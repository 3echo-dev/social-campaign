// Results read back after a job was handed off, matched to its ads and posts, and written as metric
// observations (schemas/metrics.schema.json) that the findings and the scorecard read.
//
// Where results come from:
//   results/ad-results/*.json       ad results the Director read with the Meta Ads or TikTok for Business
//                                   connector (pipeline_ad_results_save), in the job that ran the ads
//   results/ad-results-csv/*.json   the same shape, from an Ads Manager CSV export (import-metrics.js --csv)
//   Metricool rows                  organic post numbers the Director read with Metricool (--metricool)
// An ad is matched by the ad id at the end of its name (V-xxxxxx-D1, from lib-ad-variants.js), else by the
// draft the Director named for it. Nothing is guessed: an unmatched row is listed, never assigned.
// All maths happens here. A count the source did not give stays unknown, never zero.
const fs = require('fs');
const path = require('path');
const variantsLib = require('./lib-ad-variants.js');

const DAY = 24 * 60 * 60 * 1000;
const SETTLE_DAYS = 7;
const AD_ID_IN_TEXT = /V-[0-9a-f]{6}-D\d+[a-z]?/;
const DELIVERABLE = /^D\d{1,3}[a-z]?$/;
const PROVIDER_PLATFORM = { meta_ads: 'facebook', tiktok_ads: 'tiktok' };
const PLATFORMS = new Set(['facebook', 'instagram', 'tiktok']);
const LEVEL_OBJECT = { ad: 'ad', adset: 'ad_set', campaign: 'campaign' };
const AD_COUNTS = ['spend', 'impressions', 'reach', 'clicks', 'linkClicks', 'results', 'videoViews', 'thruplays'];
const POST_COUNTS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'videoViews', 'clicks'];
// Fewer impressions (or reach, for a post) than this and a pair is "too early to call".
const MIN_SAMPLE = 1000;

// The main metric each awareness stage is judged on (playbooks/awareness-stages.md), as a rate the numbers
// can give. Every one is higher-is-better.
const MAIN_METRIC = {
  unaware: { ad: 'holdRate', post: 'viewRate', words: '3 s hold' },
  problem_aware: { ad: 'completionRate', post: 'commentRate', words: 'completion, comments' },
  solution_aware: { ad: 'ctr', post: 'saveShareRate', words: 'saves and shares (clicks for ads)' },
  product_aware: { ad: 'linkCtr', post: 'clickRate', words: 'link clicks' },
  most_aware: { ad: 'resultRate', post: 'clickRate', words: 'conversions' },
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ratio(a, b) {
  return a === null || b === null || b === 0 ? null : a / b;
}

function round(value, places = 6) {
  if (value === null) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function dateOnly(value) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''));
  return m ? m[0] : '';
}

function addDays(date, days) {
  const t = Date.parse(date + 'T00:00:00Z');
  return Number.isNaN(t) ? '' : new Date(t + days * DAY).toISOString().slice(0, 10);
}

