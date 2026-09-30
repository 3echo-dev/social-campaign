/**
 * Source folder inventory.
 *
 * A read only recursive walk. It lists files with an allowlisted extension, skips
 * hidden and system folders, never follows a symbolic link and never writes into
 * the folder. Nothing here can modify, rename, move or delete an original.
 */

import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { ALLOWED_EXTENSIONS } from './mime.mjs';

/** Folder names that are never worth indexing. */
export const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.social-campaign',
  '$RECYCLE.BIN',
  'System Volume Information',
  '__MACOSX',
  '.Trash',
  '.Trashes',
]);

/**
 * @typedef {object} InventoryEntry
 * @property {string} path absolute
 * @property {string} relative path from the source folder
 * @property {number} bytes
 * @property {string} mtime ISO 8601
 * @property {string} extension lowercase, with the dot
 */

/**
 * @param {string} name
 * @returns {boolean}
 */
function isHiddenOrSystem(name) {
  return name.startsWith('.') || SKIPPED_DIRS.has(name);
}

/**
 * Walk a folder and return every allowlisted file.
 * @param {string} sourceFolder
 * @param {{maxFiles?: number}} [options]
 * @returns {InventoryEntry[]}
 */
export function inventoryFolder(sourceFolder, options = {}) {
  const root = resolve(sourceFolder);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new InvalidInputError('That folder could not be found. Please check the path and try again.');
  }
  const maxFiles = options.maxFiles ?? 50_000;
  /** @type {InventoryEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const stack = [root];
  while (stack.length > 0 && entries.length < maxFiles) {
    const dir = /** @type {string} */ (stack.pop());
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable folder, skip it rather than abort the run
    }
    // Sort so the order is stable across platforms and runs.
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const full = join(dir, child.name);
      if (child.isDirectory()) {
        if (!isHiddenOrSystem(child.name)) stack.push(full);
        continue;
      }
      if (!child.isFile() || child.name.startsWith('.')) continue;
      const extension = extname(child.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(extension)) continue;
      let stats;
      try {
        stats = lstatSync(full);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      entries.push({
        path: full,
        relative: full.slice(root.length + 1),
        bytes: stats.size,
        mtime: stats.mtime.toISOString(),
        extension,
      });
    }
  }
  entries.sort((a, b) => a.relative.localeCompare(b.relative));
  return entries;
}
