/**
 * The optional browser research backend.
 *
 * Spawns python/social_fetch.py, a small worker that renders a page with
 * crawl4ai and Playwright Chromium and prints one JSON result. This backend
 * is used only for operations the other backends already marked `none` or
 * `partial`: public pages that need JavaScript, the Instagram and Facebook
 * public pages a signed out reader gets some content from, and the Meta and
 * TikTok ad library pages. It is always tried after the existing backends,
 * never in place of a TikTok read that already works, and only when the
 * `research.browser` capability is ready (crawl4ai, Playwright Chromium and a
 * Python interpreter installed by the setup flow, recorded in
 * `integrations.json.research_helper`).
 *
 * The worker script's path never comes from this module: the python
 * interpreter path is read from integrations.json (written by the installer)
 * and passed to execFile as one argument in an array, so it is never
 * interpolated into a shell string.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../../lib/log.mjs';
import { readJsonFile } from '../../lib/json.mjs';
import {
  hasUsableResearchHelperRecord,
  normalizeResearchHelperRecord,
  researchHelperWorkerSha256,
  readResearchHelperRecord,
  researchHelperChildEnv,
} from '../../setup/research-helper-record.mjs';
import { adRecord, pageRecord, parseHumanCount, postRecord, profileRecord, toIso } from '../records.mjs';

/** Longest a single browser call is allowed to run. */
export const BROWSER_TIMEOUT_MS = 25_000;

/** Largest stdout the worker may produce, before it is cut off. */
export const BROWSER_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Where the per machine workspace pointer lives, same layout as server/lib/paths.mjs. */
function globalConfigPathDefault() {
  return join(homedir(), '.social-campaign', 'config.json');
}

/**
 * The `integrations.json.research_helper` entry the installer writes, or null.
 * Reads through the same workspace pointer file the rest of the plugin uses, so
 * this backend needs nothing passed in to find it.
 * @param {string|null} [workspaceRoot] an explicit root captured for this operation.
 * @returns {Record<string, any>|null}
 */
export function readResearchHelperState(workspaceRoot = null) {
  if (workspaceRoot) return readResearchHelperRecord(workspaceRoot);
  const override = process.env.SOCIAL_CAMPAIGN_HOME?.trim();
  const globalConfigPath = override ? join(override, 'config.json') : globalConfigPathDefault();
  const pointer = readJsonFile(globalConfigPath, /** @type {{workspaceRoot?: string}} */ ({}));
  const root = typeof pointer.workspaceRoot === 'string' ? pointer.workspaceRoot : null;
  return readResearchHelperRecord(root);
}

/**
 * @typedef {{ok: false, code: string, reason: string, trip: boolean}} BrowserFailure
 */

/**
 * @param {string} html_or_text
 * @param {RegExp} pattern
 * @param {string} label
 * @returns {number|null}
 */
function countNear(text, label) {
  const match = String(text ?? '').match(new RegExp(`([\\d.,]+\\s*[KkMmBb]?)\\s+${label}`, 'i'));
  return match ? parseHumanCount(match[1]) : null;
}

/**
 * The browser research backend.
 */
