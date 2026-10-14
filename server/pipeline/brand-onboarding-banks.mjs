/**
 * The brand intelligence banks in a research draft: what the audience struggles with, wants and doubts (in its own words), the angles that
 * match a pain with a proof, and the captions and calls to action that work, found by the "pain points" and "hooks, captions and CTAs"
 * workstreams of the research skill. The draft carries them as
 *
 *   banks: {
 *     pains:      [{ text, who?, awarenessStage?, count?, source, competitor?, quotes: [{ text, url, date? }] }],
 *     desires:    [same],   objections: [same],
 *     angles:     [{ text, pain, proof, proofSource }],
 *     captions:   [{ text, source, competitor?, url, structure?: { hook, body, cta, hashtags }, runningDays? }],
 *     ctas:       [{ text, type?, source, competitor?, url, runningDays? }],
 *   }
 *
 * A pain, desire or objection is checked like any other evidence of the run: each quote has the address of one of the run's listed sources
 * (with a readable capture) and is found in that capture, so a quote is only ever words a page really held. An angle names a pain of the
 * draft (or one already in the bank) word for word, and its proof is copied from the capture of the page that shows it. A caption or call
 * to action is found in the post it comes from (one of the checked topPosts) or, for an ad, in the capture of the ad page.
 *
 * The same checks serve a job's researchers (brand-job-banks.mjs), where a quote that cannot be found is dropped instead of failing the
 * save. Filing goes through addToBank, the call brand_bank_save makes, so the same research twice adds nothing and a pain seen again gains
 * its new quotes and count.
 *
 * Every function returns plain { field, problem } rows or counts, and changes nothing but the bank.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addToBank, readBank } from './brand-library.mjs';
import { AWARENESS_STAGES, COMPETITOR_SOURCES, MAX_COUNT, MAX_QUOTES, countOf, ctaTypeOf, sameInsight, stageOf, structureOf } from './brand-bank-items.mjs';
import * as runtime from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const evidence = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-onboarding-evidence.js'));

/** The lists of `banks` and the most items each may hold. */
export const BANK_LISTS = Object.freeze({ pains: 12, desires: 8, objections: 8, angles: 6, captions: 10, ctas: 10 });
export const BANK_KEYS = Object.freeze(Object.keys(BANK_LISTS));
const KIND_OF = Object.freeze({ pains: 'pain', desires: 'desire', objections: 'objection' });
export const INSIGHT_SOURCES = Object.freeze(['brand', 'competitor', 'community', 'review', 'ad']);
export const POST_SOURCES = Object.freeze(['brand', 'competitor', 'ad']);
const INSIGHT_FIELDS = Object.freeze(['text', 'who', 'awarenessStage', 'count', 'source', 'competitor', 'quotes']);
const ANGLE_FIELDS = Object.freeze(['text', 'pain', 'proof', 'proofSource']);
const CAPTION_FIELDS = Object.freeze(['text', 'source', 'competitor', 'url', 'structure', 'runningDays']);
const CTA_FIELDS = Object.freeze(['text', 'type', 'source', 'competitor', 'url', 'runningDays']);
const QUOTE_FIELDS = Object.freeze(['text', 'url', 'date']);
const WORDS_MIN = 8;
const WORDS_MAX = 300;
const CAPTION_MAX = 600;
const CTA_MAX = 200;
const QUOTE_MIN = evidence.MIN_QUOTE_CHARS;
const DAY_MS = 86400000;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const plain = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const given = (value) => value !== undefined && value !== null && value !== '';
const emptyBanks = () => ({ pains: [], desires: [], objections: [], angles: [], captions: [], ctas: [] });

/** The competitor's name as the brand knows it, or null; with no list to check against (a job) any name is taken as written. */
function competitorOf(name, list) {
  const text = plain(name);
  if (!text) return null;
  if (!Array.isArray(list)) return text.slice(0, 80);
  return list.find((item) => String(item).toLowerCase() === text.toLowerCase()) ?? null;
}

/**
 * The quotes of a pain, desire or objection: each { text, url, date? } with the address of a listed source, its words found in that
 * source's capture. Returns { quotes, problems }; a quote with a problem is not in `quotes`.
 */
