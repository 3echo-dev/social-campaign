/**
 * The generation manifest.
 *
 * One document per campaign that says what was planned, what is being made right
 * now, what came back, and which cost approval paid for it. It is stored as the
 * campaign's `GenerationManifest` artifact, which is a kind of its own: the working
 * record and the finished `GeneratedMediaPackage` are two different documents with
 * two different rules, and giving them one kind each means a reader never has to
 * guess which of the two a row holds.
 *
 * The working manifest is written straight into the artifacts table rather than
 * through artifact_save, because a plan that has not reached the cost gate yet has
 * no cost_approval_id and the GeneratedMediaPackage contract requires one. That is
 * the point of that contract: a package that cannot name its approval is not a
 * finished package. toPackage() is the projection the media approval and artifact_save
 * are handed once the cost gate has passed.
 *
 * The one rule this module exists to enforce:
 *
 *   an item cannot move to `generating` unless the campaign has a resolved, approved
 *   cost review, and the item records that review_id as its cost_approval_id.
 *
 * Nothing else in the codebase may start paid work, which is why beginItem is the
 * only way into the `generating` state.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { heroFirstCheck, idempotencyKey, ledgerFor, requestHash } from './cost-gate.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';
import { approvalStatus } from '../review/approvals.mjs';

/** The artifact kind the working manifest is stored under. */
export const MANIFEST_KIND = 'GenerationManifest';

/** The artifact kind the finished projection is stored under. */
export const PACKAGE_KIND = 'GeneratedMediaPackage';

/**
 * Every state an item can be in. `outcome_unknown` is a dead end on purpose: a
 * submission whose result we could not observe (timeout, crash) never auto-retries.
 * It waits for a human decision through media review, or a fresh cost approval.
 */
export const ITEM_STATES = ['planned', 'generating', 'generated', 'approved', 'rejected', 'regenerate', 'outcome_unknown'];

/** What the user is told when generation is attempted before the cost gate. */
export const NEEDS_COST_APPROVAL_MESSAGE =
  'I need your approval on the cost before I can make this. Nothing has been spent.';

/**
 * The id of the review that currently authorises a kind, by the same newest-wins
 * rule as the approval_check tool, so that generation can guard itself without
 * depending on Claude having called it.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {string|null} the review id, or null when there is no approval
 */
export function approvedReviewId(db, campaignId, kind) {
  const row = approvedReview(db, campaignId, kind);
  return row ? row.id : null;
}

/**
 * The review that currently authorises a kind, with the moment it was resolved, so a
 * caller can tell whether the approval predates a later estimate. Same rule as
 * approvalStatus (server/review/approvals.mjs): only the newest resolved review
 * counts, so a rejection or a request for changes after an approval takes it back,
 * and an approval whose bound artifacts have moved on no longer holds.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {{id: string, resolved_at: string|null}|null}
 */
export function approvedReview(db, campaignId, kind) {
  const status = approvalStatus(db, campaignId, kind);
  if (!status.approved || !status.review_id) return null;
  const row = db.prepare('SELECT resolved_at FROM reviews WHERE id = ?').get(status.review_id);
  return { id: status.review_id, resolved_at: row?.resolved_at ? String(row.resolved_at) : null };
}

/**
 * @param {any} db
 * @param {string} campaignId
 * @returns {{id: string, version: number, json: any}|null}
 */
function readRow(db, campaignId) {
  // The manifest has a kind of its own, so the newest row under it is the
  // working manifest. An invalidated newest row makes the manifest unavailable
  // until a new one is written, rather than resurrecting an older plan.
  const row = currentArtifact(db, campaignId, MANIFEST_KIND);
  const json = row?.json ?? null;
  if (json && Array.isArray(/** @type {any} */ (json).items)) {
    return { id: row.id, version: row.version, json };
  }
  return null;
}

/**
 * The highest version stored under the manifest kind, so a new manifest always
 * lands on top of the previous one.
 * @param {any} db
 * @param {string} campaignId
 * @returns {number}
 */
function latestVersion(db, campaignId) {
  return Number(
    db.prepare('SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = ?').get(campaignId, MANIFEST_KIND)
      ?.version ?? 0,
  );
}

