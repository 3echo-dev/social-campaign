/**
 * Tiny element helpers shared by every screen module.
 *
 * Text always goes in through textContent, never innerHTML, so nothing a tool puts
 * in screen data can inject markup into the pane.
 */

/**
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * A button. `primary` makes it the gold pill for the main action. `badge` adds the
 * small darker pill inside it for a count or a price; the badge is decoration, so a
 * screen reader hears `badgeLabel` instead (for example "16 credits" for "16 cr").
 * `variant: 'add'` is the dashed style for adding something, and `pressed` makes
 * the button a toggle that reports its state.
 * @param {string} label
 * @param {(event: MouseEvent) => void} onClick
 * @param {{primary?: boolean, badge?: string, badgeLabel?: string, variant?: 'add', pressed?: boolean}} [options]
 * @returns {HTMLButtonElement}
 */
export function button(label, onClick, options = {}) {
  const classes = [];
  if (options.primary) classes.push('primary');
  if (options.variant === 'add') classes.push('add');
  if (options.badge) classes.push('has-badge');
  const node = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: classes.join(' ') }, [label]));
  if (options.badge) {
    node.append(el('span', { class: 'btn-badge', 'aria-hidden': 'true' }, [options.badge]));
    if (options.badgeLabel) node.append(el('span', { class: 'sr-only' }, [` (${options.badgeLabel})`]));
  }
  if (options.pressed !== undefined) node.setAttribute('aria-pressed', String(Boolean(options.pressed)));
  node.addEventListener('click', onClick);
  return node;
}

