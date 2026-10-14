/**
 * Brand footage: a brand's archive of past videos, pictures and audio, kept as a searchable list beside its library so repurpose
 * jobs can start from what the brand already has.
 *
 *   workspaces/<brand>/library/footage/
 *     folders.jsonl       {id, path, rights: 'ours'|'client_ask'|'never', label?, at, changedAt?, removed?}   each folder the person imported
 *     index.jsonl         {id, folderId, relPath, sha256, kind: video|image|audio|font, bytes, mtime, durationSec?, width?, height?, thumb?,
 *                          font?: {family, style?, fullName?, format}, at, alsoAt?}
 *     analysis/<id>.json  {fileId, sha256, quick?: {...}, full?: {...}, wantFull?, markedAt?, updatedAt}   what was seen, in two stages
 *     progress/<folderId>.json   how far indexing a folder got (resumable)
 *     thumbs/<id>.jpg     the only files written next to the list: one small picture per video or image
 *
 * The originals are never copied, moved or changed. A file is found again by its place in its folder (relPath under the folder's
 * path), so when a folder moves the files show as missing and the person is asked for the new place (the `relink` action), not lost.
 *
 * Indexing is local and free: it lists the folder (server/media/inventory.mjs), hashes each file (sha256), reads its length and size
 * (ffprobe) and makes a thumbnail (ffmpeg); there is no model call. A font file (.ttf, .otf, .woff, .woff2) is indexed too: its family
 * is read from its own name table (server/media/font-name.mjs). A font is never described by a model and is offered to the brand kit
 * by brand-footage-digest.mjs. A file is one record per content: a copy of the same bytes in
 * another place (another folder, or another name) is not a second file, it is one more place in `alsoAt` of the first. The id is
 * `m-` and the first 16 characters of the sha256, so the same content has the same id everywhere and its analysis stays with it.
 * Both line files are only ever appended to: a change appends the whole record again with the same id, and a read keeps the last
 * line of each id.
 *
 * Indexing runs in batches (BATCH_SIZE files), one folder of a brand at a time, in the background of the server process. After each
 * batch the new records are appended and progress/<folderId>.json is rewritten, so a stop (the app closed, the machine slept) loses
 * at most one batch. Running it again on the same folder is safe and cheap: a file whose place, size and modified time are already
 * in the list is skipped without being read, so it only does what is left and picks up new files.
 *
 * Analysis comes in two stages and is written by an agent that looked at the file (the model work is the agent's; this module only
 * keeps it):
 *   quick  {opening, spoken?, hook?, style?, products?, mood?, shotTypes?, scenes?, logoVisible?, isLogo?}   the opening seconds and the first
 *          spoken words (for a picture: what is in it)
 *   full   {summary, hook?, style?, scenes: [{start, end, description, shotType?}], shotTypes, products, mood, onScreenText,
 *           spoken?, usableMoments: [{start, end, what, why?}], logoVisible?, isLogo?}   a full breakdown with timecodes in seconds
 * The person marks the files that get a full breakdown (`wantFull`), and the agent tells them what it costs before it starts.
 *
 * Rights. Every folder carries one: ours (free to use), client_ask (ask the person before posting) or never (never use). A file
 * that sits in more than one place takes the strictest of them. A search leaves out `never` files unless it asks for them, every
 * result and every line in a brief carries its rights, and a `never` file is never analysed.
 */

import { existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { InvalidInputError } from '../lib/errors.mjs';
import { appendLines, readJson, readLines, writeJsonAtomic } from '../lib/jsonl.mjs';
import { log } from '../lib/log.mjs';
import { isTooBroadSourceFolder } from '../lib/paths.mjs';
import { sha256File } from '../media/hash.mjs';
import { inventoryFolder } from '../media/inventory.mjs';
import { readFontNames } from '../media/font-name.mjs';
import { KNOWN_TYPES, detectType } from '../media/mime.mjs';
import { probeFile } from '../media/probe.mjs';
import { extractThumbnail } from '../media/frames.mjs';

export const RIGHTS = Object.freeze(['ours', 'client_ask', 'never']);
export const FOOTAGE_KINDS = Object.freeze(['video', 'image', 'audio', 'font']);
/** The kinds a model can look at. A font is read from its name table instead. */
export const LOOKABLE_KINDS = Object.freeze(['video', 'image', 'audio']);
export const FONT_EXTENSIONS = Object.freeze(['.ttf', '.otf', '.woff', '.woff2']);
/** The footage kind an extension stands for, or undefined. */
const kindOfExtension = extension => (FONT_EXTENSIONS.includes(extension) ? 'font' : KNOWN_TYPES[extension]?.kind);
export const STAGES = Object.freeze(['quick', 'full']);
export const RIGHTS_WORDS = Object.freeze({ ours: 'ours to use', client_ask: 'ask the person before posting', never: 'never use' });
const RIGHTS_NOTES = Object.freeze({
  ours: 'Ours to use.',
  client_ask: 'Ask the person before posting this.',
  never: 'The person said never use this.',
});
const RIGHTS_ORDER = Object.freeze({ ours: 0, client_ask: 1, never: 2 });

/** Files indexed between two progress records. */
export const BATCH_SIZE = 25;
/** The most files read from one folder. */
export const MAX_FILES_PER_FOLDER = 50_000;
/** How long the board and the briefs reuse the counts (the missing check looks at every file). */
export const SUMMARY_CACHE_MS = 30_000;

const TEXT = Object.freeze({ short: 120, line: 300, opening: 600, summary: 800, spoken: 1500, style: 120 });
const ERROR_LIMIT = 20;

// ---------------------------------------------------------------- small helpers
const isoOf = now => {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
const round2 = value => Math.round(value * 100) / 100;
const isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } };
const yieldToLoop = () => new Promise(done => setImmediate(done));
const canonical = path => {
  let value = resolve(String(path));
  try { value = realpathSync.native(value); } catch { /* a place that is gone is compared as written */ }
  value = value.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
};
const samePath = (a, b) => canonical(a) === canonical(b);
const strictest = (a, b) => (RIGHTS_ORDER[b] > RIGHTS_ORDER[a] ? b : a);

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
function brandDirOf(root, brand) {
  const slug = typeof brand === 'string' ? brand.trim() : '';
  if (!SLUG.test(slug)) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return join(resolve(String(root || '')), 'workspaces', slug);
}

/** The brand's footage folder. Reading a brand with no footage finds it empty. */
export function footageDir(root, brand) {
  return join(brandDirOf(root, brand), 'library', 'footage');
}

function requireBrand(root, brand) {
  const dir = brandDirOf(root, brand);
  if (!existsSync(join(dir, 'workspace.json'))) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return join(dir, 'library', 'footage');
}

// ---------------------------------------------------------------- reading the line files
const FOLD_CACHE = new Map();

