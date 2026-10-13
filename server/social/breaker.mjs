// Shared per-host circuit breaker for scrapers, crawlers and downloads.
//
// Once a platform host has refused us (bot check, login wall, rate limit,
// repeated timeouts) every other route in this process skips it for 15 minutes
// instead of hammering it again and stalling the run. In memory, per process.
//
// A key is the host alone (the downloads, the single URL verify and the video watcher share it) or the host plus a
// scope (`tiktok.com#stealth:profile`). The research router scopes every read to its own backend and kind of read, so
// a flaky embed, a login wall on one Instagram topic page or a tag page that always answers a bot check can never
// silence a different route to the same host (live 2026-10-14: one multi word Instagram search took down every
// Instagram read for 15 minutes, and two TikTok tag reads took down the profile reader and the single URL verify).

/** Failure classes that will not heal by retrying right away. */
export const NON_HEALING = new Set(['bot_check', 'blocked', 'login_required', 'rate_limited', 'timed_out']);

export const BREAKER_OPEN_MS = 15 * 60 * 1000;
/** Failures older than this no longer count toward opening. */
export const BREAKER_WINDOW_MS = 15 * 60 * 1000;
const THRESHOLD = 2;

/**
 * Reduce a hostname to its registrable domain ("www.tiktok.com" -> "tiktok.com").
 * Handles the common two-part public suffixes (co.uk etc.) conservatively.
 * @param {string} host
 * @returns {string}
 */
export function normaliseHost(host) {
  let h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  h = h.replace(/:\d+$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h; // IP literal
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const second = parts[parts.length - 2];
  const twoPart = parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(second);
  return parts.slice(twoPart ? -3 : -2).join('.');
}

/**
 * Host of a URL, normalised. Returns '' when the input is not a URL.
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  try {
    return normaliseHost(new URL(String(url)).hostname);
  } catch {
    return '';
  }
}

export class Breaker {
  /** @param {{ now?: () => number, openMs?: number, windowMs?: number }} [opts] */
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.openMs = opts.openMs || BREAKER_OPEN_MS;
    this.windowMs = opts.windowMs || BREAKER_WINDOW_MS;
    /** @type {Map<string, { fails: number[], openUntil: number, code: string, reason: string }>} */
    this.hosts = new Map();
  }

  /**
   * @param {string} host
   * @param {string} [scope] a route of that host (a backend and a kind of read); none means the host as a whole.
   */
  _key(host, scope) {
    const h = String(host || '');
    const base = normaliseHost(h.includes('/') ? hostOf(h) : h);
    return base && scope ? `${base}#${scope}` : base;
  }

  /**
   * @param {string} host
   * @param {string} [scope]
   * @returns {{ open: boolean, code?: string, reason?: string, retryAfterMs?: number }}
   */
  isOpen(host, scope) {
    const key = this._key(host, scope);
    const e = key && this.hosts.get(key);
    if (!e || !e.openUntil) return { open: false };
    const left = e.openUntil - this.now();
    if (left <= 0) {
      this.hosts.delete(key);
      return { open: false };
    }
    return { open: true, code: e.code, reason: e.reason, retryAfterMs: left };
  }

  /**
   * @param {string} host
   * @param {string} code
   * @param {string} [reason]
   * @param {string} [scope]
   */
  recordFailure(host, code, reason = '', scope) {
    const key = this._key(host, scope);
    if (!key || !NON_HEALING.has(code)) return;
    const now = this.now();
    const e = this.hosts.get(key) || { fails: [], openUntil: 0, code, reason: '' };
    e.fails = e.fails.filter((t) => now - t < this.windowMs);
    e.fails.push(now);
    const need = code === 'login_required' ? 1 : THRESHOLD;
    if (e.fails.length >= need) {
      e.openUntil = now + this.openMs;
      e.code = code;
      e.reason = reason || `${key} refused us (${code}); skipped for ${Math.round(this.openMs / 60000)} minutes.`;
    }
    this.hosts.set(key, e);
  }

  /**
   * @param {string} host
   * @param {string} [scope]
   */
  recordSuccess(host, scope) {
    const key = this._key(host, scope);
    if (key) this.hosts.delete(key);
  }

  reset() {
    this.hosts.clear();
  }
}

export const breaker = new Breaker();