function quotesOf(raw, field, ctx) {
  const problems = [];
  const at = `${field}.quotes`;
  if (!Array.isArray(raw) || !raw.length) {
    return { quotes: [], problems: [{ field: at, problem: 'quotes needs 1 to 5 quotes: words copied exactly from a page you saved, each with the address of that page.' }] };
  }
  if (raw.length > MAX_QUOTES) problems.push({ field: at, problem: `quotes holds at most ${MAX_QUOTES} quotes (has ${raw.length}). Count the rest in count.` });
  const quotes = [];
  raw.slice(0, MAX_QUOTES).forEach((item, index) => {
    const where = `${at}[${index}]`;
    const fail = (key, problem) => problems.push({ field: `${where}.${key}`, problem });
    if (!isObject(item)) { problems.push({ field: where, problem: 'Each quote must be an object with text, url and date.' }); return; }
    for (const key of Object.keys(item)) if (!QUOTE_FIELDS.includes(key)) fail(key, `"${key}" is not a quote field. Use ${QUOTE_FIELDS.join(', ')}.`);
    const text = plain(item.text);
    const url = runtime.webLink(item.url);
    if (!url) { fail('url', 'url must be the https address of one of the sources you listed.'); return; }
    const hit = typeof ctx.captureFor === 'function' ? ctx.captureFor(url) : null;
    if (!hit) { fail('url', 'url must be one of research.sources, with a readable capture. Quote only pages you saved.'); return; }
    if (text.length < QUOTE_MIN || text.length > WORDS_MAX) { fail('text', `text is the quote, ${QUOTE_MIN} to ${WORDS_MAX} characters.`); return; }
    if (!evidence.quoteFound(hit.squashed, text)) { fail('text', 'The quote is not in the saved capture of its source. Copy it exactly as it appears in the capture (use ... to skip words).'); return; }
    let date = null;
    if (given(item.date)) {
      const day = typeof item.date === 'string' ? item.date.trim() : '';
      if (!PLAIN_DATE.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) { fail('date', 'date must be the day the comment or post was written, as YYYY-MM-DD, or left out.'); return; }
      if (Date.parse(`${day}T00:00:00Z`) > (ctx.now instanceof Date ? ctx.now : new Date()).getTime() + DAY_MS) { fail('date', 'date is in the future.'); return; }
      date = day;
    }
    quotes.push({ text, url, date: date ?? (typeof ctx.observedDay === 'function' ? ctx.observedDay(url) : null) ?? null });
  });
  return { quotes, problems };
}

/** One pain, desire or objection. Returns the cleaned item, or null when it has a problem (they are added to `problems`). */
function insightItem(raw, field, ctx, problems) {
  const before = problems.length;
  const fail = (key, problem) => problems.push({ field: `${field}.${key}`, problem });
  if (!isObject(raw)) { problems.push({ field, problem: 'Each item must be an object.' }); return null; }
  for (const key of Object.keys(raw)) if (!INSIGHT_FIELDS.includes(key)) fail(key, `"${key}" is not an item field. Use ${INSIGHT_FIELDS.join(', ')}.`);
  const text = plain(raw.text);
  if (text.length < WORDS_MIN || text.length > WORDS_MAX) fail('text', `text is the problem, want or doubt in the customer's own words, ${WORDS_MIN} to ${WORDS_MAX} characters.`);
  else if (/https?:|www\./i.test(text)) fail('text', 'text must not contain a link; the quotes carry the links.');
  const source = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';
  if (!INSIGHT_SOURCES.includes(source)) fail('source', `source must be one of ${INSIGHT_SOURCES.join(', ')}.`);
  let competitor = null;
  if (given(raw.competitor)) {
    if (!COMPETITOR_SOURCES.includes(source)) fail('competitor', 'competitor is only for what a competitor\'s customers said, or a competitor\'s ad.');
    else { competitor = competitorOf(raw.competitor, ctx.competitors); if (!competitor) fail('competitor', 'competitor must be the name of one of this brand\'s competitors.'); }
  } else if (source === 'competitor') fail('competitor', 'competitor is needed when the source is a competitor.');
  if (given(raw.who) && (typeof raw.who !== 'string' || plain(raw.who).length > 80)) fail('who', 'who must be text of at most 80 characters: who has this problem.');
  let awarenessStage = null;
  if (given(raw.awarenessStage)) {
    awarenessStage = stageOf(raw.awarenessStage);
    if (!awarenessStage) fail('awarenessStage', `awarenessStage must be one of ${AWARENESS_STAGES.join(', ')}.`);
  }
  const checked = quotesOf(raw.quotes, field, ctx);
  // A job's researcher drops a quote it cannot show and keeps the item while one quote stands; a run's draft must be right in every quote.
  if (!(ctx.drop && checked.quotes.length)) problems.push(...checked.problems);
  let count = null;
  if (given(raw.count)) {
    count = countOf(raw.count);
    if (count === null || Number(raw.count) !== count || count > MAX_COUNT) fail('count', 'count must be a whole number from 1: how many comments, reviews or posts you read that said it.');
    else if (count < checked.quotes.length) fail('count', 'count is lower than the number of quotes.');
  }
  if (problems.length > before) return null;
  return {
    text, source, ...(competitor ? { competitor } : {}),
    ...(given(raw.who) ? { who: plain(raw.who) } : {}),
    ...(awarenessStage ? { awarenessStage } : {}),
    count: Math.max(count ?? 0, checked.quotes.length), quotes: checked.quotes,
  };
}

