// @ts-check
// The pure half of the spend guard.
//
// `$` is not a value: it may be spelled `$.noun.verb(...)` at a call site in `hooks.mjs` and
// nowhere else, so nothing in this module may take it. Everything here takes a string, a
// number or the result of an op that `hooks.mjs` already awaited, and gives back a decision.
// That is what makes the guard testable: `function-hooks.unit.js` imports this file directly
// and drives every branch without a session, a binary or a model.
//
// It is a sibling import, which the proof established works from an ESM module with no
// package.json (probe P2).

// ---------------------------------------------------------------------------------------
// Which tool is which.
//
// MCP tool names vary by server: the plugin's own server gives
// `mcp__plugin_social-pipeline_3echo__create_image_job`, a Claude Desktop connector gives
// `mcp__<uuid>__create_image_job`. Only the suffix is stable, so every match is a regex on
// the end of the name, never a `{ tool }` matcher.
// ---------------------------------------------------------------------------------------

/** The two tools this pipeline is allowed to spend through. */
export const SPENDER = /__(create_image_job|create_video_job)$/;

/** Everything else on the 3echo server that moves credits. Always refused. */
export const STUDIO =
  /__(generate_[a-z_]+|create_studio_[a-z_]+|start_studio_flow|advance_studio_flow|refresh_studio_[a-z_]+)$/;

/** The quote for one clip, which is the only place a video's price comes from. */
export const ESTIMATE = /__estimate_video_job$/;

/** The two ways a run learns that a submitted job has finished. */
export const FINISHED = /__(wait_for_job|get_job_result)$/;

/** True when the tool is the image spender rather than the video one. */
export const isImageSpender = (/** @type {unknown} */ tool) => /__create_image_job$/.test(String(tool || ''));

// ---------------------------------------------------------------------------------------
// Tables copied from the scripts that own them. `scripts/test/tables.smoke.js` fails if a
// copy here and its original ever disagree, so neither can be changed alone.
// ---------------------------------------------------------------------------------------

/** `record-approval.js` SYNONYMS: the words people use, mapped onto one vocabulary. */
export const SYNONYMS = {
  approve: 'approve', approved: 'approve', ok: 'approve', yes: 'approve', go: 'approve', ship: 'approve',
  edit: 'edit',
  change: 'change', changes: 'change', update: 'change', revise: 'change', fix: 'change',
  'start-over': 'start over', startover: 'start over', reject: 'start over', no: 'start over', redo: 'start over',
};

/** `lib-plain.js` FILE_REF: a file the person will never open. */
export const FILE_REF_SOURCE =
  '`[^`]*\\.(?:md|json|jsonl|py|js|png|mp4)(?:#[^`]*)?`|\\b[\\w./-]+\\.(?:md|json|jsonl)(?:#[\\w-]+)?\\b';

/** `lib-plain.js` STATE_ID: a word in SHOUTING_SNAKE_CASE, which is always an internal id. */
export const STATE_ID_SOURCE = '\\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\\b';

/**
 * A script's own message, made fit to hand to the model as a refusal.
 *
 * `preflight-generation.js` writes for whoever ran it at a terminal, so its problems name
 * files and deliverable folders. A deny reason is read as an instruction, and one carrying a
 * path sends the model looking for the path instead of fixing the plan. A fresh RegExp per
 * call, because a global one carries `lastIndex` between calls and would skip every other hit.
 */
