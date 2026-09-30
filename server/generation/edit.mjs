/**
 * The final edit: ffmpeg helpers for everything between a generated clip and a file
 * a platform will accept.
 *
 * Every function here writes into `<workspace>/generated/<campaign_id>/` and never
 * touches an input. ffmpeg is always called with an argument array through
 * server/media/probe.mjs's run(), so a folder with spaces is safe and nothing is
 * ever handed to a shell.
 *
 * The platform presets are the sizes from the platform playbooks: 9:16 for Reels
 * and TikTok, square and 4:5 for the Facebook and Instagram feed. Fitting is either
 * `pad`, which keeps the whole frame and fills the rest, or `crop`, which fills the
 * frame and loses the edges.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { UserFacingError } from '../lib/errors.mjs';
import { run, probeFile } from '../media/probe.mjs';

/** How long any one ffmpeg call may take. */
const FFMPEG_TIMEOUT_MS = 300_000;

/** Extensions treated as stills rather than clips. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

/**
 * The export sizes, in user facing names.
 * @type {Record<string, {label: string, width: number, height: number}>}
 */
export const PLATFORM_PRESETS = {
  instagram_reels: { label: 'Instagram Reels', width: 1080, height: 1920 },
  instagram_feed_square: { label: 'Instagram feed, square', width: 1080, height: 1080 },
  instagram_feed_portrait: { label: 'Instagram feed, portrait', width: 1080, height: 1350 },
  tiktok: { label: 'TikTok', width: 1080, height: 1920 },
  facebook_reels: { label: 'Facebook Reels', width: 1080, height: 1920 },
  facebook_feed_square: { label: 'Facebook feed, square', width: 1080, height: 1080 },
  facebook_feed_portrait: { label: 'Facebook feed, portrait', width: 1080, height: 1350 },
};

/**
 * Run ffmpeg quietly, overwriting the output.
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function runFfmpeg(args) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs: FFMPEG_TIMEOUT_MS });
}

/**
 * The folder this campaign's generated and exported files live in.
 * @param {string} workspaceRoot
 * @param {string} campaignId
 * @returns {string}
 */
export function generatedDir(workspaceRoot, campaignId) {
  const dir = join(workspaceRoot, 'generated', campaignId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(extname(String(filePath)).toLowerCase());
}

/**
 * @param {string} filePath
 */
function requireFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    throw new UserFacingError('That file could not be found.', { code: 'file_missing' });
  }
}

/**
 * A name for a derived file that keeps its origin readable.
 * @param {string} dir
 * @param {string} sourcePath
 * @param {string} suffix
 * @param {string} [extension]
 * @returns {string}
 */
export function derivedPath(dir, sourcePath, suffix, extension) {
  const stem = basename(sourcePath, extname(sourcePath)).replace(/[^\w.-]+/g, '-');
  const suffixExtension = extension ?? (extname(sourcePath) || '.mp4');
  return join(dir, `${stem}-${suffix}${suffixExtension}`);
}

/**
 * Cut a clip down to one stretch of it.
 * @param {{input: string, out: string, start?: number, duration?: number, end?: number}} options
 * @returns {Promise<{out: string}>}
 */
export async function trimClip({ input, out, start = 0, duration, end }) {
  requireFile(input);
  const length = duration ?? (Number.isFinite(Number(end)) ? Number(end) - Number(start) : undefined);
  if (!Number.isFinite(Number(length)) || Number(length) <= 0) {
    throw new UserFacingError('A trim needs a length longer than nothing.', { code: 'invalid_trim' });
  }
  await runFfmpeg([
    '-ss',
    String(start),
    '-i',
    input,
    '-t',
    String(length),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    out,
  ]);
  return { out };
}

/**
 * Join clips end to end. They are scaled and padded to a common size and frame rate
 * first, because a straight concatenation of different sizes produces a broken file
 * rather than an error.
 * @param {{inputs: string[], out: string, width?: number, height?: number, fps?: number}} options
 * @returns {Promise<{out: string, width: number, height: number}>}
 */
export async function concatClips({ inputs, out, width, height, fps = 30 }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new UserFacingError('There are no clips to join.', { code: 'nothing_to_join' });
  }
  for (const input of inputs) requireFile(input);
  if (inputs.length === 1 && !width) {
    await runFfmpeg(['-i', inputs[0], '-c', 'copy', out]);
    const probe = await probeFile(out);
    return { out, width: probe.width ?? 0, height: probe.height ?? 0 };
  }

  const probes = await Promise.all(inputs.map((input) => probeFile(input)));
  const targetWidth = width ?? probes[0].width ?? 1080;
  const targetHeight = height ?? probes[0].height ?? 1920;
  const everyClipHasAudio = probes.every((probe) => probe.has_audio);

  /** @type {string[]} */
  const args = [];
  for (const input of inputs) args.push('-i', input);

  const chains = inputs
    .map(
      (_input, index) =>
        `[${index}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${index}]`,
    )
    .join(';');
  const labels = inputs
    .map((_input, index) => (everyClipHasAudio ? `[v${index}][${index}:a]` : `[v${index}]`))
    .join('');
  const concat = `${labels}concat=n=${inputs.length}:v=1:a=${everyClipHasAudio ? 1 : 0}[vout]${
    everyClipHasAudio ? '[aout]' : ''
  }`;

  args.push('-filter_complex', `${chains};${concat}`, '-map', '[vout]');
  if (everyClipHasAudio) args.push('-map', '[aout]', '-c:a', 'aac');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  await runFfmpeg(args);
  return { out, width: targetWidth, height: targetHeight };
}

