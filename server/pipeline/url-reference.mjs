/**
 * pipeline_reference_from_url: save any public link the person pasted into a job as a reference.
 *
 *   - a Reel, TikTok, YouTube or other video-site address: downloaded with yt-dlp (video, caption, thumbnail, details)
 *   - a direct picture link: saved as a reference picture
 *   - a direct video file link: saved as a reference video
 *   - any other web page: its text and main picture saved as a "page" reference
 *
 * Layout, shared with the board upload:
 *   <job>/inputs/references/manifest.json          { schemaVersion, entries: [...] }
 *   <job>/inputs/references/video/<refId>/video.<ext>, thumbnail.<ext>, info.json, caption.txt
 *   <job>/inputs/references/page/<refId>/page.md, image.<ext>
 *   pictures and direct videos are saved by addReference (references.mjs), exactly like an upload.
 *
 * Reference use only: the file is something to watch, learn from and describe, never something to repost. The
 * manifest says so (usage: "reference_only").
 *
 * Safety: the address must be http(s) with no embedded login, and its host is checked with the research reader's
 * private network guard (IPv4, IPv6, IPv4-mapped and NAT64 forms) before anything is fetched; the page reader checks
 * every redirect hop again and honours robots.txt. yt-dlp runs through the social backend's runner: argument array,
 * no shell, --ignore-config, a time limit that kills the process tree, and --max-filesize. Browser cookies are never
 * read unless the caller passes cookiesFromBrowser, which the Director only does after the person said yes.
 *
 * Outside programs never write into the job folder: on Windows a job folder easily passes the 260 character path
 * limit, which yt-dlp's Python cannot cope with. yt-dlp writes into a short temporary folder and Node moves the
 * finished folder into the job.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';

import { runYtDlp, mapYtDlpError, parseInfo, YTDLP_NO_RETRY_ARGS } from '../social/backends/ytdlp.mjs';
import { assertPublicHost, boundedFetch, extractMeta, extractTitle, FetchFailure, htmlToText, parseRobots, robotsAllows, statusFailure } from '../social/backends/web.mjs';
import { isUrl, platformOf } from '../video/watch-source.mjs';
import { imageInfo } from '../brand-kit/image-info.mjs';
import { moveIntoPlace, toolWorkDir } from '../lib/paths.mjs';
import { addReference, REFERENCES_PER_JOB, REFERENCE_LIMITS, REFERENCE_TYPES, updateReferenceManifest } from './references.mjs';
import { referenceYtdlpBinary } from '../lib/ytdlp-binary.mjs';
import { breaker as sharedBreaker } from '../social/breaker.mjs';

export { referenceYtdlpBinary };

/** One download attempt, then the whole yt-dlp process tree is stopped. */
export const REFERENCE_DOWNLOAD_TIMEOUT_MS = 120_000;
export const REFERENCE_MAX_FILESIZE = '300M';
const VIDEO_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];
const THUMB_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const BROWSERS = ['chrome', 'firefox', 'edge', 'safari', 'brave', 'chromium', 'opera', 'vivaldi'];
const LINK_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const LINK_VIDEO_EXT = ['.mp4', '.mov', '.webm', '.m4v'];
const VIDEO_SITES = /(^|\.)(vimeo\.com|x\.com|twitter\.com|twitch\.tv|dailymotion\.com|rumble\.com|bilibili\.com|v\.redd\.it|snapchat\.com)$/;
const EXT_FOR_CONTENT_TYPE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
const VIDEO_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };
const PAGE_PROBE_BYTES = 2 * 1024 * 1024;
const PAGE_TEXT_MAX = 20_000;
const NO_VIDEO = /unsupported url|no video formats|no video in this post|there is no video|no video could be found/i;
const PIP_FIX = 'pip install "yt-dlp[default,curl-cffi]"';

/**
 * The one line every failure carries as its next step. No retry, no waiting, no asking mid-run: the slot stays
 * blank and the run carries on. A sign-in wall may also go on the single end-of-run list of links to ask about.
 */
function nextLine(status) {
  const base = `Record ${status} for this link, leave the slot blank and continue.`;
  return [status === 'needs_sign_in' ? `${base} Add it to the single list of links to ask the person about at the end.` : base];
}

