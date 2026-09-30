#!/usr/bin/env node
// Put the photo-of-the-product card on the page, and print the same ask in the chat.
//   node ask-product-photo.js <key> [--title "..."] [--name "the 230ml bottle"]
//
// It is `ask.js` with one fixed question, and one guard: a batch already waiting on this
// page is never replaced. Asking twice throws away an answer somebody is halfway through
// typing, and this card is the one people take longest over, because they have to go and
// find a photo first.
//
// Exit 0 whichever way it goes. A page that is not connected is not a failure, and neither
// is a question that was already asked.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');
const photo = require('./lib-photo-ask.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const key = pos[0];
const at = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

if (!key) {
  console.error('usage: ask-product-photo.js <key> [--title "..."] [--name "the product"]');
  process.exit(2);
}

// --root has to travel to ask.js, or it reads a different folder's settings.
const rootAt = argv.indexOf('--root');
const passRoot = rootAt >= 0 && argv[rootAt + 1] ? ['--root', argv[rootAt + 1]] : [];

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
  const open = await gate.call('answer?key=' + encodeURIComponent(key), null, { argv: process.argv });
  if (!open.offline && open.status === 'answered') {
    console.log('That was already answered while I was away. Read the answer rather than asking again.');
    return;
  }
  if (!open.offline && open.status === 'waiting') {
    console.log('The photo card is already on the page, waiting. Leave it there.');
    return;
  }

  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'ask.js'),
    key,
    JSON.stringify(photo.questions(at('--name'))),
    '--title', at('--title') || photo.TITLE,
    ...passRoot,
  ], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
})().catch(e => {
  // The page must never fail the run it is reporting on.
  console.log('The photo card could not be put on the page: ' + e.message);
});
