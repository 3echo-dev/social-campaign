#!/usr/bin/env node
// Validate the current production package without changing the job.
//   node validate-handoff.js <brand> <job-id> [--require-delivery] [--json]
const ws = require('./lib-workspace.js');
const { validateHandoff } = require('./lib-handoff-validation.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const requireDelivery = argv.includes('--require-delivery');
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId || !dir) {
  console.error('usage: validate-handoff.js <brand> <job-id> [--require-delivery] [--json]');
  process.exit(2);
}

const result = validateHandoff(dir, { brand, jobId, requireDelivery });
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.ok) console.log('ok: the handoff package, required approvals and delivery record are valid.');
else {
  console.error('REFUSED: the handoff is not ready for production completion.');
  for (const error of result.errors) console.error('- ' + error);
}
process.exit(result.ok ? 0 : 1);
