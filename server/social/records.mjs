/**
 * Social research records and the envelope every research tool returns.
 *
 * One place owns the record shapes from docs/CONTRACTS.md section 1a, so every
 * backend produces the same fields, a count the platform did not show is null and
 * never zero, and every record carries the four provenance fields.
 */

import { nowIso } from '../lib/ids.mjs';

/** The social platforms in scope. */
export const SOCIAL_PLATFORMS = ['tiktok', 'instagram', 'facebook'];

/** Coverage values, best first. */
export const COVERAGE_ORDER = ['full', 'partial', 'none'];

/**
 * Why coverage is reduced. The first six are the contract's; `blocked` means the
 * platform answered an automated reader with a bot challenge or an unreadable page,
 * and `timed_out` means it did not answer in time.
 */
export const DEGRADED_CODES = [
  'login_required',
  'region_restricted',
  'rate_limited',
  'backend_missing',
  'not_found',
  'unsupported',
  'blocked',
  'timed_out',
  'empty_page',
];

/** Host names that belong to each platform. */
const PLATFORM_HOSTS = {
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'fb.watch'],
};

/**
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
function hostIs(hostname, domain) {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Parse an http(s) address, or return null.
 * @param {unknown} value
 * @returns {URL|null}
 */
export function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Which social platform an address belongs to, or null.
 * @param {string} value
 * @returns {'tiktok'|'instagram'|'facebook'|null}
 */
export function platformFromUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return null;
  for (const [platform, domains] of Object.entries(PLATFORM_HOSTS)) {
    if (domains.some((domain) => hostIs(url.hostname, domain))) return /** @type {any} */ (platform);
  }
  return null;
}

/**
 * @param {string} value
 * @param {string} platform
 * @returns {boolean}
 */
export function urlBelongsTo(value, platform) {
  return platformFromUrl(value) === platform;
}

/**
 * Turn a handle or a profile address into a clean handle and the canonical profile address.
 * @param {'tiktok'|'instagram'|'facebook'} platform
 * @param {string} handleOrUrl
 * @returns {{handle: string, url: string}|null}
 */
export function parseHandle(platform, handleOrUrl) {
  const raw = String(handleOrUrl ?? '').trim();
  if (raw.length === 0) return null;
  let handle = raw;
  const url = parseHttpUrl(raw);
  if (url) {
    if (platformFromUrl(raw) !== platform) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (platform === 'tiktok') {
      const at = segments.find((segment) => segment.startsWith('@'));
      if (!at) return null;
      handle = at;
    } else if (platform === 'facebook' && segments[0] === 'profile.php') {
      const id = url.searchParams.get('id');
      if (!id) return null;
      return { handle: id, url: `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` };
    } else {
      if (segments.length === 0) return null;
      handle = segments[0];
    }
  }
  handle = decodeURIComponent(handle).replace(/^@+/, '').trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) return null;
  const canonical = {
    tiktok: `https://www.tiktok.com/@${handle}`,
    instagram: `https://www.instagram.com/${handle}/`,
    facebook: `https://www.facebook.com/${handle}`,
  }[platform];
  return { handle, url: canonical };
}

/**
 * The numeric id of a TikTok video or photo post from its address.
 * @param {string} value
 * @returns {string|null}
 */
export function tiktokPostId(value) {
  const url = parseHttpUrl(value);
  if (!url || !urlBelongsTo(value, 'tiktok')) return null;
  const match = url.pathname.match(/\/(?:video|photo|v|embed(?:\/v2)?)\/(\d{8,25})/);
  return match ? match[1] : null;
}

/**
 * TikTok ids carry their creation time in the top 32 bits, which is how a listing
 * that shows no date still gets one. The value is derived, not guessed, and on
 * 2026-09-12 it was within a minute of the create time TikTok itself reported.
 * @param {string|null|undefined} id
 * @returns {string|null} ISO 8601 in UTC.
 */
