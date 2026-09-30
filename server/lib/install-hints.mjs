/**
 * How to install or update the tools Social Campaign runs but does not ship, in one
 * line a person can paste into a terminal.
 *
 * Doctor and the session start line both use these, so the advice is the same
 * wherever the user meets it. Nothing here installs anything: the user's own
 * computer is theirs to change.
 */

import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** yt-dlp versions are dates, and an extractor older than this often stops working. */
export const YTDLP_STALE_DAYS = 90;

/**
 * @typedef {'pip'|'winget'|'brew'|'scoop'|'unknown'} InstallKind
 */

/**
 * Find a command on PATH the way a shell would, without running it.
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string|null} the absolute path, or null when it is not on PATH.
 */
export function findOnPath(command, env = process.env, platform = process.platform) {
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions =
    platform === 'win32' ? ['', ...String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)] : [''];
  for (const dir of String(pathValue).split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension.toLowerCase()}`);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // an unreadable folder on PATH is simply skipped
      }
    }
  }
  return null;
}

/**
 * How yt-dlp got onto this computer, read from where it lives, so the update line
 * uses the same tool that installed it.
 * @param {string|null} location the yt-dlp path, or null when it is not installed.
 * @param {NodeJS.Platform} [platform]
 * @returns {InstallKind}
 */
export function installKindOf(location, platform = process.platform) {
  if (!location) return 'unknown';
  const path = location.replace(/\\/g, '/').toLowerCase();
  if (path.includes('/winget/')) return 'winget';
  if (path.includes('/scoop/')) return 'scoop';
  if (path.includes('/homebrew/') || path.includes('/cellar/') || path.includes('/linuxbrew/')) return 'brew';
  if (/\/(python[^/]*|pipx|site-packages|scripts|\.local)\//.test(path) || path.includes('-venv/') || path.includes('/venv/')) {
    return 'pip';
  }
  if (platform === 'darwin' && path.startsWith('/usr/local/bin/')) return 'brew';
  return 'unknown';
}

/**
 * Where the yt-dlp Social Campaign would run lives, honouring SOCIAL_CAMPAIGN_YTDLP.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function ytdlpLocation(env = process.env) {
  const configured = env.SOCIAL_CAMPAIGN_YTDLP;
  if (configured && isAbsolute(configured)) return existsSync(configured) ? configured : null;
  return findOnPath(configured || 'yt-dlp', env);
}

/** The pip line that adds browser impersonation to yt-dlp. */
const PIP_IMPERSONATION = 'pip install -U "yt-dlp[default,curl-cffi]"';

/**
 * The command that installs yt-dlp from nothing, per operating system.
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function ytdlpInstallCommand(platform = process.platform) {
  if (platform === 'win32') return 'winget install yt-dlp.yt-dlp';
  if (platform === 'darwin') return 'brew install yt-dlp';
  return `python3 -m ${PIP_IMPERSONATION}`;
}

/**
 * The command that brings an installed yt-dlp up to date with browser impersonation,
 * using whatever installed it.
 * @param {InstallKind} kind
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function ytdlpUpdateCommand(kind, platform = process.platform) {
  if (kind === 'pip') return platform === 'win32' ? PIP_IMPERSONATION : `python3 -m ${PIP_IMPERSONATION}`;
  if (kind === 'winget') return 'winget upgrade yt-dlp.yt-dlp';
  if (kind === 'brew') return 'brew upgrade yt-dlp';
  if (kind === 'scoop') return 'scoop update yt-dlp';
  if (platform === 'win32') return `${PIP_IMPERSONATION} (if you installed it with pip), or winget upgrade yt-dlp.yt-dlp`;
  if (platform === 'darwin') return `brew upgrade yt-dlp (or python3 -m ${PIP_IMPERSONATION} if you installed it with pip)`;
  return `python3 -m ${PIP_IMPERSONATION}`;
}

/**
 * Where to type a command, in the words the operating system uses.
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
function terminal(platform = process.platform) {
  if (platform === 'win32') return 'Open the Start menu, type "Terminal", open it and run';
  if (platform === 'darwin') return 'Open the Terminal app and run';
  return 'Open a terminal and run';
}

/**
 * The fix line for a yt-dlp that is missing.
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function ytdlpMissingFix(platform = process.platform) {
  return `Reading TikTok posts and watching video addresses need yt-dlp. ${terminal(platform)}: ${ytdlpInstallCommand(platform)}. Then start a new Claude session.`;
}

/**
 * The fix line for a yt-dlp that runs but cannot imitate a browser, or is old.
 * @param {InstallKind} kind
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function ytdlpUpdateFix(kind, platform = process.platform) {
  return `TikTok often answers yt-dlp with a bot check unless it is up to date and can imitate a browser. ${terminal(platform)}: ${ytdlpUpdateCommand(kind, platform)}. Then start a new Claude session.`;
}

/**
 * The one session start line for a computer without yt-dlp.
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function ytdlpSessionHint(platform = process.platform) {
  return `Social Campaign: reading TikTok posts and watching video addresses need yt-dlp. To add it, open Terminal and run: ${ytdlpInstallCommand(platform)}`;
}

/**
 * How old a yt-dlp version is, from its date shaped number (2026.03.17).
 * @param {string|null} version
 * @param {number} [now]
 * @returns {number|null} whole days, or null when the version is not a date.
 */
export function ytdlpAgeDays(version, now = Date.now()) {
  const match = String(version ?? '').match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!match) return null;
  const released = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(released)) return null;
  return Math.max(0, Math.floor((now - released) / 86_400_000));
}
