/**
 * Ad results read from the Meta Ads or TikTok for Business connector, saved into a job.
 *
 * Nothing here calls a connector: the running Claude session reads the results with the
 * connector's read-only tools, maps each row onto the fields below, and hands them in. All the
 * maths happens here, in code: totals, rates and cost per result. A number the connector did not
 * give stays unknown, it is never guessed or filled with zero, and a total over rows where some
 * are unknown is marked partial. One save holds one ad account, so one currency, and one level
 * (ad, ad set or campaign), so nothing is counted twice.
 *
 * Files, inside the job:
 *   results/ad-results/<provider>-<dateStart>_<dateEnd>.json   one per account and date range (a repeat replaces it)
 *   results/ad-results.md                                      the summary the board shows in the job's files
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as runtime from './runtime.mjs';
import { AD_PROVIDERS, readBrandAdAccount } from './ad-accounts.mjs';
import { recordAdResultsQuietly } from './brand-results.mjs';

export const AD_RESULTS_DIR = 'results/ad-results';
export const AD_RESULTS_SUMMARY = 'results/ad-results.md';
export const AD_RESULT_LEVELS = Object.freeze(['ad', 'adset', 'campaign']);
export const AD_RESULTS_ROW_LIMIT = 500;
export const AD_RESULTS_VERSION = 1;

/** The counted fields, in the order the summary shows them. Each is a non-negative number or unknown (null). */
export const AD_RESULT_METRICS = Object.freeze(['spend', 'impressions', 'reach', 'clicks', 'linkClicks', 'results', 'videoViews', 'thruplays']);

const PROVIDER_WORDS = Object.freeze({ meta_ads: 'Meta', tiktok_ads: 'TikTok' });
const LEVEL_WORDS = Object.freeze({ ad: 'ad', adset: 'ad set', campaign: 'campaign' });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const VARIANT = /^D\d{1,3}$/;
const TEXT_LIMIT = 160;

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function text(value, limit = TEXT_LIMIT) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/** A counted value: a finite number of zero or more (a numeric string is accepted), or null when unknown. */
function count(value, field, rowLabel) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`${rowLabel}: ${field} is not a number. Leave it out when the connector did not give it.`);
  if (number < 0) throw new Error(`${rowLabel}: ${field} cannot be below zero.`);
  return number;
}

