/**
 * The yt-dlp backend.
 *
 * yt-dlp is the only external binary the social tools run. It is always spawned
 * with an argument array, never through a shell, with --ignore-config so a user's
 * own yt-dlp config can never slip cookies or a login into a read, a time limit
 * that kills the whole process tree, and a cap on how much output is read.
 *
 * What yt-dlp could read without a login was tested live on 2026-09-12 with
 * yt-dlp 2026.03.17 and 2026.06.09 (see docs/CONTRACTS.md section 1a): TikTok answered
 * it with a bot check page when no browser impersonation library is installed,
 * Instagram asked for a login, and Facebook pages were unsupported and videos
 * unparseable. The router therefore tries it first where it is the richest source
 * and falls back the moment it fails.
 */

import { execFile, spawn } from 'node:child_process';

import { pythonChildEnv } from '../../lib/python-env.mjs';
import { referenceYtdlpBinary } from '../../lib/ytdlp-binary.mjs';
import { postRecord, profileRecord, commentRecord, toCount, toIso } from '../records.mjs';

/** Longest a single yt-dlp metadata read may take. */
export const YTDLP_TIMEOUT_MS = 30_000;

/** A YouTube Short may run up to three minutes. */
export const SHORT_MAX_S = 180;

/** Most output read from one yt-dlp run. A 50 post listing is well under 1 MB. */
export const YTDLP_MAX_BYTES = 16 * 1024 * 1024;

/** Flags every read carries: no config, no cookies, no update check, no progress. */
const BASE_ARGS = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-update', '--no-progress', '--retries', '1', '--fragment-retries', '1', '--extractor-retries', '0', '--socket-timeout', '10'];

/** The flags that stop yt-dlp's own retry loops (its defaults are 10, 10 and 3), for runners that build their own argument list. */
export const YTDLP_NO_RETRY_ARGS = ['--retries', '1', '--fragment-retries', '1', '--extractor-retries', '0', '--socket-timeout', '10'];

/**
 * The yt-dlp command. SOCIAL_CAMPAIGN_YTDLP points at another yt-dlp, and when it
 * names a .mjs or .js file that script is run with this Node, which is how the tests
 * put a fake yt-dlp in place on every operating system.
 * @param {string} [override]
 * @returns {{command: string, prefix: string[]}}
 */
export function ytdlpCommand(override) {
  const configured = override ?? process.env.SOCIAL_CAMPAIGN_YTDLP ?? 'yt-dlp';
  if (/\.(mjs|cjs|js)$/i.test(configured)) return { command: process.execPath, prefix: [configured] };
  return { command: configured, prefix: [] };
}

/**
 * @typedef {object} RunResult
 * @property {boolean} ok exit code 0 with nothing wrong.
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr last 64 KB of it.
 * @property {boolean} missing the binary is not installed.
 * @property {boolean} timedOut
 * @property {boolean} tooLarge the output passed the cap and the run was stopped.
 */

/**
 * Stop a process and everything it started. The pip installed yt-dlp.exe is a
 * launcher that starts Python, so killing only the launcher would leave Python running.
 * @param {import('node:child_process').ChildProcess} child
 */
export function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/**
 * Run yt-dlp with an argument array.
 * @param {string[]} args
 * @param {{binary?: string, timeoutMs?: number, maxBytes?: number}} [options]
 * @returns {Promise<RunResult>}
 */
