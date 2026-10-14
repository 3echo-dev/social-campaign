import { spawn } from 'node:child_process';

import { boundedFetch, extractMeta } from '../social/backends/web.mjs';
import { StealthBackend } from '../social/backends/stealth.mjs';
import { PublicPageBackend } from '../social/backends/public_page.mjs';
import { TikTokPublicBackend, parseEmbedState } from '../social/backends/tiktok_public.mjs';
import { parseHandle } from '../social/records.mjs';
import { imageInfo } from './image-info.mjs';

const PLATFORM_ORDER = ['instagram', 'tiktok', 'facebook'];
const PICTURE_MAX_BYTES = 2 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 10_000;
const SAMPLE_SIZE = 32;
const MIN_SHARE = 0.03;
const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Where each platform keeps a profile picture. A picture on any other host is not that account's picture. */
const PICTURE_HOSTS = Object.freeze({
  tiktok: [/(^|\.)tiktokcdn(-us|-eu)?\.com$/i, /(^|\.)tiktokv\.(com|us|eu)$/i, /(^|\.)ibyteimg\.com$/i, /(^|\.)byteimg\.com$/i, /(^|\.)byteoversea\.com$/i, /(^|\.)muscdn\.com$/i, /(^|\.)ibytedtos\.com$/i, /^[a-z0-9-]*tiktokcdn[a-z0-9-]*\.akamaized\.net$/i, /(^|\.)tiktok\.com$/i],
  instagram: [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)instagram\.com$/i],
  facebook: [/(^|\.)fbcdn\.net$/i, /(^|\.)facebook\.com$/i, /(^|\.)fbsbx\.com$/i],
  youtube: [/(^|\.)ggpht\.com$/i, /(^|\.)googleusercontent\.com$/i, /(^|\.)ytimg\.com$/i, /(^|\.)youtube\.com$/i],
});

/**
 * Whether an address is on a host the platform serves its own pictures from.
 * @param {'instagram'|'tiktok'|'facebook'|'youtube'} platform
 * @param {string} value
 * @returns {boolean}
 */
export function isPlatformPictureHost(platform, value) {
  try {
    const url = new URL(value);
    // A platform's own static files (its app icon on a sign-in page) are not an account's picture.
    if (/^static[.-]/i.test(url.hostname) || /\/rsrc\.php(\/|$)/i.test(url.pathname)) return false;
    return (url.protocol === 'https:' || url.protocol === 'http:') && (PICTURE_HOSTS[platform] ?? []).some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

/** The first of these an object holds as an address. */
function firstAddress(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * The picture a page or profile read names for its account: an address on the platform's own picture hosts, or null.
 * @param {'instagram'|'tiktok'|'facebook'|'youtube'} platform
 * @param {unknown} value
 * @returns {string|null}
 */
function ownPicture(platform, value) {
  return typeof value === 'string' && value && isPlatformPictureHost(platform, value) ? value : null;
}

/**
 * One page through the stealth reader (Chrome's TLS fingerprint, no login), for a profile the plain read is refused for.
 * Instagram's embedded user carries the picture; the page's og:image is the picture on Facebook and as a fallback.
 */
async function pictureViaStealth(platform, url, options) {
  let stealth = options.stealth;
  if (!stealth) stealth = new StealthBackend({ workspaceRoot: options.workspaceRoot ?? null });
  if (typeof stealth.isReady === 'function' && !stealth.isReady()) return null;
  const out = await stealth.page(url, { timeoutMs: 30_000 });
  if (!out || out.ok !== true) return null;
  return ownPicture(platform, out.instagram?.user?.profilePicUrl) ?? ownPicture(platform, out.meta?.['og:image']);
}

/**
 * The address of a brand's own profile picture on one platform, read the way the research tools read the profile (no login):
 * TikTok's profile embed, Instagram and Facebook through their public page and then the stealth reader, YouTube's channel page.
 * An address on a host the platform does not serve pictures from is never returned.
 * @param {'instagram'|'tiktok'|'facebook'|'youtube'} platform
 * @param {string} url
 * @param {{allowPrivate?: boolean, pages?: {read: Function}, tiktok?: {get: Function}, stealth?: {page: Function, isReady?: Function, tiktokProfile?: Function}, workspaceRoot?: string|null, fetchHtml?: (url: string) => Promise<string|null>}} [options]
 * @returns {Promise<string|null>}
 */
export async function profilePictureUrl(platform, url, options = {}) {
  const target = parseHandle(platform, url);
  if (!target) return null;
  if (platform === 'instagram' || platform === 'facebook') {
    const pages = options.pages ?? new PublicPageBackend({ allowPrivate: options.allowPrivate });
    const page = await pages.read(target.url, platform);
    const plain = page.ok ? ownPicture(platform, page.meta['og:image']) : null;
    if (plain) return plain;
    return pictureViaStealth(platform, target.url, options);
  }
  if (platform === 'tiktok') {
    const tiktok = options.tiktok ?? new TikTokPublicBackend({ allowPrivate: options.allowPrivate });
    const result = await tiktok.get(`/embed/@${encodeURIComponent(target.handle)}`);
    if (!TikTokPublicBackend.failureOf(result)) {
      const user = parseEmbedState(result.body)?.userInfo;
      const avatar = ownPicture(platform, firstAddress(user, ['avatarLargerUrl', 'avatarMediumUrl', 'avatarThumbUrl']));
      if (avatar) return avatar;
    }
    // The embed names only a small picture or none: the profile page itself carries the larger one.
    let stealth = options.stealth;
    if (!stealth) stealth = new StealthBackend({ workspaceRoot: options.workspaceRoot ?? null });
    if (typeof stealth.isReady === 'function' && !stealth.isReady()) return null;
    if (typeof stealth.tiktokProfile !== 'function') return null;
    const profile = await stealth.tiktokProfile(target.handle, { limit: 1, timeoutMs: 40_000 });
    return profile?.ok === true ? ownPicture(platform, profile.profile?.avatar) : null;
  }
  if (platform === 'youtube') {
    const page = target.url.replace(/\/shorts\/?$/, '');
    let html = null;
    if (options.fetchHtml) html = await options.fetchHtml(page);
    else {
      const fetched = await boundedFetch(page, { allowPrivate: options.allowPrivate, timeoutMs: 12_000, maxBytes: 1024 * 1024 });
      html = fetched.ok ? fetched.body : null;
    }
    return html ? ownPicture(platform, extractMeta(html)['og:image']) : null;
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ok: true, pixels: Buffer}|{ok: false, code: 'decoder_missing'|'decode_failed'}>}
 */
export function decodeWithFfmpeg(buffer) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', `scale=${SAMPLE_SIZE}:${SAMPLE_SIZE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
    let child;
    try {
      child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: error?.code === 'ENOENT' ? 'decoder_missing' : 'decode_failed' });
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
      child.kill();
      finish({ ok: false, code: 'decode_failed' });
    }, DECODE_TIMEOUT_MS);
    child.on('error', (error) => finish({ ok: false, code: error?.code === 'ENOENT' ? 'decoder_missing' : 'decode_failed' }));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      const pixels = Buffer.concat(chunks);
      finish(code === 0 && pixels.length >= SAMPLE_SIZE * SAMPLE_SIZE * 3 ? { ok: true, pixels } : { ok: false, code: 'decode_failed' });
    });
    child.stdin.end(buffer);
  });
}

