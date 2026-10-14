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
export const FETCH_TIMEOUT_MS = 8000;

export const ENDED_MESSAGE =
  "Your 3echo workspace access for this plugin has ended, or this computer isn't connected yet. Ask your 3echo contact for a new connect message.";

export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3yPzXERypx9mRm8d279CXiCT+/3RxiTbyT8jz3KHJmE=
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
  async function refreshPass() {
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
    return currentPass() ? null : ENDED_MESSAGE;
  }

  return { refreshPass, currentPass, start, check, keyFile, cacheFile };
}

/**
 * Build the gate used by the server: null when not enforcing (no behaviour change),
 * otherwise an object whose check() returns the ended message when there is no valid pass.
 * @param {{env?: NodeJS.ProcessEnv, serverPath?: string}} [options]
 */
export function createGate(options = {}) {
  if (!shouldEnforce(options)) return null;
  const licence = createLicence();
  licence.start();
  return licence;
}
