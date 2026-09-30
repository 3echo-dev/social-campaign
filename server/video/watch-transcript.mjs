/**
 * Transcripts for video_watch, media_transcribe and transcript_save.
 *
 * Parses platform captions (WebVTT and SubRip) into timestamped segments, collapses
 * the rolling duplicates auto captions carry, normalises provider word timings, and
 * keeps one transcript per piece of media in <workspace>/imports/transcripts/.
 *
 * Caption parsing and rolling caption dedupe also handle SRT, short VTT timestamps
 * and carried over line removal.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { newId, nowIso } from '../lib/ids.mjs';

/**
 * @typedef {object} Segment
 * @property {number} start_s
 * @property {number} end_s
 * @property {string} text
 * @property {string|null} [speaker]
 */

/**
 * @typedef {object} Word
 * @property {number} start_s
 * @property {number} end_s
 * @property {string} text
 * @property {string|null} [speaker]
 */

/**
 * A cue timing line. Hours are optional in WebVTT, SubRip uses a comma before the
 * milliseconds, and both may carry cue settings after the end time.
 */
const TIMING_RE = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

/** Markup inside a cue: voice spans, karaoke timestamps, styling. */
const TAG_RE = /<[^>]*>/g;

/** The few entities captions actually use. */
const ENTITIES = /** @type {Record<string, string>} */ ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" });

/**
 * @param {string} stamp for example 01:02:03.456, 02:03.456 or 00:00:01,000
 * @returns {number} seconds
 */
export function parseTimestamp(stamp) {
  const [clock, fraction = '0'] = stamp.trim().split(/[.,]/);
  const parts = clock.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds + Number(`0.${fraction}`);
}

/**
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {string} line
 * @returns {string}
 */
