#!/usr/bin/env node
// Record that the PERSON changed what this job delivers. The only way a run may stop making
// the thing the job was routed for.
//
//   node change-deliverable.js <brand> <job-id> <D> <new-discipline> --by "Bob" --answer "their words"
//
// A run that cannot make the planned thing does not rewrite the plan. It says so, asks, and
// waits: docs/SHARED-RULES.md, "The deliverable kind is not the run's to change". This script
// is what a yes looks like on disk, and every check that compares the draft against the plan
// reads the result, so the record says the person changed it and not the pipeline.
//
// Exit 0 recorded · 1 refused · 2 usage
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const { brand, jobId: job, dir, rest } = ws.resolveJobArgs(argv, argv);
const [D, discipline] = rest;
const by = opt('--by');
const answer = opt('--answer');

if (!brand || !job || !D || !discipline) {
  console.error('usage: change-deliverable.js <brand> <job-id> <D> <new-discipline> --by "who" --answer "their words"');
  console.error('disciplines: ' + del.disciplines().join(', '));
  process.exit(2);
}
if (!by || !answer) {
  console.error('REFUSED: a change of deliverable needs the person who decided it and what they said.');
  console.error('Pass --by and --answer with their own words. Without those this is the pipeline changing the plan.');
  process.exit(2);
}
if (!del.disciplines().includes(discipline)) {
  console.error('REFUSED: "' + discipline + '" is not one of ' + del.disciplines().join(', ') + '.');
  process.exit(2);
}

const availability = execution.checkJobDirectory(dir, { requireJob: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}

const jobPath = path.join(dir || '', 'job.json');
let spec;
try { spec = JSON.parse(fs.readFileSync(jobPath, 'utf8')); }
catch {
  console.error('REFUSED: there is no job here to change.');
  process.exit(1);
}
const entry = (spec.deliverables || []).find(x => x && x.id === D);
if (!entry) {
  console.error('REFUSED: this job has no deliverable called ' + D + '.');
  process.exit(1);
}
const from = entry.creativeDiscipline;
if (from === discipline) {
  console.log('Nothing to change: this deliverable is already ' + del.words(del.KIND_OF_DISCIPLINE[discipline]) + '.');
  process.exit(0);
}

const fromKind = del.KIND_OF_DISCIPLINE[from] || null;
const toKind = del.KIND_OF_DISCIPLINE[discipline];
entry.creativeDiscipline = discipline;
// ugcSource only means anything on a UGC deliverable, and a stale one reads as a plan that is
// still standing. route-job.js rule 1 requires it when the discipline is ugc.
if (discipline !== 'ugc') delete entry.ugcSource;
if (toKind !== 'video') entry.durationSeconds = null;

spec.deliverableChanges = Array.isArray(spec.deliverableChanges) ? spec.deliverableChanges : [];
spec.deliverableChanges.push({
  deliverable: D,
  from, to: discipline,
  fromKind, toKind,
  decidedBy: by,
  decidedAt: ws.now(brand, argv),
  theirWords: answer,
});
fs.writeFileSync(jobPath, JSON.stringify(spec, null, 2) + '\n');

console.log(by + ' changed this deliverable from ' + del.words(fromKind) + ' to ' + del.words(toKind) + '.');
console.log('In their words: ' + answer);
console.log('');
console.log('The plan now says ' + del.words(toKind) + ', so the checks will pass on it.');
console.log('Say the change out loud in the chat and in the next thing you show them, so nobody');
console.log('reads the final post and wonders where the video went.');
