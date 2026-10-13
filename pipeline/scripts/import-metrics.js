#!/usr/bin/env node
// Reads an earlier job's results back in, matches them to its ads or posts, and writes what the findings use.
// Run inside a results_review job, whose job.json names the earlier job in sourceJobId.
//
//   node import-metrics.js <brand> <job-id> [--json]
//       ad results the Director already saved with the connector (results/ad-results/ in the earlier job)
//   ... --csv <file> --provider meta_ads|tiktok_ads --currency USD --date-start YYYY-MM-DD --date-end YYYY-MM-DD
//       an Ads Manager CSV export, when no connector is connected; saved to results/ad-results-csv/ in the earlier job
//   ... --metricool <rows.json>
//       organic post numbers the Director read with Metricool, one row per post
//
// Writes, in this job: metrics/*.json (schemas/metrics.schema.json), results/summary.json (each ad or post with
// its parts, checkpoint, settled or provisional, and its stage's main metric; each test pair's verdict) and
// results/matching.md (how every row was matched, how CSV columns were read, and what could not be matched).
// All maths is here, never in the agent. A number the source did not give stays unknown, never zero.
// Exit 0 ok · 1 refused (bad input, nothing to read) · 2 usage
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const results = require('./lib-results.js');

// CSV header words, lower-cased, for each counted field. The first header that matches wins.
const COLUMNS = {
  id: ['ad id', 'ad_id', 'adid'],
  name: ['ad name', 'ad_name', 'adname'],
  campaignName: ['campaign name', 'campaign_name'],
  adsetName: ['ad set name', 'adset name', 'ad group name', 'adgroup name'],
  spend: ['amount spent', 'spend', 'cost', 'total cost'],
  impressions: ['impressions'],
  reach: ['reach'],
  clicks: ['clicks (all)', 'clicks'],
  linkClicks: ['link clicks', 'clicks (destination)', 'destination clicks'],
  results: ['results', 'conversions'],
  resultType: ['result indicator', 'result type'],
  videoViews: ['3-second video plays', 'video views', '2-second video views'],
  thruplays: ['thruplays', 'video views at 100%', 'video plays at 100%'],
  currency: ['currency'],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

// Which column feeds each field, matched on whole header words ("Amount spent (USD)" -> spend, USD).
function mapColumns(headers) {
  const lower = headers.map(h => h.trim().toLowerCase());
  const map = {};
  const used = new Set();
  for (const [field, words] of Object.entries(COLUMNS)) {
    for (const word of words) {
      const at = lower.findIndex((h, i) => !used.has(i) && (h === word || h.startsWith(word + ' (')));
      if (at >= 0) { map[field] = at; used.add(at); break; }
    }
  }
  let headerCurrency = '';
  if (map.spend !== undefined) {
    const m = /\(([A-Z]{3})\)/.exec(headers[map.spend]);
    if (m) headerCurrency = m[1];
  }
  return { map, headerCurrency };
}

// "1,234", "$12.50", "12.5%" -> number; "", "-", "--" -> unknown.
function csvNumber(value) {
  const v = String(value === undefined ? '' : value).trim();
  if (!v || /^-+$/.test(v)) return null;
  const n = Number(v.replace(/[,\s$€£%]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function refuse(message) {
  console.error('REFUSED: ' + message);
  process.exit(1);
}

function arg(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

// The CSV becomes a record in the connector's shape, checked and totalled by the same code the connector uses.
async function csvRecord({ file, provider, currency, dateStart, dateEnd, now }) {
  if (!['meta_ads', 'tiktok_ads'].includes(provider)) refuse('--provider must be meta_ads or tiktok_ads.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStart || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateEnd || ''))) refuse('--date-start and --date-end must be dates written as YYYY-MM-DD, the range the export covers.');
  if (dateStart > dateEnd) refuse('--date-start comes after --date-end.');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { refuse('could not read the CSV file ' + file); }
  const table = parseCsv(text);
  if (table.length < 2) refuse('the CSV has no rows under its header.');
  const headers = table[0];
  const { map, headerCurrency } = mapColumns(headers);
  if (map.id === undefined && map.name === undefined) refuse('the CSV has no "Ad ID" or "Ad name" column, so its rows cannot be matched to ads. Export at the ad level.');
  const money = String(currency || headerCurrency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(money)) refuse('give the account currency with --currency, a three-letter code such as USD.');
  if (headerCurrency && headerCurrency !== money) refuse('the export is in ' + headerCurrency + ', not ' + money + '. Amounts in two currencies are never mixed.');
  const rows = [];
  const skipped = [];
  for (const [index, cells] of table.slice(1).entries()) {
    const at = field => (map[field] === undefined ? undefined : cells[map[field]]);
    const name = String(at('name') || '').trim();
    const id = String(at('id') || '').trim() || name;
    if (!id || /^(total|totals|results from)/i.test(name || id)) { skipped.push('line ' + (index + 2) + ' (a total or a row with no ad)'); continue; }
    if (map.currency !== undefined && String(at('currency') || '').trim() && String(at('currency')).trim().toUpperCase() !== money) refuse('line ' + (index + 2) + ' is in ' + String(at('currency')).trim() + ', not ' + money + '. Amounts in two currencies are never mixed.');
    const row = { id, name: name || null, campaignName: at('campaignName') || null, adsetName: at('adsetName') || null, resultType: at('resultType') || null };
    for (const field of results.AD_COUNTS) {
      const n = csvNumber(at(field));
      if (Number.isNaN(n)) refuse('line ' + (index + 2) + ': the ' + headers[map[field]] + ' column is not a number (' + at(field) + ').');
      row[field] = n;
    }
    rows.push(row);
  }
  process.removeAllListeners('warning');
  const ad = await import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'server', 'pipeline', 'ad-results.mjs')).href);
  let clean;
  try { clean = ad.normalizeAdResultRows(rows, 'ad'); } catch (e) { refuse(e.message); }
  const summary = ad.adResultTotals(clean);
  const columns = {};
  for (const [field, i] of Object.entries(map)) columns[field] = headers[i];
  return {
    version: 1, provider, account: { id: null, name: null }, currency: money, level: 'ad', dateStart, dateEnd,
    readAt: now.toISOString(), source: 'csv_export', sourceFile: path.basename(file), columns, skipped, rows: clean, ...summary,
  };
}

function matchingReport({ sourceJobId, variantsFrom, records, csv, adOut, postOut, summary }) {
  const lines = ['# How the results were matched', '', 'Earlier job: `' + sourceJobId + '`. Ads and posts from ' + variantsFrom + '.', ''];
  if (records.length) {
    lines.push('## Ad results read', '', '| File | Source | Dates | Level | Rows |', '|---|---|---|---|---|');
    for (const r of records) lines.push('| ' + r.file + ' | ' + (r.source === 'csv_export' ? 'CSV export' : 'connector') + ' | ' + r.dateStart + ' to ' + r.dateEnd + ' | ' + r.level + ' | ' + r.rows.length + ' |');
    lines.push('');
  }
  if (csv) {
    lines.push('## How the CSV columns were read', '', '| Field | Column |', '|---|---|');
    for (const [field, column] of Object.entries(csv.columns)) lines.push('| ' + field + ' | ' + column + ' |');
    if (csv.skipped.length) lines.push('', 'Skipped: ' + csv.skipped.join(', ') + '.');
    lines.push('');
  }
  const observations = adOut.observations.concat(postOut.observations);
  lines.push('## Matched', '');
  if (!observations.length) lines.push('Nothing was matched.');
  else {
    lines.push('| Ad or post | Ad id | Dates | Checkpoint | Settled? | Matched by |', '|---|---|---|---|---|---|');
    for (const o of observations) lines.push('| ' + o.deliverableId + ' | ' + o.raw.variantId + ' | ' + o.windowStart + ' to ' + o.windowEnd + ' | ' + o.checkpoint + ' | ' + o.settlement + (o.settlement === 'provisional' ? ' (settles ' + o.settlesAt + ')' : '') + ' | ' + (o.raw.matchedBy || o.source) + ' |');
  }
  const unmatched = adOut.unmatched.concat(postOut.unmatched);
  if (unmatched.length) {
    lines.push('', '## Not matched', '', 'These rows were left out. Nothing is guessed.', '', '| Row | Why |', '|---|---|');
    for (const u of unmatched.slice(0, 100)) lines.push('| ' + String(u.row).replace(/\|/g, '/') + ' | ' + u.reason + ' |');
  }
  const missing = summary.pieces.filter(p => !p.metrics).map(p => p.deliverable);
  if (missing.length) lines.push('', 'No results yet for: ' + missing.join(', ') + '.');
  return lines.join('\n') + '\n';
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
  if (!brand || !jobId || !dir) { console.error('usage: import-metrics.js <brand> <job-id> [--csv <file> --provider meta_ads|tiktok_ads --currency USD --date-start YYYY-MM-DD --date-end YYYY-MM-DD] [--metricool <rows.json>] [--json]'); process.exit(2); }
  let job = {};
  try { job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch { refuse('job.json is missing or unreadable.'); }
  const sourceJobId = String(job.sourceJobId || '').trim();
  if (!sourceJobId || !/^job-[a-z0-9-]+$/.test(sourceJobId)) refuse('job.json has no sourceJobId naming the earlier job whose results are read.');
  const sourceDir = path.join(path.dirname(dir), sourceJobId);
  if (!fs.existsSync(path.join(sourceDir, 'job.json'))) refuse('the earlier job ' + sourceJobId + ' is not in this brand\'s jobs.');
  const now = new Date();

  let csv = null;
  const csvFile = arg(argv, '--csv');
  if (csvFile) {
    csv = await csvRecord({ file: path.resolve(dir, csvFile), provider: arg(argv, '--provider'), currency: arg(argv, '--currency'), dateStart: arg(argv, '--date-start'), dateEnd: arg(argv, '--date-end'), now });
    const folder = path.join(sourceDir, 'results', 'ad-results-csv');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, csv.provider + '-' + csv.dateStart + '_' + csv.dateEnd + '.json'), JSON.stringify(csv, null, 2) + '\n');
  }
  let metricoolRows = null;
  const metricoolFile = arg(argv, '--metricool');
  if (metricoolFile) {
    try { metricoolRows = JSON.parse(fs.readFileSync(path.resolve(dir, metricoolFile), 'utf8')); } catch { refuse('could not read the Metricool rows in ' + metricoolFile + ' as JSON.'); }
    if (!Array.isArray(metricoolRows)) refuse('the Metricool rows must be a JSON list, one row per post.');
  }

  const { variants, pairs, from } = results.readVariants(sourceDir, sourceJobId);
  if (!variants.length) refuse('the earlier job has no ads or posts to match results to.');
  const records = results.readAdRecords(sourceDir);
  if (!records.length && !metricoolRows) refuse('there are no results to read yet. Read them with the Meta Ads or TikTok for Business connector, pass a CSV export with --csv, or pass Metricool rows with --metricool.');
  const adOut = results.adObservations({ brand, sourceJobId, records, variants });
  const postOut = metricoolRows ? results.postObservations({ brand, sourceJobId, sourceDir, rows: metricoolRows, readAt: now.toISOString(), variants }) : { observations: [], unmatched: [] };
  const observations = adOut.observations.concat(postOut.observations);
  const written = results.writeObservations(dir, observations);
  // The numbers also go into the brand's library (library/results.jsonl), tied to the lines the earlier job used, so winners rank first
  // in the bank. The Metricool posts and the CSV ads are filed here; the connector's ads were filed when they were saved. This never
  // stops a review: the library is a bonus, not part of the findings.
  try {
    process.removeAllListeners('warning');
    const library = await import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'server', 'pipeline', 'brand-results.mjs')).href);
    library.recordObservationsQuietly({ root: path.resolve(dir, '..', '..', '..', '..'), brand, observations });
  } catch { /* nothing to file */ }
  const summary = results.summarize({ sourceJobId, variants, pairs, observations });
  fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'results', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'results', 'matching.md'), matchingReport({ sourceJobId, variantsFrom: from, records, csv, adOut, postOut, summary }));

  const unmatched = adOut.unmatched.length + postOut.unmatched.length;
  if (json) console.log(JSON.stringify({ ok: true, metrics: written, unmatched, summary }, null, 2));
  else {
    console.log('ok: ' + observations.length + ' result(s) matched, ' + unmatched + ' not matched; wrote ' + written.length + ' metrics file(s), results/summary.json and results/matching.md');
    for (const p of summary.pairs) console.log('- ' + p.pair + ': ' + p.verdict);
  }
}

module.exports = { parseCsv, mapColumns, csvNumber };
if (require.main === module) main().catch(e => { console.error('REFUSED: ' + e.message); process.exit(1); });
