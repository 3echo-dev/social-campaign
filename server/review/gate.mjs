/**
 * The shared implementation behind the four human approval gates: strategy, concept,
 * cost, media and final review all funnel through openGate here.
 *
 * Design note on resuming a pending gate
 * ---------------------------------------
 * The generic ui_wait tool (server/tools/ui.mjs) only knows about the pane's screen
 * waiter; it has no idea a "review" row exists or which event name a resolved action
 * should log. Teaching ui_wait about reviews would leak review bookkeeping into a
 * foundation tool every screen type uses, including ones that have nothing to do with
 * reviews.
 *
 * Instead this module keeps its own small in-memory map from review_id to the
 * pending screenId/kind/campaign_id, and exposes reviewWait() (wired up as the
 * review_wait tool in server/tools/review.mjs). A gate tool that times out returns
 * status "pending" with a review_id; Claude calls review_wait with that id instead of
 * ui_wait. review_wait resumes the same waitForAction() call and, on resolution, does
 * the two things a plain ui_wait never would: persist the decision onto the reviews
 * row and log the matching event. This keeps ui.mjs free of review specific logic
 * while still honouring the resumable gate pattern end to end.
 */

import { createHash } from 'node:crypto';

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { GATE_WAIT_MS, SCREEN_ACTIONS } from '../ui/server.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { applyMediaDecision } from '../generation/manifest.mjs';
import { redact } from '../lib/secrets.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

/** Artifacts whose exact versions each approval scope is expected to cover. */
const APPROVAL_ARTIFACT_KINDS = {
  strategy: ['StrategySet'],
  concept: ['ConceptList', 'CopyPackage', 'ReuseBrief'],
  cost: ['MediaPlan'],
  media: ['GeneratedMediaPackage'],
  final: [],
};

/**
 * Add immutable artifact references and a payload fingerprint to an approval
 * target.  The payload fingerprint covers direct gate callers that have not yet
 * saved an artifact, while artifact refs bind the normal workflow to exact rows.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>|undefined} target
 * @returns {Record<string, unknown>|null}
 */
function approvalTarget(db, campaignId, kind, payload, target) {
  if (!['strategy', 'concept', 'cost', 'media', 'final'].includes(kind)) return target ?? null;
  const refs = [];
  for (const artifactKind of APPROVAL_ARTIFACT_KINDS[kind] ?? []) {
    const artifact = currentArtifact(db, campaignId, artifactKind);
    if (artifact) refs.push({ id: artifact.id, kind: artifact.kind, version: artifact.version });
  }
  const payloadHash = createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  return { ...(target ?? {}), artifacts: refs, artifact_kinds: APPROVAL_ARTIFACT_KINDS[kind] ?? [], payload_hash: payloadHash };
}

/**
 * Pick the immutable version that a review action is about. The normal pipeline
 * supplies a digest or version; the payload hash keeps direct callers safe too.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function targetRevisionFor(target, payload) {
  for (const key of ['target_revision', 'revision', 'version', 'digest', 'payload_hash']) {
    const value = target[key];
    if (value !== undefined && value !== null && String(value).length > 0) return String(value);
  }
  return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
}

/**
 * review_id -> { screenId, kind, campaign_id }, for reviews still waiting on a
 * decision after their first GATE_WAIT_MS (20 minute) window ran out.
 *
 * This is a shortcut, not the record of truth. It is process memory, so it is empty
 * in a process that restarted and in the other session's process; reviewWait falls
 * back to the reviews row, whose screen_id names the same screen, and the decision
 * itself lives in the workspace's shared action log either way.
 * @type {Map<string, {screenId: string, kind: string, campaign_id: string, allowedActions: string[]}>}
 */
const pendingGates = new Map();

/**
 * Action -> event name, per gate kind. Only actions with a defined V1 event name
 * (docs/CONTRACTS.md section 5) log one; a reject or an action outside this table
 * simply updates the reviews row.
 * @type {Record<string, Record<string, string>>}
 */