/** One angle: a pain matched with a proof. `painTexts` are the pains of the draft and of the bank. */
function angleItem(raw, field, painTexts, ctx, problems) {
  const before = problems.length;
  const fail = (key, problem) => problems.push({ field: `${field}.${key}`, problem });
  if (!isObject(raw)) { problems.push({ field, problem: 'Each item must be an object.' }); return null; }
  for (const key of Object.keys(raw)) if (!ANGLE_FIELDS.includes(key)) fail(key, `"${key}" is not an angle field. Use ${ANGLE_FIELDS.join(', ')}.`);
  const text = plain(raw.text);
  if (text.length < WORDS_MIN || text.length > WORDS_MAX) fail('text', `text is the angle in one line, a pain matched with a proof, ${WORDS_MIN} to ${WORDS_MAX} characters.`);
  const pain = painTexts.find((item) => sameInsight(item, raw.pain)) ?? null;
  if (!pain) fail('pain', 'pain must be the text of one of banks.pains (or of a pain already in the brand library), word for word.');
  const proof = plain(raw.proof);
  const url = runtime.webLink(raw.proofSource);
  const hit = url && typeof ctx.captureFor === 'function' ? ctx.captureFor(url) : null;
  if (!url || !hit) fail('proofSource', 'proofSource must be the https address of one of research.sources, with a readable capture: the page that shows the proof.');
  if (proof.length < WORDS_MIN || proof.length > WORDS_MAX) fail('proof', `proof is the claim, number or result the brand shows, copied from the page, ${WORDS_MIN} to ${WORDS_MAX} characters.`);
  else if (hit && !evidence.quoteFound(hit.squashed, proof)) fail('proof', 'The proof is not in the saved capture of its source. Copy it exactly as it appears in the capture (use ... to skip words).');
  if (problems.length > before) return null;
  return { text, pain, proof, proofSource: url, proofDate: (typeof ctx.observedDay === 'function' ? ctx.observedDay(url) : null) ?? null };
}

