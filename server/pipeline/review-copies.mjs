import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { probeFile, run } from '../media/probe.mjs';
import { sha256File } from '../media/hash.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { UserFacingError } from '../lib/errors.mjs';
import { isFinishedState, jobAt, listJobs } from './facts.mjs';

const require = createRequire(import.meta.url);
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const postReader = require(join(SCRIPTS, 'lib-post.js'));

export const VIDEO_MAX_EDGE = 1280;
export const IMAGE_MAX_EDGE = 2048;
export const MAX_FPS = 30;
export const TARGET_VIDEO_BYTES = 18 * 1024 * 1024;
export const HARD_LIMIT_BYTES = 20 * 1024 * 1024;
export const AUDIO_BITRATE_BPS = 128_000;
export const MIN_VIDEO_BITRATE_KBPS = 150;

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif', '.tiff', '.tif']);

const VIDEO_SCALE_FILTER = `scale='min(${VIDEO_MAX_EDGE},iw)':'min(${VIDEO_MAX_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
const IMAGE_SCALE_FILTER = `scale='min(${IMAGE_MAX_EDGE},iw)':'min(${IMAGE_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;

export function reviewCopiesDir(root) {
  return join(root, '.social-pipeline', 'review-copies');
}

function indexFile(root) {
  return join(reviewCopiesDir(root), 'index.json');
}

function emptyIndex() {
  return { version: 1, copies: {} };
}

function readIndex(root) {
  const value = readJsonFile(indexFile(root), emptyIndex());
  if (!value || typeof value !== 'object' || !value.copies || typeof value.copies !== 'object') {
    return emptyIndex();
  }
  return value;
}

function recordCopy(root, record) {
  updateJsonFile(
    indexFile(root),
    (current) => {
      const base = current && typeof current === 'object' && current.copies && typeof current.copies === 'object' ? current : emptyIndex();
      return { version: 1, copies: { ...base.copies, [record.sha]: record } };
    },
    emptyIndex(),
  );
}

export function reviewCopyFor(root, sha) {
  const index = readIndex(root);
  const record = index.copies[sha];
  if (!record || !existsSync(record.path)) return null;
  try {
    if (statSync(record.path).size !== record.bytes) return null;
  } catch {
    return null;
  }
  return record;
}

export function reviewCopiesToDelete(root, { keepShas = [] } = {}) {
  const keep = new Set(keepShas);
  const index = readIndex(root);
  return Object.values(index.copies).filter((record) => !keep.has(record.sha));
}

function tempPath(dir, ext) {
  return join(dir, `.tmp-${randomUUID()}.${ext}`);
}

export function computeVideoBitrateKbps(durationMs, hasAudio, targetBytes = TARGET_VIDEO_BYTES) {
  const durationSeconds = Math.max(Number(durationMs) / 1000, 1);
  const audioBits = hasAudio ? AUDIO_BITRATE_BPS * durationSeconds : 0;
  const targetBits = targetBytes * 8;
  const floorBits = MIN_VIDEO_BITRATE_KBPS * 1000 * durationSeconds;
  const videoBits = Math.max(targetBits - audioBits, floorBits);
  return Math.max(MIN_VIDEO_BITRATE_KBPS, Math.floor(videoBits / durationSeconds / 1000));
}

async function encodeVideo({ sourcePath, target, probe, videoBitrateKbps }) {
  const fps = probe.fps ? Math.min(MAX_FPS, Math.round(probe.fps)) : MAX_FPS;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-vf',
    VIDEO_SCALE_FILTER,
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
  ];
  if (videoBitrateKbps) {
    args.push('-b:v', `${videoBitrateKbps}k`, '-maxrate', `${Math.round(videoBitrateKbps * 1.5)}k`, '-bufsize', `${videoBitrateKbps * 2}k`);
  } else {
    args.push('-crf', '26');
  }
  if (probe.has_audio) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push('-movflags', '+faststart', target);
  await run('ffmpeg', args);
}

