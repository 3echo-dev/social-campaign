/**
 * TikTok's public, signed out pages.
 *
 * TikTok publishes embeddable players for posts and profiles so any website can
 * show them, and the page data behind those players is readable without a login.
 * Checked live on 2026-09-12, while yt-dlp was getting a bot check from TikTok:
 *
 * - https://www.tiktok.com/embed/v2/<id> carries one post: caption, author, create
 *   time, duration, sound, hashtags and play, like, comment and share counts.
 * - https://www.tiktok.com/embed/@<handle> carries the profile (followers,
 *   following, total likes, bio, verified) and its 10 latest posts with play counts.
 * - https://www.tiktok.com/api/comment/list/ returns a post's public comments; this
 *   is the same address yt-dlp's own TikTok code reads.
 * - https://www.tiktok.com/api/challenge/detail/ returns a hashtag's view and video
 *   totals. Its post list needs a signed request, so it is not used.
 *
 * Every read goes through boundedFetch with a per host politeness gap.
 */

import { boundedFetch, FetchFailure, statusFailure } from './web.mjs';
import { commentRecord, postRecord, profileRecord, tiktokTimeFromId, toCount } from '../records.mjs';

/** Where TikTok lives. Tests point this at a local server. */
export const TIKTOK_BASE_URL = 'https://www.tiktok.com';

/** How many posts the profile embed shows. */
export const EMBED_PROFILE_POSTS = 10;

/**
 * @typedef {{ok: false, code: string, reason: string, trip: boolean}} PublicFailure
 */

/**
 * Pull the embed's page state out of its HTML.
 * @param {string} html
 * @returns {Record<string, any>|null}
 */
export function parseEmbedState(html) {
  const match = html.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const state = JSON.parse(match[1]);
    const data = state?.source?.data;
    if (!data || typeof data !== 'object') return null;
    const key = Object.keys(data).find((entry) => entry.startsWith('/embed'));
    return key ? data[key] : null;
  } catch {
    return null;
  }
}

/**
 * A post record from the post embed's videoData.
 * @param {Record<string, any>} videoData
 * @param {string} observedAt
 * @param {string} sourceRef
 * @returns {Record<string, any>}
 */
export function postFromEmbed(videoData, observedAt, sourceRef) {
  const item = videoData.itemInfos ?? {};
  const author = videoData.authorInfos ?? {};
  const music = videoData.musicInfos ?? {};
  const handle = author.uniqueId ?? null;
  const tags = [
    ...(Array.isArray(videoData.challengeInfoList) ? videoData.challengeInfoList.map((entry) => entry.challengeName) : []),
    ...(Array.isArray(videoData.textExtra) ? videoData.textExtra.map((entry) => entry.HashtagName) : []),
  ]
    .filter((tag) => typeof tag === 'string' && tag.length > 0)
    .map((tag) => tag.toLowerCase());
  const isPhoto = Boolean(item.imagePost || item.imageInfos);
  return postRecord({
    platform: 'tiktok',
    url: handle ? `https://www.tiktok.com/@${handle}/${isPhoto ? 'photo' : 'video'}/${item.id}` : `https://www.tiktok.com/embed/v2/${item.id}`,
    post_id: item.id ?? null,
    author_handle: handle,
    posted_at: item.createTime ?? tiktokTimeFromId(item.id),
    media_kind: isPhoto ? 'carousel' : 'video',
    caption: typeof item.text === 'string' ? item.text : null,
    hashtags: [...new Set(tags)],
    duration_s: typeof item.video?.videoMeta?.duration === 'number' ? item.video.videoMeta.duration : null,
    sound: music.musicName ? [music.musicName, music.authorName].filter(Boolean).join(' - ') : null,
    metrics: {
      views: item.playCount,
      likes: item.diggCount,
      comments: item.commentCount,
      shares: item.shareCount,
      saves: item.collectCount,
    },
    thumbnail_url: Array.isArray(item.covers) ? item.covers[0] : null,
    source_type: 'public_platform',
    source_ref: sourceRef,
    observed_at: observedAt,
    confidence: 0.9,
  });
}

/**
 * The signed out TikTok reader.
 */
