/**
 * The brand library: what a brand has already made and learned, kept as plain files beside its profile so the next job starts from it.
 *
 *   workspaces/<brand>/library/
 *     bank/yours.jsonl       {id, kind, text, concept?, jobId?, edited?, was?, at, removed?}   the person's own lines
 *     bank/proven.jsonl      {id, kind, text, evidence:{url, views, date}, source?, competitor?, jobId?, at, removed?}   what worked, with its proof
 *                            (source is 'brand' or 'competitor', with the competitor's name; an item without one is the brand's own)
 *     research/<jobId>.json  {jobId, at, files:[{path, sha256, topic, at}], industry?}   the research a job left, by path
 *     jobs/<jobId>.json      the filed job record (below)
 *     preferences.jsonl      {at, jobId, stage, picked, rejected[], note?}   what the person chose, and what they passed on
 *
 * `kind` is one of hook, angle, style, cta, caption, format, industry, funnel.
 * A bank file is only ever appended to: an edit appends the item again with the same id and `edited: true, was: <old text>`, a removal
 * appends it again with `removed: true`, and a read keeps the last line of each id. Two writers never overwrite each other.
 * Every write is idempotent: the same item added twice is one item, and filing the same job twice changes nothing.
 *
 * The filed job record: {jobId, title, filedAt, concept:{id, title, source, hook}|null, research:[path], script:[{path, sha256}],
 * voiceOver:{path, sha256}|null, captions:[{path, sha256}], music:{id, title}|null, voice:{id}|null, styleKit?:{path, sha256},
 * media:[{path, sha256, kind, approved:true}], rubric?}. Paths are relative to the workspace root. Nothing is copied: the job's own
 * files stay where they are, and the record points at them (script = drafts/D<n>/script.md, else storyboard.md; captions = the post
 * text files drafts/D<n>/post.md; voiceOver = the chosen voice-over track; media = the final pictures and videos the person approved,
 * only those that are still exactly as approved).
 *
 * Where it is used:
 *   - applying the concepts decision (board.mjs) calls recordConceptDecision: the opening lines the person wrote or edited go to
 *     bank/yours.jsonl, and the pick goes to preferences.jsonl.
 *   - the final media approval, the final post approval and closing a job (board.mjs) call fileJob.
 *   - pipeline_agent_brief appends libraryBlock; the board's brand page reads boardLibrary (brand.library).
 *
 * Board request (for the board's Brand library panel): operation `bank_remove`, args `{ requestId, id, brand?, bank? }` where `id` is
 * the item's id from brand.library.yours / brand.library.proven, `brand` is the brand slug (when it is left out, the brand whose bank
 * holds the id is used) and `bank` is 'yours' (the default) or 'proven'. It lands with
 * pipeline_board_request_land and applies with pipeline_board_request_apply, like any non-decision request; the receipt result is
 * `{ brand, id }`. The same removal is brand_bank_save with action 'remove'.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import * as facts from './facts.mjs';
import * as runtime from './runtime.mjs';
import { parseConcepts } from './job-document.mjs';
import { readAll as readSharedLibrary } from './library.mjs';

export const BANK_KINDS = Object.freeze(['hook', 'angle', 'style', 'cta', 'caption', 'format', 'industry', 'funnel']);
export const BANKS = Object.freeze(['yours', 'proven']);
export const PROVEN_SOURCES = Object.freeze(['brand', 'competitor']);
/** Research older than this is refreshed instead of reused: the brand's own and its competitors' for 30 days, trends for 7. */
export const RESEARCH_MAX_AGE_DAYS = Object.freeze({ brand: 30, competitor: 30, trend: 7 });

const TEXT_LIMIT = 600;
const DAY_MS = 24 * 60 * 60 * 1000;
const MEDIA_KINDS = Object.freeze({ '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.mp4': 'video', '.mov': 'video', '.m4v': 'video', '.webm': 'video' });
const BOARD_LIMITS = Object.freeze({ yours: 30, proven: 20, jobs: 5, text: 200 });

