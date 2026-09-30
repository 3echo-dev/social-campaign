#!/usr/bin/env node
// Coordinate retirement of hosted performance-review gates before a local compatibility
// migration changes the job.  The Gate administrative route owns the withdrawal record and
// stale-decision rejection; this script never writes an approval or turns withdrawal into a
// user verdict.
//
//   node withdraw-hosted-gates.js <job-directory> --gates report [--by compatibility-migration]
//
// Exit 0 when every named gate is absent or administratively withdrawn, 1 when Gate cannot
// attest the result, and 2 for usage.
const fs = require('fs');
const path = require('path');
const gate = require('./lib-gate.js');
const ws = require('./lib-workspace.js');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const json = argv.includes('--json');
const rawDir = ws.positionals(argv)[0];
const dir = rawDir ? path.resolve(rawDir) : null;
const gates = String(value('gates', '')).split(',').map(item => item.trim()).filter(Boolean);
const by = value('by', 'compatibility-migration');

function fail(message, code = 1, result = null) {
  if (json) console.log(JSON.stringify({ ok: false, error: message, ...(result || {}) }, null, 2));
  else console.error(message);
  process.exit(code);
}

if (!dir || !gates.length || gates.some(gateName => !/^[A-Za-z0-9_-]{1,80}$/.test(gateName))) {
  fail('usage: withdraw-hosted-gates.js <job-directory> --gates report[,gate] [--by <system>] [--root <dir>] [--json]', 2);
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const job = readJson(path.join(dir, 'job.json')) || {};
const route = readJson(path.join(dir, 'route.json')) || {};
const jobId = String(job.jobId || path.basename(dir));
const withdrawalJobId = jobId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 100) || 'job';
if (!gate.configured(argv)) fail('Gate administrative withdrawal is unavailable. Configure the Gate app before migrating a job with a hosted review gate.');

function bodyOf(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.body && typeof value.body === 'object') return value.body;
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent;
  return value;
}

function identityFrom(value, gateName) {
  const body = bodyOf(value);
  const direct = body.gate && typeof body.gate === 'object' ? body.gate : body;
  return {
    gateId: direct.gateId || direct.id || direct.expectedGateId || null,
    artifactRevision: direct.artifactRevision || direct.expectedArtifactRevision || null,
    artifactHash: direct.artifactHash || direct.expectedArtifactHash || null,
    gate: gateName,
  };
}

async function run() {
  const results = [];
  for (const gateName of gates) {
    const decisionRoute = 'decision?key=' + encodeURIComponent(jobId) + '&gate=' + encodeURIComponent(gateName);
    const decision = await gate.call(decisionRoute, null, { argv, timeoutMs: 5000 });
    if (decision.offline) fail('Gate could not attest ' + gateName + ': ' + decision.reason);
    const state = bodyOf(decision);
    const status = String(state.status || '').toLowerCase();
    if (status === 'none' || status === 'withdrawn') {
      results.push({ gate: gateName, status });
      continue;
    }
    if (status === 'decided') {
      // A decided report gate may still have a stale browser callback.  The Gate worker must
      // classify it as retired before local migration proceeds; accepting it here would make
      // the old verdict look actionable.
      fail('Gate reported a decided ' + gateName + ' gate without a withdrawal classification. Ask the Gate worker to withdraw it, then retry.', 1, { results });
    }
    if (status !== 'waiting' && status !== 'pending') {
      fail('Gate returned an unrecognized status for ' + gateName + ': ' + (status || 'missing'), 1, { results });
    }
    const identity = identityFrom(state, gateName);
    if (!identity.gateId || !identity.artifactRevision || !identity.artifactHash) {
      fail('Gate has an open ' + gateName + ' review but did not return its gate and artifact identity. The Gate worker must supply those values to the administrative withdrawal call.', 1, { results });
    }
    const expectedExecution = {};
    if (job.kind) expectedExecution.jobKind = String(job.kind);
    if (route.workflowId) expectedExecution.workflowId = String(route.workflowId);
    if (route.workflowVersion) expectedExecution.workflowVersion = String(route.workflowVersion);
    const request = {
      job: jobId,
      gate: gateName,
      reason: 'performance_review_removed',
      withdrawalId: 'performance-review-removal-v1-' + withdrawalJobId + '-' + gateName,
      withdrawnBy: by,
      expectedGateId: identity.gateId,
      expectedArtifactRevision: identity.artifactRevision,
      expectedArtifactHash: identity.artifactHash,
      ...(Object.keys(expectedExecution).length ? { expectedExecution } : {}),
    };
    const withdrawn = await gate.call('withdraw', request, { argv, timeoutMs: 5000 });
    if (withdrawn.offline) fail('Gate withdrawal for ' + gateName + ' failed: ' + withdrawn.reason, 1, { results });
    const result = bodyOf(withdrawn);
    if (result.ok !== true || !['withdrawn', 'already_withdrawn'].includes(String(result.status || '').toLowerCase())) {
      fail('Gate did not attest withdrawal for ' + gateName + '.', 1, { results, response: result });
    }
    results.push({ gate: gateName, status: String(result.status).toLowerCase(), withdrawalId: request.withdrawalId });
  }
  const result = { ok: true, status: 'complete', jobId, gates: results };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log('Hosted review gates are administratively withdrawn for ' + jobId + '.');
}

run().catch(error => fail(error.message || String(error)));
