/**
 * Removal of publishing keys stored by earlier versions of this plugin.
 *
 * Versions before 0.7.6 let a person connect Blotato, Postiz or Buffer and kept the
 * API key outside the workspace: a Windows DPAPI file, a macOS Keychain item or a
 * Linux secret-service entry, each described by ~/.social-campaign/credentials/sc-*.json
 * and referenced from providers.publisher.credential_ref in the workspace's
 * integrations.json. Publishing no longer uses those keys, so this module can only
 * delete them. There is deliberately no write path and no way to read a key back.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { globalConfigDir } from './paths.mjs';
import { parseJson } from './json.mjs';

const SERVICE = 'social-campaign';
const REF = /^sc-[a-f0-9-]{36}$/;

/** @returns {string} */
export function legacyCredentialsDir() {
  return join(globalConfigDir(), 'credentials');
}

/**
 * The native store a record on this computer would live in, or null where the
 * record is a plain file (DPAPI and the test fixture hold the secret inside it).
 * @returns {'keychain'|'secret-service'|null}
 */
function nativeBackend() {
  if (process.platform === 'darwin') return 'keychain';
  if (process.platform === 'win32') return null;
  return 'secret-service';
}

/** `security delete-generic-password` exits with this when the item is already gone. */
const KEYCHAIN_ITEM_NOT_FOUND = 44;

/**
 * Run a native credential command and return its exit status. A command that could
 * not start at all throws. Child output is never read, because it can hold a secret.
 * @param {string} command
 * @param {string[]} args
 * @returns {number|null}
 */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error) throw new Error('The operating system credential store is unavailable. Unlock it and try again.');
  return result.status;
}

/**
 * @typedef {object} PurgeOptions
 * @property {(command: string, args: string[]) => number|null} [run] returns the exit status; injected by tests
 * @property {'keychain'|'secret-service'|null} [backend] the native store of this computer; injected by tests
 */

/**
 * Clear one native store entry. A missing macOS Keychain item counts as cleared.
 * @param {string} command
 * @param {string[]} args
 * @param {PurgeOptions} options
 */
function clearNative(command, args, options) {
  const status = (options.run ?? run)(command, args);
  if (status === 0 || (command === 'security' && status === KEYCHAIN_ITEM_NOT_FOUND)) return;
  throw new Error('The operating system credential store is unavailable. Unlock it and try again.');
}

/**
 * Every stored credential record's reference on this computer.
 * @returns {string[]}
 */
export function listLegacyCredentials() {
  try {
    return readdirSync(legacyCredentialsDir())
      .filter((name) => name.endsWith('.json') && REF.test(name.slice(0, -5)))
      .map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}

/**
 * Delete one stored credential: the native store entry where there is one, then the
 * record file. The file is kept when the native delete fails, so a retry still finds it.
 * Throws when the record cannot be read or cleared, so the caller counts it as failed.
 * @param {string} ref
 * @param {PurgeOptions} [options]
 * @returns {boolean} whether a record existed
 */
export function purgeLegacyCredential(ref, options = {}) {
  if (!REF.test(ref ?? '')) return false;
  const file = join(legacyCredentialsDir(), `${ref}.json`);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return false;
    throw new Error('A stored publishing key could not be read.');
  }
  const record = parseJson(text, null);
  if (!record || typeof record !== 'object') throw new Error('A stored publishing key could not be read.');
  // Only a record written by this kind of store can be cleared here; one copied from
  // another computer names a store this machine does not have.
  const native = 'backend' in options ? options.backend : nativeBackend();
  if (record.backend === 'keychain' && native === 'keychain') {
    clearNative('security', ['delete-generic-password', '-a', ref, '-s', SERVICE], options);
  } else if (record.backend === 'secret-service' && native === 'secret-service') {
    clearNative('secret-tool', ['clear', 'service', SERVICE, 'reference', ref], options);
  }
  rmSync(file, { force: true });
  return true;
}

/**
 * Delete every leftover credential record, whatever workspace it belonged to.
 * One that cannot be read or cleared is counted as failed, not thrown, so the rest still go.
 * @param {PurgeOptions} [options]
 * @returns {{removed: number, failed: number}}
 */
export function sweepLegacyCredentials(options = {}) {
  let removed = 0;
  let failed = 0;
  for (const ref of listLegacyCredentials()) {
    try {
      if (purgeLegacyCredential(ref, options)) removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}
