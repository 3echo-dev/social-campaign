/**
 * Where a brand's own website points at its own logo, read from the page's HTML with no extra request.
 *
 * The page names a logo in three places, and only these are used:
 *   header  an <img> in the page's <header> or <nav> that says logo (in its alt, class, id or file name) or sits in a link to the home
 *           page, or that carries the brand's name. Icons, social badges and payment marks are skipped.
 *   icon    the largest apple-touch-icon, and the largest <link rel="icon"> when it is an SVG or at least 128 pixels wide.
 *   og      the og:image, but only when its address says logo. A sharing image is usually a photo, not the logo.
 * Nothing here searches the web or looks at any page but the one it is given.
 *
 * This module only finds addresses. server/brand-kit/logo-candidates.mjs downloads them, and only from hosts that belong to the brand.
 */

import { decodeEntities } from '../social/backends/web.mjs';

const MAX_HEADER_REFS = 2;
const MAX_REGION_CHARS = 80_000;
const FALLBACK_REGION_CHARS = 12_000;
const MIN_ICON_SIDE = 128;

const NOT_A_LOGO = /(?<![a-z0-9])(search|cart|bag|basket|menu|hamburger|burger|close|arrow|chevron|caret|user|account|login|wishlist|heart|share|globe|language|locale|flag|phone|mail|email|envelope|location|play|pause|plus|minus|star|check|badge|payment|visa|mastercard|paypal|amex|facebook|instagram|tiktok|twitter|youtube|pinterest|whatsapp|linkedin|telegram|snapchat|app[\s_-]?store|google[\s_-]?play|sprite|spinner|loader|placeholder|banner|hero|slide|slider|carousel)(?![a-z0-9])/i;
const STOP_WORDS = new Set(['the', 'shop', 'official', 'home', 'welcome', 'store', 'online', 'www']);

const compact = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match ? (match[1] ?? match[2] ?? match[3]) : null;
  return value === null ? null : decodeEntities(value);
}

/**
 * The words that name the brand on this page: the site name, the first part of the title and the first label of the host.
 * @param {string} html @param {Record<string, string>} meta @param {string} finalUrl
 * @returns {string[]}
 */
function brandTokens(html, meta, finalUrl) {
  const names = [meta?.['og:site_name'], meta?.['application-name']];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) names.push(decodeEntities(title).split(/\s[^\w\s]\s|\|/)[0]);
  try {
    names.push(new URL(finalUrl).hostname.replace(/^www\d?\./i, '').split('.')[0]);
  } catch { /* the host is unknown */ }
  const tokens = new Set();
  for (const name of names) {
    const whole = compact(name);
    if (whole.length >= 3) tokens.add(whole);
    const first = compact(String(name ?? '').trim().split(/[\s\-_]+/)[0]);
    if (first.length >= 3 && !STOP_WORDS.has(first)) tokens.add(first);
  }
  return [...tokens];
}

