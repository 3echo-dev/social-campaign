/**
 * Trust-boundary contracts for the Studio bridge.
 *
 * The local runner owns files and execution state.  This module is the small
 * boundary that turns an authenticated Studio response into data that may be
 * registered or uploaded remotely.  Callers cannot manufacture the internal
 * identity proof used by the registration helpers.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { metadata: sourceEventMetadata } = require('../../pipeline/scripts/lib-metrics-sync.js');

export const STUDIO_CONTRACT_VERSION = 1;
export const MAX_EVENT_BATCH = 200;
export const MAX_EVENT_BYTES = 256 * 1024;
export const MAX_EVENT_BATCH_BYTES = 2 * 1024 * 1024;
export const METRIC_COVERAGE = Object.freeze([
  'measured',
  'estimated',
  'inferred',
  'missing',
  'partial',
  'operator_confirmed',
]);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_PATH_KEY = /(?:^|_|-)(?:path|file|folder|directory|root)(?:$|_|-)/i;
const LOCAL_PATH_VALUE = /^(?:file:|[A-Za-z]:[\\/]|\\\\|\/)/;
const AUTHENTICATION_PROOFS = new WeakSet();
const VERIFIED_IDENTITIES = new WeakSet();

export class StudioContractError extends Error {
  constructor(message, code = 'studio_contract_error', details = undefined) {
    super(message);
    this.name = 'StudioContractError';
    this.code = code;
    this.details = details;
  }
}

function text(value, name, max = 200) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StudioContractError(`${name} is required.`, 'invalid_contract');
  }
  const result = value.trim();
  if (result.length > max) {
    throw new StudioContractError(`${name} is too long.`, 'invalid_contract');
  }
  return result;
}

function id(value, name) {
  const result = text(value, name);
  if (!ID.test(result)) {
    throw new StudioContractError(`${name} is not a stable identifier.`, 'invalid_contract');
  }
  return result;
}

function optionalText(value, name, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, name, max);
}

function iso(value, name, fallback = new Date().toISOString()) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value;
  const result = text(String(candidate), name, 80);
  if (Number.isNaN(Date.parse(result))) {
    throw new StudioContractError(`${name} must be a date and time.`, 'invalid_contract');
  }
  return result;
}

function cleanEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = text(value, 'ownerEmail', 320).toLowerCase();
  if (!EMAIL.test(result)) {
    throw new StudioContractError('ownerEmail is not a valid email address.', 'invalid_contract');
  }
  return result;
}

function sourceFrom(value) {
  const source = text(value, 'identity source', 40);
  if (!['native_mcp', 'http_oauth'].includes(source)) {
    throw new StudioContractError('Studio identity must come from an authenticated connector.', 'untrusted_identity');
  }
  return source;
}

function proofFor(source, ownerUserId, extra = {}) {
  const proof = Object.freeze({
    source,
    ownerUserId,
    ...extra,
  });
  AUTHENTICATION_PROOFS.add(proof);
  return proof;
}

/**
 * Create a verified identity.  `proof` is intentionally module-private in
 * normal use; callers should use resolveNativeIdentity or resolveHttpIdentity.
 */
