/**
 * The posting plan for one job: where each approved post goes, when, and with which files.
 *
 * buildPublishIntent writes publish/intent.json from the approved drafts/D*\/post.md files, the deliverables'
 * fixed post types, the brand's Metricool choice and the job's schedule. The person's publish approval covers
 * this file by its sha256 (the publish gate lists it as one of its artifacts), and server/pipeline/media-host.mjs
 * trusts it only while that approval still matches, so what is written here is what the person agreed to.
 * Nothing here calls Metricool or 3echo.
 *
 * The file holds only what is approved to send, so the same inputs always write the same bytes:
 *   { "version": 1,
 *     "jobId": "<job id>",
 *     "route": "metricool_schedule" | "metricool_draft" | "metricool_now" | "self",
 *     "blogId": "<Metricool brand id>",            // metricool routes only
 *     "metricoolLabel": "<Metricool brand name>",  // metricool routes only
 *     "studioWorkspace": { "id": "<3echo workspace id>", "name": "<name>" } | null,
 *     "posts": [ {
 *       "id": "<deliverable>-<platform>",          // one Metricool post per platform
 *       "deliverable": "D1", "platform": "instagram", "placement": "reel",
 *       "type": "POST" | "REEL" | "STORY" | null,  // Metricool's type; TikTok has none
 *       "text": "<caption, then a blank line and the hashtags, as the hand-off writes it>",
 *       "title": "<TikTok only: first line of the caption, at most 90 characters>" | null,
 *       "firstComment": "",
 *       "publicationDate": { "dateTime": "2026-10-03T09:00:00", "timezone": "Asia/Singapore" } | null,
 *                                                  // null for metricool_now (resolved when it is sent)
 *       "autoPublish": true,
 *       "draft": false,                            // true only for metricool_draft
 *       "aiGenerated": false,                      // AI-made people or media (over-labels rather than under-labels)
 *       "tiktok": { "privacyOption": "PUBLIC_TO_EVERYONE", "isAigc": false, "commercialContentOwnBrand": false } | null,
 *       "media": [ { "path": "media/D1/final.mp4", "sha256": "<64 hex>", "kind": "video" | "image",
 *                    "mime": "video/mp4", "bytes": 123, "width": 1080, "height": 1920, "durationSeconds": 12.5 | null } ],
 *       "problems": [ "<plain sentence>" ]         // what stops this post being approved; empty in an approvable plan
 *     } ] }
 *
 * There is no assetId, no checks, no ready flag and no timestamp: whether a file is already in 3echo is answered
 * from publish/hosted-media.json (written only by the plugin) and the plan's workspace, and the checks are run
 * live (see publish-preflight.mjs) when the card is shown, when the decision is approved and when a post is sent.
 * `path` is relative to the job folder and every media entry carries its `sha256`, which is what media-host.mjs
 * needs. A post is only planned from content the latest content approval covers: its post.md and each media file
 * must still match that approval, or the post carries a blocking problem.
 *
 * Measuring a file with ffprobe is remembered in publish/media-facts.json by path, size and modified time, so a
 * rebuild never changes a size and the card measures only new or changed files. Approval and send measure again.
 */

import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { imageInfo } from '../brand-kit/image-info.mjs';
import { readJsonFile, updateJsonFile, writeJsonFile } from '../lib/json.mjs';
import { sniffMagic } from '../media/mime.mjs';
import { THREE_ECHO, jobFromDir, legalChain, readLanded, readRecords } from './facts.mjs';
import { HOSTED_MEDIA_FILE, PUBLISH_INTENT_FILE, hasPublishApproval, hostedAssetFor } from './media-host.mjs';
import { hasSendRecords } from './publish-attempts.mjs';
import { brandPublishingInfo, metricoolConnected, readBrandPublishing, readMetricoolBrands } from './metricool.mjs';
import { HANDOFF_ONLY_TEXT, PUBLISH_ROUTES, ROUTE_LABELS, TIKTOK_TITLE_LIMIT, defaultRoute, isMetricoolRoute, localDateTime, placementMissing, preflightIntent, validZone } from './publish-preflight.mjs';
import * as runtime from './runtime.mjs';
import { readStudioWorkspaceChoice, readStudioWorkspaceList } from './studio-workspace.mjs';

export { PUBLISH_INTENT_FILE, PUBLISH_ROUTES };
export const MEDIA_FACTS_FILE = 'publish/media-facts.json';
export const SEND_LOG_FILE = 'publish/metricool.jsonl';

const require = createRequire(import.meta.url);
const SCRIPTS = join(runtime.runtimeConstants.pipelineRoot, 'scripts');
const frontmatter = require(join(SCRIPTS, 'lib-frontmatter.js'));
const rules = require(join(SCRIPTS, 'lib-deliverable.js'));
const states = require(join(SCRIPTS, 'lib-states.js'));
const { normalizeMarkdown } = require(join(SCRIPTS, 'hash-artifact.js'));

