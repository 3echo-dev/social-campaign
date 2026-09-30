/**
 * Competitor intelligence memory. Competitor rows are looked up by brand and name;
 * analyses are appended, never overwritten, so a later reading never erases an
 * earlier one.
 */

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @param {string} name
 * @returns {Record<string, any>}
 */
function findOrCreateCompetitor(db, brandId, name) {
  const existing = db.prepare('SELECT * FROM competitors WHERE brand_id = ? AND name = ?').get(brandId, name);
  if (existing) return existing;
  const id = newId();
  const now = nowIso();
  db.prepare(
    'INSERT INTO competitors (id, brand_id, name, website, handles_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
  ).run(id, brandId, name, '{}', now, now);
  return db.prepare('SELECT * FROM competitors WHERE id = ?').get(id);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id: string, name?: string}} input
 * @returns {Record<string, any>[]}
 */
export function getCompetitor(db, input) {
  const brandId = String(input.brand_id ?? '');
  const competitors = input.name
    ? [db.prepare('SELECT * FROM competitors WHERE brand_id = ? AND name = ?').get(brandId, input.name)].filter(Boolean)
    : db.prepare('SELECT * FROM competitors WHERE brand_id = ?').all(brandId);

  return competitors.map((competitor) => ({
    id: competitor.id,
    brand_id: competitor.brand_id,
    name: competitor.name,
    website: competitor.website,
    handles: parseJson(competitor.handles_json, {}),
    analyses: db
      .prepare('SELECT * FROM competitor_analyses WHERE competitor_id = ? ORDER BY created_at DESC')
      .all(competitor.id)
      .map((row) => ({ id: row.id, analyst: row.analyst, scope: row.scope, analysis: parseJson(row.json, {}), created_at: row.created_at })),
  }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id: string, name: string, analysis: Record<string, any>, source_ref?: string}} input
 * @returns {Record<string, any>}
 */
export function saveCompetitorAnalysis(db, input) {
  const brandId = String(input.brand_id ?? '');
  if (!db.prepare('SELECT 1 FROM brands WHERE id = ?').get(brandId)) {
    throw new InvalidInputError(`There is no brand with id "${brandId}".`);
  }
  const name = String(input.name ?? '').trim();
  if (!name) throw new InvalidInputError('A competitor analysis needs a competitor name.');
  const competitor = findOrCreateCompetitor(db, brandId, name);
  const id = newId();
  const analysis = { ...(input.analysis ?? {}), source_ref: input.source_ref ?? null };
  const scope = typeof input.analysis?.scope === 'string' && ['organic', 'paid', 'mixed'].includes(input.analysis.scope)
    ? input.analysis.scope
    : 'organic';
  db.prepare(
    'INSERT INTO competitor_analyses (id, competitor_id, analyst, scope, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, competitor.id, String(input.analyst ?? 'competitor-researcher'), scope, toJsonColumn(analysis), nowIso());
  return getCompetitor(db, { brand_id: brandId, name })[0];
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Record<string, any>[]}
 */
export function listCompetitors(db) {
  return db.prepare('SELECT * FROM competitors ORDER BY created_at DESC').all().map((row) => ({
    id: row.id,
    brand_id: row.brand_id,
    name: row.name,
    website: row.website,
    handles: parseJson(row.handles_json, {}),
  }));
}
