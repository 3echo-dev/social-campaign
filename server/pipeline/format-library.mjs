/**
 * The format library: how a short video is labelled, on four separate axes, so any video (the brand's, a competitor's, a viral one,
 * a job's own) gets one label per axis and the labels can be counted, ranked and chosen.
 *
 *   pipeline/library/formats.json     { version, axes: { format, editing, visualHook, series: [Entry] }, legacyFormats }
 *   Entry = { id, name, definition, whyItWorks, examples: [{ url, platform, views?, note }] }
 *
 *   format      the story structure              F-TUTORIAL, F-LISTICLE, F-BREAKDOWN, F-STORY, F-BEFORE-AFTER, F-MYTH-FACT, ...
 *   editing     how it looks on screen           E-TALKING-HEAD, E-FACELESS-BROLL, E-SCREEN-RECORDING, E-SPLIT-SCREEN, ...
 *   visualHook  what the first two seconds show  V-OBJECT-IN-HAND, V-PATTERN-INTERRUPT, V-TEXT-SHOCK, V-RESULT-FIRST, ...
 *   series      a repeatable episode             S-CASE-STUDY, S-MYTH-WEEK, S-TOOL-OF-DAY, S-TEARDOWN
 *
 * A video's labels are { format, editing, visualHook, series?, subtopic }: a library id, or { custom: "text" } when nothing fits.
 * The subtopic has no library (it is one of the brand's own six, see brand-intelligence.mjs), so it is { custom } until the six are
 * confirmed and a subtopic id afterwards.
 *
 * pipeline/playbooks/visual-formats.md keeps its own F-* container ids (the stage pairing table and a post's format_id read it), so
 * `legacyFormats` maps each of them onto the axes: an older concept or filed job still lands on the right rows.
 *
 * The file is read on demand and cached by its modification time. Nothing in here throws on a bad file: a library that cannot be read
 * is an empty one.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT_LIBRARY_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'library', 'formats.json');

/** The axes a library entry belongs to, and the id prefix each one uses. */
export const AXES = Object.freeze(['format', 'editing', 'visualHook', 'series']);
export const AXIS_PREFIX = Object.freeze({ format: 'F-', editing: 'E-', visualHook: 'V-', series: 'S-' });
/** The labels a video carries: the four axes (series is optional) and the subtopic. */
export const LABEL_KEYS = Object.freeze(['format', 'editing', 'visualHook', 'series', 'subtopic']);
/** The labels every taken-apart video must have. */
export const REQUIRED_LABELS = Object.freeze(['format', 'editing', 'visualHook', 'subtopic']);
/** The words of each axis for the person and for problem messages. */
export const AXIS_WORDS = Object.freeze({ format: 'format', editing: 'editing style', visualHook: 'visual hook', series: 'series', subtopic: 'subtopic' });

const CUSTOM_LIMIT = 80;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const plain = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value, limit) => {
  const text = plain(value);
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
};
const nameKey = value => plain(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- the file
let cache = null;

/** The library as it is on disk: { version, axes: {axis: [entry]}, legacyFormats }. Empty axes when the file cannot be read. */
export function formatLibrary({ file = FORMAT_LIBRARY_FILE } = {}) {
  let stamp = null;
  try { const stat = statSync(file); stamp = `${stat.mtimeMs}:${stat.size}`; } catch { stamp = null; }
  if (cache && cache.file === file && cache.stamp === stamp) return cache.value;
  const empty = { version: 1, axes: Object.fromEntries(AXES.map(axis => [axis, []])), legacyFormats: {} };
  let value = empty;
  if (stamp) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const axes = Object.fromEntries(AXES.map(axis => [axis, (Array.isArray(raw?.axes?.[axis]) ? raw.axes[axis] : [])
        .filter(entry => isObject(entry) && typeof entry.id === 'string' && entry.id.startsWith(AXIS_PREFIX[axis]) && typeof entry.name === 'string')
        .map(entry => Object.freeze({
          id: entry.id, name: plain(entry.name), definition: plain(entry.definition), whyItWorks: plain(entry.whyItWorks),
          examples: Array.isArray(entry.examples) ? entry.examples.filter(item => isObject(item) && typeof item.url === 'string') : [],
        }))]));
      value = { version: Number(raw?.version) || 1, axes, legacyFormats: isObject(raw?.legacyFormats) ? raw.legacyFormats : {} };
    } catch { value = empty; }
  }
  cache = { file, stamp, value };
  return value;
}

/** The entries of one axis, in the order of the file. */
export function axisEntries(axis, options) {
  return formatLibrary(options).axes[axis] ?? [];
}

/** The entry with this id and the axis it sits on: { axis, id, name, definition, whyItWorks, examples }, or null. */
export function findEntry(id, options) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  const library = formatLibrary(options);
  for (const axis of AXES) {
    const entry = library.axes[axis].find(item => item.id === key);
    if (entry) return { axis, ...entry };
  }
  return null;
}

/** { id: name } for the ids given (an id the library does not hold is left out). */
export function formatNamesFor(ids, options) {
  const out = {};
  for (const id of ids ?? []) {
    const entry = typeof id === 'string' ? findEntry(id, options) : null;
    if (entry) out[entry.id] = entry.name;
  }
  return out;
}

