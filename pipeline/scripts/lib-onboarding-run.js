// Brand research outside a job: the one onboarding run a workspace may have open at a time.
//
// Usage is billed to whatever is open when a Stop hook fires, and onboarding has no job, so
// before this its research left no tokens, time or tool record anywhere. A run is a folder in
// the brand, workspaces/<slug>/onboarding/<runId>/, holding run.json beside the same usage files
// a job keeps, and one marker, .social-pipeline/onboarding/active.json, names the run that is open.
//
// There is no session logic here. The tool server does not know which Claude session asked, so
// while a run is active every turn in the workspace is billed to it. A run left open stops
// counting after STALE_MS, and the next start closes it as abandoned.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');

const STAGE = 'BRAND_RESEARCH';
const STAGE_ID = 'brand-research';
const STAGE_LABEL = 'Brand research';
const STALE_MS = 3600000;
const PENDING_MS = 600000;
const RETRY_MS = 180000;
const KIND = 'brand_onboarding_research';
const RUN_ID = /^run-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
const STATUSES = new Set(['running', 'complete', 'failed', 'abandoned']);
const CLOSED = new Set(['complete', 'failed', 'abandoned']);
const MAX_REASON = 500;

// A Date, epoch milliseconds or an ISO string. Anything unreadable is the current time.
function msOf(now) {
  let ms = Date.now();
  if (now instanceof Date) ms = now.getTime();
  else if (typeof now === 'number') ms = now;
  else if (typeof now === 'string' && now) ms = Date.parse(now);
  return Number.isFinite(ms) ? ms : Date.now();
}

const iso = ms => new Date(ms).toISOString();
const text = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const strings = (value, max) => (Array.isArray(value) ? value : [])
  .filter(item => typeof item === 'string' && item.trim())
  .map(item => item.trim().slice(0, 500))
  .slice(0, max);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {};

function inside(root, dir) {
  const rel = path.relative(root, dir);
  return Boolean(rel) && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function brandDirIn(root, brandDir) {
  const dir = typeof brandDir === 'string' && brandDir ? path.resolve(brandDir) : null;
  if (!dir || !inside(root, dir)) throw new Error('The brand folder must be inside the workspace.');
  return dir;
}

function notFound(runId) {
  const error = new Error('Brand research run not found: ' + String(runId).slice(0, 80));
  error.code = 'ONBOARDING_RUN_NOT_FOUND';
  return error;
}

const pendingPath = brandDir => path.join(path.resolve(brandDir), 'onboarding', 'research-pending.json');

const markerPath = root => path.join(path.resolve(root), '.social-pipeline', 'onboarding', 'active.json');

// The id is checked here because it arrives from tool input and becomes part of a path.
function runDir(brandDir, runId) {
  if (!RUN_ID.test(String(runId || ''))) throw new TypeError('Not a brand research run id: ' + String(runId).slice(0, 80));
  return path.join(path.resolve(brandDir), 'onboarding', runId);
}

function newRunId(now) {
  const stamp = iso(msOf(now)).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'run-' + stamp + '-' + crypto.randomBytes(3).toString('hex');
}

function parseRun(raw, runId) {
  let run;
  try { run = JSON.parse(raw); } catch { return null; }
  if (!run || typeof run !== 'object' || Array.isArray(run)) return null;
  if (run.kind !== KIND || run.runId !== runId || !STATUSES.has(run.status)) return null;
  return Number.isFinite(Date.parse(run.startedAt)) ? run : null;
}

function read(brandDir, runId) {
  if (!RUN_ID.test(String(runId || ''))) return null;
  try { return parseRun(fs.readFileSync(path.join(runDir(brandDir, runId), 'run.json'), 'utf8'), runId); }
  catch { return null; }
}

function list(brandDir) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(path.resolve(brandDir), 'onboarding'), { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter(entry => entry.isDirectory() && RUN_ID.test(entry.name))
    .map(entry => read(brandDir, entry.name))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.runId.localeCompare(b.runId));
}

/** Whether a running run has gone past the point where usage may still be billed to it. */
function isStale(run, now) {
  const started = Date.parse(run && run.startedAt);
  return !Number.isFinite(started) || msOf(now) - started >= STALE_MS;
}