// ---------------------------------------------------------------- small helpers
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}\u2026` : text;
};
const sameText = (a, b) => String(a ?? '').toLowerCase().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').replace(/\s+/g, ' ').trim() === String(b ?? '').toLowerCase().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').replace(/\s+/g, ' ').trim();
const isoOf = now => {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
};
const stable = value => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));

function readLines(file) {
  let raw = '';
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const value = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value); } catch { /* a half-written line is skipped */ }
  }
  return out;
}

function appendLine(file, value) {
  mkdirSync(join(file, '..'), { recursive: true });
  let lead = '';
  try {
    const size = statSync(file).size;
    if (size > 0) {
      const fd = openSync(file, 'r');
      try { const last = Buffer.alloc(1); readSync(fd, last, 0, 1, size - 1); if (last[0] !== 0x0a) lead = '\n'; } finally { closeSync(fd); }
    }
  } catch { /* a new file */ }
  appendFileSync(file, `${lead}${JSON.stringify(value)}\n`);
}

function hashFile(file) {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let read = readSync(fd, chunk, 0, chunk.length, null); read > 0; read = readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, read));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
function brandDirOf(root, brand) {
  const slug = typeof brand === 'string' ? brand.trim() : '';
  if (!SLUG.test(slug)) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return join(resolve(String(root || '')), 'workspaces', slug);
}

/** The brand's library folder. The brand has to exist when something is written; a read of a brand with no library finds it empty. */
export function brandLibraryDir(root, brand) {
  return join(brandDirOf(root, brand), 'library');
}

function requireBrand(root, brand) {
  const dir = brandDirOf(root, brand);
  if (!existsSync(join(dir, 'workspace.json'))) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return join(dir, 'library');
}

const bankFile = (root, brand, bank) => join(brandLibraryDir(root, brand), 'bank', `${bank}.jsonl`);
const checkBank = bank => {
  if (!BANKS.includes(bank)) throw new InvalidInputError('The bank is yours (the person\'s own lines) or proven (what worked, with its proof).');
  return bank;
};
const checkKind = kind => {
  if (!BANK_KINDS.includes(kind)) throw new InvalidInputError(`The kind must be one of ${BANK_KINDS.join(', ')}.`);
  return kind;
};

// ---------------------------------------------------------------- the bank
function foldBank(file) {
  const byId = new Map();
  for (const line of readLines(file)) if (typeof line.id === 'string' && line.id) byId.set(line.id, line);
  return [...byId.values()];
}

/** The items of a bank, newest first. Removed items are left out unless asked for. */
export function readBank({ root, brand, bank = 'yours', kind = null, includeRemoved = false, limit = null } = {}) {
  checkBank(bank);
  if (kind) checkKind(kind);
  const items = foldBank(bankFile(root, brand, bank))
    .filter(item => (includeRemoved || !item.removed) && (!kind || item.kind === kind) && typeof item.text === 'string')
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return Number.isInteger(limit) && limit > 0 ? items.slice(0, limit) : items;
}

function evidenceOf(value) {
  const input = value && typeof value === 'object' ? value : {};
  const url = runtime.webLink(input.url);
  const views = Number.isFinite(Number(input.views)) && input.views !== null && input.views !== '' ? Math.max(0, Math.round(Number(input.views))) : null;
  const when = input.date ?? input.posted_at;
  const date = typeof when === 'string' && when.trim() ? clip(when, 40) : null;
  return { url, views, date };
}

/**
 * Put one item in a bank, once. Returns { item, saved }: saved is false when the same words are already there (that item is returned).
 * `yours` keeps the person's own lines; an item the person edited from an agent's line carries edited: true and was.
 * `proven` needs the https link of the post it comes from, with its views and date when known.
 */
export function addToBank({ root, brand, bank = 'yours', kind, text, concept = null, jobId = null, edited = false, was = null, evidence = null, source = null, competitor = null, now } = {}) {
  checkBank(bank);
  checkKind(kind);
  const words = clip(text, TEXT_LIMIT);
  if (!words) throw new InvalidInputError('Say the words to save.');
  requireBrand(root, brand);
  const same = readBank({ root, brand, bank, kind }).find(item => sameText(item.text, words));
  if (same) return { item: same, saved: false };
  const at = isoOf(now);
  const id = `${bank === 'yours' ? 'y' : 'p'}-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  let item;
  if (bank === 'proven') {
    const proof = evidenceOf(evidence);
    if (!proof.url) throw new InvalidInputError('A proven item needs the link to the post it comes from.', { fix: 'Pass evidence with an https url, and its views and date when you know them.' });
    if (source !== null && source !== undefined && !PROVEN_SOURCES.includes(source)) throw new InvalidInputError('The source is brand (one of the brand\'s own posts) or competitor.');
    const who = source === 'competitor' && typeof competitor === 'string' && competitor.trim() ? clip(competitor, 80) : null;
    item = { id, kind, text: words, evidence: proof, ...(source ? { source } : {}), ...(who ? { competitor: who } : {}), ...(jobId ? { jobId: String(jobId) } : {}), at };
  } else {
    item = {
      id, kind, text: words,
      ...(typeof concept === 'string' && concept.trim() ? { concept: clip(concept, 8) } : {}),
      ...(jobId ? { jobId: String(jobId) } : {}),
      ...(edited === true ? { edited: true, ...(was ? { was: clip(was, TEXT_LIMIT) } : {}) } : {}),
      at,
    };
  }
  appendLine(bankFile(root, brand, bank), item);
  return { item, saved: true };
}

