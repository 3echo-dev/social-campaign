/**
 * The checks a posting plan has to pass before the person is asked to approve it, and the projection the board
 * shows for the publish step. Pure: nothing here reads a file, calls a tool or looks at the clock (the caller
 * passes `now`), so every rule can be tested with plain objects.
 *
 * Input is one intent post, as server/pipeline/publish-intent.mjs writes it:
 *   { id, deliverable, platform, placement, type, text, title, publicationDate:{dateTime, timezone}|null,
 *     media:[{path, kind, bytes, width, height, assetId}], problems:[plain sentence], ... }
 * plus a context the caller builds from what the connection knows:
 *   { route, now (ms), connected, found, coverage:{facebook, instagram, tiktok}|null, studioWorkspace:{name}|null,
 *     hosted: the sha256 of files already in 3echo (not held to the upload size limit) }
 *
 * Every check is `{ ok, text }` and `text` is a plain sentence for the person: no ids, no file paths, no codes.
 * The 'self' route (the person posts it) skips what only Metricool needs: the linked channel, the TikTok title,
 * the posting time, the 3echo upload size and the 3echo workspace.
 *
 * Rules follow what Metricool did when it was tried live: TikTok needs a title, a lead time of a few minutes is
 * accepted, and it does not check the shape of the media, so the shape is checked here before anything is sent.
 */

import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const del = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-deliverable.js'));

export const PUBLISH_ROUTES = Object.freeze(['metricool_schedule', 'metricool_draft', 'metricool_now', 'self']);
export const ROUTE_LABELS = Object.freeze({
  metricool_schedule: 'Schedule with Metricool',
  metricool_draft: 'Save as a draft in Metricool',
  metricool_now: 'Post now (goes out within a few minutes)',
  self: "I'll post it myself",
});
/** What a job planned before Metricool publishing is told: it ends with the hand-off package, and that is all. */
export const HANDOFF_ONLY_TEXT = 'This job was planned before posting through Metricool, so it ends with the hand-off package that you download and post yourself.';

export const isMetricoolRoute = route => typeof route === 'string' && route.startsWith('metricool_');

/** The route a job takes when none was chosen: Metricool scheduling when it can be used, else the person posts it. */
export const defaultRoute = context => (context?.connected && context?.found ? 'metricool_schedule' : 'self');

/** The soonest a scheduled post may be, in minutes from now. */
export const MIN_LEAD_MINUTES = 5;
/** 3echo's per-file limit, the same figure media-host.mjs holds uploads to. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const INSTAGRAM_HASHTAG_LIMIT = 30;
/** Most items in an Instagram carousel and in a TikTok photo post. */
export const CAROUSEL_MAX = 10;
export const TIKTOK_PHOTO_MAX = 35;
export const TIKTOK_TITLE_LIMIT = 90;
/** Caption limits in characters, from pipeline/platform-rules. */
export const CAPTION_LIMITS = Object.freeze({ instagram: 2200, tiktok: 2200, facebook: 63206 });
/** Instagram feed pictures: wider than 4:5, narrower than 1.91:1. */
export const INSTAGRAM_FEED_RATIO = Object.freeze({ min: 4 / 5, max: 1.91 });
const PHONE_RATIO = 9 / 16;
const PHONE_TOLERANCE = 0.02;
const METRICOOL_NETWORKS = Object.freeze(['facebook', 'instagram', 'tiktok']);
const LINKED = new Set(['linked', 'unverified', 'only_in_metricool']);

const count = value => Number(value).toLocaleString('en-US');
const platformName = platform => del.PLATFORM_NAMES[platform] || (typeof platform === 'string' && platform ? platform[0].toUpperCase() + platform.slice(1) : 'This platform');
const characters = text => Array.from(String(text ?? '')).length;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const check = (ok, text) => ({ ok: Boolean(ok), text });
const aOrAn = text => (/^[aeiou]/i.test(text) ? 'an' : 'a');
const sentenceCase = text => text[0].toUpperCase() + text.slice(1);

