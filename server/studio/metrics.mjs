import { normalizeMetricCoverage } from './contracts.mjs';

const NUMBER_FIELDS = Object.freeze(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'elapsedMs', 'approvalWaitMs', 'blockedMs', 'processingWindowMs', 'totalCostUsd', 'recordedApiEstimateUsd', 'operationalCostUsd', 'customerCashCostUsd', 'humanCostUsd']);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function quality(value, fallback = 'missing') {
  return normalizeMetricCoverage(value, fallback);
}

function mergeCoverage(values) {
  const list = values.map((value) => quality(value)).filter(Boolean);
  if (!list.length || list.every((value) => value === 'missing')) return 'missing';
  if (list.includes('partial') || list.includes('missing')) return 'partial';
  if (list.includes('estimated')) return 'estimated';
  if (list.includes('inferred')) return 'inferred';
  if (list.includes('operator_confirmed')) return 'operator_confirmed';
  return 'measured';
}

function usageKey(event, attrs) {
  return attrs.requestId || attrs.messageId || attrs.responseId || attrs.usageId || `${event.eventId}:usage`;
}

function eventName(event) {
  return event && (event.eventName || event.event || event.name) || '';
}

function metricAttrs(event) {
  const attrs = event && (event.attrs || event.metadata || event.payload);
  return attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {};
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function intervalUnion(intervals) {
  const ordered = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = null;
  let end = null;
  for (const [from, to] of ordered) {
    if (start === null) {
      start = from;
      end = to;
    } else if (from <= end) {
      end = Math.max(end, to);
    } else {
      total += end - start;
      start = from;
      end = to;
    }
  }
  return start === null ? null : total + end - start;
}

function intervalFor(event, attrs, duration) {
  const start = timestamp(attrs.startedAt || attrs.startAt || event.startedAt);
  const end = timestamp(attrs.endedAt || attrs.endAt || attrs.completedAt || event.endedAt || event.observedAt);
  const amount = finite(duration);
  if (start !== null && end !== null) return [start, end];
  if (start !== null && amount !== null) return [start, start + amount];
  return null;
}

function addMetric(target, coverageTarget, field, value, coverage) {
  const amount = finite(value);
  if (amount === null) {
    if (target[field] === undefined) target[field] = null;
    coverageTarget.push(quality(coverage === 'measured' ? 'missing' : coverage, 'missing'));
    return;
  }
  target[field] = finite(target[field]) === null ? amount : target[field] + amount;
  coverageTarget.push(quality(coverage, 'measured'));
}

function reportCoverage(value, fallback = 'partial') {
  if (value === 'incomplete') return 'partial';
  if (value === 'unavailable') return 'missing';
  return quality(value, fallback);
}

function applyReportProjection(totals, report, coverageRows) {
  if (!report || typeof report !== 'object') return { tokens: false, timing: false, cost: false };
  const source = report.report && typeof report.report === 'object' ? report.report : report;
  const production = source.production && typeof source.production === 'object' ? source.production : {};
  const tokens = source.tokens && typeof source.tokens === 'object' ? source.tokens : {};
  const cost = source.cost && typeof source.cost === 'object' ? source.cost : {};
  const provenance = source.provenance && typeof source.provenance === 'object' ? source.provenance : {};
  const result = { tokens: false, timing: false, cost: false };
  const tokenCoverage = reportCoverage(tokens.coverage || provenance.tokenCoverage, tokens.observations ? 'measured' : 'missing');
  const timingCoverage = reportCoverage(production.quality || provenance.timingCoverage, production.recorded ? 'measured' : 'missing');
  const costCoverage = reportCoverage(cost.coverage || provenance.costCoverage, 'missing');
  const tokensAvailable = Number(tokens.observations) > 0
    || (tokens.recorded !== null && tokens.recorded !== undefined)
    || tokenCoverage !== 'missing';
  const timingAvailable = production.recorded === true || timingCoverage !== 'missing';
  for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']) {
    if (Object.prototype.hasOwnProperty.call(tokens, field)) {
      totals.tokens[field] = tokensAvailable ? finite(tokens[field]) : null;
      coverageRows.tokens.push(tokensAvailable ? reportCoverage(tokens[`${field}Coverage`], tokenCoverage) : 'missing');
      result.tokens = true;
    }
  }
  const timingValues = {
    elapsedMs: production.elapsedMs,
    approvalWaitMs: production.approvalWaitMs,
    blockedMs: production.blockedMs,
    processingWindowMs: production.processingWindowMs,
  };
  for (const [field, value] of Object.entries(timingValues)) {
    if (Object.prototype.hasOwnProperty.call(production, field)) {
      totals.timing[field] = timingAvailable ? finite(value) : null;
      coverageRows.timing.push(timingAvailable ? reportCoverage(production[`${field}Coverage`], timingCoverage) : 'missing');
      result.timing = true;
    }
  }
  const costValues = {
    totalCostUsd: cost.totalCostUsd ?? cost.totalUsd,
    recordedApiEstimateUsd: cost.recordedApiEstimateUsd,
    operationalCostUsd: cost.operationalCostUsd,
    customerCashCostUsd: cost.customerCashCostUsd,
    humanCostUsd: cost.humanCostUsd,
  };
  for (const [field, value] of Object.entries(costValues)) {
    if (value !== undefined || Object.prototype.hasOwnProperty.call(cost, field)) {
      totals.cost[field] = finite(value);
      coverageRows.cost.push(reportCoverage(cost[`${field}Coverage`], costCoverage));
      result.cost = true;
    }
  }
  return result;
}

