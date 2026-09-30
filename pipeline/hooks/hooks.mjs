// @ts-check
// The plugin's one function-hooks module.
//
// Everything this plugin enforces today is either a script somebody has to remember to run or
// a sentence in a skill file the model is asked to obey. `docs/RUN-DEFECTS.md` is mostly a list
// of what happens when a rule is only a rule. Function hooks are the first thing in this repo
// that can refuse a tool call outright, and `docs/FUNCTION-HOOKS-PLAN.md` is the brief for
// moving the rules that matter across, one tracer at a time.
//
// This is the first of those tracers, and it guards nothing. It exists so that the next one
// starts from something already proven on this machine: that the module loads, that the events
// it names appear in the debug log, that the persistent store survives a session, and that a
// session with the flag off is exactly the plugin that shipped before it. A guard added to a
// module nobody has watched load is two unknowns, not one.
//
// Rules this file lives under, from the proof in `gate-app-function-hooks-proof/proof`:
//
//   1. Nothing here may fail a session. A hook that throws is skipped and the chain carries on,
//      but a skipped hook is a hook that did not do its job, so anything that can throw is
//      caught here and the session is told, not broken.
//   2. `next(e)` is always called and always returned. A hook that answers for core without
//      meaning to is how a plugin quietly takes over a session.
//   3. Nothing in this file re-implements a script. `lib-states.js`, `lib-wording.js` and the
//      rest stay the single authority; the module reads them through `scripts/job-context.js`.
//   4. The flag is `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. With it unset this file is never
//      loaded and the five command hooks in `hooks.json` are the whole plugin, unchanged.

import * as lib from './lib.mjs';

/** The store key holding what the last session start saw. Read by the tests and by T7 later. */
const LAST_LOAD = lib.KEYS.lastLoad;

/** How long each script gets. Both together stay under the ten seconds a hook is given. */
const CONTEXT_MS = 3000;
const PREFLIGHT_MS = 7000;

/**
 * Where the work lives, per session, learned once.
 *
 * The write guard reads every `Write` and `Edit` a run makes, and a script run per write
 * would be a second on the clock of every file the model touches. The root does not move
 * inside a session, so it is asked for once and remembered. Only an answer is remembered: a
 * `job-context.js` that could not run this time is asked again next time rather than turning
 * the root-dependent half of the table off for the rest of the session.
 *
 * @type {Map<string, string | null>}
 */
const ROOT_OF = new Map();

/** The one skill allowed to write a brand file, matched at the end of its key. */
const ONBOARD = /(^|:)onboard-brand$/;

/**
 * Who and where this session is, learned once at its start.
 *
 * The heartbeat needs both on every single tool call, and the spend guard is already spending
 * seven of its ten seconds on the pre-spend gate. Reading them again per call would put two
 * more awaits in front of every generation, so they are read where there is time for it, in
 * `session.start`, and read from here afterwards. A session whose id would not read leaves
 * these empty rather than stale: the beat then files itself under the empty key, which is
 * still this session's key and nobody else's.
 */
let SESSION = '';
let SESSION_CWD = '';

/**
 * What job this folder was on the last time a turn boundary asked, and when.
 *
 * `job-context.js` is a script run, and a turn boundary is the one place in this module that
 * can afford one: `turn.start` fires once per turn, not once per tool call. The answer is
 * kept here rather than thrown away because T5's context block and the turn boundary both want
 * the same facts inside the same turn, and a second run of the same script would be three more
 * seconds spent learning what this module already knows.
 *
 * @type {{ turnId: string, at: number, ctx: any } | null}
 */
let TURN_CTX = null;

/**
 * What the last prompt of this turn answered, when it answered anything.
 *
 * The prompt that carries a verdict and the turn that should have recorded it are two events,
 * and the store key that ties them together is the turn's own id. `prompt.submit` carries one
 * only when the prompt was typed into a running turn, so the id it had is held here rather
 * than read again at the other end: `turn.complete` gets a different id, and the `Bash` call
 * that does the recording carries none at all.
 *
 * Cleared at the end of every turn it is read on, so a reminder is given once and never twice.
 *
 * @type {{ turnId: string, at: number, kind: string, verdict: string | null } | null}
 */
let CHAT_ANSWER = null;

/**
 * When this module last told the page the run is alive, per session.
 *
 * In memory, so the common answer ("not yet") costs nothing at all. The store behind it is
 * read once per session per load, when this map has no entry, which is the only moment a
 * reload could make the page tick twice.
 *
 * @type {Map<string, number>}
 */
