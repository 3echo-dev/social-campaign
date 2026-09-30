/**
 * The Job Planner, as a pure function.
 *
 * buildJobPlan turns an intake answer into a JobExecutionPlan: the minimum pipeline
 * this particular job needs, with every stage marked required, completed, skipped,
 * not_applicable or waiting.
 *
 * Four properties matter here and are tested:
 *
 *   1. It is pure. Same inputs, same plan, no clock, no database, no network.
 *   2. A route is a composition of stage ids from registry/routes.json, hydrated
 *      from the single stage table in server/planner/stages.mjs. Neither file
 *      repeats what a stage needs, owns or produces.
 *   3. Every route is a valid dependency graph: each stage's declared inputs are
 *      produced by an earlier stage in that route or handed over by intake, and the
 *      route ends on a stage a route may legitimately end on. A job type and
 *      starting point with no sensible route is refused in plain words instead of
 *      being bent into one.
 *   4. It surfaces only real blockers (spec 28). A capability nobody needs is never
 *      mentioned, and a missing optional provider never blocks analysis only work.
 *      Only not_connected or unavailable holds a stage back, and only the stage that
 *      needs it; a degraded capability runs with a warning instead (spec 36).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeProblems, stageDefinition, stageOwner } from './stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The route table, read once. Each route is a list of stage ids. */
export const ROUTES = JSON.parse(readFileSync(join(HERE, '..', '..', 'registry', 'routes.json'), 'utf8'));

/** The job types a plan can be built for, spec section 6. */
export const JOB_TYPES = ['social_post', 'ad_campaign', 'ugc', 'analyze_existing'];

/** The starting points, spec section 7. */
export const STARTING_POINTS = ['scratch', 'reference', 'existing_creative'];

/** The platforms in V1 scope, spec section 10. */
export const PLATFORMS = ['facebook', 'instagram', 'tiktok'];

/** Capability states that never hold a stage back. */
const FINE_STATES = new Set(['ready', 'not_needed']);

/**
 * A degraded capability works with reduced coverage or confidence (spec section 36).
 * Its stage still runs, and the plan carries a warning instead of a blocker.
 */
const DEGRADED = 'degraded';

/**
 * How a user would name each family of capabilities, and which connection clears it.
 * `provider` is null when there is nothing to sign in to: social and ad research,
 * transcripts and the local video tools are measured, not connected.
 * `fallback` is set for a family the job can finish without: publishing falls back to a
 * package the user posts by hand (spec 32 and 36), so a missing publisher is a note
 * with an optional connect action, never a blocker.
 * @type {Array<{pattern: RegExp, provider: string|null, label: string, plural: boolean, degraded: string, fallback?: string}>}
 */
const CAPABILITY_FAMILIES = [
  {
    pattern: /^generation\.(image|video)$/,
    provider: 'threeecho_studio',
    label: 'image and video generation',
    plural: false,
    degraded: 'Image and video generation had a problem on its last try, so each result will be checked before you see it.',
  },
  {
    pattern: /^generation\.(voice|audio)$/,
    provider: 'elevenlabs',
    label: 'voice and audio',
    plural: false,
    degraded: 'Voice and audio had a problem on its last try, so each result will be checked before you see it.',
  },
  {
    pattern: /^publishing\./,
    provider: 'publisher',
    label: 'publishing',
    plural: false,
    degraded: 'Publishing had a problem on its last try, so the finished posts are also saved as a package you can post by hand.',
    fallback:
      'No publishing service is connected, so the finished posts will be saved as a ready to post package you can upload yourself. Connect one if you want them scheduled for you.',
  },
  {
    pattern: /^ads\./,
    provider: null,
    label: 'ad research',
    plural: false,
    degraded:
      'Ad research runs with reduced coverage: the public ad libraries rarely open to an automated reader, so ads are gathered from web search and pages you open, and every finding says where it came from and how sure it is.',
  },
  {
    pattern: /^social\./,
    provider: null,
    label: 'social research',
    plural: false,
    degraded:
      'Social research runs with reduced coverage: some platforms show little to a signed out reader, so those findings come from web search, and every finding says where it came from and how sure it is.',
  },
  {
    pattern: /^web\./,
    provider: null,
    label: 'web research',
    plural: false,
    degraded: 'Web research runs with reduced coverage, so every finding says where it came from and how sure it is.',
  },
  {
    pattern: /^media\.transcribe$/,
    provider: null,
    label: 'transcripts',
    plural: true,
    degraded: 'Transcripts come from platform captions, so a video without captions is judged from its pictures alone.',
  },
  {
    pattern: /^(media\.|generation\.(subtitle|remotion)$)/,
    provider: null,
    label: 'the video tools',
    plural: true,
    degraded: 'Some video tools are missing on this computer, so a few video steps will do less than usual.',
  },
];

