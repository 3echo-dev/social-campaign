/**
 * Music shelf and a job's music choice (plan 0.13, A2).
 *
 * The brand's shelf is `<brand>/music/` with `index.json` (one entry per track, deduplicated by sha256).
 * A job's choice is `<job>/media/music/choice.json`, and always points at a copy of the track inside the job
 * (`file` is job-relative), so the finishing script never has to look at the shelf.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

import * as runtime from './runtime.mjs';
import { probeFile } from '../media/probe.mjs';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac']);
const DEFAULT_LICENCE = "the brand's own";

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function resolveBrand(root, value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('A brand is required.');
  const brand = runtime.listBrands({ root }).find((entry) => entry.id === input || entry.brandId === input || entry.slug === input);
  if (!brand) throw new Error(`Brand not found: ${input}`);
  return brand;
}

function resolveJob(root, brandValue, jobId) {
  const brand = resolveBrand(root, brandValue);
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  if (!id || id !== basename(id)) throw new Error('A job id is required.');
  const dir = join(brand.path, 'jobs', id);
  if (!existsSync(join(dir, 'job.json'))) throw new Error(`Job not found: ${id}`);
  return { brand, dir };
}

export function shelfDir(brandDir) { return join(brandDir, 'music'); }
export function choicePath(jobDir) { return join(jobDir, 'media', 'music', 'choice.json'); }

export function readShelf(brandDir) {
  const list = readJson(join(shelfDir(brandDir), 'index.json'), []);
  return Array.isArray(list) ? list : [];
}

export function readChoice(jobDir) {
  const value = readJson(choicePath(jobDir), null);
  return value && typeof value === 'object' ? value : null;
}

function tidyTitle(file) {
  const name = basename(file, extname(file)).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name || 'Untitled track';
}

function safeFileName(file) {
  const ext = extname(file).toLowerCase();
  const stem = basename(file, extname(file)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'track';
  return `${stem}${ext}`;
}

function copyIntoJob(jobDir, source, name) {
  const dir = join(jobDir, 'media', 'music');
  mkdirSync(dir, { recursive: true });
  copyFileSync(source, join(dir, name));
  return `media/music/${name}`;
}

function writeChoice(jobDir, choice) {
  mkdirSync(join(jobDir, 'media', 'music'), { recursive: true });
  writeJson(choicePath(jobDir), { ...choice, chosenAt: new Date().toISOString() });
}

/** Copy a local audio file into the job and the brand shelf, and make it the job's choice. */
export async function addMusic({ root, brand: brandValue, jobId, path, title, licence }) {
  const { brand, dir } = resolveJob(root, brandValue, jobId);
  const source = typeof path === 'string' ? path.trim() : '';
  if (!source || !isAbsolute(source)) throw new Error('The music file path must be absolute.');
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('The music file could not be found.');
  if (!AUDIO_EXTENSIONS.has(extname(source).toLowerCase())) throw new Error('Music must be an mp3, wav, m4a or aac file.');
  const info = await probeFile(source);
  if (!info.has_audio || !info.duration) throw new Error('That file does not contain audio.');

  const sha256 = sha256Of(source);
  const shelf = readShelf(brand.path);
  let entry = shelf.find((item) => item.sha256 === sha256);
  const savedToShelf = !entry;
  const fileName = safeFileName(source);
  if (!entry) {
    const musicDir = shelfDir(brand.path);
    mkdirSync(musicDir, { recursive: true });
    const id = `m-${sha256.slice(0, 8)}`;
    const file = `${id}-${fileName}`;
    copyFileSync(source, join(musicDir, file));
    entry = {
      id,
      title: (typeof title === 'string' && title.trim()) || tidyTitle(source),
      file,
      sha256,
      licence: (typeof licence === 'string' && licence.trim()) || DEFAULT_LICENCE,
      addedFrom: `job:${jobId}`,
      addedAt: new Date().toISOString(),
    };
    writeJson(join(musicDir, 'index.json'), [...shelf, entry]);
  }
  const file = copyIntoJob(dir, source, fileName);
  writeChoice(dir, { source: 'job', title: entry.title, file, sha256, licence: entry.licence, why: 'The person gave this track for this video.' });
  return { id: entry.id, title: entry.title, seconds: Math.round(info.duration), savedToShelf, shelfCount: readShelf(brand.path).length };
}

/** The brand's shelf in plain words, plus the ids to choose by. */
export function listMusic({ root, brand: brandValue }) {
  const brand = resolveBrand(root, brandValue);
  const tracks = readShelf(brand.path).map((item) => ({ id: item.id, title: item.title, licence: item.licence }));
  return {
    brand: brand.slug,
    tracks,
    text: tracks.length ? tracks.map((item) => `${item.title} (${item.licence})`).join('; ') : 'The music shelf is empty.',
  };
}

/** Record the job's choice: a shelf id, or `none`. */
export function chooseMusic({ root, brand: brandValue, jobId, id, why }) {
  const { brand, dir } = resolveJob(root, brandValue, jobId);
  const reason = typeof why === 'string' ? why.trim() : '';
  const wanted = typeof id === 'string' ? id.trim() : '';
  if (!wanted) throw new Error('Say which track, or none.');
  if (wanted === 'none') {
    writeChoice(dir, { source: 'none', title: null, file: null, sha256: null, licence: null, why: reason || 'No music for this video.' });
    return { none: true };
  }
  const entry = readShelf(brand.path).find((item) => item.id === wanted);
  if (!entry) throw new Error(`No track with id ${wanted} on this brand's shelf.`);
  const shelfFile = join(shelfDir(brand.path), entry.file);
  if (!existsSync(shelfFile)) throw new Error("That track's file is missing from the shelf.");
  const file = copyIntoJob(dir, shelfFile, safeFileName(entry.file.replace(/^m-[0-9a-f]{8}-/, '')));
  writeChoice(dir, { source: 'brand', title: entry.title, file, sha256: entry.sha256, licence: entry.licence, why: reason || 'Fits the video.' });
  return { id: entry.id, title: entry.title };
}

/** The job document's music field: { title, source, licence } | { none: true } | null when nothing is chosen yet. */
export function musicSection(jobDir) {
  try {
    const choice = readChoice(jobDir);
    if (!choice) return null;
    if (choice.source === 'none' || !choice.title) return { none: true };
    return { title: String(choice.title), source: choice.source === 'brand' ? 'your library' : 'job', licence: String(choice.licence || DEFAULT_LICENCE) };
  } catch {
    return null;
  }
}
