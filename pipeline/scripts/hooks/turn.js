#!/usr/bin/env node
// Stop and SubagentStop hook. The pane always knows when it is the person's turn.
//
// The complaint this exists for, in the person's own words: "sometimes the chat wont mirror
// the interactive html", and more precisely "something when the chat has some clarifications,
// it wont show in the interactive html so im stuck if i cant read the chat".
//
// The shape of it: a run reaches a point where it needs an answer, asks in ordinary prose in
// the chat instead of going through `ask.js`, and stops. The pane, which is all that person is
// watching, still shows a stage with a spinner on it. They wait on the run. The run waits on
// them. Nobody moves, and the question exists on exactly one of the two surfaces.
//
// The defence up to now was a written rule plus the marker lines `ask.js` prints, and rules
// have failed here before: `docs/RUN-DEFECTS.md` records the same class of defect being
// patched in 0.5.7 with those very markers, and it came back. So this does not ask the run to
// remember anything. `Stop` fires the moment a run goes quiet, which is exactly the moment
// "the run has stopped with the person's turn outstanding" becomes true, and at that moment
// the pane is told, by the harness, whatever the run did or did not say.
//
// Two things happen here, and the second only when the first found nothing:
//
//   1. If the job's state says it is the person's turn (a gate, BLOCKED, NEEDS_CLARIFICATION)
//      and the gate app has nothing open on that page, the pane gets a waiting card carrying
//      the job's own `Next action` and `Blocked on` lines in plain English. Whatever else is
//      true, the page stops spinning and says it is over to them.
//   2. The run is refused permission to stop, once, and told to ask through `ask.js` so the
//      question lands on both surfaces. Documented contract: a `Stop` hook exiting 2 prevents
//      Claude from stopping and its stderr is the message the model reads
//      (https://code.claude.com/docs/en/hooks). A hook that blocks forever is worse than the
//      bug it fixes, so this refuses at most once per job state, and never on re-entry, which
//      `stop_hook_active` marks.
//
// Everything in step 1 holds whether or not step 2 works, which is why it comes first.
//
// The rules it may never break, the same three `heartbeat.js` lives under:
//
//   1. It never writes to stdout, and writes to stderr only as the documented way to refuse.
//   2. It exits 0 unless it is deliberately refusing. A hook that fails the turn it reports
//      on is worse than a pane that missed one beat.
//   3. It costs nothing when the folder was never connected to a gate app: no network.

const fs = require('fs');
const path = require('path');
const ws = require('../lib-workspace.js');
const gate = require('../lib-gate.js');
const jobs = require('../lib-open-job.js');
const states = require('../lib-states.js');
const stages = require('../lib-stages.js');
const roles = require('../lib-roles.js');
const { plain } = require('../lib-plain.js');
const events = require('../lib-events.js');
const durable = require('../lib-durable.js');
const execution = require('../lib-execution-availability.js');

const argv = process.argv.slice(2);

// Four seconds. This sits at the end of a turn rather than in front of a tool call, so it can
// afford a little more than the heartbeat, and still nothing like the twenty a script gets.
const TIMEOUT_MS = 4000;
const STAMP = 'turn.json';
const MAX_LINE = 160;

// The states that mean the person is being waited on. Every gate is one by definition; the
// other two are how a run says out loud that it cannot go further on its own.
const WAITING_TOO = ['BLOCKED', 'NEEDS_CLARIFICATION'];
const isTheirTurn = (state) =>
  Boolean(state) && (states.isGate(state) || WAITING_TOO.includes(state));

// What the model is told when it is refused permission to stop. One sentence of what went
// wrong and one of what to do instead: a reason the run cannot act on is a reason it ignores.
const REFUSAL = [
  'This job is waiting on the person, and the pane has nothing open on it, so the question exists only in this chat and they cannot see it.',
  'Put it to them with ask.js (or open-review.js at a gate), copy its printed questions into your next message unchanged, then wait with wait-answer.js.',
  'If nothing is actually outstanding, move the job on with set-state.js instead.',
].join(' ');

/** One field out of the `**Name:** value` lines at the top of a `status.md`. */
function field(text, name) {
  const hit = String(text || '').match(
    new RegExp('^\\s*\\*\\*' + name + ':\\*\\*\\s*(.*)$', 'mi'),
  );
  const said = hit ? hit[1].trim().replace(/^`|`$/g, '') : '';
  // The template's own placeholders, and the several ways a job writes "no answer here".
  if (/^\{.*\}$/.test(said)) return '';
  if (/^(nothing|none|n\/?a|-|tbd)\.?$/i.test(said)) return '';
  return said;
}

