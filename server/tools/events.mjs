/**
 * Event log tools.
 *
 * The events table is the V1 record of what happened, and the input V2 analytics
 * will read. Event names come from spec section 34; anything outside that list is
 * rejected so the table stays queryable.
 */

import { defineTool } from '../mcp/registry.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { redact } from '../lib/secrets.mjs';

/** The V1 event vocabulary, spec section 34. */
export const EVENT_NAMES = [
  'campaign.created',
  'intake.completed',
  'asset.indexed',
  'research.started',
  'research.completed',
  'strategy.generated',
  'strategy.revision_requested',
  'strategy.approved',
  'cost.estimated',
  'cost.approved',
  'asset.generated',
  'asset.rejected',
  'asset.approved',
  'final.approved',
  'publish.scheduled',
  'publish.completed',
  'stage.started',
  'stage.completed',
  'agent.completed',
];

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const eventTools = [
  defineTool({
    name: 'event_log',
    description:
      'Record that something happened in a campaign. Allowed names: ' + EVENT_NAMES.join(', ') + '.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'The campaign this belongs to. Optional for global events.' },
        name: { type: 'string', description: 'One of the allowed event names.' },
        payload: { type: 'object', description: 'Any extra detail worth keeping.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const name = String(args.name);
      if (!EVENT_NAMES.includes(name)) {
        throw new InvalidInputError(`"${name}" is not a Social Campaign event name.`, {
          details: { allowed: EVENT_NAMES },
        });
      }
      const db = workspace.requireDb();
      const id = newId();
      const createdAt = nowIso();
      db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        typeof args.campaign_id === 'string' && args.campaign_id ? args.campaign_id : null,
        name,
        // Every event payload written by event_log is redacted the same way as
        // the payloads the gate machinery logs directly: a secret never lands
        // in the events table, whichever path put it there.
        toJsonColumn(redact(args.payload ?? {})),
        createdAt,
      );
      return { ok: true, id, name, created_at: createdAt };
    },
  }),

  defineTool({
    name: 'events_list',
    description: 'List recorded events, newest first, optionally filtered by campaign or name.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        name: { type: 'string' },
        limit: { type: 'number', description: 'Default 50, maximum 500.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
      const clauses = [];
      const values = [];
      if (typeof args.campaign_id === 'string' && args.campaign_id) {
        clauses.push('campaign_id = ?');
        values.push(args.campaign_id);
      }
      if (typeof args.name === 'string' && args.name) {
        clauses.push('name = ?');
        values.push(args.name);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT id, campaign_id, name, payload, created_at FROM events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...values, limit);
      return {
        events: rows.map((row) => ({
          id: String(row.id),
          campaign_id: row.campaign_id ? String(row.campaign_id) : null,
          name: String(row.name),
          payload: parseJson(String(row.payload ?? '{}'), {}),
          created_at: String(row.created_at),
        })),
      };
    },
  }),

  defineTool({
    name: 'agent_run_record',
    description:
      'Log that one spawned agent finished a run for a stage: the tokens and time it used. Writes an ' +
      'agent.completed event. Call this once per agent run, right after the Agent tool returns, with no ' +
      'other narration.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        stage: { type: 'string', description: 'The stage this agent ran for.' },
        agent: { type: 'string', description: 'The agent name, for example competitor-researcher.' },
        model: { type: 'string' },
        tokens: { type: 'number', description: 'Total tokens the run reports.' },
        duration_ms: { type: 'number' },
        note: { type: 'string', description: 'Optional one line, for example what it produced.' },
      },
      required: ['campaign_id', 'stage', 'agent'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const id = newId();
      const createdAt = nowIso();
      const payload = {
        stage: String(args.stage),
        agent: String(args.agent),
        model: typeof args.model === 'string' ? args.model : null,
        tokens: Number.isFinite(Number(args.tokens)) ? Number(args.tokens) : null,
        duration_ms: Number.isFinite(Number(args.duration_ms)) ? Number(args.duration_ms) : null,
        note: typeof args.note === 'string' ? args.note : null,
      };
      db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        campaignId,
        'agent.completed',
        toJsonColumn(payload),
        createdAt,
      );
      return { ok: true, id, created_at: createdAt };
    },
  }),

  defineTool({
    name: 'campaign_stats',
    description:
      'Per stage wall time, per agent tokens and duration, and job totals, computed from stage.started, ' +
      'stage.completed and agent.completed events.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => computeCampaignStats(workspace.requireDb(), String(args.campaign_id)),
  }),
];

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} campaignId
 * @returns {{
 *   campaign_id: string,
 *   stages: Array<{stage: string, started_at: string|null, completed_at: string|null, duration_ms: number|null}>,
 *   agents: Array<{stage: string, agent: string, model: string|null, tokens: number, duration_ms: number, runs: number}>,
 *   totals: {duration_ms: number, tokens: number, agent_runs: number}
 * }}
 */
export function computeCampaignStats(db, campaignId) {
  const rows = db
    .prepare(
      "SELECT name, payload, created_at FROM events WHERE campaign_id = ? AND name IN ('stage.started', 'stage.completed', 'agent.completed') ORDER BY created_at ASC",
    )
    .all(campaignId);

  /** @type {Map<string, {started_at: string|null, completed_at: string|null}>} */
  const stageTimes = new Map();
  /** @type {Map<string, {stage: string, agent: string, model: string|null, tokens: number, duration_ms: number, runs: number}>} */
  const agentTotals = new Map();
  let totalTokens = 0;
  let totalAgentRuns = 0;

  for (const row of rows) {
    const payload = parseJson(String(row.payload ?? '{}'), {});
    if (row.name === 'stage.started') {
      const entry = stageTimes.get(String(payload.stage)) ?? { started_at: null, completed_at: null };
      if (!entry.started_at) entry.started_at = String(row.created_at);
      stageTimes.set(String(payload.stage), entry);
    } else if (row.name === 'stage.completed') {
      const entry = stageTimes.get(String(payload.stage)) ?? { started_at: null, completed_at: null };
      entry.completed_at = String(row.created_at);
      stageTimes.set(String(payload.stage), entry);
    } else if (row.name === 'agent.completed') {
      const key = `${payload.stage}::${payload.agent}`;
      const entry = agentTotals.get(key) ?? {
        stage: String(payload.stage ?? ''),
        agent: String(payload.agent ?? ''),
        model: payload.model ? String(payload.model) : null,
        tokens: 0,
        duration_ms: 0,
        runs: 0,
      };
      entry.tokens += Number(payload.tokens) || 0;
      entry.duration_ms += Number(payload.duration_ms) || 0;
      entry.runs += 1;
      if (payload.model) entry.model = String(payload.model);
      agentTotals.set(key, entry);
      totalTokens += Number(payload.tokens) || 0;
      totalAgentRuns += 1;
    }
  }

  const stages = [...stageTimes.entries()].map(([stage, times]) => {
    const duration_ms =
      times.started_at && times.completed_at
        ? new Date(times.completed_at).getTime() - new Date(times.started_at).getTime()
        : null;
    return { stage, started_at: times.started_at, completed_at: times.completed_at, duration_ms };
  });

  const totalStageMs = stages.reduce((sum, entry) => sum + (entry.duration_ms ?? 0), 0);

  return {
    campaign_id: campaignId,
    stages,
    agents: [...agentTotals.values()],
    totals: { duration_ms: totalStageMs, tokens: totalTokens, agent_runs: totalAgentRuns },
  };
}