/** Metricool's post type for each platform and post type. TikTok has none. */
const TYPES = Object.freeze({
  instagram: Object.freeze({ post: 'POST', reel: 'REEL', story: 'STORY', carousel: 'POST' }),
  facebook: Object.freeze({ post: 'POST', reel: 'REEL', story: 'STORY' }),
});
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const PAID_WORDS = /paid partnership|branded content|sponsored|\badvertisement\b/i;
const PAID_FLAGS = new Set(['paid_spend', 'paid_partnership', 'branded_content', 'sponsored']);
const PROBE_TIMEOUT_MS = 30000;
const HEAD_BYTES = 1024 * 1024;
const NOT_APPROVED = 'The final post has not been approved yet. Approve it first.';
const CHANGED_AFTER_APPROVAL = 'This post changed after you approved it; approve the final post again.';

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sameKey = value => (process.platform === 'win32' ? value.toLowerCase() : value);
const forward = value => String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');

function inside(parent, child) {
  const rel = relative(sameKey(parent), sameKey(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ---------------------------------------------------------------------------
// Who and what
// ---------------------------------------------------------------------------

function findBrand(root, brand) {
  const value = String(brand || '').trim();
  if (!value) throw new Error('Say which brand this is for.');
  const entry = runtime.listBrands({ root, includeGeneral: true }).find(item => item.slug === value || item.id === value || item.brandId === value);
  if (!entry) throw new Error('This brand could not be found.');
  return entry;
}

function findJob(root, brandSlug, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Say which job this is for.');
  const job = runtime.listJobs({ root, brand: brandSlug }).find(item => item.jobId === id);
  if (!job) throw new Error('This job could not be found.');
  return job;
}

/**
 * What the Metricool connection says about this brand, the same answer for the plan and for the board.
 * With `root` and `brandDir` it also says which 3echo workspace is chosen now (`workspaceId`), and `jobRoute` is the
 * route saved on the job: the board compares both with the plan to see whether it is out of date.
 */
export function publishContext({ root = null, brandDir, jobDir = null, jobRoute = null, channels, brands, connected }) {
  const info = brandPublishingInfo({ brandDir, channels, brands, connected });
  const match = info && !info.unreadable && info.found ? brands.find(item => item.id === info.blogId) || null : null;
  const context = {
    connected: Boolean(connected),
    found: Boolean(match),
    blogId: info && !info.unreadable ? info.blogId : null,
    label: info && !info.unreadable ? info.label : null,
    timezone: match?.timezone ?? null,
    networks: match ? match.networks : null,
    coverage: info && !info.unreadable ? info.coverage : null,
    jobRoute: PUBLISH_ROUTES.includes(jobRoute) ? jobRoute : null,
  };
  if (root && brandDir) {
    try { context.workspaceId = readStudioWorkspaceChoice({ brandDir, jobDir, root }).workspaceId ?? null; } catch { /* left out: not compared */ }
  }
  return context;
}

function connectionOf(root, brandEntry) {
  const profile = readJsonFile(join(brandEntry.path, 'brand', 'profile.json'), null);
  return publishContext({
    brandDir: brandEntry.path,
    channels: plain(profile) ? profile.channels : null,
    brands: readMetricoolBrands(root),
    connected: metricoolConnected(root),
  });
}

export const defaultPublishRoute = defaultRoute;

/**
 * A job routed before 0.8 had its posting decision folded into the final approval when it had a schedule. It has no
 * posting plan to approve and ends with the hand-off package, so Metricool is never offered for it.
 */
export function plannedBeforeMetricool(snapshot) {
  const gates = snapshot?.route?.gates;
  if (!Array.isArray(gates) || gates.includes('publish') || states.isTerminal(snapshot.project?.state)) return false;
  const job = snapshot.job || {};
  return (Array.isArray(job.deliverables) ? job.deliverables : []).some(item => rules.publishable(job, item));
}

export function storedPublishRoute(job) {
  return PUBLISH_ROUTES.includes(job?.publishRoute) ? job.publishRoute : null;
}

function studioWorkspaceFor({ root, brandDir, jobDir }) {
  const choice = readStudioWorkspaceChoice({ brandDir, jobDir, root });
  if (!choice.workspaceId) return null;
  const listed = readStudioWorkspaceList(root).find(item => item.id === choice.workspaceId);
  return { id: choice.workspaceId, name: listed?.name || choice.name || 'Your 3echo workspace' };
}

// ---------------------------------------------------------------------------
// The post and its files
// ---------------------------------------------------------------------------

function sha256Of(fd, size) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  while (position < size) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
    if (!read) break;
    hash.update(buffer.subarray(0, read));
    position += read;
  }
  return hash.digest('hex');
}

function ffprobe(file) {
  const run = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (run.error || run.status !== 0) return null;
  try { return JSON.parse(run.stdout); } catch { return null; }
}

/** `{ width, height, durationSeconds }` as the file shows on screen (a turned phone video swaps them), or null. */
export function probeMedia(file, kind) {
  let width = null;
  let height = null;
  let duration = null;
  if (kind === 'image') {
    let head = null;
    try {
      const fd = openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        head = buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
      } finally { closeSync(fd); }
    } catch { head = null; }
    const info = head ? imageInfo(head) : null;
    if (info && info.width > 0 && info.height > 0) return { width: info.width, height: info.height, durationSeconds: null };
  }
  const raw = ffprobe(file);
  const video = Array.isArray(raw?.streams) ? raw.streams.find(stream => stream.codec_type === 'video') : null;
  if (!video) return null;
  width = Number(video.width);
  height = Number(video.height);
  if (!(width > 0) || !(height > 0)) return null;
  const rotation = Number(video.tags?.rotate ?? (Array.isArray(video.side_data_list) ? video.side_data_list.find(item => item?.rotation !== undefined)?.rotation : 0)) || 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  duration = kind === 'video' ? Number(raw.format?.duration ?? video.duration) : null;
  return { width, height, durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null };
}

