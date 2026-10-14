/**
 * Post thumbnails: one small picture for each social post the brand library shows, kept on this computer.
 *
 *   workspaces/<brand>/library/thumbs/
 *     <postId>.webp      the picture: a portrait 9:16 crop, 240 pixels wide, tuned to about 8 to 15 KB
 *     <postId>.s.webp    the same picture at 144 pixels wide (about 3 to 6 KB), for a board that has little room left
 *     index.json         { version, sources: { <postId>: frame|file|remote }, failed: { <postId>: { at, reason } }, scannedAt }
 *                        where each picture came from, which posts could not get one (not asked again for a few hours) and when the
 *                        brand's saved videos were last searched for frames and covers
 *
 * Why: the board is a claude.ai artifact whose page may only load `data:` and `blob:` pictures and its own files. The https address of
 * a post's picture on the TikTok, Instagram or YouTube CDN is blocked there, so every card drew the platform tile. The picture has to
 * travel inside the board's own document as a data URI (boardPostPictures and fillPostThumbs below), and it has to exist on this computer
 * first (backfillBrandThumbs).
 *
 * Where a picture comes from, best first (a better source replaces a worse one):
 *   frame   the video's teardown frame nearest to 1 second (the real opening, not a black first frame), saved by pipeline_video_teardown
 *   file    the thumbnail.<ext> yt-dlp wrote next to the saved video (the post's own cover)
 *   remote  the thumbnail address the social read returned (thumbnail_url), fetched once: image types only, at most 3 MB, public hosts only;
 *           when that address is gone (a signed address expires) or the read gave none, the post's own page is read with yt-dlp for a fresh one
 * The post is the one in the library: its stores (brand intelligence posts.jsonl, the proven bank's evidence, the fresh trends) are scanned
 * for post links, so a post filed by any code path gets its picture from the same place. A post's id comes from its link (postThumbId).
 *
 * Nothing in here throws on a problem with one picture: a post without a picture keeps its platform tile.
 */

import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { toolWorkDir } from '../lib/paths.mjs';
import { readJson, writeJsonAtomic } from '../lib/jsonl.mjs';
import { renameReplacing } from '../lib/rename.mjs';
import { boundedFetch } from '../social/backends/web.mjs';
import { YtDlpBackend } from '../social/backends/ytdlp.mjs';
import { platformFromUrl } from '../social/records.mjs';
import { brandLibraryDir, readBank, thumbnailOf } from './brand-library.mjs';
import { readPosts } from './brand-intelligence.mjs';
import { freshTrends } from './brand-trends.mjs';
import * as runtime from './runtime.mjs';

export const THUMBS_DIR = 'thumbs';
const FULL = Object.freeze({ name: 'full', width: 240, height: 426, target: 14 * 1024, ceiling: 32 * 1024, webp: [62, 52, 42, 32], jpg: [7, 10, 14, 20] });
const SMALL = Object.freeze({ name: 'small', width: 144, height: 256, target: 6 * 1024, ceiling: 14 * 1024, webp: [55, 45, 35, 25], jpg: [8, 12, 16, 22] });
const FORMATS = Object.freeze([
  { ext: 'webp', mime: 'image/webp', args: quality => ['-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6'], pixelFormat: 'yuv420p' },
  { ext: 'jpg', mime: 'image/jpeg', args: quality => ['-c:v', 'mjpeg', '-q:v', String(quality)], pixelFormat: 'yuvj420p' },
]);
const SOURCE_RANK = Object.freeze({ remote: 1, file: 2, frame: 3 });
/** The most a fetched picture may weigh, and the longest wait for it. */
export const REMOTE_MAX_BYTES = 3 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 8000;
const FFMPEG_TIMEOUT_MS = 20000;
const PAGE_TIMEOUT_MS = 20000;
/** A post that could not get a picture is not tried again for this long. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const FAILED_KEPT = 300;
/** The saved videos of a brand are searched again for frames this often even when every post has a picture (a later teardown may add the better one). */
const RESCAN_AFTER_MS = 30 * 60 * 1000;
const REFERENCE_FOLDERS_MAX = 80;
const WORKERS = 4;
/** The most the pictures of a board may take (and a little room is always left: BOARD_SLACK). */
export const BOARD_PICTURE_BUDGET = 128 * 1024;
const BOARD_SLACK = 4 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