function liveItem(root, brand, bank, id) {
  checkBank(bank);
  const found = foldBank(bankFile(root, brand, bank)).find(item => item.id === id);
  return found || null;
}

/** Change the words of an item the bank already holds. The old words stay in `was`. Returns { item, changed }. */
export function editBankItem({ root, brand, bank = 'yours', id, text, now } = {}) {
  requireBrand(root, brand);
  const current = liveItem(root, brand, bank, id);
  if (!current || current.removed) throw new InvalidInputError('That item is not in the bank.', { fix: 'Use an id from brand_library_get.' });
  const words = clip(text, TEXT_LIMIT);
  if (!words) throw new InvalidInputError('Say the new words.');
  if (sameText(current.text, words)) return { item: current, changed: false };
  if (readBank({ root, brand, bank, kind: current.kind }).some(item => item.id !== id && sameText(item.text, words))) throw new InvalidInputError('Another item in the bank already says that.');
  const item = { ...current, text: words, edited: true, was: current.text, at: isoOf(now) };
  appendLine(bankFile(root, brand, bank), item);
  return { item, changed: true };
}

/** Take an item out of a bank. The record stays in the file marked removed, so the removal is one more line and a second removal changes nothing. */
export function removeBankItem({ root, brand, bank = 'yours', id, now, missingOk = false } = {}) {
  requireBrand(root, brand);
  const current = liveItem(root, brand, bank, id);
  if (!current && missingOk) return { item: null, removed: false };
  if (!current) throw new InvalidInputError('That item is not in the bank.', { fix: 'Use an id from brand_library_get.' });
  if (current.removed) return { item: current, removed: false };
  const item = { ...current, removed: true, at: isoOf(now) };
  appendLine(bankFile(root, brand, bank), item);
  return { item, removed: true };
}

// ---------------------------------------------------------------- preferences
const preferencesFile = (root, brand) => join(brandLibraryDir(root, brand), 'preferences.jsonl');

/**
 * Log what the person chose at a step and what they passed on. The same record twice in a row for the same job and step is kept once.
 * `picked` is what they chose (for the concepts step { concept, title, line? }), `rejected` the other choices ([{ concept, title }]).
 */
export function recordPreference({ root, brand, jobId, stage, picked, rejected = [], note = null, now } = {}) {
  requireBrand(root, brand);
  if (typeof jobId !== 'string' || !jobId.trim()) throw new InvalidInputError('A preference belongs to a job.');
  if (typeof stage !== 'string' || !stage.trim()) throw new InvalidInputError('Say which step the choice was made at.');
  const record = {
    at: isoOf(now), jobId: jobId.trim(), stage: stage.trim(), picked: picked ?? null,
    rejected: Array.isArray(rejected) ? rejected : [],
    ...(typeof note === 'string' && note.trim() ? { note: clip(note, 400) } : {}),
  };
  const file = preferencesFile(root, brand);
  const last = readLines(file).filter(line => line.jobId === record.jobId && line.stage === record.stage).pop();
  if (last && stable({ ...last, at: null }) === stable({ ...record, at: null })) return { record: last, saved: false };
  appendLine(file, record);
  return { record, saved: true };
}

/** The recorded choices, newest first. */
export function readPreferences({ root, brand, limit = null } = {}) {
  const lines = readLines(preferencesFile(root, brand)).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return Number.isInteger(limit) && limit > 0 ? lines.slice(0, limit) : lines;
}