const sizeFact = value => (Number.isFinite(value) && value > 0 ? value : null);

/** A remembered measurement, if it is well formed and the file still has the same path, size and modified time. */
function remembered(cache, path, stat) {
  const hit = plain(cache) ? cache[path] : null;
  if (!plain(hit) || hit.bytes !== stat.size || hit.mtimeMs !== stat.mtimeMs || !(hit.width > 0) || !(hit.height > 0)) return null;
  return { width: sizeFact(hit.width), height: sizeFact(hit.height), durationSeconds: sizeFact(hit.durationSeconds) };
}

/**
 * One listed file: `{ entry, listed }` with its fingerprint, or `{ problem }` in plain words (never a file name).
 * A new measurement is added to `learned` so the caller can remember it by path, size and modified time.
 */
function inspectFile(realJob, given, { probe, cache, learned }) {
  if (!given || given.includes('\0') || isAbsolute(given) || /^[a-z]:/i.test(given) || given.split('/').includes('..')) {
    return { problem: 'A file listed in the post is not inside this job.' };
  }
  let real;
  try { real = realpathSync(resolve(realJob, given)); } catch { return { problem: 'A picture or video listed in the post is missing.' }; }
  if (!inside(join(realJob, 'media'), real) && !inside(join(realJob, 'handoff'), real)) {
    return { problem: "A file listed in the post is outside the job's media folder, so it cannot be uploaded." };
  }
  let fd;
  try { fd = openSync(real, 'r'); } catch { return { problem: 'A file listed in the post could not be opened.' }; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0) return { problem: 'A file listed in the post is empty.' };
    const head = Buffer.alloc(16);
    const magic = sniffMagic(head.subarray(0, readSync(fd, head, 0, 16, 0)));
    if (!magic || (magic.kind !== 'image' && magic.kind !== 'video')) return { problem: 'A file listed in the post is not a picture or a video.' };
    const sha256 = sha256Of(fd, stat.size);
    const path = relative(realJob, real).split(sep).join('/');
    let facts = remembered(cache, path, stat);
    if (!facts) {
      facts = probe(real, magic.kind);
      if (facts && facts.width > 0 && facts.height > 0) learned[path] = { bytes: stat.size, mtimeMs: stat.mtimeMs, width: facts.width, height: facts.height, durationSeconds: facts.durationSeconds ?? null };
    }
    return {
      listed: given,
      entry: {
        path,
        sha256,
        kind: magic.kind,
        mime: magic.mime,
        bytes: stat.size,
        width: facts?.width ?? null,
        height: facts?.height ?? null,
        durationSeconds: facts?.durationSeconds ?? null,
      },
    };
  } finally {
    closeSync(fd);
  }
}

/** The file paths and checksums of media 3echo made for this job, so AI-made media can be labelled as such. */
function madeByAi(jobDir) {
  const paths = new Set();
  const shas = new Set();
  try {
    const job = jobFromDir(jobDir);
    for (const entry of job ? readLanded(job) : []) {
      if (entry.provider !== THREE_ECHO) continue;
      if (entry.type === 'landed') {
        if (typeof entry.file === 'string') paths.add(entry.file);
        for (const sha of [entry.sha256, entry.promotedSha256]) if (typeof sha === 'string') shas.add(sha);
      }
    }
  } catch { /* A missing record means nothing is marked, never a failure. */ }
  return { paths, shas };
}

function manifestFiles(jobDir, deliverable) {
  const files = new Set();
  const manifest = readJsonFile(join(jobDir, 'drafts', deliverable, 'generation-manifest.json'), null);
  for (const item of Array.isArray(manifest?.items) ? manifest.items : []) if (typeof item?.file === 'string') files.add(item.file);
  if (typeof manifest?.stitch?.output === 'string') files.add(manifest.stitch.output);
  return files;
}

