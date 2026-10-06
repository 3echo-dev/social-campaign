/**
 * Lifecycle for the private Claude artifact that presents a local workspace.
 *
 * The artifact is a presentation and request relay.  Local pipeline files stay
 * authoritative, and the URL recorded here is only a durable presentation
 * binding.  In particular, recording a URL does not prove account access or
 * artifact ownership.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { buildBoard } from '../../scripts/build-board.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import * as runtime from './runtime.mjs';
import { boardJobDocuments, boardSnapshot, boardSummary } from './board.mjs';
import { ARTIFACT_PATH, ARTIFACT_SOURCE_VERSION, artifactIdOf, canonicalArtifactUrl, isBoardUrl, projectionFileName, projectionHashFromFileName, readBoardLink, recordProjectionWritten } from './board-freshness.mjs';
import { JOB_DOCUMENT_COLLECTION } from './job-document.mjs';

export { ARTIFACT_SOURCE_VERSION };
export const MAX_BATCH_WRITES = 50;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Capabilities requested when the host publishes the source file.
 * Every collection is owner-written only. board-sync applies a saved request
 * as the owner's own approval (spend and publish included), so a person the
 * board is shared with must not be able to queue one; the meta bell log and
 * the per-job planNotes are owner-written for the same reason. `user` lets
 * the page stamp each request with the viewer's opaque id (`by`).
 */
export const ARTIFACT_CAPABILITIES = deepFreeze({
  db: {
    rules: [
      { path: 'socialCampaign', read: 'interact', write: 'owner' },
      { path: JOB_DOCUMENT_COLLECTION, read: 'interact', write: 'owner' },
      { path: 'requests', read: 'interact', write: 'owner' },
      { path: 'meta', read: 'interact', write: 'owner' },
      { path: 'planNotes', read: 'interact', write: 'owner' },
    ],
  },
  user: {},
  comments: {},
  // Transit-only: a writer-side upload of a downscaled logo (and its thumb) that
  // board-sync downloads to a local file and then deletes, so bytes never sit in
  // chat and the artifact never keeps a durable copy. See skills/board-sync/SKILL.md.
  assets: {},
  downloads: {},
});

const BOARD_DIR = join('.social-pipeline', 'board');
const BINDING_FILE = 'binding.json';
const SOURCE_FILE = 'social-campaign.html';
const SOURCE_META_FILE = 'source.json';
const JOB_DOCUMENTS_DIR = 'job-docs';
const JOB_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const RECOVERY_BACKUP_PREFIX = `${BINDING_FILE}.recovery-`;

const bindingRecoveryHint = 'Publish the replacement first, then call pipeline_board_bind with replace:true to recover the saved binding without losing local work.';

function now() {
  return new Date().toISOString();
}

function boardDirPath(root) {
  return join(root, BOARD_DIR);
}

function bindingPath(root) {
  return join(boardDirPath(root), BINDING_FILE);
}

function sourcePath(root) {
  return join(boardDirPath(root), SOURCE_FILE);
}

function sourceMetaPath(root) {
  return join(boardDirPath(root), SOURCE_META_FILE);
}

function workspaceFor(root) {
  runtime.initializeWorkspace({ root });
  return runtime.readWorkspace({ root });
}

function readBindingFile(root) {
  const file = bindingPath(root);
  if (!existsSync(file)) return { exists: false, raw: null, record: {}, state: 'missing' };
  const raw = readFileSync(file);
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { exists: true, raw, record: null, state: 'invalid' };
    }
    return { exists: true, raw, record: value, state: 'parseable' };
  } catch {
    return { exists: true, raw, record: null, state: 'corrupt' };
  }
}

function bindingReadError(state = 'corrupt') {
  if (state === 'incomplete') {
    return new Error(`The saved artifact board binding is incomplete. ${bindingRecoveryHint}`);
  }
  if (state === 'invalid') {
    return new Error(`The saved artifact board binding is invalid. ${bindingRecoveryHint}`);
  }
  return new Error(`The saved artifact board binding is corrupt. ${bindingRecoveryHint}`);
}

