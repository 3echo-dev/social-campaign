/**
 * FFprobe wrapper.
 *
 * Runs ffprobe with an argument array, never through a shell, and turns its JSON
 * into the handful of facts the library stores: duration, width, height, fps,
 * codec, audio track count and container.
 */

import { execFile } from 'node:child_process';

import { UserFacingError } from '../lib/errors.mjs';

/**
 * @typedef {object} ProbeResult
 * @property {number|null} duration seconds
 * @property {number|null} width
 * @property {number|null} height
 * @property {number|null} fps
 * @property {string|null} codec the first video stream codec, or the first audio codec when there is no video
 * @property {number} audio_tracks
 * @property {string|null} container the format name reported by ffprobe
 * @property {boolean} has_video
 * @property {boolean} has_audio
 * @property {number|null} bitrate
 */

/**
 * @param {string} binary
 * @param {string[]} args
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function run(binary, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      binary,
      args,
      { timeout: options.timeoutMs ?? 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = /** @type {any} */ (error).code;
          if (code === 'ENOENT') {
            rejectPromise(
              new UserFacingError(`${binary} is not installed on this computer.`, {
                code: 'binary_missing',
                fix: `Install FFmpeg so ${binary} is available, then try again.`,
              }),
            );
            return;
          }
          rejectPromise(
            new UserFacingError(`${binary} could not process this file.`, {
              code: 'media_tool_failed',
              details: { stderr: String(stderr).slice(-2000) },
            }),
          );
          return;
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Parse an ffprobe rational such as "30000/1001" into a number.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseRate(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num)) return null;
  if (den === undefined) return num;
  if (!Number.isFinite(den) || den === 0) return null;
  const rate = num / den;
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1000) / 1000 : null;
}

/**
 * Turn raw ffprobe JSON into a ProbeResult.
 * @param {any} raw
 * @returns {ProbeResult}
 */
export function summarizeProbe(raw) {
  const streams = Array.isArray(raw?.streams) ? raw.streams : [];
  const format = raw?.format && typeof raw.format === 'object' ? raw.format : {};
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.filter((stream) => stream.codec_type === 'audio');

  const durationText = format.duration ?? video?.duration ?? audio[0]?.duration;
  const duration = Number(durationText);
  const fps = video ? (parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate)) : null;

  return {
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null,
    width: video && Number.isInteger(video.width) ? video.width : null,
    height: video && Number.isInteger(video.height) ? video.height : null,
    // A still image reports a nominal frame rate; it is not meaningful.
    fps: video && duration > 0 ? fps : null,
    codec: video?.codec_name ?? audio[0]?.codec_name ?? null,
    audio_tracks: audio.length,
    container: typeof format.format_name === 'string' ? format.format_name : null,
    has_video: Boolean(video),
    has_audio: audio.length > 0,
    bitrate: Number.isFinite(Number(format.bit_rate)) ? Number(format.bit_rate) : null,
  };
}

/**
 * Probe a media file.
 * @param {string} filePath
 * @returns {Promise<ProbeResult>}
 */
export async function probeFile(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new UserFacingError('ffprobe returned something that could not be read.', { code: 'media_tool_failed' });
  }
  return summarizeProbe(raw);
}
