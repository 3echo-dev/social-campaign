/**
 * Read a saved transcript for a library asset, in one normalised shape.
 *
 * Transcripts are made elsewhere: media_transcribe and transcript_save store them
 * as `<workspace>/imports/transcripts/<sha256 of the media>.json` and, for a library
 * asset, as an `asset_analyses` row with `analyst = 'transcript'`
 * (docs/CONTRACTS.md section 1a). The editing tools only read them, so this reader
 * is tolerant: it accepts the Social Campaign shape (`start_s`, `end_s`, `text`)
 * and the raw ElevenLabs Scribe shape (`start`, `end`, `text`, `type`,
 * `speaker_id`), because an agent may have saved either.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJson } from '../lib/json.mjs';

/**
 * @typedef {object} Word
 * @property {number} start_s
 * @property {number} end_s
 * @property {string} text
 * @property {'word'|'audio_event'|'spacing'} type
 * @property {string|null} speaker
 */

/**
 * @typedef {object} TranscriptSegment
 * @property {number} start_s
 * @property {number} end_s
 * @property {string} text
 * @property {string|null} speaker
 */

/**
 * @typedef {object} Transcript
 * @property {string} transcript_id
 * @property {string|null} source
 * @property {string|null} language
 * @property {Word[]} words spacing entries included, in time order
 * @property {TranscriptSegment[]} segments
 */

/**
 * @param {any} entry
 * @param {string} key
 * @returns {number}
 */
function timeOf(entry, key) {
  const value = entry?.[`${key}_s`] ?? entry?.[key];
  return Number(value);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function speakerOf(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * Normalise a transcript document from either shape. Returns null when it holds
 * neither words nor segments.
 * @param {any} raw
 * @param {string} fallbackId
 * @returns {Transcript|null}
 */
export function normalizeTranscript(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw.transcript && typeof raw.transcript === 'object' ? raw.transcript : raw;
  /** @type {Word[]} */
  const words = (Array.isArray(body.words) ? body.words : [])
    .map((entry) => {
      const type = entry?.type === 'spacing' || entry?.type === 'audio_event' ? entry.type : 'word';
      return {
        start_s: timeOf(entry, 'start'),
        end_s: timeOf(entry, 'end'),
        text: String(entry?.text ?? '').trim(),
        type: /** @type {Word['type']} */ (type),
        speaker: speakerOf(entry?.speaker ?? entry?.speaker_id),
      };
    })
    .filter((word) => Number.isFinite(word.start_s) && Number.isFinite(word.end_s) && word.end_s >= word.start_s)
    .filter((word) => word.type === 'spacing' || word.text.length > 0)
    .sort((a, b) => a.start_s - b.start_s);
  /** @type {TranscriptSegment[]} */
  const segments = (Array.isArray(body.segments) ? body.segments : [])
    .map((entry) => ({
      start_s: timeOf(entry, 'start'),
      end_s: timeOf(entry, 'end'),
      text: String(entry?.text ?? '').trim(),
      speaker: speakerOf(entry?.speaker ?? entry?.speaker_id),
    }))
    .filter((segment) => Number.isFinite(segment.start_s) && Number.isFinite(segment.end_s) && segment.text)
    .sort((a, b) => a.start_s - b.start_s);
  if (words.length === 0 && segments.length === 0) return null;
  return {
    transcript_id: String(body.transcript_id ?? raw.transcript_id ?? fallbackId),
    source: body.source ? String(body.source) : null,
    language: body.language ? String(body.language) : null,
    words,
    segments,
  };
}

/**
 * The folder transcript_save writes to.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function transcriptsDir(workspaceRoot) {
  return join(workspaceRoot, 'imports', 'transcripts');
}

/**
 * Find the newest saved transcript for an asset: the asset_analyses row first, then
 * the file named after the media's sha256.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} workspaceRoot
 * @param {{id: string, sha256: string|null}} asset
 * @returns {Transcript|null}
 */
export function readTranscript(db, workspaceRoot, asset) {
  /** @type {Transcript[]} */
  const found = [];
  // The file carries the word timings; the asset_analyses row may only count them.
  if (asset.sha256) {
    const file = join(transcriptsDir(workspaceRoot), `${asset.sha256}.json`);
    if (existsSync(file)) {
      const fromFile = normalizeTranscript(parseJson(readFileSync(file, 'utf8'), null), asset.sha256);
      if (fromFile) found.push(fromFile);
    }
  }
  const rows = db
    .prepare("SELECT id, json FROM asset_analyses WHERE asset_id = ? AND analyst = 'transcript' ORDER BY created_at DESC, id DESC")
    .all(asset.id);
  for (const row of rows) {
    const json = /** @type {any} */ (parseJson(String(row.json ?? 'null'), null));
    const pointer = json && typeof json === 'object' ? (json.path ?? json.transcript_path ?? null) : null;
    if (typeof pointer === 'string' && pointer.endsWith('.json') && existsSync(pointer)) {
      const fromPointer = normalizeTranscript(parseJson(readFileSync(pointer, 'utf8'), null), String(row.id));
      if (fromPointer) found.push(fromPointer);
    }
    const inline = normalizeTranscript(json, String(row.id));
    if (inline) found.push(inline);
  }
  return found.find((transcript) => spokenWords(transcript).length > 0) ?? found[0] ?? null;
}

/**
 * The spoken words only, without spacing entries.
 * @param {Transcript|null} transcript
 * @returns {Word[]}
 */
export function spokenWords(transcript) {
  return (transcript?.words ?? []).filter((word) => word.type !== 'spacing');
}
