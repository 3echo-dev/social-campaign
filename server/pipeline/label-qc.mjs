import { createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserFacingError } from '../lib/errors.mjs';
import { probeFile, run } from '../media/probe.mjs';

const require = createRequire(import.meta.url);
const deliverableRules = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-deliverable.js'));
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const postReader = require(join(SCRIPTS, 'lib-post.js'));
const frontmatter = require(join(SCRIPTS, 'lib-frontmatter.js'));

export const QC_FRAME_MAX_EDGE = 1568;
export const FRAME_INTERVAL_S = 2;
export const MAX_INTERVAL_FRAMES = 45;
export const MAX_SCENE_FRAMES = 20;
export const SCENE_THRESHOLD = 0.3;
export const IMAGE_HUGE_EDGE = 2048;
export const IMAGE_HUGE_BYTES = Math.floor(4.5 * 1024 * 1024);
export const NEAR_PHRASE = 0.8;
export const NEAR_WORD = 0.75;
export const MIN_WORD_LENGTH = 4;
export const LABEL_CHECK_FILE = 'validation/label-check.json';
export const QC_FRAMES_DIR = 'validation/qc-frames';
export const FLAG_KINDS = Object.freeze({
  misspelling: 'possible misspelling',
  unexpected: 'unexpected text',
  mark: 'unexpected mark',
});

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif', '.tif', '.tiff', '.avif', '.bmp']);
const DIRECT_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SUBTITLE_EXT = new Set(['.srt', '.vtt']);
const SCENE_OFFSET_S = 0.1;
const END_OFFSET_S = 0.25;
const MIN_GAP_S = 0.2;
const MAX_WINDOW = 12;
const LOOSE_MATCH = 0.5;
const MAX_READINGS = 5000;
const MAX_ITEMS = 300;
const MAX_ITEM_CHARS = 500;
const SCALE = `scale='min(${QC_FRAME_MAX_EDGE},iw)':'min(${QC_FRAME_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;
const COPY_COLUMN = /spoken|on[\s-]?screen|shown|caption|overlay|subtitle|super/i;
const MARK_WORDS = new Set(['logo', 'logos', 'logotype', 'wordmark', 'mark', 'marks', 'emblem', 'icon', 'symbol', 'badge', 'monogram']);
const NEUTRAL_WORDS = new Set([
  'ml', 'l', 'g', 'kg', 'mg', 'oz', 'fl', 'lb', 'lbs', 'cm', 'mm', 'pcs', 'pc', 'net', 'wt', 'vol', 'spf', 'pa',
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'is', 'are', 'be',
  'it', 'its', 'your', 'you', 'our', 'we', 'my', 'me', 'this', 'that', 'as', 'so', 'no', 'not', 'all',
]);

const SAFE_NAME = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\/]/.test(value) && value !== '.' && value !== '..';
const forward = value => String(value).split(sep).join('/');
const round = value => Math.round(Number(value || 0) * 100) / 100;
const pathKey = value => (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));

export function jobRef({ root, brand, jobId } = {}) {
  if (!root || !SAFE_NAME(brand) || !SAFE_NAME(jobId)) {
    throw new UserFacingError('Say which job to check.', { code: 'job_missing' });
  }
  const base = resolve(String(root));
  const dir = join(base, 'workspaces', brand, 'jobs', jobId);
  if (!existsSync(join(dir, 'job.json')) && !existsSync(join(dir, 'status.md'))) {
    throw new UserFacingError('This job could not be found.', { code: 'job_missing' });
  }
  return { root: base, brand, jobId, dir };
}

function refFromJob(root, job) {
  if (job && typeof job === 'object' && typeof job.dir === 'string' && job.dir) {
    const dir = resolve(job.dir);
    return jobRef({ root: root || resolve(dir, '..', '..', '..', '..'), brand: basename(dirname(dirname(dir))), jobId: basename(dir) });
  }
  return jobRef({ root, brand: job?.brand, jobId: job?.jobId });
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function mediaKind(file) {
  const ext = extname(String(file || '')).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  return null;
}

function displayPath(ref, abs) {
  const rel = relative(ref.root, abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? forward(rel) : forward(abs);
}

function storedPath(ref, value) {
  return isAbsolute(value) ? resolve(value) : resolve(ref.root, value);
}

function inputPath(ref, value) {
  return isAbsolute(value) ? resolve(value) : resolve(ref.dir, value);
}

function mediaNoun(kind) {
  return kind === 'video' ? 'video' : 'image';
}

function suppliedNoun(job) {
  return job?.subject === 'character' ? 'the character picture' : 'the product photo';
}

function isProductAsset(ref, value) {
  const job = readJson(join(ref.dir, 'job.json'));
  const productPath = typeof job?.productAsset?.path === 'string' && job.productAsset.path.trim() ? job.productAsset.path : null;
  if (!productPath) return false;
  try {
    return pathKey(storedPath(ref, productPath)) === pathKey(storedPath(ref, value));
  } catch {
    return false;
  }
}

function plainMediaRef(ref, file) {
  if (!file || typeof file.path !== 'string') return 'this file';
  if (file.role === 'supplied') return isProductAsset(ref, file.path) ? suppliedNoun(readJson(join(ref.dir, 'job.json'))) : `a supplied ${mediaNoun(file.kind)}`;
  return deliverableName(ref, file) || `the finished ${mediaNoun(file.kind)}`;
}

// The deliverable the way the person sees it ("the Instagram Reel", "the second Instagram post"), from the
// job's own post types, never its id. A picture of a Reel or a TikTok video is its cover. Null when the
// job does not say, so the caller falls back to plain words about the file.
function deliverableName(ref, file) {
  if (!file.deliverable) return null;
  let spec;
  try { spec = deliverableRules.withDerivedPlacements(readJson(join(ref.dir, 'job.json'))); } catch { return null; }
  const match = Array.isArray(spec?.deliverables) ? spec.deliverables.find(item => item && item.id === file.deliverable) : null;
  if (!match) return null;
  const filmed = ['reel', 'video'].includes(match.placement);
  return deliverableRules.describe(spec, match) + (file.kind !== 'video' && filmed ? ' cover' : '');
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const hashCache = new Map();

export function hashFile(abs) {
  const info = statSync(abs);
  const key = pathKey(abs);
  const cached = hashCache.get(key);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) return cached.sha256;
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(abs, 'r');
  try {
    let read = readSync(fd, buffer, 0, buffer.length, null);
    while (read > 0) {
      hash.update(buffer.subarray(0, read));
      read = readSync(fd, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(fd);
  }
  const sha256 = hash.digest('hex');
  hashCache.set(key, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, sha256 });
  return sha256;
}

function deliverableIds(dir) {
  try {
    return readdirSync(join(dir, 'drafts'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^D\d+$/.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  } catch {
    return [];
  }
}

function walkFiles(dir, accept, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, accept, out);
    else if (entry.isFile() && accept(full)) out.push(full);
  }
  return out;
}

export function qcTargets(ref, { paths = [] } = {}) {
  const found = new Map();
  const add = (abs, role, deliverable = null) => {
    const full = resolve(abs);
    const kind = mediaKind(full);
    if (!kind) return;
    try {
      if (!statSync(full).isFile()) return;
    } catch {
      return;
    }
    const key = pathKey(full);
    if (!found.has(key)) found.set(key, { abs: full, path: displayPath(ref, full), role, kind, deliverable });
  };
  const named = new Set();
  for (const id of deliverableIds(ref.dir)) {
    let post = null;
    try {
      post = postReader.readPost(ref.dir, id);
    } catch {
      post = null;
    }
    for (const item of post?.media || []) {
      if (!existsSync(item.path)) continue;
      add(item.path, 'deliverable', id);
      named.add(id);
    }
  }
  const slots = new Map();
  const landedLines = readLines(join(ref.dir, 'generation', 'landed.jsonl'));
  const repaired = new Map(landedLines.filter(entry => entry.type === 'promoted' && entry.assetId && entry.promoted).map(entry => [entry.assetId, entry.promoted]));
  for (const entry of landedLines) {
    if (entry.type !== 'landed' || typeof entry.file !== 'string' || !entry.file) continue;
    const deliverable = typeof entry.deliverable === 'string' && entry.deliverable ? entry.deliverable : null;
    if (deliverable && named.has(deliverable)) continue;
    const slot = `${deliverable || ''}\u0000${entry.panel || entry.file}`;
    const version = Number(entry.version) || 0;
    const current = slots.get(slot);
    const claimed = entry.promoted || repaired.get(entry.assetId);
    const promoted = typeof claimed === 'string' && claimed && existsSync(join(ref.dir, ...claimed.split('/'))) ? claimed : null;
    const file = promoted || entry.file;
    if (!current || version > current.version) slots.set(slot, { version, deliverable, files: [file] });
    else if (version === current.version && !current.files.includes(file)) current.files.push(file);
  }
  for (const slot of slots.values()) {
    for (const file of slot.files) add(join(ref.dir, ...file.split('/')), 'deliverable', slot.deliverable);
  }
  for (const extra of paths) add(extra, 'deliverable', null);
  for (const file of walkFiles(join(ref.root, 'inputs', ref.brand, ref.jobId), full => Boolean(mediaKind(full)))) add(file, 'supplied');
  const job = readJson(join(ref.dir, 'job.json'));
  if (typeof job?.productAsset?.path === 'string' && job.productAsset.path) add(storedPath(ref, job.productAsset.path), 'supplied');
  return [...found.values()];
}

function uniqueByContent(targets) {
  const seen = new Set();
  const out = [];
  for (const target of targets) {
    const sha256 = hashFile(target.abs);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    out.push({ ...target, sha256 });
  }
  return out;
}

export function frameTimes(durationS, sceneTimes = []) {
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  if (!duration) return [{ t: 0, source: 'interval' }];
  const step = Math.max(FRAME_INTERVAL_S, duration / MAX_INTERVAL_FRAMES);
  const planned = [];
  for (let i = 0; i * step < duration - 0.05; i += 1) planned.push({ t: Math.round(i * step * 1000) / 1000, source: 'interval' });
  if (!planned.length) planned.push({ t: 0, source: 'interval' });
  const end = Math.round(Math.max(0, duration - END_OFFSET_S) * 1000) / 1000;
  if (end - planned[planned.length - 1].t > 0.5) planned.push({ t: end, source: 'end' });
  let scenes = [...new Set(sceneTimes)]
    .filter(t => Number.isFinite(t) && t > 0.05 && t < duration - 0.05)
    .sort((a, b) => a - b)
    .map(t => Math.round(Math.min(t + SCENE_OFFSET_S, duration - 0.05) * 1000) / 1000);
  if (scenes.length > MAX_SCENE_FRAMES) {
    const picked = [];
    for (let i = 0; i < MAX_SCENE_FRAMES; i += 1) picked.push(scenes[Math.floor((i * scenes.length) / MAX_SCENE_FRAMES)]);
    scenes = picked;
  }
  const merged = [...planned, ...scenes.map(t => ({ t, source: 'scene' }))].sort((a, b) => a.t - b.t);
  const out = [];
  for (const item of merged) {
    if (out.length && item.t - out[out.length - 1].t < MIN_GAP_S) continue;
    out.push(item);
  }
  return out;
}

async function sceneChanges(abs) {
  try {
    const { stderr } = await run('ffmpeg', [
      '-hide_banner', '-nostats', '-i', abs, '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', `scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f', 'null', '-',
    ], { timeoutMs: 300_000 });
    return [...stderr.matchAll(/pts_time:\s*([0-9.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite);
  } catch {
    return [];
  }
}

function unreadable(ref, target) {
  return new UserFacingError(`${capitalize(plainMediaRef(ref, target))} could not be opened for the label check. Replace the file or take it out of the job, then try again.`, { code: 'qc_file_unreadable' });
}

async function videoFrames(ref, target, out, nextId) {
  let probe;
  try {
    probe = await probeFile(target.abs);
  } catch {
    throw unreadable(ref, target);
  }
  if (!probe.has_video) return { frames: [], durationMs: probe.duration ? Math.round(probe.duration * 1000) : null };
  const times = frameTimes(probe.duration ?? 0, await sceneChanges(target.abs));
  const frames = [];
  for (const { t, source } of times) {
    const frameId = nextId();
    const image = join(out, `${frameId}.jpg`);
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', target.abs, '-frames:v', '1', '-vf', SCALE, '-q:v', '2', image]);
    } catch {
      continue;
    }
    if (existsSync(image)) frames.push({ frameId, image, atMs: Math.round(t * 1000), source });
  }
  if (!frames.length) throw unreadable(ref, target);
  return { frames, durationMs: probe.duration ? Math.round(probe.duration * 1000) : null };
}

