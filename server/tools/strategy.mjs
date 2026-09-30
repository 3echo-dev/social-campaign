/**
 * Research, strategy and creative tools: phases 5 to 7.
 *
 * The specialists in agents/ do the thinking. This file makes the loop robust:
 * the research planner decides who runs, research_record checks and stores what
 * they found and pushes it into memory the safe way, strategy_save enforces the
 * strategy contract (spec 20), the approval guards make sure copy is never written
 * against a strategy nobody approved, and platform_plan_save refuses a plan that
 * resized one execution three times instead of adapting it.
 *
 * Every write here is versioned the same way campaign.mjs versions artifacts: a new
 * row per save, never an update, so history is kept.
 */

import { defineTool } from '../mcp/registry.mjs';
import { assertDomainRules } from '../artifacts/commit.mjs';
import { progressStages, reviseFrom } from '../workflow/stage.mjs';
import { approvalStatus } from '../review/approvals.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { planResearch, RESEARCH_AGENTS } from '../research/planner.mjs';
import { getBrand, proposeBrandUpdate } from '../memory/brand.mjs';
import { getCompetitor, saveCompetitorAnalysis } from '../memory/competitor.mjs';
import { recordEvidence, getPreferences } from '../memory/preference.mjs';
import { resolveContext } from '../memory/promotion.mjs';
import { checkCopyPackage } from '../copy/check.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

/** Which contract each research specialist returns. */
const AGENT_CONTRACT = {
  'brand-researcher': 'BrandResearchResult',
  'competitor-researcher': 'CompetitorResearchResult',
  'trend-scout': 'TrendResearchResult',
  'audience-researcher': 'AudienceResearchResult',
  'platform-analyst': 'PlatformPlan',
};

/** The strategy contract, spec section 20. Keys are the schema enum; titles are what the user sees. */
export const STRATEGY_DIRECTIONS = {
  normal: [
    { key: 'brand_native', title: 'Brand Native' },
    { key: 'competitor_opportunity', title: 'Competitor Opportunity' },
    { key: 'trend_forward', title: 'Trend Forward' },
  ],
  reference: [
    { key: 'reference_led', title: 'Reference-Led Adaptation' },
    { key: 'brand_evolution', title: 'Brand Evolution' },
    { key: 'trend_competitive_evolution', title: 'Trend-Competitive Evolution' },
  ],
};

const PLATFORMS = ['facebook', 'instagram', 'tiktok'];

/** The most a job can target (spec section 10). */
const MAX_PLATFORMS = 3;

/** How many times the strategist may be sent back before the skill asks the user in chat. */
export const MAX_STRATEGY_ROUNDS = 3;

/**
 * @param {any} db
 * @param {string} campaignId
 */
function readCampaign(db, campaignId) {
  const row = db
    .prepare('SELECT id, brand_id, title, job_type, starting_point, platforms, status FROM campaigns WHERE id = ?')
    .get(campaignId);
  if (!row) {
    throw new InvalidInputError('That job could not be found.', { fix: 'Start a new job from the home screen.' });
  }
  const detail = currentArtifact(db, campaignId, 'JobIntake');
  return {
    id: String(row.id),
    brand_id: row.brand_id ? String(row.brand_id) : null,
    title: row.title ? String(row.title) : null,
    job_type: String(row.job_type),
    starting_point: String(row.starting_point),
    platforms: parseJson(String(row.platforms ?? '[]'), []),
    status: String(row.status),
    intake: detail?.json ?? {},
  };
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
    toJsonColumn(payload ?? {}),
    nowIso(),
  );
}

/**
 * Store a new version of an artifact. Same convention as campaign.mjs: a new row,
 * the next version number, never an update.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @param {unknown} json
 * @returns {{id: string, version: number}}
 */
function saveArtifact(db, campaignId, kind, json) {
  const version =
    Number(
      db.prepare('SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = ?').get(campaignId, kind)
        ?.version ?? 0,
    ) + 1;
  const id = newId();
  db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    campaignId,
    kind,
    null,
    toJsonColumn(json),
    version,
    nowIso(),
  );
  return { id, version };
}

/**
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {{id: string, json: any, version: number, created_at: string}|null}
 */
function latestArtifact(db, campaignId, kind) {
  const row = currentArtifact(db, campaignId, kind);
  if (!row) return null;
  return { id: row.id, json: row.json, version: row.version, created_at: row.created_at };
}

/**
 * Check a value against a contract and turn the first problem into a plain sentence.
 * @param {string} kind
 * @param {unknown} value
 * @param {string} label
 */
function requireValid(kind, value, label) {
  const problems = validateAgainstSchema(loadSchema(kind), value);
  if (problems.length > 0) {
    throw new InvalidInputError(`That ${label} is not complete: ${problems[0]}`, {
      fix: 'Fill in the missing detail and save it again.',
      details: { problems },
    });
  }
}

