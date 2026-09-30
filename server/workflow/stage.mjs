/**
 * The workflow module: what has actually happened to a job, and what may happen next.
 *
 * Three rules live here and nowhere else.
 *
 * 1. Progress comes from execution records. `stage_runs` holds one row per attempt
 *    at a stage, and the current plan says which stages this job has. Everything the
 *    person sees, and everything the orchestrator decides, is rolled up from those
 *    two. Saved plan versions stay immutable: they record what was intended, never
 *    what happened.
 *
 * 2. A stage is completed by doing the work, not by saying so. `completeStage` runs
 *    in one transaction: the stage has to be one this job may work on now, its inputs
 *    have to exist, any approval it depends on has to be current, and its output
 *    artifact has to be there and valid. Only then is it marked completed. The old
 *    `stage_advance` recorded the assertion and nothing else, so a failed save left
 *    completed progress with no deliverable behind it.
 *
 * 3. Rework is explicit. `reviseFrom` marks a stage and everything downstream that
 *    depends on its output as `needs_rework` and says which artifacts that
 *    invalidates, instead of leaving stale output sitting behind a newer decision.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { commitArtifact } from '../artifacts/commit.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';
import { approvalStatus } from '../review/approvals.mjs';
import { currentRelease } from '../release/package.mjs';
import { RELEASE_OUTPUT, STAGE_IDS, stageDefinition, stageOwner } from '../planner/stages.mjs';

/** Statuses that mean a stage has no outstanding work. */
const TERMINAL = new Set(['completed', 'skipped', 'not_applicable']);

/** The statuses `stage_update` may still set by hand, and what each one means. */
export const MANUAL_STATUSES = ['skipped', 'waiting'];

/**
 * How a stage_runs status reads as a plan status.
 * @type {Record<string, string>}
 */
const RUN_TO_PLAN_STATUS = {
  running: 'required',
  failed: 'required',
  completed: 'completed',
  skipped: 'skipped',
  not_applicable: 'not_applicable',
  waiting: 'waiting',
  needs_rework: 'needs_rework',
};

/**
 * The newest saved plan for a campaign, or null.
 * @param {any} db
 * @param {string} campaignId
 * @returns {any|null}
 */
export function currentPlan(db, campaignId) {
  const row = db.prepare('SELECT json FROM job_plans WHERE campaign_id = ? ORDER BY version DESC LIMIT 1').get(campaignId);
  return row ? parseJson(String(row.json ?? '{}'), {}) : null;
}

/**
 * The latest run per stage for a campaign.
 * @param {any} db
 * @param {string} campaignId
 * @returns {Map<string, {stage: string, attempt: number, status: string, artifact_id: string|null, output_kind: string|null, output_version: number|null, note: string|null, started_at: string, completed_at: string|null}>}
 */
export function latestRuns(db, campaignId) {
  const rows = db
    .prepare('SELECT stage, attempt, status, artifact_id, output_kind, output_version, note, started_at, completed_at FROM stage_runs WHERE campaign_id = ? ORDER BY stage, attempt')
    .all(campaignId);
  /** @type {Map<string, any>} */
  const byStage = new Map();
  for (const row of rows) {
    byStage.set(String(row.stage), {
      stage: String(row.stage),
      attempt: Number(row.attempt),
      status: String(row.status),
      artifact_id: row.artifact_id ? String(row.artifact_id) : null,
      output_kind: row.output_kind ? String(row.output_kind) : null,
      output_version: row.output_version == null ? null : Number(row.output_version),
      note: row.note ? String(row.note) : null,
      started_at: String(row.started_at),
      completed_at: row.completed_at ? String(row.completed_at) : null,
    });
  }
  return byStage;
}

