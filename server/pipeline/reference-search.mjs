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
 * It only lists candidates. The researcher still checks each one is in the niche, then downloads and takes it apart
 * with pipeline_video_teardown.
 */

import { runYtDlp, mapYtDlpError } from '../social/backends/ytdlp.mjs';
import { referenceYtdlpBinary } from './url-reference.mjs';

export const SEARCH_MAX_DURATION_S = 90;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;
const ENRICH_MAX = 6;
const SEARCH_TIMEOUT_MS = 90_000;
const ENRICH_TIMEOUT_MS = 30_000;
const BASE = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-update', '--no-progress', '--socket-timeout', '20'];

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

/**
 * @param {{query?: string, platform?: 'youtube'|'tiktok'|'both', tiktokTags?: string[], limit?: number,
 *   maxDurationS?: number, binary?: string, run?: typeof runYtDlp}} options
 */
export async function searchReferences(options = {}) {
  const query = String(options.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const platform = ['youtube', 'tiktok', 'both'].includes(options.platform) ? options.platform : 'both';
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || SEARCH_DEFAULT_LIMIT), 1), SEARCH_MAX_LIMIT);
  const maxDurationS = num(options.maxDurationS) || SEARCH_MAX_DURATION_S;
  const tags = (Array.isArray(options.tiktokTags) ? options.tiktokTags : []).map(tagOf).filter(Boolean).slice(0, 3);
  if (!query && platform !== 'tiktok') return { ok: false, status: 'invalid_query', message: 'Give niche keywords to search for.', candidates: [], routes: [] };
  if (platform === 'tiktok' && !tags.length) return { ok: false, status: 'invalid_query', message: 'TikTok search needs tiktokTags (hashtags without #).', candidates: [], routes: [] };

  const run = options.run ?? runYtDlp;
  const runOptions = { binary: referenceYtdlpBinary(options.binary), timeoutMs: SEARCH_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 };
  /** @type {Array<Record<string, any>>} */
  const routes = [];
  /** @type {ReturnType<typeof toCandidate>[]} */
  let found = [];

  if (platform === 'youtube' || platform === 'both') {
    const route = 'youtube_shorts_search';
    // Ask for more than limit: long videos are dropped after the search.
    const k = Math.min(limit * 3, 40);
    const result = await run([...BASE, '--flat-playlist', '--dump-json', `ytsearch${k}:${query} shorts`], runOptions);
    const entries = jsonLines(result.stdout);
    if (entries.length) {
      routes.push({ route, status: 'ok', count: entries.length });
      found.push(...entries.map((e) => toCandidate(e, 'youtube', route)).filter(Boolean));
    } else {
      const mapped = mapYtDlpError(result, 'youtube');
      routes.push({ route, status: mapped.code, detail: mapped.reason, count: 0 });
    }
  }

  if (platform === 'tiktok' || platform === 'both') {
    const route = 'tiktok_hashtag_impersonate';
    if (!tags.length) {
      routes.push({ route, status: 'skipped', detail: 'No tiktokTags given.', count: 0 });
    } else {
      let got = 0;
      let failure = null;
      for (const tag of tags) {
        const result = await run([...BASE, '--impersonate', 'chrome', '--flat-playlist', '--dump-json', '--playlist-end', String(limit * 2), `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`], runOptions);
        const entries = jsonLines(result.stdout);
        if (entries.length) {
          got += entries.length;
          found.push(...entries.map((e) => toCandidate(e, 'tiktok', route)).filter(Boolean));
        } else if (/impersonat/i.test(`${result.stderr}`) && /not available|no impersonate|missing dependencies|unsupported|unknown/i.test(result.stderr)) {
          failure = { status: 'impersonation_unavailable', detail: 'This yt-dlp has no browser impersonation (curl_cffi is not installed), so TikTok answers with a bot check.' };
          break;
        } else {
          const mapped = mapYtDlpError(result, 'tiktok');
          failure = { status: mapped.code, detail: mapped.reason };
        }
      }
      routes.push(got ? { route, status: 'ok', count: got } : { route, ...(failure ?? { status: 'empty' }), count: 0 });
    }
  }

  const seen = new Set();
  found = found.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
  await enrich(found, runOptions, run);

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
      ? ['Keep only candidates in the brand\'s niche (check title and channel), then run pipeline_video_teardown on the best ones until N are watched. Views are as displayed by the platform at search time.']
      : ['Record each route status in research/competitors.md. Try broader niche keywords or nearby markets, then ask the Director to ask the person for links only after that.'],
  };
}
