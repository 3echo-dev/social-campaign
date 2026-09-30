#!/usr/bin/env node
// Record a human verdict at a gate, bound to the artifacts' content hashes at decision time.
//
//   node record-approval.js <brand> <job-id> <gate> <approve|edit|changes|reject> --by "Name"
//        [--comment "..."] [--score 1-5] [--why "..."] [--gate-app-decision-id ID]
//        [--max-credits N] [--publish-plan] [--chosen PANEL-ID] [--channel chat|file] [--from-chat]
//        <file-relative-to-job...>
//
// Writes approvals/<gate>-<round>.json validated against schemas/approval.schema.json.
// "edit" means the human changed the file and approves it as it now is. Exit 0 ok, 1 error, 2 usage.
const fs = require('fs');
const path = require('path');
const { hashFile, normalizeMarkdown } = require('./hash-artifact.js');
const crypto = require('crypto');
const { validate } = require('./validate-schema.js');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const execution = require('./lib-execution-availability.js');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const pos = [], opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['publish-plan', 'from-chat'].includes(k)) opts[k] = true;
    else opts[k] = argv[++i];
  } else pos.push(a);
}
const GATES = states.GATE_IDS;
// One vocabulary, with the words people actually use mapped onto it.
const SYNONYMS = {
  approve: 'approve', approved: 'approve', ok: 'approve', yes: 'approve', go: 'approve', ship: 'approve',
  edit: 'edit',
  change: 'change', changes: 'change', update: 'change', revise: 'change', fix: 'change',
  'start-over': 'start over', startover: 'start over', reject: 'start over', no: 'start over', redo: 'start over',
};
const VERDICTS = { approve: 'approved', edit: 'approved', change: 'changes_requested', 'start over': 'rejected' };

// The vocabulary is the export; recording a verdict is not. `hooks/hooks.mjs` carries a copy
// of SYNONYMS, because a function hook cannot require a CommonJS script, and
// `scripts/test/tables.smoke.js` fails if the two ever disagree. Required rather than run,
// this file stops here: everything below writes a file and moves a job.
module.exports = { GATES, SYNONYMS, VERDICTS };
if (require.main !== module) return;

