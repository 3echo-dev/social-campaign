/**
 * Brand footage digest: a small layer on the footage library (brand-footage.mjs) that turns what a brand's folders hold into the
 * parts of the brand the person already keeps: its kit and its library bank.
 *
 *   fonts    A font file's family is read from its own name table when the folder is indexed. When the brand kit has no fonts yet, the
 *            families found go straight into it (the person still confirms the kit with Save and continue, as for any kit). When the
 *            kit has fonts, the new families are only offered, and `adoptFromFootage` adds the ones the person said yes to.
 *   logos    A picture whose file name says logo, or that a model looked at and saw is a logo, is offered for the logo slot. A kit that
 *            already has a logo keeps it unless the person says to replace it.
 *   photos   Pictures that were looked at and are not logos are offered for "Photos of your world". They are added, never replacing
 *            the photos the person chose (the brand keeps up to 5), and only on the person's yes.
 *   bank     When a video (or picture) is described, its hook, style, shot types and on-screen text go to the brand's bank/proven.jsonl
 *            as the brand's own, with the footage file as the evidence (no link, no path: see evidenceOf in brand-library.mjs).
 *
 * Rights stay as imported: a file in a `never` folder is never described, offered or fed anywhere, and when a folder becomes never or
 * leaves the list, the bank items learned from its files are taken out again (`reconcileBank`).
 *
 * Besides the footage folder's own files, this writes `digest.json` (what was added by itself and what the person passed on) and, only
 * for a logo that is too big for the kit, a small converted copy under `logos/`. The originals are never touched.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, extname, join } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { readJson, writeJsonAtomic } from '../lib/jsonl.mjs';
import { log } from '../lib/log.mjs';
import { run as runBinary } from '../media/probe.mjs';
import { FONT_LIMIT } from '../brand-kit/fonts.mjs';
import { addToBank, readBank, removeBankItem } from './brand-library.mjs';
import { BRAND_REFERENCES_MAX, referenceAssets } from './brand-references.mjs';
import {
  footageDir, footageFiles, groupFontFamilies, importFolder, searchFootage, startFolderIndex,
} from './brand-footage.mjs';
import * as runtime from './runtime.mjs';

const require = createRequire(import.meta.url);
const libBrandKit = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-kit.js'));
const libBrandProfile = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));

/** Hooks, styles, shot types and on-screen lines fed to the bank from one file. */
export const FEED_LIMITS = Object.freeze({ shotTypes: 3, onScreenText: 2 });
/** The most picture candidates offered for "Photos of your world", and logo candidates for the logo slot. */
export const OFFER_LIMITS = Object.freeze({ photos: 12, logos: 6 });
/** The longest edge of a logo converted to fit the kit, then its thumbnail's height. */
const LOGO_EDGES = Object.freeze([1024, 640, 384]);
const LOGO_THUMB_HEIGHTS = Object.freeze([96, 64]);
const KIT_LOGO_MAX_BYTES = 256 * 1024;
const KIT_LOGO_THUMB_MAX_BYTES = 12 * 1024;
const KIT_LOGO_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const FONT_USES = ['headings', 'body', 'captions', 'other'];
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,79}$/;
const LOGO_WORDS = new Set(['logo', 'logos', 'logotype', 'logomark', 'wordmark', 'brandmark', 'lockup', 'monogram']);
const NOT_LOGO_SUFFIX = /(catalogo|dialogo|analogo|apologo|monologo|travelogo)$/;

const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
const unique = list => [...new Set(list)];

// ---------------------------------------------------------------- the brand and its kit
function brandEntry(root, brand) {
  const entry = runtime.listBrands({ root }).find(item => item.slug === brand);
  if (!entry) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return entry;
}

/**
 * What the kit holds now: { status, draft, fonts: [{family, use}], hasLogo, photosSaved }. A kit that is still pending (the person has
 * not saved it yet) is a draft: parts are added to what the person provided, and nothing is confirmed for them. Any other kit is
 * changed through a kit save.
 */