export function createStudioIdentity(input = {}) {
  if (!input || typeof input !== 'object' || !AUTHENTICATION_PROOFS.has(input.proof)) {
    throw new StudioContractError(
      'Studio identity must be established by an authenticated connector.',
      'untrusted_identity',
    );
  }
  const ownerUserId = id(input.ownerUserId, 'ownerUserId');
  if (input.proof.ownerUserId !== ownerUserId) {
    throw new StudioContractError('Authenticated identity does not match ownerUserId.', 'identity_mismatch');
  }
  const source = sourceFrom(input.proof.source || input.source);
  const ownerEmail = cleanEmail(input.ownerEmail);
  const emailVerified = ownerEmail ? input.emailVerified === true : null;
  const identity = {
    schemaVersion: STUDIO_CONTRACT_VERSION,
    ownerUserId,
    ownerEmail: emailVerified ? ownerEmail : null,
    emailVerified,
    source,
    verifiedBy: text(input.verifiedBy || input.proof.verifiedBy || source, 'verifiedBy', 120),
    verifiedAt: iso(input.verifiedAt, 'verifiedAt'),
    workspaceIds: Object.freeze([...(input.workspaceIds || [])].map((value) => id(value, 'workspaceId'))),
    scopes: Object.freeze([...(input.scopes || [])].filter((value) => typeof value === 'string').map((value) => value.slice(0, 120))),
  };
  const result = Object.freeze(identity);
  VERIFIED_IDENTITIES.add(result);
  return result;
}

function workspacesFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];
  const structured = response.structuredContent;
  if (Array.isArray(structured)) return structured;
  if (structured && Array.isArray(structured.workspaces)) return structured.workspaces;
  if (Array.isArray(response.workspaces)) return response.workspaces;
  if (response.data && Array.isArray(response.data.workspaces)) return response.data.workspaces;
  return [];
}

function responseObjects(response) {
  const structured = response && typeof response === 'object' ? response.structuredContent : null;
  const data = response && typeof response === 'object' ? response.data : null;
  return [response, structured, data, structured && structured.data]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
}

function currentPrincipalFromResponse(response) {
  for (const source of responseObjects(response)) {
    const candidate = source.currentUser || source.authenticatedUser || source.principal || source.me;
    const ownerUserId = source.currentUserId || source.authenticatedUserId || source.principalUserId
      || (candidate && (candidate.userId || candidate.id || candidate.sub));
    if (!ownerUserId) continue;
    return {
      ownerUserId,
      ownerEmail: source.currentUserEmail || candidate?.email || candidate?.ownerEmail || null,
      emailVerified: source.currentUserEmailVerified === true || candidate?.emailVerified === true,
    };
  }
  return null;
}

function ownerMembershipIds(workspaces) {
  const ids = [];
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace !== 'object') continue;
    const membership = workspace.membership || workspace.member || workspace.currentUserMembership || {};
    const role = String(workspace.membershipRole || membership.role || membership.roleName || '').toLowerCase();
    if (role !== 'owner' && role !== 'workspace_owner') continue;
    // A workspace owner field is not the current caller. Accept only an
    // explicit membership user ID paired with the owner role.
    const memberId = workspace.membershipUserId || workspace.currentUserId || membership.userId;
    if (!memberId) continue;
    if (workspace.userId && String(workspace.userId) !== String(memberId)) continue;
    ids.push(memberId);
  }
  return [...new Set(ids)];
}

/**
 * Resolve the account returned by the authenticated native Studio connector.
 * A workspace `userId` is only an ownership candidate. Identity requires an
 * explicit current-user principal or an owner-role membership carrying that ID;
 * a caller supplied `verified: true` field is never used as evidence.
 */