async function imageFrame(ref, target, out, frameId) {
  const ext = extname(target.abs).toLowerCase();
  let probe = null;
  try {
    probe = await probeFile(target.abs);
  } catch {
    probe = null;
  }
  const edge = Math.max(probe?.width || 0, probe?.height || 0);
  if (DIRECT_IMAGE_EXT.has(ext) && edge > 0 && edge <= IMAGE_HUGE_EDGE && statSync(target.abs).size <= IMAGE_HUGE_BYTES) {
    const image = join(out, `${frameId}${ext === '.jpeg' ? '.jpg' : ext}`);
    copyFileSync(target.abs, image);
    return image;
  }
  const image = join(out, `${frameId}.jpg`);
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', target.abs, '-frames:v', '1', '-vf', SCALE, '-q:v', '2', image]);
  } catch {
    throw unreadable(ref, target);
  }
  if (!existsSync(image)) throw unreadable(ref, target);
  return image;
}

export function formatAt(atMs) {
  if (atMs === null || atMs === undefined || !Number.isFinite(Number(atMs))) return null;
  const seconds = Math.floor(Number(atMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function runFile(ref) {
  return join(ref.dir, 'validation', 'qc-frames', 'run.json');
}

function readRun(ref) {
  const value = readJson(runFile(ref));
  return value && typeof value.runId === 'string' && Array.isArray(value.files) && Array.isArray(value.frames) ? value : null;
}

export async function extractQcFrames({ root, brand, jobId, paths = [] } = {}) {
  const ref = jobRef({ root, brand, jobId });
  const extras = [];
  for (const value of Array.isArray(paths) ? paths : []) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const abs = inputPath(ref, value.trim());
    if (!mediaKind(abs) || !existsSync(abs)) {
      throw new UserFacingError('That file is not an image or video in this job.', { code: 'qc_path_invalid' });
    }
    extras.push(abs);
  }
  const targets = uniqueByContent(qcTargets(ref, { paths: extras }));
  if (!targets.length) {
    throw new UserFacingError('There are no images or videos in this job to check yet.', { code: 'qc_nothing_to_check' });
  }
  const base = join(ref.dir, 'validation', 'qc-frames');
  mkdirSync(base, { recursive: true });
  rmSync(runFile(ref), { force: true });
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory()) rmSync(join(base, entry.name), { recursive: true, force: true });
  }
  const runId = randomBytes(2).toString('hex');
  const out = join(base, runId);
  mkdirSync(out, { recursive: true });
  let counter = 0;
  const nextId = () => `${runId}-${String(++counter).padStart(3, '0')}`;
  const files = [];
  const frames = [];
  for (const target of targets) {
    const file = { path: target.path, sha256: target.sha256, role: target.role, kind: target.kind, deliverable: target.deliverable };
    if (target.kind === 'video') {
      const result = await videoFrames(ref, target, out, nextId);
      file.durationMs = result.durationMs;
      file.frames = result.frames.length;
      for (const frame of result.frames) frames.push({ ...frame, file: target.path });
    } else {
      const frameId = nextId();
      const image = await imageFrame(ref, target, out, frameId);
      file.frames = 1;
      frames.push({ frameId, image, atMs: null, source: 'image', file: target.path });
    }
    files.push(file);
  }
  const createdAt = new Date().toISOString();
  writeJsonAtomic(runFile(ref), {
    version: 1,
    runId,
    createdAt,
    extraPaths: extras.map(abs => displayPath(ref, abs)),
    files,
    frames: frames.map(frame => ({ frameId: frame.frameId, image: displayPath(ref, frame.image), file: frame.file, atMs: frame.atMs, source: frame.source })),
  });
  return {
    runId,
    createdAt,
    fileCount: files.length,
    frameCount: frames.length,
    files: files.map(file => ({ file: file.path, name: basename(file.path), role: file.role, kind: file.kind, frames: file.frames })),
    frames: frames.map(frame => ({ frameId: frame.frameId, path: frame.image, file: frame.file, name: basename(frame.file), at: formatAt(frame.atMs), atMs: frame.atMs })),
    next: 'Open every frame path with Read. Write down all text exactly as printed and every brand mark, then call pipeline_qc_save with one reading per frameId.',
  };
}

