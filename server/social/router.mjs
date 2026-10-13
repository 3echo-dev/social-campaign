/**
 * Capability first routing for the social and web research tools.
 *
 * Capability first routing, implemented in Node: every platform and operation has
 * an ordered list of backends, the first healthy
 * one is asked first and the next is the fallback, a backend is only called healthy
 * after it has really been run, and the answer says honestly how much it covers.
 *
 * Two things are added. A backend that fails in a way that will not heal by
 * retrying (a bot check, a login wall, a missing binary) is tripped for that
 * platform and operation for TRIP_MS, so later calls go straight to the fallback instead of
 * paying for the same failure again. And every read goes through the workspace
 * cache in store.mjs, so a repeated call inside the time to live does not ask the
 * platform again.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { InvalidInputError } from '../lib/errors.mjs';
import { log } from '../lib/log.mjs';
import { AdLibraryBackend, EU_LIKE, metaLibraryUrl, tiktokLibraryUrls } from './backends/adlibrary.mjs';
import { BrowserBackend } from './backends/browser.mjs';
import { commentsFromPage, instagramTopic, postFromPage, profileFromPage, readInstagramPage, topicFromPage } from './backends/instagram.mjs';
import { PublicPageBackend } from './backends/public_page.mjs';
import { STEALTH_TIMEOUT_MS } from './backends/stealth.mjs';
import { emptyAccountReason, isEmptyAccount, TikTokPublicBackend } from './backends/tiktok_public.mjs';
import { CRAWL_BUDGET_MS, FETCH_TIMEOUT_MS, Politeness, webCrawl } from './backends/web.mjs';
import { YTDLP_TIMEOUT_MS, YtDlpBackend } from './backends/ytdlp.mjs';
import { breaker as sharedBreaker } from './breaker.mjs';
import { findOutliers, findOutliersWidening, MIN_BASELINE_SAMPLE, WINDOWS } from './outliers.mjs';
import { adsPlan, commentsPlan, postPlan, profilePlan, searchPlan } from './plans.mjs';
import { envelope, envelopeCode, orderComments, pageRecord, parseHandle, parseHttpUrl, parseHumanCount, platformFromUrl, postRecord, profileRecord, tiktokPostId } from './records.mjs';
import { evidenceCountFor, readCache, rememberPlan, savedEvidenceFor, writeCache } from './store.mjs';

/** How long a failed backend is skipped for on one platform. */
export const TRIP_MS = 10 * 60_000;

/** Total time one public router call may take, across every backend it tries. */
export const ROUTER_DEADLINE_MS = 45_000;

/**
 * The same, for a call that may use the stealth reader (TikTok and Instagram profiles, outliers and Instagram posts):
 * a warm TikTok profile read takes 8 to 31 seconds and a cold one up to 77, and an Instagram outliers read opens
 * the profile and then a handful of posts one at a time. Measured live on 2026-10-13.
 */
export const ROUTER_STEALTH_DEADLINE_MS = 90_000;

/** Most Instagram posts an outliers read opens one by one (likes and comments are only on a post's own page). */
export const INSTAGRAM_OUTLIER_READS = 8;

/** An outliers read stops opening posts when less than this is left of its time. */
const INSTAGRAM_READ_MIN_MS = 12_000;

/** Most time the live probes of social_backends_status may take, all together. */
export const STATUS_PROBE_CAP_MS = 30_000;

/** The breaker scope of the ad libraries: Meta's and TikTok's ad pages never share an entry with the platforms' own pages. */
const AD_SCOPE = 'ads';

/** The platform host each route family talks to, for the shared circuit breaker. */
const PLATFORM_HOST = { tiktok: 'tiktok.com', instagram: 'instagram.com', facebook: 'facebook.com', meta: 'facebook.com', youtube: 'youtube.com' };

/**
 * The breaker scope of one backend attempt: the backend and the kind of read (`stealth:search`, `tiktok_embed:profile`).
 * Two routes to one host never share a breaker entry, so the public embed answering 503 cannot silence the stealth
 * reader that exists to cover for it, and a login wall on an Instagram topic page cannot silence its profile reads.
 * The unscoped host entry belongs to the downloads, the single URL verify and the video watcher.
 * @param {string} backend
 * @param {string} platform the platform and operation, for example instagram:search.
 * @returns {string}
 */
export function breakerScope(backend, platform) {
  return `${backend}:${String(platform).split(':')[1] ?? 'read'}`;
}

/**
 * The per call budget and the breaker state the call started with. It rides along
 * the async call chain, so backends never have to be handed it by hand.
 * @type {AsyncLocalStorage<{deadline: number, hosts: Map<string, {open: boolean, code?: string, reason?: string}>}>}
 */
const callBudget = new AsyncLocalStorage();

/**
 * A copy of a backend whose requests are capped at `ms`, leaving the shared one untouched.
 * @template T
 * @param {T} backend
 * @param {number} ms
 * @param {number} [defaultMs] the backend's own limit when it sets none.
 * @returns {T}
 */
function limited(backend, ms, defaultMs = FETCH_TIMEOUT_MS) {
  if (!Number.isFinite(ms)) return backend;
  const copy = /** @type {any} */ (Object.create(/** @type {any} */ (backend)));
  const b = /** @type {any} */ (backend);
  if (b.options && typeof b.options === 'object') copy.options = { ...b.options, timeoutMs: Math.max(1000, Math.min(b.options.timeoutMs ?? defaultMs, ms)) };
  if (typeof b.timeoutMs === 'number') copy.timeoutMs = Math.max(2000, Math.min(b.timeoutMs, ms - (b.killGraceMs ?? 0)));
  return copy;
}

/** How long a social_backends_status answer is reused. */
export const STATUS_TTL_MS = 15 * 60_000;

/** The backends social_backends_status reports on, after yt-dlp and the built in page reader, in order. */
const STATUS_BACKEND_IDS = ['tiktok_embed', 'tiktok_comments', 'yt-dlp:tiktok', 'stealth', 'instagram_page', 'instagram_post', 'facebook_page', 'youtube_channel', 'youtube_post', 'meta_ad_library', 'tiktok_creative_center'];

/**
 * The real public handles the live probes read: each platform's own account, which exists for as long as the
 * platform does. A probe reads one of these exactly the way a research call reads a brand, so the matrix reports
 * what a real read gets and not what a toy request gets.
 */
export const PROBE_HANDLES = { tiktok: 'tiktok', instagram: 'instagram', youtube: 'YouTube' };

/**
 * Ordered backends per platform and operation. The first is preferred.
 * Internal ids; the envelope reports each as yt-dlp, public_page or ad_library_page.
 */
export const ROUTES = {
  tiktok: {
    // Primary plus one fallback: the stealth reader when it is installed, else yt-dlp.
    profile: ['tiktok_embed', 'stealth|yt-dlp'],
    post: ['tiktok_embed', 'yt-dlp'],
    comments: ['tiktok_comments'],
    // Only the hashtag totals: the tag page itself answers a bot check every time (live 2026-10-13 and 2026-10-14).
    search: ['tiktok_embed'],
    // The browser backend is never used for TikTok: the embed and yt-dlp already work.
    ads: ['tiktok_creative_center', 'browser'],
  },
  // The browser backend runs last, and only for the operations the other backends
  // leave at `none` or `partial`: it is skipped automatically once the earlier
  // backends already answered in full.
  // One primary and ONE fallback per operation: the most proven fallback is kept, longer chains are trimmed.
  // Instagram (live 2026-10-13, logged out): the Scrapling page op (`stealth`) reads profiles, posts and /popular/
  // topic pages; yt-dlp's user extractor is broken, so it is not a profile route, only a post fallback.
  instagram: { profile: ['stealth', 'instagram_page'], post: ['stealth', 'yt-dlp'], comments: ['stealth', 'yt-dlp'], search: ['stealth'] },
  // YouTube: yt-dlp lists a channel's Shorts tab in about 1.5 seconds, and reads one video and its comments.
  youtube: { profile: ['yt-dlp'], post: ['yt-dlp'], comments: ['yt-dlp'], search: ['yt-dlp'] },
  facebook: { profile: ['facebook_page', 'browser'], post: ['facebook_page', 'browser'], comments: [], search: [] },
  meta: { ads: ['meta_ad_library', 'browser'] },
  web: { crawl: ['web_reader', 'browser'] },
};

/** How the envelope names each internal backend. */
const REPORTED = {
  'yt-dlp': 'yt-dlp',
  tiktok_embed: 'public_page',
  tiktok_comments: 'public_page',
  instagram_page: 'public_page',
  facebook_page: 'public_page',
  web_reader: 'public_page',
  meta_ad_library: 'ad_library_page',
  tiktok_creative_center: 'ad_library_page',
  browser: 'browser',
  stealth: 'browser',
};

/**
 * Coverage measured live (TikTok, Facebook, the ad libraries and the web on 2026-09-12; YouTube on 2026-10-13), used
 * until social_backends_status has run in this session. docs/CONTRACTS.md section 1a has the evidence behind each
 * cell. These cells are what a computer WITHOUT the optional research helper gets: Instagram needs the stealth
 * reader (Scrapling), so it is `none` here and the live status raises it to `partial` once its probes pass (it is
 * never better than partial: a signed out reader gets no view count).
 */
export const VERIFIED_MATRIX = {
  tiktok: { profile: 'partial', post: 'full', comments: 'full', search: 'partial', outliers: 'partial', ads: 'none' },
  instagram: { profile: 'none', post: 'none', comments: 'none', search: 'none', outliers: 'none' },
  facebook: { profile: 'none', post: 'none', comments: 'none', search: 'none', outliers: 'none' },
  youtube: { profile: 'partial', post: 'full', comments: 'none', search: 'partial', outliers: 'partial' },
  meta: { ads: 'none' },
  web: { crawl: 'full' },
};

/** Which failure explains a miss best, most telling first. */
const CODE_PRIORITY = ['not_found', 'login_required', 'region_restricted', 'rate_limited', 'blocked', 'empty_page', 'timed_out', 'unsupported', 'backend_missing'];

/** Codes after which the web cannot plausibly fill the gap. */
const NO_PLAN_CODES = new Set(['not_found']);

/**
 * @typedef {object} Attempt
 * @property {string} backend
 * @property {'ok'|'failed'|'skipped'} outcome
 * @property {string|null} code
 * @property {string|null} reason
 */

/**
 * @param {Attempt[]} attempts
 * @returns {Attempt|null}
 */
function mostTelling(attempts) {
  const failures = attempts.filter((attempt) => attempt.outcome !== 'ok' && attempt.code);
  failures.sort((a, b) => CODE_PRIORITY.indexOf(a.code ?? '') - CODE_PRIORITY.indexOf(b.code ?? ''));
  return failures[0] ?? null;
}

/**
 * Whether a post carries every count its platform shows. YouTube has no share count to show.
 * @param {Record<string, any>} post
 * @returns {boolean}
 */
function hasFullMetrics(post) {
  const m = post.metrics ?? {};
  const counts = post.platform === 'youtube' ? [m.views, m.likes, m.comments] : [m.views, m.likes, m.comments, m.shares];
  return counts.every((value) => typeof value === 'number');
}

/**
 * Whether a post read has everything a signed out reader can get, so a further backend would add nothing.
 * Instagram never shows a view count (or a share count) to a signed out reader; its post page does show the
 * caption, date, likes and comments.
 * @param {string} platform
 * @param {Record<string, any>} record
 * @returns {boolean}
 */
