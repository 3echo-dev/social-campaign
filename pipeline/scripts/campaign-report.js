#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');
const durable = require('./lib-durable.js');
const events = require('./lib-events.js');
const reports = require('./lib-campaign-report.js');

const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!dir) { console.error('usage: campaign-report.js <brand> <job> [--inputs file.json] [--save] [--json]'); process.exit(2); }

function hashReport(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.generatedAt;
  delete copy.reportVersion;
  if (copy.provenance) delete copy.provenance.snapshotHash;
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const QUALITY = new Set(['measured', 'estimated', 'inferred', 'missing', 'operator_confirmed', 'partial']);

function redactedText(value, max = 240) {
  if (value === undefined || value === null || value === '') return undefined;
  return events.clip(value).slice(0, max);
}

function receiptAttrs(result, version) {
  const reportVersion = Number.isSafeInteger(version) && version > 0 ? version : 1;
  const snapshotHash = result.provenance && result.provenance.snapshotHash || hashReport(result);
  const tokenCoverage = QUALITY.has(result.tokens && result.tokens.coverage) ? result.tokens.coverage : 'partial';
  const costIncomplete = !result.cost || result.cost.totalUsd === null
    || ['incomplete', 'missing', 'partial'].includes(result.cost.coverage);
  const coverage = costIncomplete ? 'partial' : tokenCoverage;
  const deliverables = (Array.isArray(result.deliverables) ? result.deliverables : []).slice(0, 50)
    .map(item => redactedText(item.quantity + ' x ' + item.name + (item.format ? ' (' + item.format + ')' : ''), 240))
    .filter(Boolean);
  const attrs = {
    reportVersion,
    inputRefs: ['campaign-report:' + result.jobId + ':v' + reportVersion + ':' + snapshotHash],
    coverage,
    deliverables,
    costCoverage: redactedText(result.cost && result.cost.coverage, 100),
    elapsedMs: result.production.elapsedMs,
    approvalWaitMs: result.production.approvalWaitMs,
    processingWindowMs: result.production.processingWindowMs,
    blockedMs: result.production.blockedMs,
    recordedTokens: result.tokens.recorded,
    tokenCoverage: result.tokens.coverage,
    totalCostUsd: result.cost.totalUsd,
    recordedApiEstimateUsd: result.cost.recordedApiEstimateUsd,
    operationalCostUsd: result.cost.operationalCostUsd,
    customerCashCostUsd: result.cost.customerCashCostUsd,
    humanCostUsd: result.cost.humanCostUsd,
    baselineCostUsd: result.comparison ? result.comparison.baselineCostUsd ?? null : null,
    estimatedSavingsUsd: result.comparison ? result.comparison.estimatedSavingsUsd ?? null : null,
    humanHours: result.cost.humanHours,
    humanHoursSaved: result.comparison ? result.comparison.humanHoursSaved ?? null : null,
  };
  const scope = redactedText(result.scope);
  const approvalMilestone = redactedText(result.approvalMilestone, 200);
  if (scope !== undefined) attrs.scope = scope;
  if (result.revisionRounds !== null && result.revisionRounds !== undefined) attrs.revisionRounds = result.revisionRounds;
  if (approvalMilestone !== undefined) attrs.approvalMilestone = approvalMilestone;
  return attrs;
}

try {
  const index = argv.indexOf('--inputs');
  const file = index >= 0 ? argv[index + 1] : path.join(dir, 'report-inputs.json');
  let input = {};
  if (index >= 0 || fs.existsSync(file)) {
    if (!file || !fs.existsSync(file)) throw new Error('No report input file was found.');
    if (fs.statSync(file).size > 60000) throw new Error('Keep report inputs under 60 KB.');
    input = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  let result = reports.report(dir, ws.root(argv), input, { reportVersion: 1 });
  if (argv.includes('--save')) {
    const currentPath = path.join(dir, 'campaign-report.json');
    const current = readJson(currentPath);
    const candidateHash = hashReport(result);
    let version = current && Number.isSafeInteger(current.reportVersion) ? current.reportVersion : 0;
    const currentHash = current && (current.provenance && current.provenance.snapshotHash || hashReport(current));
    if (!current || currentHash !== candidateHash) version += 1;
    result = reports.report(dir, ws.root(argv), input, { reportVersion: version });
    result.provenance.snapshotHash = hashReport(result);
    durable.atomicWrite(path.join(dir, 'report-inputs.json'), JSON.stringify(input, null, 2) + '\n');
    durable.atomicWrite(path.join(dir, 'campaign-report.json'), JSON.stringify(result, null, 2) + '\n');
    durable.atomicWrite(path.join(dir, 'campaign-report-v' + version + '.json'), JSON.stringify(result, null, 2) + '\n');
    durable.atomicWrite(path.join(dir, 'campaign-report.md'), reports.markdown(result));
    durable.atomicWrite(path.join(dir, 'campaign-report-v' + version + '.md'), reports.markdown(result));
    const attrs = receiptAttrs(result, version);
    const jobSpec = readJson(path.join(dir, 'job.json')) || {};
    const event = events.makeEvent(result.jobId, 'campaign.reported', result.generatedAt,
      { type: 'job', id: result.jobId }, attrs, {
        dedupeKey: 'report-v' + version + ':' + result.provenance.snapshotHash,
        workspaceId: jobSpec.workspaceId || brand, brandId: brand, jobId: result.jobId,
        ownerUserId: jobSpec.ownerUserId, ownerEmail: jobSpec.ownerEmailVerified === true ? jobSpec.ownerEmail : undefined,
        source: 'campaign_report', host: 'local', quality: attrs.coverage,
        observedAt: result.generatedAt,
      });
    durable.update(path.join(dir, 'events.jsonl'), raw => {
      if (raw.split(/\r?\n/).some(line => {
        try { return JSON.parse(line).eventId === event.eventId; } catch { return false; }
      })) return raw;
      return raw + (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(event) + '\n';
    });
  }
  console.log(argv.includes('--json') ? JSON.stringify(result, null, 2) : reports.markdown(result));
} catch (e) { console.error(e.message); process.exitCode = 1; }
