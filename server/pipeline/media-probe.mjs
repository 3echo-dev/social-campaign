/**
 * Measuring a picture or video: `{ width, height, durationSeconds }` as it shows on screen.
 *
 * Kept apart from publish-intent.mjs so the code that places a person's own files in a job (supplied-media.mjs,
 * runtime.mjs) can measure them without importing the posting plan, which imports the runtime. publish-intent.mjs
 * re-exports probeMedia, so the posting plan and its tests keep reading it from there.
 */

import { closeSync, openSync, readSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { imageInfo } from '../brand-kit/image-info.mjs';

const PROBE_TIMEOUT_MS = 30000;
const HEAD_BYTES = 1024 * 1024;

function ffprobe(file) {
  const run = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (run.error || run.status !== 0) return null;
  try { return JSON.parse(run.stdout); } catch { return null; }
}

/** `{ width, height, durationSeconds }` as the file shows on screen (a turned phone video swaps them), or null. */
export function probeMedia(file, kind) {
  let width = null;
  let height = null;
  let duration = null;
  if (kind === 'image') {
    let head = null;
    try {
      const fd = openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        head = buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
      } finally { closeSync(fd); }
    } catch { head = null; }
    const info = head ? imageInfo(head) : null;
    if (info && info.width > 0 && info.height > 0) return { width: info.width, height: info.height, durationSeconds: null };
  }
  const raw = ffprobe(file);
  const video = Array.isArray(raw?.streams) ? raw.streams.find(stream => stream.codec_type === 'video') : null;
  if (!video) return null;
  width = Number(video.width);
  height = Number(video.height);
  if (!(width > 0) || !(height > 0)) return null;
  const rotation = Number(video.tags?.rotate ?? (Array.isArray(video.side_data_list) ? video.side_data_list.find(item => item?.rotation !== undefined)?.rotation : 0)) || 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  duration = kind === 'video' ? Number(raw.format?.duration ?? video.duration) : null;
  return { width, height, durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null };
}
