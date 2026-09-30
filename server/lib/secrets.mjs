/**
 * Secrets hygiene.
 *
 * A publishing provider API key, once typed into the pane's connect screen, must
 * never leave the server: not into a tool result Claude reads, not into the pane
 * state file, not into the reviews table, not into an event payload, and not into
 * any log line. This module is the one place that rule is enforced.
 *
 * redact() is a deep-copying scrubber: any object key on this list, anywhere in a
 * value, however deeply nested, comes back as the string "[redacted]". It is safe
 * to call on anything, including values that hold no secret at all, which is what
 * makes it usable as a blanket backstop rather than something every call site has
 * to reason about individually.
 */

/**
 * Field names treated as secret wherever they appear in an object, case
 * insensitively. A key ending in "_key" or "_token" is also treated as secret,
 * checked separately below, so a provider-specific name like "refresh_token" or
 * "publisher_key" is caught without being listed here by name.
 * @type {Set<string>}
 */
const SECRET_FIELD_NAMES = new Set([
  'api_key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'password',
]);

const REDACTED = '[redacted]';

// These fields identify workflow data, not credentials. Keep them intact so
// strategy decisions and generation retry keys survive tool and event round trips.
const PUBLIC_FIELD_NAMES = new Set(['direction_key', 'idempotency_key', 'extractor_key', 'ie_key']);

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSecretField(key) {
  const lower = key.toLowerCase();
  if (PUBLIC_FIELD_NAMES.has(lower)) return false;
  if (SECRET_FIELD_NAMES.has(lower)) return true;
  if (lower.endsWith('_key') || lower.endsWith('_token')) return true;
  return false;
}

/**
 * Heuristic for a string that looks like a secret token even when it turns up
 * under a field name this module does not recognize: long, high entropy, and
 * often carrying a recognizable provider prefix. Used as a belt-and-braces check
 * for free text fields (an error message that echoed a key back, for example),
 * not as the primary redaction mechanism, which is field-name based.
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeSecret(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  const KNOWN_PREFIXES = ['sk-', 'sk_', 'pk_', 'rk_', 'Bearer ', 'ghp_', 'gho_', 'xox', 'AKIA', 'key_', 'tok_'];
  if (KNOWN_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true;
  // A long run with no whitespace, mixing letters and digits, and no natural
  // language word boundaries, reads like a credential rather than a sentence.
  if (/\s/.test(trimmed)) return false;
  if (trimmed.length < 32) return false;
  const hasLetter = /[a-zA-Z]/.test(trimmed);
  const hasDigit = /[0-9]/.test(trimmed);
  return hasLetter && hasDigit && /^[A-Za-z0-9_\-.]+$/.test(trimmed);
}

/**
 * Deep copy `value`, replacing every secret field with "[redacted]".
 *
 * Arrays are walked element by element; plain objects are walked key by key,
 * matched by field name only (see isSecretField above); anything else (string,
 * number, boolean, null, undefined, Date, etc.) is returned as is. Field-name
 * matching only, deliberately: content sniffing every string in every payload
 * would also catch legitimate long identifiers (asset hashes, ULIDs), so that
 * heuristic lives in looksLikeSecret() instead, for callers that scan free text
 * (log lines) rather than structured objects with known field names.
 *
 * Safe to call on anything, including undefined, null, primitives, and cyclic
 * structures are not expected (this codebase's payloads are plain JSON), so no
 * cycle detection is attempted.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redact(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSecretField(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(entry);
      }
    }
    return out;
  }
  return value;
}
