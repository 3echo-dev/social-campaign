/**
 * Check a render against its edit before anyone is shown it.
 *
 * A self evaluation made objective: the length against the list, the
 * picture size and frame rate against the preset, black or frozen stretches,
 * silences the edit did not ask for and dead air at the cuts, sound that jumps or
 * pops at a cut, integrated loudness against the social target, and the subtitles:
 * present when asked for, visible when burned in, and on their words within 0.15
 * seconds. It also draws a sheet of sampled frames, the first and last moments and
 * one just after every cut, for the agent to look at with Read.
 *
 * Every check is an ffmpeg measurement; nothing here judges taste.
 *
 * The visual self check becomes measured checks with a pass or fail, and the frame
 * sheet replaces per cut timeline images.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { run, probeFile } from '../media/probe.mjs';
import { runFfmpeg } from '../generation/edit.mjs';
import { escapeFilterPath } from '../generation/subtitles.mjs';
import { detectPictureProblems, detectSilences, findFontFile, integratedLoudness, windowLevel } from './detect.mjs';
import { buildCutCues, LOUDNESS_TARGET } from './render.mjs';
import { formatSeconds } from './pack.mjs';

/** Verifications that may fail per edit before the agent has to stop and ask. */
export const ATTEMPT_CAP = 3;

/** How close the render's length must be to the list's. */
export const DURATION_TOLERANCE_S = 0.1;

/** How close a subtitle must be to its words. */
export const SUBTITLE_TOLERANCE_S = 0.15;

/** Silence settings for verification: quieter and shorter than a phrase break. */
const SILENCE = { noiseDb: -45, minSeconds: 0.35 };

/** Cue midpoint frames whose subtitle band differs from the unsubtitled join by less PSNR than this carry a caption. */
const CAPTION_PSNR_DB = 32;

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {'ok'|'warn'|'fail'} status
 * @property {string} detail
 * @property {string|null} [fix]
 */

/**
 * Which clip an output moment falls in.
 * @param {Array<{clip_id: string, source_id: string, in_s: number, offset_s: number, length_s: number}>} segments
 * @param {number} t
 * @returns {{clip_id: string, source_id: string, source_time: number}|null}
 */
export function clipAt(segments, t) {
  for (const segment of segments) {
    if (t >= segment.offset_s && t < segment.offset_s + segment.length_s + 1e-6) {
      return { clip_id: segment.clip_id, source_id: segment.source_id, source_time: segment.in_s + (t - segment.offset_s) };
    }
  }
  const last = segments.at(-1);
  return last ? { clip_id: last.clip_id, source_id: last.source_id, source_time: last.in_s + last.length_s } : null;
}

/**
 * Parse an SRT file into cues.
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function parseSrt(text) {
  /** @type {Array<{start: number, end: number, text: string}>} */
  const cues = [];
  const toSeconds = (/** @type {string} */ stamp) => {
    const [hms, milli] = stamp.split(/[,.]/);
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + Number(milli) / 1000;
  };
  for (const block of String(text).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split('-->').map((part) => part.trim());
    cues.push({ start: toSeconds(from), end: toSeconds(to), text: lines.slice(timing + 1).join('\n') });
  }
  return cues;
}

/**
 * PSNR between the lower half of two frames at one moment.
 * @param {string} rendered
 * @param {string} reference
 * @param {number} t
 * @returns {Promise<number|null>}
 */
async function lowerHalfPsnr(rendered, reference, t) {
  const at = Math.max(0, t).toFixed(3);
  const { stderr } = await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-ss',
      at,
      '-i',
      rendered,
      '-ss',
      at,
      '-i',
      reference,
      '-filter_complex',
      '[0:v]crop=iw:ih/2:0:ih/2,format=yuv420p[a];[1:v]crop=iw:ih/2:0:ih/2,format=yuv420p[b];[a][b]psnr',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: 120_000 },
  );
  const match = /average:(inf|[\d.]+)/.exec(stderr);
  if (!match) return null;
  return match[1] === 'inf' ? 100 : Number(match[1]);
}

/**
 * Draw the frame sheet: one frame at each moment, labelled with its time, tiled.
 * @param {{path: string, out: string, times: number[], fps: number, width: number, height: number}} options
 * @returns {Promise<string>}
 */
