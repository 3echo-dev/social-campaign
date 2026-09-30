#!/usr/bin/env node
// What job this folder is working on, in one answer.
//
//   node job-context.js            one sentence a person can read
//   node job-context.js --json     the same facts as JSON, for a hook
//
// Six scripts already work this out for themselves in slightly different ways: `heartbeat.js`
// and `turn.js` find the open job, `export-events.js` reads the credit tally out of
// `status.md`, `turn.js` decides which of the ten stages a state belongs to. A function hook
// cannot require any of that, because it runs in the engine's worker rather than in node, so
// it asks for the answer through `$.process.run`. That is what this exists to answer.
//
// It resolves nothing itself. Every fact below comes from the library that owns it:
// `lib-workspace.js` for the root, `lib-open-job.js` for which job is open, `lib-states.js`
// for whether the state is a gate, `lib-wording.js` for the sentence a person reads, and
// `hooks/turn.js` for the `**Name:** value` reader and the stage lookup it already had to
// write. A second copy of any of those is a second answer waiting to disagree.
//
// It never touches the network, so it costs the same in a folder that was never connected to
// a gate app, and it always exits 0 with a whole answer: a hook that has to tell an exit code
// apart from a crash is a hook that fails closed on a folder with no jobs in it yet.
const path = require('path');
const ws = require('./lib-workspace.js');
const jobs = require('./lib-open-job.js');
const states = require('./lib-states.js');
const wording = require('./lib-wording.js');
const turn = require('./hooks/turn.js');
const sessions = require('./lib-session.js');
const memory = require('./lib-memory.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const option = name => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
};

const FACTS = path.join(__dirname, '..', '..', 'server', 'pipeline', 'facts.mjs');
const NO_CREDITS = Object.freeze({ threeEchoCredits: { spent: null, approved: null }, elevenLabsCredits: { spent: null, approved: null } });

function creditsFor(dir) {
  if (!dir) return NO_CREDITS;
  try {
    return require(FACTS).generationCredits({ dir });
  } catch {
    return NO_CREDITS;
  }
}

function creditLine(credits, unit) {
  const spent = credits && Number.isFinite(credits.spent) ? credits.spent : null;
  const approved = credits && Number.isFinite(credits.approved) ? credits.approved : null;
  if (approved === null && !spent) return null;
  return approved === null ? spent + ' ' + unit + ' credits used so far.' : (spent || 0) + ' of ' + approved + ' ' + unit + ' credits used so far.';
}

