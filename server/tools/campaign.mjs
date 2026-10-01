/**
 * Campaign, plan and intake tools.
 *
 * This file owns one job's life from the first question to an approved plan:
 * the campaign row, the JobExecutionPlan, stage status and stage artifacts.
 *
 * Nothing here talks to a model. The planner is a pure function in
 * server/planner/plan.mjs, so a plan is reproducible and testable without a session.
 */

import { defineTool } from '../mcp/registry.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { buildJobPlan, JOB_TYPES, PLATFORMS, STARTING_POINTS } from '../planner/plan.mjs';
import { currentPhase } from '../planner/phases.mjs';
import { CONTRACT_KINDS, loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { commitArtifact } from '../artifacts/commit.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';
import { completeStage, markStage, nextStage, progressStages, reviseFrom } from '../workflow/stage.mjs';
import { resolveCapabilities } from '../capabilities/resolve.mjs';
import { computeCampaignStats } from './events.mjs';

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} label
 * @returns {string}
 */
function requireOneOf(value, allowed, label) {
  const text = String(value ?? '');
  if (!allowed.includes(text)) {
    throw new InvalidInputError(`"${text}" is not a ${label} Social Campaign knows about.`, {
      fix: `Choose one of: ${allowed.join(', ')}.`,
    });
  }
  return text;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function cleanPlatforms(value) {
  const list = (Array.isArray(value) ? value : []).map((entry) => String(entry).toLowerCase().trim());
  const kept = PLATFORMS.filter((platform) => list.includes(platform));
  if (kept.length === 0) {
    throw new InvalidInputError('Pick at least one of Facebook, Instagram or TikTok.');
  }
  return kept;
}

/**
 * Load a campaign row and turn it back into plain values.
 * @param {any} db
 * @param {string} campaignId
 */
function readCampaign(db, campaignId) {
  const row = db
    .prepare(
      'SELECT id, brand_id, title, job_type, starting_point, platforms, status, created_at, updated_at FROM campaigns WHERE id = ?',
    )
    .get(campaignId);
  if (!row) {
    throw new InvalidInputError('That job could not be found.', { fix: 'Start a new job on the board.' });
  }
  const detail = currentArtifact(db, campaignId, 'JobIntake');
  const intake = detail?.json ?? {};
  return {
    id: String(row.id),
    brand_id: row.brand_id ? String(row.brand_id) : null,
    title: row.title ? String(row.title) : null,
    job_type: String(row.job_type),
    starting_point: String(row.starting_point),
    platforms: parseJson(String(row.platforms ?? '[]'), []),
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    intake,
  };
}

/**
 * Everything the planner should know about what is already in memory.
 *
 * The memory tools are built separately. This reads the tables directly and falls
 * back to an empty summary if they are not populated yet, so a plan can always be
 * built.
 * @param {any} db
 * @param {string|null} brandId
 */
function memorySummary(db, brandId) {
  const empty = { brand: null, creative_memory: {}, preferences: {} };
  if (!brandId) return empty;
  try {
    const brand = db.prepare('SELECT id, name, slug, website FROM brands WHERE id = ?').get(brandId);
    if (!brand) return empty;
    const fields = db
      .prepare('SELECT COUNT(*) AS count FROM brand_fields WHERE brand_id = ? AND superseded_by IS NULL')
      .get(brandId);
    const profile = db
      .prepare('SELECT version, summary FROM creative_profiles WHERE brand_id = ? ORDER BY version DESC LIMIT 1')
      .get(brandId);
    const preferences = db.prepare('SELECT signal, value FROM preferences').all();
    return {
      brand: { id: String(brand.id), name: String(brand.name), website: brand.website ? String(brand.website) : null },
      creative_memory: profile
        ? { version: Number(profile.version), summary: profile.summary ? String(profile.summary) : null }
        : {},
      preferences: Object.fromEntries(preferences.map((row) => [String(row.signal), String(row.value)])),
      known_brand_facts: fields ? Number(fields.count) : 0,
    };
  } catch {
    return empty;
  }
}

/**
 * Write the plan's stages into job_stages so stage_update has rows to move.
 * @param {any} db
 * @param {string} campaignId
 * @param {Array<{stage: string, status: string, order: number, reason: string|null}>} stages
 */
function writeStages(db, campaignId, stages) {
  const updatedAt = nowIso();
  const insert = db.prepare(
    'INSERT INTO job_stages (id, campaign_id, stage, status, stage_order, detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (campaign_id, stage) DO UPDATE SET status = excluded.status, stage_order = excluded.stage_order, ' +
      'detail = excluded.detail, updated_at = excluded.updated_at',
  );
  for (const stage of stages) {
    // A stage a human already finished is never demoted by a re-plan.
    const existing = db
      .prepare('SELECT status FROM job_stages WHERE campaign_id = ? AND stage = ?')
      .get(campaignId, stage.stage);
    const kept = existing ? String(existing.status) : null;
    // A stage a human already finished, or one sent back for rework, is never
    // quietly demoted by a re-plan.
    const status = kept === 'completed' || kept === 'needs_rework' ? kept : stage.status;
    insert.run(newId(), campaignId, stage.stage, status, stage.order, stage.reason ?? null, updatedAt);
  }
}

/**
 * @param {any} db
 * @param {string|null} campaignId
 * @param {string} name
 * @param {Record<string, unknown>} payload
 */
function logEvent(db, campaignId, name, payload) {
  db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    campaignId,
    name,
    toJsonColumn(payload),
    nowIso(),
  );
}