/**
 * The family a capability belongs to, or null for one with no user facing family.
 * @param {string} capability
 * @returns {{provider: string|null, label: string, plural: boolean, degraded: string, fallback: string|null}|null}
 */
export function capabilityFamily(capability) {
  const found = CAPABILITY_FAMILIES.find((family) => family.pattern.test(capability));
  return found
    ? { provider: found.provider, label: found.label, plural: found.plural, degraded: found.degraded, fallback: found.fallback ?? null }
    : null;
}

/**
 * Whether a capability in this state still lets its stage run: ready, not needed,
 * degraded, or missing with a fallback the job can finish on.
 * @param {string} capability
 * @param {string} state
 * @returns {boolean}
 */
function runsAnyway(capability, state) {
  if (FINE_STATES.has(state) || state === DEGRADED) return true;
  return Boolean(capabilityFamily(capability)?.fallback);
}

/** Stages that only read supplied creative, used by the "point at it first" rule. */
const ANALYSIS_STAGE =
  /(analysis|analyst|analyze|decomposition|reference_resolution|media_librarian|suitability|probe)/;

/**
 * @typedef {'required'|'completed'|'skipped'|'not_applicable'|'waiting'} StageStatus
 */

/**
 * @typedef {object} PlannedStage
 * @property {string} stage
 * @property {StageStatus} status
 * @property {number} order
 * @property {string|null} reason
 * @property {string|null} owner_agent
 * @property {'strategy'|'concept'|'cost'|'media'|'final'|null} gate
 */

/**
 * The plain reason a job type and starting point has no route. There is exactly one
 * today: there is nothing to analyze when a job starts from scratch.
 * @type {Record<string, string>}
 */
const NO_ROUTE_REASON = {
  'analyze_existing+scratch':
    'Analyzing existing content needs something to look at. Point this job at a reference or at creative you already have, or pick a different kind of job.',
};

/**
 * Pick the route for this job type and starting point. Exactly one route is declared
 * per supported pair, so there is no fallback chain to reason about any more.
 * @param {string} jobType
 * @param {string} startingPoint
 * @returns {{route_id: string, job_type: string, starting_point: string, stages: string[]}|null}
 */
export function selectRoute(jobType, startingPoint) {
  return ROUTES.find((route) => route.job_type === jobType && route.starting_point === startingPoint) ?? null;
}

/**
 * Compose a route into the ordered stage definitions this job will consider, or
 * refuse in plain words.
 *
 * The composition is checked rather than trusted: a route whose stages ask for
 * something no earlier stage produces, or which ends somewhere a job cannot
 * sensibly stop, is a bug in registry/routes.json and is refused here rather than
 * handed to a person as a plan.
 * @param {string} jobType
 * @param {string} startingPoint
 * @returns {{ok: true, route_id: string, stages: import('./stages.mjs').StageDefinition[]}|{ok: false, reason: string}}
 */
