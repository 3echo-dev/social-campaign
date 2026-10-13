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
 * webCrawl reads one page, a section or a site, same site only (the one exception is a
 * redirect of the first address to another host of the same brand, followed once), honours
 * robots.txt and its crawl delay, and waits between requests to the same host.
 */

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { envelope, pageRecord, parseHttpUrl } from '../records.mjs';
import { pagePlan } from '../plans.mjs';

/** Largest body read, from the prototype. */
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** Longest wait for one response, from the prototype. */
export const FETCH_TIMEOUT_MS = 10_000;

/** Most pages one section or site crawl reads. */
export const CRAWL_MAX_PAGES = 5;

/** Total time one crawl may take, robots.txt, crawl delays and every page included. */
export const CRAWL_BUDGET_MS = 45_000;

/** Largest generated image, video or voice file downloaded from a provider link. */
export const GENERATED_MEDIA_MAX_BYTES = 500 * 1024 * 1024;

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
   * @param {'invalid_url'|'private_address'|'timed_out'|'network'|'too_many_redirects'|'redirect_loop'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'FetchFailure';
    this.code = code;
  }
}

/** IPv4 ranges that are not the public internet: this computer, local networks, cloud metadata, benchmarking, multicast and reserved. */
const PRIVATE_V4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) PRIVATE_V4.addSubnet(network, prefix, 'ipv4');

/** IPv6 ranges that are never a public web server: unspecified, loopback, local-use NAT64, unique local, link-local, site-local and multicast. */
const PRIVATE_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) PRIVATE_V6.addSubnet(network, prefix, 'ipv6');

/**
 * The 16 bytes of a valid IPv6 address, any spelling: compressed, dotted IPv4 tail, zone id.
 * @param {string} value already accepted by isIP as version 6.
 * @returns {number[]}
 */
function ipv6Bytes(value) {
  let text = value.split('%')[0];
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(tail === null ? 0 : 8 - left.length - right.length).fill('0'), ...right];
  return groups.flatMap((group) => {
    const word = Number.parseInt(group, 16);
    return [word >> 8, word & 0xff];
  });
}

/**
 * The IPv4 address an IPv6 address carries and would reach: IPv4-mapped (::ffff:0:0/96),
 * IPv4-translated (::ffff:0:0:0/96), IPv4-compatible (::/96), NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
 * @param {number[]} bytes
 * @returns {string|null}
 */
function embeddedIpv4(bytes) {
  const zero = (from, to) => bytes.slice(from, to).every((byte) => byte === 0);
  const quad = (from) => bytes.slice(from, from + 4).join('.');
  if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return quad(12);
  if (zero(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zero(10, 12)) return quad(12);
  if (zero(0, 12)) return quad(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12)) return quad(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return quad(2);
  return null;
}

/**
 * Whether an address or host name is on this computer or a private network.
 * IPv6 is read as bytes, so the hex form Node's URL parser gives a mapped address
 * ([::ffff:7f00:1] for 127.0.0.1) is caught as well as the dotted one.
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(value) === 4) return PRIVATE_V4.check(value, 'ipv4');
  if (isIP(value) === 6) {
    const bare = value.split('%')[0];
    if (PRIVATE_V6.check(bare, 'ipv6')) return true;
    const embedded = embeddedIpv4(ipv6Bytes(bare));
    return embedded !== null && PRIVATE_V4.check(embedded, 'ipv4');
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
 * Second level labels that sit under a two letter country code and are part of the public suffix:
 * `com.sg`, `co.uk`, `com.au`, `co.jp`. This project stays at zero npm dependencies, so a full public
 * suffix list is out of reach; this covers the registries brands actually use.
 */
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'net', 'org', 'gov', 'gob', 'govt', 'edu', 'ac', 'or', 'ne', 'go', 'ltd', 'plc', 'me', 'sch', 'mil', 'asn', 'firm', 'gen', 'ind', 'nom']);

