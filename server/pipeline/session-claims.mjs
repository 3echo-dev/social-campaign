import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { appendFileSync, existsSync, linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renameReplacing } from '../lib/rename.mjs';

/**
 * One window at a time. Two Claude windows open on the same workspace both see the same board click; a claim file
 * written with the claiming window's id decides which one acts. The claim is created atomically (a hard link of a
 * finished temp file, falling back to an exclusive create), so there is no lock to hold and it works on Windows.
 * A claim from a window that has gone away is taken over after a timeout. A claim that names its window's process (windowPid, the job
 * claim does) is also taken over at once when that process is gone on this same computer: a crash never runs SessionEnd.
 */

/** A request claim lasts this long without being finished; a longer-running apply is covered by the .claim file, not this one. */
export const REQUEST_CLAIM_TTL_MS = 5 * 60 * 1000;
/** The window that owns a board keeps it while it touches it at least this often. */
export const BOARD_OWNER_TTL_MS = 30 * 60 * 1000;

let generated = null;
/** This window's id: the host's session id when it gives one, else one made for this server process. */
export function windowSessionId() {
  const named = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (typeof named === 'string' && named.trim()) return named.trim();
  generated ??= `window-${process.pid}-${randomUUID().slice(0, 8)}`;
  return generated;
}

/** The Claude window this server runs in: CLAUDE_PID when the host gives it, else the process that started the server. */
export const windowPid = () => Number.parseInt(process.env.CLAUDE_PID ?? '', 10) || process.ppid;

/**
 * The Claude window a hook runs for: only CLAUDE_PID, which the host gives its hooks too, or null. A hook is a short-lived child
 * (its own parent is the forwarder, gone as soon as the hook ends), so the parent-process fallback of windowPid would name a process
 * that is already finished and make the window look gone at once.
 */
