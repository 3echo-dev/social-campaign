/**
 * Signed out Instagram and Facebook pages.
 *
 * Checked live on 2026-09-12: Instagram served the same logged out application
 * shell for profiles, posts, reels and their embed pages, with no caption, count
 * or Open Graph tag in it; Facebook answered 400 for page addresses and an empty
 * shell for video addresses. So this reader mostly proves, quickly and politely,
 * that there is nothing to read, and says why.
 *
 * It still reads Open Graph tags when a page carries them, because both platforms
 * have served them to signed out visitors before, in the forms parsed below, and
 * a page that starts showing them again should not need a code change.
 */

import { boundedFetch, extractMeta, extractTitle, FetchFailure, statusFailure } from './web.mjs';
import { parseHumanCount, postRecord, profileRecord } from '../records.mjs';

/**
 * @typedef {{ok: false, code: string, reason: string, trip: boolean}} PageFailure
 */

/**
 * @param {string} html
 * @param {'instagram'|'facebook'} platform
 * @returns {boolean}
 */
export function looksLoggedOut(html, platform) {
  if (platform === 'instagram') {
    return /PolarisLoggedOut|loginForm|"is_logged_in":false/.test(html) || /<title>\s*Instagram\s*<\/title>/i.test(html);
  }
  return /login_form|Log in or sign up|Log into Facebook|id="login_popup_cta_form"/i.test(html) || /<title>\s*(Facebook|Video|Error)\s*<\/title>/i.test(html);
}

/**
 * Counts from an Instagram profile description such as
 * "298M Followers, 150 Following, 1,540 Posts - See Instagram photos and videos from Nike (@nike)".
 * @param {string} description
 * @returns {{followers: number|null, following: number|null, posts: number|null}}
 */
export function parseInstagramProfileDescription(description) {
  const read = (label) => {
    const match = description.match(new RegExp(`([\\d.,]+\\s*[KkMmBb]?)\\s+${label}`));
    return match ? parseHumanCount(match[1]) : null;
  };
  return { followers: read('Followers'), following: read('Following'), posts: read('Posts') };
}

/**
 * Counts and caption from an Instagram post description such as
 * '1,234 likes, 56 comments - nike on September 1, 2026: "Caption text"'.
 * @param {string} description
 * @returns {{likes: number|null, comments: number|null, author: string|null, date: string|null, caption: string|null}}
 */
export function parseInstagramPostDescription(description) {
  const likes = description.match(/([\d.,]+\s*[KkMm]?)\s+likes?/);
  const comments = description.match(/([\d.,]+\s*[KkMm]?)\s+comments?/);
  const byline = description.match(/-\s*([A-Za-z0-9._]+)\s+on\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s*:\s*"?([\s\S]*?)"?\s*$/);
  return {
    likes: likes ? parseHumanCount(likes[1]) : null,
    comments: comments ? parseHumanCount(comments[1]) : null,
    author: byline ? byline[1] : null,
    date: byline && Number.isFinite(Date.parse(`${byline[2]} UTC`)) ? new Date(Date.parse(`${byline[2]} UTC`)).toISOString() : null,
    caption: byline ? byline[3] : null,
  };
}

/**
 * The signed out page reader for Instagram and Facebook.
 */
export class PublicPageBackend {
  /**
   * @param {{allowPrivate?: boolean, timeoutMs?: number, politeness?: import('./web.mjs').Politeness}} [options]
   */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * @param {string} url
   * @param {'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, meta: Record<string, string>, title: string|null, fetched_at: string, final_url: string}|PageFailure>}
   */
  async read(url, platform) {
    const name = platform === 'instagram' ? 'Instagram' : 'Facebook';
    let result;
    try {
      if (this.options.politeness) await this.options.politeness.wait(new URL(url).host);
      result = await boundedFetch(url, { allowPrivate: this.options.allowPrivate, timeoutMs: this.options.timeoutMs ?? 20_000 });
    } catch (error) {
      const failure = error instanceof FetchFailure ? error : new FetchFailure(String(error), 'network');
      return { ok: false, code: failure.code === 'timed_out' ? 'timed_out' : 'blocked', reason: `${name} could not be reached: ${failure.message}`, trip: true };
    }
    if (!result.ok) {
      const mapped = statusFailure(result.status);
      // Facebook answers signed out page requests with 400, which in practice means it wants a login.
      if (platform === 'facebook' && result.status === 400) {
        return { ok: false, code: 'login_required', reason: 'Facebook shows this page only to signed in visitors.', trip: false };
      }
      return { ok: false, code: mapped.code, reason: `${name}: ${mapped.reason}`, trip: mapped.code !== 'not_found' };
    }
    const meta = extractMeta(result.body);
    const hasContent = Boolean(meta['og:description'] || meta['og:title']);
    if (!hasContent && looksLoggedOut(result.body, platform)) {
      return { ok: false, code: 'login_required', reason: `${name} shows this only to signed in visitors, and Social Campaign never signs in.`, trip: false };
    }
    if (!hasContent) {
      return { ok: false, code: 'blocked', reason: `${name} answered with a page that has nothing readable in it.`, trip: false };
    }
    return { ok: true, meta, title: extractTitle(result.body), fetched_at: result.fetched_at, final_url: result.final_url };
  }

  /**
   * @param {{handle: string, url: string}} target
   * @param {'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, profile: Record<string, any>}|PageFailure>}
   */
  async profile(target, platform) {
    const page = await this.read(target.url, platform);
    if (!page.ok) return page;
    const description = page.meta['og:description'] ?? page.meta.description ?? '';
    const counts = platform === 'instagram' ? parseInstagramProfileDescription(description) : { followers: null, following: null, posts: null };
    const title = page.meta['og:title'] ?? page.title ?? null;
    return {
      ok: true,
      profile: profileRecord({
        platform,
        url: target.url,
        handle: target.handle,
        display_name: title ? title.replace(/\s*\(@[^)]*\).*$/, '').replace(/\s*[|-]\s*(Instagram|Facebook).*$/i, '').trim() || null : null,
        bio: platform === 'facebook' ? description || null : null,
        followers: counts.followers,
        following: counts.following,
        post_count: counts.posts,
        source_ref: page.final_url,
        observed_at: page.fetched_at,
        confidence: 0.8,
      }),
    };
  }

  /**
   * @param {string} url
   * @param {'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, record: Record<string, any>}|PageFailure>}
   */
  async post(url, platform) {
    const page = await this.read(url, platform);
    if (!page.ok) return page;
    const description = page.meta['og:description'] ?? page.meta.description ?? '';
    const parsed = platform === 'instagram' ? parseInstagramPostDescription(description) : { likes: null, comments: null, author: null, date: null, caption: description || null };
    const isVideo = /video|reel/i.test(page.meta['og:type'] ?? '') || /\/(reel|reels|videos|watch)\b/.test(url) || Boolean(page.meta['og:video']);
    return {
      ok: true,
      record: postRecord({
        platform,
        url,
        post_id: url.match(/\/(?:p|reel|reels|tv|videos|posts)\/([^/?#]+)/)?.[1] ?? null,
        author_handle: parsed.author,
        posted_at: parsed.date,
        media_kind: isVideo ? 'video' : 'image',
        caption: parsed.caption,
        metrics: { likes: parsed.likes, comments: parsed.comments },
        thumbnail_url: page.meta['og:image'] ?? null,
        source_ref: page.final_url,
        observed_at: page.fetched_at,
        confidence: 0.8,
      }),
    };
  }
}