/** "Instagram Reel": how the person names this post. Falls back to the platform alone. */
export function postLabel(post) {
  return del.placementWords(post?.platform, post?.placement) || platformName(post?.platform);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export function validZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

function zoneOffsetMs(zone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}

/** The moment (ms since 1970) a wall-clock time is in a zone, or null when the text or the zone is not usable. */
export function zonedInstant(dateTime, zone) {
  const match = typeof dateTime === 'string' ? LOCAL_DATE_TIME.exec(dateTime.trim()) : null;
  if (!match || !validZone(zone)) return null;
  const [, year, month, day, hour, minute, second] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0));
  if (Number.isNaN(guess)) return null;
  let instant = guess - zoneOffsetMs(zone, guess);
  instant = guess - zoneOffsetMs(zone, instant);
  return instant;
}

/** The wall-clock time of a moment in a zone, as `YYYY-MM-DDTHH:MM:SS`. */
export function localDateTime(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * The zone as a person says it: "Singapore time" from Asia/Singapore, "New York time" from America/New_York. A zone
 * with no clear city (UTC, Etc/GMT+8) falls back to its short offset at that moment, such as "UTC+8" or "UTC+5:30".
 */
export function zoneWords(zone, instant = Date.now()) {
  const parts = String(zone || '').split('/');
  const city = parts.length > 1 && !/^(etc|utc|gmt)$/i.test(parts[0]) ? parts[parts.length - 1].replace(/_/g, ' ').trim() : '';
  if (city && !/^(gmt|utc)([+-]\d+)?$/i.test(city)) return `${city} time`;
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName')?.value || 'GMT';
  const hit = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(offset);
  if (!hit || !hit[1] || (Number(hit[2]) === 0 && (!hit[3] || hit[3] === '00'))) return 'UTC';
  return `UTC${hit[1]}${Number(hit[2])}${hit[3] && hit[3] !== '00' ? `:${hit[3]}` : ''}`;
}

/** "Sat 3 Oct, 9:00 am, Singapore time", or null when the time cannot be read. */
export function whenText(publicationDate) {
  const instant = zonedInstant(publicationDate?.dateTime, publicationDate?.timezone);
  if (instant === null) return null;
  const zone = publicationDate.timezone;
  // Assembled from parts so the month is always three letters ("Sep", where en-GB says "Sept").
  const dayParts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(instant));
  const dayPart = type => dayParts.find(part => part.type === type)?.value;
  const day = `${dayPart('weekday')} ${dayPart('day')} ${dayPart('month')}`;
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant)).replace(/\s?([AP])M$/i, (_, letter) => ` ${letter.toLowerCase()}m`);
  return `${day}, ${clock}, ${zoneWords(zone, instant)}`;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

function channelCheck(post, context) {
  const name = platformName(post.platform);
  if (!context.connected) return check(false, 'Metricool is not connected, so this post cannot go through it.');
  if (!context.found) return check(false, 'Choose which Metricool brand this brand posts through.');
  if (!METRICOOL_NETWORKS.includes(post.platform)) return check(false, `Metricool cannot post to ${name} from here.`);
  const status = plain(context.coverage) ? context.coverage[post.platform] : undefined;
  if (status === 'unverified') return check(true, `${name} is in Metricool. Check that it is the right account there.`);
  if (LINKED.has(status)) return check(true, `${name} is linked in Metricool.`);
  if (status === 'not_linked') return check(false, `${name} is not linked in Metricool for this brand.`);
  if (status === 'different_handle') return check(false, `${name} in Metricool is a different account from the one on the brand card.`);
  return check(false, `Metricool has no ${name} account for this brand.`);
}

const NEEDS = Object.freeze({
  one_video: 'one video',
  one_picture_or_video: 'one picture or one video',
  pictures: 'two to ten pictures',
  picture: `one to ${TIKTOK_PHOTO_MAX} pictures`,
  any: 'a picture or a video',
});