/**
 * The registrable domain of a host name: the name a person registered, with its public suffix
 * (`www.killiney.com.sg` is `killiney.com.sg`, `shop.example.co.uk` is `example.co.uk`).
 * An IP address or a single label name is returned as it is.
 * @param {string} hostname
 * @returns {string}
 */
export function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || isIP(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  return labels.slice(last.length === 2 && SECOND_LEVEL_LABELS.has(second) ? -3 : -2).join('.');
}

/**
 * The brand name part of a host: the label in front of the public suffix
 * (`killiney` for `www.killiney.com.sg`), or null for an IP address, `localhost` and other single label names.
 * @param {string} hostname
 * @returns {string|null}
 */
export function brandLabel(hostname) {
  const domain = registrableDomain(hostname);
  if (!domain || isIP(domain) || !domain.includes('.')) return null;
  return domain.split('.')[0] || null;
}

/** The shortest brand name that can be the first words of a longer one: `killiney` in `killiney-kopitiam`. */
const MIN_BRAND_PREFIX = 4;

/**
 * Whether two hosts belong to the same brand: the same registrable name under any suffix
 * (`killiney.com.sg` and `killiney.com`, `www.yakun.com` and `app.yakun.com`), or one name
 * that is the other plus more words (`killiney` and `killiney-kopitiam`).
 * @param {string} hostA
 * @param {string} hostB
 * @returns {boolean}
 */