export async function resolveNativeIdentity({ listWorkspaces } = {}) {
  if (typeof listWorkspaces !== 'function') {
    throw new StudioContractError('The native Studio connector cannot list workspaces.', 'identity_unavailable');
  }
  const response = await listWorkspaces();
  if (response?.status === 'unsupported' || response?.isError) {
    throw new StudioContractError('The native Studio connector does not expose authenticated workspaces.', 'identity_unavailable');
  }
  const workspaces = workspacesFromResponse(response);
  const principal = currentPrincipalFromResponse(response);
  const membershipIds = ownerMembershipIds(workspaces);
  const ids = principal ? [principal.ownerUserId] : membershipIds;
  if (ids.length !== 1) {
    throw new StudioContractError(
      ids.length ? 'The native connector returned more than one Studio account.' : 'The native connector did not prove the current Studio account.',
      'identity_unavailable',
    );
  }
  const ownerUserId = id(ids[0], 'ownerUserId');
  const matching = workspaces.find((workspace) => workspace && (
    workspace.userId === ownerUserId
    || workspace.membershipUserId === ownerUserId
    || workspace.currentUserId === ownerUserId
    || workspace.membership?.userId === ownerUserId
    || workspace.member?.userId === ownerUserId
  )) || {};
  const ownerEmail = principal?.ownerEmail || matching.email || matching.ownerEmail || null;
  const emailVerified = principal
    ? principal.emailVerified === true && Boolean(principal.ownerEmail)
    : matching.emailVerified === true && Boolean(ownerEmail);
  const proof = proofFor('native_mcp', ownerUserId, { verifiedBy: 'authenticated_mcp' });
  return createStudioIdentity({
    ownerUserId,
    ownerEmail: emailVerified ? ownerEmail : null,
    emailVerified,
    source: 'native_mcp',
    verifiedBy: 'authenticated_mcp',
    workspaceIds: workspaces.map((workspace) => workspace && workspace.id).filter(Boolean),
    proof,
  });
}

/**
 * Resolve a direct HTTP identity through a host-managed scoped credential.
 * The opaque handle is passed to the verifier and is never serialized into a
 * request body, local metadata, or HTML.
 */
export async function resolveHttpIdentity({ credentialHandle, verifyCredential } = {}) {
  if (credentialHandle === undefined || credentialHandle === null || credentialHandle === '') {
    throw new StudioContractError('A host-managed scoped Studio credential is required.', 'identity_unavailable');
  }
  if (typeof verifyCredential !== 'function') {
    throw new StudioContractError('No first-party Studio credential verifier is configured.', 'identity_unavailable');
  }
  const result = await verifyCredential(credentialHandle);
  if (!result || result.authenticated !== true) {
    throw new StudioContractError('The Studio credential did not authenticate.', 'untrusted_identity');
  }
  const ownerUserId = result.ownerUserId || result.subject || result.sub;
  const proof = proofFor('http_oauth', ownerUserId, { verifiedBy: 'scoped_oauth_verifier' });
  return createStudioIdentity({
    ownerUserId,
    ownerEmail: result.email,
    emailVerified: result.emailVerified === true,
    source: 'http_oauth',
    verifiedBy: 'scoped_oauth_verifier',
    workspaceIds: result.workspaceIds || [],
    scopes: result.scopes || [],
    proof,
  });
}

export function assertVerifiedIdentity(identity) {
  if (!identity || typeof identity !== 'object' || !VERIFIED_IDENTITIES.has(identity)) {
    throw new StudioContractError('A verified Studio identity is required.', 'untrusted_identity');
  }
  id(identity.ownerUserId, 'ownerUserId');
  sourceFrom(identity.source);
  return identity;
}

export function identityForPersistence(identity) {
  assertVerifiedIdentity(identity);
  return {
    schemaVersion: STUDIO_CONTRACT_VERSION,
    ownerUserId: identity.ownerUserId,
    ownerEmail: identity.ownerEmail || null,
    emailVerified: identity.emailVerified === true,
    source: identity.source,
    verifiedBy: identity.verifiedBy,
    verifiedAt: identity.verifiedAt,
    workspaceIds: [...identity.workspaceIds],
    scopes: [...identity.scopes],
  };
}

export function assertOwner(identity, ownerUserId) {
  assertVerifiedIdentity(identity);
  if (identity.ownerUserId !== id(ownerUserId, 'ownerUserId')) {
    throw new StudioContractError('The request owner does not match the authenticated Studio account.', 'identity_mismatch');
  }
  return true;
}

