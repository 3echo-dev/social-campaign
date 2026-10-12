#!/usr/bin/env node
// Ranks the concepts in a job's concepts.md by two things the plugin can measure today:
//   fit     - does each concept's visual format suit its awareness stage, does its angle suit the stage,
//             and does it name every idea part (playbooks/visual-formats.md, angles.md)
//   novelty - how often this brand has already shipped the same combination of parts (its earlier post.md files)
//   evidence - how the concept's parts have done in this brand's settled results (brand/scorecard.json, written by
//             attribute-results.js); "no results yet" until there is one
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
const CONFIDENCE = { high: 3, medium: 2, low: 1 };

// The parts with a scorecard row and one count-weighted lift for the concept.
function evidenceOf(p) {
  if (!scorecard || !scorecard.rows.length) return { text: 'no results yet', score: null };
  const keys = [['awareness_stage', p.stage, 'stage'], ['angle_id', p.angle, 'angle'], ['format_id', p.format, 'format'], ['hook_family', p.hook, 'hook'], ['mechanic_id', p.mechanic, 'mechanic']];
  const found = [];
  for (const [field, value, word] of keys) {
    if (!value) continue;
    const row = scorecard.rows.find(r => r.key === field + '.' + value);
    if (row) found.push({ ...row, word });
  }
  if (!found.length) return { text: 'no results for these parts yet', score: null };
  // Most confident first, then the parts that moved results most, so a part that made no difference is shown last.
  found.sort((a, b) => (CONFIDENCE[b.confidence] || 0) - (CONFIDENCE[a.confidence] || 0) || Math.abs(b.lift) - Math.abs(a.lift) || b.count - a.count);
  const pct = lift => (lift >= 0 ? '+' : '-') + Math.abs(Math.round(lift * 100)) + '%';
  const text = found.slice(0, 3).map(r => r.word + ' ' + r.value + ' ' + pct(r.lift) + ' (' + r.confidence + ', ' + r.count + ')').join(', ');
  const weight = found.reduce((sum, r) => sum + r.count, 0);
  const score = weight ? Math.round((found.reduce((sum, r) => sum + r.lift * r.count, 0) / weight) * 1000) / 1000 : null;
  return { text, score };
}

const text = fs.readFileSync(file, 'utf8');
const concepts = readConcepts(text);
if (!concepts.length) { console.error('concepts.md has no "## Concept X" sections'); process.exit(3); }
const past = history();
const results = concepts.map(c => {
  const p = partsOf(c);
  const fit = fitOf(p);
  const key = [p.stage, p.angle, p.format, p.hook, p.mechanic].join('|');
  const complete = p.stage && p.angle && p.format && p.hook && p.mechanic;
  const runs = complete ? past.filter(k => k === key).length : null;
  const novelty = runs === null ? 'unknown (parts missing)' : runs === 0 ? 'new combination' : 'run ' + runs + ' time' + (runs === 1 ? '' : 's') + ' before';
  const evidence = evidenceOf(p);
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