function postComplete(platform, record) {
  if (platform === 'instagram') {
    return record.caption !== null && record.posted_at !== null && typeof record.metrics?.likes === 'number' && typeof record.metrics?.comments === 'number';
  }
  return hasFullMetrics(record) && record.caption !== null;
}

/**
 * Whether an answer found nothing only because no backend was really asked: every attempt was skipped.
 * Such an answer is never cached.
 * @param {Record<string, any>} answer
 * @returns {boolean}
 */
export function skippedOnly(answer) {
  const attempts = Array.isArray(answer?.attempts) ? answer.attempts : [];
  return answer?.coverage === 'none' && attempts.length > 0 && attempts.every((attempt) => attempt.outcome === 'skipped');
}

/**
 * Merge two post lists by post id, keeping every field either side read.
 * @param {Array<Record<string, any>>} primary
 * @param {Array<Record<string, any>>} secondary
 * @returns {Array<Record<string, any>>}
 */
function mergePosts(primary, secondary) {
  const byId = new Map();
  const order = [];
  for (const post of [...primary, ...secondary]) {
    const key = post.post_id ?? post.url;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, post);
      order.push(key);
      continue;
    }
    const metrics = { ...existing.metrics };
    for (const [name, value] of Object.entries(post.metrics ?? {})) if (metrics[name] === null || metrics[name] === undefined) metrics[name] = value;
    const merged = { ...existing, metrics };
    for (const field of ['caption', 'posted_at', 'duration_s', 'sound', 'thumbnail_url', 'author_handle']) {
      if (merged[field] === null || merged[field] === undefined) merged[field] = post[field];
    }
    if ((!merged.hashtags || merged.hashtags.length === 0) && post.hashtags?.length) merged.hashtags = post.hashtags;
    byId.set(key, merged);
  }
  return order.map((key) => byId.get(key)).sort((a, b) => Date.parse(b.posted_at ?? 0) - Date.parse(a.posted_at ?? 0));
}

/**
 * The router. One per process; it holds the trip table and the status cache.
 */
export class SocialRouter {
  /**
   * @param {object} [options]
   * @param {() => (import('node:sqlite').DatabaseSync|null)} [options.db] the workspace database, when there is one.
   * @param {() => number} [options.now]
   * @param {number} [options.politenessMs] gap between requests to one host.
   * @param {boolean} [options.allowPrivate]
   * @param {boolean} [options.offline] skip live probes in social_backends_status.
   * @param {YtDlpBackend} [options.ytdlp]
   * @param {TikTokPublicBackend} [options.tiktok]
   * @param {PublicPageBackend} [options.pages]
   * @param {AdLibraryBackend} [options.ads]
   * @param {() => string|null} [options.brandCountry]
   * @param {any} [options.stealth] a StealthBackend (or a fake); loaded from backends/stealth.mjs when omitted.
   * @param {import('./breaker.mjs').Breaker} [options.breaker]
   * @param {number} [options.deadlineMs] total time per public call, default ROUTER_DEADLINE_MS.
   */
  constructor(options = {}) {
    this.db = options.db ?? (() => null);
    this.now = options.now ?? (() => Date.now());
    this.politeness = new Politeness(options.politenessMs ?? 1000);
    const shared = { politeness: this.politeness, allowPrivate: options.allowPrivate };
    // Development and offline tests only: one local address that stands in for
    // TikTok's public endpoints and both ad library pages, so the spawned server can
    // be walked end to end against recorded pages. Unset in every real session.
    const standIn = process.env.SOCIAL_CAMPAIGN_SOCIAL_BASE_URL?.trim().replace(/\/$/, '') || null;
    this.ytdlp = options.ytdlp ?? new YtDlpBackend();
    this.tiktok = options.tiktok ?? new TikTokPublicBackend(standIn ? { ...shared, baseUrl: standIn } : shared);
    this.pages = options.pages ?? new PublicPageBackend(shared);
    /** True when the ad reader was built here, so it can be handed the stealth reader on first use. */
    this.ownsAds = !options.ads;
    this.ads =
      options.ads ??
      new AdLibraryBackend(standIn ? { ...shared, bases: { meta: standIn, tiktokCreativeCenter: standIn, tiktokLibrary: standIn } } : shared);
    this.browser = options.browser ?? new BrowserBackend({ politeness: this.politeness });
    /** @type {{value: any}} the stealth reader, found on first use unless one is passed in. */
    this.stealthHolder = { value: options.stealth !== undefined ? options.stealth : undefined };
    this.breaker = options.breaker ?? sharedBreaker;
    this.deadlineMs = options.deadlineMs ?? ROUTER_DEADLINE_MS;
    this.crawlOptions = { ...shared, robotsCache: new Map() };
    this.offline = options.offline ?? process.env.SOCIAL_CAMPAIGN_SOCIAL_OFFLINE === '1';
    this.brandCountry = options.brandCountry ?? (() => null);
    /** @type {Map<string, {until: number, code: string, reason: string}>} */
    this.trips = new Map();
    /** @type {{at: number, value: Record<string, any>}|null} */
    this.statusCache = null;
    /**
     * The coverage really measured on the most recent live read of one platform and
     * operation, in this process. Crawler review 2026-09-15, finding 1: a backend
     * probe in `status()` only shows whether a backend answers at all, not what a
     * real request actually returned, so `matrixFromHealth`'s inferred ceiling is
     * overridden here by what was truly observed whenever that exists.
     * @type {Map<string, {coverage: 'full'|'partial'|'none', at: number}>}
     */
    this.observedCoverage = new Map();
  }

  /**
   * Return an operation scoped view of this router.
   *
   * Backends and trip bookkeeping remain shared, but workspace dependent values
   * are captured once. This lets two MCP processes, or two concurrent calls in one
   * process, use the same router without changing each other's database, market or
   * browser helper record while a read is in flight.
   * @param {{workspaceRoot?: string|null, root?: string|null, db?: import('node:sqlite').DatabaseSync|null, brandCountry?: string|null}} [context]
   * @returns {SocialRouter}
   */
  withContext(context = {}) {
    const root = typeof context.workspaceRoot === 'string' && context.workspaceRoot.trim()
      ? context.workspaceRoot.trim()
      : typeof context.root === 'string' && context.root.trim()
        ? context.root.trim()
        : null;
    const db = Object.prototype.hasOwnProperty.call(context, 'db') ? context.db ?? null : null;
    const country = typeof context.brandCountry === 'string' && context.brandCountry.trim() ? context.brandCountry.trim() : null;
    const scoped = /** @type {SocialRouter} */ (Object.create(this));
    scoped.db = () => db;
    scoped.brandCountry = () => country;
    scoped.browser = typeof this.browser.withContext === 'function' ? this.browser.withContext({ workspaceRoot: root }) : this.browser;
    scoped.workspaceRoot = root;
    return scoped;
  }

  /**
   * @param {string} backend
   * @param {string} platform the platform and operation, for example tiktok:post.
   * @returns {{until: number, code: string, reason: string}|null}
   */
  tripped(backend, platform) {
    const trip = this.trips.get(`${backend}:${platform}`);
    if (!trip) return null;
    if (trip.until <= this.now()) {
      this.trips.delete(`${backend}:${platform}`);
      return null;
    }
    return trip;
  }

  /**
   * @param {string} backend
   * @param {string} platform
   * @param {{code: string, reason: string, trip?: boolean}} failure
   */
  noteFailure(backend, platform, failure) {
    if (!failure.trip) return;
    this.trips.set(`${backend}:${platform}`, { until: this.now() + TRIP_MS, code: failure.code, reason: failure.reason });
    log.info('social backend tripped', { backend, platform, code: failure.code });
  }

  /**
   * Run one backend attempt with trip bookkeeping.
   * @template T
   * @param {Attempt[]} attempts
   * @param {string} backend
   * @param {string} platform
   * @param {() => Promise<T & {ok: boolean}>} call
   * @returns {Promise<(T & {ok: true})|null>}
   */
  async attempt(attempts, backend, platform, call) {
    const left = this.remainingMs();
    if (left <= 0) {
      attempts.push({ backend, outcome: 'skipped', code: 'timed_out', reason: 'skipped: budget (this call used its 45 seconds)' });
      return null;
    }
    const trip = this.tripped(backend, platform);
    if (trip) {
      attempts.push({ backend, outcome: 'skipped', code: trip.code, reason: `skipped: ${trip.reason}` });
      return null;
    }
    const host = PLATFORM_HOST[platform.split(':')[0]] ?? null;
    const scope = breakerScope(backend, platform);
    if (host) {
      const open = this.breakerState(host, scope);
      if (open.open) {
        attempts.push({ backend, outcome: 'skipped', code: open.code ?? 'blocked', reason: `skipped: ${open.reason ?? `${host} refused earlier reads`}` });
        return null;
      }
    }
    let result;
    try {
      result = await call(left);
    } catch (error) {
      log.warn('social backend threw', { backend, platform, message: error instanceof Error ? error.message : String(error) });
      result = { ok: false, code: 'blocked', reason: 'The reader stopped unexpectedly.', trip: true };
    }
    if (result.ok) {
      attempts.push({ backend, outcome: 'ok', code: null, reason: null });
      if (host) this.breaker.recordSuccess(host, scope);
      return /** @type {any} */ (result);
    }
    const failure = /** @type {any} */ (result).failure ?? result;
    // Whatever code a backend invents, the envelope only knows its own list.
    failure.code = envelopeCode(failure.code);
    attempts.push({ backend, outcome: 'failed', code: failure.code, reason: failure.reason });
    this.noteFailure(backend, platform, failure);
    // Only a refusal that will not heal by retrying counts toward the breaker, and only for this route: a login wall on
    // one page, a private account or a missing channel tab is that read's answer, not the host turning us away.
    if (host && failure.trip !== false) this.breaker.recordFailure(host, failure.code, failure.reason, scope);
    return null;
  }

