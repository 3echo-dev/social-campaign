/**
 * Creative profile memory: the synthesized brand-level creative intelligence the
 * Creative Director produces. Versioned per brand_id in creative_profiles. The
 * Creative Director proposes; only promoteProposal writes a new canonical version.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @returns {Record<string, any>|null}
 */
export function getCreativeProfile(db, brandId) {
  const row = db
    .prepare('SELECT * FROM creative_profiles WHERE brand_id = ? ORDER BY version DESC LIMIT 1')
    .get(brandId);
  if (!row) return null;
  return { id: row.id, brand_id: row.brand_id, version: row.version, profile: parseJson(row.json, {}), summary: row.summary, created_at: row.created_at };
}

/**
 * Insert the next version of a brand's creative profile. This is the only write path
 * and it is only reachable from promoteProposal, never from a specialist directly.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @param {Record<string, any>} profile
 * @returns {Record<string, any>}
 */
export function saveCreativeProfile(db, brandId, profile) {
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) {
    throw new InvalidInputError(`There is no brand with id "${brandId}".`);
  }
  const current = db.prepare('SELECT MAX(version) AS v FROM creative_profiles WHERE brand_id = ?').get(brandId);
  const version = (current && current.v ? Number(current.v) : 0) + 1;
  const id = newId();
  db.prepare(
    'INSERT INTO creative_profiles (id, brand_id, version, json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, brandId, version, toJsonColumn(profile), typeof profile.summary === 'string' ? profile.summary : null, nowIso());
  return getCreativeProfile(db, brandId);
}

/**
 * Queue a creative profile update as a proposal. The Creative Director never writes
 * creative_profiles directly (spec section 19 / architecture section 12).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id: string, profile: Record<string, any>, proposed_by: string}} input
 * @returns {{proposal_id: string}}
 */
export function proposeCreativeProfileUpdate(db, input) {
  const brandId = String(input.brand_id ?? '');
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) {
    throw new InvalidInputError(`There is no brand with id "${brandId}".`);
  }
  const proposalId = newId();
  db.prepare(
    `INSERT INTO memory_proposals (id, target, brand_id, json, status, proposed_by, reason, created_at)
     VALUES (?, 'creative', ?, ?, 'proposed', ?, ?, ?)`,
  ).run(proposalId, brandId, toJsonColumn(input.profile ?? {}), String(input.proposed_by ?? 'unknown'), 'creative profile refresh', nowIso());
  return { proposal_id: proposalId };
}
