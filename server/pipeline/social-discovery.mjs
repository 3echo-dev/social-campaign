/**
 * Optional discovery routes for popular short videos: Instaloader (Instagram) and TikTok-Api (TikTok).
 *
 * Both are Python packages that live in the research helper's virtual environment. They run inside
 * python/social_discover.py, which this module spawns with an argument array and one JSON request on stdin.
 * They only LIST candidates (url, owner, views, likes, date, duration); downloading and teardown stay with yt-dlp
 * through pipeline_video_teardown and pipeline_reference_from_url.
 *
 * Every outcome is a route status, never a throw: ok / empty / blocked / login_required / not_installed / error.
 *
 * Credentials (optional, never required)
 * --------------------------------------
 * If `<global config dir>/research-helper/credentials.json` exists (default `~/.social-campaign/research-helper/`)
 * the worker reads it itself:
 *   { "instagram": { "username": "spare_account", "sessionfile": "instagram.session" },
 *     "tiktok":    { "ms_token": "..." } }
 * A relative `sessionfile` is resolved against that folder. This module only passes the file's PATH to the worker;
 * it never reads, logs or returns the contents, and nothing from it is written to a job folder, the board or the repo.
 * There is no login prompt at run time: a session file is loaded if present, otherwise the run is anonymous.
 *
 * TODO(setup step, undecided): the Director may later ask the person once for a spare-account login and write
 * that file (an Instaloader session file made outside the plugin, and a TikTok ms_token cookie). Nothing asks yet.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globalConfigDir } from '../lib/paths.mjs';
import { managedEnvironmentRoot, managedPythonPath, researchHelperChildEnv } from '../setup/research-helper-record.mjs';

export const DISCOVER_SCRIPT_PATH = fileURLToPath(new URL('../../python/social_discover.py', import.meta.url));
export const DISCOVER_TIMEOUT_MS = 75_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const STATUSES = new Set(['ok', 'empty', 'blocked', 'login_required', 'not_installed', 'error']);
export const DISCOVER_ROUTES = ['instagram_hashtag', 'instagram_profile', 'tiktok_hashtag', 'tiktok_trending', 'tiktok_user'];

export const DISCOVERY_INSTALL_HINT =
  'Install into the research helper environment: python -m pip install instaloader TikTokApi, then python -m playwright install chromium (or run the research helper setup again).';

/** Where the optional credentials file would be. Only the path is ever passed around. */
export function credentialsPath() {
  return join(globalConfigDir(), 'research-helper', 'credentials.json');
}

function helperPython() {
  try {
    const python = managedPythonPath(managedEnvironmentRoot());
    return existsSync(python) ? python : null;
  } catch {
    return null;
  }
}

/**
 * Run the worker once. Resolves to a plain result object whatever happens.
 * @param {{route: string, target?: string, limit?: number}} request
 * @param {{python?: string, script?: string, credentials?: string|null, timeoutMs?: number, runner?: Function}} [options]
 * @returns {Promise<{status: string, detail: string|null, authenticated: boolean, items: Array<Record<string, any>>}>}
 */
export async function runDiscovery(request, options = {}) {
  const fail = (status, detail) => ({ status, detail, authenticated: false, items: [] });
  try {
    if (!DISCOVER_ROUTES.includes(request.route)) return fail('error', 'Unknown discovery route.');
    const timeoutMs = options.timeoutMs ?? DISCOVER_TIMEOUT_MS;
    const credentialsFile = options.credentials !== undefined ? options.credentials : (existsSync(credentialsPath()) ? credentialsPath() : null);
    const payload = { route: request.route, target: request.target ?? '', limit: request.limit ?? 20, timeout_ms: Math.max(timeoutMs - 10_000, 5_000), ...(credentialsFile ? { credentials_path: credentialsFile } : {}) };
    if (options.runner) return normalize(await options.runner(payload));
    const python = options.python ?? helperPython();
    const script = options.script ?? DISCOVER_SCRIPT_PATH;
    if (!python) return fail('not_installed', `The research helper environment is not installed. ${DISCOVERY_INSTALL_HINT}`);
    if (!existsSync(script)) return fail('error', 'The discovery worker script is missing.');
    const env = researchHelperChildEnv(join(python, '..', '..')) ?? undefined;
    const out = await spawnWorker(python, [script], JSON.stringify(payload), timeoutMs, env);
    if (out.spawnFailed) return fail('not_installed', `The research helper Python could not start. ${DISCOVERY_INSTALL_HINT}`);
    if (out.timedOut) return fail('blocked', 'The discovery run timed out.');
    let parsed = null;
    try {
      parsed = JSON.parse(out.stdout);
    } catch {
      // not JSON
    }
    if (!parsed) return fail('error', 'The discovery worker returned nothing readable.');
    const result = normalize(parsed);
    if (result.status === 'not_installed') result.detail = `${result.detail ?? ''} ${DISCOVERY_INSTALL_HINT}`.trim();
    return result;
  } catch {
    return fail('error', 'The discovery route failed unexpectedly.');
  }
}

function normalize(value) {
  const status = STATUSES.has(value?.status) ? value.status : 'error';
  const items = Array.isArray(value?.items) ? value.items.filter((i) => i && typeof i.url === 'string') : [];
  // Only the documented fields are kept, so nothing else the worker printed can travel on.
  const kept = items.map((i) => ({ url: i.url, owner: i.owner ?? null, views: i.views ?? null, likes: i.likes ?? null, date: i.date ?? null, durationS: i.durationS ?? null, caption: i.caption ?? null }));
  return { status: status === 'ok' && !kept.length ? 'empty' : status, detail: typeof value?.detail === 'string' ? value.detail.slice(0, 300) : null, authenticated: Boolean(value?.authenticated), items: kept };
}

function spawnWorker(python, args, input, timeoutMs, env) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], ...(env ? { env } : {}) });
    } catch {
      resolve({ stdout: '', spawnFailed: true, timedOut: false });
      return;
    }
    let stdout = '';
    let bytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_OUTPUT_BYTES) stdout += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout: '', spawnFailed: error?.code === 'ENOENT', timedOut });
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, spawnFailed: false, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
