/**
 * pipeline_reference_from_url: download a pasted Reel, TikTok, YouTube or other video address into a job as a
 * reference.
 *
 * Layout, shared with the board upload:
 *   <job>/inputs/references/manifest.json          { schemaVersion, entries: [...] }
 *   <job>/inputs/references/video/<refId>/video.<ext>, thumbnail.<ext>, info.json, caption.txt
 *
 * Reference use only: the file is something to watch, learn from and describe, never something to repost. The
 * manifest says so (usage: "reference_only").
 *
 * Safety: the address must be http(s) with no embedded login, and its host is checked with the research reader's
 * private network guard (IPv4, IPv6, IPv4-mapped and NAT64 forms) before yt-dlp is started. yt-dlp runs through the
 * social backend's runner: argument array, no shell, --ignore-config, a time limit that kills the process tree, and
 * --max-filesize. Browser cookies are never read unless the caller passes cookiesFromBrowser, which the Director only
 * does after the person said yes.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

import { runYtDlp, mapYtDlpError, parseInfo } from '../social/backends/ytdlp.mjs';
import { assertPublicHost, FetchFailure } from '../social/backends/web.mjs';
import { isUrl, platformOf } from '../video/watch-source.mjs';
import { updateReferenceManifest } from './references.mjs';
import { managedEnvironmentRoot } from '../setup/research-helper-record.mjs';

export const REFERENCE_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
export const REFERENCE_MAX_FILESIZE = '300M';
const VIDEO_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];
const THUMB_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const BROWSERS = ['chrome', 'firefox', 'edge', 'safari', 'brave', 'chromium', 'opera', 'vivaldi'];

/** Status to a one-line plain explanation and the next steps for the Director. */
const NEXT = {
  needs_sign_in: {
    message: 'That post is only shown to signed in visitors, so it could not be downloaded without a login.',
    next: [
      'Ask the person to upload the video file with the upload button on the board (or give its saved file path).',
      'Or, only if the person agrees, call this tool again with cookiesFromBrowser set to the browser they are signed in with (chrome, firefox, edge, safari or brave). Never read browser cookies without their yes.',
    ],
  },
  blocked: {
    message: 'The platform answered the downloader with a bot check, so the video could not be downloaded.',
    next: ['Ask the person to upload the video file with the board upload button, or try again later.'],
  },
  rate_limited: { message: 'The platform asked automated readers to slow down.', next: ['Wait a few minutes and try again, or ask the person to upload the file.'] },
  not_found: { message: 'The platform says that video does not exist or is no longer public.', next: ['Ask the person to check the address.'] },
  region_restricted: { message: 'The platform does not show that video in this region.', next: ['Ask the person to upload the file.'] },
  unsupported: { message: 'That address is not a video page the downloader can read.', next: ['Ask for the address of the post itself, or an uploaded file.'] },
  yt_dlp_missing: { message: 'yt-dlp is not installed on this computer, so a video address cannot be downloaded.', next: ['Ask the person to upload the file with the board upload button, or install yt-dlp.'] },
  timed_out: { message: 'The download took too long and was stopped.', next: ['Try again, or ask the person to upload the file.'] },
  too_large: { message: `That video is larger than the ${REFERENCE_MAX_FILESIZE} limit.`, next: ['Ask the person to upload a shorter cut.'] },
  invalid_url: { message: 'That is not a web address that can be downloaded.', next: ['Ask for the full https:// address.'] },
  private_address: { message: 'That address points at a private network, which is never downloaded.', next: ['Ask for a public post address.'] },
  download_failed: { message: 'The video could not be downloaded.', next: ['Ask the person to upload the file with the board upload button.'] },
};

function fail(status, extra = {}) {
  const info = NEXT[status] ?? NEXT.download_failed;
  return { ok: false, status, message: info.message, next: info.next, ...extra };
}

