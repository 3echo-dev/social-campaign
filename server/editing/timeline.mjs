/**
 * The timeline view: one PNG of a stretch of video, a strip of frames above the
 * sound waveform, with the quiet gaps shaded, the phrase starts marked and a time
 * ruler underneath, for deciding where to cut.
 *
 * The whole picture is one ffmpeg filter graph: `select` and `tile` for the frame
 * strip, `showwavespic` for the waveform, `drawbox` for the gaps, markers and
 * ticks, and `drawtext` for the labels. Nothing is decoded in Node.
 *
 * PIL and numpy based rendering is replaced by ffmpeg filters, the quiet gaps come
 * from ffmpeg's silencedetect rather than word gaps so they show without a
 * transcript, and phrase ids from the packed transcript replace word labels.
 */

import { mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { runFfmpeg } from '../generation/edit.mjs';
import { escapeFilterPath } from '../generation/subtitles.mjs';
import { findFontFile } from './detect.mjs';
import { formatSeconds } from './pack.mjs';

/** Longest window one view covers, in seconds. */
export const MAX_WINDOW_S = 60;

/** Frames in the strip. */
export const STRIP_FRAMES = 10;

const CANVAS_WIDTH = 1280;
const MARGIN = 40;
const STRIP_WIDTH = CANVAS_WIDTH - 2 * MARGIN;
const HEADER_HEIGHT = 44;
const MARKER_BAND = 22;
const WAVE_HEIGHT = 160;
const RULER_HEIGHT = 34;
const LEGEND_HEIGHT = 28;
const RULER_TICKS = 6;
const CELL_GAP = 4;

const COLOURS = {
  background: '0x121216',
  waveBackground: '0x1c1c22',
  wave: '0x8cb4ff',
  silence: '0x2c4a72',
  marker: '0xff8c3c',
  text: '0xebebeb',
  dim: '0x8a8a96',
};

/**
 * @typedef {object} TimelineLayout
 * @property {number} width
 * @property {number} height
 * @property {number} frames
 * @property {number} cellWidth
 * @property {number} cellHeight
 * @property {number} stripY
 * @property {number} bandY
 * @property {number} waveY
 * @property {number} rulerY
 * @property {number} legendY
 */

/**
 * Where everything sits, from the source's picture shape alone, so the size of the
 * image is known before it is drawn.
 * @param {{width: number|null, height: number|null}} picture
 * @param {number} [frames]
 * @returns {TimelineLayout}
 */
export function timelineLayout(picture, frames = STRIP_FRAMES) {
  const cellWidth = Math.floor((STRIP_WIDTH - (frames - 1) * CELL_GAP) / frames);
  const aspect = picture.width && picture.height ? picture.height / picture.width : 0.5625;
  const cellHeight = Math.min(240, Math.max(40, 2 * Math.round((cellWidth * aspect) / 2)));
  const stripY = HEADER_HEIGHT;
  const bandY = stripY + cellHeight + 6;
  const waveY = bandY + MARKER_BAND;
  const rulerY = waveY + WAVE_HEIGHT;
  const legendY = rulerY + RULER_HEIGHT;
  const height = legendY + LEGEND_HEIGHT;
  return { width: CANVAS_WIDTH, height: height + (height % 2), frames, cellWidth, cellHeight, stripY, bandY, waveY, rulerY, legendY };
}

/**
 * Text that is safe inside a quoted drawtext value with expansion off.
 * @param {string} text
 * @returns {string}
 */
export function safeLabel(text) {
  return String(text)
    .replace(/[^\w .,()+#/|-]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 140);
}

/**
 * One drawtext filter.
 * @param {string} font escaped font file
 * @param {string} text already safe
 * @param {string|number} x expression
 * @param {number} y
 * @param {number} size
 * @param {string} colour
 * @returns {string}
 */
function label(font, text, x, y, size, colour) {
  return `drawtext=fontfile='${font}':expansion=none:text='${text}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${colour}`;
}

/**
 * Draw the timeline view.
 * @param {{
 *   filePath: string,
 *   outPath: string,
 *   probe: {width: number|null, height: number|null, has_video: boolean, has_audio: boolean},
 *   start: number,
 *   end: number,
 *   silences?: Array<{start_s: number, end_s: number}>,
 *   phrases?: Array<{id: string, start_s: number, end_s: number}>,
 *   title?: string,
 * }} options
 * @returns {Promise<{image_path: string, width: number, height: number, frames: number, labelled: boolean}>}
 */
export async function renderTimeline(options) {
  const { filePath, outPath, probe, start, end } = options;
  const span = Math.max(0.001, end - start);
  const layout = timelineLayout(probe, STRIP_FRAMES);
  const x = (/** @type {number} */ t) => Math.round(MARGIN + ((t - start) / span) * STRIP_WIDTH);
  const fontFile = findFontFile();
  const font = fontFile ? escapeFilterPath(fontFile) : null;

  /** @type {string[]} */
  const chains = [`color=c=${COLOURS.background}:s=${layout.width}x${layout.height}:d=1:r=1,format=rgba[bg]`];

  // The canvas: waveform background, then quiet gaps, so the waveform draws over them.
  /** @type {string[]} */
  const canvas = [`drawbox=x=${MARGIN}:y=${layout.waveY}:w=${STRIP_WIDTH}:h=${WAVE_HEIGHT}:color=${COLOURS.waveBackground}:t=fill`];
  for (const silence of options.silences ?? []) {
    const from = Math.max(start, silence.start_s);
    const to = Math.min(end, silence.end_s);
    if (to <= from) continue;
    const left = x(from);
    canvas.push(
      `drawbox=x=${left}:y=${layout.waveY}:w=${Math.max(1, x(to) - left)}:h=${WAVE_HEIGHT}:color=${COLOURS.silence}:t=fill`,
    );
  }
  if (!probe.has_video) {
    canvas.push(
      `drawbox=x=${MARGIN}:y=${layout.stripY}:w=${STRIP_WIDTH}:h=${layout.cellHeight}:color=${COLOURS.waveBackground}:t=fill`,
    );
  }
  chains.push(`[bg]${canvas.join(',')}[canvas]`);

  let current = '[canvas]';
  if (probe.has_video) {
    const step = span / layout.frames;
    chains.push(
      `[0:v]select='gte(t,selected_n*${step.toFixed(4)})',` +
        `scale=${layout.cellWidth}:${layout.cellHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${layout.cellWidth}:${layout.cellHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,` +
        `tile=${layout.frames}x1:padding=${CELL_GAP}:color=${COLOURS.background},setpts=0,format=rgba[strip]`,
    );
    chains.push(`${current}[strip]overlay=${MARGIN}:${layout.stripY}[withstrip]`);
    current = '[withstrip]';
  }
  if (probe.has_audio) {
    chains.push(
      `[0:a]aformat=channel_layouts=mono,showwavespic=s=${STRIP_WIDTH}x${WAVE_HEIGHT}:colors=${COLOURS.wave}:scale=sqrt:draw=full,setpts=0[wave]`,
    );
    chains.push(`${current}[wave]overlay=${MARGIN}:${layout.waveY}[withwave]`);
    current = '[withwave]';
  }

  // Marks: phrase starts and ruler ticks, then every label.
  /** @type {string[]} */
  const marks = [];
  /** @type {Array<{text: string, x: number}>} */
  const phraseLabels = [];
  let lastLabelX = -1000;
  for (const phrase of options.phrases ?? []) {
    if (phrase.start_s < start || phrase.start_s > end) continue;
    const at = Math.min(MARGIN + STRIP_WIDTH - 1, x(phrase.start_s));
    marks.push(`drawbox=x=${at}:y=${layout.bandY}:w=2:h=${MARKER_BAND + WAVE_HEIGHT}:color=${COLOURS.marker}@0.9:t=fill`);
    if (at - lastLabelX >= 44) {
      phraseLabels.push({ text: safeLabel(phrase.id), x: at + 4 });
      lastLabelX = at;
    }
  }
  /** @type {Array<{text: string, x: number}>} */
  const rulerLabels = [];
  for (let index = 0; index <= RULER_TICKS; index += 1) {
    const at = Math.min(MARGIN + STRIP_WIDTH - 1, MARGIN + Math.round((index / RULER_TICKS) * STRIP_WIDTH));
    marks.push(`drawbox=x=${at}:y=${layout.rulerY}:w=1:h=7:color=${COLOURS.dim}:t=fill`);
    rulerLabels.push({ text: `${formatSeconds(start + (index / RULER_TICKS) * span)}s`, x: at });
  }
  if (font) {
    const title = safeLabel(options.title ?? basename(filePath));
    const header = `${title}   ${formatSeconds(start)}s to ${formatSeconds(end)}s   (${formatSeconds(span)} s, ${layout.frames} frames)`;
    marks.push(label(font, safeLabel(header), MARGIN, 14, 18, COLOURS.text));
    for (const entry of phraseLabels) marks.push(label(font, entry.text, entry.x, layout.bandY + 4, 13, COLOURS.marker));
    for (const entry of rulerLabels) {
      marks.push(label(font, entry.text, `max(${MARGIN - 20}\\,${entry.x}-tw/2)`, layout.rulerY + 11, 14, COLOURS.dim));
    }
    const gapCount = (options.silences ?? []).filter((s) => Math.min(end, s.end_s) > Math.max(start, s.start_s)).length;
    const legend = [
      `blue bands mark quiet stretches (${gapCount})`,
      (options.phrases ?? []).length ? 'orange lines mark phrase starts from the packed transcript' : null,
      probe.has_audio ? null : 'this file has no sound',
      probe.has_video ? null : 'this file has no picture',
    ]
      .filter(Boolean)
      .join('  |  ');
    marks.push(label(font, safeLabel(legend), MARGIN, layout.legendY + 6, 14, COLOURS.dim));
  }
  chains.push(`${current}${marks.join(',')},format=rgb24[out]`);

  mkdirSync(dirname(outPath), { recursive: true });
  await runFfmpeg([
    '-ss',
    start.toFixed(3),
    '-t',
    span.toFixed(3),
    '-i',
    filePath,
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[out]',
    '-frames:v',
    '1',
    '-update',
    '1',
    outPath,
  ]);
  return { image_path: outPath, width: layout.width, height: layout.height, frames: probe.has_video ? layout.frames : 0, labelled: Boolean(font) };
}
