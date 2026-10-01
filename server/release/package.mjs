/**
 * Read access to the ReleasePackage rows the legacy campaign workflow still checks.
 *
 * A release was one immutable record of what would be published, built by the removed
 * direct-API publishing tools. Nothing builds releases any more; the legacy final
 * approval and stage gates in server/review/approvals.mjs and server/workflow/stage.mjs
 * only read a release that an earlier version of the plugin already stored in the
 * workspace database. Publishing is rebuilt on the Metricool connector
 * (docs/PLAN-0.8-METRICOOL.md) and does not use this module.
 */

import { isAbsolute, join } from 'node:path';

import { parseJson } from '../lib/json.mjs';

/** Release states that still describe a live release, newest wins among them. */
const LIVE_STATUSES = ['draft', 'approved', 'published', 'exported'];

/**
 * @param {string} root workspace root
 * @param {string} path absolute, or relative to the workspace
 * @returns {string}
 */
export function resolveWorkspacePath(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

/**
 * The release a campaign is currently working towards: the newest one that has not
 * been superseded.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {{release_id: string, version: number, digest: string, status: string, posts: Array<Record<string, any>>, intent: Record<string, any>|null, created_at: string}|null}
 */
export function currentRelease(db, campaignId) {
  const row = db
    .prepare(
      `SELECT id, version, digest, json, status, created_at FROM release_packages WHERE campaign_id = ? AND status IN (${LIVE_STATUSES.map(() => '?').join(', ')}) ` +
        'ORDER BY version DESC LIMIT 1',
    )
    .get(campaignId, ...LIVE_STATUSES);
  return row ? rowToRelease(row) : null;
}

/**
 * @param {any} row
 */
function rowToRelease(row) {
  const json = parseJson(String(row.json ?? '{}'), {});
  return {
    release_id: String(row.id),
    version: Number(row.version),
    digest: String(row.digest),
    status: String(row.status),
    posts: Array.isArray(json.posts) ? json.posts : [],
    intent: json.intent && typeof json.intent === 'object' ? json.intent : null,
    created_at: String(row.created_at),
  };
}
