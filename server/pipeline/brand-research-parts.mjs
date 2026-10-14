/**
 * Brand onboarding research in parts.
 *
 * Onboarding research is orchestrated, not one long dispatch: the Director spawns parallel workers, one for each part of the pass, and every
 * worker writes its own part file in the shape of the research draft, for its own keys only:
 *
 *   workspaces/<brand>/onboarding/<runId>/
 *     research-draft.json         the starting draft (the keys every part is merged into; the Director may fix a stray key in it)
 *     parts/plan.json             the parts of this run, written by pipeline_brand_research_start
 *     parts/<part>.json           one worker's part: { version, runId, part, status, [competitor], fills?, suggested?, research?, brandFiles?,
 *                                 topPosts?, banks?, budget }; status is pending (the starting file), working or done
 *     parts/<part>.contract.md    that worker's whole contract, cut from the research skill, which it reads itself
 *     raw/<YYYY-MM-DD>/<part>-<slug>.md   the text of every page a worker read (the save checks each source against one)
 *
 * The parts are website, own, competitors (or competitor-1 to competitor-3 when all three competitors are already named), pains and viral
 * (the Trend Scout finds the viral videos and a short follow-up takes the first 3 apart). pipeline_brand_research_save merges the part files
 * (collectParts) into one draft before it is checked, so every rule of the draft holds unchanged, and each problem it finds names the part it
 * came from, so the Director dispatches again only the parts that failed. The checklist the board shows moves by itself as parts finish
 * (syncPartsProgress, run from pipeline_status).
 *
 * The run's budget (30 searches, 56 fetches, 120 turns) is split between the parts below and adds up to the same total.
 *
 * A run is "in parts" only once a worker has touched a part file. A draft written whole in research-draft.json, with every part file still
 * at its starting `pending`, is saved exactly as before.
 *
 * Nothing in here throws on a folder it cannot read: unreadable files read as missing.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANK_KEYS } from './brand-onboarding-banks.mjs';
import { readProgress, writeProgress } from './brand-intelligence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = join(HERE, '..', '..', 'pipeline');
const require = createRequire(import.meta.url);
const durable = require(join(PIPELINE_ROOT, 'scripts', 'lib-durable.js'));
const evidence = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-evidence.js'));
const onboardingRun = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-run.js'));

const RESEARCH_SKILL = join(PIPELINE_ROOT, 'skills', 'research', 'SKILL.md');

/** The most sources one run saves, all parts together. */
export const MAX_RESEARCH_SOURCES = 20;
const MAX_COMPETITORS = 3;
const MAX_OWN_VIDEOS = 5;

/** What the whole run may call. The parts below add up to exactly this. */
export const RUN_TOTALS = Object.freeze({ searches: 30, fetches: 56, turns: 120, sources: MAX_RESEARCH_SOURCES });

/**
 * The share of the run's budget each part gets. The viral part holds two workers: the Trend Scout (scout) and the short follow-up that
 * takes the first 3 viral videos apart (teardown). `captions` and `ctas` are how many items of those two banks the part may keep, so the
 * parts together stay inside the banks' limits (10 each).
 */
const BUDGETS = Object.freeze({
  website: { searches: 2, fetches: 5, turns: 14, sources: 3, captions: 0, ctas: 0 },
  own: { searches: 3, fetches: 12, turns: 28, sources: 3, captions: 3, ctas: 2 },
  competitors: { searches: 9, fetches: 16, turns: 34, sources: 8, captions: 4, ctas: 3 },
  pains: { searches: 5, fetches: 10, turns: 18, sources: 6, captions: 3, ctas: 5 },
  viral: {
    searches: 11, fetches: 13, turns: 26, sources: 0, captions: 0, ctas: 0,
    scout: { searches: 11, fetches: 10, turns: 20 }, teardown: { searches: 0, fetches: 3, turns: 6 },
  },
});

/** When all three competitors are named, one worker takes each: the competitors budget split three ways. */
const SPLIT_BUDGETS = Object.freeze([
  { searches: 3, fetches: 6, turns: 12, sources: 3, captions: 2, ctas: 1 },
  { searches: 3, fetches: 5, turns: 11, sources: 3, captions: 1, ctas: 1 },
  { searches: 3, fetches: 5, turns: 11, sources: 2, captions: 1, ctas: 1 },
]);

const LABELS = Object.freeze({
  website: 'Website and brand facts',
  own: 'Your own accounts',
  competitors: 'Competitors',
  pains: 'Pain points, captions and calls to action',
  viral: 'What is viral now',
});

