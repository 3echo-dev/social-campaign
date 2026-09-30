/**
 * Provenance and precedence for brand_fields.
 *
 * A brand fact is a row, not a key in a document. The live value for a field path is
 * the row with no superseded_by and the lowest precedence_rank, with the most recent
 * observed_at breaking a tie (docs/CONTRACTS.md section 7).
 *
 * A write only replaces the live row when its precedence rank is equal or better
 * (a lower number wins) or the live row has gone stale. A lower precedence write is
 * never dropped: it is handed back to the caller so it can be queued as a proposal.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';

/** Suggested ranks from docs/CONTRACTS.md, lower wins. */
export const PRECEDENCE_RANK = {
  user_correction: 10,
  user_brand_guide: 20,
  official_source: 30,
  verified_research: 40,
  model_inference: 60,
};

export const SOURCE_TYPES = Object.keys(PRECEDENCE_RANK);

/** How long a value stays fresh before a lower precedence write may replace it. */
export const DEFAULT_TTL_DAYS = 90;

/**
 * @param {string} sourceType
 * @returns {number}
 */
export function rankOf(sourceType) {
  const rank = PRECEDENCE_RANK[sourceType];
  if (rank === undefined) {
    throw new InvalidInputError(
      `"${sourceType}" is not a known provenance source. Use one of ${SOURCE_TYPES.join(', ')}.`,
    );
  }
  return rank;
}

/**
 * @param {string|null|undefined} lastVerifiedAt
 * @param {number} [ttlDays]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isStale(lastVerifiedAt, ttlDays = DEFAULT_TTL_DAYS, now = new Date()) {
  if (!lastVerifiedAt) return true;
  const verified = new Date(lastVerifiedAt).getTime();
  if (Number.isNaN(verified)) return true;
  const ageMs = now.getTime() - verified;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @param {string} fieldPath
 * @returns {Record<string, any>|null}
 */
export function getLiveField(db, brandId, fieldPath) {
  const row = db
    .prepare(
      `SELECT * FROM brand_fields
       WHERE brand_id = ? AND field_path = ? AND superseded_by IS NULL
       ORDER BY precedence_rank ASC, observed_at DESC
       LIMIT 1`,
    )
    .get(brandId, fieldPath);
  return row ? hydrateField(row) : null;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @returns {Record<string, any>[]}
 */
export function listLiveFields(db, brandId) {
  const rows = db
    .prepare(
      `SELECT bf.* FROM brand_fields bf
       INNER JOIN (
         SELECT field_path, MIN(precedence_rank) AS best_rank
         FROM brand_fields
         WHERE brand_id = ? AND superseded_by IS NULL
         GROUP BY field_path
       ) top ON top.field_path = bf.field_path AND top.best_rank = bf.precedence_rank
       WHERE bf.brand_id = ? AND bf.superseded_by IS NULL
       ORDER BY bf.field_path ASC, bf.observed_at DESC`,
    )
    .all(brandId, brandId);
  /** @type {Map<string, any>} */
  const byPath = new Map();
  for (const row of rows) {
    if (!byPath.has(row.field_path)) byPath.set(row.field_path, hydrateField(row));
  }
  return [...byPath.values()];
}

/**
 * @param {Record<string, any>} row
 * @returns {Record<string, any>}
 */
function hydrateField(row) {
  return { ...row, value: parseJson(row.value_json, null) };
}

/**
 * Insert a fresh live row for a field, superseding whatever was live before.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brandId: string, fieldPath: string, value: unknown, sourceType: string, sourceRef?: string|null, observedAt?: string, confidence?: number, ttlDays?: number}} input
 * @returns {Record<string, any>}
 */
export function replaceField(db, input) {
  const previous = getLiveField(db, input.brandId, input.fieldPath);
  const id = newId();
  const observedAt = input.observedAt ?? nowIso();
  db.prepare(
    `INSERT INTO brand_fields
       (id, brand_id, field_path, value_json, source_type, source_ref, observed_at, last_verified_at, confidence, precedence_rank, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.brandId,
    input.fieldPath,
    toJsonColumn(input.value),
    input.sourceType,
    input.sourceRef ?? null,
    observedAt,
    observedAt,
    input.confidence ?? 0.5,
    rankOf(input.sourceType),
    nowIso(),
  );
  if (previous) {
    db.prepare('UPDATE brand_fields SET superseded_by = ? WHERE id = ?').run(id, previous.id);
  }
  return getLiveField(db, input.brandId, input.fieldPath);
}

/**
 * Apply the precedence rule from docs/CONTRACTS.md section 7 and spec 19: replace the
 * live value only if the new source is equal or higher precedence, or the live value
 * is stale. Otherwise the write is not applied and the caller should queue it.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brandId: string, fieldPath: string, value: unknown, sourceType: string, sourceRef?: string|null, observedAt?: string, confidence?: number, ttlDays?: number}} input
 * @returns {{applied: boolean, field: Record<string, any>|null, reason: string}}
 */
export function writeField(db, input) {
  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
  const existing = getLiveField(db, input.brandId, input.fieldPath);
  if (!existing) {
    return { applied: true, field: replaceField(db, input), reason: 'no existing value' };
  }
  const newRank = rankOf(input.sourceType);
  const stale = isStale(existing.last_verified_at ?? existing.observed_at, ttlDays);
  if (newRank <= existing.precedence_rank || stale) {
    return {
      applied: true,
      field: replaceField(db, input),
      reason: stale ? 'existing value was stale' : 'equal or higher precedence',
    };
  }
  return { applied: false, field: existing, reason: 'lower precedence than the live value' };
}

/**
 * A user correction always wins: it is the highest precedence source there is.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brandId: string, fieldPath: string, value: unknown, sourceRef?: string|null}} input
 * @returns {Record<string, any>}
 */
export function correctField(db, input) {
  return replaceField(db, {
    brandId: input.brandId,
    fieldPath: input.fieldPath,
    value: input.value,
    sourceType: 'user_correction',
    sourceRef: input.sourceRef ?? 'user',
    confidence: 1,
  });
}
