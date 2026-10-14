/**
 * Results ranking for the brand library: what a posted video earned, tied to the lines and choices the filed job used, so winners
 * rank first in the bank and feed Concept A.
 *
 *   workspaces/<brand>/library/results.jsonl
 *     {jobId, platform, paid, postUrl?, adId?, variant?, hook?, postedAt?, at, metrics:{...}, source}
 *
 * The file is only ever appended to. A reading is one post (organic, keyed by its link) or one ad (paid, keyed by its ad id) on one
 * platform, read at `at`. The last line for the same (jobId, platform, paid, postUrl or adId, day) wins, so reading the same post
 * twice in a day keeps the later numbers and saving the same numbers twice changes nothing. Scoring uses the latest reading of each post.
 *
 * Where results come in:
 *   - brand_results_save (agents, after reading Metricool or an ad account) -> recordResults.
 *   - pipeline_ad_results_save calls recordAdResults for the ads it matched to a draft of the job.
 *   - pipeline/scripts/import-metrics.js (Metricool rows and Ads Manager CSV files) calls recordObservations.
 *   Each of these also files the job in the library when it is not filed yet, and then promotes any new winner (below).
 *
 * metrics (a number the source did not give is left out, never 0): views, reach, impressions, likes, comments, shares, saves, clicks,
 * watchPct (average share of the video watched, 0 to 100), avgWatchSec, watchTimeSec (total), durationSec; paid: spend, results,
 * linkClicks, thruplays, ctr (a fraction), cpa, roas, cpc, cpm, currency, resultType. ctr and cpa are worked out here when
 * clicks and impressions, or spend and results, are there.
 *
 * THE SCORE (everything relative to the brand's own median on the same platform; 1.0 is "this brand's usual"):
 *   A post (organic) is compared with the median of the brand's other grown-up posts on that platform:
 *     views ratio          = views / median views                                  weight 0.5
 *     watch-through ratio  = average watch % / median (else average seconds)       weight 0.3
 *     saves and shares     = (saves + shares) per 1000 views / median               weight 0.2
 *   An ad (paid) against the brand's median ads on that platform:
 *     click rate ratio     = ctr / median ctr                                       weight 0.4
 *     cost ratio           = roas / median roas, else median cost per result / cost per result (cheaper is better)   weight 0.6
 *   Each ratio is capped at 4, a missing one is left out, and the score is the weighted average of the ones there are.
 *   Instagram shows a signed-out reader likes but no views. A post read with likes and no views is scored on its likes in the views
 *   slot (weight 0.5), against the median likes of the brand's other likes-only posts on that platform, never against views. Views and
 *   likes are different measures, so everything that ranks says which one a row uses (measure: views, likes or mixed), ranks within
 *   each measure (the likes-only rows come after the others at the same standing) and prints "N likes" where it prints "N views".
 *   A job's score is the average of its posts' scores (grown-up ones when it has any). An item's score (an opening line, a style, a
 *   call to action, a format, an angle) is the average of the scores of the jobs that used it, and `uses` is how many jobs that is.
 * The dimensions: a filed job is grouped by what it used, and each group is scored and labelled the same way: the concept's source, ad style, call to
 * action, angle, voice and music, and the brand intelligence axes (pipeline/library/formats.json): format, editing style (editing), visual hook
 * (visualHook) and subtopic. A job filed with an older Visual format container id (F-TALKING-HEAD) counts toward the editing style and visual hook
 * that id stands for (legacyFormats in the library).
 * "Early": a post under 48 hours old, with fewer than 100 views (an ad: under 1000 impressions; a likes-only post: under 10 likes), or on a platform where the brand has
 * fewer than 3 grown-up posts to compare with. An early post is scored when there is a baseline, but it never counts toward one, and an
 * item that rests only on early posts is labelled early.
 * Labels (needs 3 grown-up jobs, so a "top quartile" means something): winner = top quartile of the brand's job scores and at least
 * 1.25; weak = bottom quartile and at most 0.7; average = the rest.
 *
 * A job that becomes a winner has its opening line promoted to bank/proven (source 'brand', evidence {url, views, date}, or
 * {url, likes, date} when its best post has likes and no views, promotedFrom: jobId), once: a line already in the bank, or one the
 * person removed, is left alone.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { appendLines, readLines } from '../lib/jsonl.mjs';
import * as facts from './facts.mjs';
import * as runtime from './runtime.mjs';
import { mapLegacyFormat } from './format-library.mjs';
// brand-intelligence.mjs imports this file too: its use below is inside a function, never at load time.
import { refreshFormatsRankQuietly } from './brand-intelligence.mjs';
// brand-library.mjs imports this file too: every use below is inside a function, never at load time.
import { addToBank, brandLibraryDir, fileJobQuietly, readBank, readFiledJobs, sameText } from './brand-library.mjs';

export const RESULTS_FILE = 'results.jsonl';
export const RESULT_SOURCES = Object.freeze(['metricool', 'manual', 'ad_results', 'csv_export', 'connector', 'other']);
/** Grown-up posts a platform needs before anything on it is scored, and the grown-up jobs the labels need. */
export const MIN_BASELINE_POSTS = 3;
export const MIN_LABEL_JOBS = 3;
export const EARLY_HOURS = 48;
export const EARLY_VIEWS = 100;
export const EARLY_LIKES = 10;
export const EARLY_IMPRESSIONS = 1000;
export const SCORE_CAP = 4;
export const WINNER_MIN = 1.25;
export const WEAK_MAX = 0.7;
export const SCORE_WEIGHTS = Object.freeze({ views: 0.5, watch: 0.3, saveShare: 0.2, ctr: 0.4, cost: 0.6 });
/** The one-paragraph version of the formula, for the tool replies. */
export const SCORE_WORDS = '1.0 is this brand\'s usual on that platform. A post is views (50%), watch-through (30%) and saves plus shares per view (20%), each divided by the brand\'s median; an ad is click rate (40%) and cost per result or return on ad spend (60%). Under 48 hours, under 100 views (ads: 1000 impressions) or fewer than 3 posts to compare with is early. A winner is in the top quarter of the brand\'s jobs and at least 1.25; weak is the bottom quarter and at most 0.7. A post with likes and no views (Instagram shows signed-out readers no views) is scored on its likes against the brand\'s other likes-only posts, and every row says its measure (views, likes or mixed); rows are ranked within a measure, never views against likes.';

