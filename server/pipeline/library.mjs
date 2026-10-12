/**
 * The workspace library: one shelf of music tracks and voice recordings for the whole workspace, each tagged with a brand.
 *
 * `<workspace>/library/index.json` lists the items (deduplicated by sha256 within a kind) and `<workspace>/library/<kind>/` holds
 * the files. Uploads and what ElevenLabs makes both go in. Each item keeps a licence note ("the brand's own", "made with
 * ElevenLabs"). The older per-brand music shelf (`<brand>/music/index.json`) is still read, so nothing already saved is lost; it
 * shows in the library as music tagged with that brand and is never written to again.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

import * as runtime from './runtime.mjs';
import { probeFile } from '../media/probe.mjs';

export const LIBRARY_KINDS = Object.freeze(['music', 'voice']);
export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac']);
export const DEFAULT_LICENCE = "the brand's own";
export const ELEVEN_LABS_LICENCE = 'made with ElevenLabs';

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { const tmp = `${file}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); renameSync(tmp, file); };
const sha256Of = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export const libraryDir = root => join(root, 'library');
const indexFile = root => join(libraryDir(root), 'index.json');

export function checkKind(kind) {
  if (!LIBRARY_KINDS.includes(kind)) throw new Error('The library holds music or voice.');
  return kind;
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

/** The brand slugs of the workspace, for the library's brand filter. */
export function libraryBrands(root) {
  try { return runtime.listBrands({ root }).map(brand => ({ slug: brand.slug, name: brand.name || brand.slug })); } catch { return []; }
}

function normalise(entry, kind) {
  const brands = [...new Set([entry.brand, ...(Array.isArray(entry.brands) ? entry.brands : [])].filter(value => typeof value === 'string' && value))];
  return { ...entry, kind, brand: brands[0] || null, brands };
}

/** Every item the workspace has: the library's own, then the old per-brand music shelves (not repeated when the library has the same file). */
export function readAll(root) {
  const own = readJson(indexFile(root), []);
  const items = (Array.isArray(own) ? own : []).filter(entry => entry && typeof entry === 'object' && LIBRARY_KINDS.includes(entry.kind) && entry.id && entry.file)
    .map(entry => ({ ...normalise(entry, entry.kind), dir: join(libraryDir(root), entry.kind), legacy: false }));
  for (const brand of libraryBrands(root)) {
    const brandDir = runtime.listBrands({ root }).find(entry => entry.slug === brand.slug)?.path;
    const shelf = brandDir ? readJson(join(brandDir, 'music', 'index.json'), []) : [];
    for (const entry of Array.isArray(shelf) ? shelf : []) {
      if (!entry || !entry.id || !entry.file) continue;
      const same = items.find(item => item.kind === 'music' && entry.sha256 && item.sha256 === entry.sha256);
      if (same) { if (!same.brands.includes(brand.slug)) same.brands.push(brand.slug); continue; }
      items.push({ ...normalise({ ...entry, brand: brand.slug }, 'music'), origin: 'brand-shelf', dir: join(brandDir, 'music'), legacy: true });
    }
  }
  return items;
}

/** The library in plain words, newest last, optionally only one kind and only one brand's items. */
export function listLibrary({ root, kind = null, brand = null } = {}) {
  if (kind) checkKind(kind);
  const wanted = typeof brand === 'string' && brand.trim() ? brand.trim() : null;
  const items = readAll(root)
    .filter(item => (!kind || item.kind === kind) && (!wanted || item.brands.includes(wanted)))
    .map(item => ({ id: item.id, kind: item.kind, title: item.title, licence: item.licence || DEFAULT_LICENCE, brand: item.brand, brands: item.brands, origin: item.origin || 'upload', seconds: item.seconds ?? null }));
  return {
    kind, brand: wanted, brands: libraryBrands(root), items,
    text: items.length ? items.map(item => `${item.title} (${item.licence}${item.brand ? `, ${item.brand}` : ''})`).join('; ') : `The ${kind || 'music and voice'} library is empty.`,
  };
}

/** One item by id, with the absolute path of its file; null when it is not there or its file is missing. */
export function findItem({ root, id, kind = null }) {
  const item = readAll(root).find(entry => entry.id === id && (!kind || entry.kind === kind));
  if (!item) return null;
  const file = join(item.dir, item.file);
  return existsSync(file) ? { item, file } : null;
}

/**
 * Put an audio file in the library, once. Returns { item, saved }: saved is false when the same bytes were already there (the
 * item found is returned, and a new brand tag is added to it). `origin` is 'upload' or 'elevenlabs'.
 */
export async function addToLibrary({ root, kind, path, brand = null, title, licence, origin = 'upload', addedFrom = null }) {
  checkKind(kind);
  const source = typeof path === 'string' ? path.trim() : '';
  if (!source || !isAbsolute(source)) throw new Error('The audio file path must be absolute.');
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('The audio file could not be found.');
  if (!AUDIO_EXTENSIONS.has(extname(source).toLowerCase())) throw new Error('Audio must be an mp3, wav, m4a or aac file.');
  const info = await probeFile(source);
  if (!info.has_audio || !info.duration) throw new Error('That file does not contain audio.');
  const tag = typeof brand === 'string' && brand.trim() ? brand.trim() : null;
  if (tag && !libraryBrands(root).some(entry => entry.slug === tag)) throw new Error(`Brand not found: ${tag}`);

  const sha256 = sha256Of(source);
  const all = readAll(root);
  const same = all.find(entry => entry.kind === kind && entry.sha256 === sha256);
  if (same) {
    if (!same.legacy && tag && !same.brands.includes(tag)) {
      const own = readJson(indexFile(root), []);
      writeJson(indexFile(root), own.map(entry => (entry.id === same.id ? { ...entry, brands: [...new Set([...(entry.brands || [entry.brand].filter(Boolean)), tag])] } : entry)));
      same.brands.push(tag);
    }
    return { item: same, saved: false };
  }
  const dir = join(libraryDir(root), kind);
  mkdirSync(dir, { recursive: true });
  const id = `${kind === 'voice' ? 'v' : 'm'}-${sha256.slice(0, 8)}`;
  const file = `${id}-${safeFileName(source)}`;
  copyFileSync(source, join(dir, file));
  const entry = {
    id, kind,
    title: (typeof title === 'string' && title.trim()) || tidyTitle(source),
    file, sha256, seconds: Math.round(info.duration),
    licence: (typeof licence === 'string' && licence.trim()) || (origin === 'elevenlabs' ? ELEVEN_LABS_LICENCE : DEFAULT_LICENCE),
    brand: tag, brands: tag ? [tag] : [], origin, addedFrom, addedAt: new Date().toISOString(),
  };
  const own = readJson(indexFile(root), []);
  writeJson(indexFile(root), [...(Array.isArray(own) ? own : []), entry]);
  return { item: { ...entry, dir, legacy: false }, saved: true };
}
