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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserFacingError } from '../lib/errors.mjs';
import * as runtime from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = join(HERE, '..', '..', 'pipeline');

const require = createRequire(import.meta.url);
const brandProfile = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-profile.js'));
const brandResearch = require(join(PIPELINE_ROOT, 'scripts', 'lib-brand-research.js'));
const researchBudgets = require(join(PIPELINE_ROOT, 'scripts', 'lib-research-budget.js'));
const onboardingRun = require(join(PIPELINE_ROOT, 'scripts', 'lib-onboarding-run.js'));
const durable = require(join(PIPELINE_ROOT, 'scripts', 'lib-durable.js'));

const MAX_SOURCES = 12;
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

function blanksAndCompetitors(profile) {
  const blankFields = brandProfile.blankContextFields(profile);
  const items = profile.competitors && Array.isArray(profile.competitors.items) ? profile.competitors.items : [];
  const declared = items.slice(0, brandProfile.MAX_COMPETITORS);
  return { blankFields, declared, toFind: brandProfile.MAX_COMPETITORS - declared.length };
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
    budget: { searches: 0, fetches: 0, stopReason: '' },
  };
}

function ensureDraftSkeleton(draftPath, runId, blankFields, toFind) {
  if (existsSync(draftPath)) return;
  durable.atomicWrite(draftPath, JSON.stringify(draftSkeleton(runId, blankFields, toFind), null, 2) + '\n');
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
  const existingResearch = brandResearch.read(brandDir);
  const researchRevision = existingResearch ? existingResearch.revision : 0;

  if (!blankFields.length && existingResearch && existingResearch.current) {
    onboardingRun.clearPending(brandDir);
    return {
      status: 'skipped',
      brand: entry.slug,
      brandId: entry.id,
      reason: 'Every context field is filled and the saved research is current.',
      researchRevision,
    };
  }

  const limits = { ...researchBudgets.HARD_LIMITS, totalSearches: 12, totalFetches: 12, turns: 25 };
  const workspaceId = runtime.readWorkspace({ root }).workspaceId;
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
      market: brandProfile.targetMarketOf(profile),
      now: new Date(),
    });
  } catch (error) {
    if (error && error.code === 'ONBOARDING_RUN_ACTIVE') {
      throw new UserFacingError(
        `Brand research is already running for "${error.brand}". Finish or close that run before starting a new one.`,
        { code: 'onboarding_run_active', details: { runId: error.runId, brand: error.brand } },
      );
    }
    throw error;
  }

  const run = started.run;
  const declaredCompetitors = Array.isArray(run.declaredCompetitors) ? run.declaredCompetitors : declared;
  const draftPath = draftPathFor(brandDir, run.runId);
  const toFind = brandProfile.MAX_COMPETITORS - declaredCompetitors.length;
  const alsoFill = brandProfile.blankResearchFields(profile).filter((name) => EXTRA_FILLS.includes(name));
  ensureDraftSkeleton(draftPath, run.runId, [...(run.blankFields || blankFields), ...alsoFill], toFind);
  return {
    status: started.created ? 'started' : 'already_running',
    runId: run.runId,
    brand: entry.slug,
    brandId: entry.id,
    market: run.market || brandProfile.targetMarketOf(profile),
    blankFields: run.blankFields || blankFields,
    alsoFill,
    competitors: { declared: declaredCompetitors, toFind },
    limits: run.limits || limits,
    draftPath,
    profileRevision: run.profileRevisionAtStart ?? profile.revision,
    researchRevision: run.researchRevisionAtStart ?? researchRevision,
  };
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
  return { market, geography: named ? market : 'SG' };
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
    const kind = source.kind || 'brand_identity';
    const parsed = Date.parse(source.observedAt);
    if (!Number.isFinite(parsed)) continue;
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
const CONTENT_PILLARS_MIN = brandProfile.CONTENT_PILLAR_MIN;
const CONTENT_PILLARS_MAX = brandProfile.CONTENT_PILLAR_MAX;
const CONTENT_PILLAR_ITEM_MAX = brandProfile.CONTENT_PILLAR_ITEM_MAX;
const DRAFT_KEYS = Object.freeze(['version', 'runId', 'fills', 'suggested', 'research', 'budget']);
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

function researchProblems(researchDraft, slug, place, problems) {
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
  if (!listsOk) return;

  const sources = Array.isArray(researchDraft.sources) ? researchDraft.sources : [];
  if (!sources.length) problems.push({ field: 'research.sources', problem: 'Add at least one dated source the research used.' });
  if (sources.length > MAX_SOURCES) problems.push({ field: 'research.sources', problem: 'Brand research saves at most 12 sources.' });
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
  const preparedSources = sources.filter(isObject).map((source) => {
    const scoped = defaultScope(source, slug, place);
    return { ...scoped, kind: scoped.kind || 'brand_identity' };
  });
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
}

