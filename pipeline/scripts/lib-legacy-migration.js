'use strict';

// Versioned compatibility for jobs created before performance review was removed.
//
// The migration is intentionally conservative. Preview reads only. Apply takes the job state
// lock, captures the original plan and state, checks the expected revision again, and records
// each phase so an interrupted run can resume without repeating accepted work.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const durable = require('./lib-durable.js');
const states = require('./lib-states.js');
const { stateIn, revisionIn } = require('./lib-open-job.js');
const handoff = require('./lib-handoff-validation.js');
const availability = require('./lib-execution-availability.js');

const MIGRATION_VERSION = 1;
const MIGRATION_ID = 'performance-review-removal';
const RETIRED_STATES = new Set(['HANDED_OFF', 'METRICS_PENDING', 'REPORT_DRAFTED', 'AWAITING_REPORT_APPROVAL']);
const MARKER_DIR = path.join('migration', MIGRATION_ID + '-v' + MIGRATION_VERSION);
const MARKER_FILE = path.join(MARKER_DIR, 'marker.json');
const RETIRED_TASK_RE = /(?:performance[ _-]*(?:review|report|analysis)|metrics?[ _-]*(?:import|upload|collect|settle|report)|settlement|platform results|learnings?[ _-]*promot)/i;

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function hashText(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }
function markerPath(jobDir) { return path.join(jobDir, MARKER_FILE); }
function originalPath(jobDir, name) { return path.join(jobDir, MARKER_DIR, 'original-' + name); }

function jobFiles(jobDir) {
  return {
    job: readJson(path.join(jobDir, 'job.json')) || {},
    route: readJson(path.join(jobDir, 'route.json')) || null,
    status: readText(path.join(jobDir, 'status.md')) || '',
    plan: readText(path.join(jobDir, 'plan.md')),
    contracts: readJson(path.join(jobDir, 'task-contracts.json')),
  };
}

function isReviewOnly(jobDir, data = jobFiles(jobDir)) {
  const kind = String(data.job.kind || '').toLowerCase().replace(/-/g, '_');
  const workflow = String(data.route && data.route.workflowId || '').toLowerCase();
  return kind === 'performance_review' || kind === 'performance_report' ||
    workflow === 'performance-review' || workflow === 'performance_review';
}

function hostedGateNames(data, reviewOnly) {
  const gates = Array.isArray(data.route && data.route.gates) ? data.route.gates : [];
  // Only the retired report decision is eligible for administrative withdrawal.  Generic
  // content/report wording remains a valid production gate and must not be disabled by name.
  const names = gates.filter(gate => String(gate).trim().toLowerCase() === 'report');
  if (reviewOnly && !names.length) names.push('report');
  return [...new Set(names)];
}

function hostedGateRequirement(jobDir, data, reviewOnly, terminal) {
  if (terminal) return null;
  const gates = hostedGateNames(data, reviewOnly);
  if (!gates.length) return null;
  // A route's historical gate list alone does not prove that a hosted card was ever opened.
  // When the workspace has no Gate connection or local hosted-decision evidence, the local
  // cancellation can proceed while preserving the old route.  If a connection is present,
  // apply must obtain an administrative withdrawal attestation before changing state.
  const root = statusRoot(jobDir);
  const configured = fs.existsSync(path.join(root, 'gate-app.json'));
  const localDecision = gates.some(gateName => {
    const dir = path.join(jobDir, 'approvals');
    try {
      return fs.readdirSync(dir).filter(file => file.startsWith(gateName + '-') && file.endsWith('.json'))
        .some(file => {
          const record = readJson(path.join(dir, file));
          return Boolean(record && record.gateAppDecisionId);
        });
    } catch { return false; }
  });
  if (!configured && !localDecision) return null;
  return {
    required: true,
    gates,
    reason: 'Withdraw each open hosted report decision through the Gate administrative withdrawal route before changing local state.',
  };
}

function stateInfo(status) {
  const state = stateIn(status);
  const revision = revisionIn(status);
  return { state, revision, valid: Boolean(state && states.exists(state) && revision !== null) };
}

function cells(line) { return line.split('|').slice(1, -1).map(value => value.trim()); }