/**
 * Where a job actually is: the current plan's stages, in order, each carrying the
 * status its newest execution record gives it. A stage with no run yet keeps the
 * status the plan gave it, which is how a skipped or not applicable stage stays out
 * of the way without anyone having to run it.
 * @param {any} db
 * @param {string} campaignId
 * @returns {Array<{stage: string, status: string, order: number, reason: string|null, owner_agent: string|null, gate: string|null, attempt: number|null, artifact_id: string|null, started_at: string|null, completed_at: string|null}>}
 */
export function progressStages(db, campaignId) {
  const plan = currentPlan(db, campaignId);
  const planned = Array.isArray(plan?.stages) ? plan.stages : [];
  const runs = latestRuns(db, campaignId);
  return planned.map((entry, index) => {
    const id = String(entry.stage);
    const run = runs.get(id) ?? null;
    const owner = stageOwner(id);
    return {
      stage: id,
      status: run ? (RUN_TO_PLAN_STATUS[run.status] ?? String(entry.status)) : String(entry.status),
      order: Number.isFinite(entry.order) ? Number(entry.order) : index,
      reason: run?.note ?? (entry.reason ? String(entry.reason) : null),
      owner_agent: entry.owner_agent ?? owner.owner_agent,
      gate: entry.gate ?? owner.gate,
      attempt: run ? run.attempt : null,
      artifact_id: run ? run.artifact_id : null,
      output_kind: run ? run.output_kind : null,
      output_version: run ? run.output_version : null,
      started_at: run ? run.started_at : null,
      completed_at: run ? run.completed_at : null,
    };
  });
}

/**
 * The stage this job should work on next: the first with outstanding work whose own
 * inputs are already satisfied. Returns null when nothing is left.
 * @param {any} db
 * @param {string} campaignId
 * @returns {any|null}
 */
export function nextStage(db, campaignId) {
  const stages = progressStages(db, campaignId);
  return stages.find((entry) => !TERMINAL.has(entry.status)) ?? null;
}

/**
 * Whether an artifact of this kind exists for the campaign.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 */
function hasArtifact(db, campaignId, kind) {
  return Boolean(currentArtifact(db, campaignId, kind));
}

/**
 * Read a current artifact reference for a declared stage input.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} input
 * @returns {{id: string, kind: string, version: number}|null}
 */
function inputArtifactRef(db, campaignId, input) {
  const artifact = currentArtifact(db, campaignId, input);
  return artifact ? { id: artifact.id, kind: artifact.kind, version: artifact.version } : null;
}

/**
 * Whether one declared input of a stage is satisfied.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} input
 * @returns {{ok: true}|{ok: false, message: string}}
 */
function inputSatisfied(db, campaignId, input) {
  if (input === 'JobIntake') {
    return hasArtifact(db, campaignId, 'JobIntake')
      ? { ok: true }
      : { ok: false, message: 'This job has not been through intake yet.' };
  }
  if (input.startsWith('approval:')) {
    const scope = input.slice('approval:'.length);
    const status = approvalStatus(db, campaignId, scope);
    return status.approved
      ? { ok: true }
      : { ok: false, message: status.message ?? `The ${scope} approval is not current.` };
  }
  if (input === RELEASE_OUTPUT) {
    return currentRelease(db, campaignId)
      ? { ok: true }
      : { ok: false, message: 'There is no release to review yet.' };
  }
  return hasArtifact(db, campaignId, input)
    ? { ok: true }
    : { ok: false, message: `This step needs the ${input} an earlier step produces, and it is not saved yet.` };
}

/**
 * Whether a stage's own output is really there.
 * @param {any} db
 * @param {string} campaignId
 * @param {import('../planner/stages.mjs').StageDefinition} definition
 * @returns {{ok: true, artifact_id: string|null}|{ok: false, message: string}}
 */
