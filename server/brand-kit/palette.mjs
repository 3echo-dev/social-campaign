/**
 * Colours and fingerprints from pictures, with no dependencies beyond ffmpeg.
 *
 * Three jobs share one decode:
 *   - dominantColours: the main colours of one or more pictures (a logo, or frames of a brand's videos) by weighted k-means over a
 *     4-bit colour histogram, skipping near white, near black and greys, at most 5.
 *   - averageHash and hamming: a perceptual fingerprint, so the same picture served at two sizes or in two formats is one picture.
 *   - coloursFromSvg: the fill and stroke colours an SVG names, since ffmpeg cannot draw an SVG.
 *
 * Nothing here reads a network or a path the caller did not hand over: a picture arrives as bytes.
 */

import { spawn } from 'node:child_process';

export const DECODE_SIZE = 48;
const DECODE_TIMEOUT_MS = 10_000;
const HASH_SIDE = 8;
/** A pixel this transparent is the background of a logo, not a colour of it. */
const OPAQUE = 200;
const MIN_SATURATION = 0.2;
const MIN_VALUE = 0.16;
const MAX_WHITE = 0.93;
export const PALETTE_MAX = 5;
/** Two colours closer than this (straight RGB distance) are one colour. */
const MERGE_DISTANCE = 52;
const KMEANS_ROUNDS = 14;

/**
 * Decode the first picture of an image (PNG, JPEG, WebP, GIF) to `size` x `size` RGBA pixels with ffmpeg, read from stdin.
 * @param {Buffer} buffer
 * @param {{size?: number, timeoutMs?: number, ffmpeg?: string}} [options]
 * @returns {Promise<{ok: true, pixels: Buffer, size: number}|{ok: false, code: 'decoder_missing'|'decode_failed'}>}
 */
