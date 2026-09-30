/**
 * The four human approval gates plus their support tools.
 *
 * review_strategy, review_cost, review_media and review_final are the gate tools
 * named in docs/CONTRACTS.md section 1; review_concepts rides the same pattern for
 * the copy/concept checkpoint between strategy and cost. Every one of them opens a
 * screen through server/review/gate.mjs's openGate() and waits per the gate pattern.
 *
 * review_get, review_list and approval_check are read only helpers other domains use
 * as guards: the media producer checks approval_check({kind: 'cost'}) before spending
 * credits, and the publisher checks approval_check({kind: 'final'}) before posting.
 */

import { defineTool } from '../mcp/registry.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { openGate, reviewWait, resolveFromChat } from '../review/gate.mjs';
import { phaseForCampaign } from '../planner/phases.mjs';
import { ledgerFor, paidGenerationSummary, readManifest } from '../generation/manifest.mjs';
import { computeCampaignStats } from './events.mjs';
import { assemblePosts } from './publishing.mjs';
import { buildRelease, currentRelease, readRelease, setReleaseStatus } from '../release/package.mjs';
import { approvalStatus, APPROVAL_REASON_MESSAGE, APPROVAL_KINDS } from '../review/approvals.mjs';
import { listAttempts, ATTEMPT_STATE_LABEL } from '../publishing/dispatch.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

/**
 * The `coverage` value the named research artifact's latest version carries, or null
 * when there is no such artifact or it carries no coverage field.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {string|null}
 */
function latestResearchCoverage(db, campaignId, kind) {
  const value = currentArtifact(db, campaignId, kind)?.json ?? null;
  const coverage = value && typeof value === 'object' ? value.coverage : null;
  return typeof coverage === 'string' ? coverage : null;
}

/**
 * A single muted line for the strategy review, composed from the research artifacts'
 * own `coverage` values, so the decision it affects shows it once, plainly, where it
 * matters. Returns null when every artifact that reported coverage reported full (or
 * none of them ran yet), so the note only appears when something is actually degraded.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {string|null}
 */
export function strategyCoverageNote(db, campaignId) {
  const areas = [
    { label: 'Competitor', kind: 'CompetitorResearchResult' },
    { label: 'Trend', kind: 'TrendResearchResult' },
    { label: 'Audience', kind: 'AudienceResearchResult' },
  ];
  const degraded = areas
    .map((area) => ({ ...area, coverage: latestResearchCoverage(db, campaignId, area.kind) }))
    .filter((area) => area.coverage && area.coverage !== 'full');
  if (degraded.length === 0) return null;
  const labels = degraded.map((area) => area.label);
  const joined =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const noun = labels.length === 1 ? 'findings' : 'findings';
  const anyNone = degraded.some((area) => area.coverage === 'none');
  return anyNone
    ? `${joined} ${noun} came from public web pages rather than the platforms themselves; treat them as directional.`
    : `${joined} ${noun} came partly from public web pages rather than the platforms themselves; treat those parts as directional.`;
}

/**
 * The campaign's brand name, for display, or null when the campaign has no brand or
 * the brand has none set.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {string|null}
 */
function campaignBrandName(db, campaignId) {
  const campaign = db.prepare('SELECT brand_id FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign || !campaign.brand_id) return null;
  const brand = db.prepare('SELECT name FROM brands WHERE id = ?').get(campaign.brand_id);
  return brand && brand.name ? String(brand.name) : null;
}

/**
 * Resolve one asset row from the library by id, for a review payload that names an
 * asset by `asset_id` rather than carrying its `path` outright. Returns null rather
 * than throwing, because a review payload should still show every other asset when
 * one id is stale; the screen shows what it has.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} assetId
 * @returns {{id: string, path: string, kind: string, duration: number|null}|null}
 */
function lookupAsset(db, assetId) {
  try {
    const row = db.prepare('SELECT id, path, kind, duration FROM assets WHERE id = ?').get(assetId);
    if (!row) return null;
    return {
      id: String(row.id),
      path: String(row.path),
      kind: String(row.kind),
      duration: row.duration == null ? null : Number(row.duration),
    };
  } catch {
    return null;
  }
}

/**
 * Fill in an asset or media entry's `path`, `kind` and `duration_s` from the asset
 * library when the entry only names an `asset_id`, so the pane always has something
 * to build a preview url from whether generation, editing or export handed the
 * review tool an id or a path. An entry that already carries a `path` is trusted as
 * given; a bare `asset_id` is resolved against the `assets` table (rendered clips,
 * subtitled renders and per platform exports are all registered there, see
 * `edit_export` and `subtitles_render`).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {any} entry
 * @returns {any}
 */
function resolveMediaEntry(db, entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.path) return entry;
  const assetId = entry.asset_id ?? entry.id ?? null;
  if (!assetId) return entry;
  const found = lookupAsset(db, String(assetId));
  if (!found) return entry;
  return {
    ...entry,
    path: found.path,
    kind: entry.kind ?? found.kind,
    duration_s: entry.duration_s ?? (found.duration == null ? null : found.duration),
  };
}

