/**
 * Social research storage: the read cache, the plans handed out, and the web
 * evidence Claude records against them. Tables are in migrations/007_social.sql.
 */

import { createHash } from 'node:crypto';

import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson } from '../lib/json.mjs';
import { adRecord, commentRecord, pageRecord, parseHttpUrl, platformFromUrl, postRecord, profileRecord, toCount } from './records.mjs';

/** How long each kind of read stays fresh. */
export const CACHE_TTL_MS = {
  profile: 6 * 3_600_000,
  post: 6 * 3_600_000,
  comments: 6 * 3_600_000,
  search: 3 * 3_600_000,
  ads: 12 * 3_600_000,
  crawl: 24 * 3_600_000,
};

/** A read that found nothing is retried sooner, so a platform that recovers is noticed. */
export const NONE_TTL_MS = 30 * 60_000;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{platform: string, kind: string, source_ref: string, now?: number}} key
 * @returns {Record<string, any>|null} the stored envelope, marked from_cache, or null.
 */
export function readCache(db, key) {
  const row = /** @type {any} */ (
    db.prepare('SELECT json, observed_at, expires_at FROM social_records WHERE platform = ? AND kind = ? AND source_ref = ?').get(key.platform, key.kind, key.source_ref)
  );
  if (!row) return null;
  const now = key.now ?? Date.now();
  if (Date.parse(row.expires_at) <= now) return null;
  const value = parseJson(row.json, null);
  if (!value) return null;
  return { ...value, from_cache: true, cached_until: row.expires_at };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{platform: string, kind: string, source_ref: string, envelope: Record<string, any>, now?: number, ttlMs?: number}} input
 */
export function writeCache(db, input) {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? (input.envelope.coverage === 'none' ? NONE_TTL_MS : CACHE_TTL_MS[input.kind] ?? 3_600_000);
  const verifiedAt = new Date(now).toISOString();
  const { from_cache: _fromCache, cached_until: _cachedUntil, ...stored } = input.envelope;
  db.prepare(
    `INSERT INTO social_records (id, platform, kind, source_ref, json, coverage, observed_at, last_verified_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (platform, kind, source_ref) DO UPDATE SET
       json = excluded.json, coverage = excluded.coverage, observed_at = excluded.observed_at,
       last_verified_at = excluded.last_verified_at, expires_at = excluded.expires_at`,
  ).run(
    newId(now),
    input.platform,
    input.kind,
    input.source_ref,
    JSON.stringify(stored),
    stored.coverage,
    stored.observed_at ?? verifiedAt,
    verifiedAt,
    new Date(now + ttl).toISOString(),
  );
}

/**
 * Remember a plan so evidence recorded against it can be traced back.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{plan: Record<string, any>, platform: string, operation: string, target: string}} input
 */
export function rememberPlan(db, input) {
  db.prepare(
    'INSERT OR IGNORE INTO web_evidence_requests (request_id, platform, operation, target, plan_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.plan.request_id, input.platform, input.operation, input.target, JSON.stringify(input.plan), nowIso());
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} requestId
 * @returns {{request_id: string, platform: string, operation: string, target: string, plan: Record<string, any>}|null}
 */
export function findPlan(db, requestId) {
  const row = /** @type {any} */ (db.prepare('SELECT * FROM web_evidence_requests WHERE request_id = ?').get(requestId));
  return row ? { request_id: row.request_id, platform: row.platform, operation: row.operation, target: row.target, plan: parseJson(row.plan_json, {}) } : null;
}

/** Fields an evidence item may carry. `claim` and `evidence` are the findings shape's aliases for `text` and `quote`. */
const ITEM_FIELDS = new Set([
  'kind',
  'url',
  'observed_at',
  'title',
  'text',
  'quote',
  'author_handle',
  'posted_at',
  'metrics',
  'notes',
  'confidence',
  'claim',
  'evidence',
]);

/** Metrics an evidence item may carry, per kind. */
const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'saves', 'followers', 'following', 'post_count', 'replies'];

/** Default confidence for web evidence, from the contract. */
export const WEB_EVIDENCE_CONFIDENCE = 0.6;