export function kitState(root, brand) {
  const entry = brandEntry(root, brand);
  const status = libBrandKit.status(entry.path);
  const record = libBrandKit.read(entry.path);
  const profile = (() => { try { return libBrandProfile.read(entry.path); } catch { return null; } })();
  const draft = status === 'pending';
  let fonts;
  let hasLogo;
  if (draft) {
    const provided = record?.provided;
    fonts = provided && Array.isArray(provided.fonts) && provided.fonts.length ? provided.fonts : (record?.proposed?.fonts ?? []);
    hasLogo = Boolean(provided?.logo);
  } else {
    fonts = record?.confirmed?.fonts ?? profile?.visualIdentity?.fonts ?? [];
    hasLogo = Boolean(record?.confirmed?.logo) || (Array.isArray(profile?.assets) && profile.assets.some(asset => asset?.kind === 'logo'));
  }
  return {
    status, draft, path: entry.path,
    fonts: (Array.isArray(fonts) ? fonts : []).filter(font => font && typeof font.family === 'string').map(font => ({ family: font.family, use: font.use })),
    hasLogo,
    photosSaved: referenceAssets(profile?.assets ?? profile?.brandAssets).length,
  };
}

// ---------------------------------------------------------------- what the person passed on, and what was added by itself
const stateFile = (root, brand) => join(footageDir(root, brand), 'digest.json');

function readState(root, brand) {
  const saved = readJson(stateFile(root, brand), {}) || {};
  const list = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
  return { addedFonts: list(saved.addedFonts), passedFonts: list(saved.passedFonts), passedFiles: list(saved.passedFiles) };
}
function writeState(root, brand, state) {
  writeJsonAtomic(stateFile(root, brand), { addedFonts: unique(state.addedFonts), passedFonts: unique(state.passedFonts), passedFiles: unique(state.passedFiles) });
}
const key = family => String(family).trim().toLowerCase();

