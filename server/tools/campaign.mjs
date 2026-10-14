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

];