/** The id of a library entry that the text names (its id anywhere in it, else its name word for word), or null. `axis` limits the search. */
export function entryIdIn(text, axis = null, options) {
  const value = plain(text);
  if (!value) return null;
  const axes = axis ? [axis] : AXES;
  const library = formatLibrary(options);
  const found = value.match(/\b([FEVS]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g) ?? [];
  for (const id of found) for (const name of axes) if (library.axes[name].some(entry => entry.id === id)) return id;
  const key = nameKey(value);
  for (const name of axes) {
    const entry = library.axes[name].find(item => nameKey(item.name) === key);
    if (entry) return entry.id;
  }
  // "F-TUTORIAL Tutorial" or "Tutorial (step by step)": the name leads the text.
  for (const name of axes) {
    const entry = library.axes[name].find(item => key === nameKey(item.name) || key.startsWith(`${nameKey(item.name)} `) || key.endsWith(` ${nameKey(item.name)}`));
    if (entry) return entry.id;
  }
  return null;
}

/**
 * What an older playbook container id (F-TALKING-HEAD, F-PROOF-CARD, ...) stands for on the axes: { format?, editing?, visualHook? }, or null.
 * An id the library already holds, or one nobody mapped, is null.
 */
export function mapLegacyFormat(id, options) {
  const key = String(id ?? '').trim();
  const map = formatLibrary(options).legacyFormats[key];
  if (!isObject(map)) return null;
  const out = {};
  for (const axis of ['format', 'editing', 'visualHook']) if (typeof map[axis] === 'string' && findEntry(map[axis], options)) out[axis] = map[axis];
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- the labels
/**
 * One label as it is kept: a library id of the right axis, or { custom: "text" }. A library name ("Tutorial") is read as its id; for the
 * subtopic any text is custom. Returns { value } or { problem } (plain words, naming what to do).
 */
export function cleanLabel(raw, axis, options) {
  const word = AXIS_WORDS[axis] ?? axis;
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (isObject(raw)) {
    const keys = Object.keys(raw);
    const text = typeof raw.custom === 'string' ? clip(raw.custom, CUSTOM_LIMIT) : '';
    if (keys.length !== 1 || keys[0] !== 'custom' || !text) return { problem: `${word} must be a library id or {"custom": "text"}.` };
    // A custom label that says exactly a library entry is that entry.
    if (axis !== 'subtopic') {
      const same = entryIdIn(text, axis, options);
      if (same && nameKey(text) === nameKey(findEntry(same, options)?.name)) return { value: same };
    }
    return { value: { custom: text } };
  }
  if (typeof raw !== 'string') return { problem: `${word} must be a library id or {"custom": "text"}.` };
  const text = plain(raw);
  if (!text) return { value: null };
  if (axis === 'subtopic') return /^st-[a-z0-9]{4,}$/.test(text) ? { value: text } : { value: { custom: clip(text, CUSTOM_LIMIT) } };
  const entry = findEntry(text, options);
  if (entry) return entry.axis === axis ? { value: entry.id } : { problem: `${text} is on the ${AXIS_WORDS[entry.axis] ?? entry.axis} axis of the library, not on the ${word} axis.` };
  const named = entryIdIn(text, axis, options);
  if (named && nameKey(text) === nameKey(findEntry(named, options)?.name)) return { value: named };
  return { problem: `${word} "${clip(text, 40)}" is not in the format library. Use one of its ids (${axisEntries(axis, options).slice(0, 3).map(entry => entry.id).join(', ')}, ...) or {"custom": "${clip(text, 24)}"} when nothing fits.` };
}

/**
 * The labels of a taken-apart video: { format, editing, visualHook, series?, subtopic }. `required` makes the four main ones needed.
 * Returns { value, problems: [{ key, problem }] }; value holds the labels that are fine.
 */
export function cleanLabels(raw, { required = false } = {}, options) {
  const problems = [];
  const value = {};
  if (raw === undefined || raw === null) {
    if (required) for (const key of REQUIRED_LABELS) problems.push({ key, problem: `${AXIS_WORDS[key]} is required: label every video taken apart on all four axes (format, editing style, visual hook, subtopic).` });
    return { value, problems };
  }
  if (!isObject(raw)) return { value, problems: [{ key: null, problem: 'labels must be an object: { format, editing, visualHook, series?, subtopic }.' }] };
  for (const key of Object.keys(raw)) if (!LABEL_KEYS.includes(key)) problems.push({ key, problem: `"${key}" is not a label. Use ${LABEL_KEYS.join(', ')}.` });
  for (const key of LABEL_KEYS) {
    const given = raw[key];
    if (given === undefined || given === null || given === '') {
      if (required && REQUIRED_LABELS.includes(key)) problems.push({ key, problem: `${AXIS_WORDS[key]} is required: pick a library id, or {"custom": "text"} when nothing fits.` });
      continue;
    }
    const out = cleanLabel(given, key, options);
    if (out.problem) problems.push({ key, problem: out.problem });
    else if (out.value) value[key] = out.value;
  }
  return { value, problems };
}

/** A label for a person: the library name of an id, the custom text, or the text of anything else. */
export function labelName(label, options) {
  if (isObject(label)) return clip(label.custom, CUSTOM_LIMIT);
  if (typeof label !== 'string') return '';
  return findEntry(label, options)?.name ?? label;
}

/** The label of one axis as a library id (null for a custom label or none). */
export const labelId = (label, options) => (typeof label === 'string' && findEntry(label, options) ? label : null);

/**
 * The options a Strategy gate row offers for an axis, in the order of the file: { id, text, hint }. The text is "<id> <name>" like the
 * other playbook rows ("E-SCREEN-RECORDING Screen recording"), so the approval note keeps the exact entry; hint is its one-line definition.
 */
export function libraryRow(axis, options) {
  return axisEntries(axis, options).map(entry => ({ id: entry.id, text: `${entry.id} ${entry.name}`, hint: entry.definition }));
}