let ffmpegMissing = false;

// ---------------------------------------------------------------- ids and files
/** A post's id: stable for its link, so every place that shows the post finds the same picture. A YouTube watch link keeps its video. */
export function postThumbId(url) {
  let key;
  try {
    const link = new URL(String(url ?? '').trim());
    const host = link.hostname.toLowerCase().replace(/^www\./, '');
    const path = link.pathname.replace(/\/+$/, '');
    const video = /(^|\.)youtube\.com$/.test(host) && path === '/watch' ? link.searchParams.get('v') : null;
    key = `${host}${path}${video ? `?v=${video}` : ''}`;
  } catch {
    key = String(url ?? '').trim();
  }
  return `pt-${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

export function thumbsDir(root, brand) {
  return join(brandLibraryDir(root, brand), THUMBS_DIR);
}

const fileName = (id, ext, small) => `${id}${small ? '.s' : ''}.${ext}`;

/** The picture file of a post in a folder listing: { path, mime } or null. */
function foundIn(dir, names, id, small) {
  for (const format of FORMATS) {
    const name = fileName(id, format.ext, small);
    if (names.has(name)) return { path: join(dir, name), mime: format.mime };
  }
  return null;
}

function listing(dir) {
  try { return new Set(readdirSync(dir)); } catch { return new Set(); }
}

/** Whether the post of this link has a picture on this computer. */
export function hasPostThumb(root, brand, url) {
  try { return Boolean(foundIn(thumbsDir(root, brand), listing(thumbsDir(root, brand)), postThumbId(url), false)); } catch { return false; }
}

const dataUriOf = (file, mime) => `data:${mime};base64,${readFileSync(file.path).toString('base64')}`;

function readIndex(dir) {
  const value = readJson(join(dir, 'index.json'), null);
  const object = item => (item && typeof item === 'object' && !Array.isArray(item) ? item : {});
  return { version: 1, sources: object(value?.sources), failed: object(value?.failed), scannedAt: Number.isFinite(Date.parse(value?.scannedAt)) ? value.scannedAt : null };
}

function writeIndex(dir, index) {
  const failed = Object.entries(index.failed).sort((a, b) => String(b[1]?.at).localeCompare(String(a[1]?.at))).slice(0, FAILED_KEPT);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, 'index.json'), { version: 1, sources: index.sources, failed: Object.fromEntries(failed), ...(index.scannedAt ? { scannedAt: index.scannedAt } : {}) });
}

// ---------------------------------------------------------------- making a picture
function ffmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  if (ffmpegMissing) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, error => {
      if (error && error.code === 'ENOENT') ffmpegMissing = true;
      resolve(!error);
    });
  });
}

async function encode(base, work, size, format) {
  let best = null;
  const scale = size.name === 'full' ? [] : ['-vf', `scale=${size.width}:${size.height}:flags=lanczos`];
  for (const quality of format.ext === 'webp' ? size.webp : size.jpg) {
    const out = join(work, `${size.name}.${format.ext}`);
    rmSync(out, { force: true });
    const made = await ffmpeg(['-i', base, ...scale, '-frames:v', '1', ...format.args(quality), '-pix_fmt', format.pixelFormat, out]);
    if (!made || !existsSync(out)) break;
    best = readFileSync(out);
    if (best.length <= size.target) break;
  }
  return best && best.length <= size.ceiling ? best : null;
}

/**
 * The portrait crop of one picture at both sizes, as bytes: { ext, mime, full, small }, or null. The input is copied into a short work folder
 * first (ffmpeg does not cope with Windows paths over 260 characters, and workspace folders get that deep).
 */
async function render(inputBytes) {
  const work = toolWorkDir('thumb');
  try {
    const input = join(work, 'in.bin');
    writeFileSync(input, inputBytes);
    const base = join(work, 'base.png');
    const filter = `scale=${FULL.width}:${FULL.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${FULL.width}:${FULL.height}`;
    if (!(await ffmpeg(['-i', input, '-frames:v', '1', '-vf', filter, base])) || !existsSync(base)) return null;
    for (const format of FORMATS) {
      const full = await encode(base, work, FULL, format);
      if (!full) continue;
      return { ext: format.ext, mime: format.mime, full, small: await encode(base, work, SMALL, format) };
    }
    return null;
  } catch {
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The frame nearest to one second, a hook frame first: the real opening of the video, not its first (often black) frame. */
export function openingFrame(frames) {
  const usable = (Array.isArray(frames) ? frames : []).filter(frame => frame && typeof frame.path === 'string' && Number.isFinite(frame.timeS) && existsSync(frame.path));
  const pool = usable.some(frame => frame.kind === 'hook') ? usable.filter(frame => frame.kind === 'hook') : usable;
  return pool.slice().sort((a, b) => Math.abs(a.timeS - 1) - Math.abs(b.timeS - 1) || b.timeS - a.timeS)[0] ?? null;
}

/** The kind of picture some bytes are, or null: only JPEG, PNG, GIF and WebP pass (never SVG or a page that says it is a picture). */
function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (bytes.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The bytes behind a thumbnail address, or null: https only, a public host, an image type, at most REMOTE_MAX_BYTES. */
async function fetchPicture(address) {
  const link = thumbnailOf(address);
  if (!link) return null;
  try {
    const got = await boundedFetch(link, { raw: true, maxBytes: REMOTE_MAX_BYTES, timeoutMs: REMOTE_TIMEOUT_MS, onRedirect: (_from, to) => to.protocol === 'https:', headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' } });
    if (!got.ok || got.truncated || /html|svg|xml|json|text/i.test(got.content_type)) return null;
    return sniffImage(got.buffer) ? got.buffer : null;
  } catch {
    return null;
  }
}

const PAGE_PLATFORMS = new Set(['tiktok', 'instagram', 'youtube']);

/** Whether the post's own page can be asked for a fresh thumbnail address (yt-dlp reads these three without a login). */
const pageReadable = url => PAGE_PLATFORMS.has(platformFromUrl(url));

/** The post's current thumbnail address from its own page, read the way the research tools read a post (yt-dlp, no login), or null. */
async function freshAddress(url) {
  try {
    const platform = platformFromUrl(url);
    if (!PAGE_PLATFORMS.has(platform)) return null;
    const got = await new YtDlpBackend({ timeoutMs: PAGE_TIMEOUT_MS }).post(url, platform);
    return got.ok ? thumbnailOf(got.record?.thumbnail_url) : null;
  } catch {
    return null;
  }
}

function store(dir, id, made) {
  mkdirSync(dir, { recursive: true });
  const write = (name, bytes) => {
    const target = join(dir, name);
    const temp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes);
    renameReplacing(temp, target);
  };
  const other = FORMATS.find(format => format.ext !== made.ext);
  // A picture in the other format from an earlier time would shadow this one (webp is looked for first), so it goes.
  for (const small of [false, true]) rmSync(join(dir, fileName(id, other.ext, small)), { force: true });
  write(fileName(id, made.ext, false), made.full);
  if (made.small) write(fileName(id, made.ext, true), made.small);
  else rmSync(join(dir, fileName(id, made.ext, true)), { force: true });
}

/**
 * Make the picture of one post and keep it, without touching the index (the caller records the source). Tries the opening frame, then the
 * thumbnail file, then the thumbnail address, then a fresh address read from the post's page (`page`, the post's link), skipping the sources
 * no better than what is already kept (unless force).
 * Returns { id, saved, source, reason? }.
 */
async function makeThumb({ dir, id, frames, file, remote, page = null, current, force }) {
  const tried = [];
  const attempt = async (source, load) => {
    if (!force && (SOURCE_RANK[source] ?? 0) <= (SOURCE_RANK[current] ?? (current ? 1 : 0))) return null;
    tried.push(source);
    let bytes = null;
    try { bytes = await load(); } catch { bytes = null; }
    const made = bytes ? await render(bytes) : null;
    if (!made) return null;
    store(dir, id, made);
    return { id, saved: true, source };
  };
  const frame = openingFrame(frames);
  const done = (frame && (await attempt('frame', () => readFileSync(frame.path))))
    || (file && existsSync(file) && (await attempt('file', () => readFileSync(file))))
    || (remote && (await attempt('remote', () => fetchPicture(remote))))
    || (page && (await attempt('remote', async () => fetchPicture(await freshAddress(page)))));
  if (done) return done;
  return { id, saved: false, source: null, reason: ffmpegMissing ? 'ffmpeg' : tried.length ? `could not use ${tried.join(', ')}` : 'nothing better to use' };
}

/**
 * Keep the picture of one post: from its teardown frames (each { kind, timeS, path }), its yt-dlp thumbnail file, or its thumbnail address.
 * Returns { id, saved, source, reason? }. Never throws.
 */
export async function savePostThumb({ root, brand, url, frames = [], file = null, remote = null, page = null, force = false } = {}) {
  try {
    const dir = thumbsDir(root, brand);
    const id = postThumbId(url);
    const index = readIndex(dir);
    const have = foundIn(dir, listing(dir), id, false);
    const result = await makeThumb({ dir, id, frames, file, remote, page, current: have ? index.sources[id] ?? 'remote' : null, force });
    if (result.saved) { index.sources[id] = result.source; delete index.failed[id]; writeIndex(dir, index); }
    return result;
  } catch {
    return { id: postThumbId(url), saved: false, source: null, reason: 'could not be saved' };
  }
}

// ---------------------------------------------------------------- the posts the library shows
const postLink = value => {
  if (typeof value !== 'string') return null;
  try { const link = new URL(value.trim()); return link.protocol === 'https:' || link.protocol === 'http:' ? link.href : null; } catch { return null; }
};

/** Every post the library shows, one per id: [{ id, url, remote }] (remote: the thumbnail address the read returned, or null). Intelligence first. */
export function collectBrandPosts({ root, brand } = {}) {
  const found = new Map();
  const add = (url, thumbnail) => {
    const link = postLink(url);
    if (!link) return;
    const id = postThumbId(link);
    const remote = thumbnailOf(thumbnail);
    const known = found.get(id);
    if (known) { if (!known.remote && remote) known.remote = remote; return; }
    found.set(id, { id, url: link, remote });
  };
  try { for (const post of readPosts({ root, brand })) add(post.url, post.thumbnail); } catch { /* none filed */ }
  try { for (const item of readBank({ root, brand, bank: 'proven', ranked: false })) add(item.evidence?.url, item.evidence?.thumbnail); } catch { /* none filed */ }
  try { for (const trend of freshTrends({ root, brand })) for (const proof of trend.evidence ?? []) add(proof?.url, proof?.thumbnail); } catch { /* none filed */ }
  return [...found.values()];
}

/**
 * What the saved videos of a brand already hold for their posts, by post id: { frames: [{ kind, timeS, path }], file }. A video taken apart in
 * a research run or a job leaves its frames in <run or job>/inputs/references/video/<id>/teardown/ and yt-dlp's cover as thumbnail.<ext>;
 * the reference manifest names the post address each came from. Newest folders first, at most REFERENCE_FOLDERS_MAX of them.
 */
export function localPostMedia({ root, brand } = {}) {
  const out = new Map();
  try {
    const brandDir = join(root, 'workspaces', brand);
    const folders = [];
    for (const group of ['onboarding', 'jobs']) {
      let names = [];
      try { names = readdirSync(join(brandDir, group)); } catch { continue; }
      for (const name of names) folders.push({ name, refs: join(brandDir, group, name, 'inputs', 'references') });
    }
    folders.sort((a, b) => b.name.localeCompare(a.name));
    for (const { refs } of folders.slice(0, REFERENCE_FOLDERS_MAX)) {
      const manifest = readJson(join(refs, 'manifest.json'), null);
      for (const entry of Array.isArray(manifest?.entries) ? manifest.entries : []) {
        if (!entry || entry.type !== 'video' || typeof entry.path !== 'string' || !postLink(entry.sourceUrl)) continue;
        const parts = entry.path.split('/').slice(0, -1);
        if (!parts.length || parts.includes('..')) continue;
        const folder = join(refs, ...parts);
        const id = postThumbId(entry.sourceUrl);
        const known = out.get(id) ?? { frames: [], file: null };
        if (!known.frames.length) {
          const teardown = readJson(join(folder, 'teardown', 'teardown.json'), null);
          known.frames = (Array.isArray(teardown?.frames) ? teardown.frames : [])
            .filter(frame => frame && typeof frame.file === 'string' && !frame.file.split('/').includes('..'))
            .map(frame => ({ kind: frame.kind, timeS: Number(frame.timeS), path: join(folder, ...frame.file.split('/')) }));
        }
        if (!known.file) {
          try { const cover = readdirSync(folder).find(name => /^thumbnail\.(jpe?g|png|webp)$/i.test(name)); if (cover) known.file = join(folder, cover); } catch { /* no cover */ }
        }
        if (known.frames.length || known.file) out.set(id, known);
      }
    }
  } catch { /* no saved videos */ }
  return out;
}

// ---------------------------------------------------------------- filling in what is missing
const running = new Map();

/** The promise's answer, or `late` once `ms` have passed (the promise carries on, and its picture is kept if it ends well). */
function withinTime(promise, ms, late) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(late), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * Give every post the library shows a picture on this computer, from what is already saved (frames, covers) first and the thumbnail address
 * for the rest. Safe to call often: it does nothing for a post that has its picture, skips one that failed lately, and stops at `limit` posts
 * (`remoteLimit` of them from the network) or when `deadlineMs` is up. Two calls for one brand share one run. Never throws.
 * Returns { made, failed, pending }: pending is how many posts still lack a picture and were left for a later call.
 */
export function backfillBrandThumbs(options = {}) {
  const key = `${options.root}|${options.brand}`;
  if (running.has(key)) return running.get(key);
  const run = backfillOnce(options).catch(() => ({ made: 0, failed: 0, pending: 0 })).finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

async function backfillOnce({ root, brand, limit = 30, remoteLimit = 10, deadlineMs = 25000, now = Date.now() } = {}) {
  const stop = Date.now() + deadlineMs;
  if (typeof brand !== 'string' || !SLUG.test(brand) || !existsSync(join(root, 'workspaces', brand, 'workspace.json'))) return { made: 0, failed: 0, pending: 0 };
  const dir = thumbsDir(root, brand);
  const names = listing(dir);
  const index = readIndex(dir);
  const posts = collectBrandPosts({ root, brand });
  const lately = id => Number.isFinite(Date.parse(index.failed[id]?.at)) && now - Date.parse(index.failed[id].at) < RETRY_AFTER_MS;
  // Posts with a saved video come first (no network), the rest by the address they came with.
  const missing = posts.some(post => !foundIn(dir, names, post.id, false));
  const stale = posts.length > 0 && !(Number.isFinite(Date.parse(index.scannedAt)) && now - Date.parse(index.scannedAt) < RESCAN_AFTER_MS);
  const scan = missing || (stale && posts.some(post => (index.sources[post.id] ?? 'remote') !== 'frame'));
  const local = scan ? localPostMedia({ root, brand }) : new Map();
  const work = [];
  for (const post of posts) {
    const have = Boolean(foundIn(dir, names, post.id, false));
    const media = local.get(post.id);
    const better = Boolean(media?.frames?.length) && (SOURCE_RANK[index.sources[post.id]] ?? 1) < SOURCE_RANK.frame;
    if (have && !better) continue;
    if (!media && !post.remote && !pageReadable(post.url)) continue;
    if (!better && lately(post.id)) continue;
    work.push({ post, media, current: have ? index.sources[post.id] ?? 'remote' : null });
  }
  work.sort((a, b) => Number(Boolean(b.media)) - Number(Boolean(a.media)));
  const todo = [];
  let remote = 0;
  for (const item of work) {
    if (todo.length >= limit) break;
    if (!item.media && remote >= remoteLimit) continue;
    if (!item.media) remote += 1;
    todo.push(item);
  }
  let made = 0;
  let failed = 0;
  let next = 0;
  const changes = [];
  const worker = async () => {
    while (next < todo.length && Date.now() < stop) {
      const { post, media, current } = todo[next++];
      // A host that never answers (a lookup that hangs) must not hold the deadline: the post is left for a later call.
      const result = await withinTime(makeThumb({ dir, id: post.id, frames: media?.frames, file: media?.file, remote: post.remote, page: media ? null : post.url, current, force: false }), Math.max(1000, stop - Date.now() + 1500), { id: post.id, saved: false, source: null, reason: 'timed out' });
      changes.push({ post, result });
      if (result.saved) made += 1; else failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, worker));
  if (changes.length || scan) {
    const fresh = readIndex(dir);
    if (scan) fresh.scannedAt = new Date(now).toISOString();
    const at = new Date(now).toISOString();
    for (const { post, result } of changes) {
      if (result.saved) { fresh.sources[post.id] = result.source; delete fresh.failed[post.id]; }
      else if (result.reason !== 'nothing better to use') fresh.failed[post.id] = { at, reason: result.reason };
    }
    try { writeIndex(dir, fresh); } catch { /* the pictures stand without the index */ }
  }
  return { made, failed, pending: Math.max(0, work.length - changes.length) };
}

/** backfillBrandThumbs for every brand of the workspace, one after another inside one deadline. Never throws. */
export async function backfillWorkspaceThumbs({ root, deadlineMs = 15000, ...rest } = {}) {
  const stop = Date.now() + deadlineMs;
  const total = { made: 0, failed: 0, pending: 0 };
  try {
    for (const entry of runtime.listBrands({ root })) {
      const left = stop - Date.now();
      if (left < 500) { total.pending += 1; continue; }
      const done = await backfillBrandThumbs({ ...rest, root, brand: entry.slug, deadlineMs: left });
      total.made += done.made; total.failed += done.failed; total.pending += done.pending;
    }
  } catch { /* the board is written without them */ }
  return total;
}

// ---------------------------------------------------------------- the board
/**
 * The cards of a brand's library and intelligence that show a post, best placed first, as the holders of the post's link: an intelligence
 * post ({ url, thumbnail? }), the evidence of a trend, of a bank item or of a listed item ({ url, thumbnail? }).
 */
function pictureHolders({ library, intelligence }) {
  const holders = [];
  const take = holder => { if (holder && typeof holder === 'object' && typeof holder.url === 'string') holders.push(holder); };
  const own = Array.isArray(intelligence?.own) ? intelligence.own : [];
  const viral = Array.isArray(intelligence?.viral) ? intelligence.viral : [];
  const rivals = (Array.isArray(intelligence?.competitors) ? intelligence.competitors : []).map(group => (Array.isArray(group?.posts) ? group.posts : []));
  own.forEach(take);
  // One post of each competitor before a second of any, so every rival has a picture before one has three.
  for (let at = 0; at < Math.max(0, ...rivals.map(list => list.length)); at += 1) for (const list of rivals) take(list[at]);
  viral.forEach(take);
  for (const trend of Array.isArray(library?.trends) ? library.trends : []) for (const proof of Array.isArray(trend?.evidence) ? trend.evidence : []) take(proof);
  for (const bank of Array.isArray(library?.banks) ? library.banks : []) for (const item of Array.isArray(bank?.items) ? bank.items : []) take(item?.evidence);
  for (const list of [library?.proven, library?.yours]) for (const item of Array.isArray(list) ? list : []) take(item?.evidence);
  return holders;
}

/**
 * Prepare a brand's library and intelligence for the board: the https address of a post's picture is taken out (the page cannot load it, and
 * it weighs a few hundred bytes a card), and a card whose post has a picture on this computer gets `thumb`, the id the brand's `thumbs` map
 * will hold (fillPostThumbs). Returns { library, intelligence }, the document parts copied. Never throws: on a problem the parts come back as they were.
 */
export function boardPostPictures({ root, brand, library, intelligence } = {}) {
  try {
    const dir = thumbsDir(root, brand);
    const names = listing(dir);
    const parts = { library: library ? structuredClone(library) : library, intelligence: intelligence ? structuredClone(intelligence) : intelligence };
    for (const holder of pictureHolders(parts)) {
      delete holder.thumbnail;
      const id = postThumbId(holder.url);
      if (foundIn(dir, names, id, false)) holder.thumb = id;
    }
    return parts;
  } catch {
    return { library, intelligence };
  }
}

/**
 * Put the pictures in the brands of a board document, as `thumbs: { <id>: data URI }`, within `room` bytes (never more than BOARD_PICTURE_BUDGET).
 * All of them are the larger picture when every card fits that way, otherwise all are the smaller one (a grid of cards that differ in sharpness
 * looks worse than a uniform one), and the cards that still do not fit keep their platform tile. Brands take turns, best placed card first, so
 * one brand does not use the room another needs. Only the cards the brand still shows get one (the document may have been slimmed since
 * boardPostPictures marked them); a card that names a `thumb` the map lacks keeps its tile.
 */
export function fillPostThumbs(brands, { root, room }) {
  const budget = Math.min(BOARD_PICTURE_BUDGET, Math.floor(room) - BOARD_SLACK);
  if (!(budget > 2048) || !Array.isArray(brands)) return brands;
  const given = new Map(brands.map(brand => [brand.slug, {}]));
  try {
    const idsOf = brand => [...new Set(pictureHolders(brand).map(holder => holder.thumb).filter(id => typeof id === 'string' && id))];
    const queues = brands.map(brand => { const dir = thumbsDir(root, brand.slug); return { slug: brand.slug, dir, names: listing(dir), ids: idsOf(brand) }; }).filter(queue => queue.ids.length);
    const load = file => { try { return file ? dataUriOf(file, file.mime) : null; } catch { return null; } };
    const entries = [];
    for (let at = 0; queues.some(queue => at < queue.ids.length); at += 1) {
      for (const queue of queues) {
        const id = queue.ids[at];
        if (id) entries.push({ slug: queue.slug, id, full: load(foundIn(queue.dir, queue.names, id, false)), small: load(foundIn(queue.dir, queue.names, id, true)) });
      }
    }
    const cost = (uri, entry) => uri.length + entry.id.length + 8;
    const best = entry => entry.full ?? entry.small;
    const everyFull = entries.reduce((sum, entry) => sum + (best(entry) ? cost(best(entry), entry) : 0), 0) <= budget;
    let used = 0;
    for (const entry of entries) {
      for (const uri of everyFull ? [entry.full, entry.small] : [entry.small, entry.full]) {
        if (!uri || used + cost(uri, entry) > budget) continue;
        given.get(entry.slug)[entry.id] = uri;
        used += cost(uri, entry);
        break;
      }
    }
  } catch { /* the pictures given so far stand */ }
  return brands.map(brand => (Object.keys(given.get(brand.slug) ?? {}).length ? { ...brand, thumbs: given.get(brand.slug) } : brand));
}