function outputPresent(db, campaignId, definition, options = {}) {
  if (definition.gate) {
    const status = approvalStatus(db, campaignId, definition.gate);
    return status.approved
      ? { ok: true, artifact_id: status.review_id, artifact_kind: `approval:${definition.gate}`, artifact_version: null }
      : { ok: false, message: status.message ?? 'Nobody has approved this yet.' };
  }
  if (!definition.output) return { ok: true, artifact_id: null };
  if (definition.output === RELEASE_OUTPUT) {
    const release = currentRelease(db, campaignId);
    return release
      ? { ok: true, artifact_id: release.release_id, artifact_kind: RELEASE_OUTPUT, artifact_version: release.version }
      : { ok: false, message: 'The release has not been built yet, so there is nothing to review.' };
  }
  if (definition.output === 'PublishingResult') {
    const artifact = currentArtifact(db, campaignId, 'PublishingResult');
    if (!artifact) return { ok: false, message: 'There is no publishing result yet. Finish publishing or export the package first.' };
    const result = artifact.json && typeof artifact.json === 'object' ? artifact.json : {};
    const posts = Array.isArray(result.posts) ? result.posts : [];
    const outcome = String(result.outcome ?? '');
    const expectedStatus = outcome === 'exported' ? 'exported' : outcome === 'scheduled' ? 'scheduled' : outcome === 'published' ? 'published' : null;
    if (!expectedStatus || posts.length === 0 || posts.some((post) => String(post?.status ?? '') !== expectedStatus)) {
      return {
        ok: false,
        message: 'The publishing result is still pending, accepted or unclear. Check the provider or export the package before finishing this step.',
      };
    }
    return {
      ok: true,
      artifact_id: artifact.id,
      artifact_kind: 'PublishingResult',
      artifact_version: artifact.version,
    };
  }
  const row = currentArtifact(db, campaignId, definition.output);
  if (options.requireAfter && row && String(row.created_at) <= String(options.requireAfter)) {
    return {
      ok: false,
      message: `This step still only has a ${definition.output} from before the revision. Save a new result for this attempt.`,
    };
  }
  return row
    ? { ok: true, artifact_id: String(row.id), artifact_kind: String(row.kind), artifact_version: Number(row.version) }
    : { ok: false, message: `This step has not saved its ${definition.output} yet.` };
}

/**
 * Write the current status of a stage into job_stages, keeping its place in order.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 * @param {string} status
 * @param {string|null} detail
 */
function writeStageStatus(db, campaignId, stage, status, detail) {
  const existing = db.prepare('SELECT stage_order FROM job_stages WHERE campaign_id = ? AND stage = ?').get(campaignId, stage);
  const order = existing
    ? Number(existing.stage_order)
    : Number(db.prepare('SELECT MAX(stage_order) AS last FROM job_stages WHERE campaign_id = ?').get(campaignId)?.last ?? -1) + 1;
  db.prepare(
    'INSERT INTO job_stages (id, campaign_id, stage, status, stage_order, detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (campaign_id, stage) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at',
  ).run(newId(), campaignId, stage, status, order, detail, nowIso());
}

/**
 * Record one execution attempt at a stage.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 * @param {string} status
 * @param {{artifact_id?: string|null, output_kind?: string|null, output_version?: number|null, note?: string|null}} [extra]
 * @returns {number} the attempt number.
 */
export function recordRun(db, campaignId, stage, status, extra = {}) {
  const attempt =
    Number(db.prepare('SELECT MAX(attempt) AS attempt FROM stage_runs WHERE campaign_id = ? AND stage = ?').get(campaignId, stage)?.attempt ?? 0) + 1;
  const now = nowIso();
  db.prepare(
    'INSERT INTO stage_runs (id, campaign_id, stage, attempt, started_at, completed_at, status, artifact_id, output_kind, output_version, note) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    newId(),
    campaignId,
    stage,
    attempt,
    now,
    status === 'running' ? null : now,
    status,
    extra.artifact_id ?? null,
    extra.output_kind ?? null,
    extra.output_version ?? null,
    extra.note ?? null,
  );
  return attempt;
}

/**
 * Return the row id for the attempt just recorded inside the current transaction.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 * @param {number} attempt
 * @returns {string}
 */