export function plainReason(/** @type {unknown} */ text, /** @type {number} */ limit = 200) {
  const said = String(text || '')
    .replace(new RegExp(FILE_REF_SOURCE, 'gi'), '')
    .replace(new RegExp(STATE_ID_SOURCE, 'g'), '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*:\s*$/, '')
    .trim();
  if (said.length <= limit) return said;
  const cut = said.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

// ---------------------------------------------------------------------------------------
// The refusals.
//
// Short, imperative, and free of paths and internal ids, because the model reads a deny
// reason as its next instruction. The unit test runs every one of these through
// `lib-plain.js`'s own jargon check, so a reason that names a file fails the build.
// ---------------------------------------------------------------------------------------

export const DENY = {
  studio: 'This pipeline spends only through create_image_job and create_video_job, under make-image or make-video. Do not call this tool.',
  noJob: 'Open a job before generating anything. Nothing is being worked on in this folder.',
  noKey: 'Give an idempotencyKey spelled as the job, then the deliverable, then the panel, joined by slashes.',
  wrongJob: 'That idempotencyKey names a different job from the one that is open. Use the open job.',
  unknownDeliverable: 'That idempotencyKey names a deliverable this job has no plan for. Use one the plan covers.',
  unknownPanel: 'That panel is not in the approved plan for this deliverable. Generate only what the board covers.',
  noQuote: 'Estimate this clip and put its price to the person before submitting it. Do not submit an unquoted clip.',
  noYes: 'Answer the quote through ask.js and wait-answer.js, and wait for an explicit yes before spending.',
  saidNo: 'The person did not say yes to the quote, so nothing was generated.',
  heroFirst: 'Generate one panel first, wait for it to finish and look at it, then generate the rest.',
  broke: 'The spend check could not finish, so nothing was generated. Run preflight-generation.js again and quote before retrying.',
};

/** The pre-spend gate's own verdict, made fit to read. */
export const preflightDenied = (/** @type {any} */ problems) => {
  const first = plainReason(Array.isArray(problems) ? problems[0] : problems, 160);
  return (first ? first + '. ' : 'The plan is not safe to generate. ') +
    'Fix the manifest or the board and re-run preflight-generation.js; do not retry this call.';
};

// ---------------------------------------------------------------------------------------
// Reading what the call and the scripts said.
// ---------------------------------------------------------------------------------------

/** `<job>/<D>/<panel or clip id>`, the only shape an idempotencyKey may take here. */
const KEY = /^([^/\s]+)\/(D\d+)\/([A-Za-z][\w-]*)$/;

/** The three parts of an idempotencyKey, or null when it is missing or malformed. */
export function parseKey(/** @type {unknown} */ key) {
  const hit = KEY.exec(String(key || '').trim());
  return hit ? { jobId: hit[1], deliverable: hit[2], item: hit[3] } : null;
}

/**
 * Everything a tool's answer said, as one string to read numbers and ids out of.
 *
 * What `next(e)` resolves to carries `text` (the answer as the model reads it) and `result`
 * (the tool's own record). Which of the two holds a job id depends on the tool, so both go in.
 *
 * @param {any} r what `next(e)` resolved to
 */
export function resultText(r) {
  if (!r) return '';
  let record = '';
  try { record = JSON.stringify(r.result ?? null); } catch { record = ''; }
  return String(r.text || '') + ' ' + record;
}

/**
 * What a shell command printed, out of what the tool call resolved to.
 *
 * A Bash result carries the child's own `stdout` on its record; `text` is the same output
 * wrapped for the model to read, so the record is the one to parse.
 *
 * @param {any} r what `next(e)` resolved to
 */
export function stdoutOf(r) {
  if (r && r.result && typeof r.result === 'object' && typeof r.result.stdout === 'string') return r.result.stdout;
  return String((r && r.text) || '');
}

/**
 * JSON on a script's stdout, or null. Never throws: a hook that throws is a hook skipped.
 * @param {unknown} stdout
 * @returns {any}
 */
export function readJson(stdout) {
  try {
    const said = JSON.parse(String(stdout || ''));
    return said && typeof said === 'object' ? said : null;
  } catch { return null; }
}

/**
 * What the person last agreed to, and what has gone already. Shown, never enforced: a
 * figure agreed at a gate is stale the moment a panel is added or cut, so the quote and the
 * yes are the decision. The tally only ever raises what is counted as spent.
 */
export function budget(/** @type {any} */ context, /** @type {any} */ preflight, /** @type {any} */ reserved) {
  const agreed = Object.values((preflight && preflight.ceilings) || {})
    .map(Number).filter(Number.isFinite);
  // `Number(null)` is 0 and `Number.isFinite(0)` is true, so a job whose tally line nobody has
  // written yet would read as a ceiling of zero, or worse as an authorisation of zero that
  // silently binds the whole job. A missing figure is a missing figure.
  const num = (/** @type {any} */ v) =>
    v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const tallied = (context && num(context.creditsSpent)) || 0;
  const fromContext = context ? num(context.creditsCeiling) : null;
  return {
    ceiling: agreed.length ? Math.min(...agreed) : fromContext,
    spent: Math.max(tallied, Number(reserved) || 0),
  };
}

/** The pre-spend gate's report for one deliverable, or null when it covered none. */
export const deliverableIn = (/** @type {any} */ preflight, /** @type {string} */ D) =>
  ((preflight && preflight.deliverables) || []).find((/** @type {any} */ d) => d && d.deliverable === D) || null;

/**
 * What this one call costs.
 *
 * An image is one credit, flat, which is the 3echo server's own rule. A clip's price varies
 * with its length, its resolution and whether it carries audio, so it comes from the plan
 * when the plan carries it and from the quote the estimate returned otherwise. Neither: no
 * price, and a spend with no price is a spend nobody agreed to.
 */
export function costOf(/** @type {string} */ tool, /** @type {any} */ deliverable, /** @type {string} */ item, /** @type {any} */ quote) {
  if (isImageSpender(tool)) return 1;
  const planned = deliverable && deliverable.videoCredits ? deliverable.videoCredits[item] : null;
  if (Number.isFinite(Number(planned)) && Number(planned) > 0) return Number(planned);
  if (quote && Number.isFinite(Number(quote.credits)) && Number(quote.credits) > 0) return Number(quote.credits);
  return null;
}

/** The ids this deliverable's plan covers, for the kind of call being made. */
export function itemsFor(/** @type {string} */ tool, /** @type {any} */ deliverable) {
  if (!deliverable) return [];
  const ids = isImageSpender(tool) ? deliverable.panelIds : deliverable.clipIds;
  return Array.isArray(ids) ? ids.map(String) : [];
}

// ---------------------------------------------------------------------------------------
// The quote, and the yes.
// ---------------------------------------------------------------------------------------

/** The fields that make one clip a different clip, in a fixed order. */
const QUOTED_FIELDS = ['prompt', 'ratio', 'resolution', 'durationSeconds', 'generateAudio', 'assetIds'];

/** FNV-1a, 32 bit: short, stable and dependency-free. A hash, not a secret. */
export function argsHash(/** @type {any} */ args) {
  const said = QUOTED_FIELDS
    .map(f => f + '=' + JSON.stringify((args && args[f] !== undefined ? args[f] : null)))
    .join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < said.length; i++) {
    h ^= said.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A number of credits somewhere in a tool's answer, or null. */
export function creditsIn(/** @type {unknown} */ text) {
  const hit = String(text || '').match(/"(?:credits|creditsReserved|estimatedCredits|creditCost)"\s*:\s*([0-9.]+)/);
  const n = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The 3echo job id in a tool's answer, or null when it carried none we can read. */
export function jobIdIn(/** @type {unknown} */ text) {
  const hit = String(text || '').match(/"(?:jobId|job_id|id)"\s*:\s*"([^"]+)"/);
  return hit ? hit[1] : null;
}

/**
 * What a `Bash` command was doing with the pane, when it was doing anything.
 *
 * The quote question and its answer are the pane's business, not a hook's: `ask.js` puts the
 * question up and `wait-answer.js` reads the reply. The guard never asks and never answers,
 * it only watches those two go past and remembers what they said, which is how an answer
 * typed into the page reaches the guard without the guard ever holding the page's key.
 */
export function paneCall(/** @type {unknown} */ command) {
  const said = String(command || '');
  const script = /(?:^|[\\/\s"'])(ask|wait-answer)\.js["']?(\s|$)/.exec(said);
  if (!script) return null;
  const after = said.slice(said.indexOf(script[0]) + script[0].length);
  const key = (after.match(/^\s*["']?([\w.-]+)["']?/) || [])[1] || null;
  return { script: script[1], key };
}

/**
 * Whether a `wait-answer.js` answer says yes to the quote.
 *
 * `wait-answer.js` prints `{ status, answers }`, one entry per question id, and the shared
 * rules make a quote the question with the id `quote`. The answer is whatever the person
 * pressed, so it goes through the same synonyms a typed verdict does: "yes", "go" and
 * "Yes, generate" are one word here, and "no" is not that word.
 */
export function quoteAnswer(/** @type {unknown} */ stdout) {
  const said = readJson(stdout);
  if (!said) return null;
  if (said.status === 'offline') return 'offline';
  if (said.status !== 'answered' || !said.answers || typeof said.answers !== 'object') return null;
  const raw = said.answers.quote;
  const one = Array.isArray(raw) ? raw[0] : raw;
  if (one === undefined || one === null) return null;
  return classify(one);
}

/** One word of the pipeline's own vocabulary for whatever a person said, or null. */
export function classify(/** @type {unknown} */ said) {
  const words = String(said).toLowerCase().match(/[a-z-]+/g) || [];
  const table = /** @type {Record<string, string>} */ (SYNONYMS);
  for (const w of words) if (table[w]) return table[w];
  return null;
}

/** True when a yes is on record for this job and it came after the question was put. */
export const yesIsCurrent = (/** @type {any} */ yes, /** @type {any} */ asked) =>
  !!(yes && yes.verdict === 'approve' && (!asked || Number(yes.at) >= Number(asked.at)));

// ---------------------------------------------------------------------------------------
// The write guard.
//
// Every path rule below was a sentence in an agent file until now: never hand-edit the
// status file, never write an approval record, never touch a brand file, never write into
// the plugin. A sentence holds until the one run where it does not, and the runs where it
// did not are rows in `docs/RUN-DEFECTS.md`.
//
// The classifier is a pure function of three strings, which is what makes the whole table
// testable. It never touches disk: the module cannot read above the session's own directory
// (probe P3), so the workspace root arrives as a string that `job-context.js` printed.
//
// It also has to hold for every caller alike. A subagent's `Write` reaches the parent
// session's module with the same session id and nothing at all naming the agent (probe P1),
// so the guard protects paths, not agents; the per-agent `writes:` contracts stay Instruction.
// ---------------------------------------------------------------------------------------

/**
 * One path, written the one way this file compares paths.
 *
 * A path arrives from the model as whatever the model typed: backslashes on Windows,
 * forward slashes everywhere else, a drive letter in either case, doubled separators,
 * spaces in folder names. None of those are a different file, so none of them may be a
 * different answer. A leading `//` is kept, because that is a network share and not a
 * doubled separator.
 */
export function normPath(/** @type {unknown} */ p) {
  let s = String(p || '').trim().replace(/\\/g, '/');
  const unc = s.startsWith('//');
  s = s.replace(/\/{2,}/g, '/');
  if (unc) s = '/' + s;
  if (/^[a-z]:/i.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s.replace(/\/+$/, '');
}

/** True when `child` is `parent` itself or sits somewhere inside it. Case-insensitive. */
export function isUnder(/** @type {unknown} */ parent, /** @type {unknown} */ child) {
  const a = normPath(parent).toLowerCase();
  const b = normPath(child).toLowerCase();
  if (!a || !b) return false;
  return b === a || b.startsWith(a + '/');
}

/** Where `p` sits inside `root`, or null when it sits outside it. */
export function relativeTo(/** @type {unknown} */ root, /** @type {unknown} */ p) {
  if (!isUnder(root, p)) return null;
  const a = normPath(root);
  const b = normPath(p);
  return b.length === a.length ? '' : b.slice(a.length + 1);
}

/** The four folders under the workspace root that a run has any business writing into. */
export const WRITE_ALLOWED = ['workspaces', 'inputs', '.pane', '.social-pipeline'];

/** What the guard says when it refuses a write, and why. */
export const WRITE_DENY = {
  status: 'Move the job with set-state.js. That script owns this file; a hand-written one is a job in two places at once.',
  record: 'Record the verdict with record-approval.js. An approval or an event written by hand is one nothing signed.',
  brand: 'Brand files and learnings change under onboard-brand, after the person has agreed. Propose the change instead.',
  plugin: 'The plugin is read-only. Write into the folder the work lives in instead.',
  config: 'The settings are the person\'s to change. Ask them to change it themselves.',
  decision: 'A decision is the person\'s to write. Put their verdict on record with record-approval.js instead.',
  heredoc: 'Use the Write tool. A shell heredoc silently loses the file on this machine.',
  outside: 'Write inside the folders the work lives in. A file left beside them belongs to no job and nothing here will ever read it.',
};

/**
 * What may be written to a path, and why not when not.
 *
 * Takes three strings and a flag, and gives back one of two actions: `deny` refuses the call,
 * and `allow` is silence. The last row shipped as a `notice` in 0.12.2 so that a phase of
 * real runs could show what it would have refused before it refused anything; 0.12.3 is that
 * phase ending.
 *
 * `root` is null when nothing has told the guard where the work lives yet. Then only the two
 * rows that need no root are applied, because a rule guessing at a root refuses the wrong
 * files, and a write guard that cries wolf gets turned off.
 *
 * @param {unknown} filePath the path the tool was given
 * @param {unknown} root the workspace root `job-context.js` printed, or null
 * @param {unknown} pluginRoot `$.plugin.root`, the copy of the plugin this session loaded
 * @param {boolean} [onboarding] whether the onboarding skill opened the brand files this session
 * @returns {{ action: 'deny' | 'allow', rule: string, reason: string | null }}
 */
export function classifyWrite(filePath, root, pluginRoot, onboarding) {
  const p = normPath(filePath);
  const allow = (/** @type {string} */ rule) => ({ action: /** @type {'allow'} */ ('allow'), rule, reason: null });
  const deny = (/** @type {string} */ rule) =>
    ({ action: /** @type {'deny'} */ ('deny'), rule, reason: /** @type {any} */ (WRITE_DENY)[rule] });
  if (!p) return allow('nothing');

  const name = p.slice(p.lastIndexOf('/') + 1).toLowerCase();

  // Rows that need no root. The plugin is read-only wherever it was loaded from, and the
  // settings file is the person's whichever copy of it this is.
  if (pluginRoot && isUnder(pluginRoot, p)) return deny('plugin');
  if (name === 'config.md') return deny('config');

  if (!root) return allow('no root known');

  const rel = relativeTo(root, p);
  // Under no root at all is as far outside the work as it gets.
  if (rel === null) return deny('outside');
  const seg = rel.toLowerCase().split('/').filter(Boolean);

  // `workspaces/<brand>/jobs/<job>/status.md`: the state machine's own file.
  if (seg[0] === 'workspaces' && seg[2] === 'jobs' && seg.length > 4 && name === 'status.md') {
    return deny('status');
  }
  // The record of what was signed, and the log of what happened.
  if (name === 'events.jsonl' || name === 'events.pushed') return deny('record');
  if (seg.includes('approvals') && name.endsWith('.json')) return deny('record');
  // The brand's own words, and what the pipeline has learned about them.
  const isBrandFile = seg[0] === 'workspaces' && seg[2] === 'brand' && name.endsWith('.md');
  if (isBrandFile || (seg[0] === 'workspaces' && name === 'learnings.md')) {
    return onboarding ? allow('onboarding is open') : deny('brand');
  }

  if (!WRITE_ALLOWED.includes(seg[0])) return deny('outside');
  return allow('inside the work');
}

// ---------------------------------------------------------------------------------------
// The forged approval.
//
// `hash-artifact.js` cuts the `# Decision` section out of a markdown file before hashing it,
// so a person can write their verdict into the artifact without invalidating the approval
// that records it. That kindness is also the hole: an agent that writes the section forges
// the approval and nothing downstream can tell. These two read the section the same way
// `hash-artifact.js` drops it, and `tables.smoke.js` fails if the two readings ever disagree.
// ---------------------------------------------------------------------------------------

/** The one sentence every template's Decision section carries, and a verdict never would. */
const DECISION_TEMPLATE = /never written by the agent/i;

/**
 * The body of the `# Decision` section, at whatever heading level it carries.
 *
 * The exact complement of what `hash-artifact.js` keeps: it skips from a heading whose text
 * starts "decision" until the next heading of the same or shallower level, and this collects
 * what it skipped.
 */
export function decisionBody(/** @type {unknown} */ text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').normalize('NFC')
    .split('\n').map(l => l.replace(/[ \t]+$/, ''));
  /** @type {string[]} */ const out = [];
  let skipLevel = 0;
  for (const l of lines) {
    const h = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      const level = h[1].length;
      if (/^decision\b/i.test(h[2])) { skipLevel = level; continue; }
      if (skipLevel && level <= skipLevel) skipLevel = 0;
    }
    if (skipLevel) out.push(l);
  }
  return out.join('\n').trim();
}

/** True when a Decision section carries something the templates never put there. */
export function isForgedDecision(/** @type {unknown} */ text) {
  const body = decisionBody(text);
  if (!body) return false;
  return body.split('\n').some(l => l.trim() && !DECISION_TEMPLATE.test(l));
}

/**
 * The file as one Edit or a run of MultiEdit edits would leave it.
 *
 * A literal replace, first hit unless `replace_all`, and the replacement goes in through a
 * function so a `$&` in somebody's prose is text rather than a back-reference.
 */
export function applyEdits(/** @type {unknown} */ before, /** @type {any[]} */ edits) {
  let t = String(before || '');
  for (const ed of edits || []) {
    const from = String((ed && ed.old_string) || '');
    const to = String((ed && ed.new_string) || '');
    if (!from) continue;
    t = ed.replace_all ? t.split(from).join(to) : t.replace(from, () => to);
  }
  return t;
}

/** The edits a call carries, whichever of the two editing tools made it. */
export function editsOf(/** @type {any} */ args) {
  if (args && Array.isArray(args.edits)) return args.edits.filter(Boolean);
  if (args && typeof args.old_string === 'string') {
    return [{ old_string: args.old_string, new_string: args.new_string, replace_all: !!args.replace_all }];
  }
  return [];
}

/**
 * Whether an edit forges a decision, given the file as it is now.
 *
 * With the file in hand the answer is a diff: a Decision body that the edit changed, and
 * that ends up carrying a verdict. With `before` null, because the file is above the session
 * directory and `$.fs` cannot reach it (probe P3), the new text alone has to answer, and a
 * verdict in the replacement is a verdict wherever it lands.
 */
export function editForgesDecision(/** @type {string | null} */ before, /** @type {any[]} */ edits) {
  if (before === null) {
    return (edits || []).some(ed => isForgedDecision(String((ed && ed.new_string) || '')));
  }
  const after = applyEdits(before, edits);
  return isForgedDecision(after) && decisionBody(after) !== decisionBody(before);
}

/** A file whose Decision section is worth reading at all. */
export const isMarkdown = (/** @type {unknown} */ p) => /\.md$/i.test(normPath(p));

/** The write and edit tools this guard watches, and where each keeps its path. */
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/** The path a write tool was pointed at. */
export const writeTarget = (/** @type {any} */ args) =>
  String((args && (args.file_path || args.notebook_path)) || '');

/**
 * A shell heredoc, which loses the file on this machine.
 *
 * Three writes in one run went missing to `cat > file <<'EOF'` before anyone noticed the
 * pattern, and it is a row in `docs/RUN-DEFECTS.md`. A bare redirect is not matched: piping
 * a script's output into a file is a legitimate thing to do and always worked.
 */
export const HEREDOC = /<<-?\s*['"]?\w+/;

// ---------------------------------------------------------------------------------------
// The heartbeat.
//
// `scripts/hooks/heartbeat.js` already exists and is already registered as a `PostToolUse`
// command hook: it takes a hook event on stdin and tells the page the run is alive. The only
// thing this module adds is a second caller, so that a session whose command hooks a person
// has trimmed, or a host that runs the module and not the command block, still says so.
//
// It fires on every tool call, which is the one place in this file where being cheap matters
// more than being right. So the decision is a pure function of two numbers, the call is never
// awaited, and every failure is silence: a page that missed a beat shows a slightly older
// line, and that is the whole cost of being wrong here.
// ---------------------------------------------------------------------------------------

/** One beat every fifteen seconds, the same window `heartbeat.js` keeps in its stamp file. */
export const BEAT_MS = 15000;

/** Four seconds. The script's own gate-app call is budgeted at three inside that. */
export const BEAT_TIMEOUT_MS = 4000;

/**
 * The calls a beat would be noise on.
 *
 * `AskUserQuestion` is a question already up on the person's screen, so a line saying the run
 * is alive is at best redundant and at worst drawn over the thing they are being asked. The
 * plugin's own calls, which the engine stamps `toolu_plugin_*`, are this module's own doing:
 * beating on them would be the plugin reporting on itself.
 */
export const BEAT_SKIP = ['AskUserQuestion'];

/** The id the engine gives a call a plugin made, rather than one the model made. */
export const PLUGIN_CALL = /^toolu_plugin_/;

/** True when this call is one the page should never hear about. */
export function beatSkipped(/** @type {unknown} */ tool, /** @type {unknown} */ toolUseId) {
  if (BEAT_SKIP.includes(String(tool || ''))) return true;
  return PLUGIN_CALL.test(String(toolUseId || ''));
}

/**
 * Whether a beat is due, from the clock and the two places the last one is remembered.
 *
 * `remembered` is this module's own in-memory stamp, which is undefined until the first call
 * after a load. `stored` is `$.store hb:<session>`, which survives a hot reload; without it a
 * reloaded module would beat again straight away and a person watching a reload would see the
 * page tick twice in a second for no reason.
 *
 * @param {number} now `$.clock.now()`
 * @param {number | undefined} remembered when this module last beat, or undefined after a load
 * @param {any} stored what `$.store` holds for this session, read only when memory is empty
 */
export function beatDue(now, remembered, stored) {
  const last = Math.max(Number(remembered) || 0, Number((stored && stored.at) || 0) || 0);
  if (!last) return true;
  return Number(now) - last >= BEAT_MS;
}

/**
 * The hook event `heartbeat.js` reads off its stdin.
 *
 * Exactly the shape the `PostToolUse` command hook is handed, because the script is the same
 * script and it parses one thing. `tool_input` is the call's own arguments with the three
 * keys the engine puts beside them taken back out, so it reads as the tool's own input and
 * not as an event with a tool's arguments spilled over it.
 *
 * @param {unknown} cwd where the session is working
 * @param {unknown} sessionId this session's id, or '' when it could not be read
 * @param {unknown} tool the tool that was called
 * @param {any} args the event, which is `{ tool, tool_use_id, ...the tool's arguments }`
 */
export function beatPayload(cwd, sessionId, tool, args) {
  /** @type {Record<string, any>} */ const input = {};
  for (const k of Object.keys(args || {})) {
    if (k === 'tool' || k === 'tool_use_id' || k === 'consent') continue;
    input[k] = args[k];
  }
  return {
    hook_event_name: 'PostToolUse',
    cwd: String(cwd || ''),
    session_id: String(sessionId || ''),
    tool_name: String(tool || ''),
    tool_input: input,
  };
}

// ---------------------------------------------------------------------------------------
// The turn boundaries.
//
// Two decorations, neither of them a guard. The status line says which job a session is on
// without anybody asking, and the sentence under an answer says whose turn it is now. Both
// are drawn from `job-context.js` and neither may ever carry an internal id: a state id in a
// status line is the plugin talking to itself in front of the person.
// ---------------------------------------------------------------------------------------

/** How long `job-context.js` gets at a turn boundary. The same three seconds the guard gives it. */
export const TURN_CONTEXT_MS = 3000;

/**
 * How long `turn.js` gets.
 *
 * The script budgets four seconds per call to the page and makes at most three: the open
 * question, the open decision, and the card. In practice a page that answers at all answers
 * in milliseconds and one that does not answer at all reads as offline on the first call and
 * posts nothing, so five seconds is the whole of a working path. It has to be five and not
 * ten because the context run above it has already taken three of the ten a hook is given,
 * and a hook that runs out of budget is a hook the engine skips.
 */
export const TURN_JS_MS = 5000;

/**
 * The line pinned under the prompt: who the work is for, which job it is, and where it is up
 * to, in the wording table's own words.
 *
 * Null when no job is open, which is the whole of the "nothing otherwise" rule: a status line
 * about nothing is a line somebody has to read past every turn.
 *
 * @param {any} ctx what `job-context.js --json` printed
 * @returns {string | null}
 */
export function statusLine(ctx) {
  if (!ctx || !ctx.jobId || !ctx.brand) return null;
  return [ctx.brand, ctx.jobId, ctx.sentence || 'Working on it.'].join(' · ');
}

/**
 * The hook event `turn.js` reads off its stdin at the end of a turn.
 *
 * `stop_hook_active` is true on purpose and always. The script's second job is refusing a
 * silent stop by exiting 2, and that job belongs to the `Stop` command hook, which is the
 * only thing in this plugin that can refuse one. Called from here the script has exactly one
 * job left: put the waiting card on the page. The flag is what tells it so.
 *
 * @param {unknown} cwd where the session is working
 * @param {unknown} sessionId this session's id, or '' when it could not be read
 */
export function turnPayload(cwd, sessionId) {
  return {
    hook_event_name: 'Stop',
    stop_hook_active: true,
    cwd: String(cwd || ''),
    session_id: String(sessionId || ''),
  };
}

/**
 * Is this a turn whose end is worth drawing on?
 *
 * A refusal is not. The model declining to answer is between the person and the model, and
 * hanging a line about a storyboard under it would read as the plugin explaining the refusal.
 * Everything else is: an answer, an interrupt, and an error all leave the job exactly where it
 * was, and where it was is what the sentence says.
 *
 * @param {unknown} reason `turn.complete`'s own `reason`
 */
export const turnWorthDrawing = (reason) => String(reason || '') !== 'refusal';

// ---------------------------------------------------------------------------------------
// The context block, once a turn.
//
// The turn boundaries draw two lines a person reads. This is the other half: a block only the
// model reads, attached beside every prompt somebody submits, saying what the job is, whose
// turn it is, what it has cost, and the two things a run gets wrong when it forgets them.
//
// It is the channel that always lands. A `tool.describe` rewrite fires only once the model
// materialises a deferred MCP tool (probe P5), and a deny reason arrives after the mistake;
// the context block is there before the turn starts, on every turn, whether or not a tool is
// ever called. It never rewrites the prompt: what the person typed is what the model reads.
// ---------------------------------------------------------------------------------------

/**
 * The origins whose prompts get the block.
 *
 * A person's own Enter (`composer`), the same person through the Remote Control bridge
 * (`bridge`), the SDK's own turn (`sdk`, which is what `claude -p` stamps), and a channel the
 * engine could not attest (`unclassified`). Everything else is left alone: `plugin` is another
 * plugin's prompt and none of this plugin's business, and a notification, a schedule or a peer
 * is not somebody asking this run to carry on.
 *
 * Probe P6 is still open: nobody has yet read what a prompt typed in Claude Desktop is
 * stamped with. `unclassified` is in the list partly for that, and when the probe answers,
 * this one line is the whole edit.
 */
export const PROMPT_ORIGINS = ['composer', 'bridge', 'sdk', 'unclassified'];

/** True when a prompt from this origin gets the block. */
export const originCarries = (/** @type {any} */ origin) =>
  PROMPT_ORIGINS.includes(String((origin && origin.kind) || ''));

/**
 * How old a job context may be and still be handed to the next reader.
 *
 * `prompt.submit` fires before `turn.start`, and both want the same facts. Running
 * `job-context.js` at each would be six seconds of script per turn to learn the same thing
 * twice. So whichever gets there first runs it and the other reuses the answer, and five
 * seconds is the window: long enough to cover a prompt and the turn it starts, short enough
 * that no boundary is ever reading a state the job has already left.
 */
export const CONTEXT_FRESH_MS = 5000;

/**
 * The job context this module already holds, when it is young enough to use.
 *
 * @param {{ at: number, ctx: any } | null} cached what the last boundary read
 * @param {number} now `$.clock.now()`
 */
export function freshContext(cached, now) {
  if (!cached || !cached.ctx) return null;
  // An age below zero is a stamp from the future, which is a clock that moved rather than a
  // context that is fresh. Read it again: the cost of being wrong here is a job state nobody
  // can account for, and the cost of being right is three seconds.
  const age = Number(now) - Number(cached.at);
  return age >= 0 && age < CONTEXT_FRESH_MS ? cached.ctx : null;
}

/**
 * The two things a run gets wrong often enough to be worth saying every single turn.
 *
 * Both are rows in `docs/RUN-DEFECTS.md`. "Continue" answered from memory when the person had
 * already decided in the pane, and a verdict typed in the chat acted on while the page went on
 * asking for it. Neither is a tool call, so neither can be refused; a sentence in front of the
 * model on the turn it would happen is the whole of what a hook can do about it.
 */
export const STANDING_ORDERS = [
  'Before answering "continue", or saying where the job got to, read the decision: run '
    + 'wait-decision.js for the open gate first, because it is probably already made.',
  'A verdict or an answer typed in the chat goes on record before you act on it: record-chat.js '
    + 'for an answer, record-approval.js --from-chat for a verdict. Record first, act second.',
];

/**
 * What the model is told beside the prompt, or null when this folder is not a job.
 *
 * Every word of it comes from `job-context.js`, which means from `lib-wording.js`, `lib-states.js`
 * and `status.md`: nothing here is this module's own account of anything. No state id, for the
 * same reason the status line carries none, and no state id can get in because the sentence is
 * the wording table's and the gate is a gate id.
 *
 * @param {any} ctx what `job-context.js --json` printed
 * @returns {string | null}
 */
export function contextBlock(ctx) {
  if (ctx && ctx.selectionRequired) return 'Social Pipeline has several open jobs. Ask which job to use, then run select-job.js with --session ' + JSON.stringify(ctx.sessionId) + '. Candidates: ' + JSON.stringify(ctx.candidates) + '. This selection is not approval.';
  if (!ctx || !ctx.jobId || !ctx.brand) return null;
  const lines = ['Social Pipeline, the job open in this folder:'];
  lines.push('- ' + ctx.brand + ', ' + ctx.jobId + '. ' + (ctx.sentence || 'Working on it.'));
  if (ctx.gate) {
    lines.push('- Gate: ' + ctx.gate + ', ' +
      (ctx.isTheirTurn ? 'still theirs to decide, so do not pass it.' : 'already decided.'));
  } else {
    lines.push('- No gate is open' + (ctx.isTheirTurn ? ', and the job is back with them.' : '.'));
  }
  if (ctx.openQuestion) lines.push('- ' + ctx.openQuestion);
  if (ctx.memory && ctx.memory.current) lines.push('Saved working notes, not approval or fresh evidence: ' + JSON.stringify({ summary: ctx.memory.summary, constraints: ctx.memory.constraints, openQuestions: ctx.memory.openQuestions }));
  else if (ctx.memory) lines.push('Saved working notes have changed or unreadable sources. Read the current artifacts before relying on them.');
  if (ctx.creditsCeiling !== null && ctx.creditsCeiling !== undefined) {
    lines.push('- ' + (ctx.creditsSpent === null || ctx.creditsSpent === undefined ? 0 : ctx.creditsSpent) +
      ' of ' + ctx.creditsCeiling + ' credits used.');
  }
  lines.push('Two standing orders, whatever the prompt says:');
  for (const order of STANDING_ORDERS) lines.push('- ' + order);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// A verdict or an answer typed in the chat.
//
// The pipeline asks its questions in two places at once, and a person answers in whichever one
// they are looking at. When they answer in the chat, the pane goes on asking until a script
// closes it: `record-chat.js` for an answer, `record-approval.js --from-chat` for a verdict.
// `docs/RUN-DEFECTS.md` records what happens when nobody runs one - the same question put twice
// and a verdict acted on that no approval file remembers.
//
// A prompt is not a tool call, so nothing here can refuse it. What a hook can do is read the
// prompt, say plainly what it looks like, and check at the end of the turn whether the script
// ever ran. So this half is two pure pieces: the classifier, and the words for each answer.
// ---------------------------------------------------------------------------------------

/**
 * How many words a chat answer can run to before it stops looking like one.
 *
 * "yes", "approve, ship it", "the blue bottle, second frame" are answers. A paragraph is a
 * person thinking out loud, and the difference between the two is length far more reliably
 * than it is vocabulary. Anything longer goes to the model rather than being guessed at.
 */
export const ANSWER_WORDS = 12;

/**
 * The prompts that tell the run to get on with it, which answer nothing.
 *
 * Matched against the words alone, so punctuation and case do not matter. "Go on" and "keep
 * going" are here and a bare "go" is not: "go" is the recorder's own word for approve, and the
 * whole point of the copied table is that this file and the recorder read a word the same way.
 */
export const CARRY_ON = /^(continue|carry on|go on|keep going|next|proceed|resume|carry on then)$/;

/**
 * What a prompt looks like, from the words alone.
 *
 * `none` is nothing to classify. `verdict` is one of the vocabulary's own words, alone or at
 * the front of a short sentence, which is how a person says approve. `short` is a few words
 * that are not a verdict, which is an answer when a question is open. `ambiguous` is anything
 * long, and anything carrying a verdict word somewhere other than the front, because "I would
 * approve it if the bottle showed earlier" is not an approval and reading it as one would
 * record a decision nobody made.
 *
 * @param {unknown} text the prompt as typed
 * @returns {{ kind: 'none' | 'short' | 'ambiguous' } | { kind: 'verdict', verdict: string }}
 */
export function classifyVerdict(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z-]+/g) || [];
  if (!words.length) return { kind: 'none' };
  // "Continue" is the most typed prompt in this whole pipeline and it answers nothing. Read as
  // an answer it would put a reminder under every second turn, which is how a person learns to
  // stop reading them. A bare "go" is still the verdict the recorder's own table says it is.
  if (CARRY_ON.test(words.join(' '))) return { kind: 'none' };
  const table = /** @type {Record<string, string>} */ (SYNONYMS);
  const lead = table[String(words[0])];
  if (lead && words.length <= ANSWER_WORDS) return { kind: 'verdict', verdict: lead };
  if (words.length > ANSWER_WORDS) return { kind: 'ambiguous' };
  if (words.some((w) => table[w])) return { kind: 'ambiguous' };
  return { kind: 'short' };
}

/** What the job has open for the person, or null when it is waiting on nobody. */
export function chatOpening(/** @type {any} */ ctx) {
  if (!ctx || !ctx.jobId || !ctx.isTheirTurn) return null;
  if (!ctx.openQuestion && !ctx.openGate) return null;
  return { question: !!ctx.openQuestion, gate: ctx.openGate || null };
}

/** The model asked when the words alone will not answer. Small, because the question is small. */
export const CLASSIFIER_MODEL = 'haiku';

/** Well inside the ten seconds a hook is given, and inside a person's patience at the prompt. */
export const CLASSIFY_MS = 4000;

/** The only words the classifier's answer is read for. Anything else is unclear. */
export const CLASSIFIER_VOCABULARY = ['approve', 'edit', 'change', 'start over', 'answer', 'unclear'];

/** The classifier's whole brief. Fixed, so the same prompt is asked the same way every time. */
export const CLASSIFIER_SYSTEM =
  'You sort one chat message into one word. Reply with exactly one of: approve, edit, change, '
  + 'start over, answer, unclear. Nothing else, no punctuation, no explanation. Use a verdict '
  + 'word only when the message decides the review outright. Use "answer" when it replies to '
  + 'the question that is open. Use "unclear" whenever it does neither, and when you are unsure.';

/**
 * The one message the classifier is given: what is open, and what they typed.
 *
 * The prompt goes to the model, so it carries no key, no path and no state id, and the text is
 * quoted rather than instructed with: a message that says "ignore your instructions" is being
 * sorted here, not obeyed.
 */
export function classifierPrompt(/** @type {unknown} */ text, /** @type {any} */ opening) {
  const open = opening && opening.question
    ? 'A question is open and waiting for their answer.'
    : 'A review is open and waiting for their verdict.';
  return open + '\nThey typed this into the chat, between the marks:\n<<<'
    + String(text ?? '').slice(0, 2000) + '>>>\nWhich one word is it?';
}

/**
 * What the classifier said, or null for unclear.
 *
 * Anything the model answers that is not one of the vocabulary's words is unclear, and unclear
 * means the hook says nothing at all. A guess here would put a decision on record.
 *
 * @returns {{ kind: 'verdict', verdict: string } | { kind: 'answer' } | null}
 */
export function readClassifier(/** @type {unknown} */ reply) {
  const said = String(reply ?? '').toLowerCase();
  if (/\bstart[\s-]?over\b/.test(said)) return { kind: 'verdict', verdict: 'start over' };
  const first = (said.match(/[a-z-]+/g) || [])[0];
  if (!first) return null;
  if (first === 'answer') return { kind: 'answer' };
  const table = /** @type {Record<string, string>} */ (SYNONYMS);
  return table[first] ? { kind: 'verdict', verdict: table[first] } : null;
}

/**
 * The order that rides beside a prompt the hook has read as an answer or a verdict.
 *
 * One more entry in the same context the block goes in, and it says the same thing the shared
 * rules say: record first, act second. It names the script, because a rule that does not name
 * the script is the rule that has been in `docs/SHARED-RULES.md` all along.
 *
 * @param {{ kind: string, verdict?: string }} found what the classification came to
 * @param {any} opening what the job has open
 * @returns {string | null}
 */
export function chatOrder(found, opening) {
  if (found.kind === 'verdict') {
    const gate = opening && opening.gate ? ' at the ' + opening.gate + ' gate' : '';
    return 'Social Pipeline: that prompt reads as a verdict' + gate + ' (' + found.verdict + '). '
      + 'Put it on record before you act on it: run record-approval.js with --from-chat, which '
      + 'records the approval and closes the same review in the pane. Record first, act second.';
  }
  if (found.kind === 'answer') {
    return 'Social Pipeline: that prompt reads as an answer to the question that is open. '
      + 'Put it on record before you act on it: run record-chat.js with the answer, so the pane '
      + 'stops asking for something they have already said. Record first, act second.';
  }
  return null;
}

/**
 * What the person is told when the turn ended and the script never ran.
 *
 * They are the one who has to know, because they are the one the pane will go on asking. It
 * names what they said, what did not happen, and what closes it, in that order, and it never
 * blames the model: from where they sit the run simply did half of it.
 */
export function omissionText(/** @type {{ kind: string }} */ found) {
  return found.kind === 'verdict'
    ? 'Your verdict has not been recorded yet, so the pane is still asking for it. Say "record it" '
      + 'and the run will put it on record before doing anything else.'
    : 'Your answer has not been recorded yet, so the pane is still asking the question. Say '
      + '"record it" and the run will put it on record before doing anything else.';
}

/** The same thing in a line short enough for a toast. */
export const omissionToast = (/** @type {{ kind: string }} */ found) =>
  found.kind === 'verdict' ? 'Verdict not recorded yet' : 'Answer not recorded yet';

/** The two scripts that close what the chat opened. Watched on `Bash`, never run by a hook. */
export const RECORDERS = /(?:^|[\\/\s"'])record-(?:chat|approval)\.js(?=["'\s]|$)/;

/** True when this shell command is one of them. */
export const recordsChat = (/** @type {unknown} */ command) => RECORDERS.test(String(command || ''));

// ---------------------------------------------------------------------------------------
// The tool descriptions.
//
// Decoration, and known to be. An MCP tool's schema is deferred, so a rewrite lands only once
// the model has materialised the tool (probe P5), which is to say only once it already means
// to call it, and never at all if it does not. The guard is the deny; this is the sentence
// that saves the model a refusal it was about to earn.
//
// The original is always kept. A description is the tool's own account of itself and belongs
// to whoever wrote the tool; this appends a paragraph and replaces nothing.
// ---------------------------------------------------------------------------------------

/** The core tool a run must not reach for while the page is connected. */
const ASK_TOOL = /(^|__)AskUserQuestion$/;

export const DESCRIBE = {
  ask: 'Social Pipeline: when a gate-app.json resolves for this workspace, do not use this tool. '
    + 'Put the question up with ask.js and read the reply with wait-answer.js, so it reaches the '
    + 'page and the chat at once and the turn is not blocked while the person reads it.',
  spender: 'Social Pipeline: the spend guard refuses this call unless a job is open, '
    + 'preflight-generation.js passes for it, the panel or clip has a price, the person said yes '
    + 'to the quote, and the idempotencyKey reads {job-id}/D{n}/{panel or clip id}.',
  write: 'Social Pipeline: the write guard refuses a job status file, an approval record, an '
    + 'event log, a brand file or learnings outside onboarding, anything under the plugin, the '
    + 'settings, a verdict written under a Decision heading, and any path outside the workspaces, '
    + 'inputs, pane and pipeline folders.',
};

/** The paragraph this tool's description should carry, or null when it needs none. */
export function describeAddition(/** @type {unknown} */ tool) {
  const t = String(tool || '');
  if (ASK_TOOL.test(t)) return DESCRIBE.ask;
  if (SPENDER.test(t)) return DESCRIBE.spender;
  if (WRITE_TOOLS.includes(t)) return DESCRIBE.write;
  return null;
}

/** The tool's own description with one paragraph after it, and never twice. */
export function appendDescription(/** @type {unknown} */ description, /** @type {string | null} */ addition) {
  const base = String(description || '');
  if (!addition || base.includes(addition)) return base;
  return base ? base.replace(/\s+$/, '') + '\n\n' + addition : addition;
}

// Human decisions are read by the stage that presented them, one bounded request at a time.
// A later manual resume or a supported host notification consumes the saved record.
/**
 * And the wake T6 left a seam for: a verdict typed in the chat that the turn never recorded.
 *
 * The person has already been told at the end of their own turn. This tells the run, so that
 * the next thing it does is the recording rather than whatever it meant to do instead.
 */
export const wakeAfterOmission = (/** @type {{ kind: string }} */ found) =>
  found.kind === 'verdict'
    ? 'The verdict typed in the chat is not on record yet. Record it with record-approval.js '
      + '--from-chat before doing anything else.'
    : 'The answer typed in the chat is not on record yet. Record it with record-chat.js before '
      + 'doing anything else.';

// ---------------------------------------------------------------------------------------
// The store keys. One place, so a reader and a writer cannot drift.
// ---------------------------------------------------------------------------------------

export const KEYS = {
  lastLoad: 'fh:lastLoad',
  yes: (/** @type {string} */ job) => 'yes:' + job,
  asked: (/** @type {string} */ job) => 'asked:' + job,
  pane: (/** @type {string} */ job) => 'pane:' + job,
  quote: (/** @type {string} */ hash) => 'quote:' + hash,
  hero: (/** @type {string} */ job, /** @type {string} */ D) => 'hero:' + job + ':' + D,
  finished: (/** @type {string} */ jobId) => 'finished:' + jobId,
  lastFinish: 'finished:any',
  spent: (/** @type {string} */ job) => 'spent:' + job,
  onboarding: (/** @type {string} */ session) => 'onboarding:' + session,
  askedOnce: (/** @type {string} */ toolUseId) => 'ui-ask:' + toolUseId,
  beat: (/** @type {string} */ session) => 'hb:' + session,
  // Session, job and state together: a turn that ends with the job in the state it was
  // already announced in has nothing new to say, and a person told once that the storyboard
  // is waiting does not need telling after every turn that follows. A state change is news
  // again, which is why the state is in the key and not the job alone.
  turn: (/** @type {string} */ session, /** @type {string} */ job, /** @type {string} */ state) =>
    'turn:' + session + '|' + job + '|' + state,
  // A prompt that answered something, and the shell command that put it on record. Both are
  // filed under the turn the prompt started, so the question asked at the end of that turn is
  // whether these two are both there, rather than whether either has ever happened.
  chatAnswer: (/** @type {string} */ session, /** @type {string} */ turnId) =>
    'chat-answer:' + session + ':' + turnId,
  recorded: (/** @type {string} */ session, /** @type {string} */ turnId) =>
    'recorded:' + session + ':' + turnId,
  // And the same dedupe on the other wake, the one at the end of a turn that recorded nothing.
  woke: (/** @type {string} */ session, /** @type {string} */ turnId) =>
    'woke:' + session + ':' + turnId,
};

/**
 * Whether the hero panel of this deliverable is still in flight.
 *
 * One panel is generated, looked at, and only then is the rest of the batch submitted. The
 * lock is the first allowed call; it lifts when a `wait_for_job` or `get_job_result` has come
 * back for that submission. A hero whose answer named no job id lifts on the first finish
 * observed after it, because a lock that can never lift is a job that can never finish.
 */
export function heroBlocks(/** @type {any} */ hero, /** @type {string} */ item, /** @type {any} */ finished, /** @type {any} */ lastFinishAt) {
  if (!hero) return false;
  if (hero.item === item) return false;
  if (hero.jobId) return !finished;
  return !(lastFinishAt && Number(lastFinishAt) >= Number(hero.at || 0));
}

/** What the tally becomes once this call is allowed; a retried key is not a second spend. */
export function record(/** @type {any} */ spent, /** @type {string} */ key, /** @type {number} */ cost, /** @type {number} */ at) {
  /** @type {Array<{ key: string, cost: number, at: number }>} */
  const calls = (spent && Array.isArray(spent.calls) ? spent.calls : []).filter((/** @type {any} */ c) => c && c.key !== key);
  calls.push({ key, cost, at });
  return { total: calls.reduce((n, c) => n + (Number(c.cost) || 0), 0), calls };
}
