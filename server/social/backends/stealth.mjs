/**
 * The stealth research backend: Scrapling, run by python/social_stealth.py.
 *
 * It does four narrow jobs the other routes cannot do without a login: a public
 * TikTok profile's latest videos, TikTok Creative Center top ads, Meta Ad Library
 * search (only when the Meta Ads connector is not connected), and a page that
 * answers 403 or a Cloudflare check to the plain readers, which is also how
 * Instagram profiles, posts and /popular/ topic pages are read (see instagram.mjs).
 * It never logs in, never uses cookies and never rotates proxies. One call is one
 * request, with one hard deadline; there are no retries here and nothing waits for
 * another try. The single exception is inside the worker: a TikTok profile whose
 * video list comes back empty is loaded one more time before it is reported as
 * empty (python/social_stealth.py, op_tiktok_profile).
 *
 * Every call spawns the worker with an argument array (no shell), writes one JSON
 * request on stdin, reads one JSON result from stdout, and kills the WHOLE process
 * tree when the deadline passes (the browser it started included).
 *
 * Every method resolves to `{ok: true, ...data}` or
 * `{ok: false, code, reason, trip}`; nothing here throws for an ordinary failure.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { log } from '../../lib/log.mjs';
import { pythonChildEnv } from '../../lib/python-env.mjs';
import {
  hasUsableResearchHelperRecord,
  normalizeResearchHelperRecord,
  researchHelperChildEnv,
} from '../../setup/research-helper-record.mjs';
import { readResearchHelperState } from './browser.mjs';
import { killTree } from './ytdlp.mjs';

/**
 * Longest a profile, page or Meta Ad Library call may run. Measured live on 2026-10-13: a warm TikTok profile read
 * takes 8 to 31 seconds and a cold one up to 77, so 45 seconds cut off about one read in five.
 */
export const STEALTH_TIMEOUT_MS = 75_000;

/** Longest a Creative Center call may run. */
export const STEALTH_TOP_ADS_TIMEOUT_MS = 40_000;

/** Largest stdout the worker may produce before it is cut off. */
export const STEALTH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{ok: false, code: string, reason: string, trip: boolean}} StealthFailure
 * @typedef {{stdout: string, timedOut: boolean, tooLarge: boolean, spawnFailed: boolean, exitCode: number|null}} RunOutcome
 * @typedef {(command: {python: string, args: string[], env?: NodeJS.ProcessEnv}, payload: string, timeoutMs: number) => Promise<RunOutcome>} StealthRunner
 */

/**
 * The real runner: spawn, feed stdin, collect stdout, kill the tree at the deadline.
 * @type {StealthRunner}
 */
export function spawnRunner(command, payload, timeoutMs) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let stdout = '';
    let tooLarge = false;
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    const finish = (/** @type {Partial<RunOutcome>} */ patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, timedOut: false, tooLarge, spawnFailed: false, exitCode: null, ...patch });
    };
    const timer = setTimeout(() => {
      if (child) killTree(child);
      finish({ timedOut: true });
    }, timeoutMs);
    try {
      child = spawn(command.python, command.args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        // A new process group on POSIX lets killTree stop the browser children too.
        detached: process.platform !== 'win32',
        // UTF-8 for the worker's stdout: a caption with an emoji must not turn the answer into a Python traceback.
        env: pythonChildEnv(command.env),
      });
    } catch {
      finish({ spawnFailed: true });
      return;
    }
    child.on('error', () => finish({ spawnFailed: true }));
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > STEALTH_MAX_OUTPUT_BYTES) {
        tooLarge = true;
        killTree(child);
        finish({});
      }
    });
    child.on('close', (code) => finish({ exitCode: code }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(payload);
  });
}

/**
 * The Scrapling backend.
 */