/**
 * Whether this campaign was already approved once and has moved on since, so the
 * screen can say plainly that an earlier approval no longer covers what is on it.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {{digest: string}} release
 * @returns {boolean}
 */
function needsReapproval(db, campaignId, release) {
  const row = db
    .prepare(
      "SELECT decision, target FROM reviews WHERE campaign_id = ? AND kind = 'final' AND status = 'resolved' " +
        'ORDER BY resolved_at DESC, id DESC LIMIT 1',
    )
    .get(campaignId);
  if (!row) return false;
  const decision = parseJson(String(row.decision ?? '{}'), {});
  if (decision.action !== 'approve') return false;
  const target = row.target ? parseJson(String(row.target), null) : null;
  return !target || target.digest !== release.digest;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 */
function readReview(db, id) {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    kind: String(row.kind),
    payload: parseJson(String(row.payload ?? '{}'), {}),
    decision: row.decision ? parseJson(String(row.decision), {}) : null,
    status: String(row.status),
    target: row.target ? parseJson(String(row.target), null) : null,
    created_at: String(row.created_at),
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  };
}

/**
 * The spend ledger to show at the cost gate: what this job may spend once the user
 * approves, what is already spent, what is set aside for items being made right now,
 * and what is left. It is the cost gate's own ledger (server/generation/cost-gate.mjs)
 * over the job's generation record, with the estimate on screen as the approved
 * amount, so the numbers on the screen are the numbers generation_begin enforces.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {any} estimate
 * @returns {{approved: number, reserved: number, spent: number, available: number}}
 */
export function costGateLedger(db, campaignId, estimate) {
  const manifest = readManifest(db, campaignId) ?? {};
  const onFile = manifest.cost_estimate ?? {};
  const shown = {
    ...onFile,
    ...(Array.isArray(estimate?.items) ? { items: estimate.items } : {}),
    total_credits: Number.isFinite(Number(estimate?.total_credits)) ? Number(estimate.total_credits) : onFile.total_credits,
  };
  return ledgerFor({ ...manifest, cost_estimate: shown });
}

/**
 * Check the results tool's own payload shape before it ever reaches the screen:
 * `sections[]` each with a `title`, an optional `summary`, `findings[]` (each a
 * `claim`, a `confidence` of high, medium or low, a `source_label`, and an optional
 * `source_url`) and an optional `so_what`; plus `gaps[]` (each a `text` and an
 * optional `needs_answer`), and an optional `coverage` with a `level` of full,
 * partial or thin and an optional `note`. Anything outside this shape is refused
 * with a plain message naming exactly what is wrong, rather than rendered and
 * flattened into "[object Object]".
 * @param {any} input
 * @returns {string[]} empty when the shape is fine
 */