/** The last line of each id, in the order the ids first appeared. The map is shared: do not change it. */
function foldFile(file) {
  let stats;
  try { stats = statSync(file); } catch { return new Map(); }
  const hit = FOLD_CACHE.get(file);
  if (hit && hit.size === stats.size && hit.mtimeMs === stats.mtimeMs) return hit.map;
  const map = new Map();
  for (const line of readLines(file)) if (typeof line.id === 'string' && line.id) map.set(line.id, line);
  FOLD_CACHE.set(file, { size: stats.size, mtimeMs: stats.mtimeMs, map });
  return map;
}

const foldersFile = dir => join(dir, 'folders.jsonl');
const indexFile = dir => join(dir, 'index.jsonl');
const analysisFile = (dir, fileId) => join(dir, 'analysis', `${fileId}.json`);
const progressFile = (dir, folderId) => join(dir, 'progress', `${folderId}.json`);

const SUMMARY_CACHE = new Map();
const bust = dir => { SUMMARY_CACHE.delete(dir); };

const locationsOf = record => [
  ...(record.folderId && record.relPath ? [{ folderId: record.folderId, relPath: record.relPath, mtime: record.mtime ?? null }] : []),
  ...(Array.isArray(record.alsoAt) ? record.alsoAt.filter(loc => loc && loc.folderId && loc.relPath) : []),
];
const locKey = (folderId, relPath) => `${folderId}\u0000${relPath}`;

/** The record with its places replaced. The first place is the main one. */
function withLocations(record, locations) {
  const { alsoAt: _old, ...rest } = record;
  const [first, ...others] = locations;
  return {
    ...rest,
    folderId: first ? first.folderId : null,
    relPath: first ? first.relPath : null,
    mtime: first ? first.mtime ?? null : null,
    ...(others.length ? { alsoAt: others } : {}),
  };
}

/** Every analysis file in the folder, by file id. */
function readAnalysisDocs(dir) {
  const out = new Map();
  let names = [];
  try { names = readdirSync(join(dir, 'analysis')).filter(name => name.endsWith('.json')); } catch { return out; }
  for (const name of names) {
    const doc = readJson(join(dir, 'analysis', name));
    if (doc && typeof doc === 'object' && typeof doc.fileId === 'string') out.set(doc.fileId, doc);
  }
  return out;
}
const stageOf = doc => (doc?.full ? 'full' : doc?.quick ? 'quick' : 'none');

// ---------------------------------------------------------------- folders
const checkRights = rights => {
  if (!RIGHTS.includes(rights)) {
    throw new InvalidInputError('Say whose footage this is: ours (free to use), client_ask (ask the person before posting) or never (never use).', { fix: 'Ask the person, then pass rights.' });
  }
  return rights;
};

/** The folders the person imported, oldest first. Removed ones are left out unless asked for. */
export function readFolders({ root, brand, includeRemoved = false } = {}) {
  return [...foldFile(foldersFile(footageDir(root, brand))).values()].filter(folder => includeRemoved || !folder.removed);
}

const cleanPath = value => {
  const text = String(value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!text || !isAbsolute(text)) throw new InvalidInputError('Say which folder, with its full path on this computer (starting at the drive, for example C:\\Footage).');
  return resolve(text);
};

function folderGuards({ root, brand, path }) {
  if (!isDir(path)) throw new InvalidInputError('That folder could not be found. Please check the path and try again.');
  if (isTooBroadSourceFolder(path, root)) {
    throw new InvalidInputError('That folder is too broad to index. Choose a specific folder rather than the home directory, a drive root or the workspace root.');
  }
  const own = canonical(join(brandDirOf(root, brand), 'library'));
  const mine = canonical(path);
  const hidden = canonical(join(resolve(String(root)), '.social-campaign'));
  if (mine === own || mine.startsWith(`${own}${sep}`) || mine === hidden || mine.startsWith(`${hidden}${sep}`)) {
    throw new InvalidInputError('That folder is Social Campaign storage, not a media folder.');
  }
}

/**
 * A folder the person asked for on the board (the brand_folder_add request), checked the way importFolder will check it, without
 * writing anything: the brand exists, the rights are one of the three, the path is a full path and, when `live`, a real folder that is
 * not too broad or Social Campaign's own, and not already imported with other rights. Returns { brand, path, rights, label }.
 * Without `live` only the shape is checked, so a request can be saved before the folder is looked at.
 */
export function checkFolderRequest({ root, brand, folder, rights, label = null, live = true } = {}) {
  const dir = requireBrand(root, brand);
  checkRights(rights);
  const path = cleanPath(folder);
  const words = typeof label === 'string' && label.trim() ? clip(label, TEXT.short) : null;
  if (live) {
    folderGuards({ root, brand, path });
    const known = [...foldFile(foldersFile(dir)).values()].find(item => !item.removed && samePath(item.path, path));
    if (known && known.rights !== rights) {
      throw new InvalidInputError(`That folder is already added as "${RIGHTS_WORDS[known.rights]}".`, { fix: 'If the person wants different rights for it, change them with brand_footage_folder (action rights).' });
    }
  }
  return { brand, path, rights, label: words };
}

/**
 * Register a folder, or find it again. Returns { folder, created, revived }. A folder already imported keeps its rights: asking for
 * different rights is an error here, because changing whose footage it is belongs to the person (see changeFolder).
 */
export function importFolder({ root, brand, folder, rights, label = null, now } = {}) {
  const dir = requireBrand(root, brand);
  checkRights(rights);
  const path = cleanPath(folder);
  folderGuards({ root, brand, path });
  const words = typeof label === 'string' && label.trim() ? clip(label, TEXT.short) : null;
  const known = [...foldFile(foldersFile(dir)).values()].find(item => samePath(item.path, path));
  const at = isoOf(now);
  if (known && !known.removed) {
    if (known.rights !== rights) {
      throw new InvalidInputError(`That folder is already imported as "${RIGHTS_WORDS[known.rights]}".`, { fix: 'If the person wants different rights for it, change them with brand_footage_folder (action rights).' });
    }
    if (words && words !== known.label) {
      const next = { ...known, label: words, changedAt: at };
      appendLines(foldersFile(dir), [next]);
      bust(dir);
      return { folder: next, created: false, revived: false };
    }
    return { folder: known, created: false, revived: false };
  }
  if (known) {
    const { removed: _removed, ...rest } = known;
    const next = { ...rest, rights, ...(words ? { label: words } : {}), changedAt: at };
    appendLines(foldersFile(dir), [next]);
    bust(dir);
    return { folder: next, created: false, revived: true };
  }
  const next = { id: `f-${randomUUID().replace(/-/g, '').slice(0, 10)}`, path, rights, ...(words ? { label: words } : {}), at };
  appendLines(foldersFile(dir), [next]);
  bust(dir);
  return { folder: next, created: true, revived: false };
}

// ---------------------------------------------------------------- the place of every file
function makeEntry({ record, locs, doc }) {
  let rights = 'ours';
  for (const loc of locs) rights = strictest(rights, loc.folder.rights);
  let found;
  return {
    record, locs, doc, rights,
    /** The first place where the file is still found, or null. */
    presentLoc() {
      if (found === undefined) found = locs.find(loc => loc.present()) ?? null;
      return found;
    },
  };
}