// The run the marker names, when the marker is readable, points inside the root and the run
// record exists. Its status is not checked here.
function locate(root) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath(root), 'utf8')); } catch { return null; }
  if (!marker || typeof marker !== 'object' || !RUN_ID.test(String(marker.runId || ''))
    || typeof marker.brandPath !== 'string' || !marker.brandPath) return null;
  const brandDir = path.resolve(root, marker.brandPath);
  if (!inside(root, brandDir)) return null;
  const run = read(brandDir, marker.runId);
  return run ? { run, dir: runDir(brandDir, run.runId), brandDir } : null;
}

function dropMarker(file, runId) {
  try {
    const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (marker && marker.runId === runId) fs.unlinkSync(file);
  } catch { /* already gone, or it names another run */ }
}

function clearMarker(root, runId) {
  const file = markerPath(root);
  if (!fs.existsSync(file)) return;
  const release = durable.acquire(file);
  try { dropMarker(file, runId); } finally { release(); }
}

// Close the record only. Callers holding the marker lock use this directly.
function finish(brandDir, runId, options) {
  if (!read(brandDir, runId)) throw notFound(runId);
  let result = null;
  durable.update(path.join(runDir(brandDir, runId), 'run.json'), raw => {
    const run = parseRun(raw, runId);
    if (!run) throw notFound(runId);
    if (run.status !== 'running') { result = run; return raw; }
    const reported = options.reported && typeof options.reported === 'object' ? {
      searches: count(options.reported.searches),
      fetches: count(options.reported.fetches),
      stopReason: text(options.reported.stopReason, 200),
    } : run.reported;
    result = {
      ...run,
      status: options.status,
      completedAt: iso(msOf(options.now)),
      profileRevisionAtEnd: options.profileRevisionAtEnd === undefined ? run.profileRevisionAtEnd : count(options.profileRevisionAtEnd),
      researchRevision: options.researchRevision === undefined ? run.researchRevision : count(options.researchRevision),
      filledFields: options.filledFields === undefined ? run.filledFields : strings(options.filledFields, 20),
      reported,
      reason: options.reason === undefined ? run.reason : text(options.reason, MAX_REASON),
    };
    return JSON.stringify(result, null, 2) + '\n';
  });
  return result;
}

/**
 * Open a brand research run, or return the one this brand already has open.
 * Another brand's open run refuses with code ONBOARDING_RUN_ACTIVE. A stale run is closed as
 * abandoned first; its end is the moment it went stale, so an idle week is not counted as work.
 */
function start(root, options = {}) {
  const base = path.resolve(root);
  const brand = text(options.brand, 200);
  if (!brand) throw new TypeError('A brand is required to start brand research.');
  const brandDir = brandDirIn(base, options.brandDir);
  const brandId = text(options.brandId, 200);
  const nowMs = msOf(options.now);
  const file = markerPath(base);
  const release = durable.acquire(file);
  try {
    const current = locate(base);
    if (current && current.run.status === 'running') {
      if (!isStale(current.run, nowMs)) {
        const same = brandId && current.run.brandId ? current.run.brandId === brandId : current.run.brand === brand;
        if (same) return { run: current.run, created: false };
        const error = new Error('Brand research is already running for ' + current.run.brand + '. Finish or close that run first.');
        error.code = 'ONBOARDING_RUN_ACTIVE';
        error.runId = current.run.runId;
        error.brand = current.run.brand;
        throw error;
      }
      finish(current.brandDir, current.run.runId, {
        status: 'abandoned', reason: 'timed out',
        now: Math.min(nowMs, Date.parse(current.run.startedAt) + STALE_MS),
      });
    }
    const runId = newRunId(nowMs);
    const startedAt = iso(nowMs);
    const workspaceId = text(options.workspaceId, 200);
    const run = {
      version: 1, kind: KIND, runId, brand, brandId, workspaceId,
      stage: STAGE, stageLabel: STAGE_LABEL, market: text(options.market, 16) || 'SG',
      status: 'running', startedAt, completedAt: null,
      profileRevisionAtStart: count(options.profileRevision), profileRevisionAtEnd: null,
      researchRevisionAtStart: count(options.researchRevision), researchRevision: null,
      blankFields: strings(options.blankFields, 20), filledFields: [],
      declaredCompetitors: strings(options.declaredCompetitors, 3),
      limits: plain(options.limits),
      reported: { searches: null, fetches: null, stopReason: null },
      reason: null,
    };
    // The marker first: a crash between the two writes leaves a marker naming no run, which reads
    // as no run, rather than a run record left running with nothing that can ever close it.
    durable.atomicWrite(file, JSON.stringify({
      version: 1, runId, brand, brandId,
      brandPath: path.relative(base, brandDir).split(path.sep).join('/'),
      workspaceId, startedAt,
    }, null, 2) + '\n');
    durable.atomicWrite(path.join(runDir(brandDir, runId), 'run.json'), JSON.stringify(run, null, 2) + '\n');
    return { run, created: true };
  } finally {
    release();
  }
}

