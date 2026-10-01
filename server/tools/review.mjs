/**
 * Read only review and approval helpers.
 *
 * review_get, review_list, approval_check and approval_assert_current are guards
 * other domains use: the media producer checks approval_check({kind: 'cost'})
 * before spending credits, and the publisher checks approval_check({kind: 'final'})
 * before posting. Decisions themselves are recorded from the board
 * (server/pipeline) and by server/review/approvals.mjs.
 */

import { defineTool } from '../mcp/registry.mjs';
import { parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { currentRelease } from '../release/package.mjs';
import { approvalStatus, APPROVAL_REASON_MESSAGE, APPROVAL_KINDS } from '../review/approvals.mjs';
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

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const reviewTools = [
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
];