export function tiktokTimeFromId(id) {
  if (typeof id !== 'string' || !/^\d{15,25}$/.test(id)) return null;
  const seconds = Number(BigInt(id) >> 32n);
  if (!Number.isFinite(seconds) || seconds < 1_400_000_000 || seconds > 4_000_000_000) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * A count as a non negative integer, or null when the platform did not show one.
 * @param {unknown} value
 * @returns {number|null}
 */
export function toCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

/**
 * A human count such as 1.2M or 3,400, or null.
 * @param {string} text
 * @returns {number|null}
 */
export function parseHumanCount(text) {
  const match = String(text ?? '').trim().match(/^([\d.,]+)\s*([KkMmBb])?$/);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[String(match[2] ?? '').toLowerCase()] ?? 1;
  return Math.round(base * scale);
}

/**
 * Unix seconds, or an ISO string, as ISO 8601 in UTC; null otherwise.
 * @param {unknown} value
 * @returns {string|null}
 */
export function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date((seconds > 1e12 ? seconds : seconds * 1000)).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Hashtags in a caption, lower case, without the #, in order of first use.
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
export function extractHashtags(text) {
  const found = [];
  for (const match of String(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = match[1].toLowerCase();
    if (!found.includes(tag)) found.push(tag);
  }
  return found;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * @typedef {object} Provenance
 * @property {'official_source'|'public_platform'|'ad_library'|'web_evidence'|'user_supplied'|'local_media'} source_type
 * @property {string} source_ref
 * @property {string} observed_at
 * @property {number} confidence
 */

/**
 * @param {Partial<Provenance>} input
 * @param {string} fallbackRef
 * @returns {Provenance}
 */
function provenance(input, fallbackRef) {
  return {
    source_type: input.source_type ?? 'public_platform',
    source_ref: input.source_ref ?? fallbackRef,
    observed_at: input.observed_at ?? nowIso(),
    confidence: typeof input.confidence === 'number' ? input.confidence : 0.9,
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function profileRecord(input) {
  return {
    kind: 'profile',
    platform: input.platform,
    url: input.url,
    handle: text(input.handle),
    display_name: text(input.display_name),
    bio: typeof input.bio === 'string' ? input.bio : null,
    followers: toCount(input.followers),
    following: toCount(input.following),
    post_count: toCount(input.post_count),
    likes_total: toCount(input.likes_total),
    verified: typeof input.verified === 'boolean' ? input.verified : null,
    links: Array.isArray(input.links) ? input.links.filter((link) => typeof link === 'string') : [],
    ...provenance(input, input.url),
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function postRecord(input) {
  const caption = typeof input.caption === 'string' ? input.caption : null;
  const metrics = input.metrics ?? {};
  return {
    kind: 'post',
    platform: input.platform,
    url: input.url,
    post_id: text(input.post_id),
    author_handle: text(input.author_handle),
    posted_at: toIso(input.posted_at),
    media_kind: ['video', 'image', 'carousel', 'text'].includes(input.media_kind) ? input.media_kind : 'unknown',
    caption,
    hashtags: Array.isArray(input.hashtags) && input.hashtags.length > 0 ? input.hashtags : extractHashtags(caption),
    duration_s: typeof input.duration_s === 'number' && input.duration_s >= 0 ? input.duration_s : null,
    sound: text(input.sound),
    metrics: {
      views: toCount(metrics.views),
      likes: toCount(metrics.likes),
      comments: toCount(metrics.comments),
      shares: toCount(metrics.shares),
      saves: toCount(metrics.saves),
    },
    thumbnail_url: text(input.thumbnail_url),
    ...provenance(input, input.url),
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function commentRecord(input) {
  return {
    kind: 'comment',
    platform: input.platform,
    url: input.url ?? input.post_url,
    post_url: input.post_url,
    comment_id: text(input.comment_id),
    author_handle: text(input.author_handle),
    text: typeof input.text === 'string' ? input.text : '',
    likes: toCount(input.likes),
    replies: toCount(input.replies),
    posted_at: toIso(input.posted_at),
    ...provenance(input, input.post_url),
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function adRecord(input) {
  return {
    kind: 'ad',
    platform: input.platform,
    url: input.url ?? input.library_url,
    advertiser: text(input.advertiser),
    ad_id: text(input.ad_id),
    library_url: text(input.library_url),
    started_at: toIso(input.started_at),
    last_seen_at: toIso(input.last_seen_at),
    active: typeof input.active === 'boolean' ? input.active : null,
    countries: Array.isArray(input.countries) ? input.countries : [],
    placements: Array.isArray(input.placements) ? input.placements : [],
    format: text(input.format),
    primary_text: text(input.primary_text),
    headline: text(input.headline),
    cta: text(input.cta),
    landing_url: text(input.landing_url),
    media_urls: Array.isArray(input.media_urls) ? input.media_urls : [],
    metrics: input.metrics && typeof input.metrics === 'object' ? input.metrics : undefined,
    ...provenance({ source_type: 'ad_library', ...input }, input.library_url ?? input.url),
  };
}

/** Longest page text a record carries, from the contract. */
export const PAGE_TEXT_LIMIT = 20_000;

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function pageRecord(input) {
  return {
    kind: 'page',
    platform: 'web',
    url: input.url,
    title: text(input.title),
    text: String(input.text ?? '').slice(0, PAGE_TEXT_LIMIT),
    links: Array.isArray(input.links) ? input.links : [],
    ...provenance({ source_type: 'web_evidence', confidence: 0.85, ...input }, input.url),
  };
}

/**
 * The worse of two coverage values.
 * @param {...string} values
 * @returns {'full'|'partial'|'none'}
 */
export function worstCoverage(...values) {
  let worst = 0;
  for (const value of values) worst = Math.max(worst, Math.max(0, COVERAGE_ORDER.indexOf(value)));
  return /** @type {any} */ (COVERAGE_ORDER[worst]);
}

/**
 * The better of two coverage values.
 * @param {...string} values
 * @returns {'full'|'partial'|'none'}
 */
export function bestCoverage(...values) {
  let best = 2;
  for (const value of values) {
    const index = COVERAGE_ORDER.indexOf(value);
    if (index >= 0) best = Math.min(best, index);
  }
  return /** @type {any} */ (COVERAGE_ORDER[best]);
}

/**
 * Build the research envelope.
 * @param {object} input
 * @param {string} input.platform
 * @param {'yt-dlp'|'public_page'|'ad_library_page'|'none'} input.backend
 * @param {'full'|'partial'|'none'} input.coverage
 * @param {string|null} [input.degraded_code]
 * @param {string|null} [input.degraded_reason]
 * @param {Array<Record<string, any>>} [input.records]
 * @param {Record<string, any>|null} [input.web_evidence_plan]
 * @param {string} [input.observed_at]
 * @param {Record<string, any>} [input.extra]
 * @returns {Record<string, any>}
 */
export function envelope(input) {
  const coverage = input.coverage;
  const degradedCode = coverage === 'full' ? null : input.degraded_code ?? null;
  if (degradedCode !== null && !DEGRADED_CODES.includes(degradedCode)) {
    throw new Error(`Unknown degraded code ${degradedCode}`);
  }
  return {
    ok: true,
    platform: input.platform,
    backend: input.backend,
    coverage,
    degraded_code: degradedCode,
    degraded_reason: coverage === 'full' ? null : input.degraded_reason ?? null,
    observed_at: input.observed_at ?? nowIso(),
    records: input.records ?? [],
    web_evidence_plan: coverage === 'full' ? null : input.web_evidence_plan ?? null,
    ...(input.extra ?? {}),
  };
}