/** One caption or call to action, from a checked top post or from an ad page's capture. */
function postItem(raw, field, kind, ctx, problems) {
  const before = problems.length;
  const fail = (key, problem) => problems.push({ field: `${field}.${key}`, problem });
  if (!isObject(raw)) { problems.push({ field, problem: 'Each item must be an object.' }); return null; }
  const allowed = kind === 'caption' ? CAPTION_FIELDS : CTA_FIELDS;
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail(key, `"${key}" is not a ${kind} field. Use ${allowed.join(', ')}.`);
  const text = plain(raw.text);
  const max = kind === 'caption' ? CAPTION_MAX : CTA_MAX;
  const min = kind === 'caption' ? WORDS_MIN : 3;
  if (text.length < min || text.length > max) fail('text', `text is the ${kind === 'caption' ? 'caption' : 'call to action'} exactly as the post or ad has it, ${min} to ${max} characters.`);
  const source = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';
  if (!POST_SOURCES.includes(source)) fail('source', `source must be one of ${POST_SOURCES.join(', ')}.`);
  let competitor = null;
  if (given(raw.competitor)) {
    if (source === 'brand') fail('competitor', 'competitor is only for a competitor\'s post or ad.');
    else { competitor = competitorOf(raw.competitor, ctx.competitors); if (!competitor) fail('competitor', 'competitor must be the name of one of this brand\'s competitors.'); }
  } else if (source === 'competitor') fail('competitor', 'competitor is needed when the source is a competitor.');
  const url = runtime.webLink(raw.url);
  if (!url) fail('url', 'url must be the https address of the post or ad.');
  // A post of the run's topPosts carries its own views, likes, date and thumbnail; an ad (or any page, in a job) is found in the saved capture.
  const post = url && Array.isArray(ctx.posts) && source !== 'ad'
    ? ctx.posts.find((item) => evidence.normUrl(item.url) === evidence.normUrl(url) && item.source === source && (source !== 'competitor' || !competitor || String(item.competitor).toLowerCase() === competitor.toLowerCase())) ?? null
    : null;
  let proof = null;
  if (url && text) {
    if (post) {
      const hay = evidence.squash([post.caption, post.text, post.breakdown && post.breakdown.cta, post.breakdown && post.breakdown.spokenHook].filter(Boolean).join(' '));
      if (!evidence.quoteFound(hay, text)) fail('text', `The ${kind === 'caption' ? 'caption' : 'call to action'} is not in that post's caption or call to action. Copy it exactly (use ... to skip words).`);
      else proof = { url: post.url, ...(Number.isFinite(post.views) ? { views: post.views } : { likes: post.likes }), date: post.date, ...(post.thumbnail ? { thumbnail: post.thumbnail } : {}) };
    } else if (Array.isArray(ctx.posts) && source !== 'ad') {
      fail('url', `url must be the link of one of the ${source === 'brand' ? 'brand\'s own' : 'competitor\'s'} topPosts you listed.`);
    } else {
      const hit = typeof ctx.captureFor === 'function' ? ctx.captureFor(url) : null;
      if (!hit) fail('url', 'url must be one of research.sources, with a readable capture: the page of the ad or post.');
      else if (!evidence.quoteFound(hit.squashed, text)) fail('text', `The ${kind === 'caption' ? 'caption' : 'call to action'} is not in the saved capture of its source. Copy it exactly as it appears in the capture (use ... to skip words).`);
      else proof = { url, date: (typeof ctx.observedDay === 'function' ? ctx.observedDay(url) : null) ?? null };
    }
  }
  let structure = null;
  if (kind === 'caption' && given(raw.structure)) {
    if (!isObject(raw.structure)) fail('structure', 'structure must be an object: { hook, body, cta, hashtags }.');
    else structure = structureOf(raw.structure);
  }
  let ctaType = null;
  if (kind === 'cta' && given(raw.type)) {
    if (typeof raw.type !== 'string') fail('type', 'type must be text, such as "comment keyword", "link in bio", "dm", "follow" or "sign up".');
    else ctaType = ctaTypeOf(raw.type);
  }
  let runningDays = null;
  if (given(raw.runningDays)) {
    if (source !== 'ad') fail('runningDays', 'runningDays is only for an ad.');
    else if (!Number.isInteger(raw.runningDays) || raw.runningDays < 0 || raw.runningDays > 3650) fail('runningDays', 'runningDays must be a whole number of days from 0: how long the ad library says the ad has run.');
    else runningDays = raw.runningDays;
  }
  if (problems.length > before) return null;
  return { text, source, ...(competitor ? { competitor } : {}), url, evidence: proof, ...(structure ? { structure } : {}), ...(ctaType ? { ctaType } : {}), ...(runningDays !== null ? { runningDays } : {}) };
}

/**
 * Check a draft's `banks`. ctx:
 *   captureFor(url)   the saved capture ({ squashed }) of a listed source, or null
 *   observedDay(url)  the day that source was read (YYYY-MM-DD), or null
 *   posts             the checked topPosts, or null for a job (then a caption or call to action is found in a saved page)
 *   competitors       the brand's competitor names, or null to take any name as written
 *   painTexts         the pains already in the bank, which an angle may name
 *   now, drop         the date; true when a quote that cannot be shown is dropped and the item kept (a job's researcher)
 * @returns {{ value: object, problems: {field: string, problem: string}[] }} value holds only the items that passed
 */