/** Everything about the brand's footage as it is now. `presence` of each file is looked up when asked for. */
function snapshotOf(root, brand) {
  const dir = footageDir(root, brand);
  const active = new Map([...foldFile(foldersFile(dir)).entries()].filter(([, folder]) => !folder.removed));
  const folderOk = new Map([...active.values()].map(folder => [folder.id, isDir(folder.path)]));
  const analysis = readAnalysisDocs(dir);
  const entries = [];
  if (active.size) {
    for (const record of foldFile(indexFile(dir)).values()) {
      const locs = locationsOf(record).filter(loc => active.has(loc.folderId)).map(loc => {
        const folder = active.get(loc.folderId);
        const abs = join(folder.path, ...loc.relPath.split('/'));
        let present;
        return {
          ...loc, folder, abs,
          present() {
            if (present === undefined) {
              present = false;
              if (folderOk.get(folder.id)) {
                try { const stats = statSync(abs); present = stats.isFile() && (!Number.isFinite(record.bytes) || stats.size === record.bytes); } catch { present = false; }
              }
            }
            return present;
          },
        };
      });
      if (locs.length) entries.push(makeEntry({ record, locs, doc: analysis.get(record.id) ?? null }));
    }
  }
  return { dir, folders: [...active.values()], folderOk, entries, analysis };
}

const zeroCounts = () => ({
  folders: 0, files: 0, video: 0, image: 0, audio: 0, font: 0, videoSeconds: 0, analysedQuick: 0, analysedFull: 0, missing: 0,
  pendingQuick: 0, fullMarked: 0, pendingFull: 0, pendingFullSeconds: 0, ours: 0, client_ask: 0, never: 0,
});

function countsOf(snapshot) {
  const out = zeroCounts();
  out.folders = snapshot.folders.length;
  for (const entry of snapshot.entries) {
    const { record, doc, rights } = entry;
    out.files += 1;
    if (FOOTAGE_KINDS.includes(record.kind)) out[record.kind] += 1;
    if (record.kind === 'video' && Number.isFinite(record.durationSec)) out.videoSeconds += record.durationSec;
    out[rights] += 1;
    const stage = stageOf(doc);
    if (stage === 'full') out.analysedFull += 1;
    else if (stage === 'quick') out.analysedQuick += 1;
    const present = entry.presentLoc() !== null;
    if (!present) out.missing += 1;
    if (doc?.wantFull && stage !== 'full' && LOOKABLE_KINDS.includes(record.kind)) {
      out.fullMarked += 1;
      if (present && rights !== 'never') { out.pendingFull += 1; out.pendingFullSeconds += Number.isFinite(record.durationSec) ? record.durationSec : 0; }
    }
    if (present && rights !== 'never' && stage === 'none' && LOOKABLE_KINDS.includes(record.kind)) out.pendingQuick += 1;
  }
  out.videoSeconds = round2(out.videoSeconds);
  out.pendingFullSeconds = round2(out.pendingFullSeconds);
  return out;
}

// ---------------------------------------------------------------- indexing
const RUNS = new Map();
const TAILS = new Map();

const idOf = sha256 => `m-${sha256.slice(0, 16)}`;

