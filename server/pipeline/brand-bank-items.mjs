/**
 * The brand intelligence banks: the extra fields an item of the pain, desire, objection, angle, caption and cta kinds carries, and the
 * rule for merging a second sighting of the same item. Pure helpers; brand-library.mjs holds the files and calls these.
 *
 *   pain, desire, objection   what the audience says, in its own words (text), who says it, how aware of the problem they are, how often it
 *                             came up (count) and the quotes that show it: { text, url, date } with the link of the page each came from.
 *   angle                     a pain matched with a proof: the line to build a concept on (text), the pain it answers (pain, and painId when
 *                             that pain is in the bank) and the proof that backs it (proof).
 *   caption                   a post's caption, with its structure: { hook, body, cta, hashtags: [..] }.
 *   cta                       the ask, with its type (ctaType: comment keyword, link in bio, dm, follow, sign up and so on).
 *
 * Every item also has what every bank item has: text, evidence, and its source (brand, competitor, community, review, ad or starter;
 * the person's own lines sit in the yours bank).
 *
 * Merging: the same words (compared without case, punctuation or spacing) are one item. A second sighting that brings a new quote adds it
 * and counts it; one that brings nothing new changes nothing, so saving the same research twice never inflates a count.
 */

import * as runtime from './runtime.mjs';

/** The kinds that hold the audience's own words. */
export const INSIGHT_KINDS = Object.freeze(['pain', 'desire', 'objection']);
/** Where a banked item came from: the brand's own pages and posts, a competitor's, a forum or comments, a review page, an ad, or the plugin's starter lines. */
export const BANK_SOURCES = Object.freeze(['brand', 'competitor', 'community', 'review', 'ad', 'starter']);
/** The sources that may name a competitor (a review of one, an ad of one). */
export const COMPETITOR_SOURCES = Object.freeze(['competitor', 'review', 'ad']);
export const AWARENESS_STAGES = Object.freeze(['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware']);
export const CTA_TYPES = Object.freeze(['comment keyword', 'link in bio', 'dm', 'follow', 'sign up', 'book a call', 'shop', 'watch', 'save or share', 'other']);
export const MAX_QUOTES = 5;
export const MAX_COUNT = 9999;
const QUOTE_TEXT_LIMIT = 300;
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}/;

const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};

/** The words without case, accents, punctuation or spacing: "AI gives wrong answers!" and "ai gives wrong answers" are one pain. */
export const looseText = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const sameInsight = (a, b) => {
  const left = looseText(a);
  return Boolean(left) && left === looseText(b);
};

/** Kinds whose items are compared by looseText instead of sameText: the ones that are the audience's words, and the angles built from them. */
export const isInsightKind = kind => INSIGHT_KINDS.includes(kind) || kind === 'angle';

/** "problem_aware", "Problem aware" and "problem-aware" are the same stage; anything else is null. */
export function stageOf(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return AWARENESS_STAGES.includes(key) ? key : null;
}

const dayOf = value => (typeof value === 'string' && PLAIN_DAY.test(value.trim()) ? value.trim().slice(0, 10) : null);
const quoteKey = quote => `${looseText(quote.text)}|${String(quote.url ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')}`;

/** The quotes as they are kept: { text, url, date }, with an https link each (a quote without one is left out), at most five, none twice. */
export function quotesOf(value) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== 'object') continue;
    const text = clip(raw.text, QUOTE_TEXT_LIMIT);
    const url = runtime.webLink(raw.url);
    if (!text || !url) continue;
    const quote = { text, url, date: dayOf(raw.date) };
    const key = quoteKey(quote);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(quote);
    if (out.length >= MAX_QUOTES) break;
  }
  return out;
}

/** A whole number from 1 to 9999, else null. */
export function countOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(MAX_COUNT, Math.round(number)) : null;
}

/** { hook, body, cta, hashtags } of a caption, each part clipped; null when it has none. */
export function structureOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  const hook = clip(value.hook, 300); if (hook) out.hook = hook;
  const body = clip(value.body, 600); if (body) out.body = body;
  const cta = clip(value.cta, 200); if (cta) out.cta = cta;
  const tags = (Array.isArray(value.hashtags) ? value.hashtags : []).map(tag => clip(tag, 40)).filter(Boolean).slice(0, 8);
  if (tags.length) out.hashtags = tags;
  return Object.keys(out).length ? out : null;
}

/** The type of a call to action: one of CTA_TYPES (any other wording is "other"), or null when none is given. */
export function ctaTypeOf(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  return CTA_TYPES.includes(text) ? text : 'other';
}

/**
 * The detail fields of an item as they are kept, each only when given (and valid): who, awarenessStage, count, quotes, pain, painId,
 * proof, structure, ctaType. With quotes and no count the count is the number of quotes; a count under the number of quotes is raised to it.
 */
export function detailsOf(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const out = {};
  const who = clip(raw.who, 80); if (who) out.who = who;
  const stage = stageOf(raw.awarenessStage); if (stage) out.awarenessStage = stage;
  const quotes = quotesOf(raw.quotes);
  if (quotes.length) out.quotes = quotes;
  const count = Math.max(countOf(raw.count) ?? 0, quotes.length);
  if (count) out.count = Math.min(MAX_COUNT, count);
  const pain = clip(raw.pain, 300); if (pain) out.pain = pain;
  if (typeof raw.painId === 'string' && /^[yp]-[0-9a-f]{10}$/.test(raw.painId.trim())) out.painId = raw.painId.trim();
  const proof = clip(raw.proof, 300); if (proof) out.proof = proof;
  const structure = structureOf(raw.structure); if (structure) out.structure = structure;
  const type = ctaTypeOf(raw.ctaType); if (type) out.ctaType = type;
  return out;
}

const SET_ONCE = Object.freeze(['who', 'awarenessStage', 'pain', 'painId', 'proof', 'structure', 'ctaType']);

/**
 * Fold a second sighting into the item already in the bank. `details` is detailsOf(...). A field the item lacks is filled; quotes the
 * item does not have are added (up to five) and counted; a count the sighting reports on its own is added only for quotes it brings.
 * Returns { item, changed }; changed is false when the sighting adds nothing, so the same research twice changes nothing.
 */
export function mergeDetails(current, details) {
  const next = { ...current };
  let changed = false;
  for (const key of SET_ONCE) {
    if (details[key] !== undefined && (next[key] === undefined || next[key] === null || next[key] === '')) { next[key] = details[key]; changed = true; }
  }
  const had = Array.isArray(current.quotes) ? current.quotes : [];
  const base = countOf(current.count) ?? had.length;
  const seen = new Set(had.map(quoteKey));
  const given = Array.isArray(details.quotes) ? details.quotes : [];
  const fresh = given.filter(quote => !seen.has(quoteKey(quote)));
  if (fresh.length) {
    const unseen = Math.max(0, (details.count ?? 0) - given.length);
    next.quotes = [...had, ...fresh].slice(0, MAX_QUOTES);
    next.count = Math.min(MAX_COUNT, base + fresh.length + unseen);
    changed = true;
  } else if ((details.count ?? 0) > base) {
    next.count = Math.min(MAX_COUNT, details.count);
    changed = true;
  }
  return { item: next, changed };
}

/** Most mentions first, then the most quotes, then the newest: the order of a pain, desire or objection bank. */
export const byMentions = (a, b) => (countOf(b.count) ?? 0) - (countOf(a.count) ?? 0)
  || (Array.isArray(b.quotes) ? b.quotes.length : 0) - (Array.isArray(a.quotes) ? a.quotes.length : 0)
  || String(b.at ?? '').localeCompare(String(a.at ?? ''));