// Inclusive length of a date range in days, and the checkpoint it counts as.
function checkpointFor(start, end) {
  const a = Date.parse(dateOnly(start) + 'T00:00:00Z');
  const b = Date.parse(dateOnly(end) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const days = Math.round((b - a) / DAY) + 1;
  if (days <= 1) return '24h';
  if (days <= 3) return '72h';
  if (days <= 7) return '7d';
  if (days <= 28) return '28d';
  return 'end';
}

// A result settles once its window has been closed for the attribution window (7 days), so late
// conversions have arrived. Only settled results may teach the scorecard.
function settlementFor(windowEnd, readAt) {
  const settlesAt = addDays(dateOnly(windowEnd), SETTLE_DAYS);
  const read = dateOnly(readAt);
  return { settlesAt, settlement: settlesAt && read && read >= settlesAt ? 'settled' : 'provisional' };
}

function adRates(m) {
  const plays = m.thruplays !== null ? m.thruplays : null;
  return {
    ctr: round(ratio(m.clicks, m.impressions)),
    linkCtr: round(ratio(m.linkClicks, m.impressions)),
    holdRate: round(ratio(m.videoViews, m.impressions)),
    completionRate: round(ratio(plays, m.impressions)),
    resultRate: round(ratio(m.results, m.impressions)),
    cpc: round(ratio(m.spend, m.clicks), 4),
    cpm: m.spend === null || !m.impressions ? null : round((m.spend / m.impressions) * 1000, 4),
    costPerResult: round(ratio(m.spend, m.results), 4),
  };
}

function postRates(m) {
  const base = m.reach !== null ? m.reach : m.impressions;
  const saveShare = m.saves === null || m.shares === null ? null : m.saves + m.shares;
  return {
    viewRate: round(ratio(m.videoViews, base)),
    commentRate: round(ratio(m.comments, base)),
    saveShareRate: round(ratio(saveShare, base)),
    clickRate: round(ratio(m.clicks, base)),
    engagementRate: round(ratio([m.likes, m.comments, m.shares, m.saves].some(v => v === null) ? null : m.likes + m.comments + m.shares + m.saves, base)),
  };
}

// The source job's ads: from the hand-off's variants.json, else worked out from job.json and the drafts.
function readVariants(sourceDir, sourceJobId) {
  const doc = readJson(path.join(sourceDir, 'handoff', 'campaign', 'variants.json'));
  if (doc && Array.isArray(doc.variants)) return { variants: doc.variants, pairs: Array.isArray(doc.pairs) ? doc.pairs : [], from: 'handoff/campaign/variants.json' };
  const job = readJson(path.join(sourceDir, 'job.json')) || {};
  const { parseFile } = require('./lib-frontmatter.js');
  const variants = (Array.isArray(job.deliverables) ? job.deliverables : []).filter(d => d && d.id).map(d => {
    let data = {};
    try { data = parseFile(path.join(sourceDir, 'drafts', d.id, 'post.md')).data || {}; } catch {}
    return { variantId: variantsLib.variantId(sourceJobId, d.id), deliverable: d.id, platform: String(data.platform || d.platform || ''), parts: variantsLib.partsOf(data), testPairs: [] };
  });
  return { variants, pairs: [], from: 'job.json and drafts' };
}

function readRecords(dir, rel, source) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, ...rel.split('/'))).filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const record = readJson(path.join(dir, ...rel.split('/'), name));
    if (record && Array.isArray(record.rows) && PROVIDER_PLATFORM[record.provider]) out.push({ ...record, file: rel + '/' + name, source: record.source || source });
  }
  return out;
}

// Every saved ad results file for the source job: connector first, then CSV.
function readAdRecords(sourceDir) {
  return readRecords(sourceDir, 'results/ad-results', 'connector').concat(readRecords(sourceDir, 'results/ad-results-csv', 'csv_export'));
}

function matchAdRow(row, byId, byDeliverable) {
  const inText = AD_ID_IN_TEXT.exec(String(row.name || '')) || AD_ID_IN_TEXT.exec(String(row.id || ''));
  if (inText) {
    const v = byId.get(inText[0]);
    if (v) return { variant: v, by: 'ad id in the name' };
    return { variant: null, reason: 'its ad id ' + inText[0] + ' belongs to another job' };
  }
  if (row.variant && byDeliverable.get(row.variant)) return { variant: byDeliverable.get(row.variant), by: 'draft named when the results were read' };
  return { variant: null, reason: 'no ad id in its name and no draft named' };
}

function observationName(o) {
  const via = o.raw && o.raw.provider ? o.raw.provider : o.source;
  return o.deliverableId + '-' + via + '-' + dateOnly(o.windowStart) + '_' + dateOnly(o.windowEnd) + '.json';
}

