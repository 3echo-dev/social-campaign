/**
 * Render an edit decision list into one finished video.
 *
 * The order below is the point of the module:
 *
 *   1. every clip is cut out on its own, frame accurately, already at the output
 *      size and frame rate, with a short audio fade at both ends (hard rules 2, 3)
 *   2. the clips are joined with a lossless concat, no second encode
 *   3. one pass lays text and image overlays over the join and burns the subtitles
 *      last, so an overlay can never hide a caption (hard rule 1), and mixes any
 *      voiceover and music bed under the programme sound
 *   4. the sound is loudness normalised to the social target in two passes
 *
 * Subtitle times are output timeline times: a word at `t` in its source lands at
 * `t - clip in + clip offset` (hard rule 5), using the real length of every cut
 * clip, so captions stay on their words however many cuts come before them.
 *
 * Sources are only ever read. Everything written lands in
 * `<workspace>/generated/<campaign_id>/`, and the joined, unsubtitled video is kept
 * in its `edit-work` folder so video_verify_render can compare against it.
 *
 * The input is the EditDecisionList contract, segments are fitted to a platform
 * preset instead of a fixed 1080p scale, overlays are text and library images
 * rather than rendered animation clips, subtitles are built from the saved
 * transcripts with Social Campaign's cue rules, and there is no color grade because
 * the contract has no field for one.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { UserFacingError } from '../lib/errors.mjs';
import { run, probeFile } from '../media/probe.mjs';
import { fitFilter, runFfmpeg, PLATFORM_PRESETS } from '../generation/edit.mjs';
import {
  chunkSegments,
  escapeFilterPath,
  forceStyle,
  MAX_CHARS_PER_LINE,
  MAX_LINES,
  MIN_CUE_SECONDS,
  toSrt,
  toVtt,
  wrapLines,
} from '../generation/subtitles.mjs';
import { findFontFile } from './detect.mjs';
import { groupIntoPhrases } from './pack.mjs';
import { ASPECT_SIZES, aspectLabel, findLibraryAsset, wordsInClip } from './edl.mjs';

/** Social loudness target: integrated LUFS, true peak and loudness range. */
export const LOUDNESS_TARGET = { I: -14, TP: -1, LRA: 11 };

/** The render presets: a full quality master plus every edit_export platform preset. */
export const RENDER_PRESET_NAMES = ['master', ...Object.keys(PLATFORM_PRESETS)];

/** Longest a word timed cue may stay up. */
const MAX_CUE_SECONDS = 3.2;

/**
 * @param {number} value
 * @returns {number}
 */