/**
 * The strategy review the user approved, if any. Mirrors approval_check in
 * review.mjs so both guards agree on what "approved" means.
 * @param {any} db
 * @param {string} campaignId
 * @returns {{review_id: string, action: string, payload: any}|null}
 */
function approvedStrategyReview(db, campaignId) {
  // Newest wins: only the most recent resolved strategy decision counts, so a later
  // rejection or request for changes takes an earlier approval back.
  const row = db
    .prepare(
      "SELECT id, decision FROM reviews WHERE campaign_id = ? AND kind = 'strategy' AND status = 'resolved' ORDER BY resolved_at DESC, id DESC LIMIT 1",
    )
    .get(campaignId);
  if (!row) return null;
  const decision = parseJson(String(row.decision ?? '{}'), {});
  if (decision.action === 'approve' || decision.action === 'combine') {
    return { review_id: String(row.id), action: String(decision.action), payload: decision.payload ?? {} };
  }
  return null;
}

/**
 * How many times the strategist has been sent back over this job.
 *
 * Two things write strategy.revision_requested: the gate, when the user clicks
 * Request Changes, and strategy_revise, when Claude acts on that. Counting the rows
 * counts one decision twice, and a job would run out of its three rounds after two.
 * A round is one trip back to the strategist, which is one strategy_revise call, and
 * only the gate stamps its row with the review it came from.
 * @param {any} db
 * @param {string} campaignId
 * @returns {number}
 */
function revisionRounds(db, campaignId) {
  const rows = db
    .prepare("SELECT payload FROM events WHERE campaign_id = ? AND name = 'strategy.revision_requested'")
    .all(campaignId);
  return rows.filter((row) => !parseJson(String(row.payload ?? '{}'), {}).review_id).length;
}

/**
 * The direction the user picked, as recorded by strategy_mark_approved.
 * @param {any} db
 * @param {string} campaignId
 * @returns {{review_id: string, direction_key: string, version: number|null, at: string}|null}
 */
function markedApproval(db, campaignId) {
  const rows = db
    .prepare("SELECT payload, created_at FROM events WHERE campaign_id = ? AND name = 'strategy.approved' ORDER BY created_at DESC, id DESC")
    .all(campaignId);
  for (const row of rows) {
    const payload = parseJson(String(row.payload ?? '{}'), {});
    if (payload.marked === true && payload.direction_key) {
      return {
        review_id: String(payload.review_id),
        direction_key: String(payload.direction_key),
        version: typeof payload.version === 'number' ? payload.version : null,
        at: String(row.created_at),
      };
    }
  }
  return null;
}

/**
 * Trend research from earlier jobs for the same brand, so a fresh trend read is not
 * repeated within its seven day life.
 * @param {any} db
 * @param {string|null} brandId
 * @param {string} campaignId
 */
function trendRecords(db, brandId, campaignId) {
  const rows = brandId
    ? db
        .prepare(
          "SELECT a.json FROM artifacts a INNER JOIN campaigns c ON c.id = a.campaign_id WHERE a.kind = 'TrendResearchResult' AND a.invalidated_at IS NULL AND (c.brand_id = ? OR a.campaign_id = ?)",
        )
        .all(brandId, campaignId)
    : db.prepare("SELECT json FROM artifacts WHERE kind = 'TrendResearchResult' AND campaign_id = ? AND invalidated_at IS NULL").all(campaignId);
  return rows
    .map((row) => parseJson(String(row.json ?? '{}'), {}))
    .map((json) => ({ observed_at: json.observed_at ?? null }));
}

/**
 * Turn a BrandResearchResult into brand_propose_update fields, every one of them a
 * verified_research proposal so the precedence rule decides whether it lands.
 * @param {any} result
 * @param {string} sourceRef
 */
function brandFieldsFromResearch(result, sourceRef) {
  const fields = Array.isArray(result.fields) ? result.fields : [];
  const proposals = fields
    .filter((field) => field && typeof field.field_path === 'string' && field.value !== undefined)
    .map((field) => ({
      key: field.field_path,
      value: field.value,
      source_type: 'verified_research',
      source_ref: field.source_ref ?? sourceRef,
      observed_at: field.observed_at,
      confidence: typeof field.confidence === 'number' ? field.confidence : 0.6,
    }));
  if (Array.isArray(result.restrictions) && result.restrictions.length > 0) {
    proposals.push({
      key: 'restrictions.claims',
      value: result.restrictions,
      source_type: 'verified_research',
      source_ref: sourceRef,
      observed_at: undefined,
      confidence: 0.7,
    });
  }
  const handles = result.brand?.handles ?? {};
  for (const platform of PLATFORMS) {
    if (typeof handles[platform] === 'string' && handles[platform]) {
      proposals.push({
        key: `social.${platform}`,
        value: handles[platform],
        source_type: 'verified_research',
        source_ref: sourceRef,
        observed_at: undefined,
        confidence: 0.7,
      });
    }
  }
  return proposals;
}