/** Stroke icons on a 24 unit grid, drawn in currentColor. */
const ICON_PATHS = {
  plus: ['M12 5v14', 'M5 12h14'],
  sparkle: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 16v4', 'M16.5 18h4'],
  library: ['M4 4.5h6.5V11H4z', 'M13.5 4.5H20V11h-6.5z', 'M4 13h6.5v6.5H4z', 'M13.5 13H20v6.5h-6.5z'],
  post: ['M4 5h16v14H4z', 'M4 15.5l4.5-4.5 4 4 2.5-2.5 5 5', 'M15.5 9.5h.01'],
  megaphone: ['M4 10v4h3.5L14 18V6l-6.5 4z', 'M17.5 9a4 4 0 0 1 0 6'],
  person: ['M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z', 'M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5'],
  search: ['M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M20 20l-4.4-4.4'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  folder: ['M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z'],
  chevron: ['M9.5 6l6 6-6 6'],
};

/**
 * An inline SVG icon, built node by node so no markup string is ever parsed.
 * @param {keyof typeof ICON_PATHS | string} name
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(ns, 'svg'));
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICON_PATHS[name] ?? ICON_PATHS.chevron) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The product name, which a hero heading shows in gold when its title ends with it. */
const EMPHASIS = 'Social Campaign';

/** State kept outside the DOM so a failed action request can be retried in place. */
const buttonGroupState = new WeakMap();
const tileGroupState = new WeakMap();

/**
 * The centred heading at the top of a hero screen (home, setup, new job, starting
 * point). The emphasis is gold: the product name when the title ends with it, as in
 * "Set up Social Campaign", otherwise the whole title. Pass `plain: true` for a
 * heading that names no product, such as the home screen's "What would you like to
 * do?", which sits under a top bar that already says the product name.
 * @param {string} title
 * @param {string} [lead]
 * @param {{plain?: boolean}} [options]
 * @returns {HTMLElement}
 */
export function hero(title, lead, options = {}) {
  const text = String(title ?? '').trim();
  const heading = el('h2');
  if (options.plain) {
    heading.append(text);
  } else if (text.length > EMPHASIS.length && text.toLowerCase().endsWith(EMPHASIS.toLowerCase())) {
    const prefix = text.slice(0, text.length - EMPHASIS.length);
    heading.append(prefix, el('span', { class: 'hero-emphasis' }, [text.slice(prefix.length)]));
  } else {
    heading.append(el('span', { class: 'hero-emphasis' }, [text]));
  }
  const node = el('header', { class: 'hero' }, [heading]);
  if (lead) node.append(el('p', { class: 'hero-lead' }, [String(lead)]));
  return node;
}

/**
 * One choice on a hero screen, drawn like the 3Echo composer card: a round icon, the
 * title and its line of explanation, and an arrow.
 * @param {{title: string, body?: string, icon?: string, onClick: () => void}} options
 * @returns {HTMLButtonElement}
 */
export function tile(options) {
  const node = /** @type {HTMLButtonElement} */ (
    el('button', { type: 'button', class: 'tile' }, [
      el('span', { class: 'tile-icon' }, [icon(options.icon ?? 'chevron')]),
      el('span', { class: 'tile-text' }, [
        el('h3', {}, [String(options.title ?? '')]),
        el('p', {}, [String(options.body ?? '')]),
        el('p', { class: 'tile-status' }, ['Opening...']),
      ]),
      el('span', { class: 'tile-arrow' }, [icon('chevron'), el('span', { class: 'tile-spinner', 'aria-hidden': 'true' })]),
    ])
  );
  node.addEventListener('click', options.onClick);
  return node;
}

/**
 * A "border trail": a short glowing gold segment that travels once around a
 * positioned element's rounded border to say "the system is working on this
 * one" without a full-card spinner overlay. Pure CSS/JS, no libraries - the
 * design reference is a Framer Motion component, reproduced natively here.
 *
 * Mechanism: an absolutely positioned overlay (`inset: 0`, `border-radius:
 * inherit`) is masked down to just the border ring (two mask layers
 * intersected so only the ring between the padding box and border box
 * survives), and a small gradient square is animated along that ring with
 * `offset-path` / `offset-distance`. `offset-path: rect(...)` tracks a
 * rounded rect directly, which is what lets the trail hug the card's actual
 * corners without hand-rolled keyframe percentages.
 *
 * Honors `prefers-reduced-motion`: the moving square is skipped in favour of
 * a static gold hairline drawn by the same mask.
 *
 * Toggles a `has-trail` class on `element` for as long as the trail runs, so
 * any solid border/tint a caller applies (e.g. a "selected" state) can be
 * styled back down to a plain hairline while the trail is the only gold on
 * the ring, without this helper needing to know about that caller's classes.
 * @param {HTMLElement} element - the card the trail runs around; the caller
 *   is responsible for it being (or becoming) a positioning context, which
 *   this function ensures by setting `position: relative` when the element
 *   is statically positioned.
 * @param {{size?: number, duration?: number}} [options]
 * @returns {{stop: () => void}}
 */
export function borderTrail(element, options = {}) {
  // One trail per element at a time: starting again on an element that is
  // already running a trail must not stack a second overlay on top of it.
  // Hand back a controller for the existing overlay instead of adding a new
  // one - a caller that lost track of its own controller (the busy-driven
  // trail picking up a card an action button already started one on, say)
  // still gets something that stops the visible trail correctly.
  const existingOverlay = /** @type {HTMLElement|null} */ (
    element.querySelector(':scope > .border-trail:not(.border-trail-fade)')
  );
  if (existingOverlay) {
    return {
      stop() {
        element.classList.remove('has-trail');
        existingOverlay.classList.add('border-trail-fade');
        setTimeout(() => existingOverlay.remove(), 320);
      },
    };
  }

  const size = options.size ?? 160;
  const duration = options.duration ?? 4;
  const computed = getComputedStyle(element);
  if (computed.position === 'static') element.style.position = 'relative';
  const radius = computed.borderRadius || 'var(--radius-card)';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const overlay = el('span', { class: 'border-trail', 'aria-hidden': 'true' });
  overlay.style.borderRadius = 'inherit';
  if (reduced) {
    overlay.classList.add('border-trail-static');
  } else {
    const head = el('span', { class: 'border-trail-head' });
    head.style.width = `${size}px`;
    head.style.height = `${size}px`;
    head.style.offsetPath = `rect(0 auto auto 0 round ${radius})`;
    head.style.animationDuration = `${duration}s`;
    overlay.append(head);
  }
  element.classList.add('has-trail');
  element.append(overlay);

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    element.classList.remove('has-trail');
    overlay.classList.add('border-trail-fade');
    setTimeout(() => overlay.remove(), 320);
  }
  return { stop };
}

