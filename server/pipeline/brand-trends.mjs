/**
 * Trends for the brand library: what is rising now in the brand's industry, found by the Trend Scout, kept so the next job reuses it
 * for a week instead of searching again.
 *
 *   workspaces/<brand>/library/trends.jsonl
 *     {id, kind, text, platform, industry, evidence:[{url, views, date, thumbnail?}], why, seenAt}
 *
 * `kind` is topic, format, sound or hashtag (what is rising on a platform), or hook or caption (the opening line and the primary text of
 * an ad that keeps running). `platform` is tiktok, instagram, facebook, youtube and so on. `industry` is the industry the trend was
 * found for (null when none is known). `evidence` is the posts, ads or pages that show it, newest first: each has an https `url`, and
 * `views` and `date` when the source displayed them (null otherwise). An ad's evidence also carries, when known, `startedAt` (the day
 * it started, YYYY-MM-DD), `runningDays` (how many days it had run when it was seen), `variants` (how many ads use the same text),
 * `advertiser` and `source` (meta_ad_library, tiktok_top_ads or organic). The ad libraries show no views or spend, so days running and
 * variants stand in for them: 30 days or more is a likely winner. An entry may also carry `thumbnail`, the https address of the picture of
 * the post or ad as the social read returned it (thumbnail_url, or an ad's cover), so the board can draw it; an address that fails
 * thumbnailOf (brand-library.mjs) is dropped without a word, and the key is left off an entry that has none. `why` is one line on why
 * it fits the brand, or null. `seenAt` is when the Trend Scout last saw it, as an ISO time.
 *
 * The file is only ever appended to. A trend is one kind on one platform with one normalised text (case, punctuation and spacing are
 * ignored, so "#GRWM" and "grwm" are the same hashtag). Seeing it again appends the same record with a new `seenAt`, the new evidence
 * added in front of the old and a new industry or reason when the sighting brings one; a read keeps one record per trend, with the
 * latest sighting on top. Two jobs saving at once never overwrite each other.
 *
 * Fresh means seen under 7 days ago (the same age the research index uses for trend research). A trend older than that is still on
 * file but is not offered: the Trend Scout looks again.
 *
 * Where it is used:
 *   - brand_trends_save (the Trend Scout) -> saveTrends.
 *   - brand_library_get returns the fresh trends; boardLibrary adds `trends` (and `counts.trends`) when there are any; libraryBlock
 *     lists the freshest few in every agent's brief. All three leave the key out when the brand has no fresh trend.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { appendLines, readLines } from '../lib/jsonl.mjs';
import * as runtime from './runtime.mjs';
// brand-library.mjs imports this file too: every use below is inside a function, never at load time.
import { brandLibraryDir, readBank, thumbnailOf } from './brand-library.mjs';

export const TREND_KINDS = Object.freeze(['topic', 'format', 'sound', 'hashtag', 'hook', 'caption']);
/** The kinds that come from ads that keep running: the opening line (hook) and the primary text (caption). */
export const AD_KINDS = Object.freeze(['hook', 'caption']);
/** Where the evidence of a trend was seen. */
export const EVIDENCE_SOURCES = Object.freeze(['meta_ad_library', 'tiktok_top_ads', 'organic']);
export const TRENDS_FILE = 'trends.jsonl';
/** A trend seen more than this many days ago is refreshed instead of reused. Matches RESEARCH_MAX_AGE_DAYS.trend in brand-library.mjs. */
export const TREND_MAX_AGE_DAYS = 7;
export const MAX_TRENDS_PER_SAVE = 40;
export const MAX_EVIDENCE = 6;
/** The board shows up to BOARD_TREND_LIMIT fresh trends (at most BOARD_AD_LIMIT of them ad hooks and captions, longest running first). */
export const BOARD_TREND_LIMIT = 12;
export const BOARD_AD_LIMIT = 4;
/** An agent's brief lists up to BLOCK_TREND_LIMIT fresh trends and, after them, up to BLOCK_AD_LIMIT ad hooks and captions. */
export const BLOCK_TREND_LIMIT = 5;
export const BLOCK_AD_LIMIT = 3;
/** An ad running this many days is a likely winner: the ad libraries show no views or spend, so this is the proxy. */
export const WINNER_RUNNING_DAYS = 30;
export const MAX_RUNNING_DAYS = 3650;
export const MAX_VARIANTS = 999;

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT_LIMIT = 300;
/** A caption is an ad's whole primary text, so it may be longer than the other kinds. */
const CAPTION_LIMIT = 600;
const ADVERTISER_LIMIT = 80;
const textLimitOf = kind => (kind === 'caption' ? CAPTION_LIMIT : TEXT_LIMIT);
const WHY_LIMIT = 400;
const INDUSTRY_LIMIT = 80;
const BOARD_TEXT_LIMIT = 200;
const PLATFORM_ALIASES = Object.freeze({ fb: 'facebook', meta: 'facebook', ig: 'instagram', insta: 'instagram', tik_tok: 'tiktok', yt: 'youtube', shorts: 'youtube', youtube_shorts: 'youtube', twitter: 'x' });