/**
 * Check and normalise one evidence item. Throws with the item's position on a problem.
 *
 * Two shapes are accepted for the same thing: a list of page items (`url`, `title`,
 * what it says as `text` or `quote`) and a list of findings (`claim`, `evidence`, `url`).
 * `kind` defaults to `page` when left out, which both shapes naturally do. The only
 * hard requirements are a source `url` and some text; everything else is normalised.
 * @param {Record<string, any>} item
 * @param {number} index
 * @param {string} platform
 * @param {number} now
 * @param {{webStandIn?: boolean}} [options] `webStandIn` is set when this evidence was
 *   gathered from the web on behalf of another platform's plan, which relaxes the
 *   platform/kind matching that only makes sense for a direct platform read.
 * @returns {{record: Record<string, any>, notes: string[]}}
 */
export function normaliseEvidenceItem(item, index, platform, now = Date.now(), options = {}) {
  const webStandIn = Boolean(options.webStandIn);
  const where = `Item ${index + 1}`;
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InvalidInputError(`${where} is not an object.`);
  const unknown = Object.keys(item).filter((key) => !ITEM_FIELDS.has(key));
  if (unknown.length > 0) throw new InvalidInputError(`${where} has fields research evidence does not keep: ${unknown.join(', ')}.`);
  const kind = item.kind ?? 'page';
  if (!['post', 'profile', 'comment', 'ad', 'page'].includes(kind)) {
    throw new InvalidInputError(`${where} needs a kind of post, profile, comment, ad or page.`);
  }
  const url = parseHttpUrl(item.url);
  if (!url) throw new InvalidInputError(`${where} has no source url.`);
  const social = ['tiktok', 'instagram', 'facebook'].includes(platform);
  if (!webStandIn && social && ['post', 'profile', 'comment'].includes(kind) && platformFromUrl(url.href) !== platform) {
    throw new InvalidInputError(`${where} is a ${platform} ${kind}, so its address must be on ${platform}; it is on ${url.hostname}.`, {
      fix: 'Record evidence found on another site as a page item, with a note saying what it says about the account.',
    });
  }
  if (!webStandIn && platform === 'meta' && !['ad', 'page'].includes(kind)) {
    throw new InvalidInputError(`${where}: Meta Ad Library evidence is recorded as ad or page items.`);
  }

  let observedAt = new Date(now).toISOString();
  if (item.observed_at !== undefined) {
    const parsed = Date.parse(String(item.observed_at));
    if (!Number.isFinite(parsed)) throw new InvalidInputError(`${where} has an observed_at that is not a date.`);
    if (parsed > now + 5 * 60_000) throw new InvalidInputError(`${where} says it was observed in the future.`);
    observedAt = new Date(parsed).toISOString();
  }
  let postedAt = null;
  if (item.posted_at !== undefined && item.posted_at !== null) {
    const parsed = Date.parse(String(item.posted_at));
    if (!Number.isFinite(parsed)) throw new InvalidInputError(`${where} has a posted_at that is not a date.`);
    postedAt = new Date(parsed).toISOString();
  }
  /** @type {Record<string, number|null>} */
  const metrics = {};
  if (item.metrics !== undefined) {
    if (!item.metrics || typeof item.metrics !== 'object' || Array.isArray(item.metrics)) throw new InvalidInputError(`${where} has metrics that are not an object.`);
    for (const [key, value] of Object.entries(item.metrics)) {
      if (!METRIC_FIELDS.includes(key)) throw new InvalidInputError(`${where} has an unknown metric ${key}.`);
      if (value === null) {
        metrics[key] = null;
        continue;
      }
      const count = typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
      if (count === null) throw new InvalidInputError(`${where}: the ${key} count must be a whole number of zero or more, or left out when the page did not show it.`);
      metrics[key] = count;
    }
  }
  let confidence = WEB_EVIDENCE_CONFIDENCE;
  if (item.confidence !== undefined) {
    if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 0.8) {
      throw new InvalidInputError(`${where}: web evidence confidence is between 0 and 0.8; a direct read by a research tool is what earns more.`);
    }
    confidence = item.confidence;
  }
  // The findings shape's `claim` and `evidence` stand in for `text` and `quote` when those
  // are not given directly, so both shapes Claude naturally produces land the same way.
  const text = typeof item.text === 'string' ? item.text : typeof item.claim === 'string' ? item.claim : null;
  const quote = typeof item.quote === 'string' ? item.quote : typeof item.evidence === 'string' ? item.evidence : null;
  if (['post', 'comment'].includes(kind) && !text && !quote && Object.keys(metrics).length === 0 && !item.title) {
    throw new InvalidInputError(`${where} records a ${kind} but carries nothing that was seen: add its text, a quote or a count.`);
  }
  if (kind === 'page' && !text && !quote && !item.title) {
    throw new InvalidInputError(`${where} has no text: add its title, quote, text, evidence or claim.`);
  }
  const notes = (Array.isArray(item.notes) ? item.notes : item.notes ? [item.notes] : []).map(String).filter((note) => note.trim().length > 0);
  if (webStandIn) {
    notes.push(`Web evidence standing in for ${platform}, since it could not be read directly.`);
  }

  const provenance = { source_type: 'web_evidence', source_ref: url.href, observed_at: observedAt, confidence };
  const record =
    kind === 'post'
      ? postRecord({ platform, url: url.href, author_handle: item.author_handle, posted_at: postedAt, caption: quote ?? text, metrics, ...provenance })
      : kind === 'profile'
        ? profileRecord({ platform, url: url.href, handle: item.author_handle, display_name: item.title, bio: text ?? quote, followers: metrics.followers, following: metrics.following, post_count: metrics.post_count, ...provenance })
        : kind === 'comment'
          ? commentRecord({ platform, url: url.href, post_url: url.href, author_handle: item.author_handle, text: quote ?? text ?? '', likes: metrics.likes, replies: metrics.replies, posted_at: postedAt, ...provenance })
          : kind === 'ad'
            ? adRecord({ platform, url: url.href, library_url: /ads\/library|library\.tiktok|creativecenter/.test(url.href) ? url.href : null, advertiser: item.author_handle ?? item.title, started_at: postedAt, headline: item.title, primary_text: quote ?? text, ...provenance })
            : pageRecord({ url: url.href, title: item.title, text: quote ?? text ?? '', links: [], ...provenance });
  if (kind === 'page' && platform !== 'web') record.platform = platform;
  if (quote && text && quote !== text) record.context = text;
  return { record, notes };
}

