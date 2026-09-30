/**
 * Subtitles: timing, files and the burned in render.
 *
 * Everything above renderSubtitles is pure text work on transcript segments, so it
 * is tested without ffmpeg and without a network. The social style chunker is the
 * part that matters: a transcript segment is often one long sentence, and a long
 * sentence pinned across the bottom of a phone screen is unreadable. Short cues of
 * at most two lines, held for at least a moment, are what platforms and viewers
 * expect.
 *
 * renderSubtitles burns the track into the video with ffmpeg's subtitles filter.
 * That filter parses its own argument string, so a Windows path has to be escaped
 * twice over: backslashes become forward slashes, and the drive colon is escaped so
 * the filter does not read it as the start of the next option.
 */

import { existsSync } from 'node:fs';

import { UserFacingError } from '../lib/errors.mjs';
import { runFfmpeg } from './edit.mjs';

/** Longest line the social style chunker will produce. */
export const MAX_CHARS_PER_LINE = 32;

/** Most lines in one cue. */
export const MAX_LINES = 2;

/** Shortest time a cue stays on screen, in seconds. */
export const MIN_CUE_SECONDS = 0.7;

/**
 * @typedef {object} Segment
 * @property {number} start seconds
 * @property {number} end seconds
 * @property {string} text
 */

/**
 * @typedef {object} Cue
 * @property {number} start seconds
 * @property {number} end seconds
 * @property {string} text one or two lines, separated by a newline
 * @property {string[]} lines
 */

/**
 * Format one timestamp. SRT uses a comma before the milliseconds, WebVTT a dot.
 * @param {number} seconds
 * @param {'srt'|'vtt'} format
 * @returns {string}
 */
