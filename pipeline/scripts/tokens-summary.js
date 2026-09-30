#!/usr/bin/env node
// Report observed usage. A missing model or cache rate is unknown, never a free operation.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const usage = require('./lib-usage.js');
const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId) { console.error('usage: tokens-summary.js <brand> <job-id> [--root <dir>] [--json]'); process.exit(2); }
if (!dir || !fs.existsSync(path.join(dir, 'status.md'))) { console.error('No such job.'); process.exit(3); }
const result = { job: jobId, brand, ...usage.summarize(dir, ws.root(argv)) };
if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
if (!result.observations) {
  console.log('No tokens were reported for ' + jobId + '.');
  console.log('The token hook only fires in Claude Code where supported; absent usage is unknown.');
  process.exit(0);
}
const n = value => Number(value).toLocaleString('en-US');
console.log(jobId + ': ' + n(result.total.inputTokens + result.total.outputTokens + result.total.cacheCreationTokens + result.total.cacheReadTokens) + ' observed tokens, including cache usage.');
console.log('By stage:');
for (const r of result.stages) console.log('  ' + r.stage + ': ' + n(r.inputTokens) + ' in, ' + n(r.outputTokens) + ' out, ' + n(r.cacheCreationTokens) + ' cache writes, ' + n(r.cacheReadTokens) + ' cache reads');
console.log('By model:');
for (const r of result.models) console.log('  ' + r.model + ': ' + (r.costUsd === null ? 'incomplete pricing; missing ' + r.missingRates.join(', ') : '$' + r.costUsd.toFixed(4)));
console.log(result.costUsd === null ? 'Total cost is unknown. Priced portion: $' + result.knownCostUsd.toFixed(4) + '.' : 'Estimated API cost: $' + result.costUsd.toFixed(4) + ' in total.');
if (result.priceAsOf) console.log('Rates as of ' + result.priceAsOf + ', from ' + result.priceSource + '.');
console.log(result.note);