// ---------------------------------------------------------------- small helpers
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}\u2026` : text;
};
const isoOf = now => {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
const stampOf = value => {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? at : null;
};
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The words of a trend with case, punctuation and spacing ignored. Falls back to the plain lowercase text for text with no letter or number. */
const squash = text => {
  const words = String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return words || String(text ?? '').trim().toLowerCase();
};

/** What makes two sightings the same trend: kind, platform and the normalised words. */
export function trendKey({ kind, platform, text } = {}) {
  return `${kind}|${platform}|${squash(text)}`;
}

/** The trends file of a brand. The slug is checked; the file need not exist. */
export function trendsFile(root, brand) {
  return join(brandLibraryDir(root, brand), TRENDS_FILE);
}

function cleanPlatform(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const slug = PLATFORM_ALIASES[text] || text;
  if (!/^[a-z][a-z0-9_]{1,24}$/.test(slug)) throw new InvalidInputError('Say which platform the trend is on, for example tiktok, instagram or facebook.');
  return slug;
}

/** A date as YYYY-MM-DD, or null when the source gave none or it is not a date. */
function dayOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text) && Number.isFinite(Date.parse(text.slice(0, 10)))) return text.slice(0, 10);
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  const date = new Date(at);
  // A date with no time zone ("Aug 11, 2026") is the writer's own day, so read it back in the same zone; one with a zone is read in UTC.
  if (!/(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})\s*$/i.test(text)) return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return date.toISOString().slice(0, 10);
}

const wholeNumber = (value, max) => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return null;
  return Math.min(max, Math.max(0, Math.round(Number(value))));
};

/** The ad fields of an evidence entry, in this order. They are left off an entry that has none, so a post's evidence keeps {url, views, date}. */
const AD_EVIDENCE_FIELDS = Object.freeze(['startedAt', 'runningDays', 'variants', 'advertiser', 'source']);
/** Every optional field of an evidence entry, merged the same way: the ad fields, then the thumbnail. */
const OPTIONAL_EVIDENCE_FIELDS = Object.freeze([...AD_EVIDENCE_FIELDS, 'thumbnail']);

/**
 * One evidence entry, or null when it has no https link. `strict` (a save) refuses a source that is not one of EVIDENCE_SOURCES; a read
 * just leaves it off. An ad field the source did not give is left off, never 0.
 */
function cleanEvidenceItem(value, { strict = false } = {}) {
  const input = plain(value) ? value : {};
  const url = runtime.webLink(input.url);
  if (!url) return null;
  const out = { url, views: wholeNumber(input.views, Number.MAX_SAFE_INTEGER), date: dayOf(input.date ?? input.posted_at) };
  const startedAt = dayOf(input.startedAt);
  if (startedAt) out.startedAt = startedAt;
  const runningDays = wholeNumber(input.runningDays, MAX_RUNNING_DAYS);
  if (runningDays !== null) out.runningDays = runningDays;
  const variants = wholeNumber(input.variants, MAX_VARIANTS);
  if (variants !== null && variants >= 1) out.variants = variants;
  if (typeof input.advertiser === 'string' && input.advertiser.trim()) out.advertiser = clip(input.advertiser, ADVERTISER_LIMIT);
  if (input.source !== undefined && input.source !== null && input.source !== '') {
    if (EVIDENCE_SOURCES.includes(input.source)) out.source = input.source;
    else if (strict) throw new InvalidInputError(`evidence source has to be one of ${EVIDENCE_SOURCES.join(', ')}.`);
  }
  // A thumbnail that does not pass the check is dropped, never an error (even in a save): a missing picture must not fail the trend.
  const thumbnail = thumbnailOf(input.thumbnail);
  if (thumbnail) out.thumbnail = thumbnail;
  return out;
}

/** Evidence from a saved line: bad entries are dropped, the rest keep their order. */
const evidenceOfLine = list => (Array.isArray(list) ? list : []).map(item => cleanEvidenceItem(item)).filter(Boolean);

/**
 * The newer evidence first, then the older, one entry per link (a number, date, ad field or thumbnail one has and the other lacks is
 * filled in, the newer reading winning), at most MAX_EVIDENCE.
 */
function mergeEvidence(newer, older) {
  const byUrl = new Map();
  for (const item of [...newer, ...older]) {
    const seen = byUrl.get(item.url);
    if (!seen) { byUrl.set(item.url, { ...item }); continue; }
    const merged = { url: item.url, views: seen.views ?? item.views, date: seen.date ?? item.date };
    for (const field of OPTIONAL_EVIDENCE_FIELDS) {
      const found = seen[field] ?? item[field];
      if (found !== undefined) merged[field] = found;
    }
    byUrl.set(item.url, merged);
  }
  return [...byUrl.values()].slice(0, MAX_EVIDENCE);
}

// ---------------------------------------------------------------- the file
/** One saved line as a record, or null when it is not a trend (an unknown kind, no words, no platform or no time). */
function recordOfLine(line) {
  if (!TREND_KINDS.includes(line.kind)) return null;
  const text = typeof line.text === 'string' ? clip(line.text, textLimitOf(line.kind)) : '';
  const platform = typeof line.platform === 'string' ? line.platform.trim().toLowerCase() : '';
  const seen = stampOf(line.seenAt);
  if (!text || !platform || seen === null || typeof line.id !== 'string' || !line.id) return null;
  return {
    id: line.id, kind: line.kind, text, platform,
    industry: typeof line.industry === 'string' && line.industry.trim() ? clip(line.industry, INDUSTRY_LIMIT) : null,
    evidence: evidenceOfLine(line.evidence),
    why: typeof line.why === 'string' && line.why.trim() ? clip(line.why, WHY_LIMIT) : null,
    seenAt: new Date(seen).toISOString(),
  };
}

/** The lines of the file as one record per trend, keyed by trendKey: the latest sighting on top, the first line's id, the evidence of every sighting. */
function foldTrends(lines) {
  const byKey = new Map();
  for (const line of lines) {
    const record = recordOfLine(line);
    if (!record) continue;
    const key = trendKey(record);
    const prior = byKey.get(key);
    if (!prior) { byKey.set(key, record); continue; }
    const [older, newer] = Date.parse(prior.seenAt) <= Date.parse(record.seenAt) ? [prior, record] : [record, prior];
    byKey.set(key, {
      ...newer, id: prior.id, industry: newer.industry ?? older.industry, why: newer.why ?? older.why, evidence: mergeEvidence(newer.evidence, older.evidence),
    });
  }
  return byKey;
}

const withAge = (record, when) => {
  const age = Math.max(0, when - Date.parse(record.seenAt));
  return { ...record, ageDays: Math.floor(age / DAY_MS), fresh: age < TREND_MAX_AGE_DAYS * DAY_MS };
};

/**
 * The brand's trends, the latest sighting first, each with ageDays and fresh (seen under 7 days ago). With freshOnly the old ones are
 * left out. A brand with no trends file has none.
 */
export function readTrends({ root, brand, now, freshOnly = false, limit = null } = {}) {
  const when = Date.parse(isoOf(now));
  let list = [...foldTrends(readLines(trendsFile(root, brand))).values()]
    .map(record => withAge(record, when))
    .sort((a, b) => b.seenAt.localeCompare(a.seenAt) || a.text.localeCompare(b.text));
  if (freshOnly) list = list.filter(record => record.fresh);
  return Number.isInteger(limit) && limit > 0 ? list.slice(0, limit) : list;
}

/** The trends seen under 7 days ago, freshest first. */
export const freshTrends = options => readTrends({ ...options, freshOnly: true });

// ---------------------------------------------------------------- saving
function cleanItem(item, fallbackIndustry) {
  if (!plain(item)) throw new InvalidInputError('is not a trend. Pass {kind, text, platform, evidence}.');
  if (!TREND_KINDS.includes(item.kind)) throw new InvalidInputError(`needs a kind: ${TREND_KINDS.join(', ')}.`);
  const text = clip(item.text, textLimitOf(item.kind));
  if (!text) throw new InvalidInputError('needs the words of the trend in text.');
  const platform = cleanPlatform(item.platform);
  const evidence = (Array.isArray(item.evidence) ? item.evidence : []).map(entry => cleanEvidenceItem(entry, { strict: true })).filter(Boolean);
  if (!evidence.length) throw new InvalidInputError('needs evidence: the https link of a post, ad or page that shows it, with its views and date when it displays them.');
  const industry = typeof item.industry === 'string' && item.industry.trim() ? clip(item.industry, INDUSTRY_LIMIT) : fallbackIndustry;
  const why = typeof item.why === 'string' && item.why.trim() ? clip(item.why, WHY_LIMIT) : null;
  return { kind: item.kind, text, platform, industry, evidence: mergeEvidence(evidence, []), why };
}

/** The industry to use for a trend the Trend Scout did not label: the person's industry pick in the library, else the brand profile's. */
function defaultIndustry(root, brand) {
  try {
    const pick = readBank({ root, brand, bank: 'yours', kind: 'industry', limit: 1, ranked: false })[0];
    if (pick?.text) return clip(pick.text, INDUSTRY_LIMIT);
  } catch { /* no bank yet */ }
  return null;
}

/**
 * Save the trends the Trend Scout found. Every item is checked first and nothing is saved when one is wrong (the error names it).
 * A trend already on file (same kind, platform and normalised words) is updated: seenAt is now, the new evidence goes in front of the
 * old, and a new industry or reason replaces the old. Returns { saved: [{ id, kind, text, platform, industry, seenAt, status }], created, updated }
 * where status is 'new' or 'updated'. The same trend twice in one call is saved once.
 */
export function saveTrends({ root, brand, items, now } = {}) {
  const library = brandLibraryDir(root, brand);
  if (!existsSync(join(library, '..', 'workspace.json'))) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  if (!Array.isArray(items) || !items.length) throw new InvalidInputError('Pass at least one trend in items.', { fix: 'Each item is {kind, text, platform, evidence: [{url, views, date}]}.' });
  if (items.length > MAX_TRENDS_PER_SAVE) throw new InvalidInputError(`Save at most ${MAX_TRENDS_PER_SAVE} trends in one call.`, { fix: 'Keep the strongest ones, or call again with the rest.' });
  const fallback = defaultIndustry(root, brand);
  const problems = [];
  const clean = [];
  items.forEach((item, index) => {
    try { clean.push(cleanItem(item, fallback)); } catch (error) { problems.push(`Trend ${index + 1} ${String(error?.message || error)}`); }
  });
  if (problems.length) throw new InvalidInputError(problems.join(' '), { fix: 'Fix those trends and call brand_trends_save again. Nothing was saved.' });

  const seenAt = isoOf(now);
  const file = join(library, TRENDS_FILE);
  const known = foldTrends(readLines(file));
  const touched = new Map();
  for (const item of clean) {
    const key = trendKey(item);
    const current = touched.get(key)?.record ?? known.get(key) ?? null;
    const record = {
      id: current?.id ?? `t-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      kind: item.kind, text: current?.text ?? item.text, platform: item.platform,
      industry: item.industry ?? current?.industry ?? null,
      evidence: mergeEvidence(item.evidence, current?.evidence ?? []),
      why: item.why ?? current?.why ?? null,
      seenAt,
    };
    touched.set(key, { record, status: known.has(key) ? 'updated' : 'new' });
  }
  appendLines(file, [...touched.values()].map(entry => entry.record));
  const saved = [...touched.values()].map(({ record, status }) => ({ id: record.id, kind: record.kind, text: record.text, platform: record.platform, industry: record.industry, seenAt: record.seenAt, status }));
  return { saved, created: saved.filter(item => item.status === 'new').length, updated: saved.filter(item => item.status === 'updated').length };
}

