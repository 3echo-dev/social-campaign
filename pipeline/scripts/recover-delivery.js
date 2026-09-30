#!/usr/bin/env node
// Recover a pre-update production job that has a valid handoff package but no delivery sidecar.
// The operator must supply the real delivery reference. This command never invents a verdict or
// treats a folder name as proof of delivery.
//
//   node recover-delivery.js <brand> <job-id> --delivery-ref <actual-reference> --by <who>
//        [--at <first-delivery-time>] [--operation-id <id>] [--json]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const { stateIn, revisionIn } = require('./lib-open-job.js');
const handoff = require('./lib-handoff-validation.js');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const json = argv.includes('--json');
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
const deliveryRef = value('delivery-ref');
const by = value('by', 'compatibility recovery');
const at = value('at');
const operationId = value('operation-id');
const usage = 'usage: recover-delivery.js <brand> <job-id> --delivery-ref <actual-reference> --by <who> [--at <ISO>] [--operation-id <id>] [--json]';
if (!brand || !jobId || !dir || !deliveryRef) { console.error(usage); process.exit(2); }

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const job = readJson(path.join(dir, 'job.json'));
const route = readJson(path.join(dir, 'route.json'));
const kind = String(job.kind || '').toLowerCase().replace(/-/g, '_');
const workflow = String(route.workflowId || '').toLowerCase().replace(/-/g, '_');
if (['performance_review', 'performance_report'].includes(kind) || workflow === 'performance_review') {
  console.error('Performance-review history cannot be recovered as delivered production. Preserve it or cancel it through the compatibility migration.');
  process.exit(1);
}

const statusPath = path.join(dir, 'status.md');
if (!fs.existsSync(statusPath)) { console.error('No job at ' + ws.fwd(dir) + '.'); process.exit(3); }
let status;
try { status = fs.readFileSync(statusPath, 'utf8'); } catch (error) { console.error(error.message); process.exit(1); }
const current = stateIn(status);
const revision = revisionIn(status);
if (!states.isRetired(current) && current !== 'HANDOFF_READY') {
  console.error('Delivery recovery is limited to HANDOFF_READY or a retired historical production state. The job is at ' + (current || 'unknown') + '.');
  process.exit(1);
}
if (revision === null) { console.error('status.md has an invalid revision.'); process.exit(1); }

let delivery;
try {
  delivery = handoff.recordDelivery(dir, {
    brand, jobId, deliveryRef, recordedBy: by, recordedAt: at, operationId, compatibilityRecovery: true,
  });
} catch (error) {
  console.error('Recovery refused: ' + error.message);
  process.exit(1);
}

if (current === 'COMPLETE') {
  const result = { ok: true, alreadyComplete: true, state: current, revision, delivery };
  if (json) console.log(JSON.stringify(result, null, 2)); else console.log('The delivery record was already present; production remains complete.');
  process.exit(0);
}

const args = [path.join(__dirname, 'set-state.js'), dir, 'COMPLETE', '--by', by, '--compatibility',
  '--reason', 'legacy_delivery_reconciled', '--delivery-ref', delivery.reference,
  '--expect-state', current, '--expect-revision', String(revision), '--root', ws.root(argv),
  '--note', 'Production completion reconciled after the operator supplied the original delivery reference. External publication remains unreported.'];
const moved = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
if (moved.status !== 0) {
  console.error('The delivery record was saved, but state reconciliation failed. Reload the job before retrying.');
  console.error(String(moved.stderr || moved.stdout || '').trim());
  process.exit(1);
}
const result = { ok: true, state: 'COMPLETE', previousState: current, revision: revision + 1, delivery,
  externalPublication: 'unreported' };
if (json) console.log(JSON.stringify(result, null, 2));
else { console.log('Production complete. The supplied delivery reference was recorded.'); process.stdout.write(moved.stdout || ''); }