function ms(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * The frame size, frame rate and fit a render uses.
 * @param {any} edl
 * @param {string} preset
 * @param {Map<string, import('./edl.mjs').ResolvedSource>} sources
 * @returns {{width: number, height: number, fps: number, fit: 'pad'|'crop', label: string}}
 */
export function outputSpec(edl, preset, sources) {
  const output = edl.output ?? {};
  const fit = output.fit === 'crop' ? 'crop' : 'pad';
  const firstSource = sources.get(String(edl.clips?.[0]?.source_id));
  const fps = Number(output.fps) > 0 ? Number(output.fps) : Math.min(60, Number(firstSource?.fps) > 0 ? Number(firstSource?.fps) : 30);
  if (preset === 'master') {
    const size =
      output.width && output.height ? { width: Number(output.width), height: Number(output.height) } : ASPECT_SIZES[output.aspect_ratio];
    return { ...size, fps, fit, label: 'Master' };
  }
  const platform = PLATFORM_PRESETS[preset];
  if (!platform) {
    throw new UserFacingError(`There is no render preset called "${preset}".`, {
      code: 'unknown_render_preset',
      fix: `Choose one of: ${RENDER_PRESET_NAMES.join(', ')}.`,
    });
  }
  const presetAspect = aspectLabel(platform.width, platform.height);
  if (presetAspect !== output.aspect_ratio) {
    throw new UserFacingError(`This edit is ${output.aspect_ratio}, and ${platform.label} needs ${presetAspect}.`, {
      code: 'preset_aspect_mismatch',
      fix: `Render it as master, pick a ${output.aspect_ratio} preset, or save a ${presetAspect} version of the edit.`,
    });
  }
  return { width: platform.width, height: platform.height, fps, fit, label: platform.label };
}

/**
 * Word timed subtitle cues on the output timeline.
 *
 * Cues never cross a clip boundary or a phrase break, hold at most two lines of
 * MAX_CHARS_PER_LINE, and start on their first word. Where a source only has
 * segment timings, the segments inside the clip go through the shared social
 * chunker instead.
 *
 * @param {any} edl the resolved list
 * @param {Map<string, import('./edl.mjs').ResolvedSource>} sources
 * @param {number[]} lengths the real length of each cut clip, in order
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function buildCutCues(edl, sources, lengths) {
  /** @type {Array<{start: number, end: number, text: string, lines: string[]}>} */
  const cues = [];
  const shift = Number(edl.subtitles?.offset_s) || 0;
  let offset = 0;
  edl.clips.forEach((clip, index) => {
    const length = lengths[index] ?? clip.out_s - clip.in_s;
    const source = sources.get(String(clip.source_id));
    const toOutput = (/** @type {number} */ t) => Math.min(offset + length, Math.max(offset, t - clip.in_s + offset)) + shift;
    if (source?.transcript) {
      const words = wordsInClip(source, clip.in_s, clip.out_s);
      if (words.length > 0) {
        const clipCues = [];
        for (const phrase of phrasesOf(words)) {
          /** @type {typeof words} */
          let group = [];
          const flush = () => {
            if (group.length === 0) return;
            const text = group.map((word) => word.text).join(' ').replace(/\s+([,.?!;:])/g, '$1');
            const lines = wrapLines(text, MAX_CHARS_PER_LINE);
            clipCues.push({ start: toOutput(group[0].start_s), end: toOutput(group[group.length - 1].end_s), text: lines.join('\n'), lines });
            group = [];
          };
          for (const word of phrase) {
            const candidate = [...group, word].map((entry) => entry.text).join(' ');
            const tooLong = wrapLines(candidate, MAX_CHARS_PER_LINE).length > MAX_LINES;
            const tooSlow = group.length > 0 && word.end_s - group[0].start_s > MAX_CUE_SECONDS;
            if (group.length > 0 && (tooLong || tooSlow)) flush();
            group.push(word);
            if (/[.?!]$/.test(word.text) && group.length >= 3) flush();
          }
          flush();
        }
        // Hold each cue for a readable moment, but never past the next one or the clip end.
        clipCues.forEach((cue, cueIndex) => {
          const limit = cueIndex + 1 < clipCues.length ? clipCues[cueIndex + 1].start : offset + length + shift;
          cue.end = Math.min(limit, Math.max(cue.end, cue.start + MIN_CUE_SECONDS));
        });
        cues.push(...clipCues);
      } else {
        const segments = source.transcript.segments
          .filter((segment) => segment.start_s < clip.out_s && segment.end_s > clip.in_s)
          .map((segment) => ({ start: toOutput(segment.start_s), end: toOutput(segment.end_s), text: segment.text }));
        cues.push(...chunkSegments(segments).map((cue) => ({ ...cue, end: Math.min(cue.end, offset + length + shift) })));
      }
    }
    offset += length;
  });
  return cues
    .filter((cue) => cue.end > cue.start && cue.start >= 0)
    .map((cue) => ({ start: ms(cue.start), end: ms(cue.end), text: cue.text }));
}

/**
 * Split a clip's words into phrases at the packed transcript's silences.
 * @param {import('./transcripts.mjs').Word[]} words
 * @returns {import('./transcripts.mjs').Word[][]}
 */
function phrasesOf(words) {
  /** @type {import('./transcripts.mjs').Word[][]} */
  const phrases = [];
  let cursor = 0;
  for (const phrase of groupIntoPhrases(words)) {
    /** @type {import('./transcripts.mjs').Word[]} */
    const members = [];
    while (cursor < words.length && words[cursor].start_s <= phrase.end_s) {
      members.push(words[cursor]);
      cursor += 1;
    }
    if (members.length) phrases.push(members);
  }
  return phrases;
}

/**
 * Cut one clip out on its own: frame accurate, at the output size and rate, with
 * a fade at both ends of its sound, and silence filled in when there is none.
 * @param {{source: import('./edl.mjs').ResolvedSource, clip: any, spec: {width: number, height: number, fps: number, fit: 'pad'|'crop'}, out: string, keepSound: boolean}} options
 * @returns {Promise<number>} the planned length, a whole number of frames
 */