export function composeRoute(jobType, startingPoint) {
  const route = selectRoute(jobType, startingPoint);
  if (!route) {
    return {
      ok: false,
      reason:
        NO_ROUTE_REASON[`${jobType}+${startingPoint}`] ??
        'Social Campaign does not have a way to run this kind of job from this starting point yet.',
    };
  }
  const ids = route.stages.map(String);
  const problems = routeProblems(ids);
  if (problems.length > 0) {
    return { ok: false, reason: `This job's steps do not fit together: ${problems[0]}` };
  }
  return { ok: true, route_id: route.route_id, stages: ids.map((id) => stageDefinition(id)) };
}

/**
 * The plain sentence a user sees for a capability that is not ready.
 * @param {string} capability
 * @param {string} state
 * @returns {{provider: string|null, action: string}}
 */
export function blockerAction(capability, state) {
  const family = capabilityFamily(capability);
  const provider = family ? family.provider : null;
  const label = family ? family.label : 'this part of the job';
  const verb = family && family.plural ? 'are' : 'is';
  if (state === DEGRADED) {
    return { provider, action: family ? family.degraded : 'This part of the job is working with reduced coverage.' };
  }
  if (family?.fallback) {
    return { provider, action: family.fallback };
  }
  if (state === 'unavailable') {
    return { provider, action: `${capitalize(label)} ${verb} not available on this computer yet.` };
  }
  if (!provider) {
    return { provider, action: `${capitalize(label)} ${verb} not ready yet.` };
  }
  return { provider, action: `Connect ${label} to continue this job.` };
}

/**
 * Name the missing capabilities the way a user would, never as capability names.
 * @param {string[]} names
 * @returns {string}
 */