/** What this post type is made from: `{ need, accepts(kinds) }`, or null when the type is not known. */
function mediaRule(platform, placement) {
  const only = kind => kinds => kinds.length === 1 && kinds[0] === kind;
  if (platform === 'instagram') {
    if (placement === 'reel') return { need: NEEDS.one_video, accepts: only('video') };
    if (placement === 'story') return { need: NEEDS.one_picture_or_video, accepts: kinds => kinds.length === 1 && ['image', 'video'].includes(kinds[0]) };
    if (placement === 'carousel') return { need: NEEDS.pictures, accepts: kinds => kinds.length >= 2 && kinds.length <= CAROUSEL_MAX && kinds.every(kind => kind === 'image') };
    if (placement === 'post') return { need: NEEDS.any, accepts: kinds => kinds.length >= 1 && kinds.every(kind => ['image', 'video'].includes(kind)) };
  }
  if (platform === 'facebook') {
    if (placement === 'reel') return { need: NEEDS.one_video, accepts: only('video') };
    if (placement === 'story') return { need: NEEDS.one_picture_or_video, accepts: kinds => kinds.length === 1 && ['image', 'video'].includes(kinds[0]) };
    if (placement === 'post') return { need: 'words, a picture or a video', accepts: kinds => kinds.every(kind => ['image', 'video'].includes(kind)) };
  }
  if (platform === 'tiktok') {
    if (placement === 'video') return { need: NEEDS.one_video, accepts: only('video') };
    if (placement === 'photo') return { need: NEEDS.picture, accepts: kinds => kinds.length >= 1 && kinds.length <= TIKTOK_PHOTO_MAX && kinds.every(kind => kind === 'image') };
  }
  return null;
}

function haveWords(kinds) {
  if (!kinds.length) return 'nothing';
  const pictures = kinds.filter(kind => kind === 'image').length;
  const videos = kinds.filter(kind => kind === 'video').length;
  const others = kinds.length - pictures - videos;
  const parts = [];
  if (pictures) parts.push(pictures === 1 ? 'one picture' : `${pictures} pictures`);
  if (videos) parts.push(videos === 1 ? 'one video' : `${videos} videos`);
  if (others) parts.push(others === 1 ? 'a file that is not a picture or video' : `${others} files that are not pictures or videos`);
  return parts.join(' and ');
}

/** Whether a post type was never chosen: not written, null or empty. */
export const placementMissing = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());

/** The sentence a post with no post type fails on. The board shows a choice in its place when there is one. */
export const chooseKindText = post => `Choose what kind of ${platformName(post?.platform)} post this is.`;

/**
 * The post types a plan's untyped posts can still be, keyed by post id: for each post whose type is missing, the
 * ones its deliverable can be made into (lib-deliverable.js validPlacementsFor, in the order a person hears them) and its
 * measured media can satisfy; when its media satisfies none, all the deliverable can be, so the failing checks show why.
 * A post with a type, or whose deliverable is not in the list, has no entry. Pure.
 */
export function postTypeChoices(posts, deliverables) {
  const found = {};
  const list = Array.isArray(deliverables) ? deliverables : [];
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!plain(post) || typeof post.id !== 'string' || !placementMissing(post.placement)) continue;
    const deliverable = list.find(item => plain(item) && item.id === post.deliverable);
    const valid = deliverable ? del.validPlacementsFor(deliverable) : [];
    // Only the types the post's measured media can satisfy (the same media, shape and length checks the plan runs); when none can, all of
    // them, so the person still sees why from the checks that stay.
    const fitting = valid.filter(placement => [mediaCheck, shapeCheck, lengthCheck].every(run => run({ ...post, placement })?.ok !== false));
    if (valid.length) found[post.id] = fitting.length ? fitting : valid;
  }
  return found;
}

function placementCheck(post) {
  const name = platformName(post.platform);
  if (!del.placementsFor(post.platform).length) return null;
  if (placementMissing(post.placement)) return check(false, chooseKindText(post));
  if (!del.placementBelongs(post.platform, post.placement)) return check(false, `${sentenceCase(`${aOrAn(name)} ${name}`)} post cannot be ${aOrAn(String(post.placement))} ${post.placement}.`);
  return check(true, `${postLabel(post)} is the post type.`);
}

function mediaCheck(post) {
  const label = postLabel(post);
  const rule = mediaRule(post.platform, post.placement);
  const media = Array.isArray(post.media) ? post.media : [];
  const kinds = media.map(item => item?.kind);
  if (!rule) return null;
  if (rule.accepts(kinds)) return check(true, `${label} has the media it needs.`);
  return check(false, `${label} needs ${rule.need}, and this has ${haveWords(kinds)}.`);
}

