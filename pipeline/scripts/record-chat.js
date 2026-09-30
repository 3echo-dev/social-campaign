#!/usr/bin/env node
// Record in the pane an answer the person typed in the chat.
//   node record-chat.js <key> answers.json
//   node record-chat.js <key> "{\"brand\":\"sk-ii\"}"
//
// The chat and the pane are one place, so a question answered in one has to close in the
// other. Without this the form sits there still asking for something the person has already
// said, and a later resume could otherwise reopen the same batch. Silent when the pane is not connected.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const key = pos[0];
const source = pos.slice(1).join(' ');
if (!key || !source) {
  console.error('usage: record-chat.js <key> <answers JSON or path>');
  process.exit(2);
}

let answers;
try {
  const raw = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : source;
  answers = JSON.parse(raw);
} catch (e) {
  console.error('The answers are not readable JSON: ' + e.message);
  process.exit(2);
}
if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
  console.error('Give a map of question id to answer.');
  process.exit(2);
}

for (const brand of ws.listBrands(argv)) {
  const dir = ws.jobDir(brand, key, argv);
  if (!fs.existsSync(path.join(dir, 'job.json'))) continue;
  const availability = execution.checkJobDirectory(dir, { requireJob: true });
  if (!availability.available) {
    console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
  break;
}

(async () => {
  const res = await gate.call('answer', { key, answers }, { argv });
  if (res.offline) return;
  console.log('recorded');
})();
