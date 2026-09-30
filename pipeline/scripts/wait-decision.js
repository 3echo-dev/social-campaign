#!/usr/bin/env node
// Read the verdict at one open gate once.
//   node wait-decision.js <key> <gate> [legacy-seconds=0]
//
// The optional seconds argument is accepted for compatibility with older workflow rows, but it
// is deliberately ignored. A human wait is not a model-turn operation: one invocation makes one
// bounded read and returns. Resume through a host notification or a later manual turn.
// It always exits 0: no decision yet is an outcome, not a failure.
const ws = require('./lib-workspace.js');
const fs = require('fs');
const path = require('path');
const gate = require('./lib-gate.js');
const execution = require('./lib-execution-availability.js');
const states = require('./lib-states.js');
const { NO_BRAND } = require('./lib-no-brand.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const key = pos[0];
const gateName = pos[1];
const seconds = pos[2] === undefined ? 0 : Number(pos[2]);

if (!key || !gateName || !Number.isFinite(seconds) || seconds < 0 || seconds > 1800) {
  console.error('usage: wait-decision.js <key> <gate> [seconds, 0 to 1800]');
  process.exit(2);
}

// The report gate belonged only to the retired performance-review workflow. Refuse before the
// gate app is contacted so a stale decision cannot be consumed by a later resume.
if (!states.GATE_IDS.includes(gateName)) {
  console.log(JSON.stringify({
    status: 'unsupported',
    reason: execution.PERFORMANCE_UNSUPPORTED,
  }, null, 2));
  process.exit(4);
}

for (const brand of [...new Set([...ws.listBrands(argv), NO_BRAND])]) {
  const dir = ws.jobDir(brand, key, argv);
  if (!fs.existsSync(path.join(dir, 'job.json'))) continue;
  const availability = execution.checkJobDirectory(dir, { requireJob: true });
  if (!availability.available) {
    console.log(JSON.stringify({ status: 'unsupported', reason: availability.message }, null, 2));
    process.exit(4);
  }
  break;
}

const route = 'decision?key=' + encodeURIComponent(key) + '&gate=' + encodeURIComponent(gateName);
(async () => {
  void seconds;
  const res = await gate.call(route, null, { argv, timeoutMs: 3000 });
  if (res.offline) {
    console.log(JSON.stringify({ status: 'offline', reason: res.reason }, null, 2));
    return;
  }
  console.log(JSON.stringify(res, null, 2));
})();
