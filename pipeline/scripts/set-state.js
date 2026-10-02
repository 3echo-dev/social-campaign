#!/usr/bin/env node
// Move a job to a new state. The only thing that writes status.md after scaffolding.
//
//   node set-state.js <brand> <job-id> <STATE> --by <who> [--note "<text>"]
//        [--notes-file <path>] [--next "<one line>"] [--blocked "<who or what>"] [--json]
//
// Status used to be edited by hand: rewrite the state, rewrite the timestamp, append a log
// row, rewrite the notes. Six string replacements in one run, and list-jobs.js then scraped
// the result, so one stray edit broke the jobs list silently.
//
// Exit 0 moved · 1 illegal transition or write failure · 2 usage · 3 job not found
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const wording = require('./lib-wording.js');
const stages = require('./lib-stages.js');
const gate = require('./lib-gate.js');
const roles = require('./lib-roles.js');
const durable = require('./lib-durable.js');
const availability = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const json = argv.includes('--json');

const resolved = ws.resolveJobArgs(argv);
const { brand, jobId, dir } = resolved;
// resolveJobArgs removes option values as well as option names, so a note or root path can
// never accidentally become the state to write.
const target = resolved.rest[0];
const by = flag('by');
const expectedState = flag('expect-state');
const expectedRevisionText = flag('expect-revision', flag('revision'));
const expectedRevision = expectedRevisionText === undefined ? null : Number(expectedRevisionText);
const reason = flag('reason', '');
const operationId = flag('operation-id', '');
const decisionId = flag('decision-id', '');
const deliveryRef = flag('delivery-ref', '');
const compatibility = argv.includes('--compatibility') || argv.includes('--migration');

if (!brand || !jobId || !target || !by) {
  console.error('usage: set-state.js <brand> <job-id> <STATE> --by <who> [--note "<text>"] [--notes-file <path>] [--next "<line>"] [--blocked "<text>"]');
  console.error('states: ' + states.ids().join(' '));
  process.exit(2);
}
if (!states.exists(target)) {
  console.error('"' + target + '" is not a state. Known states:\n  ' + states.ids().join(' '));
  process.exit(2);
}
if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
  console.error('--expect-revision must be a non-negative integer.');
  process.exit(2);
}

const statusPath = path.join(dir, 'status.md');
if (!fs.existsSync(statusPath)) {
  console.error('No job at ' + ws.fwd(dir) + '. Check the brand and job id, or scaffold it first.');
  process.exit(3);
}

let release;
try { release = durable.acquire(statusPath); } catch (e) { console.error(e.message); process.exit(1); }
const fail = (message, code = 1) => {
  console.error(message);
  try { if (release) release(); } finally { process.exit(code); }
};
let raw;
try { raw = fs.readFileSync(statusPath, 'utf8'); } catch (e) { fail('Could not read the job state: ' + e.message); }
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const field = name => {
  const m = text.match(new RegExp('\\*\\*' + name + ':\\*\\*\\s*`?([^`\\n]*)`?'));
  return m ? m[1].trim() : '';
};
const current = field('Current state');
const title = field('Title');
const revisionLine = text.match(/\*\*Revision:\*\*\s*([^\r\n]*)/i);
const revisionMatch = revisionLine && revisionLine[1].trim().match(/^`?(\d+)`?$/);
if (revisionLine && (!revisionMatch || !Number.isSafeInteger(Number(revisionMatch[1])))) {
  fail('status.md has an invalid revision. Restore the last complete state record before moving the job.');
}
const currentRevision = revisionMatch ? Number(revisionMatch[1]) : 0;
if (currentRevision >= Number.MAX_SAFE_INTEGER) fail('The job revision is exhausted. Restore the job state before continuing.');
if (expectedState && current !== expectedState) {
  fail('The job changed since this session read it. Actual state is ' + (current || 'unknown') +
    ' at revision ' + currentRevision + '. Reload its context before continuing.');
}
if (expectedRevision !== null && currentRevision !== expectedRevision) {
  fail('The job changed since this session read it. Actual revision is ' + currentRevision +
    ' (state ' + (current || 'unknown') + '). Reload its context before continuing.');
}

