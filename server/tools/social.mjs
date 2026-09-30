/**
 * Social and web research tools.
 *
 * Thin handlers over server/social/: the router picks the best healthy backend for
 * each platform and operation, and every read answers with the research envelope
 * from docs/CONTRACTS.md section 1a. When a platform cannot be read without a login,
 * the envelope says so with coverage "none" or "partial", a degraded_reason, and a
 * web_evidence_plan for Claude to run with WebSearch and WebFetch, whose findings
 * come back through research_evidence_save.
 *
 * Read only: no login, no cookies, no paid scraper. yt-dlp is the only external
 * binary, and its absence lowers coverage rather than failing a call.
 */

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { parseJson } from '../lib/json.mjs';
import { getSocialRouter } from '../social/router.mjs';
import { saveEvidence } from '../social/store.mjs';

const PLATFORMS = ['tiktok', 'instagram', 'facebook'];

/**
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {import('node:sqlite').DatabaseSync|null}
 */
function dbOf(workspace) {
  return workspace && workspace.status().configured ? workspace.requireDb() : null;
}

/**
 * The country of the brand's market, when the workspace holds exactly one active
 * brand whose market is recorded as a two letter code.
 * @param {import('node:sqlite').DatabaseSync|null} db
 * @returns {string|null}
 */