/**
 * The line under the stage, in words a client can act on.
 *
 * `Blocked on` is the better of the two when a job has it, because it names the thing that is
 * missing rather than the work that would follow. `route-job.js`'s `sayWhyItStopped` does the
 * same job for a router blocker and this follows its shape: a sentence, through `lib-plain.js`,
 * so no file name, path or state id can reach the page.
 */
function whyItIsTheirTurn(text) {
  const because = field(text, 'Blocked on') || field(text, 'Next action');
  const said = plain(because).split('\n')[0].trim();
  if (!said) return 'Waiting on you before this can carry on. The question is in the chat.';
  // "Blocked on: you, to say whether the bottle shows early" is the usual way a job writes it,
  // and "Waiting on you: You, to say whether" is what naive joining makes of that. The person
  // is already named by the opening, so the reason gives up its own copy of them.
  const rest = said.replace(/^you\b[\s,:-]*/i, '');
  // A reason that already opens by saying somebody is waited on keeps its own words:
  // "Waiting on you: Waiting on you to say whether it shows early" is the same stutter
  // wearing a different hat.
  const speaksForItself = /^(waiting|blocked|needs|awaiting)\b/i.test(said);
  const line = speaksForItself ? said
    : rest === said ? 'Waiting on you: ' + said
    : 'Waiting on you ' + rest;
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1).trimEnd() + '.' : line;
}

/**
 * Which of the ten stages to draw this on.
 *
 * Most states carry their own stage. `BLOCKED` and `ESCALATED` deliberately carry none, because
 * moving the stepper for them would misreport the run, so the stage is the last one the job
 * actually reached: the stage log in `status.md` is a record of exactly that, newest last.
 */
