/**
 * Job references: pictures, video, audio, caption text and add-ons the person uploads from the
 * board (or hands over in chat). Each one is saved inside that job's own folder, under
 * <job>/inputs/references/<type>/, with a manifest entry the Director and the other agents read.
 *
 * Nothing here trusts a caller's claim: the type, the extension and the file's own first bytes
 * are checked, the stored name is generated here, and the destination is verified to stay inside
 * the job folder.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path';
import { renameReplacing } from '../lib/rename.mjs';

export const REFERENCE_TYPES = Object.freeze({
  picture: { label: 'Reference picture', use: 'Studio reference image', kinds: ['image'] },
  video: { label: 'Reference video', use: 'motion and style reference', kinds: ['video'] },
  audio: { label: 'Audio', use: 'music or voice reference', kinds: ['audio'] },
  caption: { label: 'Caption or text', use: 'copy input', kinds: ['text'] },
  addon: { label: 'Add-on', use: 'extra material for the job', kinds: ['image', 'video', 'audio', 'document', 'text'] },
});

const EXT = Object.freeze({
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.aac': 'audio',
  '.pdf': 'document',
  '.txt': 'text', '.md': 'text', '.srt': 'text', '.vtt': 'text',
});
const MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.srt': 'text/plain', '.vtt': 'text/vtt',
});

export const REFERENCE_LIMITS = Object.freeze({
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  text: 20000,
});
// What a reference is for, picked with one tap on the board. Optional; a fixed list, anything else is ignored.
// `means` is the one line the agents read to know how to use it.
export const REFERENCE_ROLES = Object.freeze({
  logo: { label: 'Logo', means: 'Put the brand logo in exactly as it is; never redraw or restyle it.', types: ['picture', 'addon'] },
  product: { label: 'Product', means: 'Keep the product exactly as shown (shape, colours, labels).', types: ['picture', 'addon'] },
  person: { label: 'Person or character', means: 'Keep this person or character consistent: same face, look and outfit.', types: ['picture', 'addon'] },
  style: { label: 'Style or look', means: 'Match the colours, lighting and mood of this.', types: ['picture', 'video', 'addon'] },
  motion: { label: 'Motion', means: 'Copy the movement and pacing of this.', types: ['video', 'addon'] },
  sound: { label: 'Music or voice', means: 'Match the sound of this (the music or the voice).', types: ['audio', 'addon'] },
});
export const referenceRoleLabel = role => (typeof role === 'string' && Object.hasOwn(REFERENCE_ROLES, role) ? REFERENCE_ROLES[role].label : null);
function cleanRole(role, type) {
  return typeof role === 'string' && Object.hasOwn(REFERENCE_ROLES, role) && REFERENCE_ROLES[role].types.includes(type) ? role : '';
}
export const NOTE_MAX = 500;
export const REFERENCES_PER_JOB = 60;
const MANIFEST = 'manifest.json';

function megabytes(bytes) { return `${Math.round(bytes / (1024 * 1024))} MB`; }

/** The kind of file these first bytes are, or null. Independent of the name the file came with. */
function sniff(buffer) {
  const b = buffer;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', ext: ['.png'] };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: ['.jpg', '.jpeg'] };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF') {
    const form = b.toString('latin1', 8, 12);
    if (form === 'WEBP') return { kind: 'image', ext: ['.webp'] };
    if (form === 'WAVE') return { kind: 'audio', ext: ['.wav'] };
  }
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (brand === 'qt  ') return { kind: 'video', ext: ['.mov'] };
    if (brand.startsWith('M4A') || brand === 'M4B ') return { kind: 'audio', ext: ['.m4a'] };
    return { kind: 'video', ext: ['.mp4', '.m4v', '.m4a'] };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', ext: ['.webm'] };
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'OggS') return { kind: 'audio', ext: ['.ogg'] };
  if (b.length >= 3 && b.toString('latin1', 0, 3) === 'ID3') return { kind: 'audio', ext: ['.mp3'] };
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { kind: 'audio', ext: ['.mp3', '.aac'] };
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return { kind: 'document', ext: ['.pdf'] };
  return null;
}

function cleanNote(note) {
  const text = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  if (text.length > NOTE_MAX) throw new Error(`Keep the note under ${NOTE_MAX} characters.`);
  return text;
}

