/**
 * Line files and small JSON files, the way the brand library keeps them.
 *
 * A line file holds one JSON object per line and is only ever appended to, so two writers never overwrite each other and a
 * half-written last line is skipped on read. A small JSON file is replaced whole through a temporary file, so a reader never
 * sees it half written.
 */

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Every object in a line file, in order. A missing file is empty; a line that is not an object is skipped. */
export function readLines(file) {
  let raw = '';
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const value = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value); } catch { /* a half-written line is skipped */ }
  }
  return out;
}

/** Append objects to a line file in one write. A file whose last line was cut short gets a newline first. */
export function appendLines(file, values) {
  if (!values.length) return;
  mkdirSync(dirname(file), { recursive: true });
  let lead = '';
  try {
    const size = statSync(file).size;
    if (size > 0) {
      const fd = openSync(file, 'r');
      try { const last = Buffer.alloc(1); readSync(fd, last, 0, 1, size - 1); if (last[0] !== 0x0a) lead = '\n'; } finally { closeSync(fd); }
    }
  } catch { /* a new file */ }
  appendFileSync(file, `${lead}${values.map(value => JSON.stringify(value)).join('\n')}\n`);
}

/** A small JSON file, or the fallback when it is missing or unreadable. */
export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Replace a small JSON file whole. */
export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}
