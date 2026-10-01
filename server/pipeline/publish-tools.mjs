import { asObject, toolBase } from './spend-tools.mjs';

/**
 * What the Metricool send guard needs to know before it loads anything heavy: which tools it guards, the texts it
 * says, and the checks that need no job at all (the reviewer-step tools, boost fields, a call whose info cannot be
 * read or repeats a key, any field the plan does not describe, the shape of the media links). It imports only
 * spend-tools.mjs, which imports only node:path, so the PreToolUse hook (scripts/hooks/publish-pre.mjs) can still
 * refuse when publish-guard.mjs fails to load. The checks against the job's approved posting plan live in
 * publish-guard.mjs.
 */

export { asObject, toolBase };

/** The two tools that put a post on a channel. */
export const PUBLISH_WRITE_TOOLS = Object.freeze(['createScheduledPost', 'updateScheduledPost']);
/** Metricool's reviewer step. This plugin never uses it: the person approves on the board. */
export const REVIEWER_TOOLS = Object.freeze(['createScheduledPostForReview', 'sendScheduledPostForReview']);
export const PUBLISH_TOOLS = Object.freeze(new Set([...PUBLISH_WRITE_TOOLS, ...REVIEWER_TOOLS]));
/** The read-only tool whose answers reconcile trusts: the plugin keeps what Metricool really returned. */
export const LISTING_TOOL = 'getScheduledPosts';

export const isPublishTool = base => PUBLISH_TOOLS.has(base);
export const isReviewerTool = base => REVIEWER_TOOLS.includes(base);
/** True when raw event text names one of the guarded tools: used when the event itself cannot be read. */
export const namesGuardedTool = raw => /(createScheduledPost|updateScheduledPost|createScheduledPostForReview|sendScheduledPostForReview)/.test(String(raw ?? ''));

/** Where every media link a post uses must point: the person's own 3echo Studio media, by asset id. */
export const MEDIA_ORIGIN = 'https://agentc.3echo.ai';
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[A-Za-z0-9._~%+=-]{1,4096}$/;

/**
 * Why updateScheduledPost is never allowed in a pipeline workspace: a scheduled post is changed or cancelled by the person,
 * in Metricool. `plannerUrl` is the link to that post when it is known.
 */
export const updateRefusal = plannerUrl => `To change or cancel a scheduled post, open it in Metricool${typeof plannerUrl === 'string' && plannerUrl ? `: ${plannerUrl}` : ''}.`;

export const PUBLISH_NO_JOB_WARNING = "This post isn't linked to a Social Campaign job, so what goes out isn't checked against an approved plan.";
export const PUBLISH_DENY = Object.freeze({
  unchecked: "The check on this post couldn't finish, so nothing was sent. Try again in a moment.",
  reviewer: "Posts don't go through Metricool's reviewer step here. You approve them on the board, so schedule the post directly instead.",
  noJob: 'Posts are scheduled from inside a job. Start or resume the job on the board first.',
  noApproval: "The posting plan hasn't been approved yet. Show it and wait for the approval before sending anything.",
  planChanged: 'The posting plan changed after it was approved. Present it again and wait for a new approval before sending anything.',
  noPlan: 'This job has no posting plan yet, so nothing can be sent.',
  planUnreadable: "The job's posting plan couldn't be read, so nothing was sent.",
  otherJob: 'The posting plan belongs to another job.',
  selfRoute: 'This job is set to "I\'ll post it myself", so nothing is sent to Metricool.',
  notMetricool: 'The posting plan has no Metricool brand to post through.',
  infoUnreadable: "The post details (info) couldn't be read as JSON, so nothing was sent.",
  duplicateKeys: 'The post details (info) repeat a setting, so it is unclear which one counts and nothing was sent',
  allSent: 'Every post in this plan has already been sent. To change one, change the plan and get it approved first.',
  alreadySent: 'This post was already sent to Metricool. To change or cancel it, open it in Metricool.',
  ambiguous: 'This call matches more than one post in the plan, so nothing was sent.',
  unknownPending: 'An earlier send for this post has no known result. Do not send it again: call pipeline_publish_reconcile to see what to look up, read Metricool with getScheduledPosts for that span, then call pipeline_publish_reconcile again. If it still cannot tell, the person has to check in Metricool.',
  timePassed: 'The time for this post has passed. Rebuild the plan with a new time and get it approved.',
  postNowExpired: 'Approve the posting plan again to post now.',
  logUnreadable: "The record of what was sent couldn't be read, so nothing was sent.",
  reserveFailed: "The send couldn't be recorded first, so nothing was sent.",
  blogChanged: "This brand's Metricool brand changed since the plan was approved. Present the plan again and wait for a new approval.",
  extraFields: "The call carries settings the approved plan doesn't cover",
  notReady: "This post isn't ready to send",
});