const { brand, jobId: job, dir, rest } = ws.resolveJobArgs(pos, argv);
const [gate, rawVerdict, ...files] = rest;
const verdict = SYNONYMS[String(rawVerdict || '').toLowerCase()] || rawVerdict;
if (gate === 'report') {
  console.error('UNSUPPORTED: ' + execution.PERFORMANCE_UNSUPPORTED);
  process.exit(4);
}
if (!brand || !job || !GATES.includes(gate) || !VERDICTS[verdict] || !files.length || !opts.by) {
  console.error('usage: record-approval.js <brand> <job-id> <' + GATES.join('|') + '> <approve|edit|change|start over> --by "Name" [--comment "..."] [--score 1-5] [--why "..."] [--gate-app-decision-id ID] [--max-credits N] [--publish-plan] [--chosen PANEL-ID] [--channel chat|file] <file...>');
  process.exit(2);
}
// The gate-app widget returns a 1-5 rating and a sentence with the verdict. Both are optional,
// because a verdict typed in chat carries neither, and both are validated when present.
const score = opts.score !== undefined ? Number(opts.score) : null;
if (opts.score !== undefined && (!Number.isInteger(score) || score < 1 || score > 5)) {
  console.error('REFUSED: --score must be an integer from 1 to 5');
  process.exit(1);
}
const jobDir = dir;
let expectedArtifacts = null;
if (opts['expected-artifacts']) {
  try { expectedArtifacts = JSON.parse(opts['expected-artifacts']); } catch { console.error('REFUSED: malformed expected artifact hashes'); process.exit(1); }
  if (!Array.isArray(expectedArtifacts) || expectedArtifacts.length !== files.length) { console.error('REFUSED: expected artifact set differs from the review'); process.exit(1); }
}
const expectedRevision = opts['expect-revision'] === undefined ? null : Number(opts['expect-revision']);
if (expectedRevision !== null) {
  const statusText = fs.readFileSync(path.join(jobDir, 'status.md'), 'utf8');
  const currentRevision = Number(statusText.match(/\*\*Revision:\*\*\s*`?(\d+)/)?.[1] || 0);
  const currentState = statusText.match(/\*\*Current state:\*\*\s*`?([A-Z_]+)/)?.[1];
  if (!Number.isSafeInteger(expectedRevision) || currentRevision !== expectedRevision || states.gateOf(currentState) !== gate) {
    console.error('REFUSED: job revision or review gate has changed'); process.exit(1);
  }
}
const directoryAvailability = execution.checkJobDirectory(jobDir, { requireJob: true });
const availability = directoryAvailability;
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}
// Which gates this route kept decides where "start over" lands: a static post with no concept
// gate rolls back to the brief. A job folder without a readable route.json still records a
// verdict, it just gets the route-independent answer.
const routeGates = () => {
  try { return JSON.parse(fs.readFileSync(path.join(jobDir, 'route.json'), 'utf8')).gates || []; }
  catch { return []; }
};
const isApproval = VERDICTS[verdict] === 'approved';
const maxCredits = opts['max-credits'] !== undefined ? Number(opts['max-credits']) : null;
// Credits are whole. A fraction is a typo, not a budget.
if (opts['max-credits'] !== undefined && (!Number.isInteger(maxCredits) || maxCredits < 0)) {
  console.error('REFUSED: --max-credits must be a finite non-negative number');
  process.exit(1);
}
if (gate === 'concept' && isApproval && maxCredits === null) {
  console.error('REFUSED: an approved concept must include --max-credits, using 0 when no credits may be spent');
  process.exit(1);
}
// There is no preset budget on a brand or in the plugin's own settings any more. The
// estimate says what each way costs and the person picks one, and what they pick is what
// gets recorded here. A fixed ceiling turned a 91-credit quote into a dead end instead of a
// decision, and refusing their own answer for exceeding a number they never set is worse.
//
// `--max-credits` is still required on an approved concept, because a spend nobody put a
// figure against is a spend nobody authorised.
const apDir = path.join(jobDir, 'approvals');
fs.mkdirSync(apDir, { recursive: true });
const prev = fs.readdirSync(apDir).filter(f => f.startsWith(gate + '-') && f.endsWith('.json'))
  .map(f => +f.slice(gate.length + 1, -5)).filter(n => !isNaN(n)).sort((a, b) => a - b);
const round = (prev[prev.length - 1] || 0) + 1;

const artifacts = [];
for (const f of files) {
  const p = path.join(jobDir, f);
  if (!fs.existsSync(p)) { console.error('missing artifact: ' + f); process.exit(1); }
  const canonicalPath = f.split(path.sep).join('/').replace(/^\.\//, '');
  let h, reviewedRawSha256;
  if (expectedArtifacts) {
    const raw = fs.readFileSync(p);
    reviewedRawSha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const expected = expectedArtifacts.find(item => item.path === canonicalPath);
    if (!expected || reviewedRawSha256 !== expected.sha256) { console.error('REFUSED: reviewed artifact changed: ' + canonicalPath); process.exit(1); }
    const normalized = /\.md$/i.test(p) ? Buffer.from(normalizeMarkdown(raw.toString('utf8'))) : raw;
    h = { sha256:crypto.createHash('sha256').update(normalized).digest('hex'), bytes:normalized.length };
  } else h = hashFile(p);
  artifacts.push({ path: canonicalPath, sha256: h.sha256, bytes: h.bytes, ...(reviewedRawSha256 ? { reviewedRawSha256 } : {}) });
}
// An approval is an audit record, so it carries the workspace's zone, not the process's.
const when = ws.now(brand, process.argv);

const rec = {
  schemaVersion: '1.0', approvalId: gate + '-' + round, jobId: job, brand, gate, round,
  decision: VERDICTS[verdict], edited: verdict === 'edit', artifacts,
  decidedBy: opts.by, decidedAt: when, channel: opts.channel === 'file' ? 'file' : 'chat',
  comment: opts.comment || '',
  ...(expectedRevision !== null ? { artifactRevision: expectedRevision } : {}),
  ...(score !== null ? { score } : {}),
  ...(opts.why ? { why: opts.why } : {}),
  ...(opts['gate-app-decision-id'] ? { gateAppDecisionId: opts['gate-app-decision-id'] } : {}),
  // A pick_one gate returns the one panel the human chose; the rest were dropped, not rejected.
  ...(opts.chosen ? { chosen: opts.chosen } : {}),
  scope: { publishPlanIncluded: !!opts['publish-plan'], maxSpendCredits: maxCredits },
  supersedes: prev.length ? gate + '-' + prev[prev.length - 1] : null,
};
const errs = validate(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'approval.schema.json'), 'utf8')), rec);
if (errs.length) { console.error('record fails schema: ' + errs.map(e => e.path + ' ' + e.message).join('; ')); process.exit(1); }
const out = path.join(apDir, rec.approvalId + '.json');
fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
if (argv.includes('--human')) {
  const said = { approve: 'Approved', change: 'Noted, changes wanted', 'start over': 'Starting that over' };
  console.log((said[rec.decision] || rec.decision) + (rec.edited ? ', with your edits' : '') + '.');
} else {
  console.log(rec.decision + (rec.edited ? ' (edited)' : '') + ': ' + out.split(path.sep).join('/'));
  for (const a of artifacts) console.log('  ' + a.sha256.slice(0, 12) + '  ' + a.path);
}