function friendlyList(names) {
  const labels = [];
  for (const name of names) {
    const family = capabilityFamily(name);
    const label = family ? family.label : name.split('.').slice(-1)[0].replace(/_/g, ' ');
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length <= 1) return labels[0] ?? 'something else';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function capitalize(value) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Was this stage explicitly asked for, despite a rule that would drop it?
 * @param {string} stage
 * @param {Record<string, unknown>} preferences
 * @returns {boolean}
 */
function wasRequested(stage, preferences) {
  const requested = Array.isArray(preferences.requested_stages) ? preferences.requested_stages : [];
  return requested.map(String).includes(stage);
}

/**
 * Build the plan.
 *
 * @param {object} input
 * @param {string} input.job_type social_post, ad_campaign, ugc or analyze_existing.
 * @param {string} input.starting_point scratch, reference or existing_creative.
 * @param {string[]} [input.platforms] facebook, instagram, tiktok.
 * @param {{id?: string|null, brand_id?: string|null, name?: string}|null} [input.brand]
 * @param {Record<string, unknown>|null} [input.creative_memory]
 * @param {Record<string, unknown>|null} [input.preferences]
 * @param {{kind?: string, url?: string|null, asset_id?: string|null}|null} [input.reference]
 * @param {Array<string|{path?: string, asset_id?: string, kind?: string}>} [input.existing_assets]
 * @param {Record<string, string>} [input.capabilities] capability name to state.
 * @param {string[]} [input.completed_stages]
 * @returns {object} a JobExecutionPlan
 */
export function buildJobPlan(input) {
  const jobType = JOB_TYPES.includes(String(input.job_type)) ? String(input.job_type) : 'social_post';
  const startingPoint = STARTING_POINTS.includes(String(input.starting_point))
    ? String(input.starting_point)
    : 'scratch';
  const platforms = normalizePlatforms(input.platforms);
  const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : {};
  const capabilities = input.capabilities && typeof input.capabilities === 'object' ? input.capabilities : {};
  const completed = new Set((Array.isArray(input.completed_stages) ? input.completed_stages : []).map(String));
  const reference = normalizeReference(input.reference);
  const existingAssets = Array.isArray(input.existing_assets) ? input.existing_assets : [];
  const brandId = input.brand && typeof input.brand === 'object' ? (input.brand.id ?? input.brand.brand_id ?? null) : null;

  const composed = composeRoute(jobType, startingPoint);
  if (!composed.ok) {
    // No route, so no plan: the person gets the reason, not an invented pipeline.
    return {
      schema_version: 1,
      campaign_id: null,
      brand_id: brandId ? String(brandId) : null,
      job_type: jobType,
      starting_point: startingPoint,
      platforms,
      stages: [],
      required_capabilities: [],
      blockers: [],
      warnings: [],
      reference,
      refusal: { reason: composed.reason },
      summary: composed.reason,
    };
  }
  const routeId = composed.route_id;
  const raw = composed.stages;

  /** @type {PlannedStage[]} */
  const planned = raw.map((definition, index) => {
    const { owner_agent: owner, gate } = stageOwner(definition.id);
    const decided = decideStatus({
      stage: definition.id,
      preferences,
      completed,
      startingPoint,
      reference,
      existingAssets,
    });
    return {
      stage: definition.id,
      status: decided.status,
      order: index,
      reason: decided.reason,
      owner_agent: owner,
      gate,
    };
  });

  // A stage that is going to run but depends on a capability that is not connected
  // or not available is waiting, not required, and the missing capability is named
  // (spec 28). Only that stage waits; the rest of the job carries on. A degraded
  // capability holds nothing back: its stage runs, and the plan warns that its
  // findings come with reduced coverage and say how sure they are (spec 36).
  /** @type {Map<string, string>} */
  const needed = new Map();
  /** @type {Map<string, string[]>} */
  const degradedStages = new Map();
  for (const [index, stage] of planned.entries()) {
    if (stage.status !== 'required') continue;
    const states = raw[index].capabilities.map((name) => [name, capabilities[name] ?? 'ready']);
    for (const [name, state] of states) needed.set(name, state);
    const missing = states.filter(([name, state]) => !runsAnyway(name, state)).map(([name]) => name);
    const reduced = states.filter(([, state]) => state === DEGRADED).map(([name]) => name);
    const fallback = states.filter(([name, state]) => !FINE_STATES.has(state) && state !== DEGRADED && runsAnyway(name, state)).map(([name]) => name);
    for (const name of [...reduced, ...fallback]) degradedStages.set(name, [...(degradedStages.get(name) ?? []), stage.stage]);
    if (missing.length > 0) {
      stage.status = 'waiting';
      stage.reason = `Waiting for ${friendlyList(missing)} to be ready.`;
    } else if (fallback.length > 0) {
      stage.reason = 'Runs without a publishing service: the finished posts are saved as a package to post by hand.';
    } else if (reduced.length > 0) {
      stage.reason = `Runs with reduced coverage for ${friendlyList(reduced)}; each finding says where it came from and how sure it is.`;
    }
  }

  const requiredCapabilities = [...needed.keys()].sort();
  const blockers = requiredCapabilities
    .filter((name) => !runsAnyway(name, needed.get(name) ?? 'ready'))
    .map((name) => {
      const state = needed.get(name) ?? 'not_connected';
      const { provider, action } = blockerAction(name, state);
      return { capability: name, state, user_action: action, provider };
    });
  const warnings = requiredCapabilities
    .filter((name) => degradedStages.has(name))
    .map((name) => {
      const state = needed.get(name) ?? DEGRADED;
      return {
        capability: name,
        state,
        stages: degradedStages.get(name) ?? [],
        user_message: blockerAction(name, state).action,
      };
    });

  return {
    schema_version: 1,
    campaign_id: null,
    brand_id: brandId ? String(brandId) : null,
    job_type: jobType,
    starting_point: startingPoint,
    platforms,
    stages: planned,
    required_capabilities: requiredCapabilities,
    blockers: blockers.map(({ capability, state, user_action }) => ({ capability, state, user_action })),
    warnings,
    reference,
    summary: summarize({ routeId, jobType, startingPoint, platforms, planned, blockers, warnings }),
  };
}

/**
 * Decide one stage's status, before capabilities are considered.
 *
 * The route already decided which stages this job runs, so the only judgements left
 * here are about the creative that was supplied: a video reference does not need the
 * image analyst, an image reference does not need the video analyst, and a finished
 * creative job cannot read an asset nobody has pointed at yet.
 * @param {object} context
 * @returns {{status: StageStatus, reason: string|null}}
 */
function decideStatus(context) {
  const { stage, preferences, completed, startingPoint, reference, existingAssets } = context;

  if (completed.has(stage)) {
    return { status: 'completed', reason: 'This was already done for this job.' };
  }

  // Reference mode only decomposes the kind of creative that was supplied.
  if (startingPoint === 'reference' && /creative_decomposition/.test(stage) && !wasRequested(stage, preferences)) {
    const kind = reference && reference.kind ? String(reference.kind) : null;
    if (kind === 'image' && !/image/.test(stage) && !/script/.test(stage)) {
      return { status: 'not_applicable', reason: 'The reference is an image.' };
    }
    if (kind === 'video' && /image/.test(stage)) {
      return { status: 'not_applicable', reason: 'The reference is a video.' };
    }
  }

  if (startingPoint === 'existing_creative' && ANALYSIS_STAGE.test(stage) && existingAssets.length === 0) {
    return { status: 'required', reason: 'Waiting for the finished creative to be pointed at.' };
  }

  return { status: 'required', reason: null };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizePlatforms(value) {
  const list = (Array.isArray(value) ? value : []).map((entry) => String(entry).toLowerCase());
  const kept = PLATFORMS.filter((platform) => list.includes(platform));
  return kept.length > 0 ? kept : ['instagram'];
}

/**
 * @param {unknown} value
 * @returns {{kind: string, url: string|null, asset_id: string|null}|null}
 */
function normalizeReference(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const kinds = ['post', 'ad', 'video', 'image', 'campaign'];
  const kind = kinds.includes(String(raw.kind)) ? String(raw.kind) : 'post';
  const url = typeof raw.url === 'string' && raw.url.length > 0 ? raw.url : null;
  const assetId = typeof raw.asset_id === 'string' && raw.asset_id.length > 0 ? raw.asset_id : null;
  if (!url && !assetId && !raw.kind) return null;
  return { kind, url, asset_id: assetId };
}

/**
 * One or two plain sentences for the user.
 * @param {object} context
 * @returns {string}
 */
function summarize(context) {
  const { jobType, startingPoint, platforms, planned, blockers, warnings } = context;
  const label = {
    social_post: 'social post',
    ad_campaign: 'ad campaign',
    ugc: 'creator style video',
    analyze_existing: 'analysis of existing content',
  }[jobType];
  const start = {
    scratch: 'starting from scratch',
    reference: 'built around the reference you supplied',
    existing_creative: 'built on the creative you already have',
  }[startingPoint];
  const active = planned.filter((stage) => stage.status === 'required' || stage.status === 'waiting').length;
  const skipped = planned.filter((stage) => stage.status === 'skipped' || stage.status === 'not_applicable').length;
  const names = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
  const shown = platforms.map((platform) => names[platform] ?? platform);
  const audience = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  const first =
    `${/^[aeiou]/.test(label) ? 'An' : 'A'} ${label} for ${audience}, ${start}: ${active} steps to run` +
    (skipped > 0 ? `, ${skipped} this job does not need.` : '.');
  let second = '';
  if (blockers.length > 0) {
    second = ` One thing first: ${blockers[0].user_action}`;
  } else if (warnings.some((warning) => warning.state === DEGRADED)) {
    const reduced = friendlyList(warnings.filter((warning) => warning.state === DEGRADED).map((warning) => warning.capability));
    second = ` ${capitalize(reduced)} will run with reduced coverage, and every finding will say where it came from and how sure it is.`;
  }
  return `${first}${second}`;
}
