/**
 * Social Campaign pane, client side.
 *
 * The server owns the screen. This file fetches it, hands it to the matching render
 * function, and long polls /api/events for the next one. A screen module never
 * fetches anything itself: it gets (data, act) and returns an element.
 *
 * To add a screen: create ui/screens/<type>.js exporting render(data, act), then add
 * it to the SCREENS map below. See docs/ARCHITECTURE.md.
 */

import { render as setup } from './screens/setup.js';
import { render as home } from './screens/home.js';
import { render as connections, update as updateConnections } from './screens/connections.js';
import { render as message } from './screens/message.js';
import { render as newJob } from './screens/new_job.js';
import { render as startingPoint } from './screens/starting_point.js';
import { render as intake } from './screens/intake.js';
import { render as jobPlan } from './screens/job_plan.js';
import { render as brandOnboarding } from './screens/brand_onboarding.js';
import { render as strategyReview } from './screens/strategy_review.js';
import { render as conceptReview } from './screens/concept_review.js';
import { render as costReview } from './screens/cost_review.js';
import { render as mediaReview } from './screens/media_review.js';
import { render as finalReview } from './screens/final_review.js';
import { render as researchProgress } from './screens/research_progress.js';
import { render as researchResults } from './screens/research_results.js';
import { render as publish } from './screens/publish.js';
import { render as question } from './screens/question.js';
import { render as workspaceSwitch } from './screens/workspace_switch.js';
import { armButtonGroup, borderTrail, resetButtonGroups, resetTileGroups } from './screens/dom.js';
import { busyCard } from './busy.js';
import { render as creativeLibrary, hasPendingWork as creativeLibraryHasPendingWork, liveUpdate as creativeLibraryLiveUpdate } from './screens/creative_library.js';
import { stub } from './screens/stub.js';

/**
 * Screens whose truth can move without a tool re-showing them (a background
 * agent writing analyses, for example). Each entry names the module's
 * `liveUpdate(container, data)` patcher and its `hasPendingWork(data)` guard.
 * A screen type with no entry here is never polled.
 * @type {Record<string, {liveUpdate: (container: HTMLElement, data: any) => boolean, hasPendingWork: (data: any) => boolean}>}
 */
const LIVE_SCREENS = {
  creative_library: { liveUpdate: creativeLibraryLiveUpdate, hasPendingWork: creativeLibraryHasPendingWork },
};

/** How often a live-capable screen polls GET /api/live while work is in flight. */
const LIVE_POLL_MS = 2000;

/** @type {Record<string, (data: any, act: (action: string, payload?: any) => void) => HTMLElement>} */
const SCREENS = {
  setup,
  home,
  connections,
  message,
  // Every screen type in spec section 22. A stub still stands in for the ones that are not built yet.
  new_job: newJob,
  starting_point: startingPoint,
  intake,
  job_plan: jobPlan,
  brand_onboarding: brandOnboarding,
  creative_library: creativeLibrary,
  research_progress: researchProgress,
  research_results: researchResults,
  strategy_review: strategyReview,
  concept_review: conceptReview,
  cost_review: costReview,
  media_review: mediaReview,
  final_review: finalReview,
  publish,
  question,
  workspace_switch: workspaceSwitch,
};

const root = document.getElementById('root');
const connection = document.getElementById('connection');
const chatActivity = document.getElementById('chat-activity');
const busyPill = document.getElementById('busy-pill');
const busyBar = document.getElementById('busy-bar');

/** The border trail started by `applyBusy` for a busy state that showed up without
 * a local button click to start one itself (a decision made elsewhere, for
 * example). Tracked here so it can be stopped the moment busy clears or the
 * screen changes, rather than left running on a card nobody is waiting on. */
let busyTrail = null;
let busyTrailTarget = null;

/**
 * Reflect the server's busy state (from /api/state or /api/events) in the top
 * bar pill and the slim bar under it. This is the one consistent "the system
 * is doing something" signal: it stays visible even when the pressed button
 * that started it has scrolled out of view, and it clears itself the instant
 * a new screen replaces the busy one (the server clears busy in show()).
 *
 * Restore a border trail only on the card named by the action, or the sole card
 * when there is no ambiguity. Local click feedback already owns its own trail.
 * @param {{active: boolean, label: string, screenId?: string, targetId?: string|null}|null} busy
 */
