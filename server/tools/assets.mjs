/**
 * Creative library tools: assets, analyses, ingestion jobs and the library screen.
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
import { thumbsRoot } from '../media/frames.mjs';
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

/** Which contract each analyst must satisfy. */
const ANALYST_SCHEMA = {
  'video-analyst': 'video-creative-analysis.schema.json',
  'image-analyst': 'image-creative-analysis.schema.json',
  'script-analyst': 'script-analysis.schema.json',
};

/** How many assets the library screen shows at once. */
const SCREEN_ASSET_LIMIT = 60;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Give the pane the folder it serves thumbnails from. Cheap, so every library tool
 * does it rather than relying on boot order.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {import('../ui/server.mjs').UiServer} ui
 */
function exposeThumbs(workspace, ui) {
  if (workspace.root) ui.thumbsRoot = thumbsRoot(workspace.root);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} assetId
 * @param {string} workspaceRoot
 */
function requireAsset(db, assetId, workspaceRoot) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!row) throw new InvalidInputError('No asset with that id is in the library.');
  return assetFromRow(row, workspaceRoot);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} assetId
 */
function analysesFor(db, assetId) {
  return db
    .prepare('SELECT id, analyst, json, created_at FROM asset_analyses WHERE asset_id = ? ORDER BY created_at DESC, id DESC')
    .all(assetId)
    .map((row) => ({
      id: String(row.id),
      analyst: String(row.analyst),
      analysis: parseJson(String(row.json), {}),
      created_at: String(row.created_at),
    }));
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

/**
 * Counts by kind, total duration, formats, and analysis coverage.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null} brandId
 */
function summarize(db, brandId) {
  const where = brandId ? 'WHERE brand_id = ?' : '';
  const values = brandId ? [brandId] : [];
  const byKind = db
    .prepare(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(duration), 0) AS seconds FROM assets ${where} GROUP BY kind`)
    .all(...values);
  const formats = db
    .prepare(`SELECT mime, COUNT(*) AS n FROM assets ${where} GROUP BY mime ORDER BY n DESC`)
    .all(...values);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(duration), 0) AS seconds,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = assets.id) THEN 1 ELSE 0 END) AS analyzed
       FROM assets ${where}`,
    )
    .get(...values);
  const orientation = db
    .prepare(
      `SELECT CASE WHEN width IS NULL OR height IS NULL THEN 'unknown'
                   WHEN width > height THEN 'landscape' WHEN width < height THEN 'portrait' ELSE 'square' END AS shape,
              COUNT(*) AS n FROM assets ${where} GROUP BY shape`,
    )
    .all(...values);
  return {
    total: Number(totals?.total ?? 0),
    analyzed: Number(totals?.analyzed ?? 0),
    pending_analysis: Number(totals?.total ?? 0) - Number(totals?.analyzed ?? 0),
    total_bytes: Number(totals?.bytes ?? 0),
    total_duration: Math.round(Number(totals?.seconds ?? 0) * 100) / 100,
    by_kind: Object.fromEntries(
      byKind.map((row) => [String(row.kind), { count: Number(row.n), duration: Math.round(Number(row.seconds) * 100) / 100 }]),
    ),
    formats: formats.map((row) => ({ mime: row.mime ? String(row.mime) : null, count: Number(row.n) })),
    orientation: Object.fromEntries(orientation.map((row) => [String(row.shape), Number(row.n)])),
  };
}

/**
 * Build the data the creative_library screen renders.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{brandId: string|null, jobId: string|null}} options
 */