/**
 * The audience family lives in brand memory under audience.*, which is what the
 * research planner measures staleness against.
 * @param {any} result
 * @param {string} sourceRef
 */
function audienceFieldsFromResearch(result, sourceRef) {
  const segments = Array.isArray(result.segments) ? result.segments : [];
  if (segments.length === 0) return [];
  const confidence = Math.max(...segments.map((segment) => (typeof segment.confidence === 'number' ? segment.confidence : 0.5)));
  return [
    {
      key: 'audience.segments',
      value: segments.map((segment) => ({
        name: segment.name,
        problems: segment.problems ?? [],
        motivations: segment.motivations ?? [],
        objections: segment.objections ?? [],
        language: segment.language ?? [],
        funnel_stage: segment.funnel_stage ?? null,
      })),
      source_type: 'verified_research',
      source_ref: sourceRef,
      observed_at: undefined,
      confidence,
    },
    {
      key: 'audience.primary',
      value: String(segments[0].name),
      source_type: 'verified_research',
      source_ref: sourceRef,
      observed_at: undefined,
      confidence,
    },
  ];
}

/**
 * Enforce the strategy contract from spec section 20.
 * @param {any} set
 * @param {string} startingPoint
 * @returns {any} the set with canonical titles filled in.
 */
function enforceStrategyContract(set, startingPoint) {
  const mode = set.mode === 'reference' || set.mode === 'normal' ? set.mode : startingPoint === 'reference' ? 'reference' : 'normal';
  const directions = Array.isArray(set.directions) ? set.directions : [];
  const customCount = typeof set.custom_count === 'number' && Number.isInteger(set.custom_count) ? set.custom_count : null;

  if (customCount !== null) {
    if (customCount < 1) throw new InvalidInputError('A custom direction count has to be at least one.');
    if (directions.length !== customCount) {
      throw new InvalidInputError(
        `You asked for ${customCount} direction${customCount === 1 ? '' : 's'} but ${directions.length} ${directions.length === 1 ? 'was' : 'were'} supplied.`,
      );
    }
    return { ...set, mode, directions: directions.map((direction) => ({ ...direction, title: direction.title || direction.key })) };
  }

  const expected = STRATEGY_DIRECTIONS[mode];
  const modeLabel = mode === 'reference' ? 'Reference Mode' : 'normal mode';
  const expectedTitles = expected.map((entry) => entry.title).join(', ');
  if (directions.length !== 3) {
    throw new InvalidInputError(
      `A strategy needs exactly three directions in ${modeLabel}: ${expectedTitles}. ${directions.length} ${directions.length === 1 ? 'was' : 'were'} supplied.`,
      { fix: 'Send three directions, or set custom_count when the user explicitly asked for a different number.' },
    );
  }
  const seen = new Set();
  const normalized = directions.map((direction) => {
    const match = expected.find(
      (entry) =>
        entry.key === direction.key ||
        (typeof direction.title === 'string' && canonical(direction.title) === canonical(entry.title)),
    );
    if (!match) {
      throw new InvalidInputError(
        `"${direction.title ?? direction.key ?? 'untitled'}" is not one of the ${modeLabel} directions: ${expectedTitles}.`,
      );
    }
    if (seen.has(match.key)) throw new InvalidInputError(`The ${match.title} direction appears twice.`);
    seen.add(match.key);
    return { ...direction, key: match.key, title: match.title };
  });
  return { ...set, mode, directions: normalized };
}

/**
 * @param {string} value
 * @returns {string}
 */
