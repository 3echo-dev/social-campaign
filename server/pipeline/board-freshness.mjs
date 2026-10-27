import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoardShellText } from '../../scripts/build-board.mjs';
import { factsFingerprint, isFinishedState, landingReport, listJobs, readSessionBinding, sessionBindings } from './facts.mjs';
import { STALE_RUN_MS, readAgentLines } from './agent-log.mjs';
import { lastChangeAt, runsFrom } from './agent-box.mjs';
import { DIRECTOR, pendingMessages } from './agent-messages.mjs';
import { handoffSent } from './handoff.mjs';
import { BOARD_OWNER_TTL_MS, JOB_CLAIM_TTL_MS, holderGone, hookWindowPid, jobClaimFile, liveClaim, readClaimRecord, releaseClaim, takeClaim } from './session-claims.mjs';
import { renameReplacing } from '../lib/rename.mjs';

const BOARD_DIR = join('.social-pipeline', 'board');
const SAFE_ARTIFACT_ID = '[A-Za-z0-9_-]{8,128}';
const UUID_ARTIFACT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_ARTIFACT_ID}$`, 'i');
const SESSION_LIMIT = 30;

export const ARTIFACT_PATH = new RegExp(`^/(?:code/)?artifact/(?:${UUID_ARTIFACT_ID}|${SAFE_ARTIFACT_ID})$`, 'i');
export const WORKSPACE_DOCUMENT = Object.freeze({ collection: 'socialCampaign', doc_id: 'workspace' });
export const REARM_AFTER_MS = 3 * 60 * 60 * 1000;

/** The board source changes only when its source contract changes. */
export const ARTIFACT_SOURCE_VERSION = 'social-campaign-board-v4';

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
  otherWindow: 'Another Claude window is answering a board message right now, so this one leaves the board alone for this turn. Tell the person once, in plain words, that the other window is busy with the board and that their next message here takes it over.',
  otherWindowMessage: 'This board message belongs to the other Claude window that owns the board. Do not read, answer or apply it here, and say nothing to the person about it.',
  rearm: "Re-arm the board's wake-up by reading and republishing it before replying.",
  agents: 'An agent finished since the board was written; call pipeline_board_job_documents for the jobs below and write them.',
  replies: 'The person left a message for the Director on the board. For each job below, answer it with pipeline_agent_reply, then write the documents it returns.',
  chatAsk: 'You asked the person something in chat. Put the same question, with the same options, on the Director card with pipeline_board_ask, publish the board, then stop.',
  republish: 'Social Campaign was updated and the board page is out of date. Republish it now, without asking the person: call pipeline_board_source with the bound url, read the bound board with the Artifact tool, publish the returned page and files to the same url, then bind the new source as board-setup describes. If pipeline_board_source returns updateWaiting true or no pluginVersion, publish nothing and tell the person once to open a new chat.',
  stuck: 'A job is stuck and the person has not been asked yet. For each job below, ask them in one plain line with pipeline_board_ask, say the same line in chat, then carry on.',
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
    renameReplacing(temp, file);
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

// The hash of every published file of the board, by published path, as recorded when its source was bound: the files
// of a refresh that did not change are left out of the next publish. Anything that is not a map of paths to SHA-256 hex
// digests reads as nothing recorded, so a damaged record only means every file is published again.
export function normalizeFileHashes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hashes = {};
  for (const [path, hash] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(path) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    hashes[path] = hash.toLowerCase();
  }
  return Object.keys(hashes).length ? hashes : null;
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
      return url ? { url, aliasUrl: canonicalArtifactUrl(record.aliasUrl), sourceVersion, sourceHash, fileHashes: normalizeFileHashes(record.fileHashes) } : null;
    }
    if (record.workspaceId != null) return null;
  }
  const legacy = plainObject(config) ? canonicalArtifactUrl(config.board?.ref) : null;
  return legacy ? { url: legacy, aliasUrl: null, sourceVersion: null, sourceHash: null, fileHashes: null } : null;
}

export function currentBoardSourceHash(root) {
  const workspaceId = workspaceIdOf(root);
  if (!workspaceId) return null;
  const html = buildBoardShellText({ config: { workspaceId, mode: 'artifact' } });
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
    renameReplacing(temp, file);
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

export const ownerPath = root => boardPath(root, 'owner.json');
const toldPath = root => boardPath(root, 'owner-told.json');

/** An owner window that is answering a board message counts as busy this long after it last showed any sign of life. */
export const BOARD_TURN_ACTIVE_MS = 2 * 60 * 1000;
/** An owner whose window cannot be looked up (no window process number on its record) keeps the board against a board message only this long after its last sign of life. */
export const BOARD_OWNER_LIFE_MS = 10 * 60 * 1000;

/** The owner's last sign of life: the later of its own marks and its chat transcript being written; null when it left none. */
function ownerLastSeen(record) {
  const marks = [Date.parse(record?.activeAt ?? ''), Date.parse(record?.claimedAt ?? '')];
  if (typeof record?.transcript === 'string' && record.transcript) {
    try {
      marks.push(statSync(record.transcript).mtimeMs);
    } catch {
      // no transcript to look at; the window's own marks decide
    }
  }
  const seen = marks.filter(Number.isFinite);
  return seen.length ? Math.max(...seen) : null;
}

/**
 * Is this owner record a Claude window that is still there? A record that names its window's process (windowPid, on this computer)
 * is alive while that process is and the owner has been heard from within BOARD_OWNER_TTL_MS, and gone the moment it is not: a window
 * that was closed or crashed (nothing runs SessionEnd then) holds nothing. A record that cannot be looked up this way is alive only
 * while it showed a sign of life within BOARD_OWNER_LIFE_MS. No record is not alive.
 */
export function boardOwnerAlive(record, now = Date.now()) {
  if (!plainObject(record) || typeof record.sessionId !== 'string' || !record.sessionId) return false;
  if (holderGone(record)) return false;
  const seen = ownerLastSeen(record);
  if (seen === null) return false;
  const proven = record.host === hostname() && Number.isInteger(record.windowPid) && record.windowPid > 0;
  return now - seen <= (proven ? BOARD_OWNER_TTL_MS : BOARD_OWNER_LIFE_MS);
}

/** Who holds the board now, as written: null when nobody does. */
export function readBoardOwner(root) {
  const held = readJson(ownerPath(root));
  return plainObject(held) ? held : null;
}

/** What a window writes about itself on the board's owner record: its computer and its Claude window's process (when the host gives it). */
function windowMarks() {
  const pid = hookWindowPid();
  return { host: hostname(), ...(pid ? { windowPid: pid } : {}) };
}

/**
 * Is this owner record a window that is answering a board message right now? Its turn began on a board message and has not
 * ended (the Stop hook ends it), and the window showed life within BOARD_TURN_ACTIVE_MS: a hook of its own, or its chat
 * transcript being written. A window that has gone quiet, or never marked a turn (an older version), is not busy.
 */
export function boardTurnBusy(record, now = Date.now()) {
  if (!plainObject(record) || record.boardTurn !== true) return false;
  // A window that was closed answers nothing, however recently it wrote.
  if (holderGone(record)) return false;
  const marks = [Date.parse(record.activeAt ?? '')];
  if (typeof record.transcript === 'string' && record.transcript) {
    try {
      marks.push(statSync(record.transcript).mtimeMs);
    } catch {
      // no transcript to look at; the window's own marks decide
    }
  }
  const seen = marks.filter(Number.isFinite);
  return seen.length > 0 && now - Math.max(...seen) <= BOARD_TURN_ACTIVE_MS;
}

/**
 * The board has one owner window: the one the person is typing in. A window takes the board with {takeOver: true} when the
 * person starts or writes in it (a new chat, a resume, /clear, or any message of their own), unless the owner is busy
 * answering a board message right now (then {owner: false, by, busy: true}). Without takeOver a window takes the board only
 * while it is free or its owner has been silent for BOARD_OWNER_TTL_MS, and keeps what it holds. Only the owner arms the
 * board's wake-up; another window is told once, and only while the owner is really busy. An owner whose Claude window has closed
 * (its record names the window's process) holds nothing: any window takes the board at once. With {takeIfGone: true} (a board
 * message reached this window) the board is also taken from an owner that cannot be shown to be there (see boardOwnerAlive).
 * {owner: true} when this window owns it, else {owner: false, by, busy}. Without a session id nothing can be told apart, so the window is treated as the owner.
 */
export function claimBoardOwner(root, sessionId, { now = Date.now(), takeOver = false, takeIfGone = false } = {}) {
  if (!sessionId) return { owner: true, by: null };
  try {
    mkdirSync(dirname(ownerPath(root)), { recursive: true });
    const file = ownerPath(root);
    const id = String(sessionId);
    const marks = windowMarks();
    const held = readJson(file);
    const otherHolds = plainObject(held) && typeof held.sessionId === 'string' && held.sessionId !== id;
    if (takeOver || (takeIfGone && otherHolds && !boardOwnerAlive(held, now))) {
      if (takeOver && otherHolds && boardTurnBusy(held, now)) {
        return { owner: false, by: held.sessionId, busy: true };
      }
      const at = new Date(now).toISOString();
      writeJsonAtomic(file, { sessionId: id, pid: process.pid, ...marks, claimedAt: at, activeAt: at, boardTurn: false });
      return { owner: true, by: id };
    }
    const taken = takeClaim(file, id, { ttlMs: BOARD_OWNER_TTL_MS, now, extra: marks });
    if (!taken.claimed) return { owner: false, by: taken.owner?.sessionId ?? null, busy: boardTurnBusy(taken.owner, now) };
    // Still the owner: note that it is here, so a quiet owner is told apart from a gone one.
    const current = readJson(file);
    if (plainObject(current) && current.sessionId === id) {
      const changed = Object.keys(marks).some(key => current[key] !== marks[key]);
      if (changed || now - Date.parse(current.claimedAt ?? '') > 60 * 1000) writeJsonAtomic(file, { ...current, ...marks, claimedAt: new Date(now).toISOString() });
    }
    return { owner: true, by: id };
  } catch {
    return { owner: true, by: null };
  }
}

/**
 * Is the board held right now by a different window that is still within its claim? Read only, for the Stop hook: with no
 * owner on record, or an owner that was released or has been silent for BOARD_OWNER_TTL_MS, nothing is held, so this window is
 * not told to stand back. Without a session id nothing can be told apart, so the answer is no.
 */
export function boardHeldByOtherWindow(root, sessionId, now = Date.now()) {
  if (!sessionId) return false;
  try {
    const held = readJson(ownerPath(root));
    if (!plainObject(held) || typeof held.sessionId !== 'string' || held.sessionId === String(sessionId)) return false;
    // An owner whose Claude window has closed holds nothing.
    if (holderGone(held)) return false;
    const at = Date.parse(held.claimedAt ?? '');
    return Number.isFinite(at) && now - at <= BOARD_OWNER_TTL_MS;
  } catch {
    return false;
  }
}

/** Change the owner record, but only while this window still holds it (a newer window may have taken the board a moment ago). */
function updateOwnerRecord(root, sessionId, change) {
  if (!sessionId) return false;
  try {
    const current = readJson(ownerPath(root));
    if (!plainObject(current) || current.sessionId !== String(sessionId)) return false;
    writeJsonAtomic(ownerPath(root), { ...current, ...change(current) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The owner's turn begins or goes on: {board: true} when the turn answers a board message (the window is then busy until its
 * Stop hook ends the turn), {board: false} for the person's own message, no board value for anything else (the mark stays as
 * it was). Also records the window's chat transcript so its activity can be seen. Does nothing for a window that is not the owner.
 */
export function noteBoardTurn(root, sessionId, { board, transcript = null, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  return updateOwnerRecord(root, sessionId, () => ({
    claimedAt: at,
    activeAt: at,
    ...(typeof board === 'boolean' ? { boardTurn: board } : {}),
    ...(typeof transcript === 'string' && transcript ? { transcript } : {}),
  }));
}

/** A sign of life from the owner in the middle of a turn (a board tool call); written at most every 15 seconds. */
export function touchBoardWindow(root, sessionId, now = Date.now()) {
  const current = readJson(ownerPath(root));
  if (plainObject(current) && current.sessionId === String(sessionId) && now - Date.parse(current.activeAt ?? '') < 15 * 1000) return false;
  return noteBoardTurn(root, sessionId, { now });
}

/** The owner's turn is over (the Stop hook): it is no longer busy, so a message the person writes in another window takes the board. */
export function endBoardTurn(root, sessionId, now = Date.now()) {
  const at = new Date(now).toISOString();
  return updateOwnerRecord(root, sessionId, () => ({ claimedAt: at, activeAt: at, boardTurn: false }));
}

/** A window that ends gives the board back (only the owner can), so a window left open can pick it up again. It lets go of its jobs too. */
export function releaseBoardOwner(root, sessionId) {
  if (!sessionId) return false;
  try { releaseJobRunners(root, sessionId); } catch { /* a job claim left behind goes stale by itself */ }
  try { return releaseClaim(ownerPath(root), sessionId); } catch { return false; }
}

/** Give back every job this window holds as its Director (only the holder can). Returns how many were given back. */
export function releaseJobRunners(root, sessionId) {
  if (!sessionId) return 0;
  let count = 0;
  for (const job of listJobs(root)) {
    try {
      const file = jobClaimFile(job.dir);
      // The window's hook session id can be the second id on its claim (see stampJobClaimSession): it is the holder too.
      const held = readClaimRecord(file);
      if (releaseClaim(file, held?.hookSessionId === String(sessionId) ? held.sessionId : sessionId)) count += 1;
    } catch { /* the claim goes stale by itself */ }
  }
  return count;
}

/**
 * Is this job held right now by a different window that is still within its claim? Read only. Without a session id nothing can be told apart, so no.
 * A window holds the claim under its server's id and, once stamped (stampJobClaimSession), under the session id its hooks get: either one is the holder.
 */
export function jobHeldByOtherDirector(job, sessionId, now = Date.now()) {
  if (!sessionId || !job?.dir) return false;
  try {
    const held = liveClaim(jobClaimFile(job.dir), { ttlMs: JOB_CLAIM_TTL_MS, now });
    const id = String(sessionId);
    return Boolean(held) && held.sessionId !== id && held.hookSessionId !== id;
  } catch {
    return false;
  }
}

/**
 * After /clear, /resume or a fork the MCP server keeps the session id it started with (it holds the claim under it) while the hooks of
 * the same window get the new one. Call this right after a job tool succeeded in that window, with the hook's session id: it is written
 * on the job's live claim as a second id. A claim that is not live, or already carries this id, is left alone. Never takes a job.
 */
export function stampJobClaimSession(job, hookSessionId, now = Date.now()) {
  const id = typeof hookSessionId === 'string' ? hookSessionId.trim() : '';
  if (!id || !job?.dir) return false;
  const file = jobClaimFile(job.dir);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const held = liveClaim(file, { ttlMs: JOB_CLAIM_TTL_MS, now });
    if (!held || held.sessionId === id || held.hookSessionId === id) return false;
    writeFileSync(temp, JSON.stringify({ ...held, hookSessionId: id }));
    // A newer window may have taken the claim while this was written: check again just before replacing.
    if (readClaimRecord(file)?.sessionId !== held.sessionId) return false;
    renameReplacing(temp, file);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(temp, { force: true });
  }
}

/** True the first time this window is told which window owns the board, false after, so it is said once. */
export function noteOtherWindowOnce(root, sessionId, ownerId) {
  const key = String(sessionId || 'unknown');
  const current = readJson(toldPath(root));
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  if (sessions[key]?.owner === String(ownerId)) return false;
  sessions[key] = { owner: String(ownerId), at: new Date().toISOString() };
  try {
    writeJsonAtomic(toldPath(root), { sessions: pruned(sessions) });
  } catch {
    return false;
  }
  return true;
}

/**
 * The lines a starting window is told. A session start (startup, resume, clear) makes this window the board's owner, unless the
 * owner is answering a board message right now; then the window is only told where the board is and leaves it to the owner, until
 * the person writes here.
 */
export function boardSessionLines(root, sessionId) {
  try {
    const claim = claimBoardOwner(root, sessionId, { takeOver: true });
    const link = readBoardLink(root);
    if (!link) return [];
    const intro = `Social Campaign board (for Claude): this workspace's board is bound to ${link.url}.`;
    if (!claim.owner) return [intro];
    const waiting = landedRequestCount(root);
    const lines = [
      intro,
      boardSourceOutdated(link, root)
        ? 'The board page is out of date. Before replying, refresh it: call pipeline_board_source with the bound url, read the bound board with the Artifact tool, publish the returned page and files to the same url, then bind the new source as board-setup describes. If pipeline_board_source returns updateWaiting true, or no pluginVersion, publish nothing: Social Campaign was updated and this chat could not switch to it by itself, so tell the person once, in one plain line, to open a new chat.'
        : `Before replying, re-arm its wake-up: read ${link.url} with the Artifact tool, then republish that same page to the same url. Then list the board's saved requests and handle them through board-sync.`,
    ];
    if (waiting) {
      lines.push(`${waiting} board request${waiting === 1 ? ' is' : 's are'} already landed on this computer but not applied yet; handle ${waiting === 1 ? 'it' : 'them'} through board-sync too.`);
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * What a status reply adds when the plugin switched versions under a running chat and the board
 * page on the artifact is older than the new code. Only Claude can publish an artifact, so the
 * server cannot do it; it tells the Director to do it now, with no question to the person.
 */
export function boardRefreshNotice(outdated, version) {
  if (outdated !== true || version?.swapped !== true || version?.updateWaiting === true) return {};
  return { boardRefresh: { republishNow: true, ask: false, instruction: BOARD_TEXT.republish } };
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
  // A job run in chat without the board is left out. A chat that picked such a job has nothing for the board to track.
  if (sessionChatOnly(root, sessionId, jobs)) return [];
  return jobsOtherChatsLeave(root, sessionId, jobs.filter(job => !isChatOnlyJob(job)), now);
}

/** A job the person asked to run in chat without the board (chatOnly in its job record). */
export function isChatOnlyJob(job) {
  return Boolean(job?.dir) && readJson(join(job.dir, 'job.json'))?.chatOnly === true;
}

/** True when the job this chat picked runs in chat without the board. */
export function sessionChatOnly(root, sessionId, jobs = listJobs(root)) {
  const bound = sessionId ? readSessionBinding(root, sessionId) : null;
  return Boolean(bound) && jobs.some(job => job.brand === bound.brand && job.jobId === bound.jobId && isChatOnlyJob(job));
}

function jobsOtherChatsLeave(root, sessionId, jobs, now) {
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

const AGENT_ENDS = new Set(['finished', 'stopped', 'failed']);

/**
 * Jobs where an agent finished, stopped or failed after the board was last written: [{ref, at}] with the newest such line.
 * A start alone never counts. Nothing is reported while no board has been written (the behind check covers that).
 */
export function agentFinishes(root, jobs) {
  const written = Date.parse(readFreshness(root).published?.writtenAt ?? '');
  if (!Number.isFinite(written)) return [];
  const out = [];
  for (const job of jobs) {
    let newest = null;
    for (const line of readAgentLines(job.dir)) {
      const at = Date.parse(line.at ?? '');
      if (AGENT_ENDS.has(line.kind) && Number.isFinite(at) && at > written && (newest === null || at > newest)) newest = at;
    }
    if (newest !== null) out.push({ ref: jobRef(job), at: new Date(newest).toISOString() });
  }
  return out;
}

/** Jobs where the person's message to the Director has no reply yet: [{ref, ids}]. A message waiting for another agent's next step is not one. */
export function unansweredReplies(jobs) {
  const out = [];
  for (const job of jobs) {
    const ids = pendingMessages(job.dir, DIRECTOR).map(message => message.id);
    if (ids.length) out.push({ ref: jobRef(job), ids });
  }
  return out;
}

export const STUCK_RECENT_MS = 24 * 60 * 60 * 1000;
// Another Claude window that worked on a job this recently, and more recently than this one, is still the one carrying it on.
export const OTHER_WINDOW_MS = 30 * 60 * 1000;

/**
 * Stuck jobs whose question has not been asked yet: [{ref, kind, since}]. A problem on our side has no question to ask, so it never
 * counts. A job whose board already shows the person what is needed (an open question, a blocked reason, a Needs-you item, the same
 * answer personWaiting gives) has been asked, so it never counts either. Only a job bound to this session, or with activity in the
 * last 24 hours, counts: an old idle job never blocks a stop.
 */
function unaskedStuck(board, root, jobs, questions, sessionId, now = Date.now()) {
  try {
    if (typeof board?.stuckJobs !== 'function') return [];
    const bound = sessionId ? readSessionBinding(root, sessionId) : null;
    const mine = bound ? `${bound.brand}/${bound.jobId}` : null;
    const shown = ref => {
      const job = jobs.find(item => jobRef(item) === ref);
      return Boolean(job && typeof board.personWaiting === 'function' && waitingFor(board, root, job, questions));
    };
    return [...board.stuckJobs(root, jobs, { questions })]
      .filter(([ref, item]) => item.kind !== 'internal' && !item.asked && !shown(ref) && (ref === mine || (Number.isFinite(item.activeAt) && now - item.activeAt <= STUCK_RECENT_MS)))
      .map(([ref, item]) => ({ ref, kind: item.kind, since: item.since }));
  } catch {
    return [];
  }
}

// States where the next move is a person's answer or a problem to ask about, never plain work for Claude.
const NOT_YOUR_TURN = new Set(['BLOCKED', 'ESCALATED', 'UNSUPPORTED', 'NEEDS_CLARIFICATION']);

const stageWords = id => {
  const text = String(id).split('-').join(' ');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
};

/** The stage the job moves into next, in the words the board uses; a state that belongs to no stage gives its own label. */
function nextStageName(job, state) {
  const label = lifecycle?.label?.(state) || state;
  try {
    const stages = requireScript('lib-stages.js');
    const route = readJson(join(job.dir, 'route.json'));
    const workflowId = typeof route?.workflowId === 'string' ? route.workflowId : null;
    const here = stages?.forState(state, workflowId);
    if (!here) return label;
    const order = stages.walkedStages(null, workflowId, { route }) || (stages.isReportWorkflow(workflowId) ? stages.REPORT_STAGE_IDS : stages.STAGE_IDS);
    const at = order.indexOf(here.stage);
    return stageWords(here.status === 'done' && at >= 0 && at + 1 < order.length ? order[at + 1] : here.stage);
  } catch {
    return label;
  }
}

const TASK_ENDED = /^(?:completed|done|failed|killed|stopped|cancelled|canceled|error)$/i;

/** Does the Stop event list work still running in the background? */
const backgroundWork = tasks => Array.isArray(tasks) && tasks.some(task => !TASK_ENDED.test(String(task?.status ?? '')));

function hasOpenRun(lines, now) {
  return runsFrom(lines).some(run => {
    if (run.ended) return false;
    const began = Date.parse(run.startedAt ?? run.dispatchedAt ?? '');
    return !Number.isFinite(began) || now - began < STALE_RUN_MS;
  });
}

function lastActiveAt(job, lines) {
  let status = null;
  try {
    status = statSync(join(job.dir, 'status.md')).mtimeMs;
  } catch {
    status = null;
  }
  return Math.max(lastChangeAt({ dir: job.dir, lines }) ?? 0, status ?? 0) || null;
}

/**
 * Jobs that are Claude's to move on right now, with nobody to ask and no agent running: [{ref, jobId, title, state, revision, next}].
 * Only a job bound to this session, or active in the last 24 hours, counts. Needs the board to say nobody is waiting; without it nothing is reported.
 */
function yourTurnJobs(board, root, jobs, questions, sessionId, now = Date.now()) {
  try {
    if (typeof board?.personWaiting !== 'function') return [];
    const bound = sessionId ? readSessionBinding(root, sessionId) : null;
    const mine = bound ? `${bound.brand}/${bound.jobId}` : null;
    const bindings = sessionBindings(root, sessionId);
    const elsewhere = ref => {
      const ownAt = Math.max(0, ...bindings.filter(item => item.own && item.ref === ref && Number.isFinite(item.at)).map(item => item.at));
      return bindings.some(item => !item.own && item.ref === ref && Number.isFinite(item.at) && item.at > ownAt && now - item.at <= OTHER_WINDOW_MS);
    };
    const out = [];
    for (const job of jobs) {
      const state = job.state;
      if (!state || isFinishedState(state) || NOT_YOUR_TURN.has(state) || gateOfState(state) || lifecycle?.isDeliveryBoundary?.(state)) continue;
      if (handoffSent(job.dir)) continue; // with Post-production: waiting on them, not Claude's turn
      const ref = jobRef(job);
      const lines = readAgentLines(job.dir);
      const at = lastActiveAt(job, lines);
      if (ref !== mine && !(at !== null && now - at <= STUCK_RECENT_MS)) continue;
      // Another window that holds the job as its Director (a live claim, see runtime.takeJobRunner) is carrying it on.
      if (elsewhere(ref) || jobHeldByOtherDirector(job, sessionId, now)) continue;
      if (waitingFor(board, root, job, questions) || hasOpenRun(lines, now)) continue;
      const title = readJson(join(job.dir, 'job.json'))?.title;
      out.push({ ref, jobId: job.jobId, title: typeof title === 'string' && title.trim() ? title.trim() : job.jobId, state, revision: job.revision ?? 0, next: nextStageName(job, state) });
    }
    return out;
  } catch {
    return [];
  }
}

/** What Claude is told for jobs on its turn: one sentence per job. */
export const yourTurnReason = list => list
  .map(entry => `Job "${entry.title}" is waiting on you, Claude: its next step is "${entry.next}". Continue it now, or if something is missing, ask the person on the Director card and in chat.`)
  .join(' ');

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

export const CHAT_ASK_RECENT_MS = 10 * 60 * 1000;
const ENDS_IN_QUESTION = /\?[\s"')*_`\]]*$/;
const OPTION_LINE = /^\s*(?:[-*]\s*)?(?:\(?[1-9][.)]|\(?[A-Da-d][.)])\s+\S/;
const CHOOSE_CUE = /\b(?:choose|which|pick|reply with)\b/i;

/** Does a chat message ask the person something? It ends with a question mark, or offers two or more numbered or lettered options with a cue like "choose" or "pick". */
export function asksPerson(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return false;
  if (ENDS_IN_QUESTION.test(text)) return true;
  return text.split(/\r?\n/).filter(line => OPTION_LINE.test(line)).length >= 2 && CHOOSE_CUE.test(text);
}

/**
 * The question Claude just asked in chat that the job bound to this session does not have on its board card yet: {ref, jobId, hash}, else null.
 * "On the card" means an open question for the job asked in the last 10 minutes, or anything else the board already asks the person on
 * that job (a decision, the Post-production offer), which the chat question is about. Without the board's questions nothing is reported.
 */
function chatQuestion(root, jobs, questions, sessionId, message, waiting = new Set(), now = Date.now()) {
  try {
    if (!questions || !asksPerson(message)) return null;
    const bound = sessionId ? readSessionBinding(root, sessionId) : null;
    const job = bound ? jobs.find(item => item.brand === bound.brand && item.jobId === bound.jobId) : null;
    // While the job is with Post-production, its questions live on the Production Studio board, not on this Director card.
    if (!job || isFinishedState(job.state) || waiting.has(jobRef(job)) || handoffSent(job.dir)) return null;
    if ((questions.get(job.jobId) || []).some(question => now - Date.parse(question.askedAt ?? '') <= CHAT_ASK_RECENT_MS)) return null;
    return { ref: jobRef(job), jobId: job.jobId, hash: sha256(Buffer.from(String(message), 'utf8')) };
  } catch {
    return null;
  }
}

/**
 * What the stop hook looks at for these jobs. Each finding is worked out per job, so it can be
 * matched to the job that owns it; `waiting` holds the refs of jobs a person is needed on.
 */
export async function stopFindings(root, jobsIn = listJobs(root), { loadBoard: load = loadBoard, sessionId = null, lastMessage = null, backgroundTasks = null } = {}) {
  const allJobs = jobsIn.filter(job => !isChatOnlyJob(job));
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
  return {
    behind: boardBehind(root, allJobs), unsaved: unsavedOutputs(jobs), copies, waiting,
    agents: agentFinishes(root, jobs), replies: unansweredReplies(jobs), stuck: unaskedStuck(board, root, jobs, questions, sessionId),
    yourTurn: backgroundWork(backgroundTasks) ? [] : yourTurnJobs(board, root, jobs, questions, sessionId),
    chatAsk: chatQuestion(root, allJobs, questions, sessionId, lastMessage, waiting),
  };
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

export function claimStopBlock(root, sessionId, signature, at = new Date().toISOString()) {
  const file = boardPath(root, 'stop-hook.json');
  const current = readJson(file);
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  const key = String(sessionId || 'unknown');
  if (sessions[key]?.signature === signature) return false;
  sessions[key] = { ...sessions[key], signature, at };
  try {
    writeJsonAtomic(file, { sessions: pruned(sessions) });
  } catch {
    return false;
  }
  return true;
}

/**
 * Which board page version a republish order is about: the plugin's current board source (its hash and version label). A window
 * is told to republish once per version, so the same order never repeats on every turn; a newer plugin update is a new version.
 */
export function republishVersion(root) {
  try {
    return `${ARTIFACT_SOURCE_VERSION}:${currentBoardSourceHash(root) ?? ''}`;
  } catch {
    return ARTIFACT_SOURCE_VERSION;
  }
}

/** Has this window already been told to republish the board page of this version? Read only. */
export function republishTold(root, sessionId, version) {
  const current = readJson(boardPath(root, 'stop-hook.json'));
  return sessionMap(plainObject(current) ? current.sessions : null)[String(sessionId || 'unknown')]?.republish === version;
}

/** Remember that this window was told to republish the board page of this version (kept beside the Stop signature). */
export function recordRepublishTold(root, sessionId, version, at = new Date().toISOString()) {
  const file = boardPath(root, 'stop-hook.json');
  const current = readJson(file);
  const sessions = sessionMap(plainObject(current) ? current.sessions : null);
  const key = String(sessionId || 'unknown');
  sessions[key] = { ...sessions[key], republish: version, at: sessions[key]?.at ?? at };
  try {
    writeJsonAtomic(file, { sessions: pruned(sessions) });
    return true;
  } catch {
    return false;
  }
}