// ---------------------------------------------------------------- what the rest of the plugin reads
const isAd = record => AD_KINDS.includes(record.kind);
const runningOf = record => record.evidence.find(item => item.runningDays !== undefined)?.runningDays ?? null;
const variantsOf = record => record.evidence.find(item => item.variants !== undefined)?.variants ?? 0;
/** Ad hooks and captions, the longest running first, then the most variants, then the freshest. Days running stands in for views. */
const byRunning = (a, b) => (runningOf(b) ?? -1) - (runningOf(a) ?? -1) || variantsOf(b) - variantsOf(a) || b.seenAt.localeCompare(a.seenAt);

/** The trends an agent or the board is offered: up to `limit` in all, at most `adLimit` of them ads (longest running first), the rest freshest first. */
function offered(list, { limit, adLimit }) {
  const ads = list.filter(isAd).sort(byRunning).slice(0, adLimit);
  const rest = list.filter(record => !isAd(record)).slice(0, limit - ads.length);
  return { rest, ads };
}

/**
 * The board's Fresh trends: up to BOARD_TREND_LIMIT, freshest first, then at most BOARD_AD_LIMIT ad hooks and captions, longest
 * running first. Each is { id, kind, text, platform, industry, why, evidence (the first two), seenAt, ageDays }. Empty when the
 * brand has none, or when the file cannot be read.
 */
