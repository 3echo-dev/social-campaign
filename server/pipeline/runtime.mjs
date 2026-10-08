/**
 * Local adapter for the vendored social-media-pipeline runtime.
 *
 * The Social Campaign server is ESM while the imported pipeline is CommonJS.
 * This module is the only boundary used by the server and the board: it owns
 * the local root, durable ids, input snapshots and the read-only projection of
 * a pipeline job.  It never resolves a root from cwd and never talks to Drive.
 */

import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as facts from './facts.mjs';
import { addSuppliedMedia, writeSuppliedPosts } from './supplied-media.mjs';
import { finishingChoice } from './finishing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const PIPELINE_ROOT = join(PROJECT_ROOT, 'pipeline');
const PIPELINE_VERSION = '0.12.13';
const PIPELINE_COMMIT = '29f67ceb2a9f7beeb0068d7f8da8910855ecf4b4';
const CONFIG_DIR = '.social-pipeline';
const CONFIG_FILE = 'config.json';
const SCHEMA_VERSION = '1.0';
const REQUESTS_FILE = 'requests.json';
const MIGRATIONS_DIR = 'migrations';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTAKE_PATCH_FIELDS = new Set([
  'brief', 'request', 'title', 'kind', 'objective', 'distribution', 'platforms',
  'deliverables', 'audience', 'evidence', 'requiredClaims', 'prohibitedClaims',
  'offer', 'landingPageUrl', 'schedule', 'budget', 'productAsset', 'account',
  'specWork', 'usesHistoricalData', 'metricsScope', 'links', 'subject', 'kindReason',
  'caption', 'aiMade',
]);
const LINK_LIMIT = 20;
const LINK_MAX_LENGTH = 2000;
const VIDEO_FILE_LINK = /\.(mp4|mov|m4v|webm)$/i;
const STILLS_KINDS = new Set(['video_breakdown']);
const INTAKE_PATCH_SCALARS = new Set(['request', 'title', 'kind', 'kindReason', 'objective', 'distribution', 'offer', 'landingPageUrl', 'subject', 'caption']);
const JOB_SUBJECTS = ['product', 'character', 'none'];
const INTAKE_PATCH_ARRAYS = new Set(['platforms', 'deliverables', 'requiredClaims', 'prohibitedClaims']);
const INTAKE_PATCH_OBJECTS = new Set(['audience', 'evidence', 'schedule', 'budget', 'productAsset', 'account', 'metricsScope']);
const INTAKE_PATCH_BOOLEANS = new Set(['specWork', 'usesHistoricalData', 'aiMade']);
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const PHOTO_SOURCES = new Set(['uploaded', 'found-online', 'made']);
const PHOTO_LICENCE = { uploaded: 'supplied by the brand', 'found-online': 'found online, rights not confirmed', made: 'generated for this brand' };

const require = createRequire(import.meta.url);
const stagesRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-stages.js'));
const statesRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-states.js'));
const brandProfileRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-profile.js'));
const brandKitRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-kit.js'));
const deliverableRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-deliverable.js'));
const brandVoiceRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-voice.js'));
const durableLock = require(join(PIPELINE_ROOT, 'scripts', 'lib-durable.js'));
const onboardingRunRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-run.js'));
const kindsRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-kinds.js'));
const noBrandRuntime = require(join(PIPELINE_ROOT, 'scripts', 'lib-no-brand.js'));

export const NO_BRAND = noBrandRuntime.NO_BRAND;
export const isGeneralBrand = (value) => noBrandRuntime.isGeneral(value);

export function webLink(value) {
  const raw = value && typeof value === 'object' ? value.uri ?? value.url : value;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > LINK_MAX_LENGTH) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? text : null;
}

export function linkSourceRef(uri, known = null) {
  if (known && typeof known === 'object' && webLink(known) === uri) return jsonClone(known);
  let pathname = '';
  try { pathname = new URL(uri).pathname; } catch { pathname = ''; }
  return { uri, mediaType: VIDEO_FILE_LINK.test(pathname) ? 'video' : 'url', suppliedBy: 'user' };
}

export function sourceLinks(refs) {
  return [...new Set((Array.isArray(refs) ? refs : []).map(webLink).filter(Boolean))];
}

function withLinks(refs, links) {
  const current = Array.isArray(refs) ? refs : [];
  const kept = current.filter((ref) => !webLink(ref));
  if (links === null) return kept;
  if (!Array.isArray(links) || links.length > LINK_LIMIT) {
    throw new TypeError(`Links must be a list of at most ${LINK_LIMIT} https addresses.`);
  }
  const chosen = [];
  for (const item of links) {
    const uri = webLink(item);
    if (!uri) throw new TypeError('Each link must be a full https address.');
    if (!chosen.includes(uri)) chosen.push(uri);
  }
  return [...kept, ...chosen.map((uri) => linkSourceRef(uri, current.find((ref) => webLink(ref) === uri)))];
}

function reportKind(kind) {
  const entry = kindsRuntime.kindOf(kind);
  return Boolean(entry && entry.status === 'active' && entry.makesContent === false);
}

export function jobKindOf(value) {
  const entry = kindsRuntime.kindOf(value);
  return entry ? entry.kind : null;
}

/** The one line Claude saves with the pipeline it picked: plain text on one line, at most KIND_REASON_LIMIT characters, or '' when there is none. */
export const KIND_REASON_LIMIT = 200;
export function kindReasonOf(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > KIND_REASON_LIMIT ? `${text.slice(0, KIND_REASON_LIMIT - 1).trim()}…` : text;
}

function ensureJobFolders(dir, kind) {
  if (!reportKind(kind)) return;
  mkdirSync(join(dir, 'report'), { recursive: true });
  if (STILLS_KINDS.has(jobKindOf(kind))) mkdirSync(join(dir, 'report', 'stills'), { recursive: true });
}

const now = () => new Date().toISOString();
const toText = (value) => (value == null ? '' : String(value));
const forward = (value) => toText(value).split(sep).join('/');

function jsonClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function jsonForFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonAtomic(filePath, value) {
  const parent = dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temp, jsonForFile(value), 'utf8');
  renameSync(temp, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function pathKey(value) {
  const normalized = normalize(resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathInside(parent, child, equal = true) {
  const parentKey = pathKey(parent);
  const childKey = pathKey(child);
  if (equal && childKey === parentKey) return true;
  const prefix = parentKey.endsWith(sep) ? parentKey : `${parentKey}${sep}`;
  return childKey.startsWith(prefix);
}

function pathsOverlap(left, right) {
  return pathInside(left, right, true) || pathInside(right, left, true);
}

function assertAbsoluteRoot(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new TypeError('An explicit absolute local workspace root is required.');
  }
  const value = input.trim();
  if (!isAbsolute(value)) {
    throw new TypeError(`Workspace root must be absolute: ${value}`);
  }
  return resolve(value);
}

function assertDirectory(root, label = 'Workspace root') {
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  const info = lstatSync(root);
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${root}`);
  if (info.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link or junction: ${root}`);
  try { accessSync(root, constants.R_OK | constants.W_OK); }
  catch (error) { throw new Error(`${label} is not readable and writable: ${error.message}`); }
}

function realPathIfExists(value) {
  try { return realpathSync(value); } catch { return resolve(value); }
}

function assertInsideRoot(root, candidate, label = 'Path') {
  const rootReal = realPathIfExists(root);
  const candidateReal = realPathIfExists(candidate);
  if (!pathInside(rootReal, candidateReal, true)) {
    throw new Error(`${label} leaves the workspace root: ${candidate}`);
  }
  return candidateReal;
}

function assertNoInputOverlap(root, source, label = 'Input') {
  const rootReal = realPathIfExists(root);
  const sourceReal = realPathIfExists(source);
  if (pathsOverlap(rootReal, sourceReal)) {
    throw new Error(`${label} overlaps the workspace root. Choose a source outside ${root}.`);
  }
}

function assertNoReparsePoint(filePath, label = 'Path') {
  let current = resolve(filePath);
  const pieces = [];
  while (true) {
    pieces.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of pieces) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`${label} crosses a symbolic link or junction: ${filePath}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
}

function safePath(root, ...parts) {
  const result = resolve(root, ...parts);
  assertInsideRoot(root, result, 'Workspace path');
  return result;
}

function slugify(value, fallback = 'item') {
  const result = toText(value).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return result || fallback;
}

function assertSlug(value, label) {
  const slug = toText(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new TypeError(`${label} must use lowercase letters, numbers and hyphens.`);
  }
  return slug;
}

function shortHash(value, length = 12) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function workspaceConfigPath(root) { return join(root, CONFIG_DIR, CONFIG_FILE); }
function workspaceMetaDir(root) { return join(root, CONFIG_DIR); }
function requestsPath(root) { return join(workspaceMetaDir(root), REQUESTS_FILE); }
function brandsPath(root) { return join(root, 'workspaces'); }
function inputsPath(root, brand, jobId) { return join(root, 'inputs', brand, jobId); }
function brandPath(root, brand) { return join(brandsPath(root), brand); }
function jobsPath(root, brand) { return join(brandPath(root, brand), 'jobs'); }
function jobPath(root, brand, jobId) { return join(jobsPath(root, brand), jobId); }

function localConfig(root) {
  const config = readJson(workspaceConfigPath(root));
  if (!config || typeof config !== 'object') return null;
  return config;
}

function configuredRoot(root, config) {
  if (!config?.root) return resolve(root);
  return isAbsolute(String(config.root))
    ? resolve(String(config.root))
    : resolve(dirname(dirname(workspaceConfigPath(root))), String(config.root));
}

function assertLocalWorkspace(root, { allowUninitialized = false } = {}) {
  const abs = assertAbsoluteRoot(root);
  assertDirectory(abs);
  reconcileWorkspaceLocation(abs);
  const config = localConfig(abs);
  if (!config) {
    if (allowUninitialized) return { root: abs, config: null };
    throw new Error(`No local Social Campaign workspace is configured at ${abs}. Initialize or adopt it first.`);
  }
  if (config.storage?.mode && config.storage.mode !== 'local') {
    throw new Error('Only local workspace storage is supported by this runtime.');
  }
  if (config.root && pathKey(configuredRoot(abs, config)) !== pathKey(abs)) {
    throw new Error(`Workspace configuration points at ${config.root}, not ${abs}.`);
  }
  return { root: abs, config };
}

function loadRequests(root) {
  const value = readJson(requestsPath(root), {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function requestKey(kind, requestId) {
  const id = toText(requestId).trim();
  return id ? `${kind}:${id}` : null;
}

function requestLookup(root, kind, requestId) {
  const key = requestKey(kind, requestId);
  if (!key) return null;
  const requests = loadRequests(root);
  return requests[key] || null;
}

function rememberRequest(root, kind, requestId, record) {
  const key = requestKey(kind, requestId);
  if (!key) return;
  const requests = loadRequests(root);
  requests[key] = { ...record, kind, requestId: toText(requestId), recordedAt: now() };
  writeJsonAtomic(requestsPath(root), requests);
}

const LEGACY_REQUEST_LOCK_STALE_MS = 60000;
const legacyRequestLocksChecked = new Set();

function clearLegacyRequestLock(root) {
  if (legacyRequestLocksChecked.has(root)) return;
  legacyRequestLocksChecked.add(root);
  const legacyLockPath = join(workspaceMetaDir(root), '.requests.lock');
  try {
    const stat = statSync(legacyLockPath);
    if (Date.now() - stat.mtimeMs > LEGACY_REQUEST_LOCK_STALE_MS) unlinkSync(legacyLockPath);
  } catch {}
}

function acquireRequestLock(root, timeoutMs = 5000) {
  clearLegacyRequestLock(root);
  try {
    return durableLock.acquire(requestsPath(root), timeoutMs);
  } catch (error) {
    throw new Error(`Could not reserve the workspace request ledger: ${error.message}`);
  }
}

function baseConfig(root, options = {}) {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    // Location-independent identity: `root` is relative to the folder the
    // config file lives in, so the workspace is found by that folder,
    // never by a saved absolute path.  `lastSeenRoot` records the absolute
    // path this workspace was last opened at, on this computer only.
    root: '.',
    lastSeenRoot: root,
    storage: { mode: 'local' },
    workspaceId: toText(options.workspaceId).trim() || randomUUID(),
    owner: {
      userId: options.ownerUserId ? toText(options.ownerUserId) : null,
      email: options.ownerEmail ? toText(options.ownerEmail).trim().toLowerCase() : null,
    },
    ownershipStatus: options.ownerUserId ? 'bound' : 'unbound',
    board: { ref: options.boardRef ? toText(options.boardRef) : null },
    pipeline: { version: PIPELINE_VERSION, commit: PIPELINE_COMMIT },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createWorkspaceTree(root) {
  for (const dir of [
    CONFIG_DIR,
    join(CONFIG_DIR, 'sync'),
    join(CONFIG_DIR, MIGRATIONS_DIR),
    'inputs',
    'workspaces',
  ]) {
    const target = safePath(root, dir);
    mkdirSync(target, { recursive: true });
    assertNoReparsePoint(target, 'Workspace directory');
  }
}

const BOARD_DIR_NAME = 'board';
const BOARD_BINDING_FILE_NAME = 'binding.json';

function boardBindingPath(root) {
  return join(root, CONFIG_DIR, BOARD_DIR_NAME, BOARD_BINDING_FILE_NAME);
}

/**
 * Move an existing board binding aside to a backup file next to it.  The
 * binding is never deleted: the board it points at belongs to the workspace
 * it was copied from, not to this new copy, so the copy starts with no
 * binding and the old one survives only as a recovery backup.
 */
function backupBoardBinding(root) {
  const file = boardBindingPath(root);
  if (!existsSync(file)) return null;
  const stamp = now().replace(/[^0-9]/g, '');
  let backup = `${file}.moved-${stamp}.bak`;
  if (existsSync(backup)) backup = `${file}.moved-${stamp}-${randomUUID()}.bak`;
  renameSync(file, backup);
  return backup;
}

/**
 * Make a workspace config location-independent: the workspace is identified
 * by the config file inside its folder, never by a saved absolute path.
 *
 * Reconciles the recorded location (an old absolute `root`, or the newer
 * `lastSeenRoot`) against where the config actually is right now:
 *  - same folder as before (or nothing recorded yet): only upgrades `root`
 *    to "." and stamps `lastSeenRoot`.  Nothing else changes.
 *  - a different folder, and the recorded location still exists and holds a
 *    pipeline config with the SAME workspaceId: this folder is a COPY.  It
 *    gets a fresh workspaceId, its owner resets to unbound, and any board
 *    binding is moved aside to a backup (never deleted), since that board
 *    belongs to the original workspace.  Everything else is kept.
 *  - a different folder otherwise: a MOVE (or the first open on another
 *    computer).  The workspaceId, owner and board binding are kept as-is.
 *
 * In every case `root` is rewritten to "." and `lastSeenRoot` to the current
 * absolute path, atomically.  Called by initializeWorkspace and
 * assertLocalWorkspace before their own path checks, so every entry point
 * self-heals.  A config whose storage mode is not local is left untouched;
 * the caller's own check reports that refusal.
 */
export function reconcileWorkspaceLocation(root) {
  const abs = resolve(root);
  const config = localConfig(abs);
  if (!config || typeof config !== 'object') return { reconciled: false, action: 'none' };
  if (config.storage?.mode && config.storage.mode !== 'local') return { reconciled: false, action: 'none' };

  const legacyRoot = typeof config.root === 'string' ? config.root.trim() : '';
  const recordedLocation = legacyRoot && isAbsolute(legacyRoot)
    ? resolve(legacyRoot)
    : (typeof config.lastSeenRoot === 'string' && config.lastSeenRoot.trim() ? resolve(config.lastSeenRoot.trim()) : null);

  if (!recordedLocation || pathKey(recordedLocation) === pathKey(abs)) {
    if (legacyRoot !== '.' || config.lastSeenRoot !== abs) {
      writeJsonAtomic(workspaceConfigPath(abs), { ...config, root: '.', lastSeenRoot: abs, updatedAt: now() });
      return { reconciled: true, action: 'upgraded' };
    }
    return { reconciled: false, action: 'none' };
  }

  const sourceConfig = existsSync(recordedLocation) ? localConfig(recordedLocation) : null;
  const isCopy = Boolean(sourceConfig?.workspaceId && sourceConfig.workspaceId === config.workspaceId);

  let next;
  if (isCopy) {
    backupBoardBinding(abs);
    next = {
      ...config,
      workspaceId: randomUUID(),
      owner: { userId: null, email: null },
      ownershipStatus: 'unbound',
      root: '.',
      lastSeenRoot: abs,
      updatedAt: now(),
    };
  } else {
    next = { ...config, root: '.', lastSeenRoot: abs, updatedAt: now() };
  }
  writeJsonAtomic(workspaceConfigPath(abs), next);
  return { reconciled: true, action: isCopy ? 'copied' : 'moved', previousLocation: recordedLocation };
}

/**
 * Initialize a local workspace at an explicitly selected absolute path.
 * Existing matching configuration is adopted without rewriting its identity.
 */
export function initializeWorkspace(options = {}) {
  const root = assertAbsoluteRoot(options.root);
  assertDirectory(root);
  reconcileWorkspaceLocation(root);
  const existing = localConfig(root);
  if (existing) {
    if (existing.storage?.mode && existing.storage.mode !== 'local') {
      throw new Error('This workspace is configured for unsupported non-local storage.');
    }
    if (existing.root && pathKey(configuredRoot(root, existing)) !== pathKey(root)) {
      throw new Error(`Existing workspace config points at ${existing.root}.`);
    }
    createWorkspaceTree(root);
    const workspace = {
      ...existing,
      schemaVersion: existing.schemaVersion || SCHEMA_VERSION,
      root: existing.root || root,
      storage: existing.storage || { mode: 'local' },
      workspaceId: existing.workspaceId || existing.id || randomUUID(),
      owner: existing.owner || {
        userId: existing.ownerUserId || null,
        email: existing.ownerEmail || null,
      },
      ownershipStatus: existing.ownershipStatus || (existing.owner?.userId || existing.ownerUserId ? 'bound' : 'unbound'),
      pipeline: existing.pipeline || { version: PIPELINE_VERSION, commit: PIPELINE_COMMIT },
      createdAt: existing.createdAt || now(),
      updatedAt: existing.updatedAt || now(),
    };
    if (JSON.stringify(workspace) !== JSON.stringify(existing)) writeJsonAtomic(workspaceConfigPath(root), workspace);
    if (!existsSync(requestsPath(root))) writeJsonAtomic(requestsPath(root), {});
    return { workspace, created: false, adopted: true };
  }
  createWorkspaceTree(root);
  const config = baseConfig(root, options);
  writeJsonAtomic(workspaceConfigPath(root), config);
  writeJsonAtomic(requestsPath(root), {});
  return { workspace: config, created: true, adopted: false };
}

/**
 * Adopt a pre-existing pipeline root.  This only writes the local runtime
 * metadata and leaves workspaces, inputs and all user files intact.
 */
export function adoptWorkspace(options = {}) {
  const root = assertAbsoluteRoot(options.root);
  assertDirectory(root, 'Workspace root');
  const existing = localConfig(root);
  if (existing) return initializeWorkspace(options);

  const oldConfigPath = join(root, CONFIG_DIR, CONFIG_FILE);
  const oldConfig = readJson(oldConfigPath);
  const hasPipelineData = existsSync(join(root, 'workspaces')) || existsSync(join(root, 'inputs'));
  if (!hasPipelineData && !oldConfig) {
    throw new Error(`No existing pipeline root was found at ${root}.`);
  }
  if (oldConfig?.storage?.mode && oldConfig.storage.mode !== 'local') {
    throw new Error('Only local pipeline roots can be adopted.');
  }

  createWorkspaceTree(root);
  const config = baseConfig(root, {
    ...options,
    workspaceId: oldConfig?.workspaceId || oldConfig?.id,
    ownerUserId: options.ownerUserId || oldConfig?.owner?.userId || oldConfig?.ownerUserId,
    ownerEmail: options.ownerEmail || oldConfig?.owner?.email || oldConfig?.ownerEmail,
    boardRef: options.boardRef || oldConfig?.board?.ref,
  });
  if (oldConfig?.createdAt) config.createdAt = oldConfig.createdAt;
  writeJsonAtomic(workspaceConfigPath(root), config);
  if (!existsSync(requestsPath(root))) writeJsonAtomic(requestsPath(root), {});
  return { workspace: config, adopted: true, created: false, existingConfig: oldConfig || null };
}

/**
 * Read the local configuration. The returned `root` is always the current
 * absolute location, the same contract callers had before workspaces became
 * location-independent, even though the on-disk file itself now stores a
 * relative `root` (".") plus `lastSeenRoot`. Every other field is passed
 * through unchanged.
 */
export function readWorkspace({ root }) {
  const resolved = assertLocalWorkspace(root);
  return { ...resolved.config, root: resolved.root };
}

function brandRecord(root, brandDir) {
  const config = readJson(join(brandDir, 'workspace.json'), {});
  const slug = basename(brandDir);
  let profile = null;
  try { profile = brandProfileRuntime.read(brandDir); } catch { profile = null; }
  const onboarding = config.onboarding?.status
    ? config.onboarding
    : profile
      ? { status: 'complete', profileRevision: Number(profile.revision || 1), completedAt: profile.completedAt || null, reviewStatus: 'inferred' }
      : { status: 'required' };
  const kitStatus = brandKitRuntime.status(brandDir);
  const readyForJobs = onboarding.status === 'complete' && kitStatus !== 'pending';
  const voice = brandVoiceRuntime.voiceComplete(profile);
  const general = isGeneralBrand({ slug, config });
  // A time zone a person set wins; otherwise it follows the target market. Null means the step
  // that needs a time zone has to ask: nothing here assumes one.
  // Work with no brand has no target market to follow.
  const zone = brandProfileRuntime.brandTimeZone(config, general ? { targetMarket: 'unknown' } : profile);
  return {
    id: config.brandId || config.id || `brand-${shortHash(`${root}:${slug}`)}`,
    brandId: config.brandId || config.id || null,
    slug,
    general,
    name: general ? noBrandRuntime.NAME : config.name || slug,
    status: config.status || 'active',
    timezone: zone.timeZone,
    timezoneSource: zone.source,
    ownerUserId: config.ownerUserId || null,
    ownerEmail: config.ownerEmail || null,
    onboardingStatus: onboarding.status,
    onboarding,
    kitStatus,
    readyForJobs,
    voice: { complete: voice.complete, missing: voice.missing, reasons: voice.reasons },
    path: brandDir,
    config,
  };
}

function resolveBrand(root, value) {
  if (value && typeof value === 'object') {
    if (value.brandId) return resolveBrand(root, value.brandId);
    if (value.slug) return resolveBrand(root, value.slug);
  }
  const input = toText(value).trim();
  if (!input) throw new Error('A brand id or slug is required.');
  const dirBySlug = brandPath(root, input);
  if (existsSync(join(dirBySlug, 'workspace.json'))) return brandRecord(root, dirBySlug);
  for (const entry of listBrands({ root, includeGeneral: true })) {
    if (entry.id === input || entry.brandId === input) return entry;
  }
  throw new Error(`Brand not found: ${input}`);
}

function assertRealBrand(brand) {
  if (brand && isGeneralBrand(brand)) {
    throw new Error('Work with no brand has no brand profile. Choose a brand, or onboard a new one.');
  }
  return brand;
}

function assertBrandSlugFree(slug) {
  if (isGeneralBrand(slug)) {
    throw new Error(`"${noBrandRuntime.NAME}" is kept for work with no brand. Give the brand its own name.`);
  }
  return slug;
}

function ensureGeneralBrand(root) {
  const { dir } = noBrandRuntime.ensure(brandsPath(root));
  assertInsideRoot(root, dir, 'No brand folder');
  return brandRecord(root, dir);
}

export function listBrands({ root, includeGeneral = false }) {
  const workspace = assertLocalWorkspace(root);
  const dir = brandsPath(workspace.root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(dir, entry.name))
    .filter((entry) => existsSync(join(entry, 'workspace.json')))
    .map((entry) => brandRecord(workspace.root, entry))
    .filter((entry) => includeGeneral || !entry.general)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function brandTemplate(slug, name, options = {}) {
  const created = now().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    brandId: options.brandId || randomUUID(),
    brand: slug,
    name,
    status: 'active',
    onboarding: { status: 'required' },
    ownershipStatus: options.ownerUserId ? 'bound' : 'unbound',
    // Stays unset unless a person gives one. The brand's zone follows its target market, which
    // is not known yet at creation (see brandTimeZone in lib-brand-profile.js).
    timezone: options.timezone || null,
    // Marks a zone a person chose, so it is never mistaken for the pre-0.7.5 Asia/Manila default.
    ...(options.timezone ? { timezoneSource: 'set' } : {}),
    approver: options.approver || null,
    ownerUserId: options.ownerUserId || null,
    ownerEmail: options.ownerEmail || null,
    created,
    accounts: {
      facebook: { handle: null, pageId: null, url: null, state: 'unknown', notes: '' },
      instagram: { handle: null, url: null, state: 'unknown', notes: 'Must be a Business or Creator account linked to the Facebook Page.' },
      tiktok: { handle: null, url: null, state: 'unknown', notes: 'Hand-off in v1. Generated video must be disclosed as AI-made on the post.' },
    },
    cadence: { facebook: null, instagram: null, tiktok: null },
    brandFilesReviewed: false,
    brandFiles: { 'brand-voice': 1, audience: 1, positioning: 1, 'platform-playbook': 1 },
    policies: {
      namedTestimonials: 'paraphrase_only_until_permission_confirmed',
      syntheticPeopleDisclosure: 'always',
    },
  };
}

function copyBrandTemplates(root, dest, slug, name) {
  const templateDir = join(PIPELINE_ROOT, 'templates', 'brand');
  const brandDest = safePath(root, relative(root, join(dest, 'brand')));
  mkdirSync(brandDest, { recursive: true });
  for (const stem of ['audience', 'positioning', 'platform-playbook']) {
    const source = join(templateDir, `${stem}.md`);
    if (!existsSync(source)) continue;
    const text = readFileSync(source, 'utf8')
      .replaceAll('{brand}', slug)
      .replaceAll('{Brand Name}', name)
      .replaceAll('YYYY-MM-DD', now().slice(0, 10));
    writeFileSync(join(brandDest, `${stem}.md`), text, 'utf8');
  }
  brandVoiceRuntime.write(dest, { name });
}

function refreshBrandVoice(brandDir) {
  return brandVoiceRuntime.write(brandDir);
}

export function writeBrandVoice(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const brand = assertRealBrand(resolveBrand(root, options.brandId || options.brand || options.brandSlug));
  return refreshBrandVoice(brand.path);
}

/**
 * Save the declared brand profile through the vendored validator and persist a
 * durable onboarding marker.  Account URLs are profile references only; they
 * do not authenticate publishing or cloud sync.
 */
function completeBrandOnboardingUnlocked(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const brand = assertRealBrand(resolveBrand(root, options.brandId || options.brand || options.brandSlug));
  const profileInput = options.profile && typeof options.profile === 'object'
    ? jsonClone(options.profile)
    : Object.fromEntries([
      'website', 'facebook', 'instagram', 'tiktok', 'competitors', 'market', 'audience',
      'palette', 'fonts', 'voice', 'strategy', 'contentPillars', 'assets', 'sourceRefs',
      'geography', 'targetMarket', 'language', 'customerSegment', 'voiceGuidance', 'terminology',
      'examples', 'forbiddenClaims',
    ].filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
  if (profileInput.channels && typeof profileInput.channels === 'object') {
    profileInput.channels = jsonClone(profileInput.channels);
  }
  if (profileInput.provenance !== undefined
    && (!profileInput.provenance || typeof profileInput.provenance !== 'object' || Array.isArray(profileInput.provenance))) {
    throw new Error('Brand provenance must be an object.');
  }
  if (options.requestId) {
    profileInput.provenance = {
      ...(profileInput.provenance || {}),
      onboardingRequestId: toText(options.requestId).trim(),
    };
  }
  const existingProfile = brandProfileRuntime.read(brand.path);
  const profileValidation = brandProfileRuntime.validateComplete(profileInput, existingProfile);
  if (!profileValidation.valid) {
    throw new Error(`Complete the brand profile before saving it: ${profileValidation.errors.join(' ')}`);
  }
  const profile = brandProfileRuntime.save(brand.path, profileInput, { requireChannels: true, acknowledgeSuggestions: true });
  const file = join(brand.path, 'workspace.json');
  const workspace = readJson(file, {});
  const onboarding = {
    status: 'complete',
    profileRevision: Number(profile.revision || 1),
    completedAt: profile.completedAt || now(),
    reviewStatus: options.reviewStatus || 'pending',
    ...(options.requestId ? { requestId: toText(options.requestId).trim() } : {}),
  };
  writeJsonAtomic(file, {
    ...workspace,
    onboarding,
    brandFilesReviewed: Boolean(options.brandFilesReviewed ?? workspace.brandFilesReviewed),
    updatedAt: now(),
  });
  return {
    brand: brandRecord(root, brand.path),
    onboarding,
    profile,
    created: true,
  };
}

export function completeBrandOnboarding(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const release = acquireRequestLock(root);
  try {
    const completed = completeBrandOnboardingUnlocked({ ...options, root });
    refreshBrandVoice(completed.brand.path);
    return completed;
  } finally {
    release();
  }
}

function createBrandUnlocked(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const prior = requestLookup(root, 'brand', options.requestId);
  if (prior?.brandId) {
    const existing = listBrands({ root }).find((brand) => brand.id === prior.brandId || brand.brandId === prior.brandId);
    if (!existing) throw new Error(`Brand request ${options.requestId} points to a missing brand.`);
    return { brand: existing, created: false, idempotent: true, requestId: options.requestId || null };
  }
  const name = toText(options.name || options.slug).trim();
  if (!name) throw new TypeError('A brand needs a name.');
  const slug = assertBrandSlugFree(assertSlug(options.slug || slugify(name), 'Brand slug'));
  const dest = brandPath(root, slug);
  if (existsSync(dest)) throw new Error(`Brand already exists: ${slug}`);
  assertInsideRoot(root, dest, 'Brand destination');
  assertNoReparsePoint(dest, 'Brand destination');
  mkdirSync(join(dest, 'jobs'), { recursive: true });
  mkdirSync(join(root, 'inputs', slug), { recursive: true });
  const record = brandTemplate(slug, name, options);
  writeJsonAtomic(join(dest, 'workspace.json'), record);
  copyBrandTemplates(root, dest, slug, name);
  const brand = brandRecord(root, dest);
  rememberRequest(root, 'brand', options.requestId, { brandId: brand.id, slug });
  return { brand, created: true, idempotent: false, requestId: options.requestId || null };
}

export function createBrand(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const release = acquireRequestLock(root);
  try {
    return createBrandUnlocked({ ...options, root });
  } finally {
    release();
  }
}

/**
 * Validate and persist one complete brand onboarding submission.
 * The request ledger is written before the first brand mutation, so a retry
 * after a partial failure resumes the same draft and never creates a second
 * brand for the same request id.
 */
export function onboardBrand(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const requestId = toText(options.requestId).trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error('A stable onboarding request ID is required.');
  }
  const name = toText(options.name).trim();
  if (!name) throw new TypeError('A brand needs a name.');
  if (!options.profile || typeof options.profile !== 'object' || Array.isArray(options.profile)) {
    throw new TypeError('A complete brand profile is required.');
  }
  const hasKit = options.kit !== undefined;
  const requestedBrand = toText(options.brand).trim();
  if (requestedBrand) assertRealBrand(requestedBrand);
  else assertBrandSlugFree(slugify(name));
  const inputHash = shortHash(JSON.stringify(canonicalize({
    name, brand: requestedBrand || null, profile: options.profile, ...(hasKit ? { kit: options.kit } : {}),
  })), 64);
  const validationProfile = jsonClone(options.profile);
  if (validationProfile.provenance !== undefined
    && (!validationProfile.provenance || typeof validationProfile.provenance !== 'object' || Array.isArray(validationProfile.provenance))) {
    throw new Error('Brand provenance must be an object.');
  }
  validationProfile.provenance = {
    ...(validationProfile.provenance || {}),
    onboardingRequestId: requestId,
  };
  const validation = brandProfileRuntime.validateComplete(validationProfile);
  if (!validation.valid) {
    throw new Error(`Complete all brand fields before submitting: ${validation.errors.join(' ')}`);
  }
  const release = acquireRequestLock(root);
  try {
    const prior = requestLookup(root, 'onboard_brand', requestId);
    if (prior?.inputHash && prior.inputHash !== inputHash) {
      throw new Error('This onboarding request ID was reused with different brand data.');
    }
    if (prior?.status === 'complete' && prior.result) {
      return { ...jsonClone(prior.result), idempotent: true };
    }

    let brand = null;
    let created = false;
    if (prior?.brandId) {
      brand = listBrands({ root }).find((entry) => entry.id === prior.brandId || entry.brandId === prior.brandId) || null;
      if (!brand) throw new Error(`Onboarding request ${requestId} points to a missing brand.`);
    } else if (requestedBrand) {
      brand = assertRealBrand(resolveBrand(root, requestedBrand));
      if (brand.name !== name) throw new Error('An existing brand cannot be renamed during onboarding.');
    } else {
      const slug = assertSlug(slugify(name), 'Brand slug');
      const existingPath = brandPath(root, slug);
      if (existsSync(join(existingPath, 'workspace.json'))) {
        const existing = listBrands({ root }).find((entry) => entry.slug === slug);
        if (!existing) throw new Error(`Brand already exists but cannot be read: ${slug}.`);
        if (existing.name !== name) throw new Error(`Brand already exists: ${slug}`);
        if (existing.onboardingStatus === 'complete') throw new Error(`Brand already exists: ${slug}`);
        brand = existing;
      }
    }

    // wasComplete reflects onboarding state on disk before this call's own mutations: it is what
    // tells a kit apart as a kickoff offer (brand not yet onboarded) versus a confirm/update on an
    // already-onboarded brand (the board's "Save and continue").
    const wasComplete = brand ? brand.onboardingStatus === 'complete' : false;

    let kitNormalized = null;
    if (hasKit) {
      const kitRecord = brand ? brandKitRuntime.read(brand.path) : null;
      const kitValidation = brandKitRuntime.validateKitInput(options.kit, { record: kitRecord });
      if (!kitValidation.ok) {
        throw new Error(`Fix the brand kit before submitting: ${kitValidation.errors.join(' ')}`);
      }
      kitNormalized = kitValidation.normalized;
    }

    const preflightProfile = brand ? brandProfileRuntime.read(brand.path) : null;
    const updateValidation = brandProfileRuntime.validateComplete(validationProfile, preflightProfile);
    if (!updateValidation.valid) {
      throw new Error(`Complete all brand fields before submitting: ${updateValidation.errors.join(' ')}`);
    }

    const started = {
      status: 'started',
      inputHash,
      name,
      slug: brand?.slug || assertSlug(slugify(name), 'Brand slug'),
      brandId: brand?.id || null,
    };
    rememberRequest(root, 'onboard_brand', requestId, started);

    if (!brand) {
      const result = createBrandUnlocked({ root, name });
      brand = result.brand;
      created = true;
      rememberRequest(root, 'onboard_brand', requestId, { ...started, brandId: brand.id, slug: brand.slug });
    }

    if (!wasComplete) {
      brandKitRuntime.ensurePending(brand.path, { now: now() });
    }

    const existingProfile = brandProfileRuntime.read(brand.path);
    const requestAlreadyCompleted = brand.config?.onboarding?.requestId === requestId
      || existingProfile?.provenance?.onboardingRequestId === requestId;
    let completed;
    if (requestAlreadyCompleted && existingProfile) {
      completed = {
        brand: brandRecord(root, brand.path),
        profile: existingProfile,
        onboarding: brandRecord(root, brand.path).onboarding,
      };
    } else if (hasKit && wasComplete) {
      // Confirm/update on an already-onboarded brand ("Save and continue"): fold the kit's
      // palette, fonts and logo asset into the same profile revision as any context-field
      // changes, then commit the kit files, brand-kit.json and Brand marks.
      const kitResult = brandKitRuntime.applyKit(brand.path, kitNormalized, { requestId, by: 'board', now: now() });
      if (kitResult.alreadyApplied) {
        completed = completeBrandOnboardingUnlocked({ root, brand: brand.id, profile: options.profile, requestId });
      } else {
        const profileWithKit = jsonClone(options.profile);
        profileWithKit.palette = kitResult.profilePatch.palette;
        profileWithKit.fonts = kitResult.profilePatch.fonts;
        const otherAssets = (existingProfile?.assets || existingProfile?.brandAssets || []).filter((asset) => asset.kind !== 'logo');
        profileWithKit.assets = kitResult.profilePatch.logoAsset ? [...otherAssets, kitResult.profilePatch.logoAsset] : otherAssets;
        completed = completeBrandOnboardingUnlocked({ root, brand: brand.id, profile: profileWithKit, requestId });
        kitResult.commit();
      }
    } else {
      completed = completeBrandOnboardingUnlocked({ root, brand: brand.id, profile: options.profile, requestId });
      if (hasKit && !wasComplete) {
        // Kickoff offer, before the brand is complete: stash it as `provided` for later review;
        // the kit gate stays pending until an explicit confirm applies it.
        brandKitRuntime.recordProvided(brand.path, kitNormalized, { requestId, now: now() });
      }
    }
    refreshBrandVoice(brand.path);
    if (!wasComplete) {
      try { onboardingRunRuntime.markPending(root, { brandDir: brand.path, now: now() }); } catch { onboardingRunRuntime.clearPending(brand.path); }
    }

    const result = {
      brand: brandRecord(root, brand.path),
      profile: completed.profile,
      onboarding: completed.onboarding,
      created,
      idempotent: false,
    };
    rememberRequest(root, 'onboard_brand', requestId, {
      status: 'complete',
      inputHash,
      name,
      slug: brand.slug,
      brandId: brand.id,
      result,
    });
    return result;
  } finally {
    release();
  }
}

/**
 * Chat-intake confirmation of a brand kit, without the board: same validate-then-commit path as
 * the board's "Save and continue" (a single profile revision, then kit files, brand-kit.json and
 * Brand marks). Idempotent by requestId via lib-brand-kit's own applyKit check.
 */
export function saveBrandKit(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const requestId = toText(options.requestId).trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error('A stable request ID is required.');
  }
  if (!options.kit || typeof options.kit !== 'object' || Array.isArray(options.kit)) {
    throw new TypeError('A brand kit is required.');
  }
  const release = acquireRequestLock(root);
  try {
    const brand = assertRealBrand(resolveBrand(root, options.brandId || options.brand || options.brandSlug));
    const kitRecord = brandKitRuntime.read(brand.path);
    const validation = brandKitRuntime.validateKitInput(options.kit, { record: kitRecord });
    if (!validation.ok) {
      throw new Error(`Fix the brand kit before submitting: ${validation.errors.join(' ')}`);
    }
    const kitResult = brandKitRuntime.applyKit(brand.path, validation.normalized, { requestId, by: 'chat', now: now() });
    if (kitResult.alreadyApplied) {
      return { brand: brandRecord(root, brand.path), idempotent: true };
    }
    const existingProfile = brandProfileRuntime.read(brand.path);
    const otherAssets = (existingProfile?.assets || existingProfile?.brandAssets || []).filter((asset) => asset.kind !== 'logo');
    const profileInput = {
      palette: kitResult.profilePatch.palette,
      fonts: kitResult.profilePatch.fonts,
      assets: kitResult.profilePatch.logoAsset ? [...otherAssets, kitResult.profilePatch.logoAsset] : otherAssets,
    };
    const profile = brandProfileRuntime.save(brand.path, profileInput, {});
    kitResult.commit();
    refreshBrandVoice(brand.path);
    return { brand: brandRecord(root, brand.path), profile, idempotent: false, confirmedBy: options.confirmedBy || null };
  } finally {
    release();
  }
}

function resolveJobRef(root, options = {}) {
  const brand = resolveBrand(root, options.brandId || options.brand || options.brandSlug);
  const value = toText(options.jobId || options.job).trim();
  if (!value) throw new Error('A job id is required.');
  const dir = jobPath(root, brand.slug, value);
  if (!existsSync(join(dir, 'job.json'))) throw new Error(`Job not found: ${value}`);
  return { brand, jobId: value, dir };
}

/** The brand and the job folder of an existing job, for tools that write inside it. */
export function resolveJobDir(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  return { root, brand: brand.slug, jobId, dir };
}

function jobRecord(root, brand, dir) {
  const job = readJson(join(dir, 'job.json'), {});
  const jobId = job.jobId || basename(dir);
  return {
    jobId,
    id: job.jobId || jobId,
    brandId: job.brandId || brand.id,
    brand: brand.slug,
    title: job.title || jobId,
    state: readStatus(dir).state,
    revision: readStatus(dir).revision,
    ownerUserId: job.ownerUserId || null,
    ownerEmail: job.ownerEmail || null,
    ownershipStatus: job.ownershipStatus || (job.ownerUserId ? 'bound' : 'unbound'),
    path: dir,
    job,
  };
}

export function listJobs(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const brand = options.brandId || options.brand || options.brandSlug
    ? resolveBrand(root, options.brandId || options.brand || options.brandSlug)
    : null;
  const brands = brand ? [brand] : listBrands({ root, includeGeneral: true });
  const jobs = [];
  for (const item of brands) {
    const dir = jobsPath(root, item.slug);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const jobFile = join(dir, entry.name, 'job.json');
      if (existsSync(jobFile)) jobs.push(jobRecord(root, item, join(dir, entry.name)));
    }
  }
  return jobs.sort((a, b) => a.jobId.localeCompare(b.jobId));
}

function defaultJobInput(options, jobId, brand) {
  const supplied = options.job && typeof options.job === 'object' ? jsonClone(options.job) : {};
  const brief = toText(options.brief || supplied.request || options.request).trim();
  const job = {
    schemaVersion: SCHEMA_VERSION,
    jobId,
    brand: brand.slug,
    brandId: brand.id,
    workspaceId: options.workspaceId || null,
    title: toText(options.title || supplied.title || brief || jobId).trim() || jobId,
    requestedAt: supplied.requestedAt || now(),
    ownerUserId: options.ownerUserId || supplied.ownerUserId || null,
    ownerEmail: options.ownerEmail || supplied.ownerEmail || null,
    ownershipStatus: (options.ownerUserId || supplied.ownerUserId) ? 'bound' : 'unbound',
    createdAt: now(),
    inputRevision: null,
    inputRevisions: [],
  };
  const scalarFields = ['kind', 'objective', 'distribution', 'subject'];
  for (const field of scalarFields) {
    const value = supplied[field] ?? options[field];
    if (value !== undefined && value !== null && String(value).trim()) job[field] = value;
  }
  const kindReason = kindReasonOf(supplied.kindReason ?? options.kindReason);
  if (kindReason && job.kind) job.kindReason = kindReason;
  const arrayFields = ['deliverables', 'requiredClaims', 'prohibitedClaims'];
  for (const field of arrayFields) {
    const value = supplied[field] ?? options[field];
    if (Array.isArray(value)) job[field] = field === 'deliverables' ? deliverableRuntime.withImpliedRatios(value) : value;
  }
  const platformValues = supplied.platforms ?? options.platforms;
  if (Array.isArray(platformValues)) {
    job.platforms = platformValues.map((value) => toText(value).toLowerCase()).filter(Boolean);
  }
  const objectFields = ['audience', 'evidence'];
  for (const field of objectFields) {
    const value = supplied[field] ?? options[field];
    if (value !== undefined) job[field] = value;
  }
  const nullableFields = ['offer', 'landingPageUrl', 'schedule', 'budget', 'productAsset', 'account'];
  for (const field of nullableFields) {
    const value = supplied[field] ?? options[field];
    if (value !== undefined) job[field] = value;
  }
  if (brief) job.request = brief;
  if (Array.isArray(supplied.sourceRefs) || Array.isArray(options.sourceRefs)) {
    job.sourceRefs = Array.isArray(supplied.sourceRefs) ? supplied.sourceRefs : options.sourceRefs;
  }
  if (supplied.specWork !== undefined || options.specWork !== undefined) {
    job.specWork = Boolean(supplied.specWork ?? options.specWork);
  }
  // A caption the person gave is kept as they typed it, and whether their files were made with AI is their answer.
  const caption = supplied.caption ?? options.caption;
  if (typeof caption === 'string' && caption.trim()) job.caption = caption;
  const aiMade = supplied.aiMade ?? options.aiMade;
  if (typeof aiMade === 'boolean') job.aiMade = aiMade;
  // The words fit more than one pipeline: the job keeps the likeliest kind but waits, unplanned, for the person's answer.
  if ((supplied.pipelineUnsure ?? options.pipelineUnsure) === true && job.kind) job.pipelineUnsure = true;
  return job;
}

function jobSlug(options) {
  return assertSlug(options.jobSlug || slugify(options.title || options.brief || 'job', 'job'), 'Job slug');
}

function makeJobId(options, slug) {
  const stamp = now().slice(0, 10).replaceAll('-', '');
  const request = toText(options.requestId).trim();
  const suffix = request ? shortHash(request, 10) : shortHash(`${randomUUID()}:${slug}`, 10);
  return `job-${stamp}-${slug}-${suffix}`;
}

function statusFromTemplate(jobId, brand, title) {
  const template = join(PIPELINE_ROOT, 'templates', 'status.md');
  if (!existsSync(template)) {
    return `# Job status: ${jobId}\n\n**Brand:** ${brand}\n**Job:** \`${jobId}\`\n**Title:** ${title}\n**Current state:** \`INTAKE_PENDING\`\n**Revision:** \`0\`\n`;
  }
  return readFileSync(template, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('> **When resuming') && !line.startsWith('> Every time carries'))
    .join('\n')
    .replaceAll('{job-id}', jobId)
    .replaceAll('{brand}', brand)
    .replaceAll('{title}', title)
    .replaceAll('YYYY-MM-DD HH:MM', now())
    .replaceAll('{what happens next, in one line}', 'Intake: confirm the request and deliverables')
    .replaceAll('{who or what, or "Nothing"}', 'Nothing')
    .replaceAll('{Current state summary. Live constraints. Open items. Running credit tally.}', 'Job folder created. No intake yet.')
    .replace(/(\*\*Current state:\*\*[^\r\n]*\r?\n)(?!\*\*Revision:)/i, '$1**Revision:** `0`\n');
}

