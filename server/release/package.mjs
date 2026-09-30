/**
 * The ReleasePackage: one immutable record of exactly what will be published.
 *
 * A release fixes one deliverable per post - platform, caption, hashtags, first
 * comment, target account, schedule, and the exact asset with the sha256 of its bytes
 * at build time - and hashes that content into a digest. Final review is opened on a
 * release, an approval records that release's digest, and publishing reads the same
 * release back. Nothing downstream reassembles posts from "the latest artifact"
 * again, which is what let an approved subtitled export be replaced by the raw
 * original on the way to a provider.
 *
 * The digest covers content only, never the release id, version or timestamps, so two
 * builds of the same deliverable are the same release content and any edit to a
 * caption, an account, a schedule or an asset changes the digest.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { PLATFORMS } from '../publishing/adapter.mjs';
import { freezeIntent } from '../publishing/intent.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

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
 * The sha256 of a file's bytes, or null when the file is not there.
 * @param {string} absolutePath
 * @returns {string|null}
 */
export function hashFile(absolutePath) {
  if (!absolutePath || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) return null;
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

/**
 * The canonical content of a release, in the order the digest hashes it.
 * @param {Array<Record<string, any>>} posts
 * @returns {Array<Record<string, unknown>>}
 */
function canonicalPosts(posts) {
  return posts.map((post) => ({
    platform: post.platform,
    asset_id: post.asset_id ?? null,
    asset_sha256: post.asset_sha256 ?? null,
    caption: post.caption ?? '',
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    first_comment: post.first_comment ?? null,
    account_id: post.account_id ?? null,
    scheduled_at: post.scheduled_at ?? null,
  }));
}

/**
 * The digest of a release's content.
 * @param {Array<Record<string, any>>} posts
 * @returns {string}
 */
export function releaseDigest(posts) {
  return createHash('sha256').update(JSON.stringify(canonicalPosts(posts))).digest('hex');
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} assetId
 * @returns {{id: string, path: string, kind: string, duration: number|null}|null}
 */
function assetRow(db, assetId) {
  const row = db.prepare('SELECT id, path, kind, duration FROM assets WHERE id = ?').get(assetId);
  if (!row) return null;
  return {
    id: String(row.id),
    path: String(row.path),
    kind: String(row.kind),
    duration: row.duration == null ? null : Number(row.duration),
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} path
 * @returns {{id: string, path: string, kind: string, duration: number|null}|null}
 */
function assetRowByPath(db, path) {
  const row = db.prepare('SELECT id, path, kind, duration FROM assets WHERE path = ?').get(path);
  if (!row) return null;
  return {
    id: String(row.id),
    path: String(row.path),
    kind: String(row.kind),
    duration: row.duration == null ? null : Number(row.duration),
  };
}

/**
 * The latest artifact of a kind for a campaign, or null.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @param {string} kind
 * @returns {any|null}
 */
function latestArtifact(db, campaignId, kind) {
  return currentArtifact(db, campaignId, kind)?.json ?? null;
}

/**
 * The asset a platform should publish, preferring an exported file made for that
 * platform (edit_export registers those with a panel_id of `export:<preset>:<source>`)
 * over a raw generated original. This is the selection the person sees at final
 * review, so it is the selection the release freezes.
 * @param {any} mediaPackage a GeneratedMediaPackage, or null
 * @param {string} platform
 * @returns {any|null}
 */
function preferredAssetFor(mediaPackage, platform) {
  const assets = mediaPackage && Array.isArray(mediaPackage.assets) ? mediaPackage.assets : [];
  const usable = assets.filter((asset) => asset && (asset.review_state === 'approved' || !asset.review_state));
  const exported = usable.filter((asset) => String(asset.panel_id ?? '').startsWith('export:'));
  const forPlatform = exported.find((asset) => String(asset.panel_id ?? '').split(':')[1]?.startsWith(platform));
  if (forPlatform) return forPlatform;
  const subtitled = usable.find((asset) => String(asset.panel_id ?? '').startsWith('subtitled:'));
  if (subtitled) return subtitled;
  return usable.at(-1) ?? null;
}

/**
 * Resolve one requested post into a release post: find its asset, check the file is
 * really there, and hash its bytes.
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {string} args.root
 * @param {any} args.post
 * @param {number} args.index
 * @returns {Record<string, any>}
 */
function resolvePost({ db, root, post, index }) {
  const platform = String(post?.platform ?? '');
  if (!PLATFORMS.includes(platform)) {
    throw new InvalidInputError(`Post ${index + 1} names "${platform || 'no platform'}", which is not a platform this plugin posts to.`, {
      fix: `Use one of: ${PLATFORMS.join(', ')}.`,
    });
  }

  const media = post.media && typeof post.media === 'object' && !Array.isArray(post.media)
    ? post.media
    : Array.isArray(post.media)
      ? post.media[0] ?? null
      : null;
  const assetId = post.asset_id ?? media?.asset_id ?? media?.id ?? null;
  const givenPath = post.path ?? post.media_path ?? media?.path ?? null;

  /** @type {{id: string|null, path: string|null, kind: string|null, duration: number|null}} */
  let asset = { id: null, path: null, kind: null, duration: null };
  if (assetId) {
    const found = assetRow(db, String(assetId));
    if (!found && !givenPath) {
      throw new UserFacingError(`The ${platform} post points at a file this workspace does not know about.`, {
        fix: 'Export the finished file again, then build the release from that export.',
      });
    }
    asset = found ?? { id: String(assetId), path: String(givenPath), kind: null, duration: null };
  } else if (givenPath) {
    const found = assetRowByPath(db, String(givenPath));
    asset = found ?? { id: null, path: String(givenPath), kind: null, duration: null };
  }

  let sha256 = null;
  if (asset.path) {
    const absolute = resolveWorkspacePath(root, asset.path);
    sha256 = hashFile(absolute);
    if (!sha256) {
      throw new UserFacingError(`The file for the ${platform} post is not where this workspace expects it.`, {
        fix: 'Make the file again, or pick a different one, then build the release again.',
      });
    }
  }

  return {
    post_index: index,
    platform,
    asset_id: asset.id,
    asset_path: asset.path,
    asset_kind: asset.kind ?? media?.kind ?? null,
    asset_sha256: sha256,
    duration_s: media?.duration_s ?? asset.duration ?? null,
    subtitles_burned_in: media?.subtitles_burned_in ?? null,
    caption: typeof post.caption === 'string' ? post.caption : '',
    hashtags: Array.isArray(post.hashtags) ? post.hashtags.map(String) : [],
    first_comment: post.first_comment ?? null,
    account_id: post.account_id ?? null,
    scheduled_at: post.scheduled_at ?? post.schedule ?? null,
  };
}

/**
 * The posts to freeze when the caller did not name any: the approved copy's variants,
 * each paired with the exported file made for that platform.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {Array<Record<string, any>>}
 */
function postsFromCurrentState(db, campaignId) {
  const copyPackage = latestArtifact(db, campaignId, 'CopyPackage');
  if (!copyPackage) {
    throw new UserFacingError('This campaign has no copy to release yet.', {
      fix: 'Write the copy for this campaign first.',
    });
  }
  const mediaPackage = latestArtifact(db, campaignId, 'GeneratedMediaPackage');
  const variants = Array.isArray(copyPackage.variants) ? copyPackage.variants : [];
  return variants
    .filter((variant) => PLATFORMS.includes(String(variant.platform)))
    .map((variant) => {
      const asset = preferredAssetFor(mediaPackage, String(variant.platform));
      return {
        platform: String(variant.platform),
        caption: variant.caption ?? '',
        hashtags: Array.isArray(variant.hashtags) ? variant.hashtags : [],
        first_comment: variant.first_comment ?? null,
        media: asset ? { asset_id: asset.asset_id, path: asset.path, kind: asset.kind, duration_s: asset.duration_s ?? null } : null,
      };
    });
}

/**
 * Build a release for a campaign and store it. Any release still in draft is
 * superseded, so there is never more than one live draft to approve.
 *
 * @param {object} args
 * @param {import('node:sqlite').DatabaseSync} args.db
 * @param {string} args.root workspace root
 * @param {string} args.campaign_id
 * @param {Array<any>} [args.posts] the exact posts to freeze; built from the current
 *   approved copy and exported assets when left out.
 * @param {{provider?: string|null, mode?: 'publish'|'schedule'|null, timezone?: string|null, original_timezone?: string|null}} [args.intent]
 * @returns {{release_id: string, version: number, digest: string, status: string, posts: Array<Record<string, any>>, created_at: string, reused: boolean}}
 */
export function buildRelease({ db, root, campaign_id, posts, intent = null }) {
  if (!db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaign_id)) {
    throw new InvalidInputError('There is no job with that campaign id.');
  }
  const requested = Array.isArray(posts) && posts.length > 0 ? posts : postsFromCurrentState(db, campaign_id);
  if (requested.length === 0) {
    throw new UserFacingError('There is nothing in this campaign to release yet.', {
      fix: 'Write the copy and export the finished files first.',
    });
  }
  const resolved = requested.map((post, index) => resolvePost({ db, root, post, index }));
  const digest = releaseDigest(resolved);
  const frozenIntent = intent ? freezeIntent({ ...intent, posts: resolved }) : null;

  const live = currentRelease(db, campaign_id);
  if (live && live.digest === digest && live.status !== 'superseded' && (!intent || JSON.stringify(live.intent ?? null) === JSON.stringify(frozenIntent))) {
    return { ...live, reused: true };
  }

  db.prepare("UPDATE release_packages SET status = 'superseded' WHERE campaign_id = ? AND status = 'draft'").run(campaign_id);

  const version =
    Number(db.prepare('SELECT MAX(version) AS version FROM release_packages WHERE campaign_id = ?').get(campaign_id)?.version ?? 0) + 1;
  const releaseId = newId();
  const createdAt = nowIso();
  const json = { schema_version: 1, campaign_id, version, digest, posts: resolved, ...(frozenIntent ? { intent: frozenIntent } : {}) };
  db.prepare(
    'INSERT INTO release_packages (id, campaign_id, version, digest, json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(releaseId, campaign_id, version, digest, toJsonColumn(json), 'draft', createdAt);

  const insertPost = db.prepare(
    'INSERT INTO release_posts (id, release_id, post_index, platform, asset_id, asset_sha256, caption, hashtags, first_comment, account_id, scheduled_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const post of resolved) {
    insertPost.run(
      newId(),
      releaseId,
      post.post_index,
      post.platform,
      post.asset_id,
      post.asset_sha256,
      post.caption,
      toJsonColumn(post.hashtags),
      post.first_comment,
      post.account_id,
      post.scheduled_at,
    );
  }

  return { release_id: releaseId, version, digest, status: 'draft', posts: resolved, intent: frozenIntent, created_at: createdAt, reused: false };
}

/**
 * The release a campaign is currently working towards: the newest one that has not
 * been superseded.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {{release_id: string, version: number, digest: string, status: string, posts: Array<Record<string, any>>, created_at: string}|null}
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
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} releaseId
 * @returns {{release_id: string, version: number, digest: string, status: string, posts: Array<Record<string, any>>, created_at: string}|null}
 */
export function readRelease(db, releaseId) {
  const row = db.prepare('SELECT id, version, digest, json, status, created_at FROM release_packages WHERE id = ?').get(releaseId);
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

/**
 * Move a release to a new state. A superseded release never moves again.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} releaseId
 * @param {'draft'|'approved'|'superseded'|'published'|'exported'} status
 */
export function setReleaseStatus(db, releaseId, status) {
  db.prepare("UPDATE release_packages SET status = ? WHERE id = ? AND status != 'superseded'").run(status, releaseId);
}
