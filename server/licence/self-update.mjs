/**
 * Self-update for agentC installs.
 *
 * Claude Code's own marketplace auto-update runs on a schedule we do not control, so
 * after each successful licence refresh (startup and every 4 hours) we read the agentC
 * catalog and, when it lists a newer version than the one running, run
 * `claude plugin marketplace update` then `claude plugin update` in the background.
 * The 0.17.49 launcher then swaps the running server onto the new install.
 *
 * Never throws and never writes to stdout (stdout belongs to the MCP protocol).
 * THREEECHO_SELF_UPDATE=0 turns it off.
 */

import { spawn } from 'node:child_process';

import { compareVersions } from '../../scripts/lib/plugin-versions.mjs';
import { MARKETPLACE_SEGMENT, PLUGIN_NAME } from './licence.mjs';

/** The catalog sits next to the licence route: <origin>/api/plugins/marketplace.json */
export function marketplaceUrlFor(licenceUrl) {
  try {
    return new URL('/api/plugins/marketplace.json', licenceUrl).href;
  } catch {
    return null;
  }
}

/** Run commands one after another, detached from our stdio; resolves true when all exit 0. */
function runInOrder(commands, spawnImpl) {
  return commands.reduce(
    (previous, args) =>
      previous.then(ok => {
        if (!ok) return false;
        return new Promise(resolve => {
          try {
            const child = spawnImpl('claude', args, {
              stdio: 'ignore',
              windowsHide: true,
              shell: process.platform === 'win32',
            });
            child.on('error', () => resolve(false));
            child.on('exit', code => resolve(code === 0));
          } catch {
            resolve(false);
          }
        });
      }),
    Promise.resolve(true),
  );
}

/**
 * @param {object} options
 * @param {string} options.currentVersion the running plugin's version
 * @param {string} options.licenceUrl
 * @param {() => string|null} options.readKey
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.timeoutMs]
 */
export function createSelfUpdate(options) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const url = marketplaceUrlFor(options.licenceUrl);
  /** @type {string|null} the newest version this process already tried to install */
  let attempted = null;
  /** @type {Promise<string>|null} */
  let running = null;

  /** @returns {Promise<'off'|'current'|'started'|'already-tried'|'failed'|'updated'>} */
  async function check() {
    if (env.THREEECHO_SELF_UPDATE === '0' || !url) return 'off';
    if (running) return running;
    running = (async () => {
      try {
        const key = options.readKey();
        if (!key) return 'off';
        const res = await fetchImpl(url, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
        });
        if (!res.ok) return 'failed';
        const body = await res.json();
        const entry = Array.isArray(body?.plugins) ? body.plugins.find(p => p?.name === PLUGIN_NAME) : null;
        const latest = entry?.version;
        if (!latest || compareVersions(latest, options.currentVersion) <= 0) return 'current';
        if (attempted === latest) return 'already-tried';
        attempted = latest;
        const ok = await runInOrder(
          [
            ['plugin', 'marketplace', 'update', MARKETPLACE_SEGMENT],
            ['plugin', 'update', `${PLUGIN_NAME}@${MARKETPLACE_SEGMENT}`, '--scope', 'user'],
          ],
          spawnImpl,
        );
        return ok ? 'updated' : 'failed';
      } catch {
        return 'failed';
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { check, url };
}