/**
 * Put an audio track on a video.
 *
 * `replace` drops whatever audio the video had. `mix` keeps both, and when `duck`
 * is on the existing bed is pushed down whenever the new track is speaking, using
 * sidechaincompress, which is what a voiceover over music needs.
 * @param {{video: string, audio: string, out: string, mode?: 'replace'|'mix', duck?: boolean, voice_volume?: number, bed_volume?: number}} options
 * @returns {Promise<{out: string, mode: string}>}
 */
export async function addAudioTrack({
  video,
  audio,
  out,
  mode = 'mix',
  duck = true,
  voice_volume: voiceVolume = 1,
  bed_volume: bedVolume = 0.35,
}) {
  requireFile(video);
  requireFile(audio);
  const videoProbe = await probeFile(video);
  const effectiveMode = videoProbe.has_audio ? mode : 'replace';

  if (effectiveMode === 'replace') {
    await runFfmpeg([
      '-i',
      video,
      '-i',
      audio,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      out,
    ]);
    return { out, mode: 'replace' };
  }

  const filter = duck
    ? `[1:a]volume=${voiceVolume},asplit=2[voice][key];` +
      `[0:a]volume=${bedVolume}[bed];` +
      `[bed][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked];` +
      `[ducked][voice]amix=inputs=2:duration=first:dropout_transition=0[aout]`
    : `[0:a]volume=${bedVolume}[bed];[1:a]volume=${voiceVolume}[voice];` +
      `[bed][voice]amix=inputs=2:duration=first:dropout_transition=0[aout]`;

  await runFfmpeg([
    '-i',
    video,
    '-i',
    audio,
    '-filter_complex',
    filter,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    out,
  ]);
  return { out, mode: 'mix' };
}

/**
 * The scale filter for one preset and fitting choice.
 * @param {{width: number, height: number}} preset
 * @param {'pad'|'crop'} fit
 * @param {string} background
 * @returns {string}
 */
export function fitFilter(preset, fit, background = 'black') {
  if (fit === 'crop') {
    return (
      `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,` +
      `crop=${preset.width}:${preset.height},setsar=1`
    );
  }
  return (
    `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,` +
    `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1`
  );
}

/**
 * Export one asset at one platform's size. Works for a clip or a still.
 * @param {{input: string, out_dir: string, platform: string, fit?: 'pad'|'crop', background?: string}} options
 * @returns {Promise<{platform: string, label: string, path: string, width: number, height: number, fit: string}>}
 */
export async function exportForPlatform({ input, out_dir: outDir, platform, fit = 'pad', background = 'black' }) {
  requireFile(input);
  const preset = PLATFORM_PRESETS[platform];
  if (!preset) {
    throw new UserFacingError(`Social Campaign does not have a size for "${platform}".`, {
      code: 'unknown_platform_preset',
      fix: `Choose one of: ${Object.keys(PLATFORM_PRESETS).join(', ')}.`,
    });
  }
  mkdirSync(outDir, { recursive: true });
  const still = isImagePath(input);
  const out = derivedPath(outDir, input, platform, still ? '.jpg' : '.mp4');
  const filter = fitFilter(preset, fit, background);

  if (still) {
    await runFfmpeg(['-i', input, '-vf', filter, '-frames:v', '1', '-q:v', '2', out]);
  } else {
    await runFfmpeg([
      '-i',
      input,
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      out,
    ]);
  }
  return { platform, label: preset.label, path: out, width: preset.width, height: preset.height, fit };
}

/**
 * Pull a single frame out as the cover image.
 * @param {{input: string, out: string, at?: number}} options
 * @returns {Promise<{out: string}>}
 */
export async function coverFrame({ input, out, at = 0 }) {
  requireFile(input);
  await runFfmpeg(['-ss', String(Math.max(0, Number(at) || 0)), '-i', input, '-frames:v', '1', '-q:v', '2', out]);
  return { out };
}

/**
 * Apply the optional operations edit_export accepts, in a fixed order, and return
 * the file the exports should be cut from.
 * @param {{input: string, out_dir: string, operations?: any}} options
 * @returns {Promise<{path: string, applied: string[]}>}
 */
export async function applyOperations({ input, out_dir: outDir, operations }) {
  /** @type {string[]} */
  const applied = [];
  let current = input;
  const ops = operations ?? {};

  if (Array.isArray(ops.concat_with) && ops.concat_with.length > 0) {
    const out = derivedPath(outDir, current, 'joined', '.mp4');
    await concatClips({ inputs: [current, ...ops.concat_with], out });
    current = out;
    applied.push('joined');
  }
  if (ops.trim && (Number(ops.trim.duration) > 0 || Number(ops.trim.end) > 0)) {
    const out = derivedPath(outDir, current, 'trimmed', '.mp4');
    await trimClip({ input: current, out, start: Number(ops.trim.start) || 0, duration: ops.trim.duration, end: ops.trim.end });
    current = out;
    applied.push('trimmed');
  }
  if (ops.audio && typeof ops.audio.path === 'string') {
    const out = derivedPath(outDir, current, 'with-audio', '.mp4');
    await addAudioTrack({
      video: current,
      audio: ops.audio.path,
      out,
      mode: ops.audio.mode === 'replace' ? 'replace' : 'mix',
      duck: ops.audio.duck !== false,
      voice_volume: Number(ops.audio.voice_volume) || 1,
      bed_volume: Number.isFinite(Number(ops.audio.bed_volume)) ? Number(ops.audio.bed_volume) : 0.35,
    });
    current = out;
    applied.push('audio added');
  }
  return { path: current, applied };
}