  /**
   * Map a stealth reader answer onto the router's record shapes and failure codes. The worker's videos are `items`
   * (older callers and fakes may still send `posts`); a profile read whose video list came back empty is a profile
   * with `listEmpty` set, so the caller can say so instead of reporting an ok with nothing in it.
   * @param {Record<string, any>} out
   * @param {{handle: string, url: string}} target
   * @returns {{ok: true, profile: Record<string, any>|null, posts: Array<Record<string, any>>, listEmpty: boolean, listNote: string|null}|{ok: false, code: string, reason: string, trip: boolean}}
   */
  fromStealthProfile(out, target) {
    if (!out || out.ok !== true) {
      return { ok: false, code: envelopeCode(out?.code ?? 'unsupported'), reason: out?.reason ?? 'The stealth reader failed.', trip: Boolean(out?.trip) };
    }
    const observedAt = new Date(this.now()).toISOString();
    const p = out.profile && typeof out.profile === 'object' ? out.profile : null;
    const profile = p
      ? profileRecord({
          platform: 'tiktok',
          url: target.url,
          handle: p.handle ?? p.uniqueId ?? target.handle,
          display_name: p.display_name ?? p.displayName ?? p.nickname ?? null,
          bio: p.bio ?? p.signature ?? null,
          followers: p.followers ?? p.followerCount,
          following: p.following ?? p.followingCount,
          post_count: p.post_count ?? p.posts ?? p.videoCount ?? p.videos,
          likes_total: p.likes_total ?? p.likes ?? p.heartCount,
          verified: p.verified,
          source_ref: `stealth:${target.url}`,
          observed_at: observedAt,
          confidence: 0.85,
        })
      : null;
    const items = Array.isArray(out.items) ? out.items : Array.isArray(out.posts) ? out.posts : [];
    const posts = items
      .filter((post) => post && typeof post === 'object' && (post.url || post.id))
      .map((post) =>
        postRecord({
          platform: 'tiktok',
          url: post.url ?? `https://www.tiktok.com/@${target.handle}/video/${post.id}`,
          post_id: post.id != null ? String(post.id) : tiktokPostId(String(post.url ?? '')),
          author_handle: target.handle,
          posted_at: post.createdAt,
          media_kind: 'video',
          caption: post.caption ?? null,
          duration_s: typeof post.durationS === 'number' ? post.durationS : null,
          metrics: { views: post.views, likes: post.likes, comments: post.comments, shares: post.shares },
          source_ref: `stealth:${target.url}`,
          observed_at: observedAt,
          confidence: 0.85,
        }),
      );
    if (!profile && posts.length === 0) return { ok: false, code: 'empty_page', reason: 'The stealth reader found no profile or videos.', trip: false };
    // TikTok answers a handle nobody owns with a stub: a name, no bio, 0 followers and 0 videos. That is no account.
    if (profile && isEmptyAccount({ followers: profile.followers, videos: profile.post_count, posts: posts.length })) {
      return { ok: false, code: 'not_found', reason: emptyAccountReason(profile.handle ?? target.handle), trip: false };
    }
    const listEmpty = posts.length === 0;
    return { ok: true, profile, posts, listEmpty, listNote: listEmpty ? (typeof out.itemsNote === 'string' && out.itemsNote ? out.itemsNote : 'TikTok answered the profile page but its video list came back empty.') : null };
  }

  /**
   * Run `work` inside a call budget: the one already running when this is called from inside another call, else a new
   * one of `deadlineMs`.
   * @template T
   * @param {number} deadlineMs
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  budgeted(deadlineMs, work) {
    return callBudget.getStore() ? work() : callBudget.run({ deadline: this.now() + deadlineMs, hosts: new Map() }, work);
  }

  /**
   * The time budget of a read that may use the stealth reader: 90 seconds when it is installed, else the normal 45.
   * @returns {Promise<number>}
   */
  async stealthDeadlineMs() {
    return (await this.stealthReady()) ? Math.max(this.deadlineMs, ROUTER_STEALTH_DEADLINE_MS) : this.deadlineMs;
  }

  /**
   * Time left in this call's budget; unlimited outside a call.
   * @returns {number}
   */
  remainingMs() {
    const store = callBudget.getStore();
    return store ? store.deadline - this.now() : Infinity;
  }

  /**
   * Whether the shared breaker was open for a route of a host when this call first asked.
   * A failure earlier in the same call never blocks that call's own fallback.
   * @param {string} host
   * @param {string} [scope] the backend and kind of read (see breakerScope); none means the host as a whole.
   * @returns {{open: boolean, code?: string, reason?: string}}
   */
  breakerState(host, scope) {
    const store = callBudget.getStore();
    if (!store) return this.breaker.isOpen(host, scope);
    const key = scope ? `${host}#${scope}` : host;
    let state = store.hosts.get(key);
    if (!state) {
      state = this.breaker.isOpen(host, scope);
      store.hosts.set(key, state);
    }
    return state;
  }

  /**
   * The stealth reader when one is installed and ready, else null.
   * @returns {Promise<any|null>}
   */
  async stealthReady() {
    const holder = this.stealthHolder;
    if (holder.value === undefined) {
      try {
        const mod = await import('./backends/stealth.mjs');
        holder.value = new mod.StealthBackend();
      } catch {
        holder.value = null;
      }
    }
    try {
      return holder.value && holder.value.isReady() ? holder.value : null;
    } catch {
      return null;
    }
  }

  /**
   * Remember the coverage a real read just measured, so `status()` never has to
   * guess an operation's coverage purely from whether its backends answer at all.
   * @param {string} platform
   * @param {string} operation kind as passed to `cached()`, for example `profile` or `crawl`.
   * @param {'full'|'partial'|'none'} coverage
   */
  recordObserved(platform, operation, coverage) {
    this.observedCoverage.set(`${platform}:${operation}`, { coverage, at: this.now() });
  }

  /**
   * Run one browser backend attempt, skipping it outright (never counted as a real
   * failure, never tripped) when the `research.browser` capability is not ready.
   * @template T
   * @param {Attempt[]} attempts
   * @param {string} platform
   * @param {() => Promise<T & {ok: boolean}>} call
   * @returns {Promise<(T & {ok: true})|null>}
   */
  async browserAttempt(attempts, platform, call) {
    if (!this.browser.ready()) {
      attempts.push({ backend: 'browser', outcome: 'skipped', code: 'backend_missing', reason: 'skipped: the browser research helper is not connected.' });
      return null;
    }
    return this.attempt(attempts, 'browser', platform, call);
  }

  /**
   * Cache, plan bookkeeping and the finishing touches every read shares.
   * @param {{platform: string, kind: string, target: string}} key
   * @param {() => Promise<Record<string, any>>} read
   * @param {(cached: Record<string, any>) => Record<string, any>|null} [reuse] adapts a cached envelope, or null to refetch.
   * @param {{deadlineMs?: number}} [options] deadlineMs replaces the default time budget of a fresh read.
   * @returns {Promise<Record<string, any>>}
   */
  async cached(key, read, reuse = (value) => value, options = {}) {
    const db = this.db();
    if (db) {
      const hit = readCache(db, { platform: key.platform, kind: key.kind, source_ref: key.target, now: this.now() });
      const adapted = hit ? reuse(hit) : null;
      if (adapted) return this.withSavedEvidence(db, key, adapted);
    }
    // One 45 second budget per public call (90 when the stealth reader may be used); a call made from inside another
    // shares its parent's.
    const fresh = await this.budgeted(options.deadlineMs ?? this.deadlineMs, read);
    if (typeof fresh.coverage === 'string') this.recordObserved(key.platform, key.kind, fresh.coverage);
    if (db) {
      try {
        // A read that never asked the platform (skipped by a breaker, a trip, the budget, a missing helper or a query it
        // refused) says nothing about the platform: it is not kept, so the next call asks for real.
        if (!skippedOnly(fresh)) writeCache(db, { platform: key.platform, kind: key.kind, source_ref: key.target, envelope: fresh, now: this.now() });
        if (fresh.web_evidence_plan) {
          rememberPlan(db, { plan: fresh.web_evidence_plan, platform: fresh.web_evidence_plan.platform ?? key.platform, operation: key.kind, target: key.target });
          const earlier = evidenceCountFor(db, fresh.web_evidence_plan.platform ?? key.platform, key.kind, key.target);
          if (earlier > 0) fresh.earlier_web_evidence = earlier;
        }
      } catch (error) {
        log.warn('social cache write failed', { message: error instanceof Error ? error.message : String(error) });
      }
      return this.withSavedEvidence(db, key, fresh);
    }
    return fresh;
  }

  /**
   * When a read (fresh or cached) came back with nothing direct, attach any web
   * evidence already saved for this exact platform and target, within its normal
   * freshness window, and raise coverage to partial so the caller does not read a
   * bare `none` when there is in fact something on file. Evidence saved this way
   * never upgrades a read past partial: it stands in for a direct read, not equal to one.
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {{platform: string, kind: string, target: string}} key
   * @param {Record<string, any>} envelope
   * @returns {Record<string, any>}
   */
  withSavedEvidence(db, key, envelope) {
    if (envelope.coverage !== 'none') return envelope;
    let saved;
    try {
      saved = savedEvidenceFor(db, key.platform, key.kind, key.target, this.now());
    } catch (error) {
      log.warn('saved evidence lookup failed', { message: error instanceof Error ? error.message : String(error) });
      return envelope;
    }
    if (!saved || saved.length === 0) return envelope;
    return { ...envelope, coverage: 'partial', saved_evidence: saved };
  }

  /**
   * @param {object} input
   * @param {string} input.platform
   * @param {string} [input.backend]
   * @param {Array<Record<string, any>>} input.records
   * @param {'full'|'partial'|'none'} input.coverage
   * @param {Attempt[]} input.attempts
   * @param {string|null} [input.reason] overrides the failure sentence.
   * @param {string|null} [input.code]
   * @param {() => Record<string, any>} input.plan
   * @param {Record<string, any>} [input.extra]
   * @returns {Record<string, any>}
   */
  finish(input) {
    const telling = mostTelling(input.attempts);
    const code = input.coverage === 'full' ? null : input.code ?? telling?.code ?? 'unsupported';
    const reason = input.coverage === 'full' ? null : input.reason ?? telling?.reason ?? 'This could not be read directly.';
    const used = input.attempts.filter((attempt) => attempt.outcome === 'ok').map((attempt) => attempt.backend);
    const backend = input.backend ?? (used.length > 0 ? REPORTED[used[0]] ?? 'public_page' : 'none');
    return envelope({
      platform: input.platform,
      backend: /** @type {any} */ (backend),
      coverage: input.coverage,
      degraded_code: code,
      degraded_reason: reason,
      records: input.records,
      web_evidence_plan: input.coverage !== 'full' && !NO_PLAN_CODES.has(code ?? '') ? input.plan() : null,
      extra: { ...(input.extra ?? {}), attempts: input.attempts },
    });
  }

  /**
   * @param {{platform: string, handle_or_url: string, limit?: number}} input
   * @returns {Promise<Record<string, any>>}
   */
  async profile(input) {
    const platform = /** @type {'tiktok'|'instagram'|'facebook'|'youtube'} */ (input.platform);
    const limit = input.limit ?? 12;
    const target = parseHandle(platform, input.handle_or_url);
    if (!target) {
      throw new InvalidInputError(`"${input.handle_or_url}" is not a ${platform} handle or profile address.`, {
        fix: platform === 'tiktok' ? 'Use a handle like @brand or https://www.tiktok.com/@brand.' : `Use a handle like @brand or the ${platform} profile address.`,
      });
    }
    const key = { platform, kind: 'profile', target: `${platform}:${target.handle.toLowerCase()}` };
    return this.cached(
      key,
      async () => ({ ...(await this.readProfile(platform, target, limit)), requested_limit: limit }),
      (hit) => (hit.requested_limit >= limit ? { ...hit, records: [hit.records.find((r) => r.kind === 'profile'), ...hit.records.filter((r) => r.kind === 'post').slice(0, limit)].filter(Boolean) } : null),
      { deadlineMs: platform === 'tiktok' || platform === 'instagram' ? await this.stealthDeadlineMs() : this.deadlineMs },
    );
  }