function readPending(brandDir) {
  try {
    const marker = JSON.parse(fs.readFileSync(pendingPath(brandDir), 'utf8'));
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
    if (!Number.isFinite(Date.parse(marker.requestedAt)) || !Number.isFinite(Date.parse(marker.expiresAt))) return null;
    return marker;
  } catch { return null; }
}

function markPending(root, options = {}) {
  const brandDir = brandDirIn(path.resolve(root), options.brandDir);
  const nowMs = msOf(options.now);
  durable.atomicWrite(pendingPath(brandDir), JSON.stringify({
    version: 1, requestedAt: iso(nowMs), expiresAt: iso(nowMs + PENDING_MS), restarts: 0,
  }, null, 2) + '\n');
}

function clearPending(brandDir) {
  try { fs.unlinkSync(pendingPath(brandDir)); } catch { return; }
}

function settlePending(brandDir, status, nowMs) {
  const marker = readPending(brandDir);
  if (!marker) return;
  if (status === 'complete' || Number(marker.restarts) >= 1) { clearPending(brandDir); return; }
  durable.atomicWrite(pendingPath(brandDir), JSON.stringify({
    ...marker, restarts: 1, expiresAt: iso(nowMs + RETRY_MS),
  }, null, 2) + '\n');
}

function pendingInfo(brandDir, options = {}) {
  const marker = readPending(brandDir);
  if (!marker) return { state: null, until: null };
  const nowMs = msOf(options.now);
  const runs = Array.isArray(options.runs) ? options.runs : list(brandDir);
  const latest = runs[runs.length - 1] || null;
  const requestedMs = Date.parse(marker.requestedAt);
  if (latest && Date.parse(latest.startedAt) >= requestedMs) {
    if (latest.status === 'complete') return { state: null, until: null };
    if (latest.status === 'running' && !isStale(latest, nowMs)) return { state: null, until: null };
  }
  const until = Date.parse(marker.expiresAt);
  return nowMs < until ? { state: 'waiting', until: marker.expiresAt } : { state: 'expired', until: null };
}

function pendingState(brandDir, options = {}) {
  return pendingInfo(brandDir, options).state;
}

/** Close a run as complete, failed or abandoned. Closing a closed run returns it unchanged. */
function close(root, options = {}) {
  const base = path.resolve(root);
  const brandDir = brandDirIn(base, options.brandDir);
  if (!CLOSED.has(options.status)) throw new TypeError('A brand research run closes as complete, failed or abandoned.');
  const before = read(brandDir, options.runId);
  const run = finish(brandDir, options.runId, options);
  clearMarker(base, run.runId);
  if (before && before.status === 'running') settlePending(brandDir, run.status, msOf(options.now));
  return run;
}

/** The open run as `{ run, dir, brandDir }`, or null. A marker left by a closed run is removed. */
function active(root, options) {
  const base = path.resolve(root);
  const found = locate(base);
  if (!found) return null;
  if (found.run.status !== 'running') {
    clearMarker(base, found.run.runId);
    return null;
  }
  return isStale(found.run, (options || {}).now) ? null : found;
}

module.exports = {
  STAGE, STAGE_ID, STAGE_LABEL, STALE_MS, PENDING_MS, RETRY_MS, RUN_ID,
  markerPath, pendingPath, runDir, newRunId, read, list, start, close, active, isStale,
  markPending, clearPending, pendingState, pendingInfo,
};