function validateResearchResults(input) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return ['results must be an object.'];
  }

  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections)) {
      errors.push('sections must be an array.');
    } else {
      input.sections.forEach((section, i) => {
        if (!section || typeof section !== 'object') {
          errors.push(`sections[${i}] must be an object.`);
          return;
        }
        if (typeof section.title !== 'string' || section.title.trim().length === 0) {
          errors.push(`sections[${i}].title is required.`);
        }
        if (section.summary !== undefined && typeof section.summary !== 'string') {
          errors.push(`sections[${i}].summary must be a string.`);
        }
        if (section.so_what !== undefined && typeof section.so_what !== 'string') {
          errors.push(`sections[${i}].so_what must be a string.`);
        }
        if (section.findings !== undefined) {
          if (!Array.isArray(section.findings)) {
            errors.push(`sections[${i}].findings must be an array.`);
          } else {
            section.findings.forEach((finding, j) => {
              if (!finding || typeof finding !== 'object') {
                errors.push(`sections[${i}].findings[${j}] must be an object.`);
                return;
              }
              if (typeof finding.claim !== 'string' || finding.claim.trim().length === 0) {
                errors.push(`sections[${i}].findings[${j}].claim is required.`);
              }
              if (!['high', 'medium', 'low'].includes(finding.confidence)) {
                errors.push(`sections[${i}].findings[${j}].confidence must be "high", "medium" or "low".`);
              }
              if (typeof finding.source_label !== 'string' || finding.source_label.trim().length === 0) {
                errors.push(`sections[${i}].findings[${j}].source_label is required.`);
              }
              if (
                finding.source_url !== undefined &&
                finding.source_url !== null &&
                typeof finding.source_url !== 'string'
              ) {
                errors.push(`sections[${i}].findings[${j}].source_url must be a string.`);
              }
            });
          }
        }
      });
    }
  }

  if (input.gaps !== undefined) {
    if (!Array.isArray(input.gaps)) {
      errors.push('gaps must be an array.');
    } else {
      input.gaps.forEach((gap, i) => {
        if (!gap || typeof gap !== 'object') {
          errors.push(`gaps[${i}] must be an object.`);
          return;
        }
        if (typeof gap.text !== 'string' || gap.text.trim().length === 0) {
          errors.push(`gaps[${i}].text is required.`);
        }
        if (gap.needs_answer !== undefined && typeof gap.needs_answer !== 'boolean') {
          errors.push(`gaps[${i}].needs_answer must be true or false.`);
        }
      });
    }
  }

  if (input.coverage !== undefined && input.coverage !== null) {
    if (typeof input.coverage !== 'object' || Array.isArray(input.coverage)) {
      errors.push('coverage must be an object.');
    } else {
      if (!['full', 'partial', 'thin'].includes(input.coverage.level)) {
        errors.push('coverage.level must be "full", "partial" or "thin".');
      }
      if (input.coverage.note !== undefined && input.coverage.note !== null && typeof input.coverage.note !== 'string') {
        errors.push('coverage.note must be a string.');
      }
    }
  }

  return errors;
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const reviewTools = [
  defineTool({
    name: 'review_strategy',
    description:
      'Open the strategy approval gate: shows the three campaign directions from the Strategist and waits ' +
      'for the user to approve one, ask for changes, combine directions, or reject. Returns status pending ' +
      'with a review_id after about 20 minutes if undecided; call review_wait with that id immediately and ' +
      'keep calling it until it resolves. Never fall back to asking for approval in chat.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        strategy_set: { type: 'object', description: 'A StrategySet object, schemas/strategy-set.schema.json.' },
      },
      required: ['campaign_id', 'strategy_set'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const strategySet = /** @type {any} */ (args.strategy_set) ?? {};
      const directions = Array.isArray(strategySet.directions) ? strategySet.directions : [];
      return await openGate({
        workspace,
        ui,
        signal,
        campaign_id: String(args.campaign_id),
        kind: 'strategy',
        screen: 'strategy_review',
        allowedActions: ['approve', 'request_changes', 'reject', 'combine'],
        payload: {
          title: 'Review the strategy',
          campaign_id: String(args.campaign_id),
          phase: phaseForCampaign(workspace.requireDb(), String(args.campaign_id)),
          mode: strategySet.mode ?? 'normal',
          reference: strategySet.reference ?? null,
          directions,
          evidence_gaps: strategySet.evidence_gaps ?? [],
          summary: strategySet.summary ?? '',
          coverage_note: strategyCoverageNote(workspace.requireDb(), String(args.campaign_id)),
        },
        generatedEvent: 'strategy.generated',
        generatedPayload: { direction_count: directions.length },
      });
    },
  }),

  defineTool({
    name: 'review_concepts',
    description:
      'Open the concept approval gate: shows UGC or ad concepts, and the copy package if there is one, and ' +
      'waits for approve, request_changes or reject.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        concepts: { type: 'array', description: 'Ranked concept objects from the Scriptwriter or Strategist.' },
        copy_package: { type: 'object', description: 'Optional CopyPackage, schemas/copy-package.schema.json.' },
      },
      required: ['campaign_id', 'concepts'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      return await openGate({
        workspace,
        ui,
        signal,
        campaign_id: String(args.campaign_id),
        kind: 'concept',
        screen: 'concept_review',
        allowedActions: ['approve', 'request_changes', 'reject'],
        payload: {
          title: 'Review the concepts',
          campaign_id: String(args.campaign_id),
          phase: phaseForCampaign(workspace.requireDb(), String(args.campaign_id)),
          concepts: Array.isArray(args.concepts) ? args.concepts : [],
          copy_package: args.copy_package ?? null,
        },
      });
    },
  }),

  defineTool({
    name: 'review_cost',
    description:
      'Open the cost approval gate before any paid generation: shows the itemized credit estimate and waits ' +
      'for approve, reduce (send fewer items back for a smaller plan) or cancel. The screen also shows the ' +
      'spend ledger for the job: approved, already spent, set aside for work in progress, and still available. ' +
      'On approve, returns cost_approval_id, which media generation tools require before spending credits.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        estimate: {
          type: 'object',
          description: '{ items: [{label, provider, units, unit_cost, credits}], total_credits, currency_note }',
        },
      },
      required: ['campaign_id', 'estimate'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const estimate = /** @type {any} */ (args.estimate) ?? {};
      const ledger = costGateLedger(workspace.requireDb(), String(args.campaign_id), estimate);
      const result = await openGate({
        workspace,
        ui,
        signal,
        campaign_id: String(args.campaign_id),
        kind: 'cost',
        screen: 'cost_review',
        allowedActions: ['approve', 'reduce', 'cancel'],
        payload: {
          title: 'Review the cost',
          campaign_id: String(args.campaign_id),
          phase: phaseForCampaign(workspace.requireDb(), String(args.campaign_id)),
          items: Array.isArray(estimate.items) ? estimate.items : [],
          total_credits: estimate.total_credits ?? null,
          currency_note: estimate.currency_note ?? null,
          ledger,
        },
        generatedEvent: 'cost.estimated',
        generatedPayload: { total_credits: estimate.total_credits ?? null },
      });
      if (result.status === 'resolved' && result.action === 'approve') {
        return { ...result, cost_approval_id: result.review_id };
      }
      return result;
    },
  }),

  defineTool({
    name: 'review_media',
    description:
      'Open the media approval gate: shows every generated asset with a preview and waits for one decision - ' +
      'approve, regenerate (payload notes), edit_prompt (payload new prompt) or reject on a single asset ' +
      '(payload asset_id), or approve_all for the whole batch. Call again to collect the next decision when ' +
      'more than one asset needs a separate call.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        media_package: { type: 'object', description: 'A GeneratedMediaPackage, schemas/generated-media-package.schema.json.' },
      },
      required: ['campaign_id', 'media_package'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const db = workspace.requireDb();
      const mediaPackage = /** @type {any} */ (args.media_package) ?? {};
      const rawAssets = Array.isArray(mediaPackage.assets) ? mediaPackage.assets : [];
      // A rendered or exported asset may be named by asset_id alone (the finished,
      // edited, subtitled clip that generate/SKILL.md hands to this gate after the
      // render step), not only by a path already known to the caller.
      const assets = rawAssets.map((asset) => resolveMediaEntry(db, asset));
      return await openGate({
        workspace,
        ui,
        signal,
        campaign_id: String(args.campaign_id),
        kind: 'media',
        screen: 'media_review',
        allowedActions: ['approve', 'regenerate', 'edit_prompt', 'reject', 'approve_all'],
        payload: {
          title: 'Review the generated media',
          campaign_id: String(args.campaign_id),
          phase: phaseForCampaign(db, String(args.campaign_id)),
          assets,
          cost_approval_id: mediaPackage.cost_approval_id ?? null,
        },
        generatedEvent: 'asset.generated',
        generatedPayload: { asset_count: assets.length },
      });
    },
  }),

  defineTool({
    name: 'review_final',
    description:
      'Open the final approval gate on one release: shows exactly the posts in that release, the file each one ' +
      'will publish, the release version and the cost, then waits for approve, request_changes or reject. ' +
      'Pass a release_id to review a release that is already built, or a package of posts to build one from. ' +
      'The approval is recorded against that release, so any later change needs approving again.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        release_id: { type: 'string', description: 'A release from release_build. Built from the package or the current state when left out.' },
        provider: { type: 'string', description: 'The provider frozen into the release intent.' },
        mode: { type: 'string', description: 'publish or schedule, frozen into the release intent.' },
        timezone: { type: 'string', description: 'The original timezone for the frozen UTC schedule.' },
        original_timezone: { type: 'string', description: 'Optional original timezone label for the frozen schedule.' },
        package: {
          type: 'object',
          description:
            'The posts to freeze into a release: platform, caption, hashtags, first comment, media, and optional intent {provider, mode, timezone, original_timezone}.',
        },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const pkg = /** @type {any} */ (args.package) ?? {};
      const suppliedIntent =
        pkg.intent && typeof pkg.intent === 'object'
          ? pkg.intent
          : args.provider || args.mode || args.timezone || args.original_timezone
            ? {
                provider: args.provider ?? null,
                mode: args.mode ?? null,
                timezone: args.timezone ?? null,
                original_timezone: args.original_timezone ?? null,
              }
            : null;

      // One release, built or read here, is what the person is shown and what the
      // approval is recorded against. The old path showed whatever posts the caller
      // passed while publishing rebuilt its own set from the latest artifacts; the
      // two could name different files, and the probe in the architecture review
      // showed exactly that happening.
      let release = args.release_id
        ? readRelease(db, String(args.release_id))
        : buildRelease({
            db,
            root: workspace.requireRoot(),
            campaign_id: campaignId,
            posts: Array.isArray(pkg.posts) && pkg.posts.length > 0 ? pkg.posts : undefined,
            intent: suppliedIntent,
          });
      if (!release) throw new InvalidInputError('There is no release with that id.');
      const intentMismatch =
        Boolean(args.release_id && suppliedIntent) &&
        (!release.intent ||
          Object.entries(suppliedIntent).some(
            ([key, value]) => value != null && String(release.intent[key] ?? '') !== String(value),
          ));
      if (intentMismatch) {
        release = buildRelease({
          db,
          root: workspace.requireRoot(),
          campaign_id: campaignId,
          posts: release.posts,
          intent: suppliedIntent,
        });
      }

      const posts = release.posts.map((post) => ({
        post_index: post.post_index,
        platform: post.platform,
        caption: post.caption,
        hashtags: post.hashtags,
        first_comment: post.first_comment,
        account_id: post.account_id,
        scheduled_for: post.scheduled_at,
        asset_id: post.asset_id,
        media: post.asset_path
          ? {
              path: post.asset_path,
              kind: post.asset_kind === 'image' ? 'image' : 'video',
              duration_s: post.duration_s ?? null,
              subtitles_burned_in: post.subtitles_burned_in ?? null,
            }
          : null,
      }));

      const result = await openGate({
        workspace,
        ui,
        signal,
        campaign_id: campaignId,
        kind: 'final',
        screen: 'final_review',
        allowedActions: ['approve', 'request_changes', 'reject'],
        target: { release_id: release.release_id, digest: release.digest, intent_digest: release.intent?.digest ?? null },
        payload: {
          title: 'Review before publishing',
          campaign_id: campaignId,
          phase: phaseForCampaign(db, campaignId),
          posts,
          release_id: release.release_id,
          release_version: release.version,
          intent: release.intent ?? null,
          needs_reapproval: needsReapproval(db, campaignId, release),
          summary: pkg.summary ?? '',
          brand_name: pkg.brand_name ?? campaignBrandName(db, campaignId),
          stats: safeStats(db, campaignId),
          cost: finalCostBlock(db, campaignId),
        },
      });
      if (result.status === 'resolved' && result.action === 'approve') {
        setReleaseStatus(db, release.release_id, 'approved');
        return { ...result, final_approval_id: result.review_id, release_id: release.release_id, release_version: release.version };
      }
      return { ...result, release_id: release.release_id, release_version: release.version };
    },
  }),

  defineTool({
    name: 'review_wait',
    description:
      'Keep waiting on a review gate that returned status "pending". Pass the review_id from that result. ' +
      'Resolving here persists the decision to the review record and logs the matching event, exactly as if ' +
      'the user had decided within the first wait.',
    inputSchema: {
      type: 'object',
      properties: { review_id: { type: 'string' } },
      required: ['review_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const result = await reviewWait({ workspace, ui, review_id: String(args.review_id), signal });
      if (result.status === 'resolved' && result.action === 'approve') {
        const db = workspace.requireDb();
        const row = readReview(db, String(args.review_id));
        if (row && row.kind === 'cost') return { ...result, cost_approval_id: row.id };
        if (row && row.kind === 'final') return { ...result, final_approval_id: row.id };
      }
      return result;
    },
  }),

  defineTool({
    name: 'review_resolve_from_chat',
    description:
      'Record a decision the person typed in chat instead of clicking in the pane, for a gate that returned ' +
      'status "pending". Pass the review_id, the action they chose (the same action names the pane screen ' +
      'accepts, for example "approve", "request_changes", "reject"), and any payload the action needs. This ' +
      'goes through the exact same path a pane click uses, so nothing about the decision is skipped. Follow it ' +
      'immediately with review_wait using the same review_id, which is what actually persists the decision and ' +
      'logs its event and returns the resolved result.',
    inputSchema: {
      type: 'object',
      properties: {
        review_id: { type: 'string' },
        action: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['review_id', 'action'],
      additionalProperties: false,
    },
    handler: (args, { workspace, ui }) =>
      resolveFromChat({
        workspace,
        ui,
        review_id: String(args.review_id),
        action: String(args.action),
        payload: /** @type {Record<string, unknown>} */ (args.payload ?? {}),
      }),
  }),

  defineTool({
    name: 'review_get',
    description: 'Read one review by id: what was shown, what was decided, and its status.',
    inputSchema: {
      type: 'object',
      properties: { review_id: { type: 'string' } },
      required: ['review_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const row = readReview(db, String(args.review_id));
      if (!row) throw new InvalidInputError(`No review found for id "${args.review_id}".`);
      return row;
    },
  }),

  defineTool({
    name: 'review_list',
    description: 'List every review recorded for a campaign, newest first.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const rows = db
        .prepare('SELECT id FROM reviews WHERE campaign_id = ? ORDER BY created_at DESC, id DESC')
        .all(String(args.campaign_id));
      return { reviews: rows.map((row) => readReview(db, String(row.id))) };
    },
  }),

  defineTool({
    name: 'approval_check',
    description:
      'Check whether a campaign is approved at a gate right now (strategy, concept, cost, media or final). ' +
      'Only the newest decision counts, so a later rejection or request for changes takes an earlier ' +
      'approval back. For the final gate the approval also has to be about the release as it stands now. ' +
      'When it is not approved the answer says why: no_review, rejected_later or changed_since_approval.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string', description: 'strategy, concept, cost, media or final.' },
      },
      required: ['campaign_id', 'kind'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const kind = String(args.kind);
      if (!APPROVAL_KINDS.includes(kind)) {
        throw new InvalidInputError(`"${kind}" is not a gate this plugin has.`, {
          fix: `Use one of: ${APPROVAL_KINDS.join(', ')}.`,
        });
      }
      const status = approvalStatus(db, String(args.campaign_id), kind);
      return {
        approved: status.approved,
        review_id: status.review_id,
        reason: status.reason,
        message: status.message,
        release_id: status.release_id,
        digest: status.digest,
      };
    },
  }),

  defineTool({
    name: 'approval_assert_current',
    description:
      'Refuse in plain words unless a campaign is approved at a gate right now. The guard the publishing and ' +
      'export tools use: same rule as approval_check, but it returns the sentence to say to the person and ' +
      'the release the approval is about.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string', description: 'strategy, concept, cost, media or final.' },
      },
      required: ['campaign_id', 'kind'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const kind = String(args.kind);
      if (!APPROVAL_KINDS.includes(kind)) {
        throw new InvalidInputError(`"${kind}" is not a gate this plugin has.`, {
          fix: `Use one of: ${APPROVAL_KINDS.join(', ')}.`,
        });
      }
      const campaignId = String(args.campaign_id);
      const status = approvalStatus(db, campaignId, kind);
      if (!status.approved) {
        return {
          ok: false,
          approved: false,
          kind,
          reason: status.reason,
          message: status.message ?? APPROVAL_REASON_MESSAGE.no_review,
          review_id: status.review_id,
        };
      }
      const release = kind === 'final' ? currentRelease(db, campaignId) : null;
      return {
        ok: true,
        approved: true,
        kind,
        review_id: status.review_id,
        release_id: release ? release.release_id : null,
        release_version: release ? release.version : null,
        digest: release ? release.digest : null,
      };
    },
  }),

  defineTool({
    name: 'research_progress_show',
    description: 'Show research in progress: a plain list of steps and their status. Not a gate; no waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        steps: { type: 'array', description: '[{name, status}]' },
      },
      required: ['campaign_id', 'steps'],
      additionalProperties: false,
    },
    handler: (args, { ui, workspace }) => {
      const screen = ui.show('research_progress', {
        title: 'Researching',
        campaign_id: String(args.campaign_id),
        phase: phaseForCampaign(workspace.requireDb(), String(args.campaign_id)),
        steps: Array.isArray(args.steps) ? args.steps : [],
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'stage_progress_show',
    description:
      'Show any stage in progress: a plain list of steps and their status, titled for that stage. The same ' +
      'screen research_progress_show uses, generalized so creative, generation and publishing stages have a ' +
      'progress screen too. Not a gate; no waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        stage: { type: 'string', description: 'The stage name, used to build a sensible default title.' },
        title: { type: 'string', description: 'Optional override, for example "Generating media".' },
        steps: { type: 'array', description: '[{key, label, status}]' },
      },
      required: ['campaign_id', 'stage', 'steps'],
      additionalProperties: false,
    },
    handler: (args, { ui, workspace }) => {
      const stage = String(args.stage);
      const title =
        typeof args.title === 'string' && args.title
          ? args.title
          : `${stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} in progress`;
      const steps = Array.isArray(args.steps)
        ? args.steps.map((step) => ({
            name: String(step.label ?? step.key ?? step.name ?? ''),
            status: String(step.status ?? 'pending'),
          }))
        : [];
      const screen = ui.show('research_progress', {
        title,
        campaign_id: String(args.campaign_id),
        phase: phaseForCampaign(workspace.requireDb(), String(args.campaign_id)),
        stage,
        steps,
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'research_results_show',
    description:
      'Show finished research results with a Continue action. Not a gate; no waiting. `results` must be ' +
      '{ sections?: [{ title, summary?, findings?: [{ claim, confidence: "high"|"medium"|"low", source_label, ' +
      'source_url? }], so_what? }], gaps?: [{ text, needs_answer? }], coverage?: { level: "full"|"partial"|"thin", ' +
      'note? } }. Anything outside that shape is refused with a plain message naming what is wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        results: {
          type: 'object',
          description:
            '{ sections?: [{title, summary?, findings?: [{claim, confidence, source_label, source_url?}], ' +
            'so_what?}], gaps?: [{text, needs_answer?}], coverage?: {level, note?} }',
        },
      },
      required: ['campaign_id', 'results'],
      additionalProperties: false,
    },
    handler: (args, { workspace, ui }) => {
      const campaignId = String(args.campaign_id);
      const results = /** @type {any} */ (args.results) ?? {};
      const errors = validateResearchResults(results);
      if (errors.length > 0) {
        throw new InvalidInputError(`The research results are not in the shape the screen understands: ${errors.join(' ')}`);
      }
      const screen = ui.show('research_results', {
        title: 'Research results',
        campaign_id: campaignId,
        sections: Array.isArray(results.sections) ? results.sections : [],
        gaps: Array.isArray(results.gaps) ? results.gaps : [],
        coverage: results.coverage ?? null,
      });
      const db = workspace.requireDb();
      db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
        newId(),
        campaignId,
        'research.completed',
        toJsonColumn({}),
        nowIso(),
      );
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'question_ask',
    description:
      'Ask the user a multiple choice question inside the pane instead of in chat: shows the question, the ' +
      'options as selectable cards, and a free text answer when allow_other is true, with a Submit button. ' +
      'Resolves with the chosen option id and any free text. Use this for any question that would otherwise ' +
      'be asked in chat during a job, per the product rule that decisions happen in the pane.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'The job this question belongs to.' },
        title: { type: 'string' },
        question: { type: 'string' },
        options: { type: 'array', description: '[{id, label, description?}], at least one.' },
        allow_other: { type: 'boolean' },
        context: { type: 'string', description: 'Optional extra detail shown under the question.' },
      },
      required: ['campaign_id', 'title', 'question', 'options'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui, signal }) => {
      const options = Array.isArray(args.options) ? args.options : [];
      if (options.length === 0) throw new InvalidInputError('question_ask needs at least one option.');
      options.forEach((option, i) => {
        if (!option || typeof option !== 'object') throw new InvalidInputError(`options[${i}] must be an object.`);
        if (typeof option.id !== 'string' || option.id.trim().length === 0) {
          throw new InvalidInputError(`options[${i}].id is required.`);
        }
        if (typeof option.label !== 'string' || option.label.trim().length === 0) {
          throw new InvalidInputError(`options[${i}].label is required.`);
        }
      });
      return await openGate({
        workspace,
        ui,
        signal,
        campaign_id: String(args.campaign_id),
        kind: 'question',
        screen: 'question',
        allowedActions: ['submit'],
        payload: {
          title: String(args.title),
          campaign_id: String(args.campaign_id),
          question: String(args.question),
          options,
          allow_other: Boolean(args.allow_other),
          context: args.context ?? null,
        },
      });
    },
  }),

  defineTool({
    name: 'publish_show',
    description: 'Show the publishing result: scheduled, published or exported status with links. Not a gate; no waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        result: { type: 'object', description: 'A PublishingResult, schemas/publishing-result.schema.json.' },
      },
      required: ['campaign_id', 'result'],
      additionalProperties: false,
    },
    handler: (args, { ui, workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const result = /** @type {any} */ (args.result) ?? {};
      const release = currentRelease(db, campaignId);
      // The publish screen must carry the product, not only the outcome: rebuild
      // the exact release posts the person approved, so two posts on one platform
      // keep their separate content and attempt identity.
      const deliverables = release ? release.posts : safeAssemblePosts(db, campaignId);
      // The durable attempt rows, not the aggregate outcome, are what the screen says
      // out loud: a post whose outcome was never learned reads "unclear" rather than
      // being rolled up into "failed", which is what makes a retry safe to offer.
      const attempts = release ? listAttempts(db, release.release_id) : [];
      const latestByIndex = new Map();
      for (const attempt of attempts) latestByIndex.set(Number(attempt.post_index), attempt);
      const outcomePosts = Array.isArray(result.posts) ? result.posts : [];
      const usedResults = new Set();
      const posts = deliverables.map((deliverable, index) => {
        const platform = String(deliverable.platform ?? '');
        const byIndex = outcomePosts.findIndex((post, resultIndex) => !usedResults.has(resultIndex) && Number(post?.post_index) === Number(deliverable.post_index));
        const byPlatform = byIndex < 0 ? outcomePosts.findIndex((post, resultIndex) => !usedResults.has(resultIndex) && String(post?.platform ?? '') === platform) : byIndex;
        if (byPlatform >= 0) usedResults.add(byPlatform);
        const resultPost = byPlatform >= 0 ? outcomePosts[byPlatform] : null;
        const attempt = latestByIndex.get(Number(deliverable.post_index ?? index)) ?? null;
        const attemptState = attempt ? attempt.state : resultPost?.attempt_state ?? null;
        const attemptLabel = attemptState ? ATTEMPT_STATE_LABEL[attemptState] ?? attemptState : resultPost?.status ?? null;
        const receipt = attempt?.receipt && typeof attempt.receipt === 'object' ? attempt.receipt : {};
        return {
          ...(resultPost ?? {}),
          post_index: deliverable.post_index ?? index,
          platform,
          caption: deliverable.caption ?? null,
          hashtags: Array.isArray(deliverable.hashtags) ? deliverable.hashtags : [],
          media: deliverable.asset_path
            ? [{ path: deliverable.asset_path, kind: deliverable.asset_kind === 'image' ? 'image' : 'video', duration_s: deliverable.duration_s ?? null }]
            : deliverable.media ?? null,
          first_comment: deliverable.first_comment ?? null,
          status: attemptLabel,
          attempt_state: attemptState,
          attempt_label: attemptState ? ATTEMPT_STATE_LABEL[attemptState] ?? attemptState : null,
          attempt: attempt ? attempt.attempt : null,
          provider_ref: attempt?.provider_ref ?? resultPost?.provider_ref ?? null,
          scheduled_for: attempt?.intent?.scheduled_at ?? resultPost?.scheduled_for ?? deliverable.scheduled_at ?? null,
          published_at: receipt.published_at ?? resultPost?.published_at ?? null,
          post_url: receipt.post_url ?? resultPost?.post_url ?? null,
          error: receipt.error ?? resultPost?.error ?? null,
        };
      });
      const anyFailed = posts.some((post) => post.attempt_state === 'failed');
      const anyUnclear = posts.some((post) => post.attempt_state === 'unknown');
      const anyPending = posts.some((post) => post.attempt_state === 'pending');
      const anyAccepted = posts.some((post) => post.attempt_state === 'accepted');
      const allPublished = posts.length > 0 && posts.every((post) => post.attempt_state === 'published' || post.status === 'published');
      const allScheduled = posts.length > 0 && posts.every((post) => post.attempt_state === 'scheduled' || post.status === 'scheduled');
      const displayOutcome = anyUnclear
        ? 'unclear'
        : anyPending
          ? 'pending'
          : anyFailed
            ? 'failed'
          : anyAccepted
            ? 'accepted'
            : allPublished
              ? 'published'
              : allScheduled
                ? 'scheduled'
                : result.outcome ?? null;
      const displaySummary = anyUnclear
        ? 'Some posts have an unclear outcome; check with your publishing service before sending them again.'
        : anyPending
          ? 'Some publishing requests are still in progress and were left alone until their outcome can be checked.'
          : anyFailed
            ? 'Some posts could not be sent to the publishing provider; see each post for details.'
          : anyAccepted
            ? 'The provider accepted some requests but has not confirmed that those posts were published.'
            : result.summary ?? '';
      const screen = ui.show('publish', {
        title: 'Publishing',
        campaign_id: campaignId,
        phase: phaseForCampaign(db, campaignId),
        outcome: displayOutcome,
        provider: release?.intent?.provider ?? result.provider ?? null,
        posts,
        brand_name: result.brand_name ?? campaignBrandName(db, campaignId),
        export_path: result.export_path ?? null,
        release_id: release ? release.release_id : null,
        release_version: release ? release.version : null,
        can_retry_failed: anyFailed,
        needs_check_with_provider: anyUnclear,
        summary: displaySummary,
        stats: safeStats(db, campaignId),
        cost: finalCostBlock(db, campaignId),
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),
];

/**
 * campaign_stats, swallowing any failure: the pane's "This job" line is a
 * convenience, and a stats computation problem must never stop a final
 * review or a publish result from showing.
 * @param {import('better-sqlite3').Database} db
 * @param {string} campaignId
 */
function safeStats(db, campaignId) {
  try {
    return computeCampaignStats(db, campaignId);
  } catch {
    return null;
  }
}

/**
 * "What this job cost" for the final review and publish screens: approved,
 * spent and unused credits plus the paid items that were actually generated,
 * computed server side from the campaign's generation ledger so the numbers
 * shown are the numbers the cost gate enforced, not a re-typed estimate.
 *
 * Any failure reading the manifest or ledger is swallowed and the block is
 * left out entirely, so a ledger problem never stops a final review or a
 * publish result from showing the product. A campaign that genuinely had no
 * paid generation still gets a block, just one that says so plainly instead
 * of showing a breakdown of nothing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {{has_spend: boolean, approved_credits: number, spent_credits: number, unused_credits: number, items: Array<{label: string, credits: number}>, note: string}|null}
 */
function finalCostBlock(db, campaignId) {
  try {
    const manifest = readManifest(db, campaignId);
    const summary = manifest ? paidGenerationSummary(manifest) : null;
    if (!summary) {
      return {
        has_spend: false,
        approved_credits: 0,
        spent_credits: 0,
        unused_credits: 0,
        items: [],
        note: 'No credits were spent on this job.',
      };
    }
    return {
      has_spend: true,
      approved_credits: summary.approved,
      spent_credits: summary.spent,
      unused_credits: summary.unused,
      items: summary.items,
      note: 'Nothing further is charged by publishing.',
    };
  } catch {
    return null;
  }
}

/**
 * The finished deliverable per platform - caption, hashtags, media - for the
 * publish screen, so a person never lands there with nothing to look at.
 * Swallows any failure (no copy package yet, for example) and returns an
 * empty list rather than throwing, since the publishing outcome itself is the
 * point of this screen and must still show even if the deliverable cannot be
 * rebuilt.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {Array<Record<string, unknown>>}
 */
function safeAssemblePosts(db, campaignId) {
  const release = currentRelease(db, campaignId);
  if (release) {
    return release.posts.map((post) => ({
      post_index: post.post_index,
      platform: post.platform,
      caption: post.caption ?? '',
      hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
      first_comment: post.first_comment ?? null,
      media: post.asset_path
        ? [{ path: post.asset_path, kind: post.asset_kind === 'image' ? 'image' : 'video', duration_s: post.duration_s ?? null }]
        : [],
    }));
  }
  try {
    return assemblePosts(db, campaignId);
  } catch {
    return [];
  }
}
