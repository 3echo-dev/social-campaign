/**
 * A very small JSON Schema check, enough for the structured output contracts.
 *
 * The plugin has no runtime dependencies, so this covers the vocabulary the schemas in
 * schemas/ actually declare: type, required, enum, const, nested objects, array items,
 * minItems and maxItems, minLength and maxLength, pattern, minimum and maximum, and
 * format date-time. Anything outside that vocabulary is let through, because a false
 * rejection costs a user their work while a missed subtlety costs nothing today.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the contract schemas live. */
export const SCHEMA_DIR = join(HERE, '..', '..', 'schemas');

/**
 * The 16 structured output contracts, plus the ResearchPlan the research step
 * stores and the GenerationManifest generation keeps while media is being made,
 * plus the nine wave 2 contracts (docs/CONTRACTS.md section 2a) and the ReuseBrief the
 * existing creative route approves in place of a strategy. An artifact kind
 * must be one of these.
 */
export const CONTRACT_KINDS = [
  'JobExecutionPlan',
  'ResearchPlan',
  'BrandResearchResult',
  'CompetitorResearchResult',
  'TrendResearchResult',
  'AudienceResearchResult',
  'PlatformPlan',
  'NormalizedAssetRecord',
  'VideoCreativeAnalysis',
  'ImageCreativeAnalysis',
  'ScriptAnalysis',
  'CreativeProfile',
  'StrategySet',
  'CopyPackage',
  'GenerationManifest',
  'GeneratedMediaPackage',
  'SubtitlePackage',
  'PublishingResult',
  'HookAnalysis',
  'CommentMiningResult',
  'AdLibraryResearchResult',
  'SocialPostAnalysis',
  'VideoEvidencePackage',
  'VideoScript',
  'Storyboard',
  'MediaPlan',
  'EditDecisionList',
  'ReuseBrief',
];

/** @type {Map<string, any>} */
const SCHEMA_CACHE = new Map();

/**
 * Turn a contract name into its schema file name.
 * @param {string} kind
 * @returns {string}
 */
export function schemaFileName(kind) {
  return `${kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.schema.json`;
}

/**
 * Load the schema for a contract.
 * @param {string} kind
 * @returns {any}
 */
export function loadSchema(kind) {
  const cached = SCHEMA_CACHE.get(kind);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, schemaFileName(kind)), 'utf8'));
  SCHEMA_CACHE.set(kind, schema);
  return schema;
}

/**
 * Check a value against a schema.
 * @param {any} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]} plain language problems, empty when the value is fine.
 */
export function validateAgainstSchema(schema, value, path = '') {
  /** @type {string[]} */
  const problems = [];
  if (!schema || typeof schema !== 'object') return problems;
  const where = path || 'the result';

  if (schema.const !== undefined && value !== schema.const) {
    problems.push(`${where} should be ${JSON.stringify(schema.const)}.`);
    return problems;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    if (value === undefined && !isRequiredHere(schema)) return problems;
    problems.push(`${where} should be one of ${schema.enum.map((entry) => String(entry)).join(', ')}.`);
    return problems;
  }

  if (schema.type !== undefined && value !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      problems.push(`${where} should be ${types.join(' or ')}.`);
      return problems;
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (/** @type {any} */ (value)[key] === undefined) {
        problems.push(`${path ? `${path}.` : ''}${key} is missing.`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      const childValue = /** @type {any} */ (value)[key];
      if (childValue === undefined) continue;
      problems.push(...validateAgainstSchema(child, childValue, path ? `${path}.${key}` : key));
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      problems.push(`${where} needs at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}.`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      problems.push(`${where} can be at most ${schema.maxLength} characters.`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${where} is not in the form this field takes.`);
    }
    if (schema.format === 'date-time' && !isDateTime(value)) {
      problems.push(`${where} should be a date and time, for example 2026-09-15T10:00:00Z.`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      problems.push(`${where} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      problems.push(`${where} must be at most ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      problems.push(`${where} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      problems.push(`${where} can have at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}.`);
    }
    if (schema.items) {
      for (const [index, entry] of value.entries()) {
        problems.push(...validateAgainstSchema(schema.items, entry, `${path || 'item'}[${index}]`));
      }
    }
  }

  return problems;
}


/**
 * Whether a string is an ISO 8601 date and time, which is what `format: "date-time"`
 * means everywhere in schemas/. A date on its own is not one: the contracts use this
 * on fields like observed_at, where the time of day is part of the evidence.
 * @param {string} value
 * @returns {boolean}
 */
export function isDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * @param {any} schema
 * @returns {boolean}
 */
function isRequiredHere(schema) {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  return !types.includes('null');
}

/**
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}