async function makeVideoReviewCopy({ root, sourcePath, sha, probe }) {
  const dir = reviewCopiesDir(root);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${sha}.mp4`);
  const attempt1 = tempPath(dir, 'mp4');
  await encodeVideo({ sourcePath, target: attempt1, probe, videoBitrateKbps: null });
  let chosenPath = attempt1;
  let bytes = statSync(attempt1).size;
  if (bytes > TARGET_VIDEO_BYTES) {
    const durationMs = probe.duration ? probe.duration * 1000 : 0;
    const kbps = computeVideoBitrateKbps(durationMs, probe.has_audio);
    const attempt2 = tempPath(dir, 'mp4');
    await encodeVideo({ sourcePath, target: attempt2, probe, videoBitrateKbps: kbps });
    const bytes2 = statSync(attempt2).size;
    rmSync(attempt1, { force: true });
    if (bytes2 > HARD_LIMIT_BYTES) {
      rmSync(attempt2, { force: true });
      throw new UserFacingError('This video could not be brought under 20 MiB for a review copy.', { code: 'review_copy_too_large' });
    }
    chosenPath = attempt2;
    bytes = bytes2;
  }
  renameSync(chosenPath, finalPath);
  const outputProbe = await probeFile(finalPath);
  const record = {
    sha,
    path: finalPath,
    contentType: 'video/mp4',
    bytes: statSync(finalPath).size,
    width: outputProbe.width,
    height: outputProbe.height,
    durationMs: outputProbe.duration ? Math.round(outputProbe.duration * 1000) : null,
  };
  recordCopy(root, record);
  return record;
}

async function makeImageReviewCopy({ root, sourcePath, sha, ext }) {
  const dir = reviewCopiesDir(root);
  mkdirSync(dir, { recursive: true });

  if (ext === '.gif' && statSync(sourcePath).size <= HARD_LIMIT_BYTES) {
    const finalPath = join(dir, `${sha}.gif`);
    copyFileSync(sourcePath, finalPath);
    let width = null;
    let height = null;
    try {
      const probeOut = await probeFile(finalPath);
      width = probeOut.width;
      height = probeOut.height;
    } catch {
      width = null;
      height = null;
    }
    const record = {
      sha,
      path: finalPath,
      contentType: 'image/gif',
      bytes: statSync(finalPath).size,
      width,
      height,
      durationMs: null,
    };
    recordCopy(root, record);
    return record;
  }

  const finalPath = join(dir, `${sha}.webp`);
  const temp = tempPath(dir, 'webp');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath];
  if (ext === '.gif') args.push('-frames:v', '1');
  args.push('-vf', IMAGE_SCALE_FILTER, '-c:v', 'libwebp', '-quality', '82', temp);
  await run('ffmpeg', args);
  renameSync(temp, finalPath);
  const outputProbe = await probeFile(finalPath);
  const record = {
    sha,
    path: finalPath,
    contentType: 'image/webp',
    bytes: statSync(finalPath).size,
    width: outputProbe.width,
    height: outputProbe.height,
    durationMs: null,
  };
  recordCopy(root, record);
  return record;
}

export async function makeReviewCopy({ root, sourcePath }) {
  if (!existsSync(sourcePath)) {
    throw new UserFacingError('The source file could not be found.', { code: 'source_missing' });
  }
  const sha = await sha256File(sourcePath);
  const cached = reviewCopyFor(root, sha);
  if (cached) return cached;

  const ext = extname(sourcePath).toLowerCase();
  let kind = VIDEO_EXTENSIONS.has(ext) ? 'video' : IMAGE_EXTENSIONS.has(ext) ? 'image' : null;
  let probe = null;

  if (kind === 'video') {
    probe = await probeFile(sourcePath);
  } else if (kind === null) {
    try {
      probe = await probeFile(sourcePath);
    } catch {
      throw new UserFacingError('This file type is not supported for a review copy.', { code: 'unsupported_media' });
    }
    if (probe.has_video) kind = 'video';
  }

  if (kind === null) {
    throw new UserFacingError('This file type is not supported for a review copy.', { code: 'unsupported_media' });
  }

  if (kind === 'video') return makeVideoReviewCopy({ root, sourcePath, sha, probe });
  return makeImageReviewCopy({ root, sourcePath, sha, ext });
}

const SHA_RE = /^[a-f0-9]{64}$/i;
const REVIEW_COPY_NAME = /^([a-f0-9]{64})\.[a-z0-9]+$/i;
const pathKey = value => (process.platform === 'win32' ? resolve(String(value || '')).toLowerCase() : resolve(String(value || '')));

export function shaFromReviewCopyPath(path) {
  const match = REVIEW_COPY_NAME.exec(basename(String(path || '')));
  return match ? match[1].toLowerCase() : null;
}

export function isReviewCopyPath(root, path) {
  if (typeof path !== 'string' || !path.trim()) return false;
  return pathKey(dirname(path)) === pathKey(reviewCopiesDir(root));
}

export function recordReviewUpload(root, { sha, assetId, url, uploadedAt } = {}) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha) || typeof assetId !== 'string' || !assetId.trim() || typeof url !== 'string' || !url.trim()) {
    return null;
  }
  const key = sha.toLowerCase();
  const index = readIndex(root);
  const existing = index.copies[key];
  if (!existing) return null;
  const { deletedAt, ...rest } = existing;
  const record = { ...rest, upload: { assetId: assetId.trim(), url: url.trim(), uploadedAt: uploadedAt || new Date().toISOString() } };
  recordCopy(root, record);
  return record;
}

export function reviewUploadFor(root, sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) return null;
  const index = readIndex(root);
  const record = index.copies[sha.toLowerCase()];
  return record && record.upload && !record.deletedAt ? record.upload : null;
}

export function isReviewMediaPath(path) {
  const ext = extname(String(path || '')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

export function copiesMissingFor(root, artifacts) {
  const media = (Array.isArray(artifacts) ? artifacts : []).filter(item => item && isReviewMediaPath(item.path) && typeof item.sha256 === 'string');
  const missing = media.filter(item => !reviewUploadFor(root, item.sha256)).map(item => ({ path: item.path, sourceSha: item.sha256 }));
  const next = missing.length
    ? 'Call pipeline_review_copies_prepare for this job, upload each copy it returns with the Artifact tool (asset: true, file_paths), then write the board again so the images and video can be viewed there.'
    : media.length
      ? 'Every image and video in this review already has a copy on the board.'
      : 'This review lists no images or video.';
  return { missing, next };
}

export function markReviewCopyDeleted(root, { assetId } = {}) {
  if (typeof assetId !== 'string' || !assetId.trim()) return null;
  const index = readIndex(root);
  const match = Object.values(index.copies).find(record => record.upload && record.upload.assetId === assetId);
  if (!match) return null;
  recordCopy(root, { ...match, upload: null, deletedAt: new Date().toISOString() });
  return match.sha;
}

export function reviewUrlFor(root, { brand, jobId, sourceSha, file } = {}) {
  let sha = typeof sourceSha === 'string' && SHA_RE.test(sourceSha) ? sourceSha.toLowerCase() : null;
  if (!sha && typeof file === 'string' && file.trim()) {
    const job = jobAt(root, brand, jobId);
    if (!job) return null;
    const abs = isAbsolute(file) ? file : join(job.dir, ...file.split('/'));
    if (!existsSync(abs)) return null;
    try {
      sha = createHash('sha256').update(readFileSync(abs)).digest('hex');
    } catch {
      return null;
    }
  }
  if (!sha) return null;
  const upload = reviewUploadFor(root, sha);
  return upload ? upload.url : null;
}

function readLines(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value);
    } catch {
      continue;
    }
  }
  return out;
}

function deliverableIds(dir) {
  try {
    return readdirSync(join(dir, 'drafts'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^D\d+$/.test(entry.name))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

async function registeredMedia(job, all) {
  try {
    const board = await import('./board.mjs');
    return board.reviewMediaPaths({ root: job.root, brand: job.brand, jobId: job.jobId, all });
  } catch {
    return [];
  }
}

async function reviewSources(job, { all = false } = {}) {
  const found = new Map();
  const add = value => {
    if (typeof value !== 'string' || !value.trim()) return;
    let full;
    try {
      full = resolve(value);
    } catch {
      return;
    }
    try {
      if (!statSync(full).isFile()) return;
    } catch {
      return;
    }
    const key = pathKey(full);
    if (!found.has(key)) found.set(key, full);
  };
  for (const entry of readLines(join(job.dir, 'generation', 'landed.jsonl'))) {
    if (entry.type === 'landed' && typeof entry.file === 'string' && entry.file) add(join(job.dir, ...entry.file.split('/')));
  }
  for (const id of deliverableIds(job.dir)) {
    let post = null;
    try {
      post = postReader.readPost(job.dir, id);
    } catch {
      post = null;
    }
    for (const item of post?.media || []) add(item.path);
  }
  for (const path of await registeredMedia(job, all)) add(join(job.dir, ...path.split('/')));
  return [...found.values()];
}

export async function prepareReviewCopies({ root, brand, jobId } = {}) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new UserFacingError('This job could not be found.', { code: 'job_missing' });
  const sources = await reviewSources(job);
  if (sources.length) {
    try {
      await run('ffmpeg', ['-version']);
    } catch (error) {
      if (error?.code !== 'binary_missing') throw error;
      throw new UserFacingError('Review copies need FFmpeg, and it is not installed on this computer.', { code: 'binary_missing', fix: 'Install FFmpeg, then try again.' });
    }
  }
  const toUpload = [];
  const uploaded = [];
  const failed = [];
  for (const source of sources) {
    let copy;
    try {
      copy = await makeReviewCopy({ root: job.root, sourcePath: source });
    } catch (error) {
      if (error?.code === 'binary_missing') throw error;
      const inside = relative(job.dir, source);
      failed.push({ path: inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : basename(source), reason: error instanceof UserFacingError ? error.message : 'A review copy could not be made from this file.' });
      continue;
    }
    const upload = reviewUploadFor(job.root, copy.sha);
    if (upload) uploaded.push({ path: copy.path, sourceSha: copy.sha, url: upload.url });
    else toUpload.push({ path: copy.path, sourceSha: copy.sha });
  }
  let next = toUpload.length
    ? 'Upload these to the board with the Artifact tool (asset: true, file_paths), then write the board.'
    : uploaded.length
      ? 'Every review copy for this job is already uploaded.'
      : failed.length ? '' : 'There is no review media for this job yet.';
  if (failed.length) next = `${next}${next ? ' ' : ''}Some files could not get a review copy, so they cannot be viewed on the board; the person can approve in chat instead.`;
  return { toUpload, uploaded, failed, next };
}

export function recordReviewUploads({ root, brand, jobId, items } = {}) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new UserFacingError('This job could not be found.', { code: 'job_missing' });
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new UserFacingError('List at least one uploaded file.', { code: 'review_copies_empty' });
  const uploadedAt = new Date().toISOString();
  const recorded = [];
  const skipped = [];
  for (const item of list) {
    const path = item && typeof item.path === 'string' ? item.path : null;
    const assetId = item && typeof item.assetId === 'string' ? item.assetId : null;
    const url = item && typeof item.url === 'string' ? item.url : null;
    const sha = path ? shaFromReviewCopyPath(path) : null;
    const record = sha ? recordReviewUpload(job.root, { sha, assetId, url, uploadedAt }) : null;
    if (record) recorded.push({ path, sourceSha: sha, assetId: record.upload.assetId, url: record.upload.url });
    else skipped.push(path);
  }
  const next = skipped.length ? 'Some files could not be matched to a review copy. Check each path and try again.' : 'Saved.';
  return { recorded, skipped, next };
}

async function hashesInUseElsewhere(job) {
  const keep = new Set();
  for (const other of listJobs(job.root)) {
    if ((other.brand === job.brand && other.jobId === job.jobId) || isFinishedState(other.state)) continue;
    for (const source of await reviewSources(other)) {
      try {
        keep.add(await sha256File(source));
      } catch {
        continue;
      }
    }
  }
  return keep;
}

export async function reviewCopiesCleanup({ root, brand, jobId, force = false } = {}) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new UserFacingError('This job could not be found.', { code: 'job_missing' });
  if (!force && !isFinishedState(job.state)) {
    throw new UserFacingError('This job has not reached its final approval or been cancelled yet. Pass force to clean up a cancelled job early.', { code: 'job_not_finished' });
  }
  const sources = await reviewSources(job, { all: true });
  const inUse = await hashesInUseElsewhere(job);
  const items = [];
  const seen = new Set();
  let shared = 0;
  for (const source of sources) {
    const sha = await sha256File(source);
    if (seen.has(sha)) continue;
    seen.add(sha);
    const upload = reviewUploadFor(job.root, sha);
    if (!upload) continue;
    if (inUse.has(sha)) shared += 1;
    else items.push({ sourceSha: sha, assetId: upload.assetId, url: upload.url });
  }
  const next = items.length
    ? 'Delete each with the Artifact tool (action delete, path = id).'
    : shared ? 'Every uploaded copy is still needed by another job, so nothing is deleted.' : 'There is nothing to delete for this job.';
  return { items, next };
}