// The shared availability module also classifies the retired Creator brief route.  That is
// correct for execution guards, but this migration must remove only performance-review work.
// A preserved Creator brief job is historical input and must never be rewritten as AI work.
function isRetiredPerformanceDescriptor(row) {
  if (!row || typeof row !== 'object') return false;
  const key = String(row.taskKey || row.key || row.id || row.Task || row.task || '').trim().toLowerCase();
  if (availability.isRetiredTaskKey(key) && !/creator/.test(key)) return true;
  const agent = String(row.Agent || row.agent || row.owner || row.Owner || '').trim().toLowerCase();
  const role = String(row.Role || row.role || '').trim().toLowerCase();
  if ([agent, role].some(value => value === 'analyst' || value === 'performance' || value === 'performance-specialist')) return true;
  const stage = String(row.Stage || row.stage || '').trim().toLowerCase();
  if (/^metrics(?:[-_ ]|$)/.test(stage)) return true;
  const artifacts = [row.Artifact, row.artifact, row.output, row.outputRef, row.outputRefs]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim().replace(/\\/g, '/'));
  if (artifacts.some(value => /^metrics\/.+\.json$/i.test(value))) return true;
  const semantic = [row.Stage, row.stage, row.Task, row.task, row.name, row.workflowId]
    .filter(value => value !== undefined && value !== null).map(String).map(value => value.trim().toLowerCase());
  return semantic.some(value => /^(?:performance[-_ ]+(?:review|report|analysis)|metrics[-_ ]+(?:import|observe|settle|report|review|analysis))$/.test(value));
}

