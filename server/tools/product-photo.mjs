/**
 * Finds the main product photo on a brand's own official website and attaches it to a
 * job, so router rule 6c (a media job needs a product photo, pipeline/scripts/route-job.js)
 * is satisfied without asking the person for a picture they may not have handy.
 *
 * Reuses the same bounded, robots-respecting page reader as server/brand-kit/capture.mjs:
 * boundedFetch, assertPublicHost and the robots helpers from server/social/backends/web.mjs,
 * and the same magic-byte image check, imageInfo, from server/brand-kit/capture.mjs.
 *
 * Only pages on the brand's declared website (its registrable domain and any subdomain of
 * it) are ever read. Nothing else is fetched, no matter what a caller passes as pageUrl.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { boundedFetch, assertPublicHost, parseRobots, robotsAllows, decodeEntities, extractMeta, registrableDomain } from '../social/backends/web.mjs';
import { imageInfo } from '../brand-kit/capture.mjs';
import { parseHttpUrl } from '../social/records.mjs';

const require = createRequire(import.meta.url);
const brandProfileRuntime = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));

const string = { type: 'string' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function resolveBrandEntry(root, value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('A brand id or slug is required.');
  const brand = runtime.listBrands({ root }).find((entry) => entry.id === input || entry.brandId === input || entry.slug === input);
  if (!brand) throw new Error(`Brand not found: ${input}`);
  return brand;
}

/** The brand's own declared website, or null when none is on file. Mirrors server/tools/brand-kit.mjs's websiteUrl. */
function websiteUrl(brand) {
  let profile = null;
  try { profile = brandProfileRuntime.read(brand.path); } catch { profile = null; }
  const website = profile?.channels?.website;
  if (!website || website.status === 'unavailable') return null;
  return typeof website.url === 'string' ? website.url : null;
}

function allowPrivateHosts() {
  return process.env.SOCIAL_CAMPAIGN_ALLOW_PRIVATE_FETCH === '1';
}

/** Largest picture this tool will carry around, matching attachProductPhoto's own cap. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const EXT_FOR_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Whether candidateHost is the declared site itself or a subdomain of it. */
function sameOfficialDomain(candidateHost, declaredHost) {
  const candidate = registrableDomain(candidateHost);
  const declared = registrableDomain(declaredHost);
  return Boolean(candidate) && candidate === declared;
}

async function readRobots(origin, allowPrivate) {
  let robots = { rules: [], crawlDelayS: null };
  try {
    const result = await boundedFetch(`${origin}/robots.txt`, {
      allowPrivate,
      timeoutMs: 10_000,
      maxBytes: 512 * 1024,
      headers: { Accept: 'text/plain,*/*;q=0.5' },
    });
    if (result.ok) robots = parseRobots(result.body);
    else if (result.status === 401 || result.status === 403) {
      return { robots, blocked: true, reason: 'The site refuses to share its robots.txt, so it is treated as closed to automated readers.' };
    }
  } catch {
    // robots.txt unreachable for network reasons: the page fetch below reports the real problem.
  }
  return { robots, blocked: false, reason: null };
}

/** @param {string} href @param {string} base */
function resolveUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'with', 'our', 'new', 'on', 'in', 'is',
  'are', 'it', 'this', 'that', 'post', 'campaign', 'photo', 'picture', 'image', 'product',
  'make', 'create', 'about', 'from', 'your', 'you', 'we', 'us',
]);

/** Keywords a person would recognise as the product, pulled from the job's own free text. */
function productWords(job) {
  const text = [job?.title, job?.request].filter((value) => typeof value === 'string').join(' ').toLowerCase();
  const words = text.match(/[a-z0-9]+/g) || [];
  return [...new Set(words.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];
}

/**
 * The value of one attribute of a tag, or null. `src` never matches `data-src`.
 * @param {string} tag
 * @param {string} name
 * @returns {string|null}
 */
function attr(tag, name) {
  const match = tag.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match ? match[1] ?? match[2] ?? match[3] : null;
  return value === null || value === undefined ? null : decodeEntities(value).trim();
}

/**
 * Every address in a JSON-LD `image` value: a string, an ImageObject, or a list of them.
 * @param {unknown} image
 * @returns {string[]}
 */
function imageValues(image) {
  if (!image) return [];
  if (typeof image === 'string') return [image];
  if (Array.isArray(image)) return image.flatMap((entry) => imageValues(entry));
  if (typeof image === 'object') {
    const value = typeof image.url === 'string' ? image.url : typeof image.contentUrl === 'string' ? image.contentUrl : null;
    return value ? [value] : [];
  }
  return [];
}

/**
 * The Product nodes in a JSON-LD document, however it nests them.
 * @param {unknown} node
 * @param {Array<Record<string, any>>} out
 * @param {number} [depth]
 */
function collectProductNodes(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectProductNodes(entry, out, depth + 1);
    return;
  }
  const type = node['@type'];
  if ((Array.isArray(type) ? type : [type]).some((name) => name === 'Product' || name === 'ProductGroup')) out.push(node);
  for (const key of ['@graph', 'mainEntity', 'hasVariant']) collectProductNodes(node[key], out, depth + 1);
}