/** The regions of the page a logo lives in: its header blocks, else its navigation blocks, else the start of the body. */
function logoRegions(html) {
  const blocks = (name) => [...html.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}>`, 'gi'))].slice(0, 3).map((match) => match[0].slice(0, MAX_REGION_CHARS));
  const headers = blocks('header');
  if (headers.length) return headers;
  const navs = blocks('nav');
  if (navs.length) return navs;
  const body = html.match(/<body\b[^>]*>([\s\S]*)/i)?.[1] ?? html;
  return [body.slice(0, FALLBACK_REGION_CHARS)];
}

/** @param {string} href @param {string} finalUrl */
function isHomeLink(href, finalUrl) {
  if (!href || /^(?:javascript|mailto|tel):/i.test(href.trim())) return false;
  try {
    const base = new URL(finalUrl);
    const url = new URL(decodeEntities(href), base);
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return false;
    return url.pathname === '/' || /^\/(?:index\.(?:html?|php|aspx?)|[a-z]{2}(?:[-_][a-z]{2})?\/?)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** The biggest address an srcset names, or null. */
function largestFromSrcset(value) {
  let best = null;
  let bestWidth = -1;
  for (const part of String(value ?? '').split(',')) {
    const [address, descriptor] = part.trim().split(/\s+/);
    if (!address) continue;
    const width = /^(\d+)w$/.exec(descriptor ?? '') ? Number(/^(\d+)w$/.exec(descriptor)[1]) : /^(\d+(?:\.\d+)?)x$/.exec(descriptor ?? '') ? Number(/^(\d+(?:\.\d+)?)x$/.exec(descriptor)[1]) * 1000 : 0;
    if (width > bestWidth) { best = address; bestWidth = width; }
  }
  return best;
}

/** @param {string|null} raw @param {string} finalUrl */
function resolveAddress(raw, finalUrl) {
  if (!raw || /^\s*data:/i.test(raw)) return null;
  try {
    const url = new URL(decodeEntities(String(raw).trim()), finalUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** The largest side a `sizes` value lists, 0 when it lists none, Infinity for "any". */
function sideOf(sizes) {
  const text = String(sizes ?? '').toLowerCase();
  if (text.includes('any')) return Infinity;
  let largest = 0;
  for (const match of text.matchAll(/(\d+)\s*x\s*(\d+)/g)) largest = Math.max(largest, Number(match[1]), Number(match[2]));
  return largest;
}

/**
 * @param {string} html
 * @param {string} finalUrl the address the page answered from.
 * @param {Record<string, string>} [meta] the page's meta tags (extractMeta).
 * @returns {Array<{url: string, via: 'header'|'icon'|'og', hint: string}>} at most 5, best first inside each kind.
 */
export function extractSiteLogoRefs(html, finalUrl, meta = {}) {
  const text = String(html ?? '');
  if (!text) return [];
  const tokens = brandTokens(text, meta, finalUrl);
  const mentionsBrand = (value) => { const flat = compact(value); return tokens.some((token) => flat.includes(token)); };
  /** @type {Array<{url: string, via: 'header'|'icon'|'og', hint: string}>} */
  const refs = [];
  const seen = new Set();
  const add = (url, via, hint) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    refs.push({ url, via, hint: String(hint ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) });
  };

  // 1. header images
  /** @type {Array<{url: string, hint: string, score: number}>} */
  const header = [];
  for (const region of logoRegions(text)) {
    const anchors = [...region.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map((match) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      home: isHomeLink(attribute(match[0].match(/^<a\b[^>]*>/i)?.[0] ?? '', 'href') ?? '', finalUrl),
    }));
    for (const match of region.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const at = match.index ?? 0;
      const source = attribute(tag, 'src') ?? attribute(tag, 'data-src') ?? attribute(tag, 'data-lazy-src');
      const url = resolveAddress(largestFromSrcset(attribute(tag, 'srcset') ?? attribute(tag, 'data-srcset')) ?? source, finalUrl);
      if (!url) continue;
      let file = '';
      try { file = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { file = ''; }
      const hint = [attribute(tag, 'alt'), attribute(tag, 'class'), attribute(tag, 'id'), attribute(tag, 'title'), attribute(tag, 'aria-label'), file].filter(Boolean).join(' ');
      const width = Number(attribute(tag, 'width'));
      const height = Number(attribute(tag, 'height'));
      if (width > 0 && height > 0 && width <= 24 && height <= 24) continue;
      const namesLogo = /logo/i.test(hint);
      const namesBrand = mentionsBrand(hint);
      const inHomeLink = anchors.some((anchor) => anchor.home && at >= anchor.start && at < anchor.end);
      // A badge or an icon is skipped unless the image says logo or carries the brand's own name.
      if (NOT_A_LOGO.test(hint) && !namesLogo && !namesBrand) continue;
      if (NOT_A_LOGO.test(hint.replace(/logo/gi, '')) && !namesBrand && !inHomeLink) continue;
      if (!namesLogo && !namesBrand && !inHomeLink) continue;
      header.push({ url, hint: attribute(tag, 'alt') || file, score: (namesLogo ? 4 : 0) + (inHomeLink ? 3 : 0) + (namesBrand ? 2 : 0) });
    }
  }
  header.sort((a, b) => b.score - a.score);
  for (const item of header.slice(0, MAX_HEADER_REFS)) add(item.url, 'header', item.hint);

  // 2. icons: the largest apple-touch-icon, and the largest icon when it is an SVG or big enough
  const links = [...text.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const icons = links
    .map((tag) => ({ rel: (attribute(tag, 'rel') ?? '').toLowerCase(), href: attribute(tag, 'href'), sizes: attribute(tag, 'sizes'), type: (attribute(tag, 'type') ?? '').toLowerCase() }))
    .filter((link) => link.href && /(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut)(\s|$)/.test(link.rel));
  const touch = icons
    .filter((link) => link.rel.includes('apple-touch-icon'))
    .map((link) => ({ ...link, side: sideOf(link.sizes) || 180 }))
    .sort((a, b) => b.side - a.side)[0];
  if (touch) add(resolveAddress(touch.href, finalUrl), 'icon', 'apple touch icon');
  const best = icons
    .filter((link) => !link.rel.includes('apple-touch-icon'))
    .map((link) => ({ ...link, svg: link.type.includes('svg') || /\.svg(?:[?#]|$)/i.test(link.href), side: sideOf(link.sizes) }))
    .filter((link) => link.svg || link.side >= MIN_ICON_SIDE)
    .sort((a, b) => Number(b.svg) - Number(a.svg) || b.side - a.side)[0];
  if (best) add(resolveAddress(best.href, finalUrl), 'icon', best.svg ? 'svg icon' : 'site icon');

  // 3. the sharing image, only when its address says it is the logo
  const og = resolveAddress(meta?.['og:image:secure_url'] || meta?.['og:image'] || null, finalUrl);
  if (og) {
    let path = '';
    try { path = decodeURIComponent(new URL(og).pathname); } catch { path = ''; }
    if (/(^|[^a-z0-9])(logo|logotype|wordmark|brandmark)([^a-z0-9]|$)/i.test(path) && !/(hero|banner|cover|share|social|product|photo)/i.test(path)) add(og, 'og', 'sharing image');
  }
  return refs;
}

/**
 * The brand's YouTube channel when the page links to it, as an address parseHandle understands (/@name or /channel/UC...).
 * @param {string} html
 * @param {string} finalUrl
 * @returns {string|null}
 */
export function extractSiteYoutube(html, finalUrl) {
  for (const match of String(html ?? '').matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(match[0], 'href');
    if (!href) continue;
    let url;
    try { url = new URL(decodeEntities(href), finalUrl); } catch { continue; }
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) continue;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0]?.startsWith('@') && /^@[A-Za-z0-9._-]{1,100}$/.test(segments[0])) return `https://www.youtube.com/${segments[0]}`;
    if (segments[0] === 'channel' && /^UC[\w-]{22}$/.test(segments[1] ?? '')) return `https://www.youtube.com/channel/${segments[1]}`;
  }
  return null;
}
