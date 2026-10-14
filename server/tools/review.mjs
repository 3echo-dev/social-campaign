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

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const reviewTools = [

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

];
