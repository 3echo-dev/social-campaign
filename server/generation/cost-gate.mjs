/**
 * The stricter cost gate: request hashing, idempotency keys, hero-first gating and
 * the per-campaign spend ledger.
 *
 * Ported from proven logic, not proven code (no npm dependency, no import of the
 * sibling repos):
 *   - Canonical request hash and hash-bound authorization:
 *     the 3echo harness prototype's src/lib/studio-adapter.ts,
 *     `requestHash` (used at authorizeProductions, lines ~219-247) and
 *     `authorizeProductions` (lines ~219-247), which recomputes a combined hash of the
 *     quoted request set and refuses authorization when it does not match what the
 *     caller thinks it is approving.
 *   - Idempotency key persisted before submission, and "outcome unknown" on a failed
 *     or crashed submit instead of a silent retry:
 *     same file, `submitProductions`, lines ~257-302.
 *   - Hero-first batching and the plain-language refusal vocabulary:
 *     the social-media-pipeline project's hooks/lib.mjs,
 *     `heroBlocks` (lines 1192-1203) and `DENY.heroFirst` (line ~98).
 *   - The canonical per-field hash used to bind an approval to an exact request:
 *     same file, `argsHash` (lines ~250-265), which hashes a fixed, ordered field list
 *     so that changing any priced field of a request changes its hash.
 *
 * Everything below is our own zero-dependency Node implementation of those ideas; no
 * code was copied from either sibling file.
 */

import { createHash } from 'node:crypto';

/**
 * The fields that make one generation request a different request, in a fixed order.
 * Anything not in this list (a display label, a note) may change without invalidating
 * an approval; anything in this list changes what the provider is asked to make or
 * what it costs, so changing it must send the item back through cost_estimate and
 * the cost approval. Mirrors studio-adapter.ts's request shape and lib.mjs's QUOTED_FIELDS.
 */
export const REQUEST_FIELDS = [
  'tool',
  'provider',
  'model',
  'prompt',
  'reference_asset_ids',
  'duration_s',
  'resolution',
  'ratio',
  'generate_audio',
  'count',
];

/** The provider each generation tool belongs to, so a request need not repeat it. */
const TOOL_PROVIDER = { create_image_job: '3echo_studio', create_video_job: '3echo_studio' };

/**
 * What an optional request field means when the caller leaves it out. The documented
 * request shape (`{ tool, model?, prompt, reference_asset_ids?, duration_s?,
 * resolution?, ratio?, generate_audio?, count? }`) lets a caller omit these, and the
 * estimate fills the same defaults in, so leaving one out must hash exactly like
 * sending its default: no references, no audio, one of it, and the tool's provider.
 * @param {string} field
 * @param {Record<string, unknown>} request
 * @returns {unknown}
 */
function defaultFor(field, request) {
  if (field === 'reference_asset_ids') return [];
  if (field === 'generate_audio') return false;
  if (field === 'count') return 1;
  if (field === 'provider') return TOOL_PROVIDER[/** @type {keyof typeof TOOL_PROVIDER} */ (String(request.tool ?? ''))] ?? null;
  return null;
}

/**
 * Normalize one field's value so that equivalent requests hash the same way:
 * an absent field, an empty string and an explicit null are all "not set", and an
 * array of reference ids is sorted so order never matters.
 * @param {string} field
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeField(field, value) {
  if (value === undefined || value === null) return null;
  if (field === 'reference_asset_ids') {
    const ids = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
    return [...ids].sort();
  }
  if (field === 'generate_audio') return Boolean(value);
  if (field === 'duration_s' || field === 'count') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}

/**
 * A canonical, stable hash of the exact generation request an item is about to submit:
 * provider tool, model, prompt, reference asset ids, duration, resolution, ratio,
 * audio flag and count. Two requests that would cost and produce the same thing hash
 * the same way regardless of key order or incidental whitespace; anything priced that
 * changes changes the hash.
 * @param {Record<string, unknown>} request
 * @returns {string} a 64 character hex sha256 digest
 */