export class TikTokPublicBackend {
  /**
   * @param {{baseUrl?: string, allowPrivate?: boolean, timeoutMs?: number, politeness?: import('./web.mjs').Politeness}} [options]
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? TIKTOK_BASE_URL).replace(/\/$/, '');
    this.options = options;
  }

  /**
   * @param {string} path
   * @param {Record<string, string>} [headers]
   * @returns {Promise<import('./web.mjs').FetchResult|PublicFailure>}
   */
  async get(path, headers = {}) {
    const url = `${this.baseUrl}${path}`;
    try {
      if (this.options.politeness) await this.options.politeness.wait(new URL(url).host);
      return await boundedFetch(url, {
        allowPrivate: this.options.allowPrivate,
        timeoutMs: this.options.timeoutMs,
        headers: { Referer: `${TIKTOK_BASE_URL}/`, ...headers },
      });
    } catch (error) {
      const failure = error instanceof FetchFailure ? error : new FetchFailure(String(error), 'network');
      return { ok: false, code: failure.code === 'timed_out' ? 'timed_out' : 'blocked', reason: `TikTok could not be reached: ${failure.message}`, trip: true };
    }
  }

  /**
   * @param {import('./web.mjs').FetchResult|PublicFailure} result
   * @returns {PublicFailure|null}
   */
  static failureOf(result) {
    if ('code' in result && result.ok === false) return /** @type {PublicFailure} */ (result);
    const fetched = /** @type {import('./web.mjs').FetchResult} */ (result);
    if (!fetched.ok) {
      const mapped = statusFailure(fetched.status);
      return { ok: false, code: mapped.code, reason: `TikTok: ${mapped.reason}`, trip: mapped.code !== 'not_found' };
    }
    return null;
  }

  /**
   * One post from its embed page.
   * @param {string} postId
   * @returns {Promise<{ok: true, record: Record<string, any>, author: Record<string, any>}|PublicFailure>}
   */
  async post(postId) {
    const result = await this.get(`/embed/v2/${encodeURIComponent(postId)}`);
    const failure = TikTokPublicBackend.failureOf(result);
    if (failure) return failure;
    const fetched = /** @type {import('./web.mjs').FetchResult} */ (result);
    const data = parseEmbedState(fetched.body);
    if (!data) return { ok: false, code: 'blocked', reason: 'TikTok answered with a page that has no post data in it.', trip: true };
    if (data.isError || !data.videoData?.itemInfos?.id) {
      return { ok: false, code: 'not_found', reason: 'TikTok says this post does not exist, or it is no longer public.', trip: false };
    }
    const record = postFromEmbed(data.videoData, fetched.fetched_at, `${TIKTOK_BASE_URL}/embed/v2/${postId}`);
    const author = data.videoData.authorInfos ?? {};
    return { ok: true, record, author };
  }

  /**
   * A profile and its latest posts from the profile embed.
   * @param {string} handle
   * @returns {Promise<{ok: true, profile: Record<string, any>, posts: Array<Record<string, any>>}|PublicFailure>}
   */
  async profile(handle) {
    const result = await this.get(`/embed/@${encodeURIComponent(handle)}`);
    const failure = TikTokPublicBackend.failureOf(result);
    if (failure) return failure;
    const fetched = /** @type {import('./web.mjs').FetchResult} */ (result);
    const data = parseEmbedState(fetched.body);
    if (!data) return { ok: false, code: 'blocked', reason: 'TikTok answered with a page that has no profile data in it.', trip: true };
    const user = data.userInfo;
    if (data.isError || !user || user.code === 10202 || !user.uniqueId) {
      return { ok: false, code: 'not_found', reason: `TikTok has no public account called @${handle}.`, trip: false };
    }
    if (user.privateAccount) {
      return { ok: false, code: 'login_required', reason: `@${handle} is a private TikTok account.`, trip: false };
    }
    const sourceRef = `${TIKTOK_BASE_URL}/embed/@${user.uniqueId}`;
    const profile = profileRecord({
      platform: 'tiktok',
      url: `https://www.tiktok.com/@${user.uniqueId}`,
      handle: user.uniqueId,
      display_name: user.nickname,
      bio: user.signature ?? null,
      followers: user.followerCount,
      following: user.followingCount,
      post_count: user.videoCount,
      likes_total: user.heartCount,
      verified: typeof user.verified === 'boolean' ? user.verified : null,
      source_ref: sourceRef,
      observed_at: fetched.fetched_at,
    });
    const posts = (Array.isArray(data.videoList) ? data.videoList : [])
      .filter((video) => video && video.id && !video.privateItem)
      .map((video) =>
        postRecord({
          platform: 'tiktok',
          url: `https://www.tiktok.com/@${video.authorUniqueId ?? user.uniqueId}/video/${video.id}`,
          post_id: String(video.id),
          author_handle: video.authorUniqueId ?? user.uniqueId,
          posted_at: tiktokTimeFromId(String(video.id)),
          media_kind: 'video',
          caption: typeof video.desc === 'string' ? video.desc : null,
          metrics: { views: video.playCount },
          source_type: 'public_platform',
          source_ref: sourceRef,
          observed_at: fetched.fetched_at,
          confidence: 0.9,
        }),
      );
    return { ok: true, profile, posts };
  }

