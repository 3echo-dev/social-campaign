const fs = require('fs');
const path = require('path');
const { summarize } = require('./lib-usage.js');
const { timing, parseTime } = require('./lib-timing.js');
const states = require('./lib-states.js');

const money = value => value === null || value === undefined ? null : Number(Number(value).toFixed(6));

function number(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(name + ' must be a nonnegative number.');
  return value;
}

function text(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(name + ' needs a description under ' + max + ' characters.');
  return value.trim();
}

function operationIds(value, name) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 200 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 240)) {
    throw new Error(name + ' must contain at most 200 non-empty operation references.');
  }
  return [...new Set(value.map(item => item.trim()))];
}

function date(value, name, allowDateOnly = false) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' needs a date.');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(name + ' needs a valid date.');
  if (!allowDateOnly && !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error(name + ' needs an explicit timezone.');
  return new Date(parsed);
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected report inputs.');
  for (const k of ['aiCostUsd', 'generationCostUsd', 'otherCostUsd', 'humanHours', 'humanHourlyUsd',
    'operationalCostUsd', 'customerCashCostUsd', 'customerTotalEffortCostUsd', 'infrastructureCostUsd']) number(input[k], k);
  if (input.aiCostUsd != null) text(input.aiCostSource, 'Source of campaign AI cost');
  if (input.scope !== undefined) text(input.scope, 'Scope');
  if (input.approvalMilestone !== undefined) text(input.approvalMilestone, 'Approval milestone', 200);
  if (input.revisionRounds !== undefined && (!Number.isSafeInteger(input.revisionRounds) || input.revisionRounds < 0)) throw new Error('Revision rounds must be a nonnegative integer.');
  if (input.reportDate !== undefined) date(input.reportDate, 'Report date', true);
  if (input.asOf !== undefined) date(input.asOf, 'Report as-of', false);
  if (input.deliverables !== undefined && (!Array.isArray(input.deliverables) || input.deliverables.length > 50)) throw new Error('Supply at most 50 deliverables.');
  for (const item of input.deliverables || []) {
    text(item.name, 'Deliverable', 200);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Deliverable quantity must be a positive integer.');
    if (item.format !== undefined) text(item.format, 'Deliverable format', 100);
  }
  if (input.accountingWindow !== undefined) {
    const window = input.accountingWindow;
    if (!window || typeof window !== 'object') throw new Error('Accounting window needs start and end.');
    const start = date(window.start, 'Accounting window start');
    const end = date(window.end, 'Accounting window end');
    if (end < start) throw new Error('Accounting window end cannot precede its start.');
    if (window.scope !== undefined) text(window.scope, 'Accounting window scope', 500);
    operationIds(window.operationIds ?? window.operationRefs ?? window.operationScope ?? window.operations, 'Accounting window operationIds');
  }
  if (input.baseline) {
    text(input.scope, 'Shared comparison scope');
    if (!input.deliverables?.length) throw new Error('List the deliverables being compared.');
    const baseline = input.baseline;
    text(baseline.label, 'Baseline label', 200); text(baseline.source, 'Baseline source');
    date(baseline.asOf, 'Baseline asOf', true);
    if (baseline.fixedFeeUsd !== undefined) number(baseline.fixedFeeUsd, 'Baseline fixedFeeUsd');
    else for (const k of ['hours', 'hourlyUsd', 'otherCostUsd']) if (number(baseline[k], 'Baseline ' + k) === null) throw new Error('Baseline ' + k + ' is required.');
    if (baseline.roles !== undefined) {
      if (!Array.isArray(baseline.roles) || !baseline.roles.length) throw new Error('Baseline roles must contain a row.');
      for (const row of baseline.roles) {
        text(row.role, 'Baseline role', 200);
        number(row.hours, 'Baseline role hours'); number(row.hourlyUsd, 'Baseline role hourlyUsd');
      }
    }
  }
  return input;
}

