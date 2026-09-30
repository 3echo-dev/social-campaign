/**
 * Whether a campaign is currently authorised at a given gate.
 *
 * The rule is newest wins. Only the most recent resolved review of a kind counts: if
 * the person rejected or asked for changes after approving, the campaign is not
 * approved, however many approvals sit behind that decision. The old behaviour walked
 * the history until it found any approval, which meant a rejection could not take an
 * approval back.
 *
 * For the final gate an approval also has to still be about the work in hand. A final
 * review is opened on one release and records that release's digest as its target; the
 * approval holds only while the campaign's current release has the same digest. Change
 * a caption, swap an asset, move a schedule, and the digest changes with it, so the
 * answer becomes changed_since_approval rather than a silent yes.
 */

import { parseJson } from '../lib/json.mjs';
import { currentRelease } from '../release/package.mjs';
import { artifactRefIsCurrent } from '../artifacts/refs.mjs';

/** Decision actions that count as an approval at any gate. */
const APPROVING_ACTIONS = ['approve', 'combine', 'approve_all'];

/** The gate kinds the newest-wins rule applies to. */
export const APPROVAL_KINDS = ['strategy', 'concept', 'cost', 'media', 'final'];

/** Artifact kinds that a non-final gate can cover when the workflow has saved one. */
const APPROVAL_ARTIFACT_KINDS = {
  strategy: ['StrategySet'],
  concept: ['ConceptList', 'CopyPackage', 'ReuseBrief'],
  cost: ['MediaPlan'],
  media: ['GeneratedMediaPackage'],
};

/**
 * A plain sentence for each reason a gate is not currently approved.
 * @type {Record<string, string>}
 */
export const APPROVAL_REASON_MESSAGE = {
  no_review: 'This has not been through review yet.',
  rejected_later: 'The last decision on this was not an approval, so it is not approved right now.',
  changed_since_approval: 'Something changed after it was approved, so it needs approving again.',
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {{approved: boolean, review_id: string|null, reason: string|null, action: string|null, target: any|null, release_id: string|null, digest: string|null, message: string|null}}
 */
export function approvalStatus(db, campaignId, kind) {
  const row = db
    .prepare(
      "SELECT id, decision, target FROM reviews WHERE campaign_id = ? AND kind = ? AND status = 'resolved' " +
        'ORDER BY resolved_at DESC, id DESC LIMIT 1',
    )
    .get(campaignId, kind);

  if (!row) return refusal('no_review', null, null);

  const decision = parseJson(String(row.decision ?? '{}'), {});
  const action = decision.action ? String(decision.action) : null;
  if (!APPROVING_ACTIONS.includes(String(action))) return refusal('rejected_later', String(row.id), action);

  const target = row.target ? parseJson(String(row.target), null) : null;

  if (kind !== 'final') {
    const refs = Array.isArray(target?.artifacts) ? target.artifacts : [];
    const expectedKinds = Array.isArray(target?.artifact_kinds) ? target.artifact_kinds : APPROVAL_ARTIFACT_KINDS[kind] ?? [];
    const currentArtifacts = expectedKinds.map((artifactKind) => artifactRefForKind(db, campaignId, artifactKind)).filter(Boolean);
    const unboundOrIncomplete = currentArtifacts.some(
      (artifact) => !refs.some((ref) => String(ref?.kind ?? '') === String(artifact.kind) && artifactRefIsCurrent(db, ref)),
    );
    const hasArtifactHistory =
      refs.length === 0 &&
      expectedKinds.some((artifactKind) =>
        Boolean(db.prepare('SELECT 1 FROM artifacts WHERE campaign_id = ? AND kind = ? LIMIT 1').get(campaignId, String(artifactKind))),
      );
    if (!target || target.invalidated || refs.some((ref) => !artifactRefIsCurrent(db, ref)) || unboundOrIncomplete || hasArtifactHistory) {
      return refusal('changed_since_approval', String(row.id), action);
    }
    return {
      approved: true,
      review_id: String(row.id),
      reason: null,
      action,
      target,
      release_id: target?.release_id ?? null,
      digest: target?.digest ?? null,
      message: null,
    };
  }

  const release = currentRelease(db, campaignId);
  const intentDigest = release?.intent?.digest ?? null;
  const releaseHasIntent = Boolean(release?.intent && typeof release.intent === 'object');
  const targetReleaseMatches = String(target?.release_id ?? '') === String(release?.release_id ?? '');
  const targetIntentMatches =
    Object.hasOwn(target ?? {}, 'intent_digest') &&
    String(target?.intent_digest ?? '') === String(intentDigest ?? '');
  if (
    !release ||
    !target ||
    !target.digest ||
    target.digest !== release.digest ||
    (releaseHasIntent && (!targetReleaseMatches || !targetIntentMatches))
  ) {
    return {
      ...refusal('changed_since_approval', String(row.id), action),
      release_id: release ? release.release_id : null,
      digest: release ? release.digest : null,
    };
  }

  return {
    approved: true,
    review_id: String(row.id),
    reason: null,
    action,
    target,
    release_id: release.release_id,
    digest: release.digest,
    message: null,
  };
}

/** @param {any} db @param {string} campaignId @param {string} kind */
function artifactRefForKind(db, campaignId, kind) {
  const row = db
    .prepare('SELECT id, campaign_id, kind, version, path, json, created_at, invalidated_at, invalidation_reason FROM artifacts WHERE campaign_id = ? AND kind = ? ORDER BY version DESC LIMIT 1')
    .get(campaignId, String(kind));
  return row && row.invalidated_at == null
    ? { id: String(row.id), campaign_id: String(row.campaign_id), kind: String(row.kind), version: Number(row.version) }
    : null;
}

/**
 * @param {string} reason
 * @param {string|null} reviewId
 * @param {string|null} action
 */
function refusal(reason, reviewId, action) {
  return {
    approved: false,
    review_id: reviewId,
    reason,
    action,
    target: null,
    release_id: null,
    digest: null,
    message: APPROVAL_REASON_MESSAGE[reason] ?? 'This is not approved right now.',
  };
}

/**
 * The approved release for a campaign, or a refusal explaining why there is not one.
 * Every publishing and export tool goes through this rather than reading reviews
 * itself, so they all refuse for the same reasons in the same words.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {{ok: true, release: any, review_id: string}|{ok: false, reason: string, message: string}}
 */
export function approvedRelease(db, campaignId) {
  const status = approvalStatus(db, campaignId, 'final');
  if (!status.approved) {
    return {
      ok: false,
      reason: String(status.reason),
      message:
        status.reason === 'no_review'
          ? 'This campaign has not been through final review and approved yet, so there is nothing ready to publish.'
          : status.reason === 'rejected_later'
            ? 'The last final review decision was not an approval, so nothing can go out for this campaign.'
            : 'The posts changed after they were approved, so they need approving again before anything goes out.',
    };
  }
  const release = currentRelease(db, campaignId);
  return { ok: true, release, review_id: String(status.review_id) };
}
