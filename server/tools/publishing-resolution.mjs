/** A durable human check for a provider outcome that cannot be reconciled. */
import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { openGate, reviewWait } from '../review/gate.mjs';
import { lastAttempt, recordAttempt } from '../publishing/dispatch.mjs';
import { createHash } from 'node:crypto';
import { approvalStatus } from '../review/approvals.mjs';

function readAttempt(db, id) {
  return db.prepare(
    'SELECT p.*, r.campaign_id FROM publish_attempts p JOIN release_packages r ON r.id = p.release_id WHERE p.id = ?',
  ).get(id) ?? null;
}

function targetFor(attempt) {
  const revision = createHash('sha256').update(JSON.stringify([attempt.id, attempt.state, attempt.updated_at, attempt.receipt])).digest('hex');
  return { manual_publish_attempt: String(attempt.id), release_id: String(attempt.release_id), revision };
}

function retryAllowed(db, attempt) {
  if (attempt.state !== 'failed' || !parseJson(attempt.receipt, {}).manual_review_id) return false;
  const approval = approvalStatus(db, String(attempt.campaign_id), 'final');
  return approval.approved && approval.release_id === attempt.release_id;
}

export const publishingResolutionTools = [defineTool({
  name: 'publishing_resolve_attempt',
  description: 'Ask the user to check an unclear publishing attempt in the provider and account, then record their observation. Never sends a post. Resume with the returned review_id after a pending result.',
  inputSchema: {
    type: 'object',
    properties: { attempt_id: { type: 'string' }, review_id: { type: 'string' } },
    required: ['attempt_id'],
    additionalProperties: false,
  },
  handler: async (args, { workspace, ui, signal }) => {
    const db = workspace.requireDb();
    const attempt = readAttempt(db, String(args.attempt_id));
    if (!attempt) throw new InvalidInputError('That publishing attempt was not found in this workspace.');
    const latest = lastAttempt(db, String(attempt.release_id), Number(attempt.post_index));
    if (latest?.id !== attempt.id) throw new InvalidInputError('A newer attempt exists for this post. Check that attempt instead.');
    const receipt = parseJson(attempt.receipt, {});
    if (attempt.state !== 'unknown' || (args.review_id && receipt.manual_review_id === args.review_id)) {
      return { ok: true, status: 'resolved', attempt_id: attempt.id, state: attempt.state, retry_allowed: retryAllowed(db, attempt), message: 'This attempt already has an outcome or is still being handled. Reconcile it before asking for a manual check.' };
    }
    let reviewId = typeof args.review_id === 'string' ? args.review_id : null;
    // Reuse a durable check after cancellation/restart rather than opening a
    // second question for the same unchanged uncertain attempt.
    if (!reviewId) {
      const existing = db.prepare("SELECT id, target FROM reviews WHERE campaign_id = ? AND kind = 'question' ORDER BY created_at DESC").all(attempt.campaign_id);
      reviewId = existing.find(row => {
        const target = parseJson(row.target, {});
        return target.manual_publish_attempt === attempt.id && target.revision === targetFor(attempt).revision;
      })?.id ?? null;
    }
    if (reviewId) {
      const row = db.prepare("SELECT campaign_id, kind, target FROM reviews WHERE id = ?").get(reviewId);
      const target = parseJson(row?.target, {});
      if (!row || row.kind !== 'question' || row.campaign_id !== attempt.campaign_id || target.manual_publish_attempt !== attempt.id || target.revision !== targetFor(attempt).revision) {
        throw new InvalidInputError('That check belongs to another attempt or its outcome has changed. Open a fresh check.');
      }
    }
    const post = db.prepare('SELECT caption, account_id FROM release_posts WHERE release_id = ? AND post_index = ?').get(attempt.release_id, attempt.post_index);
    const postContext = [
      post?.caption ? `Post: ${post.caption}` : 'Use the post from this campaign you originally chose to send.',
      post?.account_id ? `Target account: ${post.account_id}.` : 'Use the intended account and posting service.',
      'Check the provider queue too. A post missing from the public profile alone does not prove it was never accepted.',
    ].join('\n');
    const result = reviewId
      ? await reviewWait({ workspace, ui, signal, review_id: reviewId })
      : await openGate({
        workspace, ui, signal, campaign_id: String(attempt.campaign_id), kind: 'question', screen: 'question', allowedActions: ['submit'],
        target: targetFor(attempt),
        payload: {
          title: 'Check the publishing outcome',
          question: `What does your publishing service show for this ${attempt.platform} post?`,
          context: postContext,
          options: [
            { id: 'unknown', label: 'Still unclear', description: 'Keep it on hold while its outcome is uncertain.' },
            { id: 'published', label: 'The post is live', description: 'I found this exact post on the intended account.' },
            { id: 'queued', label: 'The provider has it queued', description: 'Keep the existing post and do not send another copy.' },
            { id: 'not_sent', label: 'The provider confirms it was not accepted', description: 'I verified that it was rejected or cancelled and is not queued. A retry is allowed.' },
          ],
          allow_other: false,
          attempt_id: String(attempt.id),
        },
      });
    if (result.status !== 'resolved') return {
      ...result, attempt_id: attempt.id,
      hint: 'Call publishing_resolve_attempt with this attempt_id and review_id to resume the same check.',
    };
    const choice = String(result.payload?.option_id ?? '');
    if (result.action !== 'submit' || !['unknown', 'published', 'queued', 'scheduled', 'not_sent'].includes(choice)) {
      throw new InvalidInputError('Choose one of the publishing outcomes shown in the pane.');
    }
    const state = choice === 'not_sent' ? 'failed' : ['queued', 'scheduled'].includes(choice) ? 'accepted' : choice;
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = readAttempt(db, String(attempt.id));
      if (!current || targetFor(current).revision !== targetFor(attempt).revision || lastAttempt(db, attempt.release_id, attempt.post_index)?.id !== attempt.id) {
        throw new InvalidInputError('The attempt changed while you were checking it. Read its current outcome before taking another action.');
      }
      const receipt = {
        ...parseJson(current.receipt, {}),
        manual_review_id: result.review_id,
        manual_observation: choice,
        checked_at: nowIso(),
      };
      recordAttempt(db, String(attempt.id), { state, provider_ref: current.provider_ref, receipt });
      db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
        newId(), attempt.campaign_id, 'publishing.manually_checked', toJsonColumn({ attempt_id: attempt.id, review_id: result.review_id, state }), nowIso(),
      );
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    }
    const mayRetry = retryAllowed(db, readAttempt(db, String(attempt.id)));
    const messages = {
      failed: mayRetry ? 'Your check was recorded. This post may now be retried against its approved release.' : 'Your check was recorded. This release needs a current final approval before another attempt.',
      unknown: 'The outcome is still unclear. This post remains on hold.',
      published: 'You confirmed the post is live. The existing post was kept.',
      accepted: 'You confirmed the provider has the post queued. The existing request was kept.',
    };
    return { ok: true, status: 'resolved', attempt_id: attempt.id, review_id: result.review_id, state, retry_allowed: mayRetry, message: messages[state] };
  },
})];
