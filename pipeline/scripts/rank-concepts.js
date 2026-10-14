#!/usr/bin/env node
// Ranks the concepts in a job's concepts.md by two things the plugin can measure today:
//   fit     - does each concept's visual format suit its awareness stage, does its angle suit the stage,
//             and does it name every idea part (playbooks/visual-formats.md, angles.md)
//   novelty - how often this brand has already shipped the same combination of parts (its earlier post.md files)
//   evidence - how the concept's parts have done for this brand, from three places, combined (see libraryEvidence):
//             brand/scorecard.json (settled results, written by attribute-results.js), library/intelligence/formats-rank.json
//             (the brand's ranked formats and how they performed), and the posted-video results (library/results.jsonl joined to
//             library/jobs/<job>.json) plus library/bank/proven.jsonl items that match the concept. Any one is enough;
//             "no results yet" only when none of them has anything.
// A brand rule the person has set always beats evidence; evidence only informs the pick.
// It writes one `- Ranking:` bullet per concept, which the board's concept card shows like any other field.
// The numbers come from this script, never from the agent. Missing parts are warnings, not failures.
//
//   node rank-concepts.js <brand> <job-id> [--write] [--json]
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const { parseFile } = require('./lib-frontmatter.js');
const parts = require('./lib-idea-parts.js');

const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!dir) { console.error('usage: rank-concepts.js <brand> <job-id> [--write] [--json]'); process.exit(2); }
const file = path.join(dir, 'concepts.md');
if (!fs.existsSync(file)) { console.error('no concepts.md in ' + dir); process.exit(3); }

const cat = parts.catalogue();
const first = (re, text) => { const m = re.exec(String(text || '')); return m ? m[0] : ''; };

// One concept per `## Concept X` heading; its fields are the `- Label: value` bullets under it.
function readConcepts(text) {
  const lines = text.split(/\r?\n/);
  const concepts = [];
  let cur = null;
  lines.forEach((line, i) => {
    const h = /^#{1,6}\s+Concept\s+([A-Za-z0-9]{1,8})\b/.exec(line.trim());
    if (h) { cur = { id: h[1].toUpperCase(), start: i, fields: [] }; concepts.push(cur); return; }
    if (/^#{1,6}\s/.test(line.trim())) { cur = null; return; }
    if (!cur) return;
    const b = /^\s*[-*]\s+\**([^:*]{1,160}?)\**:\s*(.*)$/.exec(line);
    if (b) cur.fields.push({ label: b[1].trim(), value: b[2].trim(), line: i });
  });
  return concepts;
}

function partsOf(concept) {
  const get = re => concept.fields.find(f => re.test(f.label));
  const stageField = get(/^awareness stage/i);
  const stage = stageField ? (parts.STAGES.find(s => new RegExp('\\b' + s + '\\b').test(stageField.value)) || '') : '';
  const angle = first(/\bA-[A-Z0-9-]+\b/, (get(/^angle/i) || {}).value);
  const format = first(/\bF-[A-Z0-9-]+\b/, (get(/^visual format/i) || {}).value);
  const mechanic = first(/\bM-[A-Z0-9-]+\b/, (get(/^attention mechanic/i) || {}).value);
  const hookField = get(/^hook/i);
  const hook = hookField ? first(/\bH-[A-Z]+\b/, hookField.label + ' ' + hookField.value) : '';
  const anchorField = get(/^anchor/i);
  const anchor = anchorField && !/^\{.*\}$/.test(anchorField.value) ? anchorField.value : '';
  return { anchor, stage, angle, format, mechanic, hook };
}

function fitOf(p) {
  let score = 1;
  const notes = [];
  const missing = ['anchor', 'stage', 'angle', 'format', 'mechanic', 'hook'].filter(k => !p[k]);
  if (missing.length) { score -= 0.1 * missing.length; notes.push('missing ' + missing.join(', ')); }
  const pair = parts.pairing(p.stage, p.format);
  if (pair === 'strong') notes.push(p.format + ' suits ' + p.stage);
  else if (pair === 'neutral') { score -= 0.1; notes.push(p.format + ' is neutral for ' + p.stage); }
  else if (pair === 'weak') { score -= 0.3; notes.push(p.format + ' is weak for ' + p.stage); }
  const best = cat.angleStages[p.angle];
  if (p.angle && p.stage && best && best.size && !best.has(p.stage)) { score -= 0.15; notes.push(p.angle + ' is usually for ' + [...best].join(' or ')); }
  return { score: Math.max(0, Math.round(score * 10) / 10), notes };
}

// Earlier shipped posts for this brand, other than this job's own drafts.
function history() {
  const combos = [];
  let jobs = [];
  try { jobs = fs.readdirSync(path.dirname(dir)).filter(j => j.startsWith('job-')); } catch { /* no siblings */ }
  for (const job of jobs) {
    if (job === jobId) continue;
    const drafts = path.join(path.dirname(dir), job, 'drafts');
    let ds = [];
    try { ds = fs.readdirSync(drafts).filter(d => /^D\d+$/.test(d)); } catch { continue; }
    for (const d of ds) {
      const post = path.join(drafts, d, 'post.md');
      if (!fs.existsSync(post)) continue;
      try {
        const { data } = parseFile(post);
        combos.push([data.awareness_stage, data.angle_id, data.format_id, data.hook_family, data.mechanic_id].map(v => String(v || '')).join('|'));
      } catch { /* an unreadable post teaches nothing */ }
    }
  }
  return combos;
}

// The brand's scorecard sits in <brand>/brand/, two folders above the job.
function readScorecard() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(dir)), 'brand', 'scorecard.json'), 'utf8'));
    return s && Array.isArray(s.rows) ? s : null;
  } catch { return null; }
}
const scorecard = readScorecard();
const brandDir = path.dirname(path.dirname(dir));
const libDir = path.join(brandDir, 'library');

