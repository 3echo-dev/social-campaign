/**
 * Logo candidates for a brand kit, only from the brand's own places.
 *
 * A candidate comes from one of two kinds of source and from nowhere else:
 *   the brand's website  the logo in the page's header, its high resolution touch icon or icon, and the sharing image only when its
 *                        address says logo (see site-logos.mjs), downloaded only from the website's own host or a site builder's
 *                        asset host the page itself points at;
 *   the brand's accounts the profile pictures of the TikTok, Instagram, Facebook and YouTube accounts on file (and the YouTube channel
 *                        the website links to), read the way the research tools read a profile, downloaded only from that
 *                        platform's own picture hosts.
 * No search engine, image search, logo database, encyclopedia or any other third-party page is ever asked. An address on a host that is
 * not the brand's own is dropped by code, and so is a redirect that leaves it.
 *
 * Each picture is downloaded with a size cap, checked by its first bytes (PNG, JPEG, WebP or SVG only), fingerprinted so the same picture
 * on two accounts is one candidate, ranked and cut to three. Nothing here decides whether a picture is really the brand's mark: the
 * model looks at each candidate before it is offered (skills/onboard-brand/SKILL.md), and the person has the last word.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundedFetch, sameBrandHost, registrableDomain } from '../social/backends/web.mjs';
import { parseHandle } from '../social/records.mjs';
import { isPlatformPictureHost, profilePictureUrl } from './profile-picture.mjs';
import { averageHash, coloursFromSvg, dominantColours, decodeRgba, hamming, hasTransparency, SAME_PICTURE_BITS } from './palette.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const libBrandKit = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-brand-kit.js'));

export const MAX_CANDIDATES = 3;
/** The most a picture may weigh as downloaded, then the most the kit keeps (the kit's own logo file limit). */
export const FETCH_MAX_BYTES = 1024 * 1024;
export const KEEP_MAX_BYTES = 256 * 1024;
/** A thumbnail for the board is inlined in the workspace projection (which has a 200 KiB budget), so it is kept small: 6 KiB at most. */
export const THUMB_MAX_BYTES = 6 * 1024;
const SVG_THUMB_MAX_BYTES = 12 * 1024;
const MIN_EDGE = 64;
const MIN_ICON_EDGE = 120;
const MAX_EDGE_BEFORE_SHRINK = 1024;
const MAX_ASPECT = 8;
const FETCH_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook'];

/** What each source is worth before anything else counts: the website's header logo over its icon, an account's picture alongside. */
export const SOURCE_RANK = Object.freeze({
  website_header: 50, instagram: 38, tiktok: 37, youtube: 36, facebook: 35, website_icon: 30, website_og: 25,
});

/** Hosts that serve a site's own assets for the site builders most brands use. A page pointing at one of them is pointing at its own file. */
const SITE_ASSET_HOSTS = Object.freeze([
  /(^|\.)cdn\.shopify\.com$/i, /(^|\.)myshopify\.com$/i, /(^|\.)shopifycdn\.(com|net)$/i, /(^|\.)wixstatic\.com$/i,
  /(^|\.)squarespace-cdn\.com$/i, /(^|\.)squarespace\.com$/i, /(^|\.)website-files\.com$/i, /(^|\.)webflow\.(com|io)$/i,
  /(^|\.)wp\.com$/i, /(^|\.)wordpress\.com$/i, /(^|\.)cloudfront\.net$/i, /(^|\.)cloudinary\.com$/i, /(^|\.)imgix\.net$/i,
  /(^|\.)ctfassets\.net$/i, /(^|\.)sanity\.io$/i, /(^|\.)prismic\.io$/i, /(^|\.)framerusercontent\.com$/i,
  /(^|\.)bigcommerce\.com$/i, /(^|\.)azureedge\.net$/i, /(^|\.)b-cdn\.net$/i, /(^|\.)amazonaws\.com$/i,
]);

