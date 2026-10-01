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
import { isIP } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { boundedFetch, assertPublicHost, parseRobots, robotsAllows, decodeEntities, extractMeta } from '../social/backends/web.mjs';
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

/**
 * A short curated list of two label public suffixes, so a registrable domain check does
 * not mistake "example.co.uk" for the whole of ".co.uk". This project stays at zero npm
 * dependencies, so a full public suffix list is out of reach; this covers the common cases.
 */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.nz', 'org.nz', 'govt.nz', 'net.nz',
  'co.za', 'org.za', 'net.za',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'com.sg', 'com.hk', 'co.kr', 'co.id', 'com.tr', 'com.ar', 'com.cn', 'com.tw',
]);

function isIpLiteral(host) {
  return isIP(host.replace(/^\[|\]$/g, '')) !== 0;
}

/** @param {string} hostname */
function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || isIpLiteral(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && TWO_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

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

/** @param {unknown} image */
function firstImageValue(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    for (const entry of image) {
      const value = firstImageValue(entry);
      if (value) return value;
    }
    return null;
  }
  if (typeof image === 'object') {
    if (typeof image.url === 'string') return image.url;
    if (typeof image.contentUrl === 'string') return image.contentUrl;
  }
  return null;
}

/** @param {unknown} node */
function productImageFrom(node) {
  if (!node || typeof node !== 'object') return null;
  const type = node['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (!isProduct) return null;
  return firstImageValue(node.image);
}

/** @param {string} html */
function findJsonLdProductImage(html) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const nodes = Array.isArray(data) ? data : Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    for (const node of nodes) {
      const image = productImageFrom(node);
      if (image) return image;
    }
  }
  return null;
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

/** @param {string} html @param {string[]} words @param {string} baseUrl */
function findLargestMatchingImg(html, words, baseUrl) {
  let best = null;
  let bestArea = -1;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    const haystack = `${alt} ${src}`.toLowerCase();
    if (words.length > 0 && !words.some((word) => haystack.includes(word))) continue;
    const width = Number(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
    const height = Number(tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] || 0);
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      best = decodeEntities(src);
    }
  }
  return best ? resolveUrl(best, baseUrl) : null;
}

/**
 * The main product image address on a fetched page, or null. JSON-LD Product.image first,
 * then og:image, then the largest <img> whose alt or src matches the job's own product words.
 */
function findProductImageUrl({ html, meta, finalUrl, words }) {
  const jsonLd = findJsonLdProductImage(html);
  if (jsonLd) {
    const resolved = resolveUrl(jsonLd, finalUrl);
    if (resolved) return resolved;
  }
  if (meta['og:image']) {
    const resolved = resolveUrl(meta['og:image'], finalUrl);
    if (resolved) return resolved;
  }
  return findLargestMatchingImg(html, words, finalUrl);
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
      const imageUrl = findProductImageUrl({ html, meta, finalUrl: page.final_url, words });
      if (!imageUrl) return { status: 'not_found' };
      const imageParsed = parseHttpUrl(imageUrl);
      if (!imageParsed || !sameOfficialDomain(imageParsed.hostname, declaredParsed.hostname)) {
        return { status: 'not_found' };
      }

      let fetched;
      try {
        fetched = await boundedFetch(imageUrl, { allowPrivate, raw: true, timeoutMs: 15_000, maxBytes: MAX_IMAGE_BYTES });
      } catch {
        return { status: 'not_found' };
      }
      if (!fetched.ok || fetched.truncated || !fetched.buffer || fetched.buffer.length === 0) return { status: 'not_found' };
      if (fetched.bytes > MAX_IMAGE_BYTES) return { status: 'not_found' };
      const info = imageInfo(fetched.buffer);
      if (!info) return { status: 'not_found' };

      const tmpDir = mkdtempSync(join(tmpdir(), 'sc-product-photo-'));
      try {
        const tmpFile = join(tmpDir, `photo.${EXT_FOR_MIME[info.mimeType]}`);
        writeFileSync(tmpFile, fetched.buffer);
        // The photo is the brand's own, from its own site: attach it as that, so the licence text and
        // the route's rights flags are worked out together rather than patched after the re-route.
        runtime.attachOfficialProductPhoto({ root, brand: brand.slug, jobId, path: tmpFile }, imageUrl);
        return { status: 'attached', sourceUrl: imageUrl };
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
      }
    },
  ),
];