function createJobTree(root, brand, jobId, kind = null) {
  const dir = jobPath(root, brand.slug, jobId);
  if (existsSync(dir)) throw new Error(`Job already exists: ${jobId}`);
  assertInsideRoot(root, dir, 'Job destination');
  assertNoReparsePoint(dir, 'Job destination');
  for (const name of ['research', 'drafts', 'media', 'validation', 'revisions', 'approvals', 'handoff', 'campaign']) {
    mkdirSync(join(dir, name), { recursive: true });
  }
  ensureJobFolders(dir, kind);
  writeFileSync(join(dir, 'events.jsonl'), '', 'utf8');
  return dir;
}

function pipelineScript(name) {
  return join(PIPELINE_ROOT, 'scripts', name);
}

// A busy or slow machine can take a while to start a script, so the limit is generous.
const PIPELINE_SCRIPT_TIMEOUT_MS = 120000;

// Scripts safe to run again after a timeout: they only read, or overwrite one deterministic --out file (route-job.js records state unless --no-record, so only that form).
const REPEATABLE_SCRIPTS = Object.freeze({
  'new-job-guard.js': () => true,
  'route-job.js': (args) => args.includes('--no-record'),
});

// `spawn` is injectable so a test can stand in for the child process.
export function runPipelineScript(name, args, root, spawn = spawnSync) {
  const run = () => spawn(process.execPath, [pipelineScript(name), ...args], {
    cwd: root,
    env: { ...process.env, SOCIAL_PIPELINE_ROOT: root },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: PIPELINE_SCRIPT_TIMEOUT_MS,
  });
  let result = run();
  const repeatable = REPEATABLE_SCRIPTS[name]?.(args) === true;
  if (repeatable && result.error && result.error.code === 'ETIMEDOUT') result = run();
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') throw new Error(`${name} did not finish in time${repeatable ? ', even after a second try' : ''}. The computer may be busy; try again in a moment.`);
    throw new Error(`${name} failed to start: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: toText(result.stdout),
    stderr: toText(result.stderr),
    output: `${toText(result.stdout)}${toText(result.stderr)}`.trim(),
  };
}

function riskFlagsStillOpen(state) {
  if (!state) return false;
  const ids = statesRuntime.ids();
  if (['CHANGES_REQUESTED', 'ESCALATED'].includes(state)) return true;
  const at = ids.indexOf(state);
  return at >= 0 && at < ids.indexOf('CONTENT_APPROVED');
}

function refreshRiskFlags(root, brand, jobId) {
  const dir = jobPath(root, brand.slug, jobId);
  const routeFile = join(dir, 'route.json');
  const current = readJson(routeFile);
  if (!current || !Array.isArray(current.riskFlags)) return null;
  const scratch = join(dir, `.route-refresh-${process.pid}.json`);
  try {
    runPipelineScript('route-job.js', [
      join(dir, 'job.json'), '--out', scratch, '--config', join(PIPELINE_ROOT, 'CONFIG.md'), '--root', root, '--no-record',
    ], root);
    const fresh = readJson(scratch);
    if (!fresh || !Array.isArray(fresh.riskFlags)) return null;
    const merged = [...new Set([...current.riskFlags, ...fresh.riskFlags])];
    if (merged.length === current.riskFlags.length) return current;
    const next = { ...current, riskFlags: merged };
    writeJsonAtomic(routeFile, next);
    return next;
  } finally {
    if (existsSync(scratch)) unlinkSync(scratch);
  }
}

function runRouteAndPlan(root, brand, jobId, { allowBlocked = true } = {}) {
  const dir = jobPath(root, brand.slug, jobId);
  const jobFile = join(dir, 'job.json');
  // A job made from words that fit more than one pipeline is held at intake until the person's answer sets the kind
  // (applyIntakePatch clears the flag then): it is not routed, planned or started, whatever the likeliest pipeline needs.
  if (readJson(jobFile, {})?.pipelineUnsure === true) return { route: null, routeRun: null, plan: null, held: true };
  const routeFile = join(dir, 'route.json');
  const planFile = join(dir, 'plan.md');
  const contractsFile = join(dir, 'task-contracts.json');
  const routeRun = runPipelineScript('route-job.js', [
    jobFile, '--out', routeFile, '--config', join(PIPELINE_ROOT, 'CONFIG.md'), '--root', root,
  ], root);
  const route = readJson(routeFile);
  if (!route) throw new Error(`route-job.js did not write ${routeFile}: ${routeRun.output}`);
  if (route.status === 'ROUTED') {
    const planRun = runPipelineScript('plan-job.js', [
      routeFile, '--job', jobFile, '--out', planFile, '--contracts-out', contractsFile, '--root', root,
    ], root);
    if (planRun.status !== 0 || !existsSync(planFile)) {
      throw new Error(`plan-job.js failed for ${jobId}: ${planRun.output}`);
    }
  } else if (!allowBlocked && route.status !== 'ROUTED') {
    throw new Error(`The job route is ${route.status}. ${route.rationale?.join(' ') || ''}`.trim());
  }
  const planWritten = existsSync(planFile);
  updateJobRecord(dir, {
    planBasis: planWritten
      ? {
        brandProfileRevision: brandProfileRuntime.read(brand.path)?.revision ?? null,
        researchRevision: readJson(join(brand.path, 'brand', 'research.json'))?.revision ?? null,
        plannedAt: now(),
      }
      : null,
  });
  return { route, routeRun, plan: planWritten ? readFileSync(planFile, 'utf8') : null };
}

function inferMediaType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.avi'].includes(extension)) return 'video';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(extension)) return 'image';
  if (['.doc', '.docx', '.pdf', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.md', '.csv'].includes(extension)) return 'document';
  return 'document';
}

function walkInput(sourcePath, sourceRoot, files, unreadable, skipped) {
  let info;
  try { info = lstatSync(sourcePath); }
  catch (error) { unreadable.push({ path: sourcePath, reason: error.message }); return; }
  if (info.isSymbolicLink()) {
    unreadable.push({ path: sourcePath, reason: 'symbolic links and junctions are not imported' });
    return;
  }
  let real;
  try { real = realpathSync(sourcePath); }
  catch (error) { unreadable.push({ path: sourcePath, reason: error.message }); return; }
  if (!pathInside(sourceRoot, real, true)) {
    unreadable.push({ path: sourcePath, reason: 'resolved path leaves the selected source folder' });
    return;
  }
  if (info.isDirectory()) {
    let entries;
    try { entries = readdirSync(sourcePath, { withFileTypes: true }); }
    catch (error) { unreadable.push({ path: sourcePath, reason: error.message }); return; }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const child = join(sourcePath, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push({ path: forward(relative(sourceRoot, child)), reason: 'symbolic link or junction' });
        continue;
      }
      walkInput(child, sourceRoot, files, unreadable, skipped);
    }
    return;
  }
  if (!info.isFile()) {
    skipped.push({ path: forward(relative(sourceRoot, sourcePath)), reason: 'unsupported filesystem entry' });
    return;
  }
  const relativePath = forward(relative(sourceRoot, sourcePath));
  if (!relativePath || relativePath.startsWith('../') || relativePath === '..') {
    unreadable.push({ path: sourcePath, reason: 'could not derive a safe relative path' });
    return;
  }
  files.push({ abs: sourcePath, relativePath, bytes: info.size });
}

function existingInputRevisions(root, brand, jobId) {
  const base = inputsPath(root, brand, jobId);
  if (!existsSync(base)) return [];
  const revisionsDir = join(base, 'revisions');
  if (!existsSync(revisionsDir)) return [];
  return readdirSync(revisionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(revisionsDir, entry.name, 'manifest.json')))
    .map((entry) => readJson(join(revisionsDir, entry.name, 'manifest.json')))
    .filter(Boolean)
    .sort((a, b) => toText(a.importedAt).localeCompare(toText(b.importedAt)));
}

function updateJobRecord(dir, update) {
  const file = join(dir, 'job.json');
  const current = readJson(file, {});
  writeJsonAtomic(file, { ...current, ...update });
  return readJson(file, {});
}

function updateManifestIndex(root, brand, jobId, manifest) {
  const base = inputsPath(root, brand, jobId);
  const old = readJson(join(base, 'manifest.json'), { schemaVersion: SCHEMA_VERSION, revisions: [] });
  const revisions = Array.isArray(old.revisions) ? old.revisions : [];
  const row = {
    revisionId: manifest.revisionId,
    importedAt: manifest.importedAt,
    fileCount: manifest.files.length,
    unreadableCount: manifest.unreadable.length,
    manifestPath: forward(relative(root, join(base, 'revisions', manifest.revisionId, 'manifest.json'))),
  };
  const next = revisions.some((item) => item.revisionId === row.revisionId)
    ? revisions.map((item) => item.revisionId === row.revisionId ? row : item)
    : [...revisions, row];
  writeJsonAtomic(join(base, 'manifest.json'), {
    schemaVersion: SCHEMA_VERSION,
    brand,
    jobId,
    currentRevisionId: manifest.revisionId,
    revisions: next,
    updatedAt: now(),
  });
}

/**
 * Copy selected local files into an immutable input revision.
 * Originals are only read.  Source folders may not overlap the workspace root.
 */
export function importLocalInputs(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  const selected = Array.isArray(options.sourcePaths)
    ? options.sourcePaths.map((item) => (item && typeof item === 'object' ? item.path : item)).filter(Boolean)
    : (options.sourcePath ? [options.sourcePath] : []);
  if (!selected.length) throw new TypeError('At least one local input file or folder is required.');

  const revisionId = options.revisionId ? assertSlug(options.revisionId, 'Input revision id') : `rev-${randomUUID()}`;
  const base = inputsPath(root, brand.slug, jobId);
  const revisionDir = join(base, 'revisions', revisionId);
  assertInsideRoot(root, revisionDir, 'Input revision destination');
  if (existsSync(revisionDir)) throw new Error(`Input revision already exists: ${revisionId}`);
  mkdirSync(join(revisionDir, 'files'), { recursive: true });

  const files = [];
  const unreadable = [];
  const skipped = [];
  const sourceRecords = [];
  for (const input of selected) {
    const source = assertAbsoluteRoot(input);
    if (!existsSync(source)) {
      unreadable.push({ path: source, reason: 'source does not exist' });
      continue;
    }
    assertNoInputOverlap(root, source, 'Selected input');
    assertNoReparsePoint(source, 'Selected input');
    const sourceRoot = realPathIfExists(source);
    sourceRecords.push(forward(source));
    if (lstatSync(source).isDirectory()) {
      walkInput(source, sourceRoot, files, unreadable, skipped);
    } else {
      const parent = dirname(source);
      walkInput(source, realPathIfExists(parent), files, unreadable, skipped);
    }
  }
  if (!files.length) {
    // Keep no partial revision on a wholly unreadable selection.
    removeTree(revisionDir);
    throw new Error('No readable files were found in the selected local inputs.');
  }

  const copiedNames = new Set();
  const manifestFiles = [];
  for (const item of files) {
    let relativePath = item.relativePath.replace(/^\/+/, '');
    if (copiedNames.has(relativePath)) {
      relativePath = `source-${shortHash(item.abs, 6)}/${relativePath}`;
    }
    copiedNames.add(relativePath);
    const destination = safePath(revisionDir, 'files', relativePath);
    assertNoReparsePoint(destination, 'Input destination');
    mkdirSync(dirname(destination), { recursive: true });
    try {
      copyFileSync(item.abs, destination);
      const bytes = readFileSync(destination);
      manifestFiles.push({
        path: forward(join('files', relativePath)),
        sourcePath: forward(item.abs),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mediaType: inferMediaType(relativePath),
      });
    } catch (error) {
      unreadable.push({ path: forward(item.abs), reason: `copy failed: ${error.message}` });
    }
  }
  if (!manifestFiles.length) {
    removeTree(revisionDir);
    throw new Error('The selected files could not be copied into the workspace.');
  }

  const previous = existingInputRevisions(root, brand.slug, jobId).at(-1) || null;
  const importedAt = now();
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    revisionId,
    brandId: brand.id,
    brand: brand.slug,
    jobId,
    route: 'local',
    importedAt,
    sourcePaths: sourceRecords,
    previousRevisionId: previous?.revisionId || null,
    files: manifestFiles,
    unreadable,
    skipped,
    counts: {
      files: manifestFiles.length,
      unreadable: unreadable.length,
      skipped: skipped.length,
    },
  };
  writeJsonAtomic(join(revisionDir, 'manifest.json'), manifest);
  updateManifestIndex(root, brand.slug, jobId, manifest);

  const logicalRefs = manifestFiles.map((item) => ({
    uri: forward(relative(dir, join(revisionDir, item.path))),
    title: basename(item.path),
    mediaType: item.mediaType,
    ownedByBrand: options.ownedByBrand === true,
    usedInPost: options.usedInPost === true,
    suppliedBy: 'user',
    inputRevision: revisionId,
  }));
  const currentJob = readJson(join(dir, 'job.json'), {});
  const oldRefs = Array.isArray(currentJob.sourceRefs) ? currentJob.sourceRefs : [];
  const known = new Set(oldRefs.map((item) => `${item?.uri || ''}:${item?.inputRevision || ''}`));
  const nextRefs = [...oldRefs];
  for (const ref of logicalRefs) if (!known.has(`${ref.uri}:${ref.inputRevision}`)) nextRefs.push(ref);
  const job = updateJobRecord(dir, {
    sourceRefs: nextRefs,
    inputRevision: revisionId,
    inputRevisions: [...(Array.isArray(currentJob.inputRevisions) ? currentJob.inputRevisions : []), {
      revisionId, manifestPath: forward(relative(root, join(revisionDir, 'manifest.json'))), importedAt,
    }],
    updatedAt: importedAt,
  });
  const shouldReroute = ['INTAKE_PENDING', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'BLOCKED'].includes(readStatus(dir).state);
  let routed = null;
  if (shouldReroute && options.reroute !== false) routed = runRouteAndPlan(root, brand, jobId, { allowBlocked: true });
  else if (!shouldReroute && options.reroute !== false && riskFlagsStillOpen(readStatus(dir).state)) {
    try { refreshRiskFlags(root, brand, jobId); } catch {}
  }
  return {
    revisionId,
    manifest,
    manifestPath: join(revisionDir, 'manifest.json'),
    job,
    route: routed?.route || readJson(join(dir, 'route.json')),
    plan: routed?.plan || (existsSync(join(dir, 'plan.md')) ? readFileSync(join(dir, 'plan.md'), 'utf8') : null),
  };
}

function removeTree(target) {
  if (!existsSync(target)) return;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(target, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeTree(child);
    else unlinkSync(child);
  }
  try { require('node:fs').rmdirSync(target); } catch { /* best effort cleanup */ }
}

function requestedKind(options) {
  const supplied = options.job && typeof options.job === 'object' ? options.job.kind : undefined;
  const value = supplied ?? options.kind;
  if (value === undefined || value === null || !toText(value).trim()) return null;
  return jobKindOf(value) || toText(value).trim();
}

function brandForJob(root, options, kind) {
  const value = options.brandId || options.brand || options.brandSlug;
  const general = !value || isGeneralBrand(toText(value));
  if (general && !kindsRuntime.brandRequired(kind)) return { brand: null, general: true };
  if (general) {
    const error = new Error('A post or campaign needs a brand. Choose one, or onboard a new one.');
    error.code = 'BRAND_REQUIRED';
    throw error;
  }
  const brand = resolveBrand(root, value);
  if (brand.general) {
    if (!kindsRuntime.brandRequired(kind)) return { brand, general: true };
    const error = new Error('A post or campaign needs a brand. Choose one, or onboard a new one.');
    error.code = 'BRAND_REQUIRED';
    throw error;
  }
  if (!kindsRuntime.brandRequired(kind)) return { brand, general: false };
  if (brand.onboardingStatus !== 'complete') {
    const error = new Error(`Complete brand onboarding before starting a job for ${brand.name}.`);
    error.code = 'BRAND_ONBOARDING_REQUIRED';
    error.brandId = brand.id;
    throw error;
  }
  if (brand.kitStatus === 'pending') {
    const error = new Error(`Review the logo, colours and fonts for ${brand.name} on the board and click Save and continue before starting a job.`);
    error.code = 'BRAND_KIT_REVIEW_REQUIRED';
    error.brandId = brand.id;
    throw error;
  }
  return { brand, general: false };
}

/** What a placed file is, without where it came from or its hash: for answers shown to the model and the person. */
const suppliedSummary = (entry) => ({ path: entry.path, kind: entry.kind, bytes: entry.bytes, width: entry.width, height: entry.height, durationSeconds: entry.durationSeconds });

/**
 * Copy, measure and record a person's own files on a publish_post job and write its posts (supplied-media.mjs). The
 * files are added after the ones already there, or take their place with `replace`. The posts are written again from
 * the job when the files are replaced or `rewritePosts` is set (an intake edit); otherwise a caption already in a post
 * stays. job.json is written here and nothing is routed: the caller does that.
 */
function placeSuppliedFiles({ root, brand, dir, files = [], replace = false, rewritePosts = replace, probe = undefined }) {
  const current = readJson(join(dir, 'job.json'), {});
  const placed = addSuppliedMedia({ root, brand, jobDir: dir, job: current, files, replace, ...(typeof probe === 'function' ? { probe } : {}) });
  const patch = { ...placed.patch };
  if (patch.deliverables) patch.deliverables = deliverableRuntime.withImpliedRatios(patch.deliverables);
  const job = updateJobRecord(dir, { ...patch, updatedAt: now() });
  const posts = writeSuppliedPosts({ jobDir: dir, brandDir: brand.path, job, deliverables: Array.isArray(job.deliverables) ? job.deliverables : [], files: Array.isArray(job.suppliedMedia) ? job.suppliedMedia : [], replace: rewritePosts });
  return { ...placed, job, posts };
}

export function createJob(options = {}) {
  const { root, config } = assertLocalWorkspace(options.root);
  const kind = requestedKind(options);
  if (Array.isArray(options.files) && options.files.length && !kindsRuntime.suppliesMedia(kind)) {
    throw new Error('Files can only be given for a post made from pictures or video you already have.');
  }
  const chosen = brandForJob(root, options, kind);
  const release = acquireRequestLock(root);
  try {
    const brand = chosen.brand || ensureGeneralBrand(root);
    const prior = requestLookup(root, 'job', options.requestId);
    if (prior?.jobId) {
      const existing = listJobs({ root, brandId: prior.brandId || brand.id }).find((job) => job.jobId === prior.jobId);
      if (!existing) throw new Error(`Job request ${options.requestId} points to a missing job.`);
      return { jobId: existing.jobId, brand: existing.brand, jobDir: existing.path, snapshot: readJobSnapshot({ root, brand: existing.brand, jobId: existing.jobId }), created: false, idempotent: true };
    }
    const guard = runPipelineScript('new-job-guard.js', [brand.slug, ...(kind ? ['--kind', kind] : []), '--root', root], root);
    if (guard.status !== 0) {
      const error = new Error(guard.output || `The new-job guard refused a job for ${brand.slug}.`);
      error.code = 'NEW_JOB_GUARD_REFUSED';
      throw error;
    }
    const slug = jobSlug(options);
    const jobId = makeJobId(options, slug);
    const dir = createJobTree(root, brand, jobId, kind);
    const job = defaultJobInput({ ...options, workspaceId: config.workspaceId }, jobId, brand);
    if (kind) job.kind = kind;
    // A post made from files the person already has: say what it is in their words when they gave no brief.
    if (kindsRuntime.suppliesMedia(kind) && !job.request) job.request = `Post ${job.title} as it is.`;
    writeJsonAtomic(join(dir, 'job.json'), job);
    writeFileSync(join(dir, 'status.md'), statusFromTemplate(jobId, brand.slug, job.title), 'utf8');
    if (Array.isArray(options.sourcePaths) && options.sourcePaths.length) {
      importLocalInputs({ ...options, root, brandId: brand.id, jobId, reroute: false });
    }
    // The files are copied, measured and turned into posts before routing, so the router sees what the job really is.
    // A refusal here leaves no half-made job behind.
    let supplied = null;
    if (kindsRuntime.suppliesMedia(kind)) {
      try {
        supplied = placeSuppliedFiles({ root, brand, dir, files: Array.isArray(options.files) ? options.files : [], probe: options.probe });
      } catch (error) {
        removeTree(dir);
        throw error;
      }
    }
    const routed = runRouteAndPlan(root, brand, jobId, { allowBlocked: true });
    rememberRequest(root, 'job', options.requestId, { jobId, brandId: brand.id, slug });
    return {
      jobId,
      brand: brand.slug,
      jobDir: dir,
      job: readJson(join(dir, 'job.json')),
      route: routed.route,
      plan: routed.plan,
      snapshot: readJobSnapshot({ root, brandId: brand.id, jobId }),
      created: true,
      idempotent: false,
      requestId: options.requestId || null,
      ...(supplied ? { supplied: { added: supplied.added.map(suppliedSummary), skipped: supplied.skipped, notes: supplied.notes } } : {}),
    };
  } finally {
    release();
  }
}

function applyIntakePatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('An intake patch object is required.');
  }
  const next = jsonClone(current) || {};
  const seen = new Set();
  for (const [rawKey, value] of Object.entries(patch)) {
    if (!INTAKE_PATCH_FIELDS.has(rawKey)) {
      throw new Error(`The intake field ${rawKey} is not editable.`);
    }
    const field = rawKey === 'brief' ? 'request' : rawKey;
    if (seen.has(field)) throw new Error(`Use either brief or request, not both.`);
    seen.add(field);
    if (field === 'links') {
      const refs = withLinks(current?.sourceRefs, value);
      if (refs.length) next.sourceRefs = refs;
      else delete next.sourceRefs;
      continue;
    }
    if (INTAKE_PATCH_SCALARS.has(field)) {
      if (value === null) {
        delete next[field];
        continue;
      }
      if (typeof value !== 'string') throw new TypeError(`Intake field ${rawKey} must be a string or null.`);
      const text = field === 'kindReason' ? kindReasonOf(value) : value.trim();
      if (field === 'title' && !text) throw new TypeError('A job title cannot be empty.');
      if (field === 'subject' && text && !JOB_SUBJECTS.includes(text)) throw new TypeError('The subject must be product, character or none.');
      if (text) next[field] = text;
      else delete next[field];
      continue;
    }
    if (INTAKE_PATCH_ARRAYS.has(field)) {
      if (value === null) {
        delete next[field];
        continue;
      }
      if (!Array.isArray(value)) throw new TypeError(`Intake field ${rawKey} must be an array or null.`);
      next[field] = jsonClone(value);
      if (field === 'platforms') next[field] = value.map((item) => toText(item).trim().toLowerCase()).filter(Boolean);
      // A Reel, Story or TikTok video with no ratio is written as the 9:16 it is.
      if (field === 'deliverables') next[field] = deliverableRuntime.withImpliedRatios(next[field]);
      continue;
    }
    if (INTAKE_PATCH_OBJECTS.has(field)) {
      if (value === null) {
        delete next[field];
        continue;
      }
      if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Intake field ${rawKey} must be an object or null.`);
      next[field] = jsonClone(value);
      continue;
    }
    if (INTAKE_PATCH_BOOLEANS.has(field)) {
      if (value === null) {
        delete next[field];
        continue;
      }
      if (typeof value !== 'boolean') throw new TypeError(`Intake field ${rawKey} must be a boolean or null.`);
      next[field] = value;
    }
  }
  // The reason belongs to the pipeline it was written for: a new kind with no new reason leaves the old one behind, so it goes.
  if (seen.has('kind') && !seen.has('kindReason') && jobKindOf(next.kind) !== jobKindOf(current?.kind)) delete next.kindReason;
  // Setting the kind is the person's answer to which pipeline they meant, even when it is the one first guessed: the hold ends.
  if (seen.has('kind')) delete next.pipelineUnsure;
  return next;
}

