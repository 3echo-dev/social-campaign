/**
 * Which yt-dlp every download and read uses.
 *
 * One resolver for all routes (the social router, link references, teardown, reference search and video_watch), so
 * they never disagree about the binary: an explicit override, SOCIAL_CAMPAIGN_YTDLP (left to the runner, which reads
 * it itself), the yt-dlp inside the research helper's Python environment, then the one on PATH.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { managedEnvironmentRoot } from '../setup/research-helper-record.mjs';

/**
 * @param {string} [override]
 * @returns {string|undefined} a path, or undefined to let the runner use SOCIAL_CAMPAIGN_YTDLP or PATH.
 */
export function referenceYtdlpBinary(override) {
  if (override) return override;
  if (process.env.SOCIAL_CAMPAIGN_YTDLP) return undefined; // the runner reads the env itself
  try {
    const env = managedEnvironmentRoot();
    const candidate = process.platform === 'win32' ? join(env, 'Scripts', 'yt-dlp.exe') : join(env, 'bin', 'yt-dlp');
    if (existsSync(candidate)) return candidate;
  } catch {
    // no research helper environment; fall through to PATH
  }
  return undefined;
}
