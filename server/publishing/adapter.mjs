/**
 * PublisherAdapter interface and the publisher config that lives inside
 * <workspace>/.social-campaign/integrations.json under the "publisher" key.
 *
 * Shape of that key, alongside the {state, detail, updated_at} block that
 * integration_mark_connected and server/capabilities/resolve.mjs already read:
 *
 *   {
 *     state: 'connected' | 'not_connected' | 'degraded' | 'unavailable',
 *     detail: string|null,
 *     updated_at: string,
 *     provider: 'blotato' | 'postiz' | 'buffer',
 *     credential_ref: string,
 *     base_url: string|null,
 *     account_ids: { facebook?: string, instagram?: string, tiktok?: string }
 *   }
 *
 * A `post` handed to schedule()/publish() looks like:
 *   {
 *     platform: 'facebook'|'instagram'|'tiktok',
 *     caption: string,
 *     hashtags: string[],
 *     media: [{path: string, kind: 'image'|'video'}],
 *     link?: string,
 *     first_comment?: string,
 *   }
 */

import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { deleteCredential, getCredential, putCredential } from '../lib/credentials.mjs';
import { integrationsPath } from '../lib/paths.mjs';
import { nowIso } from '../lib/ids.mjs';

/**
 * @typedef {object} PublisherPost
 * @property {'facebook'|'instagram'|'tiktok'} platform
 * @property {string} caption
 * @property {string[]} [hashtags]
 * @property {Array<{path: string, kind: 'image'|'video'}>} [media]
 * @property {string} [link]
 * @property {string} [first_comment]
 */

/**
 * @typedef {object} PublisherAdapter
 * @property {string} name provider key, e.g. "blotato".
 * @property {string[]} platforms platforms this adapter can post to.
 * @property {() => boolean} isConnected
 * @property {() => string} connectInstructions
 * @property {(args: {post: PublisherPost, when: string}) => Promise<{provider_ref: string|null, post_url: string|null}>} schedule
 * @property {(args: {post: PublisherPost}) => Promise<{provider_ref: string|null, post_url: string|null}>} publish
 * @property {(args: {external_id: string}) => Promise<{status: string, post_url: string|null}>} status
 */

/**
 * Read the full publisher config block from integrations.json, or null when no
 * workspace root is available or nothing has been written yet.
 * @param {string} root
 * @returns {any|null}
 */
export function readPublisherConfig(root) {
  if (!root) return null;
  const file = readJsonFile(integrationsPath(root), /** @type {{providers?: Record<string, any>}} */ ({}));
  const providers = file.providers && typeof file.providers === 'object' ? file.providers : {};
  const publisher = providers.publisher;
  if (!publisher || typeof publisher !== 'object') return null;
  // Existing workspaces migrate on their first server-side read. Persist the
  // protected value before removing plaintext, so a failed store loses no key.
  if (publisher.api_key) return writePublisherConfig(root, {});
  try {
    const api_key = getCredential(publisher.credential_ref);
    return { ...publisher, api_key, ...(publisher.credential_ref && !api_key ? { state: 'degraded', detail: 'Reconnect the publishing service on this computer.' } : {}) };
  } catch {
    return { ...publisher, state: 'degraded', api_key: null, detail: 'Unlock the credential store and reconnect the publishing service.' };
  }
}

/**
 * Write the publisher config block, merging with whatever is already there.
 * @param {string} root
 * @param {Record<string, unknown>} patch
 * @returns {any}
 */
export function writePublisherConfig(root, patch) {
  let createdRef = null;
  let previousRef = null;
  let next;
  try {
    updateJsonFile(integrationsPath(root), file => {
      const providers = file.providers && typeof file.providers === 'object' ? file.providers : {};
      const existing = providers.publisher && typeof providers.publisher === 'object' ? providers.publisher : {};
      next = { ...existing, ...patch, updated_at: nowIso() };
      previousRef = existing.credential_ref;
      if (next.api_key) next.credential_ref = createdRef = putCredential(String(next.api_key));
      else if (Object.hasOwn(patch, 'api_key')) delete next.credential_ref;
      delete next.api_key;
      return { ...file, providers: { ...providers, publisher: next } };
    }, {});
  } catch (error) {
    if (createdRef) deleteCredential(createdRef);
    throw error;
  }
  if (previousRef && previousRef !== next.credential_ref) deleteCredential(previousRef);
  return { ...next, api_key: getCredential(next.credential_ref) };
}

/** Every publishable platform in this plugin. */
export const PLATFORMS = ['facebook', 'instagram', 'tiktok'];

/**
 * Providers this plugin knows how to speak to, and their display labels.
 * @type {Record<string, string>}
 */
export const PROVIDER_LABELS = {
  blotato: 'Blotato',
  postiz: 'Postiz',
  buffer: 'Buffer',
};
