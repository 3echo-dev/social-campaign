/**
 * Read a font file's own names (family, style, full name) from its `name` table, without loading the whole file.
 *
 * TrueType and OpenType (.ttf, .otf, the first font of a .ttc), WOFF (.woff) and WOFF2 (.woff2) are read. Nothing is written and no
 * binary runs: the table directory is read first, then only the `name` table. A WOFF table is zlib packed; a WOFF2 file is one Brotli
 * stream, which is unpacked in memory (capped) because the `name` table is not transformed in it.
 *
 * The family is the typographic family (name id 16) when the font has one, otherwise the family (id 1) with a trailing weight word
 * taken off ("Montserrat SemiBold" is the family "Montserrat"). Anything unreadable returns null; this never throws.
 */

import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliDecompress, inflate } from 'node:zlib';

import { baseFamily } from '../brand-kit/fonts.mjs';

const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);

/** The largest font file looked into. A bigger one is left unread. */
export const FONT_MAX_BYTES = 40 * 1024 * 1024;
const NAME_TABLE_MAX = 2 * 1024 * 1024;
const WOFF2_MAX_OUTPUT = 96 * 1024 * 1024;

const NAME_IDS = Object.freeze({ family: 1, subfamily: 2, fullName: 4, postScriptName: 6, typographicFamily: 16, typographicSubfamily: 17 });

const readAt = async (handle, position, length) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return bytesRead < length ? buffer.subarray(0, bytesRead) : buffer;
};

const tagAt = (buffer, offset) => buffer.toString('latin1', offset, offset + 4);

/** UIntBase128 of the WOFF2 table directory: { value, next } or null. */
function base128(buffer, offset) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (offset + i >= buffer.length) return null;
    const byte = buffer[offset + i];
    if (i === 0 && byte === 0x80) return null;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, next: offset + i + 1 };
  }
  return null;
}

/** The name table of a plain sfnt, found through the table records at `base`. */
async function sfntNameTable(handle, base, size) {
  const head = await readAt(handle, base, 12);
  if (head.length < 12) return null;
  const count = head.readUInt16BE(4);
  if (!count || count > 512) return null;
  const records = await readAt(handle, base + 12, count * 16);
  for (let i = 0; i + 16 <= records.length; i += 16) {
    if (tagAt(records, i) !== 'name') continue;
    const offset = records.readUInt32BE(i + 8);
    const length = records.readUInt32BE(i + 12);
    if (!length || length > NAME_TABLE_MAX || offset + length > size) return null;
    return readAt(handle, offset, length);
  }
  return null;
}

async function woffNameTable(handle, size) {
  const head = await readAt(handle, 0, 44);
  if (head.length < 44) return null;
  const count = head.readUInt16BE(12);
  if (!count || count > 512) return null;
  const records = await readAt(handle, 44, count * 20);
  for (let i = 0; i + 20 <= records.length; i += 20) {
    if (tagAt(records, i) !== 'name') continue;
    const offset = records.readUInt32BE(i + 4);
    const packed = records.readUInt32BE(i + 8);
    const original = records.readUInt32BE(i + 12);
    if (!original || original > NAME_TABLE_MAX || offset + packed > size) return null;
    const bytes = await readAt(handle, offset, packed);
    return packed < original ? inflateAsync(bytes) : bytes;
  }
  return null;
}

