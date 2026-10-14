/**
 * pipeline_reference_search: find candidate reference videos on public routes that need no login.
 *
 * This is step 3 of the researcher's discovery ladder. It runs yt-dlp (the research helper venv's, as the teardown
 * does) with an argument array and no cookies:
 *   - YouTube Shorts: `ytsearch{K}:{query} shorts --flat-playlist --dump-json`, ranked by view count, keeping only
 *     videos of maxDurationS seconds or less. Flat listings sometimes leave views or length empty, so the top few
 *     such items are opened once with --dump-json before they are counted.
 *   - TikTok hashtag pages through `--impersonate chrome` (needs curl_cffi) are NOT part of the default search: every
 *     live read since 2026-10-13 got a bot check. They run only when the caller asks for platform "tiktok" outright, and
 *     their refusals are kept apart from the TikTok breaker that the single URL verify and the downloads share.
 *
 * The Instaloader (Instagram) and TikTok-Api (TikTok) library routes that used to sit beside these were retired on
 * 2026-10-13: signed out, 0 of 5 live reads worked (Instaloader profile 429 and hashtag 403 login_required, TikTok-Api
 * hashtag, user and trending all empty or crashing after 21 to 30 seconds). Instagram is read by social_profile_get,
 * social_post_get and social_search (the Scrapling page op, whose /popular/<topic>/ pages list reels with play counts).
 *
 * - `urls: [...]` is the verify step: each single public video URL (found by a web search, a competitor's site or a press
 *   page, never from a listing page) is opened on its own with `--dump-json --skip-download --no-cookies`, with
 *   `--impersonate chrome` for TikTok when this yt-dlp can (asked once per process, so there is no second run). Each URL gets its own status
 *   (ok / blocked / not_found / login_required), so a walled search or profile page never says anything about a video.
 *
 * It only lists candidates. The researcher still checks each one is in the niche, then downloads and takes it apart
 * with pipeline_video_teardown.
 */

import { runYtDlp, mapYtDlpError } from '../social/backends/ytdlp.mjs';
import { referenceYtdlpBinary } from './url-reference.mjs';
import { assertPublicHost } from '../social/backends/web.mjs';
import { breaker as sharedBreaker } from '../social/breaker.mjs';

export const SEARCH_MAX_DURATION_S = 90;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;
const ENRICH_MAX = 6;
const SEARCH_TIMEOUT_MS = 30_000;
const ENRICH_TIMEOUT_MS = 30_000;
/** The whole pipeline_reference_search call, whatever it does, is over by this. */
export const SEARCH_BUDGET_MS = 90_000;
/** Below this there is no point starting another step. */
const MIN_STEP_MS = 2_000;
const BASE = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-update', '--no-progress', '--retries', '1', '--fragment-retries', '1', '--extractor-retries', '0', '--socket-timeout', '10'];

/** Breaker key for each platform this tool can touch. */
const HOST_OF_PLATFORM = { youtube: 'youtube.com', tiktok: 'tiktok.com', instagram: 'instagram.com' };
/** Failure codes that mean the platform is refusing us: skip the rest of that platform for this call. */
const WALL_CODES = new Set(['blocked', 'login_required', 'rate_limited', 'impersonation_unavailable']);
const BREAKER_CODES = new Set(['blocked', 'login_required', 'rate_limited']);

/**
 * A time budget for one call. Every step asks for min(its own limit, what is left).
 * @param {number} totalMs
 * @param {() => number} [now]
 */
export function createDeadline(totalMs, now = () => Date.now()) {
  const end = now() + totalMs;
  return {
    remaining: () => Math.max(end - now(), 0),
    expired: () => end - now() < MIN_STEP_MS,
    slice: (limitMs) => Math.max(Math.min(limitMs, end - now()), 1),
  };
}

/**
 * Remembers which platforms refused us during this call (and tells the shared breaker), so the rest of that
 * platform is skipped for the call and, via the breaker, for other tools for a while. The single URL verify uses the
 * host as a whole (the downloads share it); the keyword search and the TikTok tag pages each keep a scope of their own,
 * so a search that was walled never says anything about one video's address.
 * @param {{isOpen: Function, recordFailure: Function, recordSuccess: Function}} breaker
 */
