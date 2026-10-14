/**
 * Facebook profiles and posts, read from a page the stealth reader (Scrapling) rendered in a real browser.
 *
 * This is what the Crawl4AI browser worker used to do for Facebook. Facebook shows a signed out visitor very little, so
 * the facts come from what the page itself publishes: its JSON-LD blocks, its Open Graph tags and its visible text. A
 * count the page did not show stays null, never zero. Each function takes the stealth reader's `page` answer (`ok: true`
 * with `finalUrl`, `title`, `text`, `meta` and `json_ld`) and returns the router's record shape, or a failure.
 *
 * Nothing here starts a process; the router calls `stealth.page(url, { render: true, extract: 'json_ld' })` and passes
 * the answer in.
 */

import { parseHumanCount, postRecord, profileRecord, toIso } from '../records.mjs';

/**
 * The number written next to a label in the visible text, such as "1.2K Followers".
 * @param {unknown} text
 * @param {string} label
 * @returns {number|null}
 */
export function countNear(text, label) {
  const match = String(text ?? '').match(new RegExp(`([\\d.,]+\\s*[KkMmBb]?)\\s+${label}`, 'i'));
  return match ? parseHumanCount(match[1]) : null;
}

/**
 * @param {Array<Record<string, any>>|undefined} blocks
 * @param {string[]} types
 * @returns {Record<string, any>|null}
 */
export function firstOfType(blocks, types) {
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    const candidates = Array.isArray(block) ? block : block?.['@graph'] ? block['@graph'] : [block];
    for (const candidate of candidates) {
      if (candidate && types.includes(candidate['@type'])) return candidate;
    }
  }
  return null;
}

/** @param {Record<string, any>|undefined} meta @param {string} key */
function metaValue(meta, key) {
  const value = meta && typeof meta === 'object' ? meta[key] : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {Record<string, any>} page the stealth reader's page answer.
 * @param {{handle: string, url: string}} target
 * @param {'instagram'|'facebook'} platform
 * @param {string} observedAt
 * @returns {{ok: true, profile: Record<string, any>}|{ok: false, code: string, reason: string, trip: boolean}}
 */
export function profileFromRenderedPage(page, target, platform, observedAt = new Date().toISOString()) {
  const ld = firstOfType(page.json_ld, ['ProfilePage', 'Person', 'Organization']);
  const text = page.text ?? '';
  const followers = countNear(text, 'Followers') ?? (typeof ld?.interactionStatistic === 'object' ? parseHumanCount(String(ld.interactionStatistic.userInteractionCount ?? '')) : null);
  const name = ld?.name ?? metaValue(page.meta, 'og:title') ?? page.title ?? null;
  const bio = ld?.description ?? metaValue(page.meta, 'og:description') ?? null;
  if (!name && !bio && followers === null) {
    return { ok: false, code: 'empty_page', reason: 'The rendered page held no account facts.', trip: false };
  }
  return {
    ok: true,
    profile: profileRecord({
      platform,
      url: target.url,
      handle: target.handle,
      display_name: name,
      bio,
      followers,
      following: countNear(text, 'Following'),
      post_count: countNear(text, 'Posts'),
      source_ref: page.finalUrl ?? target.url,
      observed_at: observedAt,
      source_type: 'web_evidence',
      confidence: 0.75,
    }),
  };
}

/**
 * @param {Record<string, any>} page the stealth reader's page answer.
 * @param {string} url
 * @param {'instagram'|'facebook'} platform
 * @param {string} observedAt
 * @returns {{ok: true, record: Record<string, any>}|{ok: false, code: string, reason: string, trip: boolean}}
 */
export function postFromRenderedPage(page, url, platform, observedAt = new Date().toISOString()) {
  const ld = firstOfType(page.json_ld, ['VideoObject', 'ImageObject', 'SocialMediaPosting']);
  const text = page.text ?? '';
  const caption = ld?.description ?? ld?.caption ?? metaValue(page.meta, 'og:description') ?? null;
  const likes = countNear(text, 'likes');
  const comments = countNear(text, 'comments');
  if (!caption && likes === null && comments === null && !ld) {
    return { ok: false, code: 'empty_page', reason: 'The rendered page held no post facts.', trip: false };
  }
  const isVideo = Boolean(ld?.['@type'] === 'VideoObject' || /video|reel/i.test(String(page.title ?? '')) || metaValue(page.meta, 'og:type')?.startsWith('video'));
  return {
    ok: true,
    record: postRecord({
      platform,
      url,
      post_id: url.match(/\/(?:p|reel|reels|tv|videos|posts)\/([^/?#]+)/)?.[1] ?? null,
      caption,
      posted_at: toIso(ld?.uploadDate ?? ld?.datePublished ?? null),
      media_kind: isVideo ? 'video' : 'image',
      metrics: { likes, comments },
      thumbnail_url: typeof ld?.thumbnailUrl === 'string' ? ld.thumbnailUrl : metaValue(page.meta, 'og:image'),
      source_ref: page.finalUrl ?? url,
      observed_at: observedAt,
      source_type: 'web_evidence',
      confidence: 0.75,
    }),
  };
}