// ---------------------------------------------------------------- fonts
/** A family name the kit accepts, or null: accents are folded and anything else the kit would refuse is dropped. */
export function kitFamily(name) {
  const text = clip(String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._'-]/g, ' '), 80);
  return FAMILY_PATTERN.test(text) ? text : null;
}

function foundFamilies(views) {
  return groupFontFamilies(views.map(view => ({ id: view.fileId, kind: view.kind, font: view.font, rights: view.rights })))
    .map(row => ({ ...row, kit: kitFamily(row.family) })).filter(row => row.kit);
}

/** The uses a new run of fonts take: the first uses the kit does not have yet. */
function usesFor(existing, count) {
  const taken = new Set(existing.map(font => font.use));
  const out = [];
  for (const use of FONT_USES) { if (out.length < count && !taken.has(use)) out.push(use); }
  while (out.length < count) out.push('other');
  return out;
}

function applyFonts({ root, brand, families, now }) {
  const state = kitState(root, brand);
  const room = Math.max(0, FONT_LIMIT - state.fonts.length);
  const fresh = families.filter(family => !state.fonts.some(font => key(font.family) === key(family))).slice(0, room);
  const skipped = families.filter(family => !fresh.includes(family) && !state.fonts.some(font => key(font.family) === key(family)));
  if (!fresh.length) return { added: [], skipped };
  const uses = usesFor(state.fonts, fresh.length);
  const added = fresh.map((family, index) => ({ family, use: uses[index] }));
  if (state.draft) {
    libBrandKit.addProvided(state.path, { fonts: added, source: 'footage' }, { now });
  } else {
    const requestId = `footage-fonts-${createHash('sha256').update(added.map(font => key(font.family)).join('|')).digest('hex').slice(0, 20)}`;
    runtime.saveBrandKit({ root, brand, requestId, kit: { fonts: [...state.fonts, ...added] }, confirmedBy: 'footage' });
  }
  return { added: added.map(font => font.family), skipped };
}

/**
 * After a folder is indexed: when the kit has no fonts, the families found go into it. Families the person passed on, and families
 * already added once, are not added again. Returns { added[] } (nothing when the kit already has fonts or nothing new was found).
 */
export function syncKitFonts({ root, brand, now } = {}) {
  const state = kitState(root, brand);
  if (state.fonts.length) return { added: [] };
  const saved = readState(root, brand);
  const families = foundFamilies(footageFiles({ root, brand })).filter(row => !saved.passedFonts.includes(key(row.kit)) && !saved.addedFonts.includes(key(row.kit)));
  if (!families.length) return { added: [] };
  const out = applyFonts({ root, brand, families: families.slice(0, FONT_LIMIT).map(row => row.kit), now });
  if (out.added.length) writeState(root, brand, { ...saved, addedFonts: [...saved.addedFonts, ...out.added.map(key)] });
  return { added: out.added };
}

// ---------------------------------------------------------------- logos and photos
const camelSplit = value => String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** Whether a file's name says it is a logo (Acme_Logo_Final.png, acme-logo.png, AcmeLogo.png, wordmark.png). */
export function looksLikeLogoName(fileName) {
  const stem = basename(String(fileName), extname(String(fileName)));
  const tokens = camelSplit(stem).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some(token => LOGO_WORDS.has(token) || (token.length > 4 && token.length <= 24 && token.endsWith('logo') && !NOT_LOGO_SUFFIX.test(token)));
}

const isPicture = view => view.kind === 'image' && !view.missing;
const readOf = view => view.full ?? view.quick ?? null;
const sawLogo = view => Boolean(view.quick?.isLogo || view.full?.isLogo);

function logoCandidates(views, { passed }) {
  return views.filter(view => isPicture(view) && view.rights !== 'never' && !passed.includes(view.fileId) && (looksLikeLogoName(view.name) || sawLogo(view)))
    .sort((a, b) => Number(sawLogo(b)) - Number(sawLogo(a)) || Number(extname(b.name).toLowerCase() === '.png') - Number(extname(a.name).toLowerCase() === '.png') || (b.width ?? 0) - (a.width ?? 0) || a.name.localeCompare(b.name, 'en'))
    .slice(0, OFFER_LIMITS.logos)
    .map(view => ({
      fileId: view.fileId, name: view.name, why: sawLogo(view) ? 'it looks like a logo' : 'its file name says logo', rights: view.rights, folder: view.folder.label,
      ...(view.width ? { width: view.width, height: view.height } : {}), thumbnail: view.thumbnail,
      usable: KIT_LOGO_TYPES.has(extname(view.name).toLowerCase()),
    }));
}

function photoCandidates(views, { passed, logoIds }) {
  return views.filter(view => isPicture(view) && view.rights !== 'never' && !passed.includes(view.fileId) && !logoIds.has(view.fileId) && KIT_LOGO_TYPES.has(extname(view.name).toLowerCase()) && view.analysed !== 'none' && !readOf(view)?.isLogo)
    .map(view => {
      const read = readOf(view);
      const score = (read?.products?.length ? 2 : 0) + (read?.logoVisible ? -1 : 0) + ((view.width ?? 0) >= 1000 ? 1 : 0) + (view.analysed === 'full' ? 1 : 0);
      return { view, score };
    })
    .sort((a, b) => b.score - a.score || a.view.name.localeCompare(b.view.name, 'en'))
    .slice(0, OFFER_LIMITS.photos)
    .map(({ view }) => {
      const read = readOf(view);
      return {
        fileId: view.fileId, name: view.name, rights: view.rights, folder: view.folder.label, summary: clip(read?.summary || read?.opening || '', 200),
        ...(read?.products?.length ? { products: read.products } : {}), ...(read?.mood ? { mood: read.mood } : {}), ...(read?.logoVisible ? { logoVisible: true } : {}),
        ...(view.width ? { width: view.width, height: view.height } : {}), thumbnail: view.thumbnail,
      };
    });
}

// ---------------------------------------------------------------- the report
/** "12 videos, 40 photos, 2 fonts: Montserrat, Playfair": what the folders hold, in plain words. */
export function plainCounts(counts, families) {
  const parts = [];
  if (counts.video) parts.push(plural(counts.video, 'video'));
  if (counts.image) parts.push(plural(counts.image, 'photo'));
  if (counts.audio) parts.push(plural(counts.audio, 'audio file'));
  if (counts.font) {
    const names = families.map(row => row.family);
    const many = counts.font !== names.length;
    parts.push(names.length ? `${many ? `${plural(counts.font, 'font file')} in ${plural(names.length, 'family', 'families')}` : plural(names.length, 'font')}: ${names.join(', ')}` : plural(counts.font, 'font file'));
  }
  return parts.join(', ');
}

/**
 * What the brand's folders hold and what could go into the brand from them, without changing anything:
 * { brand, summary, counts, fonts: { found[], inKit[], added[], offer[] }, logos: { kitHasLogo, offer[] },
 *   photos: { saved, room, offer[], notLookedAt }, bank: { fromFootage }, pending, message }.
 * `never` files are left out of every offer.
 */
export function footageDigest({ root, brand } = {}) {
  const views = footageFiles({ root, brand });
  const kit = kitState(root, brand);
  const saved = readState(root, brand);
  const counts = { files: views.length, video: 0, image: 0, audio: 0, font: 0 };
  for (const view of views) if (view.kind in counts) counts[view.kind] += 1;
  const families = foundFamilies(views);
  const offerFonts = families.filter(row => !kit.fonts.some(font => key(font.family) === key(row.kit)) && !saved.passedFonts.includes(key(row.kit)));
  const logos = kit.hasLogo ? [] : logoCandidates(views, { passed: saved.passedFiles });
  const photos = photoCandidates(views, { passed: saved.passedFiles, logoIds: new Set(logoCandidates(views, { passed: [] }).map(item => item.fileId)) });
  const room = Math.max(0, BRAND_REFERENCES_MAX - kit.photosSaved);
  const usable = views.filter(view => view.rights !== 'never' && !view.missing);
  const bankItems = readBank({ root, brand, bank: 'proven', ranked: false }).filter(item => item.evidence?.file);
  const notLookedAt = usable.filter(view => ['video', 'image'].includes(view.kind) && view.analysed === 'none').length;
  const lines = [];
  if (!counts.files) lines.push('No footage has been indexed yet.');
  else lines.push(`The folders hold ${plainCounts(counts, families)}.`);
  if (notLookedAt) lines.push(`${plural(notLookedAt, 'video or photo', 'videos and photos')} ${notLookedAt === 1 ? 'has' : 'have'} not been looked at yet.`);
  if (saved.addedFonts.length) lines.push(`Fonts added to the brand kit from the folders: ${saved.addedFonts.map(name => families.find(row => key(row.kit) === name)?.kit ?? name).join(', ')}.`);
  if (offerFonts.length && kit.fonts.length) lines.push(`Fonts in the folders that the kit does not have: ${offerFonts.map(row => row.kit).join(', ')}. Ask the person before adding them.`);
  if (logos.length) lines.push(`${plural(logos.length, 'file')} could be the logo (${logos.map(item => item.name).join(', ')}). Ask the person before using one.`);
  if (photos.length && room) lines.push(`${plural(photos.length, 'looked-at photo')} could be Photos of your world, with room for ${room} more. Ask the person which to add.`);
  if (kit.photosSaved >= BRAND_REFERENCES_MAX) lines.push('The brand already has all 5 of its Photos of your world, so none are added.');
  return {
    brand,
    summary: plainCounts(counts, families),
    counts,
    fonts: {
      found: families.map(row => ({ family: row.kit, files: row.files, styles: row.styles, rights: row.rights })),
      inKit: kit.fonts.map(font => font.family),
      added: saved.addedFonts.map(name => families.find(row => key(row.kit) === name)?.kit ?? name),
      offer: kit.fonts.length ? offerFonts.map(row => ({ family: row.kit, files: row.files })) : [],
    },
    logos: { kitHasLogo: kit.hasLogo, offer: logos },
    photos: { saved: kit.photosSaved, room, offer: room ? photos : [], notLookedAt },
    bank: { fromFootage: bankItems.length },
    message: lines.join(' '),
  };
}

// ---------------------------------------------------------------- the bank
const dateOf = view => (typeof view.modified === 'string' && /^\d{4}-\d{2}-\d{2}/.test(view.modified) ? view.modified.slice(0, 10) : null);
const firstSentence = text => clip(String(text ?? '').split(/(?<=[.!?])\s+/)[0], 160);

/**
 * The lines a described file gives the bank, as { kind, text }: the hook (the spoken opening when no hook was written), the style, up to
 * 3 shot types as formats and up to 2 on-screen lines as captions. A picture gives its style only.
 */
export function bankLinesOf(view) {
  const read = view.full ?? view.quick;
  if (!read) return [];
  const lines = [];
  const add = (kind, text) => { const words = clip(text, 200); if (words.length >= 3 && !lines.some(line => line.kind === kind && line.text.toLowerCase() === words.toLowerCase())) lines.push({ kind, text: words }); };
  if (view.kind === 'video') {
    add('hook', view.full?.hook || view.quick?.hook || firstSentence(view.quick?.spoken));
  }
  add('style', read.style);
  if (view.kind === 'video') {
    for (const shot of (read.shotTypes ?? []).slice(0, FEED_LIMITS.shotTypes)) add('format', shot.charAt(0).toUpperCase() + shot.slice(1));
    for (const text of (view.full?.onScreenText ?? []).slice(0, FEED_LIMITS.onScreenText)) add('caption', text);
  }
  return lines;
}

/**
 * Put what a described file shows into the brand's bank/proven.jsonl as the brand's own, with the file as the evidence. A file in a
 * `never` folder, a font and a file that has not been described give nothing. Saving again changes nothing (the same words are one
 * item). Returns { fileId, added: [{kind, text}], already: n, skipped? }.
 */
export function feedBank({ root, brand, fileId, now } = {}) {
  const found = searchFootage({ root, brand, fileId, rights: 'all' }).results[0];
  if (found.rights === 'never') return { fileId, added: [], already: 0, skipped: 'In a folder marked never use.' };
  if (!['video', 'image'].includes(found.kind)) return { fileId, added: [], already: 0, skipped: 'Only videos and pictures are read for the bank.' };
  const evidence = { file: { fileId, name: found.name, kind: found.kind, folder: found.folder.label }, date: dateOf(found) };
  const added = [];
  let already = 0;
  for (const line of bankLinesOf(found)) {
    const out = addToBank({ root, brand, bank: 'proven', kind: line.kind, text: line.text, evidence, source: 'brand', now });
    if (out.saved) added.push(line); else already += 1;
  }
  return { fileId, added, already };
}

/**
 * Take out the bank items learned from footage that can no longer be used: files whose folder became never or left the list.
 * Returns { removed: n }.
 */
export function reconcileBank({ root, brand, now } = {}) {
  const usable = new Set(footageFiles({ root, brand }).filter(view => view.rights !== 'never').map(view => view.fileId));
  let removed = 0;
  for (const item of readBank({ root, brand, bank: 'proven', ranked: false })) {
    const id = item.evidence?.file?.fileId;
    if (id && !usable.has(id) && removeBankItem({ root, brand, bank: 'proven', id: item.id, now }).removed) removed += 1;
  }
  return { removed };
}

// ---------------------------------------------------------------- importing
/**
 * Bring a folder in and start reading it, and when it has been read put its fonts into a kit that has none. The same call the
 * brand_footage_import tool and the board's brand_folder_add request make. Returns { folder, created, revived, run, done, outcome }:
 * `done` resolves (never rejects) once the folder is indexed and the fonts are placed; `outcome.fonts` is { added[] } by then.
 */
export function importAndDigest({ root, brand, folder, rights, label = null, now } = {}) {
  const imported = importFolder({ root, brand, folder, rights, label, now });
  const run = startFolderIndex({ root, brand, folderId: imported.folder.id, now });
  const outcome = { fonts: { added: [] } };
  const done = run.done
    .then(() => { outcome.fonts = syncKitFonts({ root, brand, now }); })
    .catch(error => { log.warn('footage fonts could not be added to the kit', { brand, error: String(error) }); });
  return { ...imported, run, done, outcome };
}

// ---------------------------------------------------------------- adopting what the person said yes to
async function convertPng(input, output, { edge, height }) {
  mkdirSync(join(output, '..'), { recursive: true });
  const filter = edge ? `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease:flags=lanczos` : `scale=-2:'min(${height},ih)':flags=lanczos`;
  await runBinary('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', filter, '-pix_fmt', 'rgba', output], { timeoutMs: 30_000 });
  return existsSync(output) ? statSync(output).size : 0;
}