/**
 * Intake is complete when the planner has everything it needs to be specific.
 * @param {{job_type: string, starting_point: string, platforms: string[], intake: any}} campaign
 * @returns {boolean}
 */
function intakeComplete(campaign) {
  if (!campaign.job_type || !campaign.starting_point) return false;
  if (!Array.isArray(campaign.platforms) || campaign.platforms.length === 0) return false;
  const intake = campaign.intake ?? {};
  if (campaign.starting_point === 'reference') {
    const reference = intake.reference ?? {};
    return Boolean(reference.url || reference.asset_id);
  }
  if (campaign.starting_point === 'existing_creative') {
    return Array.isArray(intake.existing_assets) && intake.existing_assets.length > 0;
  }
  return true;
}

/**
 * Store the free form part of intake as an artifact, so the campaigns table keeps
 * only the columns migration 001 defined.
 * @param {any} db
 * @param {string} campaignId
 * @param {Record<string, unknown>} intake
 */
function saveIntake(db, campaignId, intake) {
  const next =
    Number(
      db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = 'JobIntake'").get(
        campaignId,
      )?.version ?? 0,
    ) + 1;
  db.prepare(
    'INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(newId(), campaignId, 'JobIntake', null, toJsonColumn(intake), next, nowIso());
}

/**
 * Build and store a plan for a campaign.
 * @param {any} db
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} campaignId
 */
async function buildAndSavePlan(db, workspace, campaignId) {
  const campaign = readCampaign(db, campaignId);
  const memory = memorySummary(db, campaign.brand_id);
  const { capabilities } = await resolveCapabilities(workspace);
  const completed = db
    .prepare("SELECT stage FROM job_stages WHERE campaign_id = ? AND status = 'completed'")
    .all(campaignId)
    .map((row) => String(row.stage));

  const plan = buildJobPlan({
    job_type: campaign.job_type,
    starting_point: campaign.starting_point,
    platforms: campaign.platforms,
    brand: memory.brand ? { ...memory.brand, id: campaign.brand_id } : campaign.brand_id ? { id: campaign.brand_id } : null,
    creative_memory: memory.creative_memory,
    preferences: { ...(memory.preferences ?? {}), ...(campaign.intake?.preferences ?? {}) },
    reference: campaign.intake?.reference ?? null,
    existing_assets: campaign.intake?.existing_assets ?? [],
    capabilities,
    completed_stages: completed,
  });
  plan.campaign_id = campaignId;
  plan.brand_id = campaign.brand_id;

  const version = savePlan(db, campaignId, plan);
  writeStages(db, campaignId, plan.stages);
  return { plan, version, campaign };
}

/**
 * @param {any} db
 * @param {string} campaignId
 * @param {object} plan
 * @returns {number} the version that was written.
 */
