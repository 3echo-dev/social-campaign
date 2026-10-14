/**
 * Creative library tools: assets, analyses and ingestion jobs.
 *
 * Originals are referenced in place and never touched. Everything derived lives in
 * the workspace. Searching is plain text matching over filename and analysis text,
 * which is enough for a V1 library of hundreds of assets.
 */

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { isTooBroadSourceFolder } from '../lib/paths.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { validateAgainst } from '../lib/validate.mjs';
import {
  assetFromRow,
  cancelLibraryJob,
  getJob,
  isJobRunning,
  latestJob,
  registerFile,
  startLibraryJob,
} from '../media/ingest.mjs';

const ORIGINS = ['reference', 'generated', 'imported'];
const KINDS = ['video', 'image', 'audio', 'document', 'script', 'other'];

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Shared search used by asset_search and creative_search.
 * @param {Record<string, unknown>} args
 * @param {import('../workspace/index.mjs').Workspace} workspace
 */
function searchAssets(args, workspace) {
  const db = workspace.requireDb();
  const root = workspace.requireRoot();
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
  /** @type {string[]} */
  const clauses = [];
  /** @type {unknown[]} */
  const values = [];

  const brandId = optionalString(args.brand_id);
  if (brandId) {
    clauses.push('a.brand_id = ?');
    values.push(brandId);
  }
  const kind = optionalString(args.kind);
  if (kind) {
    if (!KINDS.includes(kind)) throw new InvalidInputError(`kind must be one of ${KINDS.join(', ')}.`);
    clauses.push('a.kind = ?');
    values.push(kind);
  }
  const origin = optionalString(args.origin);
  if (origin) {
    clauses.push('a.origin = ?');
    values.push(origin);
  }
  if (Number.isFinite(Number(args.min_duration)) && args.min_duration != null) {
    clauses.push('a.duration >= ?');
    values.push(Number(args.min_duration));
  }
  if (Number.isFinite(Number(args.max_duration)) && args.max_duration != null) {
    clauses.push('a.duration <= ?');
    values.push(Number(args.max_duration));
  }
  const query = optionalString(args.query);
  if (query) {
    const like = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    clauses.push(
      "(a.path LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = a.id AND x.json LIKE ? ESCAPE '\\'))",
    );
    values.push(like, like);
  }
  // Analysis aware filters: each one is a substring match inside the stored analysis.
  for (const key of ['hook_type', 'format', 'platform']) {
    const value = optionalString(args[key]);
    if (!value) continue;
    const like = `%${value.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    clauses.push("EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = a.id AND x.json LIKE ? ESCAPE '\\')");
    values.push(like);
  }
  if (args.analyzed === true) {
    clauses.push('EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = a.id)');
  } else if (args.analyzed === false) {
    clauses.push('NOT EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = a.id)');
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM asset_analyses x WHERE x.asset_id = a.id) AS analysis_count
       FROM assets a ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...values, limit);
  return {
    assets: rows.map((row) => ({ ...assetFromRow(row, root), analysis_count: Number(row.analysis_count) })),
    count: rows.length,
  };
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const assetTools = [
  defineTool({
    name: 'asset_register',
    description:
      'Add one file to the creative library: hash it, read its facts, make thumbnails and give it a stable id. ' +
      'origin reference keeps the file where it is; generated or imported copies it into the workspace. ' +
      'A file whose content is already in the library is returned as a duplicate rather than added twice.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file.' },
        brand_id: { type: 'string' },
        origin: { type: 'string', description: 'reference (default), generated or imported.' },
        campaign_id: { type: 'string', description: 'Recorded on the asset.indexed event when given.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const origin = optionalString(args.origin) ?? 'reference';
      if (!ORIGINS.includes(origin)) throw new InvalidInputError(`origin must be one of ${ORIGINS.join(', ')}.`);
      const result = await registerFile({
        db: workspace.requireDb(),
        workspaceRoot: workspace.requireRoot(),
        path: String(args.path),
        brandId: optionalString(args.brand_id),
        origin: /** @type {'reference'|'generated'|'imported'} */ (origin),
        campaignId: optionalString(args.campaign_id),
      });
      return { ok: true, created: result.created, duplicate_of: result.duplicate_of, asset: result.asset };
    },
  }),

  defineTool({
    name: 'asset_search',
    description:
      'Search the creative library. Filters: brand_id, kind (video, image, audio, document, script, other), ' +
      'query (matches the file name and any analysis text), min_duration and max_duration in seconds, ' +
      'analyzed (true or false), limit.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        kind: { type: 'string' },
        query: { type: 'string' },
        origin: { type: 'string' },
        min_duration: { type: 'number' },
        max_duration: { type: 'number' },
        analyzed: { type: 'boolean' },
        limit: { type: 'number', description: 'Default 50, maximum 500.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => searchAssets(args, workspace),
  }),

];
