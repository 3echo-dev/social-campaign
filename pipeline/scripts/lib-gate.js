// The gate app, reached over plain HTTP instead of through the connector tools.
//
// In some desktop Code tab sessions the gate-app connector is offered with a stale tool list,
// so `set_progress`, `open_review` and `ask_in_workspace` are simply not there, and the pane
// freezes while the run carries on without it. Scripts can reach the network in that tab, so
// every pane call has a script behind it and the connector is optional there.
//
// Node 18 or newer, no dependencies. Nothing here throws: a pane that cannot be reached must
// never fail the work it is reporting on, so every failure comes back as
// { offline: true, reason } and the caller decides whether to say anything.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');

const FILE = 'gate-app.json';
const TIMEOUT_MS = 5000;
const LOCAL_PIPELINE_CONFIG = path.join('.social-pipeline', 'config.json');

// The settings live in the workspace root, next to workspaces/ and inputs/, so one folder
// carries both the work and the connection to the page that shows it.
const configPath = (argv) => path.join(ws.root(argv), FILE);
const localPipelineConfigPath = (argv) => path.join(ws.root(argv), LOCAL_PIPELINE_CONFIG);

function readLocalPipelineConfig(argv) {
  try {
    const cfg = JSON.parse(fs.readFileSync(localPipelineConfigPath(argv), 'utf8'));
    if (cfg && cfg.storage && cfg.storage.mode === 'local' && cfg.pipeline &&
        (cfg.pipeline.commit || cfg.pipeline.version)) return cfg;
  } catch { /* An absent or invalid local config is handled by the gate-app path. */ }
  return null;
}

function readConfig(argv) {
  if (readLocalPipelineConfig(argv)) {
    return { error: 'the local pipeline keeps gate decisions in the workspace; gate-app transport is parked' };
  }
  const p = configPath(argv);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch { return { error: 'no gate-app.json in ' + ws.fwd(ws.root(argv)) }; }
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch { return { error: ws.fwd(p) + ' is not readable JSON' }; }
  if (!cfg || !cfg.url || !cfg.key) return { error: ws.fwd(p) + ' is missing the address or the key' };
  return { config: { url: String(cfg.url).replace(/\/+$/, ''), key: String(cfg.key) } };
}

const configured = (argv) => Boolean(readConfig(argv).config);

// One call. `route` is a route name from the plugin API, for example "progress" or
// "answer?key=job-1". A GET carries no body.
async function call(route, body, options) {
  const opts = options || {};
  const argv = opts.argv || process.argv;
  const { config, error } = readConfig(argv);
  if (!config) return { offline: true, reason: error };

  const method = opts.method || (body ? 'POST' : 'GET');
  const url = config.url + '/api/plugin/v1/' + String(route).replace(/^\/+/, '');
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: 'Bearer ' + config.key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Keep the deadline alive while reading. Headers alone are not a completed response.
    text = await res.text();
  } catch (e) {
    return { offline: true, reason: 'could not reach the gate app: ' + (controller.signal.aborted ? 'the response exceeded its ' + timeoutMs + ' ms deadline' : e.message) };
  } finally { clearTimeout(timer); }

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { return { offline: true, reason: 'the gate app returned an incomplete or invalid response' }; }

  // A wrong or revoked key is the one failure worth saying out loud: nothing the run does
  // will fix it, and the person has to run set-gate-app.js again with a fresh key.
  if (res.status === 403) {
    const reason = (data && (data.reason || data.error)) || 'the key was refused';
    console.error(reason);
    return { offline: true, reason };
  }
  if (res.status >= 500) return { offline: true, reason: 'the gate app answered ' + res.status };
  if (!res.ok) {
    return { ok: false, status: res.status, reason: (data && (data.reason || data.error)) || ('the gate app answered ' + res.status) };
  }
  return data === null ? { ok: true } : data;
}

// Twelve megabytes, the same ceiling the gate app enforces. Checked here too so a
// forty megabyte clip is refused before it is read into memory and base64'd.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const KINDS = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
};

/**
 * Send one picture or clip to the gate app and get back the address the pane can show.
 *
 * The run makes its frames on this machine. Handing the pane `media/D1/P1.png` asked the
 * browser for a file that has never been near the web server, so the person saw the hero
 * frame in the chat and an empty card in the pane. The bytes have to travel.
 *
 * Returns `{ url }`, or `{ offline: true, reason }` for anything that went wrong, because a
 * picture that cannot be shown must never block a gate: the caller falls back to words.
 */
async function upload(filePath, options) {
  const opts = options || {};
  const key = opts.key;
  if (!key) return { offline: true, reason: 'say which page this file is for' };

  let bytes;
  try { bytes = fs.readFileSync(filePath); }
  catch (e) { return { offline: true, reason: 'could not read ' + ws.fwd(filePath) + ': ' + e.message }; }
  if (!bytes.length) return { offline: true, reason: ws.fwd(filePath) + ' is empty' };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { offline: true, reason: path.basename(filePath) + ' is over 12 MB, which the pane will not take' };
  }

  // `name` renames the file on the way up. Two deliverables both have a P1.png, and the
  // store keys on the name, so without this the second one would overwrite the first and a
  // card would show the wrong picture.
  const filename = opts.name ? String(opts.name) : path.basename(filePath);
  const extension = filename.toLowerCase().split('.').pop();
  const contentType = KINDS[extension];
  if (!contentType) return { offline: true, reason: filename + ' is neither a picture nor a clip' };

  const res = await call('upload', {
    key, filename, contentType, data: bytes.toString('base64'),
  }, { argv: opts.argv || process.argv, timeoutMs: opts.timeoutMs || 60000 });

  if (res.offline) return res;
  if (!res.url) return { offline: true, reason: res.reason || 'the gate app returned no address' };
  return { url: res.url };
}

module.exports = { call, upload, readConfig, configPath, localPipelineConfigPath, configured, FILE, TIMEOUT_MS, MAX_UPLOAD_BYTES };
