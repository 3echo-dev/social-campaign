/**
 * The options on the Strategy gate: what the person can pick for the industry, and for each concept's funnel stage, ad style, format
 * and CTA. They ride in the concepts review document, so the board draws a row of chips for each and pre-selects what the concept
 * already says.
 *
 *   review.concepts.strategyOptions = {
 *     industry: [Option], funnel: [Option], style: [Option], format: [Option], cta: [Option],
 *     industryPick: optionId | null,
 *   }
 *   Option = { id, text, yours?: true, label?: 'winner' | 'weak' | 'early' }
 *   review.concepts.concepts[n].picks = { funnel, style, format, cta }     the option id each of the concept's own fields names, else null
 *
 * Where the options come from:
 *   - the four playbooks read straight from the plugin (pipeline/playbooks): awareness-stages.md gives funnel (ids like problem_aware),
 *     ad-styles.md style (AS-*), visual-formats.md format (F-*), ctas.md cta (CTA-*). The ids are the first cell of each table row, so
 *     a row added to a playbook shows up on the next read (the parsed rows are cached by file modification time).
 *   - industry is a fixed starter list (the industry tags of ad-styles.md) plus the brand's own.
 *   - the brand's own options are its bank/yours.jsonl items of kind industry, funnel, style, format and cta (id = the bank item id,
 *     yours: true), best first. Both a brand's own item and a playbook row carry `label` when the brand's posted results call it
 *     (brand-results.mjs). Chips are named `<id> <Name>` for a style, format or CTA ("AS-PROBLEM-SOLUTION Problem solution"), so the
 *     playbook row stays exact in the approval note; a funnel stage is its name ("Problem aware").
 *
 * brand-library.mjs imports job-document.mjs, which imports this file, which imports brand-library.mjs: every use below is inside a
 * function, never at load time.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBank, sameText } from './brand-library.mjs';
import { rankBank } from './brand-results.mjs';

const PLAYBOOK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'playbooks');
const TEXT_LIMIT = 120;
const OWN_LIMIT = 12;
const LABELS = new Set(['winner', 'weak', 'early']);

/** The industry tags of playbooks/ad-styles.md, as the person reads them. ('other' is left out: "+ Add your own" covers it.) */
export const STARTER_INDUSTRIES = Object.freeze([
  ['beauty-skincare', 'Beauty and skincare'],
  ['food-beverage', 'Food and beverage'],
  ['fitness-health', 'Fitness and health'],
  ['education', 'Education'],
  ['finance', 'Finance'],
  ['real-estate', 'Real estate'],
  ['saas-ai-tech', 'Software, AI and tech'],
  ['retail-ecommerce', 'Retail and e-commerce'],
  ['hospitality-travel', 'Hospitality and travel'],
  ['professional-services', 'Professional services'],
  ['gaming-entertainment', 'Gaming and entertainment'],
].map(([id, text]) => Object.freeze({ id, text })));

/** The rows that come from a playbook: the file, and what the first cell of a table row must look like to be an option. */
const PLAYBOOK_ROWS = Object.freeze({
  funnel: { file: 'awareness-stages.md', id: /^(?:unaware|[a-z]+_aware)$/ },
  style: { file: 'ad-styles.md', id: /^AS-[A-Z0-9]+(?:-[A-Z0-9]+)*$/ },
  format: { file: 'visual-formats.md', id: /^F-[A-Z0-9]+(?:-[A-Z0-9]+)*$/ },
  cta: { file: 'ctas.md', id: /^CTA-[A-Z0-9]+(?:-[A-Z0-9]+)*$/ },
});
export const STRATEGY_ROWS = Object.freeze(['industry', 'funnel', 'style', 'format', 'cta']);

/** How the fields of a concept name the rows, as the concepts template writes them (Awareness stage, Ad style, Visual format, CTA). */
const CONCEPT_FIELDS = Object.freeze({
  funnel: /^(?:awareness|funnel)[\s_-]*stage\b/i,
  style: /^ad[\s_-]*style\b/i,
  format: /^(?:visual[\s_-]*)?format\b/i,
  cta: /^cta\b/i,
});

// ---------------------------------------------------------------- small helpers
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const STOP_WORDS = new Set(['and', 'the', 'a', 'an', 'of', 'in', 'to', 'for', 'with', 'or', 'on']);
/** "Problem and solution" and "problem-solution" read the same: lower case, letters and digits, small joining words dropped. */
const tokenKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word && !STOP_WORDS.has(word)).join(' ');
const ACRONYMS = new Set(['roi', 'ugc', 'dm', 'faq', 'ai', 'seo', 'cgi']);

