/**
 * Shared runtime contract for the optional browser research helper.
 *
 * The installer, capability checks, doctor and browser backend all read the
 * same versioned record. The record belongs to a workspace, while the managed
 * environment it points to belongs to the machine. Keeping those two facts in
 * one small contract prevents an installer result from being mistaken for a
 * usable reader.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { globalConfigDir, integrationsPath } from '../lib/paths.mjs';
import { nowIso } from '../lib/ids.mjs';

/** Current on disk shape of a research helper record. */
export const RESEARCH_HELPER_RECORD_VERSION = 1;

/** Stable key used inside the workspace provider map. */
export const RESEARCH_HELPER_KEY = 'research_helper';

/** The installation kind understood by the reader. */
export const RESEARCH_HELPER_ENVIRONMENT_KIND = 'venv';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * The plugin's own data folder, when Claude Code gave the server one.
 *
 * `.mcp.json` passes `${CLAUDE_PLUGIN_DATA}` as SOCIAL_CAMPAIGN_DATA_DIR. That
 * folder is the documented home for installed dependencies and is removed when
 * the plugin is uninstalled. A missing, relative or unsubstituted value (the
 * literal `${CLAUDE_PLUGIN_DATA}` an older host leaves in place) means there is
 * no such folder, and the caller falls back to the per machine folder.
 * @returns {string|null}
 */
export function pluginDataDir() {
  for (const name of ['SOCIAL_CAMPAIGN_DATA_DIR', 'CLAUDE_PLUGIN_DATA']) {
    const value = process.env[name]?.trim();
    if (!value || value.includes('${') || !isAbsolute(value)) continue;
    return resolve(value);
  }
  return null;
}

/**
 * Where releases up to 0.15.6 put the environment. Still used when an install is
 * already there, and when there is no plugin data folder.
 * @returns {string}
 */
export function legacyEnvironmentRoot() {
  return join(globalConfigDir(), 'research-helper', 'venv');
}

/**
 * The environment inside the plugin data folder, or null without one.
 * @returns {string|null}
 */
export function pluginDataEnvironmentRoot() {
  const data = pluginDataDir();
  return data ? join(data, 'research-helper', 'venv') : null;
}

/**
 * The machine managed environment is shared by workspaces, but enabled by an
 * explicit record in each workspace. This keeps provider data portable while
 * avoiding a user site or system Python install.
 *
 * An environment that already exists wins, so a person who installed the helper
 * with an earlier release keeps using it. A new install goes into the plugin data
 * folder when there is one, and into the per machine folder otherwise.
 * @returns {string}
 */
export function managedEnvironmentRoot() {
  const preferred = pluginDataEnvironmentRoot();
  const legacy = legacyEnvironmentRoot();
  if (preferred && existsSync(managedPythonPath(preferred))) return preferred;
  if (existsSync(managedPythonPath(legacy))) return legacy;
  return preferred ?? legacy;
}

/**
 * Where Playwright keeps its browser for an environment, or null to leave
 * Playwright's own default alone.
 *
 * Only an environment inside the plugin data folder gets a browsers folder beside
 * it. An environment in the old per machine location was installed with the
 * browser in Playwright's default cache, and pointing it anywhere else would make
 * a working install look broken.
 * @param {string|null|undefined} environmentRoot
 * @returns {string|null}
 */
export function managedBrowsersPath(environmentRoot) {
  const preferred = pluginDataEnvironmentRoot();
  if (!environmentRoot || !preferred || resolve(environmentRoot) !== preferred) return null;
  return join(dirname(preferred), 'browsers');
}

/**
 * The environment for a child process that runs the managed Python: the parent's
 * own, plus PLAYWRIGHT_BROWSERS_PATH when the environment has its own browsers
 * folder. Install, detection, smoke read and production reads all use this, so
 * they agree on where Chromium is.
 * @param {string|null|undefined} environmentRoot
 * @returns {NodeJS.ProcessEnv|undefined} undefined to inherit unchanged.
 */
export function researchHelperChildEnv(environmentRoot) {
  const browsers = managedBrowsersPath(environmentRoot);
  return browsers ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } : undefined;
}

/**
 * The Python executable inside a virtual environment.
 * @param {string} environmentRoot
 * @returns {string}
 */
export function managedPythonPath(environmentRoot) {
  return process.platform === 'win32' ? join(environmentRoot, 'Scripts', 'python.exe') : join(environmentRoot, 'bin', 'python');
}

/**
 * Return a non empty string from a possibly legacy record field.
 * @param {unknown} value
 * @returns {string|null}
 */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Normalize a worker fingerprint without accepting arbitrary text as proof of
 * the bytes that the installer smoke-tested.
 * @param {unknown} value
 * @returns {string|null}
 */
