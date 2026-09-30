/**
 * Measurements the editing tools read out of ffmpeg: silences, black and frozen
 * pictures, loudness, the level of a short window of sound, and a font file for
 * drawtext.
 *
 * Every measurement is one ffmpeg run with an argument array whose report is read
 * from stderr. Nothing here writes a file. These replace numpy and librosa based
 * detection with ffmpeg's own detector filters, so the server keeps its zero
 * dependency rule.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { run } from '../media/probe.mjs';

/** How long one measurement run may take. */
const DETECT_TIMEOUT_MS = 180_000;

/**
 * @typedef {object} Span
 * @property {number} start_s
 * @property {number} end_s
 */

/**
 * Round to the millisecond, which is as precise as any of these reports are.
 * @param {number} value
 * @returns {number}
 */
export function ms(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/**
 * Run ffmpeg with the analysis output discarded and return what it printed.
 * @param {string[]} inputArgs everything before the filter, including -i
 * @param {string[]} filterArgs the -af or -vf part and any stream selection
 * @returns {Promise<string>}
 */
async function measure(inputArgs, filterArgs) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...inputArgs, ...filterArgs, '-f', 'null', '-'], {
    timeoutMs: DETECT_TIMEOUT_MS,
  });
  return stderr;
}

/**
 * The input part of a command, limited to a window when one is given. Seeking
 * before -i keeps the reported times relative to the window start.
 * @param {string} filePath
 * @param {{start?: number, end?: number}} [window]
 * @returns {string[]}
 */
function windowInput(filePath, window = {}) {
  /** @type {string[]} */
  const args = [];
  const start = Number(window.start) || 0;
  if (start > 0) args.push('-ss', start.toFixed(3));
  if (Number.isFinite(Number(window.end)) && Number(window.end) > start) {
    args.push('-t', (Number(window.end) - start).toFixed(3));
  }
  args.push('-i', filePath);
  return args;
}

/**
 * Pair up start and end markers from a detector report. A span still open when
 * the input ended closes at `until`.
 * @param {string} text
 * @param {RegExp} startPattern with one capture group
 * @param {RegExp} endPattern with one capture group
 * @param {number} until
 * @returns {Span[]}
 */
export function pairSpans(text, startPattern, endPattern, until) {
  /** @type {Span[]} */
  const spans = [];
  /** @type {number|null} */
  let open = null;
  for (const line of String(text).split(/\r?\n/)) {
    const started = startPattern.exec(line);
    if (started) {
      open = Number(started[1]);
      continue;
    }
    const ended = endPattern.exec(line);
    if (ended && open !== null) {
      spans.push({ start_s: ms(open), end_s: ms(Number(ended[1])) });
      open = null;
    }
  }
  if (open !== null && Number.isFinite(until) && until > open) spans.push({ start_s: ms(open), end_s: ms(until) });
  return spans;
}

/**
 * Quiet stretches of the sound, as absolute times in the file.
 * @param {string} filePath
 * @param {{start?: number, end?: number, noiseDb?: number, minSeconds?: number}} [options]
 * @returns {Promise<Span[]>}
 */
export async function detectSilences(filePath, options = {}) {
  const start = Number(options.start) || 0;
  const end = Number(options.end);
  const noise = Number.isFinite(Number(options.noiseDb)) ? Number(options.noiseDb) : -45;
  const minimum = Number(options.minSeconds) > 0 ? Number(options.minSeconds) : 0.4;
  const text = await measure(windowInput(filePath, { start, end }), [
    '-vn',
    '-af',
    `silencedetect=noise=${noise}dB:duration=${minimum}`,
  ]);
  const until = Number.isFinite(end) ? end - start : Number.POSITIVE_INFINITY;
  return pairSpans(text, /silence_start:\s*(-?[\d.]+)/, /silence_end:\s*(-?[\d.]+)/, until).map((span) => ({
    start_s: ms(Math.max(0, span.start_s) + start),
    end_s: ms(span.end_s + start),
  }));
}

