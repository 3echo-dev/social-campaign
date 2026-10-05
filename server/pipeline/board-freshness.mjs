import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from '../../scripts/build-board.mjs';
import { factsFingerprint, isFinishedState, landingReport, listJobs, readSessionBinding, sessionBindings } from './facts.mjs';
import { STALE_RUN_MS, readAgentLines } from './agent-log.mjs';
import { lastChangeAt, runsFrom } from './agent-box.mjs';
import { DIRECTOR, pendingMessages } from './agent-messages.mjs';
import { handoffSent } from './handoff.mjs';

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
  agents: 'An agent finished since the board was written; call pipeline_board_job_documents for the jobs below and write them.',
  replies: 'The person left a message for the Director on the board. For each job below, answer it with pipeline_agent_reply, then write the documents it returns.',
  chatAsk: 'You asked the person something in chat. Put the same question, with the same options, on the Director card with pipeline_board_ask, publish the board, then stop.',
  stuck: 'A job is stuck and the person has not been asked yet. For each job below, ask them in one plain line with pipeline_board_ask, say the same line in chat, then carry on.',
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
      if (elsewhere(ref)) continue;
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
    if (!job || isFinishedState(job.state) || waiting.has(jobRef(job))) return null;
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
export async function stopFindings(root, allJobs = listJobs(root), { loadBoard: load = loadBoard, sessionId = null, lastMessage = null, backgroundTasks = null } = {}) {
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