const EVENT_MAP = {
  strategy: {
    approve: 'strategy.approved',
    combine: 'strategy.approved',
    request_changes: 'strategy.revision_requested',
  },
  concept: {},
  cost: { approve: 'cost.approved' },
  media: { approve: 'asset.approved', approve_all: 'asset.approved', reject: 'asset.rejected' },
  final: { approve: 'final.approved' },
  question: {},
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null} campaignId
 * @param {string} name
 * @param {Record<string, unknown>} payload
 */
function logEvent(db, campaignId, name, payload) {
  if (!name) return;
  db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    campaignId ?? null,
    name,
    // A gate's payload can be an approval decision that echoes back whatever the
    // person typed on the screen it resolved. redact() keeps a secret field out
    // of the events table the same way it is kept out of every other place a
    // resolved action can land.
    toJsonColumn(redact(payload ?? {})),
    nowIso(),
  );
}

/**
 * Open a human approval gate: write the pending reviews row, optionally log the
 * "something was produced" event that precedes review (strategy.generated,
 * cost.estimated, asset.generated are logged by the tools that made those things,
 * not here; generatedEvent below is for gates that want one logged at show time),
 * show the screen and wait.
 *
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {import('../ui/server.mjs').UiServer} args.ui
 * @param {string} args.campaign_id
 * @param {'strategy'|'concept'|'cost'|'media'|'final'|'question'} args.kind
 * @param {Record<string, unknown>} args.payload what the user is shown.
 * @param {string} args.screen the screen type to show, from SCREEN_ACTIONS.
 * @param {string[]} [args.allowedActions] documents the actions this gate expects; the
 *   pane itself is the actual enforcement point via SCREEN_ACTIONS.
 * @param {string} [args.generatedEvent] an event name to log when the gate opens.
 * @param {Record<string, unknown>} [args.generatedPayload]
 * @param {Record<string, unknown>} [args.target] what exactly is being decided about,
 *   for example {release_id, digest} for a final review. Stored on the review row so a
 *   resolved approval names the thing it approved rather than the campaign in general.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function openGate({
  workspace,
  ui,
  campaign_id,
  kind,
  payload,
  screen,
  allowedActions,
  generatedEvent,
  generatedPayload,
  target,
  signal,
}) {
  if (!campaign_id) throw new InvalidInputError('campaign_id is required to open a review gate.');
  const db = workspace.requireDb();

  const reviewId = newId();
  const approvedTarget = approvalTarget(db, campaign_id, kind, payload, target) ?? {};
  const target_revision = targetRevisionFor(approvedTarget, payload);
  const boundTarget = {
    ...approvedTarget,
    workspace_id: workspace.root ?? null,
    campaign_id,
    review_id: reviewId,
    target_revision,
  };
  const shown = ui.show(screen, payload, {
    contextKey: `review:${workspace.root ?? 'unknown'}:${campaign_id}:${reviewId}:${target_revision}`,
    workspaceId: workspace.root ?? null,
    campaignId: campaign_id,
    reviewId,
    targetRevision: target_revision,
    decision: true,
  });

  db.prepare(
    'INSERT INTO reviews (id, campaign_id, kind, payload, status, created_at, screen_id, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(reviewId, campaign_id, kind, toJsonColumn(payload ?? {}), 'pending', nowIso(), shown.screenId, boundTarget ? toJsonColumn(boundTarget) : null);

  if (generatedEvent) logEvent(db, campaign_id, generatedEvent, generatedPayload ?? {});

  return await waitAndResolve({ workspace, ui, reviewId, kind, campaign_id, screenId: shown.screenId, allowedActions, signal });
}

/**
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {import('../ui/server.mjs').UiServer} args.ui
 * @param {string} args.reviewId
 * @param {string} args.kind
 * @param {string} args.campaign_id
 * @param {string} args.screenId
 * @param {string[]} [args.allowedActions]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<Record<string, unknown>>}
 */
