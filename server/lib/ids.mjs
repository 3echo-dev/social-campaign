/**
 * Identifier generation.
 *
 * Every row in the Social Campaign database uses a text id that sorts by creation time.
 * The format is a ULID-like 26 character Crockford base32 string: 10 characters of
 * millisecond timestamp followed by 16 characters of randomness.
 */

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/**
 * Encode a non negative integer into Crockford base32 with a fixed length.
 * @param {number} value
 * @param {number} length
 * @returns {string}
 */
function encodeTime(value, length) {
  let out = '';
  let remaining = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out = ALPHABET[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/**
 * @returns {string} a 16 character random Crockford base32 suffix.
 */
function encodeRandom() {
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
}

/**
 * Create a new sortable identifier.
 * @param {number} [now] milliseconds since epoch, for deterministic tests.
 * @returns {string}
 */
export function newId(now = Date.now()) {
  return encodeTime(now, TIME_LEN) + encodeRandom();
}

/**
 * Check that a string looks like an identifier produced by newId.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isId(value) {
  return typeof value === 'string' && value.length === TIME_LEN + RANDOM_LEN && /^[0-9A-HJKMNP-TV-Z]+$/.test(value);
}

/**
 * A filesystem and url safe timestamp, used for backup file names.
 * @param {Date} [date]
 * @returns {string} for example 20260911-181722
 */
export function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * ISO 8601 timestamp used for every created_at and updated_at column.
 * @param {Date} [date]
 * @returns {string}
 */
export function nowIso(date = new Date()) {
  return date.toISOString();
}
