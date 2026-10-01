// Where the work lives. One resolver, used by every script.
//
// Before this existed, eleven scripts joined the literal string 'workspaces' against
// process.cwd(). In a cloud container the cwd is discarded at session end, so a job created
// without remembering to cd first was lost. There was no setting to change that.
//
// Resolution order, first hit wins:
//   1. --root <dir> on the command line
//   2. SOCIAL_PIPELINE_ROOT in the environment
//   3. "root" in .social-pipeline/config.json, from the nearest ancestor of cwd
//   4. the current directory
//
// A root holds workspaces/ and inputs/ side by side. Pointing a root straight at a
// workspaces/ directory also works, because people will do that.
const fs = require('fs');
const path = require('path');

const profiles = require('./lib-brand-profile.js');
const noBrand = require('./lib-no-brand.js');

const CONFIG_DIR = '.social-pipeline';
const CONFIG_FILE = 'config.json';

function readConfigFrom(dir) {
  try {
    const p = path.join(dir, CONFIG_DIR, CONFIG_FILE);
    if (fs.existsSync(p)) return { config: JSON.parse(fs.readFileSync(p, 'utf8')), at: p };
  } catch { /* a malformed config must not stop a run */ }
  return null;
}

// Walk up from cwd so a script run inside a job folder still finds the project's setting.
function findConfig(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const hit = readConfigFrom(dir);
    if (hit) return hit;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Returns { path, source } so callers can tell the user where the work is going.
function rootWithSource(argv = process.argv) {
  const i = argv.indexOf('--root');
  if (i >= 0 && argv[i + 1]) return { path: path.resolve(argv[i + 1]), source: '--root' };
  if (process.env.SOCIAL_PIPELINE_ROOT) {
    return { path: path.resolve(process.env.SOCIAL_PIPELINE_ROOT), source: 'SOCIAL_PIPELINE_ROOT' };
  }
  const found = findConfig();
  if (found && found.config && found.config.root) {
    return { path: path.resolve(path.dirname(path.dirname(found.at)), found.config.root), source: found.at };
  }
  return { path: process.cwd(), source: 'current folder' };
}

const root = (argv) => rootWithSource(argv).path;

// A root may hold workspaces/, or be the workspaces directory itself.
function brandsDir(argv) {
  const r = root(argv);
  const nested = path.join(r, 'workspaces');
  if (fs.existsSync(nested)) return nested;
  if (path.basename(r) === 'workspaces') return r;
  return nested;
}

const wsDir = (brand, argv) => path.join(brandsDir(argv), brand);
const jobsDir = (brand, argv) => path.join(wsDir(brand, argv), 'jobs');
const jobDir = (brand, jobId, argv) => path.join(jobsDir(brand, argv), jobId);

function inputsDir(brand, argv) {
  const b = brandsDir(argv);
  const dataRoot = path.basename(b) === 'workspaces' ? path.dirname(b) : b;
  return brand ? path.join(dataRoot, 'inputs', brand) : path.join(dataRoot, 'inputs');
}

function listBrands(argv) {
  const b = brandsDir(argv);
  try {
    return fs.readdirSync(b)
      .filter(n => !n.startsWith('.') && fs.existsSync(path.join(b, n, 'workspace.json')))
      .sort();
  } catch { return []; }
}

function listJobs(brand, argv) {
  try { return fs.readdirSync(jobsDir(brand, argv)).filter(j => j.startsWith('job-')).sort(); }
  catch { return []; }
}

// Flags that take a value. Filtering only on the leading `--` leaves the value behind as a
// positional, which is how `scaffold-brand.js acme --root C:/tmp/x` came to write the flag
// and its path into the brand's display name, producing a workspace.json that would not parse.
const VALUE_FLAGS = ['--root', '--out', '--job', '--by', '--comment', '--note', '--credits',
  '--max-credits', '--captions', '--state', '--since', '--until', '--rating', '--ack',
  // Every one of these carries a value. A flag missing from this list makes its value look
  // like a positional, which is how a title once turned into part of a file path.
  '--title', '--score', '--why', '--chosen', '--gate-app-decision-id', '--channel',
  '--brand', '--timeout',
  // The price question and a change of deliverable: the quotes read in, the ceiling to fit,
  // where the working is written, and the person's own words for why the plan changed.
  '--quotes', '--ceiling', '--breakdown', '--answer',
  // The photo of the product a person sent from the page: where to fetch it, what to
  // call it once it has landed, and where it came from, which decides who owns it.
  '--url', '--name', '--source', '--session', '--expect-state', '--expect-revision', '--revision',
  '--reason', '--operation-id', '--decision-id', '--notes-file', '--next', '--blocked',
  '--memory-file', '--file', '--inputs', '--changed', '--scope', '--as-of', '--price-as-of'];

function positionals(args) {
  const out = [];
  for (let i = 0; i < (args || []).length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--')) { if (VALUE_FLAGS.includes(a)) i++; continue; }
    out.push(a);
  }
  return out;
}

// Scripts used to take either "<brand> <job-id>" or a path, inconsistently. Accept both
// everywhere: a path to job.json, route.json, or the job folder resolves to the same pair.
function resolveJobArgs(args, argv) {
  const positional = positionals(args);
  const first = positional[0];
  if (first && (/[\\/]/.test(first) || /\.json$/i.test(first))) {
    let p = path.resolve(first);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) p = path.dirname(p);
    const jobId = path.basename(p);
    const brand = path.basename(path.dirname(path.dirname(p)));
    return { brand, jobId, dir: p, rest: positional.slice(1) };
  }
  const [brand, jobId, ...rest] = positional;
  return { brand, jobId, dir: brand && jobId ? jobDir(brand, jobId, argv) : null, rest };
}