function replaceFileContents(filePath, contents) {
  if (contents === null) {
    if (existsSync(filePath)) unlinkSync(filePath);
    return;
  }
  writeFileSync(filePath, contents, 'utf8');
}

function bumpStatusRevision(statusText, revision) {
  let text = statusText || '';
  const revisionPattern = /(\*\*Revision:\*\*\s*)`?[^`\r\n]*`?/i;
  if (revisionPattern.test(text)) text = text.replace(revisionPattern, `$1\`${revision}\``);
  else text = text.replace(/(\*\*Current state:\*\*[^\r\n]*\r?\n)/i, `$1**Revision:** \`${revision}\`\n`);
  const updatedPattern = /(\*\*Last updated:\*\*\s*)[^`\r\n]*/i;
  if (updatedPattern.test(text)) text = text.replace(updatedPattern, `$1${now()}`);
  return text;
}

/**
 * Update only the unresolved intake fields on a local draft.
 *
 * The expected status revision is required so an old board snapshot cannot
 * overwrite a newer answer, imported input revision, or ownership binding.
 * Job identity, owners, source references, approvals, and input manifests are
 * intentionally outside the patch allowlist.
 */
export function updateJobIntake(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  if (!Number.isSafeInteger(options.expectedRevision)) {
    throw new TypeError('An expected integer job revision is required.');
  }
  const release = acquireRequestLock(root);
  try {
    const status = readStatus(dir);
    if (status.revision !== options.expectedRevision) {
      const error = new Error(`The job changed since this intake was read. Actual revision is ${status.revision}.`);
      error.code = 'INTAKE_REVISION_MISMATCH';
      error.actualRevision = status.revision;
      throw error;
    }
    const routeFile = join(dir, 'route.json');
    const planFile = join(dir, 'plan.md');
    const contractsFile = join(dir, 'task-contracts.json');
    const routeBefore = existsSync(routeFile) ? readFileSync(routeFile, 'utf8') : null;
    const planBefore = existsSync(planFile) ? readFileSync(planFile, 'utf8') : null;
    const contractsBefore = existsSync(contractsFile) ? readFileSync(contractsFile, 'utf8') : null;
    const jobFile = join(dir, 'job.json');
    const jobBefore = readFileSync(jobFile, 'utf8');
    const statusFile = join(dir, 'status.md');
    const statusBefore = existsSync(statusFile) ? readFileSync(statusFile, 'utf8') : null;
    const route = readJson(routeFile, null);
    const intakeState = ['INTAKE_PENDING', 'NEEDS_CLARIFICATION', 'UNSUPPORTED'].includes(status.state);
    const blockedDraft = status.state === 'BLOCKED' && route?.status !== 'ROUTED' && !existsSync(planFile);
    // A publish_post job is planned as soon as it is made, so the person's own answers about their post (its caption and
    // whether the files were made with AI) can still change until the final post is approved. They only rewrite the
    // posts: the plan, the route and the state stay as they are.
    const answersOnly = Object.keys(options.patch || {});
    if (!intakeState && !blockedDraft && answersOnly.length && answersOnly.every(key => key === 'aiMade' || key === 'caption')
      && ['PLANNED', 'DRAFTS_READY', 'VALIDATED', 'CHANGES_REQUESTED'].includes(status.state)) {
      const currentJob = readJson(jobFile, null);
      if (currentJob && kindsRuntime.suppliesMedia(jobKindOf(currentJob.kind))) {
        const nextJob = applyIntakePatch(currentJob, options.patch);
        if (JSON.stringify(nextJob) === JSON.stringify(currentJob)) {
          return { jobId, brand: brand.slug, updated: false, revision: status.revision, snapshot: readJobSnapshot({ root, brandId: brand.id, jobId }) };
        }
        nextJob.updatedAt = now();
        writeJsonAtomic(jobFile, nextJob);
        try {
          placeSuppliedFiles({ root, brand, dir, files: [], rewritePosts: true });
        } catch (error) {
          writeFileSync(jobFile, jobBefore);
          throw error;
        }
        return { jobId, brand: brand.slug, updated: true, revision: status.revision, snapshot: readJobSnapshot({ root, brandId: brand.id, jobId }) };
      }
    }
    if (!intakeState && !blockedDraft) {
      const error = new Error(`Intake can only be updated before execution begins; current state is ${status.state}.`);
      error.code = 'INTAKE_UPDATE_NOT_ALLOWED';
      throw error;
    }
    const patch = options.patch || {};
    const currentJob = readJson(jobFile, null);
    if (!currentJob || typeof currentJob !== 'object') throw new Error(`Job ${jobId} has no readable job record.`);
    const nextJob = applyIntakePatch(currentJob, patch);
    const changed = JSON.stringify(nextJob) !== JSON.stringify(currentJob);
    if (!changed) {
      return { jobId, brand: brand.slug, updated: false, revision: status.revision, snapshot: readJobSnapshot({ root, brandId: brand.id, jobId }) };
    }
    nextJob.jobId = currentJob.jobId;
    nextJob.brand = currentJob.brand;
    nextJob.brandId = currentJob.brandId;
    nextJob.workspaceId = currentJob.workspaceId;
    nextJob.ownerUserId = currentJob.ownerUserId ?? null;
    nextJob.ownerEmail = currentJob.ownerEmail ?? null;
    nextJob.ownershipStatus = currentJob.ownershipStatus || (currentJob.ownerUserId ? 'bound' : 'unbound');
    if (Object.prototype.hasOwnProperty.call(patch, 'links')) {
      if (!nextJob.sourceRefs) delete nextJob.sourceRefs;
    } else if (Object.prototype.hasOwnProperty.call(currentJob, 'sourceRefs')) {
      nextJob.sourceRefs = jsonClone(currentJob.sourceRefs);
    } else {
      delete nextJob.sourceRefs;
    }
    const kindNow = jobKindOf(nextJob.kind);
    if (kindNow) nextJob.kind = kindNow;
    if (Object.prototype.hasOwnProperty.call(currentJob, 'inputRevision')) nextJob.inputRevision = currentJob.inputRevision;
    if (Object.prototype.hasOwnProperty.call(currentJob, 'inputRevisions')) nextJob.inputRevisions = jsonClone(currentJob.inputRevisions);
    nextJob.createdAt = currentJob.createdAt;
    nextJob.updatedAt = now();

    try {
      writeJsonAtomic(jobFile, nextJob);
      ensureJobFolders(dir, nextJob.kind);
      // The posts of a publish_post job carry its caption, platforms, post types, time and AI answer, so an edit to any of
      // them rewrites them from the job (the files stay as they were placed).
      if (kindsRuntime.suppliesMedia(nextJob.kind)) {
        placeSuppliedFiles({ root, brand, dir, files: [], rewritePosts: true });
      }
      // An intake edit invalidates the current draft plan.  The route helper
      // writes a fresh plan only when the edited brief is actually routable.
      if (existsSync(planFile)) unlinkSync(planFile);
      if (existsSync(contractsFile)) unlinkSync(contractsFile);
      if (status.state === 'UNSUPPORTED' || status.state === 'BLOCKED') {
        const reset = runPipelineScript('set-state.js', [
          brand.slug, jobId, 'INTAKE_PENDING', '--by', 'local-intake-update', '--root', root,
        ], root);
        if (reset.status !== 0) throw new Error(`Could not reopen the intake state: ${reset.output}`);
      }
      const routed = runRouteAndPlan(root, brand, jobId, { allowBlocked: true });
      const afterRoute = readStatus(dir);
      const revision = Math.max(afterRoute.revision, status.revision + 1);
      if (afterRoute.revision !== revision) writeFileSync(statusFile, bumpStatusRevision(afterRoute.text, revision), 'utf8');
      const snapshot = readJobSnapshot({ root, brandId: brand.id, jobId });
      return {
        jobId,
        brand: brand.slug,
        job: readJson(jobFile),
        route: routed.route,
        plan: routed.plan,
        revision: snapshot.project.revision,
        updated: true,
        snapshot,
      };
    } catch (error) {
      replaceFileContents(jobFile, jobBefore);
      replaceFileContents(routeFile, routeBefore);
      replaceFileContents(planFile, planBefore);
      replaceFileContents(contractsFile, contractsBefore);
      replaceFileContents(statusFile, statusBefore);
      throw error;
    }
  } finally {
    release();
  }
}

/**
 * Add a person's own pictures or video to a publish_post job that is still being set up, or replace the ones it has
 * (`replace`), then route and plan it again. The files are copied into the job and measured, and its posts are
 * rewritten; the plan, the approvals and the posting plan all come after, so a job past intake refuses.
 * `aiMade` records whether the files were made with AI.
 */
export function addSuppliedFiles(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  const release = acquireRequestLock(root);
  try {
    const status = readStatus(dir);
    const routeFile = join(dir, 'route.json');
    const planFile = join(dir, 'plan.md');
    const contractsFile = join(dir, 'task-contracts.json');
    const route = readJson(routeFile, null);
    const job = readJson(join(dir, 'job.json'), null);
    if (!job || typeof job !== 'object') throw new Error(`Job ${jobId} has no readable job record.`);
    if (!kindsRuntime.suppliesMedia(job.kind)) throw new Error('Files can only be added to a post made from pictures or video you already have.');
    const intakeState = ['INTAKE_PENDING', 'NEEDS_CLARIFICATION', 'UNSUPPORTED'].includes(status.state);
    const blockedDraft = status.state === 'BLOCKED' && route?.status !== 'ROUTED' && !existsSync(planFile);
    if (!intakeState && !blockedDraft) {
      const error = new Error('The files of a post can only change while it is still being set up. To post different files, start a new post.');
      error.code = 'INTAKE_UPDATE_NOT_ALLOWED';
      throw error;
    }
    if (options.aiMade !== undefined && typeof options.aiMade !== 'boolean') throw new TypeError('Say whether the files were made with AI as yes or no.');
    const before = { job: readFileSync(join(dir, 'job.json'), 'utf8'), route: existsSync(routeFile) ? readFileSync(routeFile, 'utf8') : null };
    if (options.aiMade !== undefined) updateJobRecord(dir, { aiMade: options.aiMade });
    let placed;
    try {
      placed = placeSuppliedFiles({ root, brand, dir, files: options.files, replace: options.replace === true, probe: options.probe });
    } catch (error) {
      replaceFileContents(join(dir, 'job.json'), before.job);
      throw error;
    }
    if (existsSync(planFile)) unlinkSync(planFile);
    if (existsSync(contractsFile)) unlinkSync(contractsFile);
    if (status.state === 'UNSUPPORTED' || status.state === 'BLOCKED') {
      const reset = runPipelineScript('set-state.js', [brand.slug, jobId, 'INTAKE_PENDING', '--by', 'local-supplied-files', '--root', root], root);
      if (reset.status !== 0) throw new Error(`Could not reopen the intake state: ${reset.output}`);
    }
    const routed = runRouteAndPlan(root, brand, jobId, { allowBlocked: true });
    const afterRoute = readStatus(dir);
    const revision = Math.max(afterRoute.revision, status.revision + 1);
    if (afterRoute.revision !== revision) writeFileSync(join(dir, 'status.md'), bumpStatusRevision(afterRoute.text, revision), 'utf8');
    const snapshot = readJobSnapshot({ root, brandId: brand.id, jobId });
    return {
      jobId,
      brand: brand.slug,
      suppliedMedia: placed.suppliedMedia.map(suppliedSummary),
      added: placed.added.map(suppliedSummary),
      skipped: placed.skipped,
      notes: placed.notes,
      deliverables: placed.job.deliverables || [],
      platforms: placed.job.platforms || [],
      route: routed.route,
      plan: routed.plan,
      revision: snapshot.project.revision,
      snapshot,
    };
  } finally {
    release();
  }
}

/** A name with nothing in it that could climb out of the folder it is going
 * into, stamped so a second photo for the same brand never lands on the
 * first one. Mirrors pipeline/scripts/land-photo.js's own naming. */
function stampedPhotoName(extension) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `product-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extension}`;
}

/**
 * Copy a product photo into the brand's own inputs (`<root>/inputs/{brand}/`,
 * beside `workspaces/`, the same place pipeline/scripts/land-photo.js lands
 * one fetched from a URL), validated by magic bytes rather than the caller's
 * claim, and record it on the job as `productAsset` so router rule 6c
 * (route-job.js) is satisfied. Reroutes and replans exactly as
 * updateJobIntake does, with the same rollback on failure.
 *
 * The bytes come from an absolute local `path` (the board-sync skill's own
 * transit pattern: download the asset-store upload, or decode a base64
 * fallback, to a local file first, then pass that path here) or, for the
 * local board's own direct call, `dataBase64` straight from the request.
 * `expectedRevision`, when given, guards a board request the same way
 * updateJobIntake's does; the plain MCP tool omits it.
 */
export function attachProductPhoto(options = {}) {
  return attachPhoto(options, '');
}

/**
 * The website finder's own entry: a photo read from the brand's official website is recorded as
 * such, and is the brand's. It takes the page address as an argument, not an option, and no tool
 * or board request calls it, so a caller cannot claim it through attachProductPhoto's options.
 */
export function attachOfficialProductPhoto(options = {}, officialSourceUrl = '') {
  const url = toText(officialSourceUrl).trim();
  if (!url) throw new Error('An official website photo needs the address it was read from.');
  return attachPhoto(options, url);
}

function attachPhoto(options, officialSourceUrl) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  const source = officialSourceUrl ? 'official-website' : toText(options.source).trim() || 'uploaded';
  if (!officialSourceUrl && !PHOTO_SOURCES.has(source)) throw new Error('Say where the photo came from: uploaded, found-online or made.');
  const filePath = toText(options.path).trim();
  let buffer;
  if (filePath) {
    if (!isAbsolute(filePath)) throw new Error('A product photo file path must be absolute.');
    try { buffer = readFileSync(filePath); }
    catch { throw new Error('The product photo could not be read.'); }
  } else if (options.dataBase64 !== undefined) {
    try { buffer = Buffer.from(String(options.dataBase64 || ''), 'base64'); }
    catch { buffer = Buffer.alloc(0); }
  } else {
    throw new Error('A product photo file is required.');
  }
  if (!buffer.length || buffer.length > PHOTO_MAX_BYTES) throw new Error('The product photo must be a non-empty file of at most 20 MiB.');
  const info = brandKitRuntime.imageInfo(buffer);
  if (!info) throw new Error('The product photo must be a PNG, JPEG or WebP file.');
  const extension = PHOTO_EXT[info.mimeType];

  const release = acquireRequestLock(root);
  try {
    const statusBefore = readStatus(dir);
    if (Number.isSafeInteger(options.expectedRevision) && statusBefore.revision !== options.expectedRevision) {
      const error = new Error(`The job changed since this was read. Actual revision is ${statusBefore.revision}.`);
      error.code = 'INTAKE_REVISION_MISMATCH';
      error.actualRevision = statusBefore.revision;
      throw error;
    }
    const inputsBrandDir = join(root, 'inputs', brand.slug);
    const destAbs = assertInsideRoot(root, join(inputsBrandDir, stampedPhotoName(extension)), 'Product photo destination');
    mkdirSync(inputsBrandDir, { recursive: true });
    writeFileSync(destAbs, buffer);
    const relativePath = forward(relative(root, destAbs));

    const jobFile = join(dir, 'job.json');
    const routeFile = join(dir, 'route.json');
    const planFile = join(dir, 'plan.md');
    const contractsFile = join(dir, 'task-contracts.json');
    const statusFile = join(dir, 'status.md');
    const jobBefore = readFileSync(jobFile, 'utf8');
    const routeBefore = existsSync(routeFile) ? readFileSync(routeFile, 'utf8') : null;
    const planBefore = existsSync(planFile) ? readFileSync(planFile, 'utf8') : null;
    const contractsBefore = existsSync(contractsFile) ? readFileSync(contractsFile, 'utf8') : null;
    const statusTextBefore = existsSync(statusFile) ? readFileSync(statusFile, 'utf8') : null;
    const currentJob = readJson(jobFile, null);
    if (!currentJob || typeof currentJob !== 'object') throw new Error(`Job ${jobId} has no readable job record.`);
    const nextJob = jsonClone(currentJob);
    // A picture of a person or character that someone uploaded is not assumed to be the brand's
    // to use (C5, as for any import); the person can say it is with ownedByBrand: true. A product
    // photo the person supplied, or one made for the brand, is the brand's. Found online never is.
    const uploadedCharacter = source === 'uploaded' && nextJob.subject === 'character';
    const ownedByBrand = typeof options.ownedByBrand === 'boolean'
      ? options.ownedByBrand && source !== 'found-online'
      : source !== 'found-online' && !uploadedCharacter;
    nextJob.productAsset = {
      path: relativePath,
      source,
      ...(officialSourceUrl ? { sourceUrl: officialSourceUrl } : {}),
      ownedByBrand,
      licence: officialSourceUrl ? "from the brand's official website"
        : uploadedCharacter && !ownedByBrand ? 'supplied for this job, rights not confirmed'
        : uploadedCharacter ? 'supplied by the brand, rights confirmed by the person'
        : PHOTO_LICENCE[source],
    };
    nextJob.updatedAt = now();
    try {
      writeJsonAtomic(jobFile, nextJob);
      if (existsSync(planFile)) unlinkSync(planFile);
      if (existsSync(contractsFile)) unlinkSync(contractsFile);
      if (statusBefore.state === 'UNSUPPORTED' || statusBefore.state === 'BLOCKED') {
        const reset = runPipelineScript('set-state.js', [
          brand.slug, jobId, 'INTAKE_PENDING', '--by', 'local-photo-attach', '--root', root,
        ], root);
        if (reset.status !== 0) throw new Error(`Could not reopen the intake state: ${reset.output}`);
      }
      const routed = runRouteAndPlan(root, brand, jobId, { allowBlocked: true });
      const afterRoute = readStatus(dir);
      const revision = Math.max(afterRoute.revision, statusBefore.revision + 1);
      if (afterRoute.revision !== revision) writeFileSync(statusFile, bumpStatusRevision(afterRoute.text, revision), 'utf8');
      const snapshot = readJobSnapshot({ root, brandId: brand.id, jobId });
      return {
        jobId,
        brand: brand.slug,
        path: relativePath,
        job: readJson(jobFile),
        route: routed.route,
        plan: routed.plan,
        revision: snapshot.project.revision,
        snapshot,
      };
    } catch (error) {
      replaceFileContents(jobFile, jobBefore);
      replaceFileContents(routeFile, routeBefore);
      replaceFileContents(planFile, planBefore);
      replaceFileContents(contractsFile, contractsBefore);
      replaceFileContents(statusFile, statusTextBefore);
      throw error;
    }
  } finally {
    release();
  }
}

function readStatus(dir) {
  const file = join(dir, 'status.md');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const find = (name) => text.match(new RegExp('\\*\\*' + name + ':\\*\\*\\s*`?([^`\\r\\n]*)`?', 'i'))?.[1]?.trim() || null;
  const revision = Number(find('Revision'));
  return {
    state: find('Current state') || 'UNKNOWN',
    revision: Number.isSafeInteger(revision) ? revision : 0,
    nextAction: find('Next action'),
    blockedOn: find('Blocked on'),
    updatedAt: find('Last updated'),
    text,
  };
}

function parsePlan(planText) {
  if (!planText) return [];
  const rows = [];
  let header = null;
  for (const line of planText.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (!header) {
      if (cells.includes('Stage') && cells.includes('State after')) header = cells;
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index] || ''; });
    if (row.Stage) rows.push(row);
  }
  return rows;
}

