/**
 * The one onboarding research pass for a brand.
 *
 * A brand onboarding research run fills only the blank declared-profile
 * fields and tops up a shortlist of competitors, scoped to Singapore. It
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
      market: 'SG',
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
  return {
    status: started.created ? 'started' : 'already_running',
    runId: run.runId,
    brand: entry.slug,
    brandId: entry.id,
    market: run.market || 'SG',
    blankFields: run.blankFields || blankFields,
    competitors: { declared: declaredCompetitors, toFind: brandProfile.MAX_COMPETITORS - declaredCompetitors.length },
    limits: run.limits || limits,
    draftPath: draftPathFor(brandDir, run.runId),
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
    throw new UserFacingError('The research draft is not valid JSON.', { code: 'research_draft_invalid' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UserFacingError('The research draft must be a JSON object.', { code: 'research_draft_invalid' });
  }
  return parsed;
}

function defaultScope(item, slug) {
  if (item && typeof item === 'object' && item.scope) return item;
  return { ...item, scope: { brand: slug, market: 'Singapore', geography: 'SG' }, applicableDimensions: (item && item.applicableDimensions) || ['brand'] };
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

// Board context fields hold brand-facing content, never evidence notes. A fill that leaks a
// citation, a fetch date, or run commentary is rejected here, before anything is written, so
// the session can rewrite the draft and call save again without losing the run.
const FILL_TEXT_LIMITS = Object.freeze({ audience: 400, market: 400, voice: 300 });
const SUGGESTIBLE_FIELDS = Object.freeze(['audience']);
const CONTENT_PILLARS_MIN = 1;
const CONTENT_PILLARS_MAX = 5;
const FILL_BANNED_PATTERNS = Object.freeze([
  { test: /http/i, rule: 'must not contain a URL ("http")' },
  { test: /www\./i, rule: 'must not contain a URL ("www.")' },
  { test: /\b[a-z0-9-]+\.(com|sg|net|org|co)(\.[a-z]{2})?\b/i, rule: 'must not contain a domain name' },
  { test: /\b\d{4}-\d{2}-\d{2}\b/, rule: 'must not contain a date' },
  { test: /\bfetched\b/i, rule: 'must not contain the word "fetched"' },
  { test: /\bverbatim\b/i, rule: 'must not contain the word "verbatim"' },
]);

function checkFillText(field, text, errors) {
  for (const { test, rule } of FILL_BANNED_PATTERNS) {
    if (test.test(text)) errors.push(`${field} ${rule}.`);
  }
}

/**
 * Reject a research draft's profile fills before anything is written. Evidence notes,
 * citations, fetch dates and run commentary belong in research.sources, research.evidenceMatrix
 * and research.findings, never in a board context field. Every violation is collected and names
 * its field and rule so the session can rewrite the draft in one pass.
 */
function validateFillContent(fills) {
  const errors = [];
  for (const field of ['audience', 'market', 'voice']) {
    if (!own(fills, field)) continue;
    const value = fills[field];
    if (typeof value !== 'string') continue;
    checkFillText(field, value, errors);
    const max = FILL_TEXT_LIMITS[field];
    if (value.length > max) errors.push(`${field} must be at most ${max} characters (has ${value.length}).`);
  }
  if (own(fills, 'contentPillars')) {
    const pillars = Array.isArray(fills.contentPillars) ? fills.contentPillars : [];
    if (pillars.length < CONTENT_PILLARS_MIN || pillars.length > CONTENT_PILLARS_MAX) {
      errors.push(`contentPillars must list ${CONTENT_PILLARS_MIN} to ${CONTENT_PILLARS_MAX} items (has ${pillars.length}).`);
    }
    for (const pillar of pillars) {
      if (typeof pillar === 'string') checkFillText('contentPillars', pillar, errors);
    }
  }
  if (own(fills, 'competitors')) {
    const competitors = Array.isArray(fills.competitors) ? fills.competitors : [];
    for (const competitor of competitors) {
      if (typeof competitor === 'string') checkFillText('competitors', competitor, errors);
    }
  }
  if (errors.length) {
    throw new UserFacingError(`Brand research draft has invalid fills: ${[...new Set(errors)].join(' ')}`, { code: 'invalid_input' });
  }
}

function readSuggested(value, fills) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new UserFacingError('Brand research draft suggested must be a list of field names.', { code: 'invalid_input' });
  }
  const names = [...new Set(value)];
  if (names.some((name) => !SUGGESTIBLE_FIELDS.includes(name))) {
    throw new UserFacingError('Brand research draft: only the audience can be marked as a suggestion.', { code: 'invalid_input' });
  }
  for (const name of names) {
    if (typeof fills[name] !== 'string' || !fills[name].trim()) {
      throw new UserFacingError(`Brand research draft marks the ${name} as a suggestion but has no ${name} fill.`, { code: 'invalid_input' });
    }
  }
  return names;
}

/**
 * Save a completed onboarding research draft: fill blank profile fields,
 * write the research record, then close the run as complete.
 * @returns {object} the section 1 `complete` shape.
 */
