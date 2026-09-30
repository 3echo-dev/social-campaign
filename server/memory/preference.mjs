/**
 * Preference memory, spec section 17.
 *
 * An explicit signal is written to preference_evidence and promoted to preferences
 * immediately. A single inferred signal is campaign evidence only. Repeated
 * consistent inferred signals across at least two campaigns raise confidence and
 * eventually promote. A one_off signal never promotes: it stays scoped to its
 * campaign unless the user says it is a general preference (which arrives as an
 * explicit signal, not as a change to a one_off row).
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { InvalidInputError } from '../lib/errors.mjs';

/** How many consistent inferred observations are needed before promotion. */
export const INFERRED_PROMOTION_COUNT = 3;
/** How many distinct campaigns those observations must span. */
export const INFERRED_PROMOTION_CAMPAIGNS = 2;

const KINDS = ['explicit', 'inferred', 'one_off'];

/**
 * Confidence grows with the number of consistent observations, capped below 1 so an
 * inferred preference never reads as more certain than an explicit one.
 * @param {number} count
 * @returns {number}
 */
export function inferredConfidence(count) {
  return Math.min(0.5 + 0.1 * count, 0.95);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{kind: string, signal: string, value: string, campaign_id?: string, brand_id?: string, confidence?: number, note?: string}} input
 * @returns {{evidence: Record<string, any>, promoted: Record<string, any>|null}}
 */
export function recordEvidence(db, input) {
  const kind = String(input.kind ?? '');
  if (!KINDS.includes(kind)) {
    throw new InvalidInputError(`Preference kind must be one of ${KINDS.join(', ')}.`);
  }
  const signal = String(input.signal ?? '').trim();
  const value = String(input.value ?? '').trim();
  if (!signal || !value) throw new InvalidInputError('Preference evidence needs a signal and a value.');
  const campaignId = input.campaign_id ? String(input.campaign_id) : null;
  const confidence = typeof input.confidence === 'number' ? input.confidence : kind === 'explicit' ? 0.9 : 0.3;

  const id = newId();
  db.prepare(
    'INSERT INTO preference_evidence (id, kind, signal, value, campaign_id, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, kind, signal, value, campaignId, confidence, nowIso());
  const evidence = { id, kind, signal, value, campaign_id: campaignId, confidence, note: input.note ?? null };

  if (kind === 'explicit') {
    return { evidence, promoted: promote(db, signal, value, 'explicit', confidence, 1) };
  }
  if (kind === 'one_off') {
    return { evidence, promoted: null };
  }

  // inferred: count consistent observations for this exact (signal, value) pair.
  const rows = db
    .prepare("SELECT campaign_id, COUNT(*) AS c FROM preference_evidence WHERE kind = 'inferred' AND signal = ? AND value = ? GROUP BY campaign_id")
    .all(signal, value);
  const total = rows.reduce((sum, row) => sum + Number(row.c), 0);
  const distinctCampaigns = rows.filter((row) => row.campaign_id != null).length;
  if (total >= INFERRED_PROMOTION_COUNT && distinctCampaigns >= INFERRED_PROMOTION_CAMPAIGNS) {
    return { evidence, promoted: promote(db, signal, value, 'inferred', inferredConfidence(total), total) };
  }
  return { evidence, promoted: null };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} signal
 * @param {string} value
 * @param {'explicit'|'inferred'} sourceKind
 * @param {number} confidence
 * @param {number} evidenceCount
 * @returns {Record<string, any>}
 */
function promote(db, signal, value, sourceKind, confidence, evidenceCount) {
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM preferences WHERE signal = ?').get(signal);
  if (existing) {
    db.prepare(
      'UPDATE preferences SET value = ?, source_kind = ?, confidence = ?, evidence_count = ?, updated_at = ? WHERE signal = ?',
    ).run(value, sourceKind, confidence, evidenceCount, now, signal);
  } else {
    db.prepare(
      'INSERT INTO preferences (id, signal, value, source_kind, confidence, evidence_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), signal, value, sourceKind, confidence, evidenceCount, now, now);
  }
  return db.prepare('SELECT * FROM preferences WHERE signal = ?').get(signal);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id?: string, campaign_id?: string}} [input]
 * @returns {{preferences: Record<string, any>[], evidence: Record<string, any>[]}}
 */
export function getPreferences(db, input = {}) {
  const preferences = db.prepare('SELECT * FROM preferences ORDER BY signal ASC').all();
  const evidence = input.campaign_id
    ? db.prepare('SELECT * FROM preference_evidence WHERE campaign_id = ? ORDER BY created_at DESC').all(input.campaign_id)
    : db.prepare('SELECT * FROM preference_evidence ORDER BY created_at DESC LIMIT 200').all();
  return { preferences, evidence };
}
