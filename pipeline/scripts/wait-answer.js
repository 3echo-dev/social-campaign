#!/usr/bin/env node
// Read the answer to the open question batch on one page once.
//   node wait-answer.js <key> [legacy-seconds=0]
//
// The optional seconds argument is accepted for compatibility with older workflow rows, but it
// is deliberately ignored. A human wait is not a model-turn operation: one invocation makes one
// bounded read and returns. Resume through a host notification or a later manual turn.
// It always exits 0: no answer yet is an outcome, not a failure.
const ws = require('./lib-workspace.js');
const fs = require('fs');
const path = require('path');
const gate = require('./lib-gate.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const key = pos[0];
const seconds = pos[1] === undefined ? 0 : Number(pos[1]);

if (!key || !Number.isFinite(seconds) || seconds < 0 || seconds > 1800) {
  console.error('usage: wait-answer.js <key> [seconds, 0 to 1800]');
  process.exit(2);
}

for (const brand of ws.listBrands(argv)) {
  const dir = ws.jobDir(brand, key, argv);
  if (!fs.existsSync(path.join(dir, 'job.json'))) continue;
  const availability = execution.checkJobDirectory(dir, { requireJob: true });
  if (!availability.available) {
    console.log(JSON.stringify({ status: 'unsupported', reason: availability.message }, null, 2));
    process.exit(4);
  }
  break;
}

const route = 'answer?key=' + encodeURIComponent(key);
(async () => {
  void seconds;
  const res = await gate.call(route, null, { argv, timeoutMs: 3000 });
  if (res.offline) {
    console.log(JSON.stringify({ status: 'offline', reason: res.reason }, null, 2));
    return;
  }
  console.log(JSON.stringify({ status: res.status || 'none', answers: res.answers || null }, null, 2));
})();
