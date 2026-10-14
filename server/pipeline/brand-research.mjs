/**
 * The one onboarding research pass for a brand.
 *
 * A brand onboarding research run fills only the blank declared-profile
 * fields and tops up a shortlist of competitors, scoped to the brand's target market. It
 * never touches a job's own research or routing. The run is durable: start
 * records a marker and a run file, save applies the researcher's draft to
 * the brand profile and research record in one order (profile first, then
 * research, so the saved research is never immediately stale), and close
 * ends an abandoned or failed run without saving anything.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserFacingError } from '../lib/errors.mjs';
import * as runtime from './runtime.mjs';
import { askQuestion, listQuestions, plainWordsProblem, withdrawQuestion } from './questions.mjs';
import { readClaimRecord, takeClaim, windowSessionId } from './session-claims.mjs';
import { MAX_BREAKDOWNS, breakdownCounts, fileOnboardingResearch, fileTopPosts, topPostsProblems } from './brand-onboarding-library.mjs';
import { fileIntelligence, intelligenceBuilt, startChecklist } from './brand-intelligence.mjs';
import { banksProblems, existingPainTexts, fileBanks } from './brand-onboarding-banks.mjs';
import { MAX_RESEARCH_SOURCES, collectParts, publicParts, redoOf, syncPartsProgress, tagProblems, writePartFiles } from './brand-research-parts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = join(HERE, '..', '..', 'pipeline');

const require = createRequire(import.meta.url);
const brandProfile = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-profile.js'));
const brandResearch = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-research.js'));
const researchBudgets = require(join(PIPELINE_ROOT, 'scripts', 'lib-research-budget.js'));
const onboardingRun = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-run.js'));
const durable = require(join(PIPELINE_ROOT, 'scripts', 'lib-durable.js'));
const brandFiles = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-files.js'));
const onboardingEvidence = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-evidence.js'));
const toolMetrics = require(join(PIPELINE_ROOT, 'scripts', 'lib-tool-metrics.js'));

const REFRESH_FAILED = 'The scheduled research refresh failed';
/** Said to the person when research that looks current is redone because the brand never had its intelligence built (see fileIntelligence). */
const INTELLIGENCE_REASON = 'Your brand intelligence was never built from your best posts, your competitors and what is viral in your niche; building it now';
const BUSY = 'Another Claude window is already using the browser for research. Wait for it to finish, then run it again.';
// The parts of a run (brand-research-parts.mjs) share this: 20 sources in all, 3 to 8 for each part.
const MAX_SOURCES = MAX_RESEARCH_SOURCES;
const MAX_EVIDENCE_PER_COMPETITOR = 3;
const REPLACEABLE_FIELDS = ['sources', 'evidenceMatrix', 'findings', 'gaps', 'competitors', 'competitorDetails'];

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

/**
 * Resolve a brand by slug or id.
 */
function resolveBrand(root, brand) {
  const value = String(brand || '').trim();
  if (!value) throw new UserFacingError('A brand slug or id is required.', { code: 'invalid_input' });
  const entry = runtime.listBrands({ root }).find((item) => item.slug === value || item.id === value || item.brandId === value);
  if (!entry) throw new UserFacingError(`Brand not found: ${value}`, { code: 'brand_not_found' });
  return entry;
}

/**
 * Resolve a brand by slug or id and require its onboarding to be complete.
 */
function requireOnboardedBrand(root, brand) {
  const entry = resolveBrand(root, brand);
  if (entry.onboardingStatus !== 'complete') {
    throw new UserFacingError('Save the brand profile before brand research.', { code: 'brand_onboarding_incomplete' });
  }
  return entry;
}

/** One claim per workspace: only one window drives the browser for research at a time. */
const browserClaimFile = (root) => join(root, '.social-pipeline', 'onboarding', 'browser.claim');

function takeBrowser(root, slug) {
  const file = browserClaimFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const taken = takeClaim(file, windowSessionId(), { ttlMs: onboardingRun.STALE_MS, extra: { brand: slug } });
  if (!taken.claimed) throw new UserFacingError(BUSY, { code: 'research_browser_busy' });
}

/** Let the browser go once the run is over, whichever window closes it. */
function releaseBrowser(root, slug) {
  const file = browserClaimFile(root);
  const held = readClaimRecord(file);
  if (held && (!held.brand || held.brand === slug)) rmSync(file, { force: true });
}

function refreshQuestions(root, slug) {
  return listQuestions({ root, status: 'open' }).filter((q) => q.brand === slug && String(q.text).startsWith(REFRESH_FAILED));
}

function clearRefreshQuestions(root, slug) {
  try {
    for (const question of refreshQuestions(root, slug)) withdrawQuestion({ root, questionId: question.questionId });
  } catch { /* the question is a courtesy; the run's own result is already saved */ }
}

/** The reason in plain words, short, with no trailing full stop; a reason that reads like code or a file becomes a general one. */
function plainReason(reason) {
  const line = String(reason ?? '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').slice(0, 160);
  if (!line || plainWordsProblem(line)) return 'it stopped without a clear reason';
  return line[0].toLowerCase() + line.slice(1);
}

/** A research run that did not finish goes to the Director's Inbox once, replacing any older one for the brand. Never throws. */
function raiseRefreshFailure(root, slug, reason) {
  try {
    clearRefreshQuestions(root, slug);
    askQuestion({
      root, brand: slug, text: `${REFRESH_FAILED}: ${plainReason(reason)}. Run it again?`,
      options: ['Run it again', 'Not now'], allowText: false,
    });
  } catch { /* the failed run is already on record */ }
}

/**
 * Close any research run left running past its time (a disconnected browser never says it stopped), and tell the Inbox.
 * Run from the board refresh, so a refresh that died with no message still leaves a result and a question. Never throws.
 */
export function settleStaleResearch({ root }) {
  try {
    for (const entry of runtime.listBrands({ root })) {
      for (const run of onboardingRun.list(entry.path)) {
        if (run.status !== 'running' || !onboardingRun.isStale(run)) continue;
        onboardingRun.close(root, { brandDir: entry.path, runId: run.runId, status: 'abandoned', reason: 'timed out', now: Math.min(Date.now(), Date.parse(run.startedAt) + onboardingRun.STALE_MS) });
        raiseRefreshFailure(root, entry.slug, 'it stopped responding and ran out of time, which can happen when the browser disconnects');
        releaseBrowser(root, entry.slug);
      }
    }
  } catch { /* the board still shows the run as stopped */ }
}

/**
 * Move the onboarding checklist along with the part files of the open run, so a board refresh shows the parallel workers' progress as each
 * part finishes. Run from pipeline_status next to settleStaleResearch. Writes only when a step changed, and never throws.
 */