function cells(line) { return line.split('|').slice(1, -1).map(value => value.trim().replace(/`/g, '')); }

function statusRows(status) {
  return status.split(/\r?\n/).map(line => cells(line)).filter(row => row.length === 5 && states.exists(row[2]));
}

function production(status, options = {}) {
  const rows = statusRows(status);
  // The first handoff boundary is the production receipt's end. Historical publication,
  // platform metrics and report approval rows remain readable but never extend this window.
  const endIndex = rows.findIndex(row => states.isDeliveryBoundary(row[2]));
  const selected = endIndex >= 0 ? rows.slice(0, endIndex + 1) : rows;
  const start = selected.length ? parseTime(selected[0][0]) : NaN;
  const end = endIndex >= 0 ? parseTime(rows[endIndex][0]) : NaN;
  const reportNow = options.asOf
    ? (Number.isFinite(parseTime(options.asOf)) ? parseTime(options.asOf) : Date.parse(options.asOf))
    : Date.now();
  const measured = timing(selected.map(row => '| ' + row.join(' | ') + ' |').join('\n'), Number.isFinite(end) ? end : reportNow);
  const complete = selected.length > 0 && selected[0][2] === 'INTAKE_PENDING' && endIndex >= 0
    && !measured.unknownTimestamps && Number.isFinite(start) && Number.isFinite(end) && end >= start;
  const closure = rows.length && rows[rows.length - 1][2] === 'COMPLETE' ? parseTime(rows[rows.length - 1][0]) : NaN;
  return {
    ...measured, milestone: endIndex >= 0 ? rows[endIndex][2] : null,
    startAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
    firstDeliveryAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
    elapsedMs: complete ? end - start : null, complete,
    fullJobDurationMs: Number.isFinite(start) && Number.isFinite(closure) && closure >= start ? closure - start : null,
    note: 'Intake to first delivery milestone, including decisions, retries and idle time. Later publishing or performance monitoring is excluded.',
    excludedAfterFirstDelivery: endIndex >= 0 ? rows.slice(endIndex + 1).map(row => row[2]) : [],
  };
}

function accountingWindow(input, productionResult) {
  if (input.accountingWindow) {
    const ids = operationIds(
      input.accountingWindow.operationIds ?? input.accountingWindow.operationRefs ?? input.accountingWindow.operationScope ?? input.accountingWindow.operations,
      'Accounting window operationIds',
    );
    return {
      start: date(input.accountingWindow.start, 'Accounting window start').toISOString(),
      end: date(input.accountingWindow.end, 'Accounting window end').toISOString(),
      scope: input.accountingWindow.scope || input.scope || null,
      ...(ids ? { operationIds: ids } : {}),
    };
  }
  return { start: productionResult.startAt || null, end: productionResult.firstDeliveryAt || null, scope: input.scope || null };
}

function baselineCost(baseline) {
  if (baseline.fixedFeeUsd != null) return money(baseline.fixedFeeUsd + (baseline.additionalCostUsd || 0));
  const roleTotal = Array.isArray(baseline.roles) && baseline.roles.length
    ? baseline.roles.reduce((sum, row) => sum + row.hours * row.hourlyUsd, 0)
    : baseline.hours * baseline.hourlyUsd;
  return money(roleTotal + baseline.otherCostUsd);
}

function report(dir, root, input = {}, options = {}) {
  validate(input);
  const status = fs.readFileSync(path.join(dir, 'status.md'), 'utf8');
  const reportDate = input.reportDate ? date(input.reportDate, 'Report date', true).toISOString().slice(0, 10)
    : (input.asOf ? date(input.asOf, 'Report asOf').toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const generatedAt = options.generatedAt || input.generatedAt || new Date().toISOString();
  const productionResult = production(status, { asOf: input.asOf || (input.accountingWindow && input.accountingWindow.end) });
  const window = accountingWindow(input, productionResult);
  const usage = summarize(dir, root, {
    asOf: input.priceAsOf || input.asOf || input.reportDate,
    start: window.start,
    end: window.end,
    operationIds: window.operationIds,
  });
  const hasExplicitCash = input.customerCashCostUsd != null || input.customerCostUsd != null;
  const aiCost = input.aiCostUsd ?? (input.usageComplete === true && usage.costStatus === 'complete' ? usage.costUsd : null);
  const generation = input.generationCostUsd ?? null;
  const other = input.otherCostUsd ?? null;
  const humanCost = input.humanHours != null && input.humanHourlyUsd != null ? input.humanHours * input.humanHourlyUsd : null;
  const customerCash = input.customerCashCostUsd ?? input.customerCostUsd
    ?? (!hasExplicitCash && aiCost != null && generation != null && other != null ? aiCost + generation + other : null);
  const operational = input.operationalCostUsd ?? (aiCost != null && generation != null
    ? aiCost + generation + (input.infrastructureCostUsd || 0) : null);
  const effort = input.customerTotalEffortCostUsd ?? (customerCash != null && humanCost != null ? customerCash + humanCost : null);
  const missing = [];
  if (customerCash === null) missing.push('Customer cash cost or a complete AI, generation and other-cost allocation');
  if (humanCost === null) missing.push('humanHours and humanHourlyUsd');
  if (generation === null && !hasExplicitCash) missing.push('generationCostUsd');
  if (other === null && !hasExplicitCash) missing.push('otherCostUsd');
  let comparison = null;
  if (input.baseline) {
    const baseline = input.baseline;
    const totalBaseline = baselineCost(baseline);
    comparison = {
      label: baseline.label, source: baseline.source, asOf: baseline.asOf,
      hours: baseline.hours ?? (baseline.roles || []).reduce((sum, row) => sum + row.hours, 0),
      hourlyUsd: baseline.hourlyUsd ?? null, otherCostUsd: baseline.otherCostUsd ?? baseline.additionalCostUsd ?? null,
      baselineCostUsd: totalBaseline,
      estimatedSavingsUsd: effort === null ? null : money(totalBaseline - effort),
      estimatedSavingsPercent: effort === null || totalBaseline <= 0 ? null : money((totalBaseline - effort) / totalBaseline * 100),
      humanHoursSaved: input.humanHours == null ? null : (baseline.hours ?? (baseline.roles || []).reduce((sum, row) => sum + row.hours, 0)) - input.humanHours,
      coverage: effort === null ? 'incomplete' : 'estimated',
      note: 'Estimate for the stated scope and rates, not a claim that quality or marketing results are equivalent.',
    };
  }
  return {
    version: 1,
    reportVersion: options.reportVersion || input.reportVersion || 1,
    generatedAt, reportDate, jobId: path.basename(dir), currency: input.currency || 'USD',
    scope: input.scope || null, deliverables: input.deliverables || [],
    revisionRounds: input.revisionRounds ?? null, approvalMilestone: input.approvalMilestone || productionResult.milestone,
    accountingWindow: window, production: productionResult,
    tokens: {
      recorded: usage.observations ? Object.values(usage.total).reduce((sum, value) => sum + value, 0) : null,
      ...usage.total, observations: usage.observations,
      coverage: input.usageComplete === true && usage.coverage === 'measured' && usage.observations ? 'operator_confirmed' : usage.coverage,
      priceAsOf: usage.priceAsOf, priceSource: usage.priceSource,
    },
    cost: {
      totalUsd: money(effort), customerTotalEffortCostUsd: money(effort),
      operationalCostUsd: money(operational), customerCashCostUsd: money(customerCash),
      aiCostUsd: aiCost == null ? null : money(aiCost), aiCostBasis: input.aiCostUsd != null ? input.aiCostSource : 'Estimated API cost from recorded usage and supplied rates',
      recordedApiEstimateUsd: usage.costUsd, priceSource: usage.priceSource, priceAsOf: usage.priceAsOf,
      generationCostUsd: generation, otherCostUsd: other,
      humanHours: input.humanHours ?? null, humanHourlyUsd: input.humanHourlyUsd ?? null, humanCostUsd: humanCost == null ? null : money(humanCost),
      currency: input.currency || 'USD', coverage: effort === null ? 'incomplete' : (input.costCoverage || 'estimated'),
      inclusionPolicy: input.costInclusionPolicy || 'Customer cash cost includes the supplied campaign allocation; human effort is added once for customer total effort.',
      missing,
    },
    comparison,
    provenance: {
      reportDate, accountingWindow: window,
      sources: ['status.md', 'events.jsonl', 'report-inputs.json', '.social-pipeline/pricing.json'],
      tokenCoverage: usage.coverage, costCoverage: effort === null ? 'incomplete' : (input.costCoverage || 'estimated'),
      priceSource: usage.priceSource, priceAsOf: usage.priceAsOf,
      qualityContext: input.qualityContext || 'Approved deliverables and production timing are reported; quality and marketing outcomes are not inferred.',
    },
  };
}

function markdown(report) {
  const usd = value => value === null ? 'Not reported or incomplete' : '$' + value.toFixed(2);
  const min = value => value === null ? 'Not fully measured' : (value / 60000).toFixed(1) + ' minutes';
  const lines = [
    '# Campaign performance', '', report.scope || 'Delivery scope has not been recorded.', '',
    'Report date: ' + report.reportDate + '. Version: ' + report.reportVersion + '.',
    'Approval milestone: ' + (report.approvalMilestone || 'Not recorded') + '. Revision rounds: ' + (report.revisionRounds ?? 'Not recorded') + '.', '',
    ...report.deliverables.map(item => '- ' + item.quantity + ' x ' + item.name + (item.format ? ' (' + item.format + ')' : '')), '',
    '| Measure | Result |', '|---|---|',
    '| Intake to delivery | ' + min(report.production.elapsedMs) + ' |',
    '| Waiting for decisions | ' + min(report.production.recorded ? report.production.approvalWaitMs : null) + ' |',
    '| Blocked time | ' + min(report.production.recorded ? report.production.blockedMs : null) + ' |',
    '| Recorded tokens (including cache) | ' + (report.tokens.recorded === null ? 'Not reported' : report.tokens.recorded.toLocaleString('en-US')) + ' |',
    '| 3Echo operational cost | ' + usd(report.cost.operationalCostUsd) + ' |',
    '| Customer cash cost | ' + usd(report.cost.customerCashCostUsd) + ' |',
    '| Customer total effort cost | ' + usd(report.cost.customerTotalEffortCostUsd) + ' |', '',
    'Token coverage: ' + report.tokens.coverage + '.', report.production.note,
    'Provenance: ' + report.provenance.sources.join(', ') + '; report date ' + report.reportDate + '.',
  ];
  if (report.cost.missing.length) lines.push('Missing costs: ' + report.cost.missing.join(', ') + '.');
  lines.push('');
  if (report.comparison) {
    lines.push('## Comparison for the same scope', '',
      report.comparison.label + ': ' + usd(report.comparison.baselineCostUsd) + '.',
      'Source: ' + report.comparison.source + ', as of ' + report.comparison.asOf + '.',
      report.comparison.estimatedSavingsUsd === null
        ? 'No savings comparison is published because the required totals are incomplete.'
        : 'Estimated savings against the supplied baseline: ' + usd(report.comparison.estimatedSavingsUsd) + '.',
      report.comparison.note, '');
  } else lines.push('A comparison needs a dated team or employee baseline for the same deliverables.', '');
  return lines.join('\n');
}

module.exports = { report, validate, markdown, production, baselineCost, accountingWindow };