/**
 * Read the campaign's manifest, or null when generation has not been planned yet.
 * @param {any} db
 * @param {string} campaignId
 * @returns {any|null}
 */
export function readManifest(db, campaignId) {
  const row = readRow(db, campaignId);
  return row ? row.json : null;
}

/**
 * Read the manifest or refuse with a sentence the user can act on.
 * @param {any} db
 * @param {string} campaignId
 * @returns {any}
 */
export function requireManifest(db, campaignId) {
  const manifest = readManifest(db, campaignId);
  if (!manifest) {
    throw new InvalidInputError('There is no media plan for this job yet.', {
      fix: 'Save the media plan first, then estimate the cost.',
    });
  }
  return manifest;
}

/**
 * Store a new version of the manifest.
 * @param {any} db
 * @param {string} campaignId
 * @param {any} manifest
 * @returns {{id: string, version: number, manifest: any}}
 */
export function saveManifest(db, campaignId, manifest) {
  const version = latestVersion(db, campaignId) + 1;
  const id = newId();
  const next = { ...manifest, campaign_id: campaignId, updated_at: nowIso() };
  db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    campaignId,
    MANIFEST_KIND,
    null,
    toJsonColumn(next),
    version,
    nowIso(),
  );
  return { id, version, manifest: next };
}

/**
 * Build the first manifest for a campaign from its media plan. Existing items keep
 * their state when the plan is saved again, so re-planning never erases work that
 * has already been paid for.
 * @param {any} db
 * @param {string} campaignId
 * @param {{items?: any[]}} mediaPlan
 * @returns {{manifest: any, version: number}}
 */
export function createManifest(db, campaignId, mediaPlan) {
  const previous = readManifest(db, campaignId);
  const previousItems = new Map(
    (Array.isArray(previous?.items) ? previous.items : []).map((item) => [String(item.id), item]),
  );

  const items = (Array.isArray(mediaPlan.items) ? mediaPlan.items : []).map((planItem) => {
    const kept = previousItems.get(String(planItem.id));
    return {
      id: String(planItem.id),
      kind: String(planItem.kind),
      count: Number(planItem.count) || 1,
      label: planItem.label ?? null,
      prompt: planItem.prompt ?? kept?.prompt ?? null,
      status: kept?.status ?? 'planned',
      provider_job_id: kept?.provider_job_id ?? null,
      asset_id: kept?.asset_id ?? null,
      asset_path: kept?.asset_path ?? null,
      cost_approval_id: kept?.cost_approval_id ?? null,
      regenerations: Number(kept?.regenerations ?? 0),
      note: kept?.note ?? null,
      updated_at: kept?.updated_at ?? nowIso(),
    };
  });

  const manifest = {
    schema_version: 1,
    campaign_id: campaignId,
    cost_approval_id: previous?.cost_approval_id ?? null,
    media_plan: mediaPlan,
    cost_estimate: previous?.cost_estimate ?? null,
    estimate: previous?.estimate ?? null,
    items,
    assets: Array.isArray(previous?.assets) ? previous.assets : [],
    failures: Array.isArray(previous?.failures) ? previous.failures : [],
    summary: summarize(items),
  };
  const saved = saveManifest(db, campaignId, manifest);
  return { manifest: saved.manifest, version: saved.version };
}

/**
 * Record the estimate that was shown at the cost gate.
 * @param {any} db
 * @param {string} campaignId
 * @param {any} estimate
 * @returns {any} the stored manifest
 */
export function recordEstimate(db, campaignId, estimate) {
  const manifest = requireManifest(db, campaignId);
  return saveManifest(db, campaignId, {
    ...manifest,
    cost_estimate: estimate,
    estimate: { credits: estimate.total_credits ?? null, currency: null, amount: null, quoted_at: nowIso() },
  }).manifest;
}

/**
 * @param {any} manifest
 * @param {string} itemId
 * @returns {any}
 */
export function requireItem(manifest, itemId) {
  const item = (Array.isArray(manifest.items) ? manifest.items : []).find((entry) => String(entry.id) === itemId);
  if (!item) {
    throw new InvalidInputError(`The plan for this job has nothing called "${itemId}" in it.`, {
      fix: 'Check the media plan and use one of the ids it lists.',
    });
  }
  return item;
}

