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

import { InvalidInputError } from '../lib/errors.mjs';
import { log } from '../lib/log.mjs';
import { AdLibraryBackend, EU_LIKE } from './backends/adlibrary.mjs';
import { BrowserBackend } from './backends/browser.mjs';
import { PublicPageBackend } from './backends/public_page.mjs';
import { TikTokPublicBackend } from './backends/tiktok_public.mjs';
import { Politeness, webCrawl } from './backends/web.mjs';
import { YtDlpBackend } from './backends/ytdlp.mjs';
import { findOutliers } from './outliers.mjs';
import { adsPlan, commentsPlan, postPlan, profilePlan, searchPlan } from './plans.mjs';
import { envelope, parseHandle, parseHttpUrl, platformFromUrl, tiktokPostId } from './records.mjs';
import { evidenceCountFor, readCache, rememberPlan, savedEvidenceFor, writeCache } from './store.mjs';

/** How long a failed backend is skipped for on one platform. */
export const TRIP_MS = 10 * 60_000;

/** How long a social_backends_status answer is reused. */
export const STATUS_TTL_MS = 15 * 60_000;

/**
 * Ordered backends per platform and operation. The first is preferred.
 * Internal ids; the envelope reports each as yt-dlp, public_page or ad_library_page.
 */
export const ROUTES = {
  tiktok: {
    profile: ['tiktok_embed', 'yt-dlp'],
    post: ['tiktok_embed', 'yt-dlp'],
    comments: ['tiktok_comments'],
    search: ['yt-dlp', 'tiktok_embed'],
    // The browser backend is never used for TikTok: the embed and yt-dlp already work.
    ads: ['tiktok_creative_center', 'browser'],
  },
  // The browser backend runs last, and only for the operations the other backends
  // leave at `none` or `partial`: it is skipped automatically once the earlier
  // backends already answered in full.
  instagram: { profile: ['yt-dlp', 'instagram_page', 'browser'], post: ['yt-dlp', 'instagram_page', 'browser'], comments: ['yt-dlp'], search: [] },
  facebook: { profile: ['facebook_page', 'browser'], post: ['yt-dlp', 'facebook_page', 'browser'], comments: [], search: [] },
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
};

/**
 * Coverage measured live on 2026-09-12, used until social_backends_status has run
 * in this session. docs/CONTRACTS.md section 1a has the evidence behind each cell.
 */