  /**
   * @param {'tiktok'|'instagram'|'facebook'|'youtube'} platform
   * @param {{handle: string, url: string}} target
   * @param {number} limit
   * @returns {Promise<Record<string, any>>}
   */
  async readProfile(platform, target, limit) {
    /** @type {Attempt[]} */
    const attempts = [];
    let profile = null;
    /** @type {Array<Record<string, any>>} */
    let posts = [];
    /** Set when the stealth reader read the profile but TikTok's video list came back empty (after its one retry). */
    let emptyListNote = null;
    /** Which YouTube tab the posts came from, when it was not the Shorts tab. */
    let listingTab = null;
    const plan = () => profilePlan({ platform, handle: target.handle, url: target.url, limit });

    if (platform === 'tiktok') {
      const embed = await this.attempt(attempts, 'tiktok_embed', `${platform}:profile`, (ms) => limited(this.tiktok, ms).profile(target.handle));
      if (embed) {
        profile = embed.profile;
        posts = embed.posts;
      } else if (attempts.at(-1)?.code === 'not_found' || attempts.at(-1)?.code === 'login_required') {
        return this.finish({ platform, records: [], coverage: 'none', attempts, plan });
      }
      const wantMore = posts.length < limit || posts.some((post) => !hasFullMetrics(post));
      if (wantMore) {
        // The ONE fallback: the stealth reader when it is installed, else a single yt-dlp run.
        const stealth = await this.stealthReady();
        if (stealth) {
          const read = await this.attempt(attempts, 'stealth', `${platform}:profile`, async (ms) =>
            this.fromStealthProfile(await stealth.tiktokProfile(target.handle, { limit, timeoutMs: Math.min(ms, STEALTH_TIMEOUT_MS) }), target),
          );
          if (read) {
            if (!profile) profile = read.profile;
            posts = mergePosts(read.posts, posts);
            if (read.listEmpty && posts.length === 0) emptyListNote = read.listNote;
          }
        } else {
          const listing = await this.attempt(attempts, 'yt-dlp', `${platform}:profile`, (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).listing(target.url, platform, limit));
          if (listing) posts = mergePosts(listing.posts, posts);
        }
      }
    } else {
      for (const backend of ROUTES[platform].profile) {
        if (backend === 'stealth') {
          // Instagram: the Scrapling page op (profile facts and the first posts). Not installed: say so and go on.
          const stealth = await this.stealthReady();
          if (!stealth) {
            attempts.push({ backend, outcome: 'skipped', code: 'backend_missing', reason: 'skipped: the stealth reader (Scrapling) is not installed, and Instagram refuses every other signed out reader.' });
          } else {
            const read = await this.attempt(attempts, backend, `${platform}:profile`, (ms) => this.instagramProfileRead(stealth, target, ms));
            if (read) {
              profile = read.profile;
              posts = read.posts;
            }
          }
        } else if (backend === 'yt-dlp') {
          let listing = await this.attempt(attempts, backend, `${platform}:profile`, (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).listing(target.url, platform, limit));
          if (!listing && platform === 'youtube' && attempts.at(-1)?.code === 'empty_page') {
            // No Shorts tab: the channel's videos tab is the next best list of what it posts (long videos included).
            const videosUrl = target.url.replace(/\/shorts\/?$/, '/videos');
            listing = await this.attempt(attempts, backend, `${platform}:profile`, (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).listing(videosUrl, platform, limit));
            if (listing) listingTab = 'videos';
          }
          if (listing) {
            posts = listing.posts;
            profile = profile ?? listing.profile;
          }
        } else if (backend === 'browser') {
          // Only worth spawning once the cheaper backends have already been tried and
          // still left the profile facts unread.
          if (!profile) {
            const page = await this.browserAttempt(attempts, `${platform}:profile`, (ms) => limited(this.browser, ms).profile(target, platform));
            if (page) profile = page.profile;
          }
        } else {
          const page = await this.attempt(attempts, backend, `${platform}:profile`, (ms) => limited(this.pages, ms).profile(target, platform));
          if (page) profile = page.profile;
        }
        if (profile && posts.length > 0) break;
      }
    }

    posts = posts.slice(0, limit);
    const records = [...(profile ? [profile] : []), ...posts];
    const expected = Math.min(limit, profile?.post_count ?? limit);
    const complete = Boolean(profile && profile.followers !== null) && posts.length >= expected && posts.every(hasFullMetrics);
    const coverage = records.length === 0 ? 'none' : complete ? 'full' : 'partial';
    let reason = null;
    let code = null;
    if (coverage === 'partial') {
      const gaps = [];
      if (!profile || profile.followers === null) gaps.push('the account facts');
      if (posts.length < expected) gaps.push(`${expected - posts.length} of the ${expected} posts asked for`);
      if (posts.some((post) => !hasFullMetrics(post))) {
        gaps.push(
          platform === 'instagram'
            ? "view, like and comment counts on the listed posts (Instagram shows likes and comments on a post's own page and no view count at all to a signed out reader)"
            : platform === 'youtube'
              ? 'like and comment counts on the listed Shorts (the channel listing carries view counts, rounded, and no dates)'
              : 'like, comment and share counts on the listed posts (view counts are there)',
        );
      }
      reason = `Read directly, except ${gaps.join(' and ')}.`;
      // A refusal that a later route covered (the embed's 503 before the stealth reader's answer) is not why this is partial.
      code = mostTelling(attempts.slice(attempts.findLastIndex((attempt) => attempt.outcome === 'ok') + 1))?.code ?? (platform === 'instagram' ? 'login_required' : 'unsupported');
      if (listingTab === 'videos') {
        reason = `This channel has no Shorts tab, so its latest videos were read instead (long videos included, rounded view counts, no dates). ${reason}`;
        code = 'unsupported';
      }
      if (emptyListNote && posts.length === 0) {
        // The stealth reader read the profile but TikTok's video list stayed empty after its one retry.
        reason = `${emptyListNote} The profile facts were read; the videos were not.`;
        code = 'empty_page';
      }
    }
    return this.finish({
      platform,
      records,
      coverage,
      attempts,
      reason,
      code,
      plan,
      extra: {
        ...(listingTab ? { listing_tab: listingTab } : {}),
        missing_fields: posts.some((post) => !hasFullMetrics(post))
          ? platform === 'instagram'
            ? ['metrics.views', 'metrics.likes', 'metrics.comments', 'metrics.shares']
            : platform === 'youtube'
              ? ['metrics.likes', 'metrics.comments', 'posted_at']
              : ['metrics.likes', 'metrics.comments', 'metrics.shares']
          : [],
      },
    });
  }

  /**
   * An Instagram profile through the stealth reader's page op: the account facts and its first posts.
   * @param {any} stealth
   * @param {{handle: string, url: string}} target
   * @param {number} ms time left in this call.
   * @returns {Promise<{ok: true, profile: Record<string, any>, posts: Array<Record<string, any>>}|{ok: false, code: string, reason: string, trip: boolean}>}
   */
  async instagramProfileRead(stealth, target, ms) {
    const read = await readInstagramPage(stealth, target.url, { timeoutMs: ms, politeness: this.politeness });
    if (!read.ok) return read;
    const parsed = profileFromPage(read.page, target, read.observed_at);
    if (!parsed) return { ok: false, code: 'empty_page', reason: 'Instagram answered, but the page held no account facts.', trip: false };
    return { ok: true, ...parsed };
  }

  /**
   * One Instagram post or reel through the stealth reader's page op.
   * @param {any} stealth
   * @param {string} url
   * @param {number} ms time left in this call.
   * @returns {Promise<{ok: true, record: Record<string, any>}|{ok: false, code: string, reason: string, trip: boolean}>}
   */
  async instagramPostRead(stealth, url, ms) {
    const read = await readInstagramPage(stealth, url, { timeoutMs: ms, politeness: this.politeness });
    if (!read.ok) return read;
    const record = postFromPage(read.page, url, read.observed_at);
    if (!record) return { ok: false, code: 'empty_page', reason: 'Instagram answered, but the page held no post facts.', trip: false };
    return { ok: true, record };
  }

  /**
   * The comments an Instagram post page embeds, through the stealth reader's page op (photo posts and carousels too).
   * @param {any} stealth
   * @param {string} url
   * @param {number} ms time left in this call.
   * @returns {Promise<{ok: true, records: Array<Record<string, any>>, total: number|null, complete: boolean}|{ok: false, code: string, reason: string, trip: boolean}>}
   */
  async instagramCommentsRead(stealth, url, ms) {
    const read = await readInstagramPage(stealth, url, { timeoutMs: ms, politeness: this.politeness });
    if (!read.ok) return read;
    const { records, total } = commentsFromPage(read.page, url, read.observed_at);
    if (records.length === 0 && total !== 0) {
      return { ok: false, code: 'empty_page', reason: 'Instagram answered, but the post page embedded none of its comments.', trip: false };
    }
    return { ok: true, records, total, complete: total !== null ? records.length >= total : false };
  }