/** The reason a call is not the approved post, one sentence naming what differs. */
export const MISMATCH = Object.freeze({
  blog: "The Metricool brand isn't the one in the approved plan.",
  types: 'The brand, network and post type must be plain text or numbers.',
  network: 'The post must go to exactly one network, the one in the approved plan.',
  type: "The post type isn't the one in the approved plan.",
  text: "The text isn't the approved text, word for word.",
  title: "The TikTok title isn't the approved title.",
  date: "The time isn't the approved time.",
  dateOffset: 'The date must carry its offset from UTC (Z or +hh:mm) and be the approved time.',
  noDate: 'The approved plan has no time for this post, so it cannot be sent.',
  window: 'Post now must be scheduled between 3 and 30 minutes from now.',
  draft: "The draft setting isn't the approved one.",
  autoPublish: "The automatic publishing setting isn't the approved one.",
  firstComment: "The first comment isn't the approved one.",
  ai: "The AI-made label isn't the approved one.",
  altText: 'Picture descriptions (alt text) are not part of the approved plan yet, so none can be sent.',
  showReel: "The setting for showing a reel on the feed isn't the approved one.",
  mediaCount: "The number of pictures or videos isn't the approved number.",
  mediaHost: "A media link isn't a 3echo Studio link for an approved file.",
  mediaAsset: "A media link isn't the uploaded copy of the approved file.",
  mediaMissing: 'The approved file has not been uploaded to 3echo yet, or it changed since.',
  tiktok: "The TikTok settings aren't the approved ones.",
  otherNetworkData: 'Settings for another network were included.',
  boost: 'Paid boosting is not part of any plan here, so a post carrying boost settings is refused.',
  mediaFresh: "A media link wasn't read from 3echo just before sending. Call get_asset for the file, then use its link exactly as returned.",
  mediaStale: 'A media link is too old to use. Call get_asset for the file again and send right away.',
  mediaSize: "3echo's copy of a file isn't the size of the approved file, so it may have been replaced. Upload it again from the job.",
  mediaHash: "3echo's copy of a file isn't the approved file, so it may have been replaced. Upload it again from the job.",
  mediaWorkspace: "A media file isn't in the 3echo workspace named in the approved plan, or 3echo didn't say which workspace it is in.",
});

const TOP_FIELDS = Object.freeze(['blogId', 'date', 'info']);
const INFO_FIELDS = Object.freeze(['providers', 'publicationDate', 'text', 'media', 'mediaAltText', 'firstCommentText', 'draft', 'autoPublish', 'instagramData', 'facebookData', 'tiktokData']);
export const NETWORK_FIELDS = Object.freeze({
  instagramData: Object.freeze(['type', 'showReelOnFeed', 'isAiGenerated']),
  facebookData: Object.freeze(['type', 'isAiGenerated']),
  tiktokData: Object.freeze(['privacyOption', 'disableComment', 'disableDuet', 'disableStitch', 'commercialContentOwnBrand', 'commercialContentThirdParty', 'isAigc', 'title', 'autoAddMusic']),
});
const DATE_FIELDS = Object.freeze(['dateTime', 'timezone']);
const BOOST = /^boost/i;