function shapeWord(kind) {
  return kind === 'video' ? 'video' : 'picture';
}

/** The shape of every picture and video against what this post type allows. Null when the type has no shape rule. */
function shapeCheck(post) {
  const label = postLabel(post);
  const media = Array.isArray(post.media) ? post.media : [];
  const phone = del.isVerticalOnly(post.platform, post.placement);
  const feed = post.platform === 'instagram' && (post.placement === 'post' || post.placement === 'carousel');
  if (!phone && !feed) return null;
  const problems = [];
  for (const item of media) {
    if (!item || (item.kind !== 'image' && item.kind !== 'video')) continue;
    if (feed && item.kind !== 'image') continue;
    const width = Number(item.width);
    const height = Number(item.height);
    if (!(width > 0) || !(height > 0)) {
      problems.push(`The shape of the ${shapeWord(item.kind)} could not be read, so it could not be checked against ${label}.`);
      continue;
    }
    const ratio = width / height;
    if (phone && Math.abs(ratio - PHONE_RATIO) > PHONE_TOLERANCE) {
      problems.push(`The ${shapeWord(item.kind)} is ${count(width)} by ${count(height)} pixels. ${sentenceCase(`${aOrAn(label)} ${label}`)} needs 9:16, the shape of a phone screen.`);
    } else if (feed && (ratio < INSTAGRAM_FEED_RATIO.min - 0.005 || ratio > INSTAGRAM_FEED_RATIO.max + 0.005)) {
      problems.push(`The picture is ${count(width)} by ${count(height)} pixels. An Instagram post picture must be between 4:5 and 1.91:1.`);
    }
  }
  if (problems.length) return check(false, [...new Set(problems)].join(' '));
  if (!media.some(item => item && (item.kind === 'image' || item.kind === 'video') && (!feed || item.kind === 'image'))) return null;
  return check(true, phone ? `The media is 9:16, as ${label} needs.` : 'The picture shape suits an Instagram post.');
}

/** How long a video may be, in seconds, for each post type that has a limit. */
export const VIDEO_LENGTHS = Object.freeze({
  'instagram:reel': Object.freeze({ min: 3, max: 15 * 60 }),
  'instagram:story': Object.freeze({ min: null, max: 60 }),
  'facebook:reel': Object.freeze({ min: 3, max: 90 }),
  'tiktok:video': Object.freeze({ min: 3, max: 10 * 60 }),
});

function lengthWords(seconds) {
  const whole = Math.round(seconds * 10) / 10;
  if (whole > 120 && whole % 60 === 0) return `${whole / 60} minutes`;
  return `${whole} ${whole === 1 ? 'second' : 'seconds'}`;
}

/** The length of each video against what this post type allows. Null when the type has no length rule or has no video. */
function lengthCheck(post) {
  const limit = VIDEO_LENGTHS[`${post.platform}:${post.placement}`];
  const videos = (Array.isArray(post.media) ? post.media : []).filter(item => item && item.kind === 'video');
  if (!limit || !videos.length) return null;
  const label = postLabel(post);
  const problems = [];
  for (const item of videos) {
    const seconds = Number(item.durationSeconds);
    if (!(seconds > 0)) {
      problems.push(`The length of the video could not be read, so it could not be checked against ${label}.`);
      continue;
    }
    const long = lengthWords(seconds);
    const range = limit.min === null ? `can be at most ${lengthWords(limit.max)}` : `must be between ${lengthWords(limit.min)} and ${lengthWords(limit.max)}`;
    if ((limit.min !== null && seconds < limit.min) || seconds > limit.max) problems.push(`The video is ${long} long. ${sentenceCase(`${aOrAn(label)} ${label}`)} ${range}.`);
  }
  if (problems.length) return check(false, [...new Set(problems)].join(' '));
  return check(true, `The video length suits ${label}.`);
}

function captionCheck(post) {
  const limit = CAPTION_LIMITS[post.platform];
  if (!limit) return null;
  const length = characters(post.text);
  const name = platformName(post.platform);
  if (length > limit) return check(false, `The caption is ${count(length)} characters, over the ${count(limit)} ${name} allows.`);
  return check(true, `The caption is ${count(length)} of ${count(limit)} characters.`);
}

