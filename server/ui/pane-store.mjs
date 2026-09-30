/**
 * The pane's shared state, owned by the workspace rather than by a process.
 *
 * Why this exists
 * ---------------
 * Two Claude Code sessions can run against one workspace at the same time. Only one
 * of their server processes can bind the workspace's stored pane port; the others
 * adopt it, because the person has exactly one browser tab open on that address.
 * When the screen lived in process memory, a `show()` from an adopting process went
 * into a heap nobody's browser was pointed at: the chat said the home screen was
 * open while the browser still showed "Nothing to show yet".
 *
 * So the screen, the busy state and the undecided actions live in the workspace:
 *
 *   .social-campaign/pane-state.json    the screen on show, the busy state, a
 *                                       monotonically increasing revision
 *   .social-campaign/ui-actions.jsonl   decisions nobody has consumed yet, one
 *                                       JSON object per line
 *   .social-campaign/pane-state.lock    held for the length of one read-modify-write
 *
 * Every write from every process goes through a transaction here, and every read
 * that serves the browser reads the file. Which process happens to own the socket
 * stops mattering.
 *
 * Single use decisions
 * --------------------
 * A decision stays in the projection until its consumer acknowledges it, so a
 * process crash between receiving a click and applying it to SQLite leaves the
 * decision recoverable. The durable decision table is the source of truth when a
 * workspace exists; this JSONL file is the cross-process projection and remains as
 * a compatibility path for a workspace opened by an older server.
 *
 * Removing a consumed decision is also what keeps a secret out of the workspace: the
 * publisher connect screen is the one screen whose payload carries a real API key,
 * and that payload has to survive the hop between the process that served the click
 * and the process that is waiting. It lives in this file for exactly that hop.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { paneStatePath } from '../lib/paths.mjs';
import { log } from '../lib/log.mjs';
import { nowIso } from '../lib/ids.mjs';

/** How long a lock may be held before another process treats it as abandoned. */
const LOCK_STALE_MS = 5_000;

/** How long a process will wait to take the lock before giving up and logging. */
const LOCK_WAIT_MS = 5_000;

/** How long one spin of the lock wait sleeps. */
const LOCK_SPIN_MS = 5;

/** A dead MCP process must not leave the chat indicator stuck forever. */
const CHAT_ACTIVITY_STALE_MS = 45_000;

/**
 * @typedef {object} ScreenState
 * @property {string} screenId
 * @property {string} type
 * @property {Record<string, unknown>} data
 * @property {string|null} [contextKey] distinguishes two screens of the same type
 * @property {number} revision
 * @property {string} shownAt
 */

/**
 * @typedef {object} ActionRecord
 * @property {string} screenId
 * @property {string} action
 * @property {string} [actionId] stable id for the durable receipt
 * @property {Record<string, unknown>} payload
 * @property {string} at
 * @property {'pending'|'claimed'|'applied'} [status]
 * @property {string} [consumerId]
 * @property {string} [workspaceId]
 * @property {string|null} [campaignId]
 * @property {string|null} [reviewId]
 * @property {string|null} [targetRevision]
 * @property {string|null} [contextKey]
 */

/**
 * @typedef {object} PaneDoc
 * @property {number} revision
 * @property {ScreenState} screen
 * @property {{active: boolean, label: string, screenId?: string, targetId?: string|null, actionId?: string|null}|null} busy
 * @property {ActionRecord[]} actions decisions waiting for a consumer acknowledgement
 * @property {{active: boolean, tool?: string, requestId?: string, startedAt?: string, heartbeatAt?: string, consumers?: Array<{requestId: string, tool?: string, startedAt?: string, heartbeatAt?: string}>}|null} activity
 * @property {{screenId: string, type: string, until: number}|null} previous the
 *   screen id this one just replaced, kept for PREVIOUS_SCREEN_GRACE_MS so a click
 *   already on the wire against it is still honored. Null for a refresh (the id
 *   did not change) and for the very first screen a process ever shows.
 */

/**
 * Sleep without yielding to the event loop, so a transaction stays atomic from the
 * point of view of the synchronous show()/submitAction() API every tool already
 * uses. The waits here are milliseconds against a file a few hundred bytes long.
 * @param {number} ms
 */
function sleepSync(ms) {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, ms);
}

/** @param {unknown} value @returns {boolean} */
function isStaleChatActivity(value) {
  if (!value || typeof value !== 'object' || value.active !== true) return false;
  const consumers = Array.isArray(value.consumers) ? value.consumers : null;
  if (consumers) {
    if (consumers.length === 0) return true;
    return consumers.every((entry) => {
      const stamp = entry && typeof entry === 'object' ? entry.heartbeatAt ?? entry.startedAt : null;
      const at = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
      return Number.isFinite(at) && Date.now() - at > CHAT_ACTIVITY_STALE_MS;
    });
  }
  const stamp = value.heartbeatAt ?? value.startedAt;
  const at = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) && Date.now() - at > CHAT_ACTIVITY_STALE_MS;
}