export function syncResearchProgress({ root }) {
  try {
    return syncPartsProgress({ root });
  } catch {
    return null;
  }
}

function blanksAndCompetitors(profile) {
  const blankFields = brandProfile.blankContextFields(profile);
  const items = profile.competitors && Array.isArray(profile.competitors.items) ? profile.competitors.items : [];
  const declared = items.slice(0, brandProfile.MAX_COMPETITORS);
  return { blankFields, declared, toFind: brandProfile.MAX_COMPETITORS - declared.length };
}

/**
 * The folder of a brand research run that is still going, for pipeline_video_teardown during onboarding research: the tool is given
 * jobId `onboarding-<runId>` (the id the run's library entry has too) and saves the video and its teardown in the run's own folder,
 * since the run has no job. Returns the folder, or null when the id is not a run's.
 */
export function researchRunFolder({ root, brand, jobId }) {
  const match = /^onboarding-(run-\d{8}T\d{6}Z-[a-f0-9]{6})$/.exec(String(jobId || ''));
  if (!match) return null;
  const entry = requireOnboardedBrand(root, brand);
  const run = onboardingRun.read(entry.path, match[1]);
  if (!run || run.status !== 'running') throw new UserFacingError('That brand research run is not running, so a video cannot be taken apart for it.', { code: 'research_run_not_running', fix: 'Use the runId from pipeline_brand_research_start while the run is open.' });
  return onboardingRun.runDir(entry.path, run.runId);
}

function draftPathFor(brandDir, runId) {
  return join(onboardingRun.runDir(brandDir, runId), 'research-draft.json');
}

const SKELETON_FILLS = Object.freeze({ audience: '', market: '', voice: '', contentPillars: [], competitors: [], forbiddenClaims: '', examples: '' });
const EXTRA_FILLS = brandProfile.RESEARCH_EXTRA_FIELDS;

function draftSkeleton(runId, blankFields, toFind) {
  const fills = {};
  for (const name of brandProfile.CONTEXT_FIELDS) {
    if (name === 'competitors' ? toFind > 0 : blankFields.includes(name)) fills[name] = structuredClone(SKELETON_FILLS[name]);
  }
  for (const name of EXTRA_FILLS) {
    if (blankFields.includes(name)) fills[name] = SKELETON_FILLS[name];
  }
  return {
    version: 1,
    runId,
    fills,
    suggested: [],
    research: { sources: [], evidenceMatrix: [], competitorDetails: [], findings: {}, gaps: [] },
    brandFiles: {},
    topPosts: [],
    banks: { pains: [], desires: [], objections: [], angles: [], captions: [], ctas: [] },
    budget: { searches: 0, fetches: 0, stopReason: '' },
  };
}

function ensureDraftSkeleton(draftPath, runId, blankFields, toFind) {
  if (existsSync(draftPath)) return;
  durable.atomicWrite(draftPath, JSON.stringify(draftSkeleton(runId, blankFields, toFind), null, 2) + '\n');
}

function marketUnknownError(slug) {
  return new UserFacingError(
    `The target market for "${slug}" is not set, so research cannot start yet. Ask the person which market the brand sells to, in chat with buttons: `
    + 'their likely country (guess it from the website or social accounts), "Global (no one country)", and "Other". '
    + 'Save the answer as the target market on the brand profile (use "Global" for no one country), then start the research again.',
    { code: 'target_market_unknown', details: { brand: slug } },
  );
}

/**
 * Start (or resume) the one onboarding research pass for a brand.
 * @returns {object} the section 1 `started`/`already_running`/`skipped` shape.
 */
export function startBrandResearch({ root, brand }) {
  const entry = requireOnboardedBrand(root, brand);
  const brandDir = entry.path;
  const profile = brandProfile.read(brandDir);
  if (!profile) throw new UserFacingError('Save the brand profile before brand research.', { code: 'brand_onboarding_incomplete' });
  const { blankFields, declared } = blanksAndCompetitors(profile);
  const market = brandProfile.targetMarketOf(profile);
  const existingResearch = brandResearch.read(brandDir);
  const researchRevision = existingResearch ? existingResearch.revision : 0;

  // Research that looks current is still redone once for a brand onboarded before the brand files were written from research:
  // an untouched template, or sources with no saved page behind them. After one good run neither is true, so this is once.
  // The same once for a brand whose intelligence (the labelled best posts, the six subtopics, the plan) was never built: onboarding always runs the deep pass.
  const looksCurrent = !blankFields.length && existingResearch && existingResearch.current;
  const refreshReason = (looksCurrent ? brandFiles.upgradeReason(brandDir, existingResearch) : null)
    || (looksCurrent && !intelligenceBuilt({ root, brand: entry.slug }) ? INTELLIGENCE_REASON : null);
  if (looksCurrent && !refreshReason) {
    onboardingRun.clearPending(brandDir);
    return {
      status: 'skipped',
      brand: entry.slug,
      brandId: entry.id,
      reason: 'Every context field is filled and the saved research is current.',
      researchRevision,
    };
  }

  // The market scopes every competitor, audience and trend search, so it is never guessed: without one the person is asked first.
  if (!market) throw marketUnknownError(entry.slug);

  // 30 searches, 56 fetches, 120 turns: onboarding is always the deep pass, so it needs far more than a job's research (a campaign has 12, 16
  // and 40). The calls of every agent working inside the run count here, the Trend Scout's too. Fetches: the website and each competitor's
  // (about 7), a profile read and an outlier read for each declared account and each competitor handle (about 14), the 14 video teardowns
  // (a fetch each: the brand's 5 best, the top 2 of each of 3 competitors and the 3 most viral), the pain points workstream's reads (2 comment
  // reads, 2 forum threads, 2 review pages, 1 ad search and 1 landing page) and the Trend Scout's post and ad reads (about 10).
  // Searches: the competitor and forum searches, and the Trend Scout's niche topic and YouTube searches.
  const limits = { ...researchBudgets.HARD_LIMITS, totalSearches: 30, totalFetches: 56, turns: 120 };
  const workspaceId = runtime.readWorkspace({ root }).workspaceId;
  takeBrowser(root, entry.slug);
  const wasStale = onboardingRun.list(brandDir).filter((item) => item.status === 'running' && onboardingRun.isStale(item));
  let started;
  try {
    started = onboardingRun.start(root, {
      brand: entry.slug,
      brandId: entry.id,
      brandDir,
      workspaceId,
      blankFields,
      declaredCompetitors: declared,
      limits,
      profileRevision: profile.revision,
      researchRevision,
      market,
      now: new Date(),
    });
  } catch (error) {
    releaseBrowser(root, entry.slug);
    if (error && error.code === 'ONBOARDING_RUN_ACTIVE') {
      throw new UserFacingError(
        `Brand research is already running for "${error.brand}". Finish or close that run before starting a new one.`,
        { code: 'onboarding_run_active', details: { runId: error.runId, brand: error.brand } },
      );
    }
    throw error;
  }

  const run = started.run;
  // The run this one replaced went quiet (a disconnected browser says nothing): its result is recorded, and the Inbox asked.
  if (wasStale.length) raiseRefreshFailure(root, entry.slug, 'it stopped responding and ran out of time, which can happen when the browser disconnects');
  const declaredCompetitors = Array.isArray(run.declaredCompetitors) ? run.declaredCompetitors : declared;
  const draftPath = draftPathFor(brandDir, run.runId);
  // The pages the researcher reads are saved here, one file each, like a job's research/raw: the save checks every source against one.
  const rawDir = onboardingRun.rawDir(brandDir, run.runId);
  mkdirSync(rawDir, { recursive: true });
  const toFind = brandProfile.MAX_COMPETITORS - declaredCompetitors.length;
  const alsoFill = brandProfile.blankResearchFields(profile).filter((name) => EXTRA_FILLS.includes(name));
  const fillNames = [...(run.blankFields || blankFields), ...alsoFill];
  ensureDraftSkeleton(draftPath, run.runId, fillNames, toFind);
  // The parts of the run (brand-research-parts.mjs): the Director spawns one worker for each, in one message, and each writes its own part file
  // in the shape of the draft. Where the Trend Scout (spawned beside the researchers) writes what it saw, and the viral videos a short
  // follow-up then takes apart, are named here and in the viral part's contract.
  const runFolder = onboardingRun.runDir(brandDir, run.runId);
  const trendsPath = join(runFolder, 'trends.md');
  const viralPath = join(runFolder, 'viral-candidates.json');
  const plan = writePartFiles({
    brandDir, runId: run.runId, profile, declared: declaredCompetitors, toFind,
    fills: draftSkeleton(run.runId, fillNames, toFind).fills, rawDir, viralPath, trendsPath,
  });
  // The onboarding checklist the board shows while the pass runs starts with the run; the parts then move their steps by themselves
  // (syncPartsProgress, from pipeline_status) and the Director moves the others (brand_intelligence_save).
  if (started.created) startChecklist({ root, brand: entry.slug });
  return {
    status: started.created ? 'started' : 'already_running',
    runId: run.runId,
    brand: entry.slug,
    brandId: entry.id,
    market: run.market || market,
    blankFields: run.blankFields || blankFields,
    alsoFill,
    competitors: { declared: declaredCompetitors, toFind },
    limits: run.limits || limits,
    draftPath,
    rawDir,
    refreshReason,
    // Where the Trend Scout (spawned beside the researchers) writes what it saw during this run, and the viral videos a researcher then takes apart.
    trendsPath,
    viralPath,
    // One entry for each worker to spawn at once: its part file, its contract (it reads it itself) and its share of the budget.
    parts: publicParts({ brandDir, runId: run.runId, plan, viralPath, trendsPath }),
    competitorSplit: plan.split,
    deep: true,
    draftContract: draftContract(),
    profileRevision: run.profileRevisionAtStart ?? profile.revision,
    researchRevision: run.researchRevisionAtStart ?? researchRevision,
  };
}

