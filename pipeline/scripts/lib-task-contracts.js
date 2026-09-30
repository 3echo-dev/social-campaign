// Frozen task contracts for a planned workflow.
//
// The Markdown workflow remains the human-readable source table.  plan-job.js turns each
// kept row into one small JSON contract so a dispatcher can pass only the assigned inputs,
// enforce output ownership and validate completion without relying on prompt wording.
const path = require('path');
const { canonicalArtifactRefs } = require('./lib-revision-targets.js');
const execution = require('./lib-execution-availability.js');

const COMMON_FORBIDDEN = Object.freeze([
  'change_objective',
  'change_brand_profile',
  'spawn_agent',
  'write_approval',
  'publish',
  'cross_brand_read',
  'read_credentials',
  'unapproved_provider_call',
]);

const TASK_DEFAULTS = Object.freeze({
  'intake.route': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'route_job', 'checkpoint_job'],
    inputRefs: ['job.json', 'brand/profile.json'],
    contextRefs: ['job.json', 'brand/profile.json'],
    completion: 'route_is_valid_or_explicit_blocker',
  },
  'plan.freeze': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'checkpoint_job'],
    inputRefs: ['job.json', 'route.json', 'workflows/{workflowId}.md'],
    contextRefs: ['route.json', 'workflows/{workflowId}.md'],
    completion: 'plan_and_task_contracts_written',
  },
  'source.fetch': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'fetch_public'],
    inputRefs: ['job.json', 'inputs/'],
    contextRefs: ['job.json'],
    completion: 'each_source_is_read_or_named_as_unreadable',
  },
  'source.extract': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'extract_media', 'run_deterministic_checks'],
    inputRefs: ['job.json', 'inputs/'],
    contextRefs: ['job.json', 'inputs/'],
    completion: 'watch_report_and_extraction_refs_exist',
  },
  'source.analyze': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['research/watch-report.md', 'research/source-watch/'],
    contextRefs: ['research/watch-report.md', 'research/source-watch/'],
    completion: 'analysis_has_timestamped_observations_or_gaps',
  },
  'research.evidence': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'search_public', 'fetch_public'],
    inputRefs: ['job.json', 'brand/profile.json', 'brand/research.json', 'evidence/accepted-snapshot.json'],
    contextRefs: ['job.json', 'brand/profile.json', 'evidence/accepted-snapshot.json'],
    completion: 'answer_or_gap_for_each_question',
  },
  'research.promote': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'promote_validated_memory'],
    inputRefs: ['research/'],
    contextRefs: ['research/'],
    completion: 'only_validated_research_is_promoted',
  },
  'strategy.brief': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['job.json', 'brand/', 'research/'],
    contextRefs: ['job.json', 'brand/profile.json', 'brand/positioning.md', 'research/accepted-snapshot.json'],
    completion: 'brief_matches_scope_and_declares_provenance',
  },
  'creative.concepts': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['brief.md', 'brand/', 'research/accepted-snapshot.json'],
    contextRefs: ['brief.md', 'brand/brand-voice.md', 'research/accepted-snapshot.json'],
    completion: 'ranked_concepts_match_deliverables',
  },
  'creative.storyboard': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['brief.md', 'concepts.md', 'drafts/D*/script.md', 'research/video-analysis.md'],
    contextRefs: ['brief.md', 'concepts.md', 'research/video-analysis.md'],
    completion: 'board_and_manifest_match_approved_inputs',
  },
  'creative.media-spec': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['brief.md', 'brand/', 'platform-rules/'],
    contextRefs: ['brief.md', 'brand/positioning.md', 'platform-rules/'],
    completion: 'static_board_and_manifest_exist_before_generation',
  },
  'creative.creator-brief': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['brief.md', 'concepts.md', 'brand/'],
    contextRefs: ['brief.md', 'concepts.md', 'brand/brand-voice.md'],
    completion: 'creator_brief_exists_and_marks_no_generation',
  },
  'media.render': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'generate_media', 'run_deterministic_checks'],
    inputRefs: ['drafts/D*/storyboard.md', 'drafts/D*/generation-manifest.json', 'approvals/'],
    contextRefs: ['drafts/D*/storyboard.md', 'drafts/D*/generation-manifest.json', 'approvals/'],
    completion: 'approved_media_is_landed_and_validated',
  },
  'media.qa': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'run_deterministic_checks'],
    inputRefs: ['media/D*/', 'drafts/D*/script.md', 'drafts/D*/storyboard.md'],
    contextRefs: ['media/D*/', 'drafts/D*/script.md', 'drafts/D*/storyboard.md'],
    completion: 'each_render_has_go_or_specific_blocker',
  },
  'draft.copy': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['brief.md', 'brand/', 'platform-rules/', 'media/D*/', 'drafts/D*/script.md', 'campaign/requirements.md'],
    contextRefs: ['brief.md', 'brand/brand-voice.md', 'brand/audience.md', 'platform-rules/'],
    completion: 'one_coherent_copy_pass_writes_each_post',
  },
  'validation.brand-marks': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'run_deterministic_checks'],
    inputRefs: ['media/D*/', 'validation/label-check.json'],
    contextRefs: ['media/D*/'],
    completion: 'every_landed_frame_is_checked_or_marked_not_run',
  },
  'validation.qc': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'run_deterministic_checks', 'hash_artifact'],
    inputRefs: ['drafts/', 'media/', 'platform-rules/', 'validation/platform-check.json', 'validation/brand-marks.json', 'validation/label-check.json'],
    contextRefs: ['drafts/', 'validation/platform-check.json', 'validation/brand-marks.json'],
    completion: 'checklist_rows_trace_to_current_artifacts',
  },
  'validation.mechanical': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'run_deterministic_checks', 'hash_artifact'],
    inputRefs: ['drafts/', 'media/', 'platform-rules/'],
    contextRefs: ['drafts/', 'media/', 'platform-rules/'],
    completion: 'mechanical_results_match_current_artifact_revision',
  },
  'review.editor': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['drafts/', 'brief.md', 'research/accepted-snapshot.json', 'validation/'],
    contextRefs: ['drafts/', 'brief.md', 'research/accepted-snapshot.json', 'validation/'],
    completion: 'one_consolidated_review_with_blocking_or_advisory_findings',
  },
  'human.content-gate': {
    allowedCapabilities: ['read_approved_artifacts', 'hold_approval'],
    inputRefs: ['drafts/', 'media/', 'validation/'],
    contextRefs: ['drafts/', 'media/', 'validation/'],
    completion: 'decision_is_recorded_for_current_revision',
  },
  'campaign.requirements': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['job.json', 'brief.md', 'brand/', 'platform-rules/'],
    contextRefs: ['job.json', 'brief.md', 'brand/positioning.md', 'platform-rules/'],
    completion: 'paid_requirements_fit_authorized_budget',
  },
  'campaign.proposal': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'hash_artifact'],
    inputRefs: ['campaign/requirements.md', 'drafts/', 'media/', 'approvals/'],
    contextRefs: ['campaign/requirements.md', 'drafts/', 'media/', 'approvals/'],
    completion: 'proposal_maps_only_approved_creatives',
  },
  'campaign.activation': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['campaign/proposal.md', 'approvals/'],
    contextRefs: ['campaign/proposal.md', 'approvals/'],
    completion: 'checklist_is_paused_and_hash_bound',
  },
  'handoff.build': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output', 'run_deterministic_checks', 'hash_artifact'],
    inputRefs: ['route.json', 'job.json', 'drafts/', 'media/', 'campaign/', 'approvals/'],
    contextRefs: ['route.json', 'job.json', 'drafts/', 'media/', 'campaign/', 'approvals/'],
    completion: 'handoff_contains_current_approved_artifacts',
  },
  'report.write': {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: ['job.json', 'research/', 'report/stills/'],
    contextRefs: ['job.json', 'research/'],
    completion: 'report_answers_the_request_with_a_source_for_each_claim',
  },
});