function cleanName(name) {
  const base = basename(String(name || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim();
  return base.slice(0, 120);
}

function slugOf(name) {
  const stem = name.slice(0, name.length - extname(name).length);
  return (stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'reference';
}

/**
 * Check one reference (the request shape) without writing anything. Returns what apply needs:
 * { type, note, role, fileName, ext, kind, buffer }. Throws plain-worded errors.
 */
export function checkReference(reference, { readFile = readFileSync, shapeOnly = false } = {}) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error('Add a file or some text to attach.');
  const type = typeof reference.type === 'string' ? reference.type : '';
  if (!Object.hasOwn(REFERENCE_TYPES, type)) throw new Error('Choose what this is: a reference picture, reference video, audio, caption or text, or an add-on.');
  const spec = REFERENCE_TYPES[type];
  const note = cleanNote(reference.note);
  const role = cleanRole(reference.role, type);
  const rawName = cleanName(reference.fileName);

  if (typeof reference.text === 'string' && reference.text.trim()) {
    if (!spec.kinds.includes('text')) throw new Error(`${spec.label} needs a file, not typed text.`);
    const text = reference.text.replace(/\r\n/g, '\n');
    if (text.length > REFERENCE_LIMITS.text) throw new Error(`That text is too long (limit ${REFERENCE_LIMITS.text.toLocaleString('en-US')} characters). Shorten it or split it.`);
    let ext = rawName ? extname(rawName).toLowerCase() : '.txt';
    if (EXT[ext] !== 'text') ext = '.txt';
    return { type, note, role, fileName: rawName || 'caption.txt', ext, kind: 'text', buffer: Buffer.from(text, 'utf8') };
  }

  const ext = extname(rawName).toLowerCase();
  const kind = EXT[ext];
  if (!kind || !spec.kinds.includes(kind)) {
    const allowed = Object.entries(EXT).filter(([, k]) => spec.kinds.includes(k)).map(([e]) => e.slice(1).toUpperCase());
    throw new Error(`${spec.label} accepts ${allowed.join(', ')} files. This one is not one of those.`);
  }
  if (kind === 'text') throw new Error('Text files are read in the board and sent as text; this one arrived as a file.');
  if (Number.isFinite(reference.size) && reference.size > REFERENCE_LIMITS[kind]) throw new Error(`That file is too big (limit ${megabytes(REFERENCE_LIMITS[kind])} for ${kind === 'document' ? 'documents' : kind}). Try a smaller or shorter copy.`);
  if (shapeOnly) return { type, note, role, fileName: rawName, ext, kind, buffer: null };

  let buffer;
  if (typeof reference.dataBase64 === 'string' && reference.dataBase64) buffer = Buffer.from(reference.dataBase64, 'base64');
  else if (typeof reference.path === 'string' && reference.path) {
    if (!isAbsolute(reference.path)) throw new Error('A reference file path must be absolute.');
    try { buffer = readFile(reference.path); } catch { throw new Error('The reference file could not be read.'); }
  } else throw new Error('Add a file or some text to attach.');

  if (!buffer.length) throw new Error('That file is empty.');
  if (buffer.length > REFERENCE_LIMITS[kind]) throw new Error(`That file is too big (limit ${megabytes(REFERENCE_LIMITS[kind])} for ${kind === 'document' ? 'documents' : kind}). Try a smaller or shorter copy.`);
  const seen = sniff(buffer);
  if (!seen || seen.kind !== kind || !seen.ext.includes(ext)) throw new Error(`That file does not look like a real ${ext.slice(1).toUpperCase()} file, so it was not saved.`);
  return { type, note, role, fileName: rawName, ext, kind, buffer };
}

export const referencesDir = jobDir => join(jobDir, 'inputs', 'references');
const manifestFile = jobDir => join(referencesDir(jobDir), MANIFEST);

/**
 * The shared manifest (also written by pipeline_reference_from_url):
 * { schemaVersion: 1, entries: [{ id, type, path, files, note, sha256, bytes, usage, uploadedAt|downloadedAt, by, ... }] }
 * `path` and `files` are relative to <job>/inputs/references/.
 */
export function readReferenceManifest(jobDir) {
  try {
    const parsed = JSON.parse(readFileSync(manifestFile(jobDir), 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch { /* missing or unreadable: an empty manifest */ }
  return { schemaVersion: 1, entries: [] };
}

export const readReferences = jobDir => readReferenceManifest(jobDir).entries;

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Read-modify-write the manifest under a lock file, so two writers (an upload and a link download) never lose
 * each other's entry. `change(manifest)` returns the manifest to write, or null to leave it.
 */
export function updateReferenceManifest(jobDir, change) {
  const dir = referencesDir(jobDir);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.manifest.lock');
  let held = false;
  for (let attempt = 0; attempt < 100 && !held; attempt += 1) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) unlinkSync(lock); } catch { /* raced */ }
      sleepSync(50);
    }
  }
  if (!held) throw new Error('Another reference is being saved. Try again in a moment.');
  try {
    const next = change(readReferenceManifest(jobDir));
    if (next) {
      const mf = manifestFile(jobDir);
      const temp = `${mf}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
      renameReplacing(temp, mf);
    }
    return next;
  } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

function inside(parent, child) {
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(p);
}

/**
 * Save one checked reference into the job folder and record it. Idempotent on requestId and on
 * identical content of the same type. Returns { reference, added }.
 */
export function addReference({ jobDir, reference, requestId = null, by = null, now = new Date() }) {
  if (!jobDir || !isAbsolute(jobDir)) throw new Error('A job folder is required.');
  const checked = checkReference(reference);
  const sha256 = createHash('sha256').update(checked.buffer).digest('hex');
  const id = `ref-${sha256.slice(0, 12)}`;
  let result = null;
  updateReferenceManifest(jobDir, manifest => {
    const same = manifest.entries.find(item => (requestId && item.requestId === requestId) || (item.type === checked.type && item.sha256 === sha256));
    if (same) { result = { reference: same, added: false }; return null; }
    if (manifest.entries.length >= REFERENCES_PER_JOB) throw new Error(`This job already has ${REFERENCES_PER_JOB} references. Remove some before adding more.`);
    const refsDir = referencesDir(jobDir);
    const fileName = `${slugOf(checked.fileName || 'reference')}${checked.ext}`;
    const destDir = join(refsDir, checked.type, id);
    mkdirSync(destDir, { recursive: true });
    const dest = join(realpathSync(destDir), fileName);
    if (!inside(join(realpathSync(jobDir), 'inputs', 'references'), dest)) throw new Error('A reference must stay inside its job folder.');
    const temp = `${dest}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, checked.buffer);
    renameReplacing(temp, dest);
    const rel = `${checked.type}/${id}/${fileName}`;
    const entry = {
      id,
      type: checked.type,
      kind: checked.kind,
      label: REFERENCE_TYPES[checked.type].label,
      use: REFERENCE_TYPES[checked.type].use,
      path: rel,
      files: [rel],
      originalName: checked.fileName || null,
      mimeType: MIME[checked.ext] || 'application/octet-stream',
      note: checked.note,
      ...(checked.role ? { role: checked.role } : {}),
      sha256,
      bytes: checked.buffer.length,
      usage: 'reference_only',
      uploadedAt: now.toISOString(),
      by: typeof by === 'string' && by ? by : null,
      ...(requestId ? { requestId } : {}),
      ...(checked.kind === 'text' ? { caption: checked.buffer.toString('utf8').slice(0, 2000) } : {}),
    };
    result = { reference: entry, added: true };
    return { ...manifest, schemaVersion: manifest.schemaVersion || 1, entries: [...manifest.entries, entry] };
  });
  return result;
}