function sha256(value) {
  const candidate = text(value);
  return candidate && SHA256_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * Hash a worker only when the path names a regular file.
 *
 * `lstatSync` deliberately does not follow a symlink: the record describes the
 * shipped worker bytes, so a directory, dangling link or replaced path must
 * force the installer through its repair and smoke path.
 * @param {unknown} workerPath
 * @returns {string|null}
 */
export function researchHelperWorkerSha256(workerPath) {
  const path = text(workerPath);
  if (!path) return null;
  try {
    if (!lstatSync(path).isFile()) return null;
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Normalize the field names written by older releases without claiming that
 * the record has the current version. `python_path` is read only as a migration
 * aid; all new writes use `python`.
 * @param {unknown} raw
 * @returns {Record<string, any>|null}
 */
export function normalizeResearchHelperRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = /** @type {Record<string, any>} */ (raw);
  const runtime = source.runtime && typeof source.runtime === 'object' ? source.runtime : {};
  const environment = source.environment && typeof source.environment === 'object' ? source.environment : {};
  const worker = source.worker && typeof source.worker === 'object' ? source.worker : {};
  const versionRaw = source.record_version ?? source.schema_version;
  const recordVersion = Number.isInteger(Number(versionRaw)) ? Number(versionRaw) : null;
  const python = text(source.python) ?? text(source.python_path) ?? text(runtime.python);
  const environmentPath =
    text(source.environment_path) ?? text(source.venv_path) ?? text(environment.path) ?? text(runtime.environment_path);
  const workerPath = text(source.worker_path) ?? text(worker.path) ?? text(runtime.worker_path);
  const pythonArgsSource = source.python_args ?? runtime.python_args;
  const pythonArgs = Array.isArray(pythonArgsSource)
    ? pythonArgsSource.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];
  const workerSha256 =
    sha256(source.worker_sha256) ??
    sha256(worker.sha256) ??
    sha256(runtime.worker_sha256);
  return {
    ...source,
    record_version: recordVersion,
    python,
    python_args: pythonArgs,
    environment_path: environmentPath,
    worker_path: workerPath,
    worker_sha256: workerSha256,
    environment_kind: text(source.environment_kind) ?? text(environment.kind) ?? RESEARCH_HELPER_ENVIRONMENT_KIND,
  };
}

/**
 * Whether this record can be consumed by the current reader contract.
 * @param {unknown} raw
 * @param {{requireWorker?: boolean}} [options]
 * @returns {boolean}
 */
export function isCurrentResearchHelperRecord(raw, options = {}) {
  const record = normalizeResearchHelperRecord(raw);
  if (!record || record.record_version !== RESEARCH_HELPER_RECORD_VERSION || record.state !== 'connected') return false;
  if (!record.python || !record.environment_path || record.environment_kind !== RESEARCH_HELPER_ENVIRONMENT_KIND) return false;
  return options.requireWorker === false || Boolean(record.worker_path);
}

/**
 * Whether the versioned record points at the files the reader must execute.
 * Package compatibility is checked by the installer and detector; this helper
 * verifies the durable contract, including the regular worker bytes that the
 * installer successfully smoke-tested.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function hasUsableResearchHelperRecord(raw) {
  const record = normalizeResearchHelperRecord(raw);
  return Boolean(
    isCurrentResearchHelperRecord(record) &&
      existsSync(record.python) &&
      existsSync(record.environment_path) &&
      Boolean(record.worker_sha256) &&
      researchHelperWorkerSha256(record.worker_path) === record.worker_sha256,
  );
}

/**
 * Build a current record from a state patch. This function deliberately leaves
 * unrelated fields from the previous record intact when the caller passes it a
 * normalized base record.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [patch]
 * @returns {Record<string, any>}
 */
export function currentResearchHelperRecord(raw, patch = {}) {
  const base = normalizeResearchHelperRecord(raw) ?? {};
  const merged = { ...base, ...patch };
  const normalized = normalizeResearchHelperRecord(merged) ?? {};
  return {
    ...normalized,
    ...patch,
    record_version: RESEARCH_HELPER_RECORD_VERSION,
    environment_kind: normalized.environment_kind ?? RESEARCH_HELPER_ENVIRONMENT_KIND,
    python: text(patch.python) ?? normalized.python ?? null,
    python_args: Array.isArray(patch.python_args)
      ? patch.python_args.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : normalized.python_args ?? [],
    environment_path: text(patch.environment_path) ?? normalized.environment_path ?? null,
    worker_path: text(patch.worker_path) ?? normalized.worker_path ?? null,
    worker_sha256: Object.prototype.hasOwnProperty.call(patch, 'worker_sha256')
      ? sha256(patch.worker_sha256)
      : normalized.worker_sha256 ?? null,
    updated_at: nowIso(),
  };
}

/**
 * Read a helper record from an absolute workspace root.
 * @param {string|null|undefined} workspaceRoot
 * @returns {Record<string, any>|null}
 */
export function readResearchHelperRecord(workspaceRoot) {
  if (!workspaceRoot) return null;
  const file = readJsonFile(integrationsPath(workspaceRoot), /** @type {{providers?: Record<string, any>}} */ ({}));
  const providers = file.providers && typeof file.providers === 'object' ? file.providers : {};
  return normalizeResearchHelperRecord(providers[RESEARCH_HELPER_KEY]);
}

/**
 * Update a helper record under the same cross process lock used by other JSON
 * settings. The updater receives the normalized previous record, or null.
 * @param {string|null|undefined} workspaceRoot
 * @param {Record<string, unknown>|((previous: Record<string, any>|null) => Record<string, unknown>)} patchOrUpdater
 * @returns {Record<string, any>|null}
 */
export function updateResearchHelperRecord(workspaceRoot, patchOrUpdater) {
  if (!workspaceRoot) return null;
  const path = integrationsPath(workspaceRoot);
  const result = updateJsonFile(
    path,
    (raw) => {
      const file = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
      const providers = file.providers && typeof file.providers === 'object' ? { ...file.providers } : {};
      const previous = normalizeResearchHelperRecord(providers[RESEARCH_HELPER_KEY]);
      const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(previous) : patchOrUpdater;
      providers[RESEARCH_HELPER_KEY] = currentResearchHelperRecord(previous, patch ?? {});
      return { ...file, providers };
    },
    { providers: {} },
  );
  const providers = result.providers && typeof result.providers === 'object' ? result.providers : {};
  return normalizeResearchHelperRecord(providers[RESEARCH_HELPER_KEY]);
}
