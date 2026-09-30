/**
 * Where a watched video comes from.
 *
 * A source is a library asset id, a file on this computer, or a public post address.
 * An address is fetched with yt-dlp into a cache folder inside the workspace, keyed by
 * a hash of the address, together with the page's info.json and any platform
 * captions. A second watch of the same address reuses the cache. Nothing is ever
 * written next to a user's own file.
 *
 * yt-dlp runs through execFile with an argument array and a `--` before the address,
 * so neither a path with spaces nor an address that starts with a dash can be read as
 * something else. Its failures are mapped onto the degraded codes of the research
 * envelope, so a caller can tell "sign in required" from "not found".
 *
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { isId } from '../lib/ids.mjs';
import { assetFromRow } from '../media/ingest.mjs';

/** Environment variable naming a yt-dlp to use instead of the one on PATH. */
export const YTDLP_ENV = 'SOCIAL_CAMPAIGN_YTDLP';

/** How long one yt-dlp run may take before it is stopped. */
const YTDLP_TIMEOUT_MS = 10 * 60_000;

/** How many times an unrecognised yt-dlp failure is tried, and the pause between tries. */
const YTDLP_ATTEMPTS = 3;
const RETRY_WAIT_MS = 1500;

/**
 * The shortest side a download is capped at. Frames are at most 768 pixels on the
 * long edge, so anything above 720 on the short side is bytes nobody looks at.
 */
export const DOWNLOAD_SHORT_SIDE = 720;

/** Containers a downloaded video can land in, in order of preference. */
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];

/** Caption formats the parser reads. */
const CAPTION_EXTENSIONS = ['.vtt', '.srt'];

/**
 * @typedef {'facebook'|'instagram'|'tiktok'|'youtube'|'other'} Platform
 */

/**
 * @typedef {object} WatchSource
 * @property {'url'|'file'|'asset'} kind
 * @property {string|null} url
 * @property {string|null} path the local file, null until an address is downloaded
 * @property {string|null} assetId
 * @property {Platform|null} platform
 * @property {Record<string, any>|null} asset the library record when kind is asset
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isUrl(value) {
  if (typeof value !== 'string' || value.startsWith('-')) return false;
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {Platform}
 */
export function platformOf(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  const is = (/** @type {string} */ domain) => host === domain || host.endsWith(`.${domain}`);
  if (is('tiktok.com')) return 'tiktok';
  if (is('instagram.com')) return 'instagram';
  if (is('facebook.com') || is('fb.watch') || is('fb.com')) return 'facebook';
  if (is('youtube.com') || is('youtu.be')) return 'youtube';
  return 'other';
}

/**
 * The cache key of an address: stable across calls, safe as a folder name.
 * @param {string} url
 * @returns {string}
 */
export function urlKey(url) {
  return `url-${createHash('sha256').update(url.trim()).digest('hex').slice(0, 16)}`;
}

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function watchRoot(workspaceRoot) {
  return join(workspaceRoot, 'imports', 'watch');
}

/**
 * Work out what the caller pointed at. Library assets and files are only read.
 * @param {string} source
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {WatchSource}
 */
export function resolveWatchSource(source, workspace) {
  const value = typeof source === 'string' ? source.trim() : '';
  if (!value) throw new InvalidInputError('Say which video to watch: a post address, a file path or a library asset id.');
  if (isUrl(value)) {
    return { kind: 'url', url: value, path: null, assetId: null, platform: platformOf(value), asset: null };
  }
  if (isId(value)) {
    const row = workspace.requireDb().prepare('SELECT * FROM assets WHERE id = ?').get(value);
    if (!row) throw new InvalidInputError('No asset with that id is in the library.');
    const asset = assetFromRow(row, workspace.requireRoot());
    if (asset.kind !== 'video' && asset.kind !== 'audio') {
      throw new InvalidInputError('That library asset is not a video.', { fix: 'Pick a video asset, or look at an image with Read.' });
    }
    if (!existsSync(asset.path)) {
      throw new InvalidInputError('The file behind that library asset is no longer where it was indexed.', {
        fix: 'Index the folder again so the library knows where the file went.',
      });
    }
    return { kind: 'asset', url: null, path: asset.path, assetId: asset.id, platform: null, asset };
  }
  const path = resolve(value);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new InvalidInputError('That video could not be found.', {
      fix: 'Give a full file path, a post address that starts with https://, or a library asset id.',
    });
  }
  return { kind: 'file', url: null, path, assetId: null, platform: null, asset: null };
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------