export function banksProblems(input, ctx = {}) {
  const problems = [];
  const value = emptyBanks();
  if (input === undefined || input === null) return { value, problems };
  if (!isObject(input)) return { value, problems: [{ field: 'banks', problem: `banks must be an object with the lists ${BANK_KEYS.join(', ')}.` }] };
  for (const key of Object.keys(input)) if (!BANK_KEYS.includes(key)) problems.push({ field: `banks.${key}`, problem: `"${key}" is not a bank. Use ${BANK_KEYS.join(', ')}.` });
  const lists = {};
  for (const key of BANK_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null) { lists[key] = []; continue; }
    if (!Array.isArray(raw)) { problems.push({ field: `banks.${key}`, problem: `banks.${key} must be a list.` }); lists[key] = []; continue; }
    if (raw.length > BANK_LISTS[key]) problems.push({ field: `banks.${key}`, problem: `banks.${key} holds at most ${BANK_LISTS[key]} items (has ${raw.length}).` });
    lists[key] = raw.slice(0, BANK_LISTS[key]);
  }
  for (const key of Object.keys(KIND_OF)) {
    lists[key].forEach((raw, index) => { const item = insightItem(raw, `banks.${key}[${index}]`, ctx, problems); if (item) value[key].push(item); });
  }
  const painTexts = [...value.pains.map((item) => item.text), ...(Array.isArray(ctx.painTexts) ? ctx.painTexts : [])];
  lists.angles.forEach((raw, index) => { const item = angleItem(raw, `banks.angles[${index}]`, painTexts, ctx, problems); if (item) value.angles.push(item); });
  lists.captions.forEach((raw, index) => { const item = postItem(raw, `banks.captions[${index}]`, 'caption', ctx, problems); if (item) value.captions.push(item); });
  lists.ctas.forEach((raw, index) => { const item = postItem(raw, `banks.ctas[${index}]`, 'cta', ctx, problems); if (item) value.ctas.push(item); });
  return { value, problems };
}

/** How many items the checked banks hold in all. */
export function bankItemCount(banks) {
  return BANK_KEYS.reduce((sum, key) => sum + (Array.isArray(banks && banks[key]) ? banks[key].length : 0), 0);
}

/** The text of the pains the brand already has (its own and researched), for an angle to name. */
export function existingPainTexts({ root, brand }) {
  try {
    return ['proven', 'yours'].flatMap((bank) => readBank({ root, brand, bank, kind: 'pain', ranked: false }).map((item) => item.text));
  } catch {
    return [];
  }
}

/**
 * File checked banks in the brand library as proven items, through addToBank (the call brand_bank_save makes): the same pain twice is one
 * item that gains the new quotes and count, and an item the person removed stays removed.
 * @returns {{ saved: number, merged: number, existing: number, skipped: number, kinds: Record<string, number> }} kinds counts, per kind, the items that are new or gained something
 */
export function fileBanks({ root, brand, banks, jobId = null, now = new Date() }) {
  const counts = { saved: 0, merged: 0, existing: 0, skipped: 0 };
  const kinds = {};
  const put = (kind, params) => {
    try {
      const out = addToBank({ root, brand, bank: 'proven', kind, jobId, now, ...params });
      if (out.saved || out.merged) {
        counts[out.saved ? 'saved' : 'merged'] += 1;
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      } else counts.existing += 1;
      return out.item;
    } catch {
      counts.skipped += 1;
      return null;
    }
  };
  const list = (key) => (Array.isArray(banks && banks[key]) ? banks[key] : []);
  for (const [key, kind] of Object.entries(KIND_OF)) {
    for (const item of list(key)) {
      put(kind, {
        text: item.text, source: item.source, competitor: item.competitor ?? null,
        details: { who: item.who, awarenessStage: item.awarenessStage, count: item.count, quotes: item.quotes },
      });
    }
  }
  const pains = ['proven', 'yours'].flatMap((bank) => { try { return readBank({ root, brand, bank, kind: 'pain', ranked: false }); } catch { return []; } });
  for (const item of list('angles')) {
    const pain = pains.find((candidate) => sameInsight(candidate.text, item.pain)) ?? null;
    put('angle', {
      text: item.text, source: 'brand', evidence: { url: item.proofSource, date: item.proofDate },
      details: { pain: item.pain, painId: pain ? pain.id : undefined, proof: item.proof },
    });
  }
  for (const item of list('captions')) {
    const note = item.runningDays !== undefined ? `Running ${item.runningDays} ${item.runningDays === 1 ? 'day' : 'days'} in the ad library.` : null;
    put('caption', { text: item.text, source: item.source, competitor: item.competitor ?? null, evidence: item.evidence, note, details: { structure: item.structure } });
    // An ad's opening line is a hook of its own.
    if (item.source === 'ad' && item.structure && item.structure.hook) put('hook', { text: item.structure.hook, source: 'ad', competitor: item.competitor ?? null, evidence: item.evidence, note });
  }
  for (const item of list('ctas')) {
    const note = item.runningDays !== undefined ? `Running ${item.runningDays} ${item.runningDays === 1 ? 'day' : 'days'} in the ad library.` : null;
    put('cta', { text: item.text, source: item.source, competitor: item.competitor ?? null, evidence: item.evidence, note, details: { ctaType: item.ctaType } });
  }
  return { ...counts, kinds };
}
