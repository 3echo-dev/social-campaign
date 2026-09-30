/**
 * One door for every artifact write.
 *
 * Until now the generic artifact_save tool wrote whatever passed a schema check,
 * while the specialized writers (copy_save, the media package, the edit tools) each
 * carried their own domain rules. The result was that a rule could be walked around
 * simply by using the generic tool: copy saved before any strategy was approved, and a
 * generated-media package naming a cost approval that does not exist.
 *
 * The rules live here now, and both the generic tool and the specialized writers call
 * them. A rule refuses in plain words and names what to do instead; it never silently
 * downgrades the write.
 */

import { existsSync } from 'node:fs';

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { CONTRACT_KINDS, loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { approvalStatus } from '../review/approvals.mjs';
import { resolveWorkspacePath } from '../release/package.mjs';

/**
 * Whether a resolved, approved cost review with this id exists for this campaign.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {string} reviewId
 * @returns {boolean}
 */
function isApprovedCostReview(db, campaignId, reviewId) {
  const row = db
    .prepare("SELECT decision FROM reviews WHERE id = ? AND campaign_id = ? AND kind = 'cost' AND status = 'resolved'")
    .get(reviewId, campaignId);
  if (!row) return false;
  const decision = parseJson(String(row.decision ?? '{}'), {});
  return decision.action === 'approve';
}

/**
 * The domain rules for one kind of artifact. Throws an InvalidInputError naming the
 * rule and the way out; returns nothing when the write is allowed.
 *
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {string|null} [args.root] workspace root, for rules that check files exist
 * @param {string} args.campaign_id
 * @param {string} args.kind
 * @param {any} args.json
 */
export function assertDomainRules({ db, root, campaign_id, kind, json }) {
  if (kind === 'CopyPackage') {
    // Copy needs an approved direction to execute. For a job built from scratch or
    // from a reference that is the approved strategy. For a job built on creative the
    // person already has there is no strategy to approve: what is approved is the
    // reuse brief, at the concept gate, which is why that route carries no strategy
    // gate at all. Either approval authorises the copy; neither means it is refused.
    const strategy = approvalStatus(db, campaign_id, 'strategy');
    if (strategy.approved) return;
    const hasReuseBrief = Number(
      db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE campaign_id = ? AND kind = 'ReuseBrief' AND invalidated_at IS NULL").get(campaign_id)?.count ?? 0,
    ) > 0;
    const concept = approvalStatus(db, campaign_id, 'concept');
    if (hasReuseBrief && concept.approved) return;
    throw new InvalidInputError('Copy cannot be written before the user has approved a direction for this job.', {
      fix: hasReuseBrief
        ? 'Open the reuse brief for approval and wait for it first.'
        : 'Open the strategy gate and wait for an approval first.',
      details: { reason: hasReuseBrief ? concept.reason : strategy.reason },
    });
  }

  if (kind === 'GeneratedMediaPackage') {
    const costApprovalId = json && typeof json.cost_approval_id === 'string' ? json.cost_approval_id : '';
    if (!isApprovedCostReview(db, campaign_id, costApprovalId)) {
      throw new InvalidInputError('This media names a cost approval that does not exist for this job.', {
        fix: 'Open the cost gate, wait for an approval, and save the media against that approval.',
      });
    }
    const assets = Array.isArray(json?.assets) ? json.assets : [];
    for (const asset of assets) {
      const path = asset && typeof asset.path === 'string' ? asset.path : '';
      if (!path) {
        throw new InvalidInputError('One of the generated files has no location recorded.', {
          fix: 'Save the file into the job folder, then record the media again.',
        });
      }
      if (root && !existsSync(resolveWorkspacePath(root, path))) {
        throw new InvalidInputError('One of the generated files is not where this workspace expects it.', {
          fix: 'Make the file again, or remove it from the set, then record the media again.',
          details: { path },
        });
      }
    }
  }
}

/**
 * Validate an artifact against its contract, apply the domain rules for its kind, and
 * store it as the next version. The one write path for campaign artifacts.
 *
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {string|null} [args.root]
 * @param {string} args.campaign_id
 * @param {string} args.kind
 * @param {any} args.json
 * @param {string|null} [args.path]
 * @returns {{id: string, kind: string, version: number}}
 */
export function commitArtifact({ db, root, campaign_id, kind, json, path = null }) {
  if (!CONTRACT_KINDS.includes(kind)) {
    throw new InvalidInputError(`Social Campaign does not keep results of the kind "${kind}".`, {
      fix: `Use one of: ${CONTRACT_KINDS.join(', ')}.`,
    });
  }
  const problems = validateAgainstSchema(loadSchema(kind), json);
  if (problems.length > 0) {
    throw new InvalidInputError(`That ${kind} result is not complete: ${problems[0]}`, {
      fix: 'Fill in the missing detail and save it again.',
      details: { problems },
    });
  }
  assertDomainRules({ db, root, campaign_id, kind, json });

  const version =
    Number(
      db.prepare('SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = ?').get(campaign_id, kind)?.version ?? 0,
    ) + 1;
  const id = newId();
  db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    campaign_id,
    kind,
    path,
    toJsonColumn(json),
    version,
    nowIso(),
  );
  return { id, kind, version };
}