function fold(piece) {
  return piece.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
}

function words(value) {
  const text = String(value ?? '').normalize('NFKC');
  const list = [];
  for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const token = fold(match[0]);
    if (token) list.push({ token, start: match.index, end: match.index + match[0].length });
  }
  return { text, list };
}

export function normalizeText(value) {
  return words(value).list.map(word => word.token).join(' ');
}

function editDistance(x, y) {
  let before = null;
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (before && i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current.push(value);
    }
    before = previous;
    previous = current;
  }
  return previous[y.length];
}

export function similarity(a, b) {
  const x = Array.from(String(a ?? ''));
  const y = Array.from(String(b ?? ''));
  const longest = Math.max(x.length, y.length);
  if (!longest) return 1;
  return 1 - editDistance(x, y) / longest;
}

export function buildIndex(entries) {
  const phrases = [];
  const windows = new Map();
  const vocab = new Map();
  for (const entry of entries || []) {
    const { text, list } = words(typeof entry === 'string' ? entry : entry?.text);
    if (!list.length) continue;
    const tokens = list.map(word => word.token);
    phrases.push({ text, list, tokens });
    for (let i = 0; i < list.length; i += 1) {
      if (!vocab.has(tokens[i])) vocab.set(tokens[i], text.slice(list[i].start, list[i].end));
      let compact = '';
      for (let k = 0; k < MAX_WINDOW && i + k < list.length; k += 1) {
        compact += tokens[i + k];
        const original = text.slice(list[i].start, list[i + k].end);
        if (!windows.has(compact)) windows.set(compact, original);
        if (k > 0 && k < 3 && !vocab.has(compact)) vocab.set(compact, original);
      }
    }
  }
  return { phrases, windows, vocab };
}

