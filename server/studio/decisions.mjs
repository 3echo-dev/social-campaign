import { assertVerifiedIdentity, StudioContractError, stableDigest } from './contracts.mjs';

function required(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StudioContractError(`${name} is required.`, 'invalid_decision');
  }
  return value.trim();
}

/**
 * Validate a decision before the local runner applies it.  Revision and output
 * hash are both required and compared exactly to the current local job record.
 */
export function consumeDecision({ record, job, expectedRevision, expectedHash, actorUserId } = {}) {
  if (!record || typeof record !== 'object' || !job || typeof job !== 'object') {
    throw new StudioContractError('A decision and current job record are required.', 'invalid_decision');
  }
  const ownerUserId = required(job.ownerUserId, 'job.ownerUserId');
  if (record.ownerUserId && record.ownerUserId !== ownerUserId) {
    throw new StudioContractError('The decision belongs to another Studio account.', 'identity_mismatch');
  }
  const actor = required(actorUserId || record.actorUserId, 'actorUserId');
  const revision = required(expectedRevision, 'expectedRevision');
  const hash = required(expectedHash, 'expectedHash');
  const recordRevision = required(record.artifactRevision || record.revision, 'decision.artifactRevision');
  const recordHash = required(record.artifactHash || record.outputHash || record.hash, 'decision.artifactHash');
  if (recordRevision !== revision || recordHash !== hash) {
    throw new StudioContractError(
      'This approval is stale because the job revision or output hash changed.',
      'stale_decision',
      { expectedRevision: revision, expectedHash: hash, decisionRevision: recordRevision, decisionHash: recordHash },
    );
  }
  const jobRevision = job.artifactRevision || job.revision;
  const jobHash = job.artifactHash || job.outputHash || job.hash;
  if (jobRevision !== revision || jobHash !== hash) {
    throw new StudioContractError(
      'This approval is stale because the local job changed.',
      'stale_decision',
      { expectedRevision: revision, expectedHash: hash, currentRevision: jobRevision, currentHash: jobHash },
    );
  }
  const consumedAt = new Date().toISOString();
  return Object.freeze({
    ...record,
    schemaVersion: Number.isSafeInteger(record.schemaVersion) ? record.schemaVersion : 1,
    ownerUserId,
    actorUserId: actor,
    artifactRevision: revision,
    artifactHash: hash,
    status: 'consumed',
    consumedAt,
  });
}

export function decisionEnvelope({ identity, job, gate, decision, artifactRevision, artifactHash, actorUserId, metadata = {} } = {}) {
  assertVerifiedIdentity(identity);
  const revision = required(artifactRevision, 'artifactRevision');
  const hash = required(artifactHash, 'artifactHash');
  const actor = required(actorUserId, 'actorUserId');
  if (!job || job.ownerUserId !== identity.ownerUserId) {
    throw new StudioContractError('The decision job is not owned by the authenticated Studio account.', 'identity_mismatch');
  }
  return Object.freeze({
    schemaVersion: 1,
    decisionId: required(metadata.decisionId || stableDigest({ jobId: job.jobId, gate, revision, hash, actor }), 'decisionId'),
    ownerUserId: identity.ownerUserId,
    ...(identity.ownerEmail ? { ownerEmail: identity.ownerEmail } : {}),
    workspaceId: required(job.workspaceId, 'workspaceId'),
    jobId: required(job.jobId, 'jobId'),
    gate: required(gate, 'gate'),
    decision: required(decision, 'decision'),
    actorUserId: actor,
    artifactRevision: revision,
    artifactHash: hash,
    createdAt: new Date().toISOString(),
  });
}