async function waitAndResolve({ workspace, ui, reviewId, kind, campaign_id, screenId, allowedActions, signal }) {
  const result = await ui.waitForAction(screenId, { timeoutMs: GATE_WAIT_MS, signal, acknowledge: false });
  if (!result) {
    pendingGates.set(reviewId, { screenId, kind, campaign_id, allowedActions: allowedActions ?? [] });
    return {
      status: 'pending',
      review_id: reviewId,
      screenId,
      hint: 'The user has not answered yet. Call review_wait with this review_id to keep waiting.',
      url: ui.url(),
    };
  }
  return finishGate({ workspace, ui, reviewId, kind, campaign_id, result, allowedActions });
}

/**
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {import('../ui/server.mjs').UiServer} args.ui
 * @param {string} args.reviewId
 * @param {string} args.kind
 * @param {string} args.campaign_id
 * @param {import('../ui/server.mjs').ActionResult} args.result
 * @param {string[]} [args.allowedActions]
 * @returns {Record<string, unknown>}
 */
function finishGate({ workspace, ui, reviewId, kind, campaign_id, result, allowedActions = [] }) {
  const db = workspace.requireDb();
  const { action, payload } = result;
  if (allowedActions.length > 0 && !allowedActions.includes(action)) {
    throw new InvalidInputError(`The review does not accept "${action}".`);
  }
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(reviewId);
  if (!row) throw new InvalidInputError(`No review found for id "${reviewId}".`);
  if (String(row.status) === 'resolved') return resolvedGateResult(row, ui, reviewId);
  if (String(row.campaign_id) !== campaign_id || (result.campaignId != null && String(result.campaignId) !== campaign_id)) {
    throw new InvalidInputError('That decision belongs to a different campaign.');
  }
  if (result.reviewId != null && String(result.reviewId) !== reviewId) {
    throw new InvalidInputError('That decision belongs to a different review.');
  }
  if (row.screen_id != null && String(row.screen_id) !== String(result.screenId)) {
    throw new InvalidInputError('That decision belongs to a different screen.');
  }
  const target = parseJson(String(row.target ?? '{}'), {});
  for (const [key, value] of [
    ['workspace_id', result.workspaceId],
    ['campaign_id', result.campaignId],
    ['review_id', result.reviewId],
    ['target_revision', result.targetRevision],
  ]) {
    if (target[key] != null && String(target[key]) !== String(value ?? '')) {
      throw new InvalidInputError('That decision belongs to a different workspace, campaign or review target.');
    }
  }

  // The review row, matching event and domain side effect share the durable action
  // acknowledgement transaction. A process crash before commit leaves the action
  // claimed until its lease expires, so review_wait can safely resume it.
  ui.applyDecision(result, (transactionDb) => {
    const updated = transactionDb.prepare(
      'UPDATE reviews SET decision = ?, status = ?, resolved_at = ? WHERE id = ? AND campaign_id = ? AND status = \'pending\'',
    ).run(toJsonColumn({ action, payload: redact(payload) }), 'resolved', nowIso(), reviewId, campaign_id);
    if (Number(updated?.changes ?? 0) !== 1) throw new InvalidInputError('That review was already resolved.');
    const eventName = (EVENT_MAP[kind] ?? {})[action];
    if (eventName) logEvent(transactionDb, campaign_id, eventName, { review_id: reviewId, action, ...payload });
    // A media decision is also a decision about the generation record: the approved or
    // rejected item moves on there, which is what releases a hero-first batch.
    if (kind === 'media') applyMediaDecision(transactionDb, campaign_id, String(action), /** @type {any} */ (payload));
  });
  pendingGates.delete(reviewId);
  return { status: 'resolved', review_id: reviewId, action, payload: redact(payload), url: ui.url() };
}

/** @param {any} row @param {import('../ui/server.mjs').UiServer} ui @param {string} reviewId */
function resolvedGateResult(row, ui, reviewId) {
  const decision = parseJson(String(row.decision ?? '{}'), {});
  return {
    status: 'resolved',
    review_id: reviewId,
    action: decision.action,
    payload: redact(decision.payload ?? {}),
    url: ui.url(),
  };
}