// One observation per matched ad row. Only ad-level rows can be matched to an ad.
function adObservations({ brand, sourceJobId, records, variants }) {
  const byId = new Map(variants.map(v => [v.variantId, v]));
  const byDeliverable = new Map(variants.map(v => [v.deliverable, v]));
  const observations = [];
  const unmatched = [];
  for (const record of records) {
    const { settlement, settlesAt } = settlementFor(record.dateEnd, record.readAt);
    for (const row of record.rows) {
      if (record.level !== 'ad') { unmatched.push({ file: record.file, row: row.name || row.id, reason: 'it is a ' + (record.level === 'adset' ? 'ad set' : record.level) + ' row, not one ad' }); continue; }
      const match = matchAdRow(row, byId, byDeliverable);
      if (!match.variant) { unmatched.push({ file: record.file, row: row.name || row.id, reason: match.reason }); continue; }
      const v = match.variant;
      const counts = {};
      for (const f of AD_COUNTS) counts[f] = num(row[f]);
      const platform = PLATFORMS.has(v.platform) ? v.platform : PROVIDER_PLATFORM[record.provider];
      observations.push({
        schemaVersion: '1.0', brand, jobId: sourceJobId, platform, objectType: LEVEL_OBJECT[record.level],
        externalObjectId: String(row.id), deliverableId: v.deliverable,
        collectedAt: record.readAt, windowStart: record.dateStart, windowEnd: record.dateEnd,
        checkpoint: checkpointFor(record.dateStart, record.dateEnd) || 'end', settlement, settlesAt,
        source: record.source === 'csv_export' ? 'csv_export' : 'connector',
        metrics: { currency: record.currency || null, resultType: row.resultType || null, ...counts, ...adRates(counts) },
        raw: { provider: record.provider, account: record.account && record.account.id || null, variantId: v.variantId, adName: row.name || null, file: record.file, matchedBy: match.by },
      });
    }
  }
  return { observations, unmatched };
}

// Metricool rows: [{ deliverable | postUrl, platform?, publishedAt, impressions, reach, likes, ... }].
function postObservations({ brand, sourceJobId, sourceDir, rows, readAt, variants }) {
  const byDeliverable = new Map(variants.map(v => [v.deliverable, v]));
  const posted = readJson(path.join(sourceDir, 'publish', 'posted.json')) || {};
  const byLink = new Map();
  for (const [id, entry] of Object.entries(posted)) if (entry && entry.link) byLink.set(String(entry.link).replace(/\/+$/, ''), id);
  const observations = [];
  const unmatched = [];
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const label = row && (row.deliverable || row.postUrl) || 'row ' + (index + 1);
    if (!row || typeof row !== 'object') { unmatched.push({ file: 'metricool', row: label, reason: 'it is not a row' }); continue; }
    let D = DELIVERABLE.test(String(row.deliverable || '')) ? String(row.deliverable) : '';
    if (!D && row.postUrl) {
      const id = byLink.get(String(row.postUrl).replace(/\/+$/, ''));
      if (id && byDeliverable.has(id)) D = id;
    }
    const v = byDeliverable.get(D);
    if (!v) { unmatched.push({ file: 'metricool', row: label, reason: D ? D + ' is not one of this job\'s posts' : 'no draft named and its link is not in the posting record' }); continue; }
    const published = dateOnly(row.publishedAt);
    const windowEnd = dateOnly(row.windowEnd || row.collectedAt || readAt);
    if (!published) { unmatched.push({ file: 'metricool', row: label, reason: 'it has no publish date' }); continue; }
    const counts = {};
    for (const f of POST_COUNTS) {
      const n = typeof row[f] === 'string' ? Number(row[f].replace(/,/g, '')) : row[f];
      counts[f] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    }
    const checkpoint = checkpointFor(published, windowEnd) || '24h';
    // A post's numbers barely move after a week, so an organic result settles at its 7-day checkpoint.
    const settled = ['7d', '28d', 'end'].includes(checkpoint);
    const platform = PLATFORMS.has(String(row.platform || '')) ? String(row.platform) : (PLATFORMS.has(v.platform) ? v.platform : 'facebook');
    observations.push({
      schemaVersion: '1.0', brand, jobId: sourceJobId, platform, objectType: 'post',
      externalObjectId: String(row.postId || row.postUrl || D), deliverableId: D, publishedAt: published,
      collectedAt: readAt, windowStart: published, windowEnd, checkpoint,
      settlement: settled ? 'settled' : 'provisional', settlesAt: addDays(published, 6),
      source: 'metricool', metrics: { ...counts, ...postRates(counts) },
      raw: { provider: 'metricool', variantId: v.variantId, postUrl: row.postUrl || null },
    });
  }
  return { observations, unmatched };
}

