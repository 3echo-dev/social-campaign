/**
 * agentC licence check.
 *
 * Only enforced when the plugin was installed from the agentC marketplace
 * (`agentc-3echo`), or when THREEECHO_LICENCE_ENFORCE=1. Every other install
 * (GitHub marketplace, local dev) behaves exactly as before.
 *
 * A pass is base64url(JSON payload) + "." + base64url(ed25519 signature of the
 * payload string), issued by agentC at POST <origin>/api/plugins/licence with
 * `Authorization: Bearer <plugin key>`. It is cached on disk so the plugin keeps
 * working offline until the pass expires. A 401/403 deletes the cached pass.
 *
 * stdout belongs to the MCP protocol, so nothing here prints.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_NAME = 'social-campaign';
export const MARKETPLACE_SEGMENT = 'agentc-3echo';
export const DEFAULT_LICENCE_URL = 'https://agentc.3echo.ai/api/plugins/licence';
export const REFRESH_MS = 4 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 20000;
export const RETRY_MS = 30 * 1000;

const SUPPORT = 'Please contact the 3echo team at sales@3echo.ai if you need help.';
// Said to Claude with every refusal, so it tells the person once instead of retrying tools or republishing the board.
const NO_RETRY =
  'Social Campaign tools and board updates will keep failing until this is resolved. Tell the person this once, in plain words, and do not retry Social Campaign tools or republish the board in this session. Their jobs and board are saved on this computer.';

/** agentC refused the key: the admin revoked it, turned the plugin off for the workspace, or removed the member. */
export const REVOKED_MESSAGE = `Social Campaign access has been turned off for your 3echo workspace. To restore it, please contact your workspace admin or the 3echo team at sales@3echo.ai. ${NO_RETRY}`;

/** No plugin key on this computer. */
export const NOT_CONNECTED_MESSAGE = `This computer is not connected to a 3echo workspace yet. Sign in at https://agentc.3echo.ai and choose "Connect to Claude Code", then restart Claude Code. ${SUPPORT} ${NO_RETRY}`;

/** agentC could not be reached, or its answer could not be verified, and there is no valid pass on this computer. */
export const UNVERIFIED_MESSAGE = `Social Campaign could not confirm your 3echo workspace access right now. Please check your internet connection, restart Claude Code and try again. If this continues, contact the 3echo team at sales@3echo.ai. ${NO_RETRY}`;

/** Kept for callers that only need one text. */
export const ENDED_MESSAGE = REVOKED_MESSAGE;

/** @param {string} status the last refresh outcome */
export function refusalMessage(status) {
  if (status === 'revoked') return REVOKED_MESSAGE;
  if (status === 'no-key') return NOT_CONNECTED_MESSAGE;
  return UNVERIFIED_MESSAGE;
}