/** Status to a one-line plain explanation; `next` is filled in below from nextLine. */
const NEXT = {
  needs_sign_in: { message: 'That post is only shown to signed in visitors, so it could not be downloaded without a login.' },
  blocked: { message: 'The platform answered the downloader with a bot check, so the video could not be downloaded.' },
  rate_limited: { message: 'The platform asked automated readers to slow down.' },
  not_found: { message: 'The platform says that video does not exist or is no longer public.' },
  region_restricted: { message: 'The platform does not show that video in this region.' },
  unsupported: { message: 'That address is not a video page the downloader can read.' },
  yt_dlp_missing: { message: 'yt-dlp is not installed on this computer, so a video address cannot be downloaded.' },
  timed_out: { message: 'The download took too long and was stopped.' },
  too_large: { message: `That video is larger than the ${REFERENCE_MAX_FILESIZE} limit.` },
  invalid_url: { message: 'That is not a web address that can be downloaded.' },
  private_address: { message: 'That address points at a private network, which is never downloaded.' },
  save_failed: { message: 'The video downloaded but could not be saved on this computer (disk space or folder access), not because of the link.' },
  impersonation_missing: { message: "TikTok needs yt-dlp's browser mode, which is not installed, so the video could not be downloaded." },
  ffmpeg_missing: { message: 'ffmpeg is not installed, so the video and its sound could not be joined.' },
  download_failed: { message: 'The video could not be downloaded.' },
  limit_reached: { message: `This job already has ${REFERENCES_PER_JOB} references, the most it can hold.` },
  page_blocked: { message: 'That site asks automated readers not to open the page, so it was not saved.' },
  page_failed: { message: 'That page could not be opened.' },
  empty_page: { message: 'That page has no readable text. It may need a login, or build itself in the browser.' },
  skipped: { message: 'That platform refused automated readers a moment ago, so it is skipped for now.' },
  file_rejected: { message: 'That link did not hold a picture or video that can be saved.' },
};
for (const [status, info] of Object.entries(NEXT)) info.next = nextLine(status);

function fail(status, extra = {}) {
  const known = Object.hasOwn(NEXT, status);
  const key = known ? status : 'download_failed';
  return { ok: false, status: key, message: NEXT[key].message, ...extra, next: NEXT[key].next };
}

/** Statuses that count against a host in the shared breaker, by breaker class. */
const BREAKER_CLASS = { needs_sign_in: 'login_required', blocked: 'blocked', rate_limited: 'rate_limited', timed_out: 'timed_out' };

/**
 * The skipped result when the shared breaker says this platform host refused us recently, else null.
 * Only the big platforms are guarded; ordinary sites are not.
 */
export function breakerSkip(brk, url) {
  if (platformOf(url) === 'other') return null;
  const state = brk.isOpen(url);
  return state.open ? fail('skipped', { message: state.reason || NEXT.skipped.message, platform: platformOf(url), breaker: state.code }) : null;
}

/** Tell the breaker how a download went (a success clears the host, a refusal counts toward opening it). */
export function breakerRecord(brk, url, status) {
  if (platformOf(url) === 'other') return;
  if (status === 'ok') brk.recordSuccess(url);
  else if (BREAKER_CLASS[status]) brk.recordFailure(url, BREAKER_CLASS[status]);
}

/** Whether this yt-dlp can present itself as a browser (curl_cffi), looked up once per process and binary. */
const impersonationCache = new Map();

/**
 * True when yt-dlp lists a usable curl_cffi browser target, false when it does not, null when it could not be asked.
 * Asked once per process; the answer picks the arguments up front so a download is never run twice.
 * @param {string|undefined} binary
 * @returns {Promise<boolean|null>}
 */
export function impersonationAvailable(binary) {
  const key = binary ?? process.env.SOCIAL_CAMPAIGN_YTDLP ?? '';
  if (!impersonationCache.has(key)) {
    impersonationCache.set(
      key,
      runYtDlp(['--ignore-config', '--list-impersonate-targets'], { binary, timeoutMs: 15_000, maxBytes: 1024 * 1024 }).then((run) => {
        if (!run.ok) return null;
        const rows = `${run.stdout}\n${run.stderr}`.split(/\r?\n/).filter((line) => /curl_cffi/i.test(line));
        return rows.some((line) => !/unavailable/i.test(line));
      }),
    );
  }
  return impersonationCache.get(key);
}

/** Forget what was learned about impersonation (after yt-dlp was upgraded, and in tests). */
export function resetImpersonationCache() {
  impersonationCache.clear();
}