  /**
   * Public comments on a post, paged until `limit` top level comments are read.
   * @param {string} postId
   * @param {string} postUrl
   * @param {number} limit
   * @returns {Promise<{ok: true, records: Array<Record<string, any>>, total: number|null, complete: boolean}|PublicFailure>}
   */
  async comments(postId, postUrl, limit) {
    /** @type {Array<Record<string, any>>} */
    const records = [];
    let cursor = 0;
    let total = null;
    let complete = false;
    for (let page = 0; page < 20 && records.length < limit; page += 1) {
      const count = Math.min(50, limit - records.length);
      const result = await this.get(`/api/comment/list/?aweme_id=${encodeURIComponent(postId)}&count=${count}&cursor=${cursor}&aid=1988`, {
        Accept: 'application/json,text/plain,*/*',
      });
      const failure = TikTokPublicBackend.failureOf(result);
      if (failure) {
        if (records.length > 0) break;
        return failure;
      }
      const fetched = /** @type {import('./web.mjs').FetchResult} */ (result);
      let body;
      try {
        body = JSON.parse(fetched.body);
      } catch {
        if (records.length > 0) break;
        return { ok: false, code: 'blocked', reason: 'TikTok answered the comment request with something other than comments.', trip: true };
      }
      if (body.status_code && body.status_code !== 0) {
        if (records.length > 0) break;
        return { ok: false, code: 'not_found', reason: 'TikTok did not return comments for this post.', trip: false };
      }
      total = toCount(body.total) ?? total;
      for (const comment of Array.isArray(body.comments) ? body.comments : []) {
        records.push(
          commentRecord({
            platform: 'tiktok',
            post_url: postUrl,
            url: postUrl,
            comment_id: comment.cid != null ? String(comment.cid) : null,
            author_handle: comment.user?.unique_id ?? null,
            text: comment.text ?? '',
            likes: comment.digg_count,
            replies: comment.reply_comment_total,
            posted_at: comment.create_time,
            source_type: 'public_platform',
            source_ref: `${TIKTOK_BASE_URL}/api/comment/list/?aweme_id=${postId}`,
            observed_at: fetched.fetched_at,
            confidence: 0.9,
          }),
        );
      }
      if (!body.has_more || !Array.isArray(body.comments) || body.comments.length === 0) {
        complete = true;
        break;
      }
      cursor = Number(body.cursor) || cursor + count;
    }
    records.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || (b.replies ?? -1) - (a.replies ?? -1));
    return { ok: true, records: records.slice(0, limit), total, complete: complete || records.length >= limit };
  }

  /**
   * A hashtag's totals.
   * @param {string} tag without the #.
   * @returns {Promise<{ok: true, hashtag: Record<string, any>}|PublicFailure>}
   */
  async hashtag(tag) {
    const result = await this.get(`/api/challenge/detail/?challengeName=${encodeURIComponent(tag)}&aid=1988`, { Accept: 'application/json,*/*' });
    const failure = TikTokPublicBackend.failureOf(result);
    if (failure) return failure;
    const fetched = /** @type {import('./web.mjs').FetchResult} */ (result);
    let body;
    try {
      body = JSON.parse(fetched.body);
    } catch {
      return { ok: false, code: 'blocked', reason: 'TikTok answered the hashtag request with something other than data.', trip: true };
    }
    const info = body.challengeInfo;
    if (!info?.challenge?.id) return { ok: false, code: 'not_found', reason: `TikTok has no hashtag #${tag}.`, trip: false };
    return {
      ok: true,
      hashtag: {
        name: info.challenge.title ?? tag,
        url: `https://www.tiktok.com/tag/${encodeURIComponent(info.challenge.title ?? tag)}`,
        description: info.challenge.desc || null,
        views: toCount(info.statsV2?.viewCount ?? info.stats?.viewCount),
        videos: toCount(info.statsV2?.videoCount) || toCount(info.stats?.videoCount) || null,
        source_type: 'public_platform',
        source_ref: `${TIKTOK_BASE_URL}/api/challenge/detail/?challengeName=${tag}`,
        observed_at: fetched.fetched_at,
        confidence: 0.9,
      },
    };
  }

  /**
   * Resolve a short link such as vm.tiktok.com/abc to the post address it points at.
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async resolveShortLink(url) {
    try {
      const result = await boundedFetch(url, { allowPrivate: this.options.allowPrivate, timeoutMs: this.options.timeoutMs, maxBytes: 64 * 1024 });
      return result.final_url;
    } catch {
      return null;
    }
  }
}