const RESEARCH_SKILL = join(PIPELINE_ROOT, 'skills', 'research', 'SKILL.md');

/**
 * The brand onboarding section of the research skill, read from this plugin's own copy so it can go
 * straight into the researcher's spawn prompt. Empty when the file cannot be read.
 */
export function draftContract() {
  try {
    const text = readFileSync(RESEARCH_SKILL, 'utf8').replace(/\r\n/g, '\n');
    const start = text.indexOf('## Brand onboarding workstream');
    if (start < 0) return '';
    const next = text.indexOf('\n## ', start + 1);
    return text.slice(start, next < 0 ? undefined : next).trim();
  } catch {
    return '';
  }
}

function readDraft(draftPath) {
  if (!existsSync(draftPath)) {
    throw new UserFacingError('The research draft has not been written yet. Write research-draft.json before saving.', { code: 'research_draft_missing' });
  }
  let raw;
  try {
    raw = readFileSync(draftPath, 'utf8');
  } catch {
    throw new UserFacingError('The research draft could not be read.', { code: 'research_draft_missing' });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { invalid: 'The research draft is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { invalid: 'The research draft must be a JSON object.' };
  }
  return { value: parsed };
}

function scopePlace(profile) {
  const market = brandProfile.targetMarketOf(profile);
  const named = Boolean(profile && typeof profile.targetMarket === 'string' && profile.targetMarket.trim());
  // A named country is the geography; Global or an unset market has no country filter, so there is none to give.
  return { market, geography: named && !brandProfile.isGlobalMarket(market) ? market : undefined };
}

function defaultResearchScope(slug, place) {
  return { brand: slug, market: place.market, geography: place.geography, label: 'Brand onboarding research' };
}

function defaultScope(item, slug, place) {
  if (item && typeof item === 'object' && item.scope) return item;
  return { ...item, scope: { brand: slug, market: place.market, geography: place.geography }, applicableDimensions: (item && item.applicableDimensions) || ['brand'] };
}

function latestObservedAtByKind(sources) {
  const latest = {};
  for (const source of sources) {
    // A source with no kind was already refused by the save's checks; none is given a longer life than its kind allows.
    const kind = source.kind;
    const parsed = Date.parse(source.observedAt);
    if (!kind || !Number.isFinite(parsed)) continue;
    if (!latest[kind] || parsed > Date.parse(latest[kind])) latest[kind] = source.observedAt;
  }
  const freshness = {};
  for (const [kind, observedAt] of Object.entries(latest)) freshness[kind] = { observedAt };
  return freshness;
}

function requiredFalseGaps(gaps) {
  if (!Array.isArray(gaps)) return undefined;
  return gaps.map((gap) => (typeof gap === 'string' ? { question: gap, reason: gap, required: false } : gap));
}

const FILL_TEXT_LIMITS = Object.freeze({ audience: 400, market: 400, voice: 300, forbiddenClaims: 600, examples: 600 });
const SUGGESTIBLE_FIELDS = Object.freeze(['audience', ...EXTRA_FILLS]);
// Findings the researcher may add for the brand voice notes. They are optional and each is held
// to the note cap that the brand voice file renders them under.
const DEPTH_FINDING_KEYS = Object.freeze(['uniqueMechanism', 'alternativeSolution', 'heroProduct', 'constraints', 'strategy']);
const FINDING_NOTE_MAX = 1500;
const CONSTRAINT_TAG = /^\s*(?:[-*\u2022]\s*)?[\[(]?(?:confirmed|inferred)\b/i;
// One set of pillar limits for a typed save, the board and a research fill.
// A research fill lists 3 to 5 pillars, as the research skill says. A typed list keeps the profile's wider 1 to 8.
const CONTENT_PILLARS_MIN = brandProfile.RESEARCH_PILLAR_MIN;
const CONTENT_PILLARS_MAX = brandProfile.RESEARCH_PILLAR_MAX;
const CONTENT_PILLAR_ITEM_MAX = brandProfile.CONTENT_PILLAR_ITEM_MAX;
const DRAFT_KEYS = Object.freeze(['version', 'runId', 'fills', 'suggested', 'research', 'brandFiles', 'topPosts', 'banks', 'budget']);
const RESEARCH_KEYS = Object.freeze(['scope', 'sources', 'evidenceMatrix', 'competitorDetails', 'findings', 'gaps', 'competitors']);
const RESEARCH_LISTS = Object.freeze(['sources', 'evidenceMatrix', 'competitorDetails', 'gaps', 'competitors']);
const FILL_BANNED_PATTERNS = Object.freeze([
  { test: /http/i, rule: 'must not contain a URL ("http")' },
  { test: /www\./i, rule: 'must not contain a URL ("www.")' },
  { test: /\b[a-z0-9-]+\.(com|sg|net|org|co)(\.[a-z]{2})?\b/i, rule: 'must not contain a domain name' },
  { test: /\b\d{4}-\d{2}-\d{2}\b/, rule: 'must not contain a date' },
  { test: /\bfetched\b/i, rule: 'must not contain the word "fetched"' },
  { test: /\bverbatim\b/i, rule: 'must not contain the word "verbatim"' },
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function filled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkFillText(field, text, problems) {
  for (const { test, rule } of FILL_BANNED_PATTERNS) {
    if (test.test(text)) problems.push({ field: `fills.${field}`, problem: `${field} ${rule}.` });
  }
}

function fillProblems(fills, problems) {
  for (const key of Object.keys(fills)) {
    if (!brandProfile.CONTEXT_FIELDS.includes(key) && !EXTRA_FILLS.includes(key)) {
      problems.push({ field: `fills.${key}`, problem: `Brand research cannot fill "${key}".` });
    }
  }
  for (const field of ['audience', 'market', 'voice', ...EXTRA_FILLS]) {
    if (!own(fills, field)) continue;
    const value = fills[field];
    if (typeof value !== 'string') {
      problems.push({ field: `fills.${field}`, problem: `${field} must be text.` });
      continue;
    }
    checkFillText(field, value, problems);
    const max = FILL_TEXT_LIMITS[field];
    if (value.length > max) problems.push({ field: `fills.${field}`, problem: `${field} must be at most ${max} characters (has ${value.length}).` });
  }
  for (const field of ['contentPillars', 'competitors']) {
    if (!own(fills, field)) continue;
    const list = fills[field];
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      problems.push({ field: `fills.${field}`, problem: `${field} must be a list of text items.` });
      continue;
    }
    for (const item of list) checkFillText(field, item, problems);
  }
  if (Array.isArray(fills.contentPillars) && fills.contentPillars.length) {
    const count = fills.contentPillars.length;
    if (count < CONTENT_PILLARS_MIN || count > CONTENT_PILLARS_MAX) {
      problems.push({ field: 'fills.contentPillars', problem: `contentPillars must list ${CONTENT_PILLARS_MIN} to ${CONTENT_PILLARS_MAX} items (has ${count}).` });
    }
    const longest = Math.max(...fills.contentPillars.map((item) => (typeof item === 'string' ? item.trim().length : 0)));
    if (longest > CONTENT_PILLAR_ITEM_MAX) {
      problems.push({ field: 'fills.contentPillars', problem: `each content pillar must be at most ${CONTENT_PILLAR_ITEM_MAX} characters (the longest has ${longest}).` });
    }
  }
  if (Array.isArray(fills.competitors) && fills.competitors.length > brandProfile.MAX_COMPETITORS) {
    problems.push({ field: 'fills.competitors', problem: 'Brand research saves at most 3 competitors.' });
  }
}

function suggestedProblems(suggested, fills, problems) {
  if (suggested === undefined) return [];
  if (!Array.isArray(suggested)) {
    problems.push({ field: 'suggested', problem: 'suggested must be a list of field names.' });
    return [];
  }
  const names = [...new Set(suggested)];
  if (names.some((name) => !SUGGESTIBLE_FIELDS.includes(name))) {
    problems.push({ field: 'suggested', problem: `Only ${SUGGESTIBLE_FIELDS.join(', ')} can be marked as a suggestion.` });
    return [];
  }
  for (const name of names) {
    if (!filled(fills[name])) {
      problems.push({ field: 'suggested', problem: `The ${name} is marked as a suggestion but has no ${name} fill.` });
    }
  }
  return names;
}

function findingLines(value) {
  if (typeof value === 'string') return value.split(/\r?\n/);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.flatMap((item) => item.split(/\r?\n/));
  return null;
}

function findingProblems(findings, problems) {
  for (const key of DEPTH_FINDING_KEYS) {
    if (!own(findings, key)) continue;
    const field = `research.findings.${key}`;
    const value = findings[key];
    if (key === 'strategy' && isObject(value)) continue;
    const lines = findingLines(value);
    if (!lines) {
      problems.push({ field, problem: `${key} must be text or a list of text lines.` });
      continue;
    }
    const text = lines.join('\n');
    for (const { test, rule } of FILL_BANNED_PATTERNS) {
      if (test.test(text)) problems.push({ field, problem: `${key} ${rule}.` });
    }
    if (text.trim().length > FINDING_NOTE_MAX) {
      problems.push({ field, problem: `${key} must be at most ${FINDING_NOTE_MAX} characters (has ${text.trim().length}).` });
    }
    if (key === 'constraints') {
      const untagged = lines.filter((line) => line.trim() && !CONSTRAINT_TAG.test(line));
      if (untagged.length) {
        problems.push({ field, problem: 'Start every constraint line with "Confirmed" or "Inferred"; an inferred line is never a brand fact.' });
      }
    }
  }
}

function attempt(field, problems, step) {
  try {
    step();
  } catch (error) {
    problems.push({ field, problem: error && error.message ? error.message : String(error) });
  }
}

function researchProblems(researchDraft, slug, place, problems, ctx = {}) {
  for (const key of Object.keys(researchDraft)) {
    if (!RESEARCH_KEYS.includes(key)) {
      problems.push({ field: `research.${key}`, problem: `"${key}" is not a research field. Use ${RESEARCH_KEYS.join(', ')}.` });
    }
  }
  let listsOk = true;
  for (const key of RESEARCH_LISTS) {
    if (own(researchDraft, key) && !Array.isArray(researchDraft[key])) {
      problems.push({ field: `research.${key}`, problem: `research.${key} must be a list.` });
      listsOk = false;
    }
  }
  if (own(researchDraft, 'findings') && !isObject(researchDraft.findings)) {
    problems.push({ field: 'research.findings', problem: 'research.findings must be an object.' });
  } else if (own(researchDraft, 'findings')) {
    findingProblems(researchDraft.findings, problems);
  }
  if (own(researchDraft, 'scope') && !isObject(researchDraft.scope)) {
    problems.push({ field: 'research.scope', problem: 'research.scope must be an object.' });
  }
  if (!listsOk) return { bySource: new Map() };

  const sources = Array.isArray(researchDraft.sources) ? researchDraft.sources : [];
  if (!sources.length) problems.push({ field: 'research.sources', problem: 'Add at least one dated source the research used.' });
  if (sources.length > MAX_SOURCES) problems.push({ field: 'research.sources', problem: `Brand research saves at most ${MAX_SOURCES} sources.` });
  const boundary = brandResearch.createCapabilityBoundary({});
  sources.forEach((source, index) => {
    if (!isObject(source)) {
      problems.push({ field: `research.sources[${index}]`, problem: 'Each source must be an object with url, observedAt, kind and title.' });
      return;
    }
    attempt(`research.sources[${index}].url`, problems, () => boundary.fetch(source.url, 'Source'));
  });
  const researchCompetitors = Array.isArray(researchDraft.competitors) ? researchDraft.competitors : [];
  if (researchCompetitors.length > brandProfile.MAX_COMPETITORS) {
    problems.push({ field: 'research.competitors', problem: 'Brand research saves at most 3 competitors.' });
  }
  const competitorDetails = Array.isArray(researchDraft.competitorDetails) ? researchDraft.competitorDetails : [];
  if (competitorDetails.length > brandProfile.MAX_COMPETITORS) {
    problems.push({ field: 'research.competitorDetails', problem: 'Brand research saves at most 3 competitors.' });
  }
  competitorDetails.forEach((detail, index) => {
    if (Array.isArray(detail && detail.evidence) && detail.evidence.length > MAX_EVIDENCE_PER_COMPETITOR) {
      problems.push({ field: `research.competitorDetails[${index}].evidence`, problem: 'Brand research saves at most 3 evidence items per competitor.' });
    }
  });

  const scope = isObject(researchDraft.scope) ? researchDraft.scope : defaultResearchScope(slug, place);
  const preparedSources = sources.filter(isObject).map((source) => defaultScope(source, slug, place));
  const evidenceMatrix = Array.isArray(researchDraft.evidenceMatrix) ? researchDraft.evidenceMatrix : [];
  if (evidenceMatrix.some((item) => !isObject(item))) {
    problems.push({ field: 'research.evidenceMatrix', problem: 'Each evidence item must be an object with id, question, finding, confidence, source, observedAt and semantics.' });
  } else {
    attempt('research.evidenceMatrix', problems, () => brandResearch.normalizeEvidenceMatrix(evidenceMatrix.map((item) => defaultScope(item, slug, place))));
  }
  attempt('research.scope', problems, () => brandResearch.normalizeScope(scope));
  if (preparedSources.length === sources.length) attempt('research.sources', problems, () => brandResearch.normalizeSources(preparedSources));
  if (own(researchDraft, 'competitors')) attempt('research.competitors', problems, () => brandResearch.normalizeCompetitors(researchCompetitors));
  if (own(researchDraft, 'competitorDetails')) attempt('research.competitorDetails', problems, () => brandResearch.normalizeCompetitorDetails(competitorDetails));
  if (own(researchDraft, 'gaps')) attempt('research.gaps', problems, () => brandResearch.normalizeGaps(requiredFalseGaps(researchDraft.gaps)));

  // The evidence rules: a fixed kind, a fresh read, a capture on disk, a tool that read it, quotes found in the capture,
  // and competitors that are businesses with a handle. See lib-onboarding-evidence.js.
  const checkedSources = onboardingEvidence.sourceProblems(sources, { rawDir: ctx.rawDir, now: ctx.now, calls: ctx.calls });
  problems.push(...checkedSources.problems);
  problems.push(...onboardingEvidence.evidenceProblems(evidenceMatrix, { bySource: checkedSources.bySource }));
  problems.push(...onboardingEvidence.competitorProblems(competitorDetails, { bySource: checkedSources.bySource, gaps: researchDraft.gaps, expected: ctx.expectedCompetitors }));
  const handleCount = competitorDetails.reduce((sum, detail) => sum + onboardingEvidence.handlesOf(detail).length, 0);
  problems.push(...onboardingEvidence.socialReadProblems(ctx.calls, (ctx.ownSocial || 0) + handleCount));
  return { bySource: checkedSources.bySource };
}

function audienceProblemText(market) {
  return `The audience is blank. Add the brand's own audience, or suggest one from the top competitors' audiences in ${market || 'the target market'} using sources from the last 12 months and list audience under suggested.`;
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An observedAt as a full timestamp. A plain date (YYYY-MM-DD) becomes midnight UTC that day, and a time in the
 * future is set to now, so the researcher never has to invent a clock time. A value that is not a date is left
 * as written, and the save names it.
 */
function tidyObservedAt(value, now) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const text = value.trim();
  const parsed = Date.parse(PLAIN_DATE.test(text) ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(parsed)) return value;
  return new Date(Math.min(parsed, now.getTime())).toISOString();
}

function tidyDates(items, now) {
  return items.map((item) => (isObject(item) && own(item, 'observedAt') ? { ...item, observedAt: tidyObservedAt(item.observedAt, now) } : item));
}

/** The research part of a draft with every source, evidence and competitor evidence date tidied. */
function tidyResearchDates(research, now) {
  if (!isObject(research)) return research;
  const tidy = { ...research };
  if (Array.isArray(tidy.sources)) tidy.sources = tidyDates(tidy.sources, now);
  if (Array.isArray(tidy.evidenceMatrix)) tidy.evidenceMatrix = tidyDates(tidy.evidenceMatrix, now);
  if (Array.isArray(tidy.competitorDetails)) {
    tidy.competitorDetails = tidy.competitorDetails.map((detail) => (isObject(detail) && Array.isArray(detail.evidence) ? { ...detail, evidence: tidyDates(detail.evidence, now) } : detail));
  }
  return tidy;
}

function draftProblems(draft, ctx) {
  const problems = [];
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.includes(key)) {
      problems.push({ field: key, problem: `"${key}" is not a draft field. Use ${DRAFT_KEYS.join(', ')}.` });
    }
  }
  const fills = own(draft, 'fills') ? draft.fills : {};
  const researchDraft = own(draft, 'research') ? tidyResearchDates(draft.research, new Date()) : {};
  if (!isObject(fills)) problems.push({ field: 'fills', problem: 'fills must be an object.' });
  if (!isObject(researchDraft)) problems.push({ field: 'research', problem: 'research must be an object.' });
  if (own(draft, 'budget') && !isObject(draft.budget)) problems.push({ field: 'budget', problem: 'budget must be an object.' });
  const safeFills = isObject(fills) ? fills : {};
  if (isObject(fills)) fillProblems(fills, problems);
  const named = suggestedProblems(draft.suggested, safeFills, problems);
  // A filled forbiddenClaims or examples always reads as a suggestion until the person has checked it.
  const suggested = [...new Set([...named, ...EXTRA_FILLS.filter((name) => filled(safeFills[name]))])];
  const now = ctx.now || new Date();
  const expected = expectedCompetitors(ctx.declared, safeFills, isObject(researchDraft) ? researchDraft : {});
  let bySource = new Map();
  if (isObject(researchDraft)) {
    const checked = researchProblems(researchDraft, ctx.slug, ctx.place, problems, {
      rawDir: ctx.rawDir, now, calls: ctx.calls, expectedCompetitors: expected, ownSocial: ctx.ownSocial,
    });
    if (checked && checked.bySource) bySource = checked.bySource;
  }
  // The audience, positioning and platform files, and the top posts that go to the brand library: both are checked against the
  // sources above, so a quote that is not in a saved capture or a post with no views (no likes either, for Instagram) never reaches a file or the bank.
  const filesChecked = brandFiles.validate(draft.brandFiles, { bySource, competitors: expected });
  problems.push(...filesChecked.problems);
  // Every video taken apart carries its labels (format, editing style, visual hook, subtopic: pipeline/library/formats.json).
  const postsChecked = topPostsProblems(draft.topPosts, { competitors: expected, now, requireLabels: true });
  problems.push(...postsChecked.problems);
  // A viral post comes from the Trend Scout's finds, not from an account read, so only the brand's and competitors' posts need the read in the log.
  if (postsChecked.value.some((post) => post.source !== 'viral') && ctx.calls && ctx.calls.recorded
    && !['social_outliers_find', 'social_profile_get', 'chrome'].some((tool) => ctx.calls.byTool[tool] && ctx.calls.byTool[tool].ok > 0)) {
    problems.push({ field: 'topPosts', problem: 'The tool log of this run shows no successful social_outliers_find or social_profile_get call, so these posts were not read from an account. Read the accounts, or remove the posts.' });
  }
  // A video was taken apart only when the tool log shows the teardown, and a run takes apart 14 videos at most.
  const taken = breakdownCounts(postsChecked.value);
  if (taken.total && ctx.calls && ctx.calls.recorded) {
    const teardowns = ctx.calls.byTool.pipeline_video_teardown;
    if (!teardowns || teardowns.ok < taken.total) {
      problems.push({ field: 'topPosts', problem: `${taken.total} post${taken.total === 1 ? ' has' : 's have'} a breakdown, but the tool log of this run shows ${teardowns ? teardowns.ok : 'no'} successful pipeline_video_teardown call${teardowns && teardowns.ok === 1 ? '' : 's'}. A breakdown is written only from a video that was taken apart; remove the breakdown of any video that was not.` });
    }
  }
  if (ctx.calls && ctx.calls.recorded && ctx.calls.byTool.pipeline_video_teardown && ctx.calls.byTool.pipeline_video_teardown.ok + ctx.calls.byTool.pipeline_video_teardown.failed > MAX_BREAKDOWNS) {
    problems.push({ field: 'topPosts', problem: `The run took ${ctx.calls.byTool.pipeline_video_teardown.ok + ctx.calls.byTool.pipeline_video_teardown.failed} videos apart. A run takes apart at most ${MAX_BREAKDOWNS}: 5 of the brand's own, 2 of each competitor's (6 in all) and 3 viral.` });
  }
  // The brand intelligence banks (pains, desires, objections, angles, captions, CTAs): every quote is looked for in the saved capture of
  // its source, and a caption or call to action is found in one of the top posts above or in an ad page's capture, so none reaches the bank unseen.
  const bankSource = (url) => bySource.get(onboardingEvidence.normUrl(url)) || null;
  const banksChecked = banksProblems(draft.banks, {
    captureFor: (url) => (bankSource(url) ? bankSource(url).capture : null),
    observedDay: (url) => (bankSource(url) && typeof bankSource(url).source.observedAt === 'string' ? bankSource(url).source.observedAt.slice(0, 10) : null),
    posts: postsChecked.value, competitors: expected, painTexts: ctx.root ? existingPainTexts({ root: ctx.root, brand: ctx.slug }) : [], now,
  });
  problems.push(...banksChecked.problems);
  const shapeCount = problems.length;
  let needsAudience = false;
  if (ctx.audienceBlank && !filled(safeFills.audience) && !ctx.audienceUnavailable) {
    needsAudience = true;
    problems.push({ field: 'fills.audience', problem: audienceProblemText(ctx.market) });
  }
  return {
    problems, shapeCount, suggested, needsAudience, fills: safeFills, researchDraft: isObject(researchDraft) ? researchDraft : {},
    bySource, expected, brandFiles: filesChecked.value, topPosts: postsChecked.value, banks: banksChecked.value,
  };
}

// The competitors the profile will hold: the declared ones first, then the ones research found, at most 3 in all.
function expectedCompetitors(declared, fills, researchDraft) {
  const names = [];
  const seen = new Set();
  for (const raw of [...(Array.isArray(declared) ? declared : []), ...foundCompetitors(fills, researchDraft)]) {
    const key = String(raw).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(String(raw).trim());
  }
  return names.slice(0, brandProfile.MAX_COMPETITORS);
}

function foundCompetitors(fills, researchDraft) {
  const names = [];
  const seen = new Set();
  for (const list of [fills.competitors, researchDraft.competitors]) {
    for (const raw of Array.isArray(list) ? list : []) {
      const name = typeof raw === 'string' ? raw : raw && (raw.name || raw.label);
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name.trim());
    }
  }
  return names.slice(0, brandProfile.MAX_COMPETITORS);
}

function buildSaveInput({ researchDraft, run, entry, place, runId, previousResearch, found, bySource = new Map() }) {
  const scope = isObject(researchDraft.scope) ? researchDraft.scope : defaultResearchScope(entry.slug, place);
  const sources = Array.isArray(researchDraft.sources) ? researchDraft.sources : [];
  // Each source keeps the file its page text was saved in, and that file's hash, so the record can be checked against it later.
  const capturedFor = (source) => (isObject(source) ? bySource.get(onboardingEvidence.normUrl(source.url)) : null);
  const preparedSources = sources.map((source) => {
    const scoped = defaultScope(source, entry.slug, place);
    const hit = capturedFor(source);
    return hit ? { ...scoped, captureRef: hit.capture.ref, contentHash: hit.capture.hash } : scoped;
  });
  const evidenceMatrix = Array.isArray(researchDraft.evidenceMatrix) ? researchDraft.evidenceMatrix : [];
  const preparedEvidence = evidenceMatrix.map((item) => defaultScope(item, entry.slug, place));
  const preparedGaps = requiredFalseGaps(researchDraft.gaps);
  const saveInput = {
    expectedRevision: run.researchRevisionAtStart,
    scope,
    sources: preparedSources,
    evidenceMatrix: preparedEvidence,
    freshness: latestObservedAtByKind(preparedSources),
  };
  if (preparedGaps !== undefined) saveInput.gaps = preparedGaps;
  if (found.length) saveInput.competitors = found;
  if (own(researchDraft, 'competitorDetails')) {
    // A competitor's evidence is one of the listed sources, so it carries that source's kind and capture.
    saveInput.competitorDetails = researchDraft.competitorDetails.map((detail) => (isObject(detail) && Array.isArray(detail.evidence)
      ? {
        ...detail,
        evidence: detail.evidence.map((item) => {
          const hit = capturedFor(item);
          return hit ? { ...item, kind: hit.source.kind, provider: hit.source.provider, title: item.title || hit.source.title, captureRef: hit.capture.ref, contentHash: hit.capture.hash } : item;
        }),
      }
      : detail));
  }
  if (own(researchDraft, 'findings')) saveInput.findings = researchDraft.findings;
  if (previousResearch) {
    for (const field of REPLACEABLE_FIELDS) {
      if (own(saveInput, field)) saveInput['replace' + field[0].toUpperCase() + field.slice(1)] = true;
    }
    saveInput.authorizedReason = `Brand onboarding research ${runId}`;
  }
  return saveInput;
}

function needsChanges({ runId, entry, draftPath, needsAudience, problems, parted = null }) {
  const out = {
    status: 'needs_changes',
    runOpen: true,
    runId,
    brand: entry.slug,
    draftPath,
    needsAudience,
    problems,
  };
  // A run in parts: each problem names its part (or the parts it could be), `parts` says how each stands, and `redo` is what to dispatch again, nothing more.
  if (parted && parted.active) {
    out.parts = parted.summary.map((item) => ({ ...item, problems: problems.filter((problem) => problem.part === item.id).length }));
    out.redo = redoOf(problems, parted.plan);
    out.mergedPath = parted.mergedPath;
  }
  return out;
}

/**
 * Save a completed onboarding research draft: fill blank profile fields,
 * write the research record, then close the run as complete. A draft with any
 * problem in its shape or content returns needs_changes with every problem at
 * once, writes nothing and leaves the run open.
 *
 * A run in parts (the workers' part files in the run's parts folder, see brand-research-parts.mjs) is merged into the draft first and the
 * merged draft is checked as one: every rule below holds unchanged, and each problem says which part it came from (`part`, or `candidates`
 * when it could be several), with `redo` listing the parts to dispatch again. A part that is missing or not finished is reported alone, before
 * anything else is checked.
 * @returns {object} the `complete` shape, or the `needs_changes` shape.
 */
export function saveBrandResearch({ root, brand, runId, audienceUnavailable }) {
  const entry = requireOnboardedBrand(root, brand);
  const brandDir = entry.path;

  const run = onboardingRun.read(brandDir, runId);
  if (!run || run.status !== 'running' || run.brand !== entry.slug) {
    throw new UserFacingError('This brand research run is not active for this brand.', { code: 'onboarding_run_not_active' });
  }
  const draftPath = draftPathFor(brandDir, runId);
  // Once a worker has written its part file the draft is the merge of the part files; until then the draft file is saved as it is.
  const parted = collectParts({ brandDir, runId, basePath: draftPath });
  if (parted.active && parted.blocked) {
    return needsChanges({ runId, entry, draftPath, needsAudience: false, problems: parted.problems, parted });
  }
  const read = parted.active ? { value: parted.draft } : readDraft(draftPath);
  const profile = brandProfile.read(brandDir);
  const market = brandProfile.targetMarketOf(profile);
  const place = scopePlace(profile);
  if (read.invalid) {
    return needsChanges({ runId, entry, draftPath, needsAudience: false, problems: [{ field: 'draft', problem: read.invalid }] });
  }
  const draft = read.value;
  const audienceBlank = Array.isArray(run.blankFields) && run.blankFields.includes('audience')
    && Boolean(profile) && brandProfile.blankContextFields(profile).includes('audience');
  // What the run really called, counted from its tool log. Nothing about it is taken from the draft's own budget figures.
  const calls = toolMetrics.summarizeToolEvents(toolMetrics.readToolEvents(onboardingRun.runDir(brandDir, runId)));
  const limits = run.limits && typeof run.limits === 'object' ? run.limits : {};
  const measured = {
    ...calls,
    overBudget: [
      Number.isFinite(limits.totalSearches) && calls.searches > limits.totalSearches ? 'searches' : null,
      Number.isFinite(limits.totalFetches) && calls.fetches > limits.totalFetches ? 'fetches' : null,
    ].filter(Boolean),
  };
  const ownSocial = ['instagram', 'tiktok', 'facebook'].filter((name) => profile && profile.channels && profile.channels[name] && profile.channels[name].status === 'provided').length;
  const checked = draftProblems(draft, {
    root, slug: entry.slug, market, place, audienceBlank, audienceUnavailable: audienceUnavailable === true,
    rawDir: onboardingRun.rawDir(brandDir, runId), now: new Date(), calls, declared: run.declaredCompetitors, ownSocial,
  });
  const { fills, researchDraft, suggested } = checked;
  const problems = [...checked.problems];

  const previousResearch = brandResearch.read(brandDir);
  const actualRevision = previousResearch ? previousResearch.revision : 0;
  if (actualRevision !== run.researchRevisionAtStart) {
    throw new UserFacingError('Brand research is stale: the saved research changed since this run started.', { code: 'stale_research_output' });
  }

  const found = foundCompetitors(fills, researchDraft);
  const fillInput = { ...fills };
  if (found.length) fillInput.competitors = found;
  let saveInput = null;
  const mergeProblems = parted.active ? parted.problems : [];
  if (!checked.shapeCount && !mergeProblems.length) {
    saveInput = buildSaveInput({ researchDraft, run, entry, place, runId, previousResearch, found, bySource: checked.bySource });
    let dryFill = null;
    try {
      dryFill = brandProfile.fillBlankContext(brandDir, fillInput, { runId, now: new Date(), suggested, dryRun: true });
    } catch (error) {
      problems.push({ field: 'fills', problem: error.message });
    }
    if (dryFill) {
      try {
        brandResearch.save(brandDir, saveInput, { now: new Date(), dryRun: true, profile: dryFill.profile });
      } catch (error) {
        problems.push({ field: 'research', problem: error.message });
      }
    }
  }
  if (problems.length || mergeProblems.length) {
    const listed = parted.active ? [...mergeProblems, ...tagProblems(problems, parted.origin, parted.plan)] : problems;
    return needsChanges({ runId, entry, draftPath, needsAudience: checked.needsAudience, problems: listed, parted });
  }

  let fillResult = null;
  let savedResearch = null;
  try {
    fillResult = brandProfile.fillBlankContext(brandDir, fillInput, { runId, now: new Date(), suggested });
    savedResearch = brandResearch.save(brandDir, saveInput, { now: new Date() });
    onboardingRun.close(root, {
      brandDir,
      runId,
      status: 'complete',
      filledFields: fillResult.filled,
      profileRevisionAtEnd: fillResult.profile.revision,
      researchRevision: savedResearch.revision,
      reported: normalizeReported(draft.budget),
      measured,
      reason: null,
      now: new Date(),
    });
  } catch (error) {
    const filledFields = fillResult ? fillResult.filled : [];
    const reason = filledFields.length ? `${error.message} Already filled: ${filledFields.join(', ')}.` : error.message;
    try {
      onboardingRun.close(root, {
        brandDir,
        runId,
        status: 'failed',
        filledFields,
        profileRevisionAtEnd: fillResult ? fillResult.profile.revision : null,
        researchRevision: null,
        reported: normalizeReported(draft.budget),
        measured,
        reason,
        now: new Date(),
      });
    } catch { /* the original failure is what must reach the caller */ }
    releaseBrowser(root, entry.slug);
    raiseRefreshFailure(root, entry.slug, error.message);
    throw new UserFacingError(reason, { code: 'brand_research_save_failed' });
  }
  releaseBrowser(root, entry.slug);
  clearRefreshQuestions(root, entry.slug);
  runtime.writeBrandVoice({ root, brand: entry.slug });
  const filed = fileResults({ root, entry, brandDir, runId, savedResearch, checked });

  return {
    status: 'complete',
    runId,
    brand: entry.slug,
    brandId: entry.id,
    filled: fillResult.filled,
    kept: fillResult.kept,
    suggested: fillResult.filled.filter((name) => suggested.includes(name)),
    profileRevision: fillResult.profile.revision,
    researchRevision: savedResearch.revision,
    competitors: savedResearch.competitors,
    competitorSource: savedResearch.competitorSource,
    competitorsAdded: fillResult.added,
    audienceMissing: brandProfile.blankContextFields(fillResult.profile).includes('audience'),
    sourceCount: savedResearch.sources.length,
    gapCount: savedResearch.gaps.length,
    current: savedResearch.current,
    toolCalls: { recorded: calls.recorded, total: calls.total, failed: calls.failed, searches: calls.searches, fetches: calls.fetches, overBudget: measured.overBudget },
    ...(parted.active ? { parts: parted.summary.map(({ id, status }) => ({ id, status })) } : {}),
    ...filed,
  };
}

/**
 * Everything a saved run leaves behind besides the profile and the research record: the audience, positioning and platform files,
 * the library entry for the next job, and the top posts in the proven bank. The research is already saved, so a failure here
 * never fails the save; it comes back as a warning in plain words.
 */
function fileResults({ root, entry, brandDir, runId, savedResearch, checked }) {
  const warnings = [];
  const out = {};
  const now = new Date();
  try {
    const written = brandFiles.write(brandDir, { data: checked.brandFiles, runId, now, videos: checked.topPosts.filter((item) => item.breakdown) });
    out.brandFiles = {
      audience: written.files.audience.status,
      positioning: written.files.positioning.status,
      platformPlaybook: written.files['platform-playbook'].status,
      proofPoints: written.proofPoints,
      customerPhrases: written.phrases,
      enoughForJobs: written.evidenceBearing,
    };
  } catch (error) {
    warnings.push(`The audience, positioning and platform files could not be written: ${error.message}`);
  }
  try {
    const profile = brandProfile.read(brandDir) || {};
    out.library = fileOnboardingResearch({ root, brand: entry.slug, brandDir, name: entry.name, runId, record: savedResearch, profile, posts: checked.topPosts, now });
  } catch (error) {
    warnings.push(`The research could not be filed in the brand library: ${error.message}`);
  }
  try {
    out.topPosts = fileTopPosts({ root, brand: entry.slug, posts: checked.topPosts, now });
  } catch (error) {
    warnings.push(`The top posts could not be saved to the brand library: ${error.message}`);
  }
  // The brand intelligence: every video taken apart, labelled, in the brand's own store, and the viral ones as trends (brand-intelligence.mjs).
  try {
    out.intelligence = fileIntelligence({ root, brand: entry.slug, posts: checked.topPosts, runId, now });
  } catch (error) {
    warnings.push(`The brand intelligence could not be saved: ${error.message}`);
  }
  try {
    const filed = fileBanks({ root, brand: entry.slug, banks: checked.banks, now });
    if (filed.saved || filed.merged || filed.existing || filed.skipped) out.banks = filed;
  } catch (error) {
    warnings.push(`The pain points, angles, captions and calls to action could not be saved to the brand library: ${error.message}`);
  }
  if (warnings.length) out.warnings = warnings;
  return out;
}

function normalizeReported(budget) {
  if (!budget || typeof budget !== 'object') return { searches: null, fetches: null, stopReason: null };
  return {
    searches: Number.isFinite(budget.searches) ? budget.searches : null,
    fetches: Number.isFinite(budget.fetches) ? budget.fetches : null,
    stopReason: budget.stopReason || null,
  };
}

/**
 * Close a brand research run as failed or abandoned, without saving its draft.
 */
export function closeBrandResearch({ root, brand, runId, status, reason }) {
  if (status !== 'failed' && status !== 'abandoned') {
    throw new UserFacingError('Brand research can only be closed as failed or abandoned.', { code: 'invalid_input' });
  }
  const entry = resolveBrand(root, brand);
  const wasOpen = onboardingRun.read(entry.path, runId)?.status === 'running';
  // Only status, reason and completion time change; whatever the run already recorded
  // (filled fields, revisions, budget) is left as it was when it stopped.
  try {
    onboardingRun.close(root, {
      brandDir: entry.path,
      runId,
      status,
      reason: reason || null,
      now: new Date(),
    });
  } catch (error) {
    if (error && error.code === 'ONBOARDING_RUN_NOT_FOUND') {
      throw new UserFacingError('This brand research run could not be found.', { code: 'onboarding_run_not_found' });
    }
    throw error;
  }
  releaseBrowser(root, entry.slug);
  if (wasOpen) raiseRefreshFailure(root, entry.slug, reason);
  return { runId, brand: entry.slug, status };
}
