/**
 * Durable per post publish attempts.
 *
 * The publish loop used to call the provider and record the aggregate result
 * afterwards. If the response was lost, nothing on disk said the post had ever been
 * sent, and the advice on a timeout was to try again, which can post twice.
 *
 * Every dispatch now writes its attempt row before the call and updates it straight
 * after, so the record survives a crash between the two. The states are:
 *
 *   pending    the row was written and the provider has not answered yet
 *   accepted   the provider took it but said nothing about when it goes out
 *   scheduled  the provider will post it at the time we asked for
 *   published  the provider posted it
 *   failed     the provider refused it; this is the only state a retry re-sends
 *   unknown    the call went out and the answer was lost; never retried automatically
 *
 * A retry only re-dispatches posts whose last attempt failed. A post that is already
 * scheduled or published is left alone, so a partial failure re-sends only the
 * failures, and an unknown outcome waits for a person or for publishing_reconcile.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';

/** Failures that mean the post may or may not have been accepted. */
const UNCERTAIN_CODES = new Set(['publisher_timeout', 'publisher_unreachable', 'publisher_server_failed']);

/** A reservation stays claimable for one provider request before recovery inspects it. */
export const PUBLISH_LEASE_MS = 60_000;

/** What each attempt state is called on screen and in chat. */
export const ATTEMPT_STATE_LABEL = {
  pending: 'pending',
  accepted: 'accepted',
  scheduled: 'scheduled',
  published: 'published',
  failed: 'failed',
  unknown: 'unclear',
};

/**
 * The most recent attempt for one post of a release, or null.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} releaseId
 * @param {number} postIndex
 * @returns {any|null}
 */
export function lastAttempt(db, releaseId, postIndex) {
  const row = db
    .prepare('SELECT * FROM publish_attempts WHERE release_id = ? AND post_index = ? ORDER BY attempt DESC LIMIT 1')
    .get(releaseId, postIndex);
  return row ? rowToAttempt(row) : null;
}

/**
 * Every attempt for a release, oldest first.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} releaseId
 * @returns {any[]}
 */
export function listAttempts(db, releaseId) {
  return db
    .prepare('SELECT * FROM publish_attempts WHERE release_id = ? ORDER BY post_index, attempt')
    .all(releaseId)
    .map(rowToAttempt);
}

/** @param {any} row */
function rowToAttempt(row) {
  return {
    id: String(row.id),
    release_id: String(row.release_id),
    platform: String(row.platform),
    post_index: Number(row.post_index),
    attempt: Number(row.attempt),
    idempotency_key: String(row.idempotency_key),
    state: String(row.state),
    provider_ref: row.provider_ref ? String(row.provider_ref) : null,
    receipt: parseJson(String(row.receipt ?? '{}'), {}),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    lease_expires_at: row.lease_expires_at ? String(row.lease_expires_at) : null,
    dispatch_started_at: row.dispatch_started_at ? String(row.dispatch_started_at) : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
    intent: row.intent_json ? parseJson(String(row.intent_json), null) : null,
  };
}

/**
 * Write the attempt row for a dispatch that is about to happen.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{release_id: string, platform: string, post_index: number, attempt: number, intent?: any, leaseMs?: number}} args
 * @returns {any}
 */
export function reserveAttempt(db, { release_id, platform, post_index, attempt, intent = null, leaseMs = PUBLISH_LEASE_MS }) {
  const id = newId();
  const at = nowIso();
  const key = `${release_id}/${post_index}/${attempt}`;
  const lease = new Date(Date.now() + Math.max(1, Number(leaseMs) || PUBLISH_LEASE_MS)).toISOString();
  db.prepare(
    'INSERT INTO publish_attempts (id, release_id, platform, post_index, attempt, idempotency_key, state, provider_ref, receipt, created_at, updated_at, lease_expires_at, dispatch_started_at, resolved_at, intent_json) ' +
      "VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, '{}', ?, ?, ?, NULL, NULL, ?)",
  ).run(id, release_id, platform, post_index, attempt, key, at, at, lease, intent ? toJsonColumn(intent) : null);
  return { id, idempotency_key: key, attempt, state: 'pending', lease_expires_at: lease, dispatch_started_at: null, intent };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} attemptId
 * @param {{state: string, provider_ref?: string|null, receipt?: any}} outcome
 */
