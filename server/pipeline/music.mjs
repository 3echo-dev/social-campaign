/**
 * Music shelf and a job's music choice (plan 0.13, A2).
 *
 * Tracks live in the workspace library (library.mjs, deduplicated by sha256, each tagged with a brand). The old per-brand shelf
 * `<brand>/music/` with `index.json` is still read there, so nothing saved earlier is lost.
 * A job's choice is `<job>/media/music/choice.json`, and always points at a copy of the track inside the job
 * (`file` is job-relative), so the finishing script never has to look at the shelf.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

import * as runtime from './runtime.mjs';
import { probeFile } from '../media/probe.mjs';
import { AUDIO_EXTENSIONS, addToLibrary, findItem, listLibrary } from './library.mjs';
import { renameReplacing } from '../lib/rename.mjs';

const DEFAULT_LICENCE = "the brand's own";

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameReplacing(tmp, file);
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

/** Copy a local audio file into the job and the workspace library (tagged with the brand), and make it the job's choice. */
export async function addMusic({ root, brand: brandValue, jobId, path, title, licence }) {
  const { brand, dir } = resolveJob(root, brandValue, jobId);
  const source = typeof path === 'string' ? path.trim() : '';
  if (!source || !isAbsolute(source)) throw new Error('The music file path must be absolute.');
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('The music file could not be found.');
  if (!AUDIO_EXTENSIONS.has(extname(source).toLowerCase())) throw new Error('Music must be an mp3, wav, m4a or aac file.');
  const info = await probeFile(source);
  if (!info.has_audio || !info.duration) throw new Error('That file does not contain audio.');

  const { item: entry, saved: savedToShelf } = await addToLibrary({ root, kind: 'music', path: source, brand: brand.slug, title, licence, origin: 'upload', addedFrom: `job:${jobId}` });
  const file = copyIntoJob(dir, source, safeFileName(source));
  writeChoice(dir, { source: 'job', title: entry.title, file, sha256: entry.sha256, licence: entry.licence, why: 'The person gave this track for this video.' });
  return { id: entry.id, title: entry.title, seconds: Math.round(info.duration), savedToShelf, shelfCount: listLibrary({ root, kind: 'music', brand: brand.slug }).items.length };
}

/** The workspace library's music in plain words (this brand's items when a brand is given), plus the ids to choose by. */
export function listMusic({ root, brand: brandValue }) {
  const brand = resolveBrand(root, brandValue);
  const listed = listLibrary({ root, kind: 'music', brand: brand.slug });
  const tracks = listed.items.map((item) => ({ id: item.id, title: item.title, licence: item.licence, brand: item.brand }));
  return {
    brand: brand.slug,
    tracks,
    text: tracks.length ? tracks.map((item) => `${item.title} (${item.licence})`).join('; ') : 'The music shelf is empty.',
  };
}

/** Record the job's choice: a library track id (any brand's), or `none`. */
export function chooseMusic({ root, brand: brandValue, jobId, id, why }) {
  const { dir } = resolveJob(root, brandValue, jobId);
  const reason = typeof why === 'string' ? why.trim() : '';
  const wanted = typeof id === 'string' ? id.trim() : '';
  if (!wanted) throw new Error('Say which track, or none.');
  if (wanted === 'none') {
    writeChoice(dir, { source: 'none', title: null, file: null, sha256: null, licence: null, why: reason || 'No music for this video.' });
    return { none: true };
  }
  const found = findItem({ root, id: wanted, kind: 'music' });
  if (!found) throw new Error(`No track with id ${wanted} in the library.`);
  const { item, file: libraryFile } = found;
  const file = copyIntoJob(dir, libraryFile, safeFileName(item.file.replace(/^m-[0-9a-f]{8}-/, '')));
  writeChoice(dir, { source: 'brand', title: item.title, file, sha256: item.sha256, licence: item.licence, why: reason || 'Fits the video.' });
  return { id: item.id, title: item.title };
}

/** The job document's music field: { title, source, licence } | { none: true } | null when nothing is chosen yet. */
export function musicSection(jobDir) {
  try {
    const choice = readChoice(jobDir);
    if (!choice) return null;
    if (choice.source === 'none' || !choice.title) return { none: true };
    return { title: String(choice.title), source: choice.source === 'brand' || choice.source === 'library' ? 'your library' : 'job', licence: String(choice.licence || DEFAULT_LICENCE) };
  } catch {
    return null;
  }
}
