const fs = require('fs');
const path = require('path');
const durable = require('./lib-durable.js');

const POLICY_VERSION = 'research-budget-v1';
const DEFAULT_BUDGETS = Object.freeze({
  simple_post: Object.freeze({ searchLimit: 6, readLimit: 8 }),
  campaign: Object.freeze({ searchLimit: 12, readLimit: 16 }),
  brand_onboarding: Object.freeze({ searchLimit: 12, readLimit: 12 }),
  default: Object.freeze({ searchLimit: 6, readLimit: 8 }),
});
// Per-question and per-fetch ceilings shared by the brand-onboarding research pass; see
// pipeline/skills/research/SKILL.md "Hard limits".
const HARD_LIMITS = Object.freeze({
  searchesPerQuestion: 3,
  fetchAttemptsPerUrl: 1,
  fetchesPerSection: 2,
  competitors: 3,
  itemsPerCompetitor: 3,
});
const STOP_REASONS = new Set([
  'all_material_questions_covered',
  'budget_exhausted',
  'deadline_reached',
  'no_material_progress',
  'required_gap',
  'capability_denied',
  'source_unavailable',
]);

function number(value, fallback) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
}

function limits(options = {}) {
  const preset = DEFAULT_BUDGETS[options.kind] || DEFAULT_BUDGETS.default;
  const searchLimit = number(options.searchLimit, preset.searchLimit);
  const readLimit = number(options.readLimit, preset.readLimit);
  const searchAttemptsPerQuestion = number(options.searchAttemptsPerQuestion, 3);
  return {
    searchLimit,
    readLimit,
    searchAttemptsPerQuestion,
    attemptLimit: number(options.attemptLimit, searchLimit + readLimit * 2),
  };
}

function createBudget(options = {}) {
  const max = limits(options);
  const budget = {
    version: 1,
    policyVersion: options.policyVersion || POLICY_VERSION,
    budgetRef: options.budgetRef || null,
    jobId: options.jobId || null,
    limits: max,
    used: { searches: 0, reads: 0, failedAttempts: 0, attempts: 0 },
    questionSearches: {},
    gaps: [],
    stopReason: null,
    startedAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
  };
  const gap = (questionId, reason, required = true, extra = {}) => {
    const item = { questionId: questionId || null, reason: String(reason || 'Evidence was not available.'), required: Boolean(required), ...extra };
    const key = item.questionId + ':' + item.reason;
    if (!budget.gaps.some(existing => existing.questionId + ':' + existing.reason === key)) budget.gaps.push(item);
    return item;
  };
  const can = (kind, questionId) => {
    if (budget.stopReason) return false;
    if (kind === 'search') {
      const key = questionId === undefined || questionId === null ? null : String(questionId);
      if (key && (budget.questionSearches[key] || 0) >= max.searchAttemptsPerQuestion) return false;
      return budget.used.searches < max.searchLimit && budget.used.attempts < max.attemptLimit;
    }
    if (kind === 'read' || kind === 'fetch') return budget.used.reads < max.readLimit && budget.used.attempts < max.attemptLimit;
    return budget.used.attempts < max.attemptLimit;
  };
  const record = (kind, result = {}) => {
    const operation = kind === 'fetch' ? 'read' : kind;
    const questionId = result.questionId === undefined || result.questionId === null ? null : String(result.questionId);
    if (operation === 'search') {
      budget.used.searches += 1;
      if (questionId) budget.questionSearches[questionId] = (budget.questionSearches[questionId] || 0) + 1;
    }
    if (operation === 'read') budget.used.reads += result.success === false ? 0 : 1;
    budget.used.attempts += 1;
    if (result.success === false || result.failed === true) budget.used.failedAttempts += 1;
    if (budget.used.attempts >= max.attemptLimit ||
        (budget.used.searches >= max.searchLimit && budget.used.reads >= max.readLimit)) {
      budget.stopReason = budget.stopReason || 'budget_exhausted';
    }
    return can(operation, questionId);
  };
  const stop = (reason, extra = {}) => {
    const value = STOP_REASONS.has(reason) ? reason : 'no_material_progress';
    budget.stopReason = value;
    if (extra.questionId || extra.reason) gap(extra.questionId, extra.reason || value, extra.required !== false, extra);
    return result();
  };
  const result = () => ({
    ...JSON.parse(JSON.stringify(budget)),
    exhausted: budget.stopReason === 'budget_exhausted',
    remaining: {
      searches: Math.max(0, max.searchLimit - budget.used.searches),
      reads: Math.max(0, max.readLimit - budget.used.reads),
      attempts: Math.max(0, max.attemptLimit - budget.used.attempts),
    },
  });
  budget.can = can;
  budget.record = record;
  budget.gap = gap;
  budget.stop = stop;
  budget.result = result;
  return budget;
}

function budgetFile(dir, budgetRef = 'default') {
  const safe = String(budgetRef).replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'default';
  return path.join(dir, 'research', 'budgets', safe + '.json');
}

function load(dir, budgetRef, options = {}) {
  const file = budgetFile(dir, budgetRef);
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* a new shared budget starts empty */ }
  const budget = createBudget({ ...options, budgetRef });
  if (existing && existing.limits && existing.used) {
    budget.limits = existing.limits;
    budget.used = existing.used;
    budget.gaps = existing.gaps || [];
    budget.questionSearches = existing.questionSearches || {};
    budget.stopReason = existing.stopReason || null;
    budget.startedAt = existing.startedAt || budget.startedAt;
    budget.policyVersion = existing.policyVersion || budget.policyVersion;
  }
  return budget;
}

function withSharedBudget(dir, budgetRef, change, options = {}) {
  const file = budgetFile(dir, budgetRef);
  let output;
  durable.update(file, raw => {
    let existing = null;
    try { existing = raw ? JSON.parse(raw) : null; } catch { existing = null; }
    const budget = createBudget({ ...options, budgetRef });
    if (existing && existing.limits && existing.used) {
      budget.limits = existing.limits;
      budget.used = existing.used;
      budget.gaps = existing.gaps || [];
      budget.questionSearches = existing.questionSearches || {};
      budget.stopReason = existing.stopReason || null;
      budget.startedAt = existing.startedAt || budget.startedAt;
      budget.policyVersion = existing.policyVersion || budget.policyVersion;
    }
    output = change(budget) || budget.result();
    const snapshot = output && output.version ? output : budget.result();
    return JSON.stringify(snapshot, null, 2) + '\n';
  }, '');
  return output;
}

function stopResult(questionId, reason, options = {}) {
  const budget = createBudget(options);
  return budget.stop(reason, { questionId, reason, required: options.required !== false });
}

module.exports = {
  POLICY_VERSION,
  DEFAULT_BUDGETS,
  HARD_LIMITS,
  createBudget,
  budgetFile,
  load,
  withSharedBudget,
  stopResult,
};
