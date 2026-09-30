const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gate = require('./lib-gate.js');
const durable = require('./lib-durable.js');
const events = require('./lib-events.js');

const MAX_BATCH = 200;
const MAX_ACKNOWLEDGED = 20000;
const MAX_REJECTED = 5000;
const QUALITIES = new Set(['measured', 'estimated', 'inferred', 'missing', 'partial', 'operator_confirmed']);
const ALLOWED = {
  'campaign.reported': ['reportVersion', 'inputRefs', 'coverage', 'scope', 'deliverables', 'revisionRounds', 'approvalMilestone', 'costCoverage', 'elapsedMs', 'approvalWaitMs', 'processingWindowMs', 'blockedMs', 'recordedTokens', 'tokenCoverage', 'totalCostUsd', 'recordedApiEstimateUsd', 'operationalCostUsd', 'customerCashCostUsd', 'humanCostUsd', 'baselineCostUsd', 'estimatedSavingsUsd', 'humanHours', 'humanHoursSaved'],
  'job.routed': ['workflowId', 'disciplines', 'gates'],
  'state.transitioned': ['from', 'to', 'by'],
  'gate.decided': ['gate', 'decision', 'score', 'artifacts'],
  'job.rated': ['rating'],
  'revision.opened': ['reasonCode', 'stage', 'raisedBy'],
  'credits.tallied': ['spentCredits', 'approvedCredits', 'elevenLabsSpentCredits', 'elevenLabsApprovedCredits'],
  'tokens.observed': ['model', 'provider', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'agentType', 'sessionId', 'requestId', 'messageId', 'usageSemantics', 'inputTokensCoverage', 'outputTokensCoverage', 'cacheCreationTokensCoverage', 'cacheReadTokensCoverage'],
  'tool.completed': ['tool', 'status', 'durationMs', 'requestId'],
  'operation.started': ['operationType', 'status', 'provider'],
  'operation.completed': ['operationType', 'status', 'provider', 'durationMs'],
  'decision.recorded': ['gate', 'decision', 'artifactRevision'],
  'decision.consumed': ['gate', 'decision', 'artifactRevision'],
  'provider.charge': ['provider', 'amount', 'currency', 'credits', 'status'],
  'retry.recorded': ['reason', 'attempt', 'status'],
  'delivery.recorded': ['milestone', 'status', 'deliverables'],
  'turn.observed': ['state', 'status', 'waiting'],
  'research.checked': ['evidencePlanRevision', 'policyVersion', 'reusedCount', 'adaptedCount', 'refreshedCount', 'missingCount', 'excludedCount', 'searchCount', 'fetchCount', 'failedAttemptCount', 'elapsedMs', 'completionReason'],
  'task.completed': ['taskId', 'attemptId', 'role', 'status', 'inputRevision', 'durationMs', 'stopReason'],
  'validation.completed': ['reviewTaskId', 'artifactRevision', 'blockingFindingCount', 'advisoryFindingCount', 'correctionPassCount', 'reusedCheckCount'],
};

function scalar(value, max = 240) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return events.clip(value).slice(0, max);
  return undefined;
}

function attrValue(value) {
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scalar(item, 120)).filter(item => item !== undefined);
  return scalar(value);
}

function qualityValue(value) {
  if (value === undefined || value === null || value === '') return 'measured';
  const normalized = value === 'unavailable' ? 'missing' : String(value);
  return QUALITIES.has(normalized) ? normalized : null;
}

function assetReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const forbidden = ['path', 'localPath', 'absolutePath', 'sourcePath', 'filePath', 'rootPath'];
  if (forbidden.some(key => Object.prototype.hasOwnProperty.call(value, key))) return null;
  const assetId = scalar(value.assetId, 200);
  const previewUrl = scalar(value.previewUrl, 2000);
  if (!assetId && !previewUrl) return null;
  if (previewUrl && !/^https:\/\//i.test(previewUrl)) return null;
  return Object.fromEntries(Object.entries({
    assetId, previewUrl, sha256: scalar(value.sha256, 128),
    mediaType: scalar(value.mediaType, 120), title: scalar(value.title, 240),
    bytes: Number.isSafeInteger(value.bytes) && value.bytes >= 0 ? value.bytes : undefined,
  }).filter(([, item]) => item !== undefined));
}