export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkt8H2ZnzxUhUOePLPETNGNqS/io1+PPoP88SCjJSicc=
-----END PUBLIC KEY-----
`;

/** @returns {string} the 3echo home folder: THREEECHO_HOME or <homedir>/.3echo */
export function threeechoHome(env = process.env) {
  return env.THREEECHO_HOME || path.join(os.homedir(), '.3echo');
}

/**
 * True when the plugin root has a path segment equal to `agentc-3echo`
 * (.../plugins/cache/agentc-3echo/social-campaign/<version>/), or when
 * THREEECHO_LICENCE_ENFORCE=1. Handles / and \ separators.
 * @param {{env?: NodeJS.ProcessEnv, serverPath?: string}} [options]
 */
export function shouldEnforce(options = {}) {
  const env = options.env ?? process.env;
  if (env.THREEECHO_LICENCE_ENFORCE === '1') return true;
  const serverPath = options.serverPath ?? fileURLToPath(import.meta.url);
  for (const candidate of [env.CLAUDE_PLUGIN_ROOT, serverPath]) {
    if (typeof candidate !== 'string' || !candidate) continue;
    if (candidate.split(/[\\/]+/).includes(MARKETPLACE_SEGMENT)) return true;
  }
  return false;
}

/**
 * Verify signature, expiry and plugin name. Returns the payload or null.
 * @param {unknown} pass
 * @param {string} plugin
 * @param {crypto.KeyObject} publicKey
 * @param {number} [now]
 */
export function verifyPass(pass, plugin, publicKey, now = Date.now()) {
  try {
    if (typeof pass !== 'string') return null;
    const parts = pass.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, sig] = parts;
    if (!crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(sig, 'base64url'))) return null;
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body || typeof body !== 'object') return null;
    if (!(body.exp > now) || !Array.isArray(body.plugins) || !body.plugins.includes(plugin)) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {string|crypto.KeyObject} [options.publicKey] PEM or KeyObject; defaults to the embedded agentC key
 * @param {string} [options.home]
 * @param {string} [options.url]
 * @param {string} [options.plugin]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 */
export function createLicence(options = {}) {
  const env = process.env;
  const home = options.home ?? threeechoHome(env);
  const url = options.url ?? (env.THREEECHO_LICENCE_URL || DEFAULT_LICENCE_URL);
  const plugin = options.plugin ?? PLUGIN_NAME;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const publicKey =
    options.publicKey && typeof options.publicKey === 'object'
      ? options.publicKey
      : crypto.createPublicKey(options.publicKey ?? PUBLIC_KEY_PEM);

  const keyFile = path.join(home, 'plugin-key');
  const cacheFile = path.join(home, `pass-${plugin}.txt`);

  function readKey() {
    try {
      return fs.readFileSync(keyFile, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  /** The cached pass payload if it is still valid, else null. */
  function currentPass() {
    try {
      return verifyPass(fs.readFileSync(cacheFile, 'utf8'), plugin, publicKey, now());
    } catch {
      return null;
    }
  }

  /**
   * Ask agentC for a fresh pass. Never throws.
   * 401/403 clears the cache (access ends now); network failure or 5xx keeps it.
   * @returns {Promise<{status: 'ok'|'no-key'|'revoked'|'offline'|'bad-pass'}>}
   */
  let lastAttempt = 0;
  let lastStatus = 'offline';

  async function refreshPass() {
    lastAttempt = now();
    const result = await attemptRefresh();
    lastStatus = result.status;
    return result;
  }

  async function attemptRefresh() {
    try {
      const key = readKey();
      if (!key) return { status: 'no-key' };
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { status: 'offline' };
      }
      if (res.status === 401 || res.status === 403) {
        fs.rmSync(cacheFile, { force: true });
        return { status: 'revoked' };
      }
      if (!res.ok) return { status: 'offline' };
      let pass;
      try {
        ({ pass } = await res.json());
      } catch {
        return { status: 'offline' };
      }
      if (!verifyPass(pass, plugin, publicKey, now())) return { status: 'bad-pass' };
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(cacheFile, pass);
      if (options.onRefreshed) Promise.resolve().then(options.onRefreshed).catch(() => {});
      return { status: 'ok' };
    } catch {
      return { status: 'offline' };
    }
  }

  /** @type {Promise<unknown>|null} the startup refresh while it is still running */
  let startup = null;

  /**
   * Refresh now (fire and forget, never blocks) and every 4 hours on an unref'd timer.
   * @returns {() => void} stop function
   */
  function start() {
    startup = refreshPass().finally(() => {
      startup = null;
    });
    const timer = setInterval(() => void refreshPass(), options.refreshMs ?? REFRESH_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** @returns {Promise<string|null>} the error text when there is no valid pass, else null */
  async function check() {
    if (currentPass()) return null;
    // First run: the startup refresh may still be in flight (bounded by the network timeout).
    if (startup) await startup;
    if (currentPass()) return null;
    // No pass yet (the startup fetch failed, or access was just granted): ask again, at most every RETRY_MS.
    if (now() - lastAttempt >= (options.retryMs ?? RETRY_MS)) await refreshPass();
    return currentPass() ? null : refusalMessage(lastStatus);
  }

  return { refreshPass, currentPass, start, check, keyFile, cacheFile, readKey, url };
}

/**
 * Build the gate used by the server: null when not enforcing (no behaviour change),
 * otherwise an object whose check() returns the ended message when there is no valid pass.
 * @param {{env?: NodeJS.ProcessEnv, serverPath?: string, onRefreshed?: () => unknown}} [options]
 */
export function createGate(options = {}) {
  if (!shouldEnforce(options)) return null;
  const licence = createLicence({ onRefreshed: options.onRefreshed });
  licence.start();
  return licence;
}

/**
 * For hooks: true when this is an agentC install with no valid pass on this computer, so board
 * reminders would only make Claude retry tools that are refused. Reads the cached pass only, no network.
 * @param {{env?: NodeJS.ProcessEnv, home?: string}} [options]
 */
export function accessBlocked(options = {}) {
  try {
    const env = options.env ?? process.env;
    if (!shouldEnforce({ env })) return false;
    return !createLicence({ home: options.home ?? threeechoHome(env) }).currentPass();
  } catch {
    return false;
  }
}