// ---------------------------------------------------------------- the concept note
const OWN_LINE = /^Your own opening line:\s*"(.*)"\s*$/i;
const EDITED_LINE = /^Edited opening line \(was "(.*?)"\):\s*"(.*)"\s*$/i;
const HEAD_LINE = /^Concept\s+([A-Za-z0-9]{1,8})\s*:\s*(.*?)(?:\s+\u00b7\s+Opening line:\s*"(.*)")?\s*$/i;

/**
 * Read the note the board sends with a concept decision:
 *   Concept B: <title> \u00b7 Opening line: "<line>"
 *   Your own opening line: "<text>"                      (one line each, only when used)
 *   Edited opening line (was "<old>"): "<text>"
 * Returns { conceptId, title, line, own: [text], edited: [{ was, text }] }; conceptId, title and line are null when the first line has
 * no such part, so an older note still reads. The note is not changed: the agents read it as it is.
 */
export function parseConceptNote(note) {
  const lines = String(note ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const out = { conceptId: null, title: null, line: null, own: [], edited: [] };
  const head = lines.length ? HEAD_LINE.exec(lines[0]) : null;
  if (head) {
    out.conceptId = head[1].toUpperCase();
    out.title = head[2].trim() || null;
    out.line = typeof head[3] === 'string' && head[3].trim() ? head[3].trim() : null;
  }
  for (const line of lines.slice(head ? 1 : 0)) {
    const own = OWN_LINE.exec(line);
    if (own) { if (own[1].trim()) out.own.push(own[1].trim()); continue; }
    const edit = EDITED_LINE.exec(line);
    if (edit && edit[2].trim()) out.edited.push({ was: edit[1].trim(), text: edit[2].trim() });
  }
  return out;
}

const hookOptions = value => {
  const text = String(value || '').trim();
  if (!text) return [];
  const numbered = text.split(/(?:^|\s|\n)\d[).]\s+/).map(part => part.trim().replace(/^["\u201c]|["\u201d]$/g, '').trim()).filter(Boolean);
  return numbered.length ? numbered : [text.replace(/^["\u201c]|["\u201d]$/g, '').trim()];
};
const sourceKind = text => {
  const value = String(text || '');
  if (!value.trim()) return null;
  if (/competitor/i.test(value.slice(0, 60))) return 'competitors';
  if (/trend|rising|viral/i.test(value.slice(0, 60))) return 'trending';
  if (/\b(brand|own|bank|proven|yours?)\b/i.test(value.slice(0, 60))) return 'brand';
  return clip(value, 80);
};
const fieldOf = (concept, pattern) => concept?.fields?.find(field => pattern.test(field.label || ''))?.value ?? null;

function conceptsOf(jobDir) {
  try { return parseConcepts(readFileSync(join(jobDir, 'concepts.md'), 'utf8')).concepts; } catch { return []; }
}

/**
 * The concepts decision, once it is applied: the person's own and edited opening lines go to bank/yours.jsonl (with the concept and the
 * job), and the choice goes to preferences.jsonl (the picked concept and line, the other concepts as passed over). Returns { saved, preference }.
 */
export function recordConceptDecision({ root, brand, jobId, note, chosen = null, now } = {}) {
  const parsed = parseConceptNote(note);
  const conceptId = (typeof chosen === 'string' && chosen.trim() ? chosen.trim().toUpperCase() : null) || parsed.conceptId;
  const job = facts.jobAt(root, brand, jobId);
  const concepts = job ? conceptsOf(job.dir) : [];
  const picked = concepts.find(concept => concept.id === conceptId) || null;
  const saved = [];
  const hook = (text, extra = {}) => addToBank({ root, brand, bank: 'yours', kind: 'hook', text, concept: conceptId, jobId, now, ...extra });
  for (const text of parsed.own) saved.push(hook(text));
  for (const edit of parsed.edited) saved.push(hook(edit.text, { edited: true, was: edit.was }));
  const preference = conceptId
    ? recordPreference({
      root, brand, jobId, stage: 'concept', now,
      picked: { concept: conceptId, title: picked?.title ?? parsed.title, ...(parsed.line ? { line: parsed.line } : {}) },
      rejected: concepts.filter(concept => concept.id !== conceptId).map(concept => ({ concept: concept.id, title: concept.title })),
    })
    : null;
  return { saved, preference };
}

// ---------------------------------------------------------------- research
function researchGroup(topic) {
  const name = String(topic || '').toLowerCase();
  if (/trend|concept-sources|rising|viral/.test(name)) return 'trend';
  if (/competitor/.test(name)) return 'competitor';
  if (/audience|product|customer|brand|positioning|sources|posts|voice/.test(name)) return 'brand';
  return 'other';
}

