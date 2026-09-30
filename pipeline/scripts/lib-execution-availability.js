'use strict';

// One small policy for deciding whether a current pipeline operation may execute.
// Historical job and route files remain readable, but their old performance paths never
// become executable merely because a registry entry or a saved task still names them.

const fs = require('fs');
const path = require('path');

const PERFORMANCE_UNSUPPORTED = 'Performance review is not included in this build.';
const CREATOR_BRIEF_UNSUPPORTED = 'Creator briefs are not included in this build.';

const RETIRED_JOB_KINDS = new Set(['performance_review', 'performance-review']);
const RETIRED_WORKFLOW_IDS = new Set(['performance-review', 'performance_review']);
const RETIRED_STATES = new Set(['HANDED_OFF', 'METRICS_PENDING', 'REPORT_DRAFTED', 'AWAITING_REPORT_APPROVAL']);
const RETIRED_CREATOR_BRIEF_MODES = new Set(['creator', 'creator_brief', 'real_creator']);
const RETIRED_CREATOR_BRIEF_SOURCES = new Set(['creator', 'creator_brief', 'real_creator']);
const RETIRED_CREATOR_BRIEF_TASK_KEYS = new Set([
  'creative.creator-brief',
  'creative.creator_brief',
  'creator.brief',
  'creator_brief',
  'creator-brief',
]);

// These keys are retained here even when an old plan or plugin contract is supplied by a
// caller.  A saved task must not regain permission to execute after its registry entry is gone.
const RETIRED_TASK_KEYS = new Set([
  'performance.report',
  'performance.review',
  'performance.analyze',
  'performance.analysis',
  'performance.import',
  'metrics.import',
  'metrics.observe',
  'metrics.settle',
  'metrics.report',
  'learning.promote',
  'learnings.promote',
]);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function creatorValue(value) {
  return normalized(value).replace(/[\s-]+/g, '_');
}

function taskKeyOf(input) {
  if (!input || typeof input !== 'object') return '';
  return normalized(input.taskKey || (input.contract && input.contract.taskKey));
}

function isRetiredPerformanceTaskKey(taskKey) {
  return RETIRED_TASK_KEYS.has(normalized(taskKey));
}

function isRetiredCreatorBriefTaskKey(taskKey) {
  return RETIRED_CREATOR_BRIEF_TASK_KEYS.has(normalized(taskKey)) ||
    creatorValue(taskKey) === 'creative_creator_brief';
}

function isRetiredTaskKey(taskKey) {
  // Keep this legacy helper performance-only for the performance migration. Creator brief
  // records remain readable there; execution callers use the explicit creator classifier.
  return isRetiredPerformanceTaskKey(taskKey);
}

function isRetiredExecutionTaskKey(taskKey) {
  return isRetiredPerformanceTaskKey(taskKey) || isRetiredCreatorBriefTaskKey(taskKey);
}

function isRetiredCreatorBriefSource(value) {
  return RETIRED_CREATOR_BRIEF_SOURCES.has(creatorValue(value));
}

function isRetiredCreatorBriefMode(value) {
  return RETIRED_CREATOR_BRIEF_MODES.has(creatorValue(value));
}

function isRetiredCreatorBriefJob(job) {
  if (!job || typeof job !== 'object') return false;
  const deliverables = Array.isArray(job.deliverables) ? job.deliverables : [];
  if (deliverables.some(deliverable => deliverable && (
    isRetiredCreatorBriefSource(deliverable.ugcSource) ||
    isRetiredCreatorBriefMode(deliverable.mode) ||
    isRetiredCreatorBriefMode(deliverable.ugcMode)))) return true;
  return [job.ugcSource, job.ugcMode, job.creatorMode, job.deliverableMode]
    .some(isRetiredCreatorBriefSource);
}

function isRetiredCreatorBriefRoute(route) {
  if (!route || typeof route !== 'object') return false;
  const modes = Array.isArray(route.deliverableModes) ? route.deliverableModes : [];
  if (modes.some(mode => mode && isRetiredCreatorBriefMode(mode.mode))) return true;
  return [route.ugcSource, route.ugcMode, route.creatorMode, route.deliverableMode]
    .some(isRetiredCreatorBriefMode);
}

function isRetiredCreatorBriefTaskDescriptor(row) {
  if (!row || typeof row !== 'object') return false;
  const key = normalized(row.taskKey || row.key || row.id || row.Task || row.task);
  if (isRetiredCreatorBriefTaskKey(key)) return true;

  const artifacts = [row.Artifact, row.artifact, row.output, row.outputRef, row.outputRefs]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim().replace(/\\/g, '/'));
  if (artifacts.some(value => /^(?:drafts\/D[^/]+\/)?creator[-_]brief\.md$/i.test(value))) return true;

  const semantic = [row.Stage, row.stage, row.Task, row.task, row.name, row.workflowId]
    .filter(value => value !== undefined && value !== null).map(String).map(normalized);
  return semantic.some(value => /^(?:creator[-_ ]brief|real[-_ ]creator(?:[-_ ]brief)?)$/.test(value));
}