/**
 * A stable form of a source url for deduplication: lower-cased host, no query
 * string or fragment, and no trailing slash. Two addresses that only differ in
 * tracking parameters or a trailing slash are the same source.
 * @param {string} href
 * @returns {string}
 */
function normalizeUrlForDedup(href) {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}`;
  } catch {
    return href;
  }
}

/**
 * A short stable hash of an evidence item's text, so two saves of the same wording
 * collide and two saves of different wording do not.
 * @param {string} text
 * @returns {string}
 */
function hashText(text) {
  return createHash('sha256').update(text ?? '').digest('hex').slice(0, 16);
}

/**
 * The identity one evidence item is deduplicated on: platform, the plan target it
 * answers (when there was a plan), its normalised source url and a hash of its text.
 * @param {string} platform
 * @param {string|null} target
 * @param {Record<string, any>} record
 * @returns {string}
 */
function dedupKeyFor(platform, target, record) {
  const text = record.text ?? record.caption ?? record.bio ?? record.primary_text ?? record.context ?? '';
  return `${platform}:${target ?? ''}:${normalizeUrlForDedup(record.url)}:${hashText(text)}`;
}

/**
 * Web evidence already saved for a platform and target, from within its normal
 * freshness window, so a research request that came back with nothing direct can
 * still show what earlier evidence answered the same question.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} platform the plan's platform, not necessarily the item's own platform kind.
 * @param {string} operation the cache kind, for example `profile` or `post`.
 * @param {string} target the normalised source_ref used for the plan and the cache.
 * @param {number} [now]
 * @returns {Array<Record<string, any>>}
 */
export function savedEvidenceFor(db, platform, operation, target, now = Date.now()) {
  const ttl = CACHE_TTL_MS[operation] ?? 3_600_000;
  const cutoff = new Date(now - ttl).toISOString();
  const rows = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT e.record_json, e.last_verified_at, e.created_at FROM research_evidence e
         JOIN web_evidence_requests r ON r.request_id = e.request_id
         WHERE r.platform = ? AND r.operation = ? AND r.target = ? AND e.created_at >= ?
         ORDER BY e.created_at DESC`,
      )
      .all(platform, operation, target, cutoff)
  );
  return rows.map((row) => ({ ...parseJson(row.record_json, {}), last_verified_at: String(row.last_verified_at ?? row.created_at) }));
}

