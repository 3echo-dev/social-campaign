// The evidence rules for a brand onboarding research draft.
//
// Job research keeps a raw capture of every page it cites and labels every claim. Onboarding used to accept a source
// with only a title, an evidence row with an empty finding, and a competitor page that the agent said it "summarised via
// search, not fetched". These checks hold the onboarding draft to the same standard before anything is written:
//
//   - every source has a kind from a fixed list (the kind sets how long it stays fresh), is fresh for that kind, names the tool
//     that read it (a search is not a read), and has a capture file under the run's raw/ folder that holds the page text;
//   - every evidence row has a question, a finding and an excerpt, cites a listed source, and the excerpt is found in that
//     source's capture;
//   - every competitor has a rationale, a handle (or a gap saying none was found), evidence from listed competitor sources, and
//     is a business: a government, education or media address is not a competitor;
//   - when the host recorded the run's tool calls, a source cannot name a tool that was never called.
//
// Every function returns plain { field, problem } rows and changes nothing. The server turns them into needs_changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const research = require('./lib-brand-research.js');

// The tools that read a page. A search finds addresses and snippets; it never makes a source.
const FETCH_PROVIDERS = Object.freeze([
  'web_crawl', 'social_profile_get', 'social_outliers_find', 'social_post_get', 'social_search', 'social_comments_get', 'social_ad_search', 'WebFetch', 'chrome',
]);
const SEMANTICS = Object.freeze(['FACT', 'OBSERVATION', 'INFERENCE', 'HYPOTHESIS']);
const SOCIAL_KINDS = Object.freeze(['brand_social', 'competitor_social']);
const COMPETITOR_KINDS = Object.freeze(['competitor', 'competitor_social']);
const MIN_CAPTURE_CHARS = 200;
const MAX_CAPTURE_BYTES = 400000;
const MIN_QUOTE_CHARS = 12;
// Wording that says the page was not read: seen on a real run ("summarised via search, not fetched").
const NOT_FETCHED = /not\s+fetched|unfetched|never\s+fetched|summari[sz]ed\s+(?:via|from|by|in|through)\s+(?:a\s+|the\s+)?(?:web\s+)?search|(?:search|google)\s+(?:summary|snippet|result)s?\b|(?:from|via|per|in)\s+(?:the\s+)?search\s+(?:result|snippet|summary)s?|snippet\s+only|(?:could|can)\s*not\s+be\s+(?:fetched|opened|read|reached)/i;
// A government, education or military address is never a competitor selling to the same buyer.
const NOT_A_BUSINESS_HOST = /(?:^|\.)(?:gov|edu|mil)(?:\.[a-z]{2})?$|(?:^|\.)ac\.[a-z]{2}$/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function filled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** Letters and numbers only, lower case: two texts that differ in quotes, dashes, spacing or markdown still compare equal. */
function squash(text) {
  return String(text === undefined || text === null ? '' : text).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** An address as a comparison key: no scheme, no www, no fragment, no trailing slash. */
function normUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return (url.hostname.replace(/^www\./i, '') + url.pathname.replace(/\/+$/, '') + url.search).toLowerCase();
  } catch {
    return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  }
}

function hostOf(value) {
  try { return new URL(String(value).trim()).hostname.toLowerCase(); } catch { return ''; }
}

/** Whether a quote sits in the squashed capture. A quote with an ellipsis is checked piece by piece; a very short quote must be there whole. */
function quoteFound(captureSquashed, quote) {
  const whole = squash(quote);
  if (whole.length < 4) return false;
  const pieces = String(quote || '').split(/\.{3}|…/).map(squash).filter(piece => piece.length >= MIN_QUOTE_CHARS);
  if (pieces.length) return pieces.every(piece => captureSquashed.includes(piece));
  return captureSquashed.includes(whole);
}

