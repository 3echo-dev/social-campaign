/**
 * The Social Campaign pane.
 *
 * A localhost only HTTP server bound to 127.0.0.1. It serves the static files in
 * ui/ and a three route JSON API:
 *
 *   GET  /api/state          the screen the user should be looking at right now
 *   GET  /api/events?since=  long poll, up to 25 seconds, resolves on a screen change
 *   POST /api/action         { screenId, action, payload }, known actions only
 *
 * plus the folder picker routes, which are about choosing a folder rather than about
 * the screen on show, and are documented at the block that serves them:
 *
 *   GET  /api/folders?path=      the folders inside one folder
 *   POST /api/folders/create     { parent, name }
 *   POST /api/native-folder      open the operating system's own chooser, returns a ticket
 *   GET  /api/native-folder?ticket=  how that chooser is getting on
 *
 * Tools drive the pane by calling show(), then wait for the user with
 * waitForAction(). Each screen declares the actions it accepts; anything else is a
 * 400, which is the security rule from spec section 37 made concrete.
 */

import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../lib/log.mjs';
import { isId, newId, nowIso } from '../lib/ids.mjs';
import { isInside, paneStatePath } from '../lib/paths.mjs';
import { redact } from '../lib/secrets.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { putCredential } from '../lib/credentials.mjs';
import { createFolder, folderShortcuts, listFolders } from './folders.mjs';
import { chooseFolderNative } from './native-folder.mjs';
import { FilePaneStore, MemoryPaneStore } from './pane-store.mjs';
import { readHead, sniffMagic } from '../media/mime.mjs';
import { registerFile } from '../media/ingest.mjs';
import { thumbsRoot as computeThumbsRoot } from '../media/frames.mjs';
import { boardOperation, boardMedia } from '../pipeline/board.mjs';
import { buildBoard } from '../../scripts/build-board.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The folder holding index.html, app.js, styles.css and screens/. */
export const UI_ROOT = resolve(join(HERE, '..', '..', 'ui'));

/** How long a /api/events long poll waits before answering with no change. */
const EVENT_POLL_MS = 25_000;

/**
 * How often a held-open /api/events poll re-reads the workspace's pane state, so a
 * screen shown by another process reaches the browser without waiting for the full
 * long poll window.
 */
const EVENT_TICK_MS = 300;

/**
 * How often a waitForAction re-reads the workspace's decision log. A click served by
 * another process lands within this, which is invisible next to the seconds of agent
 * work that follow every decision.
 */
const ACTION_POLL_MS = 500;

/** Screens whose actions must stay bound to one review identity. */
const REVIEW_SCREEN_TYPES = new Set([
  'strategy_review',
  'concept_review',
  'cost_review',
  'media_review',
  'final_review',
  'question',
]);

/** A claimed action can be recovered by another consumer after this lease. */
const ACTION_CLAIM_LEASE_MS = 60_000;

/** Request-scoped workspace identity used by tools that can outlive activation. */
const workspaceUiContext = new AsyncLocalStorage();

// ---------------------------------------------------------------------------
// Brand reference uploads: constants shared by the route below.
//
// The reference dropzone on the brand onboarding screen takes images, videos and
// font files. Each extension has its own size ceiling because a video is
// legitimately much larger than a font, and every ceiling is named in the
// refusal message so a person knows what to try instead.
// ---------------------------------------------------------------------------
const REFERENCE_EXTENSION_CAPS = {
  '.jpg': 25 * 1024 * 1024,
  '.jpeg': 25 * 1024 * 1024,
  '.png': 25 * 1024 * 1024,
  '.webp': 25 * 1024 * 1024,
  '.gif': 25 * 1024 * 1024,
  '.mp4': 300 * 1024 * 1024,
  '.mov': 300 * 1024 * 1024,
  '.m4v': 300 * 1024 * 1024,
  '.webm': 300 * 1024 * 1024,
  '.ttf': 10 * 1024 * 1024,
  '.otf': 10 * 1024 * 1024,
  '.woff': 10 * 1024 * 1024,
  '.woff2': 10 * 1024 * 1024,
};

/** Reference attachments are capped per brand (or per draft, before a brand exists). */
const MAX_REFERENCES_PER_TARGET = 50;

const IMAGE_EXTENSION_SET = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSION_SET = new Set(['.mp4', '.mov', '.m4v', '.webm']);
// ---------------------------------------------------------------------------

/**
 * The default ceiling for one waitForAction call, kept safely under Claude Code's MCP
 * idle timeout.
 *
 * Claude Code aborts a stdio MCP tool call that sends neither a response nor a
 * progress notification for its idle window, which defaults to 30 minutes for stdio
 * servers (this one included) and is unrelated to the much larger MCP_TOOL_TIMEOUT,
 * which defaults to about 28 hours and is not the real constraint here. This server
 * sends no progress notifications while a gate is open, so the 30 minute idle window
 * is the true ceiling on one wait call.
 *
 * 20 minutes leaves 10 minutes of margin under that 30 minute idle window, room
 * for process scheduling jitter and for a slower machine, while still being long
 * enough that a real decision (which can take several minutes) resolves within one
 * or two wait calls instead of dozens. See docs/ARCHITECTURE.md, "Gate wait timeout",
 * for the full reasoning.
 */
export const GATE_WAIT_MS = 20 * 60_000;

/**
 * A pane-state.json older than this is treated as stale and never restored. A
 * restart minutes or a couple of hours into a job should pick up where the
 * person left off; a restart of a workspace nobody has touched in days should
 * not resurrect a screen from an unrelated, long-finished session.
 */
export const PANE_STATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How long a click on the immediately previous screen id is still honored after a
 * genuinely different screen replaces it.
 *
 * A show() that mints a new id (a real screen change, not a refresh) can race a
 * click the person already made against the id the browser had a moment ago: the
 * button was drawn with the old id, the person clicked it, and the new screen
 * landed on the server microseconds before the POST arrived. Without this window
 * that click is refused outright and the person's press is simply lost. 60 seconds
 * is far longer than that race can plausibly take, while still being short enough
 * that a click on a screen from an unrelated, much earlier moment is refused as
 * it should be. See docs/ARCHITECTURE.md, "Gate pattern".
 */
export const PREVIOUS_SCREEN_GRACE_MS = 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * The actions each screen type accepts. A screen not listed here accepts nothing,
 * which is the safe default for the stub screens other engineers will fill in.
 * @type {Record<string, string[]>}
 */
/**
 * The busy label shown while the pane waits for the next screen after a
 * given screen type's action resolves. Falls back to a generic "Working" for
 * an action not named here, so a new action never has to remember to add one
 * before it works.
 * @type {Record<string, Record<string, string>>}
 */
export const ACTION_BUSY_LABELS = {
  strategy_review: {
    approve: 'Approving the strategy',
    request_changes: 'Requesting changes',
    reject: 'Rejecting the strategy',
    combine: 'Combining directions',
  },
  concept_review: {
    approve: 'Approving the concepts',
    request_changes: 'Requesting changes',
    reject: 'Rejecting the concepts',
  },
  cost_review: {
    approve: 'Approving the cost',
    reduce: 'Reducing the cost',
    cancel: 'Cancelling',
  },
  media_review: {
    approve: 'Approving the media',
    approve_all: 'Approving all media',
    regenerate: 'Regenerating',
    edit_prompt: 'Updating the prompt',
    reject: 'Rejecting the media',
  },
  final_review: {
    approve: 'Approving the final package',
    request_changes: 'Requesting changes',
    reject: 'Rejecting the final package',
  },
  research_results: {
    continue: 'Continuing to strategy',
    request_more: 'Requesting more research',
  },
  publish: {
    schedule: 'Scheduling the post',
    export_package: 'Exporting the package',
    cancel: 'Cancelling',
  },
  connections: {
    check_again: 'Checking the connection',
    skip: 'Skipping for now',
    connect: 'Connecting',
    continue_home: 'Opening Social Campaign',
  },
  job_plan: {
    approve_plan: 'Approving the plan',
    edit_plan: 'Updating the plan',
    connect: 'Opening the connection',
  },
};

/**
 * @param {string} screenType
 * @param {string} action
 * @returns {string}
 */
function busyLabelFor(screenType, action) {
  const label = ACTION_BUSY_LABELS[screenType]?.[action];
  if (label) return label;
  const spaced = action.replace(/_/g, ' ');
  return `Working (${spaced})`;
}

/** Keep a connection action attached to its card after a redraw or reconnect. */
function busyStateFor(screen, action, payload, actionId = null) {
  const busy = {
    active: true,
    label: busyLabelFor(screen.type, action),
    screenId: screen.screenId,
    actionId: actionId || null,
  };
  if (screen.type !== 'connections') return busy;
  const providers = { threeecho: 'threeecho_studio', elevenlabs: 'elevenlabs', publisher: 'publisher' };
  const provider = payload.provider ?? providers[payload.item];
  const cards = Array.isArray(screen.data?.cards) ? screen.data.cards : [];
  const card = action === 'continue_home' ? null : cards.find((item) =>
    payload.key ? item.key === payload.key : provider && item.provider === provider);
  return { ...busy, targetId: card ? `conn-card-${card.key}` : null };
}

export const SCREEN_ACTIONS = {
  setup: ['choose_folder', 'use_default_folder', 'continue', 'choose_new_here', 'choose_usual', 'choose_other'],
  home: ['start_job', 'onboard_brand', 'build_library', 'open_connections', 'fix_in_chat'],
  integration_connect: ['connect', 'skip', 'mark_connected', 'back'],
  connections: ['check_again', 'skip', 'connect', 'continue_home', 'fix_in_chat'],
  message: ['ok', 'dismiss'],
  new_job: ['select_job_type', 'cancel'],
  starting_point: ['select_starting_point', 'back'],
  intake: ['submit', 'cancel'],
  job_plan: ['approve_plan', 'edit_plan', 'connect', 'cancel'],
  brand_onboarding: ['submit_brief', 'cancel', 'save_pillars', 'retry_research', 'back_home', 'start_job'],
  creative_library: ['start', 'stop_analysis', 'leave', 'done', 'start_job'],
  research_progress: ['cancel'],
  research_results: ['continue', 'request_more'],
  strategy_review: ['approve', 'request_changes', 'reject', 'combine'],
  concept_review: ['approve', 'request_changes', 'reject'],
  cost_review: ['approve', 'reduce', 'cancel'],
  media_review: ['approve', 'regenerate', 'edit_prompt', 'reject', 'approve_all'],
  final_review: ['approve', 'request_changes', 'reject'],
  publish: ['schedule', 'export_package', 'retry_failed', 'check_with_provider', 'cancel'],
  question: ['submit'],
  workspace_switch: ['activate', 'create_new', 'forget', 'back'],
};