function progressView(dir, folderId) {
  const record = readJson(progressFile(dir, folderId));
  const running = RUNS.has(`${dir}|${folderId}`);
  if (!record || typeof record !== 'object') return { state: 'not_started', running: false };
  let state = record.status;
  if ((state === 'running' || state === 'queued') && !running) state = 'stopped';
  return {
    state, running,
    total: record.total ?? 0, processed: record.processed ?? 0, added: record.added ?? 0, copies: record.copies ?? 0,
    unchanged: record.unchanged ?? 0, failed: record.failed ?? 0,
    ...(Array.isArray(record.errors) && record.errors.length ? { errors: record.errors } : {}),
    ...(record.truncated ? { truncated: true } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
    startedAt: record.startedAt ?? null, updatedAt: record.updatedAt ?? null, finishedAt: record.finishedAt ?? null,
  };
}

async function runPass({ root, brand, dir, folderId, control, batchSize, now }) {
  const iso = () => isoOf(now);
  const progress = {
    folderId, runId: randomUUID().slice(0, 8), status: 'running', startedAt: iso(), updatedAt: iso(),
    total: 0, processed: 0, added: 0, copies: 0, unchanged: 0, failed: 0, errors: [],
  };
  const save = (patch = {}) => { Object.assign(progress, patch); progress.updatedAt = iso(); writeJsonAtomic(progressFile(dir, folderId), progress); };
  const folder = foldFile(foldersFile(dir)).get(folderId);
  if (!folder || folder.removed) { save({ status: 'failed', reason: 'That folder is no longer in the footage list.', finishedAt: iso() }); return; }
  try {
    if (!isDir(folder.path)) {
      save({ status: 'failed', reason: 'The folder is not where it was. Ask the person for its new place, then relink it.', finishedAt: iso() });
      return;
    }
    const found = inventoryFolder(folder.path, { maxFiles: MAX_FILES_PER_FOLDER });
    const entries = found.filter(entry => FOOTAGE_KINDS.includes(kindOfExtension(entry.extension)));
    save({ total: entries.length, ...(found.length >= MAX_FILES_PER_FOLDER ? { truncated: true } : {}) });

    const current = new Map(foldFile(indexFile(dir)));
    const owner = new Map();
    for (const record of current.values()) for (const loc of locationsOf(record)) owner.set(locKey(loc.folderId, loc.relPath), record.id);
    const queued = new Map();
    const put = record => { current.set(record.id, record); queued.set(record.id, record); for (const loc of locationsOf(record)) owner.set(locKey(loc.folderId, loc.relPath), record.id); };
    const flush = () => { if (queued.size) { appendLines(indexFile(dir), [...queued.values()]); queued.clear(); bust(dir); } };

    let sinceFlush = 0;
    for (const entry of entries) {
      if (control.cancelled) break;
      const relPath = entry.relative.split(sep).join('/');
      try {
        const place = { folderId, relPath, mtime: entry.mtime };
        const heldBy = current.get(owner.get(locKey(folderId, relPath)));
        const held = heldBy ? locationsOf(heldBy).find(loc => loc.folderId === folderId && loc.relPath === relPath) : null;
        if (heldBy && held && held.mtime === entry.mtime && heldBy.bytes === entry.bytes) {
          progress.unchanged += 1;
        } else {
          const sha256 = await sha256File(entry.path);
          const id = idOf(sha256);
          const known = current.get(id);
          if (known) {
            const places = locationsOf(known);
            const at = places.findIndex(loc => loc.folderId === folderId && loc.relPath === relPath);
            if (at === -1) { put(withLocations(known, [...places, place])); progress.copies += 1; }
            else if (places[at].mtime !== entry.mtime) { places[at] = place; put(withLocations(known, places)); progress.unchanged += 1; }
            else progress.unchanged += 1;
          } else {
            put(await newRecord({ dir, entry, place, sha256, id, at: iso() }));
            progress.added += 1;
          }
          // The place used to hold other content: that content is no longer there.
          if (heldBy && heldBy.id !== id) put(withLocations(heldBy, locationsOf(heldBy).filter(loc => !(loc.folderId === folderId && loc.relPath === relPath))));
        }
      } catch (error) {
        progress.failed += 1;
        if (progress.errors.length < ERROR_LIMIT) progress.errors.push({ relPath, problem: clip(error?.message || error, 200) });
        log.warn('footage file failed', { relPath, error: String(error) });
      }
      progress.processed += 1;
      sinceFlush += 1;
      if (sinceFlush >= batchSize) { flush(); save(); sinceFlush = 0; await yieldToLoop(); }
    }
    flush();
    save({ status: control.cancelled ? 'paused' : 'done', finishedAt: iso() });
  } catch (error) {
    log.warn('footage indexing failed', { folderId, error: String(error) });
    try { save({ status: 'failed', reason: clip(error?.message || error, 300), finishedAt: iso() }); } catch { /* the folder may be gone */ }
  }
}

/**
 * The record for content seen for the first time: its facts and its thumbnail, read side by side. Neither is needed, so a failure only
 * leaves it out.
 */
async function newRecord({ dir, entry, place, sha256, id, at }) {
  if (kindOfExtension(entry.extension) === 'font') {
    const names = await readFontNames(entry.path);
    return {
      id, folderId: place.folderId, relPath: place.relPath, mtime: place.mtime, sha256, kind: 'font', bytes: entry.bytes,
      ...(names ? { font: names } : {}), at,
    };
  }
  const type = detectType(entry.path);
  if (!FOOTAGE_KINDS.includes(type.kind)) throw new Error('That does not look like a video, picture, audio or font file.');
  const withThumbnail = type.kind === 'video' || type.kind === 'image';
  const [facts, thumbFile] = await Promise.all([
    probeFile(entry.path).catch(error => { log.debug('footage probe failed', { path: entry.path, error: String(error) }); return null; }),
    withThumbnail
      ? extractThumbnail({ filePath: entry.path, kind: type.kind, outFile: join(dir, 'thumbs', `${id}.jpg`) }).catch(error => { log.debug('footage thumbnail failed', { path: entry.path, error: String(error) }); return null; })
      : null,
  ]);
  return {
    id, folderId: place.folderId, relPath: place.relPath, mtime: place.mtime, sha256, kind: type.kind, bytes: entry.bytes,
    ...(facts && facts.duration > 0 && type.kind !== 'image' ? { durationSec: round2(facts.duration) } : {}),
    ...(facts && facts.width > 0 && facts.height > 0 ? { width: facts.width, height: facts.height } : {}),
    ...(thumbFile ? { thumb: `thumbs/${id}.jpg` } : {}),
    at,
  };
}

/**
 * Start indexing a folder in the background, or join the run that is already going. One folder of a brand is read at a time, so two
 * imports queue instead of racing. Returns { started, running, done }: `done` resolves (it never rejects) when the pass has ended.
 */
export function startFolderIndex({ root, brand, folderId, batchSize = BATCH_SIZE, now } = {}) {
  const dir = requireBrand(root, brand);
  const folder = foldFile(foldersFile(dir)).get(folderId);
  if (!folder || folder.removed) throw new InvalidInputError('That folder is not in this brand\'s footage.', { fix: 'Use a folder id from brand_footage_status.' });
  const key = `${dir}|${folderId}`;
  const running = RUNS.get(key);
  if (running) return { started: false, running: true, done: running.done };
  const control = { cancelled: false };
  const previous = TAILS.get(dir) || Promise.resolve();
  const at = isoOf(now);
  writeJsonAtomic(progressFile(dir, folderId), { folderId, status: 'queued', startedAt: at, updatedAt: at, total: 0, processed: 0, added: 0, copies: 0, unchanged: 0, failed: 0, errors: [] });
  const done = previous
    .then(() => runPass({ root, brand, dir, folderId, control, batchSize, now }))
    .catch(error => log.warn('footage pass crashed', { folderId, error: String(error) }))
    .then(() => { RUNS.delete(key); if (TAILS.get(dir) === done) TAILS.delete(dir); bust(dir); });
  TAILS.set(dir, done);
  RUNS.set(key, { control, done });
  return { started: true, running: true, done };
}

/** Stop a folder's run after the current file. The run can be started again later and carries on. */
export function stopFolderIndex({ root, brand, folderId } = {}) {
  const run = RUNS.get(`${footageDir(root, brand)}|${folderId}`);
  if (!run) return false;
  run.control.cancelled = true;
  return true;
}

/** Resolves when nothing is being indexed for the brand. */
export function whenIdle({ root, brand } = {}) {
  return TAILS.get(footageDir(root, brand)) || Promise.resolve();
}

// ---------------------------------------------------------------- what the rest of the plugin reads
const FONT_NAMES_ON_BOARD = 8;

/**
 * The font families the footage holds, from the name table of each font file: [{ family, files, styles[], fileIds[], rights }], the most
 * files first. Fonts in a `never` folder and fonts whose name could not be read are left out; rights is the strictest of a family's files.
 */
export function fontFamiliesOf(entries) {
  return groupFontFamilies(entries.map(entry => ({ id: entry.record.id, kind: entry.record.kind, font: entry.record.font, rights: entry.rights })));
}

/** The same grouping for plain items: [{ id, kind, font: { family, style? }, rights }]. */
export function groupFontFamilies(items) {
  const byFamily = new Map();
  for (const { id, kind, font, rights } of items) {
    if (kind !== 'font' || rights === 'never' || !font?.family) continue;
    const key = font.family.toLowerCase();
    const row = byFamily.get(key) ?? { family: font.family, files: 0, styles: [], fileIds: [], rights: 'ours' };
    row.files += 1;
    if (font.style && !row.styles.includes(font.style)) row.styles.push(font.style);
    row.fileIds.push(id);
    row.rights = strictest(row.rights, rights);
    byFamily.set(key, row);
  }
  return [...byFamily.values()].sort((a, b) => b.files - a.files || a.family.localeCompare(b.family, 'en'));
}

const zeroKinds = () => ({ video: 0, image: 0, audio: 0, font: 0 });

function folderViews(snapshot) {
  const perFolder = new Map(snapshot.folders.map(folder => [folder.id, { files: 0, missing: 0, kinds: zeroKinds(), described: 0 }]));
  for (const entry of snapshot.entries) {
    for (const loc of entry.locs) {
      const row = perFolder.get(loc.folderId);
      row.files += 1;
      if (FOOTAGE_KINDS.includes(entry.record.kind)) row.kinds[entry.record.kind] += 1;
      if (stageOf(entry.doc) !== 'none') row.described += 1;
      if (!loc.present()) row.missing += 1;
    }
  }
  return snapshot.folders.map(folder => {
    const row = perFolder.get(folder.id);
    return {
      id: folder.id, label: folder.label ?? null, name: folder.label || basename(folder.path) || folder.path, path: folder.path,
      rights: folder.rights, rightsNote: RIGHTS_NOTES[folder.rights], addedAt: folder.at ?? null,
      folderFound: snapshot.folderOk.get(folder.id) === true, files: row.files, missing: row.missing, kinds: row.kinds, described: row.described,
      indexing: progressView(snapshot.dir, folder.id),
    };
  });
}

/**
 * Everything about a brand's footage, looked at fresh (every file is checked to still be where it was):
 * { brand, folders[], counts, pending, indexing, message }.
 */
export function footageStatus({ root, brand } = {}) {
  const snapshot = snapshotOf(root, brand);
  const counts = countsOf(snapshot);
  const folders = folderViews(snapshot);
  const running = folders.filter(folder => folder.indexing.state === 'running' || folder.indexing.state === 'queued');
  const stopped = folders.filter(folder => folder.indexing.state === 'stopped' || folder.indexing.state === 'paused');
  const lines = [];
  if (!folders.length) lines.push('No footage has been imported yet. Ask the person for a folder and whose footage it is, then use brand_footage_import.');
  if (running.length) lines.push(`Indexing is running for ${plural(running.length, 'folder')}. It is local and free, and carries on without you.`);
  if (stopped.length) lines.push(`Indexing stopped part-way for ${plural(stopped.length, 'folder')} (${stopped.map(folder => folder.name).join(', ')}). Call brand_footage_import again with the same folder to carry on.`);
  const moved = folders.filter(folder => !folder.folderFound);
  if (moved.length) lines.push(`${moved.map(folder => folder.name).join(', ')} ${moved.length === 1 ? 'is' : 'are'} not where ${moved.length === 1 ? 'it was' : 'they were'}. Ask the person for the new place, then use brand_footage_folder (action relink).`);
  else if (counts.missing) lines.push(`${plural(counts.missing, 'file')} could not be found in ${counts.missing === 1 ? 'its' : 'their'} folder. Ask the person where ${counts.missing === 1 ? 'it' : 'they'} moved to, then use brand_footage_folder (action relink).`);
  if (counts.pendingFull) lines.push(fullPassNote(counts));
  return {
    brand,
    folders,
    counts: {
      folders: counts.folders, files: counts.files, video: counts.video, image: counts.image, audio: counts.audio, font: counts.font, videoSeconds: counts.videoSeconds,
      analysedQuick: counts.analysedQuick, analysedFull: counts.analysedFull, missing: counts.missing,
      byRights: { ours: counts.ours, client_ask: counts.client_ask, never: counts.never },
    },
    pending: { quick: counts.pendingQuick, full: counts.pendingFull, fullMarked: counts.fullMarked, fullSeconds: counts.pendingFullSeconds },
    indexing: { running: running.length, stopped: stopped.length },
    message: lines.join(' ') || 'Footage is indexed and up to date.',
  };
}

function fullPassNote(counts) {
  const minutes = counts.pendingFullSeconds >= 60 ? ` (about ${Math.round(counts.pendingFullSeconds / 60)} minutes of video)` : '';
  return `${plural(counts.pendingFull, 'file')} ${counts.pendingFull === 1 ? 'is' : 'are'} marked for a full breakdown${minutes}. A full breakdown uses model usage on every file, so tell the person how many and ask before you start.`;
}

/** The counts the library keeps for the board: { folders, files, analysedQuick, analysedFull, missing }. Cached for `cacheMs`. */
export function footageSummary({ root, brand, cacheMs = 0 } = {}) {
  return summaryOf({ root, brand, cacheMs }).summary;
}

/**
 * The summary plus a short list of folders for the board's Footage line, the files by kind and the font families found. No path leaves
 * the computer in it.
 */
export function boardFootage({ root, brand, cacheMs = SUMMARY_CACHE_MS } = {}) {
  const { summary, list, kinds, fonts } = summaryOf({ root, brand, cacheMs });
  return { ...summary, kinds, fonts, list };
}

function summaryOf({ root, brand, cacheMs }) {
  const empty = { summary: { folders: 0, files: 0, analysedQuick: 0, analysedFull: 0, missing: 0 }, list: [], kinds: zeroKinds(), fonts: [], byRights: { ours: 0, client_ask: 0, never: 0 } };
  let dir;
  try { dir = footageDir(root, brand); } catch { return empty; }
  if (!existsSync(foldersFile(dir))) return empty;
  const hit = SUMMARY_CACHE.get(dir);
  if (cacheMs > 0 && hit && Date.now() - hit.at < cacheMs) return hit.value;
  const snapshot = snapshotOf(root, brand);
  const counts = countsOf(snapshot);
  const value = {
    summary: { folders: counts.folders, files: counts.files, analysedQuick: counts.analysedQuick, analysedFull: counts.analysedFull, missing: counts.missing },
    byRights: { ours: counts.ours, client_ask: counts.client_ask, never: counts.never },
    kinds: { video: counts.video, image: counts.image, audio: counts.audio, font: counts.font },
    fonts: fontFamiliesOf(snapshot.entries).slice(0, FONT_NAMES_ON_BOARD).map(item => item.family),
    list: folderViews(snapshot).map(folder => {
      const { state, processed, total } = folder.indexing;
      return {
        id: folder.id, name: folder.name, rights: folder.rights, files: folder.files, missing: folder.missing, kinds: folder.kinds, described: folder.described,
        state: !folder.folderFound ? 'moved' : state === 'running' || state === 'queued' ? 'indexing' : state === 'stopped' ? 'stopped' : 'ready',
        ...(state === 'running' ? { processed, total } : {}),
      };
    }),
  };
  SUMMARY_CACHE.set(dir, { at: Date.now(), value });
  return value;
}

/**
 * One line for an agent's brief when the brand has footage, or null. It names the tool to search with and the rights rule.
 */
export function footageLine({ root, brand, cacheMs = SUMMARY_CACHE_MS } = {}) {
  const { summary, byRights } = summaryOf({ root, brand, cacheMs });
  if (!summary.folders || !summary.files) return null;
  const described = summary.analysedQuick + summary.analysedFull;
  const rights = [`${byRights.ours.toLocaleString('en-US')} ours`, `${byRights.client_ask.toLocaleString('en-US')} client_ask (ask the person before posting)`, `${byRights.never.toLocaleString('en-US')} never (never use)`];
  const rest = [`${described.toLocaleString('en-US')} described`, ...(summary.missing ? [`${summary.missing.toLocaleString('en-US')} missing from their folder`] : [])];
  return `Footage: ${plural(summary.files, 'file')} from ${plural(summary.folders, 'folder')} (${rights.join(', ')}); ${rest.join(', ')}. For a repurpose job, search it with brand_footage_search before planning new shots. Each result carries its rights; searches leave out the never files.`;
}

/**
 * Every file of the brand's footage as search would show it (path, rights, how far it is described, the whole analysis), `never` files
 * included: the caller applies the rights rule. For the layer that digests footage into the brand kit and the bank.
 */
export function footageFiles({ root, brand } = {}) {
  const snapshot = snapshotOf(root, brand);
  return snapshot.entries.map(entry => fileView(entry, snapshot.dir, { detail: true }));
}

// ---------------------------------------------------------------- searching
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'is', 'it', 'this', 'that', 'by', 'from', 'as']);
const tokensOf = text => (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const stem = word => (word.length > 4 && word.endsWith('ing') ? word.slice(0, -3) : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
const termsOf = query => [...new Set(tokensOf(query).filter(word => !STOP.has(word)).map(stem))];
const tokenSet = text => tokensOf(text).map(stem);
const matches = (term, tokens) => tokens.some(token => token === term || (term.length >= 3 && token.startsWith(term)));

const listText = value => (Array.isArray(value) ? value : []).map(item => (typeof item === 'string' ? item : item?.description ?? item?.what ?? '')).join(' ');

/** The words of an analysis, in the groups search weighs: structured fields count most, free text least. */
function analysisFields(doc) {
  const stages = [doc?.quick, doc?.full].filter(Boolean);
  const pick = key => stages.map(stage => stage[key]);
  return {
    structured: tokenSet([
      ...pick('products').map(listText), ...pick('mood'), ...pick('shotTypes').map(listText),
      ...pick('scenes').map(value => (Array.isArray(value) ? value.map(scene => (typeof scene === 'string' ? scene : `${scene.description ?? ''} ${scene.shotType ?? ''}`)).join(' ') : '')),
      ...pick('usableMoments').map(listText),
    ].join(' ')),
    text: tokenSet([...pick('summary'), ...pick('opening'), ...pick('spoken'), ...pick('hook'), ...pick('onScreenText').map(listText)].join(' ')),
  };
}

const KIND_RANK = { video: 0, image: 1, audio: 2, font: 3 };
const STAGE_RANK = { full: 2, quick: 1, none: 0 };

function normaliseAnalysedFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true) return 'any';
  if (value === false) return 'none';
  if (['none', 'quick', 'full', 'any'].includes(value)) return value;
  throw new InvalidInputError('analysed is none (not described yet), quick, full or any.');
}