const DRAFT_KEYS = Object.freeze(['fills', 'suggested', 'research', 'brandFiles', 'topPosts', 'banks', 'budget']);
const META_KEYS = Object.freeze(['version', 'runId', 'part', 'status', 'competitor']);
const BRAND_FILE_LIMITS = Object.freeze({ segments: 3, phrases: 8, objections: 5, notFor: 4, proof: 8, competitors: 3, neverClaim: 6, pillars: 8, cadence: 3, notes: 3 });
const BRAND_FILE_LISTS = Object.freeze({
  audience: ['segments', 'phrases', 'objections', 'notFor'],
  positioning: ['proof', 'competitors', 'neverClaim'],
  platforms: ['pillars', 'cadence', 'notes'],
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const clip = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
};
const isFilled = (value) => (typeof value === 'string' ? value.trim() !== '' : Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null);

// ---------------------------------------------------------------- the paths
export const partsDir = (brandDir, runId) => join(onboardingRun.runDir(brandDir, runId), 'parts');
export const partFile = (brandDir, runId, id) => join(partsDir(brandDir, runId), `${id}.json`);
export const contractFile = (brandDir, runId, id) => join(partsDir(brandDir, runId), `${id}.contract.md`);
const planFile = (brandDir, runId) => join(partsDir(brandDir, runId), 'plan.json');
const mergedFile = (brandDir, runId) => join(onboardingRun.runDir(brandDir, runId), 'research-draft.merged.json');

/** The group a part belongs to: competitor-2 is a competitors part. */
export const groupOf = (id) => (/^competitor-\d$/.test(id) ? 'competitors' : id);

// ---------------------------------------------------------------- the plan
function entryOf(id, extra = {}) {
  const group = groupOf(id);
  const split = /^competitor-(\d)$/.exec(id);
  const budget = split ? SPLIT_BUDGETS[Number(split[1]) - 1] : BUDGETS[group];
  const named = extra.competitor ? `${LABELS.competitors}: ${extra.competitor}` : LABELS[group];
  return { id, group, label: named, required: false, ...extra, budget: structuredClone(budget) };
}

/**
 * The parts of a run, from the saved profile: the website part when a website is given, the own part when an own social account is given, the
 * competitors part (or one part for each of three named competitors), the pains part and the viral part. website and own are required only when
 * their channel is given; the competitors part is always required; pains and viral are optional (a brand with no comments or nothing viral
 * simply has none).
 * @returns {{ version: number, split: boolean, ownAccounts: string[], parts: object[] }}
 */
export function buildPartsPlan({ profile, declared = [], toFind = 0 } = {}) {
  const given = (name) => Boolean(profile && profile.channels && profile.channels[name] && profile.channels[name].status === 'provided');
  const ownAccounts = ['instagram', 'tiktok', 'facebook'].filter(given);
  const names = (Array.isArray(declared) ? declared : []).filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim());
  const split = toFind === 0 && names.length >= MAX_COMPETITORS;
  const parts = [];
  if (given('website')) parts.push(entryOf('website', { required: true }));
  if (ownAccounts.length) parts.push(entryOf('own', { required: true, accounts: ownAccounts }));
  if (split) names.slice(0, MAX_COMPETITORS).forEach((name, index) => parts.push(entryOf(`competitor-${index + 1}`, { required: true, competitor: name })));
  else parts.push(entryOf('competitors', { required: true }));
  parts.push(entryOf('pains'));
  parts.push(entryOf('viral'));
  return { version: 1, split, ownAccounts, parts };
}

export function readPlan(brandDir, runId) {
  try {
    const plan = JSON.parse(readFileSync(planFile(brandDir, runId), 'utf8'));
    return isObject(plan) && Array.isArray(plan.parts) && plan.parts.every((part) => isObject(part) && typeof part.id === 'string') ? plan : null;
  } catch {
    return null;
  }
}

/** The budgets add up to the run's totals; used by the tests and the contract. */
export function budgetTotals(plan) {
  const sum = (key) => (plan ? plan.parts : []).reduce((total, part) => total + (part.budget[key] || 0), 0);
  return { searches: sum('searches'), fetches: sum('fetches'), turns: sum('turns'), sources: sum('sources') };
}

// ---------------------------------------------------------------- the starting files
function skeletonFor(entry, { runId, fills, owner }) {
  const doc = { version: 1, runId, part: entry.id, status: 'pending' };
  if (entry.competitor) doc.competitor = entry.competitor;
  if (owner && isObject(fills)) {
    const mine = Object.fromEntries(Object.entries(fills).filter(([key]) => (entry.group === 'competitors' ? true : key !== 'competitors')));
    doc.fills = structuredClone(mine);
    doc.suggested = [];
  } else if (entry.group === 'competitors' && isObject(fills) && own(fills, 'competitors')) {
    doc.fills = { competitors: [] };
  }
  const banks = (keys) => Object.fromEntries(keys.map((key) => [key, []]));
  if (entry.group === 'website') {
    doc.research = { sources: [], evidenceMatrix: [], findings: {}, gaps: [] };
    doc.brandFiles = {};
  } else if (entry.group === 'own') {
    doc.research = { sources: [], evidenceMatrix: [], gaps: [] };
    doc.brandFiles = {};
    doc.topPosts = [];
    doc.banks = banks(['captions', 'ctas']);
  } else if (entry.group === 'competitors') {
    doc.research = { sources: [], evidenceMatrix: [], competitorDetails: [], gaps: [] };
    doc.brandFiles = {};
    doc.topPosts = [];
    doc.banks = banks(['captions', 'ctas']);
  } else if (entry.group === 'pains') {
    doc.research = { sources: [], evidenceMatrix: [], gaps: [] };
    doc.brandFiles = {};
    doc.banks = banks(BANK_KEYS);
  } else if (entry.group === 'viral') {
    doc.research = { gaps: [] };
    doc.topPosts = [];
  }
  doc.budget = { searches: 0, fetches: 0, stopReason: '' };
  return doc;
}

/** The part that carries the blank profile fills: the website part, else the own part, else the first competitors part. */
function fillsOwner(plan) {
  for (const group of ['website', 'own', 'competitors']) {
    const found = plan.parts.find((part) => part.group === group);
    if (found) return found.id;
  }
  return null;
}

// ---------------------------------------------------------------- the contract of a part
let skillCache = null;