export function runYtDlp(args, options = {}) {
  const { command, prefix } = ytdlpCommand(options.binary);
  const timeoutMs = options.timeoutMs ?? YTDLP_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? YTDLP_MAX_BYTES;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...prefix, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: pythonChildEnv(),
      });
    } catch {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: '', missing: true, timedOut: false, tooLarge: false });
      return;
    }
    /** @type {Buffer[]} */
    const out = [];
    let outBytes = 0;
    let err = '';
    let timedOut = false;
    let tooLarge = false;
    let missing = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (tooLarge) return;
      outBytes += chunk.length;
      if (outBytes > maxBytes) {
        tooLarge = true;
        killTree(child);
        return;
      }
      out.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      err = (err + chunk).slice(-65_536);
    });
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      resolve({
        ok: exitCode === 0 && !timedOut && !tooLarge && !missing,
        exitCode,
        stdout,
        stderr: err,
        missing,
        timedOut,
        tooLarge,
      });
    };
    child.on('error', (error) => {
      if (/** @type {any} */ (error).code === 'ENOENT') missing = true;
      else err += `\n${error.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/**
 * @typedef {object} YtDlpFailure
 * @property {'login_required'|'region_restricted'|'rate_limited'|'not_found'|'unsupported'|'blocked'|'backend_missing'|'timed_out'|'save_failed'|'impersonation_missing'|'ffmpeg_missing'|'download_failed'} code
 * @property {string} reason one plain sentence.
 * @property {boolean} trip whether this backend should be skipped for a while on this platform.
 */

/** Error patterns, most specific first. Each was seen in a live run or in yt-dlp's own messages. */
const ERROR_PATTERNS = [
  // Local problems come first: they are about this computer, never about the platform, so they never trip the breaker.
  [/unable to open for writing|No such file or directory|Errno (2|22|13)\b|Permission denied|path too long|filename too long|No space left/i, 'save_failed', false],
  [/Impersonate target .* is not available|no impersonate target is available/i, 'impersonation_missing', false],
  [/ffmpeg is not installed|ffmpeg not found|requested merging of multiple formats but ffmpeg/i, 'ffmpeg_missing', false],
  [/private (account|video)|(video|account) is private/i, 'login_required', false],
  [/login required|log in|sign in to|cookies-from-browser|--cookies|authentication/i, 'login_required', true],
  [/HTTP Error 429|too many requests|rate[- ]limit/i, 'rate_limited', true],
  [/unsupported url/i, 'unsupported', false],
  [/HTTP Error 404|not found|does not exist|video (is )?unavailable|no longer available|removed|has been deleted/i, 'not_found', false],
  [/geo[- ]?restrict|not available in your (country|region)/i, 'region_restricted', false],
  [/impersonat|unexpected response|unable to extract|cannot parse|failed to parse json|no working app info|secondary user id|HTTP Error 403|challenge/i, 'blocked', true],
];

/** Plain sentences for each code, with the platform name filled in. */
const REASONS = {
  login_required: (name) => `${name} only shows this to signed in visitors, and Social Campaign never signs in.`,
  rate_limited: (name) => `${name} asked automated readers to slow down; try again later.`,
  unsupported: (name) => `This kind of ${name} address cannot be read directly.`,
  not_found: (name) => `${name} says this does not exist, or it is no longer public.`,
  region_restricted: (name) => `${name} does not show this in this region.`,
  blocked: (name) => `${name} answered the reader with a bot check instead of the page; this usually lasts until yt-dlp is updated or a browser impersonation library is installed for it.`,
  save_failed: () => 'The video downloaded but could not be saved on this computer.',
  impersonation_missing: (name) => `${name} needs yt-dlp's browser mode, which is not installed.`,
  ffmpeg_missing: () => 'ffmpeg is not installed, so the video and sound could not be joined.',
  backend_missing: () => 'yt-dlp is not installed on this computer.',
  timed_out: (name) => `${name} did not answer in time.`,
};

/**
 * Turn a failed run into a degraded code and a friendly sentence.
 * @param {RunResult} run
 * @param {string} platform
 * @returns {YtDlpFailure}
 */
export function mapYtDlpError(run, platform) {
  const name = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }[platform] ?? 'The platform';
  if (run.missing) return { code: 'backend_missing', reason: REASONS.backend_missing(name), trip: true };
  if (run.timedOut) return { code: 'timed_out', reason: REASONS.timed_out(name), trip: true };
  if (run.tooLarge) return { code: 'unsupported', reason: `${name} returned more data than a research read is allowed to hold.`, trip: false };
  const errorLines = run.stderr
    .split(/\r?\n/)
    .filter((line) => /^ERROR:/.test(line))
    .join('\n');
  const haystack = errorLines || run.stderr;
  for (const [pattern, code, trip] of ERROR_PATTERNS) {
    if (/** @type {RegExp} */ (pattern).test(haystack)) {
      return { code: /** @type {any} */ (code), reason: REASONS[/** @type {string} */ (code)](name), trip: /** @type {boolean} */ (trip) };
    }
  }
  // An unrecognised failure is not proof of a bot check: say what yt-dlp said, so the real cause is visible.
  const last = errorLines.split('\n').filter(Boolean).at(-1)?.replace(/^ERROR:\s*/, '').trim().slice(0, 300);
  return { code: 'download_failed', reason: last ? `yt-dlp could not read this ${name} address: ${last}` : `yt-dlp could not read this ${name} address.`, trip: true };
}

/** yt-dlp's answer for a channel that has no such tab: "This channel does not have a shorts tab". */
const NO_TAB = /does not have an? (shorts|videos|streams|live) tab/i;

