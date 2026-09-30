// Durable records for externally visible or paid operations.
//
// A provider response can be lost after the provider accepted a request. The record therefore
// separates a logical idempotency key from an attempt operationId and keeps outcome_unknown until
// a provider lookup resolves it. Callers can safely ask prepare() again after a restart: an
// existing key is returned, never submitted a second time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');

const VERSION = 1;
const INDEX_NAME = 'operations.json';
const STATUSES = ['prepared', 'submitted', 'running', 'succeeded', 'failed', 'outcome_unknown'];
const ACTIVE = new Set(['prepared', 'submitted', 'running', 'outcome_unknown']);
const TERMINAL = new Set(['succeeded', 'failed']);
const MAX_RECORDS = 10000;
const MAX_TEXT = 1000;

function fail(message, code = 'INVALID_OPERATION') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function string(value, name, required = false) {
  if (value === undefined || value === null) {
    if (required) throw fail(name + ' is required.');
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT || !value.trim()) throw fail(name + ' must be a non-empty string.');
  return value;
}

function optionalText(value, name) {
  return value === undefined || value === null || value === '' ? null : string(value, name);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeHash(value) {
  if (value === undefined || value === null || value === '') return null;
  const textValue = String(value);
  return /^[a-f0-9]{64}$/i.test(textValue) ? textValue.toLowerCase() : hash(textValue);
}

function indexFile(dir) {
  if (typeof dir !== 'string' || !dir) throw fail('A job directory is required.');
  return path.join(dir, INDEX_NAME);
}

function blank() {
  return { version: VERSION, revision: 0, operations: [] };
}

function parseIndex(raw) {
  if (!String(raw || '').trim()) return blank();
  let value;
  try { value = JSON.parse(raw); } catch { throw fail('The operation ledger is corrupt. Reconcile or restore it before retrying.', 'CORRUPT_OPERATION_LEDGER'); }
  if (!value || value.version !== VERSION || !Array.isArray(value.operations) || value.operations.length > MAX_RECORDS) {
    throw fail('The operation ledger is invalid. Reconcile or restore it before retrying.', 'CORRUPT_OPERATION_LEDGER');
  }
  return value;
}

function readIndex(dir) {
  const file = indexFile(dir);
  try { return parseIndex(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return blank(); throw e; }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findRecord(index, ref) {
  const key = typeof ref === 'string' ? ref : ref && ref.operationId;
  const idem = typeof ref === 'object' && ref ? ref.idempotencyKey : null;
  for (let i = index.operations.length - 1; i >= 0; i--) {
    const item = index.operations[i];
    if ((key && (item.operationId === key || item.idempotencyKey === key)) || (idem && item.idempotencyKey === idem)) return item;
  }
  return null;
}

function recordInput(input, existing, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('An operation description is required.');
  const idempotencyKey = string(input.idempotencyKey, 'idempotencyKey', true);
  const provider = string(input.provider, 'provider', true);
  const operationId = optionalText(input.operationId, 'operationId') || crypto.randomUUID();
  const jobId = optionalText(input.jobId, 'jobId');
  const logicalOperationId = optionalText(input.logicalOperationId, 'logicalOperationId') || hash(idempotencyKey).slice(0, 32);
  const inputHash = safeHash(input.inputHash);
  const suppliedFingerprint = optionalText(input.requestFingerprint, 'requestFingerprint');
  const requestFingerprint = safeHash(suppliedFingerprint) || hash({
    jobId, runId: input.runId, stage: input.stage, idempotencyKey, artifactRevision: input.artifactRevision,
    inputHash, provider, accountRef: input.accountRef,
  });
  const resultRefs = input.resultRefs === undefined ? [] : input.resultRefs;
  if (!Array.isArray(resultRefs) || resultRefs.length > 24 || resultRefs.some(v => typeof v !== 'string' || v.length > MAX_TEXT)) {
    throw fail('resultRefs must contain at most twenty-four short references.');
  }
  const artifactRevision = input.artifactRevision === undefined || input.artifactRevision === null
    ? null : Number(input.artifactRevision);
  if (artifactRevision !== null && (!Number.isSafeInteger(artifactRevision) || artifactRevision < 0)) throw fail('artifactRevision must be a non-negative integer.');
  const attempt = existing ? existing.attempt + 1 : 1;
  return {
    version: VERSION,
    operationId,
    logicalOperationId,
    attempt,
    jobId,
    runId: optionalText(input.runId, 'runId'),
    stage: optionalText(input.stage, 'stage'),
    idempotencyKey,
    artifactRevision,
    inputHash,
    provider,
    accountRef: optionalText(input.accountRef, 'accountRef'),
    requestFingerprint,
    status: 'prepared',
    providerRequestId: optionalText(input.providerRequestId, 'providerRequestId'),
    startedAt: now,
    completedAt: null,
    resultRefs,
    errorCode: null,
    revision: 1,
  };
}

function nowOf(options) {
  const value = options && options.now;
  if (typeof value === 'function') return new Date(value()).toISOString();
  if (value !== undefined) return new Date(value).toISOString();
  return new Date().toISOString();
}

/**
 * Record an operation before making the external request. Repeating a key returns the original
 * record. Pass `{ retry: true }` only after the prior attempt is known failed or has been
 * reconciled; uncertain operations are deliberately refused.
 */
function prepare(dir, input, options = {}) {
  const file = indexFile(dir);
  let result;
  durable.update(file, raw => {
    const index = parseIndex(raw);
    const idem = string(input && input.idempotencyKey, 'idempotencyKey', true);
    const existing = findRecord(index, { idempotencyKey: idem });
    if (existing && !options.retry) {
      const candidate = recordInput(input, existing, existing.startedAt);
      if (candidate.requestFingerprint !== existing.requestFingerprint) {
        throw fail('The idempotency key is already bound to different inputs.', 'IDEMPOTENCY_CONFLICT');
      }
      result = { record: clone(existing), created: false, duplicate: true };
      return raw || JSON.stringify(index) + '\n';
    }
    if (existing && options.retry && ACTIVE.has(existing.status)) {
      throw fail('The previous operation is still ' + existing.status + '; reconcile it before retrying.', 'OPERATION_UNCERTAIN');
    }
    if (existing && options.retry && existing.status === 'succeeded') {
      result = { record: clone(existing), created: false, duplicate: true };
      return raw || JSON.stringify(index) + '\n';
    }
    const record = recordInput(input, existing && existing.idempotencyKey === idem ? existing : null, nowOf(options));
    if (existing && existing.logicalOperationId) record.logicalOperationId = existing.logicalOperationId;
    index.operations.push(record);
    index.revision += 1;
    if (index.operations.length > MAX_RECORDS) throw fail('The operation ledger is full; archive completed records before continuing.', 'OPERATION_LEDGER_FULL');
    result = { record: clone(record), created: true, duplicate: false };
    return JSON.stringify(index, null, 2) + '\n';
  }, JSON.stringify(blank(), null, 2) + '\n');
  return result;
}

function read(dir, ref) {
  const item = findRecord(readIndex(dir), ref);
  return item ? clone(item) : null;
}

function list(dir) {
  return readIndex(dir).operations.map(clone);
}

function patchRecord(record, status, patch, now) {
  if (!STATUSES.includes(status)) throw fail('Unknown operation status: ' + status + '.');
  const allowed = {
    providerRequestId: optionalText(patch && patch.providerRequestId, 'providerRequestId'),
    resultRefs: patch && patch.resultRefs,
    errorCode: optionalText(patch && patch.errorCode, 'errorCode'),
  };
  if (allowed.resultRefs !== undefined) {
    if (!Array.isArray(allowed.resultRefs) || allowed.resultRefs.length > 24 || allowed.resultRefs.some(v => typeof v !== 'string' || v.length > MAX_TEXT)) throw fail('resultRefs must contain at most twenty-four short references.');
  } else allowed.resultRefs = record.resultRefs;
  const legal = record.status === status ||
    ({ prepared: ['submitted', 'running', 'failed', 'outcome_unknown'], submitted: ['running', 'succeeded', 'failed', 'outcome_unknown'], running: ['succeeded', 'failed', 'outcome_unknown'], outcome_unknown: ['running', 'succeeded', 'failed'], failed: [], succeeded: [] }[record.status] || []).includes(status);
  if (!legal) throw fail('Cannot move operation from ' + record.status + ' to ' + status + '.', 'INVALID_OPERATION_TRANSITION');
  record.status = status;
  if (allowed.providerRequestId !== null) record.providerRequestId = allowed.providerRequestId;
  record.resultRefs = allowed.resultRefs;
  if (allowed.errorCode !== null) record.errorCode = allowed.errorCode;
  if ((status === 'succeeded' || status === 'failed') && !record.completedAt) record.completedAt = now;
  record.revision += 1;
  return record;
}

function mark(dir, ref, status, patch = {}, options = {}) {
  const file = indexFile(dir);
  let result;
  durable.update(file, raw => {
    const index = parseIndex(raw);
    const record = findRecord(index, ref);
    if (!record) throw fail('Operation not found.', 'OPERATION_NOT_FOUND');
    if (options.expectedRevision !== undefined && record.revision !== Number(options.expectedRevision)) {
      const error = fail('The operation changed at revision ' + record.revision + '.', 'STALE_OPERATION');
      error.actualRevision = record.revision;
      throw error;
    }
    if (options.expectedStatus && record.status !== options.expectedStatus) throw fail('The operation is now ' + record.status + '.', 'STALE_OPERATION');
    const before = clone(record);
    patchRecord(record, status, patch, nowOf(options));
    const beforeWithoutRevision = { ...before, revision: 0 };
    const afterWithoutRevision = { ...record, revision: 0 };
    if (JSON.stringify(beforeWithoutRevision) === JSON.stringify(afterWithoutRevision)) {
      record.revision = before.revision;
      result = clone(record);
      return raw || JSON.stringify(index) + '\n';
    }
    index.revision += 1;
    result = clone(record);
    return JSON.stringify(index, null, 2) + '\n';
  });
  return result;
}

function resolveStatus(result) {
  if (!result || typeof result !== 'object') return 'outcome_unknown';
  const status = String(result.status || '').toLowerCase();
  if (status === 'succeeded' || status === 'success' || result.found === true && result.complete === true) return 'succeeded';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'running' || status === 'submitted') return 'running';
  return 'outcome_unknown';
}

/** Resolve an uncertain attempt from a provider lookup without submitting a new request. */
async function reconcile(dir, ref, resolver, options = {}) {
  const current = read(dir, ref);
  if (!current) throw fail('Operation not found.', 'OPERATION_NOT_FOUND');
  if (current.status !== 'outcome_unknown') return current;
  const result = typeof resolver === 'function' ? await resolver(clone(current)) : resolver;
  const status = resolveStatus(result);
  if (status === 'outcome_unknown') return read(dir, ref) || current;
  return mark(dir, current.operationId, status, result || {}, {
    ...options,
    expectedRevision: current.revision,
    expectedStatus: 'outcome_unknown',
  });
}

function retry(dir, ref, input = {}, options = {}) {
  const current = read(dir, ref);
  if (!current) throw fail('Operation not found.', 'OPERATION_NOT_FOUND');
  if (current.status === 'outcome_unknown' || ACTIVE.has(current.status)) throw fail('Reconcile the prior operation before retrying.', 'OPERATION_UNCERTAIN');
  if (current.status === 'succeeded') return { record: current, created: false, duplicate: true };
  return prepare(dir, {
    ...current,
    ...input,
    idempotencyKey: current.idempotencyKey,
    logicalOperationId: current.logicalOperationId,
    operationId: undefined,
  }, { ...options, retry: true });
}

module.exports = {
  VERSION,
  INDEX_NAME,
  STATUSES,
  prepare,
  read,
  list,
  mark,
  reconcile,
  retry,
  file: indexFile,
  fingerprint: hash,
};