// Quiet readers: a missing or broken file is no data, never an error.
function readJsonQuiet(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function readLinesQuiet(f) {
  try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(o => o && typeof o === 'object'); }
  catch { return []; }
}
const median = xs => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const fmtNum = n => n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1e3 ? (Math.round(n / 100) / 10) + 'k' : String(Math.round(n));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Brand library data, read once. Every piece may be absent.
function loadLibrary() {
  const rank = readJsonQuiet(path.join(libDir, 'intelligence', 'formats-rank.json'));
  const formats = rank && Array.isArray(rank.formats) ? rank.formats.filter(f => f && f.id) : [];
  const proven = readLinesQuiet(path.join(libDir, 'bank', 'proven.jsonl'));
  // The last line of an id wins; a removed item is gone.
  const byId = new Map();
  proven.forEach((it, i) => byId.set(it.id || 'line' + i, it));
  const items = [...byId.values()].filter(it => !it.removed);
  // Latest reading of each post (library/results.jsonl), then tied to the idea parts of the job's concept (library/jobs/<job>.json).
  const latest = new Map();
  for (const r of readLinesQuiet(path.join(libDir, 'results.jsonl'))) {
    if (!r.metrics || typeof r.metrics !== 'object') continue;
    latest.set([r.jobId, r.platform, r.paid ? 'paid' : 'organic', r.postUrl || r.adId || '', r.variant || ''].join('|'), r);
  }
  const jobConcept = {};
  const posts = [];
  const medians = {};
  for (const r of latest.values()) if (!r.paid && Number.isFinite(r.metrics.views)) (medians[r.platform] = medians[r.platform] || []).push(r.metrics.views);
  for (const r of latest.values()) {
    if (r.paid || !Number.isFinite(r.metrics.views) || !r.jobId) continue;
    const base = median(medians[r.platform] || []);
    if (!base || (medians[r.platform] || []).length < 2) continue; // nothing to compare with
    if (!(r.jobId in jobConcept)) { const j = readJsonQuiet(path.join(libDir, 'jobs', r.jobId + '.json')); jobConcept[r.jobId] = j && j.concept && typeof j.concept === 'object' ? j.concept : null; }
    if (jobConcept[r.jobId]) posts.push({ concept: jobConcept[r.jobId], ratio: Math.min(4, r.metrics.views / base), views: r.metrics.views });
  }
  return { formats, items, posts, any: !!(formats.length || items.length || posts.length) };
}
const lib = loadLibrary();

