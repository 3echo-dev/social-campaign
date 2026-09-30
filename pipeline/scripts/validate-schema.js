#!/usr/bin/env node
// Minimal, dependency-free JSON Schema validator for the plugin's own schemas.
// Supports: type (incl. arrays of types), required, properties, additionalProperties (bool),
// enum, const, items, minItems, maxItems, minimum, maximum, pattern, minLength,
// allOf, and if/then/else.
//   node validate-schema.js <schema.json> <data.json>        exit 0 valid, 1 invalid, 2 usage
//   const { validate } = require('./validate-schema.js')     -> errors[]
const fs = require('fs');

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isFinite(v)) return 'invalid-number';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeOk(want, v) {
  const t = typeOf(v);
  const list = Array.isArray(want) ? want : [want];
  return list.some(w => w === t || (w === 'number' && t === 'integer'));
}
function validate(schema, data, path = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return errors;
  for (const branch of schema.allOf || []) validate(branch, data, path, errors);
  if (schema.if) {
    const matches = validate(schema.if, data, path, []).length === 0;
    if (matches && schema.then) validate(schema.then, data, path, errors);
    if (!matches && schema.else) validate(schema.else, data, path, errors);
  }
  if (schema.type && !typeOk(schema.type, data)) {
    errors.push({ path, keyword: 'type', message: 'expected ' + [].concat(schema.type).join('|') + ', got ' + typeOf(data) });
    return errors;
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(data))
    errors.push({ path, keyword: 'const', message: 'must equal ' + JSON.stringify(schema.const) });
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(data)))
    errors.push({ path, keyword: 'enum', message: 'must be one of ' + schema.enum.join(', ') });
  if (typeOf(data) === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength)
      errors.push({ path, keyword: 'minLength', message: 'shorter than ' + schema.minLength });
    if (schema.pattern && !new RegExp(schema.pattern).test(data))
      errors.push({ path, keyword: 'pattern', message: 'does not match ' + schema.pattern });
  }
  if (typeOf(data) === 'number' || typeOf(data) === 'integer') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path, keyword: 'minimum', message: 'below ' + schema.minimum });
    if (schema.maximum !== undefined && data > schema.maximum) errors.push({ path, keyword: 'maximum', message: 'above ' + schema.maximum });
  }
  if (typeOf(data) === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path, keyword: 'minItems', message: 'fewer than ' + schema.minItems + ' items' });
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path, keyword: 'maxItems', message: 'more than ' + schema.maxItems + ' items' });
    if (schema.items) data.forEach((it, i) => validate(schema.items, it, path + '[' + i + ']', errors));
  }
  if (typeOf(data) === 'object') {
    for (const r of schema.required || []) if (!(r in data) || data[r] === undefined)
      errors.push({ path: path + '.' + r, keyword: 'required', message: 'missing' });
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in data) validate(sub, data[k], path + '.' + k, errors);
    if (schema.additionalProperties === false)
      for (const k of Object.keys(data)) if (!(k in (schema.properties || {})) && !k.startsWith('_'))
        errors.push({ path: path + '.' + k, keyword: 'additionalProperties', message: 'unexpected field' });
  }
  return errors;
}
module.exports = { validate };

if (require.main === module) {
  const [s, d] = process.argv.slice(2);
  if (!s || !d) { console.error('usage: validate-schema.js <schema.json> <data.json>'); process.exit(2); }
  const errs = validate(JSON.parse(fs.readFileSync(s, 'utf8')), JSON.parse(fs.readFileSync(d, 'utf8')));
  if (errs.length) { for (const e of errs) console.error(e.path + ': ' + e.message + ' (' + e.keyword + ')'); process.exit(1); }
  console.log('ok: valid against ' + s);
}