const researchFile = (root, brand, jobId) => join(brandLibraryDir(root, brand), 'research', `${jobId}.json`);

/**
 * The research the brand's jobs left, newest first, one entry per topic unless every file is asked for: { jobId, topic, path, sha256,
 * at, ageDays, group, maxAgeDays, fresh }. `fresh` says whether it is young enough to reuse (brand and competitor research under 30
 * days, trends under 7); it is null for a topic with no limit. A file that is no longer on disk is left out.
 */
export function researchIndex({ root, brand, now, all = false } = {}) {
  const dir = join(brandLibraryDir(root, brand), 'research');
  let names = [];
  try { names = readdirSync(dir).filter(name => name.endsWith('.json')); } catch { return []; }
  const when = new Date(isoOf(now)).getTime();
  const entries = [];
  for (const name of names) {
    const record = readJson(join(dir, name));
    if (!record || typeof record !== 'object' || !Array.isArray(record.files)) continue;
    for (const file of record.files) {
      if (!file || typeof file.path !== 'string' || !existsSync(join(resolve(String(root)), ...file.path.split('/')))) continue;
      const at = typeof file.at === 'string' ? file.at : typeof record.at === 'string' ? record.at : null;
      const stamp = Date.parse(at);
      const group = researchGroup(file.topic);
      const maxAgeDays = RESEARCH_MAX_AGE_DAYS[group] ?? null;
      const ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((when - stamp) / DAY_MS)) : null;
      entries.push({ jobId: record.jobId || name.replace(/\.json$/, ''), topic: String(file.topic || ''), path: file.path, sha256: file.sha256 || null, at, ageDays, group, maxAgeDays, fresh: maxAgeDays === null || ageDays === null ? null : ageDays < maxAgeDays });
    }
  }
  entries.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  if (all) return entries;
  const seen = new Set();
  return entries.filter(entry => (seen.has(entry.topic) ? false : seen.add(entry.topic)));
}

// ---------------------------------------------------------------- filing a job
const jobRecordFile = (root, brand, jobId) => join(brandLibraryDir(root, brand), 'jobs', `${jobId}.json`);

/** The filed job records, newest first. */
export function readFiledJobs({ root, brand, limit = null } = {}) {
  const dir = join(brandLibraryDir(root, brand), 'jobs');
  let names = [];
  try { names = readdirSync(dir).filter(name => name.endsWith('.json')); } catch { return []; }
  const records = names.map(name => readJson(join(dir, name))).filter(record => record && typeof record === 'object' && record.jobId)
    .sort((a, b) => String(b.filedAt ?? '').localeCompare(String(a.filedAt ?? '')));
  return Number.isInteger(limit) && limit > 0 ? records.slice(0, limit) : records;
}

/** The latest decision of a gate, only when it is an approval (a later request for changes voids an earlier approval). */
function latestApproved(jobDir, gate) {
  let latest = null;
  try {
    for (const name of readdirSync(join(jobDir, 'approvals'))) {
      const found = new RegExp(`^${gate}-(\\d+)\\.json$`).exec(name);
      if (!found) continue;
      const record = readJson(join(jobDir, 'approvals', name));
      const round = Number.isFinite(Number(record?.round)) ? Number(record.round) : Number(found[1]);
      if (record && (!latest || round >= latest.round)) latest = { round, record };
    }
  } catch { return null; }
  return latest && ['approved', 'approve'].includes(latest.record.decision) ? latest.record : null;
}

const mediaKindOf = path => MEDIA_KINDS[extname(String(path)).toLowerCase()] || null;
const within = (jobDir, path) => typeof path === 'string' && path && !path.startsWith('/') && !path.split(/[\\/]/).includes('..') && existsSync(join(jobDir, ...path.split('/')));

