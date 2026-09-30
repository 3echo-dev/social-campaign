/**
 * Memory proposals: promotion, rejection, and the precedence resolver.
 *
 * Specialists propose changes into memory_proposals; they never write brand_fields,
 * creative_profiles or competitor_analyses directly (architecture section 12,
 * spec section 19). promoteProposal is the only path from a proposal into canonical
 * memory. resolveContext implements the merge order from spec section 18.
 */

import { nowIso } from '../lib/ids.mjs';
import { parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { replaceField, getLiveField, listLiveFields } from './provenance.mjs';
import { saveCreativeProfile, getCreativeProfile } from './creative.mjs';
import { saveCompetitorAnalysis, getCompetitor } from './competitor.mjs';
import { getPreferences } from './preference.mjs';
import { requireBrandRow } from './brand.mjs';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{status?: string}} [input]
 * @returns {Record<string, any>[]}
 */
export function listProposals(db, input = {}) {
  const status = input.status ? String(input.status) : null;
  const rows = status
    ? db.prepare('SELECT * FROM memory_proposals WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM memory_proposals ORDER BY created_at DESC').all();
  return rows.map((row) => ({ ...row, json: parseJson(row.json, {}) }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @returns {Record<string, any>}
 */
function requireProposal(db, id) {
  const row = db.prepare('SELECT * FROM memory_proposals WHERE id = ?').get(id);
  if (!row) throw new InvalidInputError(`There is no memory proposal with id "${id}".`);
  if (row.status !== 'proposed') {
    throw new InvalidInputError(`That proposal has already been ${row.status}.`);
  }
  return row;
}

/**
 * Apply a proposal into canonical memory. This is the only function that may write
 * brand_fields, creative_profiles or competitor_analyses on behalf of a proposal.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} proposalId
 * @returns {Record<string, any>}
 */
export function promoteProposal(db, proposalId) {
  const row = requireProposal(db, proposalId);
  const json = parseJson(row.json, {});

  if (row.target === 'brand') {
    replaceField(db, {
      brandId: row.brand_id,
      fieldPath: json.field_path,
      value: json.value,
      sourceType: json.source_type ?? 'model_inference',
      sourceRef: json.source_ref ?? null,
      observedAt: json.observed_at,
      confidence: json.confidence,
    });
  } else if (row.target === 'creative') {
    saveCreativeProfile(db, row.brand_id, json);
  } else if (row.target === 'competitor') {
    saveCompetitorAnalysis(db, {
      brand_id: row.brand_id,
      name: json.name,
      analysis: json.analysis ?? json,
      source_ref: json.source_ref,
      analyst: json.analyst,
    });
  } else {
    throw new InvalidInputError(`Do not know how to promote a "${row.target}" proposal.`);
  }

  db.prepare("UPDATE memory_proposals SET status = 'promoted', resolved_at = ? WHERE id = ?").run(nowIso(), proposalId);
  return db.prepare('SELECT * FROM memory_proposals WHERE id = ?').get(proposalId);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} proposalId
 * @returns {Record<string, any>}
 */
export function rejectProposal(db, proposalId) {
  requireProposal(db, proposalId);
  db.prepare("UPDATE memory_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?").run(nowIso(), proposalId);
  return db.prepare('SELECT * FROM memory_proposals WHERE id = ?').get(proposalId);
}

/**
 * Merge memory into one context object, ordered by the precedence from spec
 * section 18, highest first. Every entry in `sources` names what contributed and at
 * which rank, so a caller can explain a decision rather than just state it.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id?: string, campaign_id?: string, instruction?: string}} input
 * @returns {Record<string, any>}
 */
export function resolveContext(db, input = {}) {
  const brandId = input.brand_id ? String(input.brand_id) : null;
  const campaignId = input.campaign_id ? String(input.campaign_id) : null;
  const sources = [];
  const layers = {};

  if (input.instruction) {
    layers.instruction = String(input.instruction);
    sources.push({ rank: 1, layer: 'instruction', label: 'current user instruction' });
  }

  if (campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    layers.campaign = campaign ?? null;
    sources.push({ rank: 2, layer: 'campaign', label: 'specific campaign reference', found: Boolean(campaign) });
  }

  if (brandId) {
    requireBrandRow(db, brandId);
    const fields = listLiveFields(db, brandId);
    const guidelines = fields.filter((field) => field.source_type === 'user_brand_guide' || field.source_type === 'official_source');
    layers.brand_guidelines = guidelines.map((field) => ({ field_path: field.field_path, value: field.value, source_type: field.source_type }));
    sources.push({ rank: 3, layer: 'brand_guidelines', label: 'brand restrictions and official guidelines', count: guidelines.length });
  }

  const preferenceData = getPreferences(db, { brand_id: brandId ?? undefined, campaign_id: campaignId ?? undefined });
  const explicitPreferences = preferenceData.preferences.filter((preference) => preference.source_kind === 'explicit');
  const promotedInferredPreferences = preferenceData.preferences.filter((preference) => preference.source_kind === 'inferred');
  layers.explicit_preferences = explicitPreferences;
  sources.push({ rank: 4, layer: 'explicit_preferences', label: 'explicit user or team preferences', count: explicitPreferences.length });

  if (brandId) {
    const creativeProfile = getCreativeProfile(db, brandId);
    layers.creative_memory = creativeProfile;
    sources.push({ rank: 5, layer: 'creative_memory', label: 'brand creative memory', found: Boolean(creativeProfile) });
  }

  // A single inferred signal never promotes to `preferences` (spec section 17), but it is
  // still campaign evidence the next stage must see, so campaign-scoped inferred evidence
  // rows are merged in alongside any preferences that already promoted from inferred signals.
  const campaignInferredEvidence = campaignId
    ? preferenceData.evidence.filter((row) => row.kind === 'inferred' && row.campaign_id === campaignId)
    : [];
  const promotedSignals = new Set(promotedInferredPreferences.map((preference) => preference.signal));
  const inferredPreferences = [
    ...promotedInferredPreferences,
    ...campaignInferredEvidence.filter((row) => !promotedSignals.has(row.signal)),
  ];
  layers.inferred_preferences = inferredPreferences;
  sources.push({ rank: 6, layer: 'inferred_preferences', label: 'inferred preferences', count: inferredPreferences.length });

  if (brandId) {
    const competitors = getCompetitor(db, { brand_id: brandId });
    layers.competitor_intelligence = competitors;
    sources.push({ rank: 7, layer: 'competitor_intelligence', label: 'competitor intelligence', count: competitors.length });
  }

  layers.trend_intelligence = null;
  sources.push({ rank: 8, layer: 'trend_intelligence', label: 'trend intelligence', found: false });

  return { brand_id: brandId, campaign_id: campaignId, context: layers, sources };
}

export { getLiveField };