function insideDir(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * Read one capture. `ref` is relative to the run folder (raw/2026-10-13/acme-about.md) or absolute inside its raw/ folder.
 * { ok, ref, hash, text, squashed } or { ok: false, problem }.
 */
function readCapture(rawDir, ref, url) {
  if (!filled(ref)) return { ok: false, problem: 'captureRef is empty. Save the page text under the raw/ folder and name the file here.' };
  if (!rawDir) return { ok: false, problem: 'There is no raw/ folder for this run.' };
  const runDir = path.dirname(rawDir);
  const abs = path.resolve(runDir, String(ref).trim());
  if (!insideDir(path.resolve(rawDir), abs)) return { ok: false, problem: `captureRef "${String(ref).slice(0, 80)}" must be a file inside this run's raw/ folder.` };
  let real;
  try {
    real = fs.realpathSync.native(abs);
    if (!insideDir(fs.realpathSync.native(rawDir), real)) return { ok: false, problem: `captureRef "${String(ref).slice(0, 80)}" must be a file inside this run's raw/ folder.` };
  } catch {
    return { ok: false, problem: `captureRef "${String(ref).slice(0, 80)}" does not exist. Write the fetched page text to that file before saving.` };
  }
  let bytes;
  try {
    if (!fs.statSync(real).isFile()) return { ok: false, problem: `captureRef "${String(ref).slice(0, 80)}" is not a file.` };
    bytes = fs.readFileSync(real);
  } catch {
    return { ok: false, problem: `captureRef "${String(ref).slice(0, 80)}" could not be read.` };
  }
  const text = bytes.subarray(0, MAX_CAPTURE_BYTES).toString('utf8');
  const squashed = squash(text);
  if (squashed.length < MIN_CAPTURE_CHARS) {
    return { ok: false, problem: `The capture "${String(ref).slice(0, 80)}" is nearly empty. Save the text the tool returned for this page, not a note about it.` };
  }
  const probe = normUrl(url);
  if (probe && !squashed.includes(squash(probe))) {
    return { ok: false, problem: `The capture "${String(ref).slice(0, 80)}" does not mention ${String(url).slice(0, 120)}. Start each capture with the page address it came from.` };
  }
  return {
    ok: true,
    ref: path.relative(runDir, real).split(path.sep).join('/'),
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    text,
    squashed,
  };
}

function ageDays(observedAt, now) {
  const stamp = Date.parse(observedAt);
  return Number.isFinite(stamp) ? Math.floor((now.getTime() - stamp) / 86400000) : null;
}

function calledOk(calls, provider) {
  const byTool = calls && calls.byTool || {};
  return Boolean(byTool[provider] && byTool[provider].ok > 0);
}

/**
 * The checks on research.sources. ctx: { rawDir, now, calls }.
 * @returns {{ problems: object[], bySource: Map<string, object> }} bySource maps a normalized address to
 *   { index, source, capture } for every source whose capture could be read.
 */
function sourceProblems(sources, ctx) {
  const problems = [];
  const bySource = new Map();
  const kinds = research.ONBOARDING_SOURCE_KINDS;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  sources.forEach((source, index) => {
    if (!isObject(source)) return;
    const field = `research.sources[${index}]`;
    const kind = typeof source.kind === 'string' ? source.kind.trim() : '';
    const days = research.DEFAULT_FRESHNESS_DAYS[kind];
    if (!kinds.includes(kind)) {
      problems.push({ field: `${field}.kind`, problem: `kind must be one of ${kinds.join(', ')}${kind ? ` (it is "${kind.slice(0, 40)}")` : ''}. The kind decides how long the source stays fresh.` });
    } else {
      const age = ageDays(source.observedAt, now);
      if (age !== null && age > days) {
        problems.push({ field: `${field}.observedAt`, problem: `A ${kind} source must have been read in the last ${days} days; this one is ${age} days old. Read the page again and date it today.` });
      }
    }
    if (!filled(source.title)) problems.push({ field: `${field}.title`, problem: 'title is empty. Name the page in a few words.' });
    const provider = typeof source.provider === 'string' ? source.provider.trim() : '';
    if (!FETCH_PROVIDERS.includes(provider)) {
      problems.push({ field: `${field}.provider`, problem: `provider must name the tool that read the page: ${FETCH_PROVIDERS.join(', ')}${provider ? ` (it is "${provider.slice(0, 40)}")` : ''}. A page seen only in search results has not been read, so it cannot be a source.` });
    } else if (ctx.calls && ctx.calls.recorded && !calledOk(ctx.calls, provider)) {
      problems.push({ field: `${field}.provider`, problem: `The run's tool log shows no successful ${provider} call, so this source was not read with it. Read the page, or name the tool that did.` });
    }
    const words = [source.limitation, source.title, source.supportingExcerpt].filter(filled).join(' ');
    if (NOT_FETCHED.test(words)) {
      problems.push({ field: `${field}.limitation`, problem: 'A source that was not fetched, or was only summarised from search results, cannot be a source. Read the page with a tool, or drop it and add a gap.' });
    }
    const capture = readCapture(ctx.rawDir, source.captureRef, source.url);
    if (!capture.ok) problems.push({ field: `${field}.captureRef`, problem: capture.problem });
    else bySource.set(normUrl(source.url), { index, source, capture });
  });
  return { problems, bySource };
}

/** The checks on research.evidenceMatrix. ctx: { bySource }. */
function evidenceProblems(rows, ctx) {
  const problems = [];
  rows.forEach((row, index) => {
    if (!isObject(row)) return;
    const field = `research.evidenceMatrix[${index}]`;
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!question || /^unresolved research question$/i.test(question)) {
      problems.push({ field: `${field}.question`, problem: 'question is empty. Say what this row answers.' });
    }
    if (!filled(row.finding)) problems.push({ field: `${field}.finding`, problem: 'finding is empty. State what the source shows, in one or two sentences.' });
    if (!filled(row.supportingExcerpt)) {
      problems.push({ field: `${field}.supportingExcerpt`, problem: 'supportingExcerpt is empty. Copy the passage from the page that shows the finding.' });
    }
    const semantics = typeof row.semantics === 'string' ? row.semantics.trim().toUpperCase() : '';
    if (!SEMANTICS.includes(semantics)) {
      problems.push({ field: `${field}.semantics`, problem: `semantics must be one of ${SEMANTICS.join(', ')}.` });
    }
    const hit = filled(row.source) ? ctx.bySource.get(normUrl(row.source)) : null;
    if (!filled(row.source)) {
      problems.push({ field: `${field}.source`, problem: 'source is empty. Give the address of one of the sources.' });
    } else if (!hit) {
      problems.push({ field: `${field}.source`, problem: 'source must be the address of one of research.sources, and that source needs a readable capture.' });
    } else if (filled(row.supportingExcerpt) && !quoteFound(hit.capture.squashed, row.supportingExcerpt)) {
      problems.push({ field: `${field}.supportingExcerpt`, problem: 'The excerpt is not in the saved capture of its source. Copy it exactly as it appears in the capture (use ... to skip words).' });
    }
  });
  return problems;
}