function runId(db, campaignId, stage, attempt) {
  const row = db
    .prepare('SELECT id FROM stage_runs WHERE campaign_id = ? AND stage = ? AND attempt = ?')
    .get(campaignId, stage, attempt);
  if (!row) throw new Error(`Stage run ${campaignId}/${stage}/${attempt} was not recorded.`);
  return String(row.id);
}

/**
 * Save the exact inputs and output observed by a completed stage attempt.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stageRunId
 * @param {import('../planner/stages.mjs').StageDefinition} definition
 * @param {any} output
 */
function recordDependencies(db, campaignId, stageRunId, definition, output) {
  const insert = db.prepare(
    'INSERT INTO artifact_dependencies (id, campaign_id, stage_run_id, dependency_type, kind, artifact_id, version, review_id, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const now = nowIso();
  for (const input of definition.inputs) {
    if (input.startsWith('approval:')) {
      const scope = input.slice('approval:'.length);
      const status = approvalStatus(db, campaignId, scope);
      if (status.review_id) {
        insert.run(newId(), campaignId, stageRunId, 'approval', input, null, null, String(status.review_id), now);
      }
      continue;
    }
    const ref = inputArtifactRef(db, campaignId, input);
    if (ref) insert.run(newId(), campaignId, stageRunId, 'input', ref.kind, ref.id, ref.version, null, now);
  }
  if (output?.artifact_id && output.artifact_kind && output.artifact_version != null) {
    insert.run(
      newId(),
      campaignId,
      stageRunId,
      'output',
      String(output.artifact_kind),
      String(output.artifact_id),
      Number(output.artifact_version),
      null,
      now,
    );
  }
}

/**
 * Log a stage event, best effort. Stats read these; a logging failure must never
 * break the stage move itself.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 * @param {'started'|'completed'} phase
 */
export function recordStageEvent(db, campaignId, stage, phase) {
  try {
    db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
      newId(),
      campaignId,
      `stage.${phase}`,
      toJsonColumn({ stage }),
      nowIso(),
    );
  } catch {
    // Deliberately ignored.
  }
}

/**
 * The stage definition for a name, refusing a name that is in no route rather than
 * inventing a row for it.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 */
function requirePlannedStage(db, campaignId, stage) {
  const definition = stageDefinition(stage);
  if (!definition) {
    throw new InvalidInputError(`"${stage}" is not a step Social Campaign knows about.`, {
      fix: `Use one of the steps in this job's plan. Every step Social Campaign runs is one of: ${STAGE_IDS.join(', ')}.`,
    });
  }
  const stages = progressStages(db, campaignId);
  if (stages.length === 0) {
    throw new InvalidInputError('This job does not have a plan yet.', { fix: 'Build the plan first.' });
  }
  const entry = stages.find((item) => item.stage === stage);
  if (!entry) {
    throw new InvalidInputError(`"${stage}" is not a step in this job's plan.`, {
      fix: 'Ask for the next step instead of naming one.',
    });
  }
  return { definition, entry, stages };
}

/**
 * Complete a stage, transactionally.
 *
 * @param {object} args
 * @param {any} args.db
 * @param {string|null} [args.root] workspace root, for the artifact rules that check files.
 * @param {string} args.campaign_id
 * @param {string} args.stage
 * @param {{kind: string, json: any, path?: string|null}|null} [args.artifact] saved first, through the one commit door.
 * @returns {{ok: true, stage: string, attempt: number, artifact_id: string|null, next: any|null, remaining: number, done: boolean}}
 */