async function cutClip({ source, clip, spec, out, keepSound }) {
  const frames = Math.max(1, Math.round((clip.out_s - clip.in_s) * spec.fps));
  const length = frames / spec.fps;
  const fade = Math.min((Number(clip.audio_fade_ms) || 0) / 1000, length / 2);
  const useSourceSound = keepSound && source.has_audio;
  const audioChain =
    `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${length.toFixed(6)}` +
    (fade > 0 ? `,afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${(length - fade).toFixed(6)}:d=${fade.toFixed(3)}` : '');
  /** @type {string[]} */
  const args = ['-ss', clip.in_s.toFixed(3), '-i', source.path];
  if (!useSourceSound) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push(
    '-filter_complex',
    `[0:v]${fitFilter(spec, spec.fit)},fps=${spec.fps},format=yuv420p[v];[${useSourceSound ? '0:a:0' : '1:a'}]${audioChain}[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-frames:v',
    String(frames),
    '-t',
    length.toFixed(6),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(spec.fps),
    // PCM until the very last pass: AAC starts every file with priming samples, and
    // joining AAC clips shifts the sound about 21 ms later at every cut.
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    out,
  );
  await runFfmpeg(args);
  return length;
}

/**
 * Join the cut clips without encoding them again.
 * @param {string[]} parts
 * @param {string} workDir
 * @param {string} out
 */
async function concatParts(parts, workDir, out) {
  const list = join(workDir, 'concat.txt');
  writeFileSync(list, parts.map((part) => `file '${part.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`).join(''), 'utf8');
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  rmSync(list, { force: true });
}

/**
 * Where a text overlay sits.
 * @param {string|null|undefined} position
 * @returns {string}
 */
function textY(position) {
  switch (position) {
    case 'top':
      return 'h*0.12';
    case 'middle':
      return '(h-th)/2';
    case 'bottom':
      return 'h*0.86-th';
    default:
      return 'h*0.70-th';
  }
}

/**
 * Where an image overlay sits.
 * @param {string|null|undefined} position
 * @returns {string}
 */
function imageY(position) {
  switch (position) {
    case 'top':
      return 'H*0.06';
    case 'bottom':
      return 'H*0.94-h';
    case 'lower_third':
      return 'H*0.72-h';
    default:
      return '(H-h)/2';
  }
}

/**
 * Read loudnorm's first pass measurement.
 * @param {string} filePath
 * @returns {Promise<Record<string, string>|null>}
 */
async function measureLoudness(filePath) {
  const { stderr } = await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-vn',
      '-af',
      `loudnorm=I=${LOUDNESS_TARGET.I}:TP=${LOUDNESS_TARGET.TP}:LRA=${LOUDNESS_TARGET.LRA}:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: 300_000 },
  );
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(stderr.slice(start, end + 1));
    const input = Number(data.input_i);
    if (!Number.isFinite(input) || input < -69) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} RenderResult
 * @property {string} out_path the finished file in the campaign folder
 * @property {string} base_path the joined clips before overlays and subtitles
 * @property {number} width
 * @property {number} height
 * @property {number} fps
 * @property {number} duration_s probed length of the finished file
 * @property {number} expected_s the list's length
 * @property {Array<{clip_id: string, source_id: string, in_s: number, out_s: number, offset_s: number, length_s: number, path: string}>} segments
 * @property {Array<{start: number, end: number, text: string}>} cues
 * @property {string|null} srt_path
 * @property {string|null} vtt_path
 * @property {'none'|'burn_in'|'sidecar'} subtitles_mode
 * @property {boolean} sound_expected
 * @property {boolean} loudness_normalised
 * @property {string[]} warnings
 */

/**
 * Render a resolved list.
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   edl: any,
 *   sources: Map<string, import('./edl.mjs').ResolvedSource>,
 *   preset: string,
 *   outDir: string,
 *   name: string,
 * }} options
 * @returns {Promise<RenderResult>}
 */
export async function renderEdl({ db, edl, sources, preset, outDir, name }) {
  const spec = outputSpec(edl, preset, sources);
  /** @type {string[]} */
  const warnings = [];
  const workDir = join(outDir, 'edit-work', name);
  mkdirSync(workDir, { recursive: true });
  const audio = edl.audio ?? {};
  const keepSound = audio.keep_source_audio !== false;

  // 1. Cut every clip on its own.
  /** @type {RenderResult['segments']} */
  const segments = [];
  let offset = 0;
  for (const [index, clip] of edl.clips.entries()) {
    const source = sources.get(String(clip.source_id));
    if (!source) throw new UserFacingError(`Source ${clip.source_id} of this edit could not be found.`, { code: 'edl_source_missing' });
    const path = join(workDir, `clip-${String(index + 1).padStart(3, '0')}.mkv`);
    const length = await cutClip({ source, clip, spec, out: path, keepSound });
    segments.push({ clip_id: String(clip.id), source_id: String(clip.source_id), in_s: clip.in_s, out_s: clip.out_s, offset_s: ms(offset), length_s: ms(length), path });
    offset += length;
  }
  // The real length of each cut, which is what the subtitles are placed by.
  for (const segment of segments) {
    const probed = await probeFile(segment.path);
    if (probed.duration) segment.length_s = ms(probed.duration);
  }
  let running = 0;
  for (const segment of segments) {
    segment.offset_s = ms(running);
    running += segment.length_s;
  }

  // 2. Join them without a second encode.
  const basePath = join(workDir, 'joined.mkv');
  await concatParts(
    segments.map((segment) => segment.path),
    workDir,
    basePath,
  );
  for (const segment of segments) rmSync(segment.path, { force: true });
  const base = await probeFile(basePath);
  const total = base.duration ?? running;

  // Subtitles, on the output timeline.
  const mode = edl.subtitles?.mode === 'burn_in' || edl.subtitles?.mode === 'sidecar' ? edl.subtitles.mode : 'none';
  /** @type {Array<{start: number, end: number, text: string}>} */
  let cues = [];
  /** @type {string|null} */
  let srtPath = null;
  /** @type {string|null} */
  let vttPath = null;
  if (mode !== 'none') {
    cues = buildCutCues(
      edl,
      sources,
      segments.map((segment) => segment.length_s),
    ).filter((cue) => cue.start < total);
    if (cues.length === 0) {
      warnings.push('Subtitles were asked for, but the clips in this edit have no transcribed words.');
    } else {
      srtPath = join(outDir, `${name}.srt`);
      vttPath = join(outDir, `${name}.vtt`);
      writeFileSync(srtPath, toSrt(cues), 'utf8');
      writeFileSync(vttPath, toVtt(cues), 'utf8');
    }
  }

  // 3. Overlays, then subtitles last, and the sound mix, in one pass.
  const fontFile = findFontFile();
  /** @type {string[]} */
  const inputs = ['-i', basePath];
  /** @type {string[]} */
  const videoFilters = [];
  /** @type {string[]} */
  const graph = [];
  let videoLabel = '[0:v]';
  let nextInput = 1;
  for (const [index, overlay] of (edl.overlays ?? []).entries()) {
    const from = Math.max(0, Number(overlay.start_s));
    const to = Math.min(total, Number(overlay.end_s));
    if (!(to > from)) continue;
    const enable = `enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`;
    if (overlay.kind === 'text') {
      if (!fontFile) {
        warnings.push(`Text overlay ${index + 1} was left out because no font file was found on this computer.`);
        continue;
      }
      const textFile = join(workDir, `overlay-${index + 1}.txt`);
      writeFileSync(textFile, String(overlay.text ?? ''), 'utf8');
      const size = Math.round(spec.height / 22);
      videoFilters.push(
        `drawtext=fontfile='${escapeFilterPath(fontFile)}':textfile='${escapeFilterPath(textFile)}':expansion=none:` +
          `fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size / 2)}:` +
          `x=(w-tw)/2:y=${textY(overlay.position)}:${enable}`,
      );
    } else {
      const { row } = findLibraryAsset(db, { asset_id: overlay.asset_id });
      if (!row) {
        warnings.push(`Image overlay ${index + 1} was left out because its asset is no longer in the library.`);
        continue;
      }
      inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', String(row.path));
      const width = 2 * Math.round((spec.width * 0.6) / 2);
      if (videoFilters.length) {
        graph.push(`${videoLabel}${videoFilters.join(',')}[pre${index}]`);
        videoLabel = `[pre${index}]`;
        videoFilters.length = 0;
      }
      graph.push(`[${nextInput}:v]scale=${width}:-2,format=rgba[img${index}]`);
      graph.push(`${videoLabel}[img${index}]overlay=x=(W-w)/2:y=${imageY(overlay.position)}:${enable}[ov${index}]`);
      videoLabel = `[ov${index}]`;
      nextInput += 1;
    }
  }
  if (mode === 'burn_in' && srtPath) {
    const vertical = spec.height > spec.width;
    videoFilters.push(
      `subtitles='${escapeFilterPath(srtPath)}':force_style='${forceStyle({ position: 'bottom', margin_v: vertical ? 90 : 36 })}'`,
    );
  }
  const videoChanged = graph.length > 0 || videoFilters.length > 0;
  if (videoChanged) {
    graph.push(`${videoLabel}${videoFilters.length ? videoFilters.join(',') : 'null'}[vout]`);
    videoLabel = '[vout]';
  }

  // Sound: the programme, then a voiceover over it and a music bed under both.
  const format = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  let audioLabel = '[0:a]';
  const anySourceSound = keepSound && edl.clips.some((clip) => sources.get(String(clip.source_id))?.has_audio);
  let soundExpected = anySourceSound;
  for (const key of ['voiceover', 'music']) {
    const track = audio[key];
    if (!track || (!track.asset_id && !track.path)) continue;
    const { row } = findLibraryAsset(db, track);
    if (!row) {
      warnings.push(`The ${key} was left out because it is no longer in the library.`);
      continue;
    }
    if (key === 'music') inputs.push('-stream_loop', '-1');
    inputs.push('-i', String(row.path));
    const volume = Number.isFinite(Number(track.volume)) ? Number(track.volume) : key === 'music' ? 0.25 : 1;
    const input = `[${nextInput}:a]${format},volume=${volume},apad,atrim=0:${total.toFixed(6)}`;
    nextInput += 1;
    if (key === 'voiceover') {
      graph.push(`${input},asplit=2[vo${nextInput}][key${nextInput}]`);
      if (anySourceSound) {
        graph.push(`${audioLabel}${format}[prog${nextInput}]`);
        graph.push(`[prog${nextInput}][key${nextInput}]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[duck${nextInput}]`);
        graph.push(`[duck${nextInput}][vo${nextInput}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix${nextInput}]`);
      } else {
        graph.push(`[key${nextInput}]anullsink`);
        graph.push(`[vo${nextInput}]anull[mix${nextInput}]`);
      }
    } else if (track.duck !== false && soundExpected) {
      graph.push(`${input}[bed${nextInput}]`);
      graph.push(`${audioLabel}${format},asplit=2[prog${nextInput}][key${nextInput}]`);
      graph.push(`[bed${nextInput}][key${nextInput}]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500[duck${nextInput}]`);
      graph.push(`[prog${nextInput}][duck${nextInput}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix${nextInput}]`);
    } else {
      graph.push(`${input}[bed${nextInput}]`);
      graph.push(`${audioLabel}${format}[prog${nextInput}]`);
      graph.push(`[prog${nextInput}][bed${nextInput}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix${nextInput}]`);
    }
    audioLabel = `[mix${nextInput}]`;
    soundExpected = true;
  }
  const audioChanged = audioLabel !== '[0:a]';

  let composedPath = basePath;
  if (videoChanged || audioChanged) {
    composedPath = join(workDir, 'composed.mkv');
    /** @type {string[]} */
    const args = [...inputs];
    if (graph.length) args.push('-filter_complex', graph.join(';'));
    args.push('-map', videoLabel === '[0:v]' ? '0:v:0' : videoLabel, '-map', audioLabel === '[0:a]' ? '0:a:0' : audioLabel);
    if (videoChanged) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(spec.fps));
    else args.push('-c:v', 'copy');
    args.push('-c:a', 'pcm_s16le', '-ar', '48000', '-t', total.toFixed(6), composedPath);
    await runFfmpeg(args);
  }

  // 4. Loudness, in two passes so the gain is linear and the cut fades keep their
  // shape, and the only lossy sound encode of the whole render.
  const outPath = join(outDir, `${name}.mp4`);
  const measured = soundExpected ? await measureLoudness(composedPath) : null;
  /** @type {string[]} */
  const loudness = measured
    ? [
        '-af',
        `loudnorm=I=${LOUDNESS_TARGET.I}:TP=${LOUDNESS_TARGET.TP}:LRA=${LOUDNESS_TARGET.LRA}` +
          `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}` +
          `:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`,
      ]
    : [];
  if (!measured && soundExpected) warnings.push('The sound was too quiet to measure, so it was not loudness normalised.');
  await runFfmpeg([
    '-i',
    composedPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'copy',
    ...loudness,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    outPath,
  ]);
  if (composedPath !== basePath) rmSync(composedPath, { force: true });

  const finished = await probeFile(outPath);
  return {
    out_path: outPath,
    base_path: basePath,
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    duration_s: finished.duration ?? 0,
    expected_s: ms(edl.clips.reduce((sum, clip) => sum + (clip.out_s - clip.in_s), 0)),
    segments: segments.map(({ path: _path, ...rest }) => rest),
    cues,
    srt_path: srtPath,
    vtt_path: vttPath,
    subtitles_mode: mode,
    sound_expected: soundExpected,
    loudness_normalised: Boolean(measured),
    warnings,
  };
}