function cleanLine(line) {
  return line
    .replace(TAG_RE, '')
    .replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split caption text into cues. Works for WebVTT and SubRip alike: a cue is a
 * timing line followed by text lines up to a blank line. Headers, NOTE and STYLE
 * blocks and SubRip counters never contain a timing line, so they are skipped.
 * @param {string} text
 * @returns {Array<{start_s: number, end_s: number, lines: string[]}>}
 */
export function parseCues(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  /** @type {Array<{start_s: number, end_s: number, lines: string[]}>} */
  const cues = [];
  let index = 0;
  while (index < lines.length) {
    const match = TIMING_RE.exec(lines[index]);
    index += 1;
    if (!match) continue;
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    /** @type {string[]} */
    const cueLines = [];
    while (index < lines.length && lines[index].trim() !== '' && !TIMING_RE.test(lines[index])) {
      const cleaned = cleanLine(lines[index]);
      if (cleaned) cueLines.push(cleaned);
      index += 1;
    }
    cues.push({ start_s: round3(start), end_s: round3(Math.max(end, start)), lines: cueLines });
  }
  return cues;
}

/**
 * Turn cues into segments and collapse rolling duplicates.
 *
 * Auto captions scroll: each cue repeats the line that was already on screen above
 * the new one, and a cue is often followed by a tiny cue with the same text. Three
 * rules clean that up, applied in order:
 *
 * 1. a line that was on screen in the previous cue is carried over, not new speech;
 * 2. a cue whose text equals the previous segment only extends its end time;
 * 3. a cue whose text grows the previous segment word by word replaces it.
 *
 * @param {Array<{start_s: number, end_s: number, lines: string[]}>} cues
 * @returns {Segment[]}
 */
export function cuesToSegments(cues) {
  /** @type {Segment[]} */
  const segments = [];
  /** @type {string[]} */
  let previousLines = [];
  for (const cue of cues) {
    const fresh = cue.lines.filter((line) => !previousLines.includes(line));
    previousLines = cue.lines;
    const text = fresh.join(' ').trim();
    const last = segments[segments.length - 1];
    if (!text) {
      if (last && cue.lines.length > 0) last.end_s = Math.max(last.end_s, cue.end_s);
      continue;
    }
    if (last && text === last.text) {
      last.end_s = Math.max(last.end_s, cue.end_s);
      continue;
    }
    if (last && text.startsWith(`${last.text} `)) {
      last.text = text;
      last.end_s = Math.max(last.end_s, cue.end_s);
      continue;
    }
    segments.push({ start_s: cue.start_s, end_s: cue.end_s, text });
  }
  return segments;
}

/**
 * Parse WebVTT or SubRip text into clean segments.
 * @param {string} text
 * @returns {Segment[]}
 */
export function parseCaptions(text) {
  return cuesToSegments(parseCues(text));
}

/**
 * Read and parse a caption file.
 * @param {string} filePath
 * @returns {Segment[]}
 */
export function parseCaptionFile(filePath) {
  return parseCaptions(readFileSync(filePath, 'utf8'));
}

/**
 * Keep the segments that overlap a window.
 * @template {{start_s: number, end_s: number}} T
 * @param {T[]} items
 * @param {{start_s: number, end_s: number|null}|null} window
 * @returns {T[]}
 */
export function filterToWindow(items, window) {
  if (!window) return items;
  const lo = window.start_s;
  const hi = window.end_s ?? Number.POSITIVE_INFINITY;
  return items.filter((item) => item.end_s >= lo && item.start_s <= hi);
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function seconds(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? round3(number) : null;
}

/**
 * Normalise segments from any caller: ours ({start_s, end_s, text}) or a provider
 * shape ({start, end, text}). Returns the clean list and a problem for each item that
 * could not be used, so a caller can refuse instead of storing half a transcript.
 * @param {unknown[]} raw
 * @returns {{segments: Segment[], problems: string[]}}
 */
export function normalizeSegments(raw) {
  /** @type {Segment[]} */
  const segments = [];
  /** @type {string[]} */
  const problems = [];
  (Array.isArray(raw) ? raw : []).forEach((item, index) => {
    const entry = /** @type {Record<string, unknown>} */ (item && typeof item === 'object' ? item : {});
    const start = seconds(entry.start_s ?? entry.start);
    const end = seconds(entry.end_s ?? entry.end);
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (start === null || end === null || end < start || !text) {
      problems.push(`segment ${index + 1} needs start_s, end_s not before it, and text`);
      return;
    }
    const speaker = entry.speaker ?? entry.speaker_id;
    segments.push({ start_s: start, end_s: end, text, speaker: typeof speaker === 'string' && speaker ? speaker : null });
  });
  segments.sort((a, b) => a.start_s - b.start_s);
  return { segments, problems };
}

/**
 * Normalise word timings. Accepts ours ({start_s, end_s, text}) and the ElevenLabs
 * speech to text shape ({text, start, end, type, speaker_id}), where spacing and
 * audio event entries are not words and are dropped.
 * @param {unknown[]} raw
 * @returns {Word[]}
 */
export function normalizeWords(raw) {
  /** @type {Word[]} */
  const words = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = /** @type {Record<string, unknown>} */ (item && typeof item === 'object' ? item : {});
    if (entry.type !== undefined && entry.type !== 'word') continue;
    const start = seconds(entry.start_s ?? entry.start);
    const end = seconds(entry.end_s ?? entry.end);
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (start === null || end === null || end < start || !text) continue;
    const speaker = entry.speaker ?? entry.speaker_id;
    words.push({ start_s: start, end_s: end, text, speaker: typeof speaker === 'string' && speaker ? speaker : null });
  }
  words.sort((a, b) => a.start_s - b.start_s);
  return words;
}

// ---------------------------------------------------------------------------
// The transcript store
// ---------------------------------------------------------------------------

/**
 * @typedef {'platform_captions'|'elevenlabs'|'manual'} TranscriptSource
 */

/**
 * @typedef {object} StoredTranscript
 * @property {1} schema_version
 * @property {string} transcript_id
 * @property {string} key sha256 of the media, or url-<hash> when only an address is known
 * @property {string|null} sha256
 * @property {string|null} url
 * @property {string|null} asset_id
 * @property {string|null} media_path
 * @property {TranscriptSource} source
 * @property {string|null} language
 * @property {Segment[]} segments
 * @property {Word[]} words
 * @property {string} text
 * @property {string} source_type
 * @property {string} source_ref
 * @property {string} observed_at
 * @property {number} confidence
 */

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function transcriptsDir(workspaceRoot) {
  return join(workspaceRoot, 'imports', 'transcripts');
}

/**
 * @param {string} workspaceRoot
 * @param {string} key
 * @returns {string}
 */
export function transcriptPath(workspaceRoot, key) {
  if (!/^(?:[0-9a-f]{64}|url-[0-9a-f]{16,64})$/.test(key)) throw new Error(`Not a transcript key: ${key}`);
  return join(transcriptsDir(workspaceRoot), `${key}.json`);
}

/**
 * @param {string} workspaceRoot
 * @param {string} key
 * @returns {StoredTranscript|null}
 */
export function readTranscript(workspaceRoot, key) {
  const path = transcriptPath(workspaceRoot, key);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && Array.isArray(parsed.segments) ? parsed : null;
  } catch {
    return null;
  }
}

/** How much each transcript source is trusted, per the provenance rules. */
const SOURCE_CONFIDENCE = /** @type {Record<TranscriptSource, number>} */ ({ platform_captions: 0.8, elevenlabs: 0.85, manual: 0.7 });

/**
 * Write a transcript, replacing any earlier one for the same media. The write goes
 * through a temporary file so a crash never leaves half a transcript behind.
 * @param {{
 *   workspaceRoot: string,
 *   key: string,
 *   sha256: string|null,
 *   url: string|null,
 *   assetId: string|null,
 *   mediaPath: string|null,
 *   source: TranscriptSource,
 *   language: string|null,
 *   segments: Segment[],
 *   words?: Word[],
 *   sourceType: string,
 *   sourceRef: string,
 * }} options
 * @returns {{transcript: StoredTranscript, path: string}}
 */
export function writeTranscript(options) {
  const path = transcriptPath(options.workspaceRoot, options.key);
  mkdirSync(transcriptsDir(options.workspaceRoot), { recursive: true });
  /** @type {StoredTranscript} */
  const transcript = {
    schema_version: 1,
    transcript_id: newId(),
    key: options.key,
    sha256: options.sha256,
    url: options.url,
    asset_id: options.assetId,
    media_path: options.mediaPath,
    source: options.source,
    language: options.language,
    segments: options.segments,
    words: options.words ?? [],
    text: options.segments.map((segment) => segment.text).join(' '),
    source_type: options.sourceType,
    source_ref: options.sourceRef,
    observed_at: nowIso(),
    confidence: SOURCE_CONFIDENCE[options.source],
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
  return { transcript, path };
}
