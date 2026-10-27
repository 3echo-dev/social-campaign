/**
 * Is a freshly downloaded 3Echo picture or clip the kind of file the job asked for?
 *
 * Run by land-outputs.mjs right after the file is saved and before it is copied into the media folder, so a square
 * clip for a 9:16 slot, a clip cut short, a picture where a clip was wanted, or a file that does not play is found
 * now and not at posting time (publish-preflight.mjs checks shape and length again, much later).
 *
 * The answer is one of:
 *  - { verdict: 'ok' }
 *  - { verdict: 'mismatch', reason }   a clear fault; `reason` is a plain sentence for the person
 *  - { verdict: 'unverified', why }    the check could not run (no ffprobe, took too long, nothing to compare with)
 * Only 'mismatch' stops a file. 'unverified' lets it through exactly as before.
 */

import { basename, extname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { inspectMedia } from './media-probe.mjs';

// 3% either way of the asked-for width / height: wide enough for providers that round sizes to a multiple of 16 or 64, far
// too narrow to let a square or landscape result through for a 9:16 slot.
const RATIO_TOLERANCE = 0.03;
const DURATION_TOLERANCE_SECONDS = 1;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);

const number = value => (value === null || value === undefined || value === '' ? NaN : Number(value));

/** "9:16", "9/16", "9x16" or 0.5625 as width / height, or null. */
export function parseRatio(value) {
  if (typeof value === 'number') return value > 0 && Number.isFinite(value) ? value : null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(value ?? ''));
  if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return Number(match[1]) / Number(match[2]);
  const plain = number(value);
  return plain > 0 ? plain : null;
}

/** "image" or "video" from a file name's extension, or null for anything else (sound files and the like). */
export function kindOfFile(file) {
  const ext = extname(String(file || '')).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : VIDEO_EXTENSIONS.has(ext) ? 'video' : null;
}

const itemKind = entry => (entry.kind === 'image' || entry.kind === 'video' ? entry.kind : kindOfFile(entry.file));

const fileBase = entry => basename(entry.file, extname(entry.file)).toLowerCase();
// "S1-take2" is the second take (version 2) of the clip S1; a file with no take suffix is the first.
const takeOf = entry => Number(/-take(\d+)$/.exec(fileBase(entry))?.[1] || 1);
const askedShape = entry => JSON.stringify([[entry.ratio, entry.aspectRatio, entry.aspect_ratio].find(value => parseRatio(value) !== null) ?? null, [entry.headroom?.askSec, entry.durationSeconds].map(number).find(value => value > 0) ?? null]);

/** Several items of one kind share the slot: pick by the version they carry, then by their take number, then by what they ask for. */
function narrowByVersion(pool, version) {
  if (pool.length < 2 || !Number.isInteger(version)) return pool;
  const stated = pool.filter(entry => entry.version !== undefined && entry.version !== null);
  if (stated.length) {
    const hit = stated.filter(entry => Number(entry.version) === version);
    if (hit.length) return hit;
  }
  if (new Set(pool.map(takeOf)).size === pool.length) {
    const hit = pool.filter(entry => takeOf(entry) === version);
    if (hit.length) return hit;
  }
  // Takes that ask for exactly the same thing cannot give a different answer, so there is nothing to guess.
  return new Set(pool.map(askedShape)).size === 1 ? [pool[0]] : pool;
}

/**
 * The one generation manifest item for a slot. `item` is the slot's name from its job key (a panel such as P1, or a clip
 * such as S1), `fileKind` the kind of the file that landed (picture or clip) and `version` the version in the key.
 *
 * An item belongs to the slot when its file is named for it, or else when its panel is. Only items of the landed kind
 * count, so a clip is never compared with the picture that shares its name or panel; when nothing of that kind is listed
 * the answer is no item (the check then lets the file through unchecked). When several items of the kind share the slot,
 * the version picks one (see narrowByVersion). Still more than one is never guessed: `ambiguous` is true and `hit` is null.
 * Without a `fileKind` the kinds are not told apart.
 */