function canonical(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The bytes of one platform execution with the platform name removed, so two
 * entries that differ only by name are caught.
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function executionFingerprint(entry) {
  const copy = { ...entry };
  delete copy.platform;
  return JSON.stringify(sortKeys(copy));
}

/**
 * @param {any} value
 * @returns {any}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * @param {string} name
 * @returns {string}
 */
function platformLabel(name) {
  return { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }[name] ?? name;
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const strategyTools = [
  defineTool({
    name: 'research_plan',
    description:
      'Work out which research a job still needs: what is already known about the brand, competitors, ' +
      'trends and audience, what has gone stale, what is missing, and therefore which specialists to run ' +
      'with which questions. Saves the plan and returns it.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      let brandContext = null;
      let competitors = [];
      if (campaign.brand_id) {
        try {
          const brand = getBrand(db, campaign.brand_id);
          brandContext = { fields: brand.fields, creative_profile: brand.creative_profile };
          competitors = getCompetitor(db, { brand_id: campaign.brand_id });
        } catch {
          brandContext = null;
        }
      }
      const preferences = { ...(campaign.intake?.preferences ?? {}) };
      for (const row of getPreferences(db, {}).preferences) preferences[String(row.signal)] = row.value;

      const plan = planResearch({
        job_type: campaign.job_type,
        starting_point: campaign.starting_point,
        platforms: campaign.platforms,
        brand_context: brandContext,
        competitor_records: competitors,
        trend_records: trendRecords(db, campaign.brand_id, campaignId),
        preferences,
        reference: campaign.intake?.reference ?? null,
      });
      plan.campaign_id = campaignId;
      requireValid('ResearchPlan', plan, 'research plan');
      const { version } = saveArtifact(db, campaignId, 'ResearchPlan', plan);
      return { ok: true, plan, version };
    },
  }),

  defineTool({
    name: 'research_record',
    description:
      'Store what a research specialist found, checked against its contract, and push it into memory the ' +
      'safe way: competitor findings become competitor analyses, brand and audience findings become ' +
      'verified research proposals. Agents: ' +
      RESEARCH_AGENTS.join(', ') +
      '.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        agent: { type: 'string', description: 'Which specialist produced the result.' },
        result: { type: 'object', description: 'The result in that specialist\'s contract shape.' },
      },
      required: ['campaign_id', 'agent', 'result'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const agent = String(args.agent);
      const kind = AGENT_CONTRACT[agent];
      if (!kind) {
        throw new InvalidInputError(`"${agent}" is not a research specialist Social Campaign knows about.`, {
          fix: `Use one of: ${RESEARCH_AGENTS.join(', ')}.`,
        });
      }
      const result = /** @type {any} */ ({ ...(args.result ?? {}) });
      if ('campaign_id' in loadSchema(kind).properties) result.campaign_id = campaignId;
      if ('brand_id' in loadSchema(kind).properties && campaign.brand_id) result.brand_id = campaign.brand_id;
      requireValid(kind, result, `${agent} result`);

      logEvent(db, campaignId, 'research.started', { agent, kind });
      const { id, version } = saveArtifact(db, campaignId, kind, result);
      const sourceRef = `artifact:${kind}:${version}`;

      /** @type {Record<string, unknown>} */
      const memory = { competitors_saved: 0, fields_applied: 0, fields_queued: 0, notes: [] };
      const notes = /** @type {string[]} */ (memory.notes);

      if (agent === 'competitor-researcher') {
        if (!campaign.brand_id) {
          notes.push('Competitor findings were kept with the job only, because it is not tied to a brand yet.');
        } else {
          for (const competitor of Array.isArray(result.competitors) ? result.competitors : []) {
            if (!competitor || typeof competitor.name !== 'string' || !competitor.name.trim()) continue;
            saveCompetitorAnalysis(db, {
              brand_id: campaign.brand_id,
              name: competitor.name.trim(),
              analysis: { ...competitor, scope: result.scope, coverage: result.coverage ?? null, campaign_id: campaignId },
              source_ref: sourceRef,
              analyst: agent,
            });
            memory.competitors_saved = Number(memory.competitors_saved) + 1;
          }
        }
      }

      if (agent === 'brand-researcher' || agent === 'audience-researcher') {
        if (!campaign.brand_id) {
          notes.push('Brand findings were kept with the job only, because it is not tied to a brand yet.');
        } else {
          const fields =
            agent === 'brand-researcher' ? brandFieldsFromResearch(result, sourceRef) : audienceFieldsFromResearch(result, sourceRef);
          if (fields.length > 0) {
            const outcome = proposeBrandUpdate(db, { brand_id: campaign.brand_id, fields, proposed_by: agent });
            memory.fields_applied = outcome.applied.length;
            memory.fields_queued = outcome.queued.length;
          }
        }
      }

      logEvent(db, campaignId, 'research.completed', { agent, kind, version, ...memory, notes: undefined });
      return { ok: true, id, kind, version, agent, memory };
    },
  }),

  defineTool({
    name: 'research_summary',
    description:
      'Everything the strategist should read before writing directions, merged from the research results ' +
      'and memory for a job and ordered by precedence: the campaign reference first, then brand facts and ' +
      'restrictions, explicit preferences, creative memory, inferred preferences, audience, competitors, trends.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const brand = latestArtifact(db, campaignId, 'BrandResearchResult');
      const competitor = latestArtifact(db, campaignId, 'CompetitorResearchResult');
      const trend = latestArtifact(db, campaignId, 'TrendResearchResult');
      const audience = latestArtifact(db, campaignId, 'AudienceResearchResult');
      const platform = latestArtifact(db, campaignId, 'PlatformPlan');
      const plan = latestArtifact(db, campaignId, 'ResearchPlan');
      const analyses = ['VideoCreativeAnalysis', 'ImageCreativeAnalysis', 'ScriptAnalysis']
        .map((kind) => ({ kind, artifact: latestArtifact(db, campaignId, kind) }))
        .filter((entry) => entry.artifact)
        .map((entry) => ({ kind: entry.kind, version: entry.artifact.version, result: entry.artifact.json }));

      let memory = null;
      try {
        memory = resolveContext(db, { brand_id: campaign.brand_id ?? undefined, campaign_id: campaignId });
      } catch {
        memory = null;
      }
      const context = memory?.context ?? {};

      const sections = [
        {
          rank: 2,
          layer: 'campaign_reference',
          label: 'specific campaign reference',
          content: {
            starting_point: campaign.starting_point,
            reference: campaign.intake?.reference ?? null,
            goal: campaign.intake?.goal ?? '',
            notes: campaign.intake?.notes ?? '',
            reference_analyses: analyses,
          },
        },
        {
          rank: 3,
          layer: 'brand',
          label: 'brand restrictions and official guidelines',
          content: {
            guidelines: context.brand_guidelines ?? [],
            research: brand?.json ?? null,
            restrictions: brand?.json?.restrictions ?? [],
            gaps: brand?.json?.gaps ?? [],
          },
        },
        { rank: 4, layer: 'explicit_preferences', label: 'explicit user or team preferences', content: context.explicit_preferences ?? [] },
        { rank: 5, layer: 'creative_memory', label: 'brand creative memory', content: context.creative_memory ?? null },
        { rank: 6, layer: 'inferred_preferences', label: 'inferred preferences', content: context.inferred_preferences ?? [] },
        { rank: 6.5, layer: 'audience', label: 'audience research', content: audience?.json ?? null },
        {
          rank: 7,
          layer: 'competitor_intelligence',
          label: 'competitor intelligence',
          content: { research: competitor?.json ?? null, memory: context.competitor_intelligence ?? [] },
        },
        { rank: 8, layer: 'trend_intelligence', label: 'trend intelligence', content: trend?.json ?? null },
        { rank: 9, layer: 'platform', label: 'platform execution guidance', content: platform?.json ?? null },
      ];

      const gaps = [
        ...(brand?.json?.gaps ?? []).map((gap) => ({ from: 'brand-researcher', gap })),
        ...(competitor?.json?.gaps ?? []).map((gap) => ({ from: 'competitor-researcher', gap })),
      ];
      const present = { brand: Boolean(brand), competitor: Boolean(competitor), trend: Boolean(trend), audience: Boolean(audience), platform: Boolean(platform) };
      const coverage = competitor?.json?.coverage ?? null;

      return {
        campaign: {
          id: campaign.id,
          title: campaign.title,
          job_type: campaign.job_type,
          starting_point: campaign.starting_point,
          platforms: campaign.platforms,
          brand_id: campaign.brand_id,
        },
        mode: campaign.starting_point === 'reference' ? 'reference' : 'normal',
        research_plan: plan?.json ?? null,
        present,
        coverage,
        sections,
        gaps,
        summaries: {
          brand: brand?.json?.summary ?? null,
          competitor: competitor?.json?.summary ?? null,
          trend: trend?.json?.summary ?? null,
          audience: audience?.json?.summary ?? null,
          platform: platform?.json?.summary ?? null,
        },
      };
    },
  }),

  defineTool({
    name: 'strategy_save',
    description:
      'Store a strategy set for a job, checked against the strategy contract: exactly three directions ' +
      'named Brand Native, Competitor Opportunity and Trend Forward, or in Reference Mode Reference-Led ' +
      'Adaptation, Brand Evolution and Trend-Competitive Evolution, unless custom_count is set because the ' +
      'user explicitly asked for a different number. Keeps every earlier version.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        strategy_set: { type: 'object', description: 'A StrategySet.' },
      },
      required: ['campaign_id', 'strategy_set'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const set = enforceStrategyContract({ ...(args.strategy_set ?? {}) }, campaign.starting_point);
      set.campaign_id = campaignId;
      set.schema_version = 1;
      requireValid('StrategySet', set, 'strategy set');
      const { id, version } = saveArtifact(db, campaignId, 'StrategySet', set);
      logEvent(db, campaignId, 'strategy.generated', {
        version,
        mode: set.mode,
        direction_count: set.directions.length,
        custom_count: set.custom_count ?? null,
      });
      return { ok: true, id, version, strategy_set: set };
    },
  }),

  defineTool({
    name: 'strategy_get',
    description: 'Fetch the current strategy set for a job, with its version and whether a direction has been approved.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        version: { type: 'number', description: 'Leave empty for the newest.' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      const artifact = args.version
        ? (() => {
            const row = db
              .prepare('SELECT id, json, version, created_at FROM artifacts WHERE campaign_id = ? AND kind = ? AND version = ? AND invalidated_at IS NULL')
              .get(campaignId, 'StrategySet', Number(args.version));
            return row
              ? { id: String(row.id), json: parseJson(String(row.json ?? 'null'), null), version: Number(row.version), created_at: String(row.created_at) }
              : null;
          })()
        : latestArtifact(db, campaignId, 'StrategySet');
      if (!artifact) throw new InvalidInputError('This job does not have a strategy yet.', { fix: 'Run the strategy step first.' });
      const rounds = revisionRounds(db, campaignId);
      return {
        strategy_set: artifact.json,
        version: artifact.version,
        created_at: artifact.created_at,
        approved: markedApproval(db, campaignId),
        review: approvedStrategyReview(db, campaignId),
        revision_rounds: rounds,
        max_rounds: MAX_STRATEGY_ROUNDS,
      };
    },
  }),

  defineTool({
    name: 'strategy_revise',
    description:
      'Record that the user asked for changes to the strategy, remember what they asked for as preference ' +
      'evidence, and return the previous strategy set with the notes so the strategist can redo it. Pass ' +
      'combine with the direction keys to merge when the user chose Combine Directions.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        notes: { type: 'string', description: 'What the user wants changed, in their words.' },
        combine: { type: 'array', description: 'Direction keys to combine, when the user chose that.' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const previous = latestArtifact(db, campaignId, 'StrategySet');
      if (!previous) throw new InvalidInputError('There is no strategy to revise yet.', { fix: 'Run the strategy step first.' });
      const notes = typeof args.notes === 'string' ? args.notes.trim() : '';
      const combine = (Array.isArray(args.combine) ? args.combine : []).map(String).filter(Boolean);
      if (!notes && combine.length === 0) {
        throw new InvalidInputError('Say what should change, or which directions to combine.');
      }
      const known = new Set((previous.json?.directions ?? []).map((direction) => String(direction.key)));
      for (const key of combine) {
        if (!known.has(key)) throw new InvalidInputError(`"${key}" is not one of the directions in the current strategy.`);
      }

      const evidence = [];
      if (notes) {
        evidence.push(
          recordEvidence(db, {
            kind: 'inferred',
            signal: 'strategy_revision',
            value: notes.slice(0, 500),
            campaign_id: campaignId,
            brand_id: campaign.brand_id ?? undefined,
            note: 'The user asked for changes at the strategy gate.',
          }).evidence,
        );
      }
      if (combine.length > 0) {
        evidence.push(
          recordEvidence(db, {
            kind: 'inferred',
            signal: 'strategy_combine',
            value: combine.join('+'),
            campaign_id: campaignId,
            brand_id: campaign.brand_id ?? undefined,
            note: 'The user combined directions at the strategy gate.',
          }).evidence,
        );
      }

      const rounds = revisionRounds(db, campaignId) + 1;
      logEvent(db, campaignId, 'strategy.revision_requested', { version: previous.version, notes, combine, round: rounds });
      // Asking for a different strategy invalidates everything written against the
      // old one, so the copy, the concepts and the media plan come back as rework
      // rather than quietly standing on an answer that changed.
      const strategyStage = progressStages(db, campaignId).find((entry) => /^strategy(_reference_mode)?$/.test(entry.stage));
      const revision = strategyStage
        ? reviseFrom({ db, campaign_id: campaignId, from_stage: strategyStage.stage, reason: notes || `Combine ${combine.join(' + ')}` })
        : { stages: [], invalidated: [] };
      return {
        ok: true,
        previous: previous.json,
        version: previous.version,
        notes,
        combine,
        round: rounds,
        needs_rework: revision.stages,
        invalidated: revision.invalidated,
        max_rounds: MAX_STRATEGY_ROUNDS,
        ask_user_directly: rounds > MAX_STRATEGY_ROUNDS,
        evidence,
      };
    },
  }),

  defineTool({
    name: 'strategy_mark_approved',
    description:
      'Record which direction the user approved at the strategy gate. Refuses unless the given review really ' +
      'was approved. Remembers the choice as preference evidence so repeated choices can become a preference.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        review_id: { type: 'string', description: 'The review returned by the strategy gate.' },
        direction_id: { type: 'string', description: 'The key of the chosen direction, or the combined keys joined with +.' },
      },
      required: ['campaign_id', 'review_id', 'direction_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const reviewId = String(args.review_id);
      const row = db.prepare('SELECT id, campaign_id, kind, decision, status FROM reviews WHERE id = ?').get(reviewId);
      if (!row) throw new InvalidInputError(`No review found for id "${reviewId}".`);
      if (String(row.campaign_id) !== campaignId) throw new InvalidInputError('That review belongs to a different job.');
      if (String(row.kind) !== 'strategy') throw new InvalidInputError('That review is not a strategy review.');
      if (String(row.status) !== 'resolved') {
        throw new InvalidInputError('The user has not decided on the strategy yet.', { fix: 'Keep waiting on the strategy gate.' });
      }
      const decision = parseJson(String(row.decision ?? '{}'), {});
      if (decision.action !== 'approve' && decision.action !== 'combine') {
        throw new InvalidInputError(`The strategy was not approved: the user chose ${String(decision.action ?? 'nothing')}.`, {
          fix: 'Revise the strategy and open the gate again.',
        });
      }

      const current = latestArtifact(db, campaignId, 'StrategySet');
      if (!current) throw new InvalidInputError('There is no strategy to approve yet.');
      const keys = new Set((current.json?.directions ?? []).map((direction) => String(direction.key)));
      const directionId = String(args.direction_id).trim();
      const parts = directionId.split('+').map((part) => part.trim()).filter(Boolean);
      const chosen = current.json.directions.filter((direction) => parts.includes(String(direction.key)));
      if (parts.length === 0 || chosen.length !== parts.length) {
        throw new InvalidInputError(`"${directionId}" is not a direction in the current strategy.`, {
          fix: `Use one of: ${[...keys].join(', ')}.`,
        });
      }
      if (decision.action === 'approve' && parts.length !== 1) {
        throw new InvalidInputError('The user approved a single direction, so name exactly one.');
      }

      const { evidence, promoted } = recordEvidence(db, {
        kind: 'inferred',
        signal: 'strategy_selection',
        value: parts.join('+'),
        campaign_id: campaignId,
        brand_id: campaign.brand_id ?? undefined,
        note: `Approved at the strategy gate (${decision.action}).`,
      });
      logEvent(db, campaignId, 'strategy.approved', {
        review_id: reviewId,
        direction_key: parts.join('+'),
        direction_titles: chosen.map((direction) => direction.title),
        version: current.version,
        action: decision.action,
        marked: true,
      });
      return {
        ok: true,
        review_id: reviewId,
        action: decision.action,
        direction_key: parts.join('+'),
        directions: chosen,
        version: current.version,
        evidence,
        promoted,
      };
    },
  }),

  defineTool({
    name: 'concepts_save',
    description:
      'Store the ranked creative concepts for a job: for each, an id, a title, the hook, the structure, ' +
      'the shots, on screen text, the call to action and the platform. Keeps every earlier version.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        concepts: { type: 'array', description: '[{id, title, hook, structure, shots[], on_screen_text[], cta, platform, direction_key, notes}]' },
      },
      required: ['campaign_id', 'concepts'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      readCampaign(db, campaignId);
      const concepts = Array.isArray(args.concepts) ? args.concepts : [];
      if (concepts.length === 0) throw new InvalidInputError('Send at least one concept.');
      const ids = new Set();
      const cleaned = concepts.map((concept, index) => {
        if (!concept || typeof concept !== 'object') throw new InvalidInputError(`Concept ${index + 1} is not an object.`);
        const id = String(concept.id ?? `concept-${index + 1}`);
        if (ids.has(id)) throw new InvalidInputError(`Two concepts share the id "${id}".`);
        ids.add(id);
        if (typeof concept.title !== 'string' || !concept.title.trim()) throw new InvalidInputError(`Concept ${id} needs a title.`);
        if (typeof concept.hook !== 'string' || !concept.hook.trim()) throw new InvalidInputError(`Concept ${id} needs a hook.`);
        if (concept.platform !== undefined && concept.platform !== null && !PLATFORMS.includes(String(concept.platform))) {
          throw new InvalidInputError(`Concept ${id} names a platform Social Campaign does not support.`);
        }
        return { ...concept, id, rank: typeof concept.rank === 'number' ? concept.rank : index + 1 };
      });
      const { id, version } = saveArtifact(db, campaignId, 'ConceptList', { schema_version: 1, campaign_id: campaignId, concepts: cleaned });
      return { ok: true, id, version, count: cleaned.length };
    },
  }),

  defineTool({
    name: 'copy_save',
    description:
      'Store the copy package for a job, checked against the copy contract. Refused until the user has ' +
      'approved a strategy direction, and the copy has to execute that direction.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        copy_package: { type: 'object', description: 'A CopyPackage.' },
      },
      required: ['campaign_id', 'copy_package'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      // The same rule the generic artifact_save applies, from the one module that
      // owns it, so copy cannot be written before an approved strategy by either door
      // and a later rejection takes that approval back for both.
      assertDomainRules({ db, root: workspace.root ?? null, campaign_id: campaignId, kind: 'CopyPackage', json: args.copy_package ?? {} });
      // The review that authorised this copy: the strategy approval on a route that
      // has one, otherwise the concept approval of this job's reuse brief.
      const review = approvedStrategyReview(db, campaignId) ?? { review_id: approvalStatus(db, campaignId, 'concept').review_id };
      const pkg = /** @type {any} */ ({ ...(args.copy_package ?? {}) });
      pkg.campaign_id = campaignId;
      pkg.schema_version = 1;
      requireValid('CopyPackage', pkg, 'copy package');

      const approval = markedApproval(db, campaignId);
      const current = latestArtifact(db, campaignId, 'StrategySet');
      const allowed = approval
        ? approval.direction_key.split('+')
        : (current?.json?.directions ?? []).map((direction) => String(direction.key));
      const directionKeys = String(pkg.direction_key).split('+').map((part) => part.trim());
      if (allowed.length > 0 && !directionKeys.every((key) => allowed.includes(key))) {
        throw new InvalidInputError(`The copy executes "${pkg.direction_key}", which is not the approved direction.`, {
          fix: `Write the copy for ${allowed.join(' + ')}.`,
        });
      }
      const unknownPlatform = (pkg.variants ?? []).find((variant) => !campaign.platforms.includes(String(variant.platform)));
      if (unknownPlatform) {
        throw new InvalidInputError(`There is copy for ${platformLabel(String(unknownPlatform.platform))}, which this job does not target.`);
      }

      // Copy validation: caption length, hook placement inside the visible cutoff,
      // hashtag count and format, link handling and the AI-generated video
      // disclosure, per platform. server/copy/check.mjs, ported from
      // social-media-pipeline's platform-check.js. A hard error refuses the save
      // with a plain-language reason; a soft issue comes back as a warning the
      // copywriter has to address, but does not block saving.
      const checked = checkCopyPackage(pkg);
      const failing = checked.results.filter((entry) => !entry.pass);
      if (failing.length > 0) {
        const first = failing[0].findings.find((entry) => entry.severity === 'fail');
        throw new InvalidInputError(
          `The copy for ${platformLabel(failing[0].platform)} is not ready to save: ${first?.message ?? 'it fails a platform rule.'}`,
          {
            fix: 'Fix the issue and save the copy again.',
            details: { platform_checks: checked.results },
          },
        );
      }
      const warnings = checked.results.flatMap((entry) =>
        entry.findings.filter((finding) => finding.severity === 'warn').map((finding) => ({ platform: entry.platform, ...finding })),
      );

      const { id, version } = saveArtifact(db, campaignId, 'CopyPackage', pkg);
      return { ok: true, id, version, review_id: review.review_id ?? null, warnings };
    },
  }),

  defineTool({
    name: 'platform_plan_save',
    description:
      'Store the platform plan for a job, checked against its contract: at most three platforms from ' +
      'Facebook, Instagram and TikTok, exactly one execution per platform, and no two executions that are ' +
      'the same thing resized.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        platform_plan: { type: 'object', description: 'A PlatformPlan.' },
      },
      required: ['campaign_id', 'platform_plan'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const campaign = readCampaign(db, campaignId);
      const plan = /** @type {any} */ ({ ...(args.platform_plan ?? {}) });
      plan.campaign_id = campaignId;
      plan.schema_version = 1;
      requireValid('PlatformPlan', plan, 'platform plan');

      const entries = Array.isArray(plan.platforms) ? plan.platforms : [];
      if (entries.length > MAX_PLATFORMS) {
        throw new InvalidInputError(`A plan covers at most ${MAX_PLATFORMS} platforms.`);
      }
      const seen = new Set();
      const fingerprints = new Map();
      for (const entry of entries) {
        const platform = String(entry.platform);
        if (!PLATFORMS.includes(platform)) throw new InvalidInputError(`"${platform}" is not a platform Social Campaign supports.`);
        if (seen.has(platform)) throw new InvalidInputError(`${platformLabel(platform)} has two executions; a plan needs exactly one per platform.`);
        seen.add(platform);
        if (!campaign.platforms.includes(platform)) {
          throw new InvalidInputError(`The plan covers ${platformLabel(platform)}, which this job does not target.`);
        }
        const fingerprint = executionFingerprint(entry);
        const twin = fingerprints.get(fingerprint);
        if (twin) {
          throw new InvalidInputError(
            `The ${platformLabel(twin)} and ${platformLabel(platform)} executions are identical. Each platform needs its own native creative, not a resized copy.`,
            { fix: 'Change the format, hook window, caption guidance or adaptation notes so each platform is genuinely different.' },
          );
        }
        fingerprints.set(fingerprint, platform);
      }
      const missing = campaign.platforms.filter((platform) => !seen.has(platform));
      if (missing.length > 0) {
        throw new InvalidInputError(`The plan has no execution for ${missing.map(platformLabel).join(' and ')}.`);
      }
      const { id, version } = saveArtifact(db, campaignId, 'PlatformPlan', plan);
      return { ok: true, id, version, platforms: [...seen] };
    },
  }),
];