export function sameBrandHost(hostA, hostB) {
  const a = brandLabel(hostA);
  const b = brandLabel(hostB);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_BRAND_PREFIX && long.startsWith(`${short}-`);
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
 * @property {string} [redirect_to] set only when `onRedirect` refused a redirect: the address it pointed at. `final_url` is then the address that sent it.
 */

/**
 * Fetch one address with a size cap, a time cap and checked redirects.
 * A non 2xx answer is returned, not thrown: 403 and 429 are normal for bot protected
 * pages and the caller decides what they mean. A redirect back to an address already
 * seen in the same chain is a loop and throws `redirect_loop` at once, without waiting
 * out the hop limit.
 * `onRedirect(from, to)` is asked before each redirect is followed; returning false stops
 * there and returns the redirect answer itself, with `redirect_to` set.
 * @param {string} rawUrl
 * @param {{timeoutMs?: number, maxBytes?: number, allowPrivate?: boolean, headers?: Record<string, string>, method?: string, body?: string, allowedProtocols?: string[], raw?: boolean, onRedirect?: (from: URL, to: URL) => boolean}} [options]
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
  const visited = new Set([chainKey(url)]);
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
        // The same request, with no cookies kept between hops, gets the same answer: an address seen
        // already in this chain is a loop (typically a cookie or consent wall), not a slow chain.
        if (visited.has(chainKey(next))) {
          throw new FetchFailure(`${next.href} redirects in a loop, usually a cookie or consent wall that a plain reader cannot pass.`, 'redirect_loop');
        }
        if (options.onRedirect && options.onRedirect(url, next) === false) {
          return {
            url: rawUrl,
            final_url: url.href,
            status: response.status,
            ok: false,
            content_type: '',
            ...(raw ? { buffer: Buffer.alloc(0) } : { body: '' }),
            bytes: 0,
            truncated: false,
            fetched_at: new Date().toISOString(),
            redirect_to: next.href,
          };
        }
        visited.add(chainKey(next));
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
 * An address as one redirect chain sees it: the fragment is never sent, so it does not tell two hops apart.
 * @param {URL} url
 * @returns {string}
 */
function chainKey(url) {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
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
   * How long a request to this host would have to wait right now, without claiming the slot.
   * @param {string} host
   * @param {number} [gapMs]
   * @returns {number}
   */
  peek(host, gapMs = this.gapMs) {
    const previous = this.last.get(host);
    if (previous === undefined) return 0;
    return Math.max(0, previous + gapMs - this.now());
  }

  /**
   * Record a request to the host that did not go through `wait`, such as the page a redirect landed on.
   * @param {string} host
   */
  touch(host) {
    this.last.set(host, Math.max(this.last.get(host) ?? 0, this.now()));
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
 * @property {number} [budgetMs] total time for the whole crawl, default CRAWL_BUDGET_MS.
 * @property {() => number} [clock] replaceable for tests.
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

/** Query parameters that only say where a visitor came from: two addresses that differ by these are the same page. */
const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|msclkid|yclid|ttclid|twclid|igshid|mc_cid|mc_eid|_ga|_gl|srsltid|mkt_tok|li_fat_id|ref_src|ref_url|spm)$/i;

/**
 * What identifies a page apart from how a link spelled it: no scheme, `www.`, fragment, tracking
 * parameters, trailing slash or `index.html`, and the remaining query parameters in a fixed order.
 * @param {URL} url
 * @returns {string}
 */
export function pageKey(url) {
  const host = url.host.toLowerCase().replace(/^www\./, '');
  let path = url.pathname.replace(/\/index\.(html?|php)$/i, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAMS.test(name))
    .sort(([a, valueA], [b, valueB]) => (a === b ? valueA.localeCompare(valueB) : a.localeCompare(b)));
  const query = params.length > 0 ? `?${params.map(([name, value]) => `${name}=${value}`).join('&')}` : '';
  return `${host}${path}${query}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function textKey(text) {
  return createHash('sha1').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
}

/**
 * The folder a section crawl stays in: the page's own path up to its last slash.
 * @param {URL} url
 * @returns {string}
 */
function sectionOf(url) {
  return url.pathname.endsWith('/') ? url.pathname : url.pathname.replace(/[^/]*$/, '');
}

/**
 * @param {Politeness} politeness
 * @param {RobotsRules} robots
 * @returns {number}
 */
function crawlGap(politeness, robots) {
  return Math.max(politeness.gapMs, Math.min(robots.crawlDelayS ?? 0, MAX_CRAWL_DELAY_S) * 1000);
}

/**
 * Read one page, a section or a site. Same site only: the one exception is the address the crawl
 * starts from. When the site itself redirects that address to another host of the same brand (`www`
 * to the bare name, `killiney.com.sg` to `killiney-kopitiam.com`), the crawl follows it once, says so in
 * `followed_redirect`, and stays on the final host from then on. A redirect to any other host is not followed.
 * Section and site crawls drop a page that is the same as one already read (the same address once
 * tidied, or the same text) and report how many in `duplicates_dropped`.
 * @param {{url: string, scope?: 'page'|'section'|'site', max_pages?: number}} input
 * @param {CrawlOptions} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function webCrawl(input, options = {}) {
  const start = parseHttpUrl(input.url);
  if (!start) throw new FetchFailure(`"${input.url}" is not a web address.`, 'invalid_url');
  start.hash = '';
  const scope = input.scope ?? 'page';
  const maxPages = scope === 'page' ? 1 : Math.max(1, Math.min(CRAWL_MAX_PAGES, input.max_pages ?? CRAWL_MAX_PAGES));
  const politeness = options.politeness ?? new Politeness(1000);
  const budgetMs = options.budgetMs ?? CRAWL_BUDGET_MS;
  const clock = options.clock ?? (() => Date.now());
  const startedAt = clock();
  const remaining = () => budgetMs - (clock() - startedAt);
  let origin = start.origin;
  let sectionPrefix = sectionOf(start);

  let { robots, note: robotsNote } = await loadRobots(origin, options);
  let gapMs = crawlGap(politeness, robots);

  const queue = [start.href];
  /** Every page already queued or read, by `pageKey`. */
  const keys = new Set([pageKey(start)]);
  /** Every spelling of an address queued, to tell a link repeated as it is from a variant of it. */
  const spellings = new Set(queue);
  /** The pages read, by `pageKey` and by text, with the address they were read at. */
  const keptByKey = new Map();
  const keptByText = new Map();
  let duplicates = 0;
  let duplicateReads = 0;
  /** @type {{from: string, to: string}|null} */
  let followedRedirect = null;
  const records = [];
  /**
   * Pages that were found but not read. `lost` marks the ones that lower coverage:
   * a page the site closed or refused, not a broken link, another site, a file or a repeat.
   * @type {Array<{url: string, reason: string, lost: boolean, code: string|null}>}
   */
  const skipped = [];
  let firstFailure = null;

  while (queue.length > 0 && records.length < maxPages) {
    const next = /** @type {string} */ (queue.shift());
    const url = new URL(next);
    const isStart = next === start.href;
    // The crawl has one clock. A page is only started when its polite wait and a
    // useful fetch both still fit; otherwise the rest is left unread, not waited for.
    if (remaining() <= 1000 || (records.length > 0 && politeness.peek(url.host, gapMs) + 1000 > remaining())) {
      skipped.push({ url: next, reason: 'skipped: budget (the crawl used its 45 seconds)', lost: true, code: 'timed_out' });
      if (isStart && records.length === 0) firstFailure = { code: 'timed_out', reason: 'The crawl ran out of time before the first page was read.', plan: 'full' };
      break;
    }
    if (!robotsAllows(robots, url.pathname + url.search)) {
      skipped.push({ url: next, reason: 'robots.txt asks automated readers not to open it', lost: true, code: 'unsupported' });
      if (isStart) firstFailure = { code: 'unsupported', reason: robotsNote ?? 'The site asks automated readers not to open this page.', plan: 'search_only' };
      continue;
    }
    await politeness.wait(url.host, gapMs);
    // Only the first address may change host, once, and only to the same brand; every other redirect
    // stays on the host that sent it. A redirect that is not allowed is not followed at all.
    let changedHost = false;
    const onRedirect = (/** @type {URL} */ from, /** @type {URL} */ to) => {
      if (from.hostname === to.hostname) return true;
      if (!isStart || changedHost || !sameBrandHost(start.hostname, to.hostname)) return false;
      changedHost = true;
      return true;
    };
    let result;
    try {
      result = await boundedFetch(next, { allowPrivate: options.allowPrivate, timeoutMs: Math.max(1000, Math.min(options.timeoutMs ?? FETCH_TIMEOUT_MS, remaining())), maxBytes: options.maxBytes, onRedirect });
    } catch (error) {
      const failure = error instanceof FetchFailure ? error : new FetchFailure(String(error), 'network');
      skipped.push({ url: next, reason: failure.message, lost: true, code: failure.code === 'timed_out' ? 'timed_out' : 'blocked' });
      if (isStart) {
        const refused = failure.code === 'private_address' || failure.code === 'invalid_url';
        // A loop of redirects is a cookie or consent wall a plain reader cannot pass: a refusal, not a missing page.
        const walled = failure.code === 'redirect_loop' || failure.code === 'too_many_redirects';
        firstFailure = {
          code: failure.code === 'timed_out' ? 'timed_out' : refused ? 'unsupported' : walled ? 'blocked' : 'not_found',
          reason: failure.message,
          plan: refused ? 'none' : 'full',
        };
      }
      continue;
    }
    if (result.redirect_to) {
      const target = new URL(result.redirect_to);
      skipped.push({ url: next, reason: `it redirects to another site, ${target.origin}`, lost: false, code: null });
      if (isStart) firstFailure = { code: 'unsupported', reason: `The address redirects to another site, ${target.href}, which a same site read does not follow.` };
      continue;
    }
    const landed = new URL(result.final_url);
    if (isStart && landed.origin !== origin) {
      // The crawl lives on the final host from here on: its robots.txt, its links, its section.
      const movedHost = landed.host !== new URL(origin).host;
      origin = landed.origin;
      sectionPrefix = sectionOf(landed);
      if (movedHost) {
        followedRedirect = { from: start.href, to: result.final_url };
        // The redirect itself just asked this host once, so its robots.txt waits out the gap like any other request.
        politeness.touch(landed.host);
        await politeness.wait(landed.host, gapMs);
        ({ robots, note: robotsNote } = await loadRobots(origin, options));
        gapMs = crawlGap(politeness, robots);
        if (!robotsAllows(robots, landed.pathname + landed.search)) {
          skipped.push({ url: result.final_url, reason: 'robots.txt asks automated readers not to open it', lost: true, code: 'unsupported' });
          firstFailure = { code: 'unsupported', reason: robotsNote ?? 'The site asks automated readers not to open this page.', plan: 'search_only' };
          continue;
        }
      }
    }
    if (landed.origin !== origin) {
      skipped.push({ url: next, reason: `it redirects to another site, ${landed.origin}`, lost: false, code: null });
      continue;
    }
    if (!result.ok) {
      const status = statusFailure(result.status);
      skipped.push({ url: next, reason: `the site answered ${result.status}`, lost: status.code !== 'not_found', code: status.code });
      if (isStart) firstFailure = statusFailure(result.status);
      continue;
    }
    if (!isHtml(result)) {
      skipped.push({ url: next, reason: `it is not a web page (${result.content_type || 'unknown type'})`, lost: false, code: null });
      if (isStart) firstFailure = { code: 'unsupported', reason: `The address is not a web page (${result.content_type || 'unknown type'}).` };
      continue;
    }
    const pageText = htmlToText(result.body);
    if (isEmptyShell(result.body, pageText)) {
      // The transport and the HTML both succeeded, but the content is added by
      // JavaScript this reader never runs, so there is nothing here to call `full`.
      skipped.push({ url: next, reason: 'its content is added by JavaScript; the page reader saw an empty shell', lost: true, code: 'empty_page' });
      if (isStart) {
        firstFailure = { code: 'empty_page', reason: 'This page\'s content is added by JavaScript; the plain page reader saw an empty shell.', plan: 'full' };
      }
      continue;
    }
    const pageId = pageKey(landed);
    const sameText = pageText.trim() ? textKey(pageText) : null;
    const repeatOf = keptByKey.get(pageId) ?? (sameText ? keptByText.get(sameText) : undefined);
    if (repeatOf) {
      // Another link led to a page already read: the same address once tidied, a redirect to it, or a page with the same text.
      duplicates += 1;
      duplicateReads += 1;
      skipped.push({ url: next, reason: `it is the same page as ${repeatOf}`, lost: false, code: null });
      if (duplicateReads >= maxPages * 2) {
        // A site that answers every address with the same page would otherwise be read until the budget ran out.
        skipped.push({ url: queue[0] ?? next, reason: 'skipped: the pages kept repeating what was already read', lost: false, code: null });
        break;
      }
      continue;
    }
    keptByKey.set(pageId, result.final_url);
    if (sameText) keptByText.set(sameText, result.final_url);
    keys.add(pageId);
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
      if (candidate.origin !== origin) continue;
      if (scope === 'section' && !candidate.pathname.startsWith(sectionPrefix)) continue;
      if (/\.(pdf|jpe?g|png|gif|webp|svg|mp4|mov|zip|css|js|json|xml|ico|woff2?)$/i.test(candidate.pathname)) continue;
      const key = pageKey(candidate);
      if (keys.has(key)) {
        // The same page spelled another way is a duplicate link; the same spelling again is just a repeated link.
        if (!spellings.has(candidate.href)) {
          spellings.add(candidate.href);
          duplicates += 1;
        }
        continue;
      }
      keys.add(key);
      spellings.add(candidate.href);
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
    extra: {
      scope,
      pages_read: records.length,
      skipped,
      ...(scope === 'page' ? {} : { duplicates_dropped: duplicates }),
      ...(followedRedirect ? { followed_redirect: followedRedirect } : {}),
    },
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