function createGate(breaker) {
  /** @type {Map<string, {status: string, detail: string}>} */
  const walls = new Map();
  const wallKey = (platform, scope) => (scope ? `${platform}#${scope}` : platform);
  return {
    /** null when the platform may be tried; otherwise the route status to report instead. `scope` names a route of the host. */
    check(platform, scope) {
      const hit = walls.get(wallKey(platform, scope));
      if (hit) return { status: 'skipped', detail: `Skipped: ${hit.detail}` };
      const host = HOST_OF_PLATFORM[platform];
      const state = host ? breaker.isOpen(host, scope) : { open: false };
      if (state.open) {
        const detail = state.reason || `${host} refused recent reads (${state.code ?? 'blocked'}).`;
        walls.set(wallKey(platform, scope), { status: 'skipped', detail });
        return { status: 'skipped', detail: `Skipped: ${detail}` };
      }
      return null;
    },
    fail(platform, code, detail, scope) {
      if (WALL_CODES.has(code)) walls.set(wallKey(platform, scope), { status: code, detail: `${platform} answered ${code} earlier in this call.` });
      const host = HOST_OF_PLATFORM[platform];
      if (host && BREAKER_CODES.has(code)) breaker.recordFailure(host, code, detail, scope);
    },
    ok(platform, scope) {
      const host = HOST_OF_PLATFORM[platform];
      if (host) breaker.recordSuccess(host, scope);
    },
  };
}

/** The breaker scope of the TikTok tag pages: their refusals never reach the single URL verify or the downloads. */
export const TAG_SCOPE = 'tag';
const TAG_ROUTE_NOTE =
  'TikTok hashtag pages answered a bot check on every live read, so they are not part of the search. For TikTok use social_search with a #hashtag (its totals), social_profile_get and social_outliers_find on competitor accounts, and urls to verify single videos; pass platform "tiktok" with tiktokTags to try the tag pages anyway.';

const IMPERSONATION_NOTE = 'This yt-dlp has no browser impersonation (curl_cffi is not installed), so TikTok answers with a bot check.';
/** @type {Map<string, Promise<boolean>>} */
const impersonationChecks = new Map();

/** Once per process and binary: can this yt-dlp impersonate Chrome? Unknown counts as yes. */
function canImpersonate(binary) {
  const key = String(binary ?? '');
  if (!impersonationChecks.has(key)) {
    impersonationChecks.set(key, runYtDlp(['--list-impersonate-targets'], { binary, timeoutMs: 10_000, maxBytes: 256 * 1024 }).then((r) => {
      if (!r.ok) return true;
      const chrome = `${r.stdout}`.split(/\r?\n/).filter((l) => /chrome/i.test(l));
      return !(chrome.length && chrome.every((l) => /unavailable/i.test(l)));
    }).catch(() => true));
  }
  return impersonationChecks.get(key);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function jsonLines(stdout) {
  const out = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      out.push(JSON.parse(text));
    } catch {
      // a stray non-JSON line; skip it
    }
  }
  return out;
}

function toCandidate(entry, platform, route) {
  const id = entry.id ? String(entry.id) : null;
  let url = entry.webpage_url || entry.original_url || entry.url || null;
  if (platform === 'youtube' && id && (!url || !/^https?:/i.test(url))) url = `https://www.youtube.com/shorts/${id}`;
  if (platform === 'youtube' && id && /youtube\.com\/watch/i.test(url ?? '')) url = `https://www.youtube.com/shorts/${id}`;
  if (!url || !/^https?:/i.test(url)) return null;
  return {
    url,
    platform,
    title: entry.title ? String(entry.title).trim() : null,
    channel: entry.channel || entry.uploader || null,
    views: num(entry.view_count),
    durationS: num(entry.duration),
    uploadDate: entry.upload_date ? String(entry.upload_date) : null,
    route,
  };
}