  /**
   * @param {{url: string}} input
   * @returns {Promise<Record<string, any>>}
   */
  async post(input) {
    const url = parseHttpUrl(input.url);
    const platform = url ? platformFromUrl(url.href) : null;
    if (!url || !platform) {
      throw new InvalidInputError('That is not a TikTok, Instagram, Facebook or YouTube post address.', { fix: 'For any other website use web_crawl.' });
    }
    let href = url.href;
    if (platform === 'tiktok' && !tiktokPostId(href)) {
      const resolved = await this.tiktok.resolveShortLink(href);
      if (resolved && tiktokPostId(resolved)) href = resolved;
    }
    const key = { platform, kind: 'post', target: platform === 'tiktok' && tiktokPostId(href) ? `tiktok:${tiktokPostId(href)}` : href.replace(/[?#].*$/, '') };
    return this.cached(key, () => this.readPost(platform, href));
  }

  /**
   * @param {'tiktok'|'instagram'|'facebook'|'youtube'} platform
   * @param {string} url
   * @returns {Promise<Record<string, any>>}
   */
  async readPost(platform, url) {
    /** @type {Attempt[]} */
    const attempts = [];
    const postId = platform === 'tiktok' ? tiktokPostId(url) : null;
    if (platform === 'tiktok' && !postId) {
      throw new InvalidInputError('That TikTok address does not point at a single post.', { fix: 'Use an address like https://www.tiktok.com/@brand/video/1234567890.' });
    }
    let record = null;
    for (const backend of ROUTES[platform].post) {
      if (backend === 'stealth') {
        // Instagram: the page op reads caption, date, exact likes and comments and the video address in one request.
        const stealth = await this.stealthReady();
        if (!stealth) {
          attempts.push({ backend, outcome: 'skipped', code: 'backend_missing', reason: 'skipped: the stealth reader (Scrapling) is not installed.' });
        } else {
          const read = await this.attempt(attempts, backend, `${platform}:post`, (ms) => this.instagramPostRead(stealth, url, ms));
          if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
        }
      } else if (backend === 'yt-dlp') {
        const read = await this.attempt(attempts, backend, `${platform}:post`, (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).post(url, platform));
        if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
      } else if (backend === 'tiktok_embed') {
        const read = await this.attempt(attempts, backend, `${platform}:post`, (ms) => limited(this.tiktok, ms).post(/** @type {string} */ (postId)));
        if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
      } else if (backend === 'browser') {
        const read = await this.browserAttempt(attempts, `${platform}:post`, (ms) => limited(this.browser, ms).post(url, /** @type {'instagram'|'facebook'} */ (platform)));
        if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
      } else {
        const read = await this.attempt(attempts, backend, `${platform}:post`, (ms) => limited(this.pages, ms).post(url, platform));
        if (read) record = read.record;
      }
      if (record && postComplete(platform, record)) break;
      if (attempts.at(-1)?.code === 'not_found') break;
      // Instagram asked automated readers to slow down: yt-dlp would ask the very same host a moment later. Stop here.
      if (platform === 'instagram' && attempts.at(-1)?.outcome === 'failed' && attempts.at(-1)?.code === 'rate_limited') break;
    }
    const coverage = !record ? 'none' : hasFullMetrics(record) && record.caption !== null ? 'full' : 'partial';
    // Instagram never shows a signed out reader a view count: a post read that has everything else is as complete as it gets.
    const publicOnly = platform === 'instagram' && coverage === 'partial' && record !== null && postComplete(platform, record);
    return this.finish({
      platform,
      records: record ? [record] : [],
      coverage,
      attempts,
      reason: publicOnly
        ? 'Instagram shows view counts only to signed in visitors, and Social Campaign never signs in. The caption, date, like count and comment count were read.'
        : coverage === 'partial'
          ? 'The post was read, but some of its counts or its caption were not shown.'
          : null,
      code: publicOnly ? 'login_required' : undefined,
      plan: () => (publicOnly ? null : postPlan({ platform, url })),
      extra: publicOnly ? { missing_fields: ['metrics.views', 'metrics.shares', 'metrics.saves'] } : undefined,
    });
  }

  /**
   * @param {{url: string, limit?: number}} input
   * @returns {Promise<Record<string, any>>}
   */
  async comments(input) {
    const limit = input.limit ?? 100;
    const url = parseHttpUrl(input.url);
    const platform = url ? platformFromUrl(url.href) : null;
    if (!url || !platform) throw new InvalidInputError('That is not a TikTok, Instagram, Facebook or YouTube post address.');
    let href = url.href;
    if (platform === 'tiktok' && !tiktokPostId(href)) {
      const resolved = await this.tiktok.resolveShortLink(href);
      if (resolved && tiktokPostId(resolved)) href = resolved;
    }
    const postId = platform === 'tiktok' ? tiktokPostId(href) : null;
    if (platform === 'tiktok' && !postId) throw new InvalidInputError('That TikTok address does not point at a single post.');
    const key = { platform, kind: 'comments', target: postId ? `tiktok:${postId}` : href.replace(/[?#].*$/, '') };
    return this.cached(
      key,
      async () => ({ ...(await this.readComments(platform, href, postId, limit)), requested_limit: limit }),
      (hit) => (hit.requested_limit >= limit ? { ...hit, records: hit.records.slice(0, limit) } : null),
    );
  }

  /**
   * @param {'tiktok'|'instagram'|'facebook'} platform
   * @param {string} url
   * @param {string|null} postId
   * @param {number} limit
   * @returns {Promise<Record<string, any>>}
   */
  async readComments(platform, url, postId, limit) {
    /** @type {Attempt[]} */
    const attempts = [];
    let records = [];
    let complete = false;
    let total = null;
    for (const backend of ROUTES[platform].comments) {
      let read = null;
      if (backend === 'tiktok_comments') {
        read = await this.attempt(attempts, backend, `${platform}:comments`, (ms) => limited(this.tiktok, ms).comments(/** @type {string} */ (postId), url, limit));
      } else if (backend === 'stealth') {
        const stealth = await this.stealthReady();
        if (!stealth) {
          attempts.push({ backend, outcome: 'skipped', code: 'backend_missing', reason: 'skipped: the stealth reader (Scrapling) is not installed.' });
          continue;
        }
        read = await this.attempt(attempts, backend, `${platform}:comments`, (ms) => this.instagramCommentsRead(stealth, url, ms));
      } else {
        read = await this.attempt(attempts, backend, `${platform}:comments`, (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).comments(url, platform, limit));
      }
      if (read) {
        records = read.records;
        total = read.total ?? null;
        complete = 'complete' in read ? Boolean(read.complete) : records.length >= Math.min(limit, total ?? limit);
        break;
      }
    }
    if (ROUTES[platform].comments.length === 0) {
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'login_required', reason: 'Facebook shows comments only to signed in visitors, and Social Campaign never signs in.' });
    }
    const ordered = orderComments(records);
    records = ordered.records.slice(0, limit);
    const coverage = records.length === 0 && !complete ? 'none' : complete ? 'full' : 'partial';
    const embeddedOnly = platform === 'instagram' && coverage === 'partial' && attempts.some((attempt) => attempt.backend === 'stealth' && attempt.outcome === 'ok');
    return this.finish({
      platform,
      records,
      coverage,
      attempts,
      reason:
        coverage === 'partial'
          ? embeddedOnly
            ? `Read ${records.length} of the post's ${total ?? 'many'} comments: Instagram embeds only the first comments in the post page it gives a signed out reader.`
            : `Read ${records.length} comments; the platform stopped before ${limit}.`
          : null,
      code: coverage === 'partial' ? (embeddedOnly ? 'login_required' : 'rate_limited') : null,
      plan: () => commentsPlan({ platform, url, limit }),
      extra: { total_comments: total, comment_order: ordered.order, comment_order_note: ordered.note },
    });
  }

  /**
   * @param {{platform: string, query: string, limit?: number}} input
   * @returns {Promise<Record<string, any>>}
   */
  async search(input) {
    const platform = /** @type {'tiktok'|'instagram'|'facebook'|'youtube'} */ (input.platform);
    const limit = input.limit ?? 20;
    const query = String(input.query ?? '').trim();
    if (!query) throw new InvalidInputError('Say what to search for: a topic, a #hashtag or an @account.');
    const key = { platform, kind: 'search', target: `${platform}:${query.toLowerCase()}` };
    return this.cached(
      key,
      async () => ({ ...(await this.readSearch(platform, query, limit)), requested_limit: limit }),
      (hit) => (hit.requested_limit >= limit ? hit : null),
    );
  }

  /**
   * @param {'tiktok'|'instagram'|'facebook'|'youtube'} platform
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Record<string, any>>}
   */
  async readSearch(platform, query, limit) {
    /** @type {Attempt[]} */
    const attempts = [];
    const plan = () => searchPlan({ platform, query, limit });
    const name = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }[platform];

    if (query.startsWith('@')) {
      const profile = await this.profile({ platform, handle_or_url: query, limit });
      return {
        ...profile,
        coverage: profile.coverage === 'full' ? 'partial' : profile.coverage,
        degraded_code: profile.coverage === 'none' ? profile.degraded_code : 'unsupported',
        degraded_reason:
          profile.coverage === 'none' ? profile.degraded_reason : `${name} search is not open to signed out readers, so this is the account ${query} itself rather than search results.`,
        web_evidence_plan: profile.coverage === 'none' && profile.web_evidence_plan ? profile.web_evidence_plan : plan(),
        search_mode: 'account',
      };
    }

    if (platform === 'instagram') return this.readInstagramSearch(query, limit, plan);
    if (platform === 'youtube') return this.readYoutubeSearch(query, limit, plan);

    if (platform !== 'tiktok') {
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'login_required', reason: `${name} search is only open to signed in visitors, and Social Campaign never signs in.` });
      return this.finish({ platform, records: [], coverage: 'none', attempts, plan, extra: { search_mode: query.startsWith('#') ? 'hashtag' : 'keyword' } });
    }

    if (!query.startsWith('#')) {
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'login_required', reason: 'TikTok keyword search needs a signed in session or a signed request; hashtags and @accounts can be read.' });
      return this.finish({ platform, records: [], coverage: 'none', attempts, plan, extra: { search_mode: 'keyword' } });
    }

