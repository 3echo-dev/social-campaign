// Resolve revision records by the task that produces the affected artifact.
//
// Older jobs stored only a numeric targetStage.  That number described a row in a
// particular workflow, not the producer of a particular artifact, so the same revision
// could be sent to a different specialist when the workflow changed.  New records use
// semantic task keys and artifact references.  This module keeps the old shape readable
// while making ambiguous legacy records fail closed.
const path = require('path');
const execution = require('./lib-execution-availability.js');

const LEGACY_STAGE_TARGETS = Object.freeze({
  '1': 'intake.route',
  '2': 'plan.freeze',
  '2a': 'source.extract',
  '2b': 'source.analyze',
  '3': 'research.evidence',
  '3b': 'research.evidence',
  '3c': 'research.promote',
  '4': 'strategy.brief',
  '4b': 'strategy.brief',
  '5': 'creative.concepts',
  '6': 'creative.storyboard',
  '6b': 'creative.media-spec',
  '6c': 'creative.creator-brief',
  '7': 'media.render',
  '8': 'media.qa',
  '9': 'draft.copy',
  '9a': 'validation.brand-marks',
  '9b': 'validation.qc',
  '9c': 'validation.mechanical',
  '10': 'review.editor',
  '10c': 'validation.mechanical',
  '11': 'review.editor',
  '12': 'human.content-gate',
  '13': 'campaign.proposal',
  '14': 'campaign.activation',
  '15': 'handoff.build',
});