export function recordAttempt(db, attemptId, { state, provider_ref = null, receipt = {} }) {
  const resolvedAt = ['accepted', 'scheduled', 'published', 'failed', 'unknown'].includes(String(state)) ? nowIso() : null;
  db.prepare('UPDATE publish_attempts SET state = ?, provider_ref = ?, receipt = ?, updated_at = ?, resolved_at = ? WHERE id = ?').run(
    state,
    provider_ref,
    toJsonColumn(receipt ?? {}),
    nowIso(),
    resolvedAt,
    attemptId,
  );
}

/** Mark a reservation as having crossed the provider-call boundary. */
function markDispatchStarted(db, attemptId) {
  const started = nowIso();
  const lease = new Date(Date.now() + PUBLISH_LEASE_MS).toISOString();
  db.prepare('UPDATE publish_attempts SET dispatch_started_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND state = ?').run(
    started,
    lease,
    started,
    attemptId,
    'pending',
  );
  return { dispatch_started_at: started, lease_expires_at: lease };
}

/**
 * A pending row can only be retried when the provider call was never started and
 * its lease expired.  A row that crossed the call boundary is made unclear and is
 * never sent a second time automatically.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {any} attempt
 * @returns {any}
 */
function recoverPending(db, attempt) {
  if (!attempt || attempt.state !== 'pending') return attempt;
  const expired = !attempt.lease_expires_at || Date.parse(attempt.lease_expires_at) <= Date.now();
  if (!expired) return attempt;
  if (attempt.dispatch_started_at) {
    recordAttempt(db, attempt.id, {
      state: 'unknown',
      provider_ref: attempt.provider_ref,
      receipt: { ...(attempt.receipt ?? {}), recovered: 'The provider call may have started before the process stopped.' },
    });
    return lastAttempt(db, attempt.release_id, attempt.post_index);
  }
  recordAttempt(db, attempt.id, {
    state: 'failed',
    provider_ref: null,
    receipt: { ...(attempt.receipt ?? {}), recovered: 'The reservation expired before the provider call started.' },
  });
  return lastAttempt(db, attempt.release_id, attempt.post_index);
}

/**
 * Send a release's posts to a provider, one durable attempt at a time.
 *
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {{release_id: string}} args.release
 * @param {Array<any>} args.posts the release posts to send, each carrying post_index
 * @param {import('./adapter.mjs').PublisherAdapter} args.adapter
 * @param {'schedule'|'publish'} args.mode
 * @param {string} [args.when] ISO date-time, for schedule
 * @param {any} [args.intent] immutable provider intent for the release
 * @returns {Promise<Array<Record<string, any>>>} one row per post, in the order given
 */