export class StealthBackend {
  /**
   * @param {object} [opts]
   * @param {string} [opts.python] the interpreter to run; defaults to the research helper's recorded one.
   * @param {string} [opts.script] overrides python/social_stealth.py.
   * @param {number} [opts.timeoutMs] overrides the default deadline for every call.
   * @param {StealthRunner} [opts.runner] replaces the real process runner, for tests.
   * @param {(context?: {workspaceRoot?: string|null}) => Record<string, any>|null} [opts.state] replaces the record reader, for tests.
   * @param {string|null} [opts.workspaceRoot]
   */
  constructor(opts = {}) {
    this.python = opts.python ?? null;
    this.script = opts.script ?? fileURLToPath(new URL('../../../python/social_stealth.py', import.meta.url));
    this.timeoutMs = opts.timeoutMs ?? null;
    this.runner = opts.runner ?? spawnRunner;
    this.workspaceRoot = opts.workspaceRoot ?? null;
    this.state = opts.state ?? ((context) => readResearchHelperState(context?.workspaceRoot ?? this.workspaceRoot));
  }

  /**
   * The interpreter and environment to use, or null when the helper is not ready.
   * @returns {{python: string, args: string[], env?: NodeJS.ProcessEnv}|null}
   */
  command() {
    const entry = normalizeResearchHelperRecord(this.state({ workspaceRoot: this.workspaceRoot }));
    if (!entry) return null;
    const python = this.python ?? entry.python;
    if (!python || !existsSync(python)) return null;
    // The record says Scrapling went in with the install; without that the worker would only say not_installed.
    if (typeof entry.scrapling_version !== 'string' || !entry.scrapling_version) return null;
    if (this.python == null && !hasUsableResearchHelperRecord(entry)) return null;
    if (!existsSync(this.script)) return null;
    const env = researchHelperChildEnv(entry.environment_path);
    return { python, args: [...(Array.isArray(entry.python_args) ? entry.python_args : []), this.script], ...(env ? { env } : {}) };
  }

  /**
   * True when the research helper's Python exists and its record says Scrapling is installed.
   * @returns {boolean}
   */
  isReady() {
    try {
      return this.command() !== null;
    } catch {
      return false;
    }
  }

  /**
   * One worker call.
   * @param {Record<string, any>} request
   * @param {number} timeoutMs
   * @returns {Promise<{ok: true, result: Record<string, any>}|StealthFailure>}
   */
  async call(request, timeoutMs) {
    const command = this.command();
    if (!command) {
      return { ok: false, code: 'backend_missing', reason: 'The stealth reader is not installed.', trip: false };
    }
    const deadline = this.timeoutMs ?? timeoutMs;
    const payload = JSON.stringify({ ...request, timeout_ms: deadline });
    /** @type {RunOutcome} */
    let outcome;
    try {
      outcome = await this.runner({ python: command.python, args: command.args, ...(command.env ? { env: command.env } : {}) }, payload, deadline);
    } catch (error) {
      log.warn('stealth worker failed', { message: error instanceof Error ? error.message : String(error) });
      return { ok: false, code: 'error', reason: 'The stealth reader stopped unexpectedly.', trip: false };
    }
    if (outcome.spawnFailed) {
      return { ok: false, code: 'backend_missing', reason: 'The stealth reader could not be started.', trip: false };
    }
    if (outcome.timedOut) {
      return { ok: false, code: 'timed_out', reason: `The stealth reader did not answer within ${Math.round(deadline / 1000)} seconds.`, trip: true };
    }
    let result;
    try {
      result = JSON.parse(String(outcome.stdout).trim());
    } catch {
      return { ok: false, code: 'error', reason: 'The stealth reader answered with something other than JSON.', trip: false };
    }
    if (!result || typeof result !== 'object') {
      return { ok: false, code: 'error', reason: 'The stealth reader answered with an unexpected result.', trip: false };
    }
    return mapStatus(result);
  }

  /**
   * A public TikTok profile: stats and the latest videos, no login.
   * @param {string} handle with or without the @.
   * @param {{limit?: number, timeoutMs?: number}} [options]
   */
  async tiktokProfile(handle, options = {}) {
    const outcome = await this.call(
      { op: 'tiktok_profile', handle: String(handle ?? '').replace(/^@/, ''), limit: options.limit ?? 20 },
      options.timeoutMs ?? STEALTH_TIMEOUT_MS,
    );
    return outcome.ok ? { ok: true, ...outcome.result } : outcome;
  }