/** Downloads in progress, so two calls for the same link share one download instead of racing in the same folder. */
const inFlight = new Map();

/** Run `work` once per key at a time; a second caller waits for the first and gets its own copy of the answer. */
async function dedupe(key, work) {
  let pending = inFlight.get(key);
  if (!pending) {
    pending = work().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const result = await pending;
  return { ...result };
}

/** The exact command that adds yt-dlp's browser mode: through the Python next to yt-dlp when it is there, else plain pip. */
function impersonationFix(binary) {
  if (binary) {
    for (const name of ['python.exe', 'python', 'python3']) {
      const candidate = join(dirname(binary), name);
      if (existsSync(candidate)) return `"${candidate}" -m pip install "yt-dlp[default,curl-cffi]"`;
    }
  }
  return PIP_FIX;
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function readManifest(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value && Array.isArray(value.entries)) return value;
  } catch {
    // missing or unreadable: start a new one
  }
  return { schemaVersion: 1, entries: [] };
}

export function referenceId(url) {
  return `ref-${createHash('sha256').update(url.trim()).digest('hex').slice(0, 12)}`;
}

/** The last "ERROR:" line yt-dlp printed, plain and short, or ''. */
function lastErrorLine(run) {
  const line = String(run.stderr ?? '').split(/\r?\n/).filter((l) => /^ERROR:/.test(l)).at(-1) ?? '';
  return line.replace(/^ERROR:\s*/, '').trim().slice(0, 300);
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const isoDay = (yyyymmdd) => (/^\d{8}$/.test(String(yyyymmdd ?? '')) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : null);

/** Add the entry (replacing one with the same id and type) under the manifest lock. */
function recordEntry(jobDir, entry) {
  updateReferenceManifest(jobDir, (latest) => {
    const others = latest.entries.filter((e) => !(e.id === entry.id && e.type === entry.type));
    if (others.length >= REFERENCES_PER_JOB) throw new Error(NEXT.limit_reached.message);
    return { ...latest, schemaVersion: latest.schemaVersion || 1, entries: [...others, entry] };
  });
}

/**
 * @param {{jobDir: string, url: string, note?: string, type?: 'auto'|'video'|'caption', cookiesFromBrowser?: string,
 *   binary?: string, timeoutMs?: number, assertHost?: (url: URL) => Promise<void>, now?: () => Date,
 *   fetchUrl?: typeof boundedFetch}} options
 *   `type` defaults to 'video' here (the teardown needs a video file); the tool passes 'auto'.
 */
export async function referenceFromUrl(options) {
  const url = String(options.url ?? '').trim();
  if (!isUrl(url)) return fail('invalid_url');
  const parsed = new URL(url);
  if (parsed.username || parsed.password) return fail('invalid_url');
  const checkHost = options.assertHost ?? ((u) => assertPublicHost(u, false));
  try {
    await checkHost(parsed);
  } catch (error) {
    if (error instanceof FetchFailure && error.code === 'private_address') return fail('private_address');
    return fail('invalid_url');
  }
  const cookies = options.cookiesFromBrowser ? String(options.cookiesFromBrowser).toLowerCase() : null;
  if (cookies && !BROWSERS.includes(cookies)) return fail('invalid_url', { message: `cookiesFromBrowser must be one of: ${BROWSERS.join(', ')}.` });

  const mode = options.type === 'auto' || options.type === 'caption' ? options.type : 'video';
  const refsDir = join(options.jobDir, 'inputs', 'references');
  const id = referenceId(url);
  const manifest = readManifest(join(refsDir, 'manifest.json'));
  const type = mode === 'caption' ? 'caption' : 'video';
  const existing = mode === 'auto'
    ? manifest.entries.find((e) => e.sourceUrl === url && e.type !== 'caption' && e.path && existsSync(join(refsDir, e.path)))
    : manifest.entries.find((e) => e.id === id && e.type === type);
  if (existing && existsSync(join(refsDir, existing.path))) return { ok: true, status: 'already_downloaded', entry: existing };
  if (manifest.entries.length >= REFERENCES_PER_JOB) return fail('limit_reached');

  const ctx = { options, url, parsed, refsDir, id, cookies, checkHost, now: options.now ?? (() => new Date()), fetchUrl: options.fetchUrl ?? boundedFetch };
  // Two calls for the same link in the same job share one download.
  return dedupe(`${options.jobDir}\n${url}\n${mode}\n${cookies ?? ''}`, () => referenceFromCheckedUrl(ctx, mode, type));
}

/** The download itself, after the address checks and the already-saved check. */
async function referenceFromCheckedUrl(ctx, mode, type) {
  const { url, parsed } = ctx;
  if (mode !== 'auto') {
    const got = await downloadWithYtDlp(ctx, type);
    delete got.noVideo;
    return got;
  }

  // Any link: a picture or video file by its ending, a video site through yt-dlp, anything else by what it answers.
  const ext = extname(parsed.pathname).toLowerCase();
  const hint = LINK_IMAGE_EXT.includes(ext) ? 'image' : LINK_VIDEO_EXT.includes(ext) ? 'video' : null;
  if (!hint && (platformOf(url) !== 'other' || VIDEO_SITES.test(parsed.hostname.toLowerCase()))) {
    const got = await downloadWithYtDlp(ctx, 'video');
    // A video site address that holds no video (a photo post, a profile, an article) is read as a page instead.
    if (!got.noVideo) {
      delete got.noVideo;
      return got;
    }
  }
  return fromLink(ctx, hint);
}

/** Whether a saved reference folder already holds what was asked for (the video, or for a caption only the details). */
function folderComplete(dir, type) {
  if (!existsSync(dir)) return false;
  const names = readdirSync(dir);
  if (type === 'caption') return names.includes('info.json');
  return names.some((n) => n.startsWith('video.') && VIDEO_EXT.includes(extname(n).toLowerCase()));
}

/**
 * Put a finished temporary folder in place without ever deleting a folder another call may be reading: an existing
 * complete folder is kept and ours is dropped; an incomplete or replaced one is moved aside first, then removed.
 * @returns {boolean} true when our folder was moved in, false when an existing one was kept.
 */
function placeFolder(work, finalDir, isComplete) {
  if (existsSync(finalDir)) {
    if (isComplete(finalDir)) return false;
    const aside = `${finalDir}.old-${process.pid}-${Date.now()}`;
    try {
      renameSync(finalDir, aside);
    } catch {
      return false; // in use by someone else: keep what is there
    }
    moveIntoPlace(work, finalDir);
    rmSync(aside, { recursive: true, force: true });
    return true;
  }
  moveIntoPlace(work, finalDir);
  return true;
}

/** Download a video-site address with yt-dlp into a short temporary folder, then move the finished folder into the job. */
async function downloadWithYtDlp(ctx, type) {
  const { options, url, refsDir, id, cookies } = ctx;
  const finalDir = join(refsDir, 'video', id);
  const work = toolWorkDir('ref');
  try {
    const platform = platformOf(url);
    const binary = referenceYtdlpBinary(options.binary);
    let videoName = null;
    let infoName = null;
    let info = null;
    if (folderComplete(finalDir, type)) {
      // Another call (or an earlier run that was never recorded) already saved it: reuse it, download nothing.
      infoName = existsSync(join(finalDir, 'info.json')) ? 'info.json' : null;
    } else {
      const skipped = breakerSkip(options.breaker ?? sharedBreaker, url);
      if (skipped) return skipped;
      const args = [
        '--ignore-config', '--no-update', '--no-progress', '--no-playlist', ...YTDLP_NO_RETRY_ARGS,
        ...(cookies ? ['--cookies-from-browser', cookies] : ['--no-cookies', '--no-cookies-from-browser']),
        '--max-filesize', REFERENCE_MAX_FILESIZE, '--write-info-json', '--write-thumbnail',
        '-o', join(work, 'video.%(ext)s'),
      ];
      if (type === 'caption') args.push('--skip-download');
      else args.push('-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4');
      const runOptions = { binary, timeoutMs: options.timeoutMs ?? REFERENCE_DOWNLOAD_TIMEOUT_MS, maxBytes: 4 * 1024 * 1024 };
      // TikTok answers a plain downloader with a bot check; with curl_cffi installed yt-dlp can present itself as Chrome.
      // Whether it can is asked once per process, so the arguments are chosen up front and the download runs once.
      const canImpersonate = platform === 'tiktok' ? await impersonationAvailable(binary) : null;
      const impersonate = platform === 'tiktok' && canImpersonate !== false;
      const run = await runYtDlp(impersonate ? [...args, '--impersonate', 'chrome', '--', url] : [...args, '--', url], runOptions);
      const names = readdirSync(work);
      const brk = options.breaker ?? sharedBreaker;
      videoName = names.find((n) => n.startsWith('video.') && VIDEO_EXT.includes(extname(n).toLowerCase()) && !n.includes('.part')) ?? null;
      infoName = names.find((n) => n === 'video.info.json') ?? null;
      const gotWhatWasAsked = type === 'caption' ? Boolean(infoName) : Boolean(videoName);
      if (!gotWhatWasAsked) {
        const text = run.stderr + run.stdout;
        if (/larger than max-filesize|File is larger/i.test(text)) return fail('too_large');
        const mapped = mapYtDlpError(run, platform);
        const finalStatus = { login_required: 'needs_sign_in', backend_missing: 'yt_dlp_missing', blocked: platform === 'instagram' ? 'needs_sign_in' : 'blocked' }[mapped.code] ?? mapped.code;
        breakerRecord(brk, url, finalStatus);
        const noVideo = NO_VIDEO.test(text);
        // TikTok with no browser mode: say what is missing instead of guessing at a bot check.
        const needsBrowserMode = platform === 'tiktok' && (canImpersonate === false || mapped.code === 'impersonation_missing') && (mapped.code === 'impersonation_missing' || mapped.code === 'blocked' || mapped.code === 'download_failed');
        if (needsBrowserMode) return fail('impersonation_missing', { fix: impersonationFix(binary), platform, noVideo });
        const status = { login_required: 'needs_sign_in', backend_missing: 'yt_dlp_missing', blocked: platform === 'instagram' ? 'needs_sign_in' : 'blocked' }[mapped.code] ?? mapped.code;
        const detail = status === 'save_failed' || status === 'ffmpeg_missing' ? lastErrorLine(run) || mapped.reason : mapped.reason;
        return fail(Object.hasOwn(NEXT, status) ? status : 'download_failed', { detail, platform, noVideo });
      }

      breakerRecord(brk, url, 'ok');
      if (infoName) info = parseInfo(readFileSync(join(work, infoName), 'utf8'));
      const title = info?.title ? String(info.title).trim() : null;
      const caption = info?.description ? String(info.description).trim() : title;
      if (caption) writeFileSync(join(work, 'caption.txt'), `${caption}\n`, 'utf8');
      const thumbName = names.find((n) => n.startsWith('video.') && THUMB_EXT.includes(extname(n).toLowerCase()));
      if (thumbName) renameSync(join(work, thumbName), join(work, `thumbnail${extname(thumbName).toLowerCase()}`));
      if (infoName) renameSync(join(work, infoName), join(work, 'info.json'));
      if (videoName) renameSync(join(work, videoName), join(work, `video${extname(videoName).toLowerCase()}`));
      mkdirSync(join(refsDir, 'video'), { recursive: true });
      placeFolder(work, finalDir, (dir) => folderComplete(dir, type));
    }

    // What is in the final folder is the truth, whichever call put it there.
    const savedVideo = readdirSync(finalDir).find((n) => n.startsWith('video.') && VIDEO_EXT.includes(extname(n).toLowerCase()));
    videoName = savedVideo ?? null;
    info = existsSync(join(finalDir, 'info.json')) ? parseInfo(readFileSync(join(finalDir, 'info.json'), 'utf8')) : info;
    const title = info?.title ? String(info.title).trim() : null;
    const caption = info?.description ? String(info.description).trim() : title;
    const videoExt = videoName ? extname(videoName).toLowerCase() : null;
    const mediaFile = videoExt ? `video${videoExt}` : 'info.json';
    const mediaPath = join(finalDir, mediaFile);
    const files = readdirSync(finalDir).sort();
    const artists = Array.isArray(info?.artists) ? info.artists.join(', ') : info?.artist;
    const entry = {
      id,
      type,
      kind: type === 'caption' ? 'text' : 'video',
      label: REFERENCE_TYPES[type].label,
      use: REFERENCE_TYPES[type].use,
      path: `video/${id}/${mediaFile}`,
      files: files.map((f) => `video/${id}/${f}`),
      mimeType: videoExt ? VIDEO_MIME[videoExt] ?? 'video/mp4' : 'application/json',
      sourceUrl: url,
      platform,
      title,
      caption,
      note: options.note ? String(options.note) : null,
      author: info?.uploader ?? info?.channel ?? null,
      musicTrack: info?.track ? String(info.track) : null,
      musicArtist: artists ? String(artists) : null,
      views: numberOrNull(info?.view_count),
      likes: numberOrNull(info?.like_count),
      comments: numberOrNull(info?.comment_count),
      uploadDate: isoDay(info?.upload_date),
      sha256: await sha256File(mediaPath),
      bytes: statSync(mediaPath).size,
      durationS: numberOrNull(info?.duration),
      usage: 'reference_only',
      by: 'link',
      usedCookies: Boolean(cookies),
      downloadedAt: ctx.now().toISOString(),
    };
    // Re-read under the lock, so an upload saved from the board while this was downloading is kept.
    recordEntry(options.jobDir, entry);
    return { ok: true, status: 'downloaded', entry, reminder: 'Reference only: learn from it and describe it; never repost or reuse it as the finished post.' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** robots.txt for the page's site: false when it asks automated readers to stay out of this page. */
async function robotsAllowPage(ctx) {
  const { parsed, fetchUrl } = ctx;
  try {
    const result = await fetchUrl(`${parsed.origin}/robots.txt`, { timeoutMs: 10_000, maxBytes: 512 * 1024, headers: { Accept: 'text/plain,*/*;q=0.5' } });
    if (result.status === 401 || result.status === 403) return false;
    if (result.ok) return robotsAllows(parseRobots(result.body), parsed.pathname + parsed.search);
  } catch {
    // robots.txt unreachable for network reasons: the page fetch reports the real problem
  }
  return true;
}

/** Read what a link answers, then save it as a picture, a video or a page. `hint` is what its ending suggests. */
async function fromLink(ctx, hint) {
  const { url, parsed, fetchUrl } = ctx;
  let robotsChecked = false;
  if (!hint) {
    if (!(await robotsAllowPage(ctx))) return fail('page_blocked');
    robotsChecked = true;
  }
  const probeBytes = hint === 'video' ? REFERENCE_LIMITS.video + 1 : hint === 'image' ? REFERENCE_LIMITS.image + 1 : PAGE_PROBE_BYTES;
  const get = async (maxBytes, timeoutMs) => fetchUrl(url, { raw: true, maxBytes, timeoutMs });
  let got;
  try {
    got = await get(probeBytes, hint === 'video' ? 120_000 : 30_000);
  } catch (error) {
    if (error instanceof FetchFailure && error.code === 'private_address') return fail('private_address');
    return fail('page_failed', { detail: error instanceof Error ? error.message : String(error) });
  }
  if (!got.ok) {
    const why = statusFailure(got.status);
    if (why.code === 'not_found') return fail('not_found', { message: 'That address does not exist any more (the site answered not found).' });
    if (why.code === 'login_required') return fail('needs_sign_in');
    return fail('page_failed', { detail: why.reason });
  }

  const contentType = String(got.content_type ?? '').split(';')[0].trim().toLowerCase();
  const kind = contentType.startsWith('image/') ? 'image'
    : contentType.startsWith('video/') ? 'video'
      : /html|xml|^text\//.test(contentType) ? 'page'
        : !contentType || contentType === 'application/octet-stream' ? hint : null;
  if (!kind) return fail('file_rejected', { detail: `It is a ${contentType} file.` });

  if (kind === 'page') {
    if (!robotsChecked && !(await robotsAllowPage(ctx))) return fail('page_blocked');
    return savePage(ctx, got);
  }
  const limit = REFERENCE_LIMITS[kind];
  // The first read of an unknown link was only a small probe: read the whole file now.
  if (got.truncated && probeBytes <= limit) {
    try {
      got = await get(limit + 1, kind === 'video' ? 120_000 : 30_000);
    } catch (error) {
      return fail('page_failed', { detail: error instanceof Error ? error.message : String(error) });
    }
  }
  if (got.truncated || got.buffer.length > limit) {
    const what = kind === 'image' ? 'picture' : 'video';
    return fail('too_large', { message: `That ${what} is larger than ${Math.round(limit / (1024 * 1024))} MB, the most a reference can be.` });
  }
  return saveFile(ctx, kind, got.buffer, contentType, got.final_url, parsed);
}

/** Save a downloaded picture or video the way an upload is saved, then add where it came from. */
function saveFile(ctx, kind, buffer, contentType, finalUrl, parsed) {
  const { options, url } = ctx;
  const urlExt = extname(parsed.pathname).toLowerCase();
  const ext = EXT_FOR_CONTENT_TYPE[contentType] ?? urlExt;
  const stem = basename(parsed.pathname, urlExt).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'link';
  const work = toolWorkDir('ref');
  try {
    const file = join(work, `link${ext}`);
    writeFileSync(file, buffer);
    const added = addReference({ jobDir: options.jobDir, reference: { type: kind === 'image' ? 'picture' : 'video', fileName: `${stem}${ext}`, path: file, note: options.note }, by: 'link', now: ctx.now() });
    if (!added.added) return { ok: true, status: 'already_downloaded', entry: added.reference };
    const extra = { sourceUrl: url, ...(finalUrl && finalUrl !== url ? { finalUrl } : {}), downloadedAt: ctx.now().toISOString() };
    updateReferenceManifest(options.jobDir, (latest) => ({ ...latest, entries: latest.entries.map((e) => (e.id === added.reference.id && e.type === added.reference.type ? { ...e, ...extra } : e)) }));
    return { ok: true, status: 'downloaded', entry: { ...added.reference, ...extra }, reminder: 'Reference only: learn from it and describe it; never repost or reuse it as the finished post.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already has \d+ references/.test(message)) return fail('limit_reached');
    return fail('file_rejected', { detail: message });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Save a web page as page.md (title, description, main text) plus its main picture when it has one. */
async function savePage(ctx, got) {
  const { options, url, refsDir, id, parsed, fetchUrl, checkHost } = ctx;
  const html = got.buffer.toString('utf8');
  const meta = extractMeta(html);
  const text = htmlToText(html).slice(0, PAGE_TEXT_MAX);
  const title = (meta['og:title'] || extractTitle(html) || '').trim() || null;
  const description = (meta['og:description'] || meta.description || '').trim() || null;
  const siteName = (meta['og:site_name'] || parsed.hostname.replace(/^www\./, '')).trim();
  if (!title && !description && text.length < 50) return fail('empty_page');

  const work = toolWorkDir('ref');
  try {
    const pageMd = [
      `# ${title ?? parsed.hostname}`,
      '',
      `Source: ${url}`,
      `Site: ${siteName}`,
      ...(description ? ['', description] : []),
      ...(text ? ['', '---', '', text] : []),
      '',
    ].join('\n');
    writeFileSync(join(work, 'page.md'), pageMd, 'utf8');

    // The page's main picture (og:image), when it is a real picture on a public host.
    let imageUrl = null;
    const rawImage = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'];
    if (rawImage) {
      try {
        const target = new URL(rawImage, got.final_url || url);
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          await checkHost(target);
          const picture = await fetchUrl(target.href, { raw: true, timeoutMs: 15_000, maxBytes: REFERENCE_LIMITS.image });
          const info = picture.ok && !picture.truncated ? imageInfo(picture.buffer) : null;
          const imageExt = info ? { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[info.mimeType] : null;
          if (imageExt) {
            writeFileSync(join(work, `image${imageExt}`), picture.buffer);
            imageUrl = target.href;
          }
        }
      } catch {
        // no usable picture: the page is still saved
      }
    }

    const finalDir = join(refsDir, 'page', id);
    mkdirSync(join(refsDir, 'page'), { recursive: true });
    // A saved page is replaced by moving the old folder aside, never by deleting one another call may be reading.
    placeFolder(work, finalDir, () => false);
    const mediaPath = join(finalDir, 'page.md');
    const files = readdirSync(finalDir).sort();
    const entry = {
      id,
      type: 'page',
      kind: 'text',
      label: 'Web page',
      use: 'page text and main picture',
      path: `page/${id}/page.md`,
      files: files.map((f) => `page/${id}/${f}`),
      mimeType: 'text/markdown',
      sourceUrl: url,
      ...(got.final_url && got.final_url !== url ? { finalUrl: got.final_url } : {}),
      title,
      description,
      siteName,
      imageUrl,
      note: options.note ? String(options.note) : null,
      sha256: await sha256File(mediaPath),
      bytes: statSync(mediaPath).size,
      usage: 'reference_only',
      by: 'link',
      downloadedAt: ctx.now().toISOString(),
    };
    recordEntry(options.jobDir, entry);
    return { ok: true, status: 'downloaded', entry, reminder: 'Reference only: learn from it and describe it; never copy it into the finished post.' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