export function requestHash(request) {
  const source = request && typeof request === 'object' ? request : {};
  const canonical = REQUEST_FIELDS.map((field) => {
    const given = source[field] === undefined || source[field] === null ? defaultFor(field, source) : source[field];
    return `${field}=${JSON.stringify(normalizeField(field, given))}`;
  }).join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The idempotency key an item must carry into its 3echo submission, persisted before
 * the agent makes the call so a retry of `generation_begin` itself never mints a
 * second key for the same attempt. Shape: `<campaign>/<item>/<attempt>`, one higher
 * numbered attempt per regeneration. Mirrors lib.mjs's `<job>/<D>/<panel>` key shape.
 * @param {string} campaignId
 * @param {string} itemId
 * @param {number} attempt 1 for the first submission, 2 for the first regeneration, and so on.
 * @returns {string}
 */
export function idempotencyKey(campaignId, itemId, attempt) {
  const safeAttempt = Number.isFinite(Number(attempt)) && Number(attempt) > 0 ? Math.floor(Number(attempt)) : 1;
  return `${campaignId}/${itemId}/${safeAttempt}`;
}

/**
 * The credits an item's estimate line reserves, for the spend ledger. Items still
 * needing a quote or billed outside of credits (voice, audio, subtitle, local edits)
 * reserve nothing.
 * @param {any} estimateItem
 * @returns {number}
 */
function creditsOf(estimateItem) {
  if (!estimateItem || estimateItem.needs_quote) return 0;
  const credits = Number(estimateItem.credits);
  return Number.isFinite(credits) && credits > 0 ? credits : 0;
}

/**
 * How many paid attempts an item has used and how many are in flight. Every
 * generation_complete is a paid attempt, whatever the person then decides: a clip
 * rejected at media review was still made and paid for, and an item sent back for a
 * redo keeps the attempts it already used. An attempt whose outcome is unknown stays
 * in flight until a person clears it, and one they reject is counted as spent,
 * because nobody can say it was not charged.
 * @param {any} item
 * @returns {{finished: number, inFlight: number}}
 */
function attemptsOf(item) {
  const redos = Math.max(0, Math.floor(Number(item?.regenerations) || 0));
  switch (item?.status) {
    case 'generated':
    case 'approved':
    case 'rejected':
      return { finished: redos + 1, inFlight: 0 };
    case 'generating':
    case 'outcome_unknown':
      return { finished: redos, inFlight: 1 };
    case 'regenerate':
      return { finished: redos, inFlight: 0 };
    default:
      return { finished: 0, inFlight: 0 };
  }
}

/**
 * The per campaign spend ledger: what was approved at the cost gate, what is
 * currently reserved by in-flight or unresolved items, and what has actually landed.
 * Read only; the manifest's items and cost_estimate remain the source of truth.
 * @param {any} manifest
 * @returns {{approved: number, reserved: number, spent: number, available: number}}
 */
export function ledgerFor(manifest) {
  const estimateItems = Array.isArray(manifest?.cost_estimate?.items) ? manifest.cost_estimate.items : [];
  const byId = new Map(estimateItems.map((entry) => [String(entry.item_id), entry]));
  const approved = Number(manifest?.cost_estimate?.total_credits);
  const items = Array.isArray(manifest?.items) ? manifest.items : [];

  let reserved = 0;
  let spent = 0;
  for (const item of items) {
    const credits = creditsOf(byId.get(String(item.id)));
    const { finished, inFlight } = attemptsOf(item);
    spent += credits * finished;
    reserved += credits * inFlight;
  }
  const total = Number.isFinite(approved) ? approved : 0;
  return { approved: total, reserved, spent, available: Math.max(0, total - reserved - spent) };
}

/**
 * What this job cost, for the final review and publish screens: the approved
 * total, what actually landed, what is left unused, and the paid items that were
 * actually generated (label and credits), so a person sees the same numbers the
 * cost gate enforced rather than a separate estimate. Returns null when the job
 * never had any paid generation - no cost estimate on file, or nothing ever
 * reached a finished attempt - so the caller can show a plain "no credits spent"
 * note instead of an empty breakdown.
 * @param {any} manifest
 * @returns {{approved: number, spent: number, unused: number, items: Array<{label: string, credits: number}>}|null}
 */
export function paidGenerationSummary(manifest) {
  const estimateItems = Array.isArray(manifest?.cost_estimate?.items) ? manifest.cost_estimate.items : [];
  if (estimateItems.length === 0) return null;
  const byId = new Map(estimateItems.map((entry) => [String(entry.item_id), entry]));
  const items = Array.isArray(manifest?.items) ? manifest.items : [];

  const paid = [];
  for (const item of items) {
    const line = byId.get(String(item.id));
    const perAttempt = creditsOf(line);
    if (perAttempt <= 0) continue;
    const { finished } = attemptsOf(item);
    if (finished <= 0) continue;
    paid.push({ label: String(line?.label ?? item.label ?? item.id), credits: perAttempt * finished });
  }

  const ledger = ledgerFor(manifest);
  if (paid.length === 0 && ledger.spent <= 0) return null;
  return { approved: ledger.approved, spent: ledger.spent, unused: ledger.available, items: paid };
}

/**
 * Whether beginning `itemId` is blocked by the hero-first rule: for a video batch
 * where the media plan asked for it, the first item must be generated and approved
 * (or rejected, which ends its hero hold the same way a decision does) before any
 * other item in that batch may begin. Configurable per media plan through
 * `media_plan.hero_first` (defaults to on for any batch of two or more video items).
 * Mirrors lib.mjs's `heroBlocks` and its DENY.heroFirst message.
 * @param {any} manifest
 * @param {any} item the item about to begin
 * @returns {{blocked: boolean, hero_item_id: string|null, reason: string|null}}
 */
export function heroFirstCheck(manifest, item) {
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const videoItems = items.filter((entry) => entry.kind === 'video');
  const plan = manifest?.media_plan ?? {};
  const heroFirst = plan.hero_first !== false && videoItems.length > 1;
  if (!heroFirst || item.kind !== 'video') return { blocked: false, hero_item_id: null, reason: null };

  const declaredHeroId = typeof plan.hero_item_id === 'string' ? plan.hero_item_id : null;
  const hero = declaredHeroId ? videoItems.find((entry) => String(entry.id) === declaredHeroId) : videoItems[0];
  if (!hero || String(hero.id) === String(item.id)) return { blocked: false, hero_item_id: hero ? String(hero.id) : null, reason: null };

  const heroSettled = hero.status === 'approved' || hero.status === 'rejected';
  if (heroSettled) return { blocked: false, hero_item_id: String(hero.id), reason: null };
  return {
    blocked: true,
    hero_item_id: String(hero.id),
    reason: 'Generate the hero clip first, wait for it to finish, and look at it before the rest of this batch starts.',
  };
}