/**
 * The stored cost estimate line for one item, keyed the same way `estimate.mjs`
 * labels its output.
 * @param {any} manifest
 * @param {string} itemId
 * @returns {any|null}
 */
function estimateLineFor(manifest, itemId) {
  const items = Array.isArray(manifest?.cost_estimate?.items) ? manifest.cost_estimate.items : [];
  return items.find((entry) => String(entry.item_id) === String(itemId)) ?? null;
}

/**
 * Move one item into `generating`. The only door into paid work, and the cost gate's
 * enforcement point: everything the spec asks for lives in this one function so
 * nothing else in the codebase can start paid work by a side door.
 *
 * `request` must be the exact generation request the caller is about to submit to
 * the provider (tool, model, prompt, reference asset ids, duration, resolution,
 * ratio, audio flag, count). Its hash must match the request that was priced at the
 * cost gate; a changed prompt or a different reference asset changes the hash and is
 * refused here, not discovered after the credits are gone.
 *
 * @param {object} options
 * @param {any} options.db
 * @param {string} options.campaign_id
 * @param {string} options.item_id
 * @param {Record<string, unknown>} options.request the exact request about to be submitted.
 * @param {string} [options.provider_job_id]
 * @returns {{manifest: any, item: any, cost_approval_id: string, idempotency_key: string}}
 */
export function beginItem({ db, campaign_id: campaignId, item_id: itemId, request, provider_job_id: providerJobId }) {
  const manifest = requireManifest(db, campaignId);
  const item = requireItem(manifest, itemId);

  const approval = approvedReview(db, campaignId, 'cost');
  if (!approval) {
    throw new UserFacingError(NEEDS_COST_APPROVAL_MESSAGE, {
      code: 'needs_cost_approval',
      fix: 'Open the cost approval and choose Approve, then I can start.',
    });
  }
  if (item.status === 'generating') {
    throw new InvalidInputError('That item is already being made.', { fix: 'Wait for it to finish before starting it again.' });
  }
  if (item.status === 'outcome_unknown') {
    throw new UserFacingError(
      'The last submission for this item ended without a known result, so I will not try again on my own.',
      {
        code: 'outcome_unknown',
        fix: 'Decide what to do with it at media review, or open a fresh cost approval to try again.',
      },
    );
  }

  // Stale approval: the estimate that was quoted has moved on since this approval was
  // granted (media_plan_save or cost_estimate ran again after the gate closed).
  const estimatedAt = manifest?.estimate?.quoted_at ?? null;
  if (estimatedAt && approval.resolved_at && approval.resolved_at < estimatedAt) {
    throw new UserFacingError('The cost approval on file is older than the latest estimate for this job.', {
      code: 'stale_approval',
      fix: 'Run cost_estimate again and get a fresh approval before starting this item.',
    });
  }

  // Hash binding: the exact request about to be submitted has to be the one that was
  // priced and approved. This does not apply to an item already cleared by
  // generation_regenerate: that call is itself the authorization for a changed
  // prompt, paid for out of the approved estimate's regeneration_headroom rather
  // than by matching a priced line item, so re-litigating its hash here would make
  // the headroom mechanism pointless.
  const requestKind = (item.kind === 'image' || item.kind === 'video') && item.status !== 'regenerate';
  if (requestKind) {
    const line = estimateLineFor(manifest, itemId);
    if (!line || !line.request_hash) {
      throw new UserFacingError('This item has not been priced yet.', {
        code: 'request_changed',
        fix: 'Run cost_estimate and get it approved before starting this item.',
      });
    }
    const actualHash = requestHash(/** @type {any} */ (request) ?? {});
    if (actualHash !== line.request_hash) {
      throw new UserFacingError(
        'What you are about to submit does not match what was priced and approved for this item.',
        {
          code: 'request_changed',
          fix: 'Re-estimate the cost with the new request and get it approved again before submitting.',
        },
      );
    }

    // Spend cap: the running reserved-plus-spent total, plus this item, must stay
    // inside the approved total.
    const ledger = ledgerFor(manifest);
    const thisCredits = Number(line.credits) || 0;
    if (ledger.approved > 0 && ledger.reserved + ledger.spent + thisCredits > ledger.approved) {
      throw new UserFacingError('Starting this item would spend more than the approved amount for this job.', {
        code: 'spend_cap_exceeded',
        fix: 'Reduce the plan or get a new cost approval that covers the extra spend, then try again.',
      });
    }
  }

  // Hero-first: in a multi-clip video batch, only the hero item may begin until it
  // has been generated and reviewed.
  const hero = heroFirstCheck(manifest, item);
  if (hero.blocked) {
    throw new UserFacingError(hero.reason ?? 'Generate the hero clip first.', {
      code: 'hero_first_required',
      fix: 'Generate and review the hero item, then start the rest of the batch.',
      details: { hero_item_id: hero.hero_item_id },
    });
  }

  const attempt = Number(item.regenerations ?? 0) + 1;
  const key = idempotencyKey(campaignId, itemId, attempt);
  const prompt = typeof (/** @type {any} */ (request)?.prompt) === 'string' ? String(/** @type {any} */ (request).prompt).trim() : '';

  const updated = {
    ...item,
    status: 'generating',
    prompt: prompt || item.prompt,
    provider_job_id: providerJobId ?? item.provider_job_id ?? null,
    cost_approval_id: approval.id,
    idempotency_key: key,
    request_hash: requestKind ? requestHash(/** @type {any} */ (request) ?? {}) : null,
    updated_at: nowIso(),
  };
  const next = replaceItem(manifest, updated, { cost_approval_id: approval.id });
  return {
    manifest: saveManifest(db, campaignId, next).manifest,
    item: updated,
    cost_approval_id: approval.id,
    idempotency_key: key,
  };
}