export async function dispatchPosts({ db, release, posts, adapter, mode, when, intent = null }) {
  const results = [];
  const frozenIntent = intent ?? release?.intent ?? null;
  for (const post of posts) {
    let previous = lastAttempt(db, release.release_id, post.post_index);

    if (previous?.state === 'pending') previous = recoverPending(db, previous);

    if (previous && previous.state === 'unknown') {
      results.push(outcomeRow(post, previous, 'We could not tell whether this one went out, so it was left alone.'));
      continue;
    }
    if (previous && previous.state === 'pending') {
      results.push(outcomeRow(post, previous, 'This one is reserved by an unfinished publishing attempt and was left alone until it can be checked.'));
      continue;
    }
    if (previous && previous.state !== 'failed') {
      results.push(outcomeRow(post, previous, 'This one had already gone out, so it was not sent again.'));
      continue;
    }

    const intentPost = Array.isArray(frozenIntent?.posts)
      ? frozenIntent.posts.find((entry) => Number(entry?.post_index) === Number(post.post_index))
      : null;
    const scheduledAt = intentPost?.scheduled_at ?? post.scheduled_at ?? when ?? null;
    const accountId = intentPost?.account_id ?? post.account_id ?? null;
    const providerName = frozenIntent?.provider ?? null;
    const providerIntent = {
      provider: providerName,
      account_id: accountId,
      mode: frozenIntent?.mode ?? mode,
      scheduled_at: scheduledAt,
      timezone: frozenIntent?.timezone ?? frozenIntent?.original_timezone ?? null,
      original_timezone: frozenIntent?.original_timezone ?? frozenIntent?.timezone ?? null,
      platform: post.platform,
      post_index: post.post_index,
      caption: post.caption ?? '',
      hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
      first_comment: post.first_comment ?? null,
      asset_id: post.asset_id ?? null,
      asset_sha256: post.asset_sha256 ?? null,
      asset_path: post.asset_path ?? null,
    };

    const reserved = reserveAttempt(db, {
      release_id: release.release_id,
      platform: post.platform,
      post_index: post.post_index,
      attempt: previous ? previous.attempt + 1 : 1,
      intent: providerIntent,
    });

    const providerPost = {
      platform: post.platform,
      account_id: accountId,
      provider: providerName,
      mode: providerIntent.mode,
      scheduled_at: scheduledAt,
      timezone: providerIntent.timezone,
      original_timezone: providerIntent.original_timezone,
      caption: post.caption ?? '',
      hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
      media: post.asset_path ? [{ path: post.asset_path, kind: post.asset_kind === 'image' ? 'image' : 'video' }] : [],
      first_comment: post.first_comment ?? undefined,
    };

    try {
      markDispatchStarted(db, reserved.id);
      const outcome =
        mode === 'schedule'
          ? await adapter.schedule({ post: providerPost, when: String(scheduledAt ?? ''), idempotency_key: reserved.idempotency_key })
          : await adapter.publish({ post: providerPost, idempotency_key: reserved.idempotency_key });
      const validReceipt = outcome && typeof outcome === 'object' && !Array.isArray(outcome);
      const providerState = String(outcome?.status ?? outcome?.state ?? '').toLowerCase();
      const hasScheduleTime = Boolean(scheduledAt || outcome?.scheduled_at || outcome?.scheduled_for || outcome?.due_at);
      const explicitlyPublished = ['published', 'posted', 'sent', 'complete', 'completed'].includes(providerState);
      const explicitlyScheduled = providerState === 'scheduled' && hasScheduleTime;
      const explicitlyFailed = ['failed', 'error', 'rejected', 'denied', 'cancelled', 'canceled'].includes(providerState);
      const explicitlyAccepted = ['accepted', 'pending', 'queued', 'submitting', 'processing', 'sending'].includes(providerState);
      const hasPublicationProof = Boolean(outcome?.provider_ref && outcome?.post_url);
      const hasReceiptEvidence = explicitlyPublished || explicitlyScheduled || explicitlyFailed || explicitlyAccepted || hasPublicationProof;
      // A successful HTTP response with no usable provider receipt is ambiguous:
      // the provider may have accepted the post before returning malformed data.
      // Keep it unclear so a later retry cannot create a duplicate post.
      const state = !validReceipt || !hasReceiptEvidence
        ? 'unknown'
        : explicitlyPublished
          ? 'published'
          : explicitlyScheduled
            ? 'scheduled'
            : explicitlyFailed
              ? 'failed'
              : hasPublicationProof
                ? 'published'
                : 'accepted';
      recordAttempt(db, reserved.id, { state, provider_ref: outcome?.provider_ref ?? null, receipt: outcome ?? {} });
      results.push(
        outcomeRow(post, { ...reserved, state, provider_ref: outcome?.provider_ref ?? null, receipt: outcome ?? {} }, null, {
          scheduled_for: state === 'scheduled' ? String(scheduledAt ?? outcome?.scheduled_at ?? outcome?.scheduled_for ?? outcome?.due_at ?? '') : null,
          published_at: state === 'published' ? nowIso() : null,
          post_url: outcome?.post_url ?? null,
        }),
      );
    } catch (error) {
      const uncertain = Boolean(error && UNCERTAIN_CODES.has(String(error.code)));
      const message = error instanceof Error ? error.message : String(error);
      const state = uncertain ? 'unknown' : 'failed';
      recordAttempt(db, reserved.id, { state, provider_ref: null, receipt: { error: message, code: error?.code ?? null } });
      results.push(
        outcomeRow(post, { ...reserved, state, provider_ref: null, receipt: { error: message } }, uncertain ? message : null, {
          error: message,
        }),
      );
    }
  }
  return results;
}

/**
 * @param {any} post
 * @param {any} attempt
 * @param {string|null} note
 * @param {Record<string, any>} [extra]
 */