/**
 * What the latest content approval covers, as `path -> sha256`, read the way check-approval.js reads it (latest
 * round of approvals/content-<round>.json). Null when there is none or the latest one is not an approval. The
 * latest record decides alone: one that cannot be read, or has no round of its own (the number in its file name
 * is used then), blocks, and an older round is never used instead.
 */
function contentApproval(jobDir) {
  const dir = join(jobDir, 'approvals');
  let names = [];
  try { names = readdirSync(dir).filter(name => name.startsWith('content-') && name.endsWith('.json')); } catch { return null; }
  const records = names.map(name => {
    const record = readJsonFile(join(dir, name), null);
    const fromName = Number(name.slice('content-'.length, -'.json'.length));
    const own = plain(record) ? Number(record.round) : NaN;
    return { record: plain(record) ? record : null, round: Number.isFinite(own) ? own : fromName };
  }).filter(item => Number.isFinite(item.round)).sort((a, b) => a.round - b.round);
  const latest = records[records.length - 1]?.record;
  if (!latest || latest.decision !== 'approved' || !Array.isArray(latest.artifacts)) return null;
  const covered = new Map();
  for (const item of latest.artifacts) {
    if (plain(item) && typeof item.path === 'string' && typeof item.sha256 === 'string') covered.set(forward(item.path), item.sha256.toLowerCase());
  }
  return covered;
}

/** The time as the post.md Publish plan row gives it (the third cell), the way build-handoff.js reads it. */
function planTime(sections) {
  const rows = String(sections?.['Publish plan'] || '').split('\n').filter(line => line.trim().startsWith('|') && !/^\|\s*-/.test(line) && !/Account/.test(line));
  const cells = rows.length ? rows[0].split('|').slice(1, -1).map(cell => cell.trim()) : [];
  return cells[2] || '';
}

/**
 * The posting time as Metricool takes it: a wall-clock time and an IANA zone. A time with an offset is shown in
 * the first known zone; a plain local time is read in it. A date with no time of day, or words, give no time.
 */