/** yt-dlp's answer for an Instagram post with no video in it (a photo or a carousel of photos). */
const NO_VIDEO_FORMATS = /no video formats found/i;

/** The codes the research router understands; the newer yt-dlp codes read as `blocked`, `unsupported` or `blocked` there. */
const ROUTER_CODE = { save_failed: 'unsupported', ffmpeg_missing: 'unsupported', impersonation_missing: 'blocked', download_failed: 'blocked' };

/**
 * mapYtDlpError for the research router, whose degraded codes are a fixed list. The reason still carries the
 * honest sentence, so only the code is folded.
 * @param {RunResult} run
 * @param {string} platform
 * @returns {YtDlpFailure}
 */
export function mapYtDlpErrorForRouter(run, platform) {
  const failure = mapYtDlpError(run, platform);
  return ROUTER_CODE[failure.code] ? { ...failure, code: /** @type {any} */ (ROUTER_CODE[failure.code]) } : failure;
}

/**
 * Parse yt-dlp's JSON output, or null.
 * @param {string} stdout
 * @returns {Record<string, any>|null}
 */
export function parseInfo(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === 'null') return null;
  // -J prints one JSON document; a stray line before it on stdout is skipped.
  for (const candidate of [trimmed, trimmed.split(/\r?\n/).filter(Boolean).at(-1) ?? '']) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      // try the next form
    }
  }
  return null;
}

/**
 * A post record from a yt-dlp info dict, or from one flat playlist entry.
 * @param {Record<string, any>} info
 * @param {'tiktok'|'instagram'|'facebook'|'youtube'} platform
 * @param {string} observedAt
 * @param {string} sourceRef
 * @returns {Record<string, any>}
 */