/**
 * Resume waiting on a gate that returned status "pending". This is the resumable
 * half of the gate pattern for reviews: it keeps calling waitForAction on the same
 * screenId until the user decides, then persists the decision exactly as openGate's
 * first wait would have.
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {import('../ui/server.mjs').UiServer} args.ui
 * @param {string} args.review_id
 * @returns {Promise<Record<string, unknown>>}
 */
export async function reviewWait({ workspace, ui, review_id, signal }) {
  const db = workspace.requireDb();
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(review_id);
  if (!row) throw new InvalidInputError(`No review found for id "${review_id}".`);
  if (String(row.status) === 'resolved') return resolvedGateResult(row, ui, review_id);
  const screenId = restorePendingGateScreen({ workspace, ui, row });
  if (!screenId) {
    throw new InvalidInputError(
      `Review "${review_id}" is not being waited on right now. Its screen identity is missing.`,
    );
  }
  const kind = String(row.kind);
  const pending = pendingGates.get(review_id);
  pendingGates.set(review_id, {
    screenId,
    kind,
    campaign_id: String(row.campaign_id),
    allowedActions: pending?.allowedActions ?? SCREEN_ACTIONS[screenTypeForKind(kind)] ?? [],
  });
  return await waitAndResolve({
    workspace,
    ui,
    reviewId: review_id,
    kind,
    campaign_id: String(row.campaign_id),
    screenId,
    allowedActions: pending?.allowedActions ?? SCREEN_ACTIONS[screenTypeForKind(kind)] ?? [],
    signal,
  });
}

const SCREEN_FOR_KIND = {
  strategy: 'strategy_review',
  concept: 'concept_review',
  cost: 'cost_review',
  media: 'media_review',
  final: 'final_review',
  question: 'question',
};

/** @param {string} kind @returns {string} */
function screenTypeForKind(kind) {
  return SCREEN_FOR_KIND[kind] ?? 'message';
}

/**
 * Restore a pending review's exact screen id and identity into the pane. This is
 * used when pane-state.json expired or the last visible screen belonged to another
 * campaign, while the durable reviews row and action receipt are still pending.
 * @param {{workspace: import('../workspace/index.mjs').Workspace, ui: import('../ui/server.mjs').UiServer, row: any}}
 *   args
 * @returns {string}
 */
export function restorePendingGateScreen({ workspace, ui, row }) {
  const screenId = row.screen_id ? String(row.screen_id) : '';
  if (!screenId) return '';
  const kind = String(row.kind);
  const type = screenTypeForKind(kind);
  if (!(type in SCREEN_ACTIONS)) return screenId;
  const target = parseJson(String(row.target ?? '{}'), {});
  const payload = parseJson(String(row.payload ?? '{}'), {});
  const targetRevision = targetRevisionFor(target, payload);
  const workspaceId = target.workspace_id == null ? String(workspace.root) : String(target.workspace_id);
  const campaignId = String(row.campaign_id);
  const reviewId = String(row.id);
  const contextKey = `review:${workspaceId}:${campaignId}:${reviewId}:${targetRevision}`;
  const current = ui.screen;
  const matches =
    current.screenId === screenId &&
    current.type === type &&
    String(current.workspaceId ?? workspace.root ?? '') === workspaceId &&
    String(current.campaignId ?? '') === campaignId &&
    String(current.reviewId ?? '') === reviewId &&
    String(current.targetRevision ?? '') === targetRevision;
  if (!matches && typeof ui.restoreState === 'function') {
    ui.restoreState({
      screen: {
        screenId,
        type,
        data: payload,
        contextKey,
        workspaceId,
        campaignId,
        reviewId,
        targetRevision,
        decision: true,
        revision: Number(row.screen_revision ?? 0),
        shownAt: String(row.created_at ?? nowIso()),
      },
      busy: null,
      activity: null,
    });
  }
  return screenId;
}