// Sentence case, never Title Case Every Word: "shaping-the-idea" reads as "Shaping the idea",
// not "Shaping The Idea".
function gatheringLabel(workflowId) {
  return stagesRuntime.forState('RESEARCH_RUNNING', workflowId)?.substep || 'Gathering';
}

function stageLabel(stageId, workflowId = null) {
  if (stageId === 'gathering' && stagesRuntime.isReportWorkflow(workflowId)) return gatheringLabel(workflowId);
  const text = String(stageId).split('-').join(' ');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

const GATE_NAMES = Object.freeze({
  concept: 'Concept', storyboard: 'Storyboard', price: 'Price', sample: 'Sample', pictures: 'Pictures', clips: 'Video clips', cut: 'Check the joined video', finishing: 'Finishing choice', content: 'Final post', publish: 'Posting plan',
  campaign_proposal: 'Campaign plan', campaign_activation: 'Going live', findings: 'Report',
});
const OFF_FLOW_STATES = new Set(['CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'COMPLETE', 'CANCELLED']);

function isoTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  const zone = local?.[4] ? (local[4] === 'Z' || local[4].includes(':') ? local[4] : `${local[4].slice(0, 3)}:${local[4].slice(3)}`) : '';
  const ms = Date.parse(local ? `${local[1]}T${local[2]}${local[3] || ':00'}${zone}` : text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// The status stage log as [{ state, at }] in log order: the "To" column and its time. Only the board's step history reads it.
function loggedTimes(statusText) {
  const out = [];
  for (const line of String(statusText || '').split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5 || !/^\d{4}-\d{2}-\d{2}T/.test(cells[1])) continue;
    const state = cells[3].replace(/`/g, '');
    const at = isoTime(cells[1]);
    if (state && at) out.push({ state, at });
  }
  return out;
}

const HISTORY_SHOWN = 4;
const HISTORY_COMMENT = 160;

// What the person decided at a gate, oldest first and short: when, the word they gave, and the files they saw.
function gateHistory(decisions, gate) {
  const entries = [];
  for (const record of decisions || []) {
    if (!record || record.malformed || record.gate !== gate) continue;
    const decision = record.decision === 'approved' ? 'approved' : record.decision === 'changes_requested' ? 'changes' : null;
    const at = isoTime(record.decidedAt);
    if (!decision || !at) continue;
    const comment = typeof record.comment === 'string' ? record.comment.replace(/\s+/g, ' ').trim() : '';
    const files = (Array.isArray(record.artifacts) ? record.artifacts : []).map((item) => item?.path).filter((path) => typeof path === 'string').slice(0, HISTORY_SHOWN);
    entries.push({ decision, at, ...(Number.isFinite(Number(record.round)) && Number(record.round) > 0 ? { round: Number(record.round) } : {}), ...(comment ? { comment: comment.length > HISTORY_COMMENT ? `${comment.slice(0, HISTORY_COMMENT - 3).trimEnd()}...` : comment } : {}), ...(files.length ? { files } : {}) });
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-HISTORY_SHOWN);
}

function stageOfGate(gate, workflowId = null) {
  if (gate === 'price') return 'your-approval-of-the-price';
  if (['sample', 'pictures', 'clips', 'cut', 'finishing'].includes(gate)) return 'making-the-images-and-video';
  return stagesRuntime.forState(statesRuntime.AWAITING_STATE[gate], workflowId)?.stage || null;
}

function priceFacts(dir) {
  const empty = { saved: false, quote: false, referencePriced: false, referenceApproved: false, current: null, changesAsked: false, made: false, landedAll: false, inFlight: false };
  if (!dir) return empty;
  const job = { dir };
  const saved = facts.readQuote(job);
  const shipped = (item) => item && !facts.isTranscriptionItem(item) && !facts.isReferenceItem(item);
  const quote = saved && saved.quote.items.some(shipped) ? saved : null;
  const forQuote = quote ? facts.listPriceApprovals(job).filter((entry) => entry.approval.scope !== facts.TRANSCRIPTION_SCOPE && entry.approval.quoteSha === quote.sha256) : [];
  const last = forQuote.length ? forQuote[forQuote.length - 1] : null;
  const current = last && last.approval.decision === 'approved' ? last : null;
  // A saved price of reference pictures alone: no shipped media in it, but it was priced and may have been approved.
  const referenceQuote = !quote && saved && saved.quote.items.some((item) => item && facts.isReferenceItem(item)) ? saved : null;
  const referenceApprovals = referenceQuote ? facts.listPriceApprovals(job).filter((entry) => entry.approval.scope !== facts.TRANSCRIPTION_SCOPE && entry.approval.quoteSha === referenceQuote.sha256) : [];
  const referenceLast = referenceApprovals.length ? referenceApprovals[referenceApprovals.length - 1] : null;
  const made = facts.readRecords(job).some((record) => record.type === 'create' && shipped(record));
  const items = made ? facts.landingReport(job).items.filter((item) => !facts.isReferenceItem(item.key)) : [];
  return {
    saved: Boolean(saved),
    quote: Boolean(quote),
    referencePriced: Boolean(referenceQuote),
    referenceApproved: Boolean(referenceLast && referenceLast.approval.decision === 'approved'),
    current,
    changesAsked: Boolean(last && !current),
    made,
    landedAll: items.length > 0 && items.every((item) => item.status === 'landed'),
    inFlight: items.some((item) => item.status !== 'landed' && item.reason !== 'not_started'),
  };
}

function sampleFacts(dir) {
  if (!dir) return { current: null };
  const job = { dir };
  const approval = readJson(join(dir, 'approvals', 'sample.json'));
  const key = approval && approval.decision === 'approve' ? facts.canonicalJobKey(approval.key) : null;
  if (!key) return { current: null };
  const landed = facts.readLanded(job).filter((entry) => entry.type === 'landed' && facts.canonicalJobKey(entry.key) === key);
  const latest = landed[landed.length - 1];
  const current = latest && latest.sha256 && approval.sha256 === latest.sha256 ? approval : null;
  return { current };
}

// The pictures and the clips reviews that this job has and the ones the person has approved, as the files are now.
function mediaReviewFacts(dir) {
  const none = { required: [], approved: new Map() };
  if (!dir) return none;
  const job = { dir };
  const required = ['pictures', 'clips', 'cut'].filter((gate) => facts.mediaReviewRequired(job, gate));
  const approved = new Map();
  for (const gate of required) {
    if (!facts.mediaSetApproved(job, gate)) continue;
    const decision = readJson(join(dir, ...facts.MEDIA_REVIEWS[gate].file.split('/')));
    approved.set(gate, { gate, at: isoTime(decision?.decidedAt) });
  }
  // What to add to the joined video is asked after it is approved; it shows as a step of its own.
  if (required.includes('cut')) {
    required.push('finishing');
    const choice = finishingChoice(job);
    if (choice) approved.set('finishing', { gate: 'finishing', at: isoTime(choice.decidedAt) });
  }
  return { required, approved };
}

function decidedGates(state, decisions, price, sample, media = { approved: new Map() }) {
  const ids = statesRuntime.ids();
  const at = ids.indexOf(state);
  const inFlow = at >= 0 && !OFF_FLOW_STATES.has(state);
  const latest = new Map();
  for (const record of decisions || []) {
    if (!record || record.malformed || typeof record.gate !== 'string') continue;
    const seen = latest.get(record.gate);
    if (!seen || (Number(record.round) || 0) >= (Number(seen.round) || 0)) latest.set(record.gate, record);
  }
  const decided = new Map();
  for (const [gate, record] of latest) {
    if (record.decision !== 'approved' || statesRuntime.gateOf(state) === gate) continue;
    const approvedState = statesRuntime.APPROVED_STATE[gate];
    if (inFlow && approvedState && ids.indexOf(approvedState) > at) continue;
    decided.set(gate, { gate, at: isoTime(record.decidedAt) });
  }
  if (price.current) {
    const totals = price.current.approval.totals || {};
    decided.set('price', { gate: 'price', at: isoTime(price.current.approval.approvedAt), totals: { threeEcho: Number(totals.threeEcho) || 0, elevenLabs: Number(totals.elevenLabs) || 0 } });
  }
  if (sample?.current) {
    decided.set('sample', { gate: 'sample', at: isoTime(sample.current.decidedAt) });
  }
  for (const [gate, entry] of media.approved) decided.set(gate, entry);
  return decided;
}

function planGates(planRows) {
  const gates = new Set();
  for (const row of planRows) {
    const fromState = statesRuntime.gateOf(String(row['State after'] || '').replace(/`/g, '').trim());
    const named = String(row.Gate || '').replace(/`/g, '').trim();
    if (fromState) gates.add(fromState);
    if (GATE_NAMES[named]) gates.add(named);
  }
  return gates;
}

function namesOf(gates) {
  const names = gates.map((gate) => GATE_NAMES[gate] || stageLabel(gate));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
}

// What the board calls each plan row and says about it: the row's Stage column is already short, but a few of its words are
// shop talk ("QC", "Hand-off"). Anything not listed keeps its own Stage words in sentence case and has no summary line.
const STEP_INFO = Object.freeze({
  intake: ['Reading your request', 'Understanding what you asked for.'],
  plan: ['Setting the plan', 'Choosing the steps for this job.'],
  'watch the reference': ['Watching the reference video', 'Taking in the video you pointed at.'],
  'break down the reference': ['Breaking down the reference', 'What the video does, beat by beat.'],
  research: ['Research', 'The facts and sources behind the post.'],
  'research (lite)': ['Quick research', 'A short check of the facts the post needs.'],
  'keep the words': ['Saving the key phrases', 'Keeping the best phrases for next time.'],
  brief: ['Strategy', 'One clear direction for the post.'],
  'lite brief': ['Short brief', 'One clear direction for the post.'],
  concepts: ['Ideas', 'A few ideas to pick from.'],
  'script and board': ['Script and storyboard', 'What is said and shown, shot by shot.'],
  'media spec': ['Shot plan', 'The pictures and clips to make.'],
  'media spec (carousel)': ['Slide plan', 'The slides, in swiping order.'],
  media: ['Making the pictures and video', 'The pictures and clips themselves.'],
  'video qa': ['Checking the video', 'Making sure the video matches the plan.'],
  posts: ['Captions', 'The words that go with each post.'],
  'brand marks': ['Logo and label check', 'Checking logos and labels in every picture.'],
  'qc and mechanical checks': ['Quality checks', 'Length, size and format checks.'],
  'qc and platform checks': ['Quality checks', 'Length, size and format checks.'],
  validate: ['Final checks', 'Facts, brand fit and platform rules.'],
  'content gate': ['Final post', 'Your go-ahead on the finished post.'],
  'publish gate': ['Posting plan', 'Where and when it goes out.'],
  'hand-off': ['Getting it ready to post', 'The finished files, ready to go out.'],
  sources: ['Finding sources', 'Where the facts will come from.'],
  'watch the video': ['Watching the video', 'Taking in the video.'],
  'break down the video': ['Breaking down the video', 'What the video does, beat by beat.'],
  'read the posts': ['Reading the posts', 'What the posts say and how people reacted.'],
  'write the report': ['Writing the report', 'Everything found, in one short report.'],
  'report review': ['Your review of the report', 'Read it, then approve it or ask for changes.'],
  done: ['Finishing up', 'The job is wrapped up.'],
  stills: ['Picking still frames', 'Key moments from the video as pictures.'],
  'caption as given': ['Your caption', 'Your own words, checked for each platform.'],
  caption: ['Caption', 'The words that go with the post.'],
  'watch source': ['Watching your video', 'Taking in your video.'],
  'analyse source': ['Breaking down your video', 'What your video does, beat by beat.'],
  'cut plan': ['Cut plan', 'Which parts of the video to keep.'],
  'ad requirements': ['Ad requirements', 'What each ad platform asks for.'],
  proposal: ['Campaign plan', 'The plan for the ad campaign.'],
  'activation checklist': ['Going live checklist', 'What happens when the ads go live.'],
  'ad copy': ['Ad copy', 'The words for each ad.'],
});

function stepInfo(row) {
  const stage = String(row.Stage || '').trim();
  const known = STEP_INFO[stage.toLowerCase()];
  if (known) return { label: known[0], line: known[1] };
  const lower = stage.toLowerCase();
  return { label: lower ? lower[0].toUpperCase() + lower.slice(1) : 'Step', line: null };
}

function planCell(value) {
  return String(value ?? '').replace(/`/g, '').trim();
}

// Each plan row's own status: done, running, waiting or pending. Rows up to the last one whose "State after" the job has
// reached (or is in now) are done. The row after that is waiting when it is the person's gate and the job waits on that gate
// (or on the person at its stage), and running while Claude has it, unless the job is held up or over. Everything later is pending.
function applyTaskStatuses(stages, planRows, state, reached, logged = []) {
  const after = planRows.map((row) => planCell(row['State after']));
  const order = statesRuntime.ids();
  const nowAt = order.indexOf(state);
  const onFlow = nowAt >= 0 && !OFF_FLOW_STATES.has(state);
  const seen = new Set((reached || []).map(planCell).filter((id) => !onFlow || (order.indexOf(id) >= 0 && order.indexOf(id) <= nowAt)));
  if (!OFF_FLOW_STATES.has(state) || state === 'COMPLETE') seen.add(state);
  let lastDone = -1;
  const firstOfNow = onFlow || state === 'COMPLETE' ? after.indexOf(state) : -1;
  if (firstOfNow >= 0) lastDone = firstOfNow;
  after.forEach((id, index) => { if (id && seen.has(id) && id !== state && index > lastDone) lastDone = index; });
  if (state === 'COMPLETE') lastDone = Math.max(lastDone, planRows.length - 1);
  // Asked for changes: the log has already reached the gate's state, which would call the next row (the media) the one
  // running. The row that made the thing under review is being redone, so it runs and everything after it waits.
  let redoRow = -1;
  if (state === 'CHANGES_REQUESTED') {
    const before = (reached || []).map(planCell).filter((id) => !OFF_FLOW_STATES.has(id)).pop();
    if (before && REWORK_STAGE[before]) {
      const rows = after.map((id, index) => (id === before && planCell(planRows[index].Agent) !== 'human' ? index : -1)).filter((index) => index >= 0);
      if (rows.length) { redoRow = rows[0]; lastDone = redoRow - 1; }
    }
  }
  const held = state === 'BLOCKED' || state === 'ESCALATED' || state === 'CANCELLED';
  const finished = state === 'COMPLETE';
  const waitingGate = statesRuntime.gateOf(state) || (stages.some((stage) => stage.id === 'your-approval-of-the-price' && stage.status === 'waiting') ? 'price' : null);
  const personWaiting = Boolean(waitingGate) || stages.some((stage) => stage.status === 'waiting');
  const gateStatus = new Map();
  for (const stage of stages) for (const gate of stage.gates || []) gateStatus.set(gate.gate, gate.status);
  // A stage the job is past has all its rows done, whatever the log remembers (an older job may not log every state).
  for (const stage of stages) {
    if (stage.status !== 'complete' && stage.status !== 'done') continue;
    for (const task of stage.tasks || []) lastDone = Math.max(lastDone, task._row);
  }
  const next = lastDone + 1;
  // When each row finished (the last time the log reached its "State after") and began (when the row before it finished, or its
  // gate was decided, whichever is later): the step history shows them. A row the log does not tell about has neither.
  const loggedAt = new Map();
  for (const entry of logged) loggedAt.set(entry.state, entry.at);
  const decidedAt = new Map();
  const gateEntries = new Map();
  for (const stage of stages) {
    for (const approval of stage.approvals || []) if (approval?.at) decidedAt.set(approval.gate, approval.at);
    for (const entry of stage.gates || []) gateEntries.set(entry.gate, entry);
  }
  const later = (a, b) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);
  const doneAt = after.map((id, index) => (id && index <= lastDone ? loggedAt.get(id) || null : null));
  const gateAt = planRows.map((row) => planCell(row.Gate) || null);
  const startedAt = planRows.map((row, index) => (index === 0 ? null : later(doneAt[index - 1], gateAt[index - 1] ? decidedAt.get(gateAt[index - 1]) || null : null)));
  for (const stage of stages) {
    for (const task of stage.tasks || []) {
      const index = task._row;
      const gate = planCell(task.gate) || null;
      const human = planCell(task.agent) === 'human';
      let status;
      if (index <= lastDone) status = 'done';
      else if (index === redoRow) status = 'running';
      else if (redoRow >= 0) status = 'pending';
      else if (index === next && !held && !finished) {
        if (personWaiting) status = (gate && gate === waitingGate) || (!gate && stage.status === 'waiting') ? 'waiting' : 'pending';
        else status = 'running';
      } else status = 'pending';
      if (gate) {
        const fromStage = gateStatus.get(gate);
        const own = fromStage || (gate === waitingGate ? 'waiting' : seen.has(statesRuntime.APPROVED_STATE[gate]) ? 'done' : 'pending');
        task.gateStatus = own;
        if (human) status = own === 'waiting' && !held ? 'waiting' : own === 'done' ? 'done' : 'pending';
      }
      task.status = status;
      if (status !== 'pending' && startedAt[index] && !(status === 'done' && doneAt[index] && Date.parse(startedAt[index]) > Date.parse(doneAt[index]))) task.startedAt = startedAt[index];
      if (status === 'done' && doneAt[index]) task.doneAt = doneAt[index];
      if (gate && gateEntries.has(gate)) {
        const opened = human ? startedAt[index] : doneAt[index];
        if (opened) gateEntries.get(gate).openedAt = opened;
      }
      delete task._row;
    }
  }
}

function deriveStages(stages, state, planRows, { dir = null, decisions = [], workflowId = null, reached = [] } = {}) {
  const referenceOnly = Boolean(dir) && facts.referenceArtOnly({ dir });
  const priced = priceFacts(dir);
  const price = referenceOnly ? { saved: false, quote: false, referencePriced: false, referenceApproved: false, current: null, changesAsked: false, made: false, landedAll: false, inFlight: false } : priced;
  const sample = referenceOnly ? { current: null } : sampleFacts(dir);
  const media = referenceOnly ? { required: [], approved: new Map() } : mediaReviewFacts(dir);
  const decided = decidedGates(state, decisions, price, sample, media);
  const gates = planGates(planRows);
  if (statesRuntime.gateOf(state)) gates.add(statesRuntime.gateOf(state));
  const held = new Set(['blocked', 'cancelled']);
  const orderIds = statesRuntime.ids();
  const nowAt = orderIds.indexOf(state);
  const flowing = nowAt >= 0 && !OFF_FLOW_STATES.has(state);
  const currentIndex = stages.findIndex((stage) => stage.id === stagesRuntime.forState(state, workflowId)?.stage);
  const making = stages.find((stage) => stage.id === 'making-the-images-and-video');
  const pastMaking = Boolean(making) && (making.status === 'complete' || making.status === 'done');
  // Nothing was priced and the job has got as far as the media being made: the job had no pricing stages, so the
  // list leaves them out. Decided from the job's facts and the states it has been in, never from a stage's status,
  // so asking for changes or a hold-up does not bring them back and change the count.
  const nothingPriced = !priced.quote && !priced.referencePriced && !priced.made && stagesRuntime.reachedMaking([state, ...reached], workflowId);
  for (const [index, stage] of stages.entries()) {
    if (nothingPriced && (stage.id === 'pricing-the-media' || stage.id === 'your-approval-of-the-price')) { stage.skipped = true; continue; }
    if (!held.has(stage.status)) {
      if (stage.id === 'pricing-the-media' && price.quote) stage.status = price.changesAsked ? 'running' : 'complete';
      if (stage.id === 'your-approval-of-the-price' && price.quote) stage.status = price.current ? 'complete' : price.changesAsked ? 'pending' : 'waiting';
      // No saved quote means nothing was priced. While the job has not got past the making stage,
      // a pricing stage the state merely walked by reads pending, not done. Once the job is past
      // making (or finished) with still no quote, nothing in it needed paying for (supplied media,
      // a cut-and-stitch job, a migrated job), the stages are left out (see nothingPriced above).
      if ((stage.id === 'pricing-the-media' || stage.id === 'your-approval-of-the-price') && !price.quote && (stage.status === 'complete' || stage.status === 'done')) {
        if (!pastMaking) stage.status = 'pending';
        else if (priced.referencePriced) {
          // Only reference pictures were priced: say so, and show whether that price was approved.
          if (stage.id === 'pricing-the-media') stage.note = 'Only reference pictures were priced.';
          else {
            // Approved, or never approved because the job moved on without those pictures (the person
            // supplied one instead): either way the stage is over, and says which.
            stage.status = 'complete';
            if (!priced.referenceApproved) stage.note = 'Reference pictures were not needed.';
          }
        }
      }
      if (stage.id === 'making-the-images-and-video' && price.made) {
        stage.status = price.landedAll ? 'complete' : price.inFlight || price.current ? 'running' : 'pending';
      }
      if (stage.status === 'done') stage.status = 'complete';
    }
    if (referenceOnly && !pastMaking && stage.id === 'pricing-the-media' && priced.saved && !held.has(stage.status)) stage.note = 'Reference pictures only so far.';
    const stageGates = stage.id === 'your-approval-of-the-price' ? ['price']
      : stage.id === 'making-the-images-and-video' ? ['sample', ...media.required]
      : [...gates].filter((gate) => stageOfGate(gate, workflowId) === stage.id);
    const approved = stageGates.filter((gate) => decided.has(gate));
    stage.approvals = approved.map((gate) => decided.get(gate));
    stage.gates = stageGates.filter((gate) => !['sample', 'pictures', 'clips', 'cut', 'finishing'].includes(gate) || decided.has(gate) || (gate === 'finishing' && decided.has('cut'))).map((gate) => {
      const history = gateHistory(decisions, gate);
      return {
        gate,
        name: GATE_NAMES[gate] || stageLabel(gate),
        status: decided.has(gate) ? 'done'
          : gate === 'finishing' ? 'waiting'
          : statesRuntime.gateOf(state) === gate || (gate === 'price' && stage.status === 'waiting') ? 'waiting'
            : (flowing && statesRuntime.APPROVED_STATE[gate] && orderIds.indexOf(statesRuntime.APPROVED_STATE[gate]) <= nowAt) || stage.status === 'complete' ? 'done' : 'pending',
        ...(history.length ? { history } : {}),
      };
    });
    const waiting = stageGates.filter((gate) => !decided.has(gate));
    if (approved.length && waiting.length && !(currentIndex >= 0 && index < currentIndex)) {
      stage.note = `${namesOf(waiting)} still to approve.`;
      if (!held.has(stage.status) && stage.status === 'complete') stage.status = 'waiting';
    }
  }
  const shown = stages.filter((stage) => !stage.skipped);
  // Between stages the state maps to the end of the stage just finished, so the next stage would read pending while Claude
  // is already working on it. Say it is running, so the list agrees with the "Where you are" rail.
  const idle = !OFF_FLOW_STATES.has(state) && !statesRuntime.isTerminal(state) && !shown.some((stage) => stage.status === 'running' || stage.status === 'waiting' || stage.status === 'blocked');
  const lastDone = shown.map((stage) => stage.status).lastIndexOf('complete');
  const nextUp = idle && lastDone >= 0 ? shown.find((stage, index) => index > lastDone && stage.status === 'pending') : null;
  if (nextUp) nextUp.status = 'running';
  return shown;
}

function workflowStageIds(workflowId) {
  return stagesRuntime.isReportWorkflow(workflowId) ? stagesRuntime.REPORT_STAGE_IDS : stagesRuntime.STAGE_IDS;
}

function stageSubstep(current, stageId, workflowId) {
  if (current?.stage !== stageId || !current.substep) return null;
  return current.substep === stageLabel(stageId, workflowId) ? null : current.substep;
}

// A job asked for changes has left the state it was in, so the state alone maps to no stage and the whole rail read
// pending. The stage log still says where it was: the last state before CHANGES_REQUESTED. The gate that was open
// names the work being redone, so the stage that makes it shows running ("Making your changes") and the stages
// before it stay done. null when the log cannot say, and the rail keeps its old reading.
const REWORK_STAGE = {
  AWAITING_CONCEPT_APPROVAL: { stage: 'shaping-the-idea', substep: 'Making your changes', status: 'running' },
  AWAITING_STORYBOARD_APPROVAL: { stage: 'shaping-the-idea', substep: 'Making your changes', status: 'running' },
  AWAITING_CONTENT_APPROVAL: { stage: 'writing-the-posts', substep: 'Making your changes', status: 'running' },
  AWAITING_PUBLISH_APPROVAL: { stage: 'writing-the-posts', substep: 'Making your changes', status: 'running' },
  AWAITING_PROPOSAL_APPROVAL: { stage: 'writing-the-posts', substep: 'Making your changes', status: 'running' },
  AWAITING_ACTIVATION_APPROVAL: { stage: 'writing-the-posts', substep: 'Making your changes', status: 'running' },
};
const REPORT_REWORK_STAGE = {
  AWAITING_REPORT_REVIEW: { stage: 'writing-the-report', substep: 'Making your changes', status: 'running' },
};

function reworkStage(state, reached, workflowId) {
  if (state !== 'CHANGES_REQUESTED') return null;
  const before = (Array.isArray(reached) ? reached : []).filter((id) => !OFF_FLOW_STATES.has(id)).pop();
  if (!before) return null;
  return (stagesRuntime.isReportWorkflow(workflowId) ? REPORT_REWORK_STAGE : REWORK_STAGE)[before] || null;
}

function snapshotStages(state, planRows, route, context = {}) {
  const workflowId = typeof route?.workflowId === 'string' ? route.workflowId : null;
  const stateIds = planRows.map((row) => row['State after']).filter(Boolean);
  const walked = stagesRuntime.walkedStages(stateIds, workflowId, { rows: planRows, route }) || workflowStageIds(workflowId);
  const current = stagesRuntime.forState(state, workflowId) || reworkStage(state, context.reached, workflowId);
  const currentIndex = current ? walked.indexOf(current.stage) : -1;
  const routeStages = walked.map((stageId, index) => {
    let stageStatus = index < currentIndex ? 'complete' : index === currentIndex ? (current?.status || 'running') : 'pending';
    if (state === 'BLOCKED' || state === 'ESCALATED') stageStatus = index <= Math.max(currentIndex, 0) ? 'blocked' : 'pending';
    if (state === 'CANCELLED') stageStatus = index < Math.max(currentIndex, 0) ? 'complete' : 'cancelled';
    const rows = planRows.filter((row) => {
      const mapped = stagesRuntime.forState(row['State after'], workflowId);
      return mapped?.stage === stageId;
    });
    return {
      id: stageId,
      label: stageLabel(stageId, workflowId),
      status: stageStatus,
      substep: stageSubstep(current, stageId, workflowId),
      tasks: rows.map((row) => ({
        number: row['#'] || null,
        name: row.Task || null,
        label: stepInfo(row).label,
        line: stepInfo(row).line,
        agent: row.Agent || null,
        role: row.Role || null,
        stateAfter: row['State after'] || null,
        gate: row.Gate || null,
        artifact: row.Artifact || null,
        _row: planRows.indexOf(row),
      })),
    };
  });
  if (!route || route.status !== 'ROUTED') {
    const intake = stagesRuntime.forState(state, workflowId);
    return [{
      id: 'getting-your-brief',
      label: 'Getting your brief',
      status: state === 'BLOCKED' || state === 'ESCALATED' ? 'blocked' : (intake?.status || 'waiting'),
      substep: intake?.stage === 'getting-your-brief' ? intake.substep || null : null,
      tasks: [],
    }];
  }
  const derived = deriveStages(routeStages, state, planRows, { ...context, workflowId });
  applyTaskStatuses(derived, planRows, state, context.reached, context.logged);
  return derived;
}

function hashFile(filePath) {
  try { return createHash('sha256').update(readFileSync(filePath)).digest('hex'); }
  catch { return null; }
}

// The board reads every job often, and a job can hold a 500 MB video, so a file is hashed again only when its path, size or modified time changed.
const artifactHashes = new Map();
function cachedHash(file, stat) {
  const known = artifactHashes.get(file);
  if (known && known.bytes === stat.size && known.mtimeMs === stat.mtimeMs) return known.sha256;
  const sha256 = hashFile(file);
  if (artifactHashes.size > 5000) artifactHashes.clear();
  if (sha256) artifactHashes.set(file, { bytes: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

function listArtifacts(dir) {
  const output = [];
  const skip = new Set(['job.json', 'route.json', 'plan.md', 'task-contracts.json', 'status.md', 'events.jsonl']);
  const factFolders = new Set(['generation', 'pricing', 'messages']);
  const factFiles = new Set(['agents.jsonl']);
  const visit = (current, prefix = '') => {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      if (!prefix && entry.isDirectory() && factFolders.has(entry.name)) continue;
      if (!prefix && entry.isFile() && factFiles.has(entry.name)) continue;
      const file = join(current, entry.name);
      const rel = forward(join(prefix, entry.name));
      if (entry.isDirectory()) visit(file, rel);
      else if (entry.isFile()) {
        try {
          const stat = statSync(file);
          output.push({ path: rel, bytes: stat.size, sha256: cachedHash(file, stat), kind: classifyArtifact(rel) });
        } catch { /* an artifact may disappear while a producer is writing */ }
      }
    }
  };
  visit(dir);
  return output;
}

function classifyArtifact(relativePath) {
  const value = relativePath.toLowerCase();
  if (value.startsWith('approvals/')) return 'approval';
  if (value.startsWith('media/')) return 'media';
  if (value.startsWith('drafts/')) return 'draft';
  if (value.startsWith('research/')) return 'research';
  if (value.startsWith('validation/')) return 'validation';
  if (value.startsWith('handoff/')) return 'delivery';
  if (value.startsWith('revisions/')) return 'update';
  if (value.startsWith('campaign/')) return 'campaign';
  if (value.startsWith('report/')) return 'report';
  return 'file';
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  const rows = [];
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { rows.push({ malformed: true, raw: line.slice(0, 500) }); }
  }
  return rows;
}

function readDecisions(dir) {
  const approvals = join(dir, 'approvals');
  if (!existsSync(approvals)) return [];
  return readdirSync(approvals, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => {
      const file = join(approvals, entry.name);
      return { path: forward(join('approvals', entry.name)), ...readJson(file, { malformed: true }) };
    });
}

function readMetrics(dir) {
  const candidates = ['report-inputs.json', 'metrics.json', join('.social-pipeline', 'metrics.json')];
  for (const item of candidates) {
    const value = readJson(join(dir, item));
    if (value && typeof value === 'object') return { available: true, source: item, ...value };
  }
  const events = readJsonLines(join(dir, 'events.jsonl'));
  const usage = events.filter((event) => event.name === 'tokens.observed' || event.event === 'tokens.observed');
  return {
    available: usage.length > 0,
    source: usage.length ? 'events.jsonl' : null,
    events: usage,
    coverage: usage.length ? 'partial' : 'unavailable',
  };
}

function inputSnapshot(root, brand, jobId, job) {
  const base = inputsPath(root, brand.slug, jobId);
  const index = readJson(join(base, 'manifest.json'), null);
  const revisions = (Array.isArray(job.inputRevisions) ? job.inputRevisions : [])
    .map((entry) => readJson(join(root, entry.manifestPath || ''), null) || entry)
    .filter(Boolean);
  return { currentRevisionId: job.inputRevision || index?.currentRevisionId || null, revisions, index };
}

/**
 * Return the board projection for a local job.  Route, frozen plan and state
 * are read from the pipeline files; the adapter does not infer a new workflow.
 */
export function readJobSnapshot(options = {}) {
  const { root } = assertLocalWorkspace(options.root);
  const { brand, jobId, dir } = resolveJobRef(root, options);
  // A job made before post types existed shows the one it can only be (a TikTok video, a 9:16
  // Instagram video as a reel) and nothing else: any other stays unanswered for the publish step
  // to ask. The job file on disk is left as it was.
  const job = deliverableRuntime.withDerivedPlacements(readJson(join(dir, 'job.json'), {}));
  const route = readJson(join(dir, 'route.json'), null);
  const plan = existsSync(join(dir, 'plan.md')) ? readFileSync(join(dir, 'plan.md'), 'utf8') : null;
  const status = readStatus(dir);
  const rows = parsePlan(plan);
  const decisions = readDecisions(dir);
  const artifacts = listArtifacts(dir);
  const metrics = readMetrics(dir);
  const input = inputSnapshot(root, brand, jobId, job);
  const currentBrandProfileRevision = brandProfileRuntime.read(brand.path)?.revision ?? null;
  const plannedBrandProfileRevision = job.planBasis?.brandProfileRevision ?? null;
  const brandProfile = {
    plannedRevision: plannedBrandProfileRevision,
    currentRevision: currentBrandProfileRevision,
    changedSincePlanning: typeof plannedBrandProfileRevision === 'number'
      && typeof currentBrandProfileRevision === 'number'
      && plannedBrandProfileRevision !== currentBrandProfileRevision,
  };
  const snapshot = {
    workspace: {
      workspaceId: localConfig(root)?.workspaceId || null,
      root,
      storageMode: 'local',
    },
    brand: {
      id: brand.id,
      brandId: brand.id,
      slug: brand.slug,
      name: brand.name,
      // The posting time zone: null means ask the person, never assume one.
      timezone: brand.timezone,
      timezoneSource: brand.timezoneSource,
    },
    project: {
      jobId,
      brand: brand.slug,
      brandId: brand.id,
      title: job.title || jobId,
      state: status.state,
      revision: status.revision,
      ownerUserId: job.ownerUserId || null,
      ownerEmail: job.ownerEmail || null,
      ownershipStatus: job.ownershipStatus || (job.ownerUserId ? 'bound' : 'unbound'),
      stages: snapshotStages(status.state, rows, route, { dir, decisions, reached: stagesRuntime.loggedStates(status.text), logged: loggedTimes(status.text) }),
      artifacts,
      decisions,
      metrics,
      inputRevision: input.currentRevisionId,
      brandProfile,
    },
    job,
    route,
    plan: plan ? { markdown: plan, rows } : null,
    status: { state: status.state, revision: status.revision, nextAction: status.nextAction, blockedOn: status.blockedOn, updatedAt: status.updatedAt },
    input,
    events: readJsonLines(join(dir, 'events.jsonl')),
  };
  // The project shape is the stable integration contract.  Keep the detailed
  // records beside it so callers do not have to reopen local files.
  return { ...snapshot.project, ...snapshot, project: snapshot.project };
}

export function workspaceStatus({ root }) {
  const abs = assertAbsoluteRoot(root);
  const config = localConfig(abs);
  return {
    configured: Boolean(config),
    root: abs,
    workspaceId: config?.workspaceId || null,
    storageMode: config?.storage?.mode || null,
    brands: config ? listBrands({ root: abs }).length : 0,
    jobs: config ? listJobs({ root: abs }).length : 0,
  };
}

export function getJobArtifacts(options = {}) {
  return readJobSnapshot(options).artifacts;
}

export const resolveWorkspace = assertLocalWorkspace;
export const initialize = initializeWorkspace;
export const adopt = adoptWorkspace;
export const copyLocalInputs = importLocalInputs;
export const getJobSnapshot = readJobSnapshot;
export const jobArtifacts = getJobArtifacts;

export const runtimeConstants = Object.freeze({
  projectRoot: PROJECT_ROOT,
  pipelineRoot: PIPELINE_ROOT,
  pipelineVersion: PIPELINE_VERSION,
  pipelineCommit: PIPELINE_COMMIT,
  schemaVersion: SCHEMA_VERSION,
});

export default {
  initializeWorkspace,
  adoptWorkspace,
  reconcileWorkspaceLocation,
  readWorkspace,
  workspaceStatus,
  resolveWorkspace,
  listBrands,
  isGeneralBrand,
  createBrand,
  completeBrandOnboarding,
  listJobs,
  createJob,
  updateJobIntake,
  importLocalInputs,
  addSuppliedFiles,
  copyLocalInputs,
  readJobSnapshot,
  getJobSnapshot,
  getJobArtifacts,
  jobArtifacts,
  runtimeConstants,
};
