#!/usr/bin/env node
// The brand's scorecard: how each idea part has done against the brand's usual result, from settled results only.
//
//   node attribute-results.js <brand> [--write] [--json]
//       reads every job's metrics/*.json, keeps settled results, and works out per part value (hook_family.H-PROOF,
//       format_id.F-DESK, ...) the average lift on its stage's main metric against the brand's median for that
//       stage. --write saves brand/scorecard.json, which rank-concepts.js reads for its Evidence column.
//   node attribute-results.js <brand> --accept <results-job-id>
//       after the person approved that job's findings, saves the lessons under "## Lessons" in its report to
//       brand/learnings.json (the ids the next brief lists in learnings_used) and refreshes the scorecard.
//
// Each ad or post counts once (its latest settled window). Confidence comes from the count: low under 3, medium up
// to 10, high above. Evidence from organic posts alone stays low (paid tests change one part; organic posts don't).
// A brand rule the person has set always beats a score; the scorecard only informs the ranking.
// Exit 0 ok · 1 refused · 2 usage
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const results = require('./lib-results.js');
const { PART_FIELDS } = require('./lib-ad-variants.js');

const SCORED_FIELDS = PART_FIELDS.filter(f => f !== 'anchor');

function confidenceFor(count, paidCount) {
  if (count < 3 || paidCount === 0) return 'low';
  return count <= 10 ? 'medium' : 'high';
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// observations: metric files with { jobId (the job that ran it), deliverableId, settlement, objectType, metrics, ... }.
// partsFor(jobId) -> Map deliverable -> parts.
function score(observations, partsFor) {
  const latest = new Map();
  for (const o of observations) {
    if (o.settlement !== 'settled') continue;
    const key = o.jobId + '/' + o.deliverableId;
    const prev = latest.get(key);
    if (!prev || String(o.windowEnd) > String(prev.windowEnd) || (o.windowEnd === prev.windowEnd && String(o.windowStart) < String(prev.windowStart))) latest.set(key, o);
  }
  const pieces = [];
  const skipped = [];
  for (const [key, o] of latest) {
    const parts = partsFor(o.jobId).get(o.deliverableId) || {};
    const kind = o.objectType === 'post' ? 'post' : 'ad';
    const main = results.MAIN_METRIC[parts.awareness_stage];
    if (!main) { skipped.push({ piece: key, reason: 'no awareness stage' }); continue; }
    const metric = main[kind];
    const value = typeof o.metrics[metric] === 'number' ? o.metrics[metric] : null;
    const sample = kind === 'post' ? (o.metrics.reach ?? o.metrics.impressions) : o.metrics.impressions;
    if (value === null) { skipped.push({ piece: key, reason: 'no ' + metric }); continue; }
    if (!(sample >= results.MIN_SAMPLE)) { skipped.push({ piece: key, reason: 'fewer than ' + results.MIN_SAMPLE + ' seen' }); continue; }
    pieces.push({ key, kind, stage: parts.awareness_stage, metric, value, parts });
  }
  const groups = new Map();
  for (const p of pieces) {
    const g = p.kind + '|' + p.stage;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const rows = new Map();
  let scored = 0;
  for (const [g, list] of groups) {
    if (list.length < 2) { for (const p of list) skipped.push({ piece: p.key, reason: 'the only ' + p.kind + ' at ' + p.stage + ' so far, nothing to compare with' }); continue; }
    const base = median(list.map(p => p.value));
    if (!base) { for (const p of list) skipped.push({ piece: p.key, reason: 'the usual result for ' + g + ' is zero' }); continue; }
    for (const p of list) {
      scored++;
      const lift = p.value / base - 1;
      for (const field of SCORED_FIELDS) {
        const value = String(p.parts[field] || '').trim();
        if (!value) continue;
        const k = field + '.' + value;
        if (!rows.has(k)) rows.set(k, { key: k, field, value, lifts: [], paidCount: 0, organicCount: 0, stages: new Set() });
        const r = rows.get(k);
        r.lifts.push(lift);
        if (p.kind === 'ad') r.paidCount++; else r.organicCount++;
        r.stages.add(p.stage);
      }
    }
  }
  const out = [...rows.values()].map(r => {
    const count = r.lifts.length;
    const lift = Math.round((r.lifts.reduce((a, b) => a + b, 0) / count) * 10000) / 10000;
    return { key: r.key, field: r.field, value: r.value, count, paidCount: r.paidCount, organicCount: r.organicCount, lift, confidence: confidenceFor(count, r.paidCount), stages: [...r.stages].sort() };
  }).sort((a, b) => a.field.localeCompare(b.field) || b.lift - a.lift);
  return { rows: out, piecesScored: scored, skipped };
}

function partsReader(jobsDir) {
  const cache = new Map();
  return jobId => {
    if (!cache.has(jobId)) {
      const { variants } = results.readVariants(path.join(jobsDir, jobId), jobId);
      cache.set(jobId, new Map(variants.map(v => [v.deliverable, v.parts || {}])));
    }
    return cache.get(jobId);
  };
}

function buildScorecard(brand, argv) {
  const jobsDir = ws.jobsDir(brand, argv);
  const observations = results.readBrandObservations(jobsDir);
  const scored = score(observations, partsReader(jobsDir));
  return {
    schemaVersion: '1.0', brand, updatedAt: new Date().toISOString(),
    note: 'Settled results only. Lift is against the brand\'s median on each stage\'s main metric. A brand rule always beats a score.',
    basedOn: { observations: observations.length, settled: observations.filter(o => o.settlement === 'settled').length, piecesScored: scored.piecesScored, skipped: scored.skipped.length },
    rows: scored.rows,
    skipped: scored.skipped.slice(0, 50),
  };
}

// Lessons are the bullets under "## Lessons" in the approved report: "- L-ab12cd-1: text" or "- text".
function readLessons(reportText, jobId) {
  const at = String(reportText).search(/^##\s+Lessons\b.*$/m);
  if (at < 0) return [];
  const out = [];
  const prefix = 'L-' + crypto.createHash('sha256').update(jobId).digest('hex').slice(0, 6) + '-';
  for (const line of reportText.slice(at).split(/\r?\n/).slice(1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const m = /^\s*[-*]\s+(?:\**(L-[0-9a-f]{6}-\d+)\**:\s*)?(.+)$/.exec(line);
    if (!m || /^none\b/i.test(m[2].trim())) continue;
    out.push({ id: m[1] || prefix + (out.length + 1), text: m[2].trim() });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const brand = ws.positionals(argv)[0];
  const json = argv.includes('--json');
  if (!brand) { console.error('usage: attribute-results.js <brand> [--write] [--json] | <brand> --accept <results-job-id>'); process.exit(2); }
  const brandDir = path.join(ws.wsDir(brand, process.argv), 'brand');
  if (!fs.existsSync(path.dirname(brandDir))) { console.error('REFUSED: no brand called ' + brand); process.exit(1); }
  const acceptAt = argv.indexOf('--accept');
  let accepted = null;
  if (acceptAt >= 0) {
    const jobId = argv[acceptAt + 1];
    if (!jobId) { console.error('usage: attribute-results.js <brand> --accept <results-job-id>'); process.exit(2); }
    const check = spawnSync(process.execPath, [path.join(__dirname, 'check-approval.js'), brand, jobId, 'findings', '--json', ...process.argv.slice(2).filter((a, i, all) => a === '--root' || all[i - 1] === '--root')], { encoding: 'utf8' });
    let res = null;
    try { res = JSON.parse(check.stdout); } catch {}
    if (check.status !== 0 || !res || !res.valid) { console.error('REFUSED: the findings for ' + jobId + ' are not approved, so no lesson is saved' + (res && res.reason ? ' (' + res.reason + ')' : '') + '.'); process.exit(1); }
    let report = '';
    try { report = fs.readFileSync(path.join(ws.jobDir(brand, jobId, process.argv), 'report', 'report.md'), 'utf8'); } catch {}
    const lessons = readLessons(report, jobId);
    const file = path.join(brandDir, 'learnings.json');
    let doc = { schemaVersion: '1.0', lessons: [] };
    try { const read = JSON.parse(fs.readFileSync(file, 'utf8')); if (read && Array.isArray(read.lessons)) doc = read; } catch {}
    const known = new Set(doc.lessons.map(l => l.id));
    const now = new Date().toISOString();
    accepted = lessons.filter(l => !known.has(l.id)).map(l => ({ ...l, fromJob: jobId, approvalId: res.approvalId || null, acceptedAt: now }));
    doc.lessons.push(...accepted);
    fs.mkdirSync(brandDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  const scorecard = buildScorecard(brand, process.argv);
  if (argv.includes('--write') || accepted) {
    fs.mkdirSync(brandDir, { recursive: true });
    fs.writeFileSync(path.join(brandDir, 'scorecard.json'), JSON.stringify(scorecard, null, 2) + '\n');
  }
  if (json) console.log(JSON.stringify({ scorecard, accepted }, null, 2));
  else {
    if (accepted) console.log('ok: saved ' + accepted.length + ' lesson(s) to brand/learnings.json' + (accepted.length ? ': ' + accepted.map(l => l.id).join(', ') : ''));
    console.log('scorecard: ' + scorecard.rows.length + ' part value(s) from ' + scorecard.basedOn.piecesScored + ' settled ad(s) or post(s); ' + scorecard.basedOn.skipped + ' skipped');
    for (const r of scorecard.rows) console.log('- ' + r.key + ': ' + (r.lift >= 0 ? '+' : '') + Math.round(r.lift * 100) + '% (' + r.confidence + ', ' + r.count + ')');
    if (!argv.includes('--write') && !accepted) console.log('(dry run: add --write to save brand/scorecard.json)');
  }
}

module.exports = { score, readLessons, confidenceFor };
if (require.main === module) main();