/**
 * The yt-dlp to run. SOCIAL_CAMPAIGN_YTDLP may name a different binary, or a .mjs or
 * .js script which is run with this Node, which is how the tests stand one in.
 * @returns {{command: string, prefix: string[]}}
 */
export function ytdlpCommand() {
  const override = process.env[YTDLP_ENV]?.trim();
  if (!override) return { command: 'yt-dlp', prefix: [] };
  const extension = extname(override).toLowerCase();
  if (extension === '.mjs' || extension === '.js') return { command: process.execPath, prefix: [override] };
  return { command: override, prefix: [] };
}

/**
 * Run yt-dlp and hand back its exit code and output, never throwing on a non zero
 * exit: a failed subtitle variant exits non zero even when the video arrived, so the
 * caller decides from what is on disk.
 * @param {string[]} args
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runYtdlp(args) {
  const { command, prefix } = ytdlpCommand();
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      [...prefix, ...args],
      { timeout: YTDLP_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = /** @type {any} */ (error)?.code;
        if (code === 'ENOENT') {
          rejectPromise(
            new UserFacingError('yt-dlp is not installed on this computer, so a video address cannot be opened.', {
              code: 'backend_missing',
              fix: 'Install yt-dlp (on Windows: winget install yt-dlp), or save the video and give its file path instead.',
            }),
          );
          return;
        }
        if (/** @type {any} */ (error)?.killed) {
          rejectPromise(
            new UserFacingError('Fetching that video took too long and was stopped.', {
              code: 'download_failed',
              fix: 'Try again in a few minutes, or save the video and give its file path instead.',
            }),
          );
          return;
        }
        resolvePromise({ code: typeof code === 'number' ? code : error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * yt-dlp error text to a degraded code and a sentence for a person. Ordered from the
 * most specific message to the least.
 * @type {Array<{code: string, pattern: RegExp, message: string, fix: string}>}
 */
const YTDLP_ERRORS = [
  {
    code: 'unsupported',
    pattern: /unsupported url|no suitable extractor|is not a valid url/i,
    message: 'That address is not a video page Social Campaign can open.',
    fix: 'Give the address of the post itself, for example https://www.tiktok.com/@brand/video/123.',
  },
  {
    code: 'login_required',
    pattern: /log ?in|sign in|private|cookies|registered users|members[- ]only|age[- ]restricted|confirm your age|comfortable for some audiences/i,
    message: 'That video is only shown to signed in visitors, so it cannot be watched from here.',
    fix: 'Save the video from the app and give its file path instead.',
  },
  {
    code: 'region_restricted',
    pattern: /available in your (?:country|region)|geo[- ]?restrict|blocked in your (?:country|region)/i,
    message: 'That video is not available in this region.',
    fix: 'Save the video on a device where it plays and give its file path instead.',
  },
  {
    code: 'rate_limited',
    pattern: /http error 429|too many requests|rate[- ]limit|temporarily blocked|try again later/i,
    message: 'The platform is refusing requests for a moment.',
    fix: 'Wait a few minutes and try again.',
  },
  {
    code: 'not_found',
    pattern: /http error 404|http error 410|not found|does not exist|video unavailable|no longer available|has been removed|deleted|status code 10204|unable to find/i,
    message: 'That video could not be found. It may have been removed or made private.',
    fix: 'Check the address in a browser.',
  },
];

/**
 * @param {string} stderr
 * @returns {{code: string, message: string, fix: string}}
 */
export function mapYtdlpError(stderr) {
  const errorLines = String(stderr)
    .split(/\r?\n/)
    .filter((line) => /error/i.test(line))
    .join('\n');
  const text = errorLines || String(stderr);
  for (const entry of YTDLP_ERRORS) {
    if (entry.pattern.test(text)) return { code: entry.code, message: entry.message, fix: entry.fix };
  }
  return {
    code: 'download_failed',
    message: 'That video could not be fetched.',
    fix: 'yt-dlp may need an update (yt-dlp -U), or save the video and give its file path instead.',
  };
}

/**
 * The subtitle languages to ask for. YouTube offers a machine translation into every
 * language, so there only the wanted language and the original track are fetched;
 * other platforms carry a handful of tracks and all of them are small.
 * @param {string} url
 * @param {string|null} language
 * @returns {string}
 */
export function subtitleLanguages(url, language) {
  const wanted = (language ?? 'en').toLowerCase();
  if (platformOf(url) === 'youtube') return `${wanted}.*,${wanted},.*-orig`;
  return 'all,-live_chat';
}

/**
 * The yt-dlp arguments for one fetch. The address always comes last, after `--`.
 * @param {{url: string, dir: string, language: string|null, skipDownload: boolean}} options
 * @returns {string[]}
 */
export function ytdlpArgs(options) {
  const args = [
    '--no-playlist',
    '--no-progress',
    '--no-overwrites',
    '--write-info-json',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    subtitleLanguages(options.url, options.language),
    '--sub-format',
    'vtt/srt/best',
    '--convert-subs',
    'vtt',
    '--ignore-errors',
    '-o',
    join(options.dir, 'video.%(ext)s'),
  ];
  if (options.skipDownload) {
    args.push('--skip-download');
  } else {
    args.push('-f', 'bv*+ba/b', '-S', `res:${DOWNLOAD_SHORT_SIDE}`, '--merge-output-format', 'mp4');
  }
  args.push('--', options.url);
  return args;
}

/**
 * @param {string} dir
 * @returns {string|null}
 */
function findVideo(dir) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  for (const extension of VIDEO_EXTENSIONS) {
    const name = names.find((entry) => entry.startsWith('video.') && entry.toLowerCase().endsWith(extension) && !entry.includes('.part'));
    if (name) return join(dir, name);
  }
  return null;
}

/**
 * The caption tracks in a download folder, with the language from the file name,
 * for example video.en.vtt, video.eng-US.vtt or video.en-orig.vtt.
 * @param {string} dir
 * @returns {Array<{path: string, language: string}>}
 */
export function listCaptionTracks(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('video.') && CAPTION_EXTENSIONS.includes(extname(name).toLowerCase()))
    .sort()
    .map((name) => ({ path: join(dir, name), language: name.slice('video.'.length, -extname(name).length) }))
    .filter((track) => track.language.length > 0 && track.language !== 'live_chat');
}