/**
 * Wires up a group of tiles that represent a single one-shot choice (home, new job,
 * starting point): clicking one marks it selected and busy, dims and disables the
 * rest, and ignores every further click on the group until the pane moves on to the
 * next screen (which happens naturally, since the click tears this screen down).
 * @param {HTMLElement} container - the `.tiles` wrapper holding the tile buttons
 */
export function armTileGroup(container) {
  const tiles = Array.from(container.querySelectorAll('.tile'));
  const state = { chosen: false, tiles, initialDisabled: new Map(), trail: null };
  tileGroupState.set(container, state);
  for (const candidate of tiles) {
    if (!(candidate instanceof HTMLButtonElement)) continue;
    state.initialDisabled.set(candidate, candidate.disabled);
    candidate.addEventListener(
      'click',
      (event) => {
        if (state.chosen) {
          event.stopImmediatePropagation();
          event.preventDefault();
          return;
        }
        state.chosen = true;
        candidate.classList.add('selected');
        candidate.setAttribute('aria-pressed', 'true');
        candidate.setAttribute('aria-busy', 'true');
        state.trail = borderTrail(candidate);
        for (const other of tiles) {
          if (other === candidate) continue;
          other.classList.add('tile-receded');
          other.disabled = true;
        }
      },
      { capture: true },
    );
  }
}

/**
 * The nearest enclosing compact card or panel around an element - found generically
 * rather than per screen, so every screen's action buttons land the border trail on
 * the right container without `armButtonGroup` needing to know that screen's
 * particular markup.
 *
 * A trail only ever runs on a compact card: a `.card` (or `.panel`) that holds no
 * other `.card` inside it. A provider card, a tile and a review card are all
 * compact. The screen root and any container that only exists to hold other cards
 * are not, so a button living directly in a container - "Continue to Social
 * Campaign" at the bottom of the Connectors screen, say - draws no trail at all:
 * the pill spinner and the top busy bar already say the system is working. Returns
 * `null` in that case rather than falling back to something wider.
 * @param {HTMLElement} element
 * @returns {HTMLElement|null}
 */
export function nearestCard(element) {
  const enclosing = /** @type {HTMLElement|null} */ (element.closest('.card, .panel'));
  if (!enclosing) return null;
  if (enclosing.classList.contains('card') && enclosing.querySelector(':scope .card')) return null;
  return enclosing;
}

/**
 * Generalizes the pressed-and-busy behaviour `armTileGroup` gives tiles to the
 * action buttons on any gate screen: clicking one shows a pressed state with a
 * spinner and a short "Working on it" line, disables every other button in the
 * group, and runs the border trail on the nearest enclosing card or panel so the
 * whole panel reads as busy - until the server shows the next screen and the whole
 * container is replaced. Call this once per `.actions` (or other button group)
 * container after a screen renders it.
 * @param {HTMLElement} container
 */