/** The name a playbook id carries: AS-PROBLEM-SOLUTION is "Problem solution", problem_aware is "Problem aware", F-UGC-SELFIE is "UGC selfie". */
function nameOf(id) {
  const words = String(id).replace(/^[A-Z]{1,4}-(?=[A-Z0-9])/, '').split(/[-_]+/).filter(Boolean).map(word => word.toLowerCase());
  const name = words.map(word => (ACRONYMS.has(word) ? word.toUpperCase() : word)).join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
const textOf = (kind, id) => (kind === 'funnel' ? nameOf(id) : `${id} ${nameOf(id)}`);

// ---------------------------------------------------------------- the playbooks
const parsed = new Map();

/** The first cell of every table row of a playbook, without the backticks around an id. */
function firstCells(text) {
  const cells = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row.startsWith('|')) continue;
    cells.push(row.slice(1).split(/(?<!\\)\|/)[0].replace(/[`*]/g, '').trim());
  }
  return cells;
}

/** The options of one playbook row, in the order of the file; an id that appears in a later table of the same file is not repeated. */
function playbookRow(kind, dir) {
  const { file, id } = PLAYBOOK_ROWS[kind];
  const path = join(dir, file);
  let stamp;
  try { const stat = statSync(path); stamp = `${stat.mtimeMs}:${stat.size}`; } catch { return []; }
  const hit = parsed.get(path);
  if (hit && hit.stamp === stamp) return hit.options;
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const seen = new Set();
  const options = [];
  for (const cell of firstCells(text)) {
    if (!id.test(cell) || seen.has(cell)) continue;
    seen.add(cell);
    options.push(Object.freeze({ id: cell, text: textOf(kind, cell) }));
  }
  parsed.set(path, { stamp, options });
  return options;
}

/** { funnel, style, format, cta }: the playbook options, each a frozen { id, text }. */
export function playbookOptions({ dir = PLAYBOOK_DIR } = {}) {
  return Object.fromEntries(Object.keys(PLAYBOOK_ROWS).map(kind => [kind, playbookRow(kind, dir)]));
}

// ---------------------------------------------------------------- the brand's own options and results
/** The brand's own bank items by row, best first (posted results, then newest): [{ id, text, yours: true, label? }]. */
function ownOptions({ root, brand }) {
  const out = Object.fromEntries(STRATEGY_ROWS.map(kind => [kind, []]));
  if (!root || !brand) return out;
  let items = [];
  try { items = readBank({ root, brand, bank: 'yours' }); } catch { return out; }
  for (const item of items) {
    const list = Object.hasOwn(out, item.kind) ? out[item.kind] : null;
    if (!list || list.length >= OWN_LIMIT) continue;
    list.push({ id: item.id, text: clip(item.text, TEXT_LIMIT), yours: true, ...(LABELS.has(item.label) ? { label: item.label } : {}) });
  }
  return out;
}

/** What the brand's posted results call each playbook row it used: { style: { 'AS-OFFER': 'winner' }, cta: {...}, format: {...} }. */
function playbookLabels({ root, brand }) {
  const out = { style: {}, format: {}, cta: {} };
  if (!root || !brand) return out;
  try {
    const ranking = rankBank({ root, brand });
    if (!ranking.hasResults) return out;
    for (const kind of Object.keys(out)) {
      for (const entry of ranking.dimensions?.[kind] ?? []) if (LABELS.has(entry.label)) out[kind][entry.key] = entry.label;
    }
  } catch { /* no results to read: no labels */ }
  return out;
}

// ---------------------------------------------------------------- matching a value to an option
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Ids that cannot be an everyday word (AS-OFFER, problem_aware): only these count when they sit inside a longer value. */
const CODE_ID = /^[A-Z]{1,4}-|_/;
const mentions = (text, id) => new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, 'i').test(text);

/** The words an option answers to: its own text and, for a playbook row, the name in its id. */
function keysOf(option) {
  if (option.yours) return [tokenKey(option.text)];
  return [tokenKey(option.text), tokenKey(nameOf(option.id)), tokenKey(String(option.id).replace(/[-_]+/g, ' '))];
}

// A hyphen, en dash or em dash with a space each side separates an id from its line ("CTA-SAVE - Save this").
const DASH = `[-${String.fromCharCode(0x2013, 0x2014)}]`;
const SPLIT_AT = new RegExp(String.raw`\s${DASH}\s|:|\(`);
const DASH_ONLY = new RegExp(String.raw`^\s${DASH}\s$`);

/** The pieces of a field worth trying: the whole line, the part before a dash, colon or bracket, and the part after the dash. */
function pieces(text) {
  const out = [text];
  const split = SPLIT_AT.exec(text);
  if (split) {
    out.push(text.slice(0, split.index));
    if (DASH_ONLY.test(split[0])) out.push(text.slice(split.index + split[0].length));
  }
  return out.map(piece => piece.trim()).filter(Boolean);
}

/**
 * The option a value names, or null. First a piece of the value that says the option's name ("Problem and solution", "problem aware",
 * "AS-PROBLEM-SOLUTION") or a brand's own option word for word, then a playbook id anywhere in the value ("{F-TALKING-HEAD}, family X").
 * With `scan` (the funnel stage and the industry, which a person writes inside a sentence) an option's name inside the value counts
 * too, the earliest and then the longest.
 */
export function matchOption(value, options, { scan = false } = {}) {
  const first = String(value ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  if (!first || !Array.isArray(options) || !options.length) return null;
  const text = first.replace(/[`*{}]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const piece of pieces(text)) {
    const key = tokenKey(piece);
    const found = options.find(option => sameText(option.text, piece) || (key && keysOf(option).includes(key)));
    if (found) return found.id;
  }
  const byId = options.filter(option => !option.yours && CODE_ID.test(option.id) && mentions(text, option.id)).sort((a, b) => b.id.length - a.id.length)[0];
  if (byId) return byId.id;
  if (scan) {
    const whole = ` ${tokenKey(text)} `;
    let best = null;
    for (const option of options) {
      for (const key of keysOf(option)) {
        if (key.length < 4) continue;
        const at = whole.indexOf(` ${key} `);
        if (at >= 0 && (!best || at < best.at || (at === best.at && key.length > best.length))) best = { id: option.id, at, length: key.length };
      }
    }
    if (best) return best.id;
  }
  return null;
}

// ---------------------------------------------------------------- the options of a concepts document
const summaryValue = (summary, pattern) => (Array.isArray(summary) ? summary.find(line => pattern.test(String(line?.label ?? '')))?.value ?? null : null);

/**
 * The strategyOptions of a concepts review. `summary` is parseConcepts' strategy summary (the Industry line picks the industry);
 * `root` and `brand` bring the brand's own options and result labels. Playbooks that cannot be read give empty rows.
 */
export function strategyOptionsFor({ root = null, brand = null, summary = [], playbookDir = PLAYBOOK_DIR } = {}) {
  const book = playbookOptions({ dir: playbookDir });
  const own = ownOptions({ root, brand });
  const labels = playbookLabels({ root, brand });
  const withoutOwn = (list, kind) => list.filter(option => !own[kind].some(mine => sameText(mine.text, option.text)));
  const rows = {
    industry: [...own.industry, ...withoutOwn(STARTER_INDUSTRIES, 'industry').map(option => ({ ...option }))],
  };
  for (const kind of Object.keys(PLAYBOOK_ROWS)) {
    rows[kind] = [...own[kind], ...withoutOwn(book[kind], kind).map(option => ({ ...option, ...(labels[kind]?.[option.id] ? { label: labels[kind][option.id] } : {}) }))];
  }
  // The industry the strategy names. A value that is none of the options is shown as one more, so the card never hides what it says.
  let industryPick = null;
  const said = summaryValue(summary, /^industry\b/i);
  if (said) {
    industryPick = matchOption(said, rows.industry, { scan: true });
    const name = clip(said.replace(/\s*\([^)]*\)\s*$/, ''), TEXT_LIMIT);
    if (!industryPick && name) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'industry';
      rows.industry.push({ id: `industry:${slug}`, text: name });
      industryPick = `industry:${slug}`;
    }
  }
  if (!industryPick) {
    const latest = readLatestIndustry({ root, brand });
    industryPick = latest && rows.industry.some(option => option.id === latest.id) ? latest.id : null;
  }
  return { ...rows, industryPick };
}