/** Search engines, image search, logo databases and reference sites: never a source, whatever else matches. */
const NEVER_HOSTS = Object.freeze([
  /(^|\.)google\.[a-z.]+$/i, /(^|\.)gstatic\.com$/i, /(^|\.)bing\.(com|net)$/i, /(^|\.)duckduckgo\.com$/i, /(^|\.)yahoo\.com$/i,
  /(^|\.)yandex\.[a-z.]+$/i, /(^|\.)baidu\.com$/i, /(^|\.)ecosia\.org$/i, /(^|\.)startpage\.com$/i, /(^|\.)wikipedia\.org$/i,
  /(^|\.)wikimedia\.org$/i, /(^|\.)clearbit\.com$/i, /(^|\.)brandfetch\.(com|io)$/i, /(^|\.)logo\.dev$/i, /(^|\.)pinterest\.[a-z.]+$/i,
  /(^|\.)flickr\.com$/i, /(^|\.)shutterstock\.com$/i, /(^|\.)gettyimages\.[a-z.]+$/i, /(^|\.)logos-world\.net$/i, /(^|\.)seeklogo\.com$/i,
]);

/**
 * Whether an image address is on a host that belongs to the brand for this kind of source. A website picture must be on the website's
 * own host (any subdomain, any suffix of the same name) or a site builder's asset host. An account picture must be on that platform's
 * own picture hosts. A search engine, a logo database or a reference site is refused for every source.
 * @param {string} source one of the SOURCE_RANK keys.
 * @param {string} imageUrl
 * @param {string|null} [siteUrl] the website the page came from.
 * @returns {boolean}
 */
export function isOwnImageHost(source, imageUrl, siteUrl = null) {
  let url;
  try { url = new URL(imageUrl); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  const isWebsite = source.startsWith('website_');
  if (!isWebsite && PLATFORMS.includes(source)) {
    // A platform's own hosts include Google's for YouTube pictures, so the never list does not apply to them.
    return isPlatformPictureHost(/** @type {any} */ (source), imageUrl);
  }
  if (!isWebsite) return false;
  if (NEVER_HOSTS.some((pattern) => pattern.test(host)) || /(^|\.)googleusercontent\.com$/i.test(host)) return false;
  let siteHost = null;
  try { siteHost = siteUrl ? new URL(siteUrl).hostname.toLowerCase() : null; } catch { siteHost = null; }
  if (siteHost && (registrableDomain(host) === registrableDomain(siteHost) || sameBrandHost(host, siteHost))) return true;
  return SITE_ASSET_HOSTS.some((pattern) => pattern.test(host));
}

/** The website kinds that count as one place when ranking: a header logo and an icon of the same site are one source. */
const kindOf = (source) => (source.startsWith('website_') ? 'website' : source);

// ------------------------------------------------------------------ the work with ffmpeg

/**
 * Run ffmpeg on bytes from stdin and collect what it writes to stdout.
 * @param {string[]} args
 * @param {Buffer} input
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer|null>}
 */
function ffmpegBuffer(args, input, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', ...args, 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      const out = Buffer.concat(chunks);
      finish(code === 0 && out.length ? out : null);
    });
    child.stdin.end(input);
  });
}

/**
 * A raster picture made to fit the kit: at most 512 pixels on a side, a PNG when it has see-through parts (a logo on nothing) and a
 * JPEG otherwise. Returns null when ffmpeg is missing or the picture cannot be made small enough.
 * @param {Buffer} buffer
 * @param {boolean} alpha
 * @returns {Promise<{buffer: Buffer, mimeType: string}|null>}
 */