export function formatTimestamp(seconds, format = 'srt') {
  const total = Math.max(0, Math.round(Number(seconds) * 1000));
  const ms = total % 1000;
  const wholeSeconds = Math.floor(total / 1000);
  const hh = String(Math.floor(wholeSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((wholeSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(wholeSeconds % 60).padStart(2, '0');
  const separator = format === 'vtt' ? '.' : ',';
  return `${hh}:${mm}:${ss}${separator}${String(ms).padStart(3, '0')}`;
}

/**
 * @param {Array<Segment|Cue>} cues
 * @returns {Cue[]}
 */
function normalizeCues(cues) {
  return (Array.isArray(cues) ? cues : []).map((cue) => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new UserFacingError('One of the subtitle timings is not a real moment in the video.', {
        code: 'invalid_subtitle_timing',
      });
    }
    const text = String(cue.text ?? '').trim();
    return { start, end, text, lines: text.split('\n') };
  });
}

/**
 * @param {Array<Segment|Cue>} cues
 * @returns {string} SubRip text, CRLF free, ending with a newline.
 */
export function toSrt(cues) {
  return (
    normalizeCues(cues)
      .map((cue, index) =>
        [
          String(index + 1),
          `${formatTimestamp(cue.start, 'srt')} --> ${formatTimestamp(cue.end, 'srt')}`,
          cue.text,
          '',
        ].join('\n'),
      )
      .join('\n') || '\n'
  );
}

/**
 * @param {Array<Segment|Cue>} cues
 * @returns {string} WebVTT text.
 */
export function toVtt(cues) {
  const body = normalizeCues(cues)
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatTimestamp(cue.start, 'vtt')} --> ${formatTimestamp(cue.end, 'vtt')}`,
        cue.text,
        '',
      ].join('\n'),
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/**
 * Break one piece of text into lines no longer than maxChars, on word boundaries
 * where that is possible and inside a word where it is not.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wrapLines(text, maxChars = MAX_CHARS_PER_LINE) {
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const rawWord of String(text).trim().split(/\s+/).filter(Boolean)) {
    let word = rawWord;
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Turn transcript segments into social style cues.
 *
 * Time inside a segment is shared between its cues in proportion to how much text
 * each one carries, which keeps a long cue on screen longer than a short one. A cue
 * that still ends up shorter than MIN_CUE_SECONDS is stretched, and anything after
 * it is pushed along so cues never overlap.
 *
 * @param {Segment[]} segments
 * @param {{maxChars?: number, maxLines?: number, minDuration?: number}} [options]
 * @returns {Cue[]}
 */
export function chunkSegments(segments, options = {}) {
  const maxChars = options.maxChars ?? MAX_CHARS_PER_LINE;
  const maxLines = options.maxLines ?? MAX_LINES;
  const minDuration = options.minDuration ?? MIN_CUE_SECONDS;

  /** @type {Cue[]} */
  const cues = [];
  for (const segment of normalizeCues(segments)) {
    if (!segment.text) continue;
    const lines = wrapLines(segment.text, maxChars);
    /** @type {string[][]} */
    const groups = [];
    for (let index = 0; index < lines.length; index += maxLines) {
      groups.push(lines.slice(index, index + maxLines));
    }
    const weights = groups.map((group) => group.join(' ').length);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const span = Math.max(segment.end - segment.start, 0);
    let cursor = segment.start;
    groups.forEach((group, index) => {
      const share = (weights[index] / totalWeight) * span;
      const start = cursor;
      const end = index === groups.length - 1 ? segment.end : cursor + share;
      cursor = end;
      cues.push({ start, end, text: group.join('\n'), lines: group });
    });
  }

  // Second pass: nothing shorter than minDuration, nothing overlapping.
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (index > 0 && cue.start < cues[index - 1].end) cue.start = cues[index - 1].end;
    if (cue.end - cue.start < minDuration) cue.end = cue.start + minDuration;
  }
  return cues.map((cue) => ({
    ...cue,
    start: Math.round(cue.start * 1000) / 1000,
    end: Math.round(cue.end * 1000) / 1000,
  }));
}

/**
 * The cue shape the SubtitlePackage contract asks for.
 * @param {Cue[]} cues
 * @returns {Array<{start_s: number, end_s: number, text: string}>}
 */
export function toPackageCues(cues) {
  return cues.map((cue) => ({ start_s: cue.start, end_s: cue.end, text: cue.text }));
}

/**
 * Escape a path for use inside ffmpeg's subtitles filter.
 *
 * The filter graph is parsed before the filename ever reaches the file system, so
 * `C:\clips\a.srt` has to arrive as `C\:/clips/a.srt`: forward slashes, an escaped
 * drive colon, and escaped quotes and brackets.
 * @param {string} filePath
 * @returns {string}
 */
export function escapeFilterPath(filePath) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

/** Where a cue sits on screen, as an ASS alignment value. */
const ALIGNMENT = { bottom: 2, lower_third: 2, middle: 5, top: 8 };

/**
 * Turn `#RRGGBB` into the `&HBBGGRR&` form libass expects. Anything already in an
 * ASS form is passed through untouched.
 * @param {string} colour
 * @returns {string}
 */
export function assColour(colour) {
  const value = String(colour ?? '').trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) return value;
  const hex = match[1].toUpperCase();
  return `&H${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
}

/**
 * Build the force_style string for a burned in render.
 * @param {{font_family?: string, font_size?: number, position?: string, primary_colour?: string, outline?: number, shadow?: number, bold?: boolean, margin_v?: number}} [style]
 * @returns {string}
 */
export function forceStyle(style = {}) {
  const parts = [
    `FontName=${style.font_family ?? 'Arial'}`,
    `FontSize=${Number(style.font_size) > 0 ? Number(style.font_size) : 18}`,
    `PrimaryColour=${assColour(style.primary_colour ?? '#FFFFFF')}`,
    `OutlineColour=${assColour('#000000')}`,
    `BorderStyle=1`,
    `Outline=${Number.isFinite(Number(style.outline)) ? Number(style.outline) : 2}`,
    `Shadow=${Number.isFinite(Number(style.shadow)) ? Number(style.shadow) : 0}`,
    `Bold=${style.bold === false ? 0 : 1}`,
    `Alignment=${ALIGNMENT[String(style.position ?? 'bottom')] ?? 2}`,
    `MarginV=${Number.isFinite(Number(style.margin_v)) ? Number(style.margin_v) : style.position === 'lower_third' ? 60 : 30}`,
  ];
  return parts.join(',');
}

/**
 * Burn a subtitle file into a video.
 * @param {{video_path: string, srt_path: string, out_path: string, style?: any}} options
 * @returns {Promise<{out_path: string}>}
 */
export async function renderSubtitles({ video_path: videoPath, srt_path: srtPath, out_path: outPath, style }) {
  if (!existsSync(videoPath)) throw new UserFacingError('That video could not be found.', { code: 'file_missing' });
  if (!existsSync(srtPath)) throw new UserFacingError('That subtitle file could not be found.', { code: 'file_missing' });
  const filter = `subtitles='${escapeFilterPath(srtPath)}':force_style='${forceStyle(style)}'`;
  await runFfmpeg([
    '-i',
    videoPath,
    '-vf',
    filter,
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    outPath,
  ]);
  return { out_path: outPath };
}
