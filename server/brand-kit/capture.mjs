/**
 * Static brand kit capture: reads a page with a plain, bounded HTTP fetch, no
 * browser, and pulls out a plausible colour palette, font list and up to three
 * logo candidates. See docs/BRAND-KIT-SPEC.md section 6.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundedFetch, assertPublicHost, parseRobots, robotsAllows, decodeEntities, extractMeta } from '../social/backends/web.mjs';
import { parseHttpUrl } from '../social/records.mjs';
import { extractFonts } from './fonts.mjs';
import { fileName, findHeaderLogos, findIconLinks, manifestIconUrls, thirdPartyCheck, withReferencedSymbols } from './logos.mjs';

const require = createRequire(import.meta.url);
const svgSanitize = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-svg-sanitize.js'));

const MAX_STYLESHEETS = 4;
const STYLESHEET_MAX_BYTES = 512 * 1024;
const MAX_LOGO_BYTES = 256 * 1024;
const PALETTE_LIMIT = 6;
const CANDIDATE_LIMIT = 3;
const HEADER_LOGO_LIMIT = 2;
const SHARE_IMAGE_MIN_RATIO = 0.5;
const SHARE_IMAGE_MAX_RATIO = 1.6;
const MANIFEST_MAX_BYTES = 64 * 1024;

const BRAND_NAME_HINT = /(brand|primary|secondary|accent|main|theme)/i;
const STATUS_NAME = /(?:^|-)(?:error|success|warning|danger|info|alert|invalid|valid)(?:-|$)/i;
const SURFACE_NAME = /(?:^|-)(?:background|bg|surface|text|border|foreground|fg|on)(?:-|$)/i;
const VARIANT_NAME = /-(?:dark|light|hover|active|subtle|emphasis|focus|disabled|\d+)$/i;
const NEUTRAL_PENALTY = [0, 1.5, 3];

/**
 * @param {{url: string, allowPrivate?: boolean, now?: Date}} input
 * @returns {Promise<{status: 'complete'|'partial'|'failed'|'unavailable', method: 'static', code: string|null, reason: string|null, finalUrl: string|null, candidates: Array<{id: string, kind: 'header_img'|'apple_touch_icon'|'og_image'|'icon', buffer: Buffer, mimeType: string, width: number|null, height: number|null, sourceUrl: string}>, palette: Array<{value: string, role: string}>, fonts: Array<{family: string, use: string}>}>}
 */
