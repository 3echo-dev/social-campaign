#!/usr/bin/env node
// What is in progress, in words a person can act on.
//   node list-jobs.js [brand] [--json] [--root <dir>]
// Exit 0 jobs listed · 3 nothing set up yet (so a caller can branch)
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const wording = require('./lib-wording.js');
const handoff = require('./lib-handoff-validation.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const only = ws.positionals(argv)[0];

function grab(txt, label) {
  const m = txt.match(new RegExp('\\*\\*' + label + ':\\*\\*\\s*`?([^`\\n]*)`?'));
  return m ? m[1].trim() : '';
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const retiredReview = dir => {
  const job = readJson(path.join(dir, 'job.json')) || {};
  const route = readJson(path.join(dir, 'route.json')) || {};
  const kind = String(job.kind || '').toLowerCase().replace(/-/g, '_');
  const workflow = String(route.workflowId || '').toLowerCase();
  return kind === 'performance_review' || kind === 'performance_report' ||
    workflow === 'performance-review' || workflow === 'performance_review';
};

let brands = ws.listBrands(argv);
if (only) brands = brands.filter(b => b === only);

const rows = [];
for (const b of brands) {
  for (const j of ws.listJobs(b, argv)) {
    const dir = ws.jobDir(b, j, argv);
    const f = path.join(dir, 'status.md');
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const id = grab(txt, 'Current state');
    const isRetiredReview = retiredReview(dir);
    const isDelivered = !isRetiredReview && handoff.isVerifiedDelivered(dir, { brand: b, jobId: j, state: id });
    const historical = isRetiredReview || states.isHistoricalOnly(id) || isDelivered;
    const workflowId = (readJson(path.join(dir, 'route.json')) || {}).workflowId;
    rows.push({
      brand: b, job: j, state: id, label: states.label(id), sentence: isRetiredReview ? wording.historical() : wording.sentence(id, workflowId),
      isGate: states.isGate(id) && !historical, historical, retiredReview: isRetiredReview, delivered: isDelivered,
      updated: grab(txt, 'Last updated'),
      next: grab(txt, 'Next action'),
      blocked: grab(txt, 'Blocked on'),
    });
  }
}
rows.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

if (json) {
  console.log(JSON.stringify({ root: ws.rootWithSource().path, brands, jobs: rows }, null, 2));
  process.exit(0);
}

if (!brands.length) {
  console.log('No brands set up yet.');
  process.exit(0);
}
if (!rows.length) {
  console.log('Brands: ' + brands.join(', ') + '. No jobs started yet.');
  process.exit(0);
}

// A job waiting on the person comes first, because that is why they are looking.
const history = rows.filter(r => r.historical);
const waiting = rows.filter(r => r.isGate && !r.historical);
const running = rows.filter(r => !r.isGate && !r.historical);
const width = Math.max(...rows.map(r => r.job.length));
// The sentence, never the id: this list is the first thing a person reads.
const line = r => '  ' + r.job.padEnd(width) + '  ' + r.sentence;
if (waiting.length) { console.log('Waiting on you:'); for (const r of waiting) console.log(line(r)); }
if (running.length) { if (waiting.length) console.log(''); console.log('In progress:'); for (const r of running) console.log(line(r)); }
if (history.length) {
  if (waiting.length || running.length) console.log('');
  console.log('History:');
  for (const r of history) console.log(line(r));
}
