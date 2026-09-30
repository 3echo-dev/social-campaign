/**
 * Content hashing.
 *
 * A streaming sha256 so a multi gigabyte video never has to fit in memory. The hash
 * is the dedupe key for the creative library.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * @param {string} filePath
 * @returns {Promise<string>} lowercase hex sha256.
 */
export function sha256File(filePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}
