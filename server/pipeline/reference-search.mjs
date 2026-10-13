/**
 * pipeline_reference_search: find candidate reference videos on public routes that need no login.
 *
 * This is step 3 of the researcher's discovery ladder. It runs yt-dlp (the research helper venv's, as the teardown
 * does) with an argument array and no cookies:
 *   - YouTube Shorts: `ytsearch{K}:{query} shorts --flat-playlist --dump-json`, ranked by view count, keeping only
 *     videos of maxDurationS seconds or less. Flat listings sometimes leave views or length empty, so the top few
 *     such items are opened once with --dump-json before they are counted.
 *   - TikTok (best effort, never blocks): hashtag pages through `--impersonate chrome`, which needs curl_cffi. A bot
 *     check or missing impersonation is recorded as a route status and the search goes on.
 *
 *   - Optional library routes, asked for with platform `tiktok_api` (TikTok-Api: hashtag, trending, user) and `instagram`
 *     (Instaloader: hashtag top posts, profile Reels). They run in the research helper venv through social-discovery.mjs,
 *     work with no login, and pick up a local credentials file if one exists. Each is a route status
 *     (ok / empty / blocked / login_required / not_installed), never a throw.
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
import { runDiscovery } from './social-discovery.mjs';
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
/** One discovery route (a tag, a profile, trending). */
export const DISCOVERY_ROUTE_TIMEOUT_MS = 40_000;
/** Below this there is no point starting another step. */
const MIN_STEP_MS = 2_000;
const BASE = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-update', '--no-progress', '--retries', '1', '--fragment-retries', '1', '--extractor-retries', '0', '--socket-timeout', '10'];

/** Breaker key for each platform this tool can touch. */
const HOST_OF_PLATFORM = { youtube: 'youtube.com', tiktok: 'tiktok.com', tiktok_api: 'tiktok.com', instagram: 'instagram.com' };
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
 * platform is skipped for the call and, via the breaker, for other tools for a while.
 * @param {{isOpen: Function, recordFailure: Function, recordSuccess: Function}} breaker
 */
function createGate(breaker) {
  /** @type {Map<string, {status: string, detail: string}>} */
  const walls = new Map();
  return {
    /** null when the platform may be tried; otherwise the route status to report instead. */
    check(platform) {
      const hit = walls.get(platform);
      if (hit) return { status: 'skipped', detail: `Skipped: ${hit.detail}` };
      const host = HOST_OF_PLATFORM[platform];
      const state = host ? breaker.isOpen(host) : { open: false };
      if (state.open) {
        const detail = state.reason || `${host} refused recent reads (${state.code ?? 'blocked'}).`;
        walls.set(platform, { status: 'skipped', detail });
        return { status: 'skipped', detail: `Skipped: ${detail}` };
      }
      return null;
    },
    fail(platform, code, detail) {
      if (WALL_CODES.has(code)) walls.set(platform, { status: code, detail: `${platform} answered ${code} earlier in this call.` });
      const host = HOST_OF_PLATFORM[platform];
      if (host && BREAKER_CODES.has(code)) breaker.recordFailure(host, code, detail);
    },
    ok(platform) {
      const host = HOST_OF_PLATFORM[platform];
      if (host) breaker.recordSuccess(host);
    },
  };
}

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

const numStrict = (value) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };

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

/** Candidate from a discovery worker item. Dates are normalised to YYYYMMDD like yt-dlp's upload_date. */
function fromDiscovery(item, platform, route) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : numStrict(v));
  return {
    url: item.url,
    platform,
    title: item.caption ? String(item.caption).replace(/\s+/g, ' ').trim().slice(0, 140) : null,
    channel: item.owner ?? null,
    views: num(item.views),
    likes: num(item.likes),
    durationS: num(item.durationS),
    uploadDate: item.date ? String(item.date).replace(/-/g, '') : null,
    route,
  };
}

/** One discovery route per tag / profile / user, in order, stopping early once there is enough or the platform refuses. */
async function discoveryRoutes(kind, jobs, limit, discover, routes, found, deadline, gate) {
  const platform = kind === 'tiktok_api' ? 'tiktok' : 'instagram';
  const gateKey = kind;
  let stopped = null;
  for (const job of jobs) {
    const route = `${job.route}`;
    const label = job.target ? `${route}:${job.target}` : route;
    if (stopped) {
      routes.push({ route: label, status: 'skipped', detail: stopped, count: 0 });
      continue;
    }
    const walled = gate.check(gateKey);
    if (walled) {
      routes.push({ route: label, status: walled.status, detail: walled.detail, count: 0 });
      stopped = walled.detail;
      continue;
    }
    if (deadline.expired()) {
      routes.push({ route: label, status: 'skipped', detail: 'Skipped: the 90 second budget for this search was used.', count: 0 });
      stopped = 'Skipped: the 90 second budget for this search was used.';
      continue;
    }
    const result = await discover({ route: job.route, target: job.target, limit: Math.min(limit * 2, 40), timeoutMs: deadline.slice(DISCOVERY_ROUTE_TIMEOUT_MS) });
    const items = (result.items ?? []).map((i) => fromDiscovery(i, platform, route));
    found.push(...items);
    routes.push({ route: label, status: result.status, ...(result.detail ? { detail: result.detail } : {}), ...(result.authenticated ? { loggedIn: true } : {}), count: items.length });
    if (result.status === 'ok') gate.ok(gateKey);
    else gate.fail(gateKey, result.status, result.detail ?? '');
    // The library is not there at all: no point trying the next target on the same platform.
    if (result.status === 'not_installed') stopped = 'Skipped: the library is not installed.';
    else if (WALL_CODES.has(result.status) || result.status === 'timed_out') stopped = `Skipped: ${platform} answered ${result.status} on ${label}.`;
  }
}