/** The final pictures and videos the person approved, only while they are still exactly as approved. */
function approvedMedia(job, contentApproval) {
  const found = new Map();
  const add = (path, sha256, current = null) => {
    if (!within(job.dir, path) || !mediaKindOf(path) || found.has(path)) return;
    let sha = typeof sha256 === 'string' && sha256 ? sha256 : null;
    if (current === 'check') {
      try { const now = hashFile(join(job.dir, ...path.split('/'))); if (sha && sha !== now) return; sha = now; } catch { return; }
    }
    if (sha) found.set(path, { path, sha256: sha, kind: mediaKindOf(path), approved: true });
  };
  for (const artifact of Array.isArray(contentApproval?.artifacts) ? contentApproval.artifacts : []) add(artifact?.path, artifact?.sha256, 'check');
  if (found.size) return [...found.values()];
  for (const gate of ['finish', 'cut', 'clips', 'pictures']) {
    if (!facts.MEDIA_REVIEWS[gate] || !facts.mediaSetApproved(job, gate)) continue;
    const decision = readJson(join(job.dir, ...facts.MEDIA_REVIEWS[gate].file.split('/')));
    for (const file of Array.isArray(decision?.files) ? decision.files : []) add(file?.file, file?.sha256);
    if (found.size) break;
  }
  return [...found.values()];
}

function filesNamed(job, relativePaths) {
  const out = [];
  for (const path of relativePaths) {
    try { out.push({ path: posix.join('workspaces', job.brand, 'jobs', job.jobId, path), sha256: createHash('sha256').update(readFileSync(join(job.dir, ...path.split('/')))).digest('hex') }); } catch { /* gone */ }
  }
  return out;
}

function draftFiles(job, name) {
  try {
    return readdirSync(join(job.dir, 'drafts'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^D\d+$/.test(entry.name) && existsSync(join(job.dir, 'drafts', entry.name, name)))
      .map(entry => `drafts/${entry.name}/${name}`)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  } catch { return []; }
}

function researchFilesOf(job) {
  let names = [];
  try { names = readdirSync(join(job.dir, 'research'), { withFileTypes: true }).filter(entry => entry.isFile() && !entry.name.startsWith('.') && /\.md$/i.test(entry.name)).map(entry => entry.name).sort(); } catch { return []; }
  return names.map(name => {
    const file = join(job.dir, 'research', name);
    try {
      return { path: posix.join('workspaces', job.brand, 'jobs', job.jobId, 'research', name), sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), topic: name.replace(/\.[^.]+$/, ''), at: statSync(file).mtime.toISOString() };
    } catch { return null; }
  }).filter(Boolean);
}

function conceptRecord(job) {
  const approval = latestApproved(job.dir, 'concept');
  if (!approval) return { concept: null, rubric: null };
  const parsed = parseConceptNote(approval.comment);
  const id = (typeof approval.chosen === 'string' && approval.chosen.trim() ? approval.chosen.trim().toUpperCase() : null) || parsed.conceptId;
  if (!id) return { concept: null, rubric: null };
  const concept = conceptsOf(job.dir).find(item => item.id === id) || null;
  const hook = parsed.line || hookOptions(fieldOf(concept, /^hook options/i))[0] || fieldOf(concept, /^hook\b/i) || null;
  const rubric = fieldOf(concept, /^rubric/i);
  return {
    concept: { id, title: concept?.title ?? parsed.title ?? null, source: sourceKind(fieldOf(concept, /^source/i)), hook: hook ? clip(hook, TEXT_LIMIT) : null },
    rubric: rubric ? clip(rubric, 300) : null,
  };
}

function choiceRecords(job) {
  const read = path => readJson(join(job.dir, ...path.split('/')));
  const music = read('media/music/choice.json');
  const voice = read('media/voice/choice.json');
  let shared = [];
  try { shared = readSharedLibrary(job.root); } catch { /* no shelf yet */ }
  const idOf = (choice, kind) => (choice?.sha256 ? shared.find(item => item.kind === kind && item.sha256 === choice.sha256)?.id ?? null : null);
  const hasMusic = music && music.source !== 'none' && music.source !== 'pending' && music.title;
  const hasVoice = voice && voice.source !== 'none' && voice.source !== 'pending' && voice.file;
  return {
    music: hasMusic ? { id: music.id ?? idOf(music, 'music'), title: String(music.title) } : null,
    voice: hasVoice ? { id: voice.id ?? idOf(voice, 'voice') } : null,
    voiceOver: hasVoice && within(job.dir, voice.file) ? filesNamed(job, [voice.file])[0] ?? null : null,
  };
}

/**
 * Put a job's finished work in the brand's library: a record that points at the job's own files (nothing is copied), the research it
 * left, and the concept, music and voice it used. Filing the same job again changes nothing; when the job changed since (more media
 * approved, a new research file) the record is updated and keeps its first filing time.
 * Returns { filed, changed, jobId, record, reason? }; filed is false (with the reason in plain words) for a job with no brand, or one
 * where nothing is approved yet.
 */
