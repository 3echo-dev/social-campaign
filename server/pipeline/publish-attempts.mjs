/**
 * What was sent to Metricool for one job, and where each post stands.
 *
 * publish/metricool.jsonl is the job's log of sends. Lines are appended, never edited, and each has a unique id (`lid`):
 *   { lid, at, post, kind, ... }   `post` is the intent post id, for example "D1-instagram".
 *   reserved   written by the guard just before a create is allowed (so a crash cannot lose a send):
 *              mode 'create', tool, toolUseId, inputSha, fingerprint, scheduledAt, draft, autoPublish
 *   sent       the call answered: id, uuid (kept as text, and possibly negative), plannerUrl, providerStatus, mode,
 *              fingerprint (what the plan said when it was sent), scheduledAt, draft, autoPublish. When the person said
 *              it is in Metricool (resolveAmbiguous) it has source 'person' and no uuid.
 *   failed     Metricool refused before saving anything, with a known reason: error. It may be sent again.
 *   unknown    an error, a timeout or an unreadable reply: error. The post may or may not exist, so it is never sent
 *              again until it has been settled.
 *   ambiguous  reconcile could not find exactly one exact match in what Metricool listed: the post stays blocked until the
 *              person says whether it is in Metricool (resolveAmbiguous).
 *   not_found  only ever written for the person's answer "It is not in Metricool" (source 'person'). It is the one thing
 *              that lets a post be sent again after an unknown result: the plugin never decides that on its own.
 *   handed_over  Claude gave this post to the person to post themselves (the posting kit), because it cannot send it. Only
 *              written while nothing for the post is open, sent, unknown or ambiguous. The guard never sends a handed-over post.
 *   status     reconcile read it back from a captured listing: providerStatus, publicUrl, error, or missing:true when a
 *              listing captured after its time no longer shows it
 * `reserved` with no later sent, failed or not_found is unresolved, exactly like `unknown`: the call may have gone out.
 * A `sent` always wins: when the answer to a call arrives after the post was settled, it is still recorded.
 *
 * The log is kept twice: in the job's publish/ folder and in ~/.social-campaign/publish-log/<brand>/<jobId>-<creation>.jsonl,
 * outside the workspace, keyed by the brand folder and the job id alone. Every
 * write goes to both, under one lock. Every read merges the two by line id and puts back, in whichever file lacks them, the
 * lines it was missing, so deleting or cutting either file alone changes nothing. (Deleting both, say from a shell, is the
 * one thing this cannot see.)
 *
 * publish/listings.jsonl holds what Metricool's getScheduledPosts really returned (kept by a hook, never passed in by the
 * model): the brand asked for and each post's uuid, id, text, time and per-network status. Reconcile uses it only to find
 * a match and to read a status and a public link, so a forged line can at worst block a send or mislabel a status: it can
 * never allow one.
 *
 * publish/asset-reads.jsonl holds what 3echo said about a media file (get_asset, complete_asset_upload, list_assets), one
 * line per asset in a reply that carries a media link, written by the hook from the real reply: assetId, sizeBytes,
 * status, mimeType, workspaceId (only from the reply), hashes, urls (the sha256 of each media link, never the link),
 * expiresAt. The guard allows a create only when the links in the call are ones 3echo just returned for files whose size
 * is the approved size.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { globalConfigDir } from '../lib/paths.mjs';
import { jobAt } from './facts.mjs';
import { localDateTime, postLabel, validZone, whenText, zonedInstant } from './publish-preflight.mjs';
import { asObject, mediaAssetId, parseInfo } from './publish-tools.mjs';

export const ATTEMPT_LOG_FILE = 'publish/metricool.jsonl';
/** What 3echo said about media files, written by the hook (see above). Kept apart from the send log, which marks a job as sent once it has a line. */
export const ASSET_READS_FILE = 'publish/asset-reads.jsonl';
/** What getScheduledPosts returned, written by the hook (see above). */
export const LISTINGS_FILE = 'publish/listings.jsonl';
/** A post still pending this long after its time reads Late. */
export const LATE_AFTER_MS = 30 * 60 * 1000;
/** A reservation with no answer is only settled by reconcile after this long: its call may still be running. */
export const RESERVED_SETTLE_MS = 10 * 60 * 1000;
/** How close in time, on the same network, a listed post must be to count as this post (or as possibly it). */
export const MATCH_WINDOW_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 5000;
/** The person may only say a post is not in Metricool this long after its latest reservation or unknown result: the call may still be saving it. */
export const RESOLVE_WAIT_MS = 10 * 60 * 1000;
/** The posts the person marked as posted themselves (the posting kit), in the job's publish/ folder. */
export const POSTED_FILE = 'publish/posted.json';

/**
 * The ids of the posts the person marked as posted. A marked post is final: it is never sent. A missing file has none; a file
 * that cannot be read throws when `strict` (the send guard then refuses) and reads as none otherwise.
 */
export function readMarkedPosts(jobDir, { strict = false } = {}) {
  const file = join(jobDir, ...POSTED_FILE.split('/'));
  if (!existsSync(file)) return new Set();
  try {
    const marks = JSON.parse(readFileSync(file, 'utf8'));
    if (!plain(marks)) throw new Error('unreadable');
    return new Set(Object.entries(marks).filter(([, mark]) => plain(mark) && mark.source === 'person').map(([id]) => id));
  } catch (error) {
    if (strict) throw error;
    return new Set();
  }
}

export const POST_STATUSES = Object.freeze(['not_sent', 'handed_over', 'unconfirmed', 'needs_check', 'scheduled', 'draft', 'waiting_in_app', 'posted', 'failed', 'late', 'check_in_metricool']);

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');
const clip = (value, limit = 400) => String(value ?? '').slice(0, limit);

export const attemptsFile = jobDir => join(jobDir, ...ATTEMPT_LOG_FILE.split('/'));

// ---------------------------------------------------------------------------
// The log, kept in two places and merged
// ---------------------------------------------------------------------------

/**
 * The copy of this job's log kept outside the workspace, or null for a folder that is not a job (workspaces/<brand>/jobs/<id>).
 * It is keyed by the brand folder and the job id alone, which a person cannot change without moving the job: no field in the
 * workspace's config or the job's own record is read. Two jobs that collide can only block a send, never allow one.
 */