export function completeStage({ db, root = null, campaign_id, stage, artifact = null }) {
  const { definition, entry, stages } = requirePlannedStage(db, campaign_id, stage);

  if (TERMINAL.has(entry.status) && entry.status === 'completed') {
    throw new InvalidInputError('That step is already done for this job.', {
      fix: 'Ask for the next step instead.',
    });
  }

  // A stage may be worked on when nothing earlier in the plan is still holding a
  // human decision open. Analysis stages that do not depend on each other are
  // therefore free to finish in any order, but nothing runs past an unresolved gate.
  const blockingGate = stages.find(
    (item) => item.order < entry.order && item.gate && !TERMINAL.has(item.status),
  );
  if (blockingGate) {
    throw new InvalidInputError('An earlier approval on this job is still open, so this step cannot be finished yet.', {
      fix: 'Finish the approval that is waiting first.',
      details: { waiting_on: blockingGate.stage },
    });
  }

  if (artifact && definition.output && definition.output !== RELEASE_OUTPUT && String(artifact.kind) !== String(definition.output)) {
    throw new InvalidInputError(`This step produces ${definition.output}, but the supplied result is ${String(artifact.kind)}.`, {
      fix: `Save a ${definition.output} result for this step.`,
    });
  }

  db.exec('BEGIN');
  try {
    let savedArtifact = null;
    if (artifact) {
      savedArtifact = commitArtifact({
        db,
        root,
        campaign_id,
        kind: String(artifact.kind),
        json: artifact.json,
        path: artifact.path ?? null,
      });
    }

    for (const input of definition.inputs) {
      const satisfied = inputSatisfied(db, campaign_id, input);
      if (!satisfied.ok) {
        throw new InvalidInputError(`This step is not ready to be finished: ${satisfied.message}`, {
          fix: 'Finish the step that produces it first.',
          details: { stage, missing_input: input },
        });
      }
    }

    const output = outputPresent(db, campaign_id, definition, {
      requireAfter: entry.status === 'needs_rework' ? entry.started_at : null,
    });
    if (!output.ok) {
      throw new InvalidInputError(`This step cannot be marked done: ${output.message}`, {
        fix: definition.gate
          ? 'Open the approval and wait for the person to decide.'
          : 'Save what this step produced, then finish the step.',
        details: { stage, expected_output: definition.output ?? definition.gate },
      });
    }

    if (savedArtifact && (String(output.artifact_id) !== String(savedArtifact.id) || Number(output.artifact_version) !== Number(savedArtifact.version))) {
      throw new InvalidInputError('The result saved for this step is not the current version of its output.', {
        fix: 'Save the step result through stage_complete and try again.',
      });
    }

    const attempt = recordRun(db, campaign_id, stage, 'completed', {
      artifact_id: output.artifact_id,
      output_kind: output.artifact_kind ?? null,
      output_version: output.artifact_version ?? null,
    });
    recordDependencies(db, campaign_id, runId(db, campaign_id, stage, attempt), definition, output);
    writeStageStatus(db, campaign_id, stage, 'completed', null);
    db.exec('COMMIT');
    recordStageEvent(db, campaign_id, stage, 'completed');

    const next = nextStage(db, campaign_id);
    if (next) recordStageEvent(db, campaign_id, next.stage, 'started');
    const remaining = progressStages(db, campaign_id).filter((item) => !TERMINAL.has(item.status)).length;
    return { ok: true, stage, attempt, artifact_id: output.artifact_id, next, remaining, done: remaining === 0 };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction was already closed by the failure itself.
    }
    throw error;
  }
}

/**
 * Mark a stage skipped or waiting, with a reason. Anything else about a stage's
 * status is decided by doing the work, not by declaring it.
 * @param {object} args
 * @param {any} args.db
 * @param {string} args.campaign_id
 * @param {string} args.stage
 * @param {string} args.status
 * @param {string} args.reason
 */