export async function shrinkImage(buffer, alpha) {
  const fit = 'scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2';
  const png = await ffmpegBuffer(['-frames:v', '1', '-vf', fit, '-f', 'image2pipe', '-vcodec', 'png'], buffer);
  if (png && png.length <= KEEP_MAX_BYTES && alpha) return { buffer: png, mimeType: 'image/png' };
  for (const quality of ['3', '8', '14']) {
    const jpeg = await ffmpegBuffer(['-frames:v', '1', '-vf', fit, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', quality], buffer);
    if (jpeg && jpeg.length <= KEEP_MAX_BYTES) return { buffer: jpeg, mimeType: 'image/jpeg' };
  }
  return png && png.length <= KEEP_MAX_BYTES ? { buffer: png, mimeType: 'image/png' } : null;
}

/**
 * A small preview for the board, at most THUMB_MAX_BYTES: a PNG when the picture has see-through parts, else a JPEG, made smaller until it fits.
 * @param {Buffer} buffer
 * @param {boolean} alpha
 * @returns {Promise<{buffer: Buffer, mimeType: string}|null>}
 */
export async function makeThumbnail(buffer, alpha) {
  for (const height of [96, 72, 56, 40]) {
    const scale = `scale=-2:${height}`;
    if (alpha) {
      const png = await ffmpegBuffer(['-frames:v', '1', '-vf', scale, '-f', 'image2pipe', '-vcodec', 'png'], buffer);
      if (png && png.length <= THUMB_MAX_BYTES) return { buffer: png, mimeType: 'image/png' };
    } else {
      const jpeg = await ffmpegBuffer(['-frames:v', '1', '-vf', scale, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6'], buffer);
      if (jpeg && jpeg.length <= THUMB_MAX_BYTES) return { buffer: jpeg, mimeType: 'image/jpeg' };
      const png = await ffmpegBuffer(['-frames:v', '1', '-vf', scale, '-f', 'image2pipe', '-vcodec', 'png'], buffer);
      if (png && png.length <= THUMB_MAX_BYTES) return { buffer: png, mimeType: 'image/png' };
    }
  }
  return null;
}

// ------------------------------------------------------------------ one candidate

/** @param {string} url @param {boolean} allowPrivate @param {(to: URL) => boolean} stays */
async function downloadImage(url, allowPrivate, stays) {
  const fetched = await boundedFetch(url, {
    allowPrivate,
    raw: true,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: FETCH_MAX_BYTES,
    headers: { Accept: 'image/*,*/*;q=0.5' },
    onRedirect: (_from, to) => stays(to),
  });
  if (fetched.redirect_to) return { ok: false, reason: 'it redirected away from the brand\'s own address' };
  if (!fetched.ok || !fetched.buffer || fetched.buffer.length === 0) return { ok: false, reason: `the address answered ${fetched.status}` };
  if (fetched.truncated) return { ok: false, reason: 'the picture is larger than 1 MB' };
  return { ok: true, buffer: fetched.buffer, finalUrl: fetched.final_url };
}

/**
 * Download one reference and turn it into a candidate, or say why not.
 * @returns {Promise<{candidate: object}|{dropped: {url: string, source: string, reason: string}}>}
 */
async function prepare(ref, context) {
  const { siteUrl, allowPrivate, fetchImage, decode, shrink, thumbnail } = context;
  const drop = (reason) => ({ dropped: { url: ref.url, source: ref.source, reason } });
  if (!isOwnImageHost(ref.source, ref.url, siteUrl)) return drop('the address is not on one of the brand\'s own hosts');
  let got;
  try {
    got = await fetchImage(ref.url, allowPrivate, (to) => isOwnImageHost(ref.source, to.href, siteUrl));
  } catch (error) {
    return drop(`it could not be downloaded (${error instanceof Error ? error.message : String(error)})`.slice(0, 160));
  }
  if (!got.ok) return drop(got.reason);
  if (!isOwnImageHost(ref.source, got.finalUrl ?? ref.url, siteUrl)) return drop('it ended on a host that is not the brand\'s own');
  const info = libBrandKit.inspectImage(got.buffer);
  if (!info) return drop('it is not a PNG, JPEG, WebP or SVG picture');
  const isSvg = info.mimeType === 'image/svg+xml';
  const width = Number.isFinite(info.width) ? info.width : null;
  const height = Number.isFinite(info.height) ? info.height : null;
  const edge = width && height ? Math.min(width, height) : null;
  if (!isSvg && edge !== null && edge < (ref.source === 'website_icon' ? MIN_ICON_EDGE : MIN_EDGE)) return drop(`it is only ${width} by ${height} pixels`);
  if (width && height && Math.max(width, height) / Math.max(1, Math.min(width, height)) > MAX_ASPECT) return drop('its shape is not a logo\'s');

  if (isSvg) {
    const svg = info.buffer;
    if (svg.length > KEEP_MAX_BYTES) return drop('the SVG is larger than 256 KB');
    return {
      candidate: {
        source: ref.source, sources: [ref.source], url: ref.url, buffer: svg, mimeType: 'image/svg+xml', width, height,
        thumbBuffer: svg.length <= SVG_THUMB_MAX_BYTES ? svg : null, thumbMimeType: svg.length <= SVG_THUMB_MAX_BYTES ? 'image/svg+xml' : null,
        hash: `svg:${createHash('sha1').update(svg).digest('hex').slice(0, 24)}`,
        colours: coloursFromSvg(svg).map((entry) => entry.hex),
      },
    };
  }

  const decoded = await decode(got.buffer);
  let hash = `raw:${createHash('sha1').update(got.buffer).digest('hex').slice(0, 24)}`;
  let colours = [];
  let alpha = info.mimeType === 'image/png' || info.mimeType === 'image/webp';
  if (decoded.ok) {
    hash = averageHash(decoded.pixels, decoded.size);
    colours = dominantColours([decoded.pixels]).map((entry) => entry.hex);
    alpha = hasTransparency(decoded.pixels);
  }
  let buffer = got.buffer;
  let mimeType = info.mimeType;
  let outWidth = width;
  let outHeight = height;
  if (buffer.length > KEEP_MAX_BYTES || Math.max(width ?? 0, height ?? 0) > MAX_EDGE_BEFORE_SHRINK) {
    const smaller = decoded.ok ? await shrink(buffer, alpha) : null;
    if (!smaller) return drop('it is too large for the brand kit and could not be made smaller on this computer');
    buffer = smaller.buffer;
    mimeType = smaller.mimeType;
    const reread = libBrandKit.imageInfo(buffer);
    outWidth = reread?.width ?? null;
    outHeight = reread?.height ?? null;
  }
  let thumb = decoded.ok ? await thumbnail(buffer, alpha) : null;
  if (!thumb && buffer.length <= THUMB_MAX_BYTES) thumb = { buffer, mimeType };
  return {
    candidate: {
      source: ref.source, sources: [ref.source], url: ref.url, buffer, mimeType, width: outWidth, height: outHeight,
      thumbBuffer: thumb ? thumb.buffer : null, thumbMimeType: thumb ? thumb.mimeType : null, hash, colours,
    },
  };
}

/** Run `task` over `items` with at most `limit` in flight, keeping the order. */
async function mapLimited(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next;
      next += 1;
      out[at] = await task(items[at], at);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ------------------------------------------------------------------ dedupe and rank

const sameHash = (a, b) => (a.startsWith('svg:') || b.startsWith('svg:') || a.startsWith('raw:') || b.startsWith('raw:') ? a === b : hamming(a, b) <= SAME_PICTURE_BITS);

/**
 * One candidate for each distinct picture, ranked best first. The same picture on several of the brand's places ranks above anything
 * that appears once; then the source decides (the website's header logo over its icon), then size.
 * @param {Array<any>} candidates
 * @returns {Array<any>}
 */
export function dedupeAndRank(candidates) {
  /** @type {Array<any[]>} */
  const groups = [];
  for (const candidate of candidates) {
    const group = groups.find((members) => members.some((member) => sameHash(member.hash, candidate.hash)));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  const ranked = groups.map((members) => {
    const pixels = (item) => (item.width ?? 0) * (item.height ?? 0);
    const best = [...members].sort((a, b) => pixels(b) - pixels(a) || (SOURCE_RANK[b.source] ?? 0) - (SOURCE_RANK[a.source] ?? 0))[0];
    const sources = [...new Set(members.map((member) => member.source))].sort((a, b) => (SOURCE_RANK[b] ?? 0) - (SOURCE_RANK[a] ?? 0));
    const places = new Set(members.map((member) => kindOf(member.source)));
    const edge = best.width && best.height ? Math.min(best.width, best.height) : 0;
    const aspect = best.width && best.height ? Math.max(best.width, best.height) / Math.max(1, Math.min(best.width, best.height)) : 1;
    const score = (places.size - 1) * 100
      + Math.max(...members.map((member) => SOURCE_RANK[member.source] ?? 0))
      + Math.min(10, Math.round(edge / 64))
      - (edge && edge < 100 ? 15 : 0)
      - (aspect > 4 ? 10 : 0);
    return { ...best, sources, score };
  });
  return ranked.sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------ the entry point

/**
 * Find, download, dedupe and rank the brand's own logo candidates.
 * @param {{
 *   site?: {finalUrl?: string|null, logoRefs?: Array<{url: string, via: string}>, youtube?: string|null}|null,
 *   social?: Record<string, string|null|undefined>,
 *   allowPrivate?: boolean,
 *   workspaceRoot?: string|null,
 *   pictureUrl?: typeof profilePictureUrl,
 *   fetchImage?: (url: string, allowPrivate: boolean, stays: (to: URL) => boolean) => Promise<any>,
 *   decode?: typeof decodeRgba,
 *   shrink?: typeof shrinkImage,
 *   thumbnail?: typeof makeThumbnail,
 *   limit?: number,
 * }} [input]
 * @returns {Promise<{candidates: Array<any>, dropped: Array<{url: string, source: string, reason: string}>, accounts: Record<string, 'found'|'none'>}>}
 */
export async function collectLogoCandidates({
  site = null, social = {}, allowPrivate = false, workspaceRoot = null, pictureUrl = profilePictureUrl,
  fetchImage = downloadImage, decode = decodeRgba, shrink = shrinkImage, thumbnail = makeThumbnail, limit = MAX_CANDIDATES,
} = {}) {
  const siteUrl = site?.finalUrl ?? null;
  /** @type {Array<{url: string, source: string}>} */
  const refs = [];
  for (const ref of site?.logoRefs ?? []) {
    const source = ref.via === 'header' ? 'website_header' : ref.via === 'icon' ? 'website_icon' : ref.via === 'og' ? 'website_og' : null;
    if (source) refs.push({ url: ref.url, source });
  }

  const accounts = {};
  const profiles = { ...social };
  if (!profiles.youtube && site?.youtube) profiles.youtube = site.youtube;
  await Promise.all(PLATFORMS.map(async (platform) => {
    const profile = profiles[platform];
    if (typeof profile !== 'string' || !profile.trim() || !parseHandle(platform, profile.trim())) return;
    let url = null;
    try {
      url = await pictureUrl(platform, profile.trim(), { allowPrivate, workspaceRoot });
    } catch { url = null; }
    accounts[platform] = url ? 'found' : 'none';
    if (url) refs.push({ url, source: platform });
  }));

  const context = { siteUrl, allowPrivate, fetchImage, decode, shrink, thumbnail };
  const prepared = await mapLimited(refs, CONCURRENCY, (ref) => prepare(ref, context).catch((error) => ({ dropped: { url: ref.url, source: ref.source, reason: `it could not be read (${error instanceof Error ? error.message : String(error)})`.slice(0, 160) } })));
  const candidates = prepared.filter((item) => item.candidate).map((item) => item.candidate);
  const dropped = prepared.filter((item) => item.dropped).map((item) => item.dropped);
  return { candidates: dedupeAndRank(candidates).slice(0, limit), dropped, accounts };
}