export function boardTrends({ root, brand, now } = {}) {
  try {
    const { rest, ads } = offered(freshTrends({ root, brand, now }), { limit: BOARD_TREND_LIMIT, adLimit: BOARD_AD_LIMIT });
    return [...rest, ...ads].map(record => ({
      id: record.id, kind: record.kind, text: clip(record.text, BOARD_TEXT_LIMIT), platform: record.platform, industry: record.industry,
      ...(record.why ? { why: clip(record.why, BOARD_TEXT_LIMIT) } : {}), evidence: record.evidence.slice(0, 2), seenAt: record.seenAt, ageDays: record.ageDays,
    }));
  } catch { return []; }
}

const agoWords = days => (days <= 0 ? 'seen today' : days === 1 ? 'seen 1 day ago' : `seen ${days} days ago`);
const SOURCE_WORDS = Object.freeze({ meta_ad_library: 'Meta Ad Library', tiktok_top_ads: 'TikTok Top Ads', organic: null });

/** "Meta Ad Library, Rival Co, running 63 days, 4 variants": what an ad's evidence says, for an agent's brief. */
function adWords(first) {
  if (!first) return [];
  return [
    SOURCE_WORDS[first.source] ?? null, first.advertiser ?? null,
    first.runningDays !== undefined ? `running ${first.runningDays} ${first.runningDays === 1 ? 'day' : 'days'}` : null,
    first.variants !== undefined ? `${first.variants} ${first.variants === 1 ? 'variant' : 'variants'}` : null,
  ].filter(Boolean);
}