function applyBusy(busy) {
  const active = Boolean(busy && busy.active);
  busyPill.hidden = !active;
  busyPill.dataset.busy = String(active);
  busyPill.textContent = active ? String(busy.label ?? 'Working') : '';
  busyBar.dataset.busy = String(active);

  if (active) {
    const target = busyCard(root, busy, currentScreenId);
    if (busyTrail && busyTrailTarget !== target) {
      busyTrail.stop();
      busyTrail = null;
      busyTrailTarget = null;
    }
    if (target && busy.targetId && busy.screenId === currentScreenId) {
      for (const other of root.querySelectorAll('.conn-card.has-trail')) {
        if (other !== target) borderTrail(other).stop();
      }
    }
    if (!busyTrail && target) {
      // borderTrail adopts an existing local click overlay without duplicating it.
      busyTrail = borderTrail(target);
      busyTrailTarget = target;
    }
  } else if (busyTrail) {
    busyTrail.stop();
    busyTrail = null;
    busyTrailTarget = null;
  }
  if (!active && currentType === 'connections') resetButtonGroups(root);
}

/** Keep HTTP liveness and an active chat consumer as separate signals. */
function applyChatActivity(activity, busy = null) {
  if (!chatActivity) return;
  const active = Boolean(activity && activity.active);
  const waiting = Boolean(busy && busy.active);
  chatActivity.dataset.state = active ? 'active' : waiting ? 'waiting' : 'idle';
  chatActivity.textContent = active ? 'Chat working' : waiting ? 'Waiting for chat' : 'Chat idle';
  chatActivity.title = active ? 'A chat request is waiting for or processing this pane.' : 'No chat request is currently consuming this pane.';
}

/** Show that the pane cannot currently read task activity from the server. */
function markChatActivityUnavailable() {
  if (!chatActivity) return;
  chatActivity.dataset.state = 'unavailable';
  chatActivity.textContent = 'Chat status unavailable';
  chatActivity.title = 'Reconnect the pane to read whether a chat request is active.';
}

let currentScreenId = null;

/** The last server payload rendered for the current screen id. */
let currentScreenData = null;

/** The screen type on show, so a different screen starts at its top. */
let currentType = null;
/**
 * The pane's revision cursor, used only as the `since` of the next long poll. It
 * moves on every change to the shared pane state, including a busy change made by
 * another session's process, which is why it is not what decides a redraw.
 */
let revision = 0;
/** The revision of the screen currently drawn, which is what decides a redraw. */
let screenRevision = -1;
/**
 * Which of the server's revision counters `revision` was last read from. The
 * server swaps counters exactly once per process, when a workspace is created
 * mid session and the pane's state moves from an in-memory store to the
 * workspace's own file store. A `since` compared against the wrong counter can
 * be meaningless, so whenever the id in a response does not match this, the
 * screen it carries is drawn unconditionally rather than trusted to a revision
 * comparison.
 */
let streamId = '';

// --- live refresh: poll a screen's own data while it declares work in flight,
// and patch it in place rather than redrawing, so a live update never resets
// scroll position or steps on a click the person is in the middle of making. ---
/** @type {ReturnType<typeof setTimeout>|null} */
let liveTimer = null;

function stopLive() {
  if (liveTimer !== null) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }
}

/**
 * @param {string} screenId
 * @param {{liveUpdate: (container: HTMLElement, data: any) => boolean, hasPendingWork: (data: any) => boolean}} live
 */
async function liveTick(screenId, live) {
  if (document.hidden || currentScreenId !== screenId) return;
  try {
    const response = await fetch(`/api/live?screenId=${encodeURIComponent(screenId)}`);
    const body = await response.json();
    if (currentScreenId !== screenId || body.screenId !== screenId || !body.data) {
      // A different screen replaced this one, or the server has nothing fresh
      // (no refresher registered, or a screenId a beat behind). Either way the
      // next real screen push, not this poll, is what should move the pane.
      return;
    }
    const container = /** @type {HTMLElement|null} */ (root.firstElementChild);
    if (container) live.liveUpdate(container, body.data);
    if (!live.hasPendingWork(body.data)) return; // nothing left to watch for
  } catch {
    // A transient fetch failure just skips this tick; /api/events already
    // owns telling the person the connection dropped.
  }
  if (currentScreenId === screenId && !document.hidden) {
    liveTimer = setTimeout(() => liveTick(screenId, live), LIVE_POLL_MS);
  }
}