function validDate(value, name) {
  const date = String(value ?? '').trim();
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error(`${name} must be a date written as YYYY-MM-DD.`);
  return date;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** a / b, or null when either is unknown or b is zero. */
function ratio(a, b) {
  return a === null || b === null || b === 0 ? null : a / b;
}

/**
 * Clean the rows handed in. Every row needs an id, and ids are unique within one save. Unknown
 * fields are dropped; counted fields are numbers or null.
 */
export function normalizeAdResultRows(rows, level) {
  if (!Array.isArray(rows)) throw new Error('Pass the rows as a list, one per ' + LEVEL_WORDS[level] + '.');
  if (!rows.length) throw new Error('There are no rows to save. Say plainly that the account had no results in this date range instead.');
  if (rows.length > AD_RESULTS_ROW_LIMIT) throw new Error(`Save at most ${AD_RESULTS_ROW_LIMIT} rows at a time; use a shorter date range or the campaign level.`);
  const seen = new Set();
  return rows.map((row, index) => {
    if (!plain(row)) throw new Error(`Row ${index + 1} is not a row.`);
    const id = text(row.id, 80);
    const label = `Row ${index + 1}${id ? ` (${id})` : ''}`;
    if (!id) throw new Error(`${label} has no id. Use the ${LEVEL_WORDS[level]} id the connector gave.`);
    if (seen.has(id)) throw new Error(`${label} appears twice. Each ${LEVEL_WORDS[level]} is saved once, so nothing is counted twice.`);
    seen.add(id);
    const variant = text(row.variant, 8);
    if (variant && !VARIANT.test(variant)) throw new Error(`${label}: variant must be a draft name such as D1.`);
    const clean = {
      id,
      name: text(row.name),
      campaignName: text(row.campaignName),
      adsetName: text(row.adsetName),
      resultType: text(row.resultType, 80),
      variant: variant || null,
    };
    for (const field of AD_RESULT_METRICS) clean[field] = count(row[field], field, label);
    if (clean.clicks !== null && clean.impressions !== null && clean.clicks > clean.impressions) {
      throw new Error(`${label}: more clicks than impressions. Check that the two columns were not swapped.`);
    }
    return clean;
  });
}

/**
 * Totals over the rows: a sum where every row has the value, otherwise the sum of the known ones
 * marked partial, or null when none has it. Rates are worked out from the totals, never averaged.
 * Results of different types (purchases and leads, say) are never added together.
 */
export function adResultTotals(rows) {
  const totals = {};
  const partial = [];
  for (const field of AD_RESULT_METRICS) {
    const known = rows.map(row => row[field]).filter(value => value !== null);
    totals[field] = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    if (known.length && known.length < rows.length) partial.push(field);
  }
  const resultTypes = [...new Set(rows.filter(row => row.results !== null).map(row => row.resultType || 'unnamed'))];
  if (resultTypes.length > 1) {
    totals.results = null;
    partial.push('results');
  }
  if (totals.spend !== null) totals.spend = round(totals.spend, 2);
  const rates = {
    ctr: ratio(totals.clicks, totals.impressions),
    cpc: ratio(totals.spend, totals.clicks),
    cpm: (() => { const value = ratio(totals.spend, totals.impressions); return value === null ? null : value * 1000; })(),
    costPerResult: ratio(totals.spend, totals.results),
  };
  // A rate built on a partial total would mislead, so it stays unknown.
  if (partial.includes('clicks') || partial.includes('impressions')) rates.ctr = null;
  if (partial.includes('spend') || partial.includes('clicks')) rates.cpc = null;
  if (partial.includes('spend') || partial.includes('impressions')) rates.cpm = null;
  if (partial.includes('spend') || partial.includes('results')) rates.costPerResult = null;
  for (const key of Object.keys(rates)) if (rates[key] !== null) rates[key] = round(rates[key], key === 'ctr' ? 6 : 4);
  return { totals, rates, partial: [...new Set(partial)], resultTypes };
}

function writeAtomic(file, body) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, body);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function brandEntry(root, slug) {
  const entry = runtime.listBrands({ root }).find(item => item.slug === slug);
  if (!entry) throw new Error('This job\'s brand could not be found.');
  return entry;
}

/**
 * Save one ad account's results for one date range into the job. The account must be the one
 * chosen for the job's brand, so results from another business never land in this job.
 */
export function saveAdResults({ root, brand, jobId, provider, accountId, dateStart, dateEnd, currency, level = 'ad', rows, sourceTool = null, now = new Date() }) {
  if (!AD_PROVIDERS.includes(provider)) throw new Error(`Use one of ${AD_PROVIDERS.join(', ')}.`);
  if (!AD_RESULT_LEVELS.includes(level)) throw new Error(`level must be one of ${AD_RESULT_LEVELS.join(', ')}.`);
  const job = runtime.resolveJobDir({ root, brand, jobId });
  const chosen = readBrandAdAccount(brandEntry(job.root, job.brand).path, provider);
  if (!chosen) throw new Error(`This brand has no ${PROVIDER_WORDS[provider]} ad account chosen yet. Check the connection first so one is chosen.`);
  const account = text(accountId, 80);
  if (!account || account !== chosen.id) throw new Error(`These results are from a different ${PROVIDER_WORDS[provider]} ad account than the one chosen for this brand (${chosen.name || chosen.id}).`);
  const start = validDate(dateStart, 'dateStart');
  const end = validDate(dateEnd, 'dateEnd');
  if (start > end) throw new Error('dateStart comes after dateEnd.');
  const money = String(currency ?? chosen.currency ?? '').trim().toUpperCase();
  if (!CURRENCY.test(money)) throw new Error('Give the account currency as a three-letter code such as USD.');
  if (chosen.currency && chosen.currency.toUpperCase() !== money) throw new Error(`The account is in ${chosen.currency}, not ${money}. Amounts in two currencies are never mixed.`);
  const clean = normalizeAdResultRows(rows, level);
  const summary = adResultTotals(clean);
  const record = {
    version: AD_RESULTS_VERSION,
    provider,
    account: { id: chosen.id, name: chosen.name || null },
    currency: money,
    level,
    dateStart: start,
    dateEnd: end,
    readAt: now.toISOString(),
    sourceTool: text(sourceTool, 80),
    rows: clean,
    ...summary,
  };
  const folder = join(job.dir, ...AD_RESULTS_DIR.split('/'));
  mkdirSync(folder, { recursive: true });
  const name = `${provider}-${start}_${end}.json`;
  const body = `${JSON.stringify(record, null, 2)}\n`;
  writeAtomic(join(folder, name), body);
  const summaryText = writeAdResultsSummary(job.dir);
  // The ads matched to a draft of this job go into the brand library too, so the lines they used can be ranked by how they did.
  const library = recordAdResultsQuietly({ root: job.root, brand: job.brand, jobId: job.jobId, record, now });
  return {
    ok: true,
    ...(library?.recorded ? { library: { recorded: library.recorded, winners: library.promoted.map(item => item.item.text) } } : {}),
    file: `${AD_RESULTS_DIR}/${name}`,
    summaryFile: AD_RESULTS_SUMMARY,
    sha256: createHash('sha256').update(body).digest('hex'),
    rows: clean.length,
    unmatched: clean.filter(row => !row.variant).map(row => row.name || row.id).slice(0, 20),
    ...summary,
    summaryLines: summaryText.split('\n').length,
  };
}

