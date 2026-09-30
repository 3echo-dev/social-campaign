/**
 * The built in page reader: a bounded fetch and a small, polite same site crawler.
 *
 * boundedFetch is a port of the prototype's bounded server side fetch: size and
 * time capped, a spoofed browser identity string, 403 and 429 treated as soft notes rather than
 * failures. Unlike the prototype it also reads http addresses, follows redirects by
 * hand so every hop is checked, and refuses private network addresses unless the
 * caller allows them, because a research tool has no business reading a router's
 * admin page.
 *
 * webCrawl reads one page, a section or a site, same origin only, honours
 * robots.txt and its crawl delay, and waits between requests to the same host.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { envelope, pageRecord, parseHttpUrl } from '../records.mjs';
import { pagePlan } from '../plans.mjs';

/** Largest body read, from the prototype. */
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** Longest wait for one response, from the prototype. */
export const FETCH_TIMEOUT_MS = 15_000;

/** A current desktop browser. Sites serve their normal page to it. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/** The token robots.txt rules are matched against, besides `*`. */
export const ROBOTS_AGENT = 'SocialCampaign';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const MAX_REDIRECTS = 5;

/**
 * A fetch that failed before any response arrived.
 */
export class FetchFailure extends Error {
  /**
   * @param {string} message
   * @param {'invalid_url'|'private_address'|'timed_out'|'network'|'too_many_redirects'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'FetchFailure';
    this.code = code;
  }
}

/**
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (isIP(value) === 6) {
    if (value === '::1' || value === '::') return true;
    if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(value);
  }
  return value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal');
}

/**
 * Whether private addresses may be read, from the option or the environment.
 * The environment switch exists for local development and the offline tests.
 * @param {boolean|undefined} option
 * @returns {boolean}
 */
function privateAllowed(option) {
  if (typeof option === 'boolean') return option;
  return process.env.SOCIAL_CAMPAIGN_ALLOW_PRIVATE_FETCH === '1';
}

/**
 * @param {URL} url
 * @param {boolean} allowPrivate
 */
export async function assertPublicHost(url, allowPrivate) {
  if (allowPrivate) return;
  if (isPrivateAddress(url.hostname)) {
    throw new FetchFailure(`${url.hostname} is a private network address.`, 'private_address');
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) return;
  let addresses = [];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new FetchFailure(`${url.hostname} could not be found.`, 'network');
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new FetchFailure(`${url.hostname} points at a private network address.`, 'private_address');
  }
}

/**
 * @typedef {object} FetchResult
 * @property {string} url the address asked for.
 * @property {string} final_url the address that answered, after redirects.
 * @property {number} status
 * @property {boolean} ok
 * @property {string} content_type
 * @property {string} body decoded as UTF-8, at most maxBytes.
 * @property {number} bytes
 * @property {boolean} truncated
 * @property {string} fetched_at
 */

/**
 * Fetch one address with a size cap, a time cap and checked redirects.
 * A non 2xx answer is returned, not thrown: 403 and 429 are normal for bot protected
 * pages and the caller decides what they mean.
 * @param {string} rawUrl
 * @param {{timeoutMs?: number, maxBytes?: number, allowPrivate?: boolean, headers?: Record<string, string>, method?: string, body?: string, allowedProtocols?: string[], raw?: boolean}} [options]
 * @returns {Promise<FetchResult>}
 */