/**
 * Re-arm the in-memory pending gate for a screen restored from pane-state.json.
 *
 * A restart always empties pendingGates, since it is process memory. Without this,
 * a person who clicks a restored gate screen's button gets their decision recorded
 * on the pane (submitAction still works, and stores the result for whichever
 * waitForAction asks next), but Claude calling review_wait with the old review_id
 * would find nothing in pendingGates and, since the reviews row is still 'pending',
 * would get a hard error instead of the decision.
 *
 * Called once at boot, after the pane state restore, for the one review row (if
 * any) whose screen_id matches the restored screen and whose status is still
 * pending. It does not itself wait; it just makes the row callable by review_wait
 * or a matching ui_wait again, which will retrieve the decision (already sitting
 * in ui.results if the person clicked before Claude asked) or truly wait for it.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null} [screenId]
 * @returns {{review_id: string, kind: string, campaign_id: string}|null}
 */
export function rehydratePendingGate(db, screenId = null) {
  const row = (screenId ? db.prepare("SELECT * FROM reviews WHERE screen_id = ? AND status = 'pending'").get(screenId) : null) ?? db.prepare("SELECT * FROM reviews WHERE status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1").get();
  if (!row) return null;
  const restoredScreenId = String(row.screen_id ?? screenId ?? '');
  if (!restoredScreenId) return null;
  pendingGates.set(String(row.id), {
    screenId: restoredScreenId,
    kind: String(row.kind),
    campaign_id: String(row.campaign_id),
    allowedActions: SCREEN_ACTIONS[screenTypeForKind(String(row.kind))] ?? [],
  });
  return { review_id: String(row.id), kind: String(row.kind), campaign_id: String(row.campaign_id) };
}

/**
 * Return the newest pending review so boot can restore it even when the pane file
 * was stale or belonged to another campaign.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{review_id: string, kind: string, campaign_id: string, screenId: string}|null}
 */
export function latestPendingGate(db) {
  const row = db.prepare("SELECT * FROM reviews WHERE status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1").get();
  if (!row || !row.screen_id) return null;
  rehydratePendingGate(db, String(row.screen_id));
  return {
    review_id: String(row.id),
    kind: String(row.kind),
    campaign_id: String(row.campaign_id),
    screenId: String(row.screen_id),
  };
}

/**
 * Record a decision the person typed in chat instead of clicking in the pane.
 *
 * This calls the exact same ui.submitAction() the pane's own click uses, so the
 * decision flows through waitForAction() and finishGate() identically to a pane
 * click: whichever review_wait call is already in flight (or the next one) resolves
 * with it, the reviews row is updated, and the matching event is logged. Nothing
 * about a chat-typed decision skips the bookkeeping a pane click would have done.
 *
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {import('../ui/server.mjs').UiServer} args.ui
 * @param {string} args.review_id
 * @param {string} args.action
 * @param {Record<string, unknown>} [args.payload]
 * @returns {Record<string, unknown>}
 */
export function resolveFromChat({ workspace, ui, review_id, action, payload }) {
  const db = workspace.requireDb();
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(review_id);
  if (!row) throw new InvalidInputError(`No review found for id "${review_id}".`);
  if (String(row.status) === 'resolved') return resolvedGateResult(row, ui, review_id);
  const allowedActions = SCREEN_ACTIONS[screenTypeForKind(String(row.kind))] ?? [];
  if (!allowedActions.includes(action)) throw new InvalidInputError(`The review does not accept "${action}".`);
  const screenId = restorePendingGateScreen({ workspace, ui, row });
  if (!screenId) throw new InvalidInputError(`Review "${review_id}" has no screen to resolve.`);
  pendingGates.set(review_id, {
    screenId,
    kind: String(row.kind),
    campaign_id: String(row.campaign_id),
    allowedActions,
  });
  ui.submitAction(screenId, action, payload ?? {});
  // submitAction only records the decision; it does not itself run finishGate. The
  // in-flight (or next) review_wait picks it up via waitForAction and finishes it.
  // Callers of this tool should follow up with review_wait using the same review_id
  // so the decision actually gets persisted onto the reviews row and its event logged.
  return { status: 'accepted', review_id, hint: 'Call review_wait with this review_id to finish resolving it.' };
}

/** Exposed for tests that want to assert on the in-memory pending set. */
export const _pendingGatesForTests = pendingGates;
