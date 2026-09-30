/**
 * JSON helpers.
 *
 * The database stores several columns as JSON text and the config files are JSON on
 * disk. Every read has to survive a truncated or hand edited file without throwing.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

/**
 * Parse JSON, returning a fallback instead of throwing.
 * @template T
 * @param {string|null|undefined} text
 * @param {T} fallback
 * @returns {T}
 */
export function parseJson(text, fallback) {
  if (typeof text !== 'string' || text.length === 0) return fallback;
  try {
    const value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Read a JSON file, returning a fallback when it is missing or unreadable.
 * @template T
 * @param {string} filePath
 * @param {T} fallback
 * @returns {T}
 */
export function readJsonFile(filePath, fallback) {
  try {
    return parseJson(readFileSync(filePath, 'utf8'), fallback);
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON file atomically, creating parent folders as needed.
 * @param {string} filePath
 * @param {unknown} value
 */
export function writeJsonFile(filePath, value) {
  return withJsonLock(filePath, () => atomicWrite(filePath, value));
}

function atomicWrite(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temp, filePath);
  } finally {
    rmSync(temp, { force: true });
  }
}

// SQLite supplies a process-safe lock with automatic release on process death.
// Never write without this lock when another process owns a config update.
function withJsonLock(filePath, operation) {
  mkdirSync(dirname(filePath), { recursive: true });
  const lockDir = join(tmpdir(), 'social-campaign-json-locks');
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const absolute = resolve(filePath);
  const identity = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const name = createHash('sha256').update(identity).digest('hex');
  // Keep synchronization files out of portable workspaces and exported packages.
  const lock = new DatabaseSync(join(lockDir, `${name}.db`));
  try {
    lock.exec('PRAGMA busy_timeout = 15000; BEGIN IMMEDIATE;');
    const result = operation();
    lock.exec('COMMIT');
    return result;
  } finally {
    lock.close();
  }
}

/** Read, modify and replace a JSON document under one cross-process lock. */
export function updateJsonFile(filePath, updater, fallback = {}) {
  return withJsonLock(filePath, () => {
    const next = updater(readJsonFile(filePath, fallback));
    atomicWrite(filePath, next);
    return next;
  });
}

/**
 * Serialize a value for a JSON text column.
 * @param {unknown} value
 * @returns {string}
 */
export function toJsonColumn(value) {
  return JSON.stringify(value ?? null);
}