/**
 * @param {string} screenId
 * @param {string} type
 * @param {any} data
 */
function scheduleLive(screenId, type, data) {
  stopLive();
  const live = LIVE_SCREENS[type];
  if (!live || document.hidden || !live.hasPendingWork(data ?? {})) return;
  liveTimer = setTimeout(() => liveTick(screenId, live), LIVE_POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLive();
    return;
  }
  const live = currentType ? LIVE_SCREENS[currentType] : null;
  if (live && currentScreenId && liveTimer === null) void liveTick(currentScreenId, live);
});
// --- end live refresh ---

/**
 * Send a decision back to the server.
 * @param {string} screenId
 * @param {string} action
 * @param {Record<string, unknown>} payload
 * @param {string} [actionId]
 */
async function postAction(screenId, action, payload, actionId = newActionId()) {
  try {
    const response = await fetch('/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screenId, action, actionId, payload: payload ?? {} }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'That action was not accepted.' }));
      resetButtonGroups(root);
      resetTileGroups(root);
      showBanner(body.error ?? 'That action was not accepted.');
      return false;
    }
    return true;
  } catch {
    resetButtonGroups(root);
    resetTileGroups(root);
    showBanner('The pane could not send that action.', () => void postAction(screenId, action, payload, actionId));
    return false;
  }
}

/** @returns {string} */
function newActionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string} text
 * @param {(() => void)|null} [retry]
 */
function showBanner(text, retry = null) {
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.dataset.tone = 'error';
  banner.append(document.createTextNode(text));
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = 'Retry';
    button.addEventListener('click', () => {
      banner.remove();
      retry();
    });
    banner.append(button);
  }
  root.prepend(banner);
  setTimeout(() => banner.remove(), 6000);
}

/**
 * Keep user entered form values while reconnecting redraws the same durable screen.
 * Screen ids are scoped to the review/context, so a different review always gets a
 * fresh id and cannot inherit another review's draft.
 * @returns {Map<string, {value: string, checked?: boolean, selectedIndex?: number}>}
 */
function captureDraft() {
  const draft = new Map();
  for (const control of root.querySelectorAll('input, textarea, select')) {
    const field = /** @type {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} */ (control);
    const key = field.id || field.getAttribute('name');
    if (!key || field instanceof HTMLInputElement && field.type === 'file') continue;
    draft.set(`${field.tagName.toLowerCase()}:${key}`, {
      value: field.value,
      ...(field instanceof HTMLInputElement ? { checked: field.checked } : {}),
      ...(field instanceof HTMLSelectElement ? { selectedIndex: field.selectedIndex } : {}),
    });
  }
  return draft;
}

/** @param {Map<string, {value: string, checked?: boolean, selectedIndex?: number}>|null} draft */
function restoreDraft(draft) {
  if (!draft) return;
  for (const control of root.querySelectorAll('input, textarea, select')) {
    const field = /** @type {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} */ (control);
    const key = field.id || field.getAttribute('name');
    if (!key || field instanceof HTMLInputElement && field.type === 'file') continue;
    const saved = draft.get(`${field.tagName.toLowerCase()}:${key}`);
    if (!saved) continue;
    if (field instanceof HTMLInputElement) {
      field.checked = Boolean(saved.checked);
      if (field.type !== 'checkbox' && field.type !== 'radio') field.value = saved.value;
    } else if (field instanceof HTMLSelectElement) {
      field.selectedIndex = Number.isInteger(saved.selectedIndex) ? saved.selectedIndex : field.selectedIndex;
    } else {
      field.value = saved.value;
    }
  }
}

/**
 * @param {{screenId: string, type: string, data: any}} screen
 */
