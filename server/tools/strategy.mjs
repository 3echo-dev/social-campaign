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

/**
 * @param {any} db
 * @param {string} campaignId
 */
function readCampaign(db, campaignId) {
  const row = db
    .prepare('SELECT id, brand_id, title, job_type, starting_point, platforms, status FROM campaigns WHERE id = ?')
    .get(campaignId);
  if (!row) {
    throw new InvalidInputError('That job could not be found.', { fix: 'Start a new job on the board.' });
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

];