function isRetiredPerformanceTaskDescriptor(row) {
  if (!row || typeof row !== 'object') return false;

  // Only inspect fields whose schema gives them task meaning.  Looking at one flattened
  // sentence made a retained campaign receipt such as "metrics report" look like a retired
  // analyst task.  Saved plans use these same column names, while old JSON contracts use the
  // compact key aliases below.
  const key = normalized(row.taskKey || row.key || row.id || row.Task || row.task);
  if (isRetiredPerformanceTaskKey(key)) return true;

  const agent = normalized(row.Agent || row.agent || row.owner || row.Owner);
  const role = normalized(row.Role || row.role);
  if ([agent, role].some(value => value === 'analyst' || value === 'performance' ||
      value === 'performance-specialist')) return true;

  const stage = normalized(row.Stage || row.stage);
  if (/^metrics(?:[-_ ]|$)/.test(stage)) return true;

  const artifacts = [row.Artifact, row.artifact, row.output, row.outputRef, row.outputRefs]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim().replace(/\\/g, '/'));
  if (artifacts.some(value => /^metrics\/.+\.json$/i.test(value))) return true;

  const semantic = [row.Stage, row.stage, row.Task, row.task, row.name, row.workflowId]
    .filter(value => value !== undefined && value !== null).map(String).map(normalized);
  return semantic.some(value => /^(?:performance[-_ ]+(?:review|report|analysis)|metrics[-_ ]+(?:import|observe|settle|report|review|analysis))$/.test(value));
}

function isRetiredTaskDescriptor(row) {
  return isRetiredPerformanceTaskDescriptor(row) || isRetiredCreatorBriefTaskDescriptor(row);
}

function failure(code, message, details = {}) {
  return { available: false, code, message, bounded: true, availabilityResult: true, ...details };
}

function checkExecutionAvailability(input = {}) {
  const job = input.job && typeof input.job === 'object' ? input.job : {};
  const route = input.route && typeof input.route === 'object' ? input.route : {};
  const workflow = input.workflow && typeof input.workflow === 'object' ? input.workflow : null;
  const kind = normalized(input.kind || job.kind || route.kind);
  const workflowId = normalized(input.workflowId || route.workflowId || (workflow && workflow.workflowId));
  const taskKey = taskKeyOf(input);

  if (RETIRED_JOB_KINDS.has(kind) || RETIRED_WORKFLOW_IDS.has(workflowId) ||
      isRetiredPerformanceTaskKey(taskKey) || isRetiredPerformanceTaskDescriptor(input.row)) {
    return failure('PERFORMANCE_REVIEW_UNSUPPORTED', PERFORMANCE_UNSUPPORTED, {
      kind: kind || null, workflowId: workflowId || null, taskKey: taskKey || null,
    });
  }

  if (isRetiredCreatorBriefJob(job) || isRetiredCreatorBriefRoute(route) ||
      isRetiredCreatorBriefTaskKey(taskKey) || isRetiredCreatorBriefTaskDescriptor(input.row)) {
    return failure('CREATOR_BRIEF_UNSUPPORTED', CREATOR_BRIEF_UNSUPPORTED, {
      kind: kind || null, workflowId: workflowId || null, taskKey: taskKey || null,
    });
  }

  // A legacy route can retain the analyst discipline even after its workflow identifier was
  // edited.  Historical decoding may read it, but no current execution boundary may use it.
  const disciplines = Array.isArray(route.requiredDisciplines) ? route.requiredDisciplines.map(normalized) : [];
  const agents = [route.owner, ...(Array.isArray(route.support) ? route.support : [])].map(normalized);
  if (disciplines.includes('performance') || agents.some(value => value === 'analyst' ||
      value === 'performance' || value === 'performance-specialist' || /\banalyst\b/.test(value))) {
    return failure('PERFORMANCE_REVIEW_UNSUPPORTED', PERFORMANCE_UNSUPPORTED, {
      kind: kind || null, workflowId: workflowId || null, taskKey: taskKey || null,
    });
  }

  const workflows = Array.isArray(input.workflows) ? input.workflows : null;
  if (workflows && workflowId) {
    const found = workflows.find(item => normalized(item && item.workflowId) === workflowId);
    if (!found) return failure('WORKFLOW_UNAVAILABLE', 'Workflow ' + workflowId + ' is not available in this build.', { workflowId });
    if (normalized(found.status) !== 'active') {
      return failure('WORKFLOW_UNAVAILABLE', 'Workflow ' + workflowId + ' is not active in this build.', { workflowId });
    }
  }

  if (workflows && kind) {
    const matches = workflows.filter(item => Array.isArray(item && item.kinds) &&
      item.kinds.map(normalized).includes(kind));
    if (!matches.length) return failure('JOB_KIND_UNAVAILABLE', 'Job kind ' + kind + ' is not available in this build.', { kind });
    if (!matches.some(item => normalized(item.status) === 'active')) {
      return failure('WORKFLOW_UNAVAILABLE', 'No active workflow is available for job kind ' + kind + '.', { kind });
    }
  }

  return { available: true, code: 'EXECUTION_AVAILABLE', bounded: true, availabilityResult: true };
}