export function armButtonGroup(container) {
  const buttons = Array.from(container.querySelectorAll('button'));
  // Screen patches may keep an existing group. Never stack capture listeners.
  const existing = buttonGroupState.get(container);
  if (existing && existing.buttons.length === buttons.length &&
      existing.buttons.every((candidate, index) => candidate === buttons[index])) return;
  const trailTarget = nearestCard(container);
  const state = { chosen: false, buttons, initialDisabled: new Map(), trail: null };
  buttonGroupState.set(container, state);
  for (const candidate of buttons) {
    if (!(candidate instanceof HTMLButtonElement)) continue;
    state.initialDisabled.set(candidate, candidate.disabled);
    candidate.addEventListener(
      'click',
      () => {
        if (state.chosen) return;
        state.chosen = true;
        candidate.classList.add('pressed');
        candidate.setAttribute('aria-busy', 'true');
        candidate.append(
          el('span', { class: 'btn-spinner', 'aria-hidden': 'true' }),
          el('span', { class: 'btn-status' }, ['Working on it...']),
        );
        for (const other of buttons) {
          other.disabled = true;
        }
        if (trailTarget) state.trail = borderTrail(trailTarget);
      },
      { capture: true },
    );
  }
}

/**
 * Restore one-shot tiles after a failed action request without replacing the screen.
 * The selected tile and its siblings keep their original listeners, so the user can
 * correct a transient connection failure and try the same action again.
 * @param {HTMLElement} rootElement
 */
export function resetTileGroups(rootElement) {
  for (const container of rootElement.querySelectorAll('.tiles')) {
    const state = tileGroupState.get(/** @type {HTMLElement} */ (container));
    if (!state) continue;
    state.chosen = false;
    if (state.trail) state.trail.stop();
    state.trail = null;
    for (const tile of state.tiles) {
      if (!(tile instanceof HTMLButtonElement)) continue;
      tile.classList.remove('selected', 'tile-receded');
      tile.removeAttribute('aria-pressed');
      tile.removeAttribute('aria-busy');
      tile.disabled = state.initialDisabled.get(tile) ?? false;
    }
  }
}

/**
 * Restore action buttons after a failed HTTP request without replacing the screen.
 * This keeps form values and each screen's original click listeners intact.
 * @param {HTMLElement} rootElement
 */
export function resetButtonGroups(rootElement) {
  for (const container of rootElement.querySelectorAll('.actions')) {
    const state = buttonGroupState.get(/** @type {HTMLElement} */ (container));
    if (!state) continue;
    state.chosen = false;
    if (state.trail) state.trail.stop();
    state.trail = null;
    for (const candidate of state.buttons) {
      if (!(candidate instanceof HTMLButtonElement)) continue;
      candidate.classList.remove('pressed');
      candidate.removeAttribute('aria-busy');
      candidate.disabled = state.initialDisabled.get(candidate) ?? false;
      for (const child of candidate.querySelectorAll('.btn-spinner, .btn-status')) child.remove();
    }
  }
}

/** The five phases in order, kept here too so the strip never has to import the
 * server's phase module; the tool that opens the screen sends the same names in
 * `data.phase` and, when it has one, `data.phases`. */
const PHASE_ORDER = ['intake', 'research_strategy', 'approval_cost', 'media_production', 'final_review_publish'];
const PHASE_SHORT_LABEL = {
  intake: 'Intake',
  research_strategy: 'Research',
  approval_cost: 'Approval',
  media_production: 'Production',
  final_review_publish: 'Publish',
};

/**
 * The compact "where am I" strip: five dots, one per phase, the current one filled
 * gold, the ones before it a quiet done tint, the ones after plain. Placed at the
 * top of any screen whose payload carries a `phase` field, so the person always has
 * a sense of how far through the job they are without reading a stage name.
 * @param {string} currentPhase one of the five phase keys.
 * @param {{phases?: Array<{phase: string, name?: string}>}} [options] an optional
 *   `phases[]` (as job_plan_open sends it) to use its names for the dot titles and
 *   to know which phases this job skips.
 * @returns {HTMLElement}
 */
