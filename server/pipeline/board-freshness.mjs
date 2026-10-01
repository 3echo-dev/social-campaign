import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from '../../scripts/build-board.mjs';
import { factsFingerprint, isFinishedState, landingReport, listJobs } from './facts.mjs';

const BOARD_DIR = join('.social-pipeline', 'board');
const SAFE_ARTIFACT_ID = '[A-Za-z0-9_-]{8,128}';
const UUID_ARTIFACT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_ARTIFACT_ID}$`, 'i');
const SESSION_LIMIT = 30;

export const ARTIFACT_PATH = new RegExp(`^/(?:code/)?artifact/(?:${UUID_ARTIFACT_ID}|${SAFE_ARTIFACT_ID})$`, 'i');
export const WORKSPACE_DOCUMENT = Object.freeze({ collection: 'socialCampaign', doc_id: 'workspace' });
export const REARM_AFTER_MS = 3 * 60 * 60 * 1000;

/** The board source changes only when its source contract changes. */
export const ARTIFACT_SOURCE_VERSION = 'social-campaign-board-v3';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const requireScript = name => {
  try {
    return createRequire(import.meta.url)(join(SCRIPTS, name));
  } catch {
    return null;
  }
};
const lifecycle = requireScript('lib-states.js');
const gateOfState = state => {
  try {
    return (state && lifecycle?.gateOf(state)) || null;
  } catch {
    return null;
  }
};

/** A job another chat picked this recently is that chat's to look after. */
export const OTHER_SESSION_HOURS = 6;

export const BOARD_TEXT = Object.freeze({
  behind: 'The board is behind the work; sync it before finishing.',
  unsaved: "Some made files aren't saved yet; check them with pipeline_generation_land.",
  copies: 'A review is waiting on the board but its images or video have no viewable copy there yet. For each job below, call pipeline_review_copies_prepare, upload what it returns with the Artifact tool, then write the board again.',
  rearm: "Re-arm the board's wake-up by reading and republishing it before replying.",
});

/** Shown without blocking when nobody is waiting on the job. */
export const BOARD_NOTE = Object.freeze({
  behind: 'The board is a little behind the work.',
  unsaved: "Some made files aren't saved yet.",
  copies: "A review's images or video can't be viewed on the board yet.",
  close: 'Nobody is waiting on this right now, so it can be caught up next time.',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const boardPath = (root, name) => join(resolve(root), BOARD_DIR, name);
const jobRef = job => `${job.brand}/${job.jobId}`;
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const PROJECTION_HISTORY_LIMIT = 5;
export const LEGACY_PROJECTION_NAME = 'workspace-projection.json';
const PROJECTION_HASH_LENGTH = 12;
const PROJECTION_NAME_PATTERN = /^workspace-([0-9a-f]{8,64})\.json$/i;

export function projectionFileName(projectionSha256Hex) {
  const hash = String(projectionSha256Hex || '').trim().toLowerCase();
  return `workspace-${hash.slice(0, PROJECTION_HASH_LENGTH)}.json`;
}

export function projectionHashFromFileName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = PROJECTION_NAME_PATTERN.exec(basename(value.trim()));
  return match ? match[1].toLowerCase() : null;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function artifactIdOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (UUID.test(raw)) return raw.toLowerCase();
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'claude.ai' || parsed.port || parsed.username || parsed.password) return null;
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!ARTIFACT_PATH.test(path)) return null;
  const id = path.slice(path.lastIndexOf('/') + 1);
  return UUID.test(id) ? id.toLowerCase() : id;
}

export function canonicalArtifactUrl(value) {
  const id = artifactIdOf(value);
  if (!id) return null;
  const raw = value.trim();
  if (UUID.test(raw)) return `https://claude.ai/code/artifact/${id}`;
  const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  return `https://claude.ai${parsed.pathname.replace(/\/+$/, '')}`;
}

export function isBoardUrl(link, url) {
  const id = artifactIdOf(url);
  if (!id || !link) return false;
  return [link.url, link.aliasUrl].some(known => artifactIdOf(known) === id);
}

function workspaceIdOf(root) {
  if (!root) return null;
  const config = readJson(join(resolve(root), '.social-pipeline', 'config.json'));
  return plainObject(config) && typeof config.workspaceId === 'string' ? config.workspaceId : null;
}