function outcomeRow(post, attempt, note, extra = {}) {
  return {
    platform: post.platform,
    post_index: post.post_index,
    status: attempt.state === 'unknown' ? 'unclear' : ATTEMPT_STATE_LABEL[attempt.state] ?? attempt.state,
    attempt_state: attempt.state,
    attempt: attempt.attempt,
    idempotency_key: attempt.idempotency_key,
    scheduled_for: extra.scheduled_for ?? null,
    published_at: extra.published_at ?? null,
    post_url: extra.post_url ?? null,
    provider_ref: attempt.provider_ref ?? null,
    media_asset_ids: post.asset_id ? [post.asset_id] : [],
    error: extra.error ?? null,
    note: note ?? null,
  };
}

/**
 * Ask the provider what happened to the attempts whose outcome was never learned.
 *
 * Only an attempt the provider can be asked about is resolved here: that means one
 * that came back with a provider reference before the answer was lost. Anything else
 * is left exactly as it is, with a plain sentence for the person, because guessing
 * here is what posts twice.
 *
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {string} args.release_id
 * @param {import('./adapter.mjs').PublisherAdapter|null} args.adapter
 * @returns {Promise<{checked: number, resolved: number, attempts: Array<Record<string, any>>}>}
 */
export async function reconcileRelease({ db, release_id, adapter }) {
  const candidates = listAttempts(db, release_id).filter((attempt) => ['pending', 'accepted', 'scheduled', 'unknown'].includes(attempt.state));
  let resolved = 0;
  const attempts = [];
  for (const initial of candidates) {
    let attempt = initial;
    if (attempt.state === 'pending') {
      const expired = !attempt.lease_expires_at || Date.parse(attempt.lease_expires_at) <= Date.now();
      if (expired && attempt.dispatch_started_at) {
        recordAttempt(db, attempt.id, {
          state: 'unknown',
          provider_ref: attempt.provider_ref,
          receipt: { ...(attempt.receipt ?? {}), recovered: 'The provider call may have started before the process stopped.' },
        });
        attempt = lastAttempt(db, release_id, attempt.post_index) ?? attempt;
      } else if (expired && !attempt.dispatch_started_at) {
        recordAttempt(db, attempt.id, {
          state: 'failed',
          provider_ref: null,
          receipt: { ...(attempt.receipt ?? {}), recovered: 'The reservation expired before the provider call started.' },
        });
        attempt = lastAttempt(db, release_id, attempt.post_index) ?? attempt;
        resolved += 1;
        attempts.push({ ...attempt, checked: true, message: 'The unfinished reservation expired before sending, so it is safe to retry.' });
        continue;
      }
    }
    if (!adapter || typeof adapter.status !== 'function' || !attempt.provider_ref) {
      attempts.push({
        ...attempt,
        checked: false,
        message:
          attempt.state === 'pending'
            ? 'This publishing attempt has not finished. Wait for its lease to expire, then check again before sending it.'
            : 'Your publishing service cannot be asked about this one. Open the account and check whether the post is there.',
      });
      continue;
    }
    try {
      const status = await adapter.status({ external_id: attempt.provider_ref });
      let state = mapProviderStatus(String(status?.status ?? ''));
      if (state === 'scheduled' && !attempt.intent?.scheduled_at) state = 'accepted';
      if (state) {
        recordAttempt(db, attempt.id, { state, provider_ref: attempt.provider_ref, receipt: status ?? {} });
        resolved += 1;
        attempts.push({ ...attempt, state, checked: true, message: null });
      } else {
        attempts.push({ ...attempt, checked: true, message: 'Your publishing service could not say what happened to this one yet.' });
      }
    } catch (error) {
      attempts.push({
        ...attempt,
        checked: true,
        message: `Your publishing service could not be asked about this one: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { checked: candidates.length, resolved, attempts };
}

/**
 * @param {string} providerStatus
 * @returns {string|null}
 */
function mapProviderStatus(providerStatus) {
  const value = providerStatus.toLowerCase();
  if (['published', 'sent', 'complete', 'completed', 'posted'].includes(value)) return 'published';
  if (['scheduled', 'buffer'].includes(value)) return 'scheduled';
  if (['pending', 'queued', 'submitting', 'accepted'].includes(value)) return 'accepted';
  if (['failed', 'error', 'rejected'].includes(value)) return 'failed';
  return null;
}