// The latest observation per deliverable (prefer settled, then the longest window), with its main metric.
function summarize({ sourceJobId, variants, pairs, observations }) {
  const latest = new Map();
  const better = (a, b) => {
    if (!b) return true;
    if ((a.settlement === 'settled') !== (b.settlement === 'settled')) return a.settlement === 'settled';
    return String(a.windowEnd) > String(b.windowEnd) || (a.windowEnd === b.windowEnd && String(a.windowStart) < String(b.windowStart));
  };
  for (const o of observations) if (better(o, latest.get(o.deliverableId))) latest.set(o.deliverableId, o);
  const pieces = variants.map(v => {
    const o = latest.get(v.deliverable) || null;
    const stage = v.parts && v.parts.awareness_stage;
    const main = MAIN_METRIC[stage] || null;
    const kind = o && o.objectType === 'post' ? 'post' : 'ad';
    const metric = main ? main[kind] : null;
    const sample = o ? (kind === 'post' ? (o.metrics.reach !== null ? o.metrics.reach : o.metrics.impressions) : o.metrics.impressions) : null;
    return {
      deliverable: v.deliverable, variantId: v.variantId, platform: v.platform, parts: v.parts || {},
      checkpoint: o ? o.checkpoint : null, settlement: o ? o.settlement : null, window: o ? [o.windowStart, o.windowEnd] : null,
      mainMetric: metric, mainMetricWords: main ? main.words : null, mainValue: o && metric ? o.metrics[metric] : null, sample,
      metrics: o ? o.metrics : null,
    };
  });
  const byId = new Map(pieces.map(p => [p.variantId, p]));
  const pairResults = (pairs || []).map(pair => {
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    const out = { pair: pair.pair, a: pair.a, b: pair.b, differsBy: pair.differsBy || [], verdict: 'no result yet', winner: null, lift: null };
    if (!a || !b || a.mainValue === null || b.mainValue === null) return out;
    if (a.mainMetric !== b.mainMetric) { out.verdict = 'judged on different metrics, not comparable'; return out; }
    if ((a.sample || 0) < MIN_SAMPLE || (b.sample || 0) < MIN_SAMPLE) { out.verdict = 'too early to call'; return out; }
    if (a.settlement !== 'settled' || b.settlement !== 'settled') out.provisional = true;
    if (a.mainValue === b.mainValue) { out.verdict = 'tie'; return out; }
    const [win, lose] = a.mainValue > b.mainValue ? [a, b] : [b, a];
    out.winner = win.variantId;
    out.lift = lose.mainValue ? round((win.mainValue - lose.mainValue) / lose.mainValue, 4) : null;
    out.verdict = (out.provisional ? 'provisional: ' : '') + win.deliverable + ' won on ' + a.mainMetric;
    return out;
  });
  return { schemaVersion: '1.0', sourceJobId, pieces, pairs: pairResults };
}

function writeObservations(jobDir, observations) {
  const dir = path.join(jobDir, 'metrics');
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const o of observations) {
    const name = observationName(o);
    fs.writeFileSync(path.join(dir, name), JSON.stringify(o, null, 2) + '\n');
    written.push('metrics/' + name);
  }
  return written;
}

// Every settled-or-not observation saved for a brand, across its jobs: what the scorecard reads.
function readBrandObservations(jobsDir) {
  const out = [];
  let jobs = [];
  try { jobs = fs.readdirSync(jobsDir); } catch { return out; }
  for (const job of jobs) {
    let names = [];
    try { names = fs.readdirSync(path.join(jobsDir, job, 'metrics')).filter(n => n.endsWith('.json')); } catch { continue; }
    for (const name of names) {
      const o = readJson(path.join(jobsDir, job, 'metrics', name));
      if (o && o.schemaVersion === '1.0' && o.deliverableId && o.metrics) out.push({ ...o, file: job + '/metrics/' + name });
    }
  }
  return out;
}

module.exports = {
  SETTLE_DAYS, MIN_SAMPLE, MAIN_METRIC, AD_COUNTS, POST_COUNTS,
  checkpointFor, settlementFor, adRates, postRates, readVariants, readAdRecords, matchAdRow,
  adObservations, postObservations, summarize, writeObservations, readBrandObservations, observationName,
};