const BEAT_AT = new Map();

/** @type {import('claude-code').Register} */
export const register = (on) => {
  // `session.start` is the cheapest place to prove the module is alive: it fires once, it can
  // read the surface and the working directory without touching disk, and its result is echoed
  // by core, so a mistake here cannot change the session.
  on('session.start', async ($, e, next) => {
    let sessionId = 'unknown';
    try {
      sessionId = await $.session.id();
      SESSION = String(sessionId);
    } catch {
      /* an id nobody could read is not worth failing a session over */
    }
    SESSION_CWD = String(e.cwd || '');

    try {
      await $.store.set(LAST_LOAD, {
        at: new Date().toISOString(),
        sessionId,
        cwd: e.cwd,
        surface: e.surface,
        interactive: e.interactive,
      });
    } catch {
      /* the store is a convenience here; the log line below is the evidence that matters */
    }

    // One line, in the words of the plan: what loaded, where it is reading from, and whether
    // anybody is at the prompt. A `-p` run has no transcript, so this reaches the debug log
    // only, which is exactly where the tests look for it.
    $.ui.log(
      'Social Pipeline hooks are loaded. ' +
        (e.interactive ? 'Someone is at the prompt' : 'Nobody is at the prompt') +
        ', the session is working in ' +
        e.cwd +
        ', and the plugin is being read from ' +
        $.plugin.root +
        '.',
    );

    // Human waits are deliberately not scheduled here. The gate/question readers make one
    // bounded request during the turn that presents the card, then the turn ends. A supported
    // host notification or a later manual resume reads the saved decision and records it once.
    // Keeping this hook timer-free prevents a model turn from becoming a hidden network reader.
    $.ui.log('Social Pipeline uses one-shot pane reads; resume by host notification or a later manual turn.');

    return next(e);
  });

  // ---------------------------------------------------------------------------------------
  // The spend guard.
  //
  // One hook for every tool call, because a module registers one hook per event and because
  // the guard needs to watch three other tools go past to do its job: the estimate that
  // prices a clip, the two calls that report a submitted job finished, and the `Bash` calls
  // that put the quote to the person and read the answer back.
  //
  // No matcher. MCP tool names carry the server in them, and the server is
  // `plugin_social-pipeline_3echo` under this plugin's own configuration and a bare UUID
  // under a Claude Desktop connector, so only the suffix is stable (probe P5).
  // ---------------------------------------------------------------------------------------
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool || '');
    /** The call's own arguments. `e` is not `$`; a helper may read it. */
    const args = /** @type {Record<string, any>} */ (/** @type {unknown} */ (e));
    const now = $.clock.now();

    // -------------------------------------------------------------------------------------
    // The heartbeat, before any guard, because it is about the calls a guard never sees.
    //
    // A person watching the page while a run reads twenty files and spawns three agents sees
    // nothing move for minutes unless something says the run is alive. `heartbeat.js` says
    // it, and the stamp file it writes throttles this caller and the still-registered
    // `PostToolUse` command hook together, so at most one beat lands every fifteen seconds
    // however many ways it is called.
    //
    // Nothing below is awaited past this block, and the `$.process.run` is not awaited at
    // all. That is the rule the spend path is owed: a generation call has ten seconds and
    // seven of them are already spoken for, and a heartbeat is never worth a credit.
    // -------------------------------------------------------------------------------------
    if (!lib.beatSkipped(tool, e.tool_use_id)) {
      const remembered = BEAT_AT.get(SESSION);
      /** @type {any} */ let stored = null;
      if (remembered === undefined) {
        // Once per session per load, and only then. A module reloaded under a running session
        // has an empty map and a store that remembers, which is the double beat this avoids.
        try {
          stored = await $.store.get(lib.KEYS.beat(SESSION));
        } catch {
          /* an unreadable store means an extra beat at worst, and the page can take one */
        }
      }
      if (lib.beatDue(now, remembered, stored)) {
        BEAT_AT.set(SESSION, now);
        try {
          $.process.run(
            ['node', $.plugin.root + '/scripts/hooks/heartbeat.js'],
            {
              stdin: JSON.stringify(lib.beatPayload(SESSION_CWD, SESSION, tool, args)),
              timeoutMs: lib.BEAT_TIMEOUT_MS,
            },
          ).catch(() => {});
        } catch {
          /* a beat that could not even start is a beat the page does without */
        }
        try {
          $.store.set(lib.KEYS.beat(SESSION), { at: now }).catch(() => {});
        } catch {
          /* the in-memory stamp above is the one that matters within a load */
        }
      }
    }

    // The studio tools spend without ever passing a quote, a board or a gate. There is no
    // path through this pipeline that needs one, so there is nothing to check.
    if (lib.STUDIO.test(tool)) {
      $.ui.log('Social Pipeline refused ' + tool + ': ' + lib.DENY.studio);
      return { deny: lib.DENY.studio };
    }

    // -------------------------------------------------------------------------------------
    // The write guard.
    //
    // Six rules that were prose in an agent file, and one that was prose in the shared rules.
    // The classifier itself is pure and lives in `lib.mjs`; everything here is the three
    // facts it needs, each read through an op at its own call site because `$` cannot be
    // handed to anything.
    // -------------------------------------------------------------------------------------
    if (lib.WRITE_TOOLS.includes(tool)) {
      const target = lib.writeTarget(args);

      let sessionId = '';
      try {
        sessionId = String(await $.session.id());
      } catch {
        /* an unreadable id costs the cache a key, never the guard its answer */
      }

      /** @type {string | null} */ let root = ROOT_OF.get(sessionId) ?? null;
      if (!ROOT_OF.has(sessionId)) {
        try {
          const ctxRun = await $.process.run(
            ['node', $.plugin.root + '/scripts/job-context.js', '--json', ...(SESSION ? ['--session', SESSION] : [])], { timeoutMs: CONTEXT_MS });
          const ctx = lib.readJson(ctxRun.stdout);
          root = (ctx && ctx.root) || null;
          if (root) ROOT_OF.set(sessionId, root);
        } catch {
          /* no root this time means the rows that need one are not applied this time */
          root = null;
        }
      }

      // The brand files open only while the onboarding skill is running, and only because
      // that skill is the one place a person is being asked about them.
      let onboarding = false;
      try {
        onboarding = !!(await $.store.get(lib.KEYS.onboarding(sessionId)));
      } catch {
        /* a store that will not read is a closed door, which is the safe way round */
      }

      const verdict = lib.classifyWrite(target, root, $.plugin.root, onboarding);
      if (verdict.action === 'deny' && verdict.reason) {
        $.ui.log('Social Pipeline refused ' + tool + ': ' + verdict.reason);
        return { deny: verdict.reason };
      }

      // The forged approval. `hash-artifact.js` cuts the Decision section out before hashing,
      // so a section written by an agent is an approval nobody gave and nothing downstream
      // would notice.
      if (lib.isMarkdown(target)) {
        let forged = false;
        if (tool === 'Write') {
          forged = lib.isForgedDecision(args.content);
        } else if (tool === 'Edit' || tool === 'MultiEdit') {
          /** @type {string | null} */ let before = null;
          try {
            before = String(await $.fs.readFile(target));
          } catch {
            // The module cannot read above the session's own directory (probe P3). Without
            // the file there is no diff, so the replacement alone has to answer, and a
            // verdict in the replacement is a verdict wherever it was going to land.
            before = null;
          }
          forged = lib.editForgesDecision(before, lib.editsOf(args));
        }
        if (forged) {
          $.ui.log('Social Pipeline refused ' + tool + ': ' + lib.WRITE_DENY.decision);
          return { deny: lib.WRITE_DENY.decision };
        }
      }

      return next(e);
    }

    // Watching, not guarding: the quote question and its answer belong to the pane's own
    // scripts, and the guard only remembers what they said.
    if (tool === 'Bash') {
      // Except for one thing, which is not watching. A heredoc loses the file on this
      // machine, and it has already cost three writes in one run.
      if (lib.HEREDOC.test(String(args.command || ''))) {
        $.ui.log('Social Pipeline refused Bash: ' + lib.WRITE_DENY.heredoc);
        return { deny: lib.WRITE_DENY.heredoc };
      }
      const seen = lib.paneCall(args.command);
      // The other thing worth watching for: the run putting a typed verdict or answer on
      // record. Nothing is guarded here, and nothing is required of the command beyond
      // running. What the flag buys is the end of the turn: a reminder that fires because
      // nobody recorded anything is useful, and one that fires after somebody did is noise a
      // person learns to ignore, which is worse than silence.
      const recording = lib.recordsChat(args.command);
      const r = await next(e);
      if (recording && CHAT_ANSWER && !r.deny && !r.isError) {
        try {
          await $.store.set(lib.KEYS.recorded(SESSION, CHAT_ANSWER.turnId), { at: now });
        } catch {
          /* an unwritten flag costs a reminder somebody does not need, never a session */
        }
      }
      if (seen && seen.key) {
        const said = lib.quoteAnswer(lib.stdoutOf(r));
        try {
          if (said === 'offline') await $.store.set(lib.KEYS.pane(seen.key), { at: now, connected: false });
          else if (said !== null) await $.store.set(lib.KEYS.pane(seen.key), { at: now, connected: true });
          if (seen.script === 'ask') await $.store.set(lib.KEYS.asked(seen.key), { at: now });
          else if (said && said !== 'offline') await $.store.set(lib.KEYS.yes(seen.key), { at: now, verdict: said });
        } catch {
          /* a store that will not write is not a reason to fail somebody's shell command */
        }
      }
      return r;
    }

    // A clip's price is whatever the estimate said for those exact arguments, so the quote is
    // filed under a hash of them: a yes to one clip can never pay for a different one.
    if (lib.ESTIMATE.test(tool)) {
      const hash = lib.argsHash(args);
      const r = await next(e);
      try {
        const credits = lib.creditsIn(lib.resultText(r));
        if (credits !== null) await $.store.set(lib.KEYS.quote(hash), { credits, at: now });
      } catch {
        /* an unrecorded quote costs a deny later, never a broken session */
      }
      return r;
    }

    // The hero lock lifts here: the first panel has come back, so the batch may follow.
    if (lib.FINISHED.test(tool)) {
      const asked = String(args.jobId || args.id || '');
      const r = await next(e);
      try {
        if (!r.deny && !r.isError) {
          await $.store.set(lib.KEYS.lastFinish, now);
          const id = asked || lib.jobIdIn(lib.resultText(r));
          if (id) await $.store.set(lib.KEYS.finished(id), { at: now });
        }
      } catch {
        /* the lock lifting late is a slow batch; the lock never lifting is a stuck job */
      }
      return r;
    }

    if (!lib.SPENDER.test(tool)) return next(e);

    // Everything from here is inside one try, and anything that throws is a refusal. A guard
    // that fails open is not a guard: the engine skips a hook that throws and the call would
    // go straight through to the credits.
    try {
      /** @type {string | null} */ let reason = null;
      /** @type {any} */ let context = null;
      /** @type {any} */ let preflight = null;
      /** @type {any} */ let key = null;
      /** @type {any} */ let deliverable = null;
      /** @type {any} */ let spentSoFar = null;
      /** @type {any} */ let hero = null;
      let cost = 0;

      // 1. Which job this folder is working on. `job-context.js` always exits 0 with a whole
      // answer, so an empty folder reads as no job rather than as a crash.
      const ctxRun = await $.process.run(
        ['node', $.plugin.root + '/scripts/job-context.js', '--json', ...(SESSION ? ['--session', SESSION] : [])], { timeoutMs: CONTEXT_MS });
      context = lib.readJson(ctxRun.stdout);
      if (!context || !context.jobId || !context.brand) reason = lib.DENY.noJob;

      // 2. The pre-spend gate, which owns every question about whether the plan is safe: the
      // board approval, the manifest, the tool limits, the figure agreed at the gate.
      if (reason === null) {
        const pf = await $.process.run(
          ['node', $.plugin.root + '/scripts/preflight-generation.js',
            context.brand, context.jobId, '--json', '--root', context.root],
          { timeoutMs: PREFLIGHT_MS });
        preflight = lib.readJson(pf.stdout);
        if (pf.exitCode !== 0 || !preflight || preflight.safe !== true) {
          reason = lib.preflightDenied((preflight && preflight.problems) || preflight && preflight.reason || pf.stderr);
        }
      }

      // 3. Which panel of which deliverable this call is for. The arguments name no
      // deliverable, so the idempotencyKey is the only place it can come from, which is why
      // both media skills now spell the key out.
      if (reason === null) {
        key = lib.parseKey(args.idempotencyKey);
        if (!key) reason = lib.DENY.noKey;
        else if (key.jobId !== context.jobId) reason = lib.DENY.wrongJob;
      }
      if (reason === null) {
        deliverable = lib.deliverableIn(preflight, key.deliverable);
        if (!deliverable) reason = lib.DENY.unknownDeliverable;
        else if (!lib.itemsFor(tool, deliverable).includes(key.item)) reason = lib.DENY.unknownPanel;
      }

      // 4. The price. Their yes to the quote is what authorises it, not a figure on a gate.
      if (reason === null) {
        const quote = await $.store.get(lib.KEYS.quote(lib.argsHash(args)));
        const priced = lib.costOf(tool, deliverable, key.item, quote);
        if (priced === null) reason = lib.DENY.noQuote;
        else cost = priced;
      }
      // What has gone already is read for the record, not as a ceiling. A figure agreed
      // at a gate is stale the moment the person adds or cuts a panel, so the quote is
      // shown and the yes decides; nothing here compares the two.
      if (reason === null) spentSoFar = await $.store.get(lib.KEYS.spent(context.jobId));

      // 5. Their explicit yes. It is on record because the guard watched `wait-answer.js`
      // print it, and it counts only if it came after the question it answers.
      if (reason === null) {
        const yes = await $.store.get(lib.KEYS.yes(context.jobId));
        const asked = await $.store.get(lib.KEYS.asked(context.jobId));
        if (!lib.yesIsCurrent(yes, asked)) {
          // The AskUserQuestion rule: a hook asks only when somebody is at the prompt, the
          // page is known not to be connected, the question is a yes or no about spending,
          // and it has not already been asked for this call. Anything less certain refuses
          // and lets the pane's own scripts carry the question.
          const load = /** @type {any} */ (await $.store.get(lib.KEYS.lastLoad));
          const pane = /** @type {any} */ (await $.store.get(lib.KEYS.pane(context.jobId)));
          const alreadyAsked = await $.store.get(lib.KEYS.askedOnce(String(e.tool_use_id || '')));
          if (!(load && load.interactive) || !(pane && pane.connected === false) || alreadyAsked) {
            reason = lib.DENY.noYes;
          } else {
            await $.store.set(lib.KEYS.askedOnce(String(e.tool_use_id || '')), { at: now });
            let said = null;
            try {
              said = await $.ui.ask(
                'Spend ' + cost + ' credit' + (cost === 1 ? '' : 's') + ' on ' + key.deliverable + '?',
                ['Yes, generate', 'No']);
            } catch {
              /* nothing could be shown, so nobody said yes */
            }
            if (lib.classify(said) !== 'approve') reason = lib.DENY.saidNo;
          }
        }
      }

      // 6. One panel first. Look at it, then generate the rest.
      if (reason === null) {
        hero = await $.store.get(lib.KEYS.hero(context.jobId, key.deliverable));
        const finished = hero && hero.jobId ? await $.store.get(lib.KEYS.finished(hero.jobId)) : null;
        const lastFinish = await $.store.get(lib.KEYS.lastFinish);
        if (lib.heroBlocks(hero, key.item, finished, lastFinish)) reason = lib.DENY.heroFirst;
      }

      if (reason !== null) {
        $.ui.log('Social Pipeline refused ' + tool + ': ' + reason);
        return { deny: reason };
      }

      // 7. Allowed. The reservation is recorded before anything else so a session that dies
      // mid-batch still knows what it has spent.
      const r = await next(e);
      if (r.deny) return r;
      try {
        await $.store.set(lib.KEYS.spent(context.jobId),
          lib.record(spentSoFar, String(args.idempotencyKey), cost, now));
        if (!hero) {
          await $.store.set(lib.KEYS.hero(context.jobId, key.deliverable),
            { item: key.item, jobId: lib.jobIdIn(lib.resultText(r)), at: now });
        }
      } catch {
        /* the spend happened; a store that will not write must not undo the answer */
      }
      $.ui.log('Social Pipeline allowed ' + cost + ' credit' + (cost === 1 ? '' : 's') +
        ' on ' + key.deliverable + ' ' + key.item + '.');
      return r;
    } catch (err) {
      $.ui.log('Social Pipeline refused ' + tool + ': the spend check did not finish (' +
        (err instanceof Error ? err.message : String(err)) + ').');
      return { deny: lib.DENY.broke };
    }
  });

  // ---------------------------------------------------------------------------------------
  // The one door the write guard leaves open.
  //
  // The brand's own words are refused to every agent, because an agent that rewrites the
  // voice file changes what every later draft is checked against and nobody sees it happen.
  // They are written for exactly one reason: a person is being onboarded and is answering
  // questions about their brand. That is a skill, and this is the skill starting.
  //
  // No matcher. A skill's key is its plugin and its name under this plugin's own
  // installation and its bare name when the same file is loaded from a directory, so the
  // name is matched at its end, the same reason the spender tools are.
  // ---------------------------------------------------------------------------------------
  on('skill.prompt', async ($, e, next) => {
    if (ONBOARD.test(String(e.skill || ''))) {
      let sessionId = '';
      try {
        sessionId = String(await $.session.id());
      } catch {
        /* with no id the flag lands under the empty key, which is still this session's */
      }
      try {
        await $.store.set(lib.KEYS.onboarding(sessionId), { at: $.clock.now(), skill: e.skill });
      } catch {
        /* a flag that would not write leaves the brand files closed, which is the safe way */
      }
      $.ui.log('Social Pipeline opened the brand files for onboarding.');
    }
    return next(e);
  });

  // ---------------------------------------------------------------------------------------
  // The two turn boundaries.
  //
  // Neither of these guards anything, and both of them fail open: everything is in one `try`
  // and anything that throws leaves the turn exactly as it found it. That is the opposite of
  // the rule the spend path lives under, and it is the right one here. A guard that fails
  // open is not a guard; a decoration that fails closed is a session somebody cannot use.
  //
  // What they are for: a run that is waiting on a person, and a person who does not know it.
  // `docs/RUN-DEFECTS.md` records that failure twice. `turn.js` on `Stop` already puts the
  // waiting card on the page, but only when the run goes quiet with nothing said, and only
  // once per state; the status line and the sentence under the answer are the two places the
  // same fact can sit where somebody reading the chat will see it without looking for it.
  // ---------------------------------------------------------------------------------------

  on('turn.start', async ($, e, next) => {
    try {
      // `prompt.submit` fires first and reads the same facts, so the ordinary turn finds them
      // already here and costs nothing. Five seconds is the window: long enough to cover a
      // prompt and the turn it starts, short enough never to draw a state the job has left.
      const now = $.clock.now();
      let ctx = lib.freshContext(TURN_CTX, now);
      if (!ctx) {
        ctx = lib.readJson((await $.process.run(
          ['node', $.plugin.root + '/scripts/job-context.js', '--json', ...(SESSION ? ['--session', SESSION] : [])],
          { timeoutMs: lib.TURN_CONTEXT_MS })).stdout);
        TURN_CTX = { turnId: String(e.turnId || ''), at: now, ctx };
      }
      const line = lib.statusLine(ctx);
      // Nothing otherwise, and nothing means nothing: a status line saying no job is open is
      // a line somebody has to read past on every turn of every session that is not a job.
      if (line) $.ui.status(line);
    } catch {
      /* the line is decoration; a turn is not worth failing over one */
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    /** What to draw beneath the answer, in the order a person would read it. */
    /** @type {string[]} */ const lines = [];
    /** The sentence to draw beneath the answer, or null for the ordinary turn. */
    /** @type {string | null} */ let say = null;
    try {
      // A refusal is between the person and the model. A line about a storyboard hung under
      // one would read as this plugin explaining it.
      if (lib.turnWorthDrawing(e.reason)) {
        // Refreshed, never the line `turn.start` read. A turn is where the work happens, and
        // the state at the end of one is routinely not the state it began in: the state that
        // matters here is the one the person is being handed back.
        const ctx = lib.readJson((await $.process.run(
          ['node', $.plugin.root + '/scripts/job-context.js', '--json', ...(SESSION ? ['--session', SESSION] : [])],
          { timeoutMs: lib.TURN_CONTEXT_MS })).stdout);
        TURN_CTX = { turnId: String(e.turnId || ''), at: $.clock.now(), ctx };

        if (ctx && ctx.jobId && ctx.isTheirTurn && ctx.sentence) {
          const key = lib.KEYS.turn(SESSION, String(ctx.jobId), String(ctx.state || ''));
          if (!(await $.store.get(key))) {
            // Whether the page already has this open is a network fact, and `turn.js` is the
            // one thing in this repo that knows how to ask. It asks, and it posts the card
            // only when the answer is a clear no, so the check and the card stay in one place
            // rather than being half re-implemented here. `stop_hook_active` is what leaves
            // its other job, the refusal, with the `Stop` command hook where it belongs.
            await $.process.run(
              ['node', $.plugin.root + '/scripts/hooks/turn.js'],
              { stdin: JSON.stringify(lib.turnPayload(SESSION_CWD, SESSION)), timeoutMs: lib.TURN_JS_MS });
            await $.store.set(key, { at: $.clock.now() });
            // The sentence, and only the sentence. It comes from `lib-wording.js`, the one
            // table allowed to turn a state into words, so it can never carry a state id.
            say = String(ctx.sentence);
            $.ui.log('Social Pipeline said whose turn it is: ' + say);
          }
        }
      }
    } catch {
      /* nothing drawn, nothing broken: this is decoration, and a turn outranks it */
      say = null;
    }
    if (say !== null) lines.push(say);

    // -------------------------------------------------------------------------------------
    // Did the verdict they typed in the chat ever get recorded?
    //
    // The context block asked for it before the turn, and this is the only moment left to
    // check. It is its own `try`, because the sentence above and this reminder answer to
    // different people: the sentence says where the job is, and this says the pane is still
    // asking for something they have already said.
    // -------------------------------------------------------------------------------------
    try {
      const answered = CHAT_ANSWER;
      if (answered && lib.turnWorthDrawing(e.reason)) {
        // Cleared first, whatever happens below. A reminder is given once; a flag left behind
        // by something that threw would hand the same person the same line on the next turn.
        CHAT_ANSWER = null;
        let recorded = true;
        try {
          recorded = !!(await $.store.get(lib.KEYS.recorded(SESSION, answered.turnId)));
        } catch {
          // A store nobody can read is not evidence that nothing was recorded, and telling
          // somebody their verdict is lost when it is not is the more expensive mistake.
          recorded = true;
        }
        try {
          await $.store.delete(lib.KEYS.chatAnswer(SESSION, answered.turnId));
          await $.store.delete(lib.KEYS.recorded(SESSION, answered.turnId));
        } catch {
          /* a key left behind is read by nothing: both are asked for by this turn's id alone */
        }
        if (!recorded) {
          $.ui.toast(lib.omissionToast(answered));
          $.ui.log('Social Pipeline said the ' + (answered.kind === 'verdict' ? 'verdict' : 'answer')
            + ' typed in the chat is still not on record.');
          // First, above the sentence about the job: the sentence says where things stand, and
          // this says the run has not finished doing what they asked.
          lines.unshift(lib.omissionText(answered));
          // And the wake T6 left the seam for. The person has just been told; this tells the
          // run, so the next thing it does is the recording. Behind the same dedupe as the
          // wake's, and for the same reason: a hot reload must not wake the run twice for
          // one verdict. Never awaited, for the reason probe P4 gave.
          if (!(await $.store.get(lib.KEYS.woke(SESSION, answered.turnId)))) {
            await $.store.set(lib.KEYS.woke(SESSION, answered.turnId), { at: $.clock.now() });
            void $.prompt.submit({ text: lib.wakeAfterOmission(answered) }).catch(() => {});
          }
        }
      }
    } catch {
      /* the reminder is a courtesy, and a turn is worth more than one */
    }

    const r = await next(e);
    return lines.length ? { text: lines.join('\n\n') } : r;
  });

  // ---------------------------------------------------------------------------------------
  // The block the model reads beside every prompt.
  //
  // The two turn boundaries put the same fact in front of the person. This puts it in front of
  // the model, on every turn, before the turn starts: which job is open, whose turn it is,
  // what has been spent, and the two things a run gets wrong when nobody reminds it.
  //
  // It is the channel that always lands. A `tool.describe` rewrite waits for the model to
  // materialise a deferred tool (probe P5) and a deny reason arrives after the mistake; this
  // arrives first, whether or not a tool is ever called.
  //
  // What it never does is touch the text. `text` is what the person typed, and a plugin that
  // edits somebody's words before the model sees them is answering for them.
  // ---------------------------------------------------------------------------------------
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e);
    try {
      // A prompt something below dropped is not a prompt, and a context entry on it would be
      // the shape the engine skips. `origin` decides the rest: another plugin's prompt, a
      // schedule and a peer's message are not somebody asking this run to carry on.
      if (r.drop !== undefined || !lib.originCarries(e.origin)) return r;

      const now = $.clock.now();
      let ctx = lib.freshContext(TURN_CTX, now);
      if (!ctx) {
        ctx = lib.readJson((await $.process.run(
          ['node', $.plugin.root + '/scripts/job-context.js', '--json', ...(SESSION ? ['--session', SESSION] : [])],
          { timeoutMs: lib.TURN_CONTEXT_MS })).stdout);
        TURN_CTX = { turnId: String(e.turnId || ''), at: now, ctx };
      }

      const block = lib.contextBlock(ctx);
      // No job open, no block. A folder that is not a job has nothing to say about one, and a
      // block saying so would be paid for in every prompt of every session that is not a job.
      if (!block) return r;
      /** @type {string[]} */ const added = [block];

      // -----------------------------------------------------------------------------------
      // And, while a question or a review is open, what this particular prompt looks like.
      //
      // The words alone answer nearly every case, and they answer it for nothing: "approve"
      // is a verdict and "the second one" is an answer. Only a prompt that is long, or that
      // carries a verdict word somewhere other than the front, goes to a model, because
      // those are the two shapes where a guess would put a decision on record that nobody
      // made. The prompt itself is never touched and never dropped: a person's own words are
      // theirs, and a plugin that edits them is answering for them.
      // -----------------------------------------------------------------------------------
      const opening = lib.chatOpening(ctx);
      if (opening) {
        /** @type {{ kind: string, verdict?: string }} */
        let found = lib.classifyVerdict(e.text);
        if (found.kind === 'short') {
          // A few words that are not a verdict. With a question open they are its answer;
          // with only a review open they are something else, and something else is a guess.
          found = opening.question ? { kind: 'answer' } : { kind: 'ambiguous' };
        }
        if (found.kind === 'ambiguous') {
          /** @type {unknown} */ let said = null;
          try {
            // Raced against the clock rather than trusted with it: `$.model.complete` takes
            // no timeout, and a hook that runs past its ten seconds is skipped whole, which
            // would cost this prompt its context block as well as its classification.
            said = await Promise.race([
              $.model.complete({
                model: lib.CLASSIFIER_MODEL,
                system: lib.CLASSIFIER_SYSTEM,
                prompt: lib.classifierPrompt(e.text, opening),
                maxTokens: 8,
              }),
              $.clock.sleep(lib.CLASSIFY_MS).then(() => null),
            ]);
          } catch {
            /* a classifier that would not answer has said nothing, which reads as unclear */
            said = null;
          }
          found = lib.readClassifier(said) || { kind: 'none' };
        }

        const order = lib.chatOrder(found, opening);
        if (order) {
          const turnId = String(e.turnId || '');
          CHAT_ANSWER = { turnId, at: now, kind: found.kind, verdict: found.verdict || null };
          try {
            await $.store.set(lib.KEYS.chatAnswer(SESSION, turnId), CHAT_ANSWER);
          } catch {
            /* the flag in memory is the one this turn reads; the store is for the next load */
          }
          added.push(order);
          $.ui.log('Social Pipeline read that prompt as '
            + (found.verdict ? 'a verdict (' + found.verdict + ')' : 'an answer')
            + ' and asked for it to go on record first.');
        }
      }

      // Added to what the chain gave, never instead of it: a hook may not leave out an entry
      // its `next` handed up.
      return { ...r, context: [...(r.context ?? []), ...added] };
    } catch {
      /* the block is context, and a prompt is worth more than the context beside it */
      return r;
    }
  });

  // ---------------------------------------------------------------------------------------
  // The descriptions, which are decoration and are meant to be.
  //
  // An MCP tool's schema is deferred, so this fires only once the model has materialised the
  // tool (probe P5), which is to say once it already means to call it. The `tool.call` deny
  // above is the guard. This is the line that saves the model a refusal it was about to earn,
  // and it is appended to the tool's own words rather than put in place of them.
  //
  // No matcher, and the same suffix matching the spend guard uses, for the same reason: the
  // server in an MCP tool's name is this plugin's under one installation and a bare UUID under
  // a Desktop connector.
  // ---------------------------------------------------------------------------------------
  on('tool.describe', async ($, e, next) => {
    const r = await next(e);
    try {
      const addition = lib.describeAddition(e.tool);
      if (!addition) return r;
      const description = lib.appendDescription(r.description, addition);
      if (description === r.description) return r;
      $.ui.log('Social Pipeline described ' + e.tool + ' with the rule it lives under.');
      return { ...r, description };
    } catch {
      /* a description nobody could rewrite is the tool's own, which is the safe one */
      return r;
    }
  });
};