function audienceProblemText(market) {
  return `The audience is blank. Add the brand's own audience, or suggest one from the top competitors' audiences in ${market} using sources from the last 12 months and list audience under suggested.`;
}

function draftProblems(draft, ctx) {
  const problems = [];
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.includes(key)) {
      problems.push({ field: key, problem: `"${key}" is not a draft field. Use ${DRAFT_KEYS.join(', ')}.` });
    }
  }
  const fills = own(draft, 'fills') ? draft.fills : {};
  const researchDraft = own(draft, 'research') ? draft.research : {};
  if (!isObject(fills)) problems.push({ field: 'fills', problem: 'fills must be an object.' });
  if (!isObject(researchDraft)) problems.push({ field: 'research', problem: 'research must be an object.' });
  if (own(draft, 'budget') && !isObject(draft.budget)) problems.push({ field: 'budget', problem: 'budget must be an object.' });
  const safeFills = isObject(fills) ? fills : {};
  if (isObject(fills)) fillProblems(fills, problems);
  const named = suggestedProblems(draft.suggested, safeFills, problems);
  // A filled forbiddenClaims or examples always reads as a suggestion until the person has checked it.
  const suggested = [...new Set([...named, ...EXTRA_FILLS.filter((name) => filled(safeFills[name]))])];
  if (isObject(researchDraft)) researchProblems(researchDraft, ctx.slug, ctx.place, problems);
  const shapeCount = problems.length;
  let needsAudience = false;
  if (ctx.audienceBlank && !filled(safeFills.audience) && !ctx.audienceUnavailable) {
    needsAudience = true;
    problems.push({ field: 'fills.audience', problem: audienceProblemText(ctx.market) });
  }
  return { problems, shapeCount, suggested, needsAudience, fills: safeFills, researchDraft: isObject(researchDraft) ? researchDraft : {} };
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

function buildSaveInput({ researchDraft, run, entry, place, runId, previousResearch, found }) {
  const scope = isObject(researchDraft.scope) ? researchDraft.scope : defaultResearchScope(entry.slug, place);
  const sources = Array.isArray(researchDraft.sources) ? researchDraft.sources : [];
  const preparedSources = sources.map((source) => {
    const scoped = defaultScope(source, entry.slug, place);
    return { ...scoped, kind: scoped.kind || 'brand_identity' };
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
  if (own(researchDraft, 'competitorDetails')) saveInput.competitorDetails = researchDraft.competitorDetails;
  if (own(researchDraft, 'findings')) saveInput.findings = researchDraft.findings;
  if (previousResearch) {
    for (const field of REPLACEABLE_FIELDS) {
      if (own(saveInput, field)) saveInput['replace' + field[0].toUpperCase() + field.slice(1)] = true;
    }
    saveInput.authorizedReason = `Brand onboarding research ${runId}`;
  }
  return saveInput;
}

function needsChanges({ runId, entry, draftPath, needsAudience, problems }) {
  return {
    status: 'needs_changes',
    runOpen: true,
    runId,
    brand: entry.slug,
    draftPath,
    needsAudience,
    problems,
  };
}

/**
 * Save a completed onboarding research draft: fill blank profile fields,
 * write the research record, then close the run as complete. A draft with any
 * problem in its shape or content returns needs_changes with every problem at
 * once, writes nothing and leaves the run open.
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
  const read = readDraft(draftPath);
  const profile = brandProfile.read(brandDir);
  const market = brandProfile.targetMarketOf(profile);
  const place = scopePlace(profile);
  if (read.invalid) {
    return needsChanges({ runId, entry, draftPath, needsAudience: false, problems: [{ field: 'draft', problem: read.invalid }] });
  }
  const draft = read.value;
  const audienceBlank = Array.isArray(run.blankFields) && run.blankFields.includes('audience')
    && Boolean(profile) && brandProfile.blankContextFields(profile).includes('audience');
  const checked = draftProblems(draft, { slug: entry.slug, market, place, audienceBlank, audienceUnavailable: audienceUnavailable === true });
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
  if (!checked.shapeCount) {
    saveInput = buildSaveInput({ researchDraft, run, entry, place, runId, previousResearch, found });
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
  if (problems.length) {
    return needsChanges({ runId, entry, draftPath, needsAudience: checked.needsAudience, problems });
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
        reason,
        now: new Date(),
      });
    } catch { /* the original failure is what must reach the caller */ }
    throw new UserFacingError(reason, { code: 'brand_research_save_failed' });
  }
  runtime.writeBrandVoice({ root, brand: entry.slug });

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
  };
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
  return { runId, brand: entry.slug, status };
}
