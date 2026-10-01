/**
 * File type detection.
 *
 * The extension decides the candidate type and the first bytes confirm it where a
 * magic number exists. Text formats (txt, md, srt, vtt) have no magic number, so
 * the extension stands alone for them.
 */

import { openSync, readSync, closeSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * @typedef {'video'|'image'|'audio'|'document'|'script'|'other'} AssetKind
 */

/** Extension to mime and kind. This is the ingestion allowlist. */
export const KNOWN_TYPES = /** @type {Record<string, {mime: string, kind: AssetKind}>} */ ({
  '.mp4': { mime: 'video/mp4', kind: 'video' },
  '.m4v': { mime: 'video/mp4', kind: 'video' },
  '.mov': { mime: 'video/quicktime', kind: 'video' },
  '.webm': { mime: 'video/webm', kind: 'video' },
  '.jpg': { mime: 'image/jpeg', kind: 'image' },
  '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.png': { mime: 'image/png', kind: 'image' },
  '.webp': { mime: 'image/webp', kind: 'image' },
  '.gif': { mime: 'image/gif', kind: 'image' },
  '.mp3': { mime: 'audio/mpeg', kind: 'audio' },
  '.wav': { mime: 'audio/wav', kind: 'audio' },
  '.m4a': { mime: 'audio/mp4', kind: 'audio' },
  '.txt': { mime: 'text/plain', kind: 'script' },
  '.md': { mime: 'text/markdown', kind: 'script' },
  '.srt': { mime: 'application/x-subrip', kind: 'script' },
  '.vtt': { mime: 'text/vtt', kind: 'script' },
  '.pdf': { mime: 'application/pdf', kind: 'document' },
  // Brand reference fonts. Fonts are not a first class library kind (the assets.kind
  // CHECK constraint only allows video, image, audio, document, script, other), so
  // they register as 'other'. A preview loads the file itself into
  // an in-page @font-face, not by generating a thumbnail image.
  '.ttf': { mime: 'font/ttf', kind: 'other' },
  '.otf': { mime: 'font/otf', kind: 'other' },
  '.woff': { mime: 'font/woff', kind: 'other' },
  '.woff2': { mime: 'font/woff2', kind: 'other' },
});

/** Extensions the library will index. */
export const ALLOWED_EXTENSIONS = Object.keys(KNOWN_TYPES);

/**
 * @param {Buffer} head
 * @param {number} offset
 * @param {string} ascii
 * @returns {boolean}
 */
function hasAscii(head, offset, ascii) {
  return head.length >= offset + ascii.length && head.toString('latin1', offset, offset + ascii.length) === ascii;
}

/**
 * Identify a file from its first bytes. Returns null when no magic number matched.
 * @param {Buffer} head at least 16 bytes when available.
 * @returns {{mime: string, kind: AssetKind}|null}
 */
export function sniffMagic(head) {
  if (head.length < 4) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (head[0] === 0x89 && hasAscii(head, 1, 'PNG')) return { mime: 'image/png', kind: 'image' };
  if (hasAscii(head, 0, 'GIF8')) return { mime: 'image/gif', kind: 'image' };
  if (hasAscii(head, 0, 'RIFF') && hasAscii(head, 8, 'WEBP')) return { mime: 'image/webp', kind: 'image' };
  if (hasAscii(head, 0, 'RIFF') && hasAscii(head, 8, 'WAVE')) return { mime: 'audio/wav', kind: 'audio' };
  if (hasAscii(head, 0, '%PDF')) return { mime: 'application/pdf', kind: 'document' };
  if (hasAscii(head, 0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', kind: 'audio' };
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { mime: 'video/webm', kind: 'video' };
  }
  // Font magic numbers, checked ahead of the generic ftyp probe below.
  if (hasAscii(head, 0, 'OTTO')) return { mime: 'font/otf', kind: 'other' };
  if (hasAscii(head, 0, 'wOFF')) return { mime: 'font/woff', kind: 'other' };
  if (hasAscii(head, 0, 'wOF2')) return { mime: 'font/woff2', kind: 'other' };
  if (head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00) {
    return { mime: 'font/ttf', kind: 'other' };
  }
  if (hasAscii(head, 0, 'true') || hasAscii(head, 0, 'typ1')) return { mime: 'font/ttf', kind: 'other' };
  if (hasAscii(head, 4, 'ftyp')) {
    const brand = head.toString('latin1', 8, 12);
    if (brand.startsWith('qt')) return { mime: 'video/quicktime', kind: 'video' };
    if (brand === 'M4A ') return { mime: 'audio/mp4', kind: 'audio' };
    return { mime: 'video/mp4', kind: 'video' };
  }
  return null;
}

/**
 * Read the first bytes of a file without loading it.
 * @param {string} filePath
 * @param {number} [length]
 * @returns {Buffer}
 */
export function readHead(filePath, length = 16) {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * Detect mime and kind for a file. The extension is the primary signal; when the
 * magic bytes disagree they win, because a renamed file is still what it is.
 * @param {string} filePath
 * @returns {{mime: string|null, kind: AssetKind, extension: string, allowed: boolean}}
 */
export function detectType(filePath) {
  const extension = extname(filePath).toLowerCase();
  const byExtension = KNOWN_TYPES[extension] ?? null;
  let sniffed = null;
  try {
    sniffed = sniffMagic(readHead(filePath));
  } catch {
    sniffed = null;
  }
  const chosen = sniffed ?? byExtension;
  return {
    mime: chosen ? chosen.mime : null,
    kind: chosen ? chosen.kind : 'other',
    extension,
    allowed: Boolean(byExtension),
  };
}
