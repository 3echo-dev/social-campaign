#!/usr/bin/env node
// Turn what is already on disk into one event per line, so a run can be measured without
// anything watching it while it happens. The job folder is the source; nothing is invented
// here and nothing is deleted from there.
//
//   node export-events.js <brand> <job-id> [--root <dir>]
//
// Writes events.jsonl in the job folder, each line an envelope validated against
// schemas/event.schema.json:
//   { eventId, eventName, schemaVersion, occurredAt, job, subject: { type, id }, attrs }
//
// eventId is sha256 of "job|eventName|occurredAt|type:id", so exporting twice produces the
// same ids and the server's idempotency does the rest. The recipe lives in lib-events.js,
// which the tokens hook shares.
//
// This script owns six event names and rewrites the file every time. It does not own
// tokens.observed, which scripts/hooks/tokens.js appends while a run is happening, so lines
// carrying an event name from outside OWNED are read back and kept rather than split into a
// second file. One events.jsonl stays the whole log, and push-events.js needs no change.
//
// Metadata only. No prompt text, no artifact bodies, no comment longer than 500 characters.
//
// Exit 0 written - 1 an event failed the schema - 2 usage - 3 no such job
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const ev = require('./lib-events.js');
const durable = require('./lib-durable.js');
const { validate } = require('./validate-schema.js');

const ROOT = path.join(__dirname, '..');
const OWNED = new Set(['job.routed', 'state.transitioned', 'gate.decided', 'job.rated',
  'revision.opened', 'credits.tallied']);
const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId) { console.error('usage: export-events.js <brand> <job-id> [--root <dir>]'); process.exit(2); }

const statusPath = path.join(dir, 'status.md');
if (!fs.existsSync(statusPath)) {
  console.error('No job at ' + ws.fwd(dir) + '. Check the brand and job id.');
  process.exit(3);
}

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const jobSpec = readJson(path.join(dir, 'job.json')) || {};
const status = fs.readFileSync(statusPath, 'utf8');
let workspaceConfig = {};
try { workspaceConfig = JSON.parse(fs.readFileSync(path.join(ws.root(argv), 'workspaces', brand, 'workspace.json'), 'utf8')); } catch {}
const workspaceOwner = workspaceConfig.owner && typeof workspaceConfig.owner === 'object' ? workspaceConfig.owner : {};
const envelopeOptions = {
  workspaceId: String(jobSpec.workspaceId || workspaceConfig.workspaceId || workspaceConfig.id || brand),
  brandId: jobSpec.brandId || workspaceConfig.brandId || brand, jobId, source: 'disk_export', host: 'local', quality: 'measured',
  ownerUserId: jobSpec.ownerUserId || workspaceConfig.ownerUserId || workspaceOwner.userId || null,
  ownerEmail: jobSpec.ownerEmailVerified === true
    ? jobSpec.ownerEmail || null
    : (workspaceConfig.ownerEmailVerified === true ? workspaceConfig.ownerEmail || null : null),
  ownerEmailVerified: jobSpec.ownerEmailVerified === true || workspaceConfig.ownerEmailVerified === true,
};
const observedAt = ((status.match(/\*\*Last updated:\*\*\s*`?([^`\n]*)`?/) || [])[1] || '').trim();
const events = [];
const clip = ev.clip;
function add(eventName, occurredAt, subject, attrs, salt) {
  if (!occurredAt) return;                       // an undated row cannot be placed on a timeline
  events.push(ev.makeEvent(jobId, eventName, occurredAt, subject, attrs, {
    ...envelopeOptions,
    salt,
    // Exporting the same immutable source rows twice must be byte-for-byte stable.
    observedAt: observedAt || occurredAt,
  }));
}

// The route: which workflow this job is running and what it has to pass through.
const route = readJson(path.join(dir, 'route.json'));
if (route) {
  add('job.routed', route.createdAt, { type: 'job', id: jobId }, {
    workflowId: route.workflowId,
    disciplines: route.requiredDisciplines || [],
    gates: route.gates || [],
  });
}

// Every stage-log row in status.md. The table is append-only, so it is the run's history.
const logRe = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/;
const unquote = s => String(s).replace(/`/g, '').trim();
for (const line of status.split(/\r?\n/)) {
  const m = line.match(logRe);
  if (!m) continue;
  const [, when, from, to, by] = m.map(unquote);
  if (!/^\d{4}-\d{2}-\d{2}/.test(when) || !/^[A-Z_]+$/.test(to)) continue;
  // Salted with the state moved into. Timestamps are minute-resolution and intake, routing
  // and planning all happen inside one minute, so without this the whole opening of a job
  // collapses into a single event and the page never leaves the first step.
  add('state.transitioned', when, { type: 'job', id: jobId }, { from: from === '-' ? null : from, to, by }, to);
}