async function frameSheet({ path, out, times, fps, width, height }) {
  const half = 0.5 / fps;
  const select = times.map((t) => `between(t,${(t - half).toFixed(4)},${(t + half - 1e-4).toFixed(4)})`).join('+');
  const cellWidth = height > width ? 216 : 384;
  // As few empty cells as possible: 5 or 6 frames sit in three columns, more in four.
  const columns = times.length <= 4 ? times.length : times.length <= 6 ? 3 : 4;
  const rows = Math.ceil(times.length / columns);
  const font = findFontFile();
  const labelFilter = font
    ? `,drawtext=fontfile='${escapeFilterPath(font)}':text='%{pts\\:hms}':x=8:y=8:fontsize=${Math.round(cellWidth / 14)}:` +
      'fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5'
    : '';
  mkdirSync(dirname(out), { recursive: true });
  await runFfmpeg([
    '-i',
    path,
    '-an',
    '-vf',
    `select='${select}',scale=${cellWidth}:-2${labelFilter},tile=${columns}x${rows}:padding=6:margin=6:color=0x121216`,
    '-frames:v',
    '1',
    '-update',
    '1',
    out,
  ]);
  return out;
}

/**
 * Moments worth looking at: the opening, just after every cut, the middle and the end.
 * @param {number} duration
 * @param {number[]} cuts
 * @param {number} fps
 * @returns {number[]}
 */
export function sampleMoments(duration, cuts, fps) {
  const frame = 1 / fps;
  const last = Math.max(0, duration - 2 * frame);
  const wanted = [Math.min(0.1, last), ...cuts.map((cut) => Math.min(last, cut + 0.12)), duration / 2, last];
  /** @type {number[]} */
  const moments = [];
  for (const t of wanted.sort((a, b) => a - b)) {
    if (moments.length && t - moments[moments.length - 1] < 3 * frame) continue;
    moments.push(Math.round(t / frame) * frame);
    if (moments.length >= 12) break;
  }
  return moments;
}

/**
 * Verify one render.
 * @param {{
 *   render: import('./render.mjs').RenderResult & {path: string, preset: string},
 *   edl: any,
 *   sources: Map<string, import('./edl.mjs').ResolvedSource>,
 *   sheetPath: string,
 * }} options
 * @returns {Promise<{passed: boolean, checks: Check[], frames: string[], suggested_fix: string|null}>}
 */
