// Shared event-envelope and usage helpers.
//
// Local writers must agree on identity and on the fields that may cross the telemetry boundary.
// This module deliberately has no provider or network dependency. It is safe to use from hooks.
const crypto = require('crypto');

const MAX_TEXT = 500;
const EVENT_NAMES = new Set([
  'job.routed', 'state.transitioned', 'gate.decided', 'job.rated', 'revision.opened',
  'credits.tallied', 'tokens.observed', 'tool.completed', 'operation.started',
  'operation.completed', 'decision.recorded', 'decision.consumed', 'provider.charge',
  'retry.recorded', 'delivery.recorded', 'campaign.reported', 'turn.observed',
  'research.checked', 'task.completed', 'validation.completed',
]);

// Optimization events are deliberately smaller than the local event envelope. These are
// the only fields that may cross into Gate for the W4 measurement contract. IDs, versions,
// roles, statuses and reason codes are opaque identifiers; evidence text and source content
// never belong in this contract.
const OPTIMIZATION_EVENT_ATTRS = Object.freeze({
  'research.checked': Object.freeze([
    'evidencePlanRevision', 'policyVersion', 'reusedCount', 'adaptedCount', 'refreshedCount',
    'missingCount', 'excludedCount', 'searchCount', 'fetchCount', 'failedAttemptCount',
    'elapsedMs', 'completionReason',
  ]),
  'task.completed': Object.freeze([
    'taskId', 'attemptId', 'role', 'status', 'inputRevision', 'durationMs', 'stopReason',
  ]),
  'validation.completed': Object.freeze([
    'reviewTaskId', 'artifactRevision', 'blockingFindingCount', 'advisoryFindingCount',
    'correctionPassCount', 'reusedCheckCount',
  ]),
});
const OPTIMIZATION_CODE_KEYS = new Set([
  'evidencePlanRevision', 'policyVersion', 'completionReason', 'taskId', 'attemptId',
  'role', 'status', 'inputRevision', 'stopReason', 'reviewTaskId', 'artifactRevision',
]);
const OPTIMIZATION_COUNTER_KEYS = new Set([
  'reusedCount', 'adaptedCount', 'refreshedCount', 'missingCount', 'excludedCount',
  'searchCount', 'fetchCount', 'failedAttemptCount', 'elapsedMs', 'durationMs',
  'blockingFindingCount', 'advisoryFindingCount', 'correctionPassCount', 'reusedCheckCount',
]);
const OPAQUE_ID = /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/;

function optimizationAttrsValid(eventName, attrs, requireAll = true) {
  const allowed = OPTIMIZATION_EVENT_ATTRS[eventName];
  if (!allowed || !attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
  const allow = new Set(allowed);
  if (Object.keys(attrs).some(key => !allow.has(key))) return false;
  if (requireAll && allowed.some(key => attrs[key] === undefined || attrs[key] === null)) return false;
  for (const [key, value] of Object.entries(attrs)) {
    if (OPTIMIZATION_CODE_KEYS.has(key)) {
      if (typeof value !== 'string' || !OPAQUE_ID.test(value)) return false;
    } else if (OPTIMIZATION_COUNTER_KEYS.has(key)) {
      if (!Number.isSafeInteger(value) || value < 0) return false;
    }
  }
  return true;
}

// These names are intentionally broad. Token counts remain allowed, but token strings, secrets,
// prompt text, transcript text, tool payloads and generated content are never metadata.
const PRIVATE_KEY = /(?:^|_)(?:prompt|transcript|credential|password|passwd|secret|api_key|access_token|refresh_token|tool_(?:input|output|args|result)|generated_(?:content|text)|raw_(?:text|content)|message_(?:text|content)|personal_message)(?:$|_)/i;
// A short identifier such as "task-copy-1" is not a provider secret. Require the
// provider prefix to be followed by a token-sized value so opaque task IDs do not get
// silently dropped from the optimization contract.
const PRIVATE_VALUE = /(?:bearer\s+|sk-[a-z0-9]{16,}|api[_-]?key|access[_-]?token|refresh[_-]?token|password|credential)/i;

function canonicalKey(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

const clip = value => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT);
};