function hasLocalPath(value, key = '') {
  if (key && LOCAL_PATH_KEY.test(key)) return true;
  if (typeof value === 'string' && LOCAL_PATH_VALUE.test(value.trim())) return true;
  if (Array.isArray(value)) return value.some((entry) => hasLocalPath(entry, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([child, entry]) => hasLocalPath(entry, child));
  return false;
}

function remoteReference(value, name, max = 500) {
  const result = optionalText(value, name, max);
  if (!result) return null;
  // Remote references may be opaque IDs or URI values. A separator in a
  // non-URI value is treated as a local relative path and is never uploaded.
  if (hasLocalPath(result)
    || (/[\\/]/.test(result) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(result))) {
    throw new StudioContractError(`${name} must be an opaque or remote reference.`, 'local_path_exposure');
  }
  return result;
}

export function sanitizePreviewAsset(asset = {}) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new StudioContractError('A preview asset reference is required.', 'invalid_asset_reference');
  }
  for (const key of ['path', 'localPath', 'absolutePath', 'sourcePath', 'filePath', 'rootPath']) {
    if (Object.prototype.hasOwnProperty.call(asset, key)) {
      throw new StudioContractError('Preview assets must use explicit hosted references.', 'local_path_exposure');
    }
  }
  if (hasLocalPath(asset)) {
    throw new StudioContractError('Preview asset metadata cannot contain a local filesystem path.', 'local_path_exposure');
  }
  const assetId = asset.assetId === undefined ? null : id(asset.assetId, 'assetId');
  const previewUrl = asset.previewUrl === undefined || asset.previewUrl === null ? null : text(asset.previewUrl, 'previewUrl', 2000);
  if (!assetId && !previewUrl) {
    throw new StudioContractError('Preview assets require an assetId or HTTPS previewUrl.', 'invalid_asset_reference');
  }
  if (previewUrl && !/^https:\/\//i.test(previewUrl)) {
    throw new StudioContractError('Preview URLs must use HTTPS.', 'invalid_asset_reference');
  }
  const result = {
    schemaVersion: STUDIO_CONTRACT_VERSION,
    ...(assetId ? { assetId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(asset.sha256 ? { sha256: text(asset.sha256, 'sha256', 128) } : {}),
    ...(asset.mediaType ? { mediaType: text(asset.mediaType, 'mediaType', 120) } : {}),
    ...(asset.title ? { title: text(asset.title, 'title', 240) } : {}),
  };
  if (asset.bytes !== undefined) {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw new StudioContractError('Preview asset bytes must be a non-negative integer.', 'invalid_asset_reference');
    }
    result.bytes = asset.bytes;
  }
  return Object.freeze(result);
}

export function normalizeWorkspaceRegistration(workspace, identity) {
  assertVerifiedIdentity(identity);
  if (!workspace || typeof workspace !== 'object') throw new StudioContractError('Workspace registration is required.', 'invalid_contract');
  const workspaceId = id(workspace.workspaceId || workspace.id, 'workspaceId');
  const result = {
    schemaVersion: STUDIO_CONTRACT_VERSION,
    workspaceId,
    ownerUserId: identity.ownerUserId,
    ownerEmail: identity.ownerEmail,
    name: text(workspace.name || workspaceId, 'workspace name', 240),
    storageKind: 'local',
    boardRef: remoteReference(workspace.boardRef, 'boardRef', 500),
    createdAt: iso(workspace.createdAt, 'createdAt'),
  };
  if (workspace.ownerUserId && workspace.ownerUserId !== identity.ownerUserId) {
    throw new StudioContractError('Workspace owner cannot change after authentication.', 'owner_immutable');
  }
  return Object.freeze(result);
}