/**
 * Store web evidence items. Everything is checked before anything is written.
 * A repeat save of the same platform, target, source url and text updates the
 * existing row's last_verified_at instead of adding a duplicate; `deduplicated`
 * says how many items in this call were treated that way.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{campaign_id?: string, request_id?: string, platform: string, items: Array<Record<string, any>>, now?: number}} input
 * @returns {{ok: true, saved: number, deduplicated: number, request_id: string|null, request_known: boolean|null, records: Array<Record<string, any>>, inferences: Array<Record<string, any>>}}
 */
export function saveEvidence(db, input) {
  const now = input.now ?? Date.now();
  if (!['tiktok', 'instagram', 'facebook', 'meta', 'web'].includes(input.platform)) {
    throw new InvalidInputError('platform must be tiktok, instagram, facebook, meta or web.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) throw new InvalidInputError('There are no evidence items to record.');
  if (input.items.length > 200) throw new InvalidInputError('Record at most 200 evidence items at a time.');
  if (input.campaign_id) {
    const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(input.campaign_id);
    if (!campaign) throw new UserFacingError('That job could not be found.', { code: 'not_found', fix: 'Check the job id, or leave campaign_id out.' });
  }
  const plan = input.request_id ? findPlan(db, input.request_id) : null;
  // Evidence gathered from the web on behalf of another platform's plan is the normal
  // case, not an error: Instagram (or any platform) could not be read directly, the
  // plan sent Claude to the open web, and what it found still answers that plan. Store
  // it against the plan's platform rather than refusing on the mismatch.
  const webStandIn = Boolean(plan && plan.platform !== input.platform);
  const platform = webStandIn ? plan.platform : input.platform;
  const normalised = input.items.map((item, index) => normaliseEvidenceItem(item, index, platform, now, { webStandIn }));
  const createdAt = new Date(now).toISOString();
  const records = [];
  const inferences = [];
  let deduplicated = 0;
  const insert = db.prepare(
    `INSERT INTO research_evidence (id, request_id, campaign_id, platform, kind, url, record_json, notes_json, source_type, source_ref, observed_at, confidence, created_at, dedup_key, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web_evidence', ?, ?, ?, ?, ?, ?)`,
  );
  const findByDedupKey = db.prepare('SELECT id, record_json FROM research_evidence WHERE dedup_key = ?');
  const touch = db.prepare('UPDATE research_evidence SET last_verified_at = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const { record, notes } of normalised) {
      const dedupKey = dedupKeyFor(platform, plan?.target ?? null, record);
      const existing = /** @type {any} */ (findByDedupKey.get(dedupKey));
      if (existing) {
        touch.run(createdAt, existing.id);
        const stored = { ...parseJson(existing.record_json, {}), last_verified_at: createdAt };
        records.push(stored);
        deduplicated += 1;
        continue;
      }
      const id = newId(now);
      const stored = { evidence_id: id, ...record };
      insert.run(
        id,
        input.request_id ?? null,
        input.campaign_id ?? null,
        platform,
        record.kind,
        record.url,
        JSON.stringify(stored),
        notes.length > 0 ? JSON.stringify(notes) : null,
        record.source_ref,
        record.observed_at,
        record.confidence,
        createdAt,
        dedupKey,
        createdAt,
      );
      records.push(stored);
      for (const note of notes) {
        inferences.push({ id: `${id}:note${inferences.length + 1}`, claim: note, based_on: [id], confidence: Math.min(0.5, record.confidence), source_type: 'model_inference' });
      }
    }
    if (plan) db.prepare('UPDATE web_evidence_requests SET answered_at = ? WHERE request_id = ?').run(createdAt, plan.request_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true, saved: records.length, deduplicated, request_id: input.request_id ?? null, request_known: input.request_id ? Boolean(plan) : null, records, inferences };
}

/**
 * Count of evidence items already recorded for a plan target, so a repeated read can mention them.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} platform
 * @param {string} operation
 * @param {string} target
 * @returns {number}
 */
export function evidenceCountFor(db, platform, operation, target) {
  const row = /** @type {any} */ (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM research_evidence e JOIN web_evidence_requests r ON r.request_id = e.request_id
         WHERE r.platform = ? AND r.operation = ? AND r.target = ?`,
      )
      .get(platform, operation, target)
  );
  return toCount(row?.n) ?? 0;
}
