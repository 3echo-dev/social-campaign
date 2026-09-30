import {
  assertVerifiedIdentity,
  MAX_EVENT_BATCH,
  MAX_EVENT_BATCH_BYTES,
  normalizeEventForStudio,
  normalizeJobRegistration,
  normalizeReceipt,
  normalizeWorkspaceRegistration,
  sanitizePreviewAsset,
  StudioContractError,
} from './contracts.mjs';
import { resolveHttpIdentity, resolveNativeIdentity } from './contracts.mjs';
import { consumeDecision, decisionEnvelope } from './decisions.mjs';

const UNSUPPORTED = (operation, reason = 'operation_not_available') => ({
  status: 'unsupported',
  operation,
  reason,
  acceptedIds: [],
  alreadyPresentIds: [],
  acknowledgedIds: [],
  rejected: [],
});

function operationName(operations, key, fallback) {
  return operations && operations[key] ? operations[key] : fallback;
}

function normalizeTransportResult(result, operation) {
  if (result === undefined || result === null) return UNSUPPORTED(operation);
  if (result.status === 'unsupported' || result.unsupported === true) return { ...UNSUPPORTED(operation), ...result, status: 'unsupported' };
  return result;
}

/**
 * Adapter for the authenticated native Studio MCP relay.  No endpoint is
 * assumed: operation names must be supplied by the host integration, and an
 * absent operation remains explicitly unsupported.
 */
export function createNativeRelay({ call, operations = {} } = {}) {
  async function invoke(key, payload) {
    const operation = operations[key];
    if (typeof operation === 'function') return normalizeTransportResult(await operation(payload), key);
    if (typeof call !== 'function') return UNSUPPORTED(key, 'native_transport_not_configured');
    try {
      return normalizeTransportResult(await call(operationName(operations, key, key), payload), key);
    } catch (error) {
      return { status: 'offline', operation: key, reason: String(error?.message || error), acceptedIds: [], alreadyPresentIds: [], acknowledgedIds: [], rejected: [] };
    }
  }
  return Object.freeze({
    source: 'native_mcp',
    async getIdentity() {
      return resolveNativeIdentity({ listWorkspaces: () => invoke('listWorkspaces', {}) });
    },
    registerWorkspace: (payload) => invoke('registerWorkspace', payload),
    registerJob: (payload) => invoke('registerJob', payload),
    putEvents: (payload) => invoke('putEvents', payload),
    readJob: (payload) => invoke('readJob', payload),
    submitDecision: (payload) => invoke('submitDecision', payload),
    readDecision: (payload) => invoke('readDecision', payload),
    registerPreviewAsset: (payload) => invoke('registerPreviewAsset', payload),
  });
}

/**
 * Adapter for a first-party HTTP path.  The credential handle is kept in the
 * host process and only passed to the verifier/request callback.
 */
export function createHttpRelay({ request, verifyCredential, credentialHandle } = {}) {
  async function getIdentity() {
    return resolveHttpIdentity({ credentialHandle, verifyCredential });
  }
  async function invoke(operation, payload, identity) {
    if (typeof request !== 'function') return UNSUPPORTED(operation, 'http_transport_not_configured');
    assertVerifiedIdentity(identity);
    try {
      const result = await request(operation, payload, credentialHandle);
      const normalized = normalizeTransportResult(result, operation);
      if (normalized.ownerUserId && normalized.ownerUserId !== identity.ownerUserId) {
        throw new StudioContractError('Studio HTTP response belongs to another account.', 'identity_mismatch');
      }
      return normalized;
    } catch (error) {
      if (error instanceof StudioContractError) throw error;
      return { status: 'offline', operation, reason: String(error?.message || error), acceptedIds: [], alreadyPresentIds: [], acknowledgedIds: [], rejected: [] };
    }
  }
  return Object.freeze({
    source: 'http_oauth',
    getIdentity,
    registerWorkspace: (payload, identity) => invoke('registerWorkspace', payload, identity),
    registerJob: (payload, identity) => invoke('registerJob', payload, identity),
    putEvents: (payload, identity) => invoke('putEvents', payload, identity),
    readJob: (payload, identity) => invoke('readJob', payload, identity),
    submitDecision: (payload, identity) => invoke('submitDecision', payload, identity),
    readDecision: (payload, identity) => invoke('readDecision', payload, identity),
    registerPreviewAsset: (payload, identity) => invoke('registerPreviewAsset', payload, identity),
  });
}

function selectedRelay(nativeRelay, httpRelay, preferred) {
  if (preferred === 'http' && httpRelay) return httpRelay;
  if (preferred === 'native' && nativeRelay) return nativeRelay;
  return nativeRelay || httpRelay || null;
}

/**
 * Build the dormant local Studio boundary.  The caller supplies the actual
 * authenticated transport and may switch transports after identity refresh.
 */