/** Every saved results file in the job, newest range first; an unreadable file is skipped. */
export function readAdResults(dir) {
  let names = [];
  try { names = readdirSync(join(dir, ...AD_RESULTS_DIR.split('/'))).filter(name => name.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(join(dir, ...AD_RESULTS_DIR.split('/'), name), 'utf8'));
      if (plain(record) && AD_PROVIDERS.includes(record.provider) && Array.isArray(record.rows)) out.push({ file: `${AD_RESULTS_DIR}/${name}`, ...record });
    } catch { /* skipped */ }
  }
  return out.sort((a, b) => String(b.dateEnd).localeCompare(String(a.dateEnd)) || String(a.provider).localeCompare(String(b.provider)));
}

function money(value, currency) {
  if (value === null || value === undefined) return 'unknown';
  return `${value.toFixed(2)} ${currency}`;
}

function whole(value) {
  return value === null || value === undefined ? 'unknown' : Math.round(value).toLocaleString('en-US');
}

function percent(value) {
  return value === null || value === undefined ? 'unknown' : `${(value * 100).toFixed(2)}%`;
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '-';
}

/** Rewrite the job's results summary from every saved file. Returns the text written. */
export function writeAdResultsSummary(dir) {
  const records = readAdResults(dir);
  const lines = ['# Ad results', ''];
  lines.push('Read from your ad accounts, read-only. Totals and rates are worked out by Social Campaign from these numbers; "unknown" means the ad account did not report it.');
  for (const record of records) {
    const { totals, rates, currency } = record;
    lines.push('', `## ${PROVIDER_WORDS[record.provider]}: ${cell(record.account?.name || record.account?.id)}, ${record.dateStart} to ${record.dateEnd}`, '');
    const resultWord = record.resultTypes?.length === 1 ? record.resultTypes[0] : 'results';
    lines.push(`- Spend: ${money(totals.spend, currency)}`);
    lines.push(`- Impressions: ${whole(totals.impressions)}${totals.reach !== null ? `, reach ${whole(totals.reach)}` : ''}`);
    lines.push(`- Clicks: ${whole(totals.clicks)} (click rate ${percent(rates.ctr)}, ${money(rates.cpc, currency)} per click)`);
    lines.push(`- ${resultWord === 'unnamed' ? 'Results' : cell(resultWord)}: ${whole(totals.results)} (${money(rates.costPerResult, currency)} each)`);
    if (record.partial?.length) lines.push(`- Some ${LEVEL_WORDS[record.level]}s did not report ${record.partial.join(', ')}, so those totals cover only the ones that did.`);
    lines.push('', `| ${LEVEL_WORDS[record.level][0].toUpperCase()}${LEVEL_WORDS[record.level].slice(1)} | Variant | Spend | Impressions | Clicks | Results |`, '|---|---|---|---|---|---|');
    for (const row of record.rows) {
      lines.push(`| ${cell(row.name || row.id)} | ${cell(row.variant)} | ${money(row.spend, currency)} | ${whole(row.impressions)} | ${whole(row.clicks)} | ${whole(row.results)} |`);
    }
  }
  if (!records.length) lines.push('', 'No ad results have been read for this job yet.');
  const body = `${lines.join('\n')}\n`;
  const file = join(dir, ...AD_RESULTS_SUMMARY.split('/'));
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeAtomic(file, body);
  return body;
}
