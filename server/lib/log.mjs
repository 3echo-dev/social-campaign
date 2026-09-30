/**
 * Logging.
 *
 * stdout belongs to the MCP protocol. Everything this server wants to say goes to
 * stderr, and optionally to a log file inside the workspace.
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact, looksLikeSecret } from './secrets.mjs';

/** A log file is rotated once it passes this size. */
export const ROTATE_AT_BYTES = 1024 * 1024;

/** @type {string|null} */
let logFilePath = null;

/** @type {'debug'|'info'|'warn'|'error'} */
let level = process.env.SOCIAL_CAMPAIGN_LOG_LEVEL === 'debug' ? 'debug' : 'info';

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Point the logger at a file inside the workspace. Failures are ignored on purpose:
 * losing a log line must never break a tool call.
 * @param {string|null} filePath
 */
export function setLogFile(filePath) {
  logFilePath = filePath;
  if (!filePath) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    logFilePath = null;
  }
}

/**
 * @param {'debug'|'info'|'warn'|'error'} next
 */
export function setLogLevel(next) {
  if (ORDER[next]) level = next;
}

/**
 * @param {'debug'|'info'|'warn'|'error'} kind
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 */
function write(kind, message, fields) {
  if (ORDER[kind] < ORDER[level]) return;
  // A secret never leaves the server, logs included. Structured fields are
  // redacted by name; the free text message is scanned by the entropy
  // heuristic, since a message can echo a value back with no field name at all
  // (for example a caught error's own .message).
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: kind,
    message: looksLikeSecret(message) ? '[redacted]' : message,
    ...(redact(fields ?? {})),
  });
  process.stderr.write(`${line}\n`);
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${line}\n`, 'utf8');
    } catch {
      logFilePath = null;
    }
  }
}

/**
 * Append one line to a log file, rotating it first when it has grown past maxBytes.
 * Rotation keeps exactly one previous file, <name>.1, so a long lived workspace
 * never accumulates logs without bound.
 *
 * Failures are swallowed: a log line is never worth failing a boot over.
 *
 * @param {string} filePath
 * @param {string} line written with a trailing newline added.
 * @param {number} [maxBytes]
 * @returns {boolean} true when the line was written.
 */
export function appendRotating(filePath, line, maxBytes = ROTATE_AT_BYTES) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      size = 0;
    }
    if (size >= maxBytes) {
      const previous = `${filePath}.1`;
      try {
        rmSync(previous, { force: true });
      } catch {
        // an unremovable old file is not a reason to stop logging
      }
      renameSync(filePath, previous);
    }
    appendFileSync(filePath, `${line}
`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export const log = {
  /** @param {string} m @param {Record<string, unknown>} [f] */
  debug: (m, f) => write('debug', m, f),
  /** @param {string} m @param {Record<string, unknown>} [f] */
  info: (m, f) => write('info', m, f),
  /** @param {string} m @param {Record<string, unknown>} [f] */
  warn: (m, f) => write('warn', m, f),
  /** @param {string} m @param {Record<string, unknown>} [f] */
  error: (m, f) => write('error', m, f),
};
