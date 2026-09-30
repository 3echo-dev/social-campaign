#!/usr/bin/env node
// Attach optional feedback to a delivered production job.
//
//   node close-job.js <brand> <job-id> --rating 1-5 [--comment "..."] [--by "Name"]
//        [--delivery-ref <reference>]
//
// Feedback is independent of production completion. A completed job stays complete and its
// first-delivery time never changes. Historical metric/report states may be reconciled here only
// when a validated handoff and delivery record already exist; missing evidence remains recovery.
//
// Exit 0 feedback saved - 1 state/evidence/write error - 2 usage - 3 no such job
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const durable = require('./lib-durable.js');
const states = require('./lib-states.js');
const { stateIn, revisionIn } = require('./lib-open-job.js');
const { validate } = require('./validate-schema.js');
const handoff = require('./lib-handoff-validation.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const json = argv.includes('--json');
const USAGE = 'usage: close-job.js <brand> <job-id> --rating 1-5 [--comment "..."] [--by "Name"] [--delivery-ref <reference>]';
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
const rawRating = flag('rating');
if (!brand || !jobId || !dir || rawRating === undefined) { console.error(USAGE); process.exit(2); }

const rating = Number(rawRating);
if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
  console.error('The rating has to be a whole number from 1 to 5. You gave "' + rawRating + '".');
  process.exit(2);
}
const comment = flag('comment', '');
const by = flag('by', 'the client');
const deliveryRefArg = flag('delivery-ref', '');
const statusPath = path.join(dir, 'status.md');
if (!fs.existsSync(statusPath)) {
  console.error('No job at ' + ws.fwd(dir) + '. Check the brand and job id.');
  process.exit(3);
}

function statusText() {
  try { return fs.readFileSync(statusPath, 'utf8'); } catch (e) { throw new Error('Could not read the job state: ' + e.message); }
}

let status;
try { status = statusText(); } catch (e) { console.error(e.message); process.exit(1); }
const current = stateIn(status);
const revision = revisionIn(status);
if (revision === null) { console.error('status.md has an invalid revision. Restore the last complete state record before attaching feedback.'); process.exit(1); }

const jobRecord = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch { return {}; } })();
const routeRecord = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8')); } catch { return {}; } })();
const reviewOnly = /^(?:performance[_-](?:review|report))$/i.test(String(jobRecord.kind || '').replace(/\s+/g, '_')) ||
  /^(?:performance[_-]review)$/i.test(String(routeRecord.workflowId || '').replace(/\s+/g, '_'));
if (reviewOnly && current !== 'COMPLETE') {
  console.error('This historical performance-review job is retained for history and cannot be closed as production.');
  console.error('Use the compatibility migration to record its system cancellation; no user rating was written.');
  process.exit(1);
}

let delivery = handoff.readDelivery(dir).record;
let completionNeeded = false;
if (current === 'COMPLETE') {
  // COMPLETE is already terminal. It may be an older completed record without the new delivery
  // sidecar, and feedback remains attachable to that history without rewriting its lifecycle.
} else if (current === 'HANDOFF_READY' || states.isRetired(current)) {
  const verified = handoff.validateHandoff(dir, { brand, jobId, requireDelivery: true,
    ...(deliveryRefArg ? { deliveryRef: deliveryRefArg } : {}) });
  if (!verified.ok) {
    console.error('This delivered job needs recovery before feedback can close it: ' + verified.errors.join('; '));
    console.error('No rating was written and the production state was not changed.');
    process.exit(1);
  }
  delivery = verified.delivery;
  completionNeeded = current !== 'COMPLETE';
} else {
  console.error('This job is not ready for optional feedback. It is at "' + (states.label(current) || current || 'unknown') + '".');
  console.error('Feedback can be attached after a validated package delivery.');
  process.exit(1);
}

const record = {
  schemaVersion: '1.0', jobId, brand, rating,
  ...(comment ? { comment } : {}), ratedBy: by,
  ratedAt: ws.now(brand, argv),
};
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'rating.schema.json'), 'utf8'));
const errs = validate(schema, record);
if (errs.length) {
  console.error('The rating record is not valid: ' + errs.map(e => e.path + ' ' + e.message).join('; '));
  process.exit(1);
}

const apDir = path.join(dir, 'approvals');
fs.mkdirSync(apDir, { recursive: true });
try {
  durable.update(path.join(apDir, 'rating.json'), () => JSON.stringify(record, null, 2) + '\n');
} catch (error) {
  console.error('Could not save the rating: ' + error.message);
  process.exit(1);
}

if (!completionNeeded) {
  const result = { ok: true, feedbackSaved: true, productionComplete: true, state: current, rating, ratedBy: by };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log('Feedback saved. Production remains complete; its delivery time was not changed.');
  process.exit(0);
}

// A handoff-ready job should normally be completed through complete-job.js. This compatibility
// path exists for old callers that already supplied a delivery record and rating. The expected
// state and revision keep a concurrent producer from being overwritten.
if (!delivery || !delivery.reference) {
  console.error('The rating is saved, but production could not close because no delivery reference is recorded.');
  process.exit(1);
}
const rootIndex = argv.indexOf('--root');
const args = [path.join(__dirname, 'set-state.js'), dir, 'COMPLETE', '--by', by,
  '--note', 'Production completion reconciled after validated delivery; feedback remains optional.',
  '--reason', 'compatibility_delivery_reconciled', '--compatibility', '--delivery-ref', delivery.reference,
  '--expect-state', current, '--expect-revision', String(revision)];
if (rootIndex >= 0 && argv[rootIndex + 1]) args.push('--root', argv[rootIndex + 1]);
const move = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
if (move.status !== 0) {
  console.error('The rating is saved, but production could not be reconciled:');
  console.error((move.stderr || '').trim());
  process.exit(1);
}
const result = { ok: true, feedbackSaved: true, productionComplete: true, state: 'COMPLETE', rating, ratedBy: by,
  previousState: current, deliveryReference: delivery.reference };
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log('Feedback saved. Production is complete; its delivery time was not changed.');
  process.stdout.write(move.stdout || '');
}
