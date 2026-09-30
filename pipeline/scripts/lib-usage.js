const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const events = require('./lib-events.js');

const FIELDS = {
  inputTokens: 'input', outputTokens: 'output', cacheCreationTokens: 'cacheCreation', cacheReadTokens: 'cacheRead',
};
const blank = () => Object.fromEntries(Object.keys(FIELDS).map(key => [key, 0]));
const round = n => Number(Number(n).toFixed(8));

function asOfMs(value) {
  if (value instanceof Date) return value.getTime();
  if (value === undefined || value === null || value === '') return Date.now();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function boundaryMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function operationScope(options) {
  const value = options.operationIds ?? options.operationRefs ?? options.operationScope ?? options.operations;
  if (value === undefined || value === null || value === '') return null;
  const values = Array.isArray(value) ? value : [value];
  const ids = values.map(item => String(item || '').trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function eventOperationRefs(event) {
  const attrs = event && event.attrs && typeof event.attrs === 'object' ? event.attrs : {};
  const values = [event && event.operationId, event && event.attemptId, event && event.runId,
    attrs.operationId, attrs.attemptId, attrs.runId, attrs.operationIds, attrs.operationRefs];
  return values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || '').trim()).filter(Boolean);
}

function inAccountingWindow(event, options, scopedOperations) {
  if (scopedOperations && !eventOperationRefs(event).some(ref => scopedOperations.has(ref))) {
    return { included: false, invalidTime: false };
  }
  const startMs = boundaryMs(options.start);
  const endMs = boundaryMs(options.end);
  const bounded = startMs !== null || endMs !== null || Number.isNaN(startMs) || Number.isNaN(endMs);
  if (!bounded) return { included: true, invalidTime: false };
  const occurredMs = boundaryMs(event.occurredAt);
  if (!Number.isFinite(occurredMs)) return { included: false, invalidTime: true };
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { included: false, invalidTime: false };
  if (startMs !== null && occurredMs < startMs) return { included: false, invalidTime: false };
  if (endMs !== null && occurredMs > endMs) return { included: false, invalidTime: false };
  return { included: true, invalidTime: false };
}

function validRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function rowIsValid(row, targetMs, pricing) {
  if (!row || typeof row !== 'object' || !row.model) return false;
  // The original `models` map predates dated `rows` and was intentionally
  // allowed to inherit the legacy USD default. Keep that public compatibility
  // seam while requiring an explicit currency for the newer row format.
  const legacyDefaultCurrency = pricing.legacyModels === true;
  if (!(row.source || pricing.source) || !(row.currency || pricing.currency || legacyDefaultCurrency)) return false;
  const from = row.validFrom || row.effectiveFrom || row.effectiveAt || row.asOf || pricing.validFrom || pricing.asOf;
  const until = row.validTo || row.effectiveTo || row.expiresAt || pricing.validTo || pricing.expiresAt;
  const fromMs = from ? Date.parse(String(from)) : -Infinity;
  const untilMs = until ? Date.parse(String(until)) : Infinity;
  if (pricing.requiredContext && typeof pricing.requiredContext === 'object') {
    const context = row.context || {};
    for (const [key, value] of Object.entries(pricing.requiredContext)) if (context[key] !== value) return false;
  }
  return Number.isFinite(targetMs) && Number.isFinite(fromMs) && (!Number.isFinite(untilMs) || targetMs < untilMs);
}

function readPricing(root, asOf) {
  let pricing = {};
  try { pricing = JSON.parse(fs.readFileSync(path.join(root, '.social-pipeline', 'pricing.json'), 'utf8')); } catch {}
  const targetMs = asOfMs(asOf);
  const source = typeof pricing.source === 'string' && pricing.source.trim() ? pricing.source.trim() : null;
  const currency = typeof pricing.currency === 'string' && pricing.currency.trim() ? pricing.currency.trim() : 'USD';
  const legacyModels = !Array.isArray(pricing.rows) && pricing.models && typeof pricing.models === 'object';
  const selectionPricing = { ...pricing, currency: pricing.currency || (legacyModels ? currency : undefined), legacyModels };
  const rows = Array.isArray(pricing.rows) ? pricing.rows : Object.entries(pricing.models || {}).map(([model, row]) => ({ model, ...row }));
  const selected = {};
  for (const row of rows) {
    if (!rowIsValid(row, targetMs, selectionPricing)) continue;
    if (!selected[row.model]) selected[row.model] = row;
  }
  return {
    pricing, rows, rates: selected,
    valid: Boolean(source && Number.isFinite(targetMs) && Object.keys(selected).length),
    source, currency, targetMs,
    asOf: Number.isFinite(targetMs) ? new Date(targetMs).toISOString() : null,
  };
}

function contribution(normalized, previous, fingerprint) {
  const zero = { ...normalized, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  if (!previous) return normalized;
  if (Array.isArray(previous.fingerprints) && previous.fingerprints.includes(fingerprint)) return zero;
  if (normalized.semantics !== 'cumulative') return normalized;
  return {
    ...normalized,
    inputTokens: Math.max(0, normalized.inputTokens - Number(previous.inputTokens || 0)),
    outputTokens: Math.max(0, normalized.outputTokens - Number(previous.outputTokens || 0)),
    cacheCreationTokens: Math.max(0, normalized.cacheCreationTokens - Number(previous.cacheCreationTokens || 0)),
    cacheReadTokens: Math.max(0, normalized.cacheReadTokens - Number(previous.cacheReadTokens || 0)),
  };
}

function summarize(dir, root, options = {}) {
  const window = options.accountingWindow && typeof options.accountingWindow === 'object' ? options.accountingWindow : {};
  const scopedOptions = {
    ...window,
    ...options,
    start: options.start !== undefined ? options.start : window.start,
    end: options.end !== undefined ? options.end : window.end,
  };
  const scopedOperations = operationScope(scopedOptions);
  const pricing = readPricing(root, options.asOf);
  const rates = pricing.rates;
  const models = new Map(), stages = new Map(), seenEvents = new Set(), usageRecords = new Map();
  const qualityValues = [];
  let observations = 0, invalidObservations = 0, text = '';
  try { text = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch {}
  const add = (map, key, attrs) => {
    const row = map.get(key) || blank();
    for (const field of Object.keys(FIELDS)) row[field] += attrs[field] || 0;
    map.set(key, row);
  };
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { invalidObservations++; continue; }
    if (!event || !['tokens.observed', 'token.usage'].includes(event.eventName)
      || event.job && event.job !== path.basename(dir) || event.jobId && event.jobId !== path.basename(dir)) continue;
    if (event.eventId && seenEvents.has(event.eventId)) continue;
    if (event.eventId) seenEvents.add(event.eventId);
    const windowResult = inAccountingWindow(event, scopedOptions, scopedOperations);
    if (!windowResult.included) {
      if (windowResult.invalidTime) invalidObservations++;
      continue;
    }
    const attrs = event.attrs || {};
    const raw = {};
    for (const field of Object.keys(FIELDS)) {
      if (attrs[field] === undefined) raw[field] = 0;
      else if (!Number.isSafeInteger(attrs[field]) || attrs[field] < 0) raw[field] = null;
      else raw[field] = attrs[field];
    }
    if (Object.values(raw).some(value => value === null)) { invalidObservations++; continue; }
    qualityValues.push(event.quality || attrs.quality || 'measured');
    const provider = attrs.provider || event.provider || 'unknown';
    const model = String(attrs.model || event.model || 'unknown');
    const normalized = { provider: events.providerName(provider), model, semantics: attrs.usageSemantics || 'delta', ...raw };
    const identity = attrs.requestId || attrs.messageId || attrs.usageId || event.operationId || event.attemptId || event.eventId;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ model, raw })).digest('hex');
    const prior = identity ? usageRecords.get(String(identity)) : null;
    const delta = contribution(normalized, prior, fingerprint);
    if (identity) {
      const fingerprints = prior && Array.isArray(prior.fingerprints) ? prior.fingerprints : [];
      usageRecords.set(String(identity), {
        ...normalized,
        fingerprints: [...new Set(fingerprints.concat(fingerprint))].slice(-8),
      });
    }
    add(models, model, delta);
    add(stages, event.subject && event.subject.id || event.stage || 'UNKNOWN', delta);
    observations++;
  }
  const total = blank(), rows = [], unpricedModels = [];
  let known = 0;
  for (const [model, counts] of models) {
    const rate = rates[model] || {};
    const missing = [];
    let cost = 0, pricedTokens = 0;
    for (const [field, priceKey] of Object.entries(FIELDS)) {
      total[field] += counts[field];
      if (!counts[field]) continue;
      if (!validRate(rate[priceKey])) missing.push(priceKey);
      else { cost += counts[field] * rate[priceKey] / 1e6; pricedTokens += counts[field]; }
    }
    if (missing.length) unpricedModels.push(model);
    known += cost;
    rows.push({ model, provider: events.providerName(rate.provider || 'unknown'), ...counts,
      priceRow: rates[model] ? model : null, currency: rates[model]?.currency || pricing.currency,
      context: rates[model]?.context || null,
      costUsd: missing.length ? null : round(cost), knownCostUsd: round(cost), pricedTokens, missingRates: missing,
      priceSource: rates[model]?.source || pricing.source,
      priceAsOf: rates[model]?.asOf || rates[model]?.effectiveAt || rates[model]?.validFrom || null });
  }
  const coverage = observations === 0 ? 'unavailable'
    : (invalidObservations || qualityValues.some(q => ['partial', 'unavailable', 'missing'].includes(q)) ? 'partial' : 'measured');
  const complete = observations > 0 && coverage === 'measured' && !unpricedModels.length && !invalidObservations;
  return {
    observations, invalidObservations,
    stages: [...stages].map(([stage, counts]) => ({ stage, ...counts })),
    models: rows, total,
    costUsd: complete ? round(known) : null,
    knownCostUsd: round(known),
    costStatus: complete ? 'complete' : (observations && known > 0 ? 'partial' : 'unavailable'),
    coverage, unpricedModels, prices: rates, pricesFrom: '.social-pipeline/pricing.json',
    priceAsOf: pricing.asOf, priceSource: pricing.source, currency: pricing.currency,
    note: 'Estimated API usage cost at the supplied exact-model rates; not a provider bill or subscription charge.',
  };
}

module.exports = { summarize, readPricing, contribution, FIELDS };