function hashtagCheck(post) {
  if (post.platform !== 'instagram') return null;
  const total = (String(post.text ?? '').match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (total > INSTAGRAM_HASHTAG_LIMIT) return check(false, `${total} hashtags is over Instagram's limit of ${INSTAGRAM_HASHTAG_LIMIT}.`);
  return check(true, `${total === 1 ? '1 hashtag' : `${total} hashtags`}, within Instagram's limit of ${INSTAGRAM_HASHTAG_LIMIT}.`);
}

function titleCheck(post) {
  if (post.platform !== 'tiktok') return null;
  const title = typeof post.title === 'string' ? post.title.trim() : '';
  if (!title) return check(false, 'TikTok needs a title, taken from the first line of the caption, and this caption has none.');
  if (characters(title) > TIKTOK_TITLE_LIMIT) return check(false, `The TikTok title is over ${TIKTOK_TITLE_LIMIT} characters.`);
  return check(true, 'The TikTok title is set.');
}

/** What a post with no posting time fails on. The card's time input sits right under it, so there is nothing to explain. */
export const NEEDS_TIME_TEXT = 'Choose when this post goes out.';
/** A draft needs a date in the planner too, but nothing goes out. */
export const NEEDS_DRAFT_DATE_TEXT = 'Choose the date for this draft.';
/** No time can be read, or chosen, until the person says which zone these posts are in. */
export const NEEDS_ZONE_TEXT = 'Tell Claude which time zone these posts are in.';

function timeCheck(post, context) {
  if (context.route === 'metricool_now') return check(true, 'Goes out within a few minutes of your approval.');
  const date = post.publicationDate;
  if (!plain(date) || !date.dateTime) {
    // `zone: null` is a plan that knows no zone at all (a context with no zone key says nothing about it): no input can be offered, so say who has to act.
    if (context.zone === null && !validZone(date?.timezone)) return check(false, NEEDS_ZONE_TEXT);
    return check(false, context.route === 'metricool_draft' ? NEEDS_DRAFT_DATE_TEXT : NEEDS_TIME_TEXT);
  }
  if (!validZone(date.timezone)) return check(false, 'The posting time has no time zone, so Metricool cannot place it. Say which time zone it is in.');
  const instant = zonedInstant(date.dateTime, date.timezone);
  if (instant === null) return check(false, 'The posting time could not be read as a date and a time.');
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const when = whenText(date);
  if (instant < now) return check(false, `The posting time has already passed: ${when}. Pick a time at least ${MIN_LEAD_MINUTES} minutes ahead.`);
  if (instant < now + MIN_LEAD_MINUTES * 60 * 1000) return check(false, `The posting time is less than ${MIN_LEAD_MINUTES} minutes away: ${when}. Pick a time at least ${MIN_LEAD_MINUTES} minutes ahead.`);
  return check(true, context.route === 'metricool_draft' ? `Saved for ${when}.` : `Goes out ${when}.`);
}

function hostedSet(context) {
  const hosted = context.hosted;
  if (hosted instanceof Set) return hosted;
  return new Set(Array.isArray(hosted) ? hosted : plain(hosted) ? Object.keys(hosted) : []);
}

// Only a file that still has to be uploaded is held to 3echo's limit: one already in 3echo (generated there, or
// uploaded before) is not sent again. The text names the kind of file, never its name.
function sizeCheck(post, context) {
  const hosted = hostedSet(context);
  const media = (Array.isArray(post.media) ? post.media : []).filter(item => item && Number(item.bytes) >= 0 && !hosted.has(item.sha256));
  if (!media.length) return null;
  const big = media.filter(item => Number(item.bytes) > MAX_FILE_BYTES);
  if (big.length) {
    return check(false, big.map(item => `The ${item.kind === 'video' ? 'video' : 'picture'} is ${count(Math.round(Number(item.bytes) / 1024 / 1024))} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit for uploading to 3echo.`).join(' '));
  }
  return check(true, `The ${media.length === 1 ? 'file is' : 'files are'} within the ${MAX_FILE_BYTES / 1024 / 1024} MB upload limit.`);
}

// Needed whenever a post has media, hosted already or not: media-host.mjs answers only for the workspace the
// approved plan names, so a plan without one cannot upload a file or even look one up.
function workspaceCheck(post, context) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (!media.length) return null;
  const name = plain(context.studioWorkspace) ? context.studioWorkspace.name : null;
  if (!plain(context.studioWorkspace) || !context.studioWorkspace.id) return check(false, 'Choose which 3echo workspace the media is uploaded to.');
  return check(true, name ? `The media is uploaded to your 3echo workspace ${name}.` : 'The media is uploaded to your 3echo workspace.');
}

