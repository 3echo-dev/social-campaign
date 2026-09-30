#!/usr/bin/env node
// Hand the next batch of events to whoever can reach the network. Scripts cannot make an
// HTTP call from Cowork, so this one only prints; the producer pastes the array into
// events_put and then acknowledges what went through.
//
//   node push-events.js <brand> <job-id> [--since <eventId>]   print the next batch
//   node push-events.js <brand> <job-id> --ack <eventId>       record what the server took
//
// The batch is one JSON array on stdout, at most 200 events, which is the server's limit.
// stderr says how many are left after it. --ack writes events.pushed in the job folder, so
// the next call starts after that id.
//
// events_put is idempotent on eventId per client, so pushing the same batch twice is
// harmless: the second call reports them as duplicates and stores nothing new. When in
// doubt, push again rather than guessing what landed.
//
// Exit 0 printed or acknowledged - 2 usage - 3 no events.jsonl, run export-events.js first
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');

const MAX_BATCH = 200;
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId) {
  console.error('usage: push-events.js <brand> <job-id> [--since <eventId>] [--ack <eventId>]');
  process.exit(2);
}

const cursorPath = path.join(dir, 'events.pushed');
const ack = flag('ack');
if (ack !== undefined) {
  if (!/^[a-f0-9]{64}$/.test(String(ack))) { console.error('--ack takes an eventId, which is 64 hex characters.'); process.exit(2); }
  fs.writeFileSync(cursorPath, ack + '\n');
  console.log('Noted. The next push starts after that event.');
  process.exit(0);
}

const file = path.join(dir, 'events.jsonl');
if (!fs.existsSync(file)) {
  console.error('There is no events.jsonl for this job. Run export-events.js first.');
  process.exit(3);
}
const all = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

let since = flag('since');
if (since === undefined && fs.existsSync(cursorPath)) since = fs.readFileSync(cursorPath, 'utf8').trim();
// An unknown cursor means the file was rewritten under it; sending everything again is safe.
const at = since ? all.findIndex(e => e.eventId === since) : -1;
const pending = all.slice(at + 1);
const batch = pending.slice(0, MAX_BATCH);
const left = pending.length - batch.length;

console.log(JSON.stringify(batch));
console.error(batch.length + ' events in this batch, ' + left + ' left after it.');
