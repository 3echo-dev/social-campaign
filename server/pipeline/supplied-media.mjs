/**
 * Pictures and video the person already has, placed in a publish_post job.
 *
 * The files are copied once into the job under media/supplied/<sha8>-<name>, hashed there and measured there, and
 * recorded on job.json as `suppliedMedia`. That sha256, taken at placement, is the anchor the rest of the chain
 * builds on: the final approval hashes post.md and every file it lists, the posting plan is built only from what
 * that approval covers, and the posting approval hashes the plan. Nothing here calls Metricool or 3echo, spends
 * credits or moves a job; it works out what the files are and writes the posts the person will approve.
 *
 * This module is plain functions over a job folder, with no import of the runtime or the posting plan, so
 * runtime.mjs (createJob, addSuppliedFiles) can use it without a cycle. The caller owns the job.json write, the lock
 * and the routing: addSuppliedMedia returns the fields to write (`patch`).
 *
 * Per post: one video, or 1 to 35 pictures, or no file only when every platform is Facebook and a caption is given.
 *
 *   files          creativeDiscipline  placement when none is stated
 *   one video      brand_video         instagram/facebook: reel if 9:16, else post; tiktok: video
 *   one picture    static_image        instagram/facebook: post; tiktok: photo
 *   2+ pictures    carousel            instagram/facebook: post; tiktok: photo
 *   none           text_only           facebook: post
 */

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sniffMagic } from '../media/mime.mjs';
import { probeMedia } from './media-probe.mjs';
import { CAROUSEL_MAX, INSTAGRAM_FEED_RATIO, TIKTOK_PHOTO_MAX, VIDEO_LENGTHS } from './publish-preflight.mjs';
import { THREE_ECHO, jobAt, readLanded } from './facts.mjs';

const require = createRequire(import.meta.url);
const PIPELINE_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const frontmatter = require(join(PIPELINE_SCRIPTS, 'lib-frontmatter.js'));
const brandProfile = require(join(PIPELINE_SCRIPTS, 'lib-brand-profile.js'));
const rules = require(join(PIPELINE_SCRIPTS, 'lib-deliverable.js'));

export const SUPPLIED_DIR = 'media/supplied';
/** Over this a file is refused. Over MAX_HOSTED_BYTES it cannot go through 3echo hosting, so only the posting kit takes it. */
export const MAX_COPY_BYTES = 500 * 1024 * 1024;
export const MAX_HOSTED_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 35;
export const PLATFORMS = Object.freeze(['facebook', 'instagram', 'tiktok']);

const HASH_CHUNK = 1024 * 1024;
const PHONE_RATIO = 9 / 16;
const PHONE_TOLERANCE = 0.02;
const NAMED_RATIOS = Object.freeze([['9:16', PHONE_RATIO], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9], ['4:3', 4 / 3], ['3:4', 3 / 4]]);
const EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
});
const HEADING_LINE = /^#{1,6}\s/m;

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const forward = value => String(value ?? '').split(sep).join('/');
const sameKey = value => (process.platform === 'win32' ? String(value).toLowerCase() : String(value));
const nowIso = () => new Date().toISOString();

