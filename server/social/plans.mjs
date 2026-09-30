/**
 * Web evidence plans.
 *
 * When a platform cannot be read directly, a research tool hands Claude a precise
 * plan: what to search for, which public addresses to open, which fields to pull
 * out, and how to record them. Claude runs it with WebSearch and WebFetch, and
 * research_evidence_save stores what it found with the plan's request_id, so the
 * evidence carries the same provenance as a direct read.
 *
 * The addresses and search forms below were checked live on 2026-09-12; the
 * coverage table in docs/CONTRACTS.md section 1a records what each one returned.
 */

import { newId } from '../lib/ids.mjs';

/** What each record kind asks Claude to pull out of a page. */
const EXTRACT = {
  profile: ['url', 'handle', 'display_name', 'bio', 'followers', 'following', 'post_count', 'links'],
  post: ['url', 'author_handle', 'posted_at', 'caption', 'metrics.views', 'metrics.likes', 'metrics.comments', 'metrics.shares'],
  comment: ['url of the post', 'author_handle', 'text', 'likes', 'posted_at'],
  ad: ['library_url', 'advertiser', 'ad_id (Library ID)', 'started_at', 'active', 'countries', 'format', 'primary_text', 'headline', 'cta', 'landing_url'],
  page: ['url', 'title', 'text'],
};