function handleOf(value) {
  return String(value ?? '').trim().replace(/^@/, '').replace(/[^\p{L}\p{N}_.]/gu, '');
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
 * @param {{urls?: string[], query?: string, platform?: 'youtube'|'tiktok'|'both'|'tiktok_api'|'instagram', tiktokTags?: string[],
 *   instagramTags?: string[], instagramProfiles?: string[], tiktokUsers?: string[], tiktokTrending?: boolean, limit?: number,
 *   maxDurationS?: number, binary?: string, run?: typeof runYtDlp, discover?: typeof runDiscovery, budgetMs?: number, breaker?: any}} options
 */
export async function searchReferences(options = {}) {
  // One budget for the whole call; every step below asks for min(its own limit, what is left).
  const deadline = createDeadline(options.budgetMs ?? SEARCH_BUDGET_MS);
  const gate = createGate(options.breaker ?? sharedBreaker);
  if (Array.isArray(options.urls) && options.urls.length) return verifyReferenceUrls(options.urls, { binary: options.binary, run: options.run, assertHost: options.assertHost, deadline, breaker: options.breaker, impersonation: options.impersonation });
  const query = String(options.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const platform = ['youtube', 'tiktok', 'both', 'tiktok_api', 'instagram'].includes(options.platform) ? options.platform : 'both';
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || SEARCH_DEFAULT_LIMIT), 1), SEARCH_MAX_LIMIT);
  const maxDurationS = num(options.maxDurationS) || SEARCH_MAX_DURATION_S;
  const tags = (Array.isArray(options.tiktokTags) ? options.tiktokTags : []).map(tagOf).filter(Boolean).slice(0, 3);
  const igTags = (Array.isArray(options.instagramTags) ? options.instagramTags : []).map(tagOf).filter(Boolean).slice(0, 3);
  const igProfiles = (Array.isArray(options.instagramProfiles) ? options.instagramProfiles : []).map(handleOf).filter(Boolean).slice(0, 3);
  const ttUsers = (Array.isArray(options.tiktokUsers) ? options.tiktokUsers : []).map(handleOf).filter(Boolean).slice(0, 3);
  // With only keywords, the library routes try one hashtag made from them (youth football -> youthfootball).
  const queryTag = tagOf(query.toLowerCase().split(' ').slice(0, 3).join(''));
  if (platform === 'tiktok_api' || platform === 'instagram') {
    const api = platform === 'tiktok_api';
    const trending = api && options.tiktokTrending === true;
    const jobs = api
      ? [...(tags.length ? tags : queryTag ? [queryTag] : []).map((t) => ({ route: 'tiktok_hashtag', target: t })), ...ttUsers.map((u) => ({ route: 'tiktok_user', target: u })), ...(trending ? [{ route: 'tiktok_trending', target: '' }] : [])]
      : [...(igTags.length ? igTags : queryTag ? [queryTag] : []).map((t) => ({ route: 'instagram_hashtag', target: t })), ...igProfiles.map((u) => ({ route: 'instagram_profile', target: u }))];
    if (!jobs.length) return { ok: false, status: 'invalid_query', message: api ? 'TikTok-Api needs tiktokTags, tiktokUsers, tiktokTrending or query keywords.' : 'Instagram needs instagramTags, instagramProfiles or query keywords.', candidates: [], routes: [] };
    return finish({ query, maxDurationS, limit, jobs, kind: platform, discover: options.discover ?? runDiscovery, deadline, gate });
  }
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
    const walled = gate.check('youtube');
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
        gate.ok('youtube');
      } else {
        const mapped = mapYtDlpError(result, 'youtube');
        const status = result.timedOut ? 'timed_out' : mapped.code;
        routes.push({ route, status, detail: mapped.reason, count: 0 });
        gate.fail('youtube', status, mapped.reason);
      }
    }
  }

  if (platform === 'tiktok' || platform === 'both') {
    const route = 'tiktok_hashtag_impersonate';
    const walled = tags.length ? gate.check('tiktok') : null;
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
          gate.ok('tiktok');
        } else if (/impersonat/i.test(`${result.stderr}`) && /not available|no impersonate|missing dependencies|unsupported|unknown/i.test(result.stderr)) {
          failure = { status: 'impersonation_unavailable', detail: IMPERSONATION_NOTE };
          gate.fail('tiktok', 'impersonation_unavailable', IMPERSONATION_NOTE);
          break;
        } else {
          const mapped = mapYtDlpError(result, 'tiktok');
          const status = result.timedOut ? 'timed_out' : mapped.code;
          failure = { status, detail: mapped.reason };
          gate.fail('tiktok', status, mapped.reason);
          // A bot check on one tag says the same about the next: stop here.
          if (WALL_CODES.has(status)) break;
        }
      }
      routes.push(got ? { route, status: 'ok', count: got } : { route, ...(failure ?? { status: 'empty' }), count: 0 });
    }
  }

  return finish({ query, maxDurationS, limit, routes, found, runOptions, run, deadline });
}

/** Rank, filter and describe. `jobs` means library routes still have to run first. */
async function finish({ query, maxDurationS, limit, jobs, kind, discover, routes = [], found = [], runOptions = null, run = null, deadline, gate }) {
  if (jobs) await discoveryRoutes(kind, jobs, limit, discover, routes, found, deadline, gate);
  const seen = new Set();
  found = found.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
  // Library routes return their own numbers (runOptions is null for them); only yt-dlp routes are opened to fill gaps,
  // and only while there is budget left.
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
