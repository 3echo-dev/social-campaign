#!/usr/bin/env node
// SessionStart hook. Anything written to stdout becomes context Claude can act on.
// Three jobs: say where the work is being saved, report missing dependencies, and orient a
// first-time user.
//
// It used to probe `python` only, so a mac or linux box with python3 reported a required
// dependency missing. It also spawned five subprocesses on every startup, resume and clear;
// results are now cached for a day.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const guards = require('./lib-guards.js');

const win = process.platform === 'win32';
const ok = c => { try { execSync(c, { stdio: 'ignore' }); return true; } catch { return false; } };
const where = exe => ok((win ? 'where ' : 'which ') + exe);

// Whichever python is present becomes the one the docs quote.
const PY = ok('python3 --version') ? 'python3' : (ok('python --version') ? 'python' : null);
const install = (winCmd, macCmd, linuxCmd) =>
  win ? winCmd : (process.platform === 'darwin' ? macCmd : linuxCmd);

const checks = [
  ['python', () => PY !== null,
    install('winget install Python.Python.3.12', 'brew install python', 'sudo apt install python3'),
    'every media script', true],
  ['Pillow', () => PY !== null && ok(PY + ' -c "import PIL"'),
    (PY || 'python3') + ' -m pip install Pillow',
    'checking downloaded media and building contact sheets', true],
  ['ffmpeg', () => where('ffmpeg'),
    install('winget install Gyan.FFmpeg', 'brew install ffmpeg', 'sudo apt install ffmpeg'),
    'stitching clips and sampling frames (without it the hand-off ships separate clips)', false],
  ['ffprobe', () => where('ffprobe'),
    install('winget install Gyan.FFmpeg', 'brew install ffmpeg', 'sudo apt install ffmpeg'),
    'reading video length and size for the quality check', false],
  ['yt-dlp', () => where('yt-dlp'),
    (PY || 'python3') + ' -m pip install yt-dlp',
    'pulling captions off a source video (a transcript you supply works instead)', false],
];

// One probe a day is enough; the answer rarely changes mid-session.
const CACHE_HOURS = 24;
const cachePath = path.join(process.cwd(), ws.CONFIG_DIR, 'deps.json');
function probeAll() {
  let cached = null;
  try {
    const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Date.now() - c.at < CACHE_HOURS * 3600e3 && c.platform === process.platform) cached = c;
  } catch { /* no cache yet */ }
  if (cached) return checks.filter(c => !cached.present.includes(c[0]));

  const present = checks.filter(c => c[1]()).map(c => c[0]);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ at: Date.now(), platform: process.platform, present }));
  } catch { /* a read-only cwd must not break the hook */ }
  return checks.filter(c => !present.includes(c[0]));
}

const missing = probeAll();

// Where the work is going. In a cloud container the current folder is discarded at session
// end, so saying this out loud is what stops a job being lost.
const { path: rootPath, source } = ws.rootWithSource();
const brands = ws.listBrands();
const rootLine = brands.length
  ? 'Jobs and brands are saved in ' + ws.fwd(ws.brandsDir()) + ' (' + source + ').'
  : 'No workspace folder is set yet. Work would be saved in ' + ws.fwd(ws.brandsDir()) +
    ', from the ' + source + '. To put it somewhere that lasts: node "${CLAUDE_PLUGIN_ROOT}/scripts/set-root.js" <folder>';

const learned = (() => {
  try {
    return fs.readFileSync(path.join(process.cwd(), ws.CONFIG_DIR, 'tool-failures.md'), 'utf8')
      .split('\n').filter(l => l.startsWith('- ('));
  } catch { return []; }
})();

const GETTING_STARTED = [
  'No brand has been set up here yet. If the user asks how to begin, or seems unsure what to do',
  'first, tell them:',
  '',
  '  1. /social-pipeline:onboard-brand {brand}   drafts the brand files from a website or docs, then asks what is wrong',
  '  2. /social-pipeline:new-job {brand}         asks a few things, then works up to the first decision and stops',
  '  3. /social-pipeline:review {job} approve    or "change ..." or "start over", at any decision point',
  '',
  'Nothing costs credits until a concept is approved and a quote is shown. Nothing is posted',
  'until the person approves where and when it goes out. Do not announce this unprompted if they',
  'have already asked for something else.',
].join('\n');

const LEARNED = learned.length
  ? '\nProblems already hit in this folder. Do not rediscover them:\n' + learned.map(l => '  ' + l).join('\n') + '\n'
  : '';

let out = 'Social Pipeline. ' + rootLine + '\n';
if (missing.length) {
  out += '\n' + missing.length + ' thing(s) not installed:\n\n';
  for (const [name, , cmd, why, req] of missing) {
    out += '- ' + name + (req ? ' (required)' : ' (optional)') + ' - needed for ' + why + '\n    ' + cmd + '\n';
  }
  out += '\n' + (missing.some(m => m[4])
    ? 'Media steps will fail until the required ones are installed. Tell the user, with the commands above.\n'
    : 'Everything runs. Say which step is degraded rather than claiming it ran.\n');
}
// The guards in hooks/hooks.mjs can refuse a wrong step outright, but only when function hooks
// are switched on. With the flag off they are back to being rules the model is asked to follow,
// which is the arrangement that put most of the rows in docs/RUN-DEFECTS.md there. Say so once,
// with the exact thing to paste, rather than letting a session assume it is protected.
// In a folder that is already the pipeline's, arming them is not a decision anybody needs to be
// asked about, so do it and say so. Settings are read at startup, so this session stays unguarded
// however early we write; the next one is protected. A folder that is not the pipeline's is never
// touched, because a session hook that edits settings wherever it happens to land is a menace.
if (!process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS) {
  const ours = brands.length > 0 || fs.existsSync(path.join(process.cwd(), ws.CONFIG_DIR, ws.CONFIG_FILE));
  const done = ours && !guards.peek(process.cwd()) ? guards.arm(process.cwd()) : null;
  if (done && (done.state === 'created' || done.state === 'updated')) {
    out += '\nThe spend and write guards were off, so they have been turned on for this folder. They take effect in the next session, not this one; until then a spend is a rule rather than a refusal.\n';
  } else {
    out += '\nFunction hooks are off, so the spend and write guards are rules rather than refusals. To turn them on, put "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } in .claude/settings.json and start a new session.\n';
  }
}

out += LEARNED;
if (!brands.length) out += '\n' + GETTING_STARTED + '\n';
process.stdout.write(out);
