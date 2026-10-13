/**
 * Outliers against an account's own baseline.
 *
 * A post is judged only against the same account's recent posts: the baseline is
 * the median view count of its settled posts inside the window, and each post's
 * outlier ratio is its views divided by that median. Likes are not the measure
 * where views exist, because a like count says as much about follower count as
 * about the post. The one exception is a platform that shows no view count to a
 * signed out reader (Instagram): there the caller asks for `measure: 'likes'`, the
 * ratio is still a post against the SAME account's own median, and the baseline
 * says which measure it used.
 *
 * Posts younger than SETTLE_DAYS are still gathering views, so they are left out of
 * the baseline; one of them can still be an outlier, because its ratio only rises.
 */

/** Posts younger than this are not part of the baseline. */
export const SETTLE_DAYS = 2;

/** Fewest settled posts with views that make a baseline worth stating. */
export const MIN_BASELINE_SAMPLE = 5;

/** A post at or above this ratio is returned. */
export const ABOVE_BASELINE_RATIO = 2;

/** A post at or above this ratio is an outlier; between the two it is above baseline. */
export const OUTLIER_RATIO = 3;

/** Window lengths in days. */
export const WINDOWS = { '30d': 30, '90d': 90, '180d': 180, all: null };

const DAY_MS = 86_400_000;

/**
 * @param {number[]} values
 * @returns {number|null}
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * @typedef {object} OutlierResult
 * @property {{median: number|null, median_views: number|null, median_likes: number|null, measure: 'views'|'likes', sample: number, window: string, excluded_recent: number, excluded_no_views: number, outside_window: number, method: string}} baseline
 * @property {Array<Record<string, any>>} outliers post records plus outlier_ratio, baseline_median_views and verdict, highest ratio first.
 * @property {string|null} problem why no outliers could be judged, or null.
 */

/**
 * Rank a set of one account's posts against that account's own baseline.
 * @param {Array<Record<string, any>>} posts post records.
 * @param {{window?: '30d'|'90d'|'180d'|'all', now?: number, measure?: 'views'|'likes', includeUndated?: boolean}} [options]
 *   `includeUndated` keeps posts with no date inside the window, for a listing that carries no dates at all
 *   (YouTube's channel Shorts tab): the listing is the account's latest posts, so it is the window.
 * @returns {OutlierResult}
 */
export function findOutliers(posts, options = {}) {
  const window = options.window ?? '90d';
  const measure = options.measure === 'likes' ? 'likes' : 'views';
  const noun = measure === 'likes' ? 'like count' : 'view count';
  const now = options.now ?? Date.now();
  const days = WINDOWS[window];
  const cutoff = days === null || days === undefined ? -Infinity : now - days * DAY_MS;
  const settledBefore = now - SETTLE_DAYS * DAY_MS;

  let outsideWindow = 0;
  let noViews = 0;
  let recent = 0;
  /** @type {Array<{post: Record<string, any>, views: number, settled: boolean}>} */
  const candidates = [];
  for (const post of posts) {
    const postedMs = post.posted_at ? Date.parse(post.posted_at) : NaN;
    // A post with no date cannot be placed in a window; it counts only for "all" (or when the listing has no dates at all).
    if (Number.isFinite(postedMs) ? postedMs < cutoff : days !== null && !options.includeUndated) {
      outsideWindow += 1;
      continue;
    }
    const views = post.metrics?.[measure];
    if (typeof views !== 'number' || views < 0) {
      noViews += 1;
      continue;
    }
    const settled = !Number.isFinite(postedMs) || postedMs <= settledBefore;
    if (!settled) recent += 1;
    candidates.push({ post, views, settled });
  }

  const baselineViews = candidates.filter((entry) => entry.settled).map((entry) => entry.views);
  const medianViews = median(baselineViews);
  const baseline = {
    // `median` is the baseline of whichever measure was used; the other two name it for a reader that wants one.
    median: medianViews,
    median_views: measure === 'views' ? medianViews : null,
    median_likes: measure === 'likes' ? medianViews : null,
    measure,
    sample: baselineViews.length,
    window,
    excluded_recent: recent,
    excluded_no_views: noViews,
    outside_window: outsideWindow,
    method: `median ${measure} of the account's own posts from the ${window === 'all' ? 'whole listing' : options.includeUndated ? 'whole listing (it carries no dates)' : `last ${days} days`}, leaving out posts younger than ${SETTLE_DAYS} days; ratio = post ${measure} / median`,
  };

  if (baselineViews.length < MIN_BASELINE_SAMPLE) {
    return {
      baseline,
      outliers: [],
      problem: `Only ${baselineViews.length} settled post${baselineViews.length === 1 ? '' : 's'} with a ${noun} ${window === 'all' ? 'were found' : `fall in the last ${days} days`}; at least ${MIN_BASELINE_SAMPLE} are needed for a baseline.`,
    };
  }
  if (!medianViews || medianViews <= 0) {
    return { baseline, outliers: [], problem: `The median ${noun} is zero, so no ratio can be computed.` };
  }

  const outliers = candidates
    .map((entry) => ({ ...entry, ratio: entry.views / medianViews }))
    .filter((entry) => entry.ratio >= ABOVE_BASELINE_RATIO)
    .sort((a, b) => b.ratio - a.ratio || b.views - a.views)
    .map((entry) => ({
      ...entry.post,
      kind: 'outlier',
      outlier_ratio: Math.round(entry.ratio * 100) / 100,
      ...(measure === 'likes' ? { baseline_median_likes: medianViews, measure } : { baseline_median_views: medianViews }),
      verdict: entry.ratio >= OUTLIER_RATIO ? 'outlier' : 'above_baseline',
      settled: entry.settled,
    }));
  return { baseline, outliers, problem: null };
}