export function phaseStrip(currentPhase, options = {}) {
  const known = Array.isArray(options.phases) ? options.phases : null;
  const order = known && known.length > 0 ? known.map((p) => String(p.phase)) : PHASE_ORDER;
  const currentIndex = order.indexOf(String(currentPhase));
  const nav = el('div', { class: 'phase-strip', role: 'list', 'aria-label': 'Job progress' });
  order.forEach((phase, index) => {
    const entry = known?.find((p) => p.phase === phase);
    const state = index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'upcoming';
    const skipped = entry?.status === 'skipped';
    const dot = el('span', {
      class: 'phase-dot',
      role: 'listitem',
      'data-state': skipped ? 'skipped' : state,
      title: entry?.name ?? PHASE_SHORT_LABEL[phase] ?? phase,
    });
    nav.append(dot);
  });
  return nav;
}

/**
 * A card with a heading and optional lead paragraph.
 * @param {string} title
 * @param {string} [lead]
 * @returns {HTMLElement}
 */
export function card(title, lead) {
  const node = el('section', { class: 'card' }, [el('h2', {}, [title])]);
  if (lead) node.append(el('p', { class: 'muted' }, [lead]));
  return node;
}

/**
 * Turn whatever a tool put in `path` into a url the pane can actually serve.
 *
 * The pane exposes exactly two folders, /generated/ and /thumbs/, and contract
 * objects carry absolute paths on disk, which on Windows look like
 * `C:\...\Workspace\generated\01J.png`. Prefixing that with /generated/ produces a
 * 404 and an empty preview at the media gate, so find the exposed folder inside the
 * path and serve from there instead. Every segment is encoded, because a real file
 * name has spaces in it.
 * @param {string} path
 * @returns {string}
 */
export function previewSrc(path) {
  const clean = String(path ?? '').replace(/\\/g, '/');
  for (const folder of ['generated', 'thumbs']) {
    const marker = `/${folder}/`;
    const at = clean.toLowerCase().lastIndexOf(marker);
    const relative = at >= 0 ? clean.slice(at + marker.length) : null;
    const bare = clean.replace(/^\/+/, '');
    const fromRoot = bare.toLowerCase().startsWith(`${folder}/`) ? bare.slice(folder.length + 1) : null;
    const chosen = relative ?? fromRoot;
    if (chosen !== null) return `/${folder}/${encodePath(chosen)}`;
  }
  return `/generated/${encodePath(clean.replace(/^\/+/, ''))}`;
}

/**
 * @param {string} relative
 * @returns {string}
 */
