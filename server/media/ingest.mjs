/**
 * Creative library ingestion.
 *
 * inventory -> hash -> dedupe by sha256 -> probe -> thumbnails -> register -> event.
 *
 * A run is a row in library_jobs. The pipeline runs in this process, one file at a
 * time, yielding to the event loop between files so tool calls keep answering while
 * it works. It is resumable: a file whose sha256 or path is already registered is
 * skipped, so pointing at the same folder twice costs nothing and a run that was
 * interrupted simply picks up where it left off. The source folder is never written
 * to; every derived file lands inside the workspace.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { log } from '../lib/log.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { inventoryFolder } from './inventory.mjs';
import { sha256File } from './hash.mjs';
import { detectType } from './mime.mjs';
import { probeFile } from './probe.mjs';
import { extractImageThumbnail, extractVideoFrames, listFrames } from './frames.mjs';

/** Kinds that ffprobe can say something useful about. */
const PROBED_KINDS = new Set(['video', 'image', 'audio']);

/** In flight jobs in this process, keyed by job id. */
const RUNNING = new Map();

/**
 * @typedef {object} LibraryJob
 * @property {string} id
 * @property {string|null} brand_id
 * @property {string} source_folder
 * @property {'queued'|'running'|'completed'|'failed'|'cancelled'} status
 * @property {'inventory'|'hashing'|'probing'|'thumbnails'|'done'} phase
 * @property {number} files_found
 * @property {number} hashed
 * @property {number} probed
 * @property {number} thumbnails
 * @property {number} registered
 * @property {number} duplicates
 * @property {number} skipped
 * @property {number} failed
 * @property {Array<{path: string, problem: string}>} errors
 * @property {string|null} error
 * @property {string|null} started_at
 * @property {string|null} finished_at
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @param {any} row
 * @returns {LibraryJob|null}
 */
export function jobFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    brand_id: row.brand_id ? String(row.brand_id) : null,
    source_folder: String(row.source_folder),
    status: row.status,
    phase: row.phase,
    files_found: Number(row.files_found),
    hashed: Number(row.hashed),
    probed: Number(row.probed),
    thumbnails: Number(row.thumbnails),
    registered: Number(row.registered),
    duplicates: Number(row.duplicates),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    errors: parseJson(String(row.errors_json ?? '[]'), []),
    error: row.error ? String(row.error) : null,
    started_at: row.started_at ? String(row.started_at) : null,
    finished_at: row.finished_at ? String(row.finished_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} jobId
 * @returns {LibraryJob|null}
 */
export function getJob(db, jobId) {
  return jobFromRow(db.prepare('SELECT * FROM library_jobs WHERE id = ?').get(jobId));
}

/**
 * The most recent job, optionally for one brand.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null} [brandId]
 * @returns {LibraryJob|null}
 */