export const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** A value that is absent or carries nothing (null, '', false, an empty list or object). */
export const isEmptyValue = value => value === null || value === undefined || value === '' || value === false
  || (Array.isArray(value) && value.length === 0) || (plain(value) && Object.keys(value).length === 0);

// ---------------------------------------------------------------------------
// Reading JSON the way a person can't be fooled by it
// ---------------------------------------------------------------------------

/**
 * JSON.parse that keeps a long `id` or `uuid` (a Metricool uuid is past 2^53) digit for digit: a number token with 15 or
 * more digits under one of those keys comes back as text. It works on number tokens in value position only (the reviver
 * is given each token's source text), so text inside a string is never touched.
 */
export function parseBigSafe(text) {
  return JSON.parse(String(text), (key, value, context) => {
    if ((key === 'id' || key === 'uuid') && typeof value === 'number' && typeof context?.source === 'string' && /^-?\d{15,}$/.test(context.source)) return context.source;
    return value;
  });
}

/**
 * What a tool reply holds, parsed with long ids kept as text, or null: JSON text is parsed, a host's content blocks are
 * opened (each block's text is parsed again the same way, so a reply escaped twice keeps its ids too), and an error
 * reply or anything unreadable gives null. A list of posts is returned as the list.
 */
export function bigSafeReply(response, depth = 0) {
  if (depth > 4 || response === null || response === undefined) return null;
  if (typeof response === 'string') {
    try {
      return bigSafeReply(parseBigSafe(response), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(response)) {
    const blocks = response.filter(block => block && block.type === 'text' && typeof block.text === 'string');
    if (!blocks.length) return response;
    for (const block of blocks) {
      const found = bigSafeReply(block.text, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof response !== 'object' || response.isError === true) return null;
  if (response.structuredContent && typeof response.structuredContent === 'object') return response.structuredContent;
  if (Array.isArray(response.content) && !Object.keys(response).some(key => !['content', 'isError', '_meta'].includes(key))) return bigSafeReply(response.content, depth + 1);
  return response;
}

const LITERAL = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/**
 * The keys a JSON text repeats inside one object, as dotted paths (the same key twice, whichever way it is escaped).
 * Throws when the text is not JSON. JSON.parse keeps only the last of a repeated key, which is not what a reader
 * scanning the text sees, so a repeated key is refused rather than guessed at.
 */
export function duplicateKeys(raw) {
  const text = String(raw);
  let at = 0;
  const found = [];
  const fail = () => { throw new Error('not JSON'); };
  const skip = () => { while (at < text.length && ' \t\r\n'.includes(text[at])) at += 1; };
  function string() {
    let out = '';
    at += 1;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') return out;
      if (char !== '\\') { out += char; continue; }
      const next = text[at++];
      if (next === 'u') {
        const hex = text.slice(at, at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        out += String.fromCharCode(parseInt(hex, 16));
        at += 4;
      } else if (next === undefined) fail();
      else out += ESCAPES[next] ?? next;
    }
    return fail();
  }
  function value(path, depth) {
    if (depth > 40) fail();
    skip();
    const char = text[at];
    if (char === '{') {
      at += 1;
      const seen = new Set();
      skip();
      if (text[at] === '}') { at += 1; return; }
      for (;;) {
        skip();
        if (text[at] !== '"') fail();
        const key = string();
        if (seen.has(key)) found.push(`${path}${key}`);
        seen.add(key);
        skip();
        if (text[at++] !== ':') fail();
        value(`${path}${key}.`, depth + 1);
        skip();
        const next = text[at++];
        if (next === '}') return;
        if (next !== ',') fail();
      }
    } else if (char === '[') {
      at += 1;
      skip();
      if (text[at] === ']') { at += 1; return; }
      for (;;) {
        value(`${path}[].`, depth + 1);
        skip();
        const next = text[at++];
        if (next === ']') return;
        if (next !== ',') fail();
      }
    } else if (char === '"') {
      string();
    } else {
      LITERAL.lastIndex = at;
      const hit = LITERAL.exec(text);
      if (!hit) fail();
      at = LITERAL.lastIndex;
    }
  }
  value('', 0);
  skip();
  if (at !== text.length) fail();
  return found;
}

/** `{ info }` from the call, or `{ problem }`. The info arrives as a JSON string, and an object is accepted as is. */
export function parseInfo(input) {
  const value = asObject(input).info;
  if (plain(value)) return { info: value };
  if (typeof value === 'string') {
    let repeated;
    try {
      repeated = duplicateKeys(value);
    } catch {
      return { problem: PUBLISH_DENY.infoUnreadable };
    }
    if (repeated.length) return { problem: `${PUBLISH_DENY.duplicateKeys}: ${repeated.slice(0, 3).join(', ')}.` };
    try {
      const parsed = parseBigSafe(value);
      if (plain(parsed)) return { info: parsed };
    } catch { /* falls through to the problem below */ }
  }
  return { problem: PUBLISH_DENY.infoUnreadable };
}

/** Every key anywhere in the value that starts with "boost": a paid boost, which no plan here covers. */
export function boostFields(value, path = '', depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') return [];
  const found = [];
  for (const [key, item] of Array.isArray(value) ? value.map((entry, index) => [String(index), entry]) : Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (BOOST.test(key) && item !== undefined && item !== null) found.push(here);
    found.push(...boostFields(item, here, depth + 1));
  }
  return found;
}

/** Keys outside `allowed`, whatever their value, and whatever case: a key may only be spelled exactly as listed. */
export function unlistedFields(object, allowed, label) {
  if (!plain(object)) return [];
  return Object.keys(object).filter(key => !allowed.includes(key)).map(key => `${label}${key}`);
}

/** The asset id in a link of exactly the form https://agentc.3echo.ai/api/mcp/assets/<assetId>/media?token=<signed>, else null. */
export function mediaAssetId(link) {
  const raw = typeof link === 'string' ? link : '';
  if (!raw || /[\s\\]/.test(raw) || raw.includes('#')) return null;
  const prefix = `${MEDIA_ORIGIN}/api/mcp/assets/`;
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash < 1) return null;
  const assetId = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (!ASSET_ID.test(assetId) || !tail.startsWith('media?token=')) return null;
  if (!TOKEN.test(tail.slice('media?token='.length))) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== MEDIA_ORIGIN || url.username || url.password || url.hash || [...url.searchParams.keys()].join() !== 'token') return null;
  return assetId;
}

/**
 * The refusals that need no job: boost settings, a call whose info is unreadable or repeats a key. Returns a plain
 * sentence, or null. Reviewer-step tools are handled by the caller.
 */
export function staticDenial(base, toolInput) {
  const input = asObject(toolInput);
  const parsed = parseInfo(input);
  const root = parsed.info ? { ...input, info: parsed.info } : input;
  const boost = boostFields(root);
  if (boost.length) return `${MISMATCH.boost} (${boost.join(', ')})`;
  if (parsed.problem) return parsed.problem;
  return null;
}

/** Fields the call carries that the approved plan does not describe: any key not spelled exactly as listed. */
export function extraFieldProblems(base, input, info) {
  const found = [
    ...unlistedFields(input, TOP_FIELDS, ''),
    ...unlistedFields(info, INFO_FIELDS, 'info.'),
    ...unlistedFields(info.publicationDate, DATE_FIELDS, 'info.publicationDate.'),
  ];
  for (const [key, allowed] of Object.entries(NETWORK_FIELDS)) found.push(...unlistedFields(info[key], allowed, `info.${key}.`));
  return found;
}