/**
 * Black and frozen stretches of the picture, in one decoding pass.
 * @param {string} filePath
 * @param {{duration: number, blackMinSeconds?: number, freezeMinSeconds?: number}} options
 * @returns {Promise<{black: Span[], frozen: Span[]}>}
 */
export async function detectPictureProblems(filePath, options) {
  const blackMinimum = Number(options.blackMinSeconds) > 0 ? Number(options.blackMinSeconds) : 0.1;
  const freezeMinimum = Number(options.freezeMinSeconds) > 0 ? Number(options.freezeMinSeconds) : 2;
  const text = await measure(
    ['-i', filePath],
    ['-an', '-vf', `blackdetect=d=${blackMinimum}:pic_th=0.98:pix_th=0.10,freezedetect=n=-60dB:d=${freezeMinimum}`],
  );
  /** @type {Span[]} */
  const black = [];
  for (const match of text.matchAll(/black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)/g)) {
    black.push({ start_s: ms(Number(match[1])), end_s: ms(Number(match[2])) });
  }
  const frozen = pairSpans(
    text,
    /freezedetect\.freeze_start:\s*(-?[\d.]+)/,
    /freezedetect\.freeze_end:\s*(-?[\d.]+)/,
    Number(options.duration),
  );
  return { black, frozen };
}

/**
 * Integrated loudness in LUFS, or null when there is no measurable sound.
 * @param {string} filePath
 * @returns {Promise<number|null>}
 */
export async function integratedLoudness(filePath) {
  const text = await measure(['-i', filePath], ['-vn', '-af', 'ebur128=framelog=quiet']);
  const matches = [...text.matchAll(/^\s*I:\s+(-?[\d.]+|-inf)\s+LUFS/gm)];
  const last = matches.at(-1);
  if (!last || last[1] === '-inf') return null;
  const value = Number(last[1]);
  // ebur128 reports its absolute gate, -70 LUFS, for silence.
  return Number.isFinite(value) && value > -69.9 ? value : null;
}

/**
 * The RMS and peak level of a short window of sound, in dBFS. Sample accurate,
 * because the window is cut with atrim after decoding rather than by seeking.
 * @param {string} filePath
 * @param {number} start seconds
 * @param {number} end seconds
 * @returns {Promise<{rms_db: number, peak_db: number}>}
 */
export async function windowLevel(filePath, start, end) {
  const from = Math.max(0, start);
  const text = await measure(
    ['-i', filePath],
    [
      '-vn',
      '-af',
      `atrim=start=${from.toFixed(4)}:end=${Math.max(from + 0.001, end).toFixed(4)},` +
        'astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level',
    ],
  );
  /** @param {string} label */
  const read = (label) => {
    const match = new RegExp(`${label} level dB:\\s*(-?[\\d.]+|-inf)`).exec(text);
    if (!match || match[1] === '-inf') return -120;
    return Math.max(-120, Number(match[1]));
  };
  return { rms_db: ms(read('RMS')), peak_db: ms(read('Peak')) };
}

/** Font files tried for drawtext, in order. drawtext without a font file crashes some Windows builds. */
const FONT_CANDIDATES = [
  process.env.WINDIR ? join(process.env.WINDIR, 'Fonts', 'arial.ttf') : null,
  process.env.WINDIR ? join(process.env.WINDIR, 'Fonts', 'segoeui.ttf') : null,
  'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];

/** @type {string|null|undefined} */
let cachedFont;

/**
 * A font file drawtext can use, or null when none of the usual ones exist, in
 * which case labels are left off rather than risking the filter.
 * @returns {string|null}
 */
export function findFontFile() {
  if (cachedFont !== undefined) return cachedFont;
  cachedFont = null;
  for (const candidate of FONT_CANDIDATES) {
    if (candidate && existsSync(candidate)) {
      cachedFont = candidate;
      break;
    }
  }
  return cachedFont;
}