export function mirrorFile(jobDir) {
  const dir = resolve(jobDir);
  const parts = dir.split(sep);
  const at = parts.length - 4;
  if (at < 0 || parts[at] !== 'workspaces' || parts[parts.length - 2] !== 'jobs') return null;
  const key = createHash('sha256').update(`${parts[at + 1]}\n${basename(dir)}`).digest('hex').slice(0, 20);
  return join(globalConfigDir(), 'publish-log', parts[at + 1], `${basename(dir)}-${key}.jsonl`);
}

const lineKey = (raw, entry) => (entry && typeof entry.lid === 'string' && entry.lid ? entry.lid : `raw-${createHash('sha256').update(raw).digest('hex')}`);

/** Every non-empty line of a file as `{ raw, entry, id }` (`entry` is null for a line that is not a JSON object). A missing file is empty. */
function readSide(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()).map(raw => {
    let entry = null;
    try {
      const value = JSON.parse(raw);
      entry = plain(value) ? value : null;
    } catch { /* kept as a line that cannot be read */ }
    return { raw, entry, id: lineKey(raw, entry) };
  });
}

/**
 * The two sides as one list: every line from either, once by id, in order. Where both have a line the copy outside the
 * workspace is the one kept. A line only the copy has goes in right after the line before it in the copy.
 */
function mergeSides(job, copy) {
  const merged = [...job];
  const have = new Map(merged.map((line, index) => [line.id, index]));
  for (const line of copy) {
    if (have.has(line.id)) merged[have.get(line.id)] = line;
  }
  copy.forEach((line, index) => {
    if (have.has(line.id)) return;
    let after = -1;
    for (let back = index - 1; back >= 0; back -= 1) {
      if (have.has(copy[back].id)) { after = merged.findIndex(item => item.id === copy[back].id); break; }
    }
    merged.splice(after + 1, 0, line);
    have.clear();
    merged.forEach((item, position) => have.set(item.id, position));
  });
  return merged;
}

const sameLines = (a, b) => a.length === b.length && a.every((line, index) => line.raw === b[index].raw);