export function postFromInfo(info, platform, observedAt, sourceRef) {
  const url = String(info.webpage_url ?? info.url ?? info.original_url ?? '');
  // On YouTube the handle is the @name (uploader_id); `uploader` is the channel's display name.
  const handle = (platform === 'youtube' ? String(info.uploader_id ?? '').replace(/^@/, '') || null : null) ?? info.uploader ?? info.channel ?? null;
  const tiktokUrl = platform === 'tiktok' && handle && info.id && !/\/video\//.test(url) ? `https://www.tiktok.com/@${handle}/video/${info.id}` : url;
  const artists = Array.isArray(info.artists) ? info.artists.join(', ') : info.artist;
  return postRecord({
    platform,
    url: tiktokUrl,
    post_id: info.id != null ? String(info.id) : null,
    author_handle: handle,
    posted_at: info.timestamp ?? (info.upload_date ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}` : null),
    media_kind: info.duration || info.vcodec || /video|reel|\/shorts\//.test(url) ? 'video' : info._type === 'playlist' ? 'carousel' : 'unknown',
    caption: info.description ?? info.title ?? null,
    hashtags: Array.isArray(info.tags) ? info.tags.map((tag) => String(tag).replace(/^#/, '').toLowerCase()) : undefined,
    duration_s: typeof info.duration === 'number' ? info.duration : null,
    sound: info.track ? [info.track, artists].filter(Boolean).join(' - ') : null,
    metrics: {
      views: info.view_count,
      likes: info.like_count,
      comments: info.comment_count,
      shares: info.repost_count,
      saves: info.save_count,
    },
    thumbnail_url: info.thumbnail ?? (Array.isArray(info.thumbnails) ? info.thumbnails.at(-1)?.url : null),
    source_type: 'public_platform',
    source_ref: sourceRef,
    observed_at: observedAt,
    confidence: 0.9,
  });
}

/**
 * The yt-dlp reader, bound to one binary and time limit.
 */
export class YtDlpBackend {
  /**
   * @param {{binary?: string, timeoutMs?: number, maxBytes?: number, retryDelayMs?: number}} [options] retryDelayMs is ignored
   */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Run a read: one attempt, no pause and no second run. A bot check answer is reported as a failure and the router
   * moves on to the next source; waiting for a second try only delays the research.
   * @param {string[]} args
   * @param {string} [_platform]
   * @returns {Promise<RunResult>}
   */
  async run(args, _platform) {
    // retryDelayMs is accepted for older callers and ignored.
    const { retryDelayMs: _delay, ...runOptions } = this.options;
    return runYtDlp([...BASE_ARGS, ...args], { ...runOptions, binary: referenceYtdlpBinary(runOptions.binary) });
  }

  /**
   * Whether yt-dlp runs at all, its version, and whether it can impersonate a
   * browser, which is what TikTok's bot check wants. A binary
   * that exists is not proof of health, so the probe really executes it.
   * @returns {Promise<{present: boolean, status: 'ok'|'missing'|'broken'|'timed_out', version: string|null, impersonation: boolean|null, detail: string}>}
   */
  async health() {
    const probeOptions = { ...this.options, binary: referenceYtdlpBinary(this.options.binary), timeoutMs: 15_000 };
    const version = await runYtDlp(['--version'], probeOptions);
    if (version.missing) return { present: false, status: 'missing', version: null, impersonation: null, detail: 'yt-dlp is not installed.' };
    if (version.timedOut) return { present: true, status: 'timed_out', version: null, impersonation: null, detail: 'yt-dlp did not answer within 15 seconds.' };
    if (!version.ok) {
      return { present: true, status: 'broken', version: null, impersonation: null, detail: `yt-dlp is installed but does not run: ${version.stderr.trim().split(/\r?\n/).at(-1) ?? 'no output'}` };
    }
    const number = version.stdout.trim().split(/\r?\n/)[0] || null;
    const targets = await runYtDlp(['--ignore-config', '--list-impersonate-targets'], probeOptions);
    const listing = `${targets.stdout}\n${targets.stderr}`;
    const rows = listing.split(/\r?\n/).filter((line) => /curl_cffi/i.test(line));
    const impersonation = targets.ok ? rows.some((line) => !/unavailable/i.test(line)) : null;
    return {
      present: true,
      status: 'ok',
      version: number,
      impersonation,
      detail:
        impersonation === false
          ? `yt-dlp ${number}, without browser impersonation, which TikTok's bot check usually needs. Installing "yt-dlp[default,curl-cffi]" with pip adds it.`
          : `yt-dlp ${number}.`,
    };
  }

  /**
   * One post, full metadata.
   * @param {string} url
   * @param {'tiktok'|'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, record: Record<string, any>, info: Record<string, any>}|{ok: false, failure: YtDlpFailure}>}
   */
  async post(url, platform) {
    const run = await this.run(['-J', '--skip-download', '--no-playlist', url], platform);
    const info = run.ok ? parseInfo(run.stdout) : null;
    if (!info) return { ok: false, failure: mapYtDlpErrorForRouter(run, platform) };
    return { ok: true, record: postFromInfo(info, platform, new Date().toISOString(), `yt-dlp:${url}`), info };
  }

  /**
   * A profile listing: the latest `limit` posts, without downloading anything. On YouTube this is a channel's
   * Shorts tab (https://www.youtube.com/@name/shorts), which yt-dlp lists in about 1.5 seconds with view counts
   * (rounded by YouTube) and no dates.
   * @param {string} url
   * @param {'tiktok'|'instagram'|'facebook'|'youtube'} platform
   * @param {number} limit
   * @returns {Promise<{ok: true, profile: Record<string, any>, posts: Array<Record<string, any>>}|{ok: false, failure: YtDlpFailure}>}
   */
  async listing(url, platform, limit) {
    const run = await this.run(['--flat-playlist', '-J', '--playlist-end', String(limit), url], platform);
    const info = run.ok ? parseInfo(run.stdout) : null;
    if (!info || !Array.isArray(info.entries)) {
      // A channel with no Shorts (or Videos) tab is a channel that has none: empty, not a refusal, and nothing to trip.
      const tab = `${run.stderr}`.match(NO_TAB)?.[1]?.toLowerCase();
      if (tab) return { ok: false, failure: { code: /** @type {any} */ ('empty'), reason: `This YouTube channel has no ${tab} tab.`, trip: false } };
      return { ok: false, failure: mapYtDlpErrorForRouter(run, platform) };
    }
    const observedAt = new Date().toISOString();
    const posts = info.entries
      .filter((entry) => entry && typeof entry === 'object')
      .slice(0, limit)
      .map((entry) => postFromInfo({ uploader: info.uploader, uploader_id: info.uploader_id, ...entry }, platform, observedAt, `yt-dlp:${url}`));
    const first = info.entries.find((entry) => entry && typeof entry === 'object') ?? {};
    const profile = profileRecord({
      platform,
      url,
      handle: (platform === 'youtube' ? String(info.uploader_id ?? '').replace(/^@/, '') || null : null) ?? info.uploader ?? first.uploader ?? null,
      display_name: info.channel ?? info.uploader ?? first.channel ?? null,
      bio: info.description ?? null,
      followers: info.channel_follower_count,
      verified: typeof info.channel_is_verified === 'boolean' ? info.channel_is_verified : null,
      // A channel listing names the channel's picture among its thumbnails (avatar_uncropped, else an avatar of another size).
      avatar_url: Array.isArray(info.thumbnails) ? (info.thumbnails.find((item) => item?.id === 'avatar_uncropped') ?? info.thumbnails.find((item) => /avatar/i.test(String(item?.id ?? ''))))?.url ?? null : null,
      source_ref: `yt-dlp:${url}`,
      observed_at: observedAt,
    });
    return { ok: true, profile, posts };
  }

  /**
   * YouTube keyword search for Shorts: `ytsearchN:<words> shorts`, flat, so each entry is a title, a channel, a duration
   * and a rounded view count with no date. Videos longer than a Short (3 minutes) are dropped; the rest are ranked by views.
   * @param {string} query
   * @param {'youtube'} platform
   * @param {number} limit
   * @returns {Promise<{ok: true, posts: Array<Record<string, any>>}|{ok: false, failure: YtDlpFailure}>}
   */
  async search(query, platform, limit) {
    const asked = Math.min(Math.max(limit * 3, 10), 40);
    const run = await this.run(['--flat-playlist', '--dump-json', `ytsearch${asked}:${query} shorts`], platform);
    const entries = [];
    for (const line of run.stdout.split(/\r?\n/)) {
      const text = line.trim();
      if (!text.startsWith('{')) continue;
      try {
        const entry = JSON.parse(text);
        if (entry && typeof entry === 'object') entries.push(entry);
      } catch {
        // a stray line that is not JSON
      }
    }
    if (entries.length === 0) return { ok: false, failure: mapYtDlpErrorForRouter(run, platform) };
    const observedAt = new Date().toISOString();
    const posts = entries
      .filter((entry) => entry.id && (typeof entry.duration !== 'number' || entry.duration <= SHORT_MAX_S))
      .map((entry) => postFromInfo({ ...entry, webpage_url: `https://www.youtube.com/shorts/${entry.id}` }, platform, observedAt, `yt-dlp:ytsearch:${query}`))
      .sort((a, b) => (b.metrics.views ?? -1) - (a.metrics.views ?? -1));
    if (posts.length === 0) return { ok: false, failure: { code: 'empty', reason: 'YouTube listed nothing short enough to be a Short for that search.', trip: false } };
    return { ok: true, posts };
  }

  /**
   * Comments on one post, where yt-dlp's extractor supports them (Instagram does;
   * TikTok's extractor in 2026.03.17 has no comment support).
   * @param {string} url
   * @param {'tiktok'|'instagram'|'facebook'} platform
   * @param {number} limit
   * @returns {Promise<{ok: true, records: Array<Record<string, any>>, total: number|null}|{ok: false, failure: YtDlpFailure}>}
   */
  async comments(url, platform, limit) {
    const run = await this.run(['-J', '--skip-download', '--no-playlist', '--write-comments', url], platform);
    const info = run.ok ? parseInfo(run.stdout) : null;
    if (!info) {
      // yt-dlp's Instagram extractor only knows video posts: on a photo or carousel it stops before the comments.
      if (!run.timedOut && !run.missing && NO_VIDEO_FORMATS.test(run.stderr)) {
        return { ok: false, failure: { code: 'unsupported', reason: 'yt-dlp reads comments only on video posts, and this one is a photo or a carousel.', trip: false } };
      }
      return { ok: false, failure: mapYtDlpErrorForRouter(run, platform) };
    }
    if (!Array.isArray(info.comments)) {
      return { ok: false, failure: { code: 'unsupported', reason: 'yt-dlp read the post but cannot read its comments.', trip: false } };
    }
    const observedAt = new Date().toISOString();
    const records = info.comments
      .filter((comment) => comment && (comment.parent === 'root' || comment.parent === undefined))
      .map((comment) =>
        commentRecord({
          platform,
          post_url: url,
          comment_id: comment.id != null ? String(comment.id) : null,
          author_handle: comment.author ?? null,
          text: comment.text ?? '',
          likes: comment.like_count,
          replies: info.comments.filter((reply) => reply.parent === comment.id).length || toCount(comment.reply_count),
          posted_at: toIso(comment.timestamp),
          source_ref: `yt-dlp:${url}`,
          observed_at: observedAt,
        }),
      )
      .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || (b.replies ?? -1) - (a.replies ?? -1))
      .slice(0, limit);
    return { ok: true, records, total: toCount(info.comment_count) };
  }
}