/** The brand onboarding section of the research skill as { intro, sections: Map(heading -> text) }. Empty when the file cannot be read. */
function onboardingSkill() {
  if (skillCache) return skillCache;
  const empty = { intro: '', sections: new Map() };
  try {
    const text = readFileSync(RESEARCH_SKILL, 'utf8').replace(/\r\n/g, '\n');
    const start = text.indexOf('## Brand onboarding workstream');
    if (start < 0) return empty;
    const next = text.indexOf('\n## ', start + 1);
    const body = text.slice(start, next < 0 ? undefined : next).trim();
    const chunks = body.split(/\n(?=### )/);
    const sections = new Map();
    for (const chunk of chunks.slice(1)) {
      const heading = /^### (.+)$/m.exec(chunk);
      if (heading) sections.set(heading[1].trim(), chunk.trim());
    }
    skillCache = { intro: chunks[0].replace(/^## [^\n]*\n+/, '').trim(), sections };
    return skillCache;
  } catch {
    return empty;
  }
}

/** The sections of the research skill each kind of part reads, besides "Working in parts". */
const CONTRACT_SECTIONS = Object.freeze({
  website: ['Tools', 'Evidence', 'What each fill holds', 'Also fill when blank', 'Strategic findings', 'Files for the brand', 'Audience fallback', 'No evidence in a fill'],
  own: ['Tools', 'Evidence', 'Top posts', 'Taking the best videos apart', 'Labels', 'Hooks, captions and CTAs', 'Files for the brand', 'No evidence in a fill'],
  competitors: ['Tools', 'Competitors', 'Evidence', 'Top posts', 'Taking the best videos apart', 'Labels', 'Hooks, captions and CTAs', 'Files for the brand', 'No evidence in a fill'],
  pains: ['Tools', 'Evidence', 'Pain points', 'Hooks, captions and CTAs', 'The banks in the draft', 'Files for the brand', 'No evidence in a fill'],
  viral: ['Tools', 'Evidence', 'Top posts', 'Taking the best videos apart', 'Labels', 'Viral now'],
});

/** The block of "Working in parts" that is about one kind of part: the text under `#### Part <group>`. */
function partBlock(working, group) {
  const match = new RegExp(`(?:^|\\n)#### Part ${group}\\n([\\s\\S]*?)(?=\\n#### |(?![\\s\\S]))`).exec(working);
  return match ? match[1].trim() : '';
}

/**
 * The whole contract of one part as text: who it is, its files and budget, then the rules of the research skill that apply to it.
 * The worker reads this file and nothing else, so it holds no wording the Director has to repeat.
 */
export function partContract(entry, ctx) {
  const skill = onboardingSkill();
  const working = skill.sections.get('Working in parts') || '';
  const general = working.replace(/^### Working in parts\n+/, '').split(/\n(?=#### )/)[0].trim();
  const others = ctx.parts.filter((part) => part.id !== entry.id).map((part) => `\`${part.id}\``).join(', ');
  // The viral part's own worker is the short follow-up that takes the videos apart; the Trend Scout beside it has its own share.
  const budget = entry.group === 'viral' ? { ...entry.budget.teardown, sources: 0 } : entry.budget;
  const lines = [
    `# Brand onboarding research: the \`${entry.id}\` part (${entry.label})`,
    '',
    `You are one of several researchers working at the same time on one brand onboarding run, \`${ctx.runId}\`.`,
    'The server merges the part files of every worker into one draft when all of them are done, so write your own part and nothing else.',
    'Read this whole file first: it is your contract, and the Director adds nothing to it.',
    '',
    '## Your part',
    '',
    `- Your part file, the only file you write besides your captures: \`${ctx.partPath}\`. It already holds the keys of your part; fill them and write the whole file with Write (you have no Edit tool).`,
    `- Your captures go under \`${ctx.rawDir}\`, one file for each page you read, at \`<rawDir>/<YYYY-MM-DD>/${entry.id}-<slug>.md\`.`,
    `- Your budget: ${budget.searches} searches, ${budget.fetches} fetches and ${budget.turns} turns, and at most ${budget.sources} sources in \`research.sources\`. A video teardown counts as a fetch. The run's ${RUN_TOTALS.searches} searches, ${RUN_TOTALS.fetches} fetches and ${RUN_TOTALS.turns} turns are split between the parts, so staying inside yours keeps the whole run inside the total.`,
    ...(entry.competitor ? [`- Your competitor: ${entry.competitor}. You cover this competitor only; the other competitors have workers of their own.`] : []),
    `- The other parts of this run are ${others || 'none'}; their files are in \`${ctx.partsDir}\` and fill while you work. Read one only when this contract says so.`,
    ...(ctx.extra || []),
    '',
  ];
  if (general) lines.push('## How the parts work', '', general, '');
  const block = partBlock(working, entry.group);
  if (block) lines.push(`## What the ${entry.group} part does`, '', block, '');
  if (skill.intro && entry.group !== 'viral') lines.push('## The draft and its rules', '', 'Wherever the text below says "the draft" or `draftPath`, it means your part file.', '', skill.intro, '');
  for (const name of CONTRACT_SECTIONS[entry.group] || []) {
    const text = skill.sections.get(name);
    if (text) lines.push(text, '');
  }
  if (!skill.sections.size) lines.push('The research skill could not be read. Follow your part file and your spawn prompt, and say so in your report.', '');
  return `${lines.join('\n').trim()}\n`;
}

/**
 * Write the files of a run's parts: plan.json (once), each part's starting file (only when it is not there yet) and each part's contract.
 * @returns {object} the plan
 */
export function writePartFiles({ brandDir, runId, profile, declared, toFind, fills, rawDir, viralPath, trendsPath }) {
  mkdirSync(partsDir(brandDir, runId), { recursive: true });
  let plan = readPlan(brandDir, runId);
  if (!plan) {
    plan = buildPartsPlan({ profile, declared, toFind });
    durable.atomicWrite(planFile(brandDir, runId), `${JSON.stringify({ ...plan, runId }, null, 2)}\n`);
  }
  const owner = fillsOwner(plan);
  for (const entry of plan.parts) {
    const file = partFile(brandDir, runId, entry.id);
    if (!existsSync(file)) {
      durable.atomicWrite(file, `${JSON.stringify(skeletonFor(entry, { runId, fills, owner: entry.id === owner }), null, 2)}\n`);
    }
    const extra = [];
    if (entry.group === 'viral') {
      extra.push(`- The Trend Scout writes the list of viral videos to \`${viralPath}\` (and its trends file to \`${trendsPath}\`). You are the short follow-up: read that list and take the first 3 videos apart.`);
    }
    durable.atomicWrite(contractFile(brandDir, runId, entry.id), partContract(entry, { runId, partPath: file, rawDir, partsDir: partsDir(brandDir, runId), parts: plan.parts, extra }));
  }
  return plan;
}

/** The parts of a run as the start result lists them for the Director. */
export function publicParts({ brandDir, runId, plan, viralPath, trendsPath }) {
  return plan.parts.map((entry) => ({
    id: entry.id,
    label: entry.label,
    required: entry.required,
    ...(entry.competitor ? { competitor: entry.competitor } : {}),
    ...(entry.accounts ? { accounts: entry.accounts } : {}),
    partPath: partFile(brandDir, runId, entry.id),
    contractPath: contractFile(brandDir, runId, entry.id),
    budget: { searches: entry.budget.searches, fetches: entry.budget.fetches, turns: entry.budget.turns },
    sources: entry.budget.sources,
    ...(entry.group === 'viral' ? { scout: entry.budget.scout, teardown: entry.budget.teardown, viralPath, trendsPath } : {}),
  }));
}

// ---------------------------------------------------------------- reading the part files
function readPartFile(file) {
  if (!existsSync(file)) return { state: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return { state: 'invalid', reason: 'is not valid JSON' };
  }
  if (!isObject(parsed)) return { state: 'invalid', reason: 'must be a JSON object' };
  const status = parsed.status === 'done' ? 'done' : parsed.status === 'pending' ? 'pending' : 'working';
  return { state: 'ok', doc: parsed, status };
}

function statusWords(read) {
  if (read.state === 'missing') return 'missing';
  if (read.state === 'invalid') return 'invalid';
  return read.status;
}

// ---------------------------------------------------------------- merging
function normUrl(value) {
  return typeof value === 'string' && value.trim() ? evidence.normUrl(value) : null;
}

/**
 * Merge the docs of the parts (in priority order: website, own, competitors, pains, viral, then the starting draft) into one draft.
 * Lists are put one after the other and the same source address, post link or competitor appears once (the first part's wins); a text
 * fill or finding is the first one filled; a suggestion counts only for the part whose fill was kept. Nothing is checked here except the
 * shape a merge needs (a list is a list); every other rule is the draft's own, applied to the merged result.
 * @returns {{ draft: object, origin: object, problems: object[] }} origin says which part each list item and each filled key came from
 */
export function mergeDocs(entries, runId) {
  const problems = [];
  const origin = {
    fills: {}, suggested: {}, findings: {}, scope: null, unknownResearch: {},
    research: { sources: [], evidenceMatrix: [], competitorDetails: [], gaps: [], competitors: [] },
    topPosts: [], banks: Object.fromEntries(BANK_KEYS.map((key) => [key, []])),
    brandFiles: { audience: {}, positioning: {}, platforms: {} },
  };
  const out = {
    version: 1, runId, fills: {}, suggested: [],
    research: { sources: [], evidenceMatrix: [], competitorDetails: [], findings: {}, gaps: [] },
    brandFiles: {}, topPosts: [], banks: Object.fromEntries(BANK_KEYS.map((key) => [key, []])),
    budget: { searches: 0, fetches: 0, stopReason: '' },
  };
  const chosen = {};
  const claims = {};
  const seen = { sources: new Set(), posts: new Set(), details: new Set(), gaps: new Set(), competitors: new Set(), banks: new Set() };
  const stops = [];

  for (const { id, doc, caps } of entries) {
    const bad = (field, problem) => problems.push({ field: `parts.${id}`, problem: `The ${id} part: ${field} ${problem}`, part: id });
    const listOf = (value, field) => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) { bad(field, 'must be a list.'); return []; }
      return value;
    };
    const objectOf = (value, field) => {
      if (value === undefined || value === null) return null;
      if (!isObject(value)) { bad(field, 'must be an object.'); return null; }
      return value;
    };
    for (const key of Object.keys(doc)) {
      if (!DRAFT_KEYS.includes(key) && !META_KEYS.includes(key)) {
        problems.push({ field: `parts.${id}`, problem: `The ${id} part: "${key}" is not a field of a part file. Use ${[...META_KEYS, ...DRAFT_KEYS].join(', ')}.`, part: id });
      }
    }

    // fills: the first one filled wins; competitors from every part are put together
    const fills = objectOf(doc.fills, 'fills');
    for (const key of Object.keys(fills || {})) {
      const value = fills[key];
      if (key === 'competitors' && Array.isArray(value)) {
        if (!Array.isArray(out.fills.competitors)) out.fills.competitors = [];
        for (const name of value) {
          const marker = typeof name === 'string' ? name.trim().toLowerCase() : null;
          if (marker && seen.competitors.has(marker)) continue;
          if (marker) seen.competitors.add(marker);
          out.fills.competitors.push(name);
          (origin.fills.competitors ||= []).push(id);
        }
        continue;
      }
      if (!own(out.fills, key) || (!isFilled(out.fills[key]) && isFilled(value))) {
        out.fills[key] = value;
        if (isFilled(value)) { chosen[key] = id; origin.fills[key] = [id]; }
        else origin.fills[key] = origin.fills[key] || [id];
      }
    }
    for (const name of listOf(doc.suggested, 'suggested')) {
      if (typeof name === 'string') (claims[name] ||= []).push(id);
    }

    // research
    const research = objectOf(doc.research, 'research');
    if (research) {
      for (const key of Object.keys(research)) {
        if (['sources', 'evidenceMatrix', 'competitorDetails', 'gaps', 'competitors', 'findings', 'scope'].includes(key)) continue;
        if (!own(out.research, key)) { out.research[key] = research[key]; origin.unknownResearch[key] = id; }
      }
      for (const source of listOf(research.sources, 'research.sources')) {
        const key = isObject(source) ? normUrl(source.url) : null;
        if (key && seen.sources.has(key)) continue;
        if (key) seen.sources.add(key);
        out.research.sources.push(source);
        origin.research.sources.push(id);
      }
      for (const row of listOf(research.evidenceMatrix, 'research.evidenceMatrix')) {
        out.research.evidenceMatrix.push(row);
        origin.research.evidenceMatrix.push(id);
      }
      for (const detail of listOf(research.competitorDetails, 'research.competitorDetails')) {
        const key = isObject(detail) && typeof detail.name === 'string' ? detail.name.trim().toLowerCase() : null;
        if (key && seen.details.has(key)) continue;
        if (key) seen.details.add(key);
        out.research.competitorDetails.push(detail);
        origin.research.competitorDetails.push(id);
      }
      for (const gap of listOf(research.gaps, 'research.gaps')) {
        const key = typeof gap === 'string' ? gap.trim().toLowerCase() : JSON.stringify(gap);
        if (seen.gaps.has(key)) continue;
        seen.gaps.add(key);
        out.research.gaps.push(gap);
        origin.research.gaps.push(id);
      }
      if (own(research, 'competitors')) {
        if (!Array.isArray(out.research.competitors)) out.research.competitors = [];
        for (const name of listOf(research.competitors, 'research.competitors')) {
          const marker = typeof name === 'string' ? name.trim().toLowerCase() : (isObject(name) && typeof name.name === 'string' ? name.name.trim().toLowerCase() : null);
          if (marker && out.research.competitors.some((item) => (typeof item === 'string' ? item : item && item.name || '').trim().toLowerCase() === marker)) continue;
          out.research.competitors.push(name);
          origin.research.competitors.push(id);
        }
      }
      const findings = objectOf(research.findings, 'research.findings');
      for (const key of Object.keys(findings || {})) {
        if (!isFilled(out.research.findings[key]) && (isFilled(findings[key]) || isObject(findings[key]))) {
          out.research.findings[key] = findings[key];
          origin.findings[key] = id;
        }
      }
      if (isObject(research.scope) && !isObject(out.research.scope)) { out.research.scope = research.scope; origin.scope = id; }
    }

    // brand files: lists are put together and cut to the limit at the end, a text is the first one filled
    const files = objectOf(doc.brandFiles, 'brandFiles');
    for (const key of Object.keys(files || {})) {
      const block = files[key];
      if (!own(BRAND_FILE_LISTS, key)) {
        if (!own(out.brandFiles, key)) { out.brandFiles[key] = block; (origin.unknownBrandFiles ||= {})[key] = id; }
        continue;
      }
      if (!isObject(block)) {
        if (!own(out.brandFiles, key)) { out.brandFiles[key] = block; origin.brandFiles[key]._whole = id; }
        continue;
      }
      if (!isObject(out.brandFiles[key])) out.brandFiles[key] = {};
      const target = out.brandFiles[key];
      const marks = origin.brandFiles[key];
      for (const field of Object.keys(block)) {
        const value = block[field];
        if (BRAND_FILE_LISTS[key].includes(field) && Array.isArray(value)) {
          if (!Array.isArray(target[field])) { target[field] = []; marks[field] = []; }
          for (const item of value) { target[field].push(item); marks[field].push(id); }
        } else if (field === 'switching' && isObject(value)) {
          if (!isObject(target.switching)) target.switching = {};
          for (const sub of Object.keys(value)) {
            if (!isFilled(target.switching[sub]) && isFilled(value[sub])) { target.switching[sub] = value[sub]; marks.switching = id; }
          }
        } else if (!own(target, field) || (!isFilled(target[field]) && isFilled(value))) {
          target[field] = value;
          marks[field] = id;
        }
      }
    }

    // top posts: one post once, by its link
    for (const post of listOf(doc.topPosts, 'topPosts')) {
      const key = isObject(post) ? normUrl(post.url) : null;
      if (key && seen.posts.has(key)) continue;
      if (key) seen.posts.add(key);
      out.topPosts.push(post);
      origin.topPosts.push(id);
    }

    // banks
    const banks = objectOf(doc.banks, 'banks');
    for (const key of Object.keys(banks || {})) {
      if (!BANK_KEYS.includes(key)) { if (!own(out.banks, key)) { out.banks[key] = banks[key]; (origin.unknownBanks ||= {})[key] = id; } continue; }
      let items = listOf(banks[key], `banks.${key}`);
      const cap = caps && Number.isFinite(caps[key]) ? caps[key] : null;
      if (cap !== null) items = items.slice(0, cap);
      for (const item of items) {
        const text = isObject(item) && typeof item.text === 'string' ? item.text.trim().toLowerCase() : null;
        const marker = text ? `${key}|${isObject(item) && typeof item.url === 'string' ? item.url : ''}|${text}` : null;
        if (marker && seen.banks.has(marker)) continue;
        if (marker) seen.banks.add(marker);
        out.banks[key].push(item);
        origin.banks[key].push(id);
      }
    }

    // budget
    const budget = objectOf(doc.budget, 'budget');
    if (budget) {
      for (const key of ['searches', 'fetches']) if (Number.isFinite(budget[key])) out.budget[key] += budget[key];
      if (typeof budget.stopReason === 'string' && budget.stopReason.trim()) stops.push(`${id}: ${budget.stopReason.trim()}`);
    }
  }

  // A suggestion counts for the part whose fill was kept; a name claimed with no fill at all is kept too, so the draft's own check names it.
  for (const [name, claimers] of Object.entries(claims)) {
    if (chosen[name] !== undefined && !claimers.includes(chosen[name])) continue;
    out.suggested.push(name);
    origin.suggested[name] = chosen[name] !== undefined ? chosen[name] : claimers[0];
  }
  for (const [key, limit] of Object.entries(BRAND_FILE_LIMITS)) {
    for (const file of Object.keys(BRAND_FILE_LISTS)) {
      const block = out.brandFiles[file];
      if (isObject(block) && Array.isArray(block[key]) && block[key].length > limit) {
        block[key] = block[key].slice(0, limit);
        origin.brandFiles[file][key] = origin.brandFiles[file][key].slice(0, limit);
      }
    }
  }
  out.budget.stopReason = clip(stops.join('; '), 200);
  return { draft: out, origin, problems };
}

// ---------------------------------------------------------------- which part a problem belongs to
const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * The part (or parts) a problem of the merged draft came from, from its field and from what the merge remembered. Returns a list of part ids:
 * one id when the problem is certain, several when it could be any of them, none when it belongs to the whole draft.
 */
export function partsOfProblem(problem, origin, plan) {
  const field = String(problem && problem.field || '');
  const text = String(problem && problem.problem || '');
  const at = (list, index) => (Array.isArray(list) && list[index] ? [list[index]] : []);
  const competitorParts = plan.parts.filter((part) => part.group === 'competitors').map((part) => part.id);
  const withPosts = unique(origin.topPosts);
  let m;
  if (problem.part) return [problem.part];
  if ((m = /^research\.(sources|evidenceMatrix|competitorDetails|gaps)\[(\d+)\]/.exec(field))) return at(origin.research[m[1]], Number(m[2]));
  if ((m = /^topPosts\[(\d+)\]/.exec(field))) return at(origin.topPosts, Number(m[1]));
  if ((m = /^banks\.(\w+)\[(\d+)\]/.exec(field))) return at(origin.banks[m[1]], Number(m[2]));
  if ((m = /^banks\.(\w+)$/.exec(field))) return unique(origin.banks[m[1]] || []);
  if ((m = /^brandFiles\.(audience|positioning|platforms)\.(\w+)\[(\d+)\]/.exec(field))) return at(origin.brandFiles[m[1]][m[2]], Number(m[3]));
  if ((m = /^brandFiles\.(audience|positioning|platforms)\.(\w+)/.exec(field))) {
    const marks = origin.brandFiles[m[1]][m[2]];
    return unique(Array.isArray(marks) ? marks : [marks]);
  }
  if ((m = /^brandFiles\.(audience|positioning|platforms)$/.exec(field))) return unique(Object.values(origin.brandFiles[m[1]]).flat());
  if ((m = /^fills\.(\w+)/.exec(field))) return unique(origin.fills[m[1]] || []);
  if (field === 'suggested') {
    const name = /The (\w+) is marked as a suggestion/.exec(text);
    return name && origin.suggested[name[1]] ? [origin.suggested[name[1]]] : unique(Object.values(origin.suggested));
  }
  if ((m = /^research\.findings\.(\w+)/.exec(field))) return origin.findings[m[1]] ? [origin.findings[m[1]]] : [];
  if ((m = /^research\.(?!sources|evidenceMatrix|competitorDetails|gaps|findings|scope|competitors)(\w+)/.exec(field))) return origin.unknownResearch[m[1]] ? [origin.unknownResearch[m[1]]] : [];
  if (field === 'research.competitorDetails' || field === 'research.competitors') {
    const named = /^(.+?) is a competitor of this brand/.exec(text);
    const own1 = named ? plan.parts.find((part) => part.competitor && part.competitor.toLowerCase() === named[1].trim().toLowerCase()) : null;
    return own1 ? [own1.id] : competitorParts;
  }
  if (field === 'research.sources') {
    if (/at most \d+ sources/.test(text)) {
      const counts = {};
      for (const id of origin.research.sources) counts[id] = (counts[id] || 0) + 1;
      const over = plan.parts.filter((part) => (counts[part.id] || 0) > part.budget.sources).map((part) => part.id);
      return over.length ? over : unique(origin.research.sources);
    }
    if (/social account/.test(text)) return plan.parts.filter((part) => ['own', 'competitors'].includes(part.group)).map((part) => part.id);
    return unique(origin.research.sources);
  }
  if (field === 'research.evidenceMatrix') return unique(origin.research.evidenceMatrix);
  if (field === 'topPosts') {
    if (/own account|brand's own/.test(text)) return plan.parts.filter((part) => part.group === 'own').map((part) => part.id);
    if (/per competitor|competitor videos/.test(text)) return competitorParts;
    if (/viral/.test(text)) return plan.parts.filter((part) => part.group === 'viral').map((part) => part.id);
    return withPosts;
  }
  return [];
}

/**
 * Put the part on every problem of the merged draft: `part` when it is certain, `candidates` when it could be several, neither when it belongs
 * to the draft as a whole. The audience problem goes to the website part (else the first part that carries the fills).
 */
export function tagProblems(problems, origin, plan) {
  const first = plan.parts.find((part) => part.group === 'website') || plan.parts.find((part) => part.group === 'own') || plan.parts.find((part) => part.group === 'competitors');
  return problems.map((item) => {
    const found = item.field === 'fills.audience' && !(origin.fills.audience || []).length && first ? [first.id] : partsOfProblem(item, origin, plan);
    if (found.length === 1) return { ...item, part: found[0] };
    if (found.length > 1) return { ...item, candidates: found };
    return { ...item };
  });
}

/** The parts to dispatch again: those that own a problem; when no problem is certain, the candidates of the uncertain ones. */
export function redoOf(problems, plan) {
  const order = plan.parts.map((part) => part.id);
  const sure = unique(problems.map((item) => item.part));
  const pool = sure.length ? sure : unique(problems.flatMap((item) => item.candidates || []));
  return order.filter((id) => pool.includes(id));
}

// ---------------------------------------------------------------- collecting
const GAP_NO_OWN = 'No posts of your own yet, so your plan starts from your competitors and your niche.';
const GAP_NO_PAINS = 'The pain points, comments and reviews could not be read this time.';
const GAP_NO_VIRAL = 'What is viral in your niche could not be found this time.';

function blockingProblem(entry, read) {
  const label = `The ${entry.id} part (${entry.label})`;
  if (read.state === 'invalid') return `${label} ${read.reason}. Dispatch its worker again with the same prompt, or fix the file, then save again.`;
  if (read.state === 'ok') {
    if (typeof read.doc.runId === 'string' && read.doc.runId !== entry.runId) {
      return `${label} belongs to another run (${clip(read.doc.runId, 40)}). Dispatch its worker again with this run's prompt.`;
    }
    if (typeof read.doc.part === 'string' && read.doc.part !== entry.id) return `${label} names another part (${clip(read.doc.part, 30)}). Its "part" must be ${entry.id}.`;
    if (read.status === 'working') {
      return `${label} is not finished: its status is not done, so its worker stopped early or has not reported. Dispatch it again with the same prompt (it carries on from its file), or, when its report says it finished, set its status to done and save again.`;
    }
    if (read.status === 'done') return null;
  }
  // Still the starting file (or no file): a part nobody wrote. Only a required part holds the save back.
  return entry.required
    ? `${label} has not been written yet. Dispatch its worker, wait for it to finish (its last write sets the status to done), then save again.`
    : null;
}

/**
 * Read the part files of a run and merge them into one draft for pipeline_brand_research_save.
 * @returns {{ active: false } | { active: true, plan, draft, origin, problems, blocked, summary, mergedPath }}
 *   `active` is false for a run with no plan or whose part files are all still at their starting `pending` (the draft written whole is saved as before).
 *   `problems` are the part-level problems (a part missing, not finished or not readable) and the shape problems of the merge; `blocked`
 *   says that some part is missing or unfinished, so the draft is not checked further until it is.
 */
export function collectParts({ brandDir, runId, basePath }) {
  const plan = readPlan(brandDir, runId);
  if (!plan) return { active: false };
  const reads = plan.parts.map((entry) => ({ entry: { ...entry, runId }, read: readPartFile(partFile(brandDir, runId, entry.id)) }));
  const touched = reads.some(({ read }) => read.state === 'invalid' || (read.state === 'ok' && read.status !== 'pending'));
  if (!touched) return { active: false, plan };

  const problems = [];
  let blocked = false;
  const gaps = [];
  const entries = [];
  for (const { entry, read } of reads) {
    const message = blockingProblem(entry, read);
    if (message) {
      blocked = true;
      problems.push({ field: `parts.${entry.id}`, problem: message, part: entry.id });
      continue;
    }
    if (read.state !== 'ok' || read.status === 'pending') continue;
    entries.push({ id: entry.id, doc: read.doc, caps: { captions: entry.budget.captions, ctas: entry.budget.ctas } });
  }
  // The starting draft is the lowest priority part: whatever the Director corrected in it is merged last.
  const base = readPartFile(basePath);
  if (base.state === 'ok') entries.push({ id: 'draft', doc: base.doc, caps: null });
  if (!plan.ownAccounts || !plan.ownAccounts.length) gaps.push(GAP_NO_OWN);
  for (const [id, text] of [['pains', GAP_NO_PAINS], ['viral', GAP_NO_VIRAL]]) {
    const entry = plan.parts.find((part) => part.id === id);
    const read = reads.find((item) => item.entry.id === id);
    if (entry && read && (read.read.state === 'missing' || (read.read.state === 'ok' && read.read.status === 'pending'))) gaps.push(text);
  }
  const merged = mergeDocs(entries, runId);
  problems.push(...merged.problems);
  if (gaps.length) {
    merged.draft.research.gaps.push(...gaps);
    merged.origin.research.gaps.push(...gaps.map(() => 'server'));
  }
  const summary = plan.parts.map((entry) => {
    const read = reads.find((item) => item.entry.id === entry.id).read;
    return { id: entry.id, label: entry.label, required: entry.required, status: statusWords(read), partPath: partFile(brandDir, runId, entry.id) };
  });
  const mergedPath = mergedFile(brandDir, runId);
  try {
    durable.atomicWrite(mergedPath, `${JSON.stringify(merged.draft, null, 2)}\n`);
  } catch { /* the merged draft is a copy to look at; the save does not depend on it */ }
  return { active: true, plan, draft: merged.draft, origin: merged.origin, problems, blocked, summary, mergedPath };
}

// ---------------------------------------------------------------- the checklist
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const countOf = (value) => (Array.isArray(value) ? value.length : 0);

function sourcesOf(doc, kinds) {
  const list = doc && isObject(doc.research) && Array.isArray(doc.research.sources) ? doc.research.sources : [];
  return list.filter((item) => isObject(item) && (!kinds || kinds.includes(item.kind)));
}

const postsOf = (doc, source) => (doc && Array.isArray(doc.topPosts) ? doc.topPosts.filter((post) => isObject(post) && post.source === source) : []);
const takenApart = (posts) => posts.filter((post) => isObject(post.breakdown)).length;

/**
 * What the part files say about the checklist steps, as Map(stepId -> { state, detail? }). A part that is not done yet shows its steps
 * running; when it is done they are done with the numbers it found. Steps that no part owns (`viral` before its follow-up starts,
 * subtopics, plan, files) are left to the Director.
 */
export function deriveSteps(plan, reads) {
  const steps = new Map();
  const set = (id, state, detail) => steps.set(id, detail ? { state, detail } : { state });
  const byId = new Map(plan.parts.map((entry) => [entry.id, reads.get(entry.id) || { state: 'missing' }]));
  const statusOf = (id) => (byId.get(id).state === 'ok' ? byId.get(id).status : 'pending');
  const docOf = (id) => (byId.get(id).state === 'ok' ? byId.get(id).doc : null);
  const has = (id) => plan.parts.some((entry) => entry.id === id);

  if (has('website')) {
    const done = statusOf('website') === 'done';
    const pages = sourcesOf(docOf('website')).length;
    set('website', done ? 'done' : 'running', done ? (pages ? plural(pages, 'page read', 'pages read') : '') : 'Reading your website');
  } else {
    set('website', 'done', 'No website given');
  }

  const competitorIds = plan.parts.filter((entry) => entry.group === 'competitors').map((entry) => entry.id);
  const ownDone = !has('own') || statusOf('own') === 'done';
  const ownAccounts = has('own') ? sourcesOf(docOf('own'), ['brand_social']).length : 0;
  const rivals = competitorIds.flatMap((id) => (docOf(id) && isObject(docOf(id).research) && Array.isArray(docOf(id).research.competitorDetails) ? docOf(id).research.competitorDetails : []));
  const rivalNames = new Set(rivals.filter((item) => isObject(item) && typeof item.name === 'string').map((item) => item.name.trim().toLowerCase()));
  const rivalPosts = competitorIds.flatMap((id) => postsOf(docOf(id), 'competitor'));
  const rivalsDone = competitorIds.length > 0 && competitorIds.every((id) => statusOf(id) === 'done');
  const rivalSocial = competitorIds.reduce((sum, id) => sum + sourcesOf(docOf(id), ['competitor_social']).length, 0);

  if (has('own') || competitorIds.length) {
    const ownRead = !has('own') || statusOf('own') === 'done' || ownAccounts >= (plan.ownAccounts || []).length;
    const rivalRead = !competitorIds.length || rivalsDone || rivalPosts.length > 0;
    const accounts = ownAccounts + rivalSocial;
    if (ownRead && rivalRead) set('accounts', 'done', accounts ? plural(accounts, 'account read', 'accounts read') : '');
    else set('accounts', 'running', accounts ? plural(accounts, 'account read so far', 'accounts read so far') : 'Reading accounts');
  }

  if (has('own')) {
    const posts = postsOf(docOf('own'), 'brand');
    set('own_top', ownDone || posts.length ? 'done' : 'running', posts.length ? plural(posts.length, 'top post', 'top posts') : (ownDone ? 'No posts of your own yet' : 'Looking for your best posts'));
    const k = takenApart(posts);
    if (ownDone) set('own_teardown', 'done', k ? plural(k, 'video taken apart', 'videos taken apart') : 'No videos to take apart');
    else set('own_teardown', 'running', posts.length ? `${k} of ${Math.min(MAX_OWN_VIDEOS, posts.length)} videos` : '');
  } else {
    set('own_top', 'done', 'No posts of your own yet');
    set('own_teardown', 'done', 'No posts of your own yet');
  }

  if (competitorIds.length) {
    const found = rivalNames.size;
    if (rivalsDone) set('competitors', 'done', found ? plural(found, 'competitor', 'competitors') : '');
    else if (found >= MAX_COMPETITORS) set('competitors', 'done', `${found} competitors`);
    else set('competitors', 'running', found ? `${found} of ${MAX_COMPETITORS} competitors` : (plan.split ? 'Reading your competitors' : 'Finding your competitors'));
    const k = takenApart(rivalPosts);
    if (rivalsDone) set('rivals_teardown', 'done', k ? plural(k, 'competitor video', 'competitor videos') : 'No competitor videos to take apart');
    else set('rivals_teardown', 'running', rivalPosts.length ? `${k} of ${Math.min(MAX_COMPETITORS * 2, rivalPosts.length)} videos` : '');
  }

  if (has('pains')) {
    const doc = docOf('pains');
    if (statusOf('pains') === 'done') {
      const banks = doc && isObject(doc.banks) ? doc.banks : {};
      const bits = [[countOf(banks.pains), 'pain point', 'pain points'], [countOf(banks.objections), 'objection', 'objections'], [countOf(banks.desires), 'desire', 'desires']]
        .filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many));
      set('pains', 'done', bits.length ? bits.join(', ') : 'No comments or reviews to read yet');
    } else {
      set('pains', 'running', 'Reading comments, forums and reviews');
    }
  }

  if (has('viral') && statusOf('viral') !== 'pending') {
    const posts = postsOf(docOf('viral'), 'viral');
    const k = takenApart(posts);
    if (statusOf('viral') === 'done') set('viral', 'done', k ? plural(k, 'viral video taken apart', 'viral videos taken apart') : 'Nothing viral found yet');
    else set('viral', 'running', posts.length ? `${k} of ${Math.min(3, posts.length)} viral videos` : 'Taking apart what is viral');
  }
  return steps;
}

/**
 * Move the checklist of the open run along with its part files: called from pipeline_status, so each board refresh shows the parallel
 * progress. A step that is done stays done, and nothing is written when nothing changed. Never throws.
 */
export function syncPartsProgress({ root }) {
  try {
    const open = onboardingRun.active(root);
    if (!open) return null;
    const { run, brandDir } = open;
    const plan = readPlan(brandDir, run.runId);
    if (!plan) return null;
    const progress = readProgress({ root, brand: run.brand });
    if (!progress || progress.status !== 'running') return null;
    const reads = new Map(plan.parts.map((entry) => [entry.id, readPartFile(partFile(brandDir, run.runId, entry.id))]));
    // A file a worker is writing right now can be unreadable for a moment; the next refresh picks it up.
    if ([...reads.values()].some((read) => read.state === 'invalid')) return null;
    const wanted = deriveSteps(plan, reads);
    let changed = false;
    const steps = progress.steps.map((step) => {
      const next = wanted.get(step.id);
      if (!next || step.state === 'done') return step;
      const detail = next.detail === undefined ? step.detail : next.detail;
      if (step.state === next.state && (step.detail || '') === (detail || '')) return step;
      changed = true;
      return { ...step, state: next.state, ...(detail ? { detail } : { detail: '' }) };
    });
    if (!changed) return progress;
    const newBrand = !plan.ownAccounts || !plan.ownAccounts.length ? true : undefined;
    return writeProgress({ root, brand: run.brand, steps: steps.map((step) => (step.detail ? step : { id: step.id, label: step.label, state: step.state })), newBrand });
  } catch {
    return null;
  }
}