export function markStage({ db, campaign_id, stage, status, reason }) {
  if (!MANUAL_STATUSES.includes(status)) {
    throw new InvalidInputError(`A step cannot be set to "${status}" by hand.`, {
      fix: 'Use skipped or waiting with a reason. A step becomes completed by finishing it with its result.',
    });
  }
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) {
    throw new InvalidInputError('Say why this step is being skipped or put on hold.', {
      fix: 'Send a short reason with it.',
    });
  }
  const { entry } = requirePlannedStage(db, campaign_id, stage);
  if (entry.status === 'completed') {
    throw new InvalidInputError('That step is already done, so it cannot be skipped or put on hold now.', {
      fix: 'Ask for a revision instead if the work needs redoing.',
    });
  }
  db.exec('BEGIN');
  try {
    recordRun(db, campaign_id, stage, status, { note: text });
    writeStageStatus(db, campaign_id, stage, status, text);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Already closed.
    }
    throw error;
  }
  if (status === 'waiting') recordStageEvent(db, campaign_id, stage, 'started');
  return { ok: true, campaign_id, stage, status, reason: text };
}

/**
 * Everything downstream of a stage: the stages after it in the plan whose inputs are
 * reachable from its output, walked transitively. A stage that neither takes its
 * output nor takes anything produced from it is left alone.
 * @param {Array<{stage: string, order: number}>} stages
 * @param {string} from
 * @returns {string[]}
 */
export function downstreamStages(stages, from) {
  const fromEntry = stages.find((entry) => entry.stage === from);
  if (!fromEntry) return [];
  const fromDefinition = stageDefinition(from);
  /** @type {Set<string>} */
  const tainted = new Set();
  if (fromDefinition?.output) tainted.add(fromDefinition.output);
  if (fromDefinition?.gate) tainted.add(`approval:${fromDefinition.gate}`);
  /** @type {string[]} */
  const affected = [];
  for (const entry of stages.filter((item) => item.order > fromEntry.order).sort((a, b) => a.order - b.order)) {
    const definition = stageDefinition(entry.stage);
    if (!definition) continue;
    if (!definition.inputs.some((input) => tainted.has(input))) continue;
    affected.push(entry.stage);
    if (definition.output) tainted.add(definition.output);
    if (definition.gate) tainted.add(`approval:${definition.gate}`);
  }
  return affected;
}

/**
 * Find the artifact versions a stage has produced, including rows written before
 * the dependency table existed.  The fallback to the current artifact also covers
 * callers that saved a result before invoking stage_complete.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} stage
 * @param {import('../planner/stages.mjs').StageDefinition|null} definition
 * @returns {Array<{id: string, kind: string, version: number}>}
 */
function stageOutputRefs(db, campaignId, stage, definition) {
  const refs = new Map();
  const runs = db
    .prepare(
      "SELECT artifact_id, output_kind, output_version FROM stage_runs WHERE campaign_id = ? AND stage = ? AND status = 'completed' AND artifact_id IS NOT NULL",
    )
    .all(campaignId, stage);
  for (const run of runs) {
    if (run.output_kind && run.output_version != null) {
      refs.set(String(run.artifact_id), { id: String(run.artifact_id), kind: String(run.output_kind), version: Number(run.output_version) });
    } else {
      const artifact = db.prepare('SELECT id, kind, version FROM artifacts WHERE id = ?').get(String(run.artifact_id));
      if (artifact) refs.set(String(artifact.id), { id: String(artifact.id), kind: String(artifact.kind), version: Number(artifact.version) });
    }
  }
  const dependencies = db
    .prepare(
      "SELECT d.artifact_id, d.kind, d.version FROM artifact_dependencies d INNER JOIN stage_runs r ON r.id = d.stage_run_id WHERE d.campaign_id = ? AND r.stage = ? AND d.dependency_type = 'output'",
    )
    .all(campaignId, stage);
  for (const dependency of dependencies) {
    if (dependency.artifact_id && dependency.version != null) {
      refs.set(String(dependency.artifact_id), {
        id: String(dependency.artifact_id),
        kind: String(dependency.kind),
        version: Number(dependency.version),
      });
    }
  }
  if (definition?.output && definition.output !== RELEASE_OUTPUT) {
    const current = currentArtifact(db, campaignId, definition.output);
    if (current) refs.set(current.id, { id: current.id, kind: current.kind, version: current.version });
  }
  return [...refs.values()];
}

