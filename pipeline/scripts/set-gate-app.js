#!/usr/bin/env node
// Connect this folder to the gate app, so the scripts can drive the pane on their own.
//   node set-gate-app.js <url> <key>
//
// Writes gate-app.json in the workspace root, the same root set-root.js chose. The key is a
// secret, so it is written and never printed back: a key echoed into the chat is a key in the
// transcript. The file is ignored by git for the same reason.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');

const [url, key] = ws.positionals(process.argv.slice(2));
if (!url || !key) {
  console.error('usage: set-gate-app.js <url> <key>');
  console.error('The key comes from the gate-app dashboard, on the clients page.');
  process.exit(2);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('The address must start with http:// or https://.');
  process.exit(2);
}

const file = gate.configPath();
try {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ url: url.replace(/\/+$/, ''), key }, null, 2) + '\n', { mode: 0o600 });
} catch (e) {
  console.error('Could not write ' + ws.fwd(file) + ': ' + e.message);
  process.exit(1);
}

console.log('saved');