/** The checks for one post, in the order the person reads them. */
export function preflightPost(post, context = {}) {
  const route = PUBLISH_ROUTES.includes(context.route) ? context.route : 'self';
  const metricool = isMetricoolRoute(route);
  const ctx = { ...context, route };
  const checks = [];
  const add = result => { if (result) checks.push(result); };
  if (metricool) add(channelCheck(post, ctx));
  add(placementCheck(post));
  for (const problem of Array.isArray(post.problems) ? post.problems : []) add(check(false, String(problem)));
  add(mediaCheck(post));
  add(shapeCheck(post));
  add(lengthCheck(post));
  add(captionCheck(post));
  add(hashtagCheck(post));
  if (metricool) {
    add(titleCheck(post));
    add(timeCheck(post, ctx));
    add(sizeCheck(post, ctx));
    add(workspaceCheck(post, ctx));
  }
  return checks;
}

/** Every post's checks and whether the whole plan is ready. No posts is never ready. */
export function preflightIntent(intent, context = {}) {
  const posts = Array.isArray(intent?.posts) ? intent.posts : [];
  const ctx = { ...context, route: context.route ?? intent?.route, studioWorkspace: context.studioWorkspace ?? intent?.studioWorkspace ?? null };
  const results = {};
  for (const post of posts) results[post.id] = preflightPost(post, ctx);
  const ready = posts.length > 0 && posts.every(post => results[post.id].every(item => item.ok));
  return { posts: results, ready };
}

// ---------------------------------------------------------------------------
// What the board shows
// ---------------------------------------------------------------------------

/** The four routes with whether each can be chosen now, and why not. */
export function routeOptions(context = {}) {
  // A job planned before 0.8 can only end with the hand-off package: posting it yourself is the one way out.
  if (context.handoffOnly) return [{ id: 'self', label: ROUTE_LABELS.self, available: true, reason: null }];
  const connected = Boolean(context.connected);
  const found = Boolean(context.found);
  const why = !connected ? 'Connect Metricool first.' : !found ? 'Choose which Metricool brand this brand posts through.' : null;
  return PUBLISH_ROUTES.map(id => {
    const needsMetricool = isMetricoolRoute(id);
    return { id, label: ROUTE_LABELS[id], available: !needsMetricool || !why, reason: needsMetricool ? why : null };
  });
}

function accountOf(platform, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  if (platform === 'facebook') return /^\d+$/.test(raw) ? null : raw;
  return raw.startsWith('@') ? raw : `@${raw}`;
}

/**
 * What the Schedule route's date and time input needs: the zone the person's time is read in (the post's own, else the plan's),
 * how that zone is said ("Singapore time"), and the time now set as `YYYY-MM-DDTHH:MM` local to that zone, or '' when there is none.
 * Null when no zone is known, because a time cannot be read without one.
 */
/** What the draft route's date is called, with the zone it is read in: Metricool needs a date for a draft, but a draft is never published. */
export const draftDateLabel = words => `Date in your Metricool planner, ${words} (a draft is not published)`;

function timeInput(post, planZone, route) {
  const date = plain(post.publicationDate) ? post.publicationDate : null;
  const zone = [date?.timezone, planZone].find(validZone);
  if (!zone) return null;
  const instant = date?.dateTime && validZone(date.timezone) ? zonedInstant(date.dateTime, date.timezone) : null;
  return { zone, zoneWords: zoneWords(zone, instant ?? Date.now()), dateTime: instant === null ? '' : localDateTime(instant, zone).slice(0, 16), ...(route === 'metricool_draft' ? { label: draftDateLabel(zoneWords(zone, instant ?? Date.now())) } : {}) };
}