function gapText(gap) {
  if (typeof gap === 'string') return gap;
  return isObject(gap) ? [gap.question, gap.reason, gap.limitation, gap.claim, gap.finding].filter(filled).join(' ') : '';
}

function gapMentions(gaps, name) {
  const needle = String(name || '').trim().toLowerCase();
  return Boolean(needle) && (Array.isArray(gaps) ? gaps : []).some(gap => gapText(gap).toLowerCase().includes(needle));
}

/** The handles of one competitor detail as [{ platform, handle }]. */
function handlesOf(detail) {
  const handles = isObject(detail && detail.handles) ? detail.handles : {};
  return Object.entries(handles).filter(([, value]) => filled(value)).map(([platform, handle]) => ({ platform, handle: String(handle).trim() }));
}

/**
 * The checks on research.competitorDetails. ctx: { bySource, gaps, expected }.
 * `expected` is the competitor names the profile will hold (declared first, then found), at most 3.
 */
function competitorProblems(details, ctx) {
  const problems = [];
  const gaps = ctx.gaps || [];
  const named = new Set();
  details.forEach((detail, index) => {
    if (!isObject(detail)) return;
    const field = `research.competitorDetails[${index}]`;
    const name = typeof detail.name === 'string' ? detail.name.trim() : '';
    if (name) named.add(name.toLowerCase());
    if (!filled(detail.rationale)) {
      problems.push({ field: `${field}.rationale`, problem: `${name || 'This competitor'} needs a rationale: one line on what it sells to the same buyer as the brand.` });
    }
    const addresses = [detail.website, ...handlesOf(detail).map(item => item.handle), ...(Array.isArray(detail.evidence) ? detail.evidence.map(item => item && item.url) : [])];
    for (const address of addresses) {
      if (filled(address) && NOT_A_BUSINESS_HOST.test(hostOf(address))) {
        problems.push({ field: `${field}.name`, problem: `${name || 'This competitor'} points at a government or education address (${hostOf(address)}). A competitor is a business selling to the same buyer, never a programme, school body or publisher. Replace it.` });
        break;
      }
    }
    if (!handlesOf(detail).length && !gapMentions(gaps, name)) {
      problems.push({ field: `${field}.handles`, problem: `${name || 'This competitor'} has no handle. Add handles such as {"instagram": "@name"}, or add a gap that names ${name || 'the competitor'} and says no account was found.` });
    }
    const evidence = Array.isArray(detail.evidence) ? detail.evidence : [];
    if (!evidence.length && !gapMentions(gaps, name)) {
      problems.push({ field: `${field}.evidence`, problem: `${name || 'This competitor'} has no evidence. Add up to 3 sources you read, or a gap that names ${name || 'the competitor'} and says why nothing could be read.` });
    }
    evidence.forEach((item, at) => {
      const hit = isObject(item) && filled(item.url) ? ctx.bySource.get(normUrl(item.url)) : null;
      if (!hit) {
        problems.push({ field: `${field}.evidence[${at}]`, problem: 'Competitor evidence must be a source listed in research.sources, with a readable capture.' });
      } else if (!COMPETITOR_KINDS.includes(String(hit.source.kind || '').trim())) {
        problems.push({ field: `${field}.evidence[${at}]`, problem: `Competitor evidence must be a competitor or competitor_social source (this one is ${hit.source.kind || 'without a kind'}).` });
      }
    });
  });
  for (const name of ctx.expected || []) {
    if (!named.has(String(name).toLowerCase())) {
      problems.push({ field: 'research.competitorDetails', problem: `${name} is a competitor of this brand but has no entry in competitorDetails. Add its rationale, handles and evidence.` });
    }
  }
  return problems;
}

