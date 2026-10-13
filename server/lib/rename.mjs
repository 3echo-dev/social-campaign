/**
 * Replace a file by renaming a finished temporary file over it, waiting out a Windows file that is busy for a moment.
 *
 * On Windows a rename over a file another process has open at that instant (a reader, a virus scanner) fails with EPERM, EACCES
 * or EBUSY and succeeds a few milliseconds later. This is the one implementation, kept in pipeline/scripts/lib-durable.js beside
 * the lock code that has the same problem; use it for every write that finishes with a rename onto an existing path.
 * Off Windows those codes are real errors and are thrown at once, and so is a directory in the way.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const durable = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-durable.js'));

/**
 * @param {string} from the finished temporary file
 * @param {string} to the path it replaces
 * @returns {void}
 */
export function renameReplacing(from, to) {
  durable.renameReplacing(from, to);
}