function whenFor(post, route, planZone) {
  if (route === 'metricool_now') return { text: 'Goes out within a few minutes of your approval' };
  const text = whenText(post.publicationDate);
  let when;
  if (text) when = { text };
  else if (plain(post.publicationDate) && post.publicationDate.dateTime) when = { text: `${post.publicationDate.dateTime.replace('T', ' ')} (time zone not set)` };
  else when = { text: route === 'self' ? 'When you choose' : 'No posting time set' };
  // Schedule and draft take a date from the person here (Metricool needs one for a draft too, which says so). Post now needs none,
  // and posting it yourself is your own time.
  const input = route === 'metricool_schedule' || route === 'metricool_draft' ? timeInput(post, planZone, route) : null;
  return input ? { ...when, input } : when;
}

// Through Metricool the label is set for the person. When they post it themselves nothing sets it, so the line says
// what they have to do.
function aiLabelFor(post, route) {
  if (!post.aiGenerated) return null;
  if (route === 'self') return post.platform === 'tiktok' ? 'Turn on the AI-generated label when you post' : 'Mark it as made with AI when you post';
  return post.platform === 'tiktok' ? 'Labelled as AI-generated on TikTok' : 'Marked as made with AI';
}

/** The post types a post with none can be chosen as, as { value, label } for the board's select; empty when it has a type or none fits. */
function typeKinds(post, choices) {
  if (!placementMissing(post?.placement) || !plain(choices) || !Array.isArray(choices[post.id])) return [];
  return choices[post.id].filter(id => del.placementBelongs(post.platform, id)).map(id => ({ value: id, label: sentenceCase(del.PLACEMENT_NOUNS[id]) }));
}

/**
 * The card-level "same time for every post" field, or null when it does not apply: only on Schedule and Draft, only for two or more
 * posts (one post has its own field), and only when every post can take a time. `state` is 'none' (no post has a time: this field is
 * the main control and each row says it uses it), 'shared' (every post has the one same time, shown with Change) or 'mixed'
 * (the posts differ). The zone is the one the posts share, else the plan's. Pure.
 */
function allTimeOf(posts, route, planZone) {
  if ((route !== 'metricool_schedule' && route !== 'metricool_draft') || posts.length < 2 || posts.some(post => !post.when?.input)) return null;
  const zones = new Set(posts.map(post => post.when.input.zone));
  const zone = zones.size === 1 ? [...zones][0] : planZone;
  if (!validZone(zone)) return null;
  const times = posts.map(post => post.when.input.dateTime);
  const set = times.filter(Boolean);
  const state = !set.length ? 'none' : set.length === posts.length && zones.size === 1 && new Set(times).size === 1 ? 'shared' : 'mixed';
  const words = zoneWords(zone, Date.now());
  return {
    state,
    zone,
    zoneWords: words,
    dateTime: state === 'shared' ? times[0] : '',
    text: state === 'shared' ? posts[0].when.text : '',
    label: route === 'metricool_draft' ? `Same date for every draft, ${words} (a draft is not published)` : `Same time for every post, ${words}`,
  };
}

/**
 * The `review.publish` block of the job document: the route and the routes on offer, where posts go, and one row
 * per post with its account, time, media and checks. The checks are run again now, so a posting time that has
 * passed since the plan was made shows as failing. `context` is what preflightPost takes plus
 * `{ label, networks }` (the Metricool brand's name and its linked accounts) and `blogId` (the chosen brand).
 * `typeChoices` (postTypeChoices) lets a post with no post type carry the choices the board shows for it.
 */
