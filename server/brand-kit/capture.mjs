/**
 * Static brand kit capture: reads a page with a plain, bounded HTTP fetch, no
 * browser, and pulls out a plausible colour palette and font list. When the
 * website gives no colour, the palette comes from the brand's social profile
 * picture. The logo is never captured. See docs/BRAND-KIT-SPEC.md section 6.
 */

import { boundedFetch, assertPublicHost, parseRobots, robotsAllows, decodeEntities, extractMeta } from '../social/backends/web.mjs';
import { parseHttpUrl } from '../social/records.mjs';
import { extractFonts } from './fonts.mjs';
import { coloursFromProfilePicture, decodeWithFfmpeg } from './profile-picture.mjs';
import { imageInfo } from './image-info.mjs';

export { imageInfo };

const MAX_STYLESHEETS = 4;
const STYLESHEET_MAX_BYTES = 512 * 1024;
const PALETTE_LIMIT = 6;

const BRAND_NAME_HINT = /(brand|primary|secondary|accent|main|theme)/i;
const STATUS_NAME = /(?:^|-)(?:error|success|warning|danger|info|alert|invalid|valid)(?:-|$)/i;
const SURFACE_NAME = /(?:^|-)(?:background|bg|surface|text|border|foreground|fg|on)(?:-|$)/i;
const VARIANT_NAME = /-(?:dark|light|hover|active|subtle|emphasis|focus|disabled|\d+)$/i;
const NEUTRAL_PENALTY = [0, 1.5, 3];

/**
 * @param {{url?: string|null, social?: {instagram?: string|null, tiktok?: string|null, facebook?: string|null}, wantPalette?: boolean, allowPrivate?: boolean, decodeImage?: (buffer: Buffer) => Promise<{ok: true, pixels: Buffer}|{ok: false, code: string}>, profileColours?: typeof coloursFromProfilePicture}} input
 * @returns {Promise<{status: 'complete'|'partial'|'failed'|'unavailable', method: 'static', code: string|null, reason: string|null, finalUrl: string|null, palette: Array<{value: string, role: string}>, paletteSource: 'website'|'instagram'|'tiktok'|'facebook'|null, fonts: Array<{family: string, use: string}>}>}
 */
export async function captureBrandKit({ url = null, social = {}, wantPalette = true, allowPrivate = false, decodeImage = decodeWithFfmpeg, profileColours = coloursFromProfilePicture } = {}) {
  const site = url ? await readWebsite(url, allowPrivate) : emptyResult({ code: 'no_website', reason: 'No website is on file for this brand.' });
  const websiteColour = site.palette.some((entry) => entry.role !== 'background');

  let palette = site.palette;
  let paletteSource = palette.length ? 'website' : null;
  let pictureColour = false;
  let pictureMissing = false;
  if (wantPalette && !websiteColour && Object.values(social ?? {}).some(Boolean)) {
    const picture = await profileColours({ social, allowPrivate, decodeImage });
    if (picture.status === 'ok') {
      palette = rankPalette(picture.colours.map((entry) => ({ hex: entry.hex, weight: entry.share * 10 })));
      paletteSource = picture.platform;
      pictureColour = palette.some((entry) => entry.role !== 'background');
    } else if (picture.status === 'decoder_missing') {
      pictureMissing = true;
    }
  }

  const hasFonts = site.fonts.length > 0;
  if (websiteColour || (!wantPalette && hasFonts)) {
    return { ...site, status: 'complete', code: null, reason: null, palette, paletteSource };
  }
  if (pictureColour || hasFonts) {
    return { ...site, status: 'partial', code: null, reason: null, palette, paletteSource };
  }
  if (pictureMissing) {
    return { ...site, status: 'failed', code: 'decoder_missing', reason: 'We could not read colours from the social profile picture.', palette, paletteSource };
  }
  if (site.code) return { ...site, palette, paletteSource };
  return { ...site, status: 'failed', code: 'nothing_found', reason: 'We could not find colours or fonts for this brand.', palette, paletteSource };
}

/**
 * @param {string} url
 * @param {boolean} allowPrivate
 */
async function readWebsite(url, allowPrivate) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return emptyResult({ code: 'invalid_url', reason: 'That is not a web address.' });

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
      return emptyResult({ code: 'unsupported', reason: 'The site asks automated readers to stay out, so it was not opened.' });
    }
  } catch {
    // robots.txt unreachable for network reasons: fall through, the page fetch reports the real problem.
  }
  if (!robotsAllows(robots, parsed.pathname + parsed.search)) {
    return emptyResult({ code: 'unsupported', reason: 'The site asks automated readers not to open this page.' });
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

  return { status: 'complete', method: 'static', code: null, reason: null, finalUrl, palette, fonts };
}

/**
 * @param {{code: string, reason: string, finalUrl?: string|null}} input
 */
function emptyResult({ code, reason, finalUrl = null }) {
  const status = code === 'private_address' || code === 'invalid_url' || code === 'unsupported' || code === 'no_website' ? 'unavailable' : 'failed';
  return { status, method: 'static', code, reason, finalUrl, palette: [], fonts: [] };
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

  return rankPalette(found);
}

/** @param {Array<{hex: string, weight: number}>} found */
export function rankPalette(found) {
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