export function fileJob({ root, brand, jobId, now } = {}) {
  if (runtime.isGeneralBrand(brand)) return { filed: false, changed: false, jobId, reason: 'A job with no brand has no library to go in.' };
  requireBrand(root, brand);
  const job = facts.jobAt(root, brand, jobId);
  if (!job) throw new InvalidInputError('That job could not be found for that brand.', { fix: 'Use the brand and jobId from pipeline_status.' });
  const content = latestApproved(job.dir, 'content');
  const media = approvedMedia(job, content);
  const { concept, rubric } = conceptRecord(job);
  if (!media.length && !content && !concept) return { filed: false, changed: false, jobId, reason: 'Nothing in this job is approved yet, so there is nothing to file.' };
  const info = readJson(join(job.dir, 'job.json'), {}) || {};
  const research = researchFilesOf(job);
  const scripts = draftFiles(job, 'script.md');
  const kit = join(resolve(String(root)), 'workspaces', brand, 'brand', 'brand-kit.json');
  const choices = choiceRecords(job);
  const previous = readJson(jobRecordFile(root, brand, jobId));
  const record = {
    jobId, title: String(info.title || jobId), filedAt: previous?.filedAt || isoOf(now),
    concept, research: research.map(file => file.path),
    script: filesNamed(job, scripts.length ? scripts : draftFiles(job, 'storyboard.md')),
    voiceOver: choices.voiceOver,
    captions: filesNamed(job, draftFiles(job, 'post.md')),
    music: choices.music, voice: choices.voice,
    ...(existsSync(kit) ? { styleKit: { path: posix.join('workspaces', brand, 'brand', 'brand-kit.json'), sha256: createHash('sha256').update(readFileSync(kit)).digest('hex') } } : {}),
    media: media.map(item => ({ ...item, path: posix.join('workspaces', brand, 'jobs', jobId, item.path) })),
    ...(rubric ? { rubric } : {}),
  };
  let changed = false;
  if (!previous || stable({ ...previous, filedAt: null }) !== stable({ ...record, filedAt: null })) { writeJson(jobRecordFile(root, brand, jobId), record); changed = true; }
  if (research.length) {
    const profile = readJson(join(resolve(String(root)), 'workspaces', brand, 'brand', 'profile.json'), {}) || {};
    const industry = typeof profile.industry === 'string' && profile.industry.trim() ? clip(profile.industry, 80) : null;
    const entry = { jobId, at: research.map(file => file.at).sort().pop(), files: research, ...(industry ? { industry } : {}) };
    const file = researchFile(root, brand, jobId);
    if (stable(readJson(file)) !== stable(entry)) { writeJson(file, entry); changed = true; }
  }
  return { filed: true, changed, jobId, record };
}

/** fileJob for the paths that must never fail because of it (an approval, closing a job): a problem is logged to stderr and nothing else happens. */
export function fileJobQuietly(options) {
  try { return fileJob(options); } catch (error) {
    try { process.stderr.write(`brand library: could not file ${options?.jobId ?? 'a job'}: ${String(error?.message || error).slice(0, 300)}\n`); } catch { /* nothing to write to */ }
    return null;
  }
}

// ---------------------------------------------------------------- what the rest of the plugin reads
/** Counts for the board. */
export function librarySummary({ root, brand, now } = {}) {
  return {
    brand,
    counts: {
      yours: readBank({ root, brand, bank: 'yours' }).length,
      proven: readBank({ root, brand, bank: 'proven' }).length,
      research: researchIndex({ root, brand, now }).length,
      jobs: readFiledJobs({ root, brand }).length,
      preferences: readPreferences({ root, brand }).length,
    },
  };
}

const jobLine = record => ({
  jobId: record.jobId, title: record.title, filedAt: record.filedAt,
  concept: record.concept ? { id: record.concept.id, title: record.concept.title, source: record.concept.source, hook: record.concept.hook } : null,
  mediaCount: Array.isArray(record.media) ? record.media.length : 0,
});

/**
 * The brand page's library: { counts, yours, proven, recentJobs }, small enough to ride in the board document (the person's newest
 * items, the proven items with the most views, the last jobs filed). Never throws: a library that cannot be read is an empty one.
 */
