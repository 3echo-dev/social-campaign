import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';

/**
 * One window at a time. Two Claude windows open on the same workspace both see the same board click; a claim file
 * written with the claiming window's id decides which one acts. The claim is created atomically (a hard link of a
 * finished temp file, falling back to an exclusive create), so there is no lock to hold and it works on Windows.
 * A claim from a window that has gone away is taken over after a timeout .
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

/** Give a claim back (only the window that holds it can). */
export function releaseClaim(file, sessionId) {
  const current = readClaim(file);
  if (!current || current.sessionId !== String(sessionId)) return false;
  rmSync(file, { force: true });
  return true;
}