export function readBoardLink(root) {
  if (!root) return null;
  const config = readJson(join(resolve(root), '.social-pipeline', 'config.json'));
  const workspaceId = plainObject(config) && typeof config.workspaceId === 'string' ? config.workspaceId : null;
  const file = boardPath(root, 'binding.json');
  if (existsSync(file)) {
    const record = readJson(file);
    if (!plainObject(record)) return null;
    if (record.url != null && record.url !== '') {
      if (!workspaceId || record.workspaceId !== workspaceId) return null;
      const url = canonicalArtifactUrl(record.url);
      const sourceVersion = typeof record.sourceVersion === 'string' && record.sourceVersion ? record.sourceVersion : null;
      const sourceHash = typeof record.sourceHash === 'string' && record.sourceHash ? record.sourceHash : null;
      return url ? { url, aliasUrl: canonicalArtifactUrl(record.aliasUrl), sourceVersion, sourceHash } : null;
    }
    if (record.workspaceId != null) return null;
  }
  const legacy = plainObject(config) ? canonicalArtifactUrl(config.board?.ref) : null;
  return legacy ? { url: legacy, aliasUrl: null, sourceVersion: null, sourceHash: null } : null;
}

export function currentBoardSourceHash(root) {
  const workspaceId = workspaceIdOf(root);
  if (!workspaceId) return null;
  const html = buildBoard({ config: { workspaceId, mode: 'artifact' } });
  return sha256(Buffer.from(html, 'utf8'));
}

export function boardSourceOutdated(link, root) {
  if (!link?.sourceHash) return false;
  let currentHash = null;
  try {
    currentHash = currentBoardSourceHash(root);
  } catch {
    currentHash = null;
  }
  if (!currentHash) return false;
  if (currentHash !== link.sourceHash) return true;
  return Boolean(link.sourceVersion) && link.sourceVersion !== ARTIFACT_SOURCE_VERSION;
}

export function recordBoardAlias(root, uuid) {
  if (typeof uuid !== 'string' || !UUID.test(uuid.trim())) return null;
  const file = boardPath(root, 'binding.json');
  let before;
  try {
    before = readFileSync(file);
  } catch {
    return null;
  }
  const link = readBoardLink(root);
  if (!link || link.aliasUrl) return null;
  const aliasUrl = `https://claude.ai/code/artifact/${uuid.trim().toLowerCase()}`;
  if (artifactIdOf(aliasUrl) === artifactIdOf(link.url)) return null;
  let record;
  try {
    record = JSON.parse(before.toString('utf8'));
  } catch {
    return null;
  }
  if (!plainObject(record)) return null;
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...record, aliasUrl, updatedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', flag: 'wx' });
    if (!readFileSync(file).equals(before)) return null;
    renameSync(temp, file);
    return aliasUrl;
  } catch {
    return null;
  } finally {
    rmSync(temp, { force: true });
  }
}

export function landedRequestCount(root) {
  let names = [];
  try {
    names = readdirSync(boardPath(root, 'requests'));
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = readJson(boardPath(root, join('requests', name)));
    if (plainObject(record) && record.status !== 'applied' && record.status !== 'declined') count += 1;
  }
  return count;
}

export function boardSessionLines(root, sessionId) {
  try {
    const link = readBoardLink(root);
    if (!link) return [];
    const waiting = landedRequestCount(root);
    const lines = [
      `Social Campaign board (for Claude): this workspace's board is bound to ${link.url}.`,
      boardSourceOutdated(link, root)
        ? 'The board page is out of date. Before replying, refresh it: call pipeline_board_source, read the bound board with the Artifact tool, publish the returned file to the same url, then bind the new source as board-setup describes. If pipeline_board_source returns updateWaiting true, or no pluginVersion, publish nothing: Social Campaign was just updated, so tell the person once to open a new chat and type /social-campaign to carry on.'
        : `Before replying, re-arm its wake-up: read ${link.url} with the Artifact tool, then republish that same page to the same url. Then list the board's saved requests and handle them through board-sync.`,
    ];
    if (waiting) {
      lines.push(`${waiting} board request${waiting === 1 ? ' is' : 's are'} already landed on this computer but not applied yet; handle ${waiting === 1 ? 'it' : 'them'} through board-sync too.`);
    }
    if (otherWindowArmedRecently(root, sessionId)) {
      lines.push('Social Campaign may also be open in another Claude window. Tell the person once, in plain words, to use one window for board clicks.');
    }
    return lines;
  } catch {
    return [];
  }
}

export const freshnessPath = root => boardPath(root, 'last-projection.json');
export const wakePath = root => boardPath(root, 'wake.json');

export function readFreshness(root) {
  const record = readJson(freshnessPath(root));
  return plainObject(record) ? record : {};
}

function openJobFingerprints(root, jobIds) {
  const wanted = Array.isArray(jobIds) ? new Set(jobIds) : null;
  const out = {};
  for (const job of listJobs(root)) {
    if (wanted ? !wanted.has(job.jobId) : isFinishedState(job.state)) continue;
    out[jobRef(job)] = factsFingerprint(job);
  }
  return out;
}

