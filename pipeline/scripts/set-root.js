#!/usr/bin/env node
// Choose where jobs and brands are saved.
//   node set-root.js <folder>     write the setting
//   node set-root.js              show what is in use now
//   node set-root.js <folder> --no-guards   skip the settings.json line
//
// Writes .social-pipeline/config.json in the current folder. Scripts read it from the nearest
// ancestor of wherever they run, so this only has to be done once per project.
//
// It also turns the guards on, because the spend and write refusals live behind
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS and that is a line of JSON nobody setting up their first
// brand should have to hand-edit. Picking the folder is the one moment we know which folder is
// the project, so it is the right moment to write it.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');

const argv = process.argv.slice(2);
const target = ws.positionals(argv)[0];

const guards = require('./lib-guards.js');

if (!target) {
  const { path: p, source } = ws.rootWithSource();
  const brands = ws.listBrands();
  console.log('Jobs and brands are saved in ' + ws.fwd(ws.brandsDir()) + '.');
  console.log('That comes from: ' + source + '.');
  console.log(brands.length ? 'Brands here: ' + brands.join(', ') : 'No brands here yet.');
  const here = guards.peek(process.cwd());
  console.log(here
    ? 'The guards are on, so a spend without an approval on disk is refused.'
    : 'The guards are off, so a spend or a stray write is a rule rather than a refusal.');
  console.log('');
  console.log('To change it: set-root.js <folder>');
  process.exit(0);
}

const abs = path.resolve(target);
if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) {
  console.error(ws.fwd(abs) + ' is a file, not a folder.');
  process.exit(2);
}
try {
  fs.mkdirSync(path.join(abs, 'workspaces'), { recursive: true });
  fs.mkdirSync(path.join(abs, 'inputs'), { recursive: true });
} catch (e) {
  console.error('Could not create ' + ws.fwd(abs) + ': ' + e.message);
  process.exit(1);
}

const dir = path.join(process.cwd(), ws.CONFIG_DIR);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, ws.CONFIG_FILE);
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first time */ }
// Store it relative when it sits under the current folder, so a moved project still works.
const rel = path.relative(process.cwd(), abs);
cfg.root = (!rel.startsWith('..') && !path.isAbsolute(rel)) ? (rel || '.') : abs;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');

console.log('Jobs and brands will be saved in ' + ws.fwd(abs) + '.');
if (process.env.SOCIAL_PIPELINE_ROOT) {
  console.log('Note: SOCIAL_PIPELINE_ROOT is set in this shell and wins over this setting until you unset it.');
}

if (argv.includes('--no-guards')) {
  console.log('The guards were left alone, as asked. Without them a spend or a stray write is refused by nobody.');
} else {
  console.log(guards.sentence(guards.arm(process.cwd()), ws.fwd));
}
