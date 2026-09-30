/**
 * Audio extraction.
 *
 * Only runs when a tool asks for it explicitly: transcription is the one consumer
 * and it is optional. Output lands in <workspace>/imports/audio/<asset_id>.wav as
 * 16 kHz mono PCM, the shape speech to text services expect.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { run } from './probe.mjs';

/**
 * @param {string} root workspace root
 * @returns {string}
 */
export function audioDir(root) {
  return join(root, 'imports', 'audio');
}

/**
 * @param {{filePath: string, assetId: string, workspaceRoot: string, format?: 'wav'|'mp3'}} options
 * @returns {Promise<{path: string, format: string}>}
 */
export async function extractAudio(options) {
  const format = options.format === 'mp3' ? 'mp3' : 'wav';
  const dir = audioDir(options.workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${options.assetId}.${format}`);
  const codecArgs = format === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '4'] : ['-codec:a', 'pcm_s16le'];
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    options.filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    ...codecArgs,
    target,
  ]);
  if (!existsSync(target)) {
    throw new Error('No audio track could be extracted from this file.');
  }
  return { path: target, format };
}