const DEPENDENCIES = Object.freeze({
  'source.fetch': ['research.evidence', 'source.extract', 'source.analyze', 'report.write'],
  'research.evidence': ['strategy.brief', 'creative.concepts', 'draft.copy', 'review.editor', 'report.write'],
  'source.extract': ['source.analyze', 'creative.storyboard', 'draft.copy', 'review.editor', 'report.write'],
  'source.analyze': ['creative.storyboard', 'draft.copy', 'review.editor', 'report.write'],
  'strategy.brief': ['creative.concepts', 'creative.storyboard', 'creative.media-spec', 'draft.copy', 'review.editor'],
  'creative.concepts': ['creative.storyboard'],
  'creative.storyboard': ['media.render', 'media.qa', 'draft.copy', 'review.editor'],
  'creative.media-spec': ['media.render', 'draft.copy', 'review.editor'],
  'media.render': ['media.qa', 'draft.copy', 'validation.brand-marks', 'validation.mechanical', 'validation.qc', 'review.editor'],
  'media.qa': ['review.editor'],
  'draft.copy': ['validation.mechanical', 'validation.qc', 'review.editor', 'human.content-gate'],
  'validation.mechanical': ['validation.qc', 'review.editor'],
  'validation.qc': ['review.editor'],
  'review.editor': ['human.content-gate', 'handoff.build'],
  'campaign.requirements': ['campaign.proposal'],
  'campaign.proposal': ['campaign.activation', 'handoff.build'],
  'campaign.activation': ['handoff.build'],
});