/** Rules that go with every plan, so web evidence stays honest. */
const COMMON_RULES = [
  'Record only what a page actually shows; a count you cannot see is left out, never guessed or set to zero.',
  'Quote captions and comments exactly in `quote` or `text`; put your own reading in `notes`, which is stored apart as an inference.',
  'Give every item the address it came from; an item from a search result snippet gets the snippet address and a note saying it came from a snippet.',
];

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
function plan(input) {
  return {
    request_id: newId(),
    goal: input.goal,
    searches: input.searches ?? [],
    fetch: input.fetch ?? [],
    open_in_browser: input.open_in_browser ?? [],
    extract: EXTRACT[input.record_kind] ?? [],
    look_for: [...(input.look_for ?? []), ...COMMON_RULES],
    record_kind: input.record_kind,
    platform: input.platform,
    record_with: 'research_evidence_save',
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoted(value) {
  return `"${String(value).replace(/"/g, '')}"`;
}

/**
 * A plan for a profile and its recent posts.
 * @param {{platform: string, handle: string, url: string, limit: number}} input
 * @returns {Record<string, any>}
 */
export function profilePlan({ platform, handle, url, limit }) {
  const name = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[platform] ?? platform;
  const host = { tiktok: 'tiktok.com', instagram: 'instagram.com', facebook: 'facebook.com' }[platform];
  return plan({
    platform,
    record_kind: 'profile',
    goal: `The public ${name} account @${handle}: follower count, bio and links, and its ${limit} most recent posts with address, date, caption and any visible counts.`,
    searches: [`site:${host}/${handle}`, `${quoted(`@${handle}`)} ${name} followers`, `${quoted(handle)} ${name} ${platform === 'tiktok' ? 'video' : 'reel'}`],
    fetch: [url],
    look_for: [
      `Search result titles and snippets often carry the follower count and bio of @${handle}; record them as a profile item with the snippet address.`,
      `Every ${host} post address found in the results is worth one WebFetch; record each as a post item.`,
      platform === 'instagram'
        ? 'A single Instagram post or reel address usually shows its caption, author and date to WebFetch even when the profile page does not.'
        : platform === 'facebook'
          ? 'Facebook pages usually show nothing to a signed out reader; prefer search snippets and news coverage that quote the page.'
          : 'TikTok profile facts are also readable in the profile embed at https://www.tiktok.com/embed/@<handle>.',
    ],
  });
}

/**
 * @param {{platform: string, url: string}} input
 * @returns {Record<string, any>}
 */
export function postPlan({ platform, url }) {
  return plan({
    platform,
    record_kind: 'post',
    goal: `The public post at ${url}: author, date, caption, hashtags and any visible view, like, comment and share counts.`,
    searches: [quoted(url.replace(/[?#].*$/, ''))],
    fetch: [url],
    look_for: ['Open the address with WebFetch first; search only if it shows nothing.'],
  });
}

/**
 * @param {{platform: string, url: string, limit: number}} input
 * @returns {Record<string, any>}
 */
export function commentsPlan({ platform, url, limit }) {
  return plan({
    platform,
    record_kind: 'comment',
    goal: `Up to ${limit} public comments on ${url}, most engaged first, with the commenter handle, exact text and like count when shown.`,
    searches: [],
    fetch: [url],
    look_for: ['WebFetch sometimes shows the first few comments under a post; record each one exactly as written.'],
  });
}

/**
 * @param {{platform: string, query: string, limit: number}} input
 * @returns {Record<string, any>}
 */
export function searchPlan({ platform, query, limit }) {
  const host = { tiktok: 'tiktok.com', instagram: 'instagram.com', facebook: 'facebook.com' }[platform] ?? platform;
  const clean = query.trim();
  const tag = clean.startsWith('#') ? clean.slice(1) : null;
  const searches = tag
    ? [`site:${host} ${quoted(`#${tag}`)}`, `${quoted(`#${tag}`)} ${platform} trend`, `site:${host}/${platform === 'tiktok' ? 'tag' : 'explore/tags'}/${tag}`]
    : [`site:${host} ${quoted(clean)}`, `${quoted(clean)} ${platform} ${platform === 'tiktok' ? 'video' : 'reel'}`];
  return plan({
    platform,
    record_kind: 'post',
    goal: `Up to ${limit} public ${platform} posts or accounts about ${quoted(clean)}, each with its address, author, date and visible counts.`,
    searches,
    fetch: [],
    look_for: [`Keep only results on ${host}; open each post address with WebFetch and record it as a post item, or a profile item for an account.`],
  });
}

/**
 * A plan for an ad library the server could not read.
 * @param {{platform: 'meta'|'tiktok', query: string, country: string, eu: boolean, urls: {library: string, alternate?: string}}} input
 * @returns {Record<string, any>}
 */
export function adsPlan({ platform, query, country, eu, urls }) {
  if (platform === 'meta') {
    return plan({
      platform: 'meta',
      record_kind: 'ad',
      goal: `Ads ${quoted(query)} is running on Facebook and Instagram as delivered in ${country}: text, format, start date, call to action and landing page.`,
      searches: [
        `${quoted(query)} site:facebook.com/ads/library`,
        `${quoted(query)} ${quoted('Library ID')}`,
        `${quoted(query)} facebook instagram ad campaign ${new Date().getUTCFullYear()}`,
      ],
      fetch: [],
      open_in_browser: [urls.library],
      look_for: [
        'The Meta Ad Library only opens in a real browser; plain fetches get a bot check. Offer the user the open_in_browser address and ask them to paste or screenshot what it shows.',
        eu
          ? `${country} is in the EU, so the library there also shows reach, targeting and payer details for every ad.`
          : `Outside the EU and UK the library shows active commercial ads, but full history and reach are published only for political and social issue ads.`,
        'Each ad in the library has a Library ID and a Started running date; record both.',
        'Search snippets and marketing press that quote a specific ad are acceptable evidence at a lower confidence.',
      ],
    });
  }
  return plan({
    platform: 'tiktok',
    record_kind: 'ad',
    goal: `TikTok ads for ${quoted(query)} in ${country}: hook, text, format, call to action and dates.`,
    searches: [`${quoted(query)} site:ads.tiktok.com/business/creativecenter`, `${quoted(query)} tiktok ad ${new Date().getUTCFullYear()}`, `${quoted(query)} tiktok spark ads`],
    fetch: [],
    open_in_browser: [urls.library, ...(urls.alternate ? [urls.alternate] : [])],
    look_for: [
      'TikTok Creative Center and the TikTok Ad Library render only in a real browser; plain fetches return an empty page. Offer the user the open_in_browser addresses.',
      eu
        ? `${country} is in the EU, so the TikTok Ad Library lists every ad shown there with first and last shown dates.`
        : 'The TikTok Ad Library lists ads shown in the EU, the UK and Switzerland; outside those markets use the Creative Center top ads list.',
      'Posts on tiktok.com marked Sponsored or Paid partnership that turn up in search are acceptable evidence, recorded as ad items.',
    ],
  });
}

/**
 * @param {{url: string, reason: string}} input
 * @returns {Record<string, any>}
 */
export function pagePlan({ url, reason }) {
  return plan({
    platform: 'web',
    record_kind: 'page',
    goal: `The text of ${url}. ${reason}`,
    searches: [quoted(url.replace(/^https?:\/\//, '').replace(/[?#].*$/, ''))],
    fetch: [url],
    look_for: ['Record the page title and the passages that matter as page items, quoting them exactly.'],
  });
}