async function enrich(candidates, runOptions, run) {
  const todo = candidates.filter((c) => c.views === null || c.durationS === null || !c.uploadDate).slice(0, ENRICH_MAX);
  await Promise.all(todo.map(async (c) => {
    const result = await run([...BASE, '--no-playlist', '--skip-download', '--dump-json', '--', c.url], { ...runOptions, timeoutMs: ENRICH_TIMEOUT_MS });
    const info = jsonLines(result.stdout)[0];
    if (!info) return;
    c.views ??= num(info.view_count);
    c.durationS ??= num(info.duration);
    c.uploadDate ??= info.upload_date ? String(info.upload_date) : null;
    c.channel ??= info.channel || info.uploader || null;
  }));
}

function tagOf(value) {
  return String(value ?? '').trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '');
}

const VERIFY_MAX_URLS = 12;
const VERIFY_TIMEOUT_MS = 30_000;
const VERIFY_CONCURRENCY = 3;

/** Which platform a URL is on, and whether it names ONE video (a listing, tag, search or profile page does not). */
export function classifyVideoUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return { valid: false, platform: 'other', single: false, reason: 'not a web address' };
  }
  if (!/^https?:$/.test(u.protocol)) return { valid: false, platform: 'other', single: false, reason: 'not a web address' };
  const host = u.hostname.replace(/^(www|m|mobile)\./i, '').toLowerCase();
  const path = u.pathname;
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    if (/^\/@[^/]+\/(video|photo)\/\d+/.test(path) || /^\/(t|v)\/[\w-]+/.test(path) || /^(vm|vt)\./.test(host)) return { valid: true, platform: 'tiktok', single: true };
    return { valid: true, platform: 'tiktok', single: false, reason: 'a TikTok listing, profile or search page, not one video' };
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    if (/^\/(?:[^/]+\/)?(reel|reels|p|tv)\/[\w-]+/.test(path)) return { valid: true, platform: 'instagram', single: true };
    return { valid: true, platform: 'instagram', single: false, reason: 'an Instagram listing, hashtag or profile page, not one Reel' };
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    if (/^\/shorts\/[\w-]+/.test(path) || (host === 'youtu.be' && path.length > 1) || (/^\/watch$/.test(path) && u.searchParams.get('v'))) return { valid: true, platform: 'youtube', single: true };
    return { valid: true, platform: 'youtube', single: false, reason: 'a YouTube listing, channel or search page, not one video' };
  }
  return { valid: true, platform: 'other', single: true };
}

function statusOf(code) {
  if (code === 'login_required') return 'login_required';
  if (code === 'not_found') return 'not_found';
  if (code === 'backend_missing' || code === 'impersonation_missing' || code === 'ffmpeg_missing') return 'backend_missing';
  return 'blocked';
}

function infoToRow(url, platform, info, impersonated) {
  return {
    url,
    platform,
    status: 'ok',
    title: info.title ? String(info.title).replace(/\s+/g, ' ').trim().slice(0, 140) : null,
    uploader: info.uploader || info.channel || null,
    views: num(info.view_count),
    likes: num(info.like_count),
    comments: num(info.comment_count),
    durationS: num(info.duration),
    uploadDate: info.upload_date ? String(info.upload_date) : null,
    pageUrl: info.webpage_url || url,
    ...(impersonated ? { impersonated: true } : {}),
  };
}