// Does a saved value (an id, a name or a sentence) name this id or word?
const mentions = (value, wanted) => !!wanted && typeof value === 'string' && value.toLowerCase().includes(String(wanted).toLowerCase());
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// What the library says about one concept, as signals { word, value, text, lift|null, weight }.
// lift is "better or worse than this brand's usual" as a fraction (+0.3 = 30% better), the same scale as the scorecard.
//   formats-rank row for the concept's Format id: resultScore (1.0 = usual) gives the lift, weight = jobs that used it (uses);
//     a format with no result score yet is shown as seen in N posts (top views) and carries no lift.
//   posted results: views against the median of the brand's posts on that platform, averaged per matching trait
//     (format, angle, subtopic, hook family), weight = posts.
//   proven items (not removed) whose kind/id/text/format/angle/subtopic/hook match: +0.1 each, capped at +0.3, weight 1.
function libraryEvidence(p, libFormat, subtopic) {
  const out = [];
  const fmt = libFormat || p.format;
  const row = lib.formats.find(f => same(f.id, libFormat) || same(f.id, p.format));
  if (row) {
    if (Number.isFinite(row.resultScore)) out.push({ word: 'format', value: row.id, lift: row.resultScore - 1, weight: Math.max(1, row.uses || 1), label: row.label, text: 'format ' + row.id + ' ' + (row.resultScore >= 1 ? '+' : '-') + Math.abs(Math.round((row.resultScore - 1) * 100)) + '%' + (row.label ? ' ' + row.label : '') });
    else out.push({ word: 'format', value: row.id, lift: null, weight: 0, text: 'format ' + row.id + ' in ' + (row.posts || 0) + ' ranked post' + (row.posts === 1 ? '' : 's') + (Number.isFinite(row.topViews) ? ', top ' + fmtNum(row.topViews) + ' views' : '') });
  }
  const traits = [['format', c => same(c.format, fmt) || same(c.format, p.format) ? fmt : '', 'format'], ['angle', c => same(c.angle, p.angle) || same(c.angleId, p.angle) ? p.angle : '', 'angle'], ['subtopic', c => same(c.subtopic, subtopic) ? subtopic : '', 'subtopic'], ['hook', c => same(c.hook_family || c.hookFamily, p.hook) ? p.hook : '', 'hook']];
  for (const [, pick, word] of traits) {
    const hit = lib.posts.map(x => ({ ...x, value: pick(x.concept) })).filter(x => x.value);
    if (!hit.length) continue;
    const mean = hit.reduce((s, x) => s + x.ratio, 0) / hit.length;
    out.push({ word, value: hit[0].value, lift: mean - 1, weight: hit.length, text: word + ' ' + hit[0].value + ' ' + (mean >= 1 ? '+' : '-') + Math.abs(Math.round((mean - 1) * 100)) + '% (' + hit.length + ' post' + (hit.length === 1 ? '' : 's') + ')' });
  }
  const wanted = [fmt, p.format, p.angle, p.hook, subtopic].filter(Boolean);
  const proven = lib.items.filter(it => wanted.some(w => same(it.id, w) || same(it.format || it.formatId, w) || same(it.angle || it.angleId, w) || same(it.subtopic, w) || same(it.hook_family || it.hookFamily, w) || (['format', 'angle', 'subtopic', 'hook'].includes(it.kind) && mentions(it.text, w))));
  if (proven.length) {
    const top = Math.max(...proven.map(it => Number((it.evidence && (it.evidence.views || it.evidence.likes)) || 0)));
    out.push({ word: 'proven', value: String(proven.length), lift: Math.min(0.3, 0.1 * proven.length), weight: 1, text: proven.length + ' proven item' + (proven.length === 1 ? '' : 's') + (top ? ', top ' + fmtNum(top) : '') });
  }
  return out;
}
const CONFIDENCE = { high: 3, medium: 2, low: 1 };