/**
 * The accounts a run was expected to read: the brand's own declared social channels and every competitor handle.
 * Returns the count, and a problem when the run recorded its calls and never tried a profile or outlier read.
 */
function socialReadProblems(calls, accounts) {
  if (!calls || !calls.recorded || !accounts) return [];
  const tried = ['social_profile_get', 'social_outliers_find'].reduce((sum, tool) => {
    const item = calls.byTool[tool];
    return sum + (item ? item.ok + item.failed : 0);
  }, 0);
  if (tried > 0) return [];
  return [{
    field: 'research.sources',
    problem: `${accounts} social account${accounts === 1 ? ' is' : 's are'} declared or known, but the run never called social_profile_get or social_outliers_find. Read each account once with both, or record why it could not be read in research.gaps.`,
  }];
}

/** Whether a source kind is a social page (a profile or post): the kinds that need a tool read, never a search. */
function isSocialKind(kind) {
  return SOCIAL_KINDS.includes(String(kind || '').trim());
}

module.exports = {
  FETCH_PROVIDERS,
  SEMANTICS,
  SOCIAL_KINDS,
  COMPETITOR_KINDS,
  MIN_QUOTE_CHARS,
  squash,
  normUrl,
  hostOf,
  quoteFound,
  readCapture,
  sourceProblems,
  evidenceProblems,
  competitorProblems,
  socialReadProblems,
  handlesOf,
  gapMentions,
  isSocialKind,
};