export class BrowserBackend {
  /**
   * @param {object} [options]
   * @param {((context?: {workspaceRoot?: string|null}) => Record<string, any>|null)} [options.state] overrides readResearchHelperState, for tests.
   * @param {string} [options.workspaceRoot] root captured for this backend's operation context.
   * @param {{root?: string|null}} [options.workspace] workspace object used only to capture its root at construction time.
   * @param {boolean} [options.allowLegacyState] permit unversioned injected test records.
   * @param {string} [options.scriptPath] overrides python/social_fetch.py, for tests.
   * @param {number} [options.timeoutMs]
   * @param {number} [options.maxOutputBytes]
   * @param {import('./web.mjs').Politeness} [options.politeness]
   */
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot ?? (options.workspace && typeof options.workspace.root === 'string' ? options.workspace.root : null);
    this.state = options.state ?? ((context) => readResearchHelperState(context?.workspaceRoot ?? this.workspaceRoot));
    this.allowLegacyState = options.allowLegacyState ?? Boolean(options.state);
    this.scriptPath = options.scriptPath ?? fileURLToPath(new URL('../../../python/social_fetch.py', import.meta.url));
    this.timeoutMs = options.timeoutMs ?? BROWSER_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? BROWSER_MAX_OUTPUT_BYTES;
    // Extra time given to the worker to print its own timeout result before this
    // side kills the process outright. Small in tests, generous in production.
    this.killGraceMs = options.killGraceMs ?? 5000;
    this.politeness = options.politeness;
  }

  /**
   * Return a view whose workspace root is fixed for the lifetime of an operation.
   * The server keeps one shared backend for trip and health bookkeeping, while each
   * request gets this small view so a later workspace switch cannot change which
   * integrations record is read by an in-flight browser call.
   * @param {{workspaceRoot?: string|null, root?: string|null}} [context]
   * @returns {BrowserBackend}
   */
  withContext(context = {}) {
    const root = typeof context.workspaceRoot === 'string' && context.workspaceRoot.trim()
      ? context.workspaceRoot.trim()
      : typeof context.root === 'string' && context.root.trim()
        ? context.root.trim()
        : null;
    const scoped = /** @type {BrowserBackend} */ (Object.create(this));
    scoped.workspaceRoot = root;
    scoped.state = root
      ? (requestContext = {}) => this.state({ ...requestContext, workspaceRoot: root })
      : () => null;
    return scoped;
  }

  /**
   * Whether the capability is ready to be tried at all.
   * @returns {boolean}
   */
  ready(context = {}) {
    const entry = normalizeResearchHelperRecord(this.state(context));
    const scriptPath = entry?.worker_path || this.scriptPath;
    if (!entry || !existsSync(scriptPath)) return false;
    if (hasUsableResearchHelperRecord(entry)) {
      return Boolean(entry.python && existsSync(entry.python) && existsSync(scriptPath));
    }
    // Existing unit fixtures inject a fake worker and a fake interpreter without
    // a persisted environment. Production records must use the versioned shape,
    // and a malformed versioned record cannot fall through this test-only escape.
    return Boolean(
      this.allowLegacyState &&
        entry.record_version == null &&
        entry.state === 'connected' &&
        typeof entry.python === 'string' &&
        entry.python.trim().length > 0 &&
        Boolean(researchHelperWorkerSha256(scriptPath)),
    );
  }

  /**
   * Spawn the worker once.
   * @param {{url: string, wait_for?: string, scroll?: number, timeout_ms?: number, extract?: 'text'|'links'|'json_ld'}} request
   * @returns {Promise<{ok: true, result: Record<string, any>}|BrowserFailure>}
   */
  async fetch(request, context = {}) {
    const entry = normalizeResearchHelperRecord(this.state(context));
    const scriptPath = entry?.worker_path || this.scriptPath;
    const legacyState = Boolean(
      this.allowLegacyState &&
        entry?.record_version == null &&
        entry?.state === 'connected' &&
        typeof entry?.python === 'string' &&
        entry.python.trim().length > 0 &&
        researchHelperWorkerSha256(scriptPath),
    );
    const usable = entry && entry.state === 'connected' && typeof entry.python === 'string' && entry.python.trim() &&
      (hasUsableResearchHelperRecord(entry) || legacyState);
    if (!usable) {
      return { ok: false, code: 'backend_missing', reason: 'The browser research helper is not installed or not connected.', trip: false };
    }
    if (!existsSync(scriptPath)) {
      return { ok: false, code: 'backend_missing', reason: 'The browser research worker script is missing.', trip: false };
    }
    if (this.politeness) {
      try {
        await this.politeness.wait(new URL(request.url).host);
      } catch {
        // an invalid url is caught below by the worker itself.
      }
    }
    const timeoutMs = request.timeout_ms ?? this.timeoutMs;
    const payload = JSON.stringify({
      url: request.url,
      wait_for: request.wait_for ?? null,
      scroll: request.scroll ?? 0,
      timeout_ms: timeoutMs,
      extract: request.extract ?? 'text',
    });
    // An environment in the plugin data folder keeps Chromium beside it; the
    // installer downloaded it there with the same variable.
    const env = researchHelperChildEnv(entry.environment_path);
    let stdout;
    try {
      stdout = await new Promise((resolvePromise, rejectPromise) => {
        const child = execFile(
          entry.python,
          [...(Array.isArray(entry.python_args) ? entry.python_args : []), scriptPath],
          { timeout: timeoutMs + this.killGraceMs, maxBuffer: this.maxOutputBytes, windowsHide: true, ...(env ? { env } : {}) },
          (error, out) => {
            if (error) rejectPromise(error);
            else resolvePromise(out);
          },
        );
        child.stdin?.end(payload);
      });
    } catch (error) {
      const killed = /** @type {any} */ (error)?.killed || /** @type {any} */ (error)?.signal === 'SIGTERM';
      log.warn('browser worker failed', { message: error instanceof Error ? error.message : String(error) });
      return {
        ok: false,
        code: killed ? 'timed_out' : 'blocked',
        reason: killed ? `The browser worker did not answer within ${Math.round(timeoutMs / 1000)} seconds.` : 'The browser worker stopped unexpectedly.',
        trip: !killed,
      };
    }
    let result;
    try {
      result = JSON.parse(String(stdout));
    } catch {
      return { ok: false, code: 'blocked', reason: 'The browser worker answered with something other than JSON.', trip: true };
    }
    if (result && typeof result === 'object' && typeof result.error === 'string') {
      return { ok: false, code: 'blocked', reason: `The browser worker failed: ${result.error}`, trip: true };
    }
    return { ok: true, result };
  }

  /**
   * A generic page read, for web_crawl's JavaScript fallback.
   * @param {string} url
   * @returns {Promise<{ok: true, record: Record<string, any>, coverage: 'full'|'partial', fetched_at: string}|BrowserFailure>}
   */
  async page(url) {
    const outcome = await this.fetch({ url, extract: 'text' });
    if (!outcome.ok) return outcome;
    const mapped = mapBlocked(outcome.result);
    if (mapped) return mapped;
    const { result } = outcome;
    const fetchedAt = new Date().toISOString();
    const record = pageRecord({
      url: result.final_url ?? url,
      title: result.title ?? null,
      text: result.text ?? '',
      links: Array.isArray(result.links) ? result.links : [],
      source_ref: result.final_url ?? url,
      observed_at: fetchedAt,
      source_type: 'web_evidence',
      confidence: 0.8,
    });
    const thin = (result.text ?? '').trim().length < 400;
    return { ok: true, record, coverage: thin ? 'partial' : 'full', fetched_at: fetchedAt };
  }

  /**
   * Instagram or Facebook profile facts, best effort, from a rendered page.
   * @param {{handle: string, url: string}} target
   * @param {'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, profile: Record<string, any>}|BrowserFailure>}
   */
  async profile(target, platform) {
    const outcome = await this.fetch({ url: target.url, extract: 'json_ld', wait_for: platform === 'instagram' ? 'main' : 'body', scroll: 2 });
    if (!outcome.ok) return outcome;
    const mapped = mapBlocked(outcome.result);
    if (mapped) return mapped;
    const { result } = outcome;
    const ld = firstOfType(result.json_ld, ['ProfilePage', 'Person', 'Organization']);
    const followers = countNear(result.text, 'Followers') ?? (typeof ld?.interactionStatistic === 'object' ? parseHumanCount(String(ld.interactionStatistic.userInteractionCount ?? '')) : null);
    return {
      ok: true,
      profile: profileRecord({
        platform,
        url: target.url,
        handle: target.handle,
        display_name: ld?.name ?? result.title ?? null,
        bio: ld?.description ?? null,
        followers,
        following: countNear(result.text, 'Following'),
        post_count: countNear(result.text, 'Posts'),
        source_ref: result.final_url ?? target.url,
        observed_at: new Date().toISOString(),
        source_type: 'web_evidence',
        confidence: 0.75,
      }),
    };
  }

  /**
   * An Instagram or Facebook post, best effort, from a rendered page.
   * @param {string} url
   * @param {'instagram'|'facebook'} platform
   * @returns {Promise<{ok: true, record: Record<string, any>}|BrowserFailure>}
   */
  async post(url, platform) {
    const outcome = await this.fetch({ url, extract: 'json_ld', wait_for: 'article, main', scroll: 1 });
    if (!outcome.ok) return outcome;
    const mapped = mapBlocked(outcome.result);
    if (mapped) return mapped;
    const { result } = outcome;
    const ld = firstOfType(result.json_ld, ['VideoObject', 'ImageObject', 'SocialMediaPosting']);
    const isVideo = Boolean(ld?.['@type'] === 'VideoObject' || /video|reel/i.test(String(result.title ?? '')));
    return {
      ok: true,
      record: postRecord({
        platform,
        url,
        post_id: url.match(/\/(?:p|reel|reels|tv|videos|posts)\/([^/?#]+)/)?.[1] ?? null,
        caption: ld?.description ?? ld?.caption ?? null,
        posted_at: toIso(ld?.uploadDate ?? ld?.datePublished ?? null),
        media_kind: isVideo ? 'video' : 'image',
        metrics: { likes: countNear(result.text, 'likes'), comments: countNear(result.text, 'comments') },
        thumbnail_url: typeof ld?.thumbnailUrl === 'string' ? ld.thumbnailUrl : null,
        source_ref: result.final_url ?? url,
        observed_at: new Date().toISOString(),
        source_type: 'web_evidence',
        confidence: 0.75,
      }),
    };
  }

  /**
   * An ad library search page, best effort. Ad libraries render their lists
   * with heavy client side frameworks that rarely publish JSON-LD, so this
   * usually still comes back with zero records; it is still worth trying,
   * because it reports honestly rather than guessing, and it is the one place
   * a future extraction rule can be added without touching the router.
   * @param {string} url
   * @returns {Promise<{ok: true, records: Array<Record<string, any>>, text: string}|BrowserFailure>}
   */
  async adLibraryPage(url, platform) {
    const outcome = await this.fetch({ url, extract: 'json_ld', wait_for: 'body', scroll: 3, timeout_ms: this.timeoutMs });
    if (!outcome.ok) return outcome;
    const mapped = mapBlocked(outcome.result);
    if (mapped) return mapped;
    const { result } = outcome;
    const ads = Array.isArray(result.json_ld) ? result.json_ld.filter((entry) => entry && (entry['@type'] === 'AdvertiserContentArticle' || entry.advertiser)) : [];
    const records = ads.map((entry) =>
      adRecord({
        platform,
        url: result.final_url ?? url,
        advertiser: entry.advertiser?.name ?? entry.advertiser ?? null,
        primary_text: entry.description ?? null,
        library_url: result.final_url ?? url,
        source_ref: result.final_url ?? url,
        observed_at: new Date().toISOString(),
        source_type: 'ad_library',
        confidence: 0.7,
      }),
    );
    return { ok: true, records, text: result.text ?? '' };
  }
}

/**
 * @param {Array<Record<string, any>>|undefined} blocks
 * @param {string[]} types
 * @returns {Record<string, any>|null}
 */
function firstOfType(blocks, types) {
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    const candidates = Array.isArray(block) ? block : block?.['@graph'] ? block['@graph'] : [block];
    for (const candidate of candidates) {
      if (candidate && types.includes(candidate['@type'])) return candidate;
    }
  }
  return null;
}

/**
 * Turn the worker's `blocked` flag into a router failure, or null when the page
 * came back with something to read.
 * @param {Record<string, any>} result
 * @returns {BrowserFailure|null}
 */
function mapBlocked(result) {
  if (!result || !result.blocked) return null;
  if (result.reason === 'login_wall') {
    return { ok: false, code: 'login_required', reason: 'The rendered page still asked for a sign in.', trip: false };
  }
  if (result.reason === 'empty_shell') {
    return { ok: false, code: 'empty_page', reason: 'The rendered page had nothing readable in it.', trip: false };
  }
  if (result.reason === 'timed_out') {
    return { ok: false, code: 'timed_out', reason: 'The browser worker did not finish in time.', trip: true };
  }
  return { ok: false, code: 'blocked', reason: result.reason === 'bot_check' ? 'The rendered page hit a bot check.' : 'The rendered page could not be read.', trip: true };
}
