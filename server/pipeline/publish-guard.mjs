/**
 * The decision behind the Metricool send guard (scripts/hooks/publish-pre.mjs): may this createScheduledPost call go out, and
 * if so, reserve it first. updateScheduledPost is never allowed in a pipeline workspace: a scheduled post is
 * changed or cancelled by the person, in Metricool.
 *
 * It allows a call only when all of this holds:
 *  - the session is bound to a job (in a pipeline workspace an unlinked call is refused);
 *  - the job's latest publish approval is current for publish/intent.json (media-host.readApprovedIntent, the same
 *    check uploads use), and the intent is a Metricool route, not "I'll post it myself";
 *  - the call is exactly one unsent post of that plan: the brand, a single network, the post type, the text word for
 *    word, the TikTok title, the time (an explicit offset; for "post now", 3 to 30 minutes from now and within a day of
 *    the approval), draft, automatic publishing, the first comment, the AI-made label and every other setting, and
 *    nothing else that changes what is posted (a key not in the list, a repeated key, boost);
 *  - every media link is https://agentc.3echo.ai/api/mcp/assets/<assetId>/media?token=... for the asset that
 *    publish/hosted-media.json (or a 3echo generation landed in that same, known workspace) holds for that file's sha256,
 *    and is a link 3echo itself returned a moment ago (read by the hook from the real get_asset reply, with the workspace
 *    the reply names) for a file whose size, and hash when 3echo reports one, is the approved file's, so replaced bytes
 *    are not sent. No media file is read here: files are known by the sha256 and size the plan records;
 *  - the plan's checks pass now (publish-preflight, run live: channel linked, media fits the post type, time ahead, ...);
 *  - no earlier send of the post is waiting for a result (reserved or unknown): that is looked up and reconciled first;
 *  - the job's send log can be read: the guard works from the merge of the job's file and its copy outside the workspace.
 * The reservation is written in the same step as the last check, under a lock. Anything that cannot be checked refuses.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { readJsonFile } from '../lib/json.mjs';
import { inPipelineWorkspace, jobAt, readSessionBinding, resolveWorkspaceRoot } from './facts.mjs';
import { hostedAssetBySha, latestPublishApproval, readApprovedIntent } from './media-host.mjs';
import { metricoolConnected, readMetricoolBrands } from './metricool.mjs';
import { attemptState, inputDigest, latestAsset, postFingerprint, readAssetReads, readAttempts, readMarkedPosts, reserveAttempt } from './publish-attempts.mjs';

// A post the person marked as posted themselves is final: it is never sent.
const MARKED_BY_PERSON = 'You marked this post as posted yourself, so it will not be sent.';
const HANDED_OVER = 'This post was handed over to the person to post themselves, so it will not be sent.';
import { hostedShasOf, publishContext } from './publish-intent.mjs';
import { isMetricoolRoute, preflightPost, validZone, zonedInstant } from './publish-preflight.mjs';
import { MISMATCH as M, NETWORK_FIELDS, PUBLISH_DENY as D, PUBLISH_NO_JOB_WARNING, asObject, extraFieldProblems, isEmptyValue, isPublishTool, isReviewerTool, mediaAssetId, parseInfo, plain, staticDenial, toolBase, updateRefusal } from './publish-tools.mjs';

/** "Post now" may be scheduled this far from now. */
export const NOW_LEAD = Object.freeze({ min: 3 * 60 * 1000, max: 30 * 60 * 1000 });
/** "Post now" is only allowed this long after the person approved the plan. */
export const POST_NOW_VALID_MS = 24 * 60 * 60 * 1000;
/** A media link read from 3echo is trusted this long (the link itself lasts about ten minutes). */
export const ASSET_READ_MAX_AGE_MS = 15 * 60 * 1000;
const EXPLICIT_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