/** The brand's newest industry item (the list above is ranked, so it is not the newest). */
function readLatestIndustry({ root, brand }) {
  if (!root || !brand) return null;
  try { return readBank({ root, brand, bank: 'yours', kind: 'industry', ranked: false })[0] ?? null; } catch { return null; }
}

/** { funnel, style, format, cta }: the option id each of the concept's own fields names, else null. */
export function conceptPicks(concept, options) {
  const picks = {};
  for (const [kind, pattern] of Object.entries(CONCEPT_FIELDS)) {
    const field = Array.isArray(concept?.fields) ? concept.fields.find(item => pattern.test(String(item?.label ?? ''))) : null;
    picks[kind] = field ? matchOption(field.value, options?.[kind] ?? [], { scan: kind === 'funnel' }) : null;
  }
  return picks;
}

/**
 * parseConcepts' result with `strategyOptions` and, on each concept, `picks`. Never throws: when the options cannot be made the
 * result comes back as it was, and the board shows no rows.
 */
export function withStrategyOptions(result, { root = null, brand = null, playbookDir } = {}) {
  try {
    const strategyOptions = strategyOptionsFor({ root, brand, summary: result?.summary, ...(playbookDir ? { playbookDir } : {}) });
    return { ...result, concepts: result.concepts.map(concept => ({ ...concept, picks: conceptPicks(concept, strategyOptions) })), strategyOptions };
  } catch { return result; }
}
