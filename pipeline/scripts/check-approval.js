#!/usr/bin/env node
// Is the latest approval at a gate still valid for the artifacts as they are now?
//   node check-approval.js <brand> <job-id> <gate> [--json]
// Exit 0 hashes match · 1 mismatch (names the files) · 3 no approved record · 2 usage
const fs = require('fs');
const path = require('path');
const { hashFile } = require('./hash-artifact.js');
const ws = require('./lib-workspace.js');
const execution = require('./lib-execution-availability.js');
const states = require('./lib-states.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const { brand, jobId: job, dir, rest: [gate] } = ws.resolveJobArgs(argv, argv);
if (!brand || !job || !gate) { console.error('usage: check-approval.js <brand> <job-id> <gate> [--json] [--human]'); process.exit(2); }

const jobDir = dir;
const availability = states.GATE_IDS.includes(gate)
  ? execution.checkJobDirectory(jobDir)
  : execution.checkExecutionAvailability({ workflowId: 'performance-review' });
if (!availability.available) {
  const result = { gate, approvalId: null, decision: null, artifacts: [], valid: false,
    changed: [], missing: [], reason: availability.message, retired: true };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}
const apDir = path.join(jobDir, 'approvals');
let files = [];
try { files = fs.readdirSync(apDir).filter(f => f.startsWith(gate + '-') && f.endsWith('.json')); } catch {}
const recs = files.map(f => JSON.parse(fs.readFileSync(path.join(apDir, f), 'utf8'))).sort((a, b) => a.round - b.round);
const latest = recs[recs.length - 1];
const result = {
  gate,
  approvalId: latest ? latest.approvalId : null,
  decision: latest ? latest.decision : null,
  artifacts: latest ? latest.artifacts.map(a => a.path) : [],
  valid: false,
  changed: [],
  missing: []
};

if (!latest || latest.decision !== 'approved') {
  result.reason = latest ? 'latest record is ' + latest.decision : 'no approval record';
  if (json) console.log(JSON.stringify(result, null, 2)); else console.error('NO APPROVAL: ' + result.reason + ' for gate ' + gate);
  process.exit(3);
}
for (const a of latest.artifacts) {
  const p = path.join(jobDir, a.path);
  if (!fs.existsSync(p)) { result.missing.push(a.path); continue; }
  const h = hashFile(p);
  if (h.sha256 !== a.sha256) result.changed.push({ path: a.path, approved: a.sha256.slice(0, 12), now: h.sha256.slice(0, 12) });
}
result.valid = !result.changed.length && !result.missing.length;
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.valid && argv.includes('--human')) console.log('Still the version you approved.');
else if (result.valid) console.log('ok: ' + latest.approvalId + ' still covers ' + latest.artifacts.length + ' artifact(s), approved by ' + latest.decidedBy + ' at ' + latest.decidedAt);
else {
  if (argv.includes('--human')) {
    console.error('This has changed since you approved it, so the approval no longer covers it.');
    for (const c of result.changed) console.error('  changed: ' + c.path);
    for (const m of result.missing) console.error('  gone: ' + m);
    process.exit(1);
  }
  for (const c of result.changed) console.error('CHANGED since approval: ' + c.path + ' (' + c.approved + ' -> ' + c.now + ')');
  for (const m of result.missing) console.error('MISSING since approval: ' + m);
  console.error('Re-send the changed artifact and ask for a new verdict. The approval ' + latest.approvalId + ' no longer applies.');
}
process.exit(result.valid ? 0 : 1);