export function projectPublish(intent, context = {}) {
  if (!plain(intent)) return null;
  const route = PUBLISH_ROUTES.includes(intent.route) ? intent.route : 'self';
  const networks = plain(context.networks) ? context.networks : {};
  // The zone the plan speaks in (`context.zone`, or the fresh evaluation's): null when it is known that there is none.
  const zoneEvaluation = plain(context.evaluation) ? context.evaluation : null;
  const zoneGiven = context.zone !== undefined || zoneEvaluation?.zone !== undefined;
  const live = preflightIntent(intent, { ...context, route, ...(zoneGiven ? { zone: [context.zone, zoneEvaluation?.zone].find(validZone) || null } : {}) });
  const metricool = isMetricoolRoute(route);
  // While a plan exists, the destination is the plan's own Metricool brand, not whatever is chosen now.
  const planLabel = typeof intent.metricoolLabel === 'string' && intent.metricoolLabel ? intent.metricoolLabel : null;
  const nowLabel = typeof context.label === 'string' && context.label ? context.label : null;
  const label = planLabel || nowLabel;
  // The plan no longer matches what is chosen now: another Metricool brand, another route, another 3echo workspace.
  // A job planned before Metricool publishing can only be posted by the person, whatever is saved or connected.
  const wantedRoute = context.handoffOnly ? 'self' : context.jobRoute || defaultRoute(context);
  const wrongBrand = metricool && Boolean(context.found) && Boolean(context.blogId) && String(intent.blogId ?? '') !== String(context.blogId);
  const wrongRoute = wantedRoute !== route;
  const wrongWorkspace = context.workspaceId !== undefined && (context.workspaceId || null) !== (plain(intent.studioWorkspace) ? intent.studioWorkspace.id || null : null);
  const outdated = wrongBrand || wrongRoute || wrongWorkspace;
  // When the plan is out of date this is the reason, as one plain sentence the board shows as it is.
  const planName = typeof intent.metricoolLabel === 'string' && intent.metricoolLabel ? intent.metricoolLabel : 'the one it was made for';
  const nowName = typeof context.label === 'string' && context.label ? context.label : 'another one';
  const outdatedReason = !outdated ? null
    : wrongBrand ? `The Metricool brand changed from ${planName} to ${nowName}, so the plan is being rebuilt.`
      : wrongRoute ? 'How these posts go out changed after the plan was made, so the plan is being rebuilt.'
        : 'The 3echo workspace changed after the plan was made, so the plan is being rebuilt.';
  // The evaluation approval uses (a fresh build with live checks), when the caller ran it: the card is ready only if
  // approval would accept it, and it says why not.
  const evaluation = plain(context.evaluation) ? context.evaluation : null;
  const changed = Boolean(context.changed) || Boolean(evaluation?.changed);
  const workspace = plain(intent.studioWorkspace) && intent.studioWorkspace.name ? { name: String(intent.studioWorkspace.name) } : null;
  const ready = live.ready && !outdated && !changed && (!evaluation || evaluation.ready === true) && (!metricool || (Boolean(context.connected) && Boolean(context.found)));
  const failingText = Object.values(live.posts).flat().find(item => !item.ok)?.text || null;
  // The zone a time is read in when the post has none yet: the plan's own, as the fresh build worked it out.
  const planZone = [context.zone, evaluation?.zone].find(validZone) || null;
  const projection = {
    route,
    routes: routeOptions(context),
    metricool: metricool && label ? { label } : null,
    studioWorkspace: workspace,
    posts: (Array.isArray(intent.posts) ? intent.posts : []).map(post => {
      const kinds = typeKinds(post, context.typeChoices);
      return {
        id: post.id,
        deliverable: typeof post.deliverable === 'string' ? post.deliverable : null,
        label: postLabel(post),
        text: typeof post.text === 'string' ? post.text : '',
        title: typeof post.title === 'string' && post.title ? post.title : null,
        firstComment: typeof post.firstComment === 'string' ? post.firstComment : '',
        account: accountOf(post.platform, networks[post.platform]),
        when: whenFor(post, route, planZone),
        media: (Array.isArray(post.media) ? post.media : []).map(item => ({ name: basename(String(item?.path || '')), path: typeof item?.path === 'string' ? item.path : null, kind: item?.kind || null })),
        // A post with no post type shows the choice in place of the sentence that says to choose.
        checks: kinds.length ? live.posts[post.id].filter(item => !(item.ok === false && item.text === chooseKindText(post))) : live.posts[post.id],
        ...(kinds.length ? { typeChoices: kinds } : {}),
        aiLabel: aiLabelFor(post, route),
      };
    }),
    ready,
    reason: ready ? null : outdatedReason || evaluation?.reason || failingText || (changed ? 'The posting plan changed after it was shown, so it has to be shown again.' : 'There is nothing to post yet.'),
    outdated: Boolean(outdated),
    changed,
  };
  const allTime = allTimeOf(projection.posts, route, planZone);
  return allTime ? { ...projection, allTime } : projection;
}