export async function boundedFetch(rawUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  const allowPrivate = privateAllowed(options.allowPrivate);
  const raw = options.raw === true;
  let url = parseHttpUrl(rawUrl);
  if (!url) throw new FetchFailure(`"${rawUrl}" is not a web address.`, 'invalid_url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(url, allowPrivate);
      let response;
      try {
        response = await fetch(url, {
          method: options.method ?? 'GET',
          body: options.body,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            Accept: HTML_ACCEPT,
            'Accept-Language': 'en-US,en;q=0.9',
            ...(options.headers ?? {}),
          },
        });
      } catch (error) {
        if (controller.signal.aborted) throw new FetchFailure(`${url.href} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'timed_out');
        throw new FetchFailure(`${url.href} could not be reached: ${error instanceof Error ? error.message : String(error)}`, 'network');
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const next = parseHttpUrl(new URL(String(response.headers.get('location')), url).href);
        await response.body?.cancel().catch(() => {});
        if (!next) throw new FetchFailure(`${url.href} redirected to an address that is not a web page.`, 'invalid_url');
        url = next;
        continue;
      }
      const capped = await readCapped(response, maxBytes, controller, url, timeoutMs, raw);
      return {
        url: rawUrl,
        final_url: url.href,
        status: response.status,
        ok: response.ok,
        content_type: String(response.headers.get('content-type') ?? ''),
        ...(raw ? { buffer: capped.buffer } : { body: capped.body }),
        bytes: capped.bytes,
        truncated: capped.truncated,
        fetched_at: new Date().toISOString(),
      };
    }
    throw new FetchFailure(`${rawUrl} redirected more than ${MAX_REDIRECTS} times.`, 'too_many_redirects');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Response} response
 * @param {number} maxBytes
 * @param {AbortController} controller
 * @param {URL} url
 * @param {number} timeoutMs
 * @param {boolean} [raw] return a Buffer instead of decoding as UTF-8.
 * @returns {Promise<{body: string, bytes: number, truncated: boolean}|{buffer: Buffer, bytes: number, truncated: boolean}>}
 */
async function readCapped(response, maxBytes, controller, url, timeoutMs, raw = false) {
  const reader = response.body?.getReader();
  if (!reader) return raw ? { buffer: Buffer.alloc(0), bytes: 0, truncated: false } : { body: '', bytes: 0, truncated: false };
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        chunks.push(Buffer.from(value.subarray(0, maxBytes - total)));
        total = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } catch (error) {
    if (controller.signal.aborted) throw new FetchFailure(`${url.href} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`, 'timed_out');
    throw new FetchFailure(`${url.href} broke off: ${error instanceof Error ? error.message : String(error)}`, 'network');
  }
  const buffer = Buffer.concat(chunks);
  return raw ? { buffer, bytes: total, truncated } : { body: buffer.toString('utf8'), bytes: total, truncated };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: '(c)', reg: '(R)', trade: '(TM)' };

/**
 * @param {string} value
 * @returns {string}
 */
export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      // A decoded em dash would put one into stored text, so it becomes a plain dash.
      if (code === 0x2014) return '-';
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * @param {string} html
 * @returns {string|null}
 */
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() || null : null;
}

/**
 * Readable text from HTML: scripts, styles and hidden templates dropped, block
 * elements turned into line breaks, entities decoded, blank runs collapsed.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figure|figcaption|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .replace(/\u2014/g, '-')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Absolute http(s) links in a page, without fragments, in order, deduplicated.
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} [limit]
 * @returns {string[]}
 */
export function extractLinks(html, baseUrl, limit = 200) {
  const links = [];
  const seen = new Set();
  const withoutScripts = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const match of withoutScripts.matchAll(/<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!raw || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    let absolute;
    try {
      absolute = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') continue;
    absolute.hash = '';
    const href = absolute.href;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
    if (links.length >= limit) break;
  }
  return links;
}

/**
 * Open Graph and description meta tags, keyed by property or name.
 * @param {string} html
 * @returns {Record<string, string>}
 */
export function extractMeta(html) {
  /** @type {Record<string, string>} */
  const meta = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    if (!key || !content) continue;
    const name = key.toLowerCase();
    if (!(name in meta)) meta[name] = decodeEntities(content[1] ?? content[2] ?? '').trim();
  }
  return meta;
}

/**
 * @typedef {object} RobotsRules
 * @property {Array<{path: string, allow: boolean}>} rules
 * @property {number|null} crawlDelayS
 */

/**
 * Parse robots.txt for one user agent. The most specific group naming the agent
 * wins; otherwise the `*` group applies; no group means everything is allowed.
 * @param {string} text
 * @param {string} [agent]
 * @returns {RobotsRules}
 */
export function parseRobots(text, agent = ROBOTS_AGENT) {
  /** @type {Array<{agents: string[], rules: Array<{path: string, allow: boolean}>, crawlDelayS: number|null}>} */
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelayS: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (value === '' && field === 'disallow') continue;
      current.rules.push({ path: value, allow: field === 'allow' });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayS = seconds;
    }
  }
  const wanted = agent.toLowerCase();
  const named = groups.filter((group) => group.agents.some((name) => name !== '*' && wanted.includes(name)));
  const chosen = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelayS: chosen.map((group) => group.crawlDelayS).find((value) => value !== null) ?? null,
  };
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function robotsPattern(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * Whether a path (with its query) may be read. The longest matching rule wins and
 * Allow wins a tie, as RFC 9309 says.
 * @param {RobotsRules} robots
 * @param {string} pathWithQuery
 * @returns {boolean}
 */
export function robotsAllows(robots, pathWithQuery) {
  let best = null;
  for (const rule of robots.rules) {
    if (!robotsPattern(rule.path).test(pathWithQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/**
 * Keeps a minimum gap between requests to the same host, for the life of the process.
 */
export class Politeness {
  /**
   * @param {number} gapMs
   * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>}} [clock] replaceable so tests run on virtual time.
   */
  constructor(gapMs, clock = {}) {
    this.gapMs = gapMs;
    this.now = clock.now ?? (() => Date.now());
    this.sleep = clock.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    /** @type {Map<string, number>} */
    this.last = new Map();
  }

  /**
   * Wait until the host may be asked again, then claim the slot.
   * @param {string} host
   * @param {number} [gapMs] a larger gap, for example a robots.txt crawl delay.
   */
  async wait(host, gapMs = this.gapMs) {
    const previous = this.last.get(host);
    const now = this.now();
    const readyAt = previous === undefined ? now : previous + gapMs;
    this.last.set(host, Math.max(now, readyAt));
    if (readyAt > now) await this.sleep(readyAt - now);
  }
}

/** The longest robots.txt crawl delay honoured before giving up on more pages. */
const MAX_CRAWL_DELAY_S = 10;

/**
 * @typedef {object} CrawlOptions
 * @property {Politeness} [politeness]
 * @property {boolean} [allowPrivate]
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 * @property {Map<string, RobotsRules>} [robotsCache]
 */

/**
 * @param {string} origin
 * @param {CrawlOptions} options
 * @returns {Promise<{robots: RobotsRules, note: string|null}>}
 */
async function loadRobots(origin, options) {
  const cached = options.robotsCache?.get(origin);
  if (cached) return { robots: cached, note: null };
  let robots = { rules: [], crawlDelayS: null };
  let note = null;
  try {
    const result = await boundedFetch(`${origin}/robots.txt`, {
      allowPrivate: options.allowPrivate,
      timeoutMs: Math.min(options.timeoutMs ?? FETCH_TIMEOUT_MS, 10_000),
      maxBytes: 512 * 1024,
      headers: { Accept: 'text/plain,*/*;q=0.5' },
    });
    if (result.ok) robots = parseRobots(result.body);
    else if (result.status === 401 || result.status === 403) {
      // RFC 9309: an unreachable robots.txt for access reasons means assume the whole site is off limits.
      robots = { rules: [{ path: '/', allow: false }], crawlDelayS: null };
      note = 'The site refuses to share its robots.txt, so it is treated as closed to automated readers.';
    }
  } catch {
    // An unreachable robots.txt for network reasons: the page fetch will report the real problem.
  }
  options.robotsCache?.set(origin, robots);
  return { robots, note };
}

/**
 * @param {FetchResult} result
 * @returns {boolean}
 */
function isHtml(result) {
  return /html|xml/i.test(result.content_type) || (!result.content_type && /<html|<body/i.test(result.body.slice(0, 2000)));
}

/** Visible text shorter than this, from a page that is mostly script tags, is an empty JavaScript shell, not a read page. */
const EMPTY_SHELL_TEXT_THRESHOLD = 200;

/** How much of the page has to be `<script>` content for a thin page to count as a shell rather than a short real page. */
const EMPTY_SHELL_SCRIPT_RATIO = 0.5;

/**
 * Whether a page's content is added by JavaScript the plain HTTP reader never runs: its
 * visible text is thin and most of its bytes are script tags. Crawler review 2026-09-15,
 * finding 2: a page like this must never be reported `full`.
 * @param {string} html
 * @param {string} text
 * @returns {boolean}
 */
export function isEmptyShell(html, text) {
  if (text.trim().length >= EMPTY_SHELL_TEXT_THRESHOLD) return false;
  if (html.length === 0) return false;
  let scriptBytes = 0;
  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) scriptBytes += match[0].length;
  return scriptBytes / html.length > EMPTY_SHELL_SCRIPT_RATIO;
}

/**
 * Read one page, a section or a site. Same origin only.
 * @param {{url: string, scope?: 'page'|'section'|'site', max_pages?: number}} input
 * @param {CrawlOptions} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function webCrawl(input, options = {}) {
  const start = parseHttpUrl(input.url);
  if (!start) throw new FetchFailure(`"${input.url}" is not a web address.`, 'invalid_url');
  start.hash = '';
  const scope = input.scope ?? 'page';
  const maxPages = scope === 'page' ? 1 : Math.max(1, Math.min(25, input.max_pages ?? 5));
  const politeness = options.politeness ?? new Politeness(1000);
  const origin = start.origin;
  const sectionPrefix = start.pathname.endsWith('/') ? start.pathname : start.pathname.replace(/[^/]*$/, '');

  const { robots, note: robotsNote } = await loadRobots(origin, options);
  const gapMs = Math.max(politeness.gapMs, Math.min(robots.crawlDelayS ?? 0, MAX_CRAWL_DELAY_S) * 1000);

  const queue = [start.href];
  const queued = new Set(queue);
  const records = [];
  /**
   * Pages that were found but not read. `lost` marks the ones that lower coverage:
   * a page the site closed or refused, not a broken link, another site or a file.
   * @type {Array<{url: string, reason: string, lost: boolean, code: string|null}>}
   */
  const skipped = [];
  let firstFailure = null;

  while (queue.length > 0 && records.length < maxPages) {
    const next = /** @type {string} */ (queue.shift());
    const url = new URL(next);
    if (!robotsAllows(robots, url.pathname + url.search)) {
      skipped.push({ url: next, reason: 'robots.txt asks automated readers not to open it', lost: true, code: 'unsupported' });
      if (next === start.href) firstFailure = { code: 'unsupported', reason: robotsNote ?? 'The site asks automated readers not to open this page.', plan: 'search_only' };
      continue;
    }
    await politeness.wait(url.host, gapMs);
    let result;
    try {
      result = await boundedFetch(next, { allowPrivate: options.allowPrivate, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes });
    } catch (error) {
      const failure = error instanceof FetchFailure ? error : new FetchFailure(String(error), 'network');
      skipped.push({ url: next, reason: failure.message, lost: true, code: failure.code === 'timed_out' ? 'timed_out' : 'blocked' });
      if (next === start.href) {
        const refused = failure.code === 'private_address' || failure.code === 'invalid_url';
        firstFailure = {
          code: failure.code === 'timed_out' ? 'timed_out' : refused ? 'unsupported' : 'not_found',
          reason: failure.message,
          plan: refused ? 'none' : 'full',
        };
      }
      continue;
    }
    if (new URL(result.final_url).origin !== origin) {
      skipped.push({ url: next, reason: `it redirects to another site, ${new URL(result.final_url).origin}`, lost: false, code: null });
      if (next === start.href) firstFailure = { code: 'unsupported', reason: `The address redirects to another site, ${result.final_url}, which a same site read does not follow.` };
      continue;
    }
    if (!result.ok) {
      const status = statusFailure(result.status);
      skipped.push({ url: next, reason: `the site answered ${result.status}`, lost: status.code !== 'not_found', code: status.code });
      if (next === start.href) firstFailure = statusFailure(result.status);
      continue;
    }
    if (!isHtml(result)) {
      skipped.push({ url: next, reason: `it is not a web page (${result.content_type || 'unknown type'})`, lost: false, code: null });
      if (next === start.href) firstFailure = { code: 'unsupported', reason: `The address is not a web page (${result.content_type || 'unknown type'}).` };
      continue;
    }
    const pageText = htmlToText(result.body);
    if (isEmptyShell(result.body, pageText)) {
      // The transport and the HTML both succeeded, but the content is added by
      // JavaScript this reader never runs, so there is nothing here to call `full`.
      skipped.push({ url: next, reason: 'its content is added by JavaScript; the page reader saw an empty shell', lost: true, code: 'empty_page' });
      if (next === start.href) {
        firstFailure = { code: 'empty_page', reason: 'This page\'s content is added by JavaScript; the plain page reader saw an empty shell.', plan: 'full' };
      }
      continue;
    }
    const links = extractLinks(result.body, result.final_url);
    records.push(
      pageRecord({
        url: result.final_url,
        title: extractTitle(result.body),
        text: pageText,
        links,
        observed_at: result.fetched_at,
        source_ref: result.final_url,
      }),
    );
    if (scope === 'page') break;
    for (const link of links) {
      const candidate = new URL(link);
      if (candidate.origin !== origin || queued.has(candidate.href)) continue;
      if (scope === 'section' && !candidate.pathname.startsWith(sectionPrefix)) continue;
      if (/\.(pdf|jpe?g|png|gif|webp|svg|mp4|mov|zip|css|js|json|xml|ico|woff2?)$/i.test(candidate.pathname)) continue;
      queued.add(candidate.href);
      queue.push(candidate.href);
    }
  }

  const truncatedText = records.some((record) => record.text.length >= 20_000);
  let coverage = 'full';
  let degradedCode = null;
  let degradedReason = null;
  if (records.length === 0) {
    coverage = 'none';
    degradedCode = firstFailure?.code ?? 'not_found';
    degradedReason = firstFailure?.reason ?? 'No readable page was found.';
  } else if (truncatedText) {
    coverage = 'partial';
    degradedCode = 'unsupported';
    degradedReason = 'At least one page was longer than 20000 characters, so its text was cut.';
  } else {
    const lost = skipped.filter((entry) => entry.lost);
    if (lost.length > 0) {
      coverage = 'partial';
      degradedCode = lost[0].code ?? 'blocked';
      degradedReason = `${lost.length} linked page${lost.length === 1 ? ' was' : 's were'} not read: ${lost[0].reason}.`;
    }
  }
  return envelope({
    platform: 'web',
    backend: records.length > 0 ? 'public_page' : 'none',
    coverage: /** @type {any} */ (coverage),
    degraded_code: degradedCode,
    degraded_reason: degradedReason,
    records,
    web_evidence_plan: records.length === 0 ? crawlPlan(start.href, degradedReason ?? '', firstFailure?.plan ?? (degradedCode === 'not_found' ? 'none' : 'full')) : null,
    extra: { scope, pages_read: records.length, skipped },
  });
}

/**
 * The fallback plan for a page that could not be read. A page robots.txt closes is
 * looked for through search only; a refused address gets no plan at all.
 * @param {string} url
 * @param {string} reason
 * @param {'full'|'search_only'|'none'} kind
 * @returns {Record<string, any>|null}
 */
function crawlPlan(url, reason, kind) {
  if (kind === 'none') return null;
  const plan = pagePlan({ url, reason });
  if (kind === 'search_only') plan.fetch = [];
  return plan;
}

/**
 * @param {number} status
 * @returns {{code: string, reason: string}}
 */
export function statusFailure(status) {
  if (status === 401) return { code: 'login_required', reason: 'The site asks for a sign in before it shows this page.' };
  if (status === 403) return { code: 'blocked', reason: 'The site turned away an automated reader (403).' };
  if (status === 404 || status === 410) return { code: 'not_found', reason: `The page does not exist (${status}).` };
  if (status === 429) return { code: 'rate_limited', reason: 'The site asked readers to slow down (429).' };
  if (status === 451) return { code: 'region_restricted', reason: 'The site does not show this page in this region (451).' };
  return { code: 'blocked', reason: `The site answered with an error (${status}).` };
}