class ExecutionAvailabilityError extends Error {
  constructor(result) {
    super(result && result.message || 'This execution is not available in the current build.');
    this.name = 'ExecutionAvailabilityError';
    this.code = result && result.code || 'EXECUTION_UNAVAILABLE';
    this.availability = result || failure(this.code, this.message);
  }
}

function assertExecutionAvailable(input = {}) {
  // Lifecycle callers often pass the result of checkJobDirectory directly.  Preserve that
  // bounded decision instead of treating its `{ available: false }` fields as arbitrary input
  // and accidentally recomputing an available result.
  const result = input && input.availabilityResult === true ? input : checkExecutionAvailability(input);
  if (!result.available) throw new ExecutionAvailabilityError(result);
  return result;
}

function readJsonRecord(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { present: true, value: null, valid: false };
    }
    return { present: true, value, valid: true };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { present: false, value: null, valid: true };
    return { present: true, value: null, valid: false };
  }
}

function checkJobDirectory(dir, options = {}) {
  const root = path.resolve(String(dir || '.'));
  const jobRecord = readJsonRecord(path.join(root, 'job.json'));
  const routeRecord = readJsonRecord(path.join(root, 'route.json'));
  if (!jobRecord.valid) {
    return failure('INVALID_JOB_RECORD', 'Execution cannot continue because job.json is missing or invalid.', { file: 'job.json' });
  }
  if (!routeRecord.valid) {
    return failure('INVALID_ROUTE_RECORD', 'Execution cannot continue because route.json is missing or invalid.', { file: 'route.json' });
  }
  if (options.requireJob && !jobRecord.present) {
    return failure('MISSING_JOB_RECORD', 'Execution cannot continue because job.json is missing.', { file: 'job.json' });
  }
  if (options.requireRoute && !routeRecord.present) {
    return failure('MISSING_ROUTE_RECORD', 'Execution cannot continue because route.json is missing.', { file: 'route.json' });
  }
  const job = jobRecord.value || {};
  const route = routeRecord.value || {};
  let state = '';
  try {
    const status = fs.readFileSync(path.join(root, 'status.md'), 'utf8');
    state = (status.match(/\*\*Current state:\*\*\s*`?([A-Z_]+)`?/i) || [])[1] || '';
  } catch {}
  if (RETIRED_STATES.has(String(state).toUpperCase())) {
    return failure('HISTORICAL_EXECUTION_UNAVAILABLE', PERFORMANCE_UNSUPPORTED, { state });
  }
  let workflows = options.workflows;
  if (workflows === undefined) {
    const registry = readJsonRecord(path.join(__dirname, '..', 'registry', 'workflows.json'));
    if (!registry.valid || !registry.value || !Array.isArray(registry.value.workflows)) {
      return failure('WORKFLOW_REGISTRY_UNAVAILABLE', 'Execution cannot continue because the workflow registry is missing or invalid.', {
        file: path.join('registry', 'workflows.json'),
      });
    }
    workflows = registry.value.workflows;
  }
  return checkExecutionAvailability({
    job: job || {}, route: route || {}, workflows,
  });
}

module.exports = {
  PERFORMANCE_UNSUPPORTED,
  RETIRED_JOB_KINDS,
  RETIRED_WORKFLOW_IDS,
  RETIRED_STATES,
  CREATOR_BRIEF_UNSUPPORTED,
  RETIRED_CREATOR_BRIEF_MODES,
  RETIRED_CREATOR_BRIEF_SOURCES,
  RETIRED_CREATOR_BRIEF_TASK_KEYS,
  RETIRED_TASK_KEYS,
  isRetiredCreatorBriefSource,
  isRetiredCreatorBriefMode,
  isRetiredCreatorBriefJob,
  isRetiredCreatorBriefRoute,
  isRetiredCreatorBriefTaskKey,
  isRetiredCreatorBriefTaskDescriptor,
  isRetiredTaskKey,
  isRetiredExecutionTaskKey,
  isRetiredTaskDescriptor,
  checkExecutionAvailability,
  assertExecutionAvailable,
  checkJobDirectory,
  ExecutionAvailabilityError,
};