function workspaceConfig(brand, argv) {
  try { return JSON.parse(fs.readFileSync(path.join(wsDir(brand, argv), 'workspace.json'), 'utf8')); }
  catch { return {}; }
}

// Storage is deliberately checked as a capability, not inferred from a path or a token.
// A Drive desktop folder can prove local filesystem access only; remote synchronization remains
// unconfirmed until the Drive client or connector reports it.
const STORAGE_STATUSES = Object.freeze([
  'not_configured', 'authorization_required', 'checking', 'ready', 'expired', 'denied', 'unavailable',
]);

function capabilityResult(mode, target, status, capabilities, reason, extra = {}) {
  return {
    mode,
    target: target ? path.resolve(target) : null,
    status: STORAGE_STATUSES.includes(status) ? status : 'unavailable',
    capabilities: {
      list: Boolean(capabilities && capabilities.list),
      read: Boolean(capabilities && capabilities.read),
      write: Boolean(capabilities && capabilities.write),
      stat: Boolean(capabilities && capabilities.stat),
      resumableUpload: Boolean(capabilities && capabilities.resumableUpload),
      stableReferences: Boolean(capabilities && capabilities.stableReferences),
      upload: Boolean(capabilities && capabilities.upload),
    },
    reason: reason || null,
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

function probeLocalFolder(target, mode = 'local') {
  if (!target) return capabilityResult(mode, null, 'not_configured', {}, 'Select a storage folder first.');
  const folder = path.resolve(target);
  try {
    if (!fs.existsSync(folder)) return capabilityResult(mode, folder, 'unavailable', {}, 'The selected storage folder does not exist.');
    if (!fs.statSync(folder).isDirectory()) return capabilityResult(mode, folder, 'unavailable', {}, 'The selected storage path is not a folder.');
    fs.accessSync(folder, fs.constants.R_OK | fs.constants.W_OK);
    const probe = path.join(folder, '.social-pipeline-capability-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    let readBack = false;
    let stat = false;
    try {
      fs.writeFileSync(probe, 'capability check\n', { flag: 'wx' });
      readBack = fs.readFileSync(probe, 'utf8') === 'capability check\n';
      stat = fs.statSync(probe).isFile();
    } finally {
      try { fs.unlinkSync(probe); } catch {}
    }
    const capabilities = {
      list: true,
      read: readBack,
      write: true,
      stat,
      resumableUpload: false,
      stableReferences: true,
      upload: true,
    };
    const ready = capabilities.list && capabilities.read && capabilities.write && capabilities.stat;
    return capabilityResult(mode, folder, ready ? 'ready' : 'unavailable', capabilities,
      ready ? null : 'The selected storage folder did not pass every local capability check.');
  } catch (error) {
    return capabilityResult(mode, folder, 'denied', {}, 'The selected storage folder cannot be read and written: ' + error.message);
  }
}

function storageConfig(argv = process.argv) {
  const rootAt = argv.indexOf('--root');
  const start = rootAt >= 0 && argv[rootAt + 1] ? path.resolve(argv[rootAt + 1]) : process.cwd();
  const found = findConfig(start);
  if (!found || !found.config) return null;
  const cfg = found.config.storage || found.config.workspaceStorage || null;
  if (!cfg) return null;
  if (typeof cfg === 'string') return { mode: 'local', path: path.resolve(path.dirname(path.dirname(found.at)), cfg) };
  return { ...cfg, path: cfg.path ? path.resolve(path.dirname(path.dirname(found.at)), cfg.path) : cfg.path };
}

function checkStorage(target, options = {}) {
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    options = target;
    target = options.path || options.target || null;
  }
  const configured = options.argv ? storageConfig(options.argv) : null;
  const mode = options.mode || options.storageMode || configured && configured.mode || 'local';
  let selected = target;
  if (!selected && configured) selected = configured.path;
  if (!selected && mode === 'local') selected = root(options.argv || process.argv);
  if (mode === 'local') return probeLocalFolder(selected, mode);
  if (mode === 'drive-folder' || mode === 'drive_folder' || mode === 'drive_desktop_folder' || mode === 'driveDesktopFolder') {
    const local = probeLocalFolder(selected, 'drive-folder');
    return {
      ...local,
      remoteSync: { status: local.status === 'ready' ? 'unconfirmed' : 'unavailable',
        reason: 'A local folder check cannot prove that Drive has synchronized the file.' },
       capabilities: { ...local.capabilities, upload: local.capabilities.write,
         resumableUpload: false, stableReferences: local.capabilities.write },
    };
  }
  if (mode === 'drive' || mode === 'drive-connector' || mode === 'connector') {
    const connector = options.connector || options.capabilities;
    if (connector && typeof connector === 'object') {
      const capabilities = {
        list: connector.list === true || typeof connector.list === 'function',
        read: connector.read === true || typeof connector.read === 'function',
        write: connector.write === true || typeof connector.write === 'function',
        stat: connector.stat === true || typeof connector.stat === 'function',
        resumableUpload: connector.resumableUpload === true || typeof connector.resumableUpload === 'function',
        stableReferences: connector.stableReferences === true || typeof connector.stableReferences === 'function',
        upload: connector.upload === true || typeof connector.upload === 'function',
      };
      const ready = capabilities.list && capabilities.read && capabilities.write && capabilities.stat;
      const authentication = typeof connector.authentication === 'string'
        ? connector.authentication
        : connector.authenticated === true ? 'ready' : 'unknown';
      const blockedStatus = ['authorization_required', 'expired', 'denied', 'unavailable'].includes(authentication)
        ? authentication : null;
      return capabilityResult(mode, selected, blockedStatus || (ready ? 'ready' : 'unavailable'), capabilities,
        blockedStatus ? 'The connector authentication is ' + authentication + '.'
          : ready ? null : 'The connector does not expose every required storage capability.',
        { authentication });
    }
    return capabilityResult(mode, selected, 'not_configured', {},
      'No writable Drive connector capability is configured. Search access is not treated as workspace storage.');
  }
  return capabilityResult(mode, selected, 'unavailable', {}, 'Unknown storage mode.');
}

function checkStorageCapabilities(target, options = {}) {
  return checkStorage(target, options);
}

function workspaceCapabilities(options = {}) {
  const state = checkStorage(options.stateRoot || root(options.argv || process.argv), { mode: 'local' });
  const media = options.mediaRoot ? checkStorage(options.mediaRoot, { mode: options.mediaMode || 'local' }) : null;
  const output = options.outputRoot ? checkStorage(options.outputRoot, { mode: options.outputMode || 'local' }) : null;
  const required = [state, media, output].filter(Boolean);
  return {
    state,
    media,
    output,
    ready: required.every(item => item.status === 'ready'),
    blocked: required.filter(item => item.status !== 'ready').map(item => item.reason || item.status),
  };
}

function storageChild(folder, reference) {
  const name = String(reference || '').replace(/[\\]/g, '/');
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
    throw new Error('Storage references must stay inside the selected folder.');
  }
  return path.join(path.resolve(folder), ...name.split('/').filter(Boolean));
}

function createStorage(target, options = {}) {
  const mode = options.mode || options.storageMode || 'local';
  const checked = checkStorage(target, options);
  const folder = checked.target;
  if (!folder || checked.status !== 'ready' || !['local', 'drive-folder', 'drive_folder', 'drive_desktop_folder', 'driveDesktopFolder'].includes(mode)) {
    return {
      mode,
      check: checked,
      list: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
      read: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
      write: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
      stat: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
      upload: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
      resumableUpload: () => { throw new Error('Resumable upload is unavailable for this storage mode.'); },
      stableRef: () => { throw new Error(checked.reason || 'Storage is not ready.'); },
    };
  }
  return {
    mode,
    check: checked,
    list(reference = '') {
      const dir = reference ? storageChild(folder, reference) : folder;
      return fs.readdirSync(dir).sort();
    },
    read(reference, encoding) {
      return fs.readFileSync(storageChild(folder, reference), encoding);
    },
    write(reference, data) {
      const file = storageChild(folder, reference);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      return { reference: this.stableRef(reference), bytes: Buffer.byteLength(data) };
    },
    stat(reference) {
      const file = storageChild(folder, reference);
      const info = fs.statSync(file);
      return { reference: this.stableRef(reference), size: info.size, modifiedAt: info.mtime.toISOString(), isFile: info.isFile(), isDirectory: info.isDirectory() };
    },
    upload(source, reference) {
      const file = storageChild(folder, reference);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(path.resolve(source), file);
      return { reference: this.stableRef(reference), bytes: fs.statSync(file).size };
    },
    resumableUpload() {
      throw new Error('Resumable upload is unavailable for a local or Drive desktop folder.');
    },
    stableRef(reference) {
      return (mode !== 'local' ? 'drive-folder:' : 'local:')
        + storageChild(folder, reference).slice(path.resolve(folder).length + 1).replace(/[\\]/g, '/');
    },
  };
}

// The brand's own zone: one a person set, else the one its target market implies. Null when
// neither gives one (work with no brand, or a market spanning several zones).
function brandZone(brand, argv) {
  const config = workspaceConfig(brand, argv) || {};
  if (noBrand.isGeneral({ slug: brand, config })) return profiles.brandTimeZone(config, { targetMarket: 'unknown' }).timeZone;
  let profile = null;
  try { profile = profiles.read(wsDir(brand, argv)); } catch { profile = null; }
  return profiles.brandTimeZone(config, profile).timeZone;
}

// Stamps were written in whatever zone the process ran in, so a Manila workspace recorded
// its approvals in UTC. Format in the brand's own zone instead, and in the machine's only when
// the brand has none.
function now(brand, argv, date = new Date()) {
  const tz = brand ? brandZone(brand, argv) : null;
  const pad = n => String(n).padStart(2, '0');
  if (!tz) {
    const off = -date.getTimezoneOffset(), s = off < 0 ? '-' : '+';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes()) + ' ' +
      s + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'longOffset',
    });
    const parts = Object.fromEntries(f.formatToParts(date).map(p => [p.type, p.value]));
    // longOffset gives "GMT+08:00"; the record wants "+08:00".
    const offset = (parts.timeZoneName || '').replace(/^GMT/, '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${offset}`;
  } catch {
    return now(null, argv, date);
  }
}

const fwd = p => String(p).split(path.sep).join('/');

module.exports = {
  root, rootWithSource, brandsDir, wsDir, jobsDir, jobDir, inputsDir,
  listBrands, listJobs, positionals, resolveJobArgs, workspaceConfig, storageConfig,
  checkStorage, checkStorageCapabilities, checkCapabilities: checkStorage, workspaceCapabilities, createStorage,
  storageAdapter: createStorage, storage: createStorage, now, fwd,
  CONFIG_DIR, CONFIG_FILE,
};