// The parts with a scorecard row, plus what the brand library says, as one weighted lift for the concept.
// The scorecard rows weigh by count, library signals by their weight (jobs or posts); the score is the weighted mean lift.
function evidenceOf(p, libFormat, subtopic) {
  const keys = [['awareness_stage', p.stage, 'stage'], ['angle_id', p.angle, 'angle'], ['format_id', p.format, 'format'], ['hook_family', p.hook, 'hook'], ['mechanic_id', p.mechanic, 'mechanic']];
  const found = [];
  if (scorecard && scorecard.rows.length) {
    for (const [field, value, word] of keys) {
      if (!value) continue;
      const row = scorecard.rows.find(r => r.key === field + '.' + value);
      if (row) found.push({ ...row, word });
    }
  }
  let signals = [];
  try { signals = lib.any ? libraryEvidence(p, libFormat, subtopic) : []; } catch { signals = []; }
  if (!found.length && !signals.length) {
    const hadData = (scorecard && scorecard.rows.length) || lib.any;
    return { text: hadData ? 'no results for these parts yet' : 'no results yet', score: null, lib: [] };
  }
  // Most confident first, then the parts that moved results most, so a part that made no difference is shown last.
  found.sort((a, b) => (CONFIDENCE[b.confidence] || 0) - (CONFIDENCE[a.confidence] || 0) || Math.abs(b.lift) - Math.abs(a.lift) || b.count - a.count);
  const pct = lift => (lift >= 0 ? '+' : '-') + Math.abs(Math.round(lift * 100)) + '%';
  const bits = found.slice(0, 3).map(r => r.word + ' ' + r.value + ' ' + pct(r.lift) + ' (' + r.confidence + ', ' + r.count + ')');
  signals.sort((a, b) => (b.lift === null ? -1 : 0) - (a.lift === null ? -1 : 0) || Math.abs(b.lift || 0) - Math.abs(a.lift || 0));
  for (const s of signals.slice(0, 3)) bits.push(s.text);
  const parts2 = [...found.map(r => ({ lift: r.lift, w: r.count })), ...signals.filter(s => s.lift !== null).map(s => ({ lift: s.lift, w: s.weight }))];
  const weight = parts2.reduce((sum, r) => sum + r.w, 0);
  const score = weight ? Math.round((parts2.reduce((sum, r) => sum + r.lift * r.w, 0) / weight) * 1000) / 1000 : null;
  return { text: bits.join(', '), score, lib: signals };
}

const text = fs.readFileSync(file, 'utf8');
const concepts = readConcepts(text);
if (!concepts.length) { console.error('concepts.md has no "## Concept X" sections'); process.exit(3); }
const past = history();
const results = concepts.map(c => {
  const p = partsOf(c);
  const fit = fitOf(p);
  const fieldOf = re => (c.fields.find(f => re.test(f.label)) || {}).value || '';
  const libFormat = first(/\bF-[A-Z0-9-]+\b/, fieldOf(/^format$/i));
  const subtopic = fieldOf(/^sub-?topic/i).replace(/^\{.*\}$/, '').trim();
  const key = [p.stage, p.angle, p.format, p.hook, p.mechanic].join('|');
  const complete = p.stage && p.angle && p.format && p.hook && p.mechanic;
  const runs = complete ? past.filter(k => k === key).length : null;
  const novelty = runs === null ? 'unknown (parts missing)' : runs === 0 ? 'new combination' : 'run ' + runs + ' time' + (runs === 1 ? '' : 's') + ' before';
  const evidence = evidenceOf(p, libFormat, subtopic);
  // Fit only goes down on library evidence: a format or part that did clearly worse than the brand's usual loses up to 0.3.
  const libLift = evidence.lib.filter(x => x.lift !== null).map(x => x.lift);
  if (libLift.length && Math.min(...libLift) < -0.25) {
    const cut = Math.round(clamp(-Math.min(...libLift) * 0.3, 0.1, 0.3) * 10) / 10;
    fit.score = Math.max(0, Math.round((fit.score - cut) * 10) / 10);
    fit.notes.push('the brand\'s own results ran below its usual');
  }
  const line = 'Fit ' + fit.score.toFixed(1) + (fit.notes.length ? ' (' + fit.notes.join('; ') + ')' : '') + ' · Novelty: ' + novelty + ' · Evidence: ' + evidence.text;
  const warnings = parts.checkParts({ anchor: p.anchor, awareness_stage: p.stage, angle_id: p.angle, format_id: p.format, mechanic_id: p.mechanic });
  return { id: c.id, parts: p, fit: fit.score, novelty: runs, evidence: evidence.score, line, warnings };
});

if (argv.includes('--write')) {
  const lines = text.split(/\r?\n/);
  // Bottom-up so earlier line numbers stay valid.
  for (const c of [...concepts].reverse()) {
    const r = results.find(x => x.id === c.id);
    const bullet = '- Ranking: ' + r.line;
    const existing = c.fields.find(f => /^ranking$/i.test(f.label));
    if (existing) lines[existing.line] = bullet;
    else {
      const last = c.fields.length ? c.fields[c.fields.length - 1].line : c.start;
      lines.splice(last + 1, 0, bullet);
    }
  }
  fs.writeFileSync(file, lines.join('\n'));
}

if (argv.includes('--json')) console.log(JSON.stringify({ brand, jobId, concepts: results }, null, 2));
else {
  for (const r of results) {
    console.log('Concept ' + r.id + ': ' + r.line);
    for (const w of r.warnings) console.log('  warning: ' + w);
  }
  if (!argv.includes('--write')) console.log('(dry run: add --write to put the Ranking lines into concepts.md)');
}