/**
 * Remove dead request heartbeats while retaining a live sibling consumer.
 * @param {unknown} value
 * @returns {any|null}
 */
function pruneChatActivity(value) {
  if (!value || typeof value !== 'object' || value.active !== true) return null;
  if (!Array.isArray(value.consumers)) return isStaleChatActivity(value) ? null : value;
  const consumers = value.consumers.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const stamp = entry.heartbeatAt ?? entry.startedAt;
    const at = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
    return Number.isFinite(at) && Date.now() - at <= CHAT_ACTIVITY_STALE_MS;
  });
  if (consumers.length === 0) return null;
  const latest = consumers[consumers.length - 1];
  return {
    active: true,
    tool: latest.tool,
    requestId: latest.requestId,
    startedAt: latest.startedAt,
    heartbeatAt: latest.heartbeatAt,
    consumers,
  };
}

/**
 * The pane state of a process that has no workspace yet. The setup screen itself is
 * shown before a workspace exists, so the pane has to work with nothing on disk; a
 * process in that state is the only process there is, so its own heap is a correct
 * source of truth.
 */
export class MemoryPaneStore {
  /** @param {PaneDoc} doc */
  constructor(doc) {
    this.doc = doc;
  }

  /** @returns {PaneDoc} */
  read() {
    return this.doc;
  }

  /**
   * @param {(doc: PaneDoc) => PaneDoc|null} mutate returning null means no change.
   * @returns {PaneDoc}
   */
  transaction(mutate) {
    const next = mutate(this.doc);
    if (next) this.doc = next;
    return this.doc;
  }
}

/**
 * The pane state of a workspace, shared by every process open on it.
 */
export class FilePaneStore {
  /**
   * @param {string} root the workspace root.
   * @param {PaneDoc} seed used only when nothing usable is on disk yet.
   * @param {{maxAgeMs?: number}} [options] a state file older than maxAgeMs is
   *   replaced by the seed rather than restored, which is the same staleness rule
   *   loadPaneState has always applied: a restart minutes into a job should pick up
   *   where the person left off, a workspace nobody has touched in days should not
   *   resurrect a screen from a long-finished session.
   */
  constructor(root, seed, options = {}) {
    this.root = root;
    this.statePath = paneStatePath(root);
    this.actionsPath = join(dirname(this.statePath), 'ui-actions.jsonl');
    this.lockPath = join(dirname(this.statePath), 'pane-state.lock');
    /** @type {PaneDoc} last doc read or written, served when a read fails. */
    this.cache = seed;
    /** @type {string} mtime and size of the state file the cache was built from. */
    this.cacheStamp = '';
    if (!this.#hasUsableState(options.maxAgeMs)) {
      // Revision only ever climbs, even when the screen behind it is discarded, so a
      // browser long-polling with the old revision still notices the replacement.
      this.transaction((current) => {
        const revision = Math.max(seed.revision, current.revision);
        return { revision, screen: { ...seed.screen, revision }, busy: seed.busy, actions: [], previous: null, activity: null };
      });
    }
  }