export function createStudioBackend({ nativeRelay = null, httpRelay = null, preferred = 'native', identity = null } = {}) {
  let activeRelay = selectedRelay(nativeRelay, httpRelay, preferred);
  let activeIdentity = identity;
  if (activeIdentity) assertVerifiedIdentity(activeIdentity);

  async function getIdentity() {
    if (!activeRelay || typeof activeRelay.getIdentity !== 'function') {
      throw new StudioContractError('No authenticated Studio connector is configured.', 'not_configured');
    }
    activeIdentity = await activeRelay.getIdentity();
    assertVerifiedIdentity(activeIdentity);
    return activeIdentity;
  }

  function identityOrThrow(value) {
    const current = value || activeIdentity;
    assertVerifiedIdentity(current);
    return current;
  }

  async function callRelay(method, payload, identity) {
    if (!activeRelay || typeof activeRelay[method] !== 'function') return UNSUPPORTED(method, 'studio_backend_not_configured');
    return activeRelay[method](payload, identity);
  }

  async function registerWorkspace(workspace, identity) {
    const verified = identityOrThrow(identity);
    const payload = normalizeWorkspaceRegistration(workspace, verified);
    return callRelay('registerWorkspace', payload, verified);
  }

  async function registerJob(job, identity, existing = null) {
    const verified = identityOrThrow(identity);
    const payload = normalizeJobRegistration(job, verified, existing);
    return callRelay('registerJob', payload, verified);
  }

  async function sendEventBatch({ identity, workspaceId, jobId, events } = {}) {
    const verified = identityOrThrow(identity);
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENT_BATCH) {
      throw new StudioContractError(`Studio event batches must contain 1 to ${MAX_EVENT_BATCH} events.`, 'invalid_event_batch');
    }
    const normalized = events.map((event) => normalizeEventForStudio(event, verified, { workspaceId, jobId }));
    const payload = {
      schemaVersion: 1,
      ownerUserId: verified.ownerUserId,
      ...(verified.ownerEmail ? { ownerEmail: verified.ownerEmail } : {}),
      workspaceId,
      jobId,
      events: normalized,
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_EVENT_BATCH_BYTES) {
      throw new StudioContractError('Studio event batches exceed the aggregate metadata size limit.', 'invalid_event_batch');
    }
    const result = await callRelay('putEvents', payload, verified);
    if (result?.status === 'unsupported' || result?.status === 'offline') return result;
    const receipt = normalizeReceipt(result, normalized);
    return receipt.exact ? result : { ...result, status: 'invalid_receipt', reason: receipt.reason };
  }

  async function readJob({ workspaceId, jobId } = {}, identity) {
    const verified = identityOrThrow(identity);
    return callRelay('readJob', { ownerUserId: verified.ownerUserId, workspaceId, jobId }, verified);
  }

  async function submitDecision({ identity, job, gate, decision, artifactRevision, artifactHash, actorUserId, metadata } = {}) {
    const verified = identityOrThrow(identity);
    const payload = decisionEnvelope({ identity: verified, job, gate, decision, artifactRevision, artifactHash, actorUserId, metadata });
    return callRelay('submitDecision', payload, verified);
  }

  async function consumeSubmittedDecision({ record, job, expectedRevision, expectedHash, actorUserId } = {}) {
    return consumeDecision({ record, job, expectedRevision, expectedHash, actorUserId });
  }

  async function readDecision({ workspaceId, jobId, gate } = {}, identity) {
    const verified = identityOrThrow(identity);
    return callRelay('readDecision', { ownerUserId: verified.ownerUserId, workspaceId, jobId, gate }, verified);
  }

  async function registerPreviewAsset(asset, identity, context = {}) {
    const verified = identityOrThrow(identity);
    if (typeof context.workspaceId !== 'string' || !context.workspaceId.trim()
      || typeof context.jobId !== 'string' || !context.jobId.trim()) {
      throw new StudioContractError('Preview assets must be scoped to a workspace and job.', 'invalid_asset_reference');
    }
    const reference = sanitizePreviewAsset(asset);
    return callRelay('registerPreviewAsset', {
      schemaVersion: 1,
      ownerUserId: verified.ownerUserId,
      workspaceId: context.workspaceId,
      jobId: context.jobId,
      asset: reference,
    }, verified);
  }

  function setTransport({ native = nativeRelay, http = httpRelay, mode = preferred } = {}) {
    activeRelay = selectedRelay(native, http, mode);
    activeIdentity = null;
    return activeRelay ? activeRelay.source : null;
  }

  function setIdentity(next) {
    activeIdentity = identityOrThrow(next);
    return activeIdentity;
  }

  return Object.freeze({
    getIdentity,
    registerWorkspace,
    registerJob,
    sendEventBatch,
    readJob,
    submitDecision,
    consumeSubmittedDecision,
    readDecision,
    registerPreviewAsset,
    setTransport,
    setIdentity,
  });
}

export { UNSUPPORTED };