/**
 * Mark an item's submission outcome as unknown: the call to the provider timed out,
 * crashed, or otherwise left nobody sure whether it went through. Never auto-retried;
 * `beginItem` refuses this item until a human clears it at media review or a fresh
 * cost approval is granted.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} itemId
 * @param {string|null} [detail]
 * @returns {{manifest: any, item: any}}
 */
export function markOutcomeUnknown(db, campaignId, itemId, detail = null) {
  const manifest = requireManifest(db, campaignId);
  const item = requireItem(manifest, itemId);
  const updated = { ...item, status: 'outcome_unknown', note: detail ?? item.note ?? null, updated_at: nowIso() };
  const next = replaceItem(manifest, updated);
  return { manifest: saveManifest(db, campaignId, next).manifest, item: updated };
}

/**
 * Record what came back from the provider.
 * @param {object} options
 * @param {any} options.db
 * @param {string} options.campaign_id
 * @param {string} options.item_id
 * @param {string} options.asset_id
 * @param {string} options.path
 * @param {string} options.kind image, video or audio
 * @param {string} [options.provider]
 * @param {number|null} [options.duration_s]
 * @param {string|null} [options.aspect_ratio]
 * @param {string} [options.idempotency_key] the key `generation_begin` handed out for this attempt.
 * @param {{expected: boolean, observed: boolean}|null} [options.audio_check] the import time audio probe result, when this item is a video.
 * @returns {{manifest: any, item: any, audio_mismatch: {expected: boolean, observed: boolean, warning: string}|null}}
 */