export function hookWindowPid(env = process.env) {
  const pid = Number.parseInt(env.CLAUDE_PID ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True only when the system says there is no such process; any other answer (such as no permission) means it is still there. */
function processGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

/** A claim that names its window's process, on this computer, whose process has gone: the holder is gone, whatever the clock says. */
export const holderGone = claim => Boolean(claim) && claim.host === hostname() && processGone(claim.windowPid);

function readClaim(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isStale(file, current, { ttlMs, now }) {
  if (!current) {
    // Unreadable (half written or damaged): stale only once it has sat that long.
    try { return now - statSync(file).mtimeMs > ttlMs; } catch { return true; }
  }
  if (holderGone(current)) return true;
  const at = Date.parse(current.claimedAt ?? '');
  return !Number.isFinite(at) || now - at > ttlMs;
}

function createExclusive(file, body) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, body);
  try {
    linkSync(temp, file);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    try {
      writeFileSync(file, body, { flag: 'wx' });
      return true;
    } catch (second) {
      if (second.code === 'EEXIST') return false;
      throw second;
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Put a claim moved aside back at `file`: a hard link, else an exclusive create. Whoever already holds `file` wins. */
function putBack(aside, file) {
  try {
    linkSync(aside, file);
  } catch (error) {
    if (error.code === 'EEXIST') return;
    try { writeFileSync(file, readFileSync(aside), { flag: 'wx' }); } catch { /* someone else already holds it; they win */ }
  }
}

/**
 * Take the claim at `file` for `sessionId`. Returns {claimed: true} (also when this window already holds it) or
 * {claimed: false, owner} with the holder's record. Exactly one of any number of racing windows gets true.
 */
export function takeClaim(file, sessionId, { ttlMs = REQUEST_CLAIM_TTL_MS, now = Date.now(), extra = {} } = {}) {
  const id = String(sessionId);
  const host = hostname();
  const body = () => JSON.stringify({ sessionId: id, pid: process.pid, host, claimedAt: new Date(now).toISOString(), ...extra });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (createExclusive(file, body())) return { claimed: true, retaken: attempt > 0 };
    const current = readClaim(file);
    if (current && current.sessionId === id) return { claimed: true, retaken: false };
    if (!isStale(file, current, { ttlMs, now })) return { claimed: false, owner: current };
    // Take over a dead window's claim: move it aside (only one racer can), and check it is the one judged stale.
    const aside = `${file}.stale-${randomUUID()}`;
    try { renameSync(file, aside); } catch { continue; }
    // Judge what was actually moved, not what was seen a moment ago: a fresh claim (a newer one landed between the check
    // and the move, or the unreadable one was only half written) is put back, never overwritten or deleted.
    if (!isStale(aside, readClaim(aside), { ttlMs, now })) putBack(aside, file);
    rmSync(aside, { force: true });
  }
  return { claimed: false, owner: readClaim(file) };
}

export function readClaimRecord(file) {
  return existsSync(file) ? readClaim(file) : null;
}

/** The record of a claim that is still within its time, whoever holds it; null when nothing is held or the holder went quiet. */
export function liveClaim(file, { ttlMs = REQUEST_CLAIM_TTL_MS, now = Date.now() } = {}) {
  const current = readClaimRecord(file);
  return current && !isStale(file, current, { ttlMs, now }) ? current : null;
}

/**
 * Say the holder is still here: claimedAt moves to now (at most once in `everyMs`). Only the window that holds the claim can. `extra` fields
 * (the holder's windowPid) are written onto the claim too, and a change in them is written at once.
 */
export function refreshClaim(file, sessionId, { now = Date.now(), everyMs = 60 * 1000, extra = {} } = {}) {
  const current = readClaim(file);
  if (!current || current.sessionId !== String(sessionId)) return false;
  const changed = Object.keys(extra).some(key => current[key] !== extra[key]);
  if (!changed && now - Date.parse(current.claimedAt ?? '') <= everyMs) return false;
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...current, ...extra, claimedAt: new Date(now).toISOString() }));
    // A newer window may have taken the claim while this was written: check again just before replacing.
    if (readClaim(file)?.sessionId !== String(sessionId)) return false;
    renameReplacing(temp, file);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * One Director per job (plan 0.19, B1.3). The claim sits in the job's own folder as a hidden file, so it follows the job and no
 * list of files shows it. It follows the board window's rule: it lasts JOB_CLAIM_TTL_MS from the holder's last sign of life.
 */
export const JOB_CLAIM_FILE = '.director.claim';
/** What a job keeps, in plain words, about its Director claim and about paid items asked for twice. */
export const JOB_LOG_FILE = 'director-log.jsonl';
export const JOB_CLAIM_TTL_MS = BOARD_OWNER_TTL_MS;
export const jobClaimFile = jobDir => join(jobDir, JOB_CLAIM_FILE);

const NOTE_REPEAT_MS = 10 * 60 * 1000;

/**
 * Add one plain-words line to the job's log: {at, kind, note}. The same line again within ten minutes (among the last twenty) is not written twice, so a
 * window that keeps trying does not fill the log. Never throws; a log that cannot be written never stops the work.
 */
export function noteOnJob(jobDir, kind, note, { now = Date.now() } = {}) {
  try {
    const file = join(jobDir, JOB_LOG_FILE);
    if (existsSync(file)) {
      for (const text of readFileSync(file, 'utf8').trimEnd().split('\n').slice(-20)) {
        let line = null;
        try { line = JSON.parse(text); } catch { line = null; }
        if (line && line.kind === kind && line.note === note && now - Date.parse(line.at ?? '') < NOTE_REPEAT_MS) return false;
      }
    }
    appendFileSync(file, `${JSON.stringify({ at: new Date(now).toISOString(), kind, note })}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Give a claim back (only the window that holds it can). */
export function releaseClaim(file, sessionId) {
  const current = readClaim(file);
  if (!current || current.sessionId !== String(sessionId)) return false;
  rmSync(file, { force: true });
  return true;
}