function stageFor(state, text, workflowId) {
  const here = stages.forState(state, workflowId);
  if (here) return here.stage;
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  for (let i = rows.length - 1; i >= 0; i--) {
    const cells = rows[i].split('|').map((c) => c.trim().replace(/`/g, ''));
    for (let j = cells.length - 1; j >= 0; j--) {
      const step = states.exists(cells[j]) ? stages.forState(cells[j], workflowId) : null;
      if (step) return step.stage;
    }
  }
  return null;
}

function jobWorkflowId(dir) {
  let plan = '';
  try { plan = fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'); } catch { return null; }
  return roles.planWorkflowId(plan);
}

/**
 * Is the gate app already showing this person something to do?
 *
 * `waiting` from `answer` is a question they have not answered yet; `waiting` from `decision`
 * is a review card still open. `decided` counts too: they have acted on this exact gate, so
 * putting up a card telling them to act would be telling them to do it twice.
 *
 * Returns null, not false, when the gate app could not be asked. A pane that did not answer is
 * not a pane with nothing on it, and inventing a card on the strength of a timeout is how a
 * good card ends up on top of an open question.
 */
async function somethingIsOpen(key, state) {
  const answer = await gate.call('answer?key=' + encodeURIComponent(key), null, { argv, timeoutMs: TIMEOUT_MS });
  if (answer.offline) return null;
  if (answer.status === 'waiting') return true;

  const which = states.gateOf(state);
  if (!which) return false;
  const decision = await gate.call(
    'decision?key=' + encodeURIComponent(key) + '&gate=' + encodeURIComponent(which),
    null, { argv, timeoutMs: TIMEOUT_MS },
  );
  if (decision.offline) return null;
  return decision.status === 'waiting' || decision.status === 'decided';
}

/**
 * May this turn be refused, and record it if so.
 *
 * Once per job and state, per session. A run that is refused, asks properly and then stops
 * again is stopping for a good reason, and a second refusal would be the loop that is worse
 * than the bug. `stop_hook_active` is checked by the caller: the harness sets it on re-entry
 * and gives up after eight refusals in a row of its own accord.
 */
function claimRefusal(hook, job) {
  const stampDir = path.join(ws.root(argv), ws.CONFIG_DIR);
  const stampFile = path.join(stampDir, STAMP);
  const key = [String(hook.session_id || 'unknown'), job.jobId, job.state].join('|');
  let last = null;
  try { last = JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch { /* the first turn */ }
  if (last && last.key === key) return false;
  try {
    fs.mkdirSync(stampDir, { recursive: true });
    fs.writeFileSync(stampFile, JSON.stringify({ key, at: Date.now() }) + '\n');
  } catch { return false; }   // nowhere to remember it is nowhere to stop a loop
  return true;
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('error', () => resolve(''));
    process.stdin.on('end', () => resolve(raw));
  });
}

function recordTurnObservation(hook, job) {
  if (!job || !hook || !hook.session_id) return;
  let transcriptMark = '';
  try {
    const stat = hook.transcript_path && fs.statSync(hook.transcript_path);
    transcriptMark = String(stat.size) + ':' + String(stat.mtimeMs);
  } catch {}
  const occurredAt = new Date().toISOString();
  const event = events.makeEvent(job.jobId, 'turn.observed', occurredAt, { type: 'job', id: job.jobId }, {
    state: job.state, status: isTheirTurn(job.state) ? 'waiting' : 'running',
    waiting: isTheirTurn(job.state),
  }, {
    dedupeKey: [hook.session_id, hook.hook_event_name || 'Stop', job.state, transcriptMark].join('|'),
    workspaceId: job.workspaceId || job.brand, brandId: job.brand, jobId: job.jobId,
    ownerUserId: job.ownerUserId, ownerEmail: job.ownerEmail,
    source: 'stop_hook', host: 'claude_code', quality: 'measured',
  });
  durable.update(path.join(job.dir, 'events.jsonl'), raw => {
    if (raw.split(/\r?\n/).some(line => {
      try { return JSON.parse(line).eventId === event.eventId; } catch { return false; }
    })) return raw;
    return raw + (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(event) + '\n';
  });
}

/** Resolves true when the run should be refused permission to stop. */
async function run() {
  // Run as a command it would sit forever on a stdin that never closes. Say nothing, exit 0.
  if (process.stdin.isTTY) return false;

  let hook = {};
  try { hook = JSON.parse(await readStdin()) || {}; } catch { return false; }
  // A payload with no event name on it is not a hook event, and this hook can refuse a turn,
  // so it will not act on something whose shape it does not recognise.
  if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return false;
  if (typeof hook.hook_event_name !== 'string' || !hook.hook_event_name.trim()) return false;

  // The hook's cwd is where the session is, which is what the root resolver walks up from.
  try { if (hook.cwd && fs.existsSync(hook.cwd)) process.chdir(hook.cwd); } catch { /* stay put */ }

  // Rule 3, and it comes first: a folder that was never connected costs one small read.
  if (!gate.configured(argv)) return false;

  let job = null;
  try { job = jobs.openJob(argv, { sessionId: hook.session_id }); } catch { return false; }
  if (job && !execution.checkJobDirectory(job.dir).available) return false;
  if (!job || !isTheirTurn(job.state)) return false;
  try { recordTurnObservation(hook, job); } catch { /* telemetry cannot fail a turn */ }

  const open = await somethingIsOpen(job.jobId, job.state);
  if (open !== false) return false;   // open, or the pane could not be asked

  const stage = stageFor(job.state, job.text, jobWorkflowId(job.dir));
  if (stage) {
    await gate.call('progress', {
      key: job.jobId,
      stage,
      substep: whyItIsTheirTurn(job.text),
      status: 'waiting',
      // The state on disk is the truth here, so this outranks a workflow row reporting late.
      fromState: true,
    }, { argv, timeoutMs: TIMEOUT_MS });
  }

  // The pane is right either way now. Whether the run is also made to go back and ask properly
  // is a separate question, and the answer is no on re-entry.
  if (hook.stop_hook_active === true) return false;
  return claimRefusal(hook, job);
}

/**
 * Rule 1, enforced rather than remembered.
 *
 * `lib-gate.js` writes one line to stderr when a key is refused, which is right for a script a
 * person ran and wrong for a hook nobody did, and on this event stderr is not a log line but a
 * refusal the model reads. Only the hook is silenced, never the test that reads this file.
 */
function hush() {
  const quiet = () => {};
  console.log = quiet;
  console.error = quiet;
  console.warn = quiet;
  console.info = quiet;
  console.debug = quiet;
}

module.exports = { isTheirTurn, whyItIsTheirTurn, stageFor, jobWorkflowId, field, REFUSAL, WAITING_TOO };

if (require.main === module) {
  hush();
  // Rule 2, enforced rather than remembered: nothing above may fail the turn it reports on.
  // Exit 2 is not a failure, it is the documented way to say "not yet, ask them properly".
  run().then(
    (refuse) => {
      if (refuse) process.stderr.write(REFUSAL + '\n');
      process.exit(refuse ? 2 : 0);
    },
    () => process.exit(0),
  );
}
