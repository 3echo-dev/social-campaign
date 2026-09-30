/**
 * Immutable provider intent carried by a release from final review to dispatch.
 *
 * The release already stores the publishable content and byte fingerprints.  This
 * record adds the destination and timing decision so a later connector change or
 * a new tool argument cannot redirect an approved release.
 */

import { createHash } from 'node:crypto';

import { InvalidInputError } from '../lib/errors.mjs';

const MODES = new Set(['publish', 'schedule']);

/** @param {string} value */
function hasExplicitOffset(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

/** @param {string|null} timezone */
function validateTimezone(timezone) {
  if (!timezone) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new InvalidInputError(`The timezone "${timezone}" is not recognized.`, {
      fix: 'Use an IANA timezone such as UTC or Asia/Manila.',
    });
  }
}

/**
 * Freeze provider, mode, timezone and the exact post facts used by adapters.
 * `posts` should be the already resolved release posts, so asset hashes are the
 * bytes the person reviewed rather than a path that can be re-read differently.
 * @param {{provider?: string|null, mode?: 'publish'|'schedule'|null, timezone?: string|null, original_timezone?: string|null, posts: Array<any>}} input
 * @returns {{provider: string|null, mode: 'publish'|'schedule'|null, timezone: string|null, original_timezone: string|null, posts: Array<any>, digest: string}}
 */
export function freezeIntent(input) {
  const provider = input.provider == null ? null : String(input.provider);
  const mode = input.mode == null ? null : String(input.mode);
  if (mode !== null && !MODES.has(mode)) {
    throw new InvalidInputError(`The publishing mode "${mode}" is not supported.`, {
      fix: 'Use publish or schedule when freezing the release intent.',
    });
  }
  const timezone = input.timezone == null ? null : String(input.timezone);
  const originalTimezone = input.original_timezone == null ? timezone : String(input.original_timezone);
  validateTimezone(timezone);
  if (mode === 'schedule' && !timezone) {
    throw new InvalidInputError('A scheduled release needs a timezone.', {
      fix: 'Choose the user timezone before opening final review.',
    });
  }
  const posts = (Array.isArray(input.posts) ? input.posts : []).map((post, index) => {
    const rawScheduledAt = post?.scheduled_at == null ? null : String(post.scheduled_at).trim();
    if (mode === 'schedule' && rawScheduledAt && !hasExplicitOffset(rawScheduledAt)) {
      throw new InvalidInputError(`The schedule for post ${index + 1} has no UTC offset.`, {
        fix: 'Use an ISO 8601 date-time ending in Z or an explicit offset such as +08:00.',
      });
    }
    const scheduledAt = rawScheduledAt ? new Date(rawScheduledAt) : null;
    if (scheduledAt && !Number.isFinite(scheduledAt.getTime())) {
      throw new InvalidInputError(`The schedule for post ${index + 1} is not a valid date-time.`, {
        fix: 'Use an ISO 8601 date-time and include its UTC offset.',
      });
    }
    return {
      post_index: Number.isInteger(Number(post?.post_index)) ? Number(post.post_index) : index,
      platform: String(post?.platform ?? ''),
      account_id: post?.account_id == null ? null : String(post.account_id),
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      timezone,
      caption: typeof post?.caption === 'string' ? post.caption : '',
      hashtags: Array.isArray(post?.hashtags) ? post.hashtags.map(String) : [],
      first_comment: post?.first_comment == null ? null : String(post.first_comment),
      asset_id: post?.asset_id == null ? null : String(post.asset_id),
      asset_sha256: post?.asset_sha256 == null ? null : String(post.asset_sha256),
      asset_path: post?.asset_path == null ? null : String(post.asset_path),
    };
  });
  if (mode === 'schedule' && posts.some((post) => !post.scheduled_at)) {
    throw new InvalidInputError('A scheduled release needs one UTC time for every post.', {
      fix: 'Choose the schedule before opening final review.',
    });
  }
  const content = { provider, mode: mode || null, timezone, original_timezone: originalTimezone, posts };
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return { ...content, digest };
}

/**
 * Return the frozen intent for one release post.
 * @param {any} intent
 * @param {number} postIndex
 * @returns {any|null}
 */
export function intentPost(intent, postIndex) {
  if (!Array.isArray(intent?.posts)) return null;
  return intent.posts.find((post) => Number(post?.post_index) === Number(postIndex)) ?? null;
}

/**
 * Compare two date-time values as UTC instants without changing the stored value.
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameInstant(left, right) {
  if (left == null || right == null) return left == null && right == null;
  const leftMs = Date.parse(String(left));
  const rightMs = Date.parse(String(right));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}