function encodePath(relative) {
  return relative
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Format a millisecond duration as a short, human string: "2h 14m", "48m",
 * "12s". Never shows a raw millisecond or token count as the headline; the
 * caller only ever sees this rounded, friendly form.
 * @param {number} ms
 * @returns {string}
 */
export function formatDurationShort(ms) {
  return formatDuration(ms);
}

function formatDuration(ms) {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Format a token count as a short secondary line, for example "3.2k tokens".
 * Never the main message on a screen, always a quiet detail underneath.
 * @param {number} tokens
 * @returns {string}
 */
function formatTokens(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${tokens} tokens`;
}

/**
 * The "This job" line for the final review and publish screens: total time
 * and total agent tokens as a small secondary line, with per stage and per
 * agent detail collapsed behind a <details> so it never competes with the
 * screen's main message. Returns null when there is nothing to show yet.
 * @param {{stages?: Array<{stage: string, duration_ms: number|null}>, agents?: Array<{stage: string, agent: string, tokens: number, duration_ms: number}>, totals?: {duration_ms: number, tokens: number}}|null} stats
 * @returns {HTMLElement|null}
 */
export function jobStatsBlock(stats) {
  if (!stats || !stats.totals) return null;
  const { totals } = stats;
  if (!totals.duration_ms && !totals.tokens) return null;
  const summary = el('p', { class: 'job-stats-summary muted' }, [
    `This job: ${formatDuration(totals.duration_ms)} total`,
    el('span', { class: 'job-stats-secondary' }, [` · ${formatTokens(totals.tokens)}`]),
  ]);
  const details = el('details', { class: 'job-stats-details' }, [el('summary', {}, ['Per stage and per agent'])]);
  const stages = Array.isArray(stats.stages) ? stats.stages : [];
  if (stages.length > 0) {
    details.append(
      el(
        'ul',
        { class: 'job-stats-list' },
        stages
          .filter((s) => s.duration_ms !== null && s.duration_ms !== undefined)
          .map((s) => el('li', {}, [`${s.stage}: ${formatDuration(s.duration_ms)}`])),
      ),
    );
  }
  const agents = Array.isArray(stats.agents) ? stats.agents : [];
  if (agents.length > 0) {
    details.append(
      el(
        'ul',
        { class: 'job-stats-list' },
        agents.map((a) =>
          el('li', {}, [`${a.agent} (${a.stage}): ${formatDuration(a.duration_ms)} · ${formatTokens(a.tokens)}`]),
        ),
      ),
    );
  }
  const wrap = el('div', { class: 'job-stats' }, [summary]);
  if (stages.length > 0 || agents.length > 0) wrap.append(details);
  return wrap;
}

/**
 * A labelled multi line text field for review notes.
 * @param {string} id
 * @param {string} labelText
 * @param {{placeholder?: string, rows?: number}} [options]
 * @returns {{wrap: HTMLElement, field: HTMLTextAreaElement}}
 */
export function textarea(id, labelText, options = {}) {
  const field = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      id,
      rows: String(options.rows ?? 3),
      placeholder: options.placeholder ?? '',
    })
  );
  const wrap = el('div', { class: 'field' }, [el('label', { for: id }, [labelText]), field]);
  return { wrap, field };
}

/** Platform names written the way the platforms write them. */
export const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

/**
 * The one deliverable a post card leads with: a single media entry, whichever of
 * `media_path`, a single `media` object or the first item of a `media` array the
 * post carries. `path`/`asset_id` alone (no `kind`) is treated as a video when the
 * file extension says so, otherwise as an image.
 * @param {any} post
 * @returns {any|null}
 */
export function primaryMedia(post) {
  if (post.media_path) return { path: post.media_path, kind: post.media_kind };
  const media = post.media;
  if (Array.isArray(media)) return media.length > 0 ? media[0] : null;
  if (media && typeof media === 'object') return media;
  if (typeof media === 'string') return { path: media };
  return null;
}

/**
 * State a duration in words, for example "25 seconds" or "1 minute 5 seconds".
 * @param {number|null|undefined} seconds
 * @returns {string|null}
 */
export function durationWords(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return null;
  const minutes = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  if (minutes <= 0) return `${rest} second${rest === 1 ? '' : 's'}`;
  const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return rest > 0 ? `${minutePart} ${rest} second${rest === 1 ? '' : 's'}` : minutePart;
}

/**
 * One post card: the finished deliverable up top (playable video with a poster, or
 * the image), then its caption and hashtags beneath. Shared by the final review and
 * publish screens so the person sees the same preview treatment in both places.
 * `extra` is appended after the caption block - final review's schedule line, or
 * publish's outcome row - so each screen keeps its own trailing content.
 * @param {any} post
 * @param {string} brandName
 * @param {Array<Node|string>} [extra]
 * @returns {HTMLElement}
 */
export function postCard(post, brandName, extra = []) {
  const platform = String(post.platform ?? '');
  const media = primaryMedia(post);
  const mediaWrap = el('div', { class: 'post-card-media' }, [media ? '' : 'No media yet']);
  const facts = [];
  if (media && media.path) {
    const isVideo =
      media.kind === 'video' || (!media.kind && /\.(mp4|webm|mov)$/i.test(String(media.path)));
    if (isVideo) {
      const video = /** @type {HTMLVideoElement} */ (
        el('video', { muted: 'true', preload: 'metadata', controls: 'true' })
      );
      video.src = previewSrc(media.path);
      if (media.cover_path) video.setAttribute('poster', previewSrc(media.cover_path));
      mediaWrap.replaceChildren(video);
      const duration = durationWords(media.duration_s);
      if (duration) facts.push(`${duration} long`);
      facts.push(media.subtitles_burned_in ? 'Subtitles burned in' : 'No subtitles burned in');
    } else {
      const img = /** @type {HTMLImageElement} */ (el('img', { alt: 'Post media' }));
      img.src = previewSrc(media.path);
      mediaWrap.replaceChildren(img);
    }
  }

  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];

  return el('div', { class: 'post-card' }, [
    mediaWrap,
    facts.length > 0 ? el('p', { class: 'post-card-media-facts muted' }, [facts.join(' · ')]) : el('span'),
    el('div', { class: 'post-card-head' }, [
      el('span', { class: 'post-card-avatar', 'aria-hidden': 'true' }, [brandName.trim().charAt(0).toUpperCase()]),
      el('span', { class: 'post-card-brand' }, [brandName]),
      el('span', { class: 'post-card-platform' }, [PLATFORM_LABEL[platform] ?? platform]),
    ]),
    el('div', { class: 'post-card-body' }, [
      el('p', { class: 'post-card-caption' }, [String(post.caption ?? '')]),
      hashtags.length > 0 ? el('p', { class: 'post-card-hashtags' }, [hashtags.join(' ')]) : el('span'),
      post.first_comment ? el('p', { class: 'post-card-first-comment' }, [`First comment: ${post.first_comment}`]) : el('span'),
      ...extra,
    ]),
  ]);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function creditsWords(value) {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  return `${amount} ${amount === 1 ? 'credit' : 'credits'}`;
}

/**
 * "What this job cost" card for the final review and publish screens: the total
 * spent as the headline in the accent colour, approved and unused as secondary
 * lines, and the paid item list collapsed behind a details block. When the job had
 * no paid generation, shows only the plain note the server sent instead. Returns
 * null when there is no cost block to show at all (the server swallowed an error
 * building it).
 * @param {{has_spend?: boolean, approved_credits?: number, spent_credits?: number, unused_credits?: number, items?: Array<{label: string, credits: number}>, note?: string}|null} cost
 * @returns {HTMLElement|null}
 */
export function costCard(cost) {
  if (!cost || typeof cost !== 'object') return null;

  if (!cost.has_spend) {
    return el('section', { class: 'cost-card', 'aria-label': 'What this job cost' }, [
      el('h3', {}, ['What this job cost']),
      el('p', { class: 'muted' }, [String(cost.note ?? 'No credits were spent on this job.')]),
    ]);
  }

  const items = Array.isArray(cost.items) ? cost.items : [];
  const details = el('details', { class: 'cost-card-details' }, [
    el('summary', {}, [`Paid items (${items.length})`]),
    el(
      'ul',
      { class: 'cost-card-item-list' },
      items.map((item) => el('li', {}, [`${item.label}: ${creditsWords(item.credits)}`])),
    ),
  ]);

  return el('section', { class: 'cost-card', 'aria-label': 'What this job cost' }, [
    el('h3', {}, ['What this job cost']),
    el('p', { class: 'cost-card-headline' }, [creditsWords(cost.spent_credits)]),
    el('dl', { class: 'cost-card-secondary' }, [
      el('div', {}, [el('dt', {}, ['Approved']), el('dd', {}, [creditsWords(cost.approved_credits)])]),
      el('div', {}, [el('dt', {}, ['Unused']), el('dd', {}, [creditsWords(cost.unused_credits)])]),
    ]),
    items.length > 0 ? details : el('span'),
    el('p', { class: 'hint' }, [String(cost.note ?? 'Nothing further is charged by publishing.')]),
  ]);
}