function projectionHistoryOf(record) {
  if (Array.isArray(record.history)) {
    return record.history.filter(entry => plainObject(entry) && typeof entry.hash === 'string');
  }
  if (typeof record.projectionSha256 === 'string' && record.projectionSha256) {
    return [{ hash: record.projectionSha256, jobs: plainObject(record.jobs) ? record.jobs : {}, writtenAt: record.writtenAt ?? null }];
  }
  return [];
}

export function recordProjectionWritten(root, { projectionSha256, jobIds = null, at = new Date().toISOString() } = {}) {
  try {
    const current = readFreshness(root);
    const jobs = {};
    if (Array.isArray(jobIds)) {
      const wanted = new Set(jobIds);
      const published = plainObject(current.published?.jobs) ? current.published.jobs : {};
      for (const [ref, fingerprint] of Object.entries(published)) {
        if (!wanted.has(ref.slice(ref.indexOf('/') + 1))) jobs[ref] = fingerprint;
      }
    }
    Object.assign(jobs, openJobFingerprints(root, jobIds));
    const history = projectionHistoryOf(current).filter(entry => entry.hash !== projectionSha256);
    history.push({ hash: projectionSha256, jobs, writtenAt: at });
    const next = { ...current, projectionSha256, writtenAt: at, jobs, history: history.slice(-PROJECTION_HISTORY_LIMIT) };
    writeJsonAtomic(freshnessPath(root), next);
    return next;
  } catch {
    return null;
  }
}

export function markProjectionPublished(root, { projectionSha256, sessionId = null, at = new Date().toISOString() } = {}) {
  const hash = typeof projectionSha256 === 'string' ? projectionSha256.trim().toLowerCase() : '';
  if (!hash) return null;
  const current = readFreshness(root);
  const latest = typeof current.projectionSha256 === 'string' ? current.projectionSha256.toLowerCase() : '';
  if (!latest || !latest.startsWith(hash)) return null;
  const entry = projectionHistoryOf(current).find(item => item.hash.toLowerCase() === latest);
  const jobs = entry && plainObject(entry.jobs) ? entry.jobs : (plainObject(current.jobs) ? current.jobs : {});
  const writtenAt = entry?.writtenAt ?? current.writtenAt ?? null;
  const published = { projectionSha256: current.projectionSha256, jobs, writtenAt, publishedAt: at, sessionId };
  writeJsonAtomic(freshnessPath(root), { ...current, published });
  return published;
}

export function projectionSha(bytes) {
  return sha256(bytes);
}

export function boardBehind(root, jobs = listJobs(root)) {
  const record = readFreshness(root);
  const published = plainObject(record.published?.jobs) ? record.published.jobs : {};
  const behind = [];
  for (const job of jobs) {
    const ref = jobRef(job);
    if (isFinishedState(job.state) && !(ref in published)) continue;
    const fingerprint = factsFingerprint(job);
    if (published[ref] !== fingerprint) behind.push({ ref, fingerprint });
  }
  return behind;
}

export function unsavedOutputs(jobs) {
  const out = [];
  for (const job of jobs) {
    if (isFinishedState(job.state)) continue;
    const items = landingReport(job).items
      .filter(item => item.reason === 'waiting_to_save' || item.reason === 'download')
      .map(item => `${item.key}:${item.status}:${(item.assetIds || []).join(',')}`);
    if (items.length) out.push({ ref: jobRef(job), items });
  }
  return out;
}

async function loadBoard() {
  try {
    return await import('./board.mjs');
  } catch {
    return null;
  }
}

function reviewGaps(board, root, jobs) {
  if (!board) return [];
  const out = [];
  for (const job of jobs) {
    if (isFinishedState(job.state)) continue;
    try {
      const { gate, missing } = board.reviewCopyGaps({ root, brand: job.brand, jobId: job.jobId });
      out.push({ job, gate, missing });
    } catch {
      out.push({ job, gate: null, missing: [] });
    }
  }
  return out;
}

const copyEntry = ({ job, gate, missing }) => ({ ref: jobRef(job), gate, files: missing.map(item => item.sourceSha) });

export async function reviewsWithoutCopies(root, jobs = listJobs(root)) {
  return reviewGaps(await loadBoard(), root, jobs).filter(entry => entry.missing.length).map(copyEntry);
}

/**
 * The jobs this chat should look after: every job except the ones another chat picked within
 * the last few hours. A job this chat picked, a job nobody picked, and a job whose other chat
 * went quiet long ago all stay in. With no chat id, or no way to read the picks, every job stays in.
 */