function isNeutral(token) {
  return Array.from(token).length === 1 || NEUTRAL_WORDS.has(token) || /^\d+(?:[.,]\d+)*$/.test(token) || /^\d+(?:[.,]\d+)?[a-z]{1,3}$/.test(token);
}

function isKnown(index, token) {
  if (index.vocab.has(token) || isNeutral(token)) return true;
  if (token.endsWith('es') && index.vocab.has(token.slice(0, -2))) return true;
  if (token.endsWith('s') && index.vocab.has(token.slice(0, -1))) return true;
  return index.vocab.has(`${token}s`);
}

function inPhrase(index, tokens) {
  for (const phrase of index.phrases) {
    for (let i = 0; i + tokens.length <= phrase.tokens.length; i += 1) {
      if (tokens.every((token, k) => phrase.tokens[i + k] === token)) return true;
    }
  }
  return false;
}

function closestWord(index, token) {
  let best = null;
  for (const [word, original] of index.vocab) {
    const longest = Math.max(word.length, token.length);
    if (Math.abs(word.length - token.length) / longest > 1 - NEAR_WORD) continue;
    const score = similarity(word, token);
    if (!best || score > best.similarity) best = { text: original, similarity: score };
  }
  return best;
}

function closestPhrase(index, tokens) {
  const count = tokens.length;
  const target = tokens.join('');
  const spaced = tokens.join(' ');
  let best = null;
  for (const phrase of index.phrases) {
    for (let size = Math.max(1, count - 1); size <= Math.min(phrase.tokens.length, count + 1); size += 1) {
      for (let i = 0; i + size <= phrase.tokens.length; i += 1) {
        const slice = phrase.tokens.slice(i, i + size);
        const compact = slice.join('');
        if (Math.abs(compact.length - target.length) / Math.max(compact.length, target.length) > 1 - LOOSE_MATCH) continue;
        const score = Math.max(similarity(compact, target), similarity(slice.join(' '), spaced));
        if (!best || score > best.similarity) {
          best = { text: phrase.text.slice(phrase.list[i].start, phrase.list[i + size - 1].end), similarity: score };
        }
      }
    }
  }
  return best;
}