    // The tag page itself (yt-dlp, even with browser impersonation) answered a bot check on every live read since
    // 2026-10-13, and each refusal counted against TikTok; the hashtag's totals are the part a signed out reader gets.
    const tag = query.slice(1).replace(/\s+/g, '');
    let hashtag = null;
    const stats = await this.attempt(attempts, 'tiktok_embed', `${platform}:search`, (ms) => limited(this.tiktok, ms).hashtag(tag));
    if (stats) hashtag = stats.hashtag;
    return this.finish({
      platform,
      records: [],
      coverage: hashtag ? 'partial' : 'none',
      attempts,
      reason: hashtag ? `TikTok shows the totals for #${tag} to signed out readers but not its posts: the tag page itself always answers a bot check, so its videos are not listed. Find posts through accounts (social_profile_get, social_outliers_find) or single addresses.` : undefined,
      code: hashtag ? 'unsupported' : undefined,
      plan,
      extra: { search_mode: 'hashtag', hashtag },
    });
  }

  /**
   * YouTube keyword search for Shorts through yt-dlp's `ytsearch`: titles, channels and view counts (rounded by YouTube),
   * ranked by views. The listing carries no dates, likes or comments, and the answer says so.
   * @param {string} query
   * @param {number} limit
   * @param {() => Record<string, any>} plan
   * @returns {Promise<Record<string, any>>}
   */
  async readYoutubeSearch(query, limit, plan) {
    /** @type {Attempt[]} */
    const attempts = [];
    const text = query.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    const found = await this.attempt(attempts, 'yt-dlp', 'youtube:search', (ms) => limited(this.ytdlp, ms, YTDLP_TIMEOUT_MS).search(text, 'youtube', limit));
    const posts = found ? found.posts.slice(0, limit) : [];
    return this.finish({
      platform: 'youtube',
      records: posts,
      coverage: posts.length > 0 ? 'partial' : 'none',
      attempts,
      reason: posts.length > 0 ? "YouTube's search lists Shorts with their title, channel and view count (rounded by YouTube), ranked here by views; it carries no dates, like counts or comment counts." : undefined,
      code: posts.length > 0 ? 'unsupported' : undefined,
      plan,
      extra: { search_mode: 'keyword', query_read_as: text, dated: false },
    });
  }

  /**
   * An Instagram topic (a #hashtag or a phrase) through the public /popular/<topic>/ page: reels with their play
   * counts, caption and owner. It carries no dates, likes or comments.
   * @param {string} query
   * @param {number} limit
   * @param {() => Record<string, any>} plan
   * @returns {Promise<Record<string, any>>}
   */
  async readInstagramSearch(query, limit, plan) {
    /** @type {Attempt[]} */
    const attempts = [];
    const topic = instagramTopic(query);
    const searchMode = query.startsWith('#') ? 'hashtag' : 'keyword';
    if (!topic.ok) {
      // Refused before any request: a phrase has no topic page, and asking for a made up one only gets the sign-in wall.
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'unsupported', reason: topic.reason });
      return this.finish({ platform: 'instagram', records: [], coverage: 'none', attempts, plan: () => null, extra: { search_mode: searchMode, hashtag: null, suggested_queries: topic.suggestions } });
    }
    const slug = topic.slug;
    const stealth = await this.stealthReady();
    /** @type {Array<Record<string, any>>} */
    let posts = [];
    let hashtag = null;
    if (!stealth) {
      attempts.push({
        backend: 'none',
        outcome: 'skipped',
        code: 'login_required',
        reason: "Instagram search is only open to signed in visitors, and Social Campaign never signs in. The stealth reader that reads Instagram's public /popular/ topic pages is not installed.",
      });
    } else {
      const url = `https://www.instagram.com/popular/${encodeURIComponent(slug)}/`;
      const read = await this.attempt(attempts, 'stealth', 'instagram:search', async (ms) => {
        const page = await readInstagramPage(stealth, url, { timeoutMs: ms, politeness: this.politeness });
        if (!page.ok) return page;
        const parsed = topicFromPage(page.page, slug, page.observed_at);
        if (parsed.posts.length === 0) return { ok: false, code: 'empty_page', reason: 'Instagram answered, but the topic page listed no reels.', trip: false };
        return { ok: true, ...parsed, url, observed_at: page.observed_at };
      });
      if (read) {
        posts = read.posts.slice(0, limit);
        hashtag = {
          name: read.topic.tag,
          url: read.url,
          description: read.topic.title,
          views: null,
          videos: read.topic.reels_text ? parseHumanCount(read.topic.reels_text) : null,
          source_type: 'public_platform',
          source_ref: read.url,
          observed_at: read.observed_at,
          confidence: 0.85,
        };
      }
    }
    const note = topic.note ? ` ${topic.note}` : '';
    return this.finish({
      platform: 'instagram',
      records: posts,
      coverage: posts.length > 0 ? 'partial' : 'none',
      attempts,
      reason: posts.length > 0 ? `Instagram's public topic page lists reels with their play counts, captions and owners; it carries no dates, like counts or comment counts.${note}` : undefined,
      code: posts.length > 0 ? 'login_required' : undefined,
      plan,
      extra: { search_mode: searchMode, hashtag, topic_read_as: `#${slug}`, ...(posts.length > 0 ? { dated: false } : {}) },
    });
  }

  /**
   * @param {{platform: string, handle_or_url: string, window?: '30d'|'90d'|'180d'|'all'}} input
   * @returns {Promise<Record<string, any>>}
   */
  async outliers(input) {
    const window = input.window ?? '90d';
    const usesStealth = input.platform === 'tiktok' || input.platform === 'instagram';
    // One time budget for the whole read: the profile, and for Instagram the posts opened one by one.
    return this.budgeted(usesStealth ? await this.stealthDeadlineMs() : this.deadlineMs, () => this.readOutliers(input, window));
  }

  /**
   * For Instagram, the profile page lists recent posts with captions and dates but no counts, and a post's likes and
   * comments are only on its own page. Open the most recent ones in the window, one at a time and politely, while
   * the call has time, and return the list with the counts filled in.
   * @param {Array<Record<string, any>>} posts the profile's post records.
   * @param {'30d'|'90d'|'180d'|'all'} window
   * @param {number} [max] most posts to open; default INSTAGRAM_OUTLIER_READS.
   * @returns {Promise<{posts: Array<Record<string, any>>, opened: number, wanted: number, stopped: string|null}>}
   */
  async enrichInstagramPosts(posts, window, max = INSTAGRAM_OUTLIER_READS) {
    const days = WINDOWS[window];
    const cutoff = days === null || days === undefined ? -Infinity : this.now() - days * 86_400_000;
    const wanted = posts
      .filter((post) => post.metrics?.likes === null || post.metrics?.likes === undefined)
      .filter((post) => {
        const at = Date.parse(post.posted_at ?? '');
        return !Number.isFinite(at) || at >= cutoff;
      })
      .sort((a, b) => Date.parse(b.posted_at ?? '') - Date.parse(a.posted_at ?? ''))
      .slice(0, Math.max(0, max));
    /** @type {Map<string, Record<string, any>>} */
    const opened = new Map();
    let stopped = null;
    for (const post of wanted) {
      if (this.remainingMs() < INSTAGRAM_READ_MIN_MS) {
        stopped = 'the time for this read ran out';
        break;
      }
      let answer;
      try {
        answer = await this.post({ url: post.url });
      } catch {
        continue;
      }
      const record = answer.records?.[0];
      if (record) opened.set(post.url, record);
      else if (['blocked', 'rate_limited', 'login_required', 'timed_out'].includes(answer.degraded_code)) {
        stopped = `Instagram answered ${answer.degraded_code}`;
        break;
      }
    }
    return {
      posts: posts.map((post) => (opened.has(post.url) ? mergePosts([opened.get(post.url)], [post])[0] : post)),
      opened: opened.size,
      wanted: wanted.length,
      stopped,
    };
  }

  /**
   * @param {{platform: string, handle_or_url: string}} input
   * @param {'30d'|'90d'|'180d'|'all'} window
   * @returns {Promise<Record<string, any>>}
   */
  async readOutliers(input, window) {
    const profile = await this.profile({ platform: input.platform, handle_or_url: input.handle_or_url, limit: 50 });
    let posts = profile.records.filter((record) => record.kind === 'post');
    /** @type {{window: typeof window, now: number, measure?: 'views'|'likes', includeUndated?: boolean}} */
    const options = { window, now: this.now() };
    let instagramNote = null;
    if (input.platform === 'instagram' && posts.length > 0) {
      const listed = posts.length;
      const enriched = await this.enrichInstagramPosts(posts, window);
      posts = enriched.posts;
      let opened = enriched.opened;
      let stopped = enriched.stopped;
      options.measure = 'likes';
      // Fewer than a baseline's worth of posts in the window: open some older ones too (same cap), so widening has counts to use.
      if (window !== 'all' && !stopped && findOutliers(posts, { ...options, window }).baseline.sample < MIN_BASELINE_SAMPLE && opened < INSTAGRAM_OUTLIER_READS) {
        const more = await this.enrichInstagramPosts(posts, 'all', INSTAGRAM_OUTLIER_READS - opened);
        posts = more.posts;
        opened += more.opened;
        stopped = more.stopped;
      }
      instagramNote = `Instagram shows no view counts to signed out readers, so posts are ranked by likes against this account's own median likes; ${opened} of its ${listed} listed posts were opened one by one for their counts${stopped ? ` (stopped early: ${stopped})` : ''}.`;
    }
    // A channel listing with no dates at all (YouTube Shorts) is the account's latest posts: that is its window.
    if (input.platform === 'youtube' && posts.length > 0 && posts.every((post) => post.posted_at === null)) options.includeUndated = true;
    const found = findOutliersWidening(posts, options);
    const baseline = found.baseline;
    const thinListing = profile.coverage !== 'full' || instagramNote !== null;
    let coverage = 'full';
    let code = null;
    let reason = null;
    /** @type {string[]} */
    const notes = [];
    if (baseline.widened) {
      notes.push(
        `Only ${baseline.requested_sample} post${baseline.requested_sample === 1 ? '' : 's'} fell in the last ${WINDOWS[window]} days, so the baseline window was widened to ${baseline.window === 'all' ? 'the whole listing' : `${WINDOWS[baseline.window]} days`}${baseline.stale ? ` (stale: the newest post is from ${baseline.newest_post_at})` : ''}.`,
      );
    }
    if (options.includeUndated) {
      notes.push("The listing carries no dates (undated): these are the channel's latest posts, ranked by views, not a time window.");
    }
    if (posts.length === 0) {
      coverage = 'none';
      code = profile.degraded_code ?? 'not_found';
      reason = profile.degraded_reason ?? 'No posts could be read for this account.';
    } else if (found.problem) {
      coverage = 'partial';
      code = instagramNote ? 'login_required' : 'unsupported';
      reason = [found.problem, baseline.newest_post_at ? `The newest post is from ${baseline.newest_post_at}.` : null, instagramNote].filter(Boolean).join(' ');
    } else if (thinListing || baseline.widened || options.includeUndated) {
      coverage = 'partial';
      code = profile.degraded_code ?? (instagramNote ? 'login_required' : 'unsupported');
      reason = [
        ...notes,
        instagramNote ?? (thinListing ? `The baseline comes from the ${posts.length} most recent posts that could be read, not the whole account${options.includeUndated ? ', and the listing carries no dates' : ''}.` : null),
      ]
        .filter(Boolean)
        .join(' ');
    }
    return envelope({
      platform: input.platform,
      backend: profile.backend,
      coverage: /** @type {any} */ (coverage),
      degraded_code: code,
      degraded_reason: reason,
      records: found.outliers,
      web_evidence_plan: coverage === 'full' ? null : profile.web_evidence_plan ?? null,
      observed_at: profile.observed_at,
      extra: {
        baseline,
        posts_considered: posts.length,
        stale: baseline.stale === true,
        newest_post_at: baseline.newest_post_at,
        dated: baseline.dated,
        ...(profile.listing_tab ? { listing_tab: profile.listing_tab } : {}),
        attempts: profile.attempts ?? [],
        from_cache: profile.from_cache ?? false,
      },
    });
  }

  /**
   * @param {{platform: 'meta'|'tiktok', advertiser_or_query: string, country?: string}} input
   * @returns {Promise<Record<string, any>>}
   */
  async adSearch(input) {
    const query = String(input.advertiser_or_query ?? '').trim();
    if (!query) throw new InvalidInputError('Say which advertiser or phrase to look up.');
    let country = input.country ? String(input.country).trim().toUpperCase() : null;
    let countrySource = 'argument';
    if (country && !/^[A-Z]{2}$/.test(country)) throw new InvalidInputError('country is a two letter code such as US, GB or DE.');
    if (!country) {
      const brand = this.brandCountry();
      country = brand ?? 'US';
      countrySource = brand ? 'brand_market' : 'default';
    }
    const platform = input.platform;
    const key = { platform: platform === 'meta' ? 'meta' : 'tiktok', kind: 'ads', target: `${platform}:${country}:${query.toLowerCase()}` };
    return this.cached(key, async () => {
      /** @type {Attempt[]} */
      const attempts = [];
      const backend = platform === 'meta' ? 'meta_ad_library' : 'tiktok_creative_center';
      const adHost = PLATFORM_HOST[platform] ?? null;
      const adsOpen = adHost ? this.breakerState(adHost, AD_SCOPE) : { open: false };
      if (adsOpen.open || this.remainingMs() <= 0) {
        const why = adsOpen.open ? `skipped: ${adsOpen.reason ?? `${adHost} refused earlier reads`}` : 'skipped: budget (this call used its 45 seconds)';
        attempts.push({ backend, outcome: 'skipped', code: adsOpen.open ? adsOpen.code ?? 'blocked' : 'timed_out', reason: why });
        return this.finish({
          platform,
          backend: 'none',
          records: [],
          coverage: 'none',
          attempts,
          plan: () => adsPlan({ platform, query, country: /** @type {string} */ (country), eu: EU_LIKE.has(/** @type {string} */ (country)), urls: platform === 'meta' ? { library: metaLibraryUrl(query, /** @type {string} */ (country)) } : { library: tiktokLibraryUrls(query, /** @type {string} */ (country)).creativeCenter } }),
          extra: { country, country_source: countrySource },
        });
      }
      // The ad reader's one fallback is the stealth reader (Meta Ad Library page, TikTok Top Ads).
      if (this.ownsAds && this.ads.options && this.ads.options.stealth === undefined) {
        this.ads.options.stealth = (await this.stealthReady()) ?? null;
      }
      const adReader = limited(this.ads, this.remainingMs());
      const outcome = platform === 'meta' ? await adReader.meta(query, country) : await adReader.tiktok(query, country);
      if (adHost) {
        if (outcome.records.length > 0) this.breaker.recordSuccess(adHost, AD_SCOPE);
        else if (['blocked', 'rate_limited', 'timed_out'].includes(outcome.code)) this.breaker.recordFailure(adHost, outcome.code, outcome.reason, AD_SCOPE);
      }
      attempts.push({ backend, outcome: outcome.records.length > 0 ? 'ok' : 'failed', code: outcome.records.length > 0 ? null : outcome.code, reason: outcome.reason || null });
      let records = outcome.records;
      let usedBackend = outcome.reached ? 'ad_library_page' : 'none';
      // The library page itself is tried first; the browser backend only runs when
      // that page carried nothing, since it is much slower and heavier to spawn.
      if (records.length === 0 && !outcome.extra?.definitive) {
        const browserOutcome = await this.browserAttempt(attempts, `${platform}:ads`, (ms) => limited(this.browser, ms).adLibraryPage(outcome.urls.library, platform));
        if (browserOutcome && browserOutcome.records.length > 0) {
          records = browserOutcome.records;
          usedBackend = 'browser';
        }
      }
      const coverage = records.length > 0 ? 'partial' : 'none';
      return this.finish({
        platform,
        backend: usedBackend,
        records,
        coverage,
        attempts,
        reason: coverage === 'partial' ? (outcome.extra?.list_scope ? outcome.reason : 'These are the ads the library page itself carried; the full list is only in the browser.') : outcome.reason,
        code: coverage === 'partial' ? 'unsupported' : outcome.code,
        plan: () => adsPlan({ platform, query, country: /** @type {string} */ (country), eu: EU_LIKE.has(/** @type {string} */ (country)), urls: outcome.urls }),
        extra: { country, country_source: countrySource, library_url: outcome.urls.library, ...(usedBackend === 'ad_library_page' || outcome.extra?.definitive ? outcome.extra ?? {} : {}) },
      });
    });
  }

  /**
   * @param {{url: string, scope?: 'page'|'section'|'site', max_pages?: number}} input
   * @returns {Promise<Record<string, any>>}
   */
  async crawl(input) {
    const url = parseHttpUrl(input.url);
    if (!url) throw new InvalidInputError(`"${input.url}" is not a web address.`, { fix: 'Use a full address starting with https://.' });
    const scope = input.scope ?? 'page';
    const maxPages = scope === 'page' ? 1 : input.max_pages ?? 5;
    url.hash = '';
    const key = { platform: 'web', kind: 'crawl', target: `${scope}:${maxPages}:${url.href}` };
    return this.cached(key, () => this.readCrawl(url.href, scope, maxPages));
  }

  /**
   * `web_reader` first, always; the browser backend only for a single page read
   * that came back `none` because its content is added by JavaScript, since a
   * section or site crawl with the browser backend would be far too slow to spawn
   * once per page.
   * @param {string} url
   * @param {'page'|'section'|'site'} scope
   * @param {number} maxPages
   * @returns {Promise<Record<string, any>>}
   */
  async readCrawl(url, scope, maxPages) {
    const first = await webCrawl({ url, scope, max_pages: maxPages }, { ...this.crawlOptions, budgetMs: Math.min(CRAWL_BUDGET_MS, Math.max(1000, this.remainingMs())) });
    const refused = first.degraded_code === 'blocked';
    const jsGap = scope === 'page' && first.coverage !== 'full' && (first.degraded_code === 'empty_page' || refused);
    if (!jsGap) return first;
    /** @type {Attempt[]} */
    const attempts = [{ backend: 'web_reader', outcome: 'failed', code: first.degraded_code, reason: first.degraded_reason }];
    // The ONE fallback: a 403, bot check or Cloudflare answer goes to the stealth reader when it is
    // installed; everything else (and a JavaScript shell) goes to the browser backend.
    const stealth = refused ? await this.stealthReady() : null;
    let page;
    let backend = 'browser';
    if (stealth) {
      backend = 'stealth';
      const read = await this.attempt(attempts, 'stealth', 'web:crawl', async (ms) => {
        const out = await stealth.page(url, { timeoutMs: Math.min(ms, 40_000) });
        if (!out || out.ok !== true) return { ok: false, code: envelopeCode(out?.code ?? 'unsupported'), reason: out?.reason ?? 'The stealth reader failed.', trip: Boolean(out?.trip) };
        const text = String(out.text ?? '');
        if (text.trim().length === 0) return { ok: false, code: 'empty_page', reason: 'The stealth reader found nothing readable.', trip: false };
        const fetchedAt = new Date(this.now()).toISOString();
        const record = pageRecord({
          url: out.finalUrl ?? url,
          title: out.title ?? null,
          text,
          links: Array.isArray(out.links) ? out.links.filter((link) => typeof link === 'string') : [],
          source_ref: out.finalUrl ?? url,
          observed_at: fetchedAt,
          source_type: 'web_evidence',
          confidence: 0.8,
        });
        return { ok: true, record, coverage: text.trim().length < 400 ? 'partial' : 'full' };
      });
      page = read;
    } else {
      page = await this.browserAttempt(attempts, 'web:crawl', (ms) => limited(this.browser, ms).page(url));
    }
    if (!page) {
      return { ...first, attempts: [...attempts] };
    }
    return this.finish({
      platform: 'web',
      backend: 'browser',
      records: [page.record],
      coverage: page.coverage,
      attempts,
      reason: page.coverage === 'partial' ? 'The rendered page had only a little readable text.' : null,
      plan: () => first.web_evidence_plan,
      extra: { scope, pages_read: 1, skipped: [], rendered: true, rendered_by: backend },
    });
  }

  /**
   * Probe every backend, once per STATUS_TTL_MS, and derive the coverage matrix.
   * @param {{force?: boolean}} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async status(options = {}) {
    if (!options.force && this.statusCache && this.now() - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const checkedAt = new Date(this.now()).toISOString();
    if (this.offline) {
      const ytdlp = await this.ytdlp.health();
      /** @type {Array<Record<string, any>>} */
      const backends = [
        { id: 'yt-dlp', present: ytdlp.present, version: ytdlp.version, healthy: ytdlp.status === 'ok', probe: 'live', detail: ytdlp.detail, impersonation: ytdlp.impersonation },
        { id: 'web_reader', present: true, version: `node ${process.versions.node}`, healthy: true, probe: 'static', detail: 'Built in page reader: robots.txt honoured, same site only, 2 MB and 10 second caps.' },
      ];
      for (const id of STATUS_BACKEND_IDS) {
        backends.push({ id, present: true, version: null, healthy: null, probe: 'skipped', detail: 'Not probed: offline mode.' });
      }
      const value = { checked_at: checkedAt, offline: true, backends, matrix: structuredClone(VERIFIED_MATRIX), matrix_source: 'verified 2026-10-13, without the research helper' };
      this.statusCache = { at: this.now(), value };
      return value;
    }

    // Every probe runs at the same time, all of them under one 30 second cap: a probe still
    // running at the cap is reported as not finished and its answer is left out.
    /** @type {Map<string, Record<string, any>>} */
    const found = new Map();
    /** @type {Record<string, boolean>} */
    const healthy = { web_reader: true };
    let capTimer;
    const capped = new Promise((resolve) => {
      capTimer = setTimeout(() => resolve('cap'), STATUS_PROBE_CAP_MS);
    });
    /** @param {string} id @param {Promise<any>} work */
    const probe = (id, work) =>
      Promise.race([work, capped]).then(
        (value) => value,
        (error) => {
          log.warn('social status probe failed', { id, message: error instanceof Error ? error.message : String(error) });
          return 'failed';
        },
      );
    const missed = (id, note = 'Not finished within 30 seconds.') => {
      if (!found.has(id)) {
        healthy[id] = false;
        found.set(id, { id, present: true, version: null, healthy: false, probe: 'skipped', detail: `Not probed: ${note}` });
      }
    };

    const ytdlpWork = this.ytdlp.health();
    const ytdlpProbe = probe('yt-dlp', ytdlpWork).then((h) => (h && typeof h === 'object' ? h : null));
    const tiktokChain = (async () => {
      const profile = await probe('tiktok_embed', this.tiktok.profile('tiktok'));
      if (!profile || typeof profile !== 'object') return missed('tiktok_embed');
      healthy.tiktok_embed = profile.ok === true;
      found.set('tiktok_embed', {
        id: 'tiktok_embed',
        present: true,
        version: null,
        healthy: healthy.tiktok_embed,
        probe: 'live',
        detail: profile.ok ? `TikTok's public profile embed answered with ${profile.posts.length} posts.` : `TikTok's public embed did not answer: ${profile.reason}`,
      });
      const samplePost = profile.ok ? profile.posts[0] : null;
      const comments = (async () => {
        if (!samplePost) {
          healthy.tiktok_comments = false;
          found.set('tiktok_comments', { id: 'tiktok_comments', present: true, version: null, healthy: false, probe: 'skipped', detail: 'Not probed: no sample post.' });
          return;
        }
        const read = await probe('tiktok_comments', this.tiktok.comments(samplePost.post_id, samplePost.url, 1));
        if (!read || typeof read !== 'object') return missed('tiktok_comments');
        healthy.tiktok_comments = read.ok === true;
        found.set('tiktok_comments', { id: 'tiktok_comments', present: true, version: null, healthy: healthy.tiktok_comments, probe: 'live', detail: read.ok ? 'TikTok public comments answered.' : `TikTok public comments did not answer: ${read.reason}` });
      })();
      const ytdlpPost = (async () => {
        const health = await ytdlpProbe;
        if (!health) return missed('yt-dlp:tiktok');
        if (health.status === 'ok' && samplePost) {
          const read = await probe('yt-dlp:tiktok', this.ytdlp.post(samplePost.url, 'tiktok'));
          if (!read || typeof read !== 'object') return missed('yt-dlp:tiktok');
          healthy['yt-dlp:tiktok'] = read.ok;
          if (!read.ok) this.noteFailure('yt-dlp', 'tiktok:post', read.failure);
          found.set('yt-dlp:tiktok', { id: 'yt-dlp:tiktok', present: true, version: health.version, healthy: read.ok, probe: 'live', detail: read.ok ? 'yt-dlp read a public TikTok post.' : read.failure.reason });
        } else {
          healthy['yt-dlp:tiktok'] = false;
          found.set('yt-dlp:tiktok', { id: 'yt-dlp:tiktok', present: health.present, version: health.version, healthy: false, probe: 'skipped', detail: health.present ? 'Not probed: no sample post.' : 'yt-dlp is not installed.' });
        }
      })();
      await Promise.all([comments, ytdlpPost]);
    })();
    // The stealth reader (Scrapling): present when the research helper installed it. A TikTok profile read through it
    // takes up to 75 seconds, so it is reported here and not probed.
    const stealthReader = await this.stealthReady();
    healthy.stealth = Boolean(stealthReader);
    found.set('stealth', {
      id: 'stealth',
      present: Boolean(stealthReader),
      version: null,
      healthy: Boolean(stealthReader),
      probe: 'static',
      detail: stealthReader
        ? 'Scrapling is installed (the research helper). It reads TikTok profiles, Instagram profiles, posts and topics, and the ad libraries; a TikTok profile read takes up to 75 seconds, so it is not probed here.'
        : 'Scrapling is not installed (run the research helper setup). Without it Instagram cannot be read at all and TikTok profiles rest on the public embed.',
    });

    // Instagram: a real public account (the platform's own), then one real post from its grid, both through the
    // stealth reader exactly as a research call reads them. Without the stealth reader only the plain page is tried.
    const instagramChain = (async () => {
      const target = /** @type {{handle: string, url: string}} */ (parseHandle('instagram', PROBE_HANDLES.instagram));
      if (!stealthReader) {
        const page = await probe('instagram_page', this.pages.read(target.url, 'instagram'));
        if (!page || typeof page !== 'object') return missed('instagram_page');
        healthy.instagram_page = page.ok;
        found.set('instagram_page', { id: 'instagram_page', present: true, version: null, healthy: page.ok, probe: 'live', detail: page.ok ? 'Signed out pages carry readable tags.' : page.reason });
        healthy.instagram_post = false;
        found.set('instagram_post', { id: 'instagram_post', present: true, version: null, healthy: false, probe: 'skipped', detail: 'Not probed: the stealth reader is not installed.' });
        return;
      }
      const profile = await probe('instagram_page', this.instagramProfileRead(stealthReader, target, 20_000));
      if (!profile || typeof profile !== 'object') return missed('instagram_page');
      healthy.instagram_page = profile.ok === true;
      found.set('instagram_page', {
        id: 'instagram_page',
        present: true,
        version: null,
        healthy: healthy.instagram_page,
        probe: 'live',
        detail: profile.ok
          ? `Instagram's profile page for @${target.handle} answered through the stealth reader: ${profile.profile.followers ?? 'no'} followers and ${profile.posts.length} listed posts.`
          : `Instagram's profile page did not answer: ${profile.reason}`,
      });
      const sample = profile.ok ? profile.posts.find((post) => post.url) : null;
      if (!sample) {
        healthy.instagram_post = false;
        found.set('instagram_post', { id: 'instagram_post', present: true, version: null, healthy: false, probe: 'skipped', detail: 'Not probed: no sample post.' });
        return;
      }
      const post = await probe('instagram_post', this.instagramPostRead(stealthReader, sample.url, 20_000));
      if (!post || typeof post !== 'object') return missed('instagram_post');
      healthy.instagram_post = post.ok === true;
      found.set('instagram_post', {
        id: 'instagram_post',
        present: true,
        version: null,
        healthy: healthy.instagram_post,
        probe: 'live',
        detail: post.ok
          ? `An Instagram post page answered through the stealth reader: caption, date, ${post.record.metrics.likes ?? 'no'} likes and ${post.record.metrics.comments ?? 'no'} comments. Instagram shows no view count to a signed out reader, so post coverage is partial by nature.`
          : `An Instagram post page did not answer: ${post.reason}`,
      });
    })();

    // YouTube: a real channel's Shorts tab, then one real video from it.
    const youtubeChain = (async () => {
      const target = /** @type {{handle: string, url: string}} */ (parseHandle('youtube', PROBE_HANDLES.youtube));
      const health = await ytdlpProbe;
      if (!health || health.status !== 'ok') {
        healthy.youtube_channel = false;
        found.set('youtube_channel', { id: 'youtube_channel', present: Boolean(health?.present), version: health?.version ?? null, healthy: false, probe: 'skipped', detail: health?.present ? 'Not probed: yt-dlp does not run.' : 'yt-dlp is not installed.' });
        healthy.youtube_post = false;
        found.set('youtube_post', { id: 'youtube_post', present: Boolean(health?.present), version: health?.version ?? null, healthy: false, probe: 'skipped', detail: 'Not probed: yt-dlp does not run.' });
        return;
      }
      const listing = await probe('youtube_channel', this.ytdlp.listing(target.url, 'youtube', 3));
      if (!listing || typeof listing !== 'object') return missed('youtube_channel');
      healthy.youtube_channel = listing.ok === true && listing.posts.length > 0;
      found.set('youtube_channel', {
        id: 'youtube_channel',
        present: true,
        version: health.version,
        healthy: healthy.youtube_channel,
        probe: 'live',
        detail: healthy.youtube_channel ? `yt-dlp listed ${listing.posts.length} Shorts of the channel @${target.handle}.` : `yt-dlp could not list a channel: ${listing.ok ? 'it was empty' : listing.failure.reason}`,
      });
      const sample = healthy.youtube_channel ? listing.posts.find((post) => post.url) : null;
      if (!sample) {
        healthy.youtube_post = false;
        found.set('youtube_post', { id: 'youtube_post', present: true, version: health.version, healthy: false, probe: 'skipped', detail: 'Not probed: no sample video.' });
        return;
      }
      const post = await probe('youtube_post', this.ytdlp.post(sample.url, 'youtube'));
      if (!post || typeof post !== 'object') return missed('youtube_post');
      healthy.youtube_post = post.ok === true;
      found.set('youtube_post', { id: 'youtube_post', present: true, version: health.version, healthy: post.ok, probe: 'live', detail: post.ok ? 'yt-dlp read a public YouTube video.' : post.failure.reason });
    })();

    const pageProbes = /** @type {const} */ ([['facebook_page', 'facebook', 'https://www.facebook.com/facebook']]).map(async ([id, platform, url]) => {
      const page = await probe(id, this.pages.read(url, platform));
      if (!page || typeof page !== 'object') return missed(id);
      healthy[id] = page.ok;
      found.set(id, { id, present: true, version: null, healthy: page.ok, probe: 'live', detail: page.ok ? 'Signed out pages carry readable tags.' : page.reason });
    });
    const adProbes = [
      ['meta_ad_library', () => this.ads.meta('Meta', 'US')],
      ['tiktok_creative_center', () => this.ads.tiktok('', 'US')],
    ].map(async ([id, run]) => {
      const read = await probe(/** @type {string} */ (id), /** @type {() => Promise<any>} */ (run)());
      if (!read || typeof read !== 'object') return missed(/** @type {string} */ (id));
      healthy[/** @type {string} */ (id)] = read.records.length > 0;
      found.set(/** @type {string} */ (id), { id, present: true, version: null, healthy: read.records.length > 0, probe: 'live', detail: read.reason || 'Ads were readable.' });
    });
    await Promise.all([tiktokChain, instagramChain, youtubeChain, ...pageProbes, ...adProbes, ytdlpProbe]);
    clearTimeout(capTimer);
    for (const id of STATUS_BACKEND_IDS) missed(id);

    const ytdlp = (await ytdlpProbe) ?? { present: true, status: 'timed_out', version: null, impersonation: null, detail: 'yt-dlp did not answer within the 30 second probe cap.' };
    /** @type {Array<Record<string, any>>} */
    const backends = [
      { id: 'yt-dlp', present: ytdlp.present, version: ytdlp.version, healthy: ytdlp.status === 'ok', probe: 'live', detail: ytdlp.detail, impersonation: ytdlp.impersonation },
      { id: 'web_reader', present: true, version: `node ${process.versions.node}`, healthy: true, probe: 'static', detail: 'Built in page reader: robots.txt honoured, same site only, 2 MB and 10 second caps.' },
    ];
    for (const id of STATUS_BACKEND_IDS) backends.push(/** @type {any} */ (found.get(id)));

    const value = { checked_at: checkedAt, offline: false, backends, matrix: matrixFromHealth(healthy, this.observedCoverage), matrix_source: 'measured now' };
    this.statusCache = { at: this.now(), value };
    return value;
  }
}