export function boardLibrary({ root, brand, now } = {}) {
  const empty = { counts: { yours: 0, proven: 0, research: 0, jobs: 0, preferences: 0 }, industry: null, yours: [], proven: [], recentJobs: [] };
  try {
    const yours = readBank({ root, brand, bank: 'yours' });
    const proven = readBank({ root, brand, bank: 'proven' }).sort((a, b) => (b.evidence?.views ?? -1) - (a.evidence?.views ?? -1) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
    const jobs = readFiledJobs({ root, brand });
    return {
      counts: { ...librarySummary({ root, brand, now }).counts },
      industry: yours.find(item => item.kind === 'industry') || null,
      yours: yours.slice(0, BOARD_LIMITS.yours).map(item => ({ ...item, text: clip(item.text, BOARD_LIMITS.text), ...(item.was ? { was: clip(item.was, BOARD_LIMITS.text) } : {}) })),
      proven: proven.slice(0, BOARD_LIMITS.proven).map(item => ({ ...item, source: item.source || 'brand', text: clip(item.text, BOARD_LIMITS.text) })),
      recentJobs: jobs.slice(0, BOARD_LIMITS.jobs).map(jobLine),
    };
  } catch { return empty; }
}

const quoted = text => `"${clip(text, 160)}"`;
const viewsText = views => (Number.isFinite(views) ? `${views.toLocaleString('en-US')} views` : null);

/**
 * A short block for an agent's brief: the person's own lines, the proven items, the research already on file with its age, and the
 * last choices the person made. null when the library is empty. Kept to a few hundred words.
 */
export function libraryBlock({ root, brand, now } = {}) {
  let industry = null; let yours = []; let proven = []; let research = []; let choices = [];
  try {
    const own = readBank({ root, brand, bank: 'yours' });
    industry = own.find(item => item.kind === 'industry') || null;
    yours = own.filter(item => item.kind !== 'industry').slice(0, 6);
    proven = readBank({ root, brand, bank: 'proven' }).sort((a, b) => (b.evidence?.views ?? -1) - (a.evidence?.views ?? -1)).slice(0, 5);
    research = researchIndex({ root, brand, now }).slice(0, 6);
    choices = readPreferences({ root, brand, limit: 3 });
  } catch { return null; }
  if (!industry && !yours.length && !proven.length && !research.length && !choices.length) return null;
  const lines = ['Brand library (what this brand already has; ask brand_library_get for more):'];
  if (industry) lines.push(`Industry (the person's pick): ${clip(industry.text, 120)}`);
  if (yours.length) {
    lines.push('The person\'s own lines. Use them word for word, never reword them:');
    for (const item of yours) lines.push(`- ${item.kind}: ${quoted(item.text)}${item.concept ? ` (concept ${item.concept})` : ''}${item.edited ? ', edited by the person' : ''}`);
  }
  if (proven.length) {
    lines.push('Proven, with the post that shows it:');
    for (const item of proven) lines.push(`- ${item.kind}: ${quoted(item.text)} (${[item.source === 'competitor' ? `competitor${item.competitor ? ` ${clip(item.competitor, 40)}` : ''}` : "the brand's own", viewsText(item.evidence?.views), item.evidence?.date, item.evidence?.url].filter(Boolean).join(', ')})`);
  }
  if (research.length) {
    lines.push('Research already done. Reuse brand and competitor research under 30 days old and trends under 7 days old; refresh only the rest, and say which you reused:');
    for (const item of research) lines.push(`- ${item.topic || 'research'}: ${item.ageDays === null ? 'date unknown' : `${item.ageDays} ${item.ageDays === 1 ? 'day' : 'days'} old`}${item.fresh === null ? '' : item.fresh ? ', reuse' : ', refresh'} - ${item.path}`);
  }
  if (choices.length) {
    lines.push('What the person chose lately. Follow it:');
    for (const choice of choices) {
      const picked = choice.picked || {};
      const passed = (choice.rejected || []).map(item => `${item.concept}${item.title ? ` (${clip(item.title, 50)})` : ''}`).join(', ');
      lines.push(`- ${choice.stage}: picked ${picked.concept ? `concept ${picked.concept}` : 'one option'}${picked.title ? ` (${clip(picked.title, 60)})` : ''}${picked.line ? ` with the opening line ${quoted(picked.line)}` : ''}${passed ? `; passed on ${passed}` : ''}`);
    }
  }
  return lines.join('\n');
}