/**
 * @typedef {object} ScreenState
 * @property {string} screenId
 * @property {string} type
 * @property {Record<string, unknown>} data
 * @property {string|null} [contextKey] distinguishes two screens of the same type
 * @property {string|null} [workspaceId] immutable workspace identity for this screen
 * @property {string|null} [campaignId] campaign identity for a review screen
 * @property {string|null} [reviewId] review identity for a review screen
 * @property {string|null} [targetRevision] exact target revision being decided
 * @property {boolean} [decision] true for review screens and other durable decisions
 * @property {number} revision
 * @property {string} shownAt
 */

/**
 * @typedef {object} ActionResult
 * @property {string} screenId
 * @property {string} [actionId] stable id for a durable action receipt
 * @property {string} action
 * @property {Record<string, unknown>} payload
 * @property {string} at
 * @property {string|null} [workspaceId]
 * @property {string|null} [campaignId]
 * @property {string|null} [reviewId]
 * @property {string|null} [targetRevision]
 * @property {string|null} [contextKey]
 * @property {string} [consumerId] consumer that claimed this action
 */

export class UiServer {
  /**
   * @param {{host?: string, port?: number|null}} [options]
   */
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port ?? 0;
    /** @type {import('../workspace/index.mjs').Workspace|null} used only to resolve /generated/. */
    this.workspace = options.workspace ?? null;
    /** @type {import('node:http').Server|null} */
    this.server = null;
    /** @type {number|null} */
    this.port = null;
    /**
     * The pane's state before there is a workspace to keep it in. The setup screen
     * is shown while the person is still choosing a folder, and a process in that
     * state is by definition the only one there is, so its own heap is a correct
     * source of truth. Everything moves to the workspace the moment one exists.
     * @type {MemoryPaneStore}
     */
    this.memoryStore = new MemoryPaneStore({
      revision: 0,
      screen: {
        screenId: newId(),
        type: 'message',
        data: { title: 'Social Campaign', body: 'Nothing to show yet.' },
        contextKey: null,
        workspaceId: null,
        campaignId: null,
        reviewId: null,
        targetRevision: null,
        decision: false,
        revision: 0,
        shownAt: nowIso(),
      },
      busy: null,
      actions: [],
      previous: null,
      activity: null,
    });
    /** @type {FilePaneStore|null} the workspace's own store, once there is a workspace. */
    this.fileStore = null;
    /** @type {Map<string, FilePaneStore>} every workspace pane store this process has opened. */
    this.fileStores = new Map();
    /** @type {string|null} the workspace root fileStore was opened on. */
    this.storeRoot = null;
    /**
     * Identifies which store's counter `revision` is currently being read from,
     * so a client can tell "the pane moved to a different revision counter"
     * apart from "the pane's own counter went up", even if the two counters
     * happen to overlap. Changes exactly once, the moment the in-memory store
     * (used before a workspace exists) is replaced by the workspace's file
     * store. A client that redraws whenever this changes, in addition to
     * whenever `screen.revision` changes, can never be stranded by a counter
     * swap it did not know about: belt and suspenders alongside the revision
     * carried forward into the new store's seed.
     * @type {string}
     */
    this.streamId = newId();
    /**
     * Wakeups for waits inside this process, so a decision made here resolves its
     * waiter immediately rather than on the next poll tick. A decision made in
     * another process arrives on the poll, which is what the poll is for.
     * @type {Set<() => void>}
     */
    this.localWaiters = new Set();
    /** True between stop() and the next start(), so every wait gives up. */
    this.stopped = false;
    /** True while ensureServing() is already trying to take over the port. */
    this.claimingPort = false;
    // --- creative library thumbnails: the folder GET /thumbs/ serves from ---
    /**
     * @deprecated kept only so an older tool that still assigns it does not throw.
     * #serveThumb derives the real root from the live workspace on every request,
     * so a thumbnail works from the very first upload rather than only once some
     * library tool happens to have run first.
     * @type {string|null}
     */
    this.thumbsRoot = null;
    // --- end creative library thumbnails ---

    // --- live refresh ---
    /**
     * One data function per screen type that wants to be polled. A tool registers
     * one when it shows a screen whose truth lives in the database rather than in
     * the payload it was shown with (creative_library today), so GET /api/live can
     * hand back fresh numbers without anything calling show() again.
     * @type {Map<string, () => Record<string, unknown>>}
     */
    this.refreshers = new Map();
    // --- end live refresh ---

    // --- folder picker ---
    /**
     * Native folder dialogs in flight, keyed by ticket. A dialog outlives the request
     * that started it, which is what keeps the pane responsive while it is open.
     * @type {Map<string, {status: 'open'|'done', path: string|null, reason: string}>}
     */
    this.nativeDialogs = new Map();
    /**
     * The chooser itself, held as a field so a test can stand in for it without
     * opening a real window.
     * @type {(options?: {platform?: string, timeoutMs?: number}) => Promise<{path: string|null, reason: string}>}
     */
    this.chooseFolder = options.chooseFolder ?? chooseFolderNative;
    // --- end folder picker ---