/**
 * Normalize a metric value without turning an unavailable measurement into zero.
 */
export function metricEnvelope(input = {}) {
  const coverage = quality(input.coverage, 'missing');
  const out = {
    schemaVersion: 1,
    coverage,
    tokens: {},
    timing: {},
    cost: {},
  };
  for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']) {
    if (input[field] !== undefined) out.tokens[field] = finite(input[field]);
    out.tokens[`${field}Coverage`] = quality(input[`${field}Coverage`], input[field] === undefined ? 'missing' : coverage);
  }
  for (const field of ['elapsedMs', 'approvalWaitMs', 'blockedMs', 'processingWindowMs']) {
    if (input[field] !== undefined) out.timing[field] = finite(input[field]);
    out.timing[`${field}Coverage`] = quality(input[`${field}Coverage`], input[field] === undefined ? 'missing' : coverage);
  }
  for (const field of ['totalCostUsd', 'recordedApiEstimateUsd', 'operationalCostUsd', 'customerCashCostUsd', 'humanCostUsd']) {
    if (input[field] !== undefined) out.cost[field] = finite(input[field]);
    out.cost[`${field}Coverage`] = quality(input[`${field}Coverage`], input[field] === undefined ? 'missing' : coverage);
  }
  return out;
}

/**
 * Project acknowledged local events into board and Studio metrics.
 * Event IDs and stable request/message IDs are both deduplication keys.  A
 * missing field remains null and receives missing or partial coverage.
 */