/**
 * Take one reference off a job: its manifest entry is removed under the manifest lock and its files are moved (never deleted) to
 * <job>/inputs/references/.removed/<id>/, keeping their folders, with the old entry saved beside them. Every path is checked to stay
 * inside the job's references folder. An id that is not on the job is a plain error. Returns { reference }.
 */
export function removeReference({ jobDir, referenceId, now = new Date() }) {
  if (!jobDir || !isAbsolute(jobDir)) throw new Error('A job folder is required.');
  const id = typeof referenceId === 'string' ? referenceId.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || id.startsWith('.')) throw new Error('That reference is no longer on this job.');
  let removed = null;
  updateReferenceManifest(jobDir, manifest => {
    const entry = manifest.entries.find(item => item.id === id);
    if (!entry) throw new Error('That reference is no longer on this job.');
    const base = realpathSync(referencesDir(jobDir));
    const keepRoot = join(base, '.removed');
    let keep = join(keepRoot, id);
    if (existsSync(keep)) keep = join(keepRoot, `${id}-${now.getTime()}`);
    const rels = [...new Set([entry.path, ...(Array.isArray(entry.files) ? entry.files : [])].filter(safeRelative))];
    mkdirSync(keep, { recursive: true });
    for (const rel of rels) {
      const from = join(base, ...rel.split(/[\\/]/));
      let real;
      try { real = realpathSync(from); } catch { continue; } // already gone
      if (!inside(base, real) || !statSync(real).isFile()) continue;
      const to = join(keep, ...rel.split(/[\\/]/));
      if (!inside(keep, to)) continue;
      mkdirSync(dirname(to), { recursive: true });
      renameSync(real, to);
      // Tidy the emptied folders (type/id), never the references folder itself.
      for (let dir = dirname(real); inside(base, dir) && dir !== base; dir = dirname(dir)) { try { rmdirSync(dir); } catch { break; } }
    }
    writeFileSync(join(keep, 'entry.json'), `${JSON.stringify({ ...entry, removedAt: now.toISOString() }, null, 2)}\n`);
    removed = entry;
    return { ...manifest, entries: manifest.entries.filter(item => item !== entry) };
  });
  return { reference: removed };
}