export async function captureBrandKit({ url, allowPrivate = false, now = new Date() }) {
  void now; // reserved for future time based decisions (capture id assignment happens upstream)

  const parsed = parseHttpUrl(url);
  if (!parsed) return emptyResult({ code: 'invalid_url', reason: `"${url}" is not a web address.` });

  try {
    await assertPublicHost(parsed, allowPrivate);
  } catch (error) {
    return emptyResult({ code: 'private_address', reason: error instanceof Error ? error.message : String(error) });
  }

  let robots = { rules: [], crawlDelayS: null };
  try {
    const robotsResult = await boundedFetch(`${parsed.origin}/robots.txt`, {
      allowPrivate,
      timeoutMs: 10_000,
      maxBytes: 512 * 1024,
      headers: { Accept: 'text/plain,*/*;q=0.5' },
    });
    if (robotsResult.ok) robots = parseRobots(robotsResult.body);
    else if (robotsResult.status === 401 || robotsResult.status === 403) {
      return emptyResult({ code: 'unsupported', reason: 'The site refuses to share its robots.txt, so it is treated as closed to automated readers.' });
    }
  } catch {
    // robots.txt unreachable for network reasons: fall through, the page fetch reports the real problem.
  }
  if (!robotsAllows(robots, parsed.pathname + parsed.search)) {
    return emptyResult({ code: 'unsupported', reason: 'robots.txt asks automated readers not to open this page.' });
  }

  let page;
  try {
    page = await boundedFetch(parsed.href, { allowPrivate, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? /** @type {any} */ (error).code : 'network';
    return emptyResult({ code, reason: error instanceof Error ? error.message : String(error) });
  }
  if (!page.ok) return emptyResult({ code: 'blocked', reason: `The site answered ${page.status}.`, finalUrl: page.final_url });

  const html = page.body;
  const finalUrl = page.final_url;
  const meta = extractMeta(html);

  const cssTexts = [collectInlineStyle(html)];
  const stylesheetHrefs = collectStylesheetHrefs(html, finalUrl, new URL(finalUrl).origin).slice(0, MAX_STYLESHEETS);
  for (const href of stylesheetHrefs) {
    try {
      const sheet = await boundedFetch(href, { allowPrivate, timeoutMs: 10_000, maxBytes: STYLESHEET_MAX_BYTES });
      if (sheet.ok) cssTexts.push(sheet.body);
    } catch {
      // A stylesheet that cannot be read contributes nothing.
    }
  }
  const css = cssTexts.join('\n');

  const palette = extractPalette(meta, html, css);
  const fonts = extractFonts(css, html);
  const candidates = await collectLogoCandidates({ html, meta, finalUrl, allowPrivate });

  const foundLogo = candidates.length > 0;
  const foundColor = palette.some((entry) => entry.role !== 'background');
  const status = foundLogo && foundColor ? 'complete' : foundLogo || foundColor ? 'partial' : 'failed';
  const reason = status === 'failed' ? 'No logo or colour could be found on the page.' : null;

  return { status, method: 'static', code: null, reason, finalUrl, candidates, palette, fonts };
}

/**
 * @param {{code: string, reason: string, finalUrl?: string|null}} input
 */
function emptyResult({ code, reason, finalUrl = null }) {
  const status = code === 'private_address' || code === 'invalid_url' || code === 'unsupported' ? 'unavailable' : 'failed';
  return { status, method: 'static', code, reason, finalUrl, candidates: [], palette: [], fonts: [] };
}

/** @param {string} html */
function collectInlineStyle(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @param {string} origin
 */
function collectStylesheetHrefs(html, baseUrl, origin) {
  const hrefs = [];
  for (const match of html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
    const href = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let absolute;
    try {
      absolute = new URL(decodeEntities(href), baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    hrefs.push(absolute.href);
  }
  return hrefs;
}

/**
 * @param {Record<string, string>} meta
 * @param {string} html
 * @param {string} css
 */
function extractPalette(meta, html, css) {
  /** @type {Array<{hex: string, weight: number}>} */
  const found = [];

  if (meta['theme-color']) addColor(found, meta['theme-color'], 5);
  if (meta['msapplication-tilecolor']) addColor(found, meta['msapplication-tilecolor'], 3);

  const maskIconTag = html.match(/<link\b[^>]*rel\s*=\s*["']mask-icon["'][^>]*>/i)?.[0];
  if (maskIconTag) {
    const color = maskIconTag.match(/\bcolor\s*=\s*["']([^"']+)["']/i)?.[1];
    if (color) addColor(found, color, 3);
  }

  for (const match of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) {
    const name = match[1];
    if (!BRAND_NAME_HINT.test(name) || STATUS_NAME.test(name)) continue;
    if (SURFACE_NAME.test(name)) continue;
    const base = /primary/i.test(name) ? 6 : /secondary|accent/i.test(name) ? 4 : /brand/i.test(name) ? 6 : 2;
    const weight = VARIANT_NAME.test(name) ? 1 : base;
    addColor(found, match[2], weight);
  }

  for (const match of css.matchAll(/(?:^|[};,\s])(?:\.btn|button|a)(?::[a-z-]+)?\s*\{([^}]*)\}/gi)) {
    for (const colorMatch of match[1].matchAll(/\b(?:background(?:-color)?|color)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) {
      addColor(found, colorMatch[1], 1);
    }
  }

  /** @type {Map<string, {hex: string, weight: number}>} */
  const merged = new Map();
  for (const entry of found) {
    const existing = merged.get(entry.hex);
    if (existing) existing.weight += entry.weight;
    else merged.set(entry.hex, { hex: entry.hex, weight: entry.weight });
  }
  const score = (entry) => entry.weight - NEUTRAL_PENALTY[colorTier(entry.hex)];
  const ranked = [...merged.values()].sort((a, b) => (colorTier(a.hex) === 2) - (colorTier(b.hex) === 2) || score(b) - score(a) || colorTier(a.hex) - colorTier(b.hex));
  const roles = ['primary', 'secondary', 'accent'];
  return ranked.slice(0, PALETTE_LIMIT).map((entry) => ({ value: entry.hex, role: colorTier(entry.hex) === 2 ? 'background' : roles.shift() ?? 'other' }));
}

/** @param {string} hex */
function colorTier(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  if (Math.min(r, g, b) >= 240) return 2;
  return Math.max(r, g, b) - Math.min(r, g, b) < 20 ? 1 : 0;
}

/**
 * @param {Array<{hex: string, weight: number}>} list
 * @param {string} raw
 * @param {number} weight
 */
function addColor(list, raw, weight) {
  const hex = normalizeColor(raw);
  if (hex) list.push({ hex, weight });
}

/** @param {string} raw */
function normalizeColor(raw) {
  const value = String(raw).trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 8) hex = hex.slice(0, 6);
    return `#${hex.toUpperCase()}`;
  }
  const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1, 4).map(Number);
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) {
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }
  }
  return null;
}

/** @param {{width: number|null, height: number|null}} image */
function isLogoShaped(image) {
  if (!image.width || !image.height) return true;
  const ratio = image.width / image.height;
  return ratio >= SHARE_IMAGE_MIN_RATIO && ratio <= SHARE_IMAGE_MAX_RATIO;
}

/** @param {Buffer} buffer */
function classifyLogoBytes(buffer) {
  if (svgSanitize.looksLikeSvg(buffer)) {
    const clean = svgSanitize.sanitizeSvg(buffer, { maxInputBytes: MAX_LOGO_BYTES });
    if (!clean.ok || clean.danglingUse || !rendersSomething(clean.svg)) return null;
    return { buffer: clean.buffer, mimeType: 'image/svg+xml', width: clean.width, height: clean.height };
  }
  const info = imageInfo(buffer);
  if (!info || (info.mimeType !== 'image/png' && info.mimeType !== 'image/jpeg' && info.mimeType !== 'image/webp')) return null;
  return { buffer, mimeType: info.mimeType, width: info.width, height: info.height };
}

/** @param {string} svg */
function rendersSomething(svg) {
  const visible = svg.replace(/<(defs|symbol|clipPath|mask|pattern|marker|linearGradient|radialGradient|filter)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  return /<(?:path|rect|circle|ellipse|polygon|polyline|line|text|use)\b/.test(visible);
}

/**
 * @param {{html: string, meta: Record<string, string>, finalUrl: string, allowPrivate: boolean}} input
 */
async function collectLogoCandidates({ html, meta, finalUrl, allowPrivate }) {
  /** @type {Array<{kind: 'header_img'|'apple_touch_icon'|'og_image'|'icon', url: string|null, inline?: string}>} */
  const picks = [];

  for (const logo of findHeaderLogos(html, meta, finalUrl).slice(0, HEADER_LOGO_LIMIT)) picks.push(logo);

  const appleIcon = findLargestAppleTouchIcon(html);
  if (appleIcon) picks.push({ kind: 'apple_touch_icon', url: resolveUrl(appleIcon, finalUrl) });

  const iconLinks = findIconLinks(html, finalUrl);
  for (const url of iconLinks.svgIcons.slice(0, 1)) picks.push({ kind: 'icon', url });
  if (iconLinks.manifest) picks.push({ kind: 'icon', url: null, manifest: iconLinks.manifest });

  if (meta['og:image']) picks.push({ kind: 'og_image', url: resolveUrl(meta['og:image'], finalUrl) });

  /** @type {Array<{id: string, kind: string, buffer: Buffer, mimeType: string, width: number|null, height: number|null, sourceUrl: string}>} */
  const candidates = [];
  const tried = new Set();
  const namesThirdPartyBrand = thirdPartyCheck(html, meta, finalUrl);
  let n = 1;
  const accept = (kind, sourceUrl, classified) => {
    if (candidates.some((existing) => Buffer.compare(existing.buffer, classified.buffer) === 0)) return;
    candidates.push({ id: `c${n}`, kind, buffer: classified.buffer, mimeType: classified.mimeType, width: classified.width, height: classified.height, sourceUrl });
    n += 1;
  };
  for (const pick of picks) {
    if (candidates.length >= CANDIDATE_LIMIT) break;
    if (pick.inline) {
      const classified = classifyLogoBytes(Buffer.from(withReferencedSymbols(pick.inline, html), 'utf8'));
      if (classified) accept(pick.kind, pick.url, classified);
      continue;
    }
    let urls = pick.url ? [pick.url] : [];
    if (pick.manifest) urls = await manifestIcons(pick.manifest, allowPrivate);
    for (const url of urls) {
      if (candidates.length >= CANDIDATE_LIMIT || tried.has(url)) continue;
      tried.add(url);
      if (pick.kind !== 'header_img' && namesThirdPartyBrand(fileName(url))) continue;
      let fetched;
      try {
        fetched = await boundedFetch(url, { allowPrivate, raw: true, timeoutMs: 10_000, maxBytes: MAX_LOGO_BYTES, headers: { Accept: 'image/svg+xml,image/*;q=0.8,*/*;q=0.5' } });
      } catch {
        continue;
      }
      if (!fetched.ok || fetched.truncated || !fetched.buffer || fetched.buffer.length === 0) continue;
      if (fetched.bytes > MAX_LOGO_BYTES) continue;
      const classified = classifyLogoBytes(fetched.buffer);
      if (classified && (pick.kind !== 'og_image' || isLogoShaped(classified))) accept(pick.kind, url, classified);
    }
  }
  return candidates;
}

/**
 * @param {string} manifestUrl
 * @param {boolean} allowPrivate
 */
async function manifestIcons(manifestUrl, allowPrivate) {
  try {
    const manifest = await boundedFetch(manifestUrl, { allowPrivate, timeoutMs: 10_000, maxBytes: MANIFEST_MAX_BYTES, headers: { Accept: 'application/manifest+json,application/json;q=0.9,*/*;q=0.5' } });
    return manifest.ok ? manifestIconUrls(manifest.body, manifest.final_url) : [];
  } catch {
    return [];
  }
}

/** @param {string} html */
function findLargestAppleTouchIcon(html) {
  let best = null;
  let bestSize = -1;
  for (const match of html.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) {
    const tag = match[0];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const sizesAttr = tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i)?.[1];
    const size = sizesAttr ? Number(sizesAttr.split(/x/i)[0]) || 0 : 0;
    if (size > bestSize) {
      bestSize = size;
      best = decodeEntities(href);
    }
  }
  return best;
}

/**
 * @param {string} href
 * @param {string} base
 */
function resolveUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Magic byte image inspection, no dependencies: PNG IHDR, JPEG SOF0/SOF2, WebP VP8/VP8L/VP8X.
 * @param {Buffer} buffer
 * @returns {{mimeType: string, width: number|null, height: number|null}|null}
 */
export function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length < 24) return null;
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9) break;
      const length = buffer.readUInt16BE(offset + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return { mimeType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return { mimeType: 'image/jpeg', width: null, height: null };
  }

  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      return { mimeType: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { mimeType: 'image/webp', width, height };
    }
    if (chunk === 'VP8X') {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { mimeType: 'image/webp', width, height };
    }
    return { mimeType: 'image/webp', width: null, height: null };
  }

  return null;
}