export async function verifyRender({ render, edl, sources, sheetPath }) {
  /** @type {Check[]} */
  const checks = [];
  const probe = await probeFile(render.path);
  const duration = probe.duration ?? 0;
  const segments = render.segments;
  const cuts = segments.slice(1).map((segment) => segment.offset_s);
  const where = (/** @type {number} */ t) => {
    const clip = clipAt(segments, t);
    return clip ? `clip ${clip.clip_id} (${clip.source_id} at ${formatSeconds(clip.source_time)} s)` : 'the edit';
  };

  // Length.
  const drift = Math.abs(duration - render.expected_s);
  checks.push({
    name: 'duration',
    status: drift <= DURATION_TOLERANCE_S ? 'ok' : 'fail',
    detail: `${formatSeconds(duration)} s rendered against ${formatSeconds(render.expected_s)} s in the edit (off by ${formatSeconds(drift)} s).`,
    fix: drift <= DURATION_TOLERANCE_S ? null : 'Render the edit again; if it stays off, check each clip against its source length.',
  });

  // Picture size and frame rate.
  const sizeOk = probe.width === render.width && probe.height === render.height;
  checks.push({
    name: 'picture_size',
    status: sizeOk ? 'ok' : 'fail',
    detail: `${probe.width}x${probe.height}, ${render.preset} needs ${render.width}x${render.height}.`,
    fix: sizeOk ? null : 'Render again with the same preset.',
  });
  const fpsOk = probe.fps !== null && Math.abs(probe.fps - render.fps) <= 0.05;
  checks.push({
    name: 'frame_rate',
    status: fpsOk ? 'ok' : 'fail',
    detail: `${probe.fps ?? 'unknown'} frames a second against ${render.fps}.`,
    fix: fpsOk ? null : 'Set output.fps in the edit and render again.',
  });

  // Black and frozen pictures.
  const picture = await detectPictureProblems(render.path, { duration });
  checks.push(
    picture.black.length === 0
      ? { name: 'black_frames', status: 'ok', detail: 'No black stretches.' }
      : {
          name: 'black_frames',
          status: 'fail',
          detail: picture.black.map((span) => `black from ${formatSeconds(span.start_s)} to ${formatSeconds(span.end_s)} s, in ${where(span.start_s)}`).join('; '),
          fix: `Trim ${where(picture.black[0].start_s)} so it starts or ends outside the black stretch.`,
        },
  );
  checks.push(
    picture.frozen.length === 0
      ? { name: 'frozen_frames', status: 'ok', detail: 'No frozen stretches of two seconds or more.' }
      : {
          name: 'frozen_frames',
          status: 'warn',
          detail: picture.frozen.map((span) => `still from ${formatSeconds(span.start_s)} to ${formatSeconds(span.end_s)} s, in ${where(span.start_s)}`).join('; '),
          fix: 'Look at the frame sheet: shorten the still stretch unless it is a deliberate hold.',
        },
  );

  // Silences and dead air at the cuts.
  if (!render.sound_expected || !probe.has_audio) {
    checks.push({ name: 'silence', status: render.sound_expected ? 'fail' : 'ok', detail: render.sound_expected ? 'The render has no sound track.' : 'This edit has no sound, as asked.' });
  } else {
    const silences = await detectSilences(render.path, SILENCE);
    const boundaries = [0, ...cuts, duration];
    /** @type {string[]} */
    const failures = [];
    /** @type {string[]} */
    const notes = [];
    /** @type {string|null} */
    let fix = null;
    /** @type {Map<string, Array<{start_s: number, end_s: number}>>} */
    const sourceSilences = new Map();
    for (const silence of silences) {
      const length = silence.end_s - silence.start_s;
      const atCut = boundaries.find((cut) => silence.start_s <= cut + 0.1 && silence.end_s >= cut - 0.1);
      if (atCut !== undefined) {
        const label = atCut === 0 ? 'at the start' : atCut === duration ? 'at the end' : `at the cut at ${formatSeconds(atCut)} s`;
        failures.push(`${formatSeconds(length)} s of dead air ${label} (${formatSeconds(silence.start_s)}-${formatSeconds(silence.end_s)} s)`);
        const clip = clipAt(segments, Math.min(duration - 0.001, Math.max(0, atCut === duration ? silence.start_s : (silence.start_s + silence.end_s) / 2)));
        fix ??= `Tighten clip ${clip?.clip_id ?? ''} so the cut sits on the word boundary rather than in the pause.`;
        continue;
      }
      const middle = (silence.start_s + silence.end_s) / 2;
      const clip = clipAt(segments, middle);
      const segment = segments.find((entry) => entry.clip_id === clip?.clip_id);
      const source = clip ? sources.get(clip.source_id) : null;
      let inSource = false;
      if (segment && source?.has_audio) {
        const key = segment.clip_id;
        if (!sourceSilences.has(key)) {
          sourceSilences.set(key, await detectSilences(source.path, { start: segment.in_s, end: segment.in_s + segment.length_s, ...SILENCE }));
        }
        const sourceTime = /** @type {{source_time: number}} */ (clip).source_time;
        inSource = /** @type {Array<{start_s: number, end_s: number}>} */ (sourceSilences.get(key)).some(
          (span) => span.start_s - 0.15 <= sourceTime && sourceTime <= span.end_s + 0.15,
        );
      }
      if (inSource) notes.push(`a ${formatSeconds(length)} s pause at ${formatSeconds(silence.start_s)} s, as in the source`);
      else {
        failures.push(`the sound drops out for ${formatSeconds(length)} s at ${formatSeconds(silence.start_s)} s in ${where(middle)}`);
        fix ??= `Check the source sound in ${where(middle)}; render again once it is fixed.`;
      }
    }
    checks.push(
      failures.length
        ? { name: 'silence', status: 'fail', detail: failures.join('; '), fix }
        : { name: 'silence', status: notes.length ? 'warn' : 'ok', detail: notes.length ? `Pauses kept from the footage: ${notes.join('; ')}.` : 'No dead air and no dropouts.', fix: notes.length ? 'Trim the pause if the pace should be tighter.' : null },
    );

    // Sound at the cuts: a fade dip at each one, and no big jump in level across it.
    /** @type {string[]} */
    const cutNotes = [];
    for (const cut of cuts.slice(0, 20)) {
      const [before, after, at] = await Promise.all([
        windowLevel(render.path, cut - 0.25, cut - 0.05),
        windowLevel(render.path, cut + 0.05, cut + 0.25),
        windowLevel(render.path, cut - 0.01, cut + 0.01),
      ]);
      const louder = Math.max(before.rms_db, after.rms_db);
      if (louder > -50 && at.rms_db > louder - 3) cutNotes.push(`no fade dip at ${formatSeconds(cut)} s, so it may click`);
      if (before.rms_db > -50 && after.rms_db > -50 && Math.abs(before.rms_db - after.rms_db) > 12) {
        cutNotes.push(`level jumps ${formatSeconds(Math.abs(before.rms_db - after.rms_db))} dB at ${formatSeconds(cut)} s`);
      }
    }
    checks.push({
      name: 'cut_sound',
      status: cutNotes.length ? 'warn' : 'ok',
      detail: cutNotes.length ? cutNotes.join('; ') : cuts.length ? `Faded cleanly at all ${cuts.length} cut${cuts.length === 1 ? '' : 's'}.` : 'No cuts inside the edit.',
      fix: cutNotes.length ? 'Pick takes with a closer level, or place the cut in a pause.' : null,
    });

    // Loudness.
    const loudness = await integratedLoudness(render.path);
    const off = loudness === null ? null : Math.abs(loudness - LOUDNESS_TARGET.I);
    checks.push({
      name: 'loudness',
      status: off === null ? 'fail' : off <= 1.5 ? 'ok' : off <= 3 ? 'warn' : 'fail',
      detail: loudness === null ? 'The sound is too quiet to measure.' : `${loudness.toFixed(1)} LUFS against the social target of ${LOUDNESS_TARGET.I} LUFS.`,
      fix: off !== null && off <= 1.5 ? null : 'Render again; the render normalises loudness, so a miss means the sound track changed afterwards or is mostly silent.',
    });
  }

  // Subtitles.
  if (render.subtitles_mode === 'none') {
    checks.push({ name: 'subtitles', status: 'ok', detail: 'Not asked for.' });
  } else if (!render.srt_path || !existsSync(render.srt_path)) {
    checks.push({ name: 'subtitles', status: 'fail', detail: 'Subtitles were asked for, but the render has none.', fix: 'Save a word level transcript for the sources, then render again.' });
  } else {
    const written = parseSrt(readFileSync(render.srt_path, 'utf8'));
    const expected = buildCutCues(edl, sources, segments.map((segment) => segment.length_s)).filter((cue) => cue.start < duration);
    /** @type {string[]} */
    const problems = [];
    if (written.length !== expected.length) problems.push(`${written.length} cues written, ${expected.length} expected from the transcript`);
    let worst = 0;
    written.forEach((cue, index) => {
      const want = expected[index];
      if (want) worst = Math.max(worst, Math.abs(cue.start - want.start), Math.abs(cue.end - want.end));
      if (cue.end > duration + SUBTITLE_TOLERANCE_S) problems.push(`cue ${index + 1} ends after the video`);
    });
    if (worst > SUBTITLE_TOLERANCE_S) problems.push(`cues are up to ${formatSeconds(worst)} s off their words`);
    if (render.subtitles_mode === 'burn_in' && render.base_path && existsSync(render.base_path)) {
      const probes = written.slice(0, 3);
      let visible = 0;
      for (const cue of probes) {
        const psnr = await lowerHalfPsnr(render.path, render.base_path, (cue.start + cue.end) / 2);
        if (psnr !== null && psnr < CAPTION_PSNR_DB) visible += 1;
      }
      if (probes.length && visible === 0) problems.push('no caption can be seen in the picture where the cues are');
    }
    checks.push(
      problems.length
        ? { name: 'subtitles', status: 'fail', detail: problems.join('; '), fix: 'Render the edit again; if the cues stay off, save the transcript again with word timings.' }
        : {
            name: 'subtitles',
            status: 'ok',
            detail: `${written.length} cue${written.length === 1 ? '' : 's'}, all within ${SUBTITLE_TOLERANCE_S} s of their words${render.subtitles_mode === 'burn_in' ? ' and visible in the picture' : ', as a separate file'}.`,
          },
    );
  }

  const frames = [];
  if (probe.has_video && duration > 0) {
    frames.push(await frameSheet({ path: render.path, out: sheetPath, times: sampleMoments(duration, cuts, render.fps), fps: render.fps, width: render.width, height: render.height }));
  }
  const failed = checks.filter((check) => check.status === 'fail');
  return {
    passed: failed.length === 0,
    checks: checks.map((check) => ({ name: check.name, status: check.status, detail: check.detail, fix: check.fix ?? null })),
    frames,
    suggested_fix: failed[0]?.fix ?? null,
  };
}