const text = value => (typeof value === 'string' ? value.trim() : '');
const isText = value => typeof value === 'string';
/** No picture descriptions: absent, empty, or a list holding only nulls and empty text (what Metricool itself fills in). */
const noAltText = value => isEmptyValue(value) || (Array.isArray(value) && value.every(item => item === null || item === undefined || (isText(item) && !item.trim())));
const deny = reason => ({ deny: reason });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sentences = list => [...new Set(list)].slice(0, 3).join(' ');

const APPROVAL_DENY = Object.freeze({
  not_approved: D.noApproval,
  plan_changed: D.planChanged,
  no_plan: D.noPlan,
  intent_unreadable: D.planUnreadable,
});

// ---------------------------------------------------------------------------
// The call against one post of the plan (no files read)
// ---------------------------------------------------------------------------

/** When the person's latest publish decision was recorded, as the approval writes it ("2026-10-01 20:00 +08:00"), or null. */
function decidedAtMs(jobDir) {
  const said = String(latestPublishApproval(jobDir)?.decidedAt ?? '').trim().replace(' ', 'T').replace(/ ([+-]\d\d:\d\d)$/, '$1');
  const parsed = Date.parse(said);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeProblems(post, intent, call, now, planZone, decidedAt) {
  const { input, info } = call;
  const out = [];
  const date = info.publicationDate;
  if (typeof input.date !== 'string' || !EXPLICIT_OFFSET.test(input.date.trim())) return [M.dateOffset];
  const instant = plain(date) ? zonedInstant(date.dateTime, date.timezone) : null;
  const top = Date.parse(input.date.trim());
  if (instant === null || !Number.isFinite(top) || top !== instant) return [M.date];
  if (intent.route === 'metricool_now') {
    const lead = instant - now;
    if (lead < NOW_LEAD.min || lead > NOW_LEAD.max) out.push(M.window);
    const zone = text(post.publicationDate?.timezone) || planZone;
    if (zone && date.timezone !== zone) out.push(M.date);
    if (decidedAt === null || now - decidedAt > POST_NOW_VALID_MS || decidedAt > now + 60 * 1000) out.push(D.postNowExpired);
    return out;
  }
  if (!plain(post.publicationDate)) return [M.noDate];
  const planned = zonedInstant(post.publicationDate.dateTime, post.publicationDate.timezone);
  if (planned === null || planned !== instant || date.timezone !== post.publicationDate.timezone) out.push(M.date);
  return out;
}

function networkProblems(post, call) {
  const { info } = call;
  const out = [];
  const providers = info.providers;
  const single = Array.isArray(providers) && providers.length === 1 && plain(providers[0]) && Object.keys(providers[0]).length === 1
    && isText(providers[0].network) && providers[0].network.toLowerCase() === post.platform;
  if (!single) out.push(M.network);
  const own = `${post.platform}Data`;
  const data = plain(info[own]) ? info[own] : {};
  for (const key of Object.keys(NETWORK_FIELDS)) if (key !== own && !isEmptyValue(info[key])) out.push(M.otherNetworkData);
  if (post.platform === 'instagram' || post.platform === 'facebook') {
    if (!post.type || !isText(data.type) || data.type.toUpperCase() !== post.type) out.push(M.type);
  }
  if (post.platform === 'instagram') {
    const feed = data.showReelOnFeed;
    if (feed !== undefined && typeof feed !== 'boolean') out.push(M.showReel);
    else if ((feed === true) !== (post.type === 'REEL')) out.push(M.showReel);
  }
  if (post.platform === 'tiktok') {
    if (!text(post.title) || data.title !== post.title) out.push(M.title);
    if (!post.tiktok?.privacyOption || data.privacyOption !== post.tiktok.privacyOption) out.push(M.tiktok);
    if ((data.commercialContentOwnBrand === true) !== Boolean(post.tiktok?.commercialContentOwnBrand) || data.commercialContentThirdParty === true) out.push(M.tiktok);
    for (const key of ['autoAddMusic', 'disableComment', 'disableDuet', 'disableStitch']) {
      if (data[key] !== undefined && data[key] !== false) out.push(M.tiktok);
    }
  }
  const label = post.platform === 'tiktok' ? data.isAigc : data.isAiGenerated;
  const wanted = Boolean(post.aiGenerated);
  if (label !== undefined && label !== null && typeof label !== 'boolean') out.push(M.ai);
  else if (post.platform === 'facebook' ? (label !== undefined && label !== null && label !== wanted) : (label === true) !== wanted) out.push(M.ai);
  return out;
}

/** Every way this call is not this post, without reading any file. An empty list means it matches. */
function mismatches(post, intent, call, now, planZone, decidedAt) {
  const { input, info } = call;
  const out = [];
  if (!isText(input.blogId) && !(typeof input.blogId === 'number' && Number.isFinite(input.blogId))) out.push(M.types);
  else if (!intent.blogId || String(input.blogId) !== String(intent.blogId)) out.push(M.blog);
  out.push(...networkProblems(post, call));
  if (typeof info.text !== 'string' || info.text !== post.text) out.push(M.text);
  if ((info.firstCommentText !== undefined && info.firstCommentText !== null && !isText(info.firstCommentText)) || String(info.firstCommentText ?? '') !== String(post.firstComment ?? '')) out.push(M.firstComment);
  if (!noAltText(info.mediaAltText)) out.push(M.altText);
  if (info.draft !== Boolean(post.draft)) out.push(M.draft);
  if (info.autoPublish !== Boolean(post.autoPublish)) out.push(M.autoPublish);
  out.push(...timeProblems(post, intent, call, now, planZone, decidedAt));
  const links = Array.isArray(info.media) ? info.media : info.media === undefined || info.media === null ? [] : null;
  const media = Array.isArray(post.media) ? post.media : [];
  if (links === null || links.length !== media.length) out.push(M.mediaCount);
  else if (links.some(link => mediaAssetId(link) === null)) out.push(M.mediaHost);
  return out;
}

// ---------------------------------------------------------------------------
// The media (no file read)
// ---------------------------------------------------------------------------

/**
 * The reasons a post's media links are not the approved bytes. No media file is read: each file is known by the sha256
 * and size the approved plan records, the asset by what the plugin recorded when it was uploaded (or generated) in the
 * plan's workspace, and 3echo's own answer, read by the hook, says the asset is that size and in that workspace.
 */
function mediaProblems(post, intent, call, job, reads, now) {
  const out = [];
  const planWorkspace = text(intent.studioWorkspace?.id);
  const media = Array.isArray(post.media) ? post.media : [];
  for (let index = 0; index < media.length; index += 1) {
    const entry = media[index];
    const link = call.info.media[index];
    const hosted = planWorkspace && isText(entry.sha256) ? hostedAssetBySha(job.dir, entry.sha256.toLowerCase(), planWorkspace) : null;
    if (!hosted?.assetId || !hosted.workspaceId || hosted.workspaceId !== planWorkspace) {
      out.push(M.mediaMissing);
      continue;
    }
    if (mediaAssetId(link) !== hosted.assetId) {
      out.push(M.mediaAsset);
      continue;
    }
    const seen = latestAsset(reads, hosted.assetId, sha256(link));
    if (!seen) {
      out.push(M.mediaFresh);
      continue;
    }
    const read = Date.parse(seen.at || '');
    const expires = Date.parse(seen.expiresAt || '');
    if (!Number.isFinite(read) || now - read > ASSET_READ_MAX_AGE_MS || (Number.isFinite(expires) && expires <= now)) {
      out.push(M.mediaStale);
      continue;
    }
    if (typeof seen.sizeBytes !== 'number' || !Number.isFinite(Number(entry.bytes)) || seen.sizeBytes !== Number(entry.bytes)) {
      out.push(M.mediaSize);
      continue;
    }
    if (Array.isArray(seen.hashes) && seen.hashes.length && !seen.hashes.includes(String(entry.sha256).toLowerCase())) {
      out.push(M.mediaHash);
      continue;
    }
    if (seen.workspaceId !== planWorkspace) out.push(M.mediaWorkspace);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

function connectionOf(job) {
  const brandDir = join(job.root, 'workspaces', job.brand);
  const profile = readJsonFile(join(brandDir, 'brand', 'profile.json'), null);
  return publishContext({
    brandDir,
    channels: plain(profile) ? profile.channels : null,
    brands: readMetricoolBrands(job.root),
    connected: metricoolConnected(job.root),
  });
}

function planZoneOf(job, intent, connection) {
  const given = [intent.timezone, readJsonFile(join(job.dir, 'job.json'), null)?.schedule?.timezone, connection.timezone];
  return given.map(text).find(zone => zone && validZone(zone)) || null;
}

function closestMismatch(posts, intent, call, now, planZone, decidedAt) {
  let best = null;
  for (const post of posts) {
    const list = mismatches(post, intent, call, now, planZone, decidedAt);
    if (!best || list.length < best.length) best = list;
  }
  return best || [];
}

/**
 * Judge one PreToolUse event for a Metricool tool. Returns null (not one of these tools, or nothing to say),
 * `{ warn }` (allowed, with a note), or `{ deny }` (a plain sentence). Writes the reservation when it allows a send.
 */
/** The link to a sent post in Metricool, when the call names one the log knows (by uuid or id), else null. Never throws. */
function knownPlannerUrl(job, input, info) {
  try {
    const named = [input.uuid, info?.uuid, input.id, info?.id].filter(value => typeof value === 'string' || typeof value === 'number').map(value => String(value).trim()).filter(Boolean);
    if (!named.length) return null;
    const hit = readAttempts(job.dir).find(entry => entry.kind === 'sent' && entry.plannerUrl && (named.includes(String(entry.uuid)) || named.includes(String(entry.id))));
    return hit ? hit.plannerUrl : null;
  } catch {
    return null;
  }
}

export async function judgePublishCall(event, { now = Date.now(), stopped = () => false } = {}) {
  const base = toolBase(event.tool_name);
  if (!isPublishTool(base)) return null;
  if (isReviewerTool(base)) return deny(D.reviewer);
  const input = asObject(event.tool_input);
  const early = staticDenial(base, input);
  if (early) return deny(early);
  const { info } = parseInfo(input);

  const root = resolveWorkspaceRoot(event.cwd);
  const bound = root ? readSessionBinding(root, event.session_id) : null;
  const job = bound ? jobAt(root, bound.brand, bound.jobId) : null;
  if (base === 'updateScheduledPost') {
    if (!job && !root && !inPipelineWorkspace(event.cwd)) return { warn: PUBLISH_NO_JOB_WARNING };
    return deny(updateRefusal(job ? knownPlannerUrl(job, input, info) : null));
  }
  if (!job) return root || inPipelineWorkspace(event.cwd) ? deny(D.noJob) : { warn: PUBLISH_NO_JOB_WARNING };

  const extra = extraFieldProblems(base, input, info);
  if (extra.length) return deny(`${D.extraFields}: ${extra.join(', ')}.`);

  const approved = readApprovedIntent(job.dir);
  if (!approved.ok) return deny(APPROVAL_DENY[approved.code] || D.planUnreadable);
  const intent = approved.document;
  if (intent.version !== 1 || !Array.isArray(intent.posts) || !intent.posts.every(plain)) return deny(D.planUnreadable);
  if (intent.jobId !== job.jobId) return deny(D.otherJob);
  if (intent.route === 'self') return deny(D.selfRoute);
  if (!isMetricoolRoute(intent.route) || !intent.blogId) return deny(D.notMetricool);

  let entries;
  try {
    entries = readAttempts(job.dir, { strict: true });
  } catch {
    return deny(D.logUnreadable);
  }
  const connection = connectionOf(job);
  if (connection.blogId && String(connection.blogId) !== String(intent.blogId)) return deny(D.blogChanged);
  const planZone = planZoneOf(job, intent, connection);
  const decidedAt = intent.route === 'metricool_now' ? decidedAtMs(job.dir) : null;
  const call = { base, input, info };

  let post;
  let marked;
  try {
    marked = readMarkedPosts(job.dir, { strict: true });
  } catch {
    return deny(D.logUnreadable);
  }
  const states = intent.posts.map(item => ({ item, state: attemptState(entries, item.id) }));
  const open = states.filter(({ item, state }) => !state.sent && !marked.has(item.id) && !state.handedOver).map(({ item }) => item);
  const alreadySent = states.filter(({ state }) => state.sent).map(({ item }) => item).filter(item => !mismatches(item, intent, call, now, planZone, decidedAt).length);
  const alreadyMarked = states.filter(({ item, state }) => !state.sent && marked.has(item.id)).map(({ item }) => item).filter(item => !mismatches(item, intent, call, now, planZone, decidedAt).length);
  const alreadyHanded = states.filter(({ item, state }) => !state.sent && !marked.has(item.id) && state.handedOver).map(({ item }) => item).filter(item => !mismatches(item, intent, call, now, planZone, decidedAt).length);
  if (!open.length) return deny(alreadyHanded.length ? HANDED_OVER : D.allSent);
  const matched = open.filter(item => !mismatches(item, intent, call, now, planZone, decidedAt).length);
  if (!matched.length) {
    if (alreadyMarked.length) return deny(MARKED_BY_PERSON);
    if (alreadyHanded.length) return deny(HANDED_OVER);
    if (alreadySent.length) return deny(D.alreadySent);
    return deny(`This isn't an approved post. ${sentences(closestMismatch(open, intent, call, now, planZone, decidedAt))}`);
  }
  if (matched.length > 1) return deny(D.ambiguous);
  post = matched[0];
  if (attemptState(entries, post.id).pending) return deny(D.unknownPending);
  const problems = mediaProblems(post, intent, call, job, readAssetReads(job.dir), now);
  if (problems.length) return deny(sentences(problems));

  const checks = preflightPost(post, { route: intent.route, now, studioWorkspace: plain(intent.studioWorkspace) ? intent.studioWorkspace : null, hosted: hostedShasOf(job.dir), ...connection });
  const failing = checks.find(item => !item.ok);
  if (failing) return deny(`${D.notReady}: ${failing.text}`);

  const scheduledAt = new Date(zonedInstant(info.publicationDate.dateTime, info.publicationDate.timezone)).toISOString();
  // Once the hook has stopped itself and refused, nothing more may be written for this call.
  if (stopped()) return deny(D.unchecked);
  let reserved;
  try {
    reserved = reserveAttempt(job.dir, {
      post: post.id,
      mode: 'create',
      tool: base,
      toolUseId: event.tool_use_id ?? null,
      inputSha: inputDigest(input),
      fingerprint: postFingerprint(post),
      scheduledAt,
      draft: Boolean(post.draft),
      autoPublish: Boolean(post.autoPublish),
      network: post.platform,
      blogId: String(intent.blogId),
    }, fresh => {
      if (stopped()) return D.unchecked;
      // The approval is read again under the lock: taking a plan back to the posting decision holds the same lock, so a plan
      // withdrawn after the first check is not sent.
      const again = readApprovedIntent(job.dir);
      if (!again.ok || again.sha256 !== approved.sha256) return APPROVAL_DENY[again.code] || D.planChanged;
      if (readMarkedPosts(job.dir).has(post.id)) return MARKED_BY_PERSON;
      const state = attemptState(fresh, post.id);
      if (state.handedOver) return HANDED_OVER;
      if (state.pending) return D.unknownPending;
      return state.sent ? D.alreadySent : null;
    });
  } catch {
    return deny(D.reserveFailed);
  }
  return reserved.ok ? null : deny(reserved.reason);
}
