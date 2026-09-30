import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import {
  assertVerifiedIdentity,
  MAX_EVENT_BATCH,
  normalizeEventForStudio,
  normalizeReceipt,
  stableDigest,
  StudioContractError,
} from './contracts.mjs';

const RECEIPT_VERSION = 1;

function safeName(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function directories(root) {
  return {
    root,
    pending: join(root, 'pending'),
    receipts: join(root, 'receipts'),
  };
}

function receiptFile(dirs, ownerUserId, workspaceId, jobId) {
  return join(dirs.receipts, `${safeName([ownerUserId, workspaceId, jobId].join('|'))}.json`);
}

function readEvent(file) {
  const value = readJsonFile(file, null);
  return value && typeof value === 'object' && value.event && typeof value.event === 'object' ? value : null;
}

function eventFiles(dirs) {
  let names = [];
  try { names = readdirSync(dirs.pending).filter((name) => name.endsWith('.json')); } catch { return []; }
  return names.map((name) => readEvent(join(dirs.pending, name))).filter(Boolean);
}

function baseReceipt(identity, workspaceId, jobId, destination = null) {
  return {
    schemaVersion: RECEIPT_VERSION,
    ownerUserId: identity.ownerUserId,
    ...(identity.ownerEmail ? { ownerEmail: identity.ownerEmail } : {}),
    workspaceId,
    jobId,
    destination,
    acceptedIds: [],
    duplicateIds: [],
    acknowledgedIds: [],
    rejected: [],
    statuses: {},
    queuedCount: 0,
    lastSuccessfulSyncAt: null,
    lastFailureCategory: null,
    lastFailureReason: null,
  };
}

function mergeUnique(previous, incoming, limit = 20000) {
  return [...new Set([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])])].slice(-limit);
}

function pendingEntries(dirs, identity, workspaceId, jobId) {
  const all = eventFiles(dirs);
  const matching = all.filter((entry) => entry.workspaceId === workspaceId && entry.jobId === jobId);
  const foreign = matching.filter((entry) => entry.ownerUserId !== identity.ownerUserId);
  const pending = matching.filter((entry) => entry.ownerUserId === identity.ownerUserId && (!entry.status || entry.status === 'pending'));
  return { all, matching, foreign, pending };
}

function markEntry(file, status, reason = null) {
  return updateJsonFile(file, (current) => {
    if (!current || typeof current !== 'object') return current;
    return {
      ...current,
      status,
      ...(reason ? { rejectionReason: reason } : {}),
      updatedAt: new Date().toISOString(),
    };
  }, '{}');
}

/**
 * Durable local outbox for Studio events.  Each event has its own record, so a
 * receipt for one batch cannot delete an event that arrived during the request.
 */