export function checkText(raw, index, mode = 'text') {
  const parsed = words(raw);
  const list = mode === 'mark' ? parsed.list.filter(word => !MARK_WORDS.has(word.token)) : parsed.list;
  if (!list.length) return [];
  const tokens = list.map(word => word.token);
  const compact = tokens.join('');
  if (index.windows.has(compact) || (tokens.length > MAX_WINDOW && inPhrase(index, tokens))) return [];
  const unknown = list.filter(word => !isKnown(index, word.token));
  if (!unknown.length) return [];
  const seen = parsed.text.trim();
  const near = closestPhrase(index, tokens);
  if (near && near.similarity >= NEAR_PHRASE && Array.from(compact).length >= MIN_WORD_LENGTH) {
    return [{ seen, expected: near.text, similarity: near.similarity, kind: FLAG_KINDS.misspelling }];
  }
  const found = [];
  let leftover = false;
  for (const word of unknown) {
    const close = Array.from(word.token).length >= MIN_WORD_LENGTH ? closestWord(index, word.token) : null;
    if (close && close.similarity >= NEAR_WORD) {
      found.push({ seen: parsed.text.slice(word.start, word.end), expected: close.text, similarity: close.similarity, kind: FLAG_KINDS.misspelling });
    } else {
      leftover = true;
    }
  }
  if (leftover && mode !== 'scene') {
    found.push({
      seen,
      expected: near && near.similarity >= LOOSE_MATCH ? near.text : null,
      similarity: near ? near.similarity : 0,
      kind: mode === 'mark' ? FLAG_KINDS.mark : FLAG_KINDS.unexpected,
    });
  }
  return found;
}

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, out);
  return out;
}