function inside(parent, child) {
  const rel = relative(sameKey(parent), sameKey(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ---------------------------------------------------------------------------
// The shape of what was given
// ---------------------------------------------------------------------------

/** The named ratio a measured picture or video is, or null when it is none of them or cannot be read. */
export function ratioName(width, height) {
  if (!(Number(width) > 0) || !(Number(height) > 0)) return null;
  const ratio = Number(width) / Number(height);
  const hit = NAMED_RATIOS.find(([name, value]) => (name === '9:16' ? Math.abs(ratio - value) <= PHONE_TOLERANCE : Math.abs(ratio - value) / value <= 0.03));
  return hit ? hit[0] : null;
}

const isPhone = file => ratioName(file.width, file.height) === '9:16';
// A video of a length the platform's Reel or video type does not take; an unmeasured length is not held against it.
const tooLong = (platform, placement, file) => {
  const limit = VIDEO_LENGTHS[`${platform}:${placement}`];
  return Boolean(limit) && Number(file.durationSeconds) > limit.max;
};

/** What a set of files is: `{ kind: 'video'|'image'|'carousel'|'text', discipline, videos, images }`, or a plain refusal. */
export function describeSet(files) {
  const list = Array.isArray(files) ? files : [];
  const videos = list.filter(file => file.kind === 'video');
  const images = list.filter(file => file.kind === 'image');
  if (videos.length && images.length) {
    throw new Error('A post is one video or a set of pictures, not both. Give Claude the video on its own, or the pictures on their own.');
  }
  if (videos.length > 1) {
    throw new Error('A post takes one video. Give Claude one video for this post and start another post for the next one.');
  }
  if (images.length > MAX_FILES) throw new Error(`A post takes at most ${MAX_FILES} pictures, and this has ${images.length}.`);
  if (videos.length) return { kind: 'video', discipline: 'brand_video', videos, images };
  if (images.length > 1) return { kind: 'carousel', discipline: 'carousel', videos, images };
  if (images.length === 1) return { kind: 'image', discipline: 'static_image', videos, images };
  return { kind: 'text', discipline: 'text_only', videos, images };
}

/** The post type a platform gets for this set when none is stated, or null when the platform cannot take it. */
export function defaultPlacement(platform, set) {
  if (platform === 'tiktok') {
    if (set.kind === 'video') return 'video';
    if (set.kind === 'image' || set.kind === 'carousel') return 'photo';
    return null;
  }
  if (platform === 'instagram' || platform === 'facebook') {
    if (set.kind === 'video') return isPhone(set.videos[0]) && !tooLong(platform, 'reel', set.videos[0]) ? 'reel' : 'post';
    if (set.kind === 'text') return platform === 'facebook' ? 'post' : null;
    return 'post';
  }
  return null;
}

/** Whether a brand's channel can take the set at all, so the platforms filled from the brand card never start with a failure. */
function canTake(platform, set) {
  if (platform === 'facebook') return true;
  if (set.kind === 'text') return false;
  if (platform === 'tiktok') {
    if (set.kind === 'video') return isPhone(set.videos[0]) && !tooLong('tiktok', 'video', set.videos[0]);
    return set.images.length <= TIKTOK_PHOTO_MAX;
  }
  if (platform === 'instagram') {
    if (set.kind === 'video') return true;
    if (set.images.length > CAROUSEL_MAX) return false;
    return set.images.every(file => {
      if (!(file.width > 0) || !(file.height > 0)) return true;
      const ratio = file.width / file.height;
      return ratio >= INSTAGRAM_FEED_RATIO.min - 0.005 && ratio <= INSTAGRAM_FEED_RATIO.max + 0.005;
    });
  }
  return false;
}

/** The channels the brand card lists, in the order the plugin posts to them. */
export function brandCardPlatforms(brandDir) {
  let profile = null;
  try { profile = brandProfile.read(brandDir); } catch { profile = null; }
  const channels = plain(profile?.channels) ? profile.channels : {};
  return PLATFORMS.filter(name => plain(channels[name]) && channels[name].status === 'provided');
}

function brandCardChannel(brandDir, platform) {
  let profile = null;
  try { profile = brandProfile.read(brandDir); } catch { profile = null; }
  const channel = plain(profile?.channels) ? profile.channels[platform] : null;
  return plain(channel) && channel.status === 'provided' && typeof channel.url === 'string' ? channel.url : '';
}

/**
 * The deliverables for these files and platforms: one per platform, D1 to Dn, count 1. A post type the person
 * already stated for a platform (in `existing`, the job's deliverables) is kept together with its id and any time chosen
 * for it; the rest is worked out from the shape of the files. aspectRatios come from the measured shape, so the
 * router's own post type rules catch a type that does not fit the file.
 */
export function deriveDeliverables({ files, platforms, existing = [] }) {
  const set = describeSet(files);
  const stated = Array.isArray(existing) ? existing.filter(item => plain(item) && typeof item.platform === 'string') : [];
  const ratios = [...new Set([...set.videos, ...set.images].map(file => ratioName(file.width, file.height)))];
  const measured = ratios.length > 0 && !ratios.includes(null) ? ratios : null;
  const taken = new Set(stated.map(item => item.id).filter(Boolean));
  let next = 1;
  const freshId = () => {
    while (taken.has(`D${next}`)) next += 1;
    const id = `D${next}`;
    taken.add(id);
    return id;
  };
  const list = [];
  for (const platform of platforms) {
    const old = stated.find(item => item.platform === platform);
    const entry = {
      id: old?.id || freshId(),
      platform,
      count: 1,
      creativeDiscipline: set.discipline,
    };
    const placement = old?.placement ?? defaultPlacement(platform, set);
    if (placement) entry.placement = placement;
    if (measured) entry.aspectRatios = measured;
    if (old?.postTime) entry.postTime = old.postTime;
    list.push(entry);
  }
  return list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

// ---------------------------------------------------------------------------
// Checking and copying a file
// ---------------------------------------------------------------------------

function assertPlainPath(source) {
  if (typeof source !== 'string' || !source.trim() || source.includes('\0')) throw new Error('A file to post needs its full path on this computer.');
  const value = source.trim();
  // A network share or device path (\\server\share, \\?\C:\...) can name another brand's files by a name the checks below cannot compare.
  if (value.startsWith('\\\\') || value.startsWith('//')) throw new Error('A file on a network share or a device path cannot be used. Copy it to a folder on this computer first.');
  if (!isAbsolute(value)) throw new Error('A file to post needs its full path on this computer, starting from the drive or the root folder.');
  return resolve(value);
}

function assertNoLinks(file) {
  let current = file;
  for (;;) {
    let stat = null;
    try { stat = lstatSync(current); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error('A shortcut, symbolic link or junction cannot be used. Give Claude the real file.');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function realOrSame(value) {
  try { return realpathSync.native(value); } catch { return resolve(value); }
}

/**
 * Where a file may come from: anywhere on the person's computer outside the workspace, or inside it only this
 * brand's own earlier files (a job's media or handoff folder, or inputs/<brand>). Never another brand, the plugin's
 * own folder or any other workspace file. Returns where it came from for the record.
 */
function sourceWhere({ root, brandSlug, real }) {
  const realRoot = realOrSame(root);
  if (!inside(realRoot, real)) return { from: 'computer', path: forward(real) };
  const parts = forward(relative(realRoot, real)).split('/');
  const brandJobFile = parts[0] === 'workspaces' && parts[1] === brandSlug && parts[2] === 'jobs' && parts.length > 5 && (parts[4] === 'media' || parts[4] === 'handoff');
  const brandInput = parts[0] === 'inputs' && parts[1] === brandSlug && parts.length > 2;
  if (brandJobFile || brandInput) return { from: 'workspace', path: parts.join('/') };
  if (parts[0] === '.social-pipeline') throw new Error("That file is part of the plugin's own records, so it cannot be posted.");
  if ((parts[0] === 'workspaces' && parts[1] !== brandSlug) || (parts[0] === 'inputs' && parts[1] !== brandSlug)) throw new Error("That file belongs to another brand's work, so it cannot be used here.");
  throw new Error("Only pictures and video from this brand's own earlier posts, or from elsewhere on this computer, can be used.");
}

function readHead(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    return head.subarray(0, readSync(fd, head, 0, 16, 0));
  } finally {
    closeSync(fd);
  }
}

function sha256OfFile(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(HASH_CHUNK);
    let position = 0;
    while (position < size) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Everything that can be known about one source file without copying it, or a plain refusal. */
export function checkSource({ root, brandSlug, source, maxBytes = MAX_COPY_BYTES }) {
  const abs = assertPlainPath(source);
  let stat;
  try { stat = lstatSync(abs); } catch { throw new Error('A file to post could not be found. Check the path and try again.'); }
  if (stat.isSymbolicLink()) throw new Error('A shortcut, symbolic link or junction cannot be used. Give Claude the real file.');
  if (!stat.isFile()) throw new Error('Give Claude a picture or a video file, not a folder.');
  assertNoLinks(dirname(abs));
  const real = realOrSame(abs);
  const where = sourceWhere({ root, brandSlug, real });
  if (stat.size === 0) throw new Error('A file to post is empty.');
  if (stat.size > maxBytes) throw new Error(`A file to post is over ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than Claude can copy.`);
  let magic = null;
  try { magic = sniffMagic(readHead(abs)); } catch { throw new Error('A file to post could not be opened.'); }
  if (!magic || (magic.kind !== 'image' && magic.kind !== 'video') || !EXTENSIONS[magic.mime]) {
    throw new Error('A file to post is not a picture or a video Claude can use. Pictures can be JPEG, PNG, WebP or GIF, and video MP4, MOV or WebM.');
  }
  return { abs, real, bytes: stat.size, kind: magic.kind, mime: magic.mime, where };
}

/** Whether 3echo made a file for any job of this brand: its landed records name the file's sha256. */
function madeByThreeEcho({ root, brandSlug, sha256 }) {
  try {
    for (const name of readdirSync(join(root, 'workspaces', brandSlug, 'jobs'))) {
      const job = jobAt(root, brandSlug, name);
      if (job && readLanded(job).some(entry => entry.provider === THREE_ECHO && entry.type === 'landed' && (entry.sha256 === sha256 || entry.promotedSha256 === sha256))) return true;
    }
  } catch { /* no records means nothing is marked */ }
  return false;
}

function safeStem(name) {
  const stem = basename(name, extname(name)).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return stem || 'file';
}

function removeQuietly(file) {
  try { unlinkSync(file); } catch { /* already gone */ }
}

/**
 * Copy one checked file into media/supplied/, hash the copy and measure it. Returns the entry for job.json, or
 * `{ duplicate: entry }` when the same content is already placed. The copy is made under a temporary name and
 * renamed once its hash is known, so a file never sits in the job under a name that does not match its content.
 */
function placeOne({ root, brandSlug, jobDir, checked, known, probe, now }) {
  const dir = join(jobDir, ...SUPPLIED_DIR.split('/'));
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.incoming-${randomUUID()}`);
  try {
    copyFileSync(checked.abs, temp);
    const sha256 = sha256OfFile(temp);
    const again = sniffMagic(readHead(temp));
    if (!again || again.mime !== checked.mime) throw new Error('A file to post changed while it was being copied. Try again.');
    const have = known.find(item => item.sha256 === sha256);
    if (have) return { duplicate: have };
    const file = `${sha256.slice(0, 8)}-${safeStem(checked.abs)}${EXTENSIONS[checked.mime]}`;
    const final = join(dir, file);
    let created = true;
    if (existsSync(final)) {
      // The name carries the start of the hash: the same content already there is kept as it is, anything else is not ours to remove.
      if (sha256OfFile(final) !== sha256) throw new Error('A different file is already stored under that name. Try again.');
      created = false;
    } else renameSync(temp, final);
    const measured = probe(final, checked.kind) || {};
    return {
      created,
      entry: {
        path: `${SUPPLIED_DIR}/${file}`,
        sha256,
        bytes: checked.bytes,
        kind: checked.kind,
        mime: checked.mime,
        width: Number(measured.width) > 0 ? Number(measured.width) : null,
        height: Number(measured.height) > 0 ? Number(measured.height) : null,
        durationSeconds: Number(measured.durationSeconds) > 0 ? Number(measured.durationSeconds) : null,
        source: checked.where,
        // A file from an earlier job of this brand that 3echo made stays labelled as made with AI.
        ...(checked.where.from === 'workspace' && madeByThreeEcho({ root, brandSlug, sha256 }) ? { aiMade: true } : {}),
        addedAt: now,
      },
    };
  } finally {
    removeQuietly(temp);
  }
}

// ---------------------------------------------------------------------------
// The posts
// ---------------------------------------------------------------------------

const AI_LABEL = 'Made with AI. Turn on the AI label when you post.';
const POST_TYPE_WORDS = Object.freeze({ post: 'post', reel: 'Reel', story: 'Story', carousel: 'carousel', video: 'video', photo: 'photo post' });

function postTable({ platform, placement, publishAt, account }) {
  const type = placement ? `${rules.PLATFORM_NAMES[platform] || platform} ${POST_TYPE_WORDS[placement] || placement}` : '';
  const row = [account || '', platform, publishAt || '', '', type].map(cell => String(cell).replace(/\|/g, '/').replace(/\s+/g, ' ').trim());
  return `| Account | Platform | Publish at (zone) | Destination URL | Settings |\n|---|---|---|---|---|\n| ${row.join(' | ')} |`;
}

/** A caption the person typed must survive as one section: a line that reads as a heading would split it. */
export function checkCaption(caption) {
  if (typeof caption !== 'string') return;
  if (HEADING_LINE.test(caption.replace(/\r\n/g, '\n'))) {
    throw new Error('A line of the caption starts with a hash and a space, which the post file would read as a heading. Put the hashtag straight after the hash, or start the line another way.');
  }
}

function renderPost({ jobId, deliverable, platform, placement, files, caption, captionBy, hashtags, cta, aiMade, publishAt, account, version, created }) {
  const media = files.length ? `media:\n${files.map(file => `  - ${file.path}`).join('\n')}` : 'media: []';
  const tags = `${hashtags ?? ''}`.trim();
  const front = [
    '---',
    `job: ${jobId}`,
    `deliverable: ${deliverable}`,
    `platform: ${platform}`,
    `version: ${version}`,
    'status: draft',
    'source: supplied',
    `caption_by: ${captionBy}`,
    media,
    `char_count: ${Array.from(caption + (tags && tags.toLowerCase() !== 'none' ? `\n\n${tags}` : '')).length}`,
    `created: ${created}`,
    '---',
  ].join('\n');
  return `${front}

# Caption

${caption}

# Hashtags

${tags}

# CTA

${cta ?? ''}

# Provenance

None

# Disclosure

${aiMade ? AI_LABEL : 'None'}

# Publish plan

${postTable({ platform, placement, publishAt, account })}
`;
}

/**
 * Write drafts/D<n>/post.md for every deliverable: the person's caption word for word (Hashtags and CTA `None`, because
 * the caption carries its own), or an empty Caption for the copywriter when none was given. A caption already filled
 * in a post is never overwritten unless `replace` is true, and a post for a deliverable that is gone is removed.
 */
export function writeSuppliedPosts({ jobDir, brandDir = null, job, deliverables, files, replace = false, now = nowIso() }) {
  checkCaption(job.caption);
  const given = typeof job.caption === 'string' && job.caption.trim() ? job.caption.replace(/\r\n/g, '\n').trim() : '';
  const publishAt = typeof job.schedule?.publishAt === 'string' ? job.schedule.publishAt : '';
  const wanted = new Set(deliverables.map(item => item.id));
  const written = [];
  for (const entry of deliverables) {
    const file = join(jobDir, 'drafts', entry.id, 'post.md');
    let kept = null;
    if (existsSync(file) && !replace) {
      try {
        const old = frontmatter.parse(readFileSync(file, 'utf8'));
        if (typeof old.sections?.Caption === 'string' && old.sections.Caption.trim()) kept = old;
      } catch { kept = null; }
    }
    const captionBy = kept ? (kept.data.caption_by === 'person' ? 'person' : 'claude') : (given ? 'person' : 'claude');
    const text = renderPost({
      jobId: job.jobId,
      deliverable: entry.id,
      platform: entry.platform,
      placement: entry.placement,
      files,
      caption: kept ? kept.sections.Caption : given,
      captionBy,
      hashtags: kept ? kept.sections.Hashtags : (given ? 'None' : ''),
      cta: kept ? kept.sections.CTA : (given ? 'None' : ''),
      aiMade: job.aiMade === true || files.some(file => file.aiMade === true),
      publishAt,
      account: brandDir ? brandCardChannel(brandDir, entry.platform) : '',
      version: kept && Number.isInteger(kept.data.version) ? kept.data.version : 1,
      created: kept && kept.data.created ? String(kept.data.created) : now,
    });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
    written.push(`drafts/${entry.id}/post.md`);
  }
  const drafts = join(jobDir, 'drafts');
  if (existsSync(drafts)) {
    for (const name of readdirSync(drafts)) {
      if (!/^D\d+$/.test(name) || wanted.has(name)) continue;
      const stale = join(drafts, name, 'post.md');
      try {
        if (existsSync(stale) && frontmatter.parse(readFileSync(stale, 'utf8')).data.source === 'supplied') {
          unlinkSync(stale);
          try { rmdirSync(join(drafts, name)); } catch { /* it holds other files */ }
        }
      } catch { /* an unreadable post is left for the checks to report */ }
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

/** The refusal for a set of file arguments that cannot be a list of paths. */
export function checkFileList(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Give Claude at least one picture or video to post.');
  if (files.length > MAX_FILES) throw new Error(`A post takes at most ${MAX_FILES} pictures, and ${files.length} were given.`);
  return files;
}

/**
 * Check, copy and measure files for a job and work out the posts.
 *
 * `job` is the job as it stands (job.json). The result is the set of fields to write back (`patch`: suppliedMedia,
 * platforms, deliverables, plus request when it is missing) and what happened, in plain words. With `replace`
 * the new files take the place of the ones already placed; without it they are added after them, and a file
 * already placed (the same content) is skipped. Nothing is written to job.json here. A failure part-way removes
 * every file this call placed and throws a plain sentence.
 */
export function addSuppliedMedia({ root, brand, jobDir, job, files = [], replace = false, probe = probeMedia, now = nowIso(), maxBytes = MAX_COPY_BYTES }) {
  const brandSlug = brand.slug;
  const checked = files.length ? checkFileList(files).map(source => checkSource({ root, brandSlug, source, maxBytes })) : [];
  const before = Array.isArray(job.suppliedMedia) ? job.suppliedMedia.filter(item => plain(item) && typeof item.sha256 === 'string') : [];
  const kept = replace ? [] : before;
  // The whole set is judged from what each source is before anything is copied, so a set that cannot be one post leaves the job as it was.
  const seen = new Set(kept.map(entry => entry.sha256));
  const candidate = [...kept];
  for (const item of checked) {
    const sha256 = sha256OfFile(item.abs);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    candidate.push({ kind: item.kind });
  }
  describeSet(candidate);
  const placed = [];
  const created = [];
  const skipped = [];
  const entries = [...kept];
  try {
    for (const item of checked) {
      const made = placeOne({ root, brandSlug, jobDir, checked: item, known: entries, probe, now });
      if (made.duplicate) {
        skipped.push({ name: basename(item.abs), reason: 'It is already part of this post.' });
        continue;
      }
      placed.push(made.entry);
      if (made.created) created.push(made.entry);
      entries.push(made.entry);
    }
    describeSet(entries);
  } catch (error) {
    for (const entry of created) removeQuietly(join(jobDir, ...entry.path.split('/')));
    throw error;
  }
  if (replace) {
    const keepPaths = new Set(entries.map(entry => entry.path));
    for (const old of before) if (!keepPaths.has(old.path)) removeQuietly(join(jobDir, ...String(old.path).split('/')));
  }

  const set = describeSet(entries);
  const notes = [];
  if (entries.some(entry => entry.bytes > MAX_HOSTED_BYTES)) {
    notes.push('A file is over 100 MB, which is more than can be uploaded for posting through Metricool. It can only be posted yourself, with the posting kit.');
  }
  // Words alone are a post only for Facebook and only when the person gave the caption, so nothing is worked out for a job with neither.
  const hasCaption = typeof job.caption === 'string' && job.caption.trim().length > 0;
  const workable = entries.length > 0 || hasCaption;
  const named = list => (Array.isArray(list) ? list.filter(value => typeof value === 'string' && value.trim()) : []);
  let platforms = named(job.platforms);
  // Platforms the person only named through a post type are still platforms they chose.
  if (!platforms.length) platforms = [...new Set(named(Array.isArray(job.deliverables) ? job.deliverables.map(item => item?.platform) : []))];
  let platformsFromCard = false;
  if (!platforms.length && workable) {
    platforms = brandCardPlatforms(brand.path).filter(platform => canTake(platform, set));
    platformsFromCard = platforms.length > 0;
  }
  const patch = { suppliedMedia: entries };
  if (platformsFromCard) {
    patch.platforms = platforms;
    notes.push(`Posting to ${platforms.map(platform => rules.PLATFORM_NAMES[platform] || platform).join(', ')}, the channels on the brand card that can take this.`);
  }
  // With no file the only post is words on Facebook; any other platform is asked for a file instead.
  const wordsAlone = entries.length === 0 && !(platforms.length > 0 && platforms.every(platform => platform === 'facebook'));
  const deliverables = platforms.length && workable && !wordsAlone ? deriveDeliverables({ files: entries, platforms, existing: job.deliverables }) : [];
  if (deliverables.length) patch.deliverables = deliverables;
  return { patch, suppliedMedia: entries, added: placed, skipped, deliverables, platforms, notes };
}