function safeScalar(value, key) {
  if (value === undefined || value === null || value === '') return undefined;
  if (PRIVATE_KEY.test(canonicalKey(key))) return undefined;
  if (typeof value === 'string') {
    const text = clip(value);
    return PRIVATE_VALUE.test(text) ? undefined : text;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function safeValue(value, key, depth = 0) {
  if (PRIVATE_KEY.test(canonicalKey(key))) return undefined;
  const scalar = safeScalar(value, key);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => safeValue(item, key, depth + 1))
      .filter(item => item !== undefined);
  }
  if (depth >= 1 || !value || typeof value !== 'object') return undefined;
  const out = {};
  for (const [child, childValue] of Object.entries(value)) {
    const safe = safeValue(childValue, child, depth + 1);
    if (safe !== undefined) out[child.slice(0, 80)] = safe;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeAttrs(attrs) {
  const clean = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    const safe = safeValue(value, key);
    if (safe !== undefined) clean[String(key).slice(0, 80)] = safe;
  }
  return clean;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function optionsFrom(value) {
  if (typeof value === 'string' || Array.isArray(value)) return { salt: String(value) };
  return value && typeof value === 'object' ? value : {};
}

function identityFor(job, eventName, occurredAt, subject, options) {
  const stable = options.dedupeKey || options.eventKey || options.requestId || options.messageId || options.toolUseId;
  if (stable !== undefined && stable !== null && stable !== '') {
    return [job, eventName, subject.type, subject.id, String(stable)].join('|');
  }
  const key = [job, eventName, occurredAt, subject.type + ':' + subject.id].join('|');
  return options.salt ? key + '|' + options.salt : key;
}

function eventId(job, eventName, occurredAt, subject, saltOrOptions) {
  return hash(identityFor(job, eventName, occurredAt, subject, optionsFrom(saltOrOptions)));
}

function makeEvent(job, eventName, occurredAt, subject, attrs, saltOrOptions) {
  const options = optionsFrom(saltOrOptions);
  const cleanSubject = {
    type: String(subject && subject.type || 'job').slice(0, 80),
    id: String(subject && subject.id || job).slice(0, 160),
  };
  const observedAt = options.observedAt || new Date().toISOString();
  const event = {
    eventId: options.eventId || eventId(job, eventName, occurredAt, cleanSubject, options),
    eventName: String(eventName),
    schemaVersion: 1,
    occurredAt: String(occurredAt),
    observedAt: String(observedAt),
    job: String(options.jobId || job),
    subject: cleanSubject,
    attrs: sanitizeAttrs(attrs),
  };
  const ids = ['workspaceId', 'brandId', 'jobId', 'runId', 'stage', 'operationId', 'attemptId'];
  for (const key of ids) {
    const value = key === 'jobId' ? (options[key] || job) : options[key];
    if (value !== undefined && value !== null && value !== '') event[key] = String(value).slice(0, 200);
  }
  // Ownership is supplied by the verified local job binding.  This helper never
  // invents an account when a job is still awaiting Studio authentication.
  const ownerUserId = options.ownerUserId || (options.identity && options.identity.ownerUserId);
  if (ownerUserId !== undefined && ownerUserId !== null && ownerUserId !== '') {
    event.ownerUserId = String(ownerUserId).slice(0, 200);
  }
  const ownerEmail = options.ownerEmail || (options.identity && options.identity.ownerEmail);
  if (ownerEmail !== undefined && ownerEmail !== null && ownerEmail !== '') {
    event.ownerEmail = String(ownerEmail).slice(0, 320);
  }
  if (options.actorUserId !== undefined && options.actorUserId !== null && options.actorUserId !== '') {
    event.actorUserId = String(options.actorUserId).slice(0, 200);
  }
  if (Array.isArray(options.assetRefs)) {
    event.assetRefs = options.assetRefs.slice(0, 50).map((asset) => {
      if (!asset || typeof asset !== 'object') return null;
      const pathKeys = ['path', 'localPath', 'absolutePath', 'sourcePath', 'filePath', 'rootPath'];
      if (pathKeys.some(key => Object.prototype.hasOwnProperty.call(asset, key))) return null;
      const ref = {};
      for (const key of ['assetId', 'previewUrl', 'sha256', 'mediaType', 'title']) {
        if (asset[key] !== undefined && asset[key] !== null && asset[key] !== '') ref[key] = clip(asset[key]);
      }
      if (asset.bytes !== undefined && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0) ref.bytes = asset.bytes;
      return ref;
    }).filter(asset => asset && (asset.assetId || asset.previewUrl));
  }
  for (const key of ['source', 'host', 'quality']) {
    const value = safeScalar(options[key] || (key === 'source' ? 'local' : key === 'host' ? 'unknown' : 'measured'), key);
    if (value !== undefined) event[key] = value;
  }
  return event;
}

function number(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function providerName(value) {
  const name = String(value || 'unknown').toLowerCase();
  if (name.includes('openai') || name === 'openai') return 'openai';
  if (name.includes('anthropic') || name.includes('claude')) return 'anthropic';
  if (name.includes('gemini') || name.includes('google')) return 'google';
  return name || 'unknown';
}

// Normalize native provider usage without counting cached input twice. The function accepts both
// normalizeTokenUsage(provider, usage, model) and normalizeTokenUsage({ provider, usage, model }).
function normalizeTokenUsage(providerOrInput, maybeUsage, maybeModel) {
  let provider, usage, model;
  if (typeof providerOrInput === 'string') {
    provider = providerOrInput;
    usage = maybeUsage || {};
    model = maybeModel;
  } else {
    const input = providerOrInput || {};
    provider = input.provider || input.sourceProvider || input.api || 'unknown';
    usage = input.usage || input;
    model = input.model || (usage && usage.model);
  }
  const p = providerName(provider);
  const u = usage || {};
  const details = u.prompt_tokens_details || u.input_tokens_details || u.inputTokenDetails || {};
  let inputTokens = number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokenCount);
  const outputTokens = number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.candidatesTokenCount);
  const cacheReadTokens = number(u.cache_read_input_tokens ?? u.cacheReadTokens ?? u.cached_tokens
    ?? details.cached_tokens ?? u.cache_read ?? u.cachedContentTokenCount);
  const cacheCreationTokens = number(u.cache_creation_input_tokens ?? u.cacheCreationTokens
    ?? u.cache_creation ?? u.cacheCreationTokenCount);
  // OpenAI prompt_tokens includes prompt_tokens_details.cached_tokens. Most other providers report
  // ordinary input and cache reads separately. A caller can explicitly select the semantics.
  const includesCache = u.inputIncludesCache === true || p === 'openai' || p === 'google';
  if (includesCache && cacheReadTokens) inputTokens = Math.max(0, inputTokens - cacheReadTokens);
  return {
    provider: p,
    ...(model ? { model: String(model) } : {}),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    semantics: String(u.semantics || u.usageSemantics || 'delta').toLowerCase() === 'cumulative' ? 'cumulative' : 'delta',
  };
}

function usageIdentity(record, fallback) {
  const source = record && (record.message || record.usage || record);
  const id = source && (source.requestId || source.request_id || source.messageId || source.message_id
    || source.responseId || source.response_id || source.id || source.usageId || source.usage_id);
  return id ? String(id) : (fallback ? String(fallback) : null);
}

const byTime = (a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))
  || String(a.eventId).localeCompare(String(b.eventId));

module.exports = {
  MAX_TEXT, EVENT_NAMES, clip, sanitizeAttrs, eventId, makeEvent, byTime,
  normalizeTokenUsage, usageIdentity, providerName, hash,
  OPTIMIZATION_EVENT_ATTRS, optimizationAttrsValid,
};
