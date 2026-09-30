// Dependency and mechanical-result invalidation helpers.
//
// A changed artifact invalidates only tasks that consume it, plus their downstream
// dependents.  This is deliberately a small graph helper rather than a second scheduler.
const crypto = require('crypto');
const { canonicalArtifactRef, canonicalArtifactRefs } = require('./lib-revision-targets.js');

function listOf(plan) {
  if (Array.isArray(plan)) return plan;
  if (plan && Array.isArray(plan.tasks)) return plan.tasks;
  if (plan && Array.isArray(plan.contracts)) return plan.contracts;
  return [];
}

function sameRef(a, b) {
  const left = canonicalArtifactRef(a);
  const right = canonicalArtifactRef(b);
  const matches = (pattern, value) => {
    if (!pattern.includes('*')) return false;
    const expression = '^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
    return new RegExp(expression).test(value);
  };
  return left === right || (left.endsWith('/') && right.startsWith(left)) ||
    (right.endsWith('/') && left.startsWith(right)) || matches(left, right) || matches(right, left);
}

function inferableRef(ref) {
  const value = canonicalArtifactRef(ref);
  // A bare directory is a read boundary, not proof that every artifact in it is a
  // dependency.  Explicit contract edges carry those stage relationships.
  return !(value.endsWith('/') && !value.includes('*'));
}

function buildDependencyGraph(plan) {
  const tasks = listOf(plan);
  const graph = new Map();
  for (const task of tasks) {
    const key = String(task.taskKey || task.key || '');
    if (!key) continue;
    const entry = graph.get(key) || { taskKey: key, dependsOn: new Set(), dependents: new Set(), inputRefs: [], outputRefs: [] };
    entry.inputRefs = canonicalArtifactRefs(task.inputRefs || task.contextRefs);
    entry.outputRefs = canonicalArtifactRefs(task.outputRefs || task.outputs || task.artifactRefs);
    // Contracts record the bounded downstream invalidation list for their task.  Convert
    // that list into graph edges here so changing an upstream caption never walks back into
    // research or strategy.
    graph.set(key, entry);
  }
  for (const task of tasks) {
    const key = String(task.taskKey || task.key || '');
    const entry = graph.get(key);
    if (!entry) continue;
    for (const dependentKey of task.dependencies || []) {
      const dependent = graph.get(String(dependentKey));
      if (!dependent) continue;
      entry.dependents.add(dependent.taskKey);
      dependent.dependsOn.add(entry.taskKey);
    }
  }
  // Infer edges from artifact ownership when a contract did not carry an explicit edge.
  for (const task of graph.values()) {
    for (const other of graph.values()) {
      if (task === other) continue;
      if (task.inputRefs.some(input => inferableRef(input) && other.outputRefs.some(output => inferableRef(output) && sameRef(input, output)))) {
        task.dependsOn.add(other.taskKey);
      }
    }
  }
  for (const task of graph.values()) {
    for (const dep of task.dependsOn) {
      const upstream = graph.get(dep);
      if (upstream) upstream.dependents.add(task.taskKey);
    }
  }
  return graph;
}

function affectedTaskKeys(plan, changedRefs, options = {}) {
  const graph = buildDependencyGraph(plan);
  const refs = canonicalArtifactRefs(changedRefs);
  const impacted = new Set();
  const queue = [];
  for (const task of graph.values()) {
    const direct = refs.some(ref => task.inputRefs.some(input => sameRef(ref, input)) ||
      (options.includeOutputs && task.outputRefs.some(output => sameRef(ref, output))));
    if (direct) { impacted.add(task.taskKey); queue.push(task.taskKey); }
  }
  while (queue.length) {
    const key = queue.shift();
    for (const dependent of graph.get(key).dependents) {
      if (impacted.has(dependent)) continue;
      impacted.add(dependent);
      queue.push(dependent);
    }
  }
  return [...impacted];
}

function invalidateTasks(plan, changedRefs, tasks = []) {
  const affected = new Set(affectedTaskKeys(plan, changedRefs, { includeOutputs: true }));
  return tasks.map(task => ({
    ...task,
    status: affected.has(task.taskKey || task.key) ? 'invalidated' : task.status,
    invalidation: affected.has(task.taskKey || task.key) ? {
      changedRefs: canonicalArtifactRefs(changedRefs),
      reason: 'dependency_changed',
    } : task.invalidation,
  }));
}

function mechanicalCacheKey(input = {}) {
  const stable = {
    artifactHash: input.artifactHash || null,
    dependencyHashes: Object.fromEntries(Object.entries(input.dependencyHashes || {}).sort()),
    checkerVersion: input.checkerVersion || null,
    ruleVersion: input.ruleVersion || null,
    check: input.check || null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function canReuseMechanicalResult(result, input = {}) {
  if (!result || result.result === 'not run' || result.status === 'invalidated') return false;
  return result.cacheKey === mechanicalCacheKey(input);
}

function cachedResult(result, input = {}) {
  return {
    ...result,
    cacheKey: mechanicalCacheKey(input),
    artifactHash: input.artifactHash || null,
    dependencyHashes: input.dependencyHashes || {},
    checkerVersion: input.checkerVersion || null,
    ruleVersion: input.ruleVersion || null,
  };
}

module.exports = {
  buildDependencyGraph,
  affectedTaskKeys,
  invalidateTasks,
  mechanicalCacheKey,
  canReuseMechanicalResult,
  cachedResult,
  sameRef,
};