function context() {
  const root = ws.root(argv);
  const empty = {
    root: ws.fwd(root),
    brand: null,
    jobId: null,
    dir: null,
    state: null,
    revision: null,
    sentence: null,
    gate: null,
    isTheirTurn: false,
    stage: null,
    creditsSpent: null,
    creditsCeiling: null,
    credits: NO_CREDITS,
    openQuestion: null,
    openGate: null,
    recoveryRequired: false,
    bindingStale: false,
    staleBinding: null,
    executionAvailable: null,
    executionReason: null,
    sessionId: sessions.sessionId(argv),
    selectionRequired: false,
    candidates: [],
  };

  let job = null;
  const requested = option('brand') && option('job') ? { brand: option('brand'), jobId: option('job') } : null;
  try { job = jobs.openJob(argv, { explicit: requested, onStale: stale => {
    empty.bindingStale = true;
    empty.staleBinding = stale;
  }, onAmbiguous: choices => {
    empty.selectionRequired = true;
    empty.candidates = choices.map(j => ({ brand: j.brand, jobId: j.jobId }));
  } }); } catch { return empty; }
  if (!job) return empty;

  const availability = execution.checkJobDirectory(job.dir);
  if (!availability.available) {
    return {
      ...empty,
      root: ws.fwd(root),
      sessionId: sessions.sessionId(argv),
      brand: job.brand,
      jobId: job.jobId,
      dir: ws.fwd(job.dir),
      state: job.state,
      revision: job.revision,
      sentence: availability.message,
      executionAvailable: false,
      executionReason: availability.message,
    };
  }

  let researchCurrent = false;
  try { researchCurrent = require('./lib-brand-research.js').read(ws.wsDir(job.brand, argv))?.current || false; } catch {}

  const isTheirTurn = turn.isTheirTurn(job.state);
  const gate = states.gateOf(job.state);
  const credits = creditsFor(job.dir);

  // The question, in the job's own words, taken the way `turn.js` takes it for the pane:
  // `Blocked on` names the missing thing, `Next action` names the work that would follow, and
  // the first is the better of the two when a job carries both.
  const asked = isTheirTurn ? turn.whyItIsTheirTurn(job.text) : null;

  return {
    root: ws.fwd(root),
    sessionId: sessions.sessionId(argv),
    brand: job.brand,
    jobId: job.jobId,
    dir: ws.fwd(job.dir),
    state: job.state,
    revision: job.revision,
    sentence: job.state ? wording.sentence(job.state) : null,
    gate,
    isTheirTurn,
    stage: turn.stageFor(job.state, job.text),
    creditsSpent: credits.threeEchoCredits.spent,
    creditsCeiling: credits.threeEchoCredits.approved,
    credits,
    openQuestion: asked,
    // A gate the person still has to decide, as opposed to a gate the job has walked past.
    openGate: isTheirTurn ? gate : null,
    recoveryRequired: Boolean(job.corrupt),
    recoveryAction: job.corrupt ? 'Restore or repair this job status record before continuing.' : null,
    executionAvailable: true,
    executionReason: null,
    memory: memory.read(job.dir),
    brandMemory: {
      profile: ws.fwd(path.join(ws.wsDir(job.brand, argv), 'brand', 'profile.json')),
      research: ws.fwd(path.join(ws.wsDir(job.brand, argv), 'brand', 'research.json')),
      researchCurrent,
    },
  };
}

/** The plain-English form, for whoever ran this by hand. No ids, no paths that are not a folder. */
function say(c) {
  if (c.selectionRequired) return 'Several jobs are open. Select the job for this chat before continuing.';
  if (c.bindingStale) return 'The job selected for this chat is no longer available. Select a job explicitly before continuing.';
  if (!c.jobId) return 'No job is open here. Nothing is waiting on anyone.';
  if (c.executionAvailable === false) return c.executionReason || 'This job is historical and cannot be resumed in this build.';
  if (c.recoveryRequired) return c.brand + ', ' + c.jobId + '. The job state record needs recovery before this campaign can continue.';
  const lines = [c.brand + ', ' + c.jobId + '. ' + (c.sentence || 'Working on it.')];
  for (const line of [creditLine(c.credits && c.credits.threeEchoCredits, '3Echo Studio'), creditLine(c.credits && c.credits.elevenLabsCredits, 'ElevenLabs voice')]) {
    if (line) lines.push(line);
  }
  if (c.isTheirTurn && c.openQuestion) lines.push(c.openQuestion);
  return lines.join('\n');
}

if (require.main === module) {
  let c;
  try {
    c = context();
  } catch (err) {
    // Rule of this file: always a whole answer. A folder nobody has scaffolded yet is the
    // normal case at the start of a session, not a failure to report.
    c = { root: ws.fwd(process.cwd()), brand: null, jobId: null, dir: null, state: null, revision: null,
      sentence: null, gate: null, isTheirTurn: false, stage: null, creditsSpent: null,
      creditsCeiling: null, credits: NO_CREDITS, openQuestion: null, openGate: null, recoveryRequired: true,
      recoveryAction: 'Restore or repair this job status record before continuing.', bindingStale: false,
      staleBinding: null,
      unreadable: String(err && err.message || err) };
  }
  process.stdout.write((asJson ? JSON.stringify(c) : say(c)) + '\n');
}

module.exports = { context, creditsFor, say };