export function normalizeJobRegistration(job, identity, existing = null) {
  assertVerifiedIdentity(identity);
  if (!job || typeof job !== 'object') throw new StudioContractError('Job registration is required.', 'invalid_contract');
  const jobId = id(job.jobId || job.id, 'jobId');
  const workspaceId = id(job.workspaceId, 'workspaceId');
  const brandId = id(job.brandId || job.brand, 'brandId');
  const existingOwner = existing && existing.ownerUserId;
  if (existing?.workspaceId && existing.workspaceId !== workspaceId) {
    throw new StudioContractError('A job cannot move between workspaces.', 'scope_mismatch');
  }
  if (existing?.brandId && existing.brandId !== brandId) {
    throw new StudioContractError('A job cannot change its brand binding.', 'scope_mismatch');
  }
  if (existingOwner && existingOwner !== identity.ownerUserId) {
    throw new StudioContractError('A job is permanently owned by its creating Studio account.', 'owner_immutable');
  }
  if (job.ownerUserId && job.ownerUserId !== identity.ownerUserId) {
    throw new StudioContractError('The submitted job owner does not match the authenticated account.', 'identity_mismatch');
  }
  return Object.freeze({
    schemaVersion: STUDIO_CONTRACT_VERSION,
    jobId,
    workspaceId,
    brandId,
    ownerUserId: identity.ownerUserId,
    ownerEmail: identity.ownerEmail,
    createdAt: iso(existing?.createdAt || job.createdAt, 'createdAt'),
    routeRef: remoteReference(job.routeRef, 'routeRef', 500),
  });
}

export function normalizeEventForStudio(event, identity, context = {}) {
  assertVerifiedIdentity(identity);
  if (!event || typeof event !== 'object') throw new StudioContractError('Event is required.', 'invalid_event');
  const eventId = id(event.eventId, 'eventId');
  const eventName = text(event.eventName, 'eventName', 120);
  const workspaceId = id(context.workspaceId || event.workspaceId, 'workspaceId');
  const jobId = id(context.jobId || event.jobId || event.job, 'jobId');
  if (context.workspaceId && event.workspaceId && String(context.workspaceId) !== String(event.workspaceId)) {
    throw new StudioContractError('The event workspace does not match the scoped request.', 'scope_mismatch');
  }
  if (context.jobId && (event.jobId || event.job) && String(context.jobId) !== String(event.jobId || event.job)) {
    throw new StudioContractError('The event job does not match the scoped request.', 'scope_mismatch');
  }
  if (event.schemaVersion !== undefined && event.schemaVersion !== STUDIO_CONTRACT_VERSION) {
    throw new StudioContractError('The event schema version is not supported.', 'invalid_event');
  }
  const subject = event.subject && typeof event.subject === 'object' ? event.subject : { type: 'job', id: jobId };
  const source = optionalText(event.source, 'source', 120) || 'local';
  const host = optionalText(event.host, 'host', 120) || 'unknown';
  if (hasLocalPath(source) || hasLocalPath(host)) {
    throw new StudioContractError('Event source metadata cannot contain local paths.', 'local_path_exposure');
  }
  if (event.assetRefs !== undefined
    && (!Array.isArray(event.assetRefs) || event.assetRefs.length > 50)) {
    throw new StudioContractError('assetRefs must be a bounded array.', 'invalid_event');
  }
  // Reuse the pipeline's canonical event name and attribute allowlist at the
  // outbound trust boundary.  Direct relays must not be able to upload fields
  // that the source event exporter would discard.
  const allowlisted = sourceEventMetadata({
    ...event,
    eventId,
    eventName,
    workspaceId,
    jobId,
    job: jobId,
    ownerUserId: identity.ownerUserId,
    ...(identity.ownerEmail ? { ownerEmail: identity.ownerEmail } : {}),
    source,
    host,
    quality: event.quality === undefined || event.quality === null || event.quality === ''
      ? 'missing'
      : event.quality,
  }, { requireOwner: true });
  if (!allowlisted) {
    throw new StudioContractError('Event is not allowlisted or contains unsupported metadata.', 'invalid_event');
  }
  const result = {
    eventId,
    eventName,
    schemaVersion: Number.isSafeInteger(event.schemaVersion) ? event.schemaVersion : STUDIO_CONTRACT_VERSION,
    occurredAt: iso(event.occurredAt, 'occurredAt'),
    observedAt: iso(event.observedAt || event.occurredAt, 'observedAt'),
    ownerUserId: identity.ownerUserId,
    ...(identity.ownerEmail ? { ownerEmail: identity.ownerEmail } : {}),
    workspaceId,
    ...(context.brandId || event.brandId ? { brandId: id(context.brandId || event.brandId, 'brandId') } : {}),
    jobId,
    ...(event.runId ? { runId: id(event.runId, 'runId') } : {}),
    ...(event.actorUserId ? { actorUserId: id(event.actorUserId, 'actorUserId') } : {}),
    source: allowlisted.source,
    host: allowlisted.host,
    quality: allowlisted.quality,
    job: jobId,
    subject: { type: text(String(subject.type || 'job'), 'subject.type', 80), id: id(subject.id || jobId, 'subject.id') },
    attrs: allowlisted.attrs,
  };
  if (allowlisted.assetRefs) {
    result.assetRefs = allowlisted.assetRefs.map(sanitizePreviewAsset);
  }
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > MAX_EVENT_BYTES) throw new StudioContractError('Event exceeds the remote metadata size limit.', 'invalid_event');
  return Object.freeze(result);
}