function draw(screen) {
  const sameRenderedScreen =
    screen.screenId === currentScreenId &&
    screen.type === currentType &&
    JSON.stringify(screen.data ?? {}) === JSON.stringify(currentScreenData ?? {});
  if (sameRenderedScreen) {
    // Reconnects can report a newer pane revision even though the durable review
    // and its payload are unchanged. Keep the existing DOM so option selection,
    // file inputs and event-handler closures survive the redraw trigger.
    scheduleLive(screen.screenId, screen.type, screen.data);
    return;
  }
  if (screen.type === 'connections' && currentType === 'connections' && screen.screenId === currentScreenId &&
      updateConnections(root.firstElementChild, screen.data ?? {})) {
    currentScreenData = screen.data ?? {};
    return;
  }
  const draft = screen.screenId === currentScreenId && screen.type === currentType ? captureDraft() : null;
  stopLive();
  if (busyTrail) {
    busyTrail.stop();
    busyTrail = null;
    busyTrailTarget = null;
  }
  currentScreenId = screen.screenId;
  const renderScreen = SCREENS[screen.type] ?? stub(screen.type);
  /** @type {(action: string, payload?: any) => void} */
  const act = (action, payload) => {
    void postAction(screen.screenId, action, payload ?? {});
  };
  root.replaceChildren(renderScreen(screen.data ?? {}, act));
  restoreDraft(draft);
  currentScreenData = screen.data ?? {};
  // Every gate screen's action buttons get the same click feedback: a pressed state
  // with a spinner, disabling the rest of the group. Connections keeps its DOM
  // through a refresh and resets its buttons when the server clears busy.
  for (const group of root.querySelectorAll('.actions')) armButtonGroup(/** @type {HTMLElement} */ (group));
  // A new kind of screen starts at its top, where its title and summary are. The same
  // screen refreshed in place (progress, a library filling up) keeps its scroll.
  if (screen.type !== currentType) window.scrollTo(0, 0);
  currentType = screen.type;
  const title = screen.data && screen.data.title ? String(screen.data.title) : '';
  document.title = !title || title === 'Social Campaign' ? 'Social Campaign' : `${title} - Social Campaign`;
  scheduleLive(screen.screenId, screen.type, screen.data);
}

async function loadState() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error(`state request failed: ${response.status}`);
  const body = await response.json();
  revision = body.revision ?? body.screen.revision ?? 0;
  screenRevision = body.screen.revision ?? 0;
  streamId = body.stream ?? '';
  draw(body.screen);
  applyBusy(body.busy ?? null);
  applyChatActivity(body.activity ?? null, body.busy ?? null);
}

async function follow() {
  for (;;) {
    try {
      const response = await fetch(`/api/events?since=${revision}&stream=${encodeURIComponent(streamId)}`);
      if (!response.ok) throw new Error(`events request failed: ${response.status}`);
      const body = await response.json();
      connection.dataset.state = 'live';
      connection.textContent = 'Pane live';
      // The server swapped revision counters (a workspace was created mid
      // session) since our last poll: `since` was compared against a counter
      // that no longer means anything, so the screen carried in this response
      // is drawn unconditionally, whatever its own screenId or revision says.
      const streamChanged = Boolean(body.stream) && body.stream !== streamId;
      revision = body.revision;
      streamId = body.stream ?? streamId;
      // Redraw only when the screen itself changed. Busy turning on and off moves
      // the pane's revision without replacing the screen, and redrawing on that
      // would throw away whatever the person was in the middle of typing.
      if (streamChanged || body.screen.screenId !== currentScreenId || body.screen.revision !== screenRevision) {
        screenRevision = body.screen.revision;
        draw(body.screen);
      }
      applyBusy(body.busy ?? null);
      applyChatActivity(body.activity ?? null, body.busy ?? null);
    } catch {
      connection.dataset.state = 'lost';
      connection.textContent = 'Reconnecting';
      markChatActivityUnavailable();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function boot() {
  for (;;) {
    try {
      await loadState();
      connection.dataset.state = 'live';
      connection.textContent = 'Pane live';
      await follow();
      return;
    } catch {
      connection.dataset.state = 'lost';
      connection.textContent = 'Reconnecting';
      markChatActivityUnavailable();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

void boot();