export function completeItem(options) {
  const { db, campaign_id: campaignId, item_id: itemId } = options;
  const manifest = requireManifest(db, campaignId);
  const item = requireItem(manifest, itemId);

  if (options.idempotency_key && item.idempotency_key && options.idempotency_key !== item.idempotency_key) {
    throw new InvalidInputError('That idempotency key does not match the one this item was started with.', {
      fix: 'Pass the idempotency_key generation_begin returned for this attempt.',
    });
  }

  let audioMismatch = null;
  if (options.audio_check) {
    const { expected, observed } = options.audio_check;
    if (expected !== observed) {
      audioMismatch = {
        expected,
        observed,
        warning: `This clip was requested with generate_audio=${expected}, but the imported file ${observed ? 'has' : 'has no'} an audio track.`,
      };
    }
  }

  const updated = {
    ...item,
    status: 'generated',
    asset_id: options.asset_id,
    asset_path: options.path,
    audio_mismatch: audioMismatch,
    updated_at: nowIso(),
  };
  const asset = {
    asset_id: options.asset_id,
    kind: options.kind,
    path: options.path,
    provider: options.provider ?? (item.kind === 'voice' || item.kind === 'audio' ? 'elevenlabs' : '3echo_studio'),
    provider_ref: item.provider_job_id ?? null,
    prompt: updated.prompt ?? null,
    panel_id: item.id,
    duration_s: options.duration_s ?? null,
    aspect_ratio: options.aspect_ratio ?? null,
    audio_mismatch: audioMismatch,
    review_state: 'pending',
  };
  const next = replaceItem(manifest, updated);
  next.assets = [...(Array.isArray(next.assets) ? next.assets : []).filter((entry) => entry.panel_id !== item.id), asset];
  return { manifest: saveManifest(db, campaignId, next).manifest, item: updated, audio_mismatch: audioMismatch };
}

/**
 * Mark an item for another attempt. Regeneration is paid work too: it is allowed
 * only while the approved estimate still has headroom for it.
 * @param {object} options
 * @param {any} options.db
 * @param {string} options.campaign_id
 * @param {string} options.item_id
 * @param {string} [options.new_prompt]
 * @returns {{manifest: any, item: any, headroom_left: number}|{needs_cost_approval: true, reason: string}}
 */
export function markRegenerate({ db, campaign_id: campaignId, item_id: itemId, new_prompt: newPrompt }) {
  const manifest = requireManifest(db, campaignId);
  const item = requireItem(manifest, itemId);
  const allowance = headroomFor(manifest, item.kind);
  const used = countRegenerations(manifest, item.kind);
  if (used >= allowance) {
    return {
      needs_cost_approval: true,
      reason:
        'Making this again costs more than the amount you approved, so I need a new cost approval before I try.',
    };
  }
  const updated = {
    ...item,
    status: 'regenerate',
    prompt: typeof newPrompt === 'string' && newPrompt.trim() ? newPrompt.trim() : item.prompt,
    provider_job_id: null,
    regenerations: Number(item.regenerations ?? 0) + 1,
    updated_at: nowIso(),
  };
  const next = replaceItem(manifest, updated);
  next.assets = (Array.isArray(next.assets) ? next.assets : []).map((entry) =>
    entry.panel_id === item.id ? { ...entry, review_state: 'regenerate' } : entry,
  );
  return {
    manifest: saveManifest(db, campaignId, next).manifest,
    item: updated,
    headroom_left: allowance - used - 1,
  };
}

/**
 * Record a review decision against one item.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} itemId
 * @param {'approved'|'rejected'} state
 * @returns {{manifest: any, item: any}}
 */
export function setReviewState(db, campaignId, itemId, state) {
  const manifest = requireManifest(db, campaignId);
  const item = requireItem(manifest, itemId);
  const updated = { ...item, status: state, updated_at: nowIso() };
  const next = replaceItem(manifest, updated);
  next.assets = (Array.isArray(next.assets) ? next.assets : []).map((entry) =>
    entry.panel_id === item.id ? { ...entry, review_state: state === 'approved' ? 'approved' : 'rejected' } : entry,
  );
  return { manifest: saveManifest(db, campaignId, next).manifest, item: updated };
}

/**
 * Carry a media review decision onto the generation record, so the item a person
 * approved or rejected at the media gate is approved or rejected here too. Without
 * this, a hero clip approved at review stayed "generated" and the rest of its batch
 * could never begin, and the package kept showing every asset as pending.
 *
 * `approve` and `reject` name one asset by `asset_id` (what the board sends) or one
 * item by `item_id`; `approve_all` approves every item that has been made. Regenerate
 * and edit prompt change nothing here: generation_regenerate owns that, inside the
 * approved headroom. A decision on media that is not in the plan changes nothing.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} action
 * @param {Record<string, unknown>|null|undefined} payload
 * @returns {string[]} the ids of the items whose state changed.
 */