/**
 * Groups rgb24 pixels into 4-bit buckets, averages each bucket and drops the ones under 3 percent.
 * @param {Buffer} pixels
 * @returns {Array<{hex: string, share: number}>}
 */
export function weightedColours(pixels) {
  const total = Math.floor(pixels.length / 3);
  if (total === 0) return [];
  const buckets = new Map();
  for (let index = 0; index < total; index += 1) {
    const r = pixels[index * 3];
    const g = pixels[index * 3 + 1];
    const b = pixels[index * 3 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    } else buckets.set(key, { r, g, b, count: 1 });
  }
  return [...buckets.values()]
    .map((bucket) => ({ bucket, share: bucket.count / total }))
    .filter((entry) => entry.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .map(({ bucket, share }) => ({
      hex: `#${[bucket.r, bucket.g, bucket.b].map((sum) => Math.round(sum / bucket.count).toString(16).padStart(2, '0')).join('').toUpperCase()}`,
      share,
    }));
}

async function fetchPicture(url, allowPrivate) {
  const fetched = await boundedFetch(url, { allowPrivate, raw: true, timeoutMs: 10_000, maxBytes: PICTURE_MAX_BYTES, headers: { Accept: 'image/*;q=0.8,*/*;q=0.5' } });
  if (!fetched.ok || fetched.truncated || !fetched.buffer || fetched.buffer.length === 0) return null;
  return fetched.buffer;
}

/**
 * @param {{social?: Record<string, string|null|undefined>, allowPrivate?: boolean, decodeImage?: typeof decodeWithFfmpeg, pictureUrl?: typeof profilePictureUrl, fetchPicture?: (url: string, allowPrivate: boolean) => Promise<Buffer|null>}} input
 * @returns {Promise<{status: 'ok', platform: string, colours: Array<{hex: string, share: number}>}|{status: 'decoder_missing'}|{status: 'none'}>}
 */
export async function coloursFromProfilePicture({ social = {}, allowPrivate = false, decodeImage = decodeWithFfmpeg, pictureUrl = profilePictureUrl, fetchPicture: fetchImage = fetchPicture } = {}) {
  for (const platform of PLATFORM_ORDER) {
    const profileUrl = social?.[platform];
    if (typeof profileUrl !== 'string' || !profileUrl.trim()) continue;
    let buffer;
    try {
      const url = await pictureUrl(platform, profileUrl.trim(), { allowPrivate });
      if (!url) continue;
      buffer = await fetchImage(url, allowPrivate);
    } catch {
      continue;
    }
    const info = buffer ? imageInfo(buffer) : null;
    if (!info || !PICTURE_TYPES.has(info.mimeType)) continue;
    let decoded;
    try {
      decoded = await decodeImage(buffer);
    } catch {
      continue;
    }
    if (!decoded?.ok) {
      if (decoded?.code === 'decoder_missing') return { status: 'decoder_missing' };
      continue;
    }
    const colours = weightedColours(decoded.pixels);
    if (colours.length) return { status: 'ok', platform, colours };
  }
  return { status: 'none' };
}