function readBindingRecord(root) {
  const file = readBindingFile(root);
  if (!file.exists) return {};
  if (file.state !== 'parseable') throw bindingReadError(file.state);
  return file.record;
}

function readSourceMeta(root) {
  const file = sourceMetaPath(root);
  if (!existsSync(file)) return {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function artifactBindingFromRecord(record, expectedWorkspaceId) {
  if (!record || typeof record !== 'object' || record.url == null) return null;
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : '';
  if (!workspaceId || workspaceId !== expectedWorkspaceId) {
    throw new Error('The saved board belongs to another workspace. Publish or bind a board for this workspace.');
  }
  const url = validateArtifactUrl(record.url);
  const sourceHash = record.sourceHash == null ? null : String(record.sourceHash).trim();
  if (sourceHash && !/^[a-f0-9]{64}$/i.test(sourceHash)) {
    throw new Error('The saved artifact board source hash is corrupt. Generate a fresh board source before binding it.');
  }
  if (record.sourceVersion != null && (typeof record.sourceVersion !== 'string' || !record.sourceVersion.trim())) {
    throw new Error('The saved artifact board source version is corrupt. Generate a fresh board source before binding it.');
  }
  return {
    url,
    aliasUrl: storedAliasUrl(record.aliasUrl),
    workspaceId,
    boundAt: typeof record.boundAt === 'string' ? record.boundAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    source: record.source === 'config' ? 'config' : 'binding',
    sourceHash: sourceHash || null,
    sourceVersion: typeof record.sourceVersion === 'string' ? record.sourceVersion : null,
    ownershipStatus: 'unverified',
  };
}

function storedAliasUrl(value) {
  if (value == null || value === '') return null;
  try {
    return validateArtifactUrl(value);
  } catch {
    return null;
  }
}

function normalizeAliasUrl(value) {
  if (value == null || value === '') return null;
  const bareId = typeof value === 'string' && !value.includes('/') ? canonicalArtifactUrl(value) : null;
  return validateArtifactUrl(bareId || value);
}

export function boardUrlMatches(binding, url) {
  return isBoardUrl(binding, url);
}

export function isBoundBoardUrl({ root, url }) {
  return isBoardUrl(readBoardLink(root), url);
}

function assertSavedWorkspace(record, expectedWorkspaceId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  if (typeof record.workspaceId === 'string' && record.workspaceId.trim() && record.workspaceId !== expectedWorkspaceId) {
    throw new Error('The saved board belongs to another workspace. Publish or bind a board for this workspace.');
  }
}

function bestEffortBinding(record, expectedWorkspaceId) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.url !== 'string' || !record.url.trim()) return null;
  let url;
  try {
    url = validateArtifactUrl(record.url);
  } catch {
    return null;
  }
  return {
    url,
    aliasUrl: null,
    workspaceId: expectedWorkspaceId,
    boundAt: typeof record.boundAt === 'string' ? record.boundAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    source: record.source === 'config' ? 'config' : 'binding',
    sourceHash: null,
    sourceVersion: null,
    ownershipStatus: 'unverified',
  };
}