/** What a search returns for one file. `detail` adds the whole analysis. */
function fileView(entry, dir, { detail = false } = {}) {
  const { record, doc, locs } = entry;
  const place = entry.presentLoc();
  const stage = stageOf(doc);
  const main = place ?? locs[0];
  const read = doc?.full ?? doc?.quick ?? null;
  return {
    fileId: record.id,
    name: basename(main.relPath),
    kind: record.kind,
    path: place ? place.abs : null,
    missing: !place,
    bytes: Number.isFinite(record.bytes) ? record.bytes : null,
    modified: typeof main.mtime === 'string' ? main.mtime.slice(0, 10) : null,
    ...(record.font ? { font: record.font } : {}),
    ...(Number.isFinite(record.durationSec) ? { durationSec: record.durationSec } : {}),
    ...(Number.isInteger(record.width) ? { width: record.width, height: record.height } : {}),
    thumbnail: record.thumb ? join(dir, ...record.thumb.split('/')) : null,
    folder: { id: main.folder.id, label: main.folder.label || basename(main.folder.path) || main.folder.path, rights: main.folder.rights },
    rights: entry.rights,
    rightsNote: RIGHTS_NOTES[entry.rights],
    analysed: stage,
    markedForFull: doc?.wantFull === true,
    ...(read ? {
      summary: clip(read.summary || read.opening || '', 300),
      ...(read.products?.length ? { products: read.products } : {}),
      ...(read.mood ? { mood: read.mood } : {}),
      ...(read.style ? { style: read.style } : {}),
      ...(read.isLogo ? { isLogo: true } : {}),
      ...(read.logoVisible ? { logoVisible: true } : {}),
      ...(read.shotTypes?.length ? { shotTypes: read.shotTypes } : {}),
      ...(doc.full?.usableMoments?.length ? { usableMoments: doc.full.usableMoments.slice(0, 5) } : {}),
    } : {}),
    ...(detail ? { quick: doc?.quick ?? null, full: doc?.full ?? null } : {}),
  };
}