function retiredPlanRow(header, row) {
  const value = (name) => {
    const i = header.indexOf(name);
    return i >= 0 ? String(row[i] || '') : '';
  };
  const state = value('State after').replace(/`/g, '').trim();
  const stage = value('Stage');
  const task = value('Task');
  const artifact = value('Artifact');
  const skills = value('Skills');
  // Use the shared task classifier for semantic fields.  A generic production receipt or
  // report artifact is retained; only the retired performance task, agent, stage, or output
  // is removed from an executable plan.
  return RETIRED_STATES.has(state) || isRetiredPerformanceDescriptor({
    State: state, Stage: stage, Task: task, Artifact: artifact, Skills: skills,
  });
}

function stripRetiredRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    return { value: route, changed: false, removed: [] };
  }
  const value = JSON.parse(JSON.stringify(route));
  const removed = [];
  if (Array.isArray(value.requiredDisciplines)) {
    const retained = value.requiredDisciplines.filter(item => {
      const retired = String(item).trim().toLowerCase() === 'performance';
      if (retired) removed.push({ field: 'requiredDisciplines', value: item });
      return !retired;
    });
    value.requiredDisciplines = retained;
  }
  if (Array.isArray(value.support)) {
    const retained = value.support.filter(item => {
      const normalized = String(item).trim().toLowerCase().replace(/_/g, '-');
      const retired = normalized === 'analyst' || normalized === 'performance' || normalized === 'performance-specialist';
      if (retired) removed.push({ field: 'support', value: item });
      return !retired;
    });
    value.support = retained;
  }
  if (Array.isArray(value.gates)) {
    const retained = value.gates.filter(item => {
      const retired = String(item).trim().toLowerCase() === 'report';
      if (retired) removed.push({ field: 'gates', value: item });
      return !retired;
    });
    value.gates = retained;
  }
  if (!removed.length) return { value: route, changed: false, removed: [] };
  value.compatibility = {
    ...(value.compatibility && typeof value.compatibility === 'object' ? value.compatibility : {}),
    migration: MIGRATION_ID,
    version: MIGRATION_VERSION,
    removed: removed.map(item => item.field + ':' + item.value),
  };
  return { value, changed: true, removed };
}

function stripRetiredPlan(plan) {
  if (typeof plan !== 'string') return { text: plan, changed: false, removedRows: [], retainedRows: [] };
  const lines = plan.split(/\r?\n/);
  let header = null;
  let inTable = false;
  const removedRows = [];
  const retainedRows = [];
  const output = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (header && inTable) inTable = false;
      output.push(line);
      continue;
    }
    const row = cells(line);
    if (!header && row.includes('State after')) { header = row; inTable = true; output.push(line); continue; }
    if (header && inTable) {
      if (row.every(value => /^:?-+:?$/.test(value))) { output.push(line); continue; }
      if (retiredPlanRow(header, row)) { removedRows.push(row); continue; }
      retainedRows.push(row);
      output.push(line);
      continue;
    }
    output.push(line);
  }
  const text = output.join('\n');
  return { text, changed: removedRows.length > 0, removedRows, retainedRows };
}

function contractIsRetired(contract) {
  const key = String(contract && (contract.taskKey || contract.key) || '').toLowerCase();
  if (availability.isRetiredTaskKey(key)) return true;
  const row = {
    taskKey: key,
    stage: contract && contract.stage,
    task: contract && contract.task,
    name: contract && contract.name,
    outputRefs: contract && contract.outputRefs,
    agent: contract && (contract.agent || contract.owner),
    role: contract && contract.role,
  };
  return isRetiredPerformanceDescriptor(row) || RETIRED_TASK_RE.test([
    contract && contract.task, contract && contract.stage,
    ...(Array.isArray(contract && contract.outputRefs) ? contract.outputRefs : []),
  ].join(' '));
}

function stripRetiredContracts(value) {
  if (!value || typeof value !== 'object') return { value, changed: false, removed: [] };
  const source = Array.isArray(value.tasks) ? value.tasks : (Array.isArray(value.contracts) ? value.contracts : null);
  if (!source) return { value, changed: false, removed: [] };
  const removed = source.filter(contractIsRetired);
  if (!removed.length) return { value, changed: false, removed: [] };
  const copy = JSON.parse(JSON.stringify(value));
  const key = Array.isArray(copy.tasks) ? 'tasks' : 'contracts';
  copy[key] = copy[key].filter(contract => !contractIsRetired(contract));
  copy.compatibility = { migration: MIGRATION_ID, version: MIGRATION_VERSION, removedTaskCount: removed.length };
  return { value: copy, changed: true, removed };
}

function semanticRetired(value) {
  const text = String(value || '').trim().toLowerCase();
  return availability.isRetiredTaskKey(text) || RETIRED_TASK_RE.test(text);
}

// Checkpoint fields are remapped by semantic task identity. Artifact references and accepted
// outputs remain untouched, so a completed production task is never run a second time.
function remapCheckpoint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: input, changed: false, remapped: [] };
  const value = JSON.parse(JSON.stringify(input));
  const remapped = [];
  const taskKeys = new Set(['taskKey', 'targetTask', 'currentTask', 'nextTask', 'task', 'semanticTask']);
  const walk = (node, parentKey = '') => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === 'string' && taskKeys.has(key) && semanticRetired(child)) {
        remapped.push({ field: key, from: child, to: 'handoff.build' });
        node[key] = 'handoff.build';
      } else if (typeof child === 'string' && ['currentStep', 'nextAction', 'step', 'stage'].includes(key) && semanticRetired(child)) {
        remapped.push({ field: key, from: child, to: 'handoff.build' });
        node[key] = 'Handoff package and delivery verification';
      } else if (child && typeof child === 'object') walk(child, key);
    }
  };
  walk(value);
  const current = String(value.currentStep || value.step || '');
  const next = String(value.nextAction || '');
  if ((RETIRED_TASK_RE.test(current) || RETIRED_TASK_RE.test(next)) && !remapped.length) {
    remapped.push({ field: 'currentStep', from: current || next, to: 'handoff.build' });
    if (Object.prototype.hasOwnProperty.call(value, 'currentStep')) value.currentStep = 'Handoff package and delivery verification';
    if (Object.prototype.hasOwnProperty.call(value, 'nextAction')) value.nextAction = 'Verify the existing handoff evidence before production completion.';
  }
  if (remapped.length) {
    value.compatibility = { migration: MIGRATION_ID, version: MIGRATION_VERSION,
      remappedAt: new Date().toISOString(), remappedTasks: remapped };
  }
  return { value, changed: remapped.length > 0, remapped };
}

function checkpointCandidates(jobDir) {
  const files = ['memory.json', 'checkpoint.json', 'task-checkpoint.json', 'session.json'];
  const checkpointDir = path.join(jobDir, 'checkpoints');
  try {
    for (const file of fs.readdirSync(checkpointDir)) if (/\.json$/i.test(file)) files.push(path.join('checkpoints', file));
  } catch {}
  return [...new Set(files)].map(relative => ({ relative, file: path.join(jobDir, relative) }))
    .filter(item => fs.existsSync(item.file));
}

function previewCheckpoint(jobDir) {
  const result = [];
  for (const item of checkpointCandidates(jobDir)) {
    const raw = readText(item.file);
    const parsed = readJson(item.file);
    const mapped = remapCheckpoint(parsed);
    if (mapped.changed) result.push({ relative: item.relative.replace(/\\/g, '/'), hash: hashText(raw), next: JSON.stringify(mapped.value, null, 2) + '\n', remapped: mapped.remapped });
  }
  return result;
}

function previewJob(jobDir) {
  const data = jobFiles(jobDir);
  const info = stateInfo(data.status);
  const reviewOnly = isReviewOnly(jobDir, data);
  const terminal = states.isTerminal(info.state);
  const plan = stripRetiredPlan(data.plan);
  const contracts = stripRetiredContracts(data.contracts);
  // A completed review is history.  Rebinding its checkpoint would make a preserved record
  // look executable again, so only unfinished review records are considered for cancellation.
  const checkpoints = reviewOnly ? [] : previewCheckpoint(jobDir);
  const route = stripRetiredRoute(data.route);
  const delivery = handoff.validateHandoff(jobDir, {
    brand: data.job.brand,
    jobId: data.job.jobId || path.basename(jobDir),
    requireDelivery: true,
  });
  const immutableDelivery = handoff.isVerifiedDelivered(jobDir, { brand: data.job.brand, jobId: data.job.jobId, state: info.state });
  const actions = [];
  let targetState = null;
  if (reviewOnly && !terminal) {
    actions.push({ type: 'cancel_review_job', reason: 'performance_review_removed' });
    targetState = 'CANCELLED';
  } else if (!reviewOnly && (RETIRED_STATES.has(info.state) || info.state === 'HANDOFF_READY')) {
    if (delivery.ok) {
      actions.push({ type: 'complete_delivered_production', reason: 'performance_review_removed' });
      targetState = 'COMPLETE';
    } else {
      const recoveryScript = info.state === 'HANDOFF_READY' ? 'complete-job.js' : 'recover-delivery.js';
      actions.push({
        type: 'recovery_required', reason: 'verified_handoff_evidence_missing',
        recoveryCommand: 'node scripts/' + recoveryScript + ' ' +
          JSON.stringify(data.job.brand || path.basename(path.dirname(path.dirname(jobDir)))) + ' ' +
          JSON.stringify(data.job.jobId || path.basename(jobDir)) +
          ' --delivery-ref <actual-delivery-reference> --by <producer>',
      });
    }
  }
  const hostedGates = hostedGateRequirement(jobDir, data, reviewOnly, terminal);
  if (hostedGates) actions.push({ type: 'withdraw_hosted_gates', gates: hostedGates.gates });
  if (!reviewOnly && plan.changed) actions.push({ type: 'rewrite_plan', removedRows: plan.removedRows.length });
  if (!reviewOnly && route.changed) actions.push({ type: 'rewrite_route', removed: route.removed.length });
  if (!reviewOnly && contracts.changed) actions.push({ type: 'rewrite_task_contracts', removedTasks: contracts.removed.length });
  for (const checkpoint of checkpoints) actions.push({ type: 'remap_checkpoint', path: checkpoint.relative, remapped: checkpoint.remapped });
  if (terminal && reviewOnly) actions.push({ type: 'preserve_completed_history' });
  return {
    migration: MIGRATION_ID,
    version: MIGRATION_VERSION,
    brand: data.job.brand || path.basename(path.dirname(path.dirname(jobDir))),
    jobId: data.job.jobId || path.basename(jobDir),
    dir: jobDir,
    reviewOnly,
    state: info.state,
    revision: info.revision,
    validState: info.valid,
    terminal,
    statusHash: hashText(data.status),
    planHash: data.plan === null ? null : hashText(data.plan),
    routeHash: data.route ? hashText(readText(path.join(jobDir, 'route.json'))) : null,
    taskContractsHash: data.contracts ? hashText(readText(path.join(jobDir, 'task-contracts.json'))) : null,
    delivery: {
      current: delivery.ok,
      immutable: immutableDelivery,
      manifestHash: delivery.manifestHash || null,
      reference: delivery.delivery && delivery.delivery.reference || null,
      errors: delivery.errors,
    },
    actions,
    targetState,
    hostedGates,
    revisedRoute: !reviewOnly && route.changed ? route.value : null,
    revisedPlan: !reviewOnly && plan.changed ? plan.text : null,
    revisedContracts: !reviewOnly && contracts.changed ? contracts.value : null,
    checkpoints,
    changed: actions.some(action => action.type !== 'preserve_completed_history'),
  };
}

function jobsFor(root, brand, jobId) {
  if (brand && jobId) return [ws.jobDir(brand, jobId, ['--root', root])];
  const brands = brand ? [brand] : ws.listBrands(['--root', root]);
  return brands.flatMap(item => ws.listJobs(item, ['--root', root]).map(job => ws.jobDir(item, job, ['--root', root])));
}

function preview(root, options = {}) {
  const jobs = [];
  for (const dir of jobsFor(root, options.brand, options.jobId)) {
    if (!fs.existsSync(path.join(dir, 'status.md'))) continue;
    jobs.push(previewJob(dir));
  }
  return { migration: MIGRATION_ID, version: MIGRATION_VERSION, root: path.resolve(root), generatedAt: new Date().toISOString(), jobs };
}

function writeMarker(file, marker) { durable.atomicWrite(file, JSON.stringify(marker, null, 2) + '\n'); }

function writeExpected(file, expectedHash, text, timeoutMs = 0) {
  const release = durable.acquire(file, { timeoutMs, staleMs: 10000 });
  try {
    const current = readText(file);
    const currentHash = current === null ? null : hashText(current);
    const nextHash = hashText(text);
    if (currentHash !== expectedHash && currentHash !== nextHash) throw new Error('A compatibility input changed while the migration was preparing it.');
    if (currentHash !== nextHash) durable.atomicWrite(file, text);
  } finally { release(); }
}

function preserveOriginal(jobDir, sourceName, raw) {
  const destination = originalPath(jobDir, sourceName);
  const existing = readText(destination);
  if (existing !== null) {
    if (hashText(existing) !== hashText(raw)) throw new Error('Original migration audit copy was changed: ' + sourceName);
  } else durable.atomicWrite(destination, raw);
  return path.relative(jobDir, destination).replace(/\\/g, '/');
}

function statusRoot(jobDir) { return path.resolve(jobDir, '..', '..', '..', '..'); }

function transition(jobDir, root, entry, target) {
  const args = [path.join(__dirname, 'set-state.js'), jobDir, target, '--by', 'compatibility migration',
    '--compatibility', '--reason', target === 'CANCELLED' ? 'performance_review_removed' : 'legacy_delivery_reconciled',
    '--expect-state', entry.state, '--expect-revision', String(entry.revision), '--root', root];
  if (target === 'COMPLETE') args.push('--delivery-ref', entry.delivery.reference);
  args.push('--note', target === 'CANCELLED'
    ? 'Stopped by the system because performance review was removed from this build. Historical artifacts and usage are preserved.'
    : 'Production completion reconciled from a validated delivered handoff. Performance review is not included in this build.');
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
  if (run.status !== 0) throw new Error('State reconciliation failed: ' + String(run.stderr || run.stdout || '').trim());
  return String(run.stdout || '').trim();
}

function withdrawHostedGates(jobDir, entry, options = {}) {
  if (!entry.hostedGates || !entry.hostedGates.gates || !entry.hostedGates.gates.length) {
    return { status: 'not_required', gates: [] };
  }
  const script = path.join(__dirname, 'withdraw-hosted-gates.js');
  const args = [script, jobDir, '--gates', entry.hostedGates.gates.join(','), '--by', 'compatibility-migration',
    '--root', options.root || statusRoot(jobDir), '--json'];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: options.gateTimeoutMs || 15000 });
  let result = null;
  try { result = JSON.parse(String(run.stdout || '')); } catch {}
  if (run.status !== 0 || !result || result.ok !== true) {
    const detail = String((result && (result.error || result.message)) || run.stderr || run.stdout || '').trim();
    throw new Error('Hosted review-gate withdrawal is required before this migration can continue.' +
      (detail ? ' ' + detail : ' Configure the Gate administrative withdrawal route and retry.'));
  }
  return result;
}

function applyJob(entry, options = {}) {
  const jobDir = path.resolve(entry.dir);
  const root = path.resolve(options.root || statusRoot(jobDir));
  const markerFile = markerPath(jobDir);
  const existingMarker = readJson(markerFile);
  if (existingMarker && existingMarker.status === 'applied' && existingMarker.version === MIGRATION_VERSION) {
    return { ...entry, applied: true, alreadyApplied: true, marker: existingMarker };
  }
  const gateWithdrawal = existingMarker && existingMarker.gateWithdrawal && existingMarker.gateWithdrawal.status === 'complete'
    ? existingMarker.gateWithdrawal
    : withdrawHostedGates(jobDir, entry, { ...options, root });
  const statusFile = path.join(jobDir, 'status.md');
  const release = durable.acquire(statusFile, { timeoutMs: options.timeoutMs === undefined ? 0 : options.timeoutMs, staleMs: 10000 });
  let marker;
  let stateOutput = '';
  try {
    const status = readText(statusFile) || '';
    const info = stateInfo(status);
    const stateAlreadyTarget = Boolean(existingMarker && entry.targetState && info.state === entry.targetState &&
      ['state_pending', 'ready_to_finalize', 'applied'].includes(existingMarker.phase));
    if (!info.valid || (!stateAlreadyTarget && (info.state !== entry.state || info.revision !== entry.revision))) {
      throw new Error('The job changed since preview. Preview it again before applying compatibility changes.');
    }
    const data = jobFiles(jobDir);
    const currentPlanHash = data.plan === null ? null : hashText(data.plan);
    const revisedPlanHash = entry.revisedPlan === null ? null : hashText(entry.revisedPlan);
    if (currentPlanHash !== entry.planHash && currentPlanHash !== revisedPlanHash) throw new Error('plan.md changed since preview.');
    const currentRouteHash = data.route === null ? null : hashText(readText(path.join(jobDir, 'route.json')));
    const revisedRouteHash = entry.revisedRoute === null ? null : hashText(JSON.stringify(entry.revisedRoute, null, 2) + '\n');
    if (currentRouteHash !== entry.routeHash && currentRouteHash !== revisedRouteHash) throw new Error('route.json changed since preview.');
    if (entry.taskContractsHash !== null) {
      const currentContracts = readText(path.join(jobDir, 'task-contracts.json'));
      const revisedContractsHash = entry.revisedContracts === null ? null : hashText(JSON.stringify(entry.revisedContracts, null, 2) + '\n');
      if (hashText(currentContracts) !== entry.taskContractsHash && hashText(currentContracts) !== revisedContractsHash) throw new Error('task-contracts.json changed since preview.');
    }
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    const priorOriginals = existingMarker && existingMarker.originals && typeof existingMarker.originals === 'object'
      ? existingMarker.originals : {};
    const originalOrKeep = (key, sourceName, raw) => {
      if (priorOriginals[key]) {
        if (readText(path.join(jobDir, priorOriginals[key])) === null) throw new Error('Original migration audit copy is missing: ' + priorOriginals[key]);
        return priorOriginals[key];
      }
      return preserveOriginal(jobDir, sourceName, raw);
    };
    const originals = {
      status: originalOrKeep('status', 'status.md', status),
      ...(data.route ? { route: originalOrKeep('route', 'route.json', readText(path.join(jobDir, 'route.json'))) } : {}),
      ...(data.plan !== null ? { plan: originalOrKeep('plan', 'plan.md', data.plan) } : {}),
      ...(data.contracts ? { taskContracts: originalOrKeep('taskContracts', 'task-contracts.json', readText(path.join(jobDir, 'task-contracts.json'))) } : {}),
    };
    const checkpointOriginals = {};
    for (const checkpoint of entry.checkpoints || []) {
      const raw = readText(path.join(jobDir, checkpoint.relative));
      if (raw !== null) {
        const auditName = 'checkpoint-' + checkpoint.relative.replace(/[\\/]/g, '--');
        if (priorOriginals.checkpoints && priorOriginals.checkpoints[checkpoint.relative]) {
          const saved = priorOriginals.checkpoints[checkpoint.relative];
          if (readText(path.join(jobDir, saved)) === null) throw new Error('Original migration audit copy is missing: ' + saved);
          checkpointOriginals[checkpoint.relative] = saved;
        } else checkpointOriginals[checkpoint.relative] = preserveOriginal(jobDir, auditName, raw);
      }
    }
    if (Object.keys(checkpointOriginals).length) originals.checkpoints = checkpointOriginals;
    marker = existingMarker || {
      migration: MIGRATION_ID, version: MIGRATION_VERSION, status: 'in_progress', phase: 'prepared',
      jobId: entry.jobId, brand: entry.brand, sourceState: entry.state, sourceRevision: entry.revision,
      sourceStatusHash: entry.statusHash, sourceRouteHash: entry.routeHash, sourcePlanHash: entry.planHash, originals,
      startedAt: new Date().toISOString(), actions: entry.actions,
    };
    marker = { ...marker, gateWithdrawal: gateWithdrawal.status === 'not_required'
      ? { status: 'not_required', gates: [] }
      : { status: 'complete', ...gateWithdrawal } };
    writeMarker(markerFile, marker);

    if (entry.revisedRoute !== null && marker.phase === 'prepared') {
      writeExpected(path.join(jobDir, 'route.json'), entry.routeHash, JSON.stringify(entry.revisedRoute, null, 2) + '\n', options.timeoutMs || 0);
      marker = { ...marker, phase: 'route_reconciled', routeRevisedAt: new Date().toISOString() };
      writeMarker(markerFile, marker);
    }
    if (entry.revisedPlan !== null && (marker.phase === 'prepared' || marker.phase === 'route_reconciled')) {
      writeExpected(path.join(jobDir, 'plan.md'), entry.planHash, entry.revisedPlan, options.timeoutMs || 0);
      marker = { ...marker, phase: 'plan_reconciled', planRevisedAt: new Date().toISOString() };
      writeMarker(markerFile, marker);
    }
    if (entry.revisedContracts !== null && (marker.phase === 'prepared' || marker.phase === 'route_reconciled' || marker.phase === 'plan_reconciled')) {
      const file = path.join(jobDir, 'task-contracts.json');
      writeExpected(file, entry.taskContractsHash, JSON.stringify(entry.revisedContracts, null, 2) + '\n', options.timeoutMs || 0);
      marker = { ...marker, phase: 'contracts_reconciled', contractsRevisedAt: new Date().toISOString() };
      writeMarker(markerFile, marker);
    }
    for (const checkpoint of entry.checkpoints || []) {
      const file = path.join(jobDir, checkpoint.relative);
      writeExpected(file, checkpoint.hash, checkpoint.next, options.timeoutMs || 0);
      marker = { ...marker, phase: 'checkpoint_reconciled', checkpoint: checkpoint.relative };
      writeMarker(markerFile, marker);
    }
    marker = { ...marker, phase: entry.targetState ? 'state_pending' : 'ready_to_finalize' };
    writeMarker(markerFile, marker);
  } finally { release(); }

  if (entry.targetState) {
    const now = stateInfo(readText(statusFile) || '');
    if (now.state === entry.targetState) {
      stateOutput = 'State was already reconciled to ' + entry.targetState + '.';
    } else {
      if (now.state !== entry.state || now.revision !== entry.revision) throw new Error('The job changed before compatibility state reconciliation.');
      stateOutput = transition(jobDir, root, entry, entry.targetState);
    }
  }
  marker = { ...(readJson(markerFile) || marker), status: 'applied', phase: 'applied', appliedAt: new Date().toISOString(), stateOutput };
  writeMarker(markerFile, marker);
  return { ...entry, applied: true, alreadyApplied: false, marker };
}

function apply(root, plan, options = {}) {
  const previewPlan = plan && Array.isArray(plan.jobs) ? plan : preview(root, options);
  const selected = options.jobId ? previewPlan.jobs.filter(job => job.jobId === options.jobId) : previewPlan.jobs;
  const results = [];
  for (const entry of selected) {
    if (!entry.changed) { results.push({ ...entry, applied: false, skipped: true }); continue; }
    results.push(applyJob(entry, { ...options, root }));
  }
  return { migration: MIGRATION_ID, version: MIGRATION_VERSION, root: path.resolve(root), appliedAt: new Date().toISOString(), jobs: results };
}

module.exports = {
  MIGRATION_VERSION, MIGRATION_ID, MARKER_DIR, MARKER_FILE,
  markerPath, isReviewOnly, stripRetiredPlan, stripRetiredRoute, stripRetiredContracts, remapCheckpoint,
  previewCheckpoint, previewJob, preview, applyJob, apply,
};