export function manifestItemFor(jobDir, deliverable, item, fileKind = null, version = null) {
  let items = [];
  try {
    const manifest = JSON.parse(readFileSync(join(jobDir, 'drafts', deliverable, 'generation-manifest.json'), 'utf8'));
    items = (Array.isArray(manifest?.items) ? manifest.items : []).filter(entry => typeof entry?.file === 'string');
  } catch { items = []; }
  const wanted = String(item).toLowerCase();
  const ofKind = items.filter(entry => !fileKind || itemKind(entry) === fileKind);
  const named = ofKind.filter(entry => fileBase(entry) === wanted);
  const pool = narrowByVersion(named.length ? named : ofKind.filter(entry => String(entry.panel ?? '').toLowerCase() === wanted), version === null ? null : Number(version));
  if (pool.length > 1) return { hit: null, ambiguous: true };
  return { hit: pool[0] || null, ambiguous: false };
}

/** What the generation manifest asked for this slot: `{ kind, ratio, ratioText, seconds }`, each null when not stated. */
export function requestedFor(jobDir, deliverable, item, fileKind = null, version = null) {
  const { hit, ambiguous } = manifestItemFor(jobDir, deliverable, item, fileKind, version);
  if (!hit) return { kind: null, ratio: null, ratioText: null, seconds: null, ambiguous };
  const kind = itemKind(hit);
  const ratioText = [hit.ratio, hit.aspectRatio, hit.aspect_ratio].find(value => parseRatio(value) !== null) ?? null;
  // The hook clip is asked for more than its beat lasts: its headroom is the length that was requested.
  const seconds = [hit.headroom?.askSec, hit.durationSeconds].map(number).find(value => value > 0) ?? null;
  return { kind, ratio: parseRatio(ratioText), ratioText: ratioText === null ? null : String(ratioText), seconds, ambiguous: false };
}

const shapeName = ratio => (Math.abs(ratio - 1) <= 0.02 ? 'square' : ratio < 1 ? 'tall' : 'wide');
const secondsWords = value => `${Math.round(value * 10) / 10} second${Math.round(value * 10) / 10 === 1 ? '' : 's'}`;

/** Compare a saved file with what was asked for. `file` is an absolute path; `requested` is requestedFor(...). */
export function checkGeneratedMedia(file, requested, { inspect = inspectMedia } = {}) {
  const wantKind = requested?.kind || null;
  // Two items in the plan share this name and kind: say so rather than check against a guess.
  if (requested?.ambiguous && kindOfFile(file)) return { verdict: 'mismatch', reason: 'More than one picture or clip in the plan has this name, so it cannot tell which one this is.' };
  const looked = inspect(file);
  if (looked.status === 'unavailable') return { verdict: 'unverified', why: looked.why };
  const ext = extname(file).slice(1).toLowerCase();
  // Sound files and the like are not this check's business.
  if (looked.status === 'unreadable' && !IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext) && wantKind === null) return { verdict: 'unverified', why: 'it is not a picture or video file' };
  if (looked.status === 'unreadable') {
    return { verdict: 'mismatch', reason: `The saved ${wantKind === 'image' ? 'picture' : wantKind === 'video' ? 'clip' : 'file'} does not open as a working ${wantKind === 'image' ? 'picture' : 'video'} (${looked.why}).` };
  }
  const word = kind => (kind === 'image' ? 'a picture' : 'a clip');
  if (wantKind && looked.kind !== wantKind) {
    return { verdict: 'mismatch', reason: `It came back as ${word(looked.kind)}, but this slot needs ${word(wantKind)}.` };
  }
  const problems = [];
  const actual = looked.width / looked.height;
  if (requested?.ratio && Math.abs(actual - requested.ratio) / requested.ratio > RATIO_TOLERANCE) {
    problems.push(`It came back ${shapeName(actual)} (${looked.width} x ${looked.height}), the job asked for ${requested.ratioText || 'another shape'}.`);
  }
  if (looked.kind === 'video' && requested?.seconds && looked.durationSeconds !== null && Math.abs(looked.durationSeconds - requested.seconds) > DURATION_TOLERANCE_SECONDS) {
    problems.push(`It runs ${secondsWords(looked.durationSeconds)}, the job asked for ${secondsWords(requested.seconds)}.`);
  }
  if (problems.length) return { verdict: 'mismatch', reason: problems.join(' ') };
  const nothingAsked = !wantKind && !requested?.ratio && !requested?.seconds;
  if (nothingAsked) return { verdict: 'unverified', why: 'the generation manifest does not say what this slot should be' };
  if (looked.kind === 'video' && requested?.seconds && looked.durationSeconds === null) return { verdict: 'unverified', why: 'the length of the clip could not be read' };
  return { verdict: 'ok' };
}