if (current && !states.exists(current)) {
  fail('status.md says the state is "' + current + '", which is not in the state table. Fix that line before moving on.');
}
if (states.isRetired(target)) {
  fail('The state "' + target + '" is retained for history and is no longer an active destination.');
}
if (current && states.isRetired(current) && target !== current && !compatibility) {
  fail('This job is in a retired historical state (' + current + '). Reconcile it through the compatibility migration before moving it.');
}
if (compatibility && current && states.isRetired(current) &&
    !['CANCELLED', 'COMPLETE', 'BLOCKED', 'ESCALATED'].includes(target)) {
  fail('Compatibility can move a retired job only to CANCELLED, COMPLETE, or an explicit recovery state.');
}
if (compatibility && target === 'CANCELLED' && !reason) {
  fail('A compatibility cancellation requires an explicit system reason. It must not be recorded as a user verdict.');
}
if (compatibility && current && states.isRetired(current) && ['BLOCKED', 'ESCALATED'].includes(target) && !reason) {
  fail('A compatibility recovery state requires an explicit system reason.');
}
const reportReviewComplete = current === 'AWAITING_REPORT_REVIEW' && target === 'COMPLETE';
if (target === 'COMPLETE' && current !== 'HANDOFF_READY' && !reportReviewComplete && !(compatibility && states.isRetired(current))) {
  if (current !== 'COMPLETE') fail('Production completion must begin at HANDOFF_READY with a validated handoff package.');
}
if (current === 'HANDOFF_READY' && target === 'COMPLETE') {
  if (!deliveryRef) fail('HANDOFF_READY can reach COMPLETE only with --delivery-ref after the handoff package is validated.');
  const handoff = require('./lib-handoff-validation.js');
  const verified = handoff.validateHandoff(dir, { brand, jobId, deliveryRef, requireDelivery: true });
  if (!verified.ok) fail('The handoff is not valid for production completion: ' + verified.errors.join('; '));
}
if (reportReviewComplete && !currentGateApproval(dir, states.gateOf(current))) {
  fail('AWAITING_REPORT_REVIEW can reach COMPLETE only with a current findings approval on record.');
}
if (compatibility && states.isRetired(current) && target === 'COMPLETE') {
  const handoff = require('./lib-handoff-validation.js');
  const verified = handoff.validateHandoff(dir, { brand, jobId, requireDelivery: true });
  if (!verified.ok) fail('The historical delivery cannot be completed without verified handoff evidence: ' + verified.errors.join('; '));
}
let jobRecord = {};
let routeRecord = {};
try { jobRecord = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch {}
try { routeRecord = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8')); } catch {}
const normalizedKind = String(jobRecord.kind || '').trim().toLowerCase().replace(/-/g, '_');
const normalizedWorkflow = String(routeRecord.workflowId || '').trim().toLowerCase().replace(/-/g, '_');
const reviewOnly = ['performance_review', 'performance_report'].includes(normalizedKind) || normalizedWorkflow === 'performance_review';
const compatibilityReviewCancellation = compatibility && target === 'CANCELLED' && reviewOnly && current !== 'COMPLETE';
const compatibilityHistoricalCompletion = compatibility && target === 'COMPLETE' && !reviewOnly && states.isRetired(current);
const compatibilityHistoricalRecovery = compatibility && !reviewOnly && states.isRetired(current) &&
  ['BLOCKED', 'ESCALATED'].includes(target);
// Route files do not exist during the first intake question.  Once either side of a move is
// beyond those two states, the route is required and the shared guard checks it strictly.
const routeExpected = !['INTAKE_PENDING', 'NEEDS_CLARIFICATION'].includes(current) ||
  !['INTAKE_PENDING', 'NEEDS_CLARIFICATION'].includes(target);
const available = availability.checkJobDirectory(dir, { requireJob: true, requireRoute: routeExpected });
if (!available.available) {
  const historicalCompatibility = (compatibilityReviewCancellation || compatibilityHistoricalCompletion || compatibilityHistoricalRecovery) &&
    ['HISTORICAL_EXECUTION_UNAVAILABLE', 'PERFORMANCE_REVIEW_UNSUPPORTED'].includes(available.code);
  if (!historicalCompatibility) fail(available.message || 'This job is not executable in the current build.');
}
if (current && !states.canMove(current, target, { allowRetired: compatibility })) {
  const allowed = (states.get(current).next || []);
  fail('cannot go from ' + current + ' to ' + target + '.\nFrom ' + states.label(current) +
    ' the job can go to: ' + (allowed.length ? allowed.join(', ') : 'nowhere, it is finished') + '.');
}

const stamp = ws.now(brand, argv);
const note = flag('notesFile') || flag('notes-file')
  ? fs.readFileSync(flag('notes-file') || flag('notesFile'), 'utf8').trim()
  : flag('note', '');

// Header fields.
const setField = (name, value) => {
  const re = new RegExp('(\\*\\*' + name + ':\\*\\*\\s*)`?[^`\\n]*`?', '');
  const backticked = name === 'Current state' || name === 'Revision';
  if (re.test(text)) text = text.replace(re, '$1' + (backticked ? '`' + value + '`' : value));
};
const ensureField = (name, value) => {
  const re = new RegExp('\\*\\*' + name + ':\\*\\*\\s*`?[^`\\n]*`?', 'i');
  if (re.test(text)) { setField(name, value); return; }
  const stateLine = text.match(/^(\*\*Current state:\*\*[^\n]*\n?)/mi);
  const line = '**' + name + ':** `' + value + '`\n';
  text = stateLine ? text.replace(stateLine[1], stateLine[1] + line) : line + text;
};
const nextRevision = currentRevision + 1;
setField('Current state', target);
ensureField('Revision', nextRevision);
setField('Last updated', stamp);
const nextLine = flag('next', wording.sentence(target, routeRecord.workflowId));
setField('Next action', nextLine);
setField('Blocked on', flag('blocked', states.isGate(target) ? 'You' : (target === 'BLOCKED' || target === 'ESCALATED' ? 'You' : 'Nothing')));

// Stage log: append, never rewrite.
const logHeader = /\| Timestamp \| From \| To \| By \| Note \|\n\|[-| ]+\|\n/;
const metadata = ['revision=' + nextRevision];
if (reason) metadata.push('reason=' + reason);
if (compatibility) metadata.push('compatibility=true');
if (operationId) metadata.push('operationId=' + operationId);
if (decisionId) metadata.push('decisionId=' + decisionId);
const logNote = ((note || states.label(target)) + ' [' + metadata.join('; ') + ']')
  .replace(/\|/g, '/').replace(/\n+/g, ' ');
const row = '| ' + [new Date().toISOString(), current || '-', '`' + target + '`', by, logNote].join(' | ') + ' |\n';
if (logHeader.test(text)) {
  // insert after the existing rows of that table
  const start = text.search(logHeader);
  const after = start + text.match(logHeader)[0].length;
  let end = after;
  while (end < text.length) {
    const lineEnd = text.indexOf('\n', end);
    const line = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
    if (!line.trim().startsWith('|')) break;
    end = (lineEnd === -1 ? text.length : lineEnd + 1);
  }
  text = text.slice(0, end) + row + text.slice(end);
} else {
  fail('status.md has no stage log table; the transition was not recorded. Re-scaffold from templates/status.md.');
}

// Notes describe now, so they are replaced rather than appended. A stale note reads as a live
// instruction to the next session.
if (note) {
  const m = text.match(/(\n## Notes\n)([\s\S]*)$/);
  if (m) {
    const keep = m[2].split('\n').filter(l => l.startsWith('**') && l.includes('CURRENT state')).join('\n');
    text = text.slice(0, m.index) + m[1] + (keep ? keep + '\n\n' : '\n') + note + '\n';
  } else {
    text += '\n## Notes\n\n' + note + '\n';
  }
}

try { durable.atomicWrite(statusPath, text.replace(/\n/g, nl)); }
catch (e) { fail('Could not write the job state: ' + e.message); }
release();
release = null;

const result = {
  brand, job: jobId, from: current || null, to: target,
  label: states.label(target), sentence: wording.sentence(target, routeRecord.workflowId), gate: states.gateOf(target), at: stamp,
  revision: nextRevision, syncNeeded: true, ...(compatibility ? { compatibility: true } : {}),
};
// The stepper in the pane moves with the state, so the post goes out from here rather than
// from a second call the producer has to remember. The state change is already on disk and is
// what counts, so a pane that is not connected, or is down, changes nothing but the reporting.
// The stages this job will actually walk, read from its own plan.
//
// A route that skips research still drew "Researching" in the pane, greyed, for the whole
// job. It never lights up, so the journey reads as though it stalled before it started.
const readPlan = () => { try { return fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'); } catch { return ''; } };

// Who a person sees working on a stage, read from the plan rather than from a run
// remembering to name them. Every route names an agent on every row, so no stage of any
// route shows an empty box where the workers should be.
function whatIsMade() {
  try {
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    const kinds = (job.deliverables || []).map(d => String(d.creativeDiscipline || ''));
    return {
      images: kinds.some(k => /image|carousel|ugc|video|motion/.test(k)),
      video: kinds.some(k => /ugc|video|motion/.test(k)),
    };
  } catch { return null; }
}

function currentGateApproval(jobDir, gateName) {
  if (!gateName) return null;
  const apDir = path.join(jobDir, 'approvals');
  let files;
  try { files = fs.readdirSync(apDir); } catch { return null; }
  const rounds = files
    .filter(f => f.startsWith(gateName + '-') && f.endsWith('.json'))
    .map(f => Number(f.slice(gateName.length + 1, -5)))
    .filter(n => Number.isSafeInteger(n))
    .sort((a, b) => a - b);
  if (!rounds.length) return null;
  const latest = rounds[rounds.length - 1];
  try {
    const record = JSON.parse(fs.readFileSync(path.join(apDir, gateName + '-' + latest + '.json'), 'utf8'));
    return record && record.decision === 'approved' ? record : null;
  } catch { return null; }
}

/**
 * The line under the stage, in this route's own words.
 *
 * The ten stage names are shared by every job, so a repurpose job that was watching a
 * reference video read as "Researching, looking at the audience and competitors". The plan
 * already names each row in plain English, and that name is what is actually happening.
 */
function substepFromPlan(state) {
  try {
    const plan = readPlan();
    const lines = plan.split(/\r?\n/).filter(l => l.trim().startsWith('|'));
    const cells = l => l.split('|').slice(1, -1).map(c => c.trim());
    const head = cells(lines.find(l => cells(l).includes('State after')) || '');
    const at = head.indexOf('State after');
    const nameAt = head.indexOf('Stage');
    if (at < 0 || nameAt < 0) return null;
    for (const line of lines) {
      const c = cells(line);
      if ((c[at] || '').replace(/`/g, '') !== state) continue;
      const said = c[nameAt] || '';
      if (said && said.length <= 60) return said;
    }
    return null;
  } catch { return null; }
}

function workersOn(stage, status) {
  try {
    return roles.workersFromPlan(readPlan(), stage, status === 'done' ? 'done' : 'working', whatIsMade());
  } catch { return []; }
}

function plannedStages() {
  try {
    const plan = readPlan();
    if (!plan) return null;
    const header = plan.split(/\r?\n/).find(l => l.includes('State after'));
    if (!header) return null;
    const at = header.split('|').map(c => c.trim()).indexOf('State after');
    if (at < 0) return null;
    const names = header.split('|').map(c => c.trim());
    const seen = [];
    const rows = [];
    let past = false;
    for (const line of plan.split(/\r?\n/)) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.split('|').map(c => c.trim());
      if (line === header) { past = true; continue; }
      if (!past) continue;
      const said = (cells[at] || '').replace(/`/g, '');
      if (states.exists(said)) seen.push(said);
      const row = {};
      names.forEach((name, i) => { if (name) row[name] = cells[i] || ''; });
      rows.push(row);
    }
    // The same plan rows and route the board reads, so this progress list agrees with the job page.
    return stages.walkedStages(seen, routeRecord.workflowId, { rows, route: routeRecord });
  } catch { return null; }
}

async function reportProgress() {
  const step = stages.forState(target, routeRecord.workflowId);
  if (!step) return;
  const walk = plannedStages();
  const here = workersOn(step.stage, step.status);
  await gate.call('progress', {
    key: jobId,
    ...(title ? { title } : {}),
    stage: step.stage,
    ...(substepFromPlan(target) || step.substep
      ? { substep: substepFromPlan(target) || step.substep }
      : {}),
    status: step.status,
    ...(walk ? { stages: walk } : {}),
    ...(here.length ? { activities: here } : {}),
    // The state on disk is the truth, so this post outranks a workflow row reporting late.
    fromState: true,
  }, { argv });

  // Finishing a stage is not the end of the work, and the row that picks it up may not say
  // so for several minutes. Where the state machine leaves no doubt about what comes next,
  // say it here, so the pane never reads as finished while the chat is still working.
  const onward = stages.nextRunning(target, (states.get(target) || {}).next || [], walk, routeRecord.workflowId);
  if (!onward) return;
  const next = workersOn(onward.stage, onward.status);
  await gate.call('progress', {
    key: jobId,
    ...(title ? { title } : {}),
    stage: onward.stage,
    status: onward.status,
    ...(walk ? { stages: walk } : {}),
    ...(next.length ? { activities: next } : {}),
    fromState: true,
  }, { argv });
}

reportProgress().catch(() => { /* the pane is never allowed to fail a state change */ }).then(() => {
  if (json) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
  console.log('Now: ' + wording.sentence(target, routeRecord.workflowId));
  // The mirror to a connected folder is triggered by a state change, so say so here rather
  // than making the producer remember.
  console.log('SYNC NEEDED');
});