function brandCountry(db) {
  if (!db) return null;
  try {
    const brands = /** @type {any[]} */ (db.prepare("SELECT id FROM brands WHERE status = 'active'").all());
    if (brands.length !== 1) return null;
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT value_json FROM brand_fields
            WHERE brand_id = ? AND superseded_by IS NULL
              AND field_path IN ('market.country', 'market.primary_country', 'market', 'identity.market', 'audience.country')
            ORDER BY precedence_rank, observed_at DESC LIMIT 1`,
        )
        .get(brands[0].id)
    );
    const value = parseJson(row?.value_json, null);
    const code = typeof value === 'string' ? value.trim().toUpperCase() : null;
    return code && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * The shared router, pointed at this call's workspace.
 * @param {import('../mcp/registry.mjs').ToolContext} context
 */
function routerFor(context) {
  const router = getSocialRouter();
  const workspace = context?.workspace;
  let captured = null;
  if (workspace && typeof workspace.captureContext === 'function') {
    try {
      captured = workspace.captureContext();
    } catch {
      // An unconfigured workspace has no database to capture. It still gets an
      // explicit null context so a global pointer cannot leak into this call.
    }
  }
  const root = captured?.root ?? (typeof workspace?.root === 'string' ? workspace.root : null);
  const db = captured?.db ?? dbOf(workspace);
  return router.withContext({ workspaceRoot: root, db, brandCountry: brandCountry(db) });
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function integerIn(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidInputError(`${name} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function oneOf(value, allowed, name, fallback) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new InvalidInputError(`${name} is one of ${allowed.join(', ')}.`);
  return value;
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const socialTools = [
  defineTool({
    name: 'social_profile_get',
    description:
      'Read a public TikTok, Instagram or Facebook account: profile facts plus its most recent posts. ' +
      'Says honestly how much it could read, and when it could not, returns a plan for finding the same evidence on the web.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        handle_or_url: { type: 'string', description: 'A handle like @brand or the profile address.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent posts to include. Default 12.' },
      },
      required: ['platform', 'handle_or_url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).profile({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        handle_or_url: String(args.handle_or_url),
        limit: integerIn(args.limit, 'limit', 1, 50, 12),
      }),
  }),
  defineTool({
    name: 'social_post_get',
    description:
      'Read one public post or reel from its address: caption, author, date, engagement counts and media details.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The post address.' } },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) => routerFor(context).post({ url: String(args.url) }),
  }),
  defineTool({
    name: 'social_comments_get',
    description: 'Read the public comments on one post, most engaged first, for audience and objection research.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post address.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) => routerFor(context).comments({ url: String(args.url), limit: integerIn(args.limit, 'limit', 1, 500, 100) }),
  }),
  defineTool({
    name: 'social_search',
    description: 'Find public posts or accounts on one platform that match a topic, hashtag or phrase.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        query: { type: 'string', description: 'A topic, #hashtag or phrase.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' },
      },
      required: ['platform', 'query'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).search({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        query: String(args.query),
        limit: integerIn(args.limit, 'limit', 1, 50, 20),
      }),
  }),
  defineTool({
    name: 'social_outliers_find',
    description:
      'Find the posts on a public account that did far better than that account usually does, measured against its own recent baseline.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        handle_or_url: { type: 'string' },
        window: {
          type: 'string',
          enum: ['30d', '90d', '180d', 'all'],
          description: 'How far back the baseline reaches. Default 90d.',
        },
      },
      required: ['platform', 'handle_or_url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).outliers({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        handle_or_url: String(args.handle_or_url),
        window: /** @type {any} */ (oneOf(args.window, ['30d', '90d', '180d', 'all'], 'window', '90d')),
      }),
  }),
  defineTool({
    name: 'social_ad_search',
    description:
      'Look up the ads an advertiser is running, or ads matching a phrase, in the public Meta or TikTok ad libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['meta', 'tiktok'] },
        advertiser_or_query: { type: 'string', description: 'An advertiser name, page address or phrase.' },
        country: { type: 'string', description: 'Two letter country code. Default is the brand market, else US.' },
      },
      required: ['platform', 'advertiser_or_query'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).adSearch({
        platform: /** @type {any} */ (oneOf(args.platform, ['meta', 'tiktok'], 'platform')),
        advertiser_or_query: String(args.advertiser_or_query),
        country: typeof args.country === 'string' ? args.country : undefined,
      }),
  }),
  defineTool({
    name: 'web_crawl',
    description:
      'Read a website page, or a few pages of the same site, as clean text with its links, for brand and landing page research.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        scope: { type: 'string', enum: ['page', 'section', 'site'], description: 'Default page.' },
        max_pages: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 5. Ignored for scope page.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).crawl({
        url: String(args.url),
        scope: /** @type {any} */ (oneOf(args.scope, ['page', 'section', 'site'], 'scope', 'page')),
        max_pages: integerIn(args.max_pages, 'max_pages', 1, 25, 5),
      }),
  }),
  defineTool({
    name: 'social_backends_status',
    description:
      'Report which ways of reading TikTok, Instagram, Facebook, the ad libraries and the web work on this computer right now, and how complete each one is.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, context) => routerFor(context).status(),
  }),
  defineTool({
    name: 'research_evidence_save',
    description:
      'Record evidence Claude found with web search or web fetch after a research tool said it could not read a platform directly, ' +
      'so it carries the same provenance as everything else. ' +
      'It is normal to answer an instagram (or any platform) plan with evidence found on the open web: pass the plan\'s ' +
      '`request_id` and either that platform or "web" as `platform`, and it is recorded against the plan\'s platform either way, ' +
      'tagged as web evidence standing in for it. ' +
      'Two item shapes both work: a page item ({url, title?, text}, what the page says) and a finding ({claim, evidence, url}, ' +
      'evidence being the exact quote or fact backing the claim). Only a missing source url or missing text is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        request_id: { type: 'string', description: 'The web_evidence_plan request_id this answers, when there was one.' },
        platform: { type: 'string', enum: [...PLATFORMS, 'meta', 'web'] },
        items: {
          type: 'array',
          minItems: 1,
          description:
            'Either shape, per item: a page item {kind?: "page", url, title?, text} or a finding {claim, evidence, url}. ' +
            'A structured item also works: {kind: post|profile|comment|ad|page, url, observed_at?, title?, text?, quote?, ' +
            'author_handle?, posted_at?, metrics?, notes?}. `kind` defaults to "page" when left out.',
          items: { type: 'object' },
        },
      },
      required: ['platform', 'items'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      saveEvidence(context.workspace.requireDb(), {
        campaign_id: typeof args.campaign_id === 'string' && args.campaign_id ? args.campaign_id : undefined,
        request_id: typeof args.request_id === 'string' && args.request_id ? args.request_id : undefined,
        platform: oneOf(args.platform, [...PLATFORMS, 'meta', 'web'], 'platform'),
        items: /** @type {any[]} */ (args.items),
      }),
  }),
];