/**
 * The logo file the kit accepts for a footage picture: the original when it is a PNG, JPEG or WebP of at most 256 KiB, otherwise a
 * converted PNG copy under footage/logos/ (ffmpeg), plus a small thumbnail for the board. Returns { path, thumbPath|null, converted }.
 */
async function logoFilesFor({ root, brand, view }) {
  const dir = join(footageDir(root, brand), 'logos');
  const original = view.path;
  const thumbPath = join(dir, `${view.fileId}-thumb.png`);
  let thumb = null;
  for (const height of LOGO_THUMB_HEIGHTS) {
    try { if ((await convertPng(original, thumbPath, { height })) && statSync(thumbPath).size <= KIT_LOGO_THUMB_MAX_BYTES) { thumb = thumbPath; break; } } catch { /* a thumbnail is optional */ }
  }
  if (KIT_LOGO_TYPES.has(extname(original).toLowerCase()) && statSync(original).size <= KIT_LOGO_MAX_BYTES) return { path: original, thumbPath: thumb, converted: false };
  const target = join(dir, `${view.fileId}.png`);
  for (const edge of LOGO_EDGES) {
    let size = 0;
    try { size = await convertPng(original, target, { edge }); } catch (error) {
      throw new InvalidInputError('That logo file is too big for the brand kit and could not be made smaller on this computer.', { fix: 'Ask the person to upload the logo on the board instead.', details: { reason: String(error?.message || error) } });
    }
    if (size && size <= KIT_LOGO_MAX_BYTES) return { path: target, thumbPath: thumb, converted: true };
  }
  throw new InvalidInputError('That logo file is too big for the brand kit, even made smaller.', { fix: 'Ask the person to upload the logo on the board instead.' });
}