// Approvals, and the rating file that closes the job.
const apDir = path.join(dir, 'approvals');
for (const f of (fs.existsSync(apDir) ? fs.readdirSync(apDir).filter(n => n.endsWith('.json')).sort() : [])) {
  const rec = readJson(path.join(apDir, f));
  if (!rec) continue;
  if (f === 'rating.json') {
    add('job.rated', rec.ratedAt, { type: 'job', id: jobId }, {
      rating: rec.rating, comment: clip(rec.comment), ratedBy: rec.ratedBy,
    });
    continue;
  }
  add('gate.decided', rec.decidedAt, { type: 'approval', id: String(rec.approvalId || f.replace(/\.json$/, '')) }, {
    gate: rec.gate, decision: rec.decision, score: rec.score, why: clip(rec.why),
    gateAppDecisionId: rec.gateAppDecisionId, artifacts: (rec.artifacts || []).length,
  });
}

// Revisions: how often a stage had to be run again, and for which reason.
const revDir = path.join(dir, 'revisions');
for (const f of (fs.existsSync(revDir) ? fs.readdirSync(revDir).filter(n => n.endsWith('.json')).sort() : [])) {
  const rec = readJson(path.join(revDir, f));
  if (!rec) continue;
  add('revision.opened', rec.at, { type: 'revision', id: String(rec.n || f.replace(/\.json$/, '')) }, {
    reasonCode: rec.reasonCode, stage: String(rec.targetStage || ''), raisedBy: rec.raisedBy,
  });
}

// The credit tally, which is the only cost figure Cowork can report.
const creditFacts = (() => {
  try {
    const facts = require(path.join(__dirname, '..', '..', 'server', 'pipeline', 'facts.mjs'));
    const job = { dir };
    const credits = facts.generationCredits(job);
    const studio = credits.threeEchoCredits;
    const elevenLabs = credits.elevenLabsCredits;
    const times = [...facts.readRecords(job), ...facts.readLanded(job)].map(entry => entry.at)
      .concat(facts.listPriceApprovals(job).map(entry => entry.approval.decidedAt || entry.approval.approvedAt))
      .filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
    return { studio, elevenLabs, at: times.length ? times[times.length - 1] : null };
  } catch {
    return null;
  }
})();
if (creditFacts && creditFacts.at && (creditFacts.studio.spent > 0 || creditFacts.studio.approved !== null
  || creditFacts.elevenLabs.spent > 0 || creditFacts.elevenLabs.approved !== null)) {
  add('credits.tallied', creditFacts.at, { type: 'job', id: jobId }, {
    spentCredits: creditFacts.studio.spent || 0,
    approvedCredits: creditFacts.studio.approved || 0,
    elevenLabsSpentCredits: creditFacts.elevenLabs.spent || 0,
    elevenLabsApprovedCredits: creditFacts.elevenLabs.approved || 0,
  });
}

// Anything already in the file that this script does not own is kept exactly as written.
const out = path.join(dir, 'events.jsonl');
const release = durable.acquire(out);
const kept = [];
try {
  for (const line of fs.readFileSync(out, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch { continue; }   // a torn line is dropped, not carried
    if (parsed && parsed.eventName && !OWNED.has(parsed.eventName)) kept.push(parsed);
  }
} catch { /* no file yet is the normal first run */ }

// One line per event, oldest first, ties broken by id so two runs order identically.
const seen = new Set();
const ordered = events.concat(kept)
  .filter(e => (seen.has(e.eventId) ? false : seen.add(e.eventId)))
  .sort(ev.byTime);

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'event.schema.json'), 'utf8'));
for (const e of ordered) {
  const errs = validate(schema, e);
  if (errs.length) {
    console.error('A ' + e.eventName + ' event is not valid: ' + errs.map(x => x.path + ' ' + x.message).join('; '));
    process.exit(1);
  }
}

durable.atomicWrite(out, ordered.map(e => JSON.stringify(e)).join('\n') + (ordered.length ? '\n' : ''));
release();
console.log('Wrote ' + ordered.length + ' events to ' + ws.fwd(out) + '.'
  + (kept.length ? ' ' + kept.length + ' of them were already there and are not mine to rebuild.' : ''));