export function jobsForSession(root, sessionId, jobs = listJobs(root), now = Date.now()) {
  if (!sessionId) return jobs;
  const sessions = requireScript('lib-session.js');
  if (!sessions) return jobs;
  try {
    const argv = ['--root', resolve(root)];
    const own = basename(sessions.file(String(sessionId), argv), '.json');
    const bindings = sessions.list(argv);
    const mine = new Set(bindings.filter(entry => entry.key === own).map(entry => `${entry.brand}/${entry.jobId}`));
    // The later of "picked" and "still here"; a time in the future counts as now.
    const age = entry => {
      const at = Math.max(...[entry.selectedAt, entry.touchedAt].map(value => Date.parse(value ?? '')).filter(Number.isFinite));
      return Number.isFinite(at) ? Math.max(0, now - at) : Infinity;
    };
    const theirs = new Set(bindings
      .filter(entry => entry.key !== own && age(entry) < OTHER_SESSION_HOURS * 60 * 60 * 1000)
      .map(entry => `${entry.brand}/${entry.jobId}`));
    return jobs.filter(job => mine.has(jobRef(job)) || !theirs.has(jobRef(job)));
  } catch {
    return jobs;
  }
}

/** The board's own answer to "is a person needed here", or just the approval gates when it cannot load. */
function waitingFor(board, root, job, questions) {
  try {
    if (board?.personWaiting) return board.personWaiting(root, job, { questions });
  } catch {
    // fall through to the gate on the job's state
  }
  const gate = gateOfState(job.state);
  return gate ? { kind: 'decision', gate, reason: null } : null;
}

/**
 * What the stop hook looks at for these jobs. Each finding is worked out per job, so it can be
 * matched to the job that owns it; `waiting` holds the refs of jobs a person is needed on.
 */
export async function stopFindings(root, allJobs = listJobs(root), { loadBoard: load = loadBoard } = {}) {
  // A finished job never waits on anyone, so it is left out of everything except the board check:
  // a board that still shows a cancelled or completed job as open is behind, whoever it was for.
  const jobs = allJobs.filter(job => !isFinishedState(job.state));
  const board = await load();
  let questions = null;
  try {
    questions = board?.openQuestionsForWaiting ? board.openQuestionsForWaiting(root) : null;
  } catch {
    questions = null;
  }
  const waiting = new Set();
  for (const job of jobs) {
    if (waitingFor(board, root, job, questions)) waiting.add(jobRef(job));
  }
  const copies = reviewGaps(board, root, jobs).filter(entry => entry.missing.length).map(copyEntry);
  return { behind: boardBehind(root, allJobs), unsaved: unsavedOutputs(jobs), copies, waiting };
}

function sessionMap(value) {
  return plainObject(value) ? value : {};
}

function pruned(sessions) {
  return Object.fromEntries(Object.entries(sessions)
    .sort((a, b) => String(b[1]?.at ?? b[1]).localeCompare(String(a[1]?.at ?? a[1])))
    .slice(0, SESSION_LIMIT));
}

export function recordBoardArmed(root, sessionId, at = new Date().toISOString()) {
  if (!sessionId) return null;
  const current = readJson(wakePath(root));
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  sessions[String(sessionId)] = { at };
  writeJsonAtomic(wakePath(root), { sessions: pruned(sessions) });
  return at;
}

export function boardArmedAt(root, sessionId) {
  const current = readJson(wakePath(root));
  const entry = sessionMap(plainObject(current) ? current.sessions : null)[String(sessionId)];
  const at = Date.parse(entry?.at ?? '');
  return Number.isFinite(at) ? at : null;
}

export function needsRearm(root, sessionId, now = Date.now()) {
  if (!readBoardLink(root)) return false;
  const at = boardArmedAt(root, sessionId);
  return at === null || now - at > REARM_AFTER_MS;
}

export function otherWindowArmedRecently(root, sessionId, now = Date.now()) {
  const current = readJson(wakePath(root));
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  const key = sessionId != null ? String(sessionId) : null;
  return Object.entries(sessions).some(([id, entry]) => {
    if (key !== null && id === key) return false;
    const at = Date.parse(entry?.at ?? '');
    return Number.isFinite(at) && now - at <= REARM_AFTER_MS;
  });
}

export function claimStopBlock(root, sessionId, signature, at = new Date().toISOString()) {
  const file = boardPath(root, 'stop-hook.json');
  const current = readJson(file);
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  const key = String(sessionId || 'unknown');
  if (sessions[key]?.signature === signature) return false;
  sessions[key] = { signature, at };
  try {
    writeJsonAtomic(file, { sessions: pruned(sessions) });
  } catch {
    return false;
  }
  return true;
}
