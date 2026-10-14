/**
 * Which of the board's published files a publish must carry, and how the agent reads them.
 *
 * The host's Artifact tool makes the agent read, in full, every file it did not write before it may publish it. The
 * board is several files of 20 to 50 KB (see scripts/board-modules.mjs), the page itself is a few KB, and a refresh
 * leaves out the files the bound board already has at the same hash (the tool keeps the files a publish leaves out).
 * Each Read call must stay under the Read tool's 25,000 token cap, so the plan names the exact lines of every Read.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { READ_CHAR_BUDGET } from '../../scripts/board-modules.mjs';

// What the Read tool adds to each line it shows: its number, padded, and a tab.
const LINE_NUMBER_WIDTH = 8;

/**
 * Cut a file's text into Read calls of at most `budget` characters (counting what Read adds to each line). A file that
 * fits in one call needs no offset or limit. A line is never cut: the longest line of a built file is 1,500 characters.
 *
 * @param {string} text
 * @param {number} [budget]
 * @returns {{offset?: number, limit?: number}[]}
 */
export function readSlices(text, budget = READ_CHAR_BUDGET) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const slices = [];
  let first = 0;
  let used = 0;
  lines.forEach((line, index) => {
    const cost = line.length + LINE_NUMBER_WIDTH;
    if (used && used + cost > budget) {
      slices.push({ offset: first + 1, limit: index - first });
      first = index;
      used = 0;
    }
    used += cost;
  });
  if (!slices.length) return [{}];
  slices.push({ offset: first + 1, limit: lines.length - first });
  return slices;
}

/**
 * The Read calls that cover the page and every file about to be published, in one list the agent issues in parallel.
 *
 * @param {{file_path: string, text: string}[]} entries
 * @returns {{file_path: string, offset?: number, limit?: number}[]}
 */
export function boardReadPlan(entries) {
  return entries.flatMap(entry => readSlices(entry.text).map(slice => ({ file_path: entry.file_path, ...slice })));
}

/**
 * The published paths a publish must carry. With no record of what the bound board holds, every file; otherwise the files
 * whose hash differs from the recorded one (a path the record does not have counts as changed).
 *
 * @param {Record<string, string>} fileHashes the hash of every file of the current build, by published path
 * @param {Record<string, string>|null} recorded what the bound board was last bound with, or null
 * @returns {string[]}
 */
export function pathsToPublish(fileHashes, recorded) {
  const paths = Object.keys(fileHashes);
  return recorded ? paths.filter(path => recorded[path] !== fileHashes[path]) : paths;
}

/** Delete board files an earlier build wrote that the current build no longer has (a renamed or removed section). */
export function removeStaleBoardFiles(dir, keep) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const boardFile = name === 'board.js' || name === 'board.css' || (name.startsWith('board-') && (name.endsWith('.js') || name.endsWith('.css')));
    if (!boardFile || keep.has(name)) continue;
    try {
      rmSync(join(dir, name), { force: true });
    } catch {
      // A file that cannot be removed is only left behind.
    }
  }
}