async function verifyOne(rawUrl, runOptions, run, assertHost, ctx) {
  const url = String(rawUrl ?? '').trim();
  const kind = classifyVideoUrl(url);
  if (!kind.valid) return { url, platform: kind.platform, status: 'invalid_url', reason: kind.reason };
  if (!kind.single) return { url, platform: kind.platform, status: 'not_a_video_url', reason: kind.reason };
  try {
    await assertHost(new URL(url));
  } catch (error) {
    return { url, platform: kind.platform, status: 'invalid_url', reason: error?.message ?? 'address could not be checked' };
  }
  const walled = ctx.gate.check(kind.platform);
  if (walled) return { url, platform: kind.platform, status: 'skipped', reason: walled.detail };
  if (ctx.deadline.expired()) return { url, platform: kind.platform, status: 'skipped', reason: 'Skipped: the 90 second budget for this search was used.' };
  // Decided once up front: TikTok is opened with impersonation only when this yt-dlp has it. No second run.
  const impersonate = kind.platform === 'tiktok' && ctx.impersonation;
  const args = [...BASE, ...(impersonate ? ['--impersonate', 'chrome'] : []), '--no-playlist', '--skip-download', '--dump-json', '--', url];
  const result = await run(args, { ...runOptions, timeoutMs: ctx.deadline.slice(VERIFY_TIMEOUT_MS) });
  const info = jsonLines(result.stdout)[0];
  if (info) {
    ctx.gate.ok(kind.platform);
    return infoToRow(url, kind.platform, info, impersonate);
  }
  const mapped = mapYtDlpError(result, kind.platform);
  const status = result.timedOut ? 'timed_out' : statusOf(mapped.code);
  ctx.gate.fail(kind.platform, status, mapped.reason);
  return { url, platform: kind.platform, status, code: mapped.code, reason: mapped.reason };
}

/**
 * Open each single public video URL on its own and report what yt-dlp saw. A URL is only ever called blocked,
 * login_required or not_found here, from its own page, never because a search, hashtag or profile page was walled.
 * @param {string[]} urls
 * @param {{binary?: string, run?: typeof runYtDlp, assertHost?: (u: URL) => Promise<void>, budgetMs?: number, breaker?: any, impersonation?: boolean}} [options]
 */
export async function verifyReferenceUrls(urls, options = {}) {
  const seen = new Set();
  const list = (Array.isArray(urls) ? urls : []).map((u) => String(u ?? '').trim()).filter((u) => u && !seen.has(u) && seen.add(u)).slice(0, VERIFY_MAX_URLS);
  if (!list.length) return { ok: false, status: 'invalid_query', message: 'Give at least one single video URL in urls.', results: [], counts: {} };
  const run = options.run ?? runYtDlp;
  const assertHost = options.assertHost ?? ((u) => assertPublicHost(u, false));
  const runOptions = { binary: referenceYtdlpBinary(options.binary), timeoutMs: VERIFY_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 };
  const deadline = options.deadline ?? createDeadline(options.budgetMs ?? SEARCH_BUDGET_MS);
  const gate = createGate(options.breaker ?? sharedBreaker);
  const wantsTiktok = list.some((u) => classifyVideoUrl(u).platform === 'tiktok');
  // A custom runner (tests) is assumed to cope; the real yt-dlp is asked once per process.
  const impersonation = options.impersonation ?? (wantsTiktok && !options.run ? await canImpersonate(runOptions.binary) : true);
  const ctx = { deadline, gate, impersonation };
  const results = new Array(list.length);
  // TikTok and Instagram are read one at a time (a bot check on the first says the same about the rest); everything
  // else runs three at a time. The lanes run side by side.
  const lanes = [];
  const sequential = { tiktok: [], instagram: [] };
  const pool = [];
  list.forEach((u, i) => {
    const platform = classifyVideoUrl(u).platform;
    (sequential[platform] ?? pool).push(i);
  });
  for (const indexes of Object.values(sequential)) if (indexes.length) lanes.push(runLane(indexes, 1));
  if (pool.length) lanes.push(runLane(pool, VERIFY_CONCURRENCY));
  function runLane(indexes, width) {
    let next = 0;
    const worker = async () => {
      while (next < indexes.length) {
        const i = indexes[next++];
        results[i] = await verifyOne(list[i], runOptions, run, assertHost, ctx);
      }
    };
    return Promise.all(Array.from({ length: Math.min(width, indexes.length) }, worker));
  }
  await Promise.all(lanes);
  const count = (s) => results.filter((r) => r.status === s).length;
  const counts = {
    given: list.length,
    ok: count('ok'),
    blocked: count('blocked'),
    not_found: count('not_found'),
    login_required: count('login_required'),
    timed_out: count('timed_out'),
    skipped: count('skipped'),
    other: results.filter((r) => !['ok', 'blocked', 'not_found', 'login_required', 'timed_out', 'skipped'].includes(r.status)).length,
  };
  const videoLinks = list.length - count('not_a_video_url') - count('invalid_url');
  const summary = `found ${videoLinks} public video links, ${counts.ok} downloaded, ${counts.blocked + counts.login_required + counts.not_found} blocked individually${counts.timed_out || counts.skipped ? `, ${counts.timed_out} timed out, ${counts.skipped} skipped` : ''}`;
  return {
    ok: counts.ok > 0,
    status: counts.ok ? 'ok' : 'none_verified',
    summary,
    counts,
    results,
    next: counts.ok
      ? ['Keep the ok results that are in the brand\'s niche and run pipeline_video_teardown on each until N are watched. Record this summary line and each other URL with its own status in research/competitors.md, leave the missing slots blank and continue.']
      : ['Record what was found with each URL\'s own status, leave the missing slots blank and continue.'],
  };
}