function usableView(views, fileId, what) {
  const view = views.find(item => item.fileId === fileId);
  if (!view) throw new InvalidInputError(`That ${what} is not in this brand's footage.`, { fix: 'Use a fileId from brand_footage_digest.' });
  if (view.rights === 'never') throw new InvalidInputError(`That ${what} is in a folder the person marked never use, so it is not used.`);
  if (view.missing || !view.path) throw new InvalidInputError(`That ${what} could not be found in its folder. The folder may have moved.`, { fix: 'Ask the person for the new place and use brand_footage_folder (action relink).' });
  return view;
}

/**
 * Do what the person said yes to, and remember what they passed on so it is not asked again.
 *   fonts        family names from the digest's fonts.offer (or found): added to the kit up to 4 fonts, never replacing one.
 *   logoFileId   a picture from the digest's logos.offer for the logo slot; refused when the kit has a logo unless replaceLogo is true.
 *   photoFileIds pictures for Photos of your world: added up to the brand's 5, never replacing the photos the person chose.
 *   pass         { fonts?: [family], files?: [fileId] }: the person said no to these.
 * Returns { fonts?, logo?, photos?, passed?, message }.
 */
export async function adoptFromFootage({ root, brand, fonts = null, logoFileId = null, replaceLogo = false, photoFileIds = null, pass = null, now } = {}) {
  const out = {};
  const saved = readState(root, brand);
  const views = footageFiles({ root, brand });
  const notes = [];

  if (Array.isArray(fonts) && fonts.length) {
    const found = foundFamilies(views);
    const rows = fonts.map(name => found.find(row => key(row.kit) === key(name) || key(row.family) === key(name)));
    const unknown = fonts.filter((_name, index) => !rows[index]);
    if (unknown.length) throw new InvalidInputError(`These fonts are not in the brand's folders: ${unknown.join(', ')}.`, { fix: 'Use the family names from brand_footage_digest.' });
    const result = applyFonts({ root, brand, families: unique(rows.map(row => row.kit)), now });
    saved.addedFonts.push(...result.added.map(key));
    out.fonts = result;
    if (result.added.length) notes.push(`Added ${result.added.join(', ')} to the fonts.`);
    else if (!result.skipped.length) notes.push('Those fonts were already in the kit.');
    if (result.skipped.length) notes.push(`The kit holds ${FONT_LIMIT} fonts at most, so ${result.skipped.join(', ')} ${result.skipped.length === 1 ? 'was' : 'were'} not added.`);
  }

  if (logoFileId) {
    const state = kitState(root, brand);
    if (state.hasLogo && replaceLogo !== true) throw new InvalidInputError('The brand already has a logo.', { fix: 'Ask the person whether to replace it, and pass replaceLogo true only on their yes.' });
    const view = usableView(views, logoFileId, 'logo');
    if (view.kind !== 'image') throw new InvalidInputError('The logo has to be a picture.');
    const files = await logoFilesFor({ root, brand, view });
    const logo = { action: 'file', path: files.path, ...(files.thumbPath ? { thumbPath: files.thumbPath } : {}) };
    if (state.draft) {
      const checked = libBrandKit.validateKitInput({ logo });
      if (!checked.ok) throw new InvalidInputError(`That logo could not be used: ${checked.errors.join(' ')}`);
      libBrandKit.addProvided(state.path, { logo: checked.normalized.logo, source: 'footage' }, { now });
    } else {
      const requestId = `footage-logo-${createHash('sha256').update(`${logoFileId}|${Date.now()}`).digest('hex').slice(0, 20)}`;
      runtime.saveBrandKit({ root, brand, requestId, kit: { logo }, confirmedBy: 'footage' });
    }
    out.logo = { fileId: logoFileId, name: view.name, converted: files.converted, replaced: state.hasLogo };
    notes.push(`${view.name} is now the logo${files.converted ? ' (made smaller to fit)' : ''}.`);
  }

  if (Array.isArray(photoFileIds) && photoFileIds.length) {
    const state = kitState(root, brand);
    const room = Math.max(0, BRAND_REFERENCES_MAX - state.photosSaved);
    const picked = unique(photoFileIds).map(fileId => usableView(views, fileId, 'photo'));
    if (picked.some(view => view.kind !== 'image')) throw new InvalidInputError('Photos of your world have to be pictures.');
    if (!room) {
      out.photos = { saved: 0, skipped: picked.map(view => ({ name: view.name, reason: `A brand keeps up to ${BRAND_REFERENCES_MAX} photos, and it has them already. The ones the person chose stay.` })) };
    } else {
      const result = runtime.saveBrandReferences({ root, brand, files: picked.map(view => ({ path: view.path, fileName: view.name })) });
      out.photos = { saved: result.saved, skipped: result.skipped };
    }
    notes.push(out.photos.saved ? `Added ${plural(out.photos.saved, 'photo')} to Photos of your world.` : 'No photo was added.');
  }

  if (pass && typeof pass === 'object') {
    const passedFonts = (Array.isArray(pass.fonts) ? pass.fonts : []).map(key);
    const passedFiles = (Array.isArray(pass.files) ? pass.files : []).filter(id => typeof id === 'string');
    saved.passedFonts.push(...passedFonts);
    saved.passedFiles.push(...passedFiles);
    out.passed = { fonts: passedFonts.length, files: passedFiles.length };
    notes.push('Noted. They will not be offered again.');
  }

  writeState(root, brand, saved);
  return { ...out, message: notes.join(' ') || 'Nothing to add.' };
}