export function decodeRgba(buffer, { size = DECODE_SIZE, timeoutMs = DECODE_TIMEOUT_MS, ffmpeg = 'ffmpeg' } = {}) {
  return new Promise((resolve) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      resolve({ ok: false, code: 'decode_failed' });
      return;
    }
    const args = ['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', `scale=${size}:${size}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
    let child;
    try {
      child = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: /** @type {any} */ (error)?.code === 'ENOENT' ? 'decoder_missing' : 'decode_failed' });
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
      finish({ ok: false, code: 'decode_failed' });
    }, timeoutMs);
    child.on('error', (error) => finish({ ok: false, code: /** @type {any} */ (error)?.code === 'ENOENT' ? 'decoder_missing' : 'decode_failed' }));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      const pixels = Buffer.concat(chunks);
      finish(code === 0 && pixels.length >= size * size * 4 ? { ok: true, pixels: pixels.subarray(0, size * size * 4), size } : { ok: false, code: 'decode_failed' });
    });
    child.stdin.end(buffer);
  });
}

/** @param {number} r @param {number} g @param {number} b */
function saturationOf(r, g, b) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * Whether a colour is a brand colour candidate: not near white, not near black, not a grey.
 * @param {number} r @param {number} g @param {number} b
 */
export function isChromatic(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (min >= MAX_WHITE) return false;
  if (max <= MIN_VALUE) return false;
  return saturationOf(r, g, b) >= MIN_SATURATION;
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
/** @param {number[]} rgb */
export const toHex = (rgb) => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
/** @param {string} hex */
export const fromHex = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The main colours of some RGBA pixel buffers, biggest first, at most `max`.
 * @param {Array<Buffer>} pixelSets RGBA pixels of each picture.
 * @param {{max?: number, k?: number}} [options]
 * @returns {Array<{hex: string, share: number}>} share is the part of the chromatic pixels the colour covers.
 */
export function dominantColours(pixelSets, { max = PALETTE_MAX, k = 8 } = {}) {
  /** @type {Map<number, {r: number, g: number, b: number, count: number}>} */
  const buckets = new Map();
  let kept = 0;
  for (const pixels of pixelSets) {
    if (!Buffer.isBuffer(pixels)) continue;
    for (let at = 0; at + 3 < pixels.length; at += 4) {
      if (pixels[at + 3] < OPAQUE) continue;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      if (!isChromatic(r, g, b)) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.r += r; bucket.g += g; bucket.b += b; bucket.count += 1;
      } else buckets.set(key, { r, g, b, count: 1 });
      kept += 1;
    }
  }
  if (kept === 0) return [];
  const points = [...buckets.values()]
    .map((bucket) => ({ rgb: [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count], weight: bucket.count }))
    .sort((a, b) => b.weight - a.weight);
  const clusters = Math.min(k, points.length);

  // Farthest point start: the heaviest bucket, then the bucket that is far from every centre and still carries some weight.
  const centres = [points[0].rgb.slice()];
  const floor = Math.max(1, kept * 0.004);
  while (centres.length < clusters) {
    let best = null;
    let bestScore = -1;
    for (const point of points) {
      if (point.weight < floor) continue;
      const near = Math.min(...centres.map((centre) => distance(centre, point.rgb)));
      const score = near * Math.sqrt(point.weight);
      if (score > bestScore) { bestScore = score; best = point; }
    }
    if (!best || bestScore <= 0) break;
    centres.push(best.rgb.slice());
  }

  const totals = centres.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
  for (let round = 0; round < KMEANS_ROUNDS; round += 1) {
    for (const total of totals) { total.r = 0; total.g = 0; total.b = 0; total.weight = 0; }
    for (const point of points) {
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let index = 0; index < centres.length; index += 1) {
        const d = distance(centres[index], point.rgb);
        if (d < nearestDistance) { nearestDistance = d; nearest = index; }
      }
      const total = totals[nearest];
      total.r += point.rgb[0] * point.weight; total.g += point.rgb[1] * point.weight; total.b += point.rgb[2] * point.weight; total.weight += point.weight;
    }
    let moved = 0;
    totals.forEach((total, index) => {
      if (!total.weight) return;
      const next = [total.r / total.weight, total.g / total.weight, total.b / total.weight];
      moved += distance(centres[index], next);
      centres[index] = next;
    });
    if (moved < 0.5) break;
  }

  /** @type {Array<{rgb: number[], weight: number}>} */
  const found = totals
    .map((total, index) => ({ rgb: centres[index], weight: total.weight }))
    .filter((entry) => entry.weight > 0 && entry.weight / kept >= 0.03)
    .sort((a, b) => b.weight - a.weight);
  // Colours that are one colour to the eye (a shaded red and its highlight) count once, the heavier one keeping the weight.
  /** @type {Array<{rgb: number[], weight: number}>} */
  const merged = [];
  for (const entry of found) {
    const twin = merged.find((other) => distance(other.rgb, entry.rgb) < MERGE_DISTANCE);
    if (twin) twin.weight += entry.weight;
    else merged.push({ rgb: entry.rgb, weight: entry.weight });
  }
  return merged
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((entry) => ({ hex: toHex(entry.rgb), share: Math.round((entry.weight / kept) * 1000) / 1000 }));
}

/**
 * The colours an SVG names in fill, stroke and stop-color, most used first, neutrals skipped. An SVG cannot be drawn without a
 * renderer, so its own text is the only place its colours are.
 * @param {string|Buffer} svg
 * @param {{max?: number}} [options]
 * @returns {Array<{hex: string, share: number}>}
 */
export function coloursFromSvg(svg, { max = PALETTE_MAX } = {}) {
  const text = Buffer.isBuffer(svg) ? svg.toString('utf8') : String(svg ?? '');
  /** @type {Map<string, number>} */
  const counts = new Map();
  let total = 0;
  for (const match of text.matchAll(/(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/gi)) {
    let value = match[1].toLowerCase();
    if (value.length === 4) value = `#${[...value.slice(1)].map((c) => c + c).join('')}`;
    const rgb = fromHex(value);
    if (!isChromatic(rgb[0], rgb[1], rgb[2])) continue;
    const hex = value.toUpperCase();
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
    total += 1;
  }
  if (!total) return [];
  /** @type {Array<{hex: string, count: number}>} */
  const merged = [];
  for (const [hex, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const twin = merged.find((other) => distance(fromHex(other.hex), fromHex(hex)) < MERGE_DISTANCE);
    if (twin) twin.count += count;
    else merged.push({ hex, count });
  }
  return merged.slice(0, max).map((entry) => ({ hex: entry.hex, share: Math.round((entry.count / total) * 1000) / 1000 }));
}

/**
 * A 64 bit average hash of RGBA pixels, as 16 hex characters. Transparent pixels count as white, so a logo with a see-through
 * background and the same logo on white are the same picture.
 * @param {Buffer} pixels RGBA, `size` x `size`.
 * @param {number} [size]
 * @returns {string}
 */
export function averageHash(pixels, size = DECODE_SIZE) {
  const block = Math.floor(size / HASH_SIDE);
  const grey = [];
  for (let cy = 0; cy < HASH_SIDE; cy += 1) {
    for (let cx = 0; cx < HASH_SIDE; cx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = cy * block; y < (cy + 1) * block; y += 1) {
        for (let x = cx * block; x < (cx + 1) * block; x += 1) {
          const at = (y * size + x) * 4;
          const alpha = pixels[at + 3] / 255;
          const flat = (channel) => channel * alpha + 255 * (1 - alpha);
          sum += 0.299 * flat(pixels[at]) + 0.587 * flat(pixels[at + 1]) + 0.114 * flat(pixels[at + 2]);
          count += 1;
        }
      }
      grey.push(sum / count);
    }
  }
  const mean = grey.reduce((total, value) => total + value, 0) / grey.length;
  let bits = 0n;
  for (const value of grey) bits = (bits << 1n) | (value > mean ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

/**
 * How many of the 64 bits two hashes differ in. Hashes of different lengths (or that are not hashes) differ completely.
 * @param {string} a @param {string} b
 */
export function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 16 || b.length !== 16 || !/^[0-9a-f]+$/.test(a + b)) return 64;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (bits) { count += Number(bits & 1n); bits >>= 1n; }
  return count;
}

/** Two pictures with at most this many differing hash bits are the same picture. */
export const SAME_PICTURE_BITS = 6;

/**
 * Whether the pixels carry any see-through part (a logo with a transparent background).
 * @param {Buffer} pixels RGBA
 */
export function hasTransparency(pixels) {
  for (let at = 3; at < pixels.length; at += 4) if (pixels[at] < 250) return true;
  return false;
}