function libraryScreenData(workspace, options) {
  const status = workspace.status();
  if (!status.configured) {
    return { title: 'Build Creative Library', brand_id: options.brandId, job: null, assets: [], summary: null };
  }
  const db = workspace.requireDb();
  const job = options.jobId ? getJob(db, options.jobId) : latestJob(db, options.brandId);
  const { assets } = searchAssets({ brand_id: options.brandId, limit: SCREEN_ASSET_LIMIT }, workspace);
  return {
    title: 'Build Creative Library',
    brand_id: options.brandId,
    workspaceRoot: status.workspaceRoot,
    job: job ? { ...job, running: isJobRunning(job.id) } : null,
    assets: assets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      kind: asset.kind,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      thumbnail_url: asset.thumbnail_url,
      analyzed: asset.analysis_count > 0,
    })),
    summary: summarize(db, options.brandId),
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
    handler: async (args, { workspace, ui }) => {
      const origin = optionalString(args.origin) ?? 'reference';
      if (!ORIGINS.includes(origin)) throw new InvalidInputError(`origin must be one of ${ORIGINS.join(', ')}.`);
      exposeThumbs(workspace, ui);
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
    name: 'asset_get',
    description: 'Fetch one library asset by id: its facts, thumbnail and frame paths.',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({
      asset: requireAsset(workspace.requireDb(), String(args.asset_id), workspace.requireRoot()),
    }),
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

  defineTool({
    name: 'creative_search',
    description:
      'Search analysed creative in the library. Same filters as asset_search plus hook_type, format and ' +
      'platform, each matched against the stored analyses. Use this to find references by what they do.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        kind: { type: 'string' },
        query: { type: 'string' },
        hook_type: { type: 'string' },
        format: { type: 'string' },
        platform: { type: 'string', description: 'facebook, instagram or tiktok.' },
        min_duration: { type: 'number' },
        max_duration: { type: 'number' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => searchAssets(args, workspace),
  }),

  defineTool({
    name: 'creative_get',
    description: 'Fetch one asset together with every analysis saved against it, newest first.',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const asset = requireAsset(db, String(args.asset_id), workspace.requireRoot());
      return { asset, analyses: analysesFor(db, asset.id) };
    },
  }),

  defineTool({
    name: 'creative_save_analysis',
    description:
      'Save an analyst reading of one asset. analyst is video-analyst, image-analyst or script-analyst and the ' +
      'analysis must match that analyst\'s contract; problems are listed back if it does not. A new reading ' +
      'never replaces an older one.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        analyst: { type: 'string' },
        analysis: { type: 'object' },
      },
      required: ['asset_id', 'analyst', 'analysis'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const analyst = String(args.analyst);
      const schemaFile = ANALYST_SCHEMA[analyst];
      if (!schemaFile) {
        throw new InvalidInputError(`analyst must be one of ${Object.keys(ANALYST_SCHEMA).join(', ')}.`);
      }
      const asset = requireAsset(db, String(args.asset_id), workspace.requireRoot());
      const analysis = { ...(/** @type {Record<string, unknown>} */ (args.analysis)), asset_id: asset.id };
      const problems = validateAgainst(analysis, schemaFile);
      if (problems.length > 0) {
        throw new InvalidInputError('The analysis does not match the expected shape.', {
          details: { problems },
          fix: `Fix these and save again: ${problems.slice(0, 8).join('; ')}`,
        });
      }
      const id = newId();
      const createdAt = nowIso();
      db.prepare('INSERT INTO asset_analyses (id, asset_id, analyst, json, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        asset.id,
        analyst,
        toJsonColumn(analysis),
        createdAt,
      );
      return { ok: true, id, asset_id: asset.id, analyst, created_at: createdAt };
    },
  }),

  defineTool({
    name: 'library_ingest',
    description:
      'Start indexing a media folder into the creative library: find supported files, hash and dedupe them, ' +
      'read their facts and make thumbnails. Returns a job id at once; poll library_status for progress. ' +
      'The folder is only read. Pointing at the same folder again only picks up new files.',
    inputSchema: {
      type: 'object',
      properties: {
        source_folder: { type: 'string', description: 'Absolute path to the folder.' },
        brand_id: { type: 'string' },
      },
      required: ['source_folder'],
      additionalProperties: false,
    },
    handler: (args, { workspace, ui }) => {
      const workspaceRoot = workspace.requireRoot();
      const sourceFolder = String(args.source_folder);
      if (isTooBroadSourceFolder(sourceFolder, workspaceRoot)) {
        throw new InvalidInputError(
          'That folder is too broad to index. Choose a specific folder rather than the home directory, a drive root or the workspace root.',
        );
      }
      exposeThumbs(workspace, ui);
      const job = startLibraryJob({
        db: workspace.requireDb(),
        workspaceRoot,
        sourceFolder,
        brandId: optionalString(args.brand_id),
      });
      return { ok: true, job_id: job.id, job, hint: 'Call library_status with this job_id to follow progress.' };
    },
  }),

  defineTool({
    name: 'library_status',
    description:
      'Progress of a library indexing job: files found, hashed, probed, thumbnails made, registered, ' +
      'duplicates, failures, and whether it is still running.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Omit to get the most recent job.' },
        cancel: { type: 'boolean', description: 'Set true to stop the job after the current file.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const jobId = optionalString(args.job_id);
      const job = jobId ? getJob(db, jobId) : latestJob(db);
      if (!job) throw new InvalidInputError('No library job with that id.');
      if (args.cancel === true) cancelLibraryJob(job.id);
      const done = job.registered + job.duplicates + job.skipped + job.failed;
      return {
        job: { ...job, running: isJobRunning(job.id) },
        progress: job.files_found > 0 ? Math.min(1, done / job.files_found) : job.status === 'completed' ? 1 : 0,
        finished: !isJobRunning(job.id) && job.status !== 'queued' && job.status !== 'running',
      };
    },
  }),

  defineTool({
    name: 'library_pending_analysis',
    description:
      'List library assets that have no analysis yet, with their facts, thumbnail and frame paths, so a ' +
      'video, image or script analyst can read them and analyse them. Filter with brand_id and kind.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        kind: { type: 'string', description: 'video, image or script. Default: all three.' },
        limit: { type: 'number', description: 'Default 20, maximum 200.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 200);
      const kind = optionalString(args.kind);
      const kinds = kind ? [kind] : ['video', 'image', 'script'];
      const brandId = optionalString(args.brand_id);
      const rows = db
        .prepare(
          `SELECT * FROM assets a WHERE kind IN (${kinds.map(() => '?').join(', ')})
             ${brandId ? 'AND brand_id = ?' : ''}
             AND NOT EXISTS (SELECT 1 FROM asset_analyses x WHERE x.asset_id = a.id)
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(...kinds, ...(brandId ? [brandId] : []), limit);
      const assets = rows.map((row) => assetFromRow(row, root));
      return {
        assets,
        count: assets.length,
        hint: 'Read keyframe_paths to see each asset, then call creative_save_analysis.',
      };
    },
  }),

  defineTool({
    name: 'library_summary',
    description:
      'Totals for the creative library: counts and duration by kind, formats, orientation, and how many ' +
      'assets still need analysis.',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({ summary: summarize(workspace.requireDb(), optionalString(args.brand_id)) }),
  }),

  defineTool({
    name: 'creative_library_open',
    description:
      'Show the creative library screen: a folder field with a Start button, progress of the current ' +
      'indexing job, and the indexed assets. Call it again to refresh while a job runs. Wait with ui_wait; ' +
      'the action comes back as start (payload.folder), skip_analysis, done or cancel.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        job_id: { type: 'string', description: 'Show this job instead of the latest one.' },
        folder: { type: 'string', description: 'Pre-fill the folder field.' },
        error: { type: 'string', description: 'A one line problem to show at the top.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace, ui }) => {
      exposeThumbs(workspace, ui);
      const brandId = optionalString(args.brand_id);
      const jobId = optionalString(args.job_id);
      const data = libraryScreenData(workspace, { brandId, jobId });
      const screen = ui.show('creative_library', {
        ...data,
        folder: optionalString(args.folder) ?? data.job?.source_folder ?? '',
        error: optionalString(args.error),
      });
      // --- live refresh: background analysts write analyses through
      // creative_save_analysis without ever re-showing this screen, so the pane
      // polls GET /api/live to read the same truth this handler just built.
      ui.registerRefresher('creative_library', () => libraryScreenData(workspace, { brandId, jobId }));
      // --- end live refresh ---
      return { url: ui.url(), screenId: screen.screenId, job_id: data.job?.id ?? null, summary: data.summary };
    },
  }),
];