export function projectMetrics(events = [], options = {}) {
  if (!Array.isArray(events) && events && typeof events === 'object') {
    options = events;
    events = options.events || [];
  }
  const report = options && typeof options === 'object' ? options.report : null;
  const orderedEvents = (Array.isArray(events) ? events : []).slice().sort((a, b) => String(a?.occurredAt || a?.at || '').localeCompare(String(b?.occurredAt || b?.at || '')) || String(a?.eventId || '').localeCompare(String(b?.eventId || '')));
  const seenEvents = new Set();
  const usageRecords = new Map();
  const totals = {
    schemaVersion: 1,
    eventCount: 0,
    tokens: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null },
    timing: { elapsedMs: null, approvalWaitMs: null, blockedMs: null, processingWindowMs: null },
    cost: { totalCostUsd: null, recordedApiEstimateUsd: null, operationalCostUsd: null, customerCashCostUsd: null, humanCostUsd: null },
    coverage: { tokens: 'missing', timing: 'missing', cost: 'missing' },
    partial: true,
  };
  const tokenCoverage = [];
  const timingCoverage = [];
  const costCoverage = [];
  const reportCoverageRows = { tokens: [], timing: [], cost: [] };
  const timingRows = { elapsedMs: [], approvalWaitMs: [], blockedMs: [], processingWindowMs: [] };
  const campaignRows = [];
  const costRows = [];
  for (const event of orderedEvents) {
    if (!event || typeof event !== 'object' || typeof event.eventId !== 'string' || seenEvents.has(event.eventId)) continue;
    seenEvents.add(event.eventId);
    totals.eventCount += 1;
    const name = eventName(event);
    const attrs = metricAttrs(event);
    const eventCoverage = quality(attrs.coverage || event.quality, 'missing');
    if (name === 'tokens.observed' || name === 'token.usage') {
      const key = usageKey(event, attrs);
      const current = {};
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']) current[field] = finite(attrs[field]);
      const fingerprint = JSON.stringify({ model: attrs.model || event.model || null, values: current, semantics: attrs.usageSemantics || attrs.semantics || 'delta' });
      const previous = usageRecords.get(String(key));
      let contribution = { ...current };
      const cumulative = String(attrs.usageSemantics || attrs.semantics || 'delta').toLowerCase() === 'cumulative';
      if (previous?.fingerprints?.has(fingerprint)) {
        contribution = Object.fromEntries(Object.keys(current).map((field) => [field, 0]));
      } else if (previous && cumulative) {
        contribution = Object.fromEntries(Object.keys(current).map((field) => [field, current[field] === null ? null : Math.max(0, current[field] - (previous.values[field] || 0))]));
      }
      const fingerprints = previous?.fingerprints || new Set();
      fingerprints.add(fingerprint);
      usageRecords.set(String(key), { values: current, fingerprints });
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']) addMetric(totals.tokens, tokenCoverage, field, contribution[field], attrs[`${field}Coverage`] || attrs.coverage || event.quality);
      tokenCoverage.push(eventCoverage);
    }
    if (name === 'campaign.reported') campaignRows.push({ event, attrs, eventCoverage });
    if (name === 'turn.observed' || name === 'tool.completed' || name === 'operation.completed') {
      const duration = attrs.durationMs;
      const interval = intervalFor(event, attrs, duration);
      if (interval) timingRows.elapsedMs.push(interval);
      else if (finite(duration) !== null) timingRows.elapsedMs.push([0, finite(duration)]);
      timingCoverage.push(eventCoverage);
    }
    if (name === 'provider.charge') {
      costRows.push({ event, attrs, eventCoverage });
    }
  }
  // Campaign receipts are authoritative for job-level timing and cost.  They
  // replace lower-level tool durations instead of summing overlapping windows.
  if (campaignRows.length) {
    const row = campaignRows.slice().sort((a, b) => Number(b.attrs.reportVersion || 0) - Number(a.attrs.reportVersion || 0)).at(0);
    for (const field of ['elapsedMs', 'approvalWaitMs', 'blockedMs', 'processingWindowMs']) {
      const value = finite(row.attrs[field]);
      totals.timing[field] = value;
      timingCoverage.push(row.attrs[`${field}Coverage`] || (value === null ? 'missing' : row.attrs.coverage || row.eventCoverage));
    }
    for (const field of ['totalCostUsd', 'recordedApiEstimateUsd', 'operationalCostUsd', 'customerCashCostUsd', 'humanCostUsd']) {
      const value = finite(row.attrs[field]);
      totals.cost[field] = value;
      costCoverage.push(row.attrs[`${field}Coverage`] || (value === null ? 'missing' : row.attrs.costCoverage || row.eventCoverage));
    }
  } else {
    const union = intervalUnion(timingRows.elapsedMs);
    totals.timing.elapsedMs = union;
    totals.timing.elapsedMsCoverage = union === null ? 'missing' : 'partial';
    if (union !== null) timingCoverage.push('partial');
    timingCoverage.push(timingRows.elapsedMs.length ? 'partial' : 'missing');
  }
  // An explicit provider charge is authoritative only when no campaign receipt
  // supplied a total.  Amounts in another currency are left unavailable.
  if (!campaignRows.length && costRows.length) {
    for (const row of costRows) {
      const currency = String(row.attrs.currency || 'USD').toUpperCase();
      addMetric(totals.cost, costCoverage, 'totalCostUsd', currency === 'USD' ? row.attrs.totalCostUsd ?? row.attrs.amount : null, row.attrs.coverage || row.eventCoverage);
    }
  }
  // Some native telemetry producers include a per-request API estimate.  Keep
  // it separate from provider charges and dedupe it by request/message ID.
  if (!campaignRows.length) {
    const estimates = new Set();
    for (const event of orderedEvents) {
      const name = eventName(event);
      const attrs = metricAttrs(event);
      const estimate = attrs.recordedApiEstimateUsd ?? attrs.estimatedCostUsd ?? attrs.apiCostUsd ?? attrs.costUsd;
      if (estimate === undefined) continue;
      const key = usageKey(event, attrs);
      if (estimates.has(key)) continue;
      estimates.add(key);
      addMetric(totals.cost, costCoverage, 'recordedApiEstimateUsd', estimate, attrs.coverage || event.quality);
    }
  }
  const reportProjection = applyReportProjection(totals, report, reportCoverageRows);
  totals.coverage.tokens = mergeCoverage(tokenCoverage);
  totals.coverage.timing = mergeCoverage(timingCoverage);
  totals.coverage.cost = mergeCoverage(costCoverage);
  if (reportProjection.tokens) totals.coverage.tokens = mergeCoverage(reportCoverageRows.tokens);
  if (reportProjection.timing) totals.coverage.timing = mergeCoverage(reportCoverageRows.timing);
  if (reportProjection.cost) totals.coverage.cost = mergeCoverage(reportCoverageRows.cost);
  totals.partial = [totals.coverage.tokens, totals.coverage.timing, totals.coverage.cost].some((value) => value === 'partial' || value === 'missing');
  for (const group of ['tokens', 'timing', 'cost']) {
    for (const field of NUMBER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(totals[group], field) && totals[group][field] === undefined) totals[group][field] = null;
    }
  }
  return totals;
}

/**
 * Project the event stream with the persisted campaign report when one exists.
 * The report is authoritative for job-level timing and cost because event-level
 * tool windows can overlap; token fields remain deduplicated from events unless
 * the report supplies a canonical per-field total.
 */
export function projectJobMetrics({ events = [], report = null } = {}) {
  return projectMetrics(events, { report });
}

export const __private = Object.freeze({ NUMBER_FIELDS, finite, mergeCoverage, reportCoverage, applyReportProjection });
