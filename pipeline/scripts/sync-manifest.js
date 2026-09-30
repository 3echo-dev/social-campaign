#!/usr/bin/env node
// What has changed since the last mirror to the user's own folder.
//
//   node sync-manifest.js <brand> [job-id] [--json] [--mark] [--all]
//
// In a cloud session the scripts run inside a container that is thrown away at the end. The
// container is also the only place `node` can see, so a root setting alone does not save the
// work: the files have to be copied out with the device tools. This script does not copy
// anything. It says which files are new or changed, so the skill can copy exactly those and
// nothing else.
//
// --mark records the current state as synced, after the copy has actually happened.
//
// Exit 0 nothing to copy · 1 files listed · 2 usage · 3 brand or job not found
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const mark = argv.includes('--mark');
const all = argv.includes('--all');
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);

if (!brand) {
  console.error('usage: sync-manifest.js <brand> [job-id] [--json] [--mark] [--all]');
  process.exit(2);
}
const brandDir = ws.wsDir(brand);
if (!fs.existsSync(brandDir)) {
  console.error('No brand called "' + brand + '" in ' + ws.fwd(ws.brandsDir()) + '.');
  process.exit(3);
}
const scanRoot = jobId ? dir : brandDir;
if (!fs.existsSync(scanRoot)) {
  console.error('No job called "' + jobId + '" for ' + brand + '.');
  process.exit(3);
}

// Media is large and immutable once downloaded, so it is listed but flagged, letting the
// skill copy text first and binaries in a later batch if it needs to.
const BINARY = /\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|pdf|zip|tgz)$/i;
const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const statePath = path.join(brandDir, ws.CONFIG_DIR, 'last-sync.json');
let last = { files: {} };
try { last = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* first sync */ }

const files = walk(scanRoot);
const changed = [];
const seen = {};
for (const f of files) {
  const rel = path.relative(ws.brandsDir(), f).split(path.sep).join('/');
  const buf = fs.readFileSync(f);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  seen[rel] = sha;
  if (all || last.files[rel] !== sha) {
    changed.push({ path: rel, bytes: buf.length, binary: BINARY.test(f), sha256: sha });
  }
}

if (mark) {
  // Only record what was actually scanned this run, so a job-scoped sync does not claim the
  // whole brand is up to date.
  const merged = Object.assign({}, last.files, seen);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ at: new Date().toISOString(), files: merged }, null, 2) + '\n');
  console.log('Marked ' + Object.keys(seen).length + ' file(s) as saved.');
  process.exit(0);
}

const totalBytes = changed.reduce((n, c) => n + c.bytes, 0);
if (json) {
  console.log(JSON.stringify({
    brand, job: jobId || null,
    from: ws.fwd(ws.brandsDir()),
    to: 'social-pipeline/workspaces',
    count: changed.length, bytes: totalBytes, files: changed,
  }, null, 2));
  process.exit(changed.length ? 1 : 0);
}

if (!changed.length) { console.log('Nothing new to save.'); process.exit(0); }
console.log(changed.length + ' file(s) to copy into the connected folder, under social-pipeline/workspaces/:');
for (const c of changed) console.log('  ' + c.path + (c.binary ? '  (binary, ' + Math.round(c.bytes / 1024) + 'KB)' : ''));
console.log('');
console.log('Copy them, then run this again with --mark.');
process.exit(1);
