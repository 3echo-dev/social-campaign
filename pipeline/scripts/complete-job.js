#!/usr/bin/env node
// Complete production after the handoff package has been delivered.
//
//   node complete-job.js <brand> <job-id> --delivery-ref <reference> --by <who>
//
// The reference identifies the delivery operation or package. It does not claim that a social
// platform post happened. The command validates current approvals and every manifest hash,
// records the first-delivery boundary once, then performs the guarded HANDOFF_READY -> COMPLETE
// transition with an expected state and revision.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const { stateIn, revisionIn } = require('./lib-open-job.js');
const { validateHandoff, recordDelivery } = require('./lib-handoff-validation.js');
const availability = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const index = argv.indexOf('--' + name);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
const json = argv.includes('--json');
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
const deliveryRef = value('delivery-ref');
const by = value('by', 'producer');
const recordedAt = value('at');
const operationId = value('operation-id');
const usage = 'usage: complete-job.js <brand> <job-id> --delivery-ref <reference> [--by "Name"] [--at <ISO>] [--operation-id ID] [--json]';
if (!brand || !jobId || !dir || !deliveryRef) { console.error(usage); process.exit(2); }

const statusPath = path.join(dir, 'status.md');
if (!fs.existsSync(statusPath)) { console.error('No job at ' + ws.fwd(dir) + '.'); process.exit(3); }
try {
  const available = availability.checkJobDirectory(dir, { requireJob: true, requireRoute: true });
  availability.assertExecutionAvailable(available);
}
catch (error) { console.error(error.message); process.exit(1); }

function fail(message, code = 1, result = null) {
  if (json && result) console.log(JSON.stringify({ ...result, ok: false, error: message }, null, 2));
  else console.error(message);
  process.exit(code);
}

let status;
try { status = fs.readFileSync(statusPath, 'utf8'); } catch (e) { fail('Could not read the job state: ' + e.message); }
const current = stateIn(status);
const revision = revisionIn(status);
if (revision === null) fail('status.md has an invalid revision. Restore the last complete state record before completing the job.');

if (current === 'COMPLETE') {
  const result = validateHandoff(dir, { brand, jobId, deliveryRef, requireDelivery: true });
  if (!result.ok) fail('The job is already complete, but its delivery record is not valid: ' + result.errors.join('; '), 1, result);
  if (json) console.log(JSON.stringify({ ok: true, alreadyComplete: true, state: current, revision, ...result }, null, 2));
  else console.log('Production is already complete. The original delivery record was kept.');
  process.exit(0);
}
if (current !== 'HANDOFF_READY') {
  fail('Production can be completed only from the approved handoff package. The job is at "' + (states.label(current) || current || 'unknown') + '". Use the compatibility migration for an old metrics/report state.');
}

let verified = validateHandoff(dir, { brand, jobId, deliveryRef });
if (!verified.ok) fail('REFUSED: the handoff cannot be completed: ' + verified.errors.join('; '), 1, verified);

let delivery;
try {
  delivery = recordDelivery(dir, { brand, jobId, deliveryRef, recordedBy: by, recordedAt, operationId });
} catch (error) {
  fail('REFUSED: the delivery record was not saved: ' + error.message);
}

const note = 'Production package delivered; delivery reference recorded. External publication remains unreported.';
const args = [path.join(__dirname, 'set-state.js'), brand, jobId, 'COMPLETE', '--by', by,
  '--note', note, '--expect-state', 'HANDOFF_READY', '--expect-revision', String(revision),
  '--delivery-ref', deliveryRef, '--root', ws.root(argv)];
if (operationId) args.push('--operation-id', operationId);
const moved = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
if (moved.status !== 0) {
  fail('The delivery record is saved, but the guarded production completion did not happen. Reload the job and reconcile the state before retrying.\n' + String(moved.stderr || '').trim(), 1,
    { delivery, state: current, revision });
}

const result = { ok: true, state: 'COMPLETE', previousState: current, revision: revision + 1, delivery,
  manifestHash: verified.manifestHash, externalPublication: 'unreported' };
if (json) console.log(JSON.stringify(result, null, 2));
else { console.log('Production complete. See where each post stands on the board.'); process.stdout.write(moved.stdout || ''); }