// A verdict typed in the chat has to close the review that is still open in the pane, or the
// page goes on asking for something the person has already decided. --from-chat says this is
// that case, so the same verdict goes to the gate app as well. Silent when it is not connected.
if (opts['from-chat']) {
  const gateApp = require('./lib-gate.js');
  gateApp.call('decision', {
    key: job, gate, decision: rec.decision, score: score === null ? undefined : score,
    ...(rec.chosen ? { chosen: rec.chosen } : {}),
    ...(rec.comment ? { comments: rec.comment } : {}),
    decidedBy: rec.decidedBy,
  }, { argv }).catch(() => { /* the pane never fails a recorded approval */ });
}

// Move the state here, so an approval and the state it implies cannot drift apart.
// approve or edit -> the gate's approved state; change -> CHANGES_REQUESTED;
// start over -> the gate's rollback, which is the decision before this one.
const target = rec.decision === 'approved'
  ? states.APPROVED_STATE[gate]
  : (rec.decision === 'changes_requested'
      ? 'CHANGES_REQUESTED'
      : states.rollbackFor(states.AWAITING_STATE[gate], routeGates()));

if (target) {
  const note = rec.decision === 'approved'
    ? 'Approved by ' + rec.decidedBy + (rec.comment ? ': ' + rec.comment : '')
    : (rec.comment || 'Sent back by ' + rec.decidedBy);
  const move = spawnSync(process.execPath,
    [path.join(__dirname, 'set-state.js'), brand, job, target, '--by', rec.decidedBy, '--note', note]
      // Without --root the child resolves the workspace from cwd and moves a same-named job elsewhere.
      .concat(argv.includes('--root') ? ['--root', argv[argv.indexOf('--root') + 1]] : [])
      .concat(expectedRevision !== null ? ['--expect-revision', String(expectedRevision), '--expect-state', states.AWAITING_STATE[gate]] : []),
      // The state writer checks this under its own lock.
    { encoding: 'utf8' });
  if (move.status === 0) {
    process.stdout.write(move.stdout);
  } else if (move.status === 3) {
    // No status.md to move: a job folder that this pipeline did not scaffold. The record is
    // still valid, and there is no state to drift from, so this is a note rather than a failure.
    console.error('Recorded. There is no status.md for this job, so nothing was moved to ' + target + '.');
  } else {
    if (expectedRevision !== null) {
      const failedDir = path.join(jobDir, '.decision-reconciliation');
      fs.mkdirSync(failedDir, { recursive: true });
      fs.renameSync(out, path.join(failedDir, rec.approvalId + '-' + crypto.randomUUID() + '.json'));
    }
    // The record is written and correct; only the state move failed, so say exactly that.
    console.error('The decision was recorded, but the job could not be moved to ' + target + ':');
    console.error((move.stderr || '').trim());
    console.error('Move it with: set-state.js ' + brand + ' ' + job + ' ' + target + ' --by "' + rec.decidedBy + '"');
    process.exit(1);
  }
}