/**
 * @param {{urls?: string[], query?: string, platform?: 'youtube'|'tiktok'|'both', tiktokTags?: string[] (only read when platform is "tiktok"), limit?: number,
 *   maxDurationS?: number, binary?: string, run?: typeof runYtDlp, budgetMs?: number, breaker?: any}} options
 */
export async function searchReferences(options = {}) {
  // One budget for the whole call; every step below asks for min(its own limit, what is left).
  const deadline = createDeadline(options.budgetMs ?? SEARCH_BUDGET_MS);
  const gate = createGate(options.breaker ?? sharedBreaker);
  if (Array.isArray(options.urls) && options.urls.length) return verifyReferenceUrls(options.urls, { binary: options.binary, run: options.run, assertHost: options.assertHost, deadline, breaker: options.breaker, impersonation: options.impersonation });
  const query = String(options.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  // The library routes were retired; a caller still asking for one is told so instead of getting a different search.
  if (['tiktok_api', 'instagram'].includes(String(options.platform))) {
    return {
      ok: false,
      status: 'route_retired',
      message: 'The Instaloader and TikTok-Api routes were retired: signed out, none of five live reads worked. Use platform youtube, tiktok or both here; for Instagram use social_search with a #hashtag or topic, social_profile_get and social_outliers_find.',
      candidates: [],
      routes: [],
    };
  }
  const platform = ['youtube', 'tiktok', 'both'].includes(options.platform) ? options.platform : 'both';
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || SEARCH_DEFAULT_LIMIT), 1), SEARCH_MAX_LIMIT);
  const maxDurationS = num(options.maxDurationS) || SEARCH_MAX_DURATION_S;
  const tags = (Array.isArray(options.tiktokTags) ? options.tiktokTags : []).map(tagOf).filter(Boolean).slice(0, 3);
  if (!query && platform !== 'tiktok') return { ok: false, status: 'invalid_query', message: 'Give niche keywords to search for.', candidates: [], routes: [] };
  if (platform === 'tiktok' && !tags.length) return { ok: false, status: 'invalid_query', message: 'TikTok search needs tiktokTags (hashtags without #).', candidates: [], routes: [] };

  const baseRun = options.run ?? runYtDlp;
  // Every yt-dlp run is capped by what is left of the call's budget.
  const run = (args, opts) => baseRun(args, { ...opts, timeoutMs: deadline.slice(opts?.timeoutMs ?? SEARCH_TIMEOUT_MS) });
  const runOptions = { binary: referenceYtdlpBinary(options.binary), timeoutMs: SEARCH_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 };
  /** @type {Array<Record<string, any>>} */
  const routes = [];
  /** @type {ReturnType<typeof toCandidate>[]} */
  let found = [];

  if (platform === 'youtube' || platform === 'both') {
    const route = 'youtube_shorts_search';
    const walled = gate.check('youtube', 'search');
    if (walled) {
      routes.push({ route, ...walled, count: 0 });
    } else if (deadline.expired()) {
      routes.push({ route, status: 'skipped', detail: 'Skipped: the 90 second budget for this search was used.', count: 0 });
    } else {
      // Ask for more than limit: long videos are dropped after the search.
      const k = Math.min(limit * 3, 40);
      const result = await run([...BASE, '--flat-playlist', '--dump-json', `ytsearch${k}:${query} shorts`], runOptions);
      const entries = jsonLines(result.stdout);
      if (entries.length) {
        routes.push({ route, status: 'ok', count: entries.length });
        found.push(...entries.map((e) => toCandidate(e, 'youtube', route)).filter(Boolean));
        gate.ok('youtube', 'search');
      } else {
        const mapped = mapYtDlpError(result, 'youtube');
        const status = result.timedOut ? 'timed_out' : mapped.code;
        routes.push({ route, status, detail: mapped.reason, count: 0 });
        gate.fail('youtube', status, mapped.reason, 'search');
      }
    }
  }

  if (platform === 'both' && tags.length) {
    routes.push({ route: 'tiktok_hashtag_impersonate', status: 'skipped', detail: TAG_ROUTE_NOTE, count: 0 });
  }

  if (platform === 'tiktok') {
    const route = 'tiktok_hashtag_impersonate';
    const walled = tags.length ? gate.check('tiktok', TAG_SCOPE) : null;
    if (!tags.length) {
      routes.push({ route, status: 'skipped', detail: 'No tiktokTags given.', count: 0 });
    } else if (walled) {
      routes.push({ route, ...walled, count: 0 });
    } else {
      let got = 0;
      let failure = null;
      for (const tag of tags) {
        if (deadline.expired()) {
          failure ??= { status: 'skipped', detail: 'Skipped: the 90 second budget for this search was used.' };
          break;
        }
        const result = await run([...BASE, '--impersonate', 'chrome', '--flat-playlist', '--dump-json', '--playlist-end', String(limit * 2), `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`], runOptions);
        const entries = jsonLines(result.stdout);
        if (entries.length) {
          got += entries.length;
          found.push(...entries.map((e) => toCandidate(e, 'tiktok', route)).filter(Boolean));
          gate.ok('tiktok', TAG_SCOPE);
        } else if (/impersonat/i.test(`${result.stderr}`) && /not available|no impersonate|missing dependencies|unsupported|unknown/i.test(result.stderr)) {
          failure = { status: 'impersonation_unavailable', detail: IMPERSONATION_NOTE };
          gate.fail('tiktok', 'impersonation_unavailable', IMPERSONATION_NOTE, TAG_SCOPE);
          break;
        } else {
          const mapped = mapYtDlpError(result, 'tiktok');
          const status = result.timedOut ? 'timed_out' : mapped.code;
          failure = { status, detail: mapped.reason };
          gate.fail('tiktok', status, mapped.reason, TAG_SCOPE);
          // A bot check on one tag says the same about the next: stop here.
          if (WALL_CODES.has(status)) break;
        }
      }
      routes.push(got ? { route, status: 'ok', count: got } : { route, ...(failure ?? { status: 'empty' }), count: 0 });
    }
  }

  return finish({ query, maxDurationS, limit, routes, found, runOptions, run, deadline });
}

