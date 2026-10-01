#!/usr/bin/env node
/**
 * SessionStart hook.
 *
 * Prints a few short lines: whether a Social Campaign workspace is set up,
 * whether this computer's Node is new enough, and how to install what is missing:
 * FFmpeg for video and audio, and yt-dlp for TikTok posts and video addresses. When
 * both are missing they share one line. yt-dlp is mentioned only when it is missing;
 * an old or limited yt-dlp is doctor's business, not the session start line's.
 *
 * Two rules govern everything in this file. It must never fail a session, so every
 * path ends in exit code 0 and anything unexpected is swallowed. And it must never
 * print an internal: no paths the user did not choose, no version strings beyond the
 * one number they would have to act on, no stack traces.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';

import { databasePath, globalConfigDir, integrationsPath } from '../server/lib/paths.mjs';
import { readJsonFile } from '../server/lib/json.mjs';
import { ytdlpInstallCommand, ytdlpSessionHint } from '../server/lib/install-hints.mjs';
import { ytdlpCommand } from '../server/social/backends/ytdlp.mjs';
import { resolveActiveWorkspace } from '../server/workspace/index.mjs';
import { boardSessionLines } from '../server/pipeline/board-freshness.mjs';

/** The oldest Node this plugin runs on, because it uses the built in SQLite. */
const MINIMUM_NODE = [22, 13];

const TOOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} line
 */
function say(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Is this Node new enough.
 * @param {string} version for example "v22.13.0".
 * @returns {boolean}
 */
export function nodeIsNewEnough(version) {
  const parts = String(version).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10));
  const [major, minor] = [parts[0] || 0, parts[1] || 0];
  if (major !== MINIMUM_NODE[0]) return major > MINIMUM_NODE[0];
  return minor >= MINIMUM_NODE[1];
}

/**
 * Is a command on PATH.
 * @param {string} command
 * @param {string[]} [args] how it reports its version.
 * @returns {boolean}
 */
function hasCommand(command, args = ['-version']) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 4000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Is yt-dlp installed. It reads "-version" as a bundle of short options, so it is
 * asked with two dashes, and SOCIAL_CAMPAIGN_YTDLP is honoured like everywhere else.
 * @returns {boolean}
 */
function hasYtDlp() {
  const { command, prefix } = ytdlpCommand();
  return hasCommand(command, [...prefix, '--version']);
}

function locateOnPath(command) {
  if (/[\\/]/.test(command)) {
    try {
      const target = resolve(command);
      const stat = statSync(target);
      return stat.isFile() ? { path: target, mtimeMs: stat.mtimeMs } : null;
    } catch {
      return null;
    }
  }
  const dirs = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const name = ext && !command.toLowerCase().endsWith(ext.toLowerCase()) ? command + ext : command;
      try {
        const target = join(dir, name);
        const stat = statSync(target);
        if (stat.isFile()) return { path: target, mtimeMs: stat.mtimeMs };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function toolCachePath() {
  return join(globalConfigDir(), 'tool-check-cache.json');
}

function readToolCache() {
  try {
    const value = JSON.parse(readFileSync(toolCachePath(), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeToolCache(next) {
  try {
    mkdirSync(globalConfigDir(), { recursive: true });
    writeFileSync(toolCachePath(), JSON.stringify(next, null, 2));
  } catch {
    return;
  }
}

function checkCached(name, command, run) {
  let located = null;
  try {
    located = locateOnPath(command);
  } catch {
    located = null;
  }
  if (!located) return run();
  const cache = readToolCache();
  const entry = cache[name];
  const checkedAt = entry ? Date.parse(entry.checkedAt || '') : NaN;
  const fresh = Boolean(entry) && entry.path === located.path && entry.mtimeMs === located.mtimeMs
    && Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < TOOL_CACHE_TTL_MS;
  if (fresh) return entry.ok === true;
  const ok = run();
  writeToolCache({ ...cache, [name]: { path: located.path, mtimeMs: located.mtimeMs, checkedAt: new Date().toISOString(), ok } });
  return ok;
}

async function readHookEvent() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 65536) break;
    }
  } catch {
    return {};
  }
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' && !Array.isArray(event) ? event : {};
  } catch {
    return {};
  }
}

/**
 * The one line that tells a person how to install FFmpeg on their own computer.
 * @returns {string}
 */
export function ffmpegHint() {
  if (process.platform === 'win32') {
    return 'Social Campaign: video and audio need FFmpeg. To add it, open Terminal and run: winget install Gyan.FFmpeg';
  }
  if (process.platform === 'darwin') {
    return 'Social Campaign: video and audio need FFmpeg. To add it, open Terminal and run: brew install ffmpeg';
  }
  return 'Social Campaign: video and audio need FFmpeg. To add it, install the ffmpeg package for your system.';
}

/**
 * Whether the workspace's integrations.json still holds a publishing key (a credential
 * reference or a plain text key) from an earlier version. Reads that one file only; no credential store is touched.
 * @param {string} root
 * @returns {boolean}
 */
export function hasLegacyPublishingKey(root) {
  const file = readJsonFile(integrationsPath(root), {});
  const record = file && typeof file === 'object' && file.providers && typeof file.providers === 'object' ? file.providers.publisher : null;
  return Boolean(record) && typeof record === 'object' && Boolean(record.credential_ref || record.api_key);
}

try {
  const hookEvent = await readHookEvent();

  if (!nodeIsNewEnough(process.version)) {
    say(
      'Social Campaign needs a newer version of Node.js (22.13 or later) on this computer. ' +
        'Download it from nodejs.org, install it, then start a new Claude session.',
    );
  }

  const resolution = resolveActiveWorkspace(process.cwd());
  const root = resolution.root;

  if (!root) {
    say('Social Campaign: this folder has no workspace yet. Type /social-campaign to set one up here.');
  } else if (!existsSync(root)) {
    say(
      `Social Campaign: the saved workspace folder is missing (${root}). Type /social-campaign to pick a new one.`,
    );
  } else if (!existsSync(databasePath(root))) {
    say(`Social Campaign: workspace found at ${root}, finishing setup on first use.`);
  } else {
    say(`Social Campaign: this folder resolves to the workspace at ${root}.`);
    for (const line of boardSessionLines(root, hookEvent.session_id)) say(line);
  }

  if (root && existsSync(root) && hasLegacyPublishingKey(root)) {
    say(
      'Social Campaign: an old publishing key from an earlier version is still stored on this computer. ' +
        'Run /social-campaign:doctor to remove it.',
    );
  }

  const needsFfmpeg = !checkCached('ffmpeg', 'ffmpeg', () => hasCommand('ffmpeg'))
    || !checkCached('ffprobe', 'ffprobe', () => hasCommand('ffprobe'));
  const needsYtDlp = !checkCached('ytdlp', process.env.SOCIAL_CAMPAIGN_YTDLP || 'yt-dlp', hasYtDlp);
  if (needsFfmpeg && needsYtDlp) {
    say(`${ffmpegHint()}. For TikTok posts and video addresses also run: ${ytdlpInstallCommand()}`);
  } else if (needsFfmpeg) {
    say(ffmpegHint());
  } else if (needsYtDlp) {
    say(ytdlpSessionHint());
  }
} catch {
  say('Social Campaign: ready.');
}

process.exit(0);