function splitArtifacts(value) {
  if (Array.isArray(value)) return value.flatMap(splitArtifacts);
  return String(value || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
}

function rowTaskKey(row) {
  const stage = String(row && row.Stage || '').toLowerCase();
  const task = String(row && row.Task || '').toLowerCase();
  const text = stage + ' ' + task;
  if (/^sources\b/.test(stage)) return 'source.fetch';
  if (/^read the posts\b/.test(stage)) return 'research.evidence';
  if (/^write the report\b/.test(stage)) return 'report.write';
  if (/hand.?off/.test(text)) return 'handoff.build';
  if (/activation/.test(stage)) return 'campaign.activation';
  if (/proposal/.test(stage)) return 'campaign.proposal';
  if (/ad requirements/.test(text)) return 'campaign.requirements';
  if (/intake/.test(stage)) return 'intake.route';
  if (/^plan\b/.test(stage)) return 'plan.freeze';
  if (/break down|analyse|analy[sz]e source/.test(text)) return 'source.analyze';
  if (/watch|extract/.test(text)) return 'source.extract';
  if (/keep the words|promot/.test(text)) return 'research.promote';
  if (/research/.test(stage)) return 'research.evidence';
  if (/lite brief|\bbrief\b/.test(text)) return 'strategy.brief';
  if (/concept/.test(text)) return 'creative.concepts';
  if (/creator brief/.test(text)) return 'creative.creator-brief';
  if (/media spec/.test(text)) return 'creative.media-spec';
  if (/video qa|rendered.*qa/.test(text)) return 'media.qa';
  if (/\b(script|storyboard|cut plan)\b/.test(text)) return 'creative.storyboard';
  if (/^media\b/.test(stage)) return 'media.render';
  if (/^validate\b/.test(stage) || /editor review/.test(text)) return 'review.editor';
  if (/brand marks/.test(text)) return 'validation.brand-marks';
  if (/\bqc\b|qc checklist/.test(text)) return 'validation.qc';
  if (/mechanical|platform-check|hash/.test(text)) return 'validation.mechanical';
  if (/post|ad copy/.test(text)) return 'draft.copy';
  if (/validate|editor|content review/.test(text)) return 'review.editor';
  if (/content gate/.test(text)) return 'human.content-gate';
  return 'workflow.' + String(row && (row.Stage || row.Task) || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function taskDefaults(taskKey) {
  return TASK_DEFAULTS[taskKey] || {
    allowedCapabilities: ['read_assigned_inputs', 'write_task_output'],
    inputRefs: [],
    contextRefs: [],
    completion: 'assigned_artifacts_exist_and_are_validated',
  };
}

function canonicalRefsForRow(row) {
  return canonicalArtifactRefs(splitArtifacts(row && (row.Artifact || row.artifact)));
}

function contractForRow(row, options = {}) {
  const taskKey = rowTaskKey(row);
  execution.assertExecutionAvailable({
    job: options.job,
    route: options.route,
    taskKey,
    row,
  });
  const defaults = taskDefaults(taskKey);
  const outputRefs = canonicalRefsForRow(row);
  const route = options.route || {};
  const job = options.job || {};
  const stageNumber = String(row && (row['#'] || row.number || '')).trim();
  const agent = String(row && (row.Agent || row.agent || '')).trim();
  const inputRefs = canonicalArtifactRefs(options.inputRefs || defaults.inputRefs);
  const contextRefs = canonicalArtifactRefs(options.contextRefs || defaults.contextRefs);
  const forbidden = [...new Set(COMMON_FORBIDDEN.concat(
    taskKey === 'media.render' ? ['change_budget', 'activate_campaign'] : [],
    taskKey === 'human.content-gate' ? ['edit_artifact', 'self_approve'] : [],
    agent !== 'producer' ? ['run_unapproved_command', 'change_plan'] : [],
  ))];
  const contract = {
    contractVersion: '1.0',
    taskKey,
    jobId: route.jobId || job.jobId || null,
    stageNumber: stageNumber || null,
    stage: row && row.Stage || null,
    task: row && row.Task || null,
    agent: agent || null,
    role: row && row.Role || agent || null,
    owner: row && row.Owner || null,
    inputRevision: options.inputRevision || route.inputRevision || job.revision || null,
    objective: options.objective || job.request || job.title || null,
    questionIds: taskKey === 'research.evidence' && Array.isArray(options.questionIds) ? options.questionIds : [],
    inputRefs,
    contextRefs,
    outputRefs,
    allowedCapabilities: [...new Set(options.allowedCapabilities || defaults.allowedCapabilities)],
    forbiddenActions: forbidden,
    budgetRef: options.budgetRef || (taskKey === 'research.evidence' ? 'research-budget' : null),
    completion: defaults.completion,
    dependencies: [...(DEPENDENCIES[taskKey] || [])],
    correctionPass: 0,
  };
  return contract;
}

function isSafeRef(ref) {
  const value = String(ref || '').replace(/\\/g, '/');
  return Boolean(value) && !path.posix.isAbsolute(value) && !/^[a-zA-Z]:[\\/]/.test(value) &&
    !value.split('/').includes('..') && !value.includes('\0');
}

function validateTaskContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') return ['contract must be an object'];
  const availability = execution.checkExecutionAvailability({
    taskKey: contract.taskKey,
    row: contract,
  });
  if (!availability.available) errors.push(availability.message);
  for (const key of ['contractVersion', 'taskKey', 'jobId', 'agent', 'completion']) {
    if (!contract[key]) errors.push(key + ' is required');
  }
  if (!Array.isArray(contract.inputRefs)) errors.push('inputRefs must be an array');
  if (!Array.isArray(contract.outputRefs)) errors.push('outputRefs must be an array');
  if (!Array.isArray(contract.contextRefs)) errors.push('contextRefs must be an array');
  if (!Array.isArray(contract.allowedCapabilities)) errors.push('allowedCapabilities must be an array');
  if (!Array.isArray(contract.forbiddenActions)) errors.push('forbiddenActions must be an array');
  for (const key of ['inputRefs', 'outputRefs', 'contextRefs']) {
    for (const ref of contract[key] || []) if (!isSafeRef(ref)) errors.push(key + ' contains unsafe path: ' + ref);
  }
  if ((contract.allowedCapabilities || []).includes('publish') || (contract.allowedCapabilities || []).includes('external_write')) {
    errors.push('external side effects are producer-mediated and cannot be granted to task contracts');
  }
  const overlap = (contract.allowedCapabilities || []).filter(c => contract.forbiddenActions.includes(c));
  if (overlap.length) errors.push('capability is both allowed and forbidden: ' + overlap.join(', '));
  return errors;
}

function buildContracts(rows, options = {}) {
  const contracts = rows.map(row => contractForRow(row, options));
  const errors = contracts.flatMap(contract => validateTaskContract(contract).map(error => contract.taskKey + ': ' + error));
  if (errors.length) {
    const error = new Error('Invalid task contract(s):\n' + errors.join('\n'));
    error.code = 'INVALID_TASK_CONTRACT';
    error.errors = errors;
    throw error;
  }
  return contracts;
}

module.exports = {
  COMMON_FORBIDDEN,
  TASK_DEFAULTS,
  DEPENDENCIES,
  rowTaskKey,
  canonicalRefsForRow,
  contractForRow,
  validateTaskContract,
  buildContracts,
  isSafeRef,
  isRetiredTaskKey: execution.isRetiredTaskKey,
};