function parseableBindingState(record, workspaceId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'invalid';
  if (record.url == null || record.url === '') {
    // An empty or metadata-only document has always meant that no dedicated
    // artifact is bound.  Keep that first-bind behavior distinct from a
    // record that claims a workspace but lost its URL.
    return record.workspaceId == null ? 'empty' : 'incomplete';
  }
  try {
    artifactBindingFromRecord(record, workspaceId);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

function readLegacyBinding(root, workspaceId, { strict = false } = {}) {
  const config = readJsonFile(join(root, '.social-pipeline', 'config.json'), {});
  const legacyRef = config?.board?.ref;
  if (legacyRef == null || legacyRef === '') return null;
  try {
    return artifactBindingFromRecord({ url: legacyRef, workspaceId, source: 'config' }, workspaceId);
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

function inspectBindingForRecovery(root, workspaceId, { strictWorkspace = false } = {}) {
  const file = readBindingFile(root);
  if (!file.exists) {
    const legacy = readLegacyBinding(root, workspaceId, { strict: strictWorkspace });
    return { ...file, binding: null, legacy, effective: legacy || null, effectiveKind: legacy ? 'legacy' : null };
  }
  if (file.state === 'corrupt' || file.state === 'invalid') {
    const legacy = readLegacyBinding(root, workspaceId, { strict: strictWorkspace });
    return {
      ...file,
      binding: null,
      legacy,
      effective: legacy || null,
      effectiveKind: legacy ? 'legacy' : null,
    };
  }
  const record = file.record;
  if (strictWorkspace) assertSavedWorkspace(record, workspaceId);
  let binding = null;
  try {
    binding = artifactBindingFromRecord(record, workspaceId);
  } catch {
    binding = null;
  }
  const legacy = binding ? null : readLegacyBinding(root, workspaceId, { strict: strictWorkspace });
  const candidate = binding || legacy || bestEffortBinding(record, workspaceId);
  const state = parseableBindingState(record, workspaceId);
  return {
    ...file,
    state,
    binding,
    legacy,
    effective: candidate,
    effectiveKind: binding ? 'dedicated' : legacy ? 'legacy' : candidate ? 'candidate' : null,
  };
}

function normalizeSourceReceipt(sourceHash, sourceVersion) {
  let normalizedHash = null;
  let normalizedVersion = null;
  if (sourceHash != null) {
    if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(sourceHash.trim())) {
      throw new Error('sourceHash must be a 64 character SHA-256 hex digest.');
    }
    normalizedHash = sourceHash.trim();
  }
  if (sourceVersion != null) {
    if (typeof sourceVersion !== 'string' || !sourceVersion.trim() || sourceVersion.length > 200) {
      throw new Error('sourceVersion must be a non-empty string of at most 200 characters.');
    }
    normalizedVersion = sourceVersion.trim();
  }
  return { sourceHash: normalizedHash, sourceVersion: normalizedVersion };
}

/**
 * Read the dedicated binding, falling back to the older runtime board.ref field.
 * The fallback is deliberately validated before it can be opened.
 *
 * @param {{root:string, workspaceId:string}} options
 * @returns {ReturnType<typeof artifactBindingFromRecord>}
 */
export function readArtifactBinding({ root, workspaceId }) {
  const record = readBindingRecord(root);
  if (record.workspaceId != null && record.url == null) {
    throw bindingReadError('incomplete');
  }
  const dedicated = artifactBindingFromRecord(record, workspaceId);
  if (dedicated) return dedicated;
  const config = readJsonFile(join(root, '.social-pipeline', 'config.json'), {});
  const legacyRef = config?.board?.ref;
  if (legacyRef == null || legacyRef === '') return null;
  return artifactBindingFromRecord({ url: legacyRef, workspaceId, source: 'config' }, workspaceId);
}

/**
 * Validate and canonicalize the URL returned by the host Artifact tool.
 * Current supported forms are https://claude.ai/artifact/<id> and
 * https://claude.ai/code/artifact/<id>.  Query strings and fragments are
 * ignored because the artifact identity is its canonical path.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function validateArtifactUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('The artifact URL is required.');
  }
  const raw = value.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('The artifact URL must be an https://claude.ai artifact address.');
  }
  const authority = /^https:\/\/([^/?#]+)/i.exec(raw)?.[1]?.toLowerCase() || '';
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'claude.ai' || authority !== 'claude.ai' || parsed.port || parsed.username || parsed.password) {
    throw new Error('The artifact URL must use the trusted claude.ai host without credentials or a port.');
  }
  if (!ARTIFACT_PATH.test(parsed.pathname)) {
    throw new Error('The artifact URL must use /artifact/<id> or /code/artifact/<id>.');
  }
  return `https://claude.ai${parsed.pathname}`;
}

function writeTextAtomic(filePath, text) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temp, filePath);
  } finally {
    rmSync(temp, { force: true });
  }
}

function writeBufferAtomic(filePath, bytes) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temp, filePath);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Write the board projection atomically to a content-addressed file and
 * report it by hash and size. The projection itself never contains this
 * file path.
 *
 * @param {{root:string, snapshot:object}} options
 */
export function writeWorkspaceProjection({ root, snapshot }) {
  const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const projectionSha256 = createHash('sha256').update(bytes).digest('hex');
  const filePath = resolve(boardDirPath(root), projectionFileName(projectionSha256));
  if (!existsSync(filePath) || !readFileSync(filePath).equals(bytes)) {
    writeBufferAtomic(filePath, bytes);
  }
  return {
    projectionFile: filePath,
    projectionSha256,
    projectionBytes: bytes.length,
  };
}

function pruneProjectionFiles(root, freshness) {
  const keepHashes = (freshness && Array.isArray(freshness.history) ? freshness.history : [])
    .map((entry) => (entry && typeof entry.hash === 'string' ? entry.hash.toLowerCase() : null))
    .filter(Boolean);
  if (!keepHashes.length) return;
  const dir = boardDirPath(root);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const prefix = projectionHashFromFileName(name);
    if (!prefix || keepHashes.some((hash) => hash.startsWith(prefix))) continue;
    try {
      rmSync(join(dir, name), { force: true });
    } catch {}
  }
}

function jobDocumentPath(root, jobId) {
  if (!JOB_DOCUMENT_ID.test(String(jobId || ''))) throw new Error('A job document needs a safe job ID.');
  return resolve(boardDirPath(root), JOB_DOCUMENTS_DIR, `${jobId}.json`);
}

/**
 * Write each job's board document (see job-document.mjs) atomically beside the
 * projection, one JSON file per job, and report which ones changed. A file is
 * rewritten only when its bytes differ, so an unchanged job keeps its file.
 *
 * @param {{root:string, jobIds?:string[]|null}} options
 */
export function writeJobDocuments({ root, jobIds = null }) {
  return boardJobDocuments({ root, jobIds }).map(({ jobId, terminal, document }) => {
    const filePath = jobDocumentPath(root, jobId);
    const bytes = Buffer.from(JSON.stringify(document), 'utf8');
    let changed = true;
    try { changed = !readFileSync(filePath).equals(bytes); } catch { changed = true; }
    if (changed) writeBufferAtomic(filePath, bytes);
    return {
      collection: JOB_DOCUMENT_COLLECTION,
      doc_id: jobId,
      file_path: filePath,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      changed,
      terminal,
    };
  });
}

/**
 * Write the workspace projection and the job documents, and list the artifact
 * database documents board-sync writes from those files: every open job's
 * document (a finished job's only when it changed), then the workspace
 * projection. Each entry is `{collection, doc_id, file_path}`, the exact
 * arguments of an ArtifactData `set`.
 *
 * @param {{root:string, snapshot:object, jobIds?:string[]|null}} options
 */
export function writeBoardDocuments({ root, snapshot, jobIds = null }) {
  const projection = writeWorkspaceProjection({ root, snapshot });
  const jobDocuments = writeJobDocuments({ root, jobIds });
  const freshness = recordProjectionWritten(root, { projectionSha256: projection.projectionSha256, jobIds });
  pruneProjectionFiles(root, freshness);
  return { ...projection, documents: boardDocumentList({ jobDocuments, projectionFile: projection.projectionFile, jobIds }) };
}

export function boardDocumentList({ jobDocuments, projectionFile, jobIds = null }) {
  const due = jobDocuments.filter(entry => jobIds || !entry.terminal || entry.changed);
  const room = MAX_BATCH_WRITES - 1;
  const kept = due.length <= room ? new Set(due) : new Set([...due.filter(entry => entry.changed), ...due.filter(entry => !entry.changed)].slice(0, room));
  return [
    ...due
      .filter(entry => kept.has(entry))
      .map(({ collection, doc_id, file_path }) => ({ collection, doc_id, file_path })),
    { collection: 'socialCampaign', doc_id: 'workspace', file_path: projectionFile },
  ];
}

function preserveBindingBytes(root, bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const base = join(boardDirPath(root), `${RECOVERY_BACKUP_PREFIX}${digest}.bak`);
  if (existsSync(base)) {
    try {
      if (readFileSync(base).equals(bytes)) return { path: base, digest, created: false };
    } catch {
      // A conflicting recovery file is handled by the unique suffix below.
    }
  } else {
    writeBufferAtomic(base, bytes);
    return { path: base, digest, created: true };
  }
  const unique = join(boardDirPath(root), `${RECOVERY_BACKUP_PREFIX}${digest}-${randomUUID()}.bak`);
  writeBufferAtomic(unique, bytes);
  return { path: unique, digest, created: true };
}

/**
 * Generate the host-publishable board source and the safe projection document.
 * The returned filePath is for the host Artifact tool only and is never put in
 * the artifact database document.
 *
 * @param {{root:string}} options
 */
export function sourceArtifactBoard({ root }) {
  const workspace = workspaceFor(root);
  const html = buildBoard({ config: { workspaceId: workspace.workspaceId, mode: 'artifact' } });
  const filePath = sourcePath(root);
  writeTextAtomic(filePath, html);
  const sourceHash = createHash('sha256').update(html, 'utf8').digest('hex');
  updateJsonFile(sourceMetaPath(root), (current) => ({
    ...current,
    sourceVersion: ARTIFACT_SOURCE_VERSION,
    sourceHash,
    generatedAt: typeof current.generatedAt === 'string' && current.sourceHash === sourceHash ? current.generatedAt : now(),
  }), {});
  const snapshot = boardSnapshot({ root });
  const projection = writeBoardDocuments({ root, snapshot });
  return {
    filePath,
    relativePath: join(BOARD_DIR, SOURCE_FILE).replaceAll('\\', '/'),
    sourceVersion: ARTIFACT_SOURCE_VERSION,
    sourceHash,
    title: 'Social Campaign',
    icon: 'dashboard',
    description: 'Social Campaign board: brands, jobs, reviews, outputs',
    capabilities: ARTIFACT_CAPABILITIES,
    documents: projection.documents,
    ...boardSummary(snapshot),
    workspaceId: workspace.workspaceId,
    syncStatus: 'not_configured',
    ownershipStatus: 'unverified',
    projectionFile: projection.projectionFile,
    projectionSha256: projection.projectionSha256,
    projectionBytes: projection.projectionBytes,
  };
}

/**
 * Open the board. Artifact mode is the only mode and never falls back to a
 * localhost URL when publication has not happened.
 *
 * @param {{root:string, mode?:'artifact', sourceBuilder?: typeof buildBoard}} options
 */
export function openArtifactBoard({ root, mode = 'artifact', sourceBuilder = buildBoard }) {
  const workspace = workspaceFor(root);
  if (mode !== 'artifact') throw new Error('Board mode must be artifact.');
  const snapshot = boardSnapshot({ root });
  const projection = writeBoardDocuments({ root, snapshot });
  const binding = readArtifactBinding({ root, workspaceId: workspace.workspaceId });
  if (!binding) {
    return {
      mode: 'artifact',
      status: 'needs_publication',
      workspaceId: workspace.workspaceId,
      sourceVersion: ARTIFACT_SOURCE_VERSION,
      ...boardSummary(snapshot),
      projectionFile: projection.projectionFile,
      projectionSha256: projection.projectionSha256,
      projectionBytes: projection.projectionBytes,
      documents: projection.documents,
      message: 'Publish the source from pipeline_board_source with the private db and comments capabilities, then bind the returned URL with pipeline_board_bind. The binding does not verify account access or ownership.',
    };
  }
  const currentHtml = sourceBuilder({ config: { workspaceId: workspace.workspaceId, mode: 'artifact' } });
  const currentSourceHash = createHash('sha256').update(currentHtml, 'utf8').digest('hex');
  const currentSource = {
    ...readSourceMeta(root),
    sourceVersion: ARTIFACT_SOURCE_VERSION,
    sourceHash: currentSourceHash,
  };
  const sourceStatus = !binding.sourceHash
    ? 'unverified'
    : currentSource.sourceHash && currentSource.sourceHash !== binding.sourceHash
      ? 'needs_refresh'
      : currentSource.sourceVersion && binding.sourceVersion && currentSource.sourceVersion !== binding.sourceVersion
        ? 'needs_refresh'
        : 'current';
  return {
    mode: 'artifact',
    status: 'bound',
    url: binding.url,
    aliasUrl: binding.aliasUrl,
    workspaceId: workspace.workspaceId,
    boundAt: binding.boundAt,
    source: binding.source,
    sourceHash: binding.sourceHash,
    sourceVersion: binding.sourceVersion,
    currentSourceHash,
    currentSourceVersion: ARTIFACT_SOURCE_VERSION,
    sourceStatus,
    boardSourceOutdated: sourceStatus === 'needs_refresh',
    ownershipStatus: 'unverified',
    ...boardSummary(snapshot),
    projectionFile: projection.projectionFile,
    projectionSha256: projection.projectionSha256,
    projectionBytes: projection.projectionBytes,
    documents: projection.documents,
    message: 'The board URL is recorded for this workspace. The binding does not verify account access or artifact ownership.',
  };
}

/**
 * Bind a host-published artifact to exactly one workspace.
 *
 * @param {{root:string,url:string,workspaceId:string,replace?:boolean,sourceHash?:string|null,sourceVersion?:string|null,aliasUrl?:string|null}} options
 */
export function bindArtifactBoard({ root, url, workspaceId, replace = false, sourceHash = null, sourceVersion = null, aliasUrl = null }) {
  const workspace = workspaceFor(root);
  if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId !== workspace.workspaceId) {
    throw new Error('The artifact binding belongs to another workspace.');
  }
  const canonical = validateArtifactUrl(url);
  const alias = normalizeAliasUrl(aliasUrl);
  const receipt = normalizeSourceReceipt(sourceHash, sourceVersion);
  const path = bindingPath(root);
  if (replace !== true) {
    // Ordinary binding remains strict.  Recovery is an explicit operation after
    // the host has successfully published the replacement artifact.
    const current = readBindingRecord(root);
    assertSavedWorkspace(current, workspace.workspaceId);
    if (current.workspaceId != null && current.url == null) throw bindingReadError('incomplete');
  }
  let previousUrl = null;
  let previousAliasUrl = null;
  let previousSourceHash = null;
  let previousSourceVersion = null;
  let previousTrusted = false;
  let previousState = 'missing';
  let recoveryStatus = 'none';
  let backupInfo = null;
  const result = updateJsonFile(path, (current) => {
    // Read the record again while updateJsonFile holds its cross-process lock.
    // This keeps the corruption check inside the atomic read-modify-write too.
    const strictExisting = replace === true
      ? null
      : readArtifactBinding({ root, workspaceId: workspace.workspaceId });
    const inspection = inspectBindingForRecovery(root, workspace.workspaceId, { strictWorkspace: replace !== true });
    previousState = inspection.state;
    const currentRecord = inspection.record && typeof inspection.record === 'object' && !Array.isArray(inspection.record)
      ? inspection.record
      : {};
    const existing = strictExisting || inspection.effective;
    previousUrl = existing?.url || null;
    previousTrusted = inspection.state === 'valid' || inspection.effectiveKind === 'legacy';
    previousAliasUrl = previousTrusted ? existing?.aliasUrl || null : null;
    previousSourceHash = previousTrusted ? existing?.sourceHash || null : null;
    previousSourceVersion = previousTrusted ? existing?.sourceVersion || null : null;
    const trustedExisting = previousTrusted;
    const known = existing ? { url: existing.url, aliasUrl: previousAliasUrl } : null;
    const sameUrl = Boolean(known) && [canonical, alias].some((address) => address && boardUrlMatches(known, address));
    if (existing && !sameUrl && replace !== true) {
      throw new Error('This workspace already has a different artifact board. Pass replace:true to change it deliberately.');
    }
    const targetUrl = sameUrl ? existing.url : canonical;
    const offeredAlias = [alias, canonical].find((address) => address && artifactIdOf(address) !== artifactIdOf(targetUrl)) || null;
    const nextAliasUrl = offeredAlias || (sameUrl ? known.aliasUrl : null);
    const sameReceipt = trustedExisting
      && sameUrl
      && (receipt.sourceHash == null || existing?.sourceHash === receipt.sourceHash)
      && (receipt.sourceVersion == null || existing?.sourceVersion === receipt.sourceVersion)
      && (existing?.aliasUrl || null) === nextAliasUrl;
    const needsRecovery = ['corrupt', 'invalid', 'incomplete'].includes(inspection.state);
    const actualReplacement = Boolean(existing?.url && !sameUrl);
    const shouldBackup = inspection.exists && replace === true && (needsRecovery || actualReplacement);
    if (replace === true && (needsRecovery || actualReplacement)) {
      recoveryStatus = needsRecovery ? 'recovered' : 'replaced';
    }
    if (shouldBackup) {
      // All input validation, workspace checks, and replacement guards happen
      // before this point while updateJsonFile holds the binding lock.
      backupInfo = preserveBindingBytes(root, inspection.raw);
      recoveryStatus = needsRecovery ? 'recovered' : 'replaced';
    }
    const at = sameUrl && trustedExisting && existing?.boundAt ? existing.boundAt : now();
    const nextSourceHash = receipt.sourceHash != null
      ? receipt.sourceHash
      : sameUrl && trustedExisting ? existing?.sourceHash || null : null;
    const nextSourceVersion = receipt.sourceVersion != null
      ? receipt.sourceVersion
      : sameUrl && trustedExisting ? existing?.sourceVersion || null : null;
    const recovery = recoveryStatus !== 'none'
      ? {
        status: recoveryStatus,
        previousState: inspection.state,
        backupSha256: backupInfo?.digest || null,
        recoveredAt: now(),
      }
      : currentRecord.recovery;
    return {
      ...currentRecord,
      workspaceId: workspace.workspaceId,
      url: targetUrl,
      aliasUrl: nextAliasUrl,
      boundAt: at,
      updatedAt: sameReceipt && existing?.updatedAt ? existing.updatedAt : now(),
      source: 'host_artifact',
      ownershipStatus: 'unverified',
      sourceHash: nextSourceHash,
      sourceVersion: nextSourceVersion,
      ...(recovery ? { recovery } : {}),
    };
  }, {});
  const idempotent = previousTrusted && previousUrl === result.url && previousAliasUrl === (result.aliasUrl || null) && previousSourceHash === result.sourceHash && previousSourceVersion === result.sourceVersion;
  const recovery = {
    status: recoveryStatus,
    previousState,
    backupPath: backupInfo?.path || null,
    backupCreated: Boolean(backupInfo?.created),
  };
  return {
    mode: 'artifact',
    status: 'bound',
    url: result.url,
    aliasUrl: result.aliasUrl || null,
    workspaceId: workspace.workspaceId,
    boundAt: result.boundAt,
    updatedAt: result.updatedAt,
    idempotent,
    replaced: Boolean(replace && previousUrl && previousUrl !== result.url),
    sourceHash: result.sourceHash || null,
    sourceVersion: result.sourceVersion || null,
    ownershipStatus: 'unverified',
    recovery,
    backupPath: recovery.backupPath,
    message: 'The artifact URL is recorded for this workspace. This binding does not verify account access or artifact ownership.',
  };
}