// Convert a local event to the restricted metadata envelope sent to the gate app. This function
// is deliberately lossy: the local event remains the source of truth, while the online copy gets
// only the fields needed for authorized aggregates.
function metadata(event, options = {}) {
  if (!event || typeof event !== 'object' || typeof event.eventId !== 'string' || !event.eventId
    || typeof event.eventName !== 'string' || !event.eventName || typeof event.occurredAt !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, event.eventName)) return null;
  if (!event.attrs || typeof event.attrs !== 'object' || Array.isArray(event.attrs)) return null;
  if (options.requireOwner !== false && !scalar(event.ownerUserId, 200)) return null;
  if (events.OPTIMIZATION_EVENT_ATTRS[event.eventName]
    && !events.optimizationAttrsValid(event.eventName, event.attrs, true)) return null;
  const attrs = {};
  for (const key of ALLOWED[event.eventName]) {
    let value = attrValue(event.attrs[key]);
    if (key === 'coverage' && value === 'unavailable') value = 'missing';
    if (value !== undefined) attrs[key] = value;
  }
  const result = {
    eventId: event.eventId.slice(0, 160), eventName: event.eventName,
    schemaVersion: event.schemaVersion || 1,
    occurredAt: event.occurredAt.slice(0, 80),
    observedAt: String(event.observedAt || event.occurredAt).slice(0, 80),
    workspaceId: scalar(event.workspaceId), brandId: scalar(event.brandId),
    jobId: scalar(event.jobId), runId: scalar(event.runId), stage: scalar(event.stage),
    operationId: scalar(event.operationId), attemptId: scalar(event.attemptId),
    source: scalar(event.source) || 'local', host: scalar(event.host) || 'unknown',
    quality: qualityValue(event.quality),
    ownerUserId: scalar(event.ownerUserId, 200),
    ownerEmail: scalar(event.ownerEmail, 320),
    actorUserId: scalar(event.actorUserId, 200),
    job: event.job ? String(event.job).slice(0, 200) : undefined,
    subject: {
      type: String(event.subject && event.subject.type || 'job').slice(0, 80),
      id: String(event.subject && event.subject.id || event.job || 'unknown').slice(0, 160),
    },
    attrs,
  };
  if (Array.isArray(event.assetRefs)) {
    const refs = event.assetRefs.slice(0, 50).map(assetReference);
    if (refs.some(ref => !ref)) return null;
    result.assetRefs = refs;
  }
  if (result.quality === null) return null;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function destinationFor(config) {
  return crypto.createHash('sha256').update(config.url + '\0' + config.key).digest('hex');
}

function readReceipt(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function eventLines(dir, options = {}) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch {}
  const unique = new Map();
  const invalid = [];
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    let value;
    try { value = JSON.parse(line); } catch { invalid.push({ eventId: null, reason: 'invalid_json' }); continue; }
    const safe = metadata(value, options);
    if (!safe) {
      invalid.push({ eventId: value && value.eventId ? String(value.eventId) : null, reason: 'invalid_or_unallowlisted_event' });
      continue;
    }
    if (!unique.has(safe.eventId)) unique.set(safe.eventId, safe);
  }
  return { events: [...unique.values()], invalid };
}

function ackFrom(result, batch) {
  const ids = new Set(batch.map(event => event.eventId));
  const accepted = Array.isArray(result && result.acceptedIds) ? result.acceptedIds : [];
  const already = Array.isArray(result && result.alreadyPresentIds) ? result.alreadyPresentIds : [];
  const acknowledged = Array.isArray(result && result.acknowledgedIds) ? result.acknowledgedIds : [];
  const rejected = Array.isArray(result && result.rejected) ? result.rejected : [];
  if (accepted.length || already.length || acknowledged.length || rejected.length) {
    const normalizedRejected = rejected.map(item => typeof item === 'string' ? { eventId: item, reason: 'rejected' } : item)
      .filter(item => item && item.eventId !== undefined)
      .map(item => ({ eventId: String(item.eventId), reason: String(item.reason || item.code || 'rejected').slice(0, 240) }));
    const allReported = [...accepted, ...already, ...acknowledged, ...normalizedRejected.map(item => item.eventId)];
    if (allReported.some(id => !ids.has(String(id)))) {
      return { acknowledged: [], accepted: [], duplicates: [], rejected: [], exact: false, reason: 'receipt_contains_unknown_event_id' };
    }
    const rawAck = (acknowledged.length ? acknowledged : accepted.concat(already)).map(String);
    const ack = new Set(rawAck);
    const rejectedIds = normalizedRejected.map(item => item.eventId);
    if (new Set(rawAck).size !== rawAck.length || new Set(rejectedIds).size !== rejectedIds.length
      || accepted.some(id => already.includes(id))
      || normalizedRejected.some(item => ack.has(item.eventId))) {
      return { acknowledged: [], accepted: [], duplicates: [], rejected: [], exact: false, reason: 'receipt_contains_duplicate_event_id' };
    }
    const covered = new Set([...ack, ...normalizedRejected.map(item => item.eventId)]);
    if (covered.size !== ids.size || [...ids].some(id => !covered.has(id))) {
      return { acknowledged: [], accepted: [], duplicates: [], rejected: [], exact: false, reason: 'receipt_missing_event_id' };
    }
    return {
      acknowledged: [...ack],
      accepted: accepted.length || already.length
        ? accepted.map(String).filter(id => ack.has(id))
        : [...ack],
      duplicates: already.map(String).filter(id => ack.has(id)),
      rejected: normalizedRejected.filter(item => ids.has(item.eventId)),
      exact: true,
    };
  }
  // Backward-compatible response used by the first gate-app implementation.
  if (result && Number(result.received) === batch.length
    && Number(result.inserted || 0) + Number(result.duplicates || 0) === batch.length) {
    const duplicateCount = Number(result.duplicates || 0);
    return { acknowledged: batch.map(event => event.eventId), accepted: batch.slice(0, batch.length - duplicateCount).map(event => event.eventId),
      duplicates: batch.slice(batch.length - duplicateCount).map(event => event.eventId), rejected: [], exact: true };
  }
  return { acknowledged: [], accepted: [], duplicates: [], rejected: [], exact: false };
}