export function normalizeMetricCoverage(value, fallback = 'missing') {
  const candidate = value === 'unavailable' ? 'missing' : value;
  return METRIC_COVERAGE.includes(candidate) ? candidate : fallback;
}

export function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeReceipt(result, batch) {
  const ids = batch.map((event) => event.eventId);
  const allowed = new Set(ids);
  const accepted = Array.isArray(result?.acceptedIds) ? result.acceptedIds.map(String) : [];
  const duplicates = Array.isArray(result?.alreadyPresentIds) ? result.alreadyPresentIds.map(String) : [];
  const acknowledged = Array.isArray(result?.acknowledgedIds) ? result.acknowledgedIds.map(String) : [];
  const rejected = Array.isArray(result?.rejected) ? result.rejected.map((item) => typeof item === 'string' ? ({ eventId: item, reason: 'rejected' }) : item).filter(Boolean).map((item) => ({ eventId: String(item.eventId), reason: String(item.reason || item.code || 'rejected').slice(0, 240) })) : [];
  const sets = [accepted, duplicates, acknowledged, rejected.map((item) => item.eventId)];
  if (sets.some((set) => set.some((item) => !allowed.has(item)))) {
    return { exact: false, acknowledged: [], accepted: [], duplicates: [], rejected: [], reason: 'receipt_contains_unknown_event_id' };
  }
  const ack = acknowledged.length ? acknowledged : [...new Set([...accepted, ...duplicates])];
  const all = new Set([...ack, ...rejected.map((item) => item.eventId)]);
  if (new Set(ack).size !== ack.length || new Set(accepted).size !== accepted.length
    || new Set(duplicates).size !== duplicates.length || accepted.some((item) => duplicates.includes(item))
    || new Set(rejected.map((item) => item.eventId)).size !== rejected.length
    || accepted.some((item) => !ack.includes(item)) || duplicates.some((item) => !ack.includes(item))
    || rejected.some((item) => ack.includes(item.eventId))) {
    return { exact: false, acknowledged: [], accepted: [], duplicates: [], rejected: [], reason: 'receipt_contains_duplicate_event_id' };
  }
  if (all.size !== ids.length || ids.some((eventId) => !all.has(eventId))) {
    return { exact: false, acknowledged: [], accepted: [], duplicates: [], rejected: [], reason: 'receipt_missing_event_id' };
  }
  const classifiedAccepted = accepted.length || duplicates.length
    ? accepted.filter((eventId) => ack.includes(eventId))
    : ack.slice();
  return {
    exact: true,
    acknowledged: [...ack],
    accepted: classifiedAccepted,
    duplicates: duplicates.filter((eventId) => ack.includes(eventId)),
    rejected,
  };
}