const HOUR_MS = 60 * 60 * 1000;
const TEXT_LIMIT = 600;
const PROVIDER_PLATFORM = Object.freeze({ meta_ads: 'facebook', tiktok_ads: 'tiktok' });
const PLATFORM_ALIASES = Object.freeze({ fb: 'facebook', meta: 'facebook', meta_ads: 'facebook', tiktok_ads: 'tiktok', ig: 'instagram', insta: 'instagram', tik_tok: 'tiktok', yt: 'youtube', shorts: 'youtube', youtube_shorts: 'youtube', twitter: 'x' });
const COUNT_FIELDS = Object.freeze(['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'clicks', 'linkClicks', 'thruplays', 'results']);
const FIELD_ALIASES = Object.freeze({
  views: ['views', 'videoviews', 'plays', 'videoplays'],
  reach: ['reach'],
  impressions: ['impressions'],
  likes: ['likes', 'reactions'],
  comments: ['comments'],
  shares: ['shares', 'reposts'],
  saves: ['saves', 'saved', 'bookmarks'],
  clicks: ['clicks'],
  linkClicks: ['linkclicks'],
  thruplays: ['thruplays'],
  results: ['results', 'conversions', 'purchases', 'leads'],
  watchPct: ['watchpct', 'avgwatchpct', 'avgwatchpercent', 'avgwatchpercentage', 'averagewatchpct', 'averagewatchpercent', 'averagewatchpercentage', 'watchpercent', 'avgviewpercentage', 'averageviewpercentage'],
  avgWatchSec: ['avgwatchsec', 'avgwatchseconds', 'avgwatchtime', 'averagewatchsec', 'averagewatchseconds', 'averagewatchtime', 'avgviewduration', 'averageviewduration'],
  watchTimeSec: ['watchtimesec', 'watchtimeseconds', 'totalwatchsec', 'totalwatchtime', 'totalwatchtimesec', 'watchtime'],
  durationSec: ['durationsec', 'durationseconds', 'videolengthsec', 'videoduration', 'duration'],
  spend: ['spend', 'cost', 'amountspent'],
  cpa: ['cpa', 'costperresult', 'costperconversion'],
  cpc: ['cpc', 'costperclick'],
  cpm: ['cpm'],
  ctr: ['ctr', 'clickrate', 'clickthroughrate'],
  roas: ['roas', 'returnonadspend'],
  currency: ['currency'],
  resultType: ['resulttype'],
});
const FIELD_OF = new Map(Object.entries(FIELD_ALIASES).flatMap(([field, names]) => names.map(name => [name, field])));
const FIELD_WORDS = Object.freeze({ watchPct: 'average watch percent', avgWatchSec: 'average watch time', watchTimeSec: 'watch time', durationSec: 'video length', linkClicks: 'link clicks', resultType: 'result type' });

// ---------------------------------------------------------------- small helpers
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNum = value => typeof value === 'number' && Number.isFinite(value);
const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => (values.length ? sum(values) / values.length : null);
const round = (value, places) => { const factor = 10 ** places; return Math.round(value * factor) / factor; };
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const isoOf = value => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** The value at a share of the way up a sorted list, by nearest rank (0.75 is the top quarter's edge). */
function nearestRank(values, share) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

const resultsFile = (root, brand) => join(brandLibraryDir(root, brand), RESULTS_FILE);
const brandFolder = (root, brand) => join(brandLibraryDir(root, brand), '..');
function requireBrand(root, brand) {
  if (!existsSync(join(brandFolder(root, brand), 'workspace.json'))) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
}

// ---------------------------------------------------------------- reading the numbers in
function parseNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  let number = value;
  let percent = false;
  if (typeof number === 'string') {
    const text = number.trim().replace(/,/g, '');
    percent = text.endsWith('%');
    number = text === '' ? null : Number(text.replace(/%$/, ''));
    if (number === null) return null;
  }
  if (!isNum(number)) throw new InvalidInputError(`The ${label} is not a number. Leave it out when you do not have it; never put 0 for unknown.`);
  if (number < 0) throw new InvalidInputError(`The ${label} cannot be below zero.`);
  return { number, percent };
}

/**
 * The numbers a source gave, as the fields this module scores. Names are matched loosely (videoViews is views, avg_watch_pct is
 * watchPct); an unknown name is ignored; a number that is not given stays out. Throws in plain words for a bad number or when
 * there is nothing to save. ctr and cpa are worked out when their parts are there.
 */
export function cleanMetrics(input) {
  if (!plain(input)) throw new InvalidInputError('Pass the numbers as an object, for example {"views": 1200, "saves": 30}.');
  const out = {};
  for (const [name, raw] of Object.entries(input)) {
    const field = FIELD_OF.get(String(name).toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!field || out[field] !== undefined) continue;
    const label = FIELD_WORDS[field] || field;
    if (field === 'currency') { const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''; if (/^[A-Z]{3}$/.test(text)) out.currency = text; continue; }
    if (field === 'resultType') { const text = clip(raw, 80); if (text) out.resultType = text; continue; }
    const parsed = parseNumber(raw, label);
    if (!parsed) continue;
    let { number } = parsed;
    if (field === 'ctr') {
      if (parsed.percent) number /= 100;
      if (number > 1) throw new InvalidInputError('Give the click rate as a fraction such as 0.012 (or "1.2%"), or give clicks and impressions.');
      number = round(number, 6);
    } else if (field === 'watchPct') {
      if (!parsed.percent && number > 0 && number <= 1) number *= 100;
      if (number > 1000) throw new InvalidInputError('The average watch percent is a number from 0 to 100.');
      number = round(number, 2);
    } else if (COUNT_FIELDS.includes(field)) number = round(number, 2);
    else number = round(number, 4);
    out[field] = number;
  }
  if (out.clicks !== undefined && out.impressions !== undefined && out.clicks > out.impressions) throw new InvalidInputError('There are more clicks than impressions. Check the two numbers were not swapped.');
  if (out.avgWatchSec === undefined && out.watchTimeSec !== undefined && out.views > 0) out.avgWatchSec = round(out.watchTimeSec / out.views, 2);
  if (out.watchPct === undefined && out.avgWatchSec !== undefined && out.durationSec > 0) out.watchPct = round(Math.min(1000, (out.avgWatchSec / out.durationSec) * 100), 2);
  if (out.ctr === undefined && out.clicks !== undefined && out.impressions > 0) out.ctr = round(out.clicks / out.impressions, 6);
  if (out.cpa === undefined && out.spend !== undefined && out.results > 0) out.cpa = round(out.spend / out.results, 4);
  if (!Object.keys(out).some(key => isNum(out[key]))) throw new InvalidInputError('There are no numbers to save. Pass at least the views, or for an ad the spend and impressions.');
  return out;
}

function cleanPlatform(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const slug = PLATFORM_ALIASES[text] || text;
  if (!/^[a-z][a-z0-9_]{1,24}$/.test(slug)) throw new InvalidInputError('Say which platform the post is on, for example tiktok, instagram or facebook.');
  return slug;
}

function cleanWhen(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!Number.isFinite(Date.parse(text))) throw new InvalidInputError(`${name} has to be a date such as 2026-10-01 or 2026-10-01T09:30:00Z.`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date(text).toISOString();
}

// ---------------------------------------------------------------- the file
const refOf = row => row.postUrl || row.adId || '';
const dayOf = row => String(row.at || '').slice(0, 10);
const foldKey = row => [row.jobId, row.platform, row.paid ? 'paid' : 'organic', refOf(row), dayOf(row)].join('\u0000');
const unitKey = row => [row.jobId, row.platform, row.paid ? 'paid' : 'organic', refOf(row)].join('\u0000');
const usable = row => typeof row.jobId === 'string' && row.jobId && typeof row.platform === 'string' && row.platform && plain(row.metrics) && Number.isFinite(Date.parse(row.at));

/** Every reading kept (the last line of each job, platform, post or ad, and day), newest first. */
export function readResults({ root, brand, jobId = null } = {}) {
  const kept = new Map();
  for (const row of readLines(resultsFile(root, brand))) if (usable(row) && (!jobId || row.jobId === jobId)) { kept.delete(foldKey(row)); kept.set(foldKey(row), row); }
  return [...kept.values()].reverse().sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The latest reading of each post or ad, newest first. */
function latestReadings(rows) {
  const latest = new Map();
  for (const row of [...rows].reverse()) {
    const key = unitKey(row);
    const have = latest.get(key);
    if (!have || String(row.at) > String(have.at)) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * Add one reading. Returns { record, saved }: saved is false when the last line for the same post and day already says the same.
 * The job has to be one of the brand's. A paid reading is one ad (adId); an organic one is one post (postUrl).
 */
export function saveResults({ root, brand, jobId, platform, postUrl = null, adId = null, variant = null, hook = null, paid = false, metrics, at, postedAt = null, source = 'manual', now } = {}) {
  requireBrand(root, brand);
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  if (!id || !facts.jobAt(root, brand, id)) throw new InvalidInputError('That job could not be found for that brand.', { fix: 'Use the brand and jobId from pipeline_status.' });
  let link = null;
  if (postUrl !== null && postUrl !== undefined && String(postUrl).trim() !== '') {
    link = runtime.webLink(postUrl);
    if (!link) throw new InvalidInputError('The link to the post has to be an https address.');
  }
  const kind = source === undefined || source === null || source === '' ? 'manual' : String(source).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(kind)) throw new InvalidInputError(`The source is where the numbers came from, for example ${RESULT_SOURCES.slice(0, 3).join(', ')}.`);
  const ad = clip(adId, 80);
  const draft = clip(variant, 8);
  const line = clip(hook, TEXT_LIMIT);
  const posted = cleanWhen(postedAt, 'postedAt');
  const read = cleanWhen(at, 'at');
  const record = {
    jobId: id, platform: cleanPlatform(platform), paid: paid === true,
    ...(link ? { postUrl: link } : {}), ...(ad ? { adId: ad } : {}), ...(draft ? { variant: draft } : {}), ...(line ? { hook: line } : {}),
    ...(posted ? { postedAt: posted } : {}),
    at: read ? new Date(read).toISOString() : isoOf(now),
    metrics: cleanMetrics(metrics), source: kind,
  };
  const same = readLines(resultsFile(root, brand)).filter(row => usable(row) && foldKey(row) === foldKey(record)).pop();
  const stable = row => JSON.stringify({ ...row, at: null, metrics: Object.fromEntries(Object.entries(row.metrics).sort()) });
  if (same && stable(same) === stable(record)) return { record: same, saved: false };
  appendLines(resultsFile(root, brand), [record]);
  return { record, saved: true };
}

// ---------------------------------------------------------------- scoring
const WATCH_PCT = 'watchPct';
const WATCH_SEC = 'avgWatchSec';

/** The things a reading is compared on: { key, group, value, invert }. A thing the reading does not have is not there. */
function partsOf(row) {
  const m = row.metrics;
  const parts = [];
  if (row.paid) {
    if (isNum(m.ctr)) parts.push({ key: 'ctr', group: 'ctr', value: m.ctr, invert: false });
    if (isNum(m.roas)) parts.push({ key: 'roas', group: 'cost', value: m.roas, invert: false });
    else if (isNum(m.cpa)) parts.push({ key: 'cpa', group: 'cost', value: m.cpa, invert: true });
    return parts;
  }
  if (isNum(m.views)) parts.push({ key: 'views', group: 'views', value: m.views, invert: false });
  else if (isNum(m.likes)) parts.push({ key: 'likes', group: 'views', value: m.likes, invert: false });
  if (isNum(m[WATCH_PCT])) parts.push({ key: WATCH_PCT, group: 'watch', value: m[WATCH_PCT], invert: false });
  else if (isNum(m[WATCH_SEC])) parts.push({ key: WATCH_SEC, group: 'watch', value: m[WATCH_SEC], invert: false });
  if (m.views > 0 && (isNum(m.saves) || isNum(m.shares))) parts.push({ key: 'saveShare', group: 'saveShare', value: (((m.saves || 0) + (m.shares || 0)) / m.views) * 1000, invert: false });
  return parts;
}

/** What a reading counts: views, likes when it has likes and no views (Instagram), or null (an ad, or a reading with neither). */
const measureOf = row => (row.paid ? null : isNum(row.metrics.views) ? 'views' : isNum(row.metrics.likes) ? 'likes' : null);
/** One measure for several readings or rows: the one they share, 'mixed' when they differ, null when none counts anything. */
function sharedMeasure(measures) {
  const kinds = new Set(measures.filter(Boolean));
  return kinds.size > 1 ? 'mixed' : [...kinds][0] ?? null;
}
/** Rows are ranked within a measure: the ones that count only likes come after the others. */
const likesSide = row => (row.measure === 'likes' ? 1 : 0);
const countOf = (value, word) => `${value.toLocaleString('en-US')} ${word}`;

function ageHours(row) {
  const from = Date.parse(row.postedAt || '');
  const to = Date.parse(row.at || '');
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, (to - from) / HOUR_MS) : null;
}

/** Whether a reading is too young or too small to count toward a baseline or to be called. */
function isEarly(row) {
  const m = row.metrics;
  const sample = row.paid ? m.impressions : (m.views ?? m.reach ?? m.impressions);
  const likesOnly = !row.paid && !isNum(sample) && isNum(m.likes);
  const age = ageHours(row);
  if (likesOnly) return m.likes < EARLY_LIKES || (age !== null && age < EARLY_HOURS);
  return !isNum(sample) || sample < (row.paid ? EARLY_IMPRESSIONS : EARLY_VIEWS) || (age !== null && age < EARLY_HOURS);
}

/** Medians per platform and kind from the grown-up readings: { posts, established, medians:{key: median} }. */
function baselinesOf(units) {
  const out = new Map();
  for (const unit of units) {
    const key = `${unit.row.platform}\u0000${unit.row.paid ? 'paid' : 'organic'}`;
    if (!out.has(key)) out.set(key, { platform: unit.row.platform, paid: unit.row.paid === true, grownUp: [] });
    if (!unit.early) out.get(key).grownUp.push(unit);
  }
  for (const base of out.values()) {
    base.posts = base.grownUp.length;
    base.established = base.posts >= MIN_BASELINE_POSTS;
    base.medians = {};
    const keys = new Set(base.grownUp.flatMap(unit => unit.parts.map(part => part.key)));
    for (const key of keys) {
      const values = base.grownUp.flatMap(unit => unit.parts.filter(part => part.key === key).map(part => part.value));
      if (values.length >= MIN_BASELINE_POSTS) base.medians[key] = median(values);
    }
    delete base.grownUp;
  }
  return out;
}

function scoreUnit(unit, base) {
  if (!base?.established) return null;
  const used = [];
  for (const part of unit.parts) {
    const middle = base.medians[part.key];
    if (!isNum(middle) || middle <= 0) continue;
    const ratio = part.invert ? (part.value > 0 ? middle / part.value : SCORE_CAP) : part.value / middle;
    used.push({ weight: SCORE_WEIGHTS[part.group], ratio: Math.min(SCORE_CAP, ratio) });
  }
  const weights = sum(used.map(item => item.weight));
  return weights > 0 ? sum(used.map(item => item.weight * item.ratio)) / weights : null;
}

/** The score of a set of readings: the grown-up ones averaged, else the early ones. */
function summarise(units) {
  const scored = units.filter(unit => unit.score !== null);
  const grown = scored.filter(unit => !unit.early);
  const pool = grown.length ? grown : scored;
  const views = units.map(unit => unit.row.metrics.views).filter(isNum);
  const likes = units.filter(unit => unit.measure === 'likes').map(unit => unit.row.metrics.likes);
  return { score: pool.length ? mean(pool.map(unit => unit.score)) : null, early: !grown.length, posts: units.length, views: views.length ? sum(views) : null, likes: likes.length ? sum(likes) : null, measure: sharedMeasure(units.map(unit => unit.measure)) };
}

/** Several jobs' results for one thing, averaged: { score, early, uses, views } or null when no job is in it. */
function aggregate(entries) {
  if (!entries.length) return null;
  const grown = entries.filter(entry => entry.score !== null && !entry.early);
  const early = entries.filter(entry => entry.score !== null && entry.early);
  const pool = grown.length ? grown : early.length ? early : entries;
  const views = pool.map(entry => entry.views).filter(isNum);
  const likes = pool.map(entry => entry.likes).filter(isNum);
  return { score: grown.length || early.length ? mean(pool.map(entry => entry.score)) : null, early: !grown.length, uses: pool.length, views: views.length ? sum(views) : null, likes: likes.length ? sum(likes) : null, measure: sharedMeasure(pool.map(entry => entry.measure)) };
}

function labelOf(summary, cutoffs) {
  if (!summary) return null;
  if (summary.score === null || summary.early || !cutoffs.labels) return 'early';
  if (summary.score >= cutoffs.winner) return 'winner';
  if (summary.score <= cutoffs.weak) return 'weak';
  return 'average';
}

const NONE = Object.freeze({ score: null, uses: 0, label: null });
function statOf(summary, cutoffs) {
  if (!summary) return NONE;
  return { score: summary.score === null ? null : round(summary.score, 2), uses: summary.uses ?? summary.posts, label: labelOf(summary, cutoffs), ...(isNum(summary.views) ? { views: summary.views } : {}), ...(isNum(summary.likes) ? { likes: summary.likes } : {}), ...(summary.measure ? { measure: summary.measure } : {}) };
}

// ---------------------------------------------------------------- what a filed job used
const ID_IN_TEXT = /\b([A-Z]{1,4}(?:-[A-Z0-9]+)+)\b/;
const idOf = value => ID_IN_TEXT.exec(String(value ?? ''))?.[1] ?? null;
const lineOf = value => String(value ?? '').replace(/^\s*[A-Z]{1,4}(?:-[A-Z0-9]+)+\s*[-:]?\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const TRAIT_KINDS = Object.freeze(['angle', 'style', 'cta', 'format', 'editing', 'visual_hook', 'subtopic']);
/** The trait a bank kind is matched on, when its name differs. */
const TRAIT_OF = Object.freeze({ visual_hook: 'visualHook' });

function traitsOf(record) {
  const concept = plain(record?.concept) ? record.concept : {};
  const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const legacy = mapLegacyFormat(idOf(concept.format));
  return {
    hook: text(concept.hook), source: text(concept.source), angle: text(concept.angle), style: text(concept.style), cta: text(concept.cta), format: text(concept.format),
    editing: text(concept.editing) || legacy?.editing || null, visualHook: text(concept.visualHook) || legacy?.visualHook || null, subtopic: text(concept.subtopic),
    music: text(record?.music?.id) || text(record?.music?.title), voice: text(record?.voice?.id),
    drafts: Array.isArray(record?.captions) ? record.captions.length : 0,
  };
}

/** The opening line one reading used: its own when it names one, the job's picked line, or none when a draft of a many-draft job is not named. */
function hookOf(unit, traits) {
  if (unit.row.hook) return unit.row.hook;
  if (unit.row.variant && traits.drafts > 1) return null;
  return traits.hook;
}

function matchesItem(item, job, unit) {
  if (item.kind === 'hook') { const line = hookOf(unit, job.traits); return Boolean(line) && sameText(item.text, line); }
  if (!TRAIT_KINDS.includes(item.kind)) return false;
  const value = job.traits[TRAIT_OF[item.kind] ?? item.kind];
  if (!value) return false;
  if (sameText(item.text, value) || sameText(item.text, lineOf(value))) return true;
  const mine = idOf(item.text);
  return Boolean(mine) && mine === idOf(value);
}

function dimensionKeys(traits) {
  const sourceWord = String(traits.source ?? '').toLowerCase();
  const source = !sourceWord ? null : /competitor/.test(sourceWord) ? 'competitors' : /trend/.test(sourceWord) ? 'trending' : /brand/.test(sourceWord) ? 'brand' : clip(traits.source, 60);
  return {
    source, style: traits.style && (idOf(traits.style) || clip(traits.style, 60)), cta: traits.cta && (idOf(traits.cta) || clip(traits.cta, 60)),
    format: traits.format && (idOf(traits.format) || clip(traits.format, 60)), angle: traits.angle && (idOf(traits.angle) || clip(traits.angle, 60)),
    editing: traits.editing && (idOf(traits.editing) || clip(traits.editing, 60)), visualHook: traits.visualHook && (idOf(traits.visualHook) || clip(traits.visualHook, 60)),
    subtopic: traits.subtopic && clip(traits.subtopic, 60),
    voice: traits.voice, music: traits.music,
  };
}

// ---------------------------------------------------------------- the ranking
function rankingContext(root, brand) {
  const rows = readResults({ root, brand });
  if (!rows.length) return { empty: true, jobs: [], baseline: [], cutoffs: { labels: false, matureJobs: 0, winner: WINNER_MIN, weak: WEAK_MAX } };
  const filed = new Map(readFiledJobs({ root, brand }).map(record => [record.jobId, record]));
  const units = latestReadings(rows).map(row => ({ row, parts: partsOf(row), early: isEarly(row), measure: measureOf(row) }));
  const bases = baselinesOf(units);
  for (const unit of units) unit.score = scoreUnit(unit, bases.get(`${unit.row.platform}\u0000${unit.row.paid ? 'paid' : 'organic'}`));
  const byJob = new Map();
  for (const unit of units) { if (!byJob.has(unit.row.jobId)) byJob.set(unit.row.jobId, []); byJob.get(unit.row.jobId).push(unit); }
  const jobs = [...byJob].map(([jobId, list]) => {
    const record = filed.get(jobId) || null;
    return { jobId, title: record?.title ?? null, filed: Boolean(record), traits: traitsOf(record), units: list, ...summarise(list), at: list.map(unit => unit.row.at).sort().pop() };
  });
  const grownScores = jobs.filter(job => job.score !== null && !job.early).map(job => job.score);
  const cutoffs = grownScores.length >= MIN_LABEL_JOBS
    ? { labels: true, matureJobs: grownScores.length, winner: Math.max(WINNER_MIN, nearestRank(grownScores, 0.75)), weak: Math.min(WEAK_MAX, nearestRank(grownScores, 0.25)) }
    : { labels: false, matureJobs: grownScores.length, winner: WINNER_MIN, weak: WEAK_MAX };
  for (const job of jobs) job.label = labelOf(job, cutoffs);
  const baseline = [...bases.values()].sort((a, b) => a.platform.localeCompare(b.platform) || Number(a.paid) - Number(b.paid));
  return { empty: false, jobs, baseline, cutoffs };
}

function itemStat(item, context) {
  if (context.empty) return NONE;
  const entries = [];
  for (const job of context.jobs) {
    const units = job.units.filter(unit => matchesItem(item, job, unit));
    if (units.length) { const summary = summarise(units); entries.push({ score: summary.score, early: summary.early, views: summary.views, likes: summary.likes, measure: summary.measure }); }
  }
  return statOf(aggregate(entries), context.cutoffs);
}

function jobStat(job, context) {
  return {
    jobId: job.jobId, title: job.title, filed: job.filed, score: job.score === null ? null : round(job.score, 2), label: job.label, early: job.early, posts: job.posts,
    views: job.views, ...(isNum(job.likes) ? { likes: job.likes } : {}), ...(job.measure ? { measure: job.measure } : {}), at: job.at,
    units: job.units.map(unit => ({
      platform: unit.row.platform, paid: unit.row.paid === true, ...(unit.row.postUrl ? { postUrl: unit.row.postUrl } : {}), ...(unit.row.adId ? { adId: unit.row.adId } : {}),
      ...(unit.row.variant ? { variant: unit.row.variant } : {}), ...(unit.row.postedAt ? { postedAt: unit.row.postedAt } : {}), at: unit.row.at, source: unit.row.source,
      score: unit.score === null ? null : round(unit.score, 2), early: unit.early, ...(unit.measure ? { measure: unit.measure } : {}), metrics: unit.row.metrics,
    })),
    ...(job.score === null ? { note: `Not enough posts to compare yet: a platform needs ${MIN_BASELINE_POSTS} posts at least ${EARLY_HOURS / 24} days old with ${EARLY_VIEWS} or more views (ads: ${EARLY_IMPRESSIONS} impressions) before its posts are scored.` }
      : context.cutoffs.labels ? {} : { note: `Winners and weak lines are called once ${MIN_LABEL_JOBS} jobs have results that are not early.` }),
  };
}

/**
 * Items in the order they should be offered: grown-up scores high to low, then early ones, then the unscored in the order they came.
 * Within a tier the items that count only likes come after the rest, so views and likes are never ranked against each other.
 */
function order(rows) {
  const tier = row => (row.stat.score === null ? 2 : row.stat.label === 'early' ? 1 : 0);
  return rows.sort((a, b) => tier(a) - tier(b) || (tier(a) < 2 ? likesSide(a.stat) - likesSide(b.stat) || b.stat.score - a.stat.score : 0) || a.index - b.index);
}

/**
 * Put results on the items of a bank and sort them: each item gets { score, uses, label, views? } and the ones with a grown-up score
 * come first, high to low; items with only early results come next; the rest keep the order they came in. With no results at all
 * the order is unchanged (and every item reads score null, uses 0, label null). Never throws: a results file it cannot read is none.
 */
export function applyRanking({ root, brand, items, context: given } = {}) {
  let context = given;
  if (!context) { try { context = rankingContext(root, brand); } catch { context = { empty: true, jobs: [], cutoffs: { labels: false } }; } }
  const rows = (items || []).map((item, index) => { const stat = itemStat(item, context); return { item: { ...item, ...stat }, stat, index }; });
  return order(rows).map(row => row.item);
}

/**
 * Everything the results say about a brand: { brand, hasResults, cutoffs, baseline, jobs, items:{yours, proven}, dimensions }.
 * jobs are scored and labelled, best first; items are the bank items that have results behind them; dimensions group the filed
 * jobs by what they used (source, style, cta, format, angle, voice, music).
 */
export function rankBank({ root, brand } = {}) {
  const context = rankingContext(root, brand);
  const items = {};
  for (const bank of ['yours', 'proven']) {
    items[bank] = applyRanking({ root, brand, context, items: readBank({ root, brand, bank, ranked: false }) }).filter(item => item.uses > 0);
  }
  const groups = new Map();
  for (const job of context.jobs) {
    for (const [dimension, key] of Object.entries(dimensionKeys(job.traits))) {
      if (!key) continue;
      const id = `${dimension}\u0000${key}`;
      if (!groups.has(id)) groups.set(id, { dimension, key, entries: [] });
      groups.get(id).entries.push({ score: job.score, early: job.early, views: job.views, likes: job.likes, measure: job.measure });
    }
  }
  const dimensions = {};
  for (const group of groups.values()) (dimensions[group.dimension] ||= []).push({ key: group.key, ...statOf(aggregate(group.entries), context.cutoffs) });
  for (const list of Object.values(dimensions)) list.sort((a, b) => likesSide(a) - likesSide(b) || (b.score ?? -1) - (a.score ?? -1) || a.key.localeCompare(b.key));
  const jobs = context.jobs.map(job => jobStat(job, context)).sort((a, b) => Number(a.early) - Number(b.early) || likesSide(a) - likesSide(b) || (b.score ?? -1) - (a.score ?? -1) || String(b.at).localeCompare(String(a.at)));
  return {
    brand, hasResults: !context.empty,
    cutoffs: { labels: context.cutoffs.labels, grownUpJobs: context.cutoffs.matureJobs, winnerAtLeast: round(context.cutoffs.winner, 2), weakAtMost: round(context.cutoffs.weak, 2) },
    baseline: context.baseline.map(base => ({ platform: base.platform, kind: base.paid ? 'paid' : 'organic', posts: base.posts, established: base.established, medians: base.medians })),
    jobs, items, dimensions, how: SCORE_WORDS,
  };
}

/** The result of each job that has results, by job id: { score, label, early, posts, views, at }. Used for the board and the agent reply. */
export function jobResults({ root, brand } = {}) {
  const out = new Map();
  try {
    const context = rankingContext(root, brand);
    for (const job of context.jobs) out.set(job.jobId, { score: job.score === null ? null : round(job.score, 2), label: job.label, early: job.early, posts: job.posts, ...(isNum(job.views) ? { views: job.views } : {}), ...(isNum(job.likes) ? { likes: job.likes } : {}), ...(job.measure ? { measure: job.measure } : {}), at: job.at });
  } catch { /* a results file that cannot be read is none */ }
  return out;
}

/**
 * A short plain description of an item's stat for an agent: "2.3x this brand's usual (3 posts, 45,200 views)". A stat that counts
 * only likes (Instagram shows no views) says so: "2.3x this brand's usual likes (1 post, 954 likes)"; one that has both says which
 * count belongs to which posts: "(3 posts, 45,200 views, 954 likes on the posts with no views)".
 */
export function describeStat(stat) {
  if (!stat || !stat.uses) return '';
  const posts = `${stat.uses} ${stat.uses === 1 ? 'post' : 'posts'}`;
  const likesOnly = stat.measure === 'likes';
  const counts = [isNum(stat.views) ? countOf(stat.views, 'views') : null, isNum(stat.likes) ? countOf(stat.likes, isNum(stat.views) ? 'likes on the posts with no views' : 'likes') : null].filter(Boolean);
  const detail = [posts, ...counts].join(', ');
  if (stat.label === 'early' || stat.score === null) return `too early to call (${detail})`;
  return `${stat.score.toFixed(1)}x this brand's usual${likesOnly ? ' likes' : ''} (${detail})`;
}

// ---------------------------------------------------------------- winners go to the proven bank
/**
 * Promote the opening line of every winning job to bank/proven (kind hook, source 'brand', evidence {url, views, date} or, for a best post
 * that has likes and no views, {url, likes, date}, promotedFrom the job). Safe to run any time: a line already in the bank, one the person removed, or one promoted before is left alone.
 * Returns { promoted: [{ jobId, item }], skipped: [{ jobId, reason }] }; a winner with no opening line or no link to its post is skipped.
 */
export function promoteWinners({ root, brand, now } = {}) {
  const context = rankingContext(root, brand);
  const out = { promoted: [], skipped: [] };
  if (context.empty) return out;
  for (const job of context.jobs) {
    if (job.label !== 'winner') continue;
    const best = job.units.filter(unit => !unit.row.paid && unit.row.postUrl && runtime.webLink(unit.row.postUrl)).sort((a, b) => (isNum(a.row.metrics.views) ? 0 : 1) - (isNum(b.row.metrics.views) ? 0 : 1) || (b.row.metrics.views ?? b.row.metrics.likes ?? -1) - (a.row.metrics.views ?? a.row.metrics.likes ?? -1))[0]
      || job.units.filter(unit => unit.row.postUrl && runtime.webLink(unit.row.postUrl))[0];
    const line = best ? hookOf(best, job.traits) : job.traits.hook;
    if (!line) { out.skipped.push({ jobId: job.jobId, reason: 'no opening line is filed for this job' }); continue; }
    if (!best) { out.skipped.push({ jobId: job.jobId, reason: 'no link to the post' }); continue; }
    const had = readBank({ root, brand, bank: 'proven', kind: 'hook', includeRemoved: true, ranked: false }).find(item => item.promotedFrom === job.jobId || sameText(item.text, line));
    if (had) continue;
    const { views, likes } = best.row.metrics;
    const date = String(best.row.postedAt || best.row.at).slice(0, 10);
    const added = addToBank({
      root, brand, bank: 'proven', kind: 'hook', text: line, source: 'brand', jobId: job.jobId, promotedFrom: job.jobId, now,
      evidence: !isNum(views) && isNum(likes) ? { url: best.row.postUrl, likes, date } : { url: best.row.postUrl, views: isNum(views) ? views : null, date },
    });
    if (added.saved) out.promoted.push({ jobId: job.jobId, item: added.item });
  }
  return out;
}

// ---------------------------------------------------------------- the ways results come in
/**
 * Save a reading, file the job when it is not filed yet, promote any new winner, and say where the job stands.
 * Returns { record, saved, job, promoted[] }.
 */
export function recordResults(options = {}) {
  const { root, brand, now } = options;
  const saved = saveResults(options);
  if (!readFiledJobs({ root, brand }).some(record => record.jobId === saved.record.jobId)) fileJobQuietly({ root, brand, jobId: saved.record.jobId, now });
  const promotion = promoteWinners({ root, brand, now });
  // The brand's formats ranking (library/intelligence/formats-rank.json) takes the new numbers in.
  refreshFormatsRankQuietly({ root, brand, now });
  const job = rankBank({ root, brand }).jobs.find(item => item.jobId === saved.record.jobId) ?? null;
  return { ...saved, job, promoted: promotion.promoted };
}

const quietly = (what, run) => {
  try { return run(); } catch (error) {
    try { process.stderr.write(`brand results: could not file ${what}: ${String(error?.message || error).slice(0, 300)}\n`); } catch { /* nothing to write to */ }
    return null;
  }
};

let variantsLib = null;
/** The draft (D1, D2) an Ads Manager row belongs to: the one it was matched to, else the V-xxxxxx-D1 id in its name when that id is this job's. */
function variantOf(row, jobId) {
  if (row.variant) return row.variant;
  const found = /V-[0-9a-f]{6}-(D\d+[a-z]?)/.exec(`${row.name ?? ''} ${row.id ?? ''}`);
  if (!found) return null;
  variantsLib ||= createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-ad-variants.js'));
  return variantsLib.variantId(jobId, found[1]) === found[0] ? found[1] : null;
}

function draftCount(dir) {
  try { return readdirSync(join(dir, 'drafts'), { withFileTypes: true }).filter(entry => entry.isDirectory() && /^D\d+$/.test(entry.name) && existsSync(join(dir, 'drafts', entry.name, 'post.md'))).length; } catch { return 0; }
}

/** The first line of a draft's caption, which is its opening line. */
function captionHook(dir, draft) {
  if (!/^D\d+[a-z]?$/.test(draft || '')) return null;
  let text = '';
  try { text = readFileSync(join(dir, 'drafts', draft, 'post.md'), 'utf8'); } catch { return null; }
  const after = text.split(/^#\s+Caption\s*$/m)[1];
  const first = (after || '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#') && !line.startsWith('<!--'));
  return first ? clip(first.replace(/^["'“‘]+|["'”’]+$/g, ''), TEXT_LIMIT) : null;
}

/**
 * The ads in a results file that pipeline_ad_results_save just wrote, into the library. Only ad-level rows that belong to a draft of
 * this job count (a row the person has not matched is not this job's result). Returns { recorded, promoted[] } or null on a problem.
 */
export function recordAdResults({ root, brand, jobId, record, now } = {}) {
  const platform = PROVIDER_PLATFORM[record?.provider];
  if (!platform || record.level !== 'ad' || !Array.isArray(record.rows)) return { recorded: 0, promoted: [] };
  const job = facts.jobAt(root, brand, jobId);
  if (!job) return { recorded: 0, promoted: [] };
  const many = draftCount(job.dir) > 1;
  let recorded = 0;
  for (const row of record.rows) {
    const variant = variantOf(row, jobId);
    if (!variant) continue;
    const metrics = {};
    for (const field of ['spend', 'impressions', 'reach', 'clicks', 'linkClicks', 'results', 'thruplays']) if (isNum(row[field])) metrics[field] = row[field];
    if (isNum(row.videoViews)) metrics.views = row.videoViews;
    if (record.currency) metrics.currency = record.currency;
    if (row.resultType) metrics.resultType = row.resultType;
    if (!Object.keys(metrics).some(key => isNum(metrics[key]))) continue;
    const saved = saveResults({
      root, brand, jobId, platform, paid: true, adId: row.id, variant, hook: many ? captionHook(job.dir, variant) : null,
      metrics, at: record.readAt, postedAt: record.dateStart, source: 'ad_results', now,
    });
    if (saved.saved) recorded += 1;
  }
  if (!recorded) return { recorded: 0, promoted: [] };
  if (!readFiledJobs({ root, brand }).some(item => item.jobId === jobId)) fileJobQuietly({ root, brand, jobId, now });
  const promoted = promoteWinners({ root, brand, now }).promoted;
  refreshFormatsRankQuietly({ root, brand, now });
  return { recorded, promoted };
}
export const recordAdResultsQuietly = options => quietly('ad results', () => (runtime.isGeneralBrand(options?.brand) ? null : recordAdResults(options)));

/**
 * The metric observations import-metrics.js wrote (pipeline/schemas/metrics.schema.json) into the library: every Metricool post, and
 * the ads read from an Ads Manager CSV (the connector's ads are filed when they are saved). Returns { recorded, promoted[] }.
 */
export function recordObservations({ root, brand, observations, now } = {}) {
  let recorded = 0;
  for (const observation of Array.isArray(observations) ? observations : []) {
    const m = plain(observation?.metrics) ? observation.metrics : {};
    const paid = observation.objectType !== 'post';
    if (paid && observation.source !== 'csv_export') continue;
    const metrics = {};
    const take = (to, from = to) => { if (isNum(m[from])) metrics[to] = m[from]; };
    if (paid) { ['spend', 'impressions', 'reach', 'clicks', 'linkClicks', 'results', 'thruplays'].forEach(field => take(field)); take('views', 'videoViews'); if (m.currency) metrics.currency = m.currency; if (m.resultType) metrics.resultType = m.resultType; }
    else { ['reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'clicks'].forEach(field => take(field)); take('views', 'videoViews'); }
    if (!Object.keys(metrics).some(key => isNum(metrics[key]))) continue;
    const saved = saveResults({
      root, brand, jobId: observation.jobId, platform: observation.platform, paid, postUrl: paid ? null : observation.raw?.postUrl ?? null,
      adId: paid ? observation.externalObjectId : null, variant: paid ? observation.deliverableId : null, metrics,
      at: observation.collectedAt, postedAt: paid ? observation.windowStart : observation.publishedAt, source: paid ? 'csv_export' : 'metricool', now,
    });
    if (saved.saved) recorded += 1;
  }
  if (!recorded) return { recorded: 0, promoted: [] };
  const jobs = new Set(observations.map(observation => observation.jobId));
  for (const jobId of jobs) if (!readFiledJobs({ root, brand }).some(item => item.jobId === jobId)) fileJobQuietly({ root, brand, jobId, now });
  const promoted = promoteWinners({ root, brand, now }).promoted;
  refreshFormatsRankQuietly({ root, brand, now });
  return { recorded, promoted };
}
export const recordObservationsQuietly = options => quietly('results', () => (runtime.isGeneralBrand(options?.brand) ? null : recordObservations(options)));