export function createSyncStore(root) {
  if (typeof root !== 'string' || root.trim().length === 0) throw new StudioContractError('A sync root is required.', 'invalid_sync_store');
  const dirs = directories(root);

  function enqueueEvent(event, identity, context = {}) {
    assertVerifiedIdentity(identity);
    const normalized = normalizeEventForStudio(event, identity, context);
    const file = join(dirs.pending, `${safeName(normalized.eventId)}.json`);
    const digest = stableDigest(normalized);
    let conflict = false;
    updateJsonFile(file, (current) => {
      if (current && current.event && stableDigest(current.event) !== digest) {
        conflict = true;
        return current;
      }
      return {
        schemaVersion: RECEIPT_VERSION,
        event: normalized,
        digest,
        ownerUserId: identity.ownerUserId,
        workspaceId: normalized.workspaceId,
        jobId: normalized.jobId,
        status: current?.status || 'pending',
        createdAt: current?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }, '{}');
    if (conflict) throw new StudioContractError('An event ID was reused with different content.', 'event_conflict');
    return { eventId: normalized.eventId, status: 'queued', file };
  }

  function listPending({ identity, workspaceId, jobId, limit = MAX_EVENT_BATCH } = {}) {
    assertVerifiedIdentity(identity);
    const wid = String(workspaceId || '');
    const jid = String(jobId || '');
    const result = pendingEntries(dirs, identity, wid, jid);
    return {
      status: result.foreign.length ? 'paused' : 'pending',
      reason: result.foreign.length ? 'account_switch_requires_owner_reauthentication' : null,
      pending: result.pending.slice(0, Math.min(MAX_EVENT_BATCH, Math.max(1, Number(limit) || MAX_EVENT_BATCH))).map((entry) => entry.event),
      pendingCount: result.pending.length,
      foreignCount: result.foreign.length,
    };
  }

  async function sync({ identity, workspaceId, jobId, sendBatch, limit = MAX_EVENT_BATCH, destination = null } = {}) {
    assertVerifiedIdentity(identity);
    if (typeof sendBatch !== 'function') throw new StudioContractError('A Studio event sender is required.', 'invalid_sync_sender');
    const first = pendingEntries(dirs, identity, String(workspaceId || ''), String(jobId || ''));
    if (first.foreign.length) {
      return { status: 'paused', sent: 0, pending: first.pending.length, reason: 'account_switch_requires_owner_reauthentication' };
    }
    if (!first.pending.length) return { status: 'synced', sent: 0, pending: 0 };
    const batch = first.pending.slice(0, Math.min(MAX_EVENT_BATCH, Math.max(1, Number(limit) || MAX_EVENT_BATCH)));
    const receiptPath = receiptFile(dirs, identity.ownerUserId, String(workspaceId), String(jobId));
    let result;
    try {
      result = await sendBatch({
        ownerUserId: identity.ownerUserId,
        workspaceId: String(workspaceId),
        jobId: String(jobId),
        events: batch,
      });
    } catch (error) {
      result = { status: 'offline', reason: String(error?.message || error) };
    }
    if (!result || result.status === 'unsupported' || result.status === 'offline' || result.offline) {
      updateJsonFile(receiptPath, (current) => ({
        ...baseReceipt(identity, String(workspaceId), String(jobId), destination),
        ...current,
        ownerUserId: identity.ownerUserId,
        workspaceId: String(workspaceId),
        jobId: String(jobId),
        destination,
        queuedCount: pendingEntries(dirs, identity, String(workspaceId), String(jobId)).pending.length,
        lastFailureCategory: result?.status === 'unsupported' ? 'unsupported' : 'unavailable',
        lastFailureReason: String(result?.reason || 'Studio event destination unavailable').slice(0, 240),
      }), '{}');
      return { status: result?.status === 'unsupported' ? 'unsupported' : 'pending', sent: 0, pending: first.pending.length, reason: result?.reason };
    }
    const ack = normalizeReceipt(result, batch);
    if (!ack.exact) {
      updateJsonFile(receiptPath, (current) => ({
        ...baseReceipt(identity, String(workspaceId), String(jobId), destination),
        ...current,
        ownerUserId: identity.ownerUserId,
        workspaceId: String(workspaceId),
        jobId: String(jobId),
        destination,
        queuedCount: pendingEntries(dirs, identity, String(workspaceId), String(jobId)).pending.length,
        lastFailureCategory: 'incomplete_acknowledgement',
        lastFailureReason: ack.reason,
      }), '{}');
      return { status: 'pending', sent: 0, pending: first.pending.length, reason: ack.reason };
    }
    const byId = new Map(batch.map((event) => [event.eventId, event]));
    const accepted = new Set(ack.accepted);
    const duplicates = new Set(ack.duplicates);
    const rejected = new Map(ack.rejected.map((item) => [item.eventId, item.reason]));
    for (const eventId of ack.acknowledged) {
      if (!duplicates.has(eventId) && !rejected.has(eventId)) accepted.add(eventId);
    }
    for (const event of batch) {
      const file = join(dirs.pending, `${safeName(event.eventId)}.json`);
      if (accepted.has(event.eventId)) markEntry(file, 'accepted');
      else if (duplicates.has(event.eventId)) markEntry(file, 'duplicate');
      else if (rejected.has(event.eventId)) markEntry(file, 'rejected', rejected.get(event.eventId));
      else if (!byId.has(event.eventId)) continue;
    }
    const after = pendingEntries(dirs, identity, String(workspaceId), String(jobId));
    updateJsonFile(receiptPath, (current) => {
      const base = { ...baseReceipt(identity, String(workspaceId), String(jobId), destination), ...current };
      const statuses = { ...(base.statuses || {}) };
      for (const eventId of accepted) statuses[eventId] = 'accepted';
      for (const eventId of ack.duplicates) statuses[eventId] = 'duplicate';
      for (const item of ack.rejected) statuses[item.eventId] = 'rejected';
      return {
        ...base,
        ownerUserId: identity.ownerUserId,
        workspaceId: String(workspaceId),
        jobId: String(jobId),
        destination,
        acceptedIds: mergeUnique(base.acceptedIds, [...accepted]),
        duplicateIds: mergeUnique(base.duplicateIds, ack.duplicates),
        acknowledgedIds: mergeUnique(base.acknowledgedIds, ack.acknowledged),
        rejected: [...(Array.isArray(base.rejected) ? base.rejected : []), ...ack.rejected].slice(-5000),
        statuses,
        queuedCount: after.pending.length,
        lastSuccessfulSyncAt: new Date().toISOString(),
        lastFailureCategory: ack.rejected.length ? 'rejected' : null,
        lastFailureReason: ack.rejected[0]?.reason || null,
      };
    }, '{}');
    return {
      status: after.pending.length ? (ack.rejected.length ? 'rejected' : 'pending') : 'synced',
      sent: ack.acknowledged.length,
      pending: after.pending.length,
      rejected: ack.rejected.length,
      acknowledgedIds: ack.acknowledged,
    };
  }

  function readReceipt({ identity, workspaceId, jobId } = {}) {
    assertVerifiedIdentity(identity);
    return readJsonFile(receiptFile(dirs, identity.ownerUserId, String(workspaceId), String(jobId)), baseReceipt(identity, String(workspaceId), String(jobId)));
  }

  function pruneAcknowledged({ identity, workspaceId, jobId, keep = 20000 } = {}) {
    assertVerifiedIdentity(identity);
    const entries = pendingEntries(dirs, identity, String(workspaceId), String(jobId)).all
      .filter((entry) => entry.ownerUserId === identity.ownerUserId && entry.status && entry.status !== 'pending')
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    for (const entry of entries.slice(0, Math.max(0, entries.length - keep))) {
      try { rmSync(join(dirs.pending, `${safeName(entry.event.eventId)}.json`), { force: true }); } catch { /* best effort cleanup */ }
    }
    return entries.length;
  }

  return Object.freeze({ enqueueEvent, listPending, sync, readReceipt, pruneAcknowledged, directories: dirs });
}