/**
 * The lines of the fresh trends for an agent's brief: a heading, the freshest BLOCK_TREND_LIMIT, then up to BLOCK_AD_LIMIT hooks and
 * captions of ads that keep running (longest running first) with a note on why days running is the measure. Each has where, how long
 * ago and the post or ad that shows it. No lines when the brand has no fresh trend.
 */
export function trendLines({ root, brand, now } = {}) {
  let list = [];
  try { list = freshTrends({ root, brand, now }); } catch { return []; }
  if (!list.length) return [];
  const { rest, ads } = offered(list, { limit: BLOCK_TREND_LIMIT + BLOCK_AD_LIMIT, adLimit: BLOCK_AD_LIMIT });
  const lines = [`Fresh trends (the Trend Scout saw each under ${TREND_MAX_AGE_DAYS} days ago; Concept C can use them with the day they were seen, so do not search for them again):`];
  for (const record of [...rest.slice(0, BLOCK_TREND_LIMIT), ...ads]) {
    const first = record.evidence[0];
    const views = Number.isFinite(first?.views) ? `${first.views.toLocaleString('en-US')} views` : null;
    const detail = [record.industry, agoWords(record.ageDays), ...adWords(first), views, first?.url].filter(Boolean).join(', ');
    lines.push(`- ${record.platform} ${record.kind}: "${clip(record.text, 120)}" (${detail})`);
  }
  if (ads.length) lines.push("Hooks and captions come from ads that keep running. The ad libraries show no views or spend, so days running (30 or more is a likely winner) and variants stand in for them. Adapt a hook, never copy a competitor's words, and say the source and days running.");
  return lines;
}