const ARTIFACT_HINTS = [
  [/^research\/(?:watch-report|source-watch(?:\.md|\/))/i, 'source.extract'],
  [/^research\/video-analysis\.md$/i, 'source.analyze'],
  [/^video-analysis\.md$/i, 'source.analyze'],
  [/^research\/(?:audience|competitors|product-evidence|customer)\.md$/i, 'research.evidence'],
  [/^brief\.md$/i, 'strategy.brief'],
  [/^concepts\.md$/i, 'creative.concepts'],
  [/^drafts\/D\d+\/(?:script|storyboard|generation-manifest)\.\w+$/i, 'creative.storyboard'],
  [/^drafts\/D\d+\/creator-brief\.md$/i, 'creative.creator-brief'],
  [/^drafts\/D\d+\/post\.md$/i, 'draft.copy'],
  [/^media\/D\d+\//i, 'media.render'],
  [/^validation\/video-qa\.md$/i, 'media.qa'],
  [/^validation\/brand-marks\.json$/i, 'validation.brand-marks'],
  [/^validation\/qc-checklist\.md$/i, 'validation.qc'],
  [/^validation\/platform-check\.json$/i, 'validation.mechanical'],
  [/^validation\/(?:fact-check|brand-check|policy-check)\.md$/i, 'review.editor'],
  [/^campaign\/requirements\.md$/i, 'campaign.requirements'],
  [/^campaign\/proposal\.md$/i, 'campaign.proposal'],
  [/^campaign\/activation-checklist\.md$/i, 'campaign.activation'],
  [/^handoff\//i, 'handoff.build'],
];

function canonicalArtifactRef(value) {
  let ref = String(value || '').trim().replace(/\\/g, '/');
  ref = ref.replace(/^\.\//, '').replace(/^\/+/, '');
  // These two references were used by the first workflow tables.  Keep their history
  // readable while making every new contract point at one canonical location.
  if (ref === 'video-analysis.md') ref = 'research/video-analysis.md';
  if (ref === 'research/source-watch/report.md') ref = 'research/source-watch.md';
  return ref;
}

function canonicalArtifactRefs(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(canonicalArtifactRef).filter(Boolean))];
}

function taskKeyForArtifact(ref) {
  const canonical = canonicalArtifactRef(ref);
  for (const [pattern, taskKey] of ARTIFACT_HINTS) {
    if (pattern.test(canonical)) return taskKey;
  }
  return null;
}

function taskList(plan) {
  if (Array.isArray(plan)) return plan;
  if (plan && Array.isArray(plan.tasks)) return plan.tasks;
  if (plan && Array.isArray(plan.contracts)) return plan.contracts;
  return [];
}

function stageOf(contract) {
  return contract && (contract.stageNumber || contract.stage || contract.row || contract.legacyStage);
}

function outputsOf(contract) {
  return canonicalArtifactRefs(contract && (contract.outputRefs || contract.outputs || contract.artifactRefs));
}

function taskMatchesRef(contract, ref) {
  const wanted = canonicalArtifactRef(ref);
  return outputsOf(contract).some(output => {
    if (output === wanted || (output.endsWith('/') && wanted.startsWith(output)) ||
        (wanted.endsWith('/') && output.startsWith(wanted))) return true;
    if (output.includes('*')) {
      const pattern = '^' + output.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
      return new RegExp(pattern).test(wanted);
    }
    return false;
  });
}

function findByTask(tasks, taskKey) {
  return tasks.filter(task => String(task.taskKey || task.key || '') === taskKey);
}

class RevisionTargetError extends Error {
  constructor(message, code = 'INVALID_REVISION_TARGET', details = {}) {
    super(message);
    this.name = 'RevisionTargetError';
    this.code = code;
    Object.assign(this, details);
  }
}

function legacyTaskKey(revision) {
  const stage = String(revision && revision.targetStage || '').trim();
  return LEGACY_STAGE_TARGETS[stage] || null;
}

/**
 * Resolve a revision against a frozen task-contract list.
 *
 * The result always includes a semantic taskKey and canonical artifactRefs.  A legacy
 * numeric target is accepted only when it identifies one task in the supplied plan.
 */
function resolveRevisionTarget(revision, plan) {
  if (!revision || typeof revision !== 'object') {
    throw new RevisionTargetError('A revision object is required.', 'INVALID_REVISION');
  }
  const tasks = taskList(plan);
  const refs = canonicalArtifactRefs(revision.artifactRefs || revision.artifacts || revision.scope || revision.artifact);
  const requestedTask = String(revision.targetTask || revision.taskKey || '').trim();
  const byTask = requestedTask ? findByTask(tasks, requestedTask) : [];
  if (requestedTask && tasks.length && !byTask.length) {
    throw new RevisionTargetError('Revision target task "' + requestedTask + '" is not in the frozen plan.',
      'UNKNOWN_REVISION_TASK', { requestedTask, refs });
  }

  let candidates = byTask.length ? byTask : tasks.filter(task => refs.some(ref => taskMatchesRef(task, ref)));
  const legacy = !requestedTask && Boolean(revision.targetStage);
  const legacyKey = legacyTaskKey(revision);
  if (!requestedTask && !candidates.length && legacyKey) {
    const exactStage = tasks.filter(task => String(stageOf(task)) === String(revision.targetStage));
    candidates = exactStage.length ? exactStage :
      tasks.filter(task => String(task.taskKey || task.key || '') === legacyKey);
  }

  if (!candidates.length) {
    const inferred = refs.map(taskKeyForArtifact).filter(Boolean);
    const unique = [...new Set(inferred)];
    if (unique.length === 1) {
      candidates = [{ taskKey: unique[0], outputRefs: refs, legacyStage: revision.targetStage || null }];
    } else if (unique.length > 1) {
      throw new RevisionTargetError('Revision artifacts point to more than one producer task: ' + unique.join(', ') + '.',
        'AMBIGUOUS_REVISION_TARGET', { refs, candidates: unique });
    }
  }
  if (!candidates.length) {
    throw new RevisionTargetError('Revision does not identify a producer task or known artifact.',
      'MISSING_REVISION_TARGET', { refs, targetStage: revision.targetStage || null });
  }
  if (candidates.length > 1) {
    throw new RevisionTargetError('Revision target is ambiguous across ' + candidates.map(c => c.taskKey || c.key).join(', ') + '.',
      'AMBIGUOUS_REVISION_TARGET', { refs, candidates: candidates.map(c => c.taskKey || c.key) });
  }

  const selected = candidates[0];
  const taskKey = String(selected.taskKey || selected.key || requestedTask || legacyKey || '').trim();
  if (!taskKey) throw new RevisionTargetError('Resolved revision task has no semantic key.', 'INVALID_REVISION_TARGET');
  const availability = execution.checkExecutionAvailability({ taskKey, row: selected });
  if (!availability.available) {
    throw new RevisionTargetError(availability.message, 'RETIRED_REVISION_TASK', { taskKey });
  }
  const selectedRefs = refs.length ? refs : outputsOf(selected);
  return {
    taskKey,
    artifactRefs: selectedRefs,
    stageNumber: stageOf(selected) || revision.targetStage || null,
    legacy,
    legacyTargetStage: legacy ? String(revision.targetStage) : null,
    reasonCode: revision.reasonCode || null,
    correctionPass: Number.isSafeInteger(revision.correctionPass) ? revision.correctionPass : 0,
  };
}

function semanticRevision(revision, plan) {
  const target = resolveRevisionTarget(revision, plan);
  return {
    ...revision,
    targetTask: target.taskKey,
    artifactRefs: target.artifactRefs,
    // Keep targetStage for old consumers, but never make it the only destination in a
    // newly written record.
    targetStage: target.stageNumber == null ? null : String(target.stageNumber),
    legacyTargetStage: target.legacyTargetStage,
  };
}

module.exports = {
  LEGACY_STAGE_TARGETS,
  ARTIFACT_HINTS,
  RevisionTargetError,
  canonicalArtifactRef,
  canonicalArtifactRefs,
  taskKeyForArtifact,
  legacyTaskKey,
  resolveRevisionTarget,
  semanticRevision,
};