    /**
     * True when this process deliberately did not bind a pane server because
     * another live instance already serves this workspace. url() still returns
     * that instance's address so tools keep handing the person a working link,
     * but every in-process method here (show, setBusy, waitForAction) is a no-op
     * against a screen nobody's browser is pointed at.
     * @type {boolean}
     */
    this.external = false;
  }

  /**
   * Adopt an already-running pane on `port` instead of binding a socket of our
   * own. Used when isLivePaneForWorkspace() finds a live instance for this
   * workspace on the saved port.
   * @param {number} port
   */
  adoptExternal(port) {
    this.external = true;
    this.port = port;
  }

  /**
   * Bind the socket.
   * @returns {Promise<{url: string, port: number}>}
   */
  async start() {
    this.stopped = false;
    await this.#normalizeLegacyConnections();
    if (this.external) return { url: this.url(), port: this.port ?? 0 };
    if (this.server && this.port) return { url: this.url(), port: this.port };
    this.server = createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        log.error('ui request failed', { error: String(error) });
        sendJson(response, 500, { error: 'Something went wrong in the Social Campaign pane.' });
      });
    });
    await new Promise((resolveBind, rejectBind) => {
      const server = /** @type {import('node:http').Server} */ (this.server);
      // A busy port leaves a server object that will never listen. Drop it, so a
      // retry with a different port really does bind.
      const onBindError = (/** @type {Error} */ error) => {
        this.server = null;
        this.port = null;
        server.close(() => {});
        rejectBind(error);
      };
      server.once('error', onBindError);
      server.listen(this.requestedPort || 0, this.host, () => {
        server.removeListener('error', onBindError);
        resolveBind(undefined);
      });
    });
    const address = /** @type {{port: number}} */ (this.server.address());
    this.port = address.port;
    log.info('ui listening', { url: this.url() });
    return { url: this.url(), port: this.port };
  }

  /** @returns {string} */
  url() {
    if (!this.port) return '';
    return `http://${this.host}:${this.port}/`;
  }

  async servedUrl() {
    await this.ensureServing();
    return this.url();
  }

  /**
   * Put a screen in front of the user.
   *
   * Showing a genuinely different screen clears any decision recorded against the
   * previous one, so a stale click can never satisfy a new gate.
   *
   * A call that shows exactly the screen already on display, same type, same
   * data, is a no-op: it keeps the current screenId and revision instead of
   * minting a new one.
   *
   * A call that shows the same screen (same type and same `contextKey`, which
   * defaults to null so "same type" alone is what counts unless a caller says
   * otherwise) but with different data is a refresh: it keeps the current
   * screenId too, bumps only the revision, and leaves any decision already
   * recorded against that id in place, since the id itself never changed. A tool
   * re-showing a screen with updated numbers (card states after a probe, progress
   * steps moving on) is common, and without this the pane would mint a new id on
   * every such call, which is exactly what let a click race a re-show and get
   * discarded: the browser drew a "Continue" button against one id, the server
   * replaced the screen with a new one a moment later, and the click that landed
   * in between satisfied nothing.
   *
   * Only a call that changes the screen type or the contextKey is a genuine
   * screen change: it mints a new id and clears the decision log, but remembers
   * the id it just replaced for PREVIOUS_SCREEN_GRACE_MS, so a click that was
   * already in flight against that old id is still honored (see submitAction).
   * @param {string} type one of the keys in SCREEN_ACTIONS.
   * @param {Record<string, unknown>} [data]
   * @param {{contextKey?: string|null, workspaceId?: string|null, campaignId?: string|null,
   *   reviewId?: string|null, targetRevision?: string|number|null, decision?: boolean}} [options]
   *   contextKey distinguishes two screens of the same type that are not the same
   *   screen. Identity fields bind a decision to one workspace, campaign, review
   *   and target revision.
   * @returns {ScreenState}
   */
  show(type, data = {}, options = {}) {
    // A secret never leaves the server, and the shared screen is a file in the
    // workspace, so what is stored is the redacted copy. Every screen that holds no
    // secret field is untouched by this, which is every screen in practice.
    const safeData = redact(data ?? {});
    const captured = this.#activeWorkspaceContext();
    const contextKey = typeof options.contextKey === 'string' ? options.contextKey : null;
    const workspaceId =
      typeof options.workspaceId === 'string'
        ? options.workspaceId
        : captured?.root ?? (this.workspace?.root ? String(this.workspace.root) : null);
    const campaignId = typeof options.campaignId === 'string' ? options.campaignId : null;
    const reviewId = typeof options.reviewId === 'string' ? options.reviewId : null;
    const targetRevision = options.targetRevision == null ? null : String(options.targetRevision);
    const decision = options.decision === true || REVIEW_SCREEN_TYPES.has(type);
    /** @type {ScreenState} */
    let shown;
    let changed = false;
    this.#store().transaction((doc) => {
      const sameScreen =
        type === doc.screen.type &&
        contextKey === (doc.screen.contextKey ?? null) &&
        workspaceId === (doc.screen.workspaceId ?? null) &&
        campaignId === (doc.screen.campaignId ?? null) &&
        reviewId === (doc.screen.reviewId ?? null) &&
        targetRevision === (doc.screen.targetRevision == null ? null : String(doc.screen.targetRevision));
      if (sameScreen && sameScreenData(safeData, doc.screen.data)) {
        shown = doc.screen;
        return null;
      }
      const revision = doc.revision + 1;
      if (sameScreen) {
        // A refresh: the id stays put, so nothing waiting on it and nothing the
        // person already clicked is disturbed. Busy is still cleared, the same as
        // a genuine change, because a refresh always follows a tool finishing
        // whatever the previous busy label described.
        shown = {
          ...doc.screen,
          screenId: doc.screen.screenId,
          type,
          data: safeData,
          contextKey,
          workspaceId,
          campaignId,
          reviewId,
          targetRevision,
          decision,
          revision,
          shownAt: doc.screen.shownAt,
        };
        changed = true;
        return { revision, screen: shown, busy: null, actions: doc.actions, previous: doc.previous, activity: doc.activity ?? null };
      }
      shown = {
        screenId: newId(),
        type,
        data: safeData,
        contextKey,
        workspaceId,
        campaignId,
        reviewId,
        targetRevision,
        decision,
        revision,
        shownAt: nowIso(),
      };
      changed = true;
      const previous =
        doc.screen.screenId && doc.screen.type
          ? {
              screenId: doc.screen.screenId,
              type: doc.screen.type,
              contextKey: doc.screen.contextKey ?? null,
              workspaceId: doc.screen.workspaceId ?? null,
              campaignId: doc.screen.campaignId ?? null,
              reviewId: doc.screen.reviewId ?? null,
              targetRevision: doc.screen.targetRevision ?? null,
              decision: Boolean(doc.screen.decision || REVIEW_SCREEN_TYPES.has(doc.screen.type)),
              until: Date.now() + PREVIOUS_SCREEN_GRACE_MS,
            }
          : null;
      // A new screen empties the decision log: a stale click can never satisfy a
      // new gate, and nothing a person typed into the screen being replaced
      // lingers in the workspace. The id it replaced is kept, briefly, so a click
      // already on the wire against that id is not simply dropped.
      const retainedActions = doc.actions.filter((entry) => entry.reviewId);
      return { revision, screen: shown, busy: null, actions: retainedActions, previous, activity: doc.activity ?? null };
    });
    if (changed) {
      this.#notifyLocal();
      // The browser is on the workspace's stored port. If the process that owned
      // that socket died, this process should take it over now, so the person's
      // bookmarked address keeps working across a reload.
      if (this.external) void this.ensureServing();
      log.info('ui screen shown', { type, screenId: shown.screenId });
    }
    return shown;
  }

  /** Compatibility alias used by the workspace switch tool. */
  open(type, data = {}, options = {}) {
    return this.show(type, data, options);
  }

  /**
   * Run an async tool inside the pane context captured when that tool started.
   * Every pane read/write made by the callback then uses that workspace's state,
   * even if another request activates a different workspace while it is waiting.
   * @template T
   * @param {{root?: string, workspaceId?: string, db?: import('node:sqlite').DatabaseSync}|null} context
   * @param {() => T} callback
   * @returns {T}
   */
  withWorkspaceContext(context, callback) {
    const root = context?.root ?? context?.workspaceId;
    const db = context?.db;
    if (!root || !db) return callback();
    return workspaceUiContext.run({ root: String(root), db }, callback);
  }

  /** @returns {{root: string, db: import('node:sqlite').DatabaseSync}|null} */
  #activeWorkspaceContext() {
    const current = workspaceUiContext.getStore();
    return current && current.root && current.db ? current : null;
  }

  /**
   * The store for the active request context, or the live workspace for direct
   * calls such as HTTP handlers. A workspace created mid session (setup_wait) moves
   * the state across by seeding the new store with the screen that is on show.
   * @returns {MemoryPaneStore|FilePaneStore}
   */
  #store() {
    const context = this.#activeWorkspaceContext();
    const root = context?.root ?? (this.workspace && this.workspace.root ? String(this.workspace.root) : null);
    if (!root) return this.memoryStore;
    const existing = this.fileStores.get(root);
    if (existing) {
      this.fileStore = existing;
      this.storeRoot = root;
      return existing;
    }
    // A workspace switch must never seed workspace B with the screen that was
    // displayed for workspace A. The in-memory seed is useful only for the first
    // transition from setup into a newly-created workspace; once a file store has
    // existed, a missing target state starts from a neutral screen.
    const seed =
      this.storeRoot && this.storeRoot !== root
        ? {
            revision: 0,
            screen: {
              screenId: newId(),
              type: 'message',
              data: { title: 'Social Campaign', body: 'Nothing to show yet.' },
              contextKey: null,
              workspaceId: root,
              campaignId: null,
              reviewId: null,
              targetRevision: null,
              decision: false,
              revision: 0,
              shownAt: nowIso(),
            },
            busy: null,
            actions: [],
            previous: null,
            activity: null,
          }
        : this.memoryStore.read();
    this.fileStore = new FilePaneStore(root, seed, { maxAgeMs: PANE_STATE_MAX_AGE_MS });
    this.fileStores.set(root, this.fileStore);
    this.storeRoot = root;
    // The revision counter just changed owners (memory -> this workspace's file).
    // A new stream id tells every client polling against the old counter to
    // redraw unconditionally on its next poll, rather than trust a `since`
    // comparison against a counter it was never counting.
    this.streamId = newId();
    return this.fileStore;
  }

  /** Wake every wait inside this process, which a write from here has just changed. */
  #notifyLocal() {
    for (const wake of [...this.localWaiters]) wake();
  }

  /** @returns {import('node:sqlite').DatabaseSync|null} */
  #database() {
    const context = this.#activeWorkspaceContext();
    if (context?.db) return context.db;
    return this.workspace && this.workspace.db ? this.workspace.db : null;
  }

  /**
   * Migration 015 owns the durable decision inbox. Keep the file projection
   * usable for an older workspace that has not applied it yet.
   * @param {import('node:sqlite').DatabaseSync|null} db
   * @returns {boolean}
   */
  #hasDurableActions(db) {
    if (!db) return false;
    try {
      return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decision_actions'").get());
    } catch {
      return false;
    }
  }

  /** @param {string} actionId */
  #readDurableAction(actionId) {
    const db = this.#database();
    if (!this.#hasDurableActions(db)) return null;
    try {
      return db.prepare('SELECT * FROM decision_actions WHERE id = ?').get(actionId) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Insert the durable receipt before the pane projection is written.
   * The primary key makes a client retry idempotent when the HTTP response was lost.
   * A receipt failure must abort submitAction, because the JSON projection alone
   * cannot recover an accepted click after a process restart.
   * @param {ActionResult} action
   */
  #recordDurableAction(action) {
    const db = this.#database();
    if (!this.#hasDurableActions(db) || !action.actionId) return;
    try {
      db.prepare(
        'INSERT INTO decision_actions ' +
          '(id, workspace_id, campaign_id, review_id, screen_id, screen_revision, screen_type, context_key, target_revision, action, payload, status, consumer_id, claim_expires_at, created_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)",
      ).run(
        action.actionId,
        action.workspaceId ?? this.workspace?.root ?? null,
        action.campaignId ?? null,
        action.reviewId ?? null,
        action.screenId,
        Number(action.screenRevision ?? 0),
        action.screenType ?? null,
        action.contextKey ?? null,
        action.targetRevision ?? null,
        action.action,
        JSON.stringify(redact(action.payload ?? {})),
        action.at,
      );
    } catch (error) {
      // A concurrent retry can race the first insert. Treat an existing row with
      // the same identity as the already committed receipt; every other database
      // failure must reach the caller before the pane projection is written.
      if (isUniqueConstraintError(error)) {
        const existing = this.#readDurableAction(action.actionId);
        if (existing && durableActionMatches(action, existing)) return;
      }
      throw error;
    }
  }

  /**
   * Remove one acknowledged action from the JSON projection. SQLite keeps the
   * durable audit row, so this is only a compact delivery projection.
   * @param {string} actionId
   */
  #removeActionProjection(actionId) {
    if (!actionId) return;
    const store = this.#store();
    store.transaction((doc) => {
      const actions = doc.actions.filter((entry) => entry.actionId !== actionId);
      if (actions.length === doc.actions.length) return null;
      return {
        revision: doc.revision + 1,
        screen: doc.screen,
        busy: doc.busy,
        actions,
        previous: doc.previous,
        activity: doc.activity ?? null,
      };
    });
  }

  /**
   * Mark an action applied after a generic waiter has returned it. Gate consumers
   * use applyDecision() below to commit this acknowledgement with their review.
   * @param {string} actionId
   * @param {string|null} [consumerId]
   */
  acknowledgeAction(actionId, consumerId = null) {
    const db = this.#database();
    let acknowledged = true;
    if (this.#hasDurableActions(db)) {
      try {
        const acknowledgedAt = nowIso();
        const updated = db.prepare(
          "UPDATE decision_actions SET status = 'applied', acknowledged_at = ?, applied_at = ?, consumer_id = COALESCE(?, consumer_id) WHERE id = ? AND ((status = 'claimed' AND consumer_id = ?) OR (status = 'pending' AND ? IS NULL))",
        ).run(acknowledgedAt, acknowledgedAt, consumerId, actionId, consumerId, consumerId);
        acknowledged = Number(updated?.changes ?? 0) === 1;
      } catch (error) {
        acknowledged = false;
        log.warn('durable decision acknowledgement failed', { error: String(error) });
      }
    }
    if (acknowledged) this.#removeActionProjection(actionId);
  }

  /**
   * Apply a claimed action and its domain side effects in one SQLite transaction.
   * The callback must perform the review/event updates using the supplied database.
   * @param {ActionResult} action
   * @param {(db: import('node:sqlite').DatabaseSync) => unknown} apply
   * @returns {unknown}
   */
  applyDecision(action, apply) {
    const db = this.#database();
    if (!db || !this.#hasDurableActions(db) || !action.actionId) {
      const value = db ? apply(db) : undefined;
      this.acknowledgeAction(action.actionId ?? '', action.consumerId ?? null);
      return value;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT * FROM decision_actions WHERE id = ?').get(action.actionId);
      if (!row) throw new InvalidInputError('That decision receipt is no longer available.');
      if (String(row.status) === 'applied') {
        db.exec('COMMIT');
        this.#removeActionProjection(action.actionId);
        return undefined;
      }
      const consumerId = typeof action.consumerId === 'string' ? action.consumerId : '';
      const expiresAt = row.claim_expires_at ? Date.parse(String(row.claim_expires_at)) : NaN;
      if (String(row.status) !== 'claimed' || !consumerId || String(row.consumer_id ?? '') !== consumerId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new InvalidInputError('That decision is no longer claimed by this consumer.');
      }
      for (const [column, value] of [
        ['workspace_id', action.workspaceId],
        ['campaign_id', action.campaignId],
        ['review_id', action.reviewId],
        ['screen_id', action.screenId],
        ['target_revision', action.targetRevision],
      ]) {
        if (row[column] != null && String(row[column]) !== String(value ?? '')) {
          throw new InvalidInputError('That decision belongs to a different workspace, campaign or review target.');
        }
      }
      const value = apply(db);
      const appliedAt = nowIso();
      const updated = db.prepare(
        "UPDATE decision_actions SET status = 'applied', acknowledged_at = ?, applied_at = ? WHERE id = ? AND status = 'claimed' AND consumer_id = ? AND claim_expires_at > ?",
      ).run(appliedAt, appliedAt, action.actionId, consumerId, appliedAt);
      if (!updated || Number(updated.changes ?? 0) !== 1) throw new InvalidInputError('That decision was already claimed by another consumer.');
      db.exec('COMMIT');
      this.#removeActionProjection(action.actionId);
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* rollback best effort */ }
      throw error;
    }
  }

  /**
   * Claim one decision for a single waiter. A claim is a lease rather than removal:
   * cancellation or a process crash leaves the receipt available to a resumed
   * consumer after the lease expires.
   * @param {string} screenId
   * @param {string} consumerId
   * @returns {ActionResult|null}
   */
  #takeDecision(screenId, consumerId) {
    const db = this.#database();
    if (this.#hasDurableActions(db)) {
      try {
        db.exec('BEGIN IMMEDIATE');
        const row = db.prepare(
          "SELECT * FROM decision_actions WHERE screen_id = ? AND status IN ('pending', 'claimed') AND (status = 'pending' OR claim_expires_at IS NULL OR claim_expires_at <= ?) ORDER BY created_at ASC, id ASC LIMIT 1",
        ).get(screenId, nowIso());
        if (!row) {
          db.exec('ROLLBACK');
        } else {
          const expires = new Date(Date.now() + ACTION_CLAIM_LEASE_MS).toISOString();
          const updated = db.prepare(
            "UPDATE decision_actions SET status = 'claimed', consumer_id = ?, claim_expires_at = ?, claimed_at = COALESCE(claimed_at, ?) WHERE id = ? AND status IN ('pending', 'claimed') AND (status = 'pending' OR claim_expires_at IS NULL OR claim_expires_at <= ?)",
          ).run(consumerId, expires, nowIso(), row.id, nowIso());
          if (!updated || Number(updated.changes ?? 0) !== 1) {
            db.exec('ROLLBACK');
            return null;
          }
          db.exec('COMMIT');
          return {
            actionId: String(row.id),
            screenId: String(row.screen_id),
            action: String(row.action),
            payload: parseActionPayload(row.payload),
            at: String(row.created_at),
            workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
            campaignId: row.campaign_id == null ? null : String(row.campaign_id),
            reviewId: row.review_id == null ? null : String(row.review_id),
            targetRevision: row.target_revision == null ? null : String(row.target_revision),
            contextKey: row.context_key == null ? null : String(row.context_key),
            consumerId,
            screenRevision: Number(row.screen_revision ?? 0),
            screenType: row.screen_type == null ? null : String(row.screen_type),
          };
        }
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* rollback best effort */ }
        log.warn('durable decision claim failed', { error: String(error) });
      }
    }

    const store = this.#store();
    const projected = store.read().actions.filter((entry) => entry.screenId === screenId);
    // Once migration 015 is present, an action carrying an id must be claimed from
    // SQLite. Falling back to the projection in that case could let two consumers
    // claim the same receipt while one database claim is still active.
    if (this.#hasDurableActions(db) && projected.some((entry) => entry.actionId)) return null;
    if (projected.length === 0) return null;
    /** @type {ActionResult|null} */
    let taken = null;
    store.transaction((doc) => {
      const index = doc.actions.findIndex((entry) => {
        if (entry.screenId !== screenId) return false;
        if (entry.status === 'applied') return false;
        if (entry.status !== 'claimed') return true;
        return !entry.claimExpiresAt || Date.parse(String(entry.claimExpiresAt)) <= Date.now();
      });
      if (index < 0) return null;
      const current = /** @type {ActionResult} */ (doc.actions[index]);
      taken = { ...current, actionId: current.actionId ?? newId(), consumerId };
      const actions = doc.actions.slice();
      actions[index] = { ...current, ...taken, status: 'claimed', claimExpiresAt: new Date(Date.now() + ACTION_CLAIM_LEASE_MS).toISOString() };
      return { revision: doc.revision + 1, screen: doc.screen, busy: doc.busy, actions, previous: doc.previous, activity: doc.activity ?? null };
    });
    return taken;
  }

  /** @param {ActionResult} action */
  #releaseDecision(action) {
    const db = this.#database();
    if (this.#hasDurableActions(db) && action.actionId) {
      try {
        db.prepare(
          "UPDATE decision_actions SET status = 'pending', consumer_id = NULL, claim_expires_at = NULL WHERE id = ? AND status = 'claimed' AND consumer_id = ?",
        ).run(action.actionId, action.consumerId ?? null);
      } catch (error) {
        log.warn('durable decision release failed', { error: String(error) });
      }
    }
    if (!action.actionId) return;
    const store = this.#store();
    store.transaction((doc) => {
      const index = doc.actions.findIndex((entry) => entry.actionId === action.actionId);
      if (index < 0) return null;
      if (doc.actions[index].status === 'claimed' && doc.actions[index].consumerId !== action.consumerId) return null;
      const actions = doc.actions.slice();
      actions[index] = { ...actions[index], status: 'pending', claimExpiresAt: undefined, consumerId: undefined };
      return { revision: doc.revision + 1, screen: doc.screen, busy: doc.busy, actions, previous: doc.previous, activity: doc.activity ?? null };
    });
  }

  /**
   * Bind the workspace's stored port if whoever held it has gone away.
   *
   * Only one process serves the browser; the others write the same shared state and
   * do not bind anything. When the serving process dies, the address in the person's
   * browser stops answering, so the next process to show a screen claims it. Nothing
   * waits on this: show() stays synchronous and the takeover lands a beat later.
   * @returns {Promise<void>}
   */
  async ensureServing() {
    if (!this.external || this.claimingPort || this.stopped) return;
    const port = this.port;
    if (!port) return;
    this.claimingPort = true;
    try {
      const root = this.workspace && this.workspace.root ? String(this.workspace.root) : null;
      if (root && (await isLivePaneForWorkspace(port, root))) return;
      this.external = false;
      this.requestedPort = port;
      try {
        await this.start();
        log.info('took over the stored pane port', { port });
      } catch (error) {
        // Somebody else got there first, or the socket is not free yet. Stay an
        // adopting process and try again on the next show().
        this.external = true;
        this.port = port;
        log.warn('could not take over the stored pane port', { port, error: String(error) });
      }
    } finally {
      this.claimingPort = false;
    }
  }

  /**
   * Rebind this pane after Workspace.activate changed the live root. A process that
   * adopted workspace A must not keep returning A's socket after switching to B;
   * it either serves B's configured port, adopts a live B pane, or binds a fresh
   * port and persists it. The caller should use the returned URL for the next pane
   * navigation.
   * @returns {Promise<{url: string, port: number, external: boolean, workspaceRoot: string|null}>}
   */
  async rebindWorkspace() {
    const root = this.workspace && this.workspace.root ? String(this.workspace.root) : null;
    if (!root) return { url: this.url(), port: this.port ?? 0, external: this.external, workspaceRoot: null };

    const oldServer = this.server;
    const previousPort = this.port;
    const wasExternal = this.external;
    const previousRoot = this.storeRoot;
    const switchingRoots = Boolean(previousRoot && String(previousRoot) !== root);
    const savedPort = Number(this.workspace.readConfig()?.ui?.port) || 0;
    if (oldServer) {
      this.server = null;
      this.port = null;
      if (typeof oldServer.closeAllConnections === 'function') oldServer.closeAllConnections();
      await new Promise((resolveClose) => oldServer.close(() => resolveClose(undefined)));
    }
    this.external = false;
    this.claimingPort = false;
    this.fileStore = null;
    this.storeRoot = null;
    this.streamId = newId();

    // A newly initialized workspace has no saved port yet. Reuse an owned socket
    // when possible so the browser URL from setup remains valid across adoption.
    // An adopting process cannot safely reclaim another process's old socket, so it
    // falls back to a fresh port when the target has no configured one.
    // Setup initialization can safely keep its temporary in-memory pane port, but
    // an owner switching A -> B must leave A's socket free for another process
    // still waiting on A to reclaim. Use B's saved port when present, otherwise a
    // fresh port for the target workspace.
    // A previously used B port can equal A's old port in a stale config. Do not
    // immediately take that socket back for B, or an A adopter would see B there
    // and be unable to reclaim its own workspace pane.
    const targetSavedPort = switchingRoots && savedPort === Number(previousPort) ? 0 : savedPort;
    const desiredPort = targetSavedPort || (!wasExternal && !switchingRoots ? Number(previousPort) || 0 : 0);
    this.requestedPort = desiredPort;
    if (desiredPort > 0) {
      try {
        await this.start();
      } catch (error) {
        const liveElsewhere = await isLivePaneForWorkspace(desiredPort, root);
        if (liveElsewhere) {
          this.adoptExternal(desiredPort);
        } else {
          log.warn('target workspace pane port was unavailable, selecting another', { port: desiredPort, error: String(error) });
          this.requestedPort = 0;
          await this.start();
        }
      }
    } else {
      await this.start();
    }
    this.workspace.uiUrl = this.url();
    if (!this.external) this.workspace.patchConfig({ ui: { port: this.port } });
    return { url: this.url(), port: this.port ?? 0, external: this.external, workspaceRoot: root };
  }

  // --- pane state, shared through the workspace ---
  /**
   * The screen on show right now, read from the workspace rather than from this
   * process's heap, so a process that did not show it still reports it correctly.
   * @returns {ScreenState}
   */
  get screen() {
    return this.#store().read().screen;
  }

  /**
   * Busy state: set the moment an action resolves a gate or screen decision,
   * cleared the moment the next show() replaces the screen. Lets the client keep
   * visible feedback (top bar pill, slim progress bar) alive across the gap between
   * a click and whatever the tool does next, which can be many seconds of agent work
   * with no screen change to signal it.
   * @returns {{active: boolean, label: string}|null}
   */
  get busy() {
    return this.#store().read().busy;
  }

  /**
   * Restore a screen and busy state saved by a previous process, bypassing the
   * same-screen no-op check in show() (there is nothing to compare against on a
   * fresh boot) and without touching results/waiters, which a fresh process never
   * had populated in the first place.
   *
   * Only restores a screen type the pane still knows how to render actions for
   * (a key of SCREEN_ACTIONS); an unknown or removed screen type is left as the
   * default "Nothing to show yet" rather than showing something the client can no
   * longer act on safely.
   * @param {{screen: ScreenState, busy: {active: boolean, label: string, screenId?: string, targetId?: string|null}|null}} state
   * @returns {boolean} true when a screen was actually restored.
   */
  restoreState(state) {
    const screen = state && typeof state === 'object' ? state.screen : null;
    if (!screen || typeof screen !== 'object') return false;
    if (typeof screen.type !== 'string' || !(screen.type in SCREEN_ACTIONS) && screen.type !== 'message') return false;
    if (typeof screen.screenId !== 'string' || typeof screen.revision !== 'number') return false;
    const busy = state.busy && typeof state.busy === 'object' ? state.busy : null;
    this.#store().transaction((doc) => {
      const revision = Math.max(doc.revision, Number(screen.revision) || 0);
      return {
        revision,
        screen: {
          screenId: screen.screenId,
          type: screen.type,
          data: screen.data && typeof screen.data === 'object' ? screen.data : {},
          contextKey: typeof screen.contextKey === 'string' ? screen.contextKey : null,
          workspaceId: typeof screen.workspaceId === 'string' ? screen.workspaceId : this.workspace?.root ? String(this.workspace.root) : null,
          campaignId: typeof screen.campaignId === 'string' ? screen.campaignId : null,
          reviewId: typeof screen.reviewId === 'string' ? screen.reviewId : null,
          targetRevision: screen.targetRevision == null ? null : String(screen.targetRevision),
          decision: Boolean(screen.decision || REVIEW_SCREEN_TYPES.has(screen.type)),
          revision: Number(screen.revision) || revision,
          shownAt: typeof screen.shownAt === 'string' ? screen.shownAt : nowIso(),
        },
        busy,
        actions: doc.actions,
        previous: null,
        activity: state.activity && typeof state.activity === 'object' ? state.activity : doc.activity ?? null,
      };
    });
    log.info('ui screen restored', { type: screen.type, screenId: screen.screenId });
    return true;
  }
  // --- end pane state persistence ---

  /**
   * Mark the pane busy with the label of whatever the just-resolved action is
   * doing, until the next show() replaces the screen. Call this from
   * submitAction (the HTTP action route already does), or directly from a
   * tool that wants busy to start before any click at all (a stage about to
   * spawn agents, for example).
   * @param {string} label
   */
  setBusy(label) {
    const busy = { active: true, label: String(label ?? 'Working') };
    this.#store().transaction((doc) => ({
      revision: doc.revision + 1,
      screen: doc.screen,
      busy,
      actions: doc.actions,
      previous: doc.previous,
      activity: doc.activity ?? null,
    }));
    this.#notifyLocal();
    if (this.external) void this.ensureServing();
  }

  /** Clear busy without waiting for the next show(). Rarely needed directly. */
  clearBusy() {
    this.#store().transaction((doc) =>
      doc.busy
        ? {
            revision: doc.revision + 1,
            screen: doc.screen,
            busy: null,
            actions: doc.actions,
            previous: doc.previous,
            activity: doc.activity ?? null,
          }
        : null,
    );
    this.#notifyLocal();
  }

  /**
   * Clear the busy marker created by one specific accepted action.
   *
   * A Connections refresh can be a data no-op, so show() has no replacement
   * through which to clear the marker. Matching the action id prevents a slow
   * handler from clearing a newer click that arrived on the same screen.
   * @param {string} screenId
   * @param {string|null|undefined} actionId
   * @returns {boolean} true when this action owned and cleared the marker
   */
  clearBusyForAction(screenId, actionId) {
    const expectedScreenId = String(screenId ?? '');
    const expectedActionId = typeof actionId === 'string' ? actionId : '';
    if (!expectedScreenId || !expectedActionId) return false;
    let cleared = false;
    this.#store().transaction((doc) => {
      const busy = doc.busy;
      if (!busy || String(busy.screenId ?? '') !== expectedScreenId || String(busy.actionId ?? '') !== expectedActionId) return null;
      cleared = true;
      return {
        revision: doc.revision + 1,
        screen: doc.screen,
        busy: null,
        actions: doc.actions,
        previous: doc.previous,
        activity: doc.activity ?? null,
      };
    });
    if (cleared) {
      this.#notifyLocal();
      if (this.external) void this.ensureServing();
    }
    return cleared;
  }

  /**
   * Record one request's chat activity. This is separate from HTTP liveness: a
   * live browser can be waiting while no MCP request is consuming its actions.
   * Activity is a small shared consumer set so two MCP processes can wait on one
   * workspace without one request finishing and clearing the other's indicator.
   * @param {{active: boolean, tool?: string, requestId?: string, startedAt?: string}|null} activity
   */
  setChatActivity(activity) {
    const requestId = activity?.requestId ? String(activity.requestId) : '';
    const heartbeatAt = nowIso();
    let changed = false;
    this.#store().transaction((doc) => {
      const current = normalizeChatActivity(doc.activity);
      const consumers = current?.consumers ? current.consumers.slice() : current?.active ? [legacyActivityConsumer(current)] : [];
      const index = requestId ? consumers.findIndex((entry) => String(entry.requestId) === requestId) : -1;
      if (activity?.active) {
        const nextConsumer = {
          requestId: requestId || `anonymous:${newId()}`,
          tool: activity.tool ? String(activity.tool) : undefined,
          startedAt: index >= 0 ? consumers[index].startedAt : activity.startedAt ? String(activity.startedAt) : heartbeatAt,
          heartbeatAt,
        };
        if (index >= 0) consumers[index] = nextConsumer;
        else consumers.push(nextConsumer);
      } else if (requestId) {
        if (index >= 0) consumers.splice(index, 1);
      } else {
        consumers.length = 0;
      }
      const next = summarizeChatActivity(consumers);
      const previous = doc.activity ?? null;
      changed = !sameScreenData(previous, next);
      if (!changed) return null;
      return {
        revision: doc.revision + 1,
        screen: doc.screen,
        busy: doc.busy,
        actions: doc.actions,
        previous: doc.previous,
        activity: next,
      };
    });
    if (changed) this.#notifyLocal();
  }

  /** @returns {{active: boolean, tool?: string, requestId?: string, startedAt?: string, heartbeatAt?: string}|null} */
  get chatActivity() {
    return this.#store().read().activity ?? null;
  }

  /**
   * Wait for the user to act on a screen.
   *
   * Resolves with the action when the user clicks, or null when the wait runs out.
   * Callers must treat null as "still waiting", not as a rejection.
   * @param {string} screenId
   * @param {{timeoutMs?: number, signal?: AbortSignal, consumerId?: string, acknowledge?: boolean}} [options]
   * @returns {Promise<ActionResult|null>}
   */
  waitForAction(screenId, options = {}) {
    const timeoutMs = options.timeoutMs ?? GATE_WAIT_MS;
    const signal = options.signal ?? null;
    const consumerId = options.consumerId ?? newId();
    const acknowledge = options.acknowledge !== false;
    if (signal?.aborted) return Promise.reject(createAbortError());
    if (this.external) void this.ensureServing();
    const immediate = this.#takeDecision(screenId, consumerId);
    if (immediate) {
      if (signal?.aborted) {
        this.#releaseDecision(immediate);
        return Promise.reject(createAbortError());
      }
      if (acknowledge) this.acknowledgeAction(immediate.actionId ?? '', consumerId);
      return Promise.resolve(immediate);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const deadline = Date.now() + timeoutMs;
      /** @type {NodeJS.Timeout|null} */
      let timer = null;
      /** @type {(() => void)|null} */
      let wake = null;
      /** @type {ActionResult|null} */
      let claimed = null;
      /** @type {(() => void)|null} */
      let abortListener = null;
      /** @param {ActionResult|null} value */
      const finish = (value) => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (wake) this.localWaiters.delete(wake);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
        resolvePromise(value);
      };
      const abort = () => {
        if (claimed) {
          this.#releaseDecision(claimed);
          claimed = null;
        }
        if (timer) clearTimeout(timer);
        timer = null;
        if (wake) this.localWaiters.delete(wake);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
        rejectPromise(createAbortError());
      };
      abortListener = abort;
      signal?.addEventListener('abort', abort, { once: true });
      const tick = () => {
        if (this.stopped) {
          finish(null);
          return;
        }
        if (signal?.aborted) {
          abort();
          return;
        }
        if (this.external) void this.ensureServing();
        const found = this.#takeDecision(screenId, consumerId);
        if (found) {
          claimed = found;
          if (signal?.aborted) {
            abort();
            return;
          }
          if (acknowledge) {
            this.acknowledgeAction(found.actionId ?? '', consumerId);
            claimed = null;
          }
          finish(found);
          return;
        }
        if (Date.now() >= deadline) {
          finish(null);
          return;
        }
        timer = setTimeout(tick, ACTION_POLL_MS);
        if (typeof timer.unref === 'function') timer.unref();
      };
      wake = () => {
        if (timer) clearTimeout(timer);
        tick();
      };
      this.localWaiters.add(wake);
      timer = setTimeout(tick, ACTION_POLL_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  /**
   * Record a decision as if the user had clicked. Used by the HTTP route and by
   * tests. Review actions never use the previous-screen grace path: a click for a
   * different campaign, review or target revision must be refused rather than
   * applied to whatever review happens to be visible now.
   * @param {string} screenId
   * @param {string} action
   * @param {Record<string, unknown>} payload
   * @param {string|null} [requestedActionId]
   * @returns {ActionResult}
   */
  submitAction(screenId, action, payload = {}, requestedActionId = null) {
    const actionId = typeof requestedActionId === 'string' && requestedActionId.trim() ? requestedActionId.trim() : newId();
    const existing = this.#readDurableAction(actionId);
    if (existing) {
      const prior = durableActionResult(existing);
      const current = this.#store().read();
      const namesSame = prior.screenId === screenId || current.previous?.screenId === screenId;
      // An action id is a retry key, not a global acknowledgement token. The
      // current pane context still has to agree with the receipt, otherwise a
      // stale browser POST can acknowledge an identically shaped action from a
      // different campaign or review after the pane has moved on.
      const contextSame = actionContextMatches(prior, current.screen);
      const identitySame = prior.action === action && payloadIdentity(prior.payload) === payloadIdentity(payload);
      if (!namesSame || !contextSame || !identitySame) {
        throw new InvalidInputError('That action id is already used for a different decision.');
      }
      return prior;
    }
    /** @type {Error|null} */
    let refusal = null;
    /** @type {ActionResult|null} */
    let result = null;
    this.#store().transaction((doc) => {
      let effectiveId = doc.screen.screenId;
      if (screenId !== doc.screen.screenId) {
        const previous = doc.previous;
        const currentIsDecision = Boolean(doc.screen.decision || REVIEW_SCREEN_TYPES.has(doc.screen.type));
        const previousIsDecision = Boolean(previous?.decision || REVIEW_SCREEN_TYPES.has(previous?.type));
        const withinGrace =
          previous &&
          previous.screenId === screenId &&
          previous.type === doc.screen.type &&
          previous.contextKey === (doc.screen.contextKey ?? null) &&
          previous.workspaceId === (doc.screen.workspaceId ?? null) &&
          previous.campaignId === (doc.screen.campaignId ?? null) &&
          previous.reviewId === (doc.screen.reviewId ?? null) &&
          String(previous.targetRevision ?? '') === String(doc.screen.targetRevision ?? '') &&
          !currentIsDecision &&
          !previousIsDecision &&
          Date.now() <= Number(previous.until ?? 0);
        if (!withinGrace) {
          refusal = new InvalidInputError('That screen is no longer open.');
          return null;
        }
        // The click named the screen this one just replaced. Honor it against the
        // screen that is actually on show now, so it is never silently dropped.
      }
      const allowed = SCREEN_ACTIONS[doc.screen.type] ?? [];
      if (!allowed.includes(action)) {
        refusal = new InvalidInputError(`The "${doc.screen.type}" screen does not accept "${action}".`);
        return null;
      }
      const safePayload = prepareActionPayload(payload, doc.screen.type, action);
      result = {
        actionId,
        screenId: effectiveId,
        action,
        payload: safePayload,
        at: nowIso(),
        workspaceId: doc.screen.workspaceId ?? (this.workspace?.root ? String(this.workspace.root) : null),
        campaignId: doc.screen.campaignId ?? null,
        reviewId: doc.screen.reviewId ?? null,
        targetRevision: doc.screen.targetRevision == null ? null : String(doc.screen.targetRevision),
        contextKey: doc.screen.contextKey ?? null,
        screenRevision: Number(doc.screen.revision ?? doc.revision ?? 0),
        screenType: doc.screen.type,
      };
      // Commit SQLite first. If this throws, PaneStore.transaction never writes
      // the JSON projection and the HTTP route cannot report a successful click.
      this.#recordDurableAction(/** @type {ActionResult} */ (result));
      // Busy starts the instant the action is accepted, in the same write as the
      // decision itself, so the pane shows feedback even if the tool that will pick
      // the decision up lives in another process and takes a moment to notice.
      // show() clears it again on the next screen.
      return {
        revision: doc.revision + 1,
        screen: doc.screen,
        busy: busyStateFor(doc.screen, action, safePayload, actionId),
        // A second click on the same screen replaces the first undecided one rather
        // than queueing behind it: the last thing the person pressed is the decision.
        actions: [...doc.actions.filter((entry) => entry.screenId !== effectiveId), result],
        previous: doc.previous,
        activity: doc.activity ?? null,
      };
    });
    if (refusal) throw refusal;
    this.#notifyLocal();
    return /** @type {ActionResult} */ (result);
  }

  // --- live refresh ---
  /**
   * Register the function GET /api/live calls while this screen type is on
   * show. Call it again each time the screen is (re)opened, since the fresh
   * function usually closes over that call's own filters (brand, job id).
   * @param {string} type one of the keys in SCREEN_ACTIONS.
   * @param {() => Record<string, unknown>|Promise<Record<string, unknown>>} fn
   */
  registerRefresher(type, fn) {
    this.refreshers.set(type, fn);
  }
  // --- end live refresh ---

  /** Close the socket and release every waiter. */
  async stop() {
    this.stopped = true;
    this.#notifyLocal();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
  }

  /**
   * Resolve once the shared state has moved past `since`, or after EVENT_POLL_MS.
   *
   * A change made in this process wakes this immediately; a change made in another
   * process arrives on the next poll of the workspace file, which is the price of
   * two sessions sharing one pane and is well under what a person notices.
   * @param {number} since
   * @returns {Promise<number>}
   */
  #waitForRevision(since) {
    const current = this.#store().read().revision;
    if (current > since) return Promise.resolve(current);
    return new Promise((resolvePromise) => {
      const deadline = Date.now() + EVENT_POLL_MS;
      /** @type {NodeJS.Timeout|null} */
      let timer = null;
      /** @type {(() => void)|null} */
      let wake = null;
      /** @param {number} revision */
      const finish = (revision) => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (wake) this.localWaiters.delete(wake);
        resolvePromise(revision);
      };
      const tick = () => {
        const revision = this.#store().read().revision;
        if (this.stopped || revision > since || Date.now() >= deadline) {
          finish(revision);
          return;
        }
        timer = setTimeout(tick, EVENT_TICK_MS);
        if (typeof timer.unref === 'function') timer.unref();
      };
      wake = () => {
        if (timer) clearTimeout(timer);
        tick();
      };
      this.localWaiters.add(wake);
      timer = setTimeout(tick, EVENT_TICK_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  /** Upgrade the retired connector layout before it reaches a restored browser. */
  async #normalizeLegacyConnections() {
    const previous = this.screen;
    if (previous.type !== 'integration_connect' || !this.workspace?.root) return;
    const workspace = this.workspace.captureContext();
    const { connectionsScreenData, connectionKeyForProvider } = await import('../tools/connections.mjs');
    const focus = connectionKeyForProvider(previous.data.provider) ?? 'publishing';
    const data = await connectionsScreenData(workspace, { setup: false, focus });
    this.withWorkspaceContext(workspace, () => {
      // Another process may have opened a newer page while capabilities loaded.
      if (this.screen.screenId !== previous.screenId || this.screen.type !== 'integration_connect') return;
      this.show('connections', data, { contextKey: 'home' });
    });
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async #handle(request, response) {
    const url = new URL(request.url ?? '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;
    if (path === '/board' || path === '/api/board' || path === '/api/board/media') {
      const expectedHost = `${this.host}:${this.port}`;
      const origin = request.headers.origin;
      if (request.headers.host !== expectedHost || (origin && origin !== `http://${expectedHost}`) || request.headers['sec-fetch-site']==='cross-site') {
        sendJson(response, 403, {error:'Open the board from the local session URL.'});
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (path === '/board') {
        if (request.method !== 'GET') { sendJson(response,405,{error:'Use GET.'});return; }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; frame-ancestors 'self'");
        response.end(buildBoard({config:{mode:'local'}}));
        return;
      }
      if(path==='/api/board/media') {
        if(!['GET','HEAD'].includes(request.method)){sendJson(response,405,{error:'Use GET or HEAD.'});return;}
        try {
          const media=boardMedia({...Object.fromEntries(url.searchParams),root:this.workspace?.root});
          let start=0,end=media.size-1;
          const range=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          if(request.headers.range && !range){response.writeHead(416,{'Content-Range':`bytes */${media.size}`});response.end();return;}
          if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
          if(start>end || start>=media.size){response.writeHead(416,{'Content-Range':`bytes */${media.size}`});response.end();return;}
          response.writeHead(range?206:200,{'Content-Type':media.mimeType,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.size}`}:{})});
          if(request.method==='HEAD'){response.end();return;}
          const stream=createReadStream(media.file,{start,end});stream.on('error',()=>response.destroy());stream.pipe(response);
        }catch(error){sendJson(response,400,{error:error.message});}
        return;
      }
      if (request.method !== 'POST' || request.headers['x-social-campaign'] !== 'board' || !request.headers['content-type']?.startsWith('application/json')) {
        sendJson(response,400,{error:'Use the board JSON action protocol.'});return;
      }
      try {
        const body = await readJsonBody(request);
        const result = boardOperation({root:this.workspace?.root,operation:body.operation,args:body.args,source:'local'});
        sendJson(response,200,result);
      } catch(error) { sendJson(response,400,{error:error.message}); }
      return;
    }
    if (path === '/api/state' || path === '/api/events') await this.#normalizeLegacyConnections();

    if (path === '/api/state') {
      const doc = this.#store().read();
      sendJson(response, 200, {
        revision: doc.revision,
        stream: this.streamId,
        screen: doc.screen,
        decided: doc.actions.some((entry) => entry.screenId === doc.screen.screenId),
        busy: doc.busy,
        activity: doc.activity ?? null,
        workspaceRoot: this.workspace && this.workspace.root ? this.workspace.root : null,
      });
      return;
    }

    if (path === '/api/events') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0;
      const sinceStream = url.searchParams.get('stream') ?? '';
      // A client whose stream id no longer matches is polling against a counter
      // this process has already replaced (memory -> workspace file store): tell
      // it about the current screen immediately rather than waiting for a
      // revision comparison that counter swap may have made meaningless.
      if (sinceStream && sinceStream !== this.streamId) {
        const doc = this.#store().read();
        sendJson(response, 200, { revision: doc.revision, stream: this.streamId, screen: doc.screen, busy: doc.busy, activity: doc.activity ?? null });
        return;
      }
      await this.#waitForRevision(since);
      const doc = this.#store().read();
      sendJson(response, 200, { revision: doc.revision, stream: this.streamId, screen: doc.screen, busy: doc.busy, activity: doc.activity ?? null });
      return;
    }

    if (path === '/api/action') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Use POST for actions.' });
        return;
      }
      const body = await readJsonBody(request);
      const screenId = typeof body.screenId === 'string' ? body.screenId : '';
      const action = typeof body.action === 'string' ? body.action : '';
      const actionId = typeof body.actionId === 'string' ? body.actionId : null;
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      if (!screenId || !action) {
        sendJson(response, 400, { error: 'An action needs a screen and an action name.' });
        return;
      }
      try {
        const result = this.submitAction(screenId, action, payload, actionId);
        sendJson(response, 200, { ok: true, result });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // ---------------------------------------------------------------------
    // Live refresh: GET /api/live?screenId=  fresh data for the screen that is
    // on show right now, when that screen type registered a refresher. This is
    // how the pane keeps counts and tiles current while a background agent is
    // writing analyses: nothing has to call show() again to move the numbers.
    //
    // A screenId that does not match the one currently on show comes back with
    // data: null, same as a screen with no refresher at all, so a client that
    // is a beat behind never patches the wrong screen.
    // ---------------------------------------------------------------------
    if (path === '/api/live') {
      const requested = url.searchParams.get('screenId') ?? '';
      const refresher = this.refreshers.get(this.screen.type);
      if (!refresher || requested !== this.screen.screenId) {
        sendJson(response, 200, { screenId: this.screen.screenId, data: null });
        return;
      }
      try {
        // A refresher may be async (the connections screen resolves capabilities
        // and probes the research helper before it can answer), so await it here
        // rather than shipping a pending promise out as an empty object.
        sendJson(response, 200, { screenId: this.screen.screenId, data: await refresher() });
      } catch (error) {
        log.error('live refresh failed', { error: String(error) });
        sendJson(response, 200, { screenId: this.screen.screenId, data: null });
      }
      return;
    }
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Folder picker.
    //
    // Three routes so a person can point at a folder instead of typing its path.
    // Every guard lives in ./folders.mjs and in chooseFolderNative: no file is ever
    // listed, no symlink is followed out of the folder being listed, a path that is
    // not absolute is refused rather than resolved against the server's own
    // directory, and an unreadable folder comes back as one plain sentence.
    //
    // The native chooser gets a ticket rather than a held-open request, because the
    // dialog can sit on screen for two minutes. That is the same shape as the gate
    // pattern the review tools use, and it means no MCP tool call is ever blocked on
    // a window the person has not answered.
    // ---------------------------------------------------------------------
    if (path === '/api/folders') {
      const asked = url.searchParams.get('path');
      const outcome = listFolders(asked && asked.length > 0 ? asked : this.#homeFolder());
      if ('error' in outcome) {
        sendJson(response, 400, { error: outcome.error, shortcuts: folderShortcuts() });
        return;
      }
      sendJson(response, 200, outcome.listing);
      return;
    }

    if (path === '/api/folders/create') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Use POST to make a folder.' });
        return;
      }
      const body = await readJsonBody(request);
      const outcome = createFolder(body.parent, body.name);
      if ('error' in outcome) {
        sendJson(response, 400, { error: outcome.error });
        return;
      }
      const listed = listFolders(outcome.path);
      sendJson(response, 200, {
        path: outcome.path,
        ...('listing' in listed ? { listing: listed.listing } : {}),
      });
      return;
    }

    if (path === '/api/native-folder') {
      if (request.method === 'POST') {
        sendJson(response, 200, { ticket: this.#startNativeDialog() });
        return;
      }
      const ticket = url.searchParams.get('ticket') ?? '';
      const entry = this.nativeDialogs.get(ticket);
      if (!entry) {
        sendJson(response, 404, { error: 'That folder window is no longer open.' });
        return;
      }
      if (entry.status === 'open') {
        sendJson(response, 200, { status: 'open' });
        return;
      }
      this.nativeDialogs.delete(ticket);
      sendJson(response, 200, { status: 'done', path: entry.path, reason: entry.reason });
      return;
    }
    // --- end folder picker ---

    // =====================================================================
    // Brand reference uploads: localhost only, one file per request, raw
    // body, no multipart parsing (this server has no npm dependencies).
    //
    //   POST /api/brand-references/upload?target=<id>&filename=<name>
    //     target is either a real brand id (uploads land straight in
    //     <workspace>/brands/<slug>/references/) or a draft id handed out by
    //     brand_onboarding_open before the brand exists yet (uploads land in
    //     <workspace>/.social-campaign/uploads/<draft id>/references/ and are
    //     moved into the brand's folder once brand_create runs).
    //   GET  /api/brand-references/font/<target>/<filename>
    //     serves a font file back for the pane's @font-face preview. Images
    //     and videos are served through the existing /thumbs/ route once
    //     registered, since registration gives them a normal asset thumbnail.
    //
    // Every guard lives here: an allowed extension, magic bytes that agree
    // with it, a per-extension size cap, a per-target count cap, and a file
    // name that cannot escape the folder it is written into. The body is
    // streamed straight to disk rather than buffered in memory.
    // =====================================================================
    if (path === '/api/brand-references/upload') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Use POST to upload a reference.' });
        return;
      }
      await this.#handleReferenceUpload(request, response, url);
      return;
    }

    if (path.startsWith('/api/brand-references/font/')) {
      this.#serveReferenceFont(path, response);
      return;
    }
    // --- end brand reference uploads ---

    if (path.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Unknown endpoint.' });
      return;
    }

    // ---------------------------------------------------------------------
    // GET /generated/<path>: preview images and video for the media review
    // gate. Localhost only (this whole server is), and confined to
    // <workspace>/generated the same way static files are confined to ui/.
    // ---------------------------------------------------------------------
    if (path.startsWith('/generated/')) {
      this.#serveGenerated(path, response);
      return;
    }
    // ---------------------------------------------------------------------

    // --- creative library thumbnails: GET /thumbs/<asset_id>/<file> ---
    if (path.startsWith('/thumbs/')) {
      this.#serveThumb(path, response);
      return;
    }
    // --- end creative library thumbnails ---

    this.#serveStatic(path, response);
  }

  // --- folder picker ---
  /** Where a picker with no path of its own starts. @returns {string} */
  #homeFolder() {
    return homedir();
  }

  /**
   * Open the operating system's folder chooser and hand back a ticket at once.
   *
   * Only one window at a time: asking again while one is open returns the ticket that
   * is already running, so a double click cannot stack two dialogs.
   * @returns {string}
   */
  #startNativeDialog() {
    for (const [ticket, entry] of this.nativeDialogs) {
      if (entry.status === 'open') return ticket;
    }
    const ticket = newId();
    this.nativeDialogs.set(ticket, { status: 'open', path: null, reason: 'open' });
    this.chooseFolder()
      .then((outcome) => {
        this.nativeDialogs.set(ticket, { status: 'done', path: outcome.path, reason: outcome.reason });
      })
      .catch(() => {
        // A chooser that throws is a chooser that is not there. The pane falls back.
        this.nativeDialogs.set(ticket, { status: 'done', path: null, reason: 'unavailable' });
      });
    return ticket;
  }
  // --- end folder picker ---

  // --- brand reference uploads ---
  /**
   * Where target's reference files live: the real brand folder when target is a
   * known brand id, otherwise a draft staging folder keyed by the draft id.
   * @param {string} target
   * @returns {{dir: string, brandId: string|null}|null} null when there is no workspace.
   */
  #referencesDirFor(target) {
    const root = this.workspace && this.workspace.root ? this.workspace.root : null;
    if (!root) return null;
    let brand = null;
    try {
      brand = this.workspace.db ? this.workspace.db.prepare('SELECT id, slug FROM brands WHERE id = ?').get(target) : null;
    } catch {
      brand = null;
    }
    if (brand) {
      return { dir: join(root, 'brands', String(brand.slug), 'references'), brandId: String(brand.id) };
    }
    return { dir: join(root, '.social-campaign', 'uploads', target, 'references'), brandId: null };
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {URL} url
   */
  async #handleReferenceUpload(request, response, url) {
    const target = url.searchParams.get('target') ?? '';
    const rawName = url.searchParams.get('filename') ?? '';
    if (!isId(target)) {
      sendJson(response, 400, { error: 'That upload has no valid brand or draft to attach to.' });
      request.resume();
      return;
    }
    // The name must be a bare file name: no path separators, no leading dot, so it
    // cannot climb out of the references folder it is about to be written into.
    const safeName = basenameOnly(rawName);
    const extension = extname(safeName).toLowerCase();
    const cap = REFERENCE_EXTENSION_CAPS[extension];
    if (!safeName || !cap) {
      sendJson(response, 400, {
        error: 'That file type is not accepted. Attach an image, a video or a font file (.ttf, .otf, .woff, .woff2).',
      });
      request.resume();
      return;
    }
    const located = this.#referencesDirFor(target);
    if (!located) {
      sendJson(response, 400, { error: 'Social Campaign has no workspace open yet.' });
      request.resume();
      return;
    }
    let existingCount = 0;
    try {
      existingCount = existsSync(located.dir) ? readdirSync(located.dir).length : 0;
    } catch {
      existingCount = 0;
    }
    if (existingCount >= MAX_REFERENCES_PER_TARGET) {
      sendJson(response, 400, {
        error: `Social Campaign keeps up to ${MAX_REFERENCES_PER_TARGET} references per brand. Remove one before adding another.`,
      });
      request.resume();
      return;
    }
    mkdirSync(located.dir, { recursive: true });
    let target2 = join(located.dir, safeName);
    if (!isInside(located.dir, target2)) {
      sendJson(response, 400, { error: 'That file name is not allowed.' });
      request.resume();
      return;
    }
    // A duplicate name gets a numbered suffix rather than overwriting a different
    // attachment that happens to share a file name.
    target2 = uniqueTarget(target2);

    const megabytes = Math.round(cap / (1024 * 1024));
    let bytesWritten = 0;
    let refused = false;
    const stream = createWriteStream(target2);
    await new Promise((settle) => {
      request.on('data', (chunk) => {
        if (refused) return;
        bytesWritten += chunk.length;
        if (bytesWritten > cap) {
          // Stop writing and remember the refusal, but let the request keep
          // draining rather than destroying the socket: killing the connection
          // here would abort the response too, and the client would see a
          // broken connection instead of the plain refusal it is owed.
          if (!refused) stream.destroy();
          refused = true;
          return;
        }
        stream.write(chunk);
      });
      request.on('end', () => {
        if (!refused) stream.end();
        else settle(undefined);
      });
      request.on('error', () => {
        refused = true;
        stream.destroy();
      });
      stream.on('finish', settle);
      stream.on('close', settle);
      stream.on('error', () => {
        refused = true;
        settle(undefined);
      });
    });
    if (refused) {
      try {
        unlinkSync(target2);
      } catch {
        // nothing on disk to clean up
      }
      sendJson(response, 400, {
        error: `That file is larger than the ${megabytes}MB limit for ${extension} references.`,
      });
      return;
    }

    // sniffMagic alone, not detectType: detectType falls back to trusting the
    // extension whenever the magic bytes are not one it recognises at all, which is
    // right for text formats that have no magic number but wrong for a reference
    // upload, where every accepted extension does have one. The sniffed mime group
    // must actually match the extension's own group, image, video or font.
    let sniffedMime = null;
    try {
      const found = sniffMagic(readHead(target2));
      sniffedMime = found ? found.mime : null;
    } catch {
      sniffedMime = null;
    }
    const expectedGroup = IMAGE_EXTENSION_SET.has(extension) ? 'image' : VIDEO_EXTENSION_SET.has(extension) ? 'video' : 'font';
    const actualGroup = sniffedMime ? sniffedMime.split('/')[0] : null;
    if (actualGroup !== expectedGroup) {
      try {
        unlinkSync(target2);
      } catch {
        // best effort cleanup of a file that failed the magic byte check
      }
      sendJson(response, 400, { error: 'That file does not look like a real file of its type and was not kept.' });
      return;
    }

    try {
      const result = await registerFile({
        db: this.workspace.requireDb(),
        workspaceRoot: this.workspace.requireRoot(),
        path: target2,
        brandId: located.brandId,
        origin: 'reference',
      });
      sendJson(response, 200, { ok: true, asset: result.asset });
    } catch (error) {
      log.error('reference registration failed', { error: String(error) });
      sendJson(response, 200, {
        ok: true,
        asset: {
          filename: safeName,
          path: target2,
          mime: sniffedMime,
          kind: expectedGroup,
          thumbnail_url: null,
        },
      });
    }
  }

  /**
   * Serve a font file back to the pane for an in-page @font-face preview.
   * @param {string} path
   * @param {import('node:http').ServerResponse} response
   */
  #serveReferenceFont(path, response) {
    const match = /^\/api\/brand-references\/font\/([0-9A-HJKMNP-TV-Z]{26})\/([^/]+)$/.exec(path);
    const target = match ? match[1] : null;
    const filename = match ? decodeURIComponent(match[2]) : null;
    const located = target ? this.#referencesDirFor(target) : null;
    const candidate = located && filename ? normalize(join(located.dir, filename)) : null;
    const fontMime = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    const ext = candidate ? extname(candidate).toLowerCase() : '';
    if (
      !candidate ||
      !located ||
      !fontMime[ext] ||
      !isInside(located.dir, candidate) ||
      !existsSync(candidate) ||
      !statSync(candidate).isFile()
    ) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': fontMime[ext], 'cache-control': 'no-store' });
    createReadStream(candidate).pipe(response);
  }
  // --- end brand reference uploads ---

  // --- creative library thumbnails ---
  /**
   * Serve one extracted frame. The asset id and file name must match strict
   * patterns, so a path cannot escape the thumbs folder, and nothing is served
   * until a workspace has told the pane where that folder is.
   * @param {string} path
   * @param {import('node:http').ServerResponse} response
   */
  #serveThumb(path, response) {
    const match = /^\/thumbs\/([0-9A-Z]{26})\/(frame-\d{2}\.jpg)$/.exec(path);
    const root = this.workspace && this.workspace.root ? computeThumbsRoot(this.workspace.root) : this.thumbsRoot;
    const candidate = match && root ? normalize(join(root, match[1], match[2])) : null;
    if (!candidate || !root || !isInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
    createReadStream(candidate).pipe(response);
  }
  // --- end creative library thumbnails ---

  /**
   * @param {string} path
   * @param {import('node:http').ServerResponse} response
   */
  #serveGenerated(path, response) {
    const root = this.workspace && this.workspace.root ? join(this.workspace.root, 'generated') : null;
    if (!root) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const relative = decodeURIComponent(path.slice('/generated/'.length));
    const candidate = normalize(join(root, relative));
    if (!isInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(candidate).pipe(response);
  }

  /**
   * @param {string} path
   * @param {import('node:http').ServerResponse} response
   */
  #serveStatic(path, response) {
    const relative = path === '/' ? 'index.html' : decodeURIComponent(path).replace(/^\/+/, '');
    const candidate = normalize(join(UI_ROOT, relative));
    if (!isInside(UI_ROOT, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(candidate).pipe(response);
  }
}

/**
 * Ask whatever is listening on 127.0.0.1:port whether it is a Social Campaign pane
 * already serving this same workspace.
 *
 * Used at boot when the saved port is busy: rather than assume the port is busy
 * for an unrelated reason and grab a new one (which is what stranded the person
 * from their open pane), the server checks whether the thing holding the port is
 * itself a live Social Campaign pane for this workspace. If so, the caller should
 * not start a second pane server at all; the person already has one open.
 * @param {number} port
 * @param {string} workspaceRoot
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isLivePaneForWorkspace(port, workspaceRoot, timeoutMs = 1500) {
  if (!port || !workspaceRoot) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body && body.screen && body.workspaceRoot === workspaceRoot);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the pane's durable action log lives, alongside pane-state.json. Kept here
 * rather than in server/lib/paths.mjs because it is an implementation detail of the
 * pane's shared store and nothing outside this module needs to name it.
 * @param {string} root
 * @returns {string}
 */
export function paneActionsPath(root) {
  return join(dirname(paneStatePath(root)), 'ui-actions.jsonl');
}

/**
 * Read pane-state.json for a workspace, if it exists and is recent enough to
 * trust. Called once at boot, before the UI server has a screen of its own.
 * Never throws: a missing, corrupt or stale file simply means no restore, which
 * is the same "Nothing to show yet" a person would have seen before this
 * feature existed.
 * @param {string} root
 * @param {number} [maxAgeMs]
 * @returns {{screen: ScreenState, busy: {active: boolean, label: string, screenId?: string, targetId?: string|null}|null}|null}
 */
export function loadPaneState(root, maxAgeMs = PANE_STATE_MAX_AGE_MS) {
  try {
    const target = paneStatePath(root);
    if (!existsSync(target)) return null;
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    const savedAt = typeof parsed?.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs) return null;
    if (!parsed || typeof parsed !== 'object' || !parsed.screen) return null;
    return { screen: parsed.screen, busy: parsed.busy ?? null };
  } catch (error) {
    log.warn('pane state read failed', { error: String(error) });
    return null;
  }
}

/**
 * Structural equality for screen data, used only to decide whether a show()
 * call is a genuine change. JSON.stringify is enough here: screen data is
 * plain, JSON-serializable payloads (strings, numbers, arrays, plain objects)
 * built fresh each call in the same order, never Dates, Maps or class
 * instances, so two calls with the same values produce the same string.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function sameScreenData(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

const CHAT_ACTIVITY_STALE_MS = 45_000;

/** @param {any} entry @returns {boolean} */
function chatActivityFresh(entry) {
  const stamp = entry && typeof entry === 'object' ? entry.heartbeatAt ?? entry.startedAt : null;
  const at = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) && Date.now() - at <= CHAT_ACTIVITY_STALE_MS;
}

/** @param {any} value @returns {any|null} */
function normalizeChatActivity(value) {
  if (!value || typeof value !== 'object' || value.active !== true) return null;
  if (Array.isArray(value.consumers)) {
    return summarizeChatActivity(value.consumers.filter(chatActivityFresh));
  }
  return chatActivityFresh(value) ? { ...value, consumers: [legacyActivityConsumer(value)] } : null;
}

/** @param {any} value @returns {{requestId: string, tool?: string, startedAt?: string, heartbeatAt?: string}} */
function legacyActivityConsumer(value) {
  return {
    requestId: value.requestId ? String(value.requestId) : 'legacy',
    tool: value.tool ? String(value.tool) : undefined,
    startedAt: value.startedAt ? String(value.startedAt) : undefined,
    heartbeatAt: value.heartbeatAt ? String(value.heartbeatAt) : undefined,
  };
}

/** @param {Array<{requestId: string, tool?: string, startedAt?: string, heartbeatAt?: string}>} consumers @returns {any|null} */
function summarizeChatActivity(consumers) {
  if (!Array.isArray(consumers) || consumers.length === 0) return null;
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
 * Reduce a client-supplied file name to a safe bare name: no directory
 * separators, no leading dots that could resolve to a parent folder, no empty
 * result. Returns '' when nothing safe is left.
 * @param {string} rawName
 * @returns {string}
 */
function basenameOnly(rawName) {
  const decoded = (() => {
    try {
      return decodeURIComponent(String(rawName ?? ''));
    } catch {
      return String(rawName ?? '');
    }
  })();
  const stripped = basename(decoded.replace(/[/\\]+/g, '/')).trim();
  const cleaned = stripped.replace(/^\.+/, '').replace(/[\u0000-\u001f]/g, '');
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned.slice(0, 200) : '';
}

/**
 * Add a numbered suffix until the path is free, so a second attachment named
 * the same thing never overwrites the first.
 * @param {string} candidate
 * @returns {string}
 */
function uniqueTarget(candidate) {
  if (!existsSync(candidate)) return candidate;
  const ext = extname(candidate);
  const stem = candidate.slice(0, candidate.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const next = `${stem}-${i}${ext}`;
    if (!existsSync(next)) return next;
  }
  return candidate;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function parseActionPayload(value) {
  if (value && typeof value === 'object') return /** @type {Record<string, unknown>} */ (value);
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} payload @returns {Record<string, unknown>} */
function prepareActionPayload(payload, screenType = '', action = '') {
  const input = payload && typeof payload === 'object' ? { ...payload } : {};
  const apiKey = typeof input.api_key === 'string' ? input.api_key.trim() : '';
  const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
  const isPublisherConnect =
    ['integration_connect', 'connections'].includes(screenType) &&
    action === 'connect' &&
    ['blotato', 'postiz', 'buffer'].includes(provider);
  if (apiKey && isPublisherConnect) {
    // Credentials are the only user supplied value that must survive a process
    // hop. Store it in the machine credential store and retain only its short lived
    // reference in the pane projection, SQLite receipt and HTTP response.
    const credentialRef = putCredential(apiKey, {
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    delete input.api_key;
    input.credential_ref = credentialRef;
  } else if (Object.hasOwn(input, 'api_key')) {
    // A stray credential-shaped field on a review or another action is not a
    // credential submission. Drop it before writing the receipt or returning the
    // action so an unrelated screen cannot create a usable vault entry.
    delete input.api_key;
  }
  return input;
}

/**
 * Compare retry payloads without retaining or echoing credential material. A
 * credential reference is intentionally ignored because a browser retry may have
 * created a new short lived reference before the first receipt was observed.
 * @param {unknown} value
 * @returns {string}
 */
function payloadIdentity(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.entries(entry)
          .filter(([key]) => key !== 'api_key' && key !== 'credential_ref')
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value ?? {}));
}

/**
 * Keep an action retry in the pane context that received it. The screen id check
 * alone is insufficient because the immediately previous id is intentionally
 * accepted for a short race window, and that id can otherwise cross a campaign
 * or review boundary.
 * @param {ActionResult} action
 * @param {ScreenState} screen
 * @returns {boolean}
 */
function actionContextMatches(action, screen) {
  if (!screen) return false;
  for (const [actionValue, screenValue] of [
    [action.workspaceId, screen.workspaceId],
    [action.campaignId, screen.campaignId],
    [action.reviewId, screen.reviewId],
    [action.targetRevision, screen.targetRevision],
    [action.contextKey, screen.contextKey],
  ]) {
    if (String(actionValue ?? '') !== String(screenValue ?? '')) return false;
  }
  return true;
}

/**
 * @param {ActionResult} action
 * @param {any} row
 * @returns {boolean}
 */
function durableActionMatches(action, row) {
  const same = (left, right) => String(left ?? '') === String(right ?? '');
  return (
    same(action.actionId, row.id) &&
    same(action.workspaceId, row.workspace_id) &&
    same(action.campaignId, row.campaign_id) &&
    same(action.reviewId, row.review_id) &&
    same(action.screenId, row.screen_id) &&
    Number(action.screenRevision ?? 0) === Number(row.screen_revision ?? 0) &&
    same(action.screenType, row.screen_type) &&
    same(action.contextKey, row.context_key) &&
    same(action.targetRevision, row.target_revision) &&
    same(action.action, row.action) &&
    payloadIdentity(action.payload) === payloadIdentity(parseActionPayload(row.payload))
  );
}

/** @param {unknown} error @returns {boolean} */
function isUniqueConstraintError(error) {
  const message = String(error).toLowerCase();
  return message.includes('unique constraint') || (message.includes('constraint failed') && message.includes('decision_actions'));
}

/** @param {any} row @returns {ActionResult} */
function durableActionResult(row) {
  return {
    actionId: String(row.id),
    screenId: String(row.screen_id),
    action: String(row.action),
    payload: parseActionPayload(row.payload),
    at: String(row.created_at),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    campaignId: row.campaign_id == null ? null : String(row.campaign_id),
    reviewId: row.review_id == null ? null : String(row.review_id),
    targetRevision: row.target_revision == null ? null : String(row.target_revision),
    contextKey: row.context_key == null ? null : String(row.context_key),
    consumerId: row.consumer_id == null ? undefined : String(row.consumer_id),
    screenRevision: Number(row.screen_revision ?? 0),
    screenType: row.screen_type == null ? null : String(row.screen_type),
  };
}

/** @returns {Error} */
function createAbortError() {
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  // @ts-expect-error attaching a stable marker for transport callers
  error.code = 'REQUEST_CANCELLED';
  return error;
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
function readJsonBody(request) {
  return new Promise((resolvePromise) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(raw || '{}');
        resolvePromise(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        resolvePromise({});
      }
    });
    request.on('error', () => resolvePromise({}));
  });
}
