/**
 * Instagram, read without a login through the Scrapling page op (python/social_stealth.py, op "page").
 *
 * Checked live on 2026-10-13, logged out, with Chrome's TLS fingerprint (curl_cffi): profile pages, post and reel
 * pages and /popular/<topic>/ pages all answer 200 with the page data embedded as JSON. Node's own fetch is refused
 * and yt-dlp's Instagram user extractor is broken, so this is the one working route. The worker returns, per page,
 * the readable text, the links, the page's <meta> tags and an `instagram` object with the facts the page embeds:
 *
 *   profile     the account (exact followers, following, bio) and its first dozen posts: code, caption, date.
 *   post/reel   the post: caption, exact like and comment counts, date, video address, sound.
 *   /popular/   reels on a topic: owner, caption, play count, video address.
 *
 * Instagram shows no view count on a post page to a signed out visitor, so a post read carries likes and comments
 * but views stay null. Nothing here logs in, sends a cookie, or retries.
 *
 * The parsers fall back to the page's meta description and text when the embedded JSON is missing, so a layout
 * change that removes the JSON lowers coverage instead of failing the read.
 */

import { commentRecord, envelopeCode, parseHumanCount, postRecord, profileRecord } from '../records.mjs';
import { parseInstagramPostDescription, parseInstagramProfileDescription } from './public_page.mjs';

/** Longest one Instagram page read may take (the worker's own limit is 3 s shorter). */
export const INSTAGRAM_PAGE_TIMEOUT_MS = 30_000;

/** The host politeness is applied to. */
export const INSTAGRAM_HOST = 'www.instagram.com';

/** Instagram is asked no more often than this, whatever the router's general gap is (it is 0 only when politeness is off). */
export const INSTAGRAM_MIN_GAP_MS = 2_500;

/**
 * @typedef {{ok: false, code: string, reason: string, trip: boolean}} ReadFailure
 */

/**
 * The shortcode of a post or reel address, or null.
 * @param {string} value
 * @returns {string|null}
 */