/** The yt-dlp to use: an explicit override, SOCIAL_CAMPAIGN_YTDLP, the research helper venv's, then PATH. */
export function referenceYtdlpBinary(override) {
  if (override) return override;
  if (process.env.SOCIAL_CAMPAIGN_YTDLP) return undefined; // runYtDlp reads the env itself
  try {
    const env = managedEnvironmentRoot();
    const candidate = process.platform === 'win32' ? join(env, 'Scripts', 'yt-dlp.exe') : join(env, 'bin', 'yt-dlp');
    if (existsSync(candidate)) return candidate;
  } catch {
    // no research helper environment; fall through to PATH
  }
  return undefined;
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

function writeJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

export function referenceId(url) {
  return `ref-${createHash('sha256').update(url.trim()).digest('hex').slice(0, 12)}`;
}

/**
 * @param {{jobDir: string, url: string, note?: string, type?: 'video'|'caption', cookiesFromBrowser?: string,
 *   binary?: string, timeoutMs?: number, assertHost?: (url: URL) => Promise<void>, now?: () => Date}} options
 */
export async function referenceFromUrl(options) {
  const url = String(options.url ?? '').trim();
  if (!isUrl(url)) return fail('invalid_url');
  const parsed = new URL(url);
  if (parsed.username || parsed.password) return fail('invalid_url');
  try {
    await (options.assertHost ?? ((u) => assertPublicHost(u, false)))(parsed);
  } catch (error) {
    if (error instanceof FetchFailure && error.code === 'private_address') return fail('private_address');
    return fail('invalid_url');
  }
  const cookies = options.cookiesFromBrowser ? String(options.cookiesFromBrowser).toLowerCase() : null;
  if (cookies && !BROWSERS.includes(cookies)) return fail('invalid_url', { message: `cookiesFromBrowser must be one of: ${BROWSERS.join(', ')}.` });

  const type = options.type === 'caption' ? 'caption' : 'video';
  const refsDir = join(options.jobDir, 'inputs', 'references');
  const manifestPath = join(refsDir, 'manifest.json');
  const id = referenceId(url);
  const manifest = readManifest(manifestPath);
  const existing = manifest.entries.find((e) => e.id === id && e.type === type);
  if (existing && existsSync(join(refsDir, existing.path))) return { ok: true, status: 'already_downloaded', entry: existing };

  const finalDir = join(refsDir, 'video', id);
  const tempDir = join(refsDir, 'video', `.tmp-${id}-${process.pid}`);
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const args = [
    '--ignore-config', '--no-update', '--no-progress', '--no-playlist', '--socket-timeout', '20',
    ...(cookies ? ['--cookies-from-browser', cookies] : ['--no-cookies', '--no-cookies-from-browser']),
    '--max-filesize', REFERENCE_MAX_FILESIZE, '--write-info-json', '--write-thumbnail',
    '-o', join(tempDir, 'video.%(ext)s'),
  ];
  if (type === 'caption') args.push('--skip-download');
  else args.push('-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4');
  args.push('--', url);

  const run = await runYtDlp(args, { binary: referenceYtdlpBinary(options.binary), timeoutMs: options.timeoutMs ?? REFERENCE_DOWNLOAD_TIMEOUT_MS, maxBytes: 4 * 1024 * 1024 });
  const platform = platformOf(url);
  const names = readdirSync(tempDir);
  const videoName = names.find((n) => n.startsWith('video.') && VIDEO_EXT.includes(extname(n).toLowerCase()) && !n.includes('.part'));
  const infoName = names.find((n) => n === 'video.info.json');
  const gotWhatWasAsked = type === 'caption' ? Boolean(infoName) : Boolean(videoName);
  if (!gotWhatWasAsked) {
    rmSync(tempDir, { recursive: true, force: true });
    if (/larger than max-filesize|File is larger/i.test(run.stderr + run.stdout)) return fail('too_large');
    const mapped = mapYtDlpError(run, platform);
    const status = { login_required: 'needs_sign_in', backend_missing: 'yt_dlp_missing', blocked: platform === 'instagram' ? 'needs_sign_in' : 'blocked' }[mapped.code] ?? mapped.code;
    return fail(NEXT[status] ? status : 'download_failed', { detail: mapped.reason, platform });
  }

  let info = null;
  if (infoName) info = parseInfo(readFileSync(join(tempDir, infoName), 'utf8'));
  const title = info?.title ? String(info.title).trim() : null;
  const caption = info?.description ? String(info.description).trim() : title;
  if (caption) writeFileSync(join(tempDir, 'caption.txt'), `${caption}\n`, 'utf8');
  const thumbName = names.find((n) => n.startsWith('video.') && THUMB_EXT.includes(extname(n).toLowerCase()));
  if (thumbName) renameSync(join(tempDir, thumbName), join(tempDir, `thumbnail${extname(thumbName).toLowerCase()}`));
  if (infoName) renameSync(join(tempDir, infoName), join(tempDir, 'info.json'));
  if (videoName) renameSync(join(tempDir, videoName), join(tempDir, `video${extname(videoName).toLowerCase()}`));

  rmSync(finalDir, { recursive: true, force: true });
  renameSync(tempDir, finalDir);
  const mediaFile = videoName ? `video${extname(videoName).toLowerCase()}` : 'info.json';
  const mediaPath = join(finalDir, mediaFile);
  const files = readdirSync(finalDir).sort();
  const entry = {
    id,
    type,
    path: `video/${id}/${mediaFile}`,
    files: files.map((f) => `video/${id}/${f}`),
    sourceUrl: url,
    platform,
    title,
    caption,
    note: options.note ? String(options.note) : null,
    author: info?.uploader ?? info?.channel ?? null,
    sha256: await sha256File(mediaPath),
    bytes: statSync(mediaPath).size,
    durationS: typeof info?.duration === 'number' ? info.duration : null,
    usage: 'reference_only',
    usedCookies: Boolean(cookies),
    downloadedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  // Re-read under the lock, so an upload saved from the board while this was downloading is kept.
  updateReferenceManifest(options.jobDir, (latest) => ({
    ...latest,
    schemaVersion: latest.schemaVersion || 1,
    entries: [...latest.entries.filter((e) => !(e.id === id && e.type === type)), entry],
  }));
  return { ok: true, status: 'downloaded', entry, reminder: 'Reference only: learn from it and describe it; never repost or reuse it as the finished post.' };
}