async function woff2NameTable(handle, size) {
  const head = await readAt(handle, 0, 48);
  if (head.length < 48) return null;
  const count = head.readUInt16BE(12);
  const packedSize = head.readUInt32BE(20);
  if (!count || count > 256 || !packedSize) return null;
  // Each directory entry is at most 1 flag byte, 4 tag bytes and two 5 byte numbers.
  const directory = await readAt(handle, 48, Math.min(size - 48, count * 15));
  let cursor = 0;
  let offset = 0;
  let found = null;
  for (let i = 0; i < count; i += 1) {
    if (cursor >= directory.length) return null;
    const flags = directory[cursor]; cursor += 1;
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag = null;
    if (index === 63) { tag = tagAt(directory, cursor); cursor += 4; }
    const original = base128(directory, cursor);
    if (!original) return null;
    cursor = original.next;
    // glyf and loca are transformed by version 0; every other table by a version above 0.
    const transformed = index === 10 || index === 11 || tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    let length = original.value;
    if (transformed) {
      const packed = base128(directory, cursor);
      if (!packed) return null;
      cursor = packed.next;
      length = packed.value;
    }
    if ((index === 5 || tag === 'name') && !transformed) found = { offset, length };
    offset += length;
  }
  if (!found || !found.length || found.length > NAME_TABLE_MAX || 48 + cursor + packedSize > size) return null;
  const stream = await readAt(handle, 48 + cursor, packedSize);
  const data = await brotliAsync(stream, { maxOutputLength: WOFF2_MAX_OUTPUT });
  return data.subarray(found.offset, found.offset + found.length);
}

const decodeName = (bytes, platform) => {
  if (platform === 1) return bytes.toString('latin1');
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  return Buffer.from(even).swap16().toString('utf16le');
};

const tidy = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** The strings of a name table by name id: the best language and platform for each. */
export function parseNameTable(table) {
  if (!Buffer.isBuffer(table) || table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const stringBase = table.readUInt16BE(4);
  const best = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 12;
    if (at + 12 > table.length) break;
    const platform = table.readUInt16BE(at);
    const language = table.readUInt16BE(at + 4);
    const id = table.readUInt16BE(at + 6);
    const length = table.readUInt16BE(at + 8);
    const offset = stringBase + table.readUInt16BE(at + 10);
    if (!Object.values(NAME_IDS).includes(id) || offset + length > table.length) continue;
    const rank = platform === 3 && language === 0x0409 ? 4 : platform === 3 ? 3 : platform === 0 ? 2 : platform === 1 && language === 0 ? 1 : 0;
    if (!rank) continue;
    if ((best.get(id)?.rank ?? 0) >= rank) continue;
    const text = tidy(decodeName(table.subarray(offset, offset + length), platform));
    if (text) best.set(id, { rank, text });
  }
  const get = id => best.get(id)?.text ?? null;
  return {
    family: get(NAME_IDS.family), subfamily: get(NAME_IDS.subfamily), fullName: get(NAME_IDS.fullName), postScriptName: get(NAME_IDS.postScriptName),
    typographicFamily: get(NAME_IDS.typographicFamily), typographicSubfamily: get(NAME_IDS.typographicSubfamily),
  };
}

/**
 * The names a font file gives itself: { family, style, fullName, format } (style and fullName only when the font has them), or null when
 * the file is not a font this can read.
 */
export async function readFontNames(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size } = await handle.stat();
    if (size < 44 || size > FONT_MAX_BYTES) return null;
    const head = await readAt(handle, 0, 16);
    const tag = tagAt(head, 0);
    let table = null;
    let format = null;
    if (tag === 'wOFF') { format = 'woff'; table = await woffNameTable(handle, size); }
    else if (tag === 'wOF2') { format = 'woff2'; table = await woff2NameTable(handle, size); }
    else if (tag === 'ttcf') {
      format = 'ttc';
      table = await sfntNameTable(handle, head.readUInt32BE(12), size);
    } else if (['OTTO', 'true', 'typ1'].includes(tag) || head.readUInt32BE(0) === 0x00010000) {
      format = tag === 'OTTO' ? 'otf' : 'ttf';
      table = await sfntNameTable(handle, 0, size);
    }
    const names = table ? parseNameTable(table) : null;
    if (!names) return null;
    const family = names.typographicFamily || (names.family ? baseFamily(names.family) : null);
    if (!family) return null;
    const style = names.typographicSubfamily || names.subfamily;
    return { family: family.slice(0, 80), ...(style ? { style: style.slice(0, 60) } : {}), ...(names.fullName ? { fullName: names.fullName.slice(0, 120) } : {}), format };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
