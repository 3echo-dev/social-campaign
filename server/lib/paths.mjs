/**
 * Path layout.
 *
 * One place decides where every Social Campaign file lives, so no other module has to
 * join path segments by hand. Windows is the primary target, so everything goes
 * through node:path and os.homedir and nothing is ever interpolated into a shell.
 */

import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, normalize, parse, sep } from 'node:path';

/** Name of the hidden folder Social Campaign keeps inside a workspace. */
export const WORKSPACE_DIR_NAME = '.social-campaign';

/** Folders created inside a workspace at initialize time, from spec section 25. */
export const WORKSPACE_TREE = [
  '.social-campaign',
  '.social-campaign/logs',
  '.social-campaign/backups',
  'brands',
  'campaigns',
  'imports',
  'generated',
  'memory',
  'outputs',
];

/**
 * The per machine pointer file. It holds only the workspace location and a version,
 * so a machine can be repointed at a different workspace without touching the data.
 * @returns {string}
 */
export function globalConfigPath() {
  return join(globalConfigDir(), 'config.json');
}

/**
 * @returns {string}
 */
export function globalConfigDir() {
  const override = process.env.SOCIAL_CAMPAIGN_HOME;
  if (override && override.trim().length > 0) {
    const trimmed = override.trim();
    // `resolve()` silently joins a relative-looking value onto process.cwd(), which is
    // how a stray junk folder can end up inside this repo when a caller's env var
    // ever arrives malformed (e.g. a drive letter stripped by upstream quoting). Since
    // this override always names an absolute location in every real caller, refuse to
    // guess rather than create files relative to wherever this process happens to run.
    if (!isAbsolute(trimmed)) {
      throw new Error(
        `SOCIAL_CAMPAIGN_HOME must be an absolute path, got "${trimmed}". Refusing to resolve it relative to the current directory.`,
      );
    }
    return resolve(trimmed);
  }
  return join(homedir(), WORKSPACE_DIR_NAME);
}

/**
 * The default workspace suggested to a user who has no opinion.
 * @returns {string}
 */
export function defaultWorkspaceRoot() {
  return join(homedir(), 'Social Campaign Workspace');
}

/**
 * @param {string} root
 * @returns {string} the hidden Social Campaign folder inside the workspace.
 */
export function workspaceDir(root) {
  return join(root, WORKSPACE_DIR_NAME);
}

/** @param {string} root @returns {string} */
export function workspaceConfigPath(root) {
  return join(workspaceDir(root), 'config.json');
}

/** @param {string} root @returns {string} */
export function databasePath(root) {
  return join(workspaceDir(root), 'creative.db');
}

/** @param {string} root @returns {string} */
export function schemaDumpPath(root) {
  return join(workspaceDir(root), 'schema.json');
}

/** @param {string} root @returns {string} */
export function integrationsPath(root) {
  return join(workspaceDir(root), 'integrations.json');
}

/** @param {string} root @returns {string} */
export function logsDir(root) {
  return join(workspaceDir(root), 'logs');
}

/** @param {string} root @returns {string} */
export function backupsDir(root) {
  return join(workspaceDir(root), 'backups');
}

/** @param {string} root @returns {string} */
export function serverLogPath(root) {
  return join(logsDir(root), 'server.log');
}

/** @param {string} root @returns {string} */
export function bootLogPath(root) {
  return join(logsDir(root), 'boot.log');
}

/** @param {string} root @returns {string} */
export function toolFailuresLogPath(root) {
  return join(logsDir(root), 'tool-failures.log');
}

/**
 * Expand the shell style shorthands a user may type into a folder field.
 * Handles a leading tilde and the Windows %USERPROFILE% form. Returns an absolute
 * normalized path.
 * @param {string} input
 * @returns {string}
 */
export function expandUserPath(input) {
  let value = String(input ?? '').trim();
  if (value.length === 0) return '';
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/%USERPROFILE%/gi, homedir());
  value = value.replace(/\$HOME\b/g, homedir());
  if (value === '~') value = homedir();
  else if (value.startsWith('~/') || value.startsWith('~\\')) {
    value = join(homedir(), value.slice(2));
  }
  if (value.length === 0) return '';
  return normalize(isAbsolute(value) ? value : resolve(value));
}

/**
 * Whether a candidate path stays inside a root folder.
 * @param {string} rootDir
 * @param {string} candidate
 * @returns {boolean}
 */
export function isInside(rootDir, candidate) {
  const base = resolve(rootDir);
  const target = resolve(candidate);
  if (target === base) return true;
  return target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * Whether a path is a drive root ("C:\\", "C:/") or the filesystem root ("/"),
 * rather than a real folder someone would actually mean to point at.
 * @param {string} candidate
 * @returns {boolean}
 */
export function isDriveOrFilesystemRoot(candidate) {
  const target = resolve(String(candidate ?? ''));
  return target === parse(target).root;
}

/**
 * A source folder is too broad to safely index or ingest when it is the user's home
 * directory, a drive root or the filesystem root, or the workspace root itself. Any
 * caller that accepts a folder path from a person or a tool argument should refuse
 * these, regardless of how the value arrived, since indexing one of them means
 * silently reading everything on the machine.
 * @param {string} candidate
 * @param {string} [workspaceRoot]
 * @returns {boolean}
 */
export function isTooBroadSourceFolder(candidate, workspaceRoot) {
  const target = resolve(String(candidate ?? ''));
  if (target.length === 0) return false;
  const canonical = (value) => {
    let resolved = resolve(value);
    try { resolved = realpathSync.native(resolved); } catch { /* caller validates existence */ }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (canonical(target) === canonical(homedir())) return true;
  if (isDriveOrFilesystemRoot(target)) return true;
  if (workspaceRoot && canonical(target) === canonical(workspaceRoot)) return true;
  return false;
}