/**
 * Search the brand's footage by words over file names, folder labels and the analysis (product, scene, shot type, mood, what is said
 * and shown), or list it with filters. Files in a `never` folder are left out unless `rights` asks for them (never or all); files
 * that cannot be found in their folder are left out and counted. Returns { brand, count, total, results[], hiddenByRights, skippedMissing, note }.
 */
export function searchFootage({ root, brand, query = null, kind = null, rights = null, analysed = null, fileId = null, limit = 20 } = {}) {
  if (kind && !FOOTAGE_KINDS.includes(kind)) throw new InvalidInputError(`kind must be one of ${FOOTAGE_KINDS.join(', ')}.`);
  if (rights && !RIGHTS.includes(rights) && rights !== 'all') throw new InvalidInputError('rights is ours, client_ask, never or all. Leave it out to search what can be used (ours and client_ask).');
  const stageFilter = normaliseAnalysedFilter(analysed);
  const cap = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const snapshot = snapshotOf(root, brand);
  const base = { brand, query: typeof query === 'string' && query.trim() ? query.trim() : null };

  if (fileId) {
    const entry = snapshot.entries.find(item => item.record.id === fileId);
    if (!entry) throw new InvalidInputError('That file is not in this brand\'s footage.', { fix: 'Use a fileId from brand_footage_search.' });
    return { ...base, count: 1, total: 1, results: [fileView(entry, snapshot.dir, { detail: true })], hiddenByRights: 0, skippedMissing: 0, note: entry.rights === 'never' ? 'This file is marked never use. Do not use it.' : entry.rights === 'client_ask' ? 'Ask the person before posting this file.' : '' };
  }

  const terms = termsOf(query);
  let hiddenByRights = 0;
  const hits = [];
  for (const entry of snapshot.entries) {
    const { record, doc } = entry;
    if (kind && record.kind !== kind) continue;
    if (rights && rights !== 'all' && entry.rights !== rights) continue;
    const stage = stageOf(doc);
    if (stageFilter === 'none' && stage !== 'none') continue;
    if (stageFilter === 'quick' && stage !== 'quick') continue;
    if (stageFilter === 'full' && stage !== 'full') continue;
    if (stageFilter === 'any' && stage === 'none') continue;
    let score = 0;
    const matched = new Set();
    if (terms.length) {
      const name = tokenSet(`${entry.locs.map(loc => `${loc.relPath} ${loc.folder.label ?? ''}`).join(' ')} ${record.font?.family ?? ''}`);
      const fields = analysisFields(doc);
      for (const term of terms) {
        if (matches(term, fields.structured)) { score += 3; matched.add('what is in it'); }
        else if (matches(term, name)) { score += 2; matched.add('name or folder'); }
        else if (matches(term, fields.text)) { score += 1; matched.add('what is said or shown'); }
      }
      if (!score) continue;
    }
    if (!rights && entry.rights === 'never') { hiddenByRights += 1; continue; }
    hits.push({ entry, score, matched: [...matched], stage });
  }
  hits.sort((a, b) => b.score - a.score
    || STAGE_RANK[b.stage] - STAGE_RANK[a.stage]
    || (KIND_RANK[a.entry.record.kind] ?? 9) - (KIND_RANK[b.entry.record.kind] ?? 9)
    || basename(a.entry.locs[0].relPath).localeCompare(basename(b.entry.locs[0].relPath), 'en', { numeric: true })
    || a.entry.record.id.localeCompare(b.entry.record.id));

  const results = [];
  let skippedMissing = 0;
  for (const hit of hits) {
    if (results.length >= cap) break;
    if (!hit.entry.presentLoc()) { skippedMissing += 1; continue; }
    results.push({ ...fileView(hit.entry, snapshot.dir), ...(terms.length ? { matched: hit.matched } : {}) });
  }
  const notes = [];
  if (!snapshot.entries.length) notes.push('No footage has been imported yet. Ask the person for a folder and whose footage it is, then use brand_footage_import.');
  if (results.some(item => item.rights === 'client_ask')) notes.push('Files marked client_ask need the person\'s yes before they are posted.');
  if (hiddenByRights) notes.push(`${plural(hiddenByRights, 'matching file')} ${hiddenByRights === 1 ? 'is' : 'are'} in folders marked never use and ${hiddenByRights === 1 ? 'was' : 'were'} left out.`);
  if (skippedMissing) notes.push(`${plural(skippedMissing, 'matching file')} could not be found in ${skippedMissing === 1 ? 'its' : 'their'} folder and ${skippedMissing === 1 ? 'was' : 'were'} left out. The folder may have moved: ask the person for the new place and use brand_footage_folder (action relink).`);
  return { ...base, count: results.length, total: hits.length, results, hiddenByRights, skippedMissing, note: notes.join(' ') };
}