  /**
   * A web page that answered 403 or a Cloudflare check to the plain readers.
   * @param {string} url
   * @param {{timeoutMs?: number}} [options]
   */
  async page(url, options = {}) {
    const outcome = await this.call({ op: 'page', url }, options.timeoutMs ?? STEALTH_TIMEOUT_MS);
    if (!outcome.ok) return outcome;
    const { httpStatus, ...rest } = outcome.result;
    // A worker older than this release marked a JavaScript shell (TikTok tag and search pages: 22 characters) as ok.
    if (isEmptyShell(rest)) return { ok: false, code: 'empty', reason: SHELL_REASON, trip: false };
    return { ok: true, ...rest, status: httpStatus ?? null };
  }

  /**
   * TikTok Creative Center top ads.
   * @param {{country?: string, period?: number|string, keyword?: string, limit?: number, timeoutMs?: number}} [options]
   */
  async topAds(options = {}) {
    const outcome = await this.call(
      { op: 'tiktok_top_ads', country: options.country ?? 'US', period: options.period ?? 30, keyword: options.keyword ?? '', limit: options.limit ?? 20 },
      options.timeoutMs ?? STEALTH_TOP_ADS_TIMEOUT_MS,
    );
    return outcome.ok ? { ok: true, ...outcome.result } : outcome;
  }

  /**
   * Meta Ad Library search, for when the Meta Ads connector is not connected.
   * @param {{query: string, country?: string, limit?: number, timeoutMs?: number}} options
   */
  async metaAdLibrary(options) {
    const outcome = await this.call(
      { op: 'meta_ad_library', query: options?.query ?? '', country: options?.country ?? 'US', limit: options?.limit ?? 30 },
      options?.timeoutMs ?? STEALTH_TIMEOUT_MS,
    );
    return outcome.ok ? { ok: true, ...outcome.result } : outcome;
  }
}

const SHELL_REASON = 'The page is only a JavaScript shell: its content is drawn in the browser, so there was nothing to read.';

/**
 * Whether a page result has no readable text and no links at all.
 * @param {Record<string, any>} page
 * @returns {boolean}
 */
export function isEmptyShell(page) {
  const hasLinks = Array.isArray(page.links) && page.links.length > 0;
  return String(page.text ?? '').trim().length < 60 && !hasLinks && !page.instagram;
}

/**
 * Turn the worker's status into the success or failure shape the router uses.
 * @param {Record<string, any>} result
 * @returns {{ok: true, result: Record<string, any>}|StealthFailure}
 */
export function mapStatus(result) {
  const status = String(result.status ?? 'error');
  const detail = typeof result.detail === 'string' && result.detail ? result.detail : '';
  if (status === 'ok') {
    const { status: _status, detail: _detail, ...data } = result;
    return { ok: true, result: data };
  }
  if (status === 'empty') {
    return { ok: false, code: 'empty', reason: detail || 'The page loaded but had nothing to read.', trip: false };
  }
  if (status === 'blocked') {
    return { ok: false, code: 'blocked', reason: detail || 'The site answered with a bot check.', trip: true };
  }
  if (status === 'login_required') {
    return { ok: false, code: 'login_required', reason: detail || 'The site asked for a sign in.', trip: false };
  }
  if (status === 'rate_limited') {
    return { ok: false, code: 'rate_limited', reason: detail || 'The site asked automated readers to slow down.', trip: true };
  }
  if (status === 'not_found') {
    return { ok: false, code: 'not_found', reason: detail || 'The site says that page does not exist.', trip: false };
  }
  if (status === 'timed_out') {
    return { ok: false, code: 'timed_out', reason: detail || 'The stealth reader ran out of time.', trip: true };
  }
  if (status === 'not_installed') {
    return { ok: false, code: 'backend_missing', reason: detail || 'The stealth reader is not installed.', trip: false };
  }
  return { ok: false, code: 'error', reason: detail || 'The stealth reader failed.', trip: false };
}