/**
 * Choose the caption track to use: the asked for language, then the original track,
 * then English, then whatever there is.
 * @param {Array<{path: string, language: string}>} tracks
 * @param {string|null} language
 * @returns {{path: string, language: string}|null}
 */
export function pickCaptionTrack(tracks, language) {
  if (tracks.length === 0) return null;
  // Compare short tags, so a wanted "es" finds TikTok's "spa-ES" and "en" finds "eng-US".
  const tagOf = (/** @type {{language: string}} */ track) => captionLanguageTag(track.language).toLowerCase();
  const matches = (/** @type {string} */ wanted) => (/** @type {{language: string}} */ track) =>
    tagOf(track) === wanted || tagOf(track).startsWith(`${wanted}-`);
  if (language) {
    const wanted = tracks.find(matches(captionLanguageTag(language).toLowerCase()));
    if (wanted) return wanted;
  }
  return tracks.find((track) => /-orig$/i.test(track.language)) ?? tracks.find(matches('en')) ?? tracks[0];
}

/**
 * A caption track's language as a short tag, for example eng-US to en-US.
 * @param {string} trackLanguage
 * @returns {string}
 */
export function captionLanguageTag(trackLanguage) {
  const base = trackLanguage.replace(/-orig$/i, '');
  const [primary, ...rest] = base.split('-');
  const THREE_TO_TWO = /** @type {Record<string, string>} */ ({ eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', zho: 'zh', rus: 'ru', ara: 'ar', hin: 'hi', ind: 'id', vie: 'vi', tha: 'th', tur: 'tr', nld: 'nl', pol: 'pl' });
  const short = THREE_TO_TWO[primary.toLowerCase()] ?? primary.toLowerCase();
  return [short, ...rest].join('-');
}

/**
 * What the platform page says about the video, from yt-dlp's info.json.
 * @param {string} dir
 * @returns {{metadata: Record<string, any>|null, durationS: number|null}}
 */
export function readInfoJson(dir) {
  const path = join(dir, 'video.info.json');
  if (!existsSync(path)) return { metadata: null, durationS: null };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { metadata: null, durationS: null };
  }
  const count = (/** @type {unknown} */ value) => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null);
  const text = (/** @type {unknown} */ value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  let postedAt = null;
  if (Number.isFinite(raw.timestamp)) {
    postedAt = new Date(Number(raw.timestamp) * 1000).toISOString();
  } else if (typeof raw.upload_date === 'string' && /^\d{8}$/.test(raw.upload_date)) {
    postedAt = `${raw.upload_date.slice(0, 4)}-${raw.upload_date.slice(4, 6)}-${raw.upload_date.slice(6, 8)}`;
  }
  return {
    metadata: {
      title: text(raw.title),
      author_handle: text(raw.uploader) ?? text(raw.channel) ?? text(raw.uploader_id),
      posted_at: postedAt,
      description: text(raw.description),
      views: count(raw.view_count),
      likes: count(raw.like_count),
      comments: count(raw.comment_count),
    },
    durationS: Number.isFinite(raw.duration) && raw.duration > 0 ? Number(raw.duration) : null,
  };
}

/**
 * @typedef {object} FetchedUrl
 * @property {string} dir the cache folder
 * @property {string|null} videoPath null when only captions were asked for
 * @property {{path: string, language: string}|null} captions
 * @property {Record<string, any>|null} metadata
 * @property {number|null} durationS what the page says, used when no video was downloaded
 * @property {boolean} cached true when nothing had to be fetched
 */

/**
 * Fetch an address into its cache folder. With skipDownload only info.json and the
 * captions are fetched; a later call without it downloads the video into the same
 * folder. A folder that already holds what was asked for is reused as it is.
 * @param {{url: string, workspaceRoot: string, language?: string|null, skipDownload?: boolean}} options
 * @returns {Promise<FetchedUrl>}
 */
export async function fetchUrl(options) {
  const dir = join(watchRoot(options.workspaceRoot), urlKey(options.url));
  mkdirSync(dir, { recursive: true });
  const language = options.language ?? null;
  const skipDownload = options.skipDownload === true;

  let videoPath = findVideo(dir);
  const haveInfo = existsSync(join(dir, 'video.info.json'));
  const cached = haveInfo && (skipDownload || videoPath !== null);

  if (!cached) {
    // TikTok in particular answers some page requests with a challenge that a later
    // request passes, so an unrecognised failure is tried up to three times.
    for (let attempt = 1; ; attempt += 1) {
      const result = await runYtdlp(ytdlpArgs({ url: options.url, dir, language, skipDownload }));
      videoPath = findVideo(dir);
      const gotWhatWasAsked = skipDownload ? existsSync(join(dir, 'video.info.json')) : videoPath !== null;
      if (gotWhatWasAsked) break;
      const mapped = mapYtdlpError(result.stderr);
      if (mapped.code === 'download_failed' && attempt < YTDLP_ATTEMPTS) {
        await new Promise((resolveWait) => setTimeout(resolveWait, RETRY_WAIT_MS));
        continue;
      }
      throw new UserFacingError(mapped.message, {
        code: mapped.code,
        fix: mapped.fix,
        details: { stderr: result.stderr.slice(-2000), exit_code: result.code, attempts: attempt },
      });
    }
  }

  const { metadata, durationS } = readInfoJson(dir);
  return {
    dir,
    videoPath: skipDownload && !videoPath ? null : videoPath,
    captions: pickCaptionTrack(listCaptionTracks(dir), language),
    metadata,
    durationS,
    cached,
  };
}