// ---------------------------------------------------------------- analysis
function seconds(value, label, problems) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return round2(value);
  if (typeof value === 'string') {
    const text = value.trim();
    let match;
    if ((match = /^(\d+(?:\.\d+)?)s?$/.exec(text))) return round2(Number(match[1]));
    if ((match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(text))) return round2(Number(match[1]) * 60 + Number(match[2]));
    if ((match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text))) return round2(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }
  problems.push(`${label} must be a time in seconds (for example 12.5) or minutes and seconds (for example 0:12).`);
  return null;
}

const textOf = (value, limit) => (typeof value === 'string' ? clip(value, limit) : '');
const listOf = (value, items, limit) => (Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : [])
  .map(item => (typeof item === 'string' ? clip(item, limit) : '')).filter(Boolean).slice(0, items);

function rangesOf(value, key, label, problems, durationSec) {
  const out = [];
  for (const [index, item] of (Array.isArray(value) ? value : []).slice(0, 60).entries()) {
    const where = `${label} ${index + 1}`;
    if (!item || typeof item !== 'object') { problems.push(`${where} must be an object with start, end and a description.`); continue; }
    const start = seconds(item.start, `${where} start`, problems);
    const end = seconds(item.end, `${where} end`, problems);
    if (start === null || end === null) continue;
    if (end <= start) { problems.push(`${where} must end after it starts.`); continue; }
    if (Number.isFinite(durationSec) && start > durationSec + 1) { problems.push(`${where} starts at ${start}s, past the end of this ${round2(durationSec)}s file.`); continue; }
    const words = textOf(item[key], TEXT.line);
    if (!words) { problems.push(`${where} needs ${key === 'what' ? 'what' : 'a description'} in words.`); continue; }
    out.push({ start, end, [key]: words, ...(key === 'description' && textOf(item.shotType, 60) ? { shotType: textOf(item.shotType, 60) } : {}), ...(key === 'what' && textOf(item.why, TEXT.line) ? { why: textOf(item.why, TEXT.line) } : {}) });
  }
  return out;
}

/** Check and tidy an analysis for one stage. Returns the clean object; throws a plain list of what is wrong. */
export function cleanAnalysis(stage, input, { kind = 'video', durationSec = null } = {}) {
  if (!STAGES.includes(stage)) throw new InvalidInputError('stage is quick (the opening seconds and the first spoken words) or full (the whole breakdown).');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvalidInputError('analysis must be an object.');
  const problems = [];
  const common = {
    products: listOf(input.products, 12, 80), mood: textOf(input.mood, 80), shotTypes: listOf(input.shotTypes, 12, 60),
    style: textOf(input.style, TEXT.style), logoVisible: input.logoVisible === true ? true : '', isLogo: input.isLogo === true ? true : '',
  };
  let clean;
  if (stage === 'quick') {
    const opening = textOf(input.opening, TEXT.opening);
    if (!opening) problems.push('opening must say what the first seconds show.');
    clean = {
      opening, spoken: textOf(input.spoken, TEXT.opening), hook: textOf(input.hook, TEXT.line), ...common,
      scenes: listOf(input.scenes, 12, 120),
    };
  } else {
    const summary = textOf(input.summary, TEXT.summary);
    if (!summary) problems.push('summary must say in a sentence or two what the file is.');
    const scenes = rangesOf(input.scenes, 'description', 'Scene', problems, durationSec);
    const usableMoments = rangesOf(input.usableMoments, 'what', 'Usable moment', problems, durationSec);
    if (kind === 'video' && !scenes.length && !usableMoments.length && !problems.length) problems.push('a video\'s full breakdown needs scenes or usable moments, each with a start and an end in seconds.');
    clean = {
      summary, hook: textOf(input.hook, TEXT.line), scenes, ...common, onScreenText: listOf(input.onScreenText, 20, 120),
      spoken: textOf(input.spoken, TEXT.spoken), usableMoments,
    };
  }
  if (problems.length) {
    throw new InvalidInputError(`The ${stage} analysis is not complete: ${problems.slice(0, 6).join(' ')}`, { details: { problems }, fix: stage === 'quick' ? 'Send opening (and spoken, products, mood, shotTypes when you can tell).' : 'Send summary, scenes and usableMoments with start and end times in seconds, plus hook, shotTypes, products, mood, onScreenText and spoken.' });
  }
  return Object.fromEntries(Object.entries(clean).filter(([, value]) => !(value === '' || (Array.isArray(value) && !value.length))));
}

const stable = value => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));

function findEntry(snapshot, fileId) {
  const entry = snapshot.entries.find(item => item.record.id === fileId);
  if (!entry) throw new InvalidInputError('That file is not in this brand\'s footage.', { fix: 'Use a fileId from brand_footage_search.' });
  return entry;
}

/**
 * Keep what an agent saw in a file, as the quick or the full stage. Saving the same stage again replaces it (the same words change
 * nothing); a quick reading never replaces a full one. A file in a `never` folder is not analysed.
 * Returns { fileId, stage, changed, analysed, pending }.
 */