export function applyMediaDecision(db, campaignId, action, payload) {
  const manifest = readManifest(db, campaignId);
  if (!manifest) return [];
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  /** @type {Array<[string, 'approved'|'rejected']>} */
  const changes = [];
  if (action === 'approve_all') {
    for (const item of items) if (item.status === 'generated') changes.push([String(item.id), 'approved']);
  } else if (action === 'approve' || action === 'reject') {
    const assetId = typeof payload?.asset_id === 'string' ? payload.asset_id : null;
    const itemId = typeof payload?.item_id === 'string' ? payload.item_id : null;
    const item = items.find((entry) => (itemId && String(entry.id) === itemId) || (assetId && entry.asset_id === assetId));
    const decidable = action === 'approve' ? ['generated'] : ['generated', 'approved', 'outcome_unknown'];
    if (item && decidable.includes(item.status)) changes.push([String(item.id), action === 'approve' ? 'approved' : 'rejected']);
  }
  for (const [id, state] of changes) setReviewState(db, campaignId, id, state);
  return changes.map(([id]) => id);
}

/**
 * Add a generated file that did not come from a plan item, such as a platform
 * export or a burned in subtitle render.
 * @param {any} db
 * @param {string} campaignId
 * @param {any} asset
 * @returns {any} the stored manifest
 */
export function attachDerivedAsset(db, campaignId, asset) {
  const manifest = requireManifest(db, campaignId);
  const assets = [...(Array.isArray(manifest.assets) ? manifest.assets : []), { review_state: 'pending', ...asset }];
  return saveManifest(db, campaignId, { ...manifest, assets }).manifest;
}

/**
 * How many extra attempts the approved estimate paid for, per kind.
 * @param {any} manifest
 * @param {string} kind
 * @returns {number}
 */
export function headroomFor(manifest, kind) {
  const headroom = manifest?.cost_estimate?.regeneration_headroom;
  if (!headroom) return 0;
  if (kind === 'image') return Number(headroom.images) || 0;
  if (kind === 'video') return Number(headroom.videos) || 0;
  // Voice, audio and subtitles are not billed in credits, so retrying them is free.
  return Number.MAX_SAFE_INTEGER;
}

/**
 * @param {any} manifest
 * @param {string} kind
 * @returns {number}
 */
function countRegenerations(manifest, kind) {
  return (Array.isArray(manifest.items) ? manifest.items : [])
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => sum + (Number(item.regenerations) || 0), 0);
}

/**
 * @param {any} manifest
 * @param {any} item
 * @param {Record<string, unknown>} [patch]
 * @returns {any}
 */
function replaceItem(manifest, item, patch = {}) {
  const items = (Array.isArray(manifest.items) ? manifest.items : []).map((entry) =>
    String(entry.id) === String(item.id) ? item : entry,
  );
  return { ...manifest, ...patch, items, summary: summarize(items) };
}

/**
 * One plain sentence about where generation has got to.
 * @param {any[]} items
 * @returns {string}
 */
export function summarize(items) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const order = ITEM_STATES.filter((state) => counts[state]);
  if (order.length === 0) return 'Nothing is planned yet.';
  const words = {
    planned: 'still to make',
    generating: 'being made',
    generated: 'made',
    approved: 'approved',
    rejected: 'rejected',
    regenerate: 'to be made again',
    outcome_unknown: 'waiting on a human decision after an unclear result',
  };
  return order.map((state) => `${counts[state]} ${words[state]}`).join(', ') + '.';
}

/**
 * Project the manifest onto the GeneratedMediaPackage contract, which is what
 * the media approval is shown and what artifact_save will accept.
 * @param {any} manifest
 * @returns {any}
 */
export function toPackage(manifest) {
  return {
    schema_version: 1,
    campaign_id: manifest.campaign_id ?? null,
    cost_approval_id: manifest.cost_approval_id ?? '',
    estimate: manifest.estimate ?? null,
    assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    failures: Array.isArray(manifest.failures) ? manifest.failures : [],
    summary: manifest.summary ?? '',
  };
}

export { ledgerFor, paidGenerationSummary } from './cost-gate.mjs';
