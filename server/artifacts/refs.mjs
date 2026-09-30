/**
 * Helpers for reading the current version of a campaign artifact.
 *
 * Artifact history is deliberately retained for audit and recovery.  A row with
 * invalidated_at set is historical evidence only and cannot satisfy a workflow
 * input or output check.
 */

import { parseJson } from '../lib/json.mjs';

/**
 * @typedef {{id: string, campaign_id: string, kind: string, version: number, path: string|null, json: any, created_at: string, invalidated_at: string|null, invalidation_reason: string|null}} ArtifactRecord
 */

/**
 * Read the newest artifact of a kind when that newest row is still current.
 *
 * Once a newer row exists, an older row is history even if the newer row was
 * invalidated.  Returning the older row here would let a replacement silently
 * roll a workflow back to obsolete content.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {ArtifactRecord|null}
 */
export function currentArtifact(db, campaignId, kind) {
  const row = db
    .prepare(
      'SELECT id, campaign_id, kind, version, path, json, created_at, invalidated_at, invalidation_reason ' +
        'FROM artifacts WHERE campaign_id = ? AND kind = ? ORDER BY version DESC LIMIT 1',
    )
    .get(campaignId, kind);
  return row && row.invalidated_at == null ? toArtifact(row) : null;
}

/**
 * Read an artifact by its durable identity and version.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} artifactId
 * @param {number} version
 * @returns {ArtifactRecord|null}
 */
export function artifactByRef(db, artifactId, version) {
  const row = db
    .prepare(
      'SELECT id, campaign_id, kind, version, path, json, created_at, invalidated_at, invalidation_reason ' +
        'FROM artifacts WHERE id = ? AND version = ?',
    )
    .get(artifactId, Number(version));
  return row ? toArtifact(row) : null;
}

/**
 * Whether a durable artifact reference still names the current version.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{id?: string, artifact_id?: string, kind?: string, version?: number}} ref
 * @returns {boolean}
 */
export function artifactRefIsCurrent(db, ref) {
  const id = String(ref?.id ?? ref?.artifact_id ?? '');
  const version = Number(ref?.version);
  if (!id || !Number.isInteger(version) || version < 1) return false;
  const row = db
    .prepare('SELECT id, campaign_id, kind, version, invalidated_at FROM artifacts WHERE id = ? AND version = ?')
    .get(id, version);
  if (!row || row.invalidated_at != null) return false;
  if (ref?.kind && String(ref.kind) !== String(row.kind)) return false;
  const newest = db
    .prepare('SELECT id, version, invalidated_at FROM artifacts WHERE campaign_id = ? AND kind = ? ORDER BY version DESC LIMIT 1')
    .get(String(row.campaign_id), String(row.kind));
  return Boolean(newest && newest.invalidated_at == null && String(newest.id) === String(row.id) && Number(newest.version) === Number(row.version));
}

/**
 * Read a JSON artifact row into the shape used by workflow and approval checks.
 * @param {any} row
 * @returns {ArtifactRecord}
 */
function toArtifact(row) {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    kind: String(row.kind),
    version: Number(row.version),
    path: row.path == null ? null : String(row.path),
    json: parseJson(String(row.json ?? 'null'), null),
    created_at: String(row.created_at),
    invalidated_at: row.invalidated_at == null ? null : String(row.invalidated_at),
    invalidation_reason: row.invalidation_reason == null ? null : String(row.invalidation_reason),
  };
}