/**
 * Every image a JSON-LD Product carries, in page order.
 * @param {string} html
 * @returns {string[]}
 */
function jsonLdProductImages(html) {
  const images = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const products = [];
    collectProductNodes(data, products);
    for (const product of products) images.push(...imageValues(product.image));
  }
  return images;
}

/**
 * Every picture the page marks `itemprop="image"` (microdata): a meta, link or img tag.
 * @param {string} html
 * @returns {string[]}
 */
function itempropImages(html) {
  const images = [];
  for (const match of html.matchAll(/<(?:meta|link|img)\b[^>]*(?<![\w-])itemprop\s*=\s*["']image["'][^>]*>/gi)) {
    const value = attr(match[0], 'content') || attr(match[0], 'href') || attr(match[0], 'src') || attr(match[0], 'data-src');
    if (value) images.push(value);
  }
  return images;
}

/**
 * The widest address in a srcset.
 * @param {string|null} srcset
 * @returns {string|null}
 */
function widestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestSize = -1;
  for (const part of srcset.split(',')) {
    const [address, size] = part.trim().split(/\s+/);
    if (!address) continue;
    const value = Number.parseFloat(size ?? '1') || 1;
    if (value > bestSize) {
      bestSize = value;
      best = address;
    }
  }
  return best;
}

/** How many of a page's own pictures are carried forward as candidates, best first. */
const MAX_PAGE_IMAGES = 3;

/**
 * The pictures on the page itself that look like the product: named like it (by the job's own words) or sitting in
 * a product card, and not declared tiny. Best first.
 * @param {string} html
 * @param {string[]} words
 * @returns {Array<{address: string, alt: string, score: number, area: number}>}
 */
function pageImages(html, words) {
  const scored = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const address = widestFromSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset')) || attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'data-original');
    if (!address || /^data:/i.test(address) || address.includes('{')) continue;
    const width = Number(attr(tag, 'width') || 0);
    const height = Number(attr(tag, 'height') || 0);
    if ((width && width < 150) || (height && height < 150)) continue;
    const alt = attr(tag, 'alt') || '';
    const haystack = `${alt} ${address} ${attr(tag, 'class') || ''}`.toLowerCase();
    const before = html.slice(Math.max(0, (match.index ?? 0) - 500), match.index);
    let score = 0;
    if (words.length > 0 && words.some((word) => haystack.includes(word))) score += 3;
    if (haystack.includes('product') || /(?:class|id|href)\s*=\s*["'][^"']*product/i.test(before)) score += 2;
    if (score === 0) continue;
    scored.push({ address, alt, score, area: width * height });
  }
  scored.sort((a, b) => b.score - a.score || b.area - a.area);
  return scored.slice(0, MAX_PAGE_IMAGES);
}

/**
 * Words in a picture's address that say it is page furniture or share art, not a photo of the product.
 * Matched against whole words, so "dog" never counts as "og".
 */
const NOT_A_PRODUCT_WORDS = new Set([
  'banner', 'banners', 'og', 'ogimage', 'opengraph', 'share', 'sharing', 'social', 'logo', 'logos', 'favicon', 'sprite', 'sprites',
  'placeholder', 'default', 'icon', 'icons', 'avatar', 'splash', 'facebook', 'twitter', 'blank', 'spacer', 'pixel', 'noimage',
]);

/** The same, for the alt text of a picture, where a few of those words are ordinary words about a product. */
const NOT_A_PRODUCT_ALT_WORDS = new Set(['banner', 'logo', 'logos', 'icon', 'icons', 'avatar', 'favicon']);

/**
 * The word that gives a picture away as not being a product photo, or null.
 * @param {string} address
 * @param {string} [alt]
 * @returns {string|null}
 */
function notAProductWord(address, alt = '') {
  const split = (text) => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let path = address;
  try { path = new URL(address).pathname; } catch { /* a bare path is split as it is */ }
  return split(path).find((word) => NOT_A_PRODUCT_WORDS.has(word)) ?? split(alt).find((word) => NOT_A_PRODUCT_ALT_WORDS.has(word)) ?? null;
}

/** A product photo is wider than tall by at most this much; the 1.91 : 1 share card every site publishes as og:image is past it. */
const MAX_PRODUCT_ASPECT = 1.85;
/** ...and not a thin strip either. */
const MIN_PRODUCT_ASPECT = 0.4;
/** The shorter side of a usable photo, in pixels. */
const MIN_PRODUCT_SIDE = 300;
/** Pictures downloaded to be measured, at most, before giving up. */
const MAX_IMAGES_TRIED = 4;

/**
 * Why a picture of this size cannot be the main product photo, or null when its size and shape fit one.
 * @param {{width: number|null, height: number|null}} info
 * @returns {string|null}
 */
function badShape(info) {
  const { width, height } = info;
  if (!width || !height) return null; // not measurable: the other checks stand
  if (Math.min(width, height) < MIN_PRODUCT_SIDE) return `it is only ${width} by ${height} pixels`;
  const aspect = width / height;
  if (aspect > MAX_PRODUCT_ASPECT) return `it is a wide banner shape (${width} by ${height})`;
  if (aspect < MIN_PRODUCT_ASPECT) return `it is a tall strip (${width} by ${height})`;
  return null;
}

/**
 * Whether the page is about a product, which is what makes its share image (og:image) a candidate at all. A home page's
 * share image is the brand's banner or logo card; a product page's is usually the product.
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {boolean}
 */
function pageIsAboutAProduct(meta, finalUrl) {
  if ((meta['og:type'] || '').toLowerCase().includes('product')) return true;
  if (Object.keys(meta).some((name) => /^(product|og):price/.test(name))) return true;
  try {
    return /\/(products?|items?|p)\//i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

/**
 * Every picture on the page that might be the product photo, most trustworthy first: the JSON-LD Product image,
 * the microdata image, the page's own pictures that look like the product, and only then the Open Graph / Twitter
 * share image, which is usually a banner or a logo.
 * @param {{html: string, meta: Record<string, string>, finalUrl: string, words: string[]}} page
 * @returns {Array<{url: string, from: 'json-ld'|'itemprop'|'page'|'share-image', alt: string}>}
 */
function candidateImages({ html, meta, finalUrl, words }) {
  const found = [
    ...jsonLdProductImages(html).map((address) => ({ address, from: 'json-ld', alt: '' })),
    ...itempropImages(html).map((address) => ({ address, from: 'itemprop', alt: '' })),
    ...pageImages(html, words).map((image) => ({ address: image.address, from: 'page', alt: image.alt })),
    ...[meta['og:image'], meta['og:image:secure_url'], meta['twitter:image'], meta['twitter:image:src']].filter(Boolean).map((address) => ({ address, from: 'share-image', alt: '' })),
  ];
  const seen = new Set();
  const out = [];
  for (const entry of found) {
    const url = resolveUrl(entry.address, finalUrl);
    if (!url || !parseHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, from: /** @type {any} */ (entry.from), alt: entry.alt });
  }
  return out;
}

function jobFilePath(brand, jobId) {
  return join(brand.path, 'jobs', jobId, 'job.json');
}

function readJobRecord(brand, jobId) {
  const jobFile = jobFilePath(brand, jobId);
  if (!existsSync(jobFile)) throw new Error(`Job not found: ${jobId}`);
  return { jobFile, job: JSON.parse(readFileSync(jobFile, 'utf8')) };
}

export const productPhotoTools = [
  tool(
    'web_product_photo_find',
    'Find the main product photo on a brand\'s own official website and attach it to a job that needs one, so the job can carry on without a person having to supply a picture. ' +
      'Only reads pages on the brand\'s declared website domain and its subdomains, a static, robots.txt respecting read, and never returns image bytes.',
    { brand: string, jobId: string, pageUrl: { ...string, description: 'A specific product page already found by web search restricted to the brand\'s official domain. Omit to read the brand\'s declared website itself.' } },
    ['brand', 'jobId'],
    async (args, { workspace }) => {
      const root = local(workspace);
      const brand = resolveBrandEntry(root, args.brand);
      const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
      if (!jobId) throw new Error('A job id is required.');
      readJobRecord(brand, jobId); // fails fast with a clear message when the job does not exist

      const declaredUrl = websiteUrl(brand);
      if (!declaredUrl) return { status: 'refused', reason: 'No official website is on file for this brand.' };
      const declaredParsed = parseHttpUrl(declaredUrl);
      if (!declaredParsed) return { status: 'refused', reason: 'The brand\'s declared website address is not usable.' };

      const requestedUrl = typeof args.pageUrl === 'string' && args.pageUrl.trim() ? args.pageUrl.trim() : declaredUrl;
      const pageParsed = parseHttpUrl(requestedUrl);
      if (!pageParsed) return { status: 'refused', reason: `"${requestedUrl}" is not a web address.` };
      if (!sameOfficialDomain(pageParsed.hostname, declaredParsed.hostname)) {
        return { status: 'refused', reason: `${pageParsed.hostname} is not the brand's official website.` };
      }

      const allowPrivate = allowPrivateHosts();
      try {
        await assertPublicHost(pageParsed, allowPrivate);
      } catch (error) {
        return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
      }

      const robotsCheck = await readRobots(pageParsed.origin, allowPrivate);
      if (robotsCheck.blocked) return { status: 'not_found', reason: robotsCheck.reason };
      if (!robotsAllows(robotsCheck.robots, pageParsed.pathname + pageParsed.search)) {
        return { status: 'not_found', reason: 'robots.txt asks automated readers not to open this page.' };
      }

      let page;
      try {
        page = await boundedFetch(pageParsed.href, { allowPrivate, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
      } catch (error) {
        return { status: 'not_found', reason: error instanceof Error ? error.message : String(error) };
      }
      if (!page.ok) return { status: 'not_found', reason: `The page answered ${page.status}.` };

      const finalParsed = parseHttpUrl(page.final_url);
      if (!finalParsed || !sameOfficialDomain(finalParsed.hostname, declaredParsed.hostname)) {
        return { status: 'refused', reason: `The page redirected off the brand's official website to ${page.final_url}.` };
      }

      const html = page.body;
      const meta = extractMeta(html);
      const { job } = readJobRecord(brand, jobId);
      const words = productWords(job);
      const candidates = candidateImages({ html, meta, finalUrl: page.final_url, words });
      const aboutAProduct = pageIsAboutAProduct(meta, page.final_url);

      // Every candidate is judged, most trustworthy first, and the first one that is a product photo wins. A share
      // image that is a banner or a logo is never attached just because it is the only picture the page declares.
      /** @type {Array<{url: string, why: string}>} */
      const rejected = [];
      let tried = 0;
      for (const candidate of candidates) {
        if (candidate.from === 'share-image' && !aboutAProduct) {
          rejected.push({ url: candidate.url, why: 'it is the share image of a page that is not about a product' });
          continue;
        }
        const imageParsed = parseHttpUrl(candidate.url);
        if (!imageParsed || !sameOfficialDomain(imageParsed.hostname, declaredParsed.hostname)) {
          rejected.push({ url: candidate.url, why: 'it is hosted outside the brand\'s own website' });
          continue;
        }
        const word = notAProductWord(candidate.url, candidate.alt);
        if (word) {
          rejected.push({ url: candidate.url, why: `its address says "${word}", so it is site art and not a product photo` });
          continue;
        }
        if (tried >= MAX_IMAGES_TRIED) break;
        tried += 1;

        let fetched;
        try {
          fetched = await boundedFetch(candidate.url, { allowPrivate, raw: true, timeoutMs: 15_000, maxBytes: MAX_IMAGE_BYTES });
        } catch {
          rejected.push({ url: candidate.url, why: 'it could not be downloaded' });
          continue;
        }
        if (!fetched.ok || fetched.truncated || !fetched.buffer || fetched.buffer.length === 0 || fetched.bytes > MAX_IMAGE_BYTES) {
          rejected.push({ url: candidate.url, why: 'it could not be downloaded' });
          continue;
        }
        const info = imageInfo(fetched.buffer);
        if (!info) {
          rejected.push({ url: candidate.url, why: 'it is not a PNG, JPEG or WebP picture' });
          continue;
        }
        const shape = badShape(info);
        if (shape) {
          rejected.push({ url: candidate.url, why: shape });
          continue;
        }

        const tmpDir = mkdtempSync(join(tmpdir(), 'sc-product-photo-'));
        try {
          const tmpFile = join(tmpDir, `photo.${EXT_FOR_MIME[info.mimeType]}`);
          writeFileSync(tmpFile, fetched.buffer);
          // The photo is the brand's own, from its own site: attach it as that, so the licence text and
          // the route's rights flags are worked out together rather than patched after the re-route.
          runtime.attachOfficialProductPhoto({ root, brand: brand.slug, jobId, path: tmpFile }, candidate.url);
          return { status: 'attached', sourceUrl: candidate.url, found_in: candidate.from, width: info.width, height: info.height };
        } finally {
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
        }
      }
      // Nothing is attached. `not_found` is the status every caller already treats as "ask the person for the photo";
      // `code` and `reason` say plainly that the page had pictures, but none of them was a product photo.
      return {
        status: 'not_found',
        code: 'no_product_photo',
        reason: rejected.length > 0
          ? 'No product photo was found on this page; the pictures it offers are banners, logos, share art or too small to use.'
          : 'No product photo was found on this page.',
        ...(rejected.length > 0 ? { rejected: rejected.slice(0, 6) } : {}),
      };
    },
  ),
];