/**
 * Mark approval decisions stale when a revision changes their declared scope or
 * one of the artifact versions they were made against.
 * @param {any} db
 * @param {string} campaignId
 * @param {Set<string>} scopes
 * @param {Set<string>} artifactIds
 * @param {string} reason
 */
function invalidateApprovalTargets(db, campaignId, scopes, artifactIds, reason) {
  const rows = db
    .prepare("SELECT id, kind, target FROM reviews WHERE campaign_id = ? AND status = 'resolved'")
    .all(campaignId);
  for (const row of rows) {
    const kind = String(row.kind);
    let target = row.target ? parseJson(String(row.target), {}) : {};
    const refs = Array.isArray(target?.artifacts) ? target.artifacts : [];
    const referencesInvalidatedArtifact = refs.some((ref) => artifactIds.has(String(ref?.id ?? ref?.artifact_id ?? '')));
    if (!scopes.has(kind) && !referencesInvalidatedArtifact) continue;
    target = { ...target, invalidated: true, invalidated_reason: reason, invalidated_at: nowIso() };
    db.prepare('UPDATE reviews SET target = ? WHERE id = ?').run(toJsonColumn(target), String(row.id));
  }
}

/**
 * Send a stage and everything that depends on its output back for rework.
 *
 * This is what a strategy revision and a media regeneration both do: the work is not
 * deleted, it is marked `needs_rework` and the artifacts it produced are named as no
 * longer current, so nothing downstream quietly stands on an answer that changed.
 * @param {object} args
 * @param {any} args.db
 * @param {string} args.campaign_id
 * @param {string} args.from_stage
 * @param {string} args.reason
 * @returns {{ok: true, from_stage: string, stages: string[], invalidated: Array<{stage: string, kind: string, artifact_id: string|null, version: number|null}>, reason: string}}
 */
export function reviseFrom({ db, campaign_id, from_stage, reason }) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) {
    throw new InvalidInputError('Say what needs to change.', { fix: 'Send a short reason with the revision.' });
  }
  const { stages } = requirePlannedStage(db, campaign_id, from_stage);
  const affected = [from_stage, ...downstreamStages(stages, from_stage)];

  /** @type {Array<{stage: string, kind: string, artifact_id: string|null, version: number|null}>} */
  const invalidated = [];
  const invalidatedIds = new Set();
  const invalidatedScopes = new Set();
  db.exec('BEGIN');
  try {
    for (const stage of affected) {
      const definition = stageDefinition(stage);
      const outputs = stageOutputRefs(db, campaign_id, stage, definition);
      if (definition?.gate) invalidatedScopes.add(String(definition.gate));
      for (const output of outputs) {
        if (invalidatedIds.has(output.id)) continue;
        invalidatedIds.add(output.id);
        db.prepare('UPDATE artifacts SET invalidated_at = ?, invalidation_reason = ? WHERE id = ? AND invalidated_at IS NULL').run(
          nowIso(),
          text,
          output.id,
        );
        invalidated.push({ stage, kind: output.kind, artifact_id: output.id, version: output.version });
      }
      recordRun(db, campaign_id, stage, 'needs_rework', { note: text });
      writeStageStatus(db, campaign_id, stage, 'needs_rework', text);
      if (definition?.output === RELEASE_OUTPUT) {
        db.prepare("UPDATE release_packages SET status = 'superseded' WHERE campaign_id = ? AND status IN ('draft', 'approved', 'exported')").run(campaign_id);
      }
    }
    invalidateApprovalTargets(db, campaign_id, invalidatedScopes, invalidatedIds, text);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Already closed.
    }
    throw error;
  }
  return { ok: true, from_stage, stages: affected, invalidated, reason: text };
}