/** Rank, filter and describe. */
async function finish({ query, maxDurationS, limit, routes = [], found = [], runOptions = null, run = null, deadline }) {
  const seen = new Set();
  found = found.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
  // Only yt-dlp routes are opened to fill gaps in a listing, and only while there is budget left.
  if (runOptions && !deadline.expired()) await enrich(found, runOptions, run);

  const candidates = found
    .filter((c) => c.durationS !== null && c.durationS <= maxDurationS)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
    .slice(0, limit)
    .map((c, i) => ({ rank: i + 1, ...c, viewsKnown: c.views !== null }));
  const dropped = found.length - candidates.length;

  const anyOk = routes.some((r) => r.status === 'ok');
  return {
    ok: candidates.length > 0,
    status: candidates.length ? 'ok' : anyOk ? 'no_short_results' : 'no_route_worked',
    query,
    maxDurationS,
    candidates,
    droppedOverLengthOrUnknown: Math.max(dropped, 0),
    routes,
    next: candidates.length
      ? ['Keep only candidates in the brand\'s niche (check title and channel), then run pipeline_video_teardown on the best ones until N are watched. Views are as displayed by the platform at search time. Record the route statuses, leave the missing slots blank and continue.']
      : ['Record what was found, leave the missing slots blank and continue.'],
  };
}
