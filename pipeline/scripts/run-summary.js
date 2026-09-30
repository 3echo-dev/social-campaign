#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const usage = require('./lib-usage.js');
const { timing } = require('./lib-timing.js');
const memory = require('./lib-memory.js');
const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!dir) { console.error('usage: run-summary.js <brand> <job-id> [--json]'); process.exit(2); }
const asOfIndex = argv.indexOf('--as-of');
const asOf = asOfIndex >= 0 ? argv[asOfIndex + 1] : undefined;
try {
  const status = fs.readFileSync(path.join(dir, 'status.md'), 'utf8');
  const clock = asOf ? new Date(asOf) : undefined;
  if (clock && Number.isNaN(clock.getTime())) throw new Error('--as-of must be an ISO date.');
  const result = { brand, jobId, reportDate: asOf || new Date().toISOString(),
    timing: timing(status, clock || Date.now()), usage: usage.summarize(dir, ws.root(argv), { asOf }), memory: memory.read(dir) };
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    const minutes = n => (n / 60000).toFixed(1) + ' min';
    console.log(brand + ', ' + jobId);
    console.log('Processing windows: ' + minutes(result.timing.processingWindowMs) + '; waiting for decisions: ' + minutes(result.timing.approvalWaitMs) + '; blocked: ' + minutes(result.timing.blockedMs) + '.');
    console.log(result.timing.note);
    console.log('Token observations: ' + result.usage.observations + ' (' + result.usage.coverage + '). API cost: ' + (result.usage.costUsd === null ? 'unknown or incomplete' : '$' + result.usage.costUsd.toFixed(4)) + '.');
    console.log('Working notes: ' + (!result.memory ? 'not saved' : result.memory.current ? 'sources unchanged' : 'sources changed; reread them') + '.');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