function writeWhole(file, lines) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, lines.map(line => `${line.raw}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Merge the two files and put right whichever one differs from the result. Needs the lock. Returns the merged lines. */
function settle(jobDir) {
  const file = attemptsFile(jobDir);
  const copy = mirrorFile(jobDir);
  const here = readSide(file);
  const there = copy ? readSide(copy) : [];
  const merged = copy ? mergeSides(here, there) : here;
  if (merged.length && !sameLines(merged, here)) writeWhole(file, merged);
  if (copy && merged.length && !sameLines(merged, there)) writeWhole(copy, merged);
  return merged;
}

/**
 * Every line of the log, oldest first, from the merge of the job's file and its copy outside the workspace, with either
 * file put right first if it lacked lines. With `strict`, a line that cannot be read, or a log that cannot be checked,
 * throws, so a guard fails closed instead of ignoring a reservation it cannot see.
 */
export function readAttempts(jobDir, { strict = false } = {}) {
  let merged;
  try {
    const copy = mirrorFile(jobDir);
    const here = readSide(attemptsFile(jobDir));
    const there = copy ? readSide(copy) : [];
    merged = copy ? mergeSides(here, there) : here;
    if (merged.length && (!sameLines(merged, here) || (copy && !sameLines(merged, there)))) merged = withLogLock(jobDir, () => settle(jobDir));
  } catch (error) {
    if (strict) throw error;
    merged = readSide(attemptsFile(jobDir));
  }
  if (strict && merged.some(line => !line.entry)) throw new Error('unreadable line');
  return merged.filter(line => line.entry).map(line => line.entry);
}

/** One line added to both files. Needs the lock. */
function appendLocked(jobDir, entry) {
  settle(jobDir);
  const file = attemptsFile(jobDir);
  const line = { lid: randomUUID(), at: new Date().toISOString(), ...entry };
  const raw = `${JSON.stringify(line)}\n`;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, raw, { encoding: 'utf8', flag: 'a' });
  const copy = mirrorFile(jobDir);
  if (copy) {
    mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
    appendFileSync(copy, raw, { encoding: 'utf8', flag: 'a' });
  }
  return line;
}

// Every write, and every read that puts a file right, is a read, a decision and an append that must not interleave with
// another run (two calls can be made at once), so it runs under a cross-process lock keyed by the log's path. Waiting for
// it is bounded: a lock that cannot be had in a few seconds throws, and the guard then refuses. It can be asked for again
// by code already holding it.
const held = new Set();

/** The lock's name: the job folder as it really is (links and short names expanded), lower-cased on Windows, so one folder is one lock whatever it is called. */
export function sendLockKey(jobDir) {
  let real;
  try {
    real = realpathSync.native(resolve(jobDir));
  } catch {
    real = resolve(jobDir);
  }
  return createHash('sha256').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex').slice(0, 40);
}

function lockedBy(name, jobDir, work) {
  const key = name ? `${sendLockKey(jobDir)}-${name}` : sendLockKey(jobDir);
  if (held.has(key)) return work();
  const dir = join(tmpdir(), 'social-campaign-publish-locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(join(dir, `${key}.db`));
  try {
    lock.exec(`PRAGMA busy_timeout = ${LOCK_WAIT_MS}; BEGIN IMMEDIATE;`);
    held.add(key);
    const result = work();
    lock.exec('COMMIT');
    return result;
  } finally {
    held.delete(key);
    lock.close();
  }
}

function withLogLock(jobDir, work) {
  return lockedBy('', jobDir, work);
}

/**
 * Run `work` while holding the job's close lock, a lock apart from the send lock. Closing a job spawns scripts that take seconds, so
 * it holds this one for that long and takes the send lock only for the short checks and writes inside it: a send is never held up
 * by a close. Waiting for it is bounded, like the send lock; a close already running makes the second one throw.
 */
export function withCloseLock(root, brand, jobId, work) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new Error('This job could not be found.');
  return lockedBy('close', job.dir, work);
}

/** One line added to the log, under the lock, to the job's file and to its copy. */
export function appendAttempt(jobDir, entry) {
  return withLogLock(jobDir, () => appendLocked(jobDir, entry));
}

/**
 * Whether anything counts as sent for this job, read from the merged log (a file lost on either side changes nothing). A
 * post counts while its latest state is sent, a reservation still waiting for its answer, an unknown result or an
 * ambiguous one. A post whose attempt ended in a clean refusal made before anything was saved (failed), or that the person
 * said is not in Metricool (not_found), counts for nothing: it can be fixed and approved again. A log that cannot be read
 * counts as "something was sent".
 */
export function hasSendRecords(jobDir) {
  try {
    const entries = readAttempts(jobDir, { strict: true });
    const posts = new Set(entries.filter(entry => typeof entry.post === 'string' && entry.post).map(entry => entry.post));
    for (const post of posts) {
      const state = attemptState(entries, post);
      if (state.sent || state.pending || state.ambiguous || state.handedOver) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Run `work` while holding the lock every reservation and every log write takes, so nothing can be reserved between a check
 * made inside `work` and the change it guards (taking a plan back to the posting decision, for one). `work` must be quick:
 * a send that cannot get the lock within a few seconds is refused. Asking for it again from inside `work` is fine.
 */
export function withSendLock(root, brand, jobId, work) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new Error('This job could not be found.');
  return withLogLock(job.dir, work);
}

/**
 * Reserve a send: under the lock, `decide(entries)` returns a plain sentence to refuse or null to go ahead, and the
 * reservation is appended in the same step. Returns `{ ok: true, entry }` or `{ ok: false, reason }`.
 */
export function reserveAttempt(jobDir, entry, decide) {
  return withLogLock(jobDir, () => {
    const refusal = decide(readAttempts(jobDir, { strict: true }));
    if (refusal) return { ok: false, reason: refusal };
    return { ok: true, entry: appendLocked(jobDir, { ...entry, kind: 'reserved' }) };
  });
}

// ---------------------------------------------------------------------------
// One post's state
// ---------------------------------------------------------------------------

/**
 * Where one post stands, read from the log:
 *   sent     the send that answered, or null
 *   pending  a reservation or an unknown result with no answer yet, or null
 *   failed   the last clear refusal when nothing was sent, else null
 *   status   the latest read-back after the last send, or null
 */
export function attemptState(entries, postId) {
  const state = { entries: 0, sent: null, pending: null, failed: null, status: null, notFound: false, ambiguous: null, handedOver: null };
  for (const entry of entries) {
    if (entry.post !== postId) continue;
    state.entries += 1;
    switch (entry.kind) {
      case 'reserved':
        state.pending = { ...entry, reservedAt: entry.at };
        state.notFound = false;
        state.ambiguous = null;
        break;
      case 'unknown':
        state.pending = { ...(state.pending || {}), ...entry, kind: 'unknown' };
        break;
      case 'sent':
        state.sent = { ...(state.sent || {}), ...entry };
        state.pending = null;
        state.failed = null;
        state.status = null;
        state.notFound = false;
        state.ambiguous = null;
        break;
      case 'failed':
        state.pending = null;
        state.failed = entry;
        state.ambiguous = null;
        break;
      case 'not_found':
        state.pending = null;
        state.notFound = true;
        state.ambiguous = null;
        break;
      case 'ambiguous':
        state.ambiguous = entry;
        break;
      case 'handed_over':
        state.handedOver = entry;
        break;
      case 'status':
        state.status = entry;
        break;
      default:
        break;
    }
  }
  return state;
}

const sortKeys = value => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  return value;
};

/** The same digest for the guard and for the hook that records the answer: the call's input with its info read as JSON. */
export function inputDigest(toolInput) {
  const input = asObject(toolInput);
  const parsed = parseInfo(input);
  return createHash('sha256').update(JSON.stringify(sortKeys(parsed.info ? { ...input, info: parsed.info } : input))).digest('hex');
}

/**
 * A fingerprint of what a post says in the approved plan: its network, type, text, title, first comment, time,
 * switches and the checksums of its files. A post whose approved plan changed after it was sent shows as changed on the board.
 */
export function postFingerprint(post) {
  const media = (Array.isArray(post?.media) ? post.media : []).map(item => item?.sha256 ?? null);
  return createHash('sha256').update(JSON.stringify(sortKeys({
    platform: post?.platform ?? null,
    type: post?.type ?? null,
    text: post?.text ?? '',
    title: post?.title ?? null,
    firstComment: post?.firstComment ?? '',
    publicationDate: post?.publicationDate ?? null,
    autoPublish: post?.autoPublish ?? null,
    draft: Boolean(post?.draft),
    aiGenerated: Boolean(post?.aiGenerated),
    tiktok: post?.tiktok ?? null,
    media,
  }))).digest('hex');
}

/** When the post is meant to go out (ms since 1970): the plan's time, else the time the send recorded, else null. */
export function plannedInstant(post, state) {
  const planned = post?.publicationDate ? zonedInstant(post.publicationDate.dateTime, post.publicationDate.timezone) : null;
  if (planned !== null) return planned;
  const recorded = Date.parse(state?.sent?.scheduledAt || state?.pending?.scheduledAt || '');
  return Number.isFinite(recorded) ? recorded : null;
}

// ---------------------------------------------------------------------------
// What came back from Metricool
// ---------------------------------------------------------------------------

const PUBLISHED = /^(PUBLISHED|POSTED|SENT)$/i;
const FAILED = /ERROR|FAIL|REJECT|DENIED/i;

const providersOf = item => (Array.isArray(item?.providers) ? item.providers : Array.isArray(item?.networks) ? item.networks : []).filter(plain);

/** The first provider status in a created post, upper case, or null. */
function providerStatusOf(item, network = null) {
  const providers = providersOf(item);
  const mine = network ? providers.find(provider => text(provider.network).toLowerCase() === network) : null;
  const chosen = mine || providers.find(provider => text(provider.status)) || null;
  const status = text(chosen?.status) || text(item?.status);
  return status ? status.toUpperCase() : null;
}

/** The created post inside a Metricool reply, tolerant of the reply being wrapped. */
export function createdPost(data) {
  if (!plain(data)) return null;
  const candidates = [data, data.post, data.data, data.result, data.scheduledPost, data.created];
  if (Array.isArray(data.posts)) candidates.push(data.posts[0]);
  if (Array.isArray(data.data)) candidates.push(data.data[0]);
  return candidates.find(item => plain(item) && item.uuid !== undefined && item.uuid !== null && text(String(item.uuid))) || null;
}

/**
 * What to keep from a successful create reply: `{ id, uuid, plannerUrl, providerStatus }`, or null. The ids are
 * kept as text; the hook parses the reply with long ids kept as text (parseBigSafe), so none is rounded.
 */
export function sentFacts(data, network = null) {
  const post = createdPost(data);
  if (!post) return null;
  const planner = text(post.plannerUrl) || text(post.plannerURL) || text(post.url);
  return {
    id: post.id !== undefined && post.id !== null ? String(post.id) : null,
    uuid: String(post.uuid),
    plannerUrl: /^https:\/\//i.test(planner) ? planner : null,
    providerStatus: providerStatusOf(post, network),
  };
}

// A reply that is an error leaves the post unknown (it may have been saved before the error), unless the message is a
// known refusal that happens before anything is saved. A timeout, a dropped connection or an interrupted call is unknown.
const PRE_SAVE = [
  /\b(?:title|text|caption|network|provider|date|time|blog\s?id|media)\b[^.\n]{0,40}\b(?:is|are) required\b/i,
  /\bmissing required\b/i,
  /\brequired (?:field|parameter)\b/i,
  /\bmust not be empty\b/i,
  /\bscheduled posts? (?:limit|cap)\b/i,
];

/** 'failed' only when the text is a known refusal made before anything was saved, otherwise 'unknown'. */
export function classifyFailure(message, interrupted = false) {
  const said = String(message ?? '');
  if (interrupted || !said.trim()) return 'unknown';
  return PRE_SAVE.some(pattern => pattern.test(said)) ? 'failed' : 'unknown';
}

// ---------------------------------------------------------------------------
// Recording the answer
// ---------------------------------------------------------------------------

/**
 * The reservation this tool call made, `{ ...line, open }`, or null. It is found by tool use id across the whole log (the
 * answer may arrive after reconcile settled the post), else by the digest of the input among the reservations still open.
 * `open` says whether the reservation has no answer yet.
 */
export function findReservation(entries, { toolUseId = null, inputSha = null } = {}) {
  const open = new Map();
  for (const entry of entries) {
    if (!entry.post) continue;
    if (entry.kind === 'reserved') open.set(entry.post, entry);
    else if (['sent', 'failed', 'not_found'].includes(entry.kind)) open.delete(entry.post);
  }
  const isOpen = entry => open.get(entry.post) === entry;
  const reserved = entries.filter(entry => entry.kind === 'reserved' && entry.post);
  const byId = toolUseId ? [...reserved].reverse().find(entry => entry.toolUseId === toolUseId) : null;
  if (byId) return { ...byId, open: isOpen(byId) };
  const byDigest = inputSha ? [...reserved].reverse().find(entry => isOpen(entry) && entry.inputSha === inputSha) : null;
  return byDigest ? { ...byDigest, open: true } : null;
}

/**
 * Record how a send ended, for the reservation that made it. `outcome` is one of
 *   { kind: 'sent', facts }       a readable reply (see sentFacts): always recorded, even after reconcile settled the post
 *   { kind: 'failed', error }     a known refusal made before anything was saved
 *   { kind: 'unknown', error }    an error, a timeout or a reply that could not be read
 * A failed or unknown result is only recorded while the reservation is still waiting for an answer, so it never undoes a
 * post that was found. Returns the line written, or null.
 */
export function recordOutcome(jobDir, reservation, outcome) {
  if (!reservation) return null;
  const base = { post: reservation.post, mode: reservation.mode || 'create', toolUseId: reservation.toolUseId ?? null };
  if (outcome.kind === 'sent') {
    return appendAttempt(jobDir, {
      ...base,
      kind: 'sent',
      ...outcome.facts,
      uuid: outcome.facts.uuid || reservation.uuid || null,
      fingerprint: reservation.fingerprint ?? null,
      scheduledAt: reservation.scheduledAt ?? null,
      draft: reservation.draft ?? null,
      autoPublish: reservation.autoPublish ?? null,
      network: reservation.network ?? null,
    });
  }
  if (reservation.open === false) return null;
  return appendAttempt(jobDir, { ...base, kind: outcome.kind, error: clip(outcome.error) });
}

// ---------------------------------------------------------------------------
// Captured listings
// ---------------------------------------------------------------------------

const FRACTION = /(\d{2}:\d{2}:\d{2})\.\d+/;
const OFFSET_END = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const LISTING_LIMIT = 1000;

/** The moment a listed post is set for (ms), reading fractional seconds, an offset or a zone; null when it cannot be told. */
function listedInstant(item) {
  const pd = item.publicationDate;
  if (plain(pd) && typeof pd.dateTime === 'string') {
    const clean = pd.dateTime.trim().replace(FRACTION, '$1').replace(' ', 'T');
    if (OFFSET_END.test(clean)) {
      const parsed = Date.parse(clean);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return zonedInstant(clean, typeof pd.timezone === 'string' ? pd.timezone : null);
  }
  for (const value of [typeof pd === 'string' ? pd : null, typeof item.date === 'string' ? item.date : null]) {
    if (value && OFFSET_END.test(value.trim())) {
      const parsed = Date.parse(value.trim().replace(' ', 'T'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/** The list inside a getScheduledPosts reply, or null when the reply has none (an empty list is a list). */
function replyList(data) {
  if (Array.isArray(data)) return data;
  if (!plain(data)) return null;
  return [data.posts, data.data, data.items, data.scheduledPosts, data.results].find(Array.isArray) ?? null;
}

/** One listed post, trimmed to what reconcile reads. */
function listedItem(raw) {
  const providers = providersOf(raw).map(provider => {
    const status = text(provider.status).toUpperCase() || null;
    const error = text(provider.error) || text(provider.errorMessage) || text(provider.detailedStatus) || text(raw.error);
    const publicUrl = text(provider.publicUrl) || text(raw.publicUrl);
    return {
      network: text(provider.network).toLowerCase(),
      status,
      publicUrl: /^https:\/\//i.test(publicUrl) ? publicUrl : null,
      error: error && FAILED.test(status || '') ? clip(error) : null,
    };
  }).filter(provider => provider.network);
  const planner = text(raw.plannerUrl) || text(raw.plannerURL);
  return {
    uuid: raw.uuid !== undefined && raw.uuid !== null ? String(raw.uuid) : null,
    id: raw.id !== undefined && raw.id !== null ? String(raw.id) : null,
    text: typeof raw.text === 'string' ? clip(raw.text, 20000) : null,
    providers,
    instant: listedInstant(raw),
    plannerUrl: /^https:\/\//i.test(planner) ? planner : null,
  };
}

/**
 * Keep what a getScheduledPosts reply said, with the brand it was asked for (`brandId`). Written only by the hook, from the
 * real call and reply. Returns the line, or null when the reply held no list.
 */
export function recordListing(jobDir, data, toolInput) {
  const list = replyList(data);
  if (!list) return null;
  const input = asObject(toolInput);
  const blog = input.brandId ?? input.blogId;
  const file = join(jobDir, ...LISTINGS_FILE.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  const line = {
    at: new Date().toISOString(),
    blogId: typeof blog === 'string' || typeof blog === 'number' ? String(blog) : null,
    posts: list.filter(plain).slice(0, LISTING_LIMIT).map(listedItem),
  };
  appendFileSync(file, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' });
  return line;
}

/** Every captured listing, oldest first. A missing or unreadable file is empty: nothing was captured. */
export function readListings(jobDir) {
  let raw;
  try {
    raw = readFileSync(join(jobDir, ...LISTINGS_FILE.split('/')), 'utf8');
  } catch {
    return [];
  }
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    try {
      const value = line.trim() ? JSON.parse(line) : null;
      if (plain(value) && Array.isArray(value.posts)) lines.push(value);
    } catch { /* a bad line proves nothing */ }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/** Text as a person reads it: line breaks and runs of spaces folded, so a different wrapping is the same text. */
export const foldText = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && foldText(a) === foldText(b);

function statusLine(post, item) {
  const provider = item.providers.find(entry => entry.network === post.platform) || item.providers[0] || {};
  return {
    id: item.id,
    uuid: item.uuid,
    providerStatus: provider.status ?? null,
    publicUrl: provider.publicUrl ?? null,
    error: provider.error ?? null,
    plannerUrl: item.plannerUrl,
  };
}

const sameStatus = (previous, next) => Boolean(previous) && (previous.providerStatus ?? null) === (next.providerStatus ?? null)
  && (previous.publicUrl ?? null) === (next.publicUrl ?? null) && (previous.error ?? null) === (next.error ?? null) && Boolean(previous.missing) === Boolean(next.missing);

/** The listings that are about this brand and were captured after `after` (ms). */
const usable = (listings, blogId, after) => listings.filter(listing => String(listing.blogId ?? '') === String(blogId ?? '') && Date.parse(listing.at) >= after);

/** The newest version of each listed post (by uuid) across the listings, oldest listing first. */
function newest(listings) {
  const byUuid = new Map();
  const anonymous = [];
  for (const listing of listings) {
    for (const item of listing.posts) {
      if (item.uuid) byUuid.set(item.uuid, item);
      else anonymous.push(item);
    }
  }
  return [...byUuid.values(), ...anonymous];
}

const near = (post, instant, items) => items.filter(item => item.providers.some(provider => provider.network === post.platform)
  && (item.instant === null || (instant !== null && Math.abs(item.instant - instant) <= MATCH_WINDOW_MS)));

/**
 * Settle what Metricool holds for the job's posts from the listings the hook captured. The plugin never decides on its own
 * that a post is safe to send again.
 *   - A create with no known result (unknown, or reserved for over 10 minutes) is found, and recorded as `sent`, only when
 *     exactly one listed post is on the same network within 10 minutes of its time and has its text (line breaks and
 *     spacing folded). Anything else is `ambiguous`: a near post with other text, a second one, or nothing near it at
 *     all, an empty listing included. It stays blocked until the person says whether it is in Metricool
 *     (resolveAmbiguous). With no listing captured since the send it stays `no_listing`.
 *   - A sent post is matched by its uuid and its latest status is recorded; once its time has passed and a listing
 *     captured after that time no longer shows it, `status` records missing:true.
 * Returns `{ results: [{ id, outcome }], changed }`.
 */
export function reconcilePosts({ jobDir, intent, now = Date.now() }) {
  const listings = readListings(jobDir);
  return withLogLock(jobDir, () => {
    const entries = readAttempts(jobDir, { strict: true });
    const results = [];
    let changed = 0;
    for (const post of Array.isArray(intent?.posts) ? intent.posts : []) {
      const state = attemptState(entries, post.id);
      const say = outcome => results.push({ id: post.id, outcome });
      if (!state.entries) { say('no_attempt'); continue; }
      const append = line => { appendLocked(jobDir, { post: post.id, ...line }); changed += 1; };
      const instant = plannedInstant(post, state);
      if (state.pending) {
        const reservation = state.pending;
        const reservedAt = Date.parse(reservation.reservedAt || reservation.at);
        if (reservation.kind === 'reserved' && now < reservedAt + RESERVED_SETTLE_MS) { say('still_sending'); continue; }
        const mine = usable(listings, intent.blogId, reservedAt);
        if (!mine.length) { say('no_listing'); continue; }
        const close = near(post, instant, newest(mine));
        const exact = close.filter(item => sameText(item.text, post.text));
        if (close.length === 1 && exact.length === 1 && exact[0].instant !== null) {
          append({ kind: 'sent', mode: 'create', ...statusLine(post, exact[0]), fingerprint: reservation.fingerprint ?? null, scheduledAt: reservation.scheduledAt ?? null, draft: reservation.draft ?? null, autoPublish: reservation.autoPublish ?? null, network: post.platform, via: 'reconcile' });
          say('sent');
        } else {
          if (!state.ambiguous) append({ kind: 'ambiguous', mode: 'create', via: 'reconcile', plannerUrl: close.length === 1 ? close[0].plannerUrl : null });
          say('ambiguous');
        }
        continue;
      }
      if (!state.sent) { say('no_attempt'); continue; }
      if (!state.sent.uuid) { say('confirmed_by_person'); continue; }
      const sentAt = Date.parse(state.sent.at);
      const mine = usable(listings, intent.blogId, Number.isFinite(sentAt) ? sentAt : 0);
      const latest = [...mine].reverse().map(listing => listing.posts.find(item => item.uuid === String(state.sent.uuid))).find(Boolean);
      const last = state.status || { providerStatus: state.sent.providerStatus ?? null, publicUrl: state.sent.publicUrl ?? null, error: null, missing: false };
      if (latest) {
        const next = statusLine(post, latest);
        if (sameStatus(last, next) && (state.sent.id === next.id || !next.id)) say('unchanged');
        else { append({ kind: 'status', ...next }); say('status'); }
        continue;
      }
      const passed = instant !== null && now >= instant;
      const seenAfter = instant !== null && mine.some(listing => Date.parse(listing.at) >= instant);
      if (!passed || !seenAfter) say(mine.length ? 'not_listed_yet' : 'no_listing');
      else if (state.status?.missing) say('unchanged');
      else {
        append({ kind: 'status', uuid: state.sent.uuid ?? null, missing: true, providerStatus: state.sent.providerStatus ?? null, publicUrl: null, error: null });
        say('missing');
      }
    }
    return { results, changed };
  });
}

/** The zone the plan speaks in for this post: its own, else any post's, else UTC. */
function planZone(intent, post) {
  const zones = [post?.publicationDate?.timezone, ...(Array.isArray(intent?.posts) ? intent.posts : []).map(item => item?.publicationDate?.timezone), intent?.timezone];
  return zones.find(zone => typeof zone === 'string' && validZone(zone)) || 'UTC';
}

/**
 * Give one post of a frozen Metricool plan to the person to post themselves (it appears in the posting kit). Claude does this only
 * for a post it cannot send: a refusal it cannot fix, an expired Post now approval, or the person asking. It is written under the
 * send lock and refused while anything for the post is open: a reservation or an unknown result (it may be in Metricool), an
 * ambiguous one, or a post that was sent. Handing over twice is harmless. From then on the guard never sends this post.
 * Returns `{ ok: true, already? }`; throws a plain sentence when it cannot be done.
 */
export function handOverPost({ root, brand, jobId, postId }) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new Error('This job could not be found.');
  return withLogLock(job.dir, () => {
    let intent = null;
    try { intent = JSON.parse(readFileSync(join(job.dir, 'publish', 'intent.json'), 'utf8')); } catch { intent = null; }
    if (!plain(intent) || !String(intent.route || '').startsWith('metricool_') || !(Array.isArray(intent.posts) && intent.posts.some(post => plain(post) && post.id === postId))) throw new Error('This post is not part of a Metricool plan for this job.');
    const state = attemptState(readAttempts(job.dir, { strict: true }), postId);
    if (state.sent) throw new Error('This post already went to Metricool, so it is changed there and cannot be handed over.');
    if (state.pending || state.ambiguous) throw new Error('This post may already be in Metricool, so it cannot be handed over until that is settled.');
    if (state.handedOver) return { ok: true, already: true };
    appendLocked(job.dir, { post: postId, kind: 'handed_over', source: 'claude' });
    return { ok: true };
  });
}

/** The id of the latest line of the log for this post, whatever its kind, or null. */
export function latestLid(entries, postId) {
  for (let index = entries.length - 1; index >= 0; index -= 1) if (entries[index].post === postId) return typeof entries[index].lid === 'string' ? entries[index].lid : null;
  return null;
}

/** When the person may say a waiting post is not in Metricool: `{ at (ISO), text (the time in the plan's zone) }`, or null once it is time. */
function checkAfterFor(state, intent, post, now) {
  const since = Date.parse(state?.pending?.at || '');
  if (!Number.isFinite(since) || now >= since + RESOLVE_WAIT_MS) return null;
  const at = since + RESOLVE_WAIT_MS;
  const zone = planZone(intent, post);
  return { at: new Date(at).toISOString(), text: whenText({ dateTime: localDateTime(at, zone), timezone: zone }) };
}

/**
 * The person's answer for a post that reconcile could not tell apart from something in Metricool: "It is in Metricool"
 * (answer 'in_metricool') records it as sent, with no uuid and source 'person'; "It is not in Metricool"
 * (answer 'not_in_metricool') records it as not found, so it may be sent again. This is the only way a post with no known
 * result can be sent again, and it is only taken 10 minutes after the post's latest reservation or unknown result, since the
 * call may still be saving it; before that it throws "Metricool may still be saving this post. Check again after <time>."
 * Only a post that is currently ambiguous can be answered. The same requestId is recorded once; replayed for a later send
 * of the same post it is refused. Throws a plain sentence when it cannot be applied.
 * Returns `{ ok: true, outcome: 'sent' | 'not_found', already?: true }`.
 */
export function resolveAmbiguous({ root, brand, jobId, postId, answer, requestId = null, lid = null, now = Date.now() }) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new Error('This job could not be found.');
  if (answer !== 'in_metricool' && answer !== 'not_in_metricool') throw new Error('Say whether the post is in Metricool.');
  return withLogLock(job.dir, () => {
    const entries = readAttempts(job.dir, { strict: true });
    const state = attemptState(entries, postId);
    const rid = requestId === null || requestId === undefined ? null : String(requestId).slice(0, 200);
    const lastIndex = predicate => { for (let index = entries.length - 1; index >= 0; index -= 1) if (predicate(entries[index])) return index; return -1; };
    const answered = rid ? lastIndex(entry => entry.post === postId && entry.source === 'person' && entry.requestId === rid) : -1;
    if (answered >= 0) {
      if (answered > lastIndex(entry => entry.post === postId && entry.kind === 'reserved')) return { ok: true, outcome: entries[answered].kind, already: true };
      throw new Error('That answer was already used for an earlier send of this post. Answer again for this one.');
    }
    if (!state.pending || !state.ambiguous) throw new Error('This post is not waiting for your answer.');
    // The answer is for the attempt the person was asked about: when the post has moved on since (sent again, settled by
    // another read), the answer is refused and they are asked again.
    if (lid !== null && lid !== undefined && latestLid(entries, postId) !== String(lid)) throw new Error('This post changed after you were asked. Look at the board again and answer for what it shows now.');
    const reservation = state.pending;
    if (answer === 'not_in_metricool') {
      let intent = null;
      try { intent = JSON.parse(readFileSync(join(job.dir, 'publish', 'intent.json'), 'utf8')); } catch { intent = null; }
      const post = (Array.isArray(intent?.posts) ? intent.posts : []).find(item => item?.id === postId);
      const wait = checkAfterFor(state, intent, post, now);
      if (wait) throw new Error(`Metricool may still be saving this post. Check again after ${wait.text}.`);
      appendLocked(job.dir, { post: postId, kind: 'not_found', mode: reservation.mode || 'create', source: 'person', requestId: rid });
      return { ok: true, outcome: 'not_found' };
    }
    appendLocked(job.dir, {
      post: postId,
      kind: 'sent',
      mode: reservation.mode || 'create',
      source: 'person',
      requestId: rid,
      id: null,
      uuid: null,
      plannerUrl: null,
      providerStatus: null,
      fingerprint: reservation.fingerprint ?? null,
      scheduledAt: reservation.scheduledAt ?? null,
      draft: reservation.draft ?? null,
      autoPublish: reservation.autoPublish ?? null,
      network: reservation.network ?? null,
    });
    return { ok: true, outcome: 'sent' };
  });
}

// ---------------------------------------------------------------------------
// Status for the board
// ---------------------------------------------------------------------------

function statusFor(post, state, now) {
  if (!state.entries) return { status: 'not_sent' };
  const sent = state.sent;
  // Said by the person, with nothing from Metricool to read back: the board points them to the post in Metricool.
  if (sent && !sent.uuid) return { status: 'check_in_metricool', plannerUrl: sent.plannerUrl ?? null, publicUrl: null };
  if (sent) {
    const providerStatus = (state.status?.providerStatus ?? sent.providerStatus ?? '').toUpperCase();
    const publicUrl = state.status?.publicUrl ?? sent.publicUrl ?? null;
    const plannerUrl = sent.plannerUrl ?? null;
    const base = { plannerUrl, publicUrl: null };
    if (PUBLISHED.test(providerStatus)) return { ...base, status: 'posted', publicUrl };
    if (FAILED.test(providerStatus) || state.status?.error) {
      return { ...base, status: 'failed', reason: clip(state.status?.error || 'Metricool could not publish this post.') };
    }
    if (state.status?.missing) return { ...base, status: 'check_in_metricool' };
    if (state.pending) return { ...base, status: 'unconfirmed' };
    if (sent.draft === true) return { ...base, status: 'draft' };
    if (sent.autoPublish === false) return { ...base, status: 'waiting_in_app' };
    const instant = plannedInstant(post, state);
    if (instant !== null && now > instant + LATE_AFTER_MS) return { ...base, status: 'late' };
    return { ...base, status: 'scheduled' };
  }
  if (state.handedOver && !state.pending) return { status: 'handed_over' };
  if (state.pending && state.ambiguous) return { status: 'needs_check', plannerUrl: state.ambiguous.plannerUrl ?? null, publicUrl: null };
  if (state.pending) return { status: 'unconfirmed' };
  if (state.failed) return { status: 'failed', reason: clip(state.failed.error || 'Metricool turned this post down.') };
  return { status: 'not_sent' };
}

/**
 * Where each post of a Metricool job stands, for the board:
 *   { route, allSent, posts: [{ id, label, status, when, plannerUrl, publicUrl, reason, planChanged }] }
 * status is one of POST_STATUSES: not_sent, unconfirmed (sent with no answer yet, look it up), scheduled, draft,
 * waiting_in_app (automatic publishing is off, the person finishes it in the app), posted (with publicUrl), failed
 * (with reason), late (still pending 30 minutes after its time) or check_in_metricool (no longer listed after its time).
 * Null when the job has no Metricool plan or nothing was sent yet.
 */
export function projectPublishStatus({ jobDir, intent, now = Date.now() }) {
  if (!plain(intent) || !String(intent.route || '').startsWith('metricool_') || !Array.isArray(intent.posts)) return null;
  const entries = readAttempts(jobDir);
  if (!entries.length) return null;
  const posts = intent.posts.filter(plain).map(post => {
    const state = attemptState(entries, post.id);
    const result = statusFor(post, state, now);
    const instant = plannedInstant(post, state);
    const row = {
      id: post.id,
      label: postLabel(post),
      status: result.status,
      when: post.publicationDate ? whenText(post.publicationDate) : null,
      plannerUrl: result.plannerUrl ?? null,
      publicUrl: result.publicUrl ?? null,
      reason: result.reason ?? null,
      planChanged: Boolean(state.sent && state.sent.fingerprint && state.sent.fingerprint !== postFingerprint(post)),
      checkAfter: result.status === 'needs_check' ? checkAfterFor(state, intent, post, now) : null,
      // The attempt a needs_check answer is for (resolveAmbiguous refuses an answer for any other), the line a failure was read
      // from (a later failure of the same post has another), and whether anything of
      // this post ever reached Metricool: a post that failed before that was a clean refusal Claude can fix and send again.
      lid: result.status === 'needs_check' || result.status === 'failed' ? latestLid(entries, post.id) : null,
      sentOut: Boolean(state.sent),
    };
    if (!row.when && instant !== null && post.platform) row.when = null;
    return row;
  });
  const allSent = intent.posts.length > 0 && intent.posts.every(post => attemptState(entries, post.id).sent);
  return { route: intent.route, allSent, posts };
}

/**
 * Whether Metricool has to be read to settle this job, and over which days: a post with no known result, or one whose time
 * has passed and that is not yet posted or failed (still pending, late, waiting in the app or not listed). `from` and `to`
 * are ISO times a day either side of those posts, the span getScheduledPosts should be asked for (with `brandId` and `timezone`), because
 * reconcile reads only what that call returned.
 */
export function lookupNeeded({ jobDir, intent, now = Date.now() }) {
  if (!plain(intent) || !String(intent.route || '').startsWith('metricool_') || !Array.isArray(intent.posts)) return { needed: false, brandId: null, timezone: null, posts: [], from: null, to: null };
  const entries = readAttempts(jobDir);
  const day = 24 * 60 * 60 * 1000;
  const due = [];
  for (const post of intent.posts.filter(plain)) {
    const state = attemptState(entries, post.id);
    if (!state.entries) continue;
    const instant = plannedInstant(post, state);
    const status = statusFor(post, state, now).status;
    const open = state.pending || (state.sent && state.sent.uuid && instant !== null && now >= instant && !['posted', 'failed', 'draft'].includes(status));
    if (open) due.push({ id: post.id, instant });
  }
  const instants = due.map(item => item.instant).filter(value => value !== null);
  return {
    needed: due.length > 0,
    brandId: intent.blogId == null ? null : String(intent.blogId),
    timezone: intent.posts.map(post => post?.publicationDate?.timezone).find(zone => typeof zone === 'string' && zone) ?? null,
    posts: due.map(item => item.id),
    from: instants.length ? new Date(Math.min(...instants) - day).toISOString() : null,
    to: instants.length ? new Date(Math.max(...instants) + day).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const REFERENCE_LIMIT = 1000;

/**
 * The delivery reference for a finished Metricool job: every post's uuid and planner link, on one line the delivery
 * record accepts (an `operation:` reference of at most 1000 characters). Null until every post of a Metricool plan has
 * been sent. Planner links are dropped from the end when the line would be too long, the uuids never are.
 */
/** What was sent for each post, for the session that has to finish or change the job: `[{ post, uuid, id, plannerUrl }]`. */
export function sentPosts({ jobDir, intent }) {
  const entries = readAttempts(jobDir);
  return (Array.isArray(intent?.posts) ? intent.posts : []).filter(plain).map(post => ({ post: post.id, sent: attemptState(entries, post.id).sent })).filter(item => item.sent)
    .map(item => ({ post: item.post, uuid: item.sent.uuid ? String(item.sent.uuid) : '', id: item.sent.id ?? null, plannerUrl: item.sent.plannerUrl ?? null }));
}

export function deliveryReference({ jobDir, intent, marks = null }) {
  if (!plain(intent) || !String(intent.route || '').startsWith('metricool_') || !Array.isArray(intent.posts) || !intent.posts.length) return null;
  const entries = readAttempts(jobDir);
  const rows = [];
  for (const post of intent.posts) {
    const sent = attemptState(entries, post.id).sent;
    // A post the person marked as posted themselves (the posting kit) counts as delivered, in their words.
    if (plain(marks) && marks[post.id] && !sent) { rows.push({ id: post.id, marked: true, uuid: null, planner: null }); continue; }
    if (!sent || (!sent.uuid && sent.source !== 'person')) return null;
    rows.push({ id: post.id, uuid: sent.uuid ? String(sent.uuid) : null, planner: sent.plannerUrl || null });
  }
  const build = withLinks => `operation:metricool:${intent.route} ${rows.map((row, index) => `${row.id} ${row.marked ? 'marked-by-person' : row.uuid ? `uuid=${row.uuid}` : 'confirmed-by-person'}${row.planner && index < withLinks ? ` planner=${row.planner}` : ''}`).join('; ')}`;
  for (let withLinks = rows.length; withLinks >= 0; withLinks -= 1) {
    const line = build(withLinks);
    if (line.length <= REFERENCE_LIMIT) return line;
  }
  return build(0).slice(0, REFERENCE_LIMIT);
}

// ---------------------------------------------------------------------------
// Media files as 3echo reports them
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/i;
const MAX_ASSETS = 50;
const APP_URL = /^https:\/\/agentc\.3echo\.ai\/assets\/([A-Za-z0-9_-]{1,128})\?workspaceId=([A-Za-z0-9_-]{1,128})$/;

function walk(value, visit, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') return;
  visit(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) walk(item, visit, depth + 1);
}

/**
 * What a 3echo reply says about each asset in it that has a media link:
 * `[{ assetId, sizeBytes, status, mimeType, workspaceId, hashes, urls, expiresAt }]`.
 * `urls` holds the sha256 of every media link in the reply (a link carries its asset id), never the link itself, so the
 * log holds no usable link. An asset with no https://agentc.3echo.ai media link in the reply is left out. The workspace
 * comes only from the reply (an explicit workspaceId, or the asset's own app link), never from what the call asked for.
 */
export function assetFacts(data) {
  const found = new Map();
  const entry = assetId => {
    if (!found.has(assetId)) found.set(assetId, { assetId, sizeBytes: null, status: null, mimeType: null, workspaceId: null, appWorkspaceId: null, hashes: [], urls: [], expiresAt: null });
    return found.get(assetId);
  };
  walk(data, object => {
    if (Array.isArray(object)) return;
    if (typeof object.assetId === 'string' && object.assetId && found.size < MAX_ASSETS) {
      const asset = entry(object.assetId);
      const size = Number(object.sizeBytes ?? object.size ?? object.bytes);
      if (Number.isFinite(size) && size >= 0 && (object.sizeBytes ?? object.size ?? object.bytes) !== null) asset.sizeBytes = size;
      if (typeof object.status === 'string') asset.status = object.status.toLowerCase();
      if (typeof object.mimeType === 'string') asset.mimeType = object.mimeType;
      if (typeof object.workspaceId === 'string') asset.workspaceId = object.workspaceId;
      for (const key of ['sha256', 'checksum', 'contentHash', 'hash']) {
        if (typeof object[key] === 'string' && HEX64.test(object[key])) asset.hashes.push(object[key].toLowerCase());
      }
    }
    for (const value of Object.values(object)) {
      if (typeof value !== 'string' || found.size >= MAX_ASSETS) continue;
      const assetId = mediaAssetId(value);
      if (assetId) {
        const asset = entry(assetId);
        asset.urls.push(createHash('sha256').update(value).digest('hex'));
        if (typeof object.expiresAt === 'string') asset.expiresAt = object.expiresAt;
      }
      const app = APP_URL.exec(value);
      if (app) entry(app[1]).appWorkspaceId = app[2];
    }
  });
  return [...found.values()].filter(asset => asset.urls.length).map(({ appWorkspaceId, ...asset }) => ({
    ...asset,
    workspaceId: asset.workspaceId || appWorkspaceId || null,
    hashes: [...new Set(asset.hashes)],
    urls: [...new Set(asset.urls)],
  }));
}

/** Append one line per asset in the reply that has a 3echo media link. */
export function recordAssets(jobDir, data, input, tool) {
  const written = [];
  const file = join(jobDir, ...ASSET_READS_FILE.split('/'));
  for (const asset of assetFacts(data)) {
    mkdirSync(dirname(file), { recursive: true });
    const line = { at: new Date().toISOString(), tool, ...asset };
    appendFileSync(file, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' });
    written.push(line);
  }
  return written;
}

/** Every line of publish/asset-reads.jsonl, oldest first. A missing or unreadable file is empty, which the guard reads as "not read". */
export function readAssetReads(jobDir) {
  let raw;
  try {
    raw = readFileSync(join(jobDir, ...ASSET_READS_FILE.split('/')), 'utf8');
  } catch {
    return [];
  }
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    try {
      const value = line.trim() ? JSON.parse(line) : null;
      if (plain(value)) lines.push(value);
    } catch { /* a bad line proves nothing */ }
  }
  return lines;
}

/** The latest reading of this asset that lists this exact media link (by its sha256), or null. */
export function latestAsset(entries, assetId, linkSha256) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.assetId === assetId && Array.isArray(entry.urls) && entry.urls.includes(linkSha256)) return entry;
  }
  return null;
}