export function instagramPostCode(value) {
  try {
    const url = new URL(value);
    return url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The canonical address of a post.
 * @param {string} code
 * @param {string|null|undefined} kind reel, video, image or carousel.
 * @returns {string}
 */
export function instagramPostUrl(code, kind) {
  return `https://www.instagram.com/${kind === 'reel' || kind === 'video' ? 'reel' : 'p'}/${code}/`;
}

/**
 * What Instagram topic page a search query can be read from. Instagram's /popular/<topic>/ pages are single hashtags:
 * "kayatoast" has one, "kaya toast singapore" does not, and building a slug out of a longer phrase sends the reader to a
 * page that does not exist, which Instagram answers with its sign-in wall (live 2026-10-14).
 *
 * One word is its own hashtag. Two words are read as the one hashtag people write them as (#kayatoast). Three words or
 * more have no best single hashtag, so the query is refused plainly, with hashtags to try instead.
 * @param {string} query a topic, a #hashtag or a phrase.
 * @returns {{ok: true, slug: string, joined: boolean, note: string|null}|{ok: false, reason: string, suggestions: string[]}}
 */
export function instagramTopic(query) {
  const text = String(query ?? '').trim();
  const words = text
    .replace(/^#+/, '')
    .split(/[\s,;|/+&]+/u)
    .map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return { ok: false, reason: 'Say a topic or #hashtag made of letters and digits.', suggestions: [] };
  if (words.length === 1) return { ok: true, slug: words[0], joined: false, note: null };
  if (words.length === 2) {
    const slug = words.join('');
    return { ok: true, slug, joined: true, note: `Instagram topic pages are single hashtags, so "${text}" was read as #${slug}.` };
  }
  const suggestions = [...new Set([words.slice(0, 2).join(''), words.slice(-2).join(''), words[0]])].map((tag) => `#${tag}`);
  return {
    ok: false,
    reason: `Instagram topic pages are single hashtags, and "${text}" is ${words.length} words with no single hashtag to read it as. Search one hashtag at a time, for example ${suggestions.join(', ')}.`,
    suggestions,
  };
}

/**
 * @param {Record<string, any>} media one embedded media node from the worker.
 * @param {string} observedAt
 * @param {string} sourceRef
 * @param {{authorFallback?: string|null, kind?: string|null}} [fallback]
 * @returns {Record<string, any>}
 */
function postFromMedia(media, observedAt, sourceRef, fallback = {}) {
  const kind = media.kind ?? fallback.kind ?? null;
  const mediaKind = kind === 'reel' || kind === 'video' ? 'video' : kind === 'carousel' ? 'carousel' : kind === 'image' ? 'image' : 'unknown';
  const record = postRecord({
    platform: 'instagram',
    url: instagramPostUrl(media.code, kind),
    post_id: media.code,
    author_handle: media.owner ?? fallback.authorFallback ?? null,
    posted_at: media.takenAt ?? media.date ?? null,
    media_kind: mediaKind,
    caption: typeof media.caption === 'string' ? media.caption : null,
    duration_s: typeof media.durationS === 'number' ? media.durationS : null,
    sound: media.sound ?? null,
    metrics: { views: media.views, likes: media.likes, comments: media.comments },
    source_ref: sourceRef,
    observed_at: observedAt,
    confidence: 0.85,
  });
  if (typeof media.videoUrl === 'string' && media.videoUrl) record.video_url = media.videoUrl;
  return record;
}

/**
 * A count written before a label in page text: "5.3M\nfollowers".
 * @param {string} text
 * @param {string} label
 * @returns {number|null}
 */
function countBefore(text, label) {
  const match = String(text ?? '').match(new RegExp(`(\\d[\\d.,]*\\s*[KkMmBb]?)\\s*\\n?\\s*${label}\\b`, 'i'));
  return match ? parseHumanCount(match[1]) : null;
}

/**
 * Profile and recent posts from a profile page the worker read.
 * @param {Record<string, any>} page the worker's page result.
 * @param {{handle: string, url: string}} target
 * @param {string} observedAt
 * @returns {{profile: Record<string, any>, posts: Array<Record<string, any>>}|null} null when the page held neither.
 */
export function profileFromPage(page, target, observedAt) {
  const facts = page.instagram && typeof page.instagram === 'object' ? page.instagram : { user: null, media: [] };
  const meta = page.meta && typeof page.meta === 'object' ? page.meta : {};
  const user = facts.user ?? null;
  const description = String(meta['og:description'] ?? meta.description ?? '');
  const counts = parseInstagramProfileDescription(description);
  const text = String(page.text ?? '');
  const followers = user?.followers ?? countBefore(text, 'followers') ?? counts.followers;
  const following = user?.following ?? countBefore(text, 'following') ?? counts.following;
  const postCount = user?.posts ?? counts.posts;
  const title = String(meta['og:title'] ?? page.title ?? '');
  const sourceRef = page.finalUrl || target.url;
  const posts = (Array.isArray(facts.media) ? facts.media : [])
    .filter((media) => media && typeof media.code === 'string')
    .map((media) => postFromMedia(media, observedAt, sourceRef, { authorFallback: target.handle }));
  if (posts.length === 0) {
    // No embedded data: the post links on the page are still real posts, with an address and nothing else.
    const seen = new Set();
    for (const link of Array.isArray(page.links) ? page.links : []) {
      const code = instagramPostCode(String(link));
      if (!code || seen.has(code) || !String(link).includes(`/${target.handle}/`)) continue;
      seen.add(code);
      posts.push(postFromMedia({ code, kind: /\/reel\//.test(String(link)) ? 'reel' : 'image' }, observedAt, sourceRef, { authorFallback: target.handle }));
    }
  }
  if (followers === null && following === null && postCount === null && !user && posts.length === 0) return null;
  const profile = profileRecord({
    platform: 'instagram',
    url: target.url,
    handle: target.handle,
    display_name: user?.fullName ?? (title ? title.replace(/\s*\(@[^)]*\).*$/, '').replace(/\s*[|-]\s*Instagram.*$/i, '').trim() || null : null),
    bio: user?.biography ?? null,
    followers,
    following,
    post_count: postCount,
    verified: typeof user?.verified === 'boolean' ? user.verified : /(^|\n)Verified(\n|$)/.test(text) ? true : null,
    avatar_url: user?.profilePicUrl ?? meta['og:image'] ?? null,
    source_ref: sourceRef,
    observed_at: observedAt,
    confidence: 0.85,
  });
  return { profile, posts };
}

/**
 * One post from a post or reel page the worker read.
 * @param {Record<string, any>} page
 * @param {string} url the address that was read.
 * @param {string} observedAt
 * @returns {Record<string, any>|null}
 */
export function postFromPage(page, url, observedAt) {
  const code = instagramPostCode(url);
  const facts = page.instagram && typeof page.instagram === 'object' ? page.instagram : { user: null, media: [] };
  const media = (Array.isArray(facts.media) ? facts.media : []).find((entry) => entry?.code === code) ?? null;
  const meta = page.meta && typeof page.meta === 'object' ? page.meta : {};
  const parsed = parseInstagramPostDescription(String(meta['og:description'] ?? meta.description ?? ''));
  if (!media && parsed.likes === null && parsed.comments === null && parsed.caption === null) return null;
  const kind = media?.kind ?? (/\/reels?\//.test(url) ? 'reel' : null);
  const record = postFromMedia(
    {
      code: code ?? media?.code ?? '',
      kind,
      owner: media?.owner ?? parsed.author,
      caption: media?.caption ?? parsed.caption,
      takenAt: media?.takenAt ?? null,
      date: media?.date ?? parsed.date,
      durationS: media?.durationS ?? null,
      sound: media?.sound ?? null,
      views: media?.views ?? null,
      likes: media?.likes ?? parsed.likes,
      comments: media?.comments ?? parsed.comments,
      videoUrl: media?.videoUrl ?? null,
    },
    observedAt,
    page.finalUrl || url,
  );
  // The address that was asked for stays the record's address (owner-prefixed addresses and short ones both resolve).
  record.url = url.replace(/[?#].*$/, '');
  record.thumbnail_url = typeof meta['og:image'] === 'string' && meta['og:image'] ? meta['og:image'] : typeof meta['twitter:image'] === 'string' ? meta['twitter:image'] : null;
  return record;
}

/**
 * The first comments of a post, from the comments its page embeds for a signed out visitor (newest first, around a
 * dozen, photo posts and carousels included), plus the post's comment total.
 * @param {Record<string, any>} page the worker's page result.
 * @param {string} url the address that was read.
 * @param {string} observedAt
 * @returns {{records: Array<Record<string, any>>, total: number|null}}
 */
export function commentsFromPage(page, url, observedAt) {
  const facts = page.instagram && typeof page.instagram === 'object' ? page.instagram : { media: [] };
  const code = instagramPostCode(url);
  const media = (Array.isArray(facts.media) ? facts.media : []).find((entry) => entry?.code === code) ?? null;
  const sourceRef = page.finalUrl || url;
  const postUrl = url.replace(/[?#].*$/, '');
  const records = (Array.isArray(facts.comments) ? facts.comments : [])
    .filter((comment) => comment && typeof comment.text === 'string')
    .map((comment) =>
      commentRecord({
        platform: 'instagram',
        post_url: postUrl,
        url: postUrl,
        comment_id: comment.id || null,
        author_handle: comment.username ?? null,
        text: comment.text,
        likes: comment.likes,
        replies: comment.replies,
        posted_at: comment.createdAt,
        source_ref: sourceRef,
        observed_at: observedAt,
        confidence: 0.85,
      }),
    );
  return { records, total: typeof media?.comments === 'number' ? media.comments : null };
}

/**
 * Reels from a /popular/<topic>/ page the worker read.
 * @param {Record<string, any>} page
 * @param {string} topic
 * @param {string} observedAt
 * @returns {{posts: Array<Record<string, any>>, topic: {tag: string, title: string|null, reels_text: string|null}}}
 */
export function topicFromPage(page, topic, observedAt) {
  const facts = page.instagram && typeof page.instagram === 'object' ? page.instagram : { user: null, media: [] };
  const meta = page.meta && typeof page.meta === 'object' ? page.meta : {};
  const title = typeof meta['og:title'] === 'string' ? meta['og:title'] : null;
  const sourceRef = page.finalUrl || `https://www.instagram.com/popular/${topic}/`;
  const posts = (Array.isArray(facts.media) ? facts.media : [])
    .filter((media) => media && typeof media.code === 'string')
    .map((media) => postFromMedia(media, observedAt, sourceRef, { kind: 'reel' }));
  return { posts, topic: { tag: topic, title, reels_text: title?.match(/•\s*([\d.,]+\s*[KkMmBb]?)\s+reels/i)?.[1] ?? null } };
}

/**
 * Read one Instagram address through the stealth reader's page op.
 * @param {{page: Function}} stealth a StealthBackend (or a fake with the same page method).
 * @param {string} url
 * @param {{timeoutMs?: number, politeness?: {wait: (host: string) => Promise<void>}|null}} [options]
 * @returns {Promise<{ok: true, page: Record<string, any>, observed_at: string}|ReadFailure>}
 */
export async function readInstagramPage(stealth, url, options = {}) {
  if (options.politeness) {
    try {
      const gap = options.politeness.gapMs > 0 ? Math.max(options.politeness.gapMs, INSTAGRAM_MIN_GAP_MS) : 0;
      await options.politeness.wait(INSTAGRAM_HOST, gap);
    } catch {
      // A broken politeness helper never blocks a read.
    }
  }
  const out = await stealth.page(url, { timeoutMs: Math.min(options.timeoutMs ?? INSTAGRAM_PAGE_TIMEOUT_MS, INSTAGRAM_PAGE_TIMEOUT_MS) });
  if (!out || out.ok !== true) {
    const failure = /** @type {any} */ (out ?? {});
    return { ok: false, code: envelopeCode(failure.code), reason: failure.reason ?? 'The stealth reader failed.', trip: Boolean(failure.trip) };
  }
  return { ok: true, page: out, observed_at: new Date().toISOString() };
}