/**
 * The coverage each platform and operation can reach, given which backends answered a
 * health probe. This is a ceiling inferred from backend reachability, not a report of
 * what any real request returned; a real request very often returns less, because a
 * live probe reads one sample rather than the account, page or count that was actually
 * asked for.
 * @param {Record<string, boolean>} healthy
 * @param {Map<string, {coverage: 'full'|'partial'|'none', at: number}>} [observed] real
 *   coverage measured by live reads in this process (`SocialRouter.observedCoverage`),
 *   keyed `<platform>:<operation>`. Crawler review 2026-09-15, finding 1: whenever a
 *   real measurement exists for a cell, it replaces the inferred ceiling, so the matrix
 *   never claims more than requests have actually delivered.
 * @returns {Record<string, Record<string, 'full'|'partial'|'none'>>}
 */
export function matrixFromHealth(healthy, observed) {
  const embed = Boolean(healthy.tiktok_embed);
  const ytdlp = Boolean(healthy['yt-dlp:tiktok']);
  // The stealth reader can read a TikTok profile on its own (slowly), so it lifts `none` to `partial`.
  const tiktokProfile = embed && ytdlp ? 'full' : embed || ytdlp || healthy.stealth ? 'partial' : 'none';
  const page = (id) => (healthy[id] ? 'partial' : 'none');
  const matrix = {
    tiktok: {
      profile: tiktokProfile,
      post: embed || ytdlp ? 'full' : 'none',
      comments: healthy.tiktok_comments ? 'full' : 'none',
      // Only the hashtag totals are readable: the tag page itself answers a bot check every time.
      search: embed ? 'partial' : 'none',
      outliers: tiktokProfile,
      ads: healthy.tiktok_creative_center ? 'partial' : 'none',
    },
    // Instagram is never better than partial: a signed out reader gets no view count.
    instagram: {
      profile: page('instagram_page'),
      post: page('instagram_post'),
      // The post page embeds its first comments (live 2026-10-14), photo posts and carousels included.
      comments: page('instagram_post'),
      search: page('instagram_page'),
      outliers: healthy.instagram_page && healthy.instagram_post ? 'partial' : 'none',
    },
    facebook: { profile: page('facebook_page'), post: page('facebook_page'), comments: 'none', search: 'none', outliers: 'none' },
    youtube: { profile: page('youtube_channel'), post: healthy.youtube_post ? 'full' : 'none', comments: 'none', search: page('youtube_channel'), outliers: page('youtube_channel') },
    meta: { ads: healthy.meta_ad_library ? 'partial' : 'none' },
    web: { crawl: healthy.web_reader ? 'full' : 'none' },
  };
  if (observed) {
    for (const [platform, operations] of Object.entries(matrix)) {
      for (const operation of Object.keys(operations)) {
        const entry = observed.get(`${platform}:${operation}`);
        if (entry) operations[operation] = entry.coverage;
      }
    }
  }
  return matrix;
}

