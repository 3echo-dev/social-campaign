#!/usr/bin/env node
// Scaffold one brand workspace in a single call.
//   node scaffold-brand.js <brand-slug> [display name]
// Reads templates from the plugin, writes into the current working directory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');
const guards = require('./lib-guards.js');

const slug = (process.argv[2] || '').trim();
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('usage: scaffold-brand.js <brand-slug> [display name]   (slug: lowercase, hyphens)');
  process.exit(2);
}
const name = (ws.positionals(process.argv.slice(3)).join(' ') || slug).trim();
const dest = ws.wsDir(slug);
if (fs.existsSync(dest)) {
  console.error('REFUSED: ' + ws.fwd(dest) + ' already exists. Run onboard-brand in update mode instead of overwriting.');
  process.exit(1);
}
const T = path.join(__dirname, '..', 'templates');
// The changelog date is the brand's own day, not the process's.
const today = ws.now(slug, process.argv).slice(0, 10);

for (const d of [ws.inputsDir(slug), dest, path.join(dest, 'brand'), path.join(dest, 'jobs')]) {
  fs.mkdirSync(d, { recursive: true });
}
const fill = s => s.split('{brand}').join(slug).split('{Brand Name}').join(name).split('YYYY-MM-DD').join(today);

const workspace = JSON.parse(fill(fs.readFileSync(path.join(T, 'workspace.json'), 'utf8')));
workspace.workspaceId = workspace.workspaceId || 'workspace-' + crypto.randomUUID();
fs.writeFileSync(path.join(dest, 'workspace.json'), JSON.stringify(workspace, null, 2) + '\n');
for (const f of ['brand-voice', 'audience', 'positioning', 'platform-playbook']) {
  const src = path.join(T, 'brand', f + '.md');
  if (fs.existsSync(src)) fs.writeFileSync(path.join(dest, 'brand', f + '.md'), fill(fs.readFileSync(src, 'utf8')));
}
const fwd = s => s.split(path.sep).join('/');
console.log('ready: ' + ws.fwd(dest) + '/  (workspace.json, brand/*.md from templates, jobs/)');
console.log('inputs: ' + ws.fwd(ws.inputsDir(slug)) + '/  drop source docs, URLs, exports here');

// A first brand is the moment this folder is unambiguously the pipeline's, so it is the moment to
// arm the guards. Somebody who never runs set-root.js still gets the refusals, one session later.
console.log(guards.sentence(guards.arm(process.cwd()), ws.fwd));