  /**
   * @param {number} [maxAgeMs]
   * @returns {boolean}
   */
  #hasUsableState(maxAgeMs) {
    try {
      if (!existsSync(this.statePath)) return false;
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.screen) return false;
      if (!Number.isFinite(maxAgeMs)) return true;
      const savedAt = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
      if (!Number.isFinite(savedAt)) return false;
      return Date.now() - savedAt <= Number(maxAgeMs);
    } catch {
      return false;
    }
  }

  /**
   * The current document. Reads the file every time the file has moved, so a
   * process that did not write it still serves the latest screen.
   * @returns {PaneDoc}
   */
  read() {
    try {
      // Size as well as mtime: a clock with millisecond resolution can stamp two
      // writes from two processes identically, and the size almost always differs.
      const stat = statSync(this.statePath);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (stamp === this.cacheStamp) {
        const activity = pruneChatActivity(this.cache.activity);
        if (JSON.stringify(activity) !== JSON.stringify(this.cache.activity)) this.cache = { ...this.cache, activity };
        return this.cache;
      }
      const doc = this.#readDoc();
      this.cache = doc;
      this.cacheStamp = stamp;
      return doc;
    } catch {
      return this.cache;
    }
  }

  /**
   * Read, apply, write, all while holding the lock, so two processes can never
   * interleave. The mutator sees the document as it is on disk right now, not as
   * this process last remembered it, which is the re-read-and-retry rule: a writer
   * carrying a stale revision never clobbers a newer one because it never gets to
   * act on its stale copy at all.
   * @param {(doc: PaneDoc) => PaneDoc|null} mutate returning null means no change.
   * @returns {PaneDoc}
   */
  transaction(mutate) {
    const released = this.#acquireLock();
    try {
      const current = this.#readDoc();
      const next = mutate(current);
      if (!next) {
        this.cache = current;
        this.cacheStamp = '';
        return current;
      }
      if (next.revision < current.revision) {
        throw new Error(`pane revision went backwards (${current.revision} -> ${next.revision})`);
      }
      this.#writeDoc(next);
      this.cache = next;
      this.cacheStamp = '';
      return next;
    } finally {
      released();
    }
  }

  /** @returns {PaneDoc} */
  #readDoc() {
    /** @type {PaneDoc} */
    const fallback = this.cache;
    let screen = fallback.screen;
    let busy = fallback.busy;
    let revision = fallback.revision;
    let previous = fallback.previous ?? null;
    try {
      if (existsSync(this.statePath)) {
        const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.screen && typeof parsed.screen === 'object') {
          screen = parsed.screen;
          busy = parsed.busy ?? null;
          revision = Number.isFinite(parsed.revision) ? Number(parsed.revision) : Number(screen.revision) || 0;
          previous = parsed.previous && typeof parsed.previous === 'object' ? parsed.previous : null;
        }
      }
    } catch (error) {
      log.warn('pane state read failed, keeping the last good copy', { error: String(error) });
    }
    let activity = fallback.activity ?? null;
    try {
      if (existsSync(this.statePath)) {
        const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          activity = parsed.activity && typeof parsed.activity === 'object' ? parsed.activity : null;
        }
      }
    } catch {
      // Keep the last good activity value alongside the other pane fields.
    }
    activity = pruneChatActivity(activity);
    return { revision, screen, busy, previous, actions: this.#readActions(), activity };
  }

  /** @returns {ActionRecord[]} */
  #readActions() {
    try {
      if (!existsSync(this.actionsPath)) return [];
      const raw = readFileSync(this.actionsPath, 'utf8');
      /** @type {ActionRecord[]} */
      const out = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && typeof parsed.screenId === 'string') out.push(parsed);
        } catch {
          // A torn last line can only come from a crash mid-write, which the
          // atomic rename below makes impossible in practice. Skip it either way
          // rather than losing every decision before it.
        }
      }
      return out;
    } catch (error) {
      log.warn('pane actions read failed', { error: String(error) });
      return [];
    }
  }

  /** @param {PaneDoc} doc */
  #writeDoc(doc) {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeAtomic(
      this.statePath,
      JSON.stringify({
        version: 2,
        savedAt: nowIso(),
        revision: doc.revision,
        screen: doc.screen,
        busy: doc.busy,
        previous: doc.previous ?? null,
        activity: doc.activity ?? null,
      }),
    );
    if (doc.actions.length === 0) {
      try {
        if (existsSync(this.actionsPath)) unlinkSync(this.actionsPath);
      } catch {
        writeAtomic(this.actionsPath, '');
      }
      return;
    }
    writeAtomic(this.actionsPath, `${doc.actions.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  }

  /**
   * Take the lock, or wait until the lock is released. A pane state transaction
   * must never continue without its lock: an unlocked read-modify-write can erase a
   * concurrent click even though each individual replacement is atomic.
   * @returns {() => void} release
   */
  #acquireLock() {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        mkdirSync(this.lockPath);
        return () => {
          try {
            rmSync(this.lockPath, { recursive: true, force: true });
          } catch {
            // Another process already cleared it as stale.
          }
        };
      } catch {
        // Held by someone else. Break a lock whose holder died mid-write. Every
        // branch here falls through to the deadline check and the sleep below:
        // spinning straight back to mkdirSync would burn the thread on Windows,
        // where a directory pending deletion fails mkdir and stat at the same time.
        try {
          const age = Date.now() - statSync(this.lockPath).mtimeMs;
          if (age > LOCK_STALE_MS) rmSync(this.lockPath, { recursive: true, force: true });
        } catch {
          // The holder released it between the failed mkdir and this stat.
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`pane state lock never came free: ${this.lockPath}`);
      }
      sleepSync(LOCK_SPIN_MS);
    }
  }
}

/**
 * Write a whole file or none of it: a reader in another process never sees a
 * half-written pane state.
 * @param {string} target
 * @param {string} body
 */
function writeAtomic(target, body) {
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, target);
}