function writeReceipt(file, updater) {
  durable.update(file, text => {
    let current = {};
    try { current = JSON.parse(text) || {}; } catch {}
    const next = updater(current) || {};
    // Merge histories while holding the receipt lock.  A second hook can append
    // an event while the network request is in flight; its receipt update must
    // never be overwritten by the first request's stale snapshot.
    const sameDestination = !current.destination || !next.destination || current.destination === next.destination;
    if (sameDestination) {
      for (const key of ['acknowledged', 'accepted', 'duplicates']) {
        next[key] = [...new Set([...(Array.isArray(current[key]) ? current[key] : []), ...(Array.isArray(next[key]) ? next[key] : [])])]
          .slice(-MAX_ACKNOWLEDGED);
      }
      next.rejected = [...(Array.isArray(current.rejected) ? current.rejected : []), ...(Array.isArray(next.rejected) ? next.rejected : [])]
        .slice(-MAX_REJECTED);
      next.statuses = { ...(current.statuses && typeof current.statuses === 'object' ? current.statuses : {}), ...(next.statuses && typeof next.statuses === 'object' ? next.statuses : {}) };
    }
    return JSON.stringify(next, null, 2) + '\n';
  });
}

async function sync(dir, argv, timeoutMs = 2000) {
  const { config } = gate.readConfig(argv);
  const receipt = path.join(dir, '.metrics-sync.json');
  const existing = readReceipt(receipt);
  if (!config) {
    const local = eventLines(dir, { requireOwner: false });
    return { status: 'unavailable', state: 'local_only', sent: 0, pending: local.events.length, rejected: local.invalid.length,
      reason: 'No telemetry destination is configured; local observations remain available.' };
  }
  const destination = destinationFor(config);
  const state = existing.destination === destination ? existing : {};
  const acknowledged = new Set(Array.isArray(state.acknowledged) ? state.acknowledged : []);
  const acceptedHistory = new Set(Array.isArray(state.accepted) ? state.accepted : []);
  const duplicateHistory = new Set(Array.isArray(state.duplicates) ? state.duplicates : []);
  const statuses = state.statuses && typeof state.statuses === 'object' ? { ...state.statuses } : {};
  const { events: all, invalid } = eventLines(dir);
  const pending = all.filter(event => !acknowledged.has(event.eventId));
  const rejectedHistory = Array.isArray(state.rejected) ? state.rejected : [];
  if (invalid.length) {
    invalid.forEach(item => { if (item.eventId) statuses[item.eventId] = 'uninstrumented'; });
    writeReceipt(receipt, previous => ({
      version: 2, destination, acknowledged: [...acknowledged].slice(-MAX_ACKNOWLEDGED),
      accepted: [...acceptedHistory].slice(-MAX_ACKNOWLEDGED), duplicates: [...duplicateHistory].slice(-MAX_ACKNOWLEDGED), statuses,
      rejected: rejectedHistory.concat(invalid).slice(-MAX_REJECTED),
      queuedCount: pending.length, invalidCount: invalid.length,
      lastFailureCategory: 'invalid_local_event', lastFailureAt: new Date().toISOString(),
      syncedAt: previous.syncedAt || null,
    }));
  }
  if (!pending.length) {
    if (!invalid.length) writeReceipt(receipt, previous => ({ ...previous, version: 2, destination,
      acknowledged: [...acknowledged].slice(-MAX_ACKNOWLEDGED), accepted: [...acceptedHistory].slice(-MAX_ACKNOWLEDGED),
      duplicates: [...duplicateHistory].slice(-MAX_ACKNOWLEDGED), statuses, queuedCount: 0, syncedAt: previous.syncedAt || null }));
    return { status: invalid.length ? 'rejected' : 'synced', sent: 0, pending: 0, rejected: invalid.length };
  }
  pending.forEach(event => { if (!statuses[event.eventId]) statuses[event.eventId] = 'queued'; });
  const batch = pending.slice(0, MAX_BATCH);
  let result;
  try { result = await gate.call('events', { events: batch }, { argv, timeoutMs }); }
  catch (error) { result = { offline: true, reason: error.message }; }
  if (!result || result.offline) {
    writeReceipt(receipt, previous => ({
      version: 2, destination, acknowledged: [...acknowledged].slice(-MAX_ACKNOWLEDGED),
      accepted: [...acceptedHistory].slice(-MAX_ACKNOWLEDGED), duplicates: [...duplicateHistory].slice(-MAX_ACKNOWLEDGED), statuses,
      rejected: rejectedHistory.slice(-MAX_REJECTED), queuedCount: pending.length,
      invalidCount: invalid.length, lastFailureCategory: 'unavailable',
      lastFailureReason: String(result && result.reason || 'telemetry destination unavailable').slice(0, 240),
      lastFailureAt: new Date().toISOString(), syncedAt: previous.syncedAt || null,
    }));
    return { status: 'pending', sent: 0, pending: pending.length, reason: result && result.reason };
  }
  const ack = ackFrom(result, batch);
  if (!ack.exact) {
    writeReceipt(receipt, previous => ({
      version: 2, destination, acknowledged: [...acknowledged].slice(-MAX_ACKNOWLEDGED),
      accepted: [...acceptedHistory].slice(-MAX_ACKNOWLEDGED), duplicates: [...duplicateHistory].slice(-MAX_ACKNOWLEDGED), statuses,
      rejected: rejectedHistory.slice(-MAX_REJECTED), queuedCount: pending.length,
      invalidCount: invalid.length, lastFailureCategory: 'incomplete_acknowledgement',
      lastFailureReason: 'The destination did not acknowledge accepted or already-present event IDs.',
      lastFailureAt: new Date().toISOString(), syncedAt: previous.syncedAt || null,
    }));
    return { status: 'pending', sent: 0, pending: pending.length, reason: 'incomplete_acknowledgement' };
  }
  ack.acknowledged.forEach(id => acknowledged.add(id));
  ack.accepted.forEach(id => { acceptedHistory.add(id); statuses[id] = 'acknowledged'; });
  ack.duplicates.forEach(id => { duplicateHistory.add(id); statuses[id] = 'duplicate'; });
  ack.rejected.forEach(item => { statuses[item.eventId] = 'rejected'; });
  const rejectedNow = rejectedHistory.concat(ack.rejected).filter(item => item && item.eventId);
  // Re-read after the remote call.  Events written while the batch was in
  // flight were not part of its receipt and therefore remain pending.
  const fresh = eventLines(dir);
  const remaining = fresh.events.filter(event => !acknowledged.has(event.eventId));
  writeReceipt(receipt, previous => ({
    version: 2, destination, acknowledged: [...acknowledged].slice(-MAX_ACKNOWLEDGED),
    accepted: [...acceptedHistory].slice(-MAX_ACKNOWLEDGED), duplicates: [...duplicateHistory].slice(-MAX_ACKNOWLEDGED), statuses,
    rejected: rejectedNow.slice(-MAX_REJECTED), queuedCount: remaining.length,
    invalidCount: fresh.invalid.length, lastFailureCategory: ack.rejected.length ? 'rejected' : null,
    lastFailureReason: ack.rejected.length ? ack.rejected[0].reason : null,
    lastFailureAt: ack.rejected.length ? new Date().toISOString() : null,
    syncedAt: new Date().toISOString(),
  }));
  return {
    status: remaining.length ? (ack.rejected.length ? 'rejected' : 'pending') : 'synced',
    sent: ack.acknowledged.length, pending: remaining.length, rejected: ack.rejected.length,
  };
}

async function flush(job, argv) {
  if (!gate.configured(argv)) return { status: 'unavailable', state: 'local_only', sent: 0 };
  const { spawnSync } = require('child_process');
  const ws = require('./lib-workspace.js');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'export-events.js'), job.brand, job.jobId, '--root', ws.root(argv)], { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0) return { status: 'pending', reason: 'Could not prepare local events' };
  return sync(job.dir, argv, 1500);
}

module.exports = { sync, metadata, flush, ackFrom, MAX_BATCH };