function tablesOf(body) {
  const rows = [];
  let block = [];
  const flush = () => {
    if (block.length) rows.push(...frontmatter.table(block.join('\n')));
    block = [];
  };
  for (const line of String(body || '').split(/\r?\n/)) {
    if (line.trim().startsWith('|')) block.push(line);
    else flush();
  }
  flush();
  return rows;
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function subtitleLines(text) {
  return String(text || '').split(/\r?\n/).filter(line => {
    const trimmed = line.trim();
    return trimmed && !/^WEBVTT/i.test(trimmed) && !/^\d+$/.test(trimmed) && !/-->/.test(trimmed) && !/^(NOTE|STYLE|REGION)\b/.test(trimmed);
  });
}

export function allowedText(ref) {
  const names = [];
  const copy = [];
  const push = (list, value, from) => {
    for (const text of strings(value)) {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) list.push({ text: trimmed, from });
      }
    }
  };
  const brandDir = join(ref.root, 'workspaces', ref.brand);
  const workspace = readJson(join(brandDir, 'workspace.json')) || {};
  push(names, [workspace.name, workspace.brandName, ref.brand.replace(/[-_]+/g, ' ')], 'brand');
  const profile = readJson(join(brandDir, 'brand', 'profile.json')) || {};
  push(names, [profile.name, profile.brandName, profile.products, profile.productNames, profile.terminology], 'brand profile');
  const kit = readJson(join(brandDir, 'brand', 'brand-kit.json')) || {};
  push(names, [kit.name, kit.brandName, kit.wordmark, kit.confirmed?.brandName, kit.confirmed?.wordmark], 'brand kit');
  const job = readJson(join(ref.dir, 'job.json')) || {};
  const deliverables = Array.isArray(job.deliverables) ? job.deliverables : [];
  push(names, [
    job.title, job.request, job.product, job.productName, job.products, job.offer, job.requiredClaims,
    job.productAsset?.name, job.productAsset?.title, job.productAsset?.label,
    deliverables.map(item => (item && typeof item === 'object' ? [item.product, item.productName, item.name, item.title] : null)),
  ], 'brief');
  const brief = readText(join(ref.dir, 'brief.md'));
  if (brief) {
    try {
      push(names, Object.values(frontmatter.parse(brief).sections), 'brief');
    } catch {
      push(names, brief, 'brief');
    }
  }
  for (const id of deliverableIds(ref.dir)) {
    const draft = join(ref.dir, 'drafts', id);
    const postText = readText(join(draft, 'post.md'));
    if (postText !== null) {
      try {
        const post = postReader.parse(postText, ref.dir);
        push(copy, [post.caption, post.cta, post.hashtags.map(tag => tag.replace(/^#/, ''))], 'post');
        const parsed = frontmatter.parse(postText);
        push(copy, [parsed.sections.CTA, parsed.sections.Disclosure, parsed.data.disclosure], 'post');
      } catch {
        push(copy, postText, 'post');
      }
    }
    for (const name of ['script.md', 'storyboard.md']) {
      const text = readText(join(draft, name));
      if (text === null) continue;
      let parsed;
      try {
        parsed = frontmatter.parse(text);
      } catch {
        continue;
      }
      push(copy, parsed.data.disclosure, name);
      for (const row of tablesOf(parsed.body)) {
        for (const [header, cell] of Object.entries(row)) if (COPY_COLUMN.test(header)) push(copy, cell, name);
      }
    }
  }
  const subtitles = [
    ...walkFiles(join(ref.dir, 'drafts'), file => SUBTITLE_EXT.has(extname(file).toLowerCase())),
    ...walkFiles(join(ref.dir, 'media'), file => SUBTITLE_EXT.has(extname(file).toLowerCase())),
  ];
  for (const file of subtitles) push(copy, subtitleLines(readText(file)), 'subtitles');
  return { names, copy };
}

export function labelFlags({ frames, allowed, shaOf }) {
  const all = buildIndex([...allowed.names, ...allowed.copy]);
  const names = buildIndex(allowed.names);
  const flags = new Map();
  for (const frame of frames) {
    const fileSha = shaOf.get(frame.file) || '';
    const found = [
      ...frame.text.flatMap(value => checkText(value, all, 'text')),
      ...frame.marks.flatMap(value => checkText(value, all, 'mark')),
      ...(frame.scene || []).flatMap(value => checkText(value, names, 'scene')),
    ];
    for (const item of found) {
      const id = `lf-${createHash('sha256').update([fileSha, item.kind, normalizeText(item.seen)].join('\n')).digest('hex').slice(0, 12)}`;
      if (flags.has(id)) continue;
      flags.set(id, {
        id,
        frameId: frame.frameId,
        file: frame.file,
        atMs: frame.atMs,
        seen: item.seen,
        expected: item.expected,
        similarity: round(item.similarity),
        kind: item.kind,
      });
    }
  }
  return [...flags.values()];
}

function cleanList(value, label, frameId) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new UserFacingError(`The ${label} for frame ${frameId} must be a list of text.`, { code: 'qc_reading_invalid' });
  }
  if (value.length > MAX_ITEMS || value.some(item => item.length > MAX_ITEM_CHARS)) {
    throw new UserFacingError(`The ${label} for frame ${frameId} is too long. Split it into shorter lines.`, { code: 'qc_reading_invalid' });
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function collectReadings(readings, manifest) {
  if (!Array.isArray(readings) || !readings.length) {
    throw new UserFacingError('Add one reading for every frame.', { code: 'qc_reading_invalid' });
  }
  if (readings.length > MAX_READINGS) throw new UserFacingError('There are too many readings for one check.', { code: 'qc_reading_invalid' });
  const known = new Set(manifest.frames.map(frame => frame.frameId));
  const byId = new Map();
  const unknown = [];
  for (const reading of readings) {
    if (!reading || typeof reading !== 'object' || typeof reading.frameId !== 'string') {
      throw new UserFacingError('Every reading needs the frameId it describes.', { code: 'qc_reading_invalid' });
    }
    if (!known.has(reading.frameId)) {
      unknown.push(reading.frameId);
      continue;
    }
    if (!Array.isArray(reading.text) || !Array.isArray(reading.marks)) {
      throw new UserFacingError(`The reading for frame ${reading.frameId} needs text and marks lists, even when they are empty.`, { code: 'qc_reading_invalid' });
    }
    const entry = byId.get(reading.frameId) || { text: [], marks: [], scene: [], notes: [] };
    entry.text.push(...cleanList(reading.text, 'text', reading.frameId));
    entry.marks.push(...cleanList(reading.marks, 'marks', reading.frameId));
    entry.scene.push(...cleanList(reading.scene, 'scene text', reading.frameId));
    if (typeof reading.notes === 'string' && reading.notes.trim()) entry.notes.push(reading.notes.trim().slice(0, 2000));
    byId.set(reading.frameId, entry);
  }
  if (unknown.length) {
    throw new UserFacingError(`These frames are not from the latest set: ${unknown.join(', ')}. Read the frames from the last pipeline_qc_frames call.`, { code: 'qc_frames_unknown', details: { unknown } });
  }
  const missing = manifest.frames.map(frame => frame.frameId).filter(frameId => !byId.has(frameId));
  if (missing.length) {
    throw new UserFacingError(`These frames have no reading yet: ${missing.join(', ')}. Open each one and add what it shows, even when it shows no writing.`, { code: 'qc_frames_unread', details: { missing } });
  }
  return byId;
}

export function describeFlag(ref, flag, file) {
  const at = formatAt(flag.atMs);
  const where = `${at ? `at ${at} ` : ''}in ${plainMediaRef(ref, file)}`;
  const expected = flag.expected ? ` (expected '${flag.expected}')` : '';
  return `'${flag.seen}'${expected} ${where}`;
}

function labelCheckFile(ref) {
  return join(ref.dir, ...LABEL_CHECK_FILE.split('/'));
}

export function saveLabelCheck({ root, brand, jobId, readings } = {}) {
  const ref = jobRef({ root, brand, jobId });
  const manifest = readRun(ref);
  if (!manifest) throw new UserFacingError('Take the review frames first, then save what they show.', { code: 'qc_frames_missing' });
  const runShas = new Set(manifest.files.map(file => file.sha256));
  for (const file of manifest.files) {
    const abs = storedPath(ref, file.path);
    let sha256 = null;
    try {
      sha256 = hashFile(abs);
    } catch {
      sha256 = null;
    }
    if (sha256 !== file.sha256) {
      throw new UserFacingError(`${capitalize(plainMediaRef(ref, file))} changed after the frames were taken. Take the frames again and read the new ones.`, { code: 'qc_frames_stale' });
    }
  }
  const extras = (Array.isArray(manifest.extraPaths) ? manifest.extraPaths : []).map(value => storedPath(ref, value));
  for (const target of qcTargets(ref, { paths: extras })) {
    if (!runShas.has(hashFile(target.abs))) {
      throw new UserFacingError(`${capitalize(plainMediaRef(ref, target))} was added or changed after the frames were taken. Take the frames again and read the new ones.`, { code: 'qc_frames_stale' });
    }
  }
  const byId = collectReadings(readings, manifest);
  const frames = manifest.frames.map(frame => {
    const reading = byId.get(frame.frameId);
    return {
      frameId: frame.frameId,
      file: frame.file,
      atMs: frame.atMs,
      image: frame.image,
      text: reading.text,
      marks: reading.marks,
      scene: reading.scene,
      ...(reading.notes.length ? { notes: reading.notes.join(' ') } : {}),
    };
  });
  const shaOf = new Map(manifest.files.map(file => [file.path, file.sha256]));
  const flags = labelFlags({ frames, allowed: allowedText(ref), shaOf });
  const checkedAt = new Date().toISOString();
  const record = {
    version: 1,
    runId: manifest.runId,
    files: manifest.files.map(file => ({ path: file.path, sha256: file.sha256, role: file.role, kind: file.kind, deliverable: file.deliverable ?? null })),
    frames,
    flags,
    checkedAt,
  };
  writeJsonAtomic(labelCheckFile(ref), record);
  const fileByPath = new Map(record.files.map(item => [item.path, item]));
  const counted = `Checked ${frames.length} frame${frames.length === 1 ? '' : 's'} from ${record.files.length} file${record.files.length === 1 ? '' : 's'}.`;
  const summary = flags.length
    ? `${counted} ${flags.length === 1 ? 'One item needs' : `${flags.length} items need`} the person's eye: ${flags.map(flag => describeFlag(ref, flag, fileByPath.get(flag.file))).join('; ')}.`
    : `${counted} Every label and mark matches the brand and the approved copy.`;
  return {
    status: flags.length ? 'needs_a_look' : 'clear',
    summary,
    checkedAt,
    fileCount: record.files.length,
    frameCount: frames.length,
    flags: flags.map(flag => ({
      id: flag.id,
      kind: flag.kind,
      seen: flag.seen,
      expected: flag.expected,
      at: formatAt(flag.atMs),
      file: basename(flag.file),
      role: record.files.find(file => file.path === flag.file)?.role ?? null,
      similarity: flag.similarity,
    })),
    labelCheckFile: labelCheckFile(ref),
  };
}

export function readLabelCheck({ root, brand, jobId } = {}) {
  const ref = jobRef({ root, brand, jobId });
  const value = readJson(labelCheckFile(ref));
  return value && Array.isArray(value.files) && Array.isArray(value.frames) && Array.isArray(value.flags) ? value : null;
}

function coverageOf(ref, check, extras = []) {
  const covered = new Set((check?.files || []).map(file => file.sha256));
  const targets = qcTargets(ref, { paths: extras });
  const missing = [];
  const live = new Set();
  for (const target of targets) {
    let sha256;
    try {
      sha256 = hashFile(target.abs);
    } catch {
      continue;
    }
    live.add(sha256);
    if (!covered.has(sha256)) missing.push(target);
  }
  return { current: missing.length === 0, missing, live, targets };
}

function openFlags(check, live, accepted) {
  const shaOf = new Map(check.files.map(file => [file.path, file.sha256]));
  return check.flags.filter(flag => {
    const sha256 = shaOf.get(flag.file);
    return (!sha256 || live.has(sha256)) && !accepted.has(flag.id);
  });
}

export function labelCheckStatus({ root, brand, jobId, acceptedFlagIds = [] } = {}) {
  const ref = jobRef({ root, brand, jobId });
  const check = readLabelCheck(ref);
  const coverage = coverageOf(ref, check);
  const targets = coverage.targets.map(target => ({ path: target.path, role: target.role, kind: target.kind, deliverable: target.deliverable }));
  if (!coverage.targets.length) return { state: 'not_needed', checkedAt: check?.checkedAt ?? null, flags: [], files: check?.files ?? [], targets, changed: [] };
  if (!check) return { state: 'missing', checkedAt: null, flags: [], files: [], targets, changed: coverage.missing.map(target => target.path) };
  const fileOf = new Map(check.files.map(file => [file.path, file]));
  const flags = openFlags(check, coverage.live, new Set(Array.isArray(acceptedFlagIds) ? acceptedFlagIds : [])).map(flag => ({
    ...flag,
    at: formatAt(flag.atMs),
    name: basename(flag.file),
    role: fileOf.get(flag.file)?.role ?? null,
    deliverable: fileOf.get(flag.file)?.deliverable ?? null,
  }));
  return {
    state: coverage.current ? 'current' : 'stale',
    checkedAt: check.checkedAt ?? null,
    flags,
    files: check.files,
    targets,
    changed: coverage.missing.map(target => target.path),
  };
}

export function assertContentQc({ root, job, files = [], acceptedFlagIds = [] } = {}) {
  const ref = refFromJob(root, job);
  const extras = (Array.isArray(files) ? files : [])
    .map(item => (typeof item === 'string' ? item : item?.path))
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => inputPath(ref, value.trim()))
    .filter(abs => mediaKind(abs) && existsSync(abs));
  const check = readLabelCheck(ref);
  const coverage = coverageOf(ref, check, extras);
  if (!coverage.targets.length) return { required: false, checkedAt: check?.checkedAt ?? null, accepted: [] };
  if (!check) {
    throw new UserFacingError('The labels and logos in the images and video have not been checked yet. Run the label check before the final approval.', { code: 'label_check_missing' });
  }
  if (!coverage.current) {
    const refs = coverage.missing.map(target => plainMediaRef(ref, target)).join(', ');
    throw new UserFacingError(`Some images or video changed after the label check: ${refs}. Run the label check again before the final approval.`, { code: 'label_check_stale', details: { files: coverage.missing.map(target => target.path) } });
  }
  const accepted = new Set(Array.isArray(acceptedFlagIds) ? acceptedFlagIds : []);
  const open = openFlags(check, coverage.live, accepted);
  if (open.length) {
    const fileByPath = new Map(check.files.map(item => [item.path, item]));
    const lead = open.length === 1 ? 'One item from the label check still needs a look' : `${open.length} items from the label check still need a look`;
    throw new UserFacingError(`${lead}: ${open.map(flag => describeFlag(ref, flag, fileByPath.get(flag.file))).join('; ')}. Accept each one as is or fix the file before the final approval.`, { code: 'label_check_open', details: { flagIds: open.map(flag => flag.id) } });
  }
  return {
    required: true,
    checkedAt: check.checkedAt ?? null,
    files: check.files.length,
    flags: check.flags.length,
    accepted: check.flags.filter(flag => accepted.has(flag.id)).map(flag => flag.id),
  };
}
