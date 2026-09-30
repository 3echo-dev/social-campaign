import { readJsonFile, writeJsonFile } from '../lib/json.mjs';
import { assertVerifiedIdentity, identityForPersistence, StudioContractError } from './contracts.mjs';

/**
 * Persist display and reconciliation evidence for an identity.
 *
 * The saved record is evidence only and cannot be passed back to a transport
 * as proof.  A fresh native or scoped HTTP resolver must establish identity on
 * every account-sensitive operation.
 */
export function writeIdentityEvidence(filePath, identity) {
  assertVerifiedIdentity(identity);
  if (typeof filePath !== 'string' || !filePath.trim()) throw new StudioContractError('An identity evidence path is required.', 'invalid_identity_evidence');
  const evidence = {
    ...identityForPersistence(identity),
    status: 'verified',
    savedAt: new Date().toISOString(),
  };
  writeJsonFile(filePath, evidence);
  return evidence;
}

export function readIdentityEvidence(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new StudioContractError('An identity evidence path is required.', 'invalid_identity_evidence');
  const evidence = readJsonFile(filePath, null);
  return evidence && typeof evidence === 'object' && evidence.status === 'verified' ? evidence : null;
}

export async function refreshIdentityEvidence(filePath, resolveIdentity) {
  if (typeof resolveIdentity !== 'function') throw new StudioContractError('An authenticated identity resolver is required.', 'identity_unavailable');
  const identity = await resolveIdentity();
  return writeIdentityEvidence(filePath, identity);
}