function publicationFor(publishAt, zones) {
  const at = String(publishAt || '').trim();
  if (!at) return null;
  const zone = zones.find(validZone) || null;
  if (ISO_OFFSET.test(at)) {
    const instant = Date.parse(at.replace(' ', 'T'));
    if (Number.isNaN(instant)) return null;
    if (zone) return { dateTime: localDateTime(instant, zone), timezone: zone };
    return { dateTime: at.replace(/\s*(?:Z|[+-]\d{2}:?\d{2})$/i, '').replace(' ', 'T').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00'), timezone: null };
  }
  if (!LOCAL_ISO.test(at)) return null;
  const local = at.replace(' ', 'T').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00');
  return { dateTime: local, timezone: zone };
}

/** The first line of the caption, cut to Metricool's TikTok title length, never in the middle of a character. */
export function tiktokTitle(caption) {
  const first = String(caption ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  const letters = Array.from(first);
  if (letters.length <= TIKTOK_TITLE_LIMIT) return first;
  return letters.slice(0, TIKTOK_TITLE_LIMIT).join('').trimEnd();
}

const capitalise = text => (text ? text[0].toUpperCase() + text.slice(1) : text);

function composePost({ jobDir, realJob, job, deliverable, route, zones, flags, ai, approved, files }) {
  const D = deliverable.id;
  const platform = String(deliverable.platform || '');
  const placement = deliverable.placement ?? null;
  const postFile = join(jobDir, 'drafts', D, 'post.md');
  const problems = [];
  let data = {};
  let sections = {};
  let changed = false;
  if (existsSync(postFile)) {
    // The file is read once, and the plan is made from exactly the text the approval's hash covers: anything the
    // hash ignores (a "Decision" section at any level, trailing spaces, NFC) is also left out of what is sent.
    try {
      const covered = normalizeMarkdown(readFileSync(postFile, 'utf8'));
      ({ data, sections } = frontmatter.parse(covered));
      if (approved && approved.get(`drafts/${D}/post.md`) !== createHash('sha256').update(Buffer.from(covered, 'utf8')).digest('hex')) changed = true;
    } catch { problems.push('The post could not be read.'); }
  } else {
    problems.push('The post for this deliverable has not been written yet.');
  }
  for (const problem of rules.placementProblems(deliverable, job)) problems.push(`${capitalise(problem)}.`);

  const caption = String(sections.Caption || '').trim();
  const sectionTags = String(sections.Hashtags || '').trim();
  const listedTags = Array.isArray(data.hashtags) ? data.hashtags.map(String).filter(Boolean).join(' ') : '';
  const tags = sectionTags || listedTags;
  const text = caption + (tags && tags.toLowerCase() !== 'none' ? `\n\n${tags}` : '');
  const listed = Array.isArray(data.media) ? data.media : data.media ? [data.media] : [];

  const media = [];
  for (const item of listed) {
    const found = inspectFile(realJob, forward(item), files);
    if (!found.entry) { problems.push(found.problem); continue; }
    media.push(found.entry);
    if (approved && (approved.get(found.entry.path) ?? approved.get(found.listed)) !== found.entry.sha256) changed = true;
  }
  if (!approved) problems.push(NOT_APPROVED);
  else if (changed) problems.push(CHANGED_AFTER_APPROVAL);

  const made = manifestFiles(jobDir, D);
  const aiMade = media.some(item => ai.shas.has(item.sha256) || ai.paths.has(item.path) || made.has(item.path));
  const aiGenerated = flags.has('synthetic_person') || aiMade;
  const paid = ['paid', 'both'].includes(job.distribution) || [...flags].some(flag => PAID_FLAGS.has(flag)) || PAID_WORDS.test(String(sections.Disclosure || ''));
  // The time in the post's own Publish plan wins over the job's schedule, as it does in the hand-off.
  const planned = planTime(sections);
  // Post now is resolved when it is sent, but the zone it is sent in is the plan's, so the send guard has it.
  const when = route === 'metricool_now' ? { dateTime: null, timezone: zones.find(validZone) || null } : planned ? publicationFor(planned, zones) : publicationFor(job.schedule?.publishAt, zones);
  return {
    id: `${D}-${platform}`,
    deliverable: D,
    platform,
    placement,
    type: TYPES[platform]?.[placement] ?? null,
    text,
    title: platform === 'tiktok' ? tiktokTitle(caption) : null,
    firstComment: String(sections['First comment'] || '').trim(),
    publicationDate: when,
    autoPublish: true,
    draft: route === 'metricool_draft',
    aiGenerated,
    tiktok: platform === 'tiktok' ? { privacyOption: 'PUBLIC_TO_EVERYONE', isAigc: aiGenerated, commercialContentOwnBrand: paid } : null,
    media,
    problems: [...new Set(problems)],
  };
}

/**
 * The plan as it would be written now, without writing it. A measurement of a file is remembered in
 * publish/media-facts.json by path, size and modified time, a cache for what the card shows: a file that still
 * matches is not measured again, and only a new or changed one is. With `useCache` false (approval and send) every
 * file is measured again and the cache is corrected from it, so a wrong or tampered entry is never trusted.
 */
function compose({ root, brand, jobId, probe = probeMedia, useCache = true }) {
  const brandEntry = findBrand(root, brand);
  const jobRecord = findJob(root, brandEntry.slug, jobId);
  const jobDir = jobRecord.path;
  const realJob = realpathSync(jobDir);
  const snapshot = runtime.readJobSnapshot({ root, brand: brandEntry.slug, jobId: jobRecord.jobId });
  const job = rules.withDerivedPlacements(snapshot.job || {});
  const connection = connectionOf(root, brandEntry);
  const route = plannedBeforeMetricool(snapshot) ? 'self' : storedPublishRoute(job) || defaultPublishRoute(connection);
  const publishing = readBrandPublishing(brandEntry.path);
  const zones = [job.schedule?.timezone, brandEntry.timezone, connection.timezone].filter(zone => typeof zone === 'string' && zone.trim()).map(zone => zone.trim());
  const flags = new Set([...(snapshot.route?.riskFlags || []), ...(snapshot.route?.modelAddedRiskFlags || [])]);
  const studioWorkspace = studioWorkspaceFor({ root, brandDir: brandEntry.path, jobDir });
  const remembered = readJsonFile(join(jobDir, MEDIA_FACTS_FILE), {});
  const files = { probe, cache: useCache ? remembered : {}, learned: {} };
  const approved = contentApproval(jobDir);
  const ai = madeByAi(jobDir);

  const posts = (Array.isArray(job.deliverables) ? job.deliverables : [])
    .filter(item => plain(item) && typeof item.id === 'string' && item.id)
    .map(deliverable => composePost({ jobDir, realJob, job, deliverable, route, zones, flags, ai, approved, files }));
  const news = Object.keys(files.learned).filter(path => !plain(remembered) || JSON.stringify(remembered[path]) !== JSON.stringify(files.learned[path]));
  if (news.length) {
    updateJsonFile(join(jobDir, MEDIA_FACTS_FILE), current => ({ ...(plain(current) ? current : {}), ...files.learned }), {});
  }
  const intent = {
    version: 1,
    jobId: jobRecord.jobId,
    route,
    ...(isMetricoolRoute(route) ? { blogId: publishing?.blogId ?? connection.blogId ?? null, metricoolLabel: connection.label || publishing?.label || null } : {}),
    studioWorkspace,
    posts,
  };
  return { intent, brandEntry, jobRecord, jobDir, connection, studioWorkspace, route, job };
}

const textOf = intent => `${JSON.stringify(intent, null, 2)}\n`;
const shaOfText = text => createHash('sha256').update(text).digest('hex');

const LOCKED_AFTER_APPROVAL = 'You already approved the posting plan, so it cannot change now. To change anything, the final post has to be reworked and approved again.';
const LOCKED_AFTER_SENDING = 'Posts for this job were already sent to Metricool, so where they go cannot change now.';

/**
 * Why the posting plan on disk must not be rewritten, in plain words, or null while it may be: an approval is in
 * force for it (the final post has not been approved again since), or anything was recorded as sent.
 */
export function planLockReason(jobDir) {
  if (hasPublishApproval(jobDir)) return LOCKED_AFTER_APPROVAL;
  return anythingSent(jobDir) ? LOCKED_AFTER_SENDING : null;
}

/**
 * Whether anything counts as sent, read from the merged send log (publish-attempts.mjs; a file lost on either side changes
 * nothing): a post whose latest state is sent, a reservation still waiting, an unknown or an ambiguous result. A clean
 * refusal made before anything was saved (failed), or the person's "It is not in Metricool", does not count, so such a plan
 * can be fixed, reopened and approved again. A log that cannot be read counts as sent.
 */
export function anythingSent(jobDir) {
  return hasSendRecords(jobDir) || anyMarkedPosted(jobDir);
}

// "I'll post it myself": a post the person marked as posted (publish/posted.json) freezes the plan like a send does. A file
// that cannot be read counts as marked.
function anyMarkedPosted(jobDir) {
  const file = join(jobDir, 'publish', 'posted.json');
  if (!existsSync(file)) return false;
  const marks = readJsonFile(file, null);
  return !plain(marks) || Object.keys(marks).length > 0;
}

/**
 * Write publish/intent.json for a job and return `{ intent, path, sha256, changed }`.
 * `probe` is for tests: how a file's shape is read. The file is written only when its bytes change, atomically,
 * and never over a plan the person approved or after anything was sent: that is refused in plain words.
 */
export function buildPublishIntent({ root, brand, jobId, probe }) {
  const { intent, jobDir } = compose({ root, brand, jobId, ...(probe ? { probe } : {}) });
  const file = join(jobDir, ...PUBLISH_INTENT_FILE.split('/'));
  const text = textOf(intent);
  let existing = null;
  try { existing = readFileSync(file, 'utf8'); } catch { existing = null; }
  if (existing === text) return { intent, path: PUBLISH_INTENT_FILE, sha256: shaOfText(text), changed: false };
  const locked = planLockReason(jobDir);
  if (locked) throw new Error(locked);
  writeJsonFile(file, intent);
  return { intent, path: PUBLISH_INTENT_FILE, sha256: shaOfText(readFileSync(file)), changed: true };
}

/**
 * The checksums of files already in the plan's own 3echo workspace: uploaded there before, or generated there for
 * this job. A file whose workspace is unknown, or another one, is not counted. Only for the size check.
 */
export function hostedShasOf(jobDir, workspaceId) {
  const found = new Set();
  if (!workspaceId) return found;
  const uploaded = readJsonFile(join(jobDir, ...HOSTED_MEDIA_FILE.split('/')), {});
  for (const [sha, entry] of Object.entries(plain(uploaded) ? uploaded : {})) if (plain(entry) && entry.workspaceId === workspaceId) found.add(sha);
  try {
    const job = jobFromDir(jobDir);
    if (job) {
      const made = new Map();
      for (const record of readRecords(job)) {
        if (record.type !== 'create' || !record.providerJobId) continue;
        const where = record.workspaceId || record.inputs?.workspaceId;
        if (typeof where === 'string' && where.trim()) made.set(record.providerJobId, where.trim());
      }
      for (const entry of readLanded(job)) {
        if (entry.type !== 'landed' || entry.provider !== THREE_ECHO || entry.converted || made.get(entry.providerJobId) !== workspaceId) continue;
        for (const sha of [entry.sha256, entry.promotedSha256]) if (typeof sha === 'string') found.add(sha);
      }
    }
  } catch { /* nothing more is marked hosted */ }
  return found;
}

/**
 * Whether the plan on disk can be approved right now, which is also what the card shows. The plan is built again
 * from what is true now and the checks run live. `changed` is true when the plan on disk is no longer what a fresh
 * build writes, and `reason` says in plain words what stops it, or is null when it is ready.
 * `measure` is how the files are measured: 'approval' (the default, for approving and sending) measures every file
 * again and never trusts the remembered measurements; 'display' (the card) reuses a remembered one while the file's
 * path, size and modified time still match, and measures only new or changed files.
 */
export function evaluatePublishPlan({ root, brand, jobId, now = Date.now(), probe, measure = 'approval' }) {
  const fresh = compose({ root, brand, jobId, useCache: measure === 'display', ...(probe ? { probe } : {}) });
  const onDisk = readJsonFile(join(fresh.jobDir, ...PUBLISH_INTENT_FILE.split('/')), null);
  const changed = !plain(onDisk) || JSON.stringify(onDisk) !== JSON.stringify(fresh.intent);
  const checks = preflightIntent(fresh.intent, { route: fresh.route, now, studioWorkspace: fresh.studioWorkspace, hosted: hostedShasOf(fresh.jobDir, fresh.studioWorkspace?.id), ...fresh.connection });
  const ready = checks.ready && !changed;
  const failing = Object.values(checks.posts).flat().find(item => !item.ok);
  const reason = ready ? null : failing ? failing.text : changed ? 'The posting plan changed after it was shown, so it has to be shown again.' : 'There is nothing to post yet.';
  return { ready, changed, reason, checks, intent: fresh.intent };
}

/**
 * The 3echo asset ids of files the plan names that are already in the plan's own workspace, keyed by sha256. It
 * answers only after the person approved the plan (media-host.mjs refuses before), and never accepts a generated
 * file whose workspace is unknown. The plan itself carries no asset ids.
 */
export async function hostedAssetsFor({ jobDir }) {
  const intent = readJsonFile(join(jobDir, ...PUBLISH_INTENT_FILE.split('/')), null);
  const workspaceId = plain(intent?.studioWorkspace) ? intent.studioWorkspace.id : null;
  const found = {};
  if (!workspaceId) return found;
  for (const post of Array.isArray(intent?.posts) ? intent.posts : []) {
    for (const item of Array.isArray(post?.media) ? post.media : []) {
      if (typeof item?.path !== 'string' || !SHA256.test(item.sha256 || '') || found[item.sha256]) continue;
      const hosted = await hostedAssetFor(jobDir, item.path);
      if (hosted?.assetId && hosted.workspaceId && hosted.workspaceId === workspaceId) found[item.sha256] = hosted.assetId;
    }
  }
  return found;
}

/**
 * The paths a publish review registers: the ones given, with the posting plan built now and always included.
 * Nothing is written unless the job is at the posting decision or can legally move there, and its plan may still
 * change: a job that cannot is refused here, before publish/intent.json is touched.
 */
export function withPublishIntent({ root, brand, jobId, paths }) {
  const brandEntry = findBrand(root, brand);
  const jobRecord = findJob(root, brandEntry.slug, jobId);
  const state = runtime.readJobSnapshot({ root, brand: brandEntry.slug, jobId: jobRecord.jobId }).project.state;
  const locked = routeLockReason({ jobDir: jobRecord.path, state });
  if (locked) throw new Error(locked);
  if (state !== 'AWAITING_PUBLISH_APPROVAL' && !legalChain(state, 'AWAITING_PUBLISH_APPROVAL')) throw new Error('This job cannot move to the posting decision from where it is now.');
  buildPublishIntent({ root, brand: brandEntry.slug, jobId: jobRecord.jobId });
  return [...(Array.isArray(paths) ? paths : []).filter(item => item !== PUBLISH_INTENT_FILE), PUBLISH_INTENT_FILE];
}

export function readPublishIntent(jobDir) {
  const intent = readJsonFile(join(jobDir, ...PUBLISH_INTENT_FILE.split('/')), null);
  return plain(intent) && intent.version === 1 ? intent : null;
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

const STATE_ORDER = states.STATES.map(item => item.id);
const GATE_AT = STATE_ORDER.indexOf('AWAITING_PUBLISH_APPROVAL');
// States after the gate that a job can come back from with nothing approved or sent yet.
const REOPENABLE = new Set(['CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED']);

/** Why the route can no longer change, in plain words, or null while it can. */
export function routeLockReason({ jobDir, state }) {
  const locked = planLockReason(jobDir);
  if (locked) return locked;
  const at = STATE_ORDER.indexOf(state);
  if (at < 0 || (at > GATE_AT && !REOPENABLE.has(state))) return 'This job is already past the posting decision, so where its posts go can no longer change.';
  return null;
}

/** Throws a plain sentence when this route cannot be chosen for this job now. Returns the brand and job. */
export function checkPublishRoute({ root, brand, jobId, route }) {
  if (!PUBLISH_ROUTES.includes(route)) throw new Error(`Choose one of: ${PUBLISH_ROUTES.map(id => ROUTE_LABELS[id]).join(', ')}.`);
  const brandEntry = findBrand(root, brand);
  const jobRecord = findJob(root, brandEntry.slug, jobId);
  const snapshot = runtime.readJobSnapshot({ root, brand: brandEntry.slug, jobId: jobRecord.jobId });
  if (isMetricoolRoute(route) && plannedBeforeMetricool(snapshot)) throw new Error(HANDOFF_ONLY_TEXT);
  const locked = routeLockReason({ jobDir: jobRecord.path, state: snapshot.project.state });
  if (locked) throw new Error(locked);
  if (isMetricoolRoute(route)) {
    const connection = connectionOf(root, brandEntry);
    if (!connection.connected) throw new Error('Connect Metricool first, then choose this.');
    if (!connection.found) throw new Error('Choose which Metricool brand this brand posts through first.');
  }
  return { brandEntry, jobRecord };
}

/**
 * Store the route on the job and rebuild the posting plan for it. Metricool routes need Metricool connected and
 * the brand's Metricool choice saved, and the route can only change while nothing is approved or sent.
 */
export function choosePublishRoute({ root, brand, jobId, route, probe }) {
  const { brandEntry, jobRecord } = checkPublishRoute({ root, brand, jobId, route });
  const jobFile = join(jobRecord.path, 'job.json');
  if (!plain(readJsonFile(jobFile, null))) throw new Error('This job record could not be read, so the route was not saved.');
  updateJsonFile(jobFile, current => ({ ...current, publishRoute: route }), {});
  const built = buildPublishIntent({ root, brand: brandEntry.slug, jobId: jobRecord.jobId, ...(probe ? { probe } : {}) });
  return {
    brand: brandEntry.slug,
    jobId: jobRecord.jobId,
    route,
    label: ROUTE_LABELS[route],
    posts: built.intent.posts.length,
    changed: built.changed,
    path: built.path,
  };
}

// ---------------------------------------------------------------------------
// The post type of a job planned before 0.8
// ---------------------------------------------------------------------------

const GATE_STATE = 'AWAITING_PUBLISH_APPROVAL';
/**
 * Throws a plain sentence when this post type cannot be saved for this deliverable now. Returns the brand, the job and
 * the deliverable as stored. It is open only at the posting decision with nothing approved or sent, only for a
 * deliverable whose stored post type is missing (one that has a type is never changed here), and only to a post type
 * the deliverable can be made into.
 */
export function checkPostType({ root, brand, jobId, deliverable, placement }) {
  const brandEntry = findBrand(root, brand);
  const jobRecord = findJob(root, brandEntry.slug, jobId);
  const locked = planLockReason(jobRecord.path);
  if (locked) throw new Error(locked);
  const state = runtime.readJobSnapshot({ root, brand: brandEntry.slug, jobId: jobRecord.jobId }).project.state;
  if (state !== GATE_STATE) {
    const past = STATE_ORDER.indexOf(state) > GATE_AT && !REOPENABLE.has(state);
    throw new Error(past ? 'This job is already past the posting decision, so the kind of post can no longer be chosen.' : 'The kind of post can be chosen once the posting decision is open.');
  }
  const id = typeof deliverable === 'string' ? deliverable.trim() : '';
  if (!id) throw new Error('Say which post this is for.');
  const stored = readJsonFile(join(jobRecord.path, 'job.json'), null);
  if (!plain(stored)) throw new Error('This job record could not be read, so the kind of post was not saved.');
  const entry = (Array.isArray(stored.deliverables) ? stored.deliverables : []).find(item => plain(item) && item.id === id);
  if (!entry) throw new Error('This job has no such post.');
  if (!placementMissing(entry.placement)) throw new Error('This post already has a kind, so it cannot be changed here.');
  const valid = rules.validPlacementsFor(entry);
  if (!valid.length) throw new Error('No kind of post fits this one as it is made, so its format has to change first.');
  if (typeof placement !== 'string' || !valid.includes(placement)) throw new Error(`Choose one of: ${rules.placementChoices(entry.platform, valid)}.`);
  return { brandEntry, jobRecord, entry };
}

/**
 * Store the post type on the deliverable in job.json (the same atomic, locked write the route choice uses) and rebuild
 * the posting plan with it. The checks are made again inside the write, so a type saved a moment earlier is never
 * replaced.
 */
export function savePostType({ root, brand, jobId, deliverable, placement, probe }) {
  const { brandEntry, jobRecord, entry } = checkPostType({ root, brand, jobId, deliverable, placement });
  const jobFile = join(jobRecord.path, 'job.json');
  updateJsonFile(jobFile, current => {
    const list = plain(current) && Array.isArray(current.deliverables) ? current.deliverables : [];
    const at = list.findIndex(item => plain(item) && item.id === entry.id);
    if (at < 0) throw new Error('This job record could not be read, so the kind of post was not saved.');
    if (!placementMissing(list[at].placement)) throw new Error('This post already has a kind, so it cannot be changed here.');
    return { ...current, deliverables: list.map((item, index) => (index === at ? { ...item, placement } : item)), updatedAt: new Date().toISOString() };
  }, {});
  const built = buildPublishIntent({ root, brand: brandEntry.slug, jobId: jobRecord.jobId, ...(probe ? { probe } : {}) });
  return {
    brand: brandEntry.slug,
    jobId: jobRecord.jobId,
    deliverable: entry.id,
    placement,
    label: rules.placementWords(entry.platform, placement),
    posts: built.intent.posts.length,
    changed: built.changed,
    path: built.path,
  };
}