function savePlan(db, campaignId, plan) {
  const version =
    Number(db.prepare('SELECT MAX(version) AS version FROM job_plans WHERE campaign_id = ?').get(campaignId)?.version ?? 0) +
    1;
  db.prepare('INSERT INTO job_plans (id, campaign_id, json, version, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    campaignId,
    toJsonColumn(plan),
    version,
    nowIso(),
  );
  return version;
}

export { currentPhase };

/**
 * Stage names are written for the model. This is what the user sees.
 * @param {string} stage
 * @returns {string}
 */
function humanStage(stage) {
  // "gate" is how the plan names an approval step; a person calls it an approval.
  return stage
    .replace(/_gate$/, '_approval')
    .split('_')
    .map((word) => (word.length <= 2 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const campaignTools = [
  defineTool({
    name: 'campaign_create',
    description:
      'Start a new job and remember it: what kind of job it is, what the user is starting with, which ' +
      'platforms it is for, and any reference or finished creative they supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand this job belongs to, if one is chosen.' },
        job_type: { type: 'string', description: 'social_post, ad_campaign, ugc or analyze_existing.' },
        starting_point: { type: 'string', description: 'scratch, reference or existing_creative.' },
        platforms: { type: 'array', description: 'Any of facebook, instagram, tiktok.' },
        title: { type: 'string', description: 'A short name for this job.' },
        reference: { type: 'object', description: 'For a reference job: { kind, url, asset_id }.' },
        existing_assets: { type: 'array', description: 'For a finished creative job: file paths or asset ids.' },
        goal: { type: 'string', description: 'What the user wants out of this job, in their words.' },
        notes: { type: 'string', description: 'Anything else the user said that the planner should respect.' },
      },
      required: ['job_type', 'starting_point', 'platforms'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const jobType = requireOneOf(args.job_type, JOB_TYPES, 'job type');
      const startingPoint = requireOneOf(args.starting_point, STARTING_POINTS, 'starting point');
      const platforms = cleanPlatforms(args.platforms);
      const id = newId();
      const at = nowIso();
      const brandId = typeof args.brand_id === 'string' && args.brand_id ? args.brand_id : null;

      db.prepare(
        'INSERT INTO campaigns (id, brand_id, title, job_type, starting_point, platforms, status, created_at, updated_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      ).run(id, brandId, typeof args.title === 'string' ? args.title : null, jobType, startingPoint, toJsonColumn(platforms), at, at);

      saveIntake(db, id, {
        reference: args.reference && typeof args.reference === 'object' ? args.reference : null,
        existing_assets: Array.isArray(args.existing_assets) ? args.existing_assets : [],
        goal: typeof args.goal === 'string' ? args.goal : '',
        notes: typeof args.notes === 'string' ? args.notes : '',
        preferences: {},
      });

      logEvent(db, id, 'campaign.created', { job_type: jobType, starting_point: startingPoint, platforms });
      return { ok: true, campaign: readCampaign(db, id) };
    },
  }),

  defineTool({
    name: 'campaign_get',
    description: 'Look up one job: its type, starting point, platforms, brand, status and what was supplied at intake.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({ campaign: readCampaign(workspace.requireDb(), String(args.campaign_id)) }),
  }),

  defineTool({
    name: 'campaign_update',
    description:
      'Change what is known about a job. The patch may set title, brand_id, platforms, status, reference, ' +
      'existing_assets, goal or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        patch: { type: 'object', description: 'Only the fields that change.' },
      },
      required: ['campaign_id', 'patch'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const current = readCampaign(db, campaignId);
      const patch = /** @type {Record<string, unknown>} */ (args.patch ?? {});

      const columns = [];
      const values = [];
      if ('title' in patch) {
        columns.push('title = ?');
        values.push(patch.title === null ? null : String(patch.title));
      }
      if ('brand_id' in patch) {
        columns.push('brand_id = ?');
        values.push(patch.brand_id ? String(patch.brand_id) : null);
      }
      if ('platforms' in patch) {
        columns.push('platforms = ?');
        values.push(toJsonColumn(cleanPlatforms(patch.platforms)));
      }
      if ('status' in patch) {
        columns.push('status = ?');
        values.push(requireOneOf(patch.status, ['active', 'waiting', 'completed', 'abandoned'], 'job status'));
      }
      if ('job_type' in patch) {
        columns.push('job_type = ?');
        values.push(requireOneOf(patch.job_type, JOB_TYPES, 'job type'));
      }
      if ('starting_point' in patch) {
        columns.push('starting_point = ?');
        values.push(requireOneOf(patch.starting_point, STARTING_POINTS, 'starting point'));
      }
      columns.push('updated_at = ?');
      values.push(nowIso());
      db.prepare(`UPDATE campaigns SET ${columns.join(', ')} WHERE id = ?`).run(...values, campaignId);

      const intakeKeys = ['reference', 'existing_assets', 'goal', 'notes', 'preferences'];
      if (intakeKeys.some((key) => key in patch)) {
        const merged = { ...current.intake };
        for (const key of intakeKeys) if (key in patch) merged[key] = patch[key];
        saveIntake(db, campaignId, merged);
      }

      return { ok: true, campaign: readCampaign(db, campaignId) };
    },
  }),

  defineTool({
    name: 'campaign_list',
    description: 'List jobs, newest first, optionally only the ones for one brand or in one state.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        status: { type: 'string', description: 'active, waiting, completed or abandoned.' },
        limit: { type: 'number', description: 'Default 20, maximum 200.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
      const clauses = [];
      const values = [];
      if (typeof args.brand_id === 'string' && args.brand_id) {
        clauses.push('brand_id = ?');
        values.push(args.brand_id);
      }
      if (typeof args.status === 'string' && args.status) {
        clauses.push('status = ?');
        values.push(requireOneOf(args.status, ['active', 'waiting', 'completed', 'abandoned'], 'job status'));
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT id, brand_id, title, job_type, starting_point, platforms, status, created_at, updated_at FROM campaigns ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...values, limit);
      return {
        campaigns: rows.map((row) => ({
          id: String(row.id),
          brand_id: row.brand_id ? String(row.brand_id) : null,
          title: row.title ? String(row.title) : null,
          job_type: String(row.job_type),
          starting_point: String(row.starting_point),
          platforms: parseJson(String(row.platforms ?? '[]'), []),
          status: String(row.status),
          created_at: String(row.created_at),
          updated_at: String(row.updated_at),
        })),
      };
    },
  }),

  defineTool({
    name: 'job_plan_build',
    description:
      'Work out the shortest real pipeline for a job: which stages it needs, which it can skip because of ' +
      'what the user already supplied or what is already known, and anything that has to be connected first. ' +
      'Saves the plan and returns it.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const { plan, version, campaign } = await buildAndSavePlan(db, workspace, campaignId);

      if (intakeComplete(campaign)) {
        const already = db
          .prepare("SELECT COUNT(*) AS count FROM events WHERE campaign_id = ? AND name = 'intake.completed'")
          .get(campaignId);
        if (!already || Number(already.count) === 0) {
          logEvent(db, campaignId, 'intake.completed', {
            job_type: campaign.job_type,
            starting_point: campaign.starting_point,
            platforms: campaign.platforms,
          });
        }
      }

      return { ok: true, plan, version, blockers: plan.blockers, warnings: plan.warnings ?? [] };
    },
  }),

  defineTool({
    name: 'job_plan_save',
    description: 'Store a plan for a job, keeping the previous one. Use after changing a plan the user asked to adjust.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        plan: { type: 'object', description: 'The full plan, in the JobExecutionPlan shape.' },
      },
      required: ['campaign_id', 'plan'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      const plan = /** @type {any} */ ({ ...(args.plan ?? {}) });
      plan.campaign_id = campaignId;
      const problems = validateAgainstSchema(loadSchema('JobExecutionPlan'), plan);
      if (problems.length > 0) {
        throw new InvalidInputError(`That plan is not usable: ${problems[0]}`, { details: { problems } });
      }
      const version = savePlan(db, campaignId, plan);
      if (Array.isArray(plan.stages)) writeStages(db, campaignId, plan.stages);
      return { ok: true, version, plan };
    },
  }),

  defineTool({
    name: 'job_plan_get',
    description: 'Fetch the current plan for a job, or an earlier version of it.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        version: { type: 'number', description: 'Leave empty for the newest plan.' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const row = args.version
        ? db.prepare('SELECT json, version, created_at FROM job_plans WHERE campaign_id = ? AND version = ?').get(campaignId, Number(args.version))
        : db.prepare('SELECT json, version, created_at FROM job_plans WHERE campaign_id = ? ORDER BY version DESC LIMIT 1').get(campaignId);
      if (!row) {
        throw new InvalidInputError('This job does not have a plan yet.', { fix: 'Build the plan first.' });
      }
      let statsByStage = new Map();
      try {
        statsByStage = new Map(computeCampaignStats(db, campaignId).stages.map((s) => [s.stage, s.duration_ms]));
      } catch {
        statsByStage = new Map();
      }
      // Progress comes from the execution records, not from the plan JSON: the saved
      // plan is what was intended, `stage_runs` is what happened.
      const stages = progressStages(db, campaignId).map((entry) => ({
        ...entry,
        duration_ms: statsByStage.get(entry.stage) ?? null,
      }));
      return {
        plan: parseJson(String(row.json ?? '{}'), {}),
        version: Number(row.version),
        created_at: String(row.created_at),
        stages,
      };
    },
  }),

  defineTool({
    name: 'stage_next',
    description:
      'Ask which step of a job comes next, and who owns it. Always ask rather than remembering an order: ' +
      'the answer comes from the plan and from what has actually been finished.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      const stages = progressStages(db, campaignId);
      if (stages.length === 0) {
        throw new InvalidInputError('This job does not have a plan yet.', { fix: 'Build the plan first.' });
      }
      const next = nextStage(db, campaignId);
      const remaining = stages.filter(
        (entry) => !['completed', 'skipped', 'not_applicable'].includes(entry.status),
      ).length;
      return {
        campaign_id: campaignId,
        next: next
          ? {
              stage: next.stage,
              label: humanStage(next.stage),
              status: next.status,
              order: next.order,
              owner_agent: next.owner_agent,
              gate: next.gate,
              reason: next.reason,
            }
          : null,
        remaining,
        done: remaining === 0,
        stages,
      };
    },
  }),

  defineTool({
    name: 'stage_complete',
    description:
      'Finish a step of a job: save what it produced and mark it done in one go. Refused unless this job is ' +
      'really on that step, everything the step needs already exists, any approval it depends on is still ' +
      'current, and its result is saved. Returns the next step.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        stage: { type: 'string', description: 'The step being finished, from the plan.' },
        artifact: {
          type: 'object',
          description: 'What the step produced: { kind, json, path? }. Leave it out when the result is already saved.',
        },
      },
      required: ['campaign_id', 'stage'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      const artifact = args.artifact && typeof args.artifact === 'object' ? args.artifact : null;
      if (artifact && (typeof artifact.kind !== 'string' || !artifact.kind)) {
        throw new InvalidInputError('Say what kind of result this is.', { fix: 'Set artifact.kind to one of the contract names.' });
      }
      const result = completeStage({
        db,
        root: workspace.root ?? null,
        campaign_id: campaignId,
        stage: String(args.stage),
        artifact: artifact ? { kind: String(artifact.kind), json: artifact.json, path: artifact.path ?? null } : null,
      });
      return {
        ...result,
        next: result.next
          ? {
              stage: result.next.stage,
              label: humanStage(result.next.stage),
              status: result.next.status,
              order: result.next.order,
              owner_agent: result.next.owner_agent,
              gate: result.next.gate,
              reason: result.next.reason,
            }
          : null,
      };
    },
  }),

  defineTool({
    name: 'stage_update',
    description:
      'Put a step of a job aside: skipped, or waiting on something, with a short reason. A step is never ' +
      'marked done here; finishing a step means finishing its work.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        stage: { type: 'string', description: 'The step name from the plan.' },
        status: { type: 'string', description: 'skipped or waiting.' },
        detail: { type: 'string', description: 'Why, in one line. Required.' },
      },
      required: ['campaign_id', 'stage', 'status', 'detail'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      return markStage({
        db,
        campaign_id: campaignId,
        stage: String(args.stage),
        status: String(args.status),
        reason: typeof args.detail === 'string' ? args.detail : '',
      });
    },
  }),

  defineTool({
    name: 'revise',
    description:
      'Send a step and everything downstream that was built on its result back for rework, with the reason. ' +
      'Returns which steps came back and which saved results are no longer current.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        from_stage: { type: 'string', description: 'The step whose result changed.' },
        reason: { type: 'string', description: 'What needs to change, in plain words.' },
      },
      required: ['campaign_id', 'from_stage', 'reason'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      return reviseFrom({
        db,
        campaign_id: campaignId,
        from_stage: String(args.from_stage),
        reason: typeof args.reason === 'string' ? args.reason : '',
      });
    },
  }),

  defineTool({
    name: 'artifact_save',
    description:
      'Store what a stage produced, checked against the contract for that kind of result and against the ' +
      'rules for that kind: copy needs an approved strategy, generated media has to name the cost approval ' +
      'it was made under and every file it lists has to be there. Kinds: ' +
      CONTRACT_KINDS.join(', ') +
      '.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string', description: 'One of the contract names.' },
        json: { type: 'object', description: 'The result itself.' },
        path: { type: 'string', description: 'Optional file this result describes.' },
      },
      required: ['campaign_id', 'kind', 'json'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      // Generic and specialized writers go through the same door: schema check, then
      // the domain rules for that kind, then the write. Saving copy here used to skip
      // the strategy approval that copy_save enforces, and a media package could name
      // a cost approval that does not exist.
      const saved = commitArtifact({
        db,
        root: workspace.root ?? null,
        campaign_id: campaignId,
        kind: String(args.kind),
        json: args.json,
        path: typeof args.path === 'string' && args.path ? args.path : null,
      });
      return { ok: true, ...saved };
    },
  }),

  defineTool({
    name: 'artifact_get',
    description: 'Fetch what a stage produced for a job, newest version unless an earlier one is asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string' },
        version: { type: 'number' },
      },
      required: ['campaign_id', 'kind'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const kind = String(args.kind);
      const row = args.version
        ? db
            .prepare('SELECT id, path, json, version, created_at, invalidated_at, invalidation_reason FROM artifacts WHERE campaign_id = ? AND kind = ? AND version = ?')
            .get(campaignId, kind, Number(args.version))
        : currentArtifact(db, campaignId, kind);
      if (!row) {
        throw new InvalidInputError(`This job has no ${kind} result yet.`);
      }
      return {
        artifact: {
          id: String(row.id),
          kind,
          path: row.path ? String(row.path) : null,
          json: args.version ? parseJson(String(row.json ?? 'null'), null) : row.json,
          version: Number(row.version),
          created_at: String(row.created_at),
          invalidated_at: row.invalidated_at ? String(row.invalidated_at) : null,
          invalidation_reason: row.invalidation_reason ? String(row.invalidation_reason) : null,
        },
      };
    },
  }),

  defineTool({
    name: 'artifact_list',
    description: 'List everything stored for a job, newest first, so it is clear which stages have produced results.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string', description: 'Optional filter.' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const kind = typeof args.kind === 'string' && args.kind ? args.kind : null;
      const rows = kind
        ? db
            .prepare('SELECT id, kind, path, version, created_at, invalidated_at, invalidation_reason FROM artifacts WHERE campaign_id = ? AND kind = ? ORDER BY created_at DESC, id DESC')
            .all(campaignId, kind)
        : db
            .prepare(
              "SELECT id, kind, path, version, created_at, invalidated_at, invalidation_reason FROM artifacts WHERE campaign_id = ? AND kind <> 'JobIntake' ORDER BY created_at DESC, id DESC",
            )
            .all(campaignId);
      return {
        artifacts: rows.map((row) => ({
          id: String(row.id),
          kind: String(row.kind),
          path: row.path ? String(row.path) : null,
          version: Number(row.version),
          created_at: String(row.created_at),
          invalidated_at: row.invalidated_at ? String(row.invalidated_at) : null,
          invalidation_reason: row.invalidation_reason ? String(row.invalidation_reason) : null,
        })),
      };
    },
  }),
];