/** Which matrix column each capability rests on. */
const CAPABILITY_OPERATION = {
  'social.inspect_post': ['post', ['tiktok', 'instagram', 'facebook']],
  'social.inspect_account': ['profile', ['tiktok', 'instagram', 'facebook']],
  'social.search_content': ['search', ['tiktok', 'instagram', 'facebook']],
  'ads.research': ['ads', ['meta', 'tiktok']],
};

/** @type {SocialRouter|null} */
let sharedRouter = null;

/**
 * The process wide router the tools use.
 * @param {ConstructorParameters<typeof SocialRouter>[0]} [options] used only when the router is first made.
 * @returns {SocialRouter}
 */
export function getSocialRouter(options) {
  if (!sharedRouter) sharedRouter = new SocialRouter(options);
  return sharedRouter;
}

/**
 * Capability state for the social, ads and web capabilities, from the latest
 * measured matrix when social_backends_status has run, else the verified one.
 * These capabilities never block: where a platform cannot be read directly the
 * tools hand back a web evidence plan, so the worst state is degraded.
 * @param {string} name
 * @param {{present: boolean, version: string|null}} ytdlp
 * @returns {{state: 'ready'|'degraded', detail: string}}
 */
export function socialCapability(name, ytdlp) {
  if (name === 'web.fetch') {
    return { state: 'ready', detail: 'Claude web fetch, plus the built in page reader behind web_crawl.' };
  }
  const entry = CAPABILITY_OPERATION[name];
  if (!entry) return { state: 'degraded', detail: 'Unknown social capability.' };
  const [operation, platforms] = entry;
  const matrix = sharedRouter?.statusCache?.value.matrix ?? VERIFIED_MATRIX;
  const cells = platforms.map((platform) => [platform, matrix[platform]?.[operation] ?? 'none']);
  const allFull = cells.every(([, coverage]) => coverage === 'full');
  const summary = cells.map(([platform, coverage]) => `${platform} ${coverage}`).join(', ');
  const binary = ytdlp.present ? `yt-dlp ${ytdlp.version}` : 'yt-dlp not installed';
  return {
    state: allFull ? 'ready' : 'degraded',
    detail: `Direct reads: ${summary} (${binary}). The rest comes from web evidence plans.`,
  };
}