/** What the board shows for a job: no bytes, no absolute paths, capped. */
export function referenceSummaries(jobDir, limit = 40, { preview = null, previews = 8, large = null, larges = 3, copyUrl = null } = {}) {
  const entries = readReferences(jobDir).slice(-limit);
  return entries.map((item, index) => {
    const summary = {
      id: item.id, type: item.type, kind: item.type === 'page' ? 'page' : item.kind || (item.type === 'video' ? 'video' : 'text'),
      label: item.label || REFERENCE_TYPES[item.type]?.label || 'Reference',
      name: item.originalName || item.title || String(item.path || '').split('/').pop(),
      note: item.note || '', ...(referenceRoleLabel(item.role) ? { role: item.role } : {}), uploadedAt: item.uploadedAt || item.downloadedAt || null, bytes: item.bytes ?? null,
    };
    const site = siteOf(item.finalUrl || item.sourceUrl);
    if (site) summary.site = site;
    // Only the newest few carry a picture, so a job with many references stays light on the board.
    const source = preview && index >= entries.length - previews ? previewSource(item) : null;
    const thumb = source ? preview(join(referencesDir(jobDir), source.path), { video: source.video }) : null;
    // What the "see it large" view shows: a link, the start of a text, a bigger picture for the newest few, and a full copy's
    // address when one was uploaded to the board (the same copies the review gates play).
    const link = item.type === 'page' ? httpsLink(item.finalUrl || item.sourceUrl) : null;
    if (link) summary.link = link;
    if (item.kind === 'text' && typeof item.caption === 'string' && item.caption.trim()) summary.excerpt = item.caption.trim().slice(0, 400);
    const url = typeof copyUrl === 'function' && /^[0-9a-f]{64}$/i.test(item.sha256 || '') ? copyUrl(item.sha256) : null;
    if (url) summary.url = url;
    const bigger = source && large && index >= entries.length - larges ? large(join(referencesDir(jobDir), source.path), { video: source.video }) : null;
    if (thumb) summary.thumb = thumb;
    if (bigger) summary.large = bigger;
    return summary;
  });
}

function httpsLink(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.href.length <= 400 ? parsed.href : null; } catch { return null; }
}

function siteOf(url) {
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch { return null; }
}

/**
 * The saved file that best shows what a reference looks like, as { path, video }, or null: the picture itself, a link
 * video's own thumbnail (else the video's first frame), or a web page's main picture. Paths stay inside the references folder.
 */
export function previewSource(item) {
  const files = (Array.isArray(item?.files) ? item.files : []).filter(safeRelative);
  const picture = pattern => files.find(file => pattern.test(file));
  if (item?.type === 'page') {
    const image = picture(/(^|\/)image\.(png|jpe?g|webp)$/i);
    return image ? { path: image, video: false } : null;
  }
  const path = safeRelative(item?.path) ? item.path : null;
  if (item?.kind === 'image' && path) return { path, video: false };
  if (item?.kind === 'video') {
    const thumbnail = picture(/(^|\/)thumbnail\.(png|jpe?g|webp)$/i);
    if (thumbnail) return { path: thumbnail, video: false };
    if (path && /\.(mp4|mov|webm|m4v)$/i.test(path)) return { path, video: true };
  }
  return null;
}

function safeRelative(path) {
  return typeof path === 'string' && path && !path.includes('\0') && !isAbsolute(path) && !/^[a-z]:/i.test(path) && !path.split(/[\\/]/).includes('..');
}