export function latestJob(db, brandId = null) {
  const row = brandId
    ? db.prepare('SELECT * FROM library_jobs WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(brandId)
    : db.prepare('SELECT * FROM library_jobs ORDER BY created_at DESC, id DESC LIMIT 1').get();
  return jobFromRow(row);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
function updateJob(db, jobId, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE library_jobs SET ${sets}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((key) => patch[key]),
    nowIso(),
    jobId,
  );
}

/**
 * Record a real file in the assets table, with hash, probe facts and thumbnails.
 *
 * origin reference: the file is referenced in place and never touched.
 * origin generated or imported: the file is copied into generated/ or imports/ and
 * the copy is what gets registered, per the hybrid storage rule in spec section 14.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   workspaceRoot: string,
 *   path: string,
 *   brandId?: string|null,
 *   origin?: 'reference'|'generated'|'imported',
 *   campaignId?: string|null,
 *   frameCount?: number,
 *   onStep?: (step: 'hashed'|'probed'|'thumbnails') => void,
 * }} options
 * @returns {Promise<{asset: Record<string, any>, created: boolean, duplicate_of: string|null}>}
 */
export async function registerFile(options) {
  const { db, workspaceRoot } = options;
  const origin = options.origin ?? 'reference';
  const sourcePath = resolve(options.path);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new InvalidInputError('That file could not be found.');
  }
  const notify = options.onStep ?? (() => {});

  const sha256 = await sha256File(sourcePath);
  notify('hashed');

  const byHash = db.prepare('SELECT * FROM assets WHERE sha256 = ? ORDER BY created_at ASC LIMIT 1').get(sha256);
  if (byHash) {
    return { asset: assetFromRow(byHash, workspaceRoot), created: false, duplicate_of: String(byHash.id) };
  }
  const byPath = db.prepare('SELECT * FROM assets WHERE path = ?').get(sourcePath);
  if (byPath) {
    return { asset: assetFromRow(byPath, workspaceRoot), created: false, duplicate_of: null };
  }

  const id = newId();
  let path = sourcePath;
  if (origin === 'generated' || origin === 'imported') {
    const folder = join(workspaceRoot, origin === 'generated' ? 'generated' : 'imports');
    mkdirSync(folder, { recursive: true });
    path = join(folder, `${id}${extname(sourcePath).toLowerCase()}`);
    copyFileSync(sourcePath, path);
  }

  const type = detectType(path);
  const bytes = statSync(path).size;

  /** @type {import('./probe.mjs').ProbeResult|null} */
  let probe = null;
  if (PROBED_KINDS.has(type.kind)) {
    try {
      probe = await probeFile(path);
    } catch (error) {
      log.warn('probe failed, registering with what is known', { path, error: String(error) });
    }
  }
  notify('probed');

  let thumbnail = null;
  if (type.kind === 'video' || type.kind === 'image') {
    try {
      const result =
        type.kind === 'video'
          ? await extractVideoFrames({
              filePath: path,
              assetId: id,
              workspaceRoot,
              duration: probe?.duration ?? null,
              count: options.frameCount,
            })
          : await extractImageThumbnail({ filePath: path, assetId: id, workspaceRoot });
      thumbnail = result.thumbnail || null;
    } catch (error) {
      log.warn('thumbnail failed, registering without one', { path, error: String(error) });
    }
  }
  notify('thumbnails');

  const now = nowIso();
  db.prepare(
    `INSERT INTO assets (id, brand_id, path, sha256, mime, kind, bytes, width, height, duration, fps, codec,
       audio_tracks, thumbnail_path, indexed_at, origin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.brandId ?? null,
    path,
    sha256,
    type.mime,
    type.kind,
    bytes,
    probe?.width ?? null,
    probe?.height ?? null,
    probe?.duration ?? null,
    probe?.fps ?? null,
    probe?.codec ?? null,
    probe?.audio_tracks ?? null,
    thumbnail,
    now,
    origin,
    now,
    now,
  );
  db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    options.campaignId ?? null,
    'asset.indexed',
    toJsonColumn({ asset_id: id, kind: type.kind, origin, brand_id: options.brandId ?? null, sha256 }),
    now,
  );

  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  return { asset: assetFromRow(row, workspaceRoot), created: true, duplicate_of: null };
}

/**
 * Turn an assets row into the NormalizedAssetRecord shape plus display helpers.
 * @param {any} row
 * @param {string} workspaceRoot
 * @returns {Record<string, any>}
 */
export function assetFromRow(row, workspaceRoot) {
  const id = String(row.id);
  const frames = listFrames(workspaceRoot, id);
  return {
    schema_version: 1,
    id,
    brand_id: row.brand_id ? String(row.brand_id) : null,
    path: String(row.path),
    filename: basename(String(row.path)),
    sha256: row.sha256 ? String(row.sha256) : null,
    mime: row.mime ? String(row.mime) : null,
    kind: String(row.kind),
    bytes: row.bytes == null ? null : Number(row.bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    duration: row.duration == null ? null : Number(row.duration),
    fps: row.fps == null ? null : Number(row.fps),
    codec: row.codec ? String(row.codec) : null,
    audio_tracks: row.audio_tracks == null ? null : Number(row.audio_tracks),
    thumbnail_path: row.thumbnail_path ? String(row.thumbnail_path) : null,
    keyframe_paths: frames,
    origin: String(row.origin),
    duplicate_of: null,
    indexed_at: String(row.indexed_at ?? row.created_at),
    probe_source: row.codec || row.duration != null || row.width != null ? 'ffprobe' : 'unknown',
  };
}

/**
 * Create a library job row and start processing it in the background.
 * @param {{db: import('node:sqlite').DatabaseSync, workspaceRoot: string, sourceFolder: string, brandId?: string|null}} options
 * @returns {LibraryJob}
 */
export function startLibraryJob(options) {
  const sourceFolder = resolve(options.sourceFolder);
  if (!existsSync(sourceFolder) || !statSync(sourceFolder).isDirectory()) {
    throw new InvalidInputError('That folder could not be found. Please check the path and try again.');
  }
  const inside = resolve(options.workspaceRoot);
  if (sourceFolder === join(inside, '.social-campaign') || sourceFolder.startsWith(join(inside, '.social-campaign'))) {
    throw new InvalidInputError('That folder is Social Campaign storage, not a media folder.');
  }
  const id = newId();
  const now = nowIso();
  options.db
    .prepare(
      'INSERT INTO library_jobs (id, brand_id, source_folder, status, phase, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, options.brandId ?? null, sourceFolder, 'queued', 'inventory', now, now);

  const control = { cancelled: false };
  RUNNING.set(id, control);
  const promise = runLibraryJob({ ...options, sourceFolder, jobId: id, control }).finally(() => RUNNING.delete(id));
  promise.catch((error) => log.error('library job crashed', { jobId: id, error: String(error) }));
  return /** @type {LibraryJob} */ (getJob(options.db, id));
}

/**
 * Ask a running job to stop after the current file.
 * @param {string} jobId
 * @returns {boolean} whether the job was running in this process.
 */
export function cancelLibraryJob(jobId) {
  const control = RUNNING.get(jobId);
  if (!control) return false;
  control.cancelled = true;
  return true;
}

/**
 * @param {string} jobId
 * @returns {boolean}
 */
export function isJobRunning(jobId) {
  return RUNNING.has(jobId);
}

/**
 * The pipeline itself. Exported so tests can await a run directly.
 * @param {{db: import('node:sqlite').DatabaseSync, workspaceRoot: string, sourceFolder: string, brandId?: string|null, jobId: string, control?: {cancelled: boolean}}} options
 * @returns {Promise<LibraryJob>}
 */
export async function runLibraryJob(options) {
  const { db, jobId } = options;
  const control = options.control ?? { cancelled: false };
  updateJob(db, jobId, { status: 'running', phase: 'inventory', started_at: nowIso() });

  try {
    const entries = inventoryFolder(options.sourceFolder);
    updateJob(db, jobId, { files_found: entries.length, phase: 'hashing' });

    const counters = { hashed: 0, probed: 0, thumbnails: 0, registered: 0, duplicates: 0, skipped: 0, failed: 0 };
    /** @type {Array<{path: string, problem: string}>} */
    const errors = [];

    for (const entry of entries) {
      if (control.cancelled) {
        updateJob(db, jobId, { status: 'cancelled', finished_at: nowIso() });
        return /** @type {LibraryJob} */ (getJob(db, jobId));
      }
      // Already registered by path: nothing to do, not even a hash.
      const known = db.prepare('SELECT id FROM assets WHERE path = ?').get(entry.path);
      if (known) {
        counters.skipped += 1;
        updateJob(db, jobId, { skipped: counters.skipped });
        await yieldToLoop();
        continue;
      }
      try {
        const result = await registerFile({
          db,
          workspaceRoot: options.workspaceRoot,
          path: entry.path,
          brandId: options.brandId ?? null,
          origin: 'reference',
          onStep: (step) => {
            counters[step] += 1;
            const phase = step === 'hashed' ? 'hashing' : step === 'probed' ? 'probing' : 'thumbnails';
            updateJob(db, jobId, { [step]: counters[step], phase });
          },
        });
        if (result.created) counters.registered += 1;
        else counters.duplicates += 1;
      } catch (error) {
        counters.failed += 1;
        errors.push({ path: entry.path, problem: error instanceof Error ? error.message : String(error) });
        log.warn('library file failed', { path: entry.path, error: String(error) });
      }
      updateJob(db, jobId, {
        registered: counters.registered,
        duplicates: counters.duplicates,
        failed: counters.failed,
        errors_json: toJsonColumn(errors.slice(0, 200)),
      });
      await yieldToLoop();
    }

    updateJob(db, jobId, { status: 'completed', phase: 'done', finished_at: nowIso() });
  } catch (error) {
    updateJob(db, jobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finished_at: nowIso(),
    });
  }
  return /** @type {LibraryJob} */ (getJob(db, jobId));
}

/** Let queued tool calls run between files. */
function yieldToLoop() {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}
