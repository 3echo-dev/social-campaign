/**
 * Frame extraction.
 *
 * Writes the first frame plus N evenly spaced representative frames as jpg into
 * <workspace>/.social-campaign/thumbs/<asset_id>/. For a still image it writes one
 * scaled thumbnail. Frames are the only thing Claude vision needs to analyse a
 * video, so they are kept small.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceDir } from '../lib/paths.mjs';
import { run } from './probe.mjs';

/** Longest edge of an extracted frame, in pixels. */
export const FRAME_MAX_EDGE = 640;

/** Default number of evenly spaced frames, on top of the first frame. */
export const DEFAULT_FRAME_COUNT = 4;

/**
 * @param {string} root workspace root
 * @returns {string}
 */
export function thumbsRoot(root) {
  return join(workspaceDir(root), 'thumbs');
}

/**
 * @param {string} root workspace root
 * @param {string} assetId
 * @returns {string}
 */
export function thumbsDir(root, assetId) {
  return join(thumbsRoot(root), assetId);
}

/** ffmpeg filter that fits the frame inside FRAME_MAX_EDGE without upscaling. */
const SCALE_FILTER = `scale='min(${FRAME_MAX_EDGE},iw)':'min(${FRAME_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;

/**
 * @param {number} index
 * @returns {string}
 */
export function frameName(index) {
  return `frame-${String(index).padStart(2, '0')}.jpg`;
}

/**
 * Choose the timestamps to sample: 0 plus count points spread across the clip,
 * avoiding the very last instant where a decoder may return nothing.
 * @param {number} duration
 * @param {number} count
 * @returns {number[]}
 */
export function sampleTimes(duration, count) {
  const times = [0];
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return times;
  const usable = Math.max(duration - 0.25, 0);
  for (let i = 1; i <= count; i += 1) {
    const t = Math.round(((usable * i) / (count + 1)) * 1000) / 1000;
    if (t > 0 && !times.includes(t)) times.push(t);
  }
  return times;
}

/**
 * Extract frames from a video.
 * @param {{filePath: string, assetId: string, workspaceRoot: string, duration: number|null, count?: number}} options
 * @returns {Promise<{dir: string, thumbnail: string, frames: string[]}>}
 */
export async function extractVideoFrames(options) {
  const count = Math.min(Math.max(Number(options.count) || DEFAULT_FRAME_COUNT, 0), 24);
  const dir = thumbsDir(options.workspaceRoot, options.assetId);
  mkdirSync(dir, { recursive: true });
  // A re-extraction replaces the set, so a smaller count never leaves stale frames.
  for (const old of listFrames(options.workspaceRoot, options.assetId)) rmSync(old, { force: true });
  const times = sampleTimes(options.duration ?? 0, count);
  /** @type {string[]} */
  const frames = [];
  for (let i = 0; i < times.length; i += 1) {
    const target = join(dir, frameName(i));
    // -ss before -i seeks by keyframe, which is fast and good enough for a thumbnail.
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(times[i]),
      '-i',
      options.filePath,
      '-frames:v',
      '1',
      '-vf',
      SCALE_FILTER,
      '-q:v',
      '3',
      target,
    ]);
    if (existsSync(target)) frames.push(target);
  }
  return { dir, thumbnail: frames[0] ?? '', frames };
}

/**
 * Write one thumbnail for a still image.
 * @param {{filePath: string, assetId: string, workspaceRoot: string}} options
 * @returns {Promise<{dir: string, thumbnail: string, frames: string[]}>}
 */
export async function extractImageThumbnail(options) {
  const dir = thumbsDir(options.workspaceRoot, options.assetId);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, frameName(0));
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    options.filePath,
    '-frames:v',
    '1',
    '-vf',
    SCALE_FILTER,
    '-q:v',
    '3',
    target,
  ]);
  const frames = existsSync(target) ? [target] : [];
  return { dir, thumbnail: frames[0] ?? '', frames };
}

/**
 * List the frames already on disk for an asset, in order.
 * @param {string} workspaceRoot
 * @param {string} assetId
 * @returns {string[]}
 */
export function listFrames(workspaceRoot, assetId) {
  const dir = thumbsDir(workspaceRoot, assetId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^frame-\d{2}\.jpg$/.test(name))
    .sort()
    .map((name) => join(dir, name));
}