export function saveAnalysis({ root, brand, fileId, stage, analysis, now } = {}) {
  const dir = requireBrand(root, brand);
  const snapshot = snapshotOf(root, brand);
  const entry = findEntry(snapshot, fileId);
  if (entry.rights === 'never') throw new InvalidInputError('That file is in a folder the person marked never use, so it is not analysed.');
  if (!LOOKABLE_KINDS.includes(entry.record.kind)) throw new InvalidInputError('A font file is not described. Its family name is read from the file itself.');
  const clean = cleanAnalysis(stage, analysis, { kind: entry.record.kind, durationSec: entry.record.durationSec ?? null });
  const previous = entry.doc && typeof entry.doc === 'object' ? entry.doc : {};
  const same = previous[stage] && stable({ ...previous[stage], at: null }) === stable({ ...clean, at: null });
  const at = isoOf(now);
  let changed = false;
  if (!same) {
    writeJsonAtomic(analysisFile(dir, fileId), { ...previous, fileId, sha256: entry.record.sha256, [stage]: { ...clean, at }, updatedAt: at });
    changed = true;
    bust(dir);
  }
  const doc = changed ? readJson(analysisFile(dir, fileId), {}) : previous;
  const stageNow = stageOf(doc);
  const waiting = snapshot.entries.filter(item => item.rights !== 'never' && stageOf(item.doc) === 'none').length - (stageOf(previous) === 'none' && stageNow !== 'none' ? 1 : 0);
  return { fileId, stage, changed, analysed: stageNow, waitingForQuick: waiting };
}

/**
 * Mark files for a full breakdown (the person's choice), or take the mark off. Files in a `never` folder are not marked.
 * Returns { marked, alreadyMarked, unmarked, unknown[], skipped[], pendingFull, pendingFullSeconds, message }.
 */
export function markForFull({ root, brand, fileIds, wantFull = true, now } = {}) {
  const dir = requireBrand(root, brand);
  const ids = [...new Set(Array.isArray(fileIds) ? fileIds.filter(id => typeof id === 'string' && id) : [])];
  if (!ids.length) throw new InvalidInputError('Say which files, with fileIds from brand_footage_search.');
  if (ids.length > 500) throw new InvalidInputError('Mark at most 500 files at a time.');
  const snapshot = snapshotOf(root, brand);
  const byId = new Map(snapshot.entries.map(entry => [entry.record.id, entry]));
  const at = isoOf(now);
  const out = { marked: 0, alreadyMarked: 0, unmarked: 0, unknown: [], skipped: [] };
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) { out.unknown.push(id); continue; }
    if (wantFull && entry.rights === 'never') { out.skipped.push({ fileId: id, reason: 'In a folder marked never use.' }); continue; }
    if (wantFull && !LOOKABLE_KINDS.includes(entry.record.kind)) { out.skipped.push({ fileId: id, reason: 'A font file is not described.' }); continue; }
    const doc = entry.doc && typeof entry.doc === 'object' ? entry.doc : {};
    if (wantFull) {
      if (doc.wantFull === true) { out.alreadyMarked += 1; continue; }
      writeJsonAtomic(analysisFile(dir, id), { ...doc, fileId: id, sha256: entry.record.sha256, wantFull: true, markedAt: at, updatedAt: at });
      out.marked += 1;
    } else if (doc.wantFull === true) {
      const { wantFull: _mark, markedAt: _at, ...rest } = doc;
      if (rest.quick || rest.full) writeJsonAtomic(analysisFile(dir, id), { ...rest, updatedAt: at });
      else rmSync(analysisFile(dir, id), { force: true });
      out.unmarked += 1;
    }
  }
  bust(dir);
  const counts = countsOf(snapshotOf(root, brand));
  return {
    ...out, pendingFull: counts.pendingFull, pendingFullSeconds: counts.pendingFullSeconds,
    message: counts.pendingFull ? fullPassNote(counts) : 'No files are waiting for a full breakdown.',
  };
}

// ---------------------------------------------------------------- changing a folder
/**
 * relink: the folder moved, so point it at the new place (path). The files are looked for there under the same names; it is refused
 * when none of them is, so a wrong place changes nothing. rights: change whose footage it is (the person's word). remove: take the
 * folder out of the footage list (its files stay on disk untouched, and what was learned about them is kept if it is imported again).
 * Returns { folder, changed, ...detail }.
 */
export function changeFolder({ root, brand, folderId, action, path = null, rights = null, now } = {}) {
  const dir = requireBrand(root, brand);
  const folder = foldFile(foldersFile(dir)).get(folderId);
  if (!folder || folder.removed) throw new InvalidInputError('That folder is not in this brand\'s footage.', { fix: 'Use a folder id from brand_footage_status.' });
  const at = isoOf(now);
  if (action === 'rights') {
    checkRights(rights);
    if (folder.rights === rights) return { folder, changed: false };
    const next = { ...folder, rights, changedAt: at };
    appendLines(foldersFile(dir), [next]);
    bust(dir);
    return { folder: next, changed: true, message: `Now marked "${RIGHTS_WORDS[rights]}".` };
  }
  if (action === 'remove') {
    stopFolderIndex({ root, brand, folderId });
    const next = { ...folder, removed: true, changedAt: at };
    appendLines(foldersFile(dir), [next]);
    bust(dir);
    return { folder: next, changed: true, message: 'Taken out of the footage list. The files themselves were not touched.' };
  }
  if (action !== 'relink') throw new InvalidInputError('action is relink, rights or remove.');
  const target = cleanPath(path);
  folderGuards({ root, brand, path: target });
  if (samePath(folder.path, target)) return { folder, changed: false, message: 'That is already this folder\'s place.' };
  const other = [...foldFile(foldersFile(dir)).values()].find(item => !item.removed && item.id !== folderId && samePath(item.path, target));
  if (other) throw new InvalidInputError(`That place is already imported${other.label ? ` as "${other.label}"` : ''}.`, { fix: 'Remove one of the two folders, or give this one its own place.' });
  let expected = 0;
  let found = 0;
  for (const record of foldFile(indexFile(dir)).values()) {
    for (const loc of locationsOf(record)) {
      if (loc.folderId !== folderId) continue;
      expected += 1;
      try { const stats = statSync(join(target, ...loc.relPath.split('/'))); if (stats.isFile() && (!Number.isFinite(record.bytes) || stats.size === record.bytes)) found += 1; } catch { /* not there */ }
    }
  }
  if (expected > 0 && found === 0) {
    throw new InvalidInputError(`None of this folder's ${plural(expected, 'file')} ${expected === 1 ? 'is' : 'are'} in that place.`, { fix: 'Check the place with the person. It has to be the folder that holds the same files, with the same folder names inside.' });
  }
  const next = { ...folder, path: target, changedAt: at };
  appendLines(foldersFile(dir), [next]);
  bust(dir);
  return {
    folder: next, changed: true, found, expected, stillMissing: expected - found,
    message: expected - found ? `Found ${found} of ${plural(expected, 'file')} in the new place. ${expected - found} could not be found there.` : `Found all ${plural(expected, 'file')} in the new place.`,
  };
}
