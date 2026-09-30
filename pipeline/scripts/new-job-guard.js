#!/usr/bin/env node
// Refuse a new job only when the brand has reached its active-production limit. Completed
// delivery feedback is optional and is reported as a follow-up rather than a blocker.
//
//   node new-job-guard.js <brand> [--kind <kind>] [--root <dir>]
//
// Exit 0 go ahead - 1 do not start, with the reason - 2 usage - 3 no such brand
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const handoff = require('./lib-handoff-validation.js');
const kinds = require('./lib-kinds.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const kindAt = argv.indexOf('--kind');
const kindValue = kindAt >= 0 ? argv[kindAt + 1] : '';
const kind = String(kindValue || '');
const brand = ws.positionals(kindAt >= 0 ? argv.filter((_, i) => i !== kindAt && i !== kindAt + 1) : argv)[0];
if (!brand || kindValue === undefined || kind.startsWith('--')) {
  console.error('usage: new-job-guard.js <brand> [--kind <kind>] [--root <dir>]');
  process.exit(2);
}
const brandNeeded = kinds.brandRequired(kind);
const countsTowardLimit = kinds.makesContent(kind);

if (brand === kinds.NO_BRAND && brandNeeded) {
  console.error('A post or campaign needs a brand. Choose one, or onboard a new one.');
  process.exit(1);
}

// The two numbers live in CONFIG.md, so changing the policy is an edit and not a code change.
function setting(key, dflt) {
  try {
    const m = fs.readFileSync(path.join(ROOT, 'CONFIG.md'), 'utf8').match(new RegExp('^' + key + ':[ \t]*([0-9]+)', 'm'));
    if (m) return Number(m[1]);
  } catch { /* the default stands */ }
  return dflt;
}
const maxOpen = setting('max_open_jobs_per_brand', 5);
const graceHours = setting('rating_grace_hours', 72);

if (brand !== kinds.NO_BRAND && !fs.existsSync(path.join(ws.wsDir(brand, argv), 'workspace.json'))) {
  console.error('There is no brand called "' + brand + '" on disk. Onboard it first.');
  process.exit(3);
}
if (brandNeeded && !require('./lib-brand-profile.js').read(ws.wsDir(brand, argv))) {
  console.error('Complete brand onboarding before starting a job. Website, Facebook, Instagram, and TikTok each need a URL or Not available.');
  process.exit(1);
}
if (!countsTowardLimit) {
  console.log('Go ahead.');
  process.exit(0);
}

// Terminal states are the ones the table says a job cannot leave.
const TERMINAL = new Set(states.STATES.filter(s => !(s.next || []).length).map(s => s.id));
const field = (txt, name) => {
  const m = txt.match(new RegExp('[*][*]' + name + ':[*][*][ \t]*`?([^`\n]*)`?'));
  return m ? m[1].trim() : '';
};
// "2026-09-01 10:00 +08:00" is not a Date the parser accepts; the file's own mtime is the
// fallback, which is close enough for a grace period measured in days.
function stampToDate(stamp, file) {
  const iso = String(stamp).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2').replace(/\s+([+-]\d{2}:?\d{2}|Z)$/, '$1');
  const d = new Date(iso);
  if (!isNaN(d)) return d;
  try { return fs.statSync(file).mtime; } catch { return new Date(); }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isRetiredReviewJob(dir) {
  const job = readJson(path.join(dir, 'job.json')) || {};
  const route = readJson(path.join(dir, 'route.json')) || {};
  const kind = String(job.kind || '').toLowerCase().replace(/-/g, '_');
  const workflow = String(route.workflowId || '').toLowerCase();
  return kind === 'performance_review' || kind === 'performance_report' ||
    workflow === 'performance-review' || workflow === 'performance_review';
}

const open = [], unrated = [];
for (const jobId of ws.listJobs(brand, argv)) {
  const statusPath = path.join(ws.jobDir(brand, jobId, argv), 'status.md');
  let txt = '';
  try { txt = fs.readFileSync(statusPath, 'utf8'); } catch { continue; }
  const state = field(txt, 'Current state');
  const dir = ws.jobDir(brand, jobId, argv);
  const retiredReview = isRetiredReviewJob(dir);
  const report = !retiredReview && !kinds.makesContent((readJson(path.join(dir, 'job.json')) || {}).kind);
  const delivered = !retiredReview && !report && handoff.isVerifiedDelivered(dir, { brand, jobId, state });
  // Historical review jobs and production jobs with a verified delivery no longer consume an
  // active production slot. A promising filename in handoff/ is deliberately not evidence.
  if (!TERMINAL.has(state) && !retiredReview && !report && !delivered) open.push({ jobId, state });
  if (!retiredReview && ['HANDED_OFF', 'METRICS_PENDING'].includes(state)
      && !fs.existsSync(path.join(ws.jobDir(brand, jobId, argv), 'approvals', 'rating.json'))) {
    const hours = (Date.now() - stampToDate(field(txt, 'Last updated'), statusPath).getTime()) / 3600000;
    if (hours > graceHours) unrated.push({ jobId, hours: Math.round(hours) });
  }
}

if (open.length >= maxOpen) {
  console.error('Not starting a new job yet. ' + brand + ' already has ' + open.length
    + ' jobs on the go and the limit is ' + maxOpen + '.');
  console.error('Open now: ' + open.map(o => o.jobId).join(', ') + '.');
  console.error('Finish or cancel one, then start the next.');
  process.exit(1);
}

const followup = unrated.length
  ? ' ' + unrated.length + ' completed job' + (unrated.length === 1 ? ' is' : 's are') + ' awaiting optional feedback.'
  : ' Nothing waiting on feedback.';
console.log('Go ahead. ' + brand + ' has ' + open.length + ' of ' + maxOpen + ' jobs open.' + followup);