export const VERIFIED_MATRIX = {
  tiktok: { profile: 'partial', post: 'full', comments: 'full', search: 'partial', outliers: 'partial', ads: 'none' },
  instagram: { profile: 'none', post: 'none', comments: 'none', search: 'none', outliers: 'none' },
  facebook: { profile: 'none', post: 'none', comments: 'none', search: 'none', outliers: 'none' },
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
 * @param {Record<string, any>} post
 * @returns {boolean}
 */
function hasFullMetrics(post) {
  const m = post.metrics ?? {};
  return [m.views, m.likes, m.comments, m.shares].every((value) => typeof value === 'number');
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
    this.ads =
      options.ads ??
      new AdLibraryBackend(standIn ? { ...shared, bases: { meta: standIn, tiktokCreativeCenter: standIn, tiktokLibrary: standIn } } : shared);
    this.browser = options.browser ?? new BrowserBackend({ politeness: this.politeness });
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
    const trip = this.tripped(backend, platform);
    if (trip) {
      attempts.push({ backend, outcome: 'skipped', code: trip.code, reason: `skipped: ${trip.reason}` });
      return null;
    }
    let result;
    try {
      result = await call();
    } catch (error) {
      log.warn('social backend threw', { backend, platform, message: error instanceof Error ? error.message : String(error) });
      result = { ok: false, code: 'blocked', reason: 'The reader stopped unexpectedly.', trip: true };
    }
    if (result.ok) {
      attempts.push({ backend, outcome: 'ok', code: null, reason: null });
      return /** @type {any} */ (result);
    }
    const failure = /** @type {any} */ (result).failure ?? result;
    attempts.push({ backend, outcome: 'failed', code: failure.code, reason: failure.reason });
    this.noteFailure(backend, platform, failure);
    return null;
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
   * @returns {Promise<Record<string, any>>}
   */
  async cached(key, read, reuse = (value) => value) {
    const db = this.db();
    if (db) {
      const hit = readCache(db, { platform: key.platform, kind: key.kind, source_ref: key.target, now: this.now() });
      const adapted = hit ? reuse(hit) : null;
      if (adapted) return this.withSavedEvidence(db, key, adapted);
    }
    const fresh = await read();
    if (typeof fresh.coverage === 'string') this.recordObserved(key.platform, key.kind, fresh.coverage);
    if (db) {
      try {
        writeCache(db, { platform: key.platform, kind: key.kind, source_ref: key.target, envelope: fresh, now: this.now() });
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
    const platform = /** @type {'tiktok'|'instagram'|'facebook'} */ (input.platform);
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
    );
  }

  /**
   * @param {'tiktok'|'instagram'|'facebook'} platform
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
    const plan = () => profilePlan({ platform, handle: target.handle, url: target.url, limit });

    if (platform === 'tiktok') {
      const embed = await this.attempt(attempts, 'tiktok_embed', `${platform}:profile`, () => this.tiktok.profile(target.handle));
      if (embed) {
        profile = embed.profile;
        posts = embed.posts;
      } else if (attempts.at(-1)?.code === 'not_found' || attempts.at(-1)?.code === 'login_required') {
        return this.finish({ platform, records: [], coverage: 'none', attempts, plan });
      }
      const wantMore = posts.length < limit || posts.some((post) => !hasFullMetrics(post));
      if (wantMore) {
        const listing = await this.attempt(attempts, 'yt-dlp', `${platform}:profile`, () => this.ytdlp.listing(target.url, platform, limit));
        if (listing) posts = mergePosts(listing.posts, posts);
      }
    } else {
      for (const backend of ROUTES[platform].profile) {
        if (backend === 'yt-dlp') {
          const listing = await this.attempt(attempts, backend, `${platform}:profile`, () => this.ytdlp.listing(target.url, platform, limit));
          if (listing) {
            posts = listing.posts;
            profile = profile ?? listing.profile;
          }
        } else if (backend === 'browser') {
          // Only worth spawning once the cheaper backends have already been tried and
          // still left the profile facts unread.
          if (!profile) {
            const page = await this.browserAttempt(attempts, `${platform}:profile`, () => this.browser.profile(target, platform));
            if (page) profile = page.profile;
          }
        } else {
          const page = await this.attempt(attempts, backend, `${platform}:profile`, () => this.pages.profile(target, platform));
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
      if (posts.some((post) => !hasFullMetrics(post))) gaps.push('like, comment and share counts on the listed posts (view counts are there)');
      reason = `Read directly, except ${gaps.join(' and ')}.`;
      code = mostTelling(attempts)?.code ?? 'unsupported';
    }
    return this.finish({
      platform,
      records,
      coverage,
      attempts,
      reason,
      code,
      plan,
      extra: { missing_fields: posts.some((post) => !hasFullMetrics(post)) ? ['metrics.likes', 'metrics.comments', 'metrics.shares'] : [] },
    });
  }

  /**
   * @param {{url: string}} input
   * @returns {Promise<Record<string, any>>}
   */
  async post(input) {
    const url = parseHttpUrl(input.url);
    const platform = url ? platformFromUrl(url.href) : null;
    if (!url || !platform) {
      throw new InvalidInputError('That is not a TikTok, Instagram or Facebook post address.', { fix: 'For any other website use web_crawl.' });
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
   * @param {'tiktok'|'instagram'|'facebook'} platform
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
      if (backend === 'yt-dlp') {
        const read = await this.attempt(attempts, backend, `${platform}:post`, () => this.ytdlp.post(url, platform));
        if (read) record = read.record;
      } else if (backend === 'tiktok_embed') {
        const read = await this.attempt(attempts, backend, `${platform}:post`, () => this.tiktok.post(/** @type {string} */ (postId)));
        if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
      } else if (backend === 'browser') {
        const read = await this.browserAttempt(attempts, `${platform}:post`, () => this.browser.post(url, /** @type {'instagram'|'facebook'} */ (platform)));
        if (read) record = record ? mergePosts([record], [read.record])[0] : read.record;
      } else {
        const read = await this.attempt(attempts, backend, `${platform}:post`, () => this.pages.post(url, platform));
        if (read) record = read.record;
      }
      if (record && hasFullMetrics(record) && record.caption !== null) break;
      if (attempts.at(-1)?.code === 'not_found') break;
    }
    const coverage = !record ? 'none' : hasFullMetrics(record) && record.caption !== null ? 'full' : 'partial';
    return this.finish({
      platform,
      records: record ? [record] : [],
      coverage,
      attempts,
      reason: coverage === 'partial' ? 'The post was read, but some of its counts or its caption were not shown.' : null,
      plan: () => postPlan({ platform, url }),
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
    if (!url || !platform) throw new InvalidInputError('That is not a TikTok, Instagram or Facebook post address.');
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
      const read =
        backend === 'tiktok_comments'
          ? await this.attempt(attempts, backend, `${platform}:comments`, () => this.tiktok.comments(/** @type {string} */ (postId), url, limit))
          : await this.attempt(attempts, backend, `${platform}:comments`, () => this.ytdlp.comments(url, platform, limit));
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
    const coverage = records.length === 0 && !complete ? 'none' : complete ? 'full' : 'partial';
    return this.finish({
      platform,
      records,
      coverage,
      attempts,
      reason: coverage === 'partial' ? `Read ${records.length} comments; the platform stopped before ${limit}.` : null,
      code: coverage === 'partial' ? 'rate_limited' : null,
      plan: () => commentsPlan({ platform, url, limit }),
      extra: { total_comments: total },
    });
  }

  /**
   * @param {{platform: string, query: string, limit?: number}} input
   * @returns {Promise<Record<string, any>>}
   */
  async search(input) {
    const platform = /** @type {'tiktok'|'instagram'|'facebook'} */ (input.platform);
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
   * @param {'tiktok'|'instagram'|'facebook'} platform
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Record<string, any>>}
   */
  async readSearch(platform, query, limit) {
    /** @type {Attempt[]} */
    const attempts = [];
    const plan = () => searchPlan({ platform, query, limit });
    const name = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[platform];

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

    if (platform !== 'tiktok') {
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'login_required', reason: `${name} search is only open to signed in visitors, and Social Campaign never signs in.` });
      return this.finish({ platform, records: [], coverage: 'none', attempts, plan, extra: { search_mode: query.startsWith('#') ? 'hashtag' : 'keyword' } });
    }

    if (!query.startsWith('#')) {
      attempts.push({ backend: 'none', outcome: 'skipped', code: 'login_required', reason: 'TikTok keyword search needs a signed in session or a signed request; hashtags and @accounts can be read.' });
      return this.finish({ platform, records: [], coverage: 'none', attempts, plan, extra: { search_mode: 'keyword' } });
    }

    const tag = query.slice(1).replace(/\s+/g, '');
    let records = [];
    const listing = await this.attempt(attempts, 'yt-dlp', `${platform}:search`, () => this.ytdlp.listing(`https://www.tiktok.com/tag/${encodeURIComponent(tag)}`, platform, limit));
    if (listing) records = listing.posts.slice(0, limit);
    let hashtag = null;
    const stats = await this.attempt(attempts, 'tiktok_embed', `${platform}:search`, () => this.tiktok.hashtag(tag));
    if (stats) hashtag = stats.hashtag;
    const coverage = records.length >= Math.min(limit, 1) && records.every(hasFullMetrics) ? 'full' : records.length > 0 || hashtag ? 'partial' : 'none';
    return this.finish({
      platform,
      records,
      coverage,
      attempts,
      reason:
        coverage === 'partial' && records.length === 0
          ? `TikTok shows the totals for #${tag} to signed out readers but not its posts.`
          : coverage === 'partial'
            ? 'Some posts were listed without all of their counts.'
            : null,
      plan,
      extra: { search_mode: 'hashtag', hashtag },
    });
  }

  /**
   * @param {{platform: string, handle_or_url: string, window?: '30d'|'90d'|'180d'|'all'}} input
   * @returns {Promise<Record<string, any>>}
   */
  async outliers(input) {
    const window = input.window ?? '90d';
    const profile = await this.profile({ platform: input.platform, handle_or_url: input.handle_or_url, limit: 50 });
    const posts = profile.records.filter((record) => record.kind === 'post');
    const found = findOutliers(posts, { window, now: this.now() });
    const thinListing = profile.coverage !== 'full';
    let coverage = 'full';
    let code = null;
    let reason = null;
    if (posts.length === 0) {
      coverage = 'none';
      code = profile.degraded_code ?? 'not_found';
      reason = profile.degraded_reason ?? 'No posts could be read for this account.';
    } else if (found.problem) {
      coverage = 'partial';
      code = profile.degraded_code ?? 'not_found';
      reason = found.problem;
    } else if (thinListing) {
      coverage = 'partial';
      code = profile.degraded_code ?? 'unsupported';
      reason = `The baseline comes from the ${posts.length} most recent posts that could be read, not the whole account.`;
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
        baseline: found.baseline,
        posts_considered: posts.length,
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
      const outcome = platform === 'meta' ? await this.ads.meta(query, country) : await this.ads.tiktok(query, country);
      attempts.push({ backend, outcome: outcome.records.length > 0 ? 'ok' : 'failed', code: outcome.records.length > 0 ? null : outcome.code, reason: outcome.reason || null });
      let records = outcome.records;
      let usedBackend = outcome.reached ? 'ad_library_page' : 'none';
      // The library page itself is tried first; the browser backend only runs when
      // that page carried nothing, since it is much slower and heavier to spawn.
      if (records.length === 0) {
        const browserOutcome = await this.browserAttempt(attempts, `${platform}:ads`, () => this.browser.adLibraryPage(outcome.urls.library, platform));
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
        reason: coverage === 'partial' ? 'These are the ads the library page itself carried; the full list is only in the browser.' : outcome.reason,
        code: coverage === 'partial' ? 'unsupported' : outcome.code,
        plan: () => adsPlan({ platform, query, country: /** @type {string} */ (country), eu: EU_LIKE.has(/** @type {string} */ (country)), urls: outcome.urls }),
        extra: { country, country_source: countrySource, library_url: outcome.urls.library },
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
    const first = await webCrawl({ url, scope, max_pages: maxPages }, this.crawlOptions);
    const jsGap = scope === 'page' && first.coverage !== 'full' && (first.degraded_code === 'empty_page' || first.degraded_code === 'blocked');
    if (!jsGap) return first;
    /** @type {Attempt[]} */
    const attempts = [{ backend: 'web_reader', outcome: 'failed', code: first.degraded_code, reason: first.degraded_reason }];
    const page = await this.browserAttempt(attempts, 'web:crawl', () => this.browser.page(url));
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
      extra: { scope, pages_read: 1, skipped: [], rendered: true },
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
    const ytdlp = await this.ytdlp.health();
    /** @type {Array<Record<string, any>>} */
    const backends = [
      { id: 'yt-dlp', present: ytdlp.present, version: ytdlp.version, healthy: ytdlp.status === 'ok', probe: 'live', detail: ytdlp.detail, impersonation: ytdlp.impersonation },
      { id: 'web_reader', present: true, version: `node ${process.versions.node}`, healthy: true, probe: 'static', detail: 'Built in page reader: robots.txt honoured, same site only, 2 MB and 15 second caps.' },
    ];
    /** @type {Record<string, boolean>} */
    const healthy = { web_reader: true };

    if (this.offline) {
      for (const id of ['tiktok_embed', 'tiktok_comments', 'yt-dlp:tiktok', 'instagram_page', 'facebook_page', 'meta_ad_library', 'tiktok_creative_center']) {
        backends.push({ id, present: true, version: null, healthy: null, probe: 'skipped', detail: 'Not probed: offline mode.' });
      }
      const value = { checked_at: checkedAt, offline: true, backends, matrix: structuredClone(VERIFIED_MATRIX), matrix_source: 'verified 2026-09-12' };
      this.statusCache = { at: this.now(), value };
      return value;
    }

    const tiktokProfile = await this.tiktok.profile('tiktok');
    healthy.tiktok_embed = tiktokProfile.ok === true;
    const samplePost = tiktokProfile.ok ? tiktokProfile.posts[0] : null;
    backends.push({
      id: 'tiktok_embed',
      present: true,
      version: null,
      healthy: healthy.tiktok_embed,
      probe: 'live',
      detail: tiktokProfile.ok ? `TikTok's public profile embed answered with ${tiktokProfile.posts.length} posts.` : `TikTok's public embed did not answer: ${tiktokProfile.reason}`,
    });
    if (samplePost) {
      const comments = await this.tiktok.comments(samplePost.post_id, samplePost.url, 1);
      healthy.tiktok_comments = comments.ok === true;
      backends.push({ id: 'tiktok_comments', present: true, version: null, healthy: healthy.tiktok_comments, probe: 'live', detail: comments.ok ? 'TikTok public comments answered.' : `TikTok public comments did not answer: ${comments.reason}` });
    } else {
      healthy.tiktok_comments = false;
      backends.push({ id: 'tiktok_comments', present: true, version: null, healthy: false, probe: 'skipped', detail: 'Not probed: no sample post.' });
    }
    if (ytdlp.status === 'ok' && samplePost) {
      const read = await this.ytdlp.post(samplePost.url, 'tiktok');
      healthy['yt-dlp:tiktok'] = read.ok;
      if (!read.ok) this.noteFailure('yt-dlp', 'tiktok:post', read.failure);
      backends.push({ id: 'yt-dlp:tiktok', present: true, version: ytdlp.version, healthy: read.ok, probe: 'live', detail: read.ok ? 'yt-dlp read a public TikTok post.' : read.failure.reason });
    } else {
      healthy['yt-dlp:tiktok'] = false;
      backends.push({ id: 'yt-dlp:tiktok', present: ytdlp.present, version: ytdlp.version, healthy: false, probe: 'skipped', detail: ytdlp.present ? 'Not probed: no sample post.' : 'yt-dlp is not installed.' });
    }
    for (const [id, platform, url] of /** @type {const} */ ([
      ['instagram_page', 'instagram', 'https://www.instagram.com/instagram/'],
      ['facebook_page', 'facebook', 'https://www.facebook.com/facebook'],
    ])) {
      const page = await this.pages.read(url, platform);
      healthy[id] = page.ok;
      backends.push({ id, present: true, version: null, healthy: page.ok, probe: 'live', detail: page.ok ? 'Signed out pages carry readable tags.' : page.reason });
    }
    const meta = await this.ads.meta('Meta', 'US');
    healthy.meta_ad_library = meta.records.length > 0;
    backends.push({ id: 'meta_ad_library', present: true, version: null, healthy: healthy.meta_ad_library, probe: 'live', detail: meta.reason || 'Ads were readable.' });
    const creative = await this.ads.tiktok('skincare', 'US');
    healthy.tiktok_creative_center = creative.records.length > 0;
    backends.push({ id: 'tiktok_creative_center', present: true, version: null, healthy: healthy.tiktok_creative_center, probe: 'live', detail: creative.reason || 'Ads were readable.' });

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
  const tiktokProfile = embed && ytdlp ? 'full' : embed || ytdlp ? 'partial' : 'none';
  const page = (id) => (healthy[id] ? 'partial' : 'none');
  const matrix = {
    tiktok: {
      profile: tiktokProfile,
      post: embed || ytdlp ? 'full' : 'none',
      comments: healthy.tiktok_comments ? 'full' : 'none',
      search: ytdlp ? 'full' : embed ? 'partial' : 'none',
      outliers: tiktokProfile,
      ads: healthy.tiktok_creative_center ? 'partial' : 'none',
    },
    instagram: { profile: page('instagram_page'), post: page('instagram_page'), comments: 'none', search: 'none', outliers: 'none' },
    facebook: { profile: page('facebook_page'), post: page('facebook_page'), comments: 'none', search: 'none', outliers: 'none' },
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