export function saveBrandResearch({ root, brand, runId }) {
  const entry = requireOnboardedBrand(root, brand);
  const brandDir = entry.path;

  // a. The run exists, is running and belongs to this brand; read the draft.
  const run = onboardingRun.read(brandDir, runId);
  if (!run || run.status !== 'running' || run.brand !== entry.slug) {
    throw new UserFacingError('This brand research run is not active for this brand.', { code: 'onboarding_run_not_active' });
  }
  const draft = readDraft(draftPathFor(brandDir, runId));
  const draftFills = draft.fills && typeof draft.fills === 'object' ? draft.fills : {};
  const researchDraft = draft.research && typeof draft.research === 'object' ? draft.research : {};

  // b. Limits.
  for (const key of Object.keys(draftFills)) {
    if (!brandProfile.CONTEXT_FIELDS.includes(key)) {
      throw new UserFacingError(`Brand research cannot fill "${key}".`, { code: 'invalid_input' });
    }
  }
  const fills = draftFills;
  const suggested = readSuggested(draft.suggested, fills);
  validateFillContent(fills);
  const fillsCompetitors = Array.isArray(fills.competitors) ? fills.competitors : [];
  const researchCompetitors = Array.isArray(researchDraft.competitors) ? researchDraft.competitors : [];
  const competitorDetails = Array.isArray(researchDraft.competitorDetails) ? researchDraft.competitorDetails : [];
  if (fillsCompetitors.length > brandProfile.MAX_COMPETITORS
    || researchCompetitors.length > brandProfile.MAX_COMPETITORS
    || competitorDetails.length > brandProfile.MAX_COMPETITORS) {
    throw new UserFacingError('Brand research saves at most 3 competitors.', { code: 'invalid_input' });
  }
  for (const detail of competitorDetails) {
    if (Array.isArray(detail && detail.evidence) && detail.evidence.length > MAX_EVIDENCE_PER_COMPETITOR) {
      throw new UserFacingError('Brand research saves at most 3 evidence items per competitor.', { code: 'invalid_input' });
    }
  }
  const sources = Array.isArray(researchDraft.sources) ? researchDraft.sources : [];
  if (sources.length > MAX_SOURCES) {
    throw new UserFacingError('Brand research saves at most 12 sources.', { code: 'invalid_input' });
  }
  const boundary = brandResearch.createCapabilityBoundary({});
  for (const source of sources) boundary.fetch(source && source.url, 'Source');

  // c. Build the research.save input.
  const scope = researchDraft.scope && typeof researchDraft.scope === 'object'
    ? researchDraft.scope
    : { brand: entry.slug, market: 'Singapore', geography: 'SG', label: 'Brand onboarding research' };
  const preparedSources = sources.map((source) => {
    const scoped = defaultScope(source, entry.slug);
    return { ...scoped, kind: scoped.kind || 'brand_identity' };
  });
  const evidenceMatrix = Array.isArray(researchDraft.evidenceMatrix) ? researchDraft.evidenceMatrix : [];
  const preparedEvidence = evidenceMatrix.map((item) => defaultScope(item, entry.slug));
  const preparedGaps = requiredFalseGaps(researchDraft.gaps);

  const previousResearch = brandResearch.read(brandDir);

  const saveInput = {
    expectedRevision: run.researchRevisionAtStart,
    scope,
    sources: preparedSources,
    evidenceMatrix: preparedEvidence,
    freshness: latestObservedAtByKind(preparedSources),
  };
  if (preparedGaps !== undefined) saveInput.gaps = preparedGaps;
  if (own(researchDraft, 'competitors')) saveInput.competitors = researchCompetitors;
  if (own(researchDraft, 'competitorDetails')) saveInput.competitorDetails = competitorDetails;
  if (own(researchDraft, 'findings')) saveInput.findings = researchDraft.findings;
  if (previousResearch) {
    for (const field of REPLACEABLE_FIELDS) {
      if (own(saveInput, field)) saveInput['replace' + field[0].toUpperCase() + field.slice(1)] = true;
    }
    saveInput.authorizedReason = `Brand onboarding research ${runId}`;
  }

  // d. Pre-validate with the exported normalizers and the expected revision. Nothing is written yet.
  try {
    brandResearch.normalizeScope(scope);
    brandResearch.normalizeSources(preparedSources);
    brandResearch.normalizeEvidenceMatrix(preparedEvidence);
    if (saveInput.competitors !== undefined) brandResearch.normalizeCompetitors(saveInput.competitors);
    if (saveInput.competitorDetails !== undefined) brandResearch.normalizeCompetitorDetails(saveInput.competitorDetails);
    if (saveInput.gaps !== undefined) brandResearch.normalizeGaps(saveInput.gaps);
  } catch (error) {
    throw new UserFacingError(error.message, { code: 'invalid_input' });
  }
  const actualRevision = previousResearch ? previousResearch.revision : 0;
  if (actualRevision !== run.researchRevisionAtStart) {
    throw new UserFacingError('Brand research is stale: the saved research changed since this run started.', { code: 'stale_research_output' });
  }

  // e, f, g. Fill the profile, then save the research, then close the run.
  // Any failure past this point closes the run as failed instead of leaving it active.
  let fillResult = null;
  let savedResearch = null;
  try {
    fillResult = brandProfile.fillBlankContext(brandDir, fills, { runId, now: new Date(), suggested });
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
