/**
 * A small JSON Schema validator.
 *
 * Covers the vocabulary the contract schemas in schemas/ actually declare: type
 * (including union types), required, properties, additionalProperties, enum, const,
 * minimum, maximum, minItems, maxItems, minLength, maxLength, pattern, format
 * date-time, items and nested objects. It is deliberately not a full draft 2020-12
 * implementation; there are no runtime dependencies in this server and the contracts
 * do not need more than this.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The folder holding the structured output contracts. */
export const SCHEMAS_DIR = join(HERE, '..', '..', 'schemas');

/** @type {Map<string, Record<string, any>>} */
const CACHE = new Map();

/**
 * Load a contract schema by file name, for example video-creative-analysis.schema.json.
 * @param {string} fileName
 * @returns {Record<string, any>}
 */
export function loadSchema(fileName) {
  const cached = CACHE.get(fileName);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, fileName), 'utf8'));
  CACHE.set(fileName, schema);
  return schema;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * @param {unknown} value
 * @param {string|string[]} expected
 * @returns {boolean}
 */
function matchesType(value, expected) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((type) => type === actual || (type === 'number' && actual === 'integer'));
}

/**
 * Validate a value against a schema. Returns a list of problems, empty when valid.
 * @param {unknown} value
 * @param {Record<string, any>} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validate(value, schema, path = '$') {
  /** @type {string[]} */
  const problems = [];
  if (!schema || typeof schema !== 'object') return problems;

  if (schema.const !== undefined && value !== schema.const) {
    problems.push(`${path} must be ${JSON.stringify(schema.const)}`);
    return problems;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    problems.push(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
    return problems;
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
    problems.push(`${path} should be ${expected}, got ${typeOf(value)}`);
    return problems;
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      problems.push(`${path} must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      problems.push(`${path} must be at most ${schema.maximum}`);
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      problems.push(`${path} needs at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      problems.push(`${path} can be at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${path} is not in the form this field takes`);
    }
    if (schema.format === 'date-time' && !isDateTime(value)) {
      problems.push(`${path} must be a date and time, for example 2026-09-15T10:00:00Z`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      problems.push(`${path} must have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      problems.push(`${path} must have at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => problems.push(...validate(entry, schema.items, `${path}[${index}]`)));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (record[key] === undefined) problems.push(`${path}.${key} is required`);
    }
    for (const [key, entry] of Object.entries(record)) {
      if (properties[key]) {
        problems.push(...validate(entry, properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}.${key} is not an allowed field`);
      }
    }
  }

  return problems;
}

/**
 * Whether a string is an ISO 8601 date and time, which is what `format: "date-time"`
 * means everywhere in schemas/.
 * @param {string} value
 * @returns {boolean}
 */
export function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Validate against a contract file and return the problems.
 * @param {unknown} value
 * @param {string} fileName
 * @returns {string[]}
 */
export function validateAgainst(value, fileName) {
  return validate(value, loadSchema(fileName));
}
