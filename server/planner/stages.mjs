/**
 * Every stage Social Campaign knows how to run, defined exactly once.
 *
 * Before this module a stage was three half definitions: a name in
 * registry/routes.json, a regular expression in the planner that guessed what kind
 * of stage it was, and a sentence in a skill telling an agent what to do next. The
 * route files disagreed with the skills, a reference job carried two strategy
 * branches, an analyze only job still opened a strategy gate, and nothing in the
 * code could say what a stage needed before it ran or what it had to produce.
 *
 * A stage definition answers five questions and nothing else:
 *
 *   - `phase`: which of the five visible phases it belongs to.
 *   - `owner`: who does the work. An agent, a human at a gate, or the system.
 *   - `inputs`: what has to exist first, as artifact kinds and approval scopes.
 *   - `output`: the one thing it must produce before it can be called done.
 *   - `gate` and `terminal`: the approval scope it opens, and whether a route may
 *     legitimately end on it.
 *
 * registry/routes.json is now a list of stage ids per job type and starting point,
 * so a route is a composition rather than a copy. server/planner/plan.mjs hydrates
 * those ids from this table, and nothing else in the server hard codes a stage.
 */

/** The five approval scopes, in the order a job meets them. */
export const APPROVAL_SCOPES = ['strategy', 'concept', 'cost', 'media', 'final'];

/**
 * What intake hands the first stage of any route. A stage whose inputs are covered
 * by this needs nothing before it.
 */
export const INTAKE_OUTPUTS = ['JobIntake'];

/**
 * Outputs that are not campaign artifacts. `ReleasePackage` is the release record
 * from migration 012, checked through `currentRelease` rather than the artifacts
 * table; a gate produces a decision rather than a file, written as `null`.
 */
export const RELEASE_OUTPUT = 'ReleasePackage';

/**
 * @typedef {object} StageDefinition
 * @property {string} id
 * @property {string} phase one of server/planner/phases.mjs PHASES.
 * @property {string} owner `agent:<name>`, `gate:<scope>` or `system`.
 * @property {string[]} inputs artifact kinds, or `approval:<scope>`.
 * @property {string|null} output the artifact kind, `ReleasePackage`, or null for a gate.
 * @property {string|null} gate the approval scope this stage opens, if it is a gate.
 * @property {boolean} terminal whether a route may end here.
 * @property {string[]} capabilities what has to be connected or available for it to run.
 */

/**
 * @param {StageDefinition} definition
 * @returns {StageDefinition}
 */
function stage(definition) {
  return {
    inputs: [],
    output: null,
    gate: null,
    terminal: false,
    capabilities: [],
    ...definition,
  };
}

const LIST = [
  // ---------------------------------------------------------------------------
  // Research and strategy
  // ---------------------------------------------------------------------------
  stage({
    id: 'brand_context',
    phase: 'research_strategy',
    owner: 'agent:brand-researcher',
    inputs: ['JobIntake'],
    output: 'BrandResearchResult',
    capabilities: ['memory.brand.read', 'memory.brand.propose', 'web.search', 'web.fetch'],
  }),
  stage({
    id: 'trend_research',
    phase: 'research_strategy',
    owner: 'agent:trend-scout',
    inputs: ['JobIntake'],
    output: 'TrendResearchResult',
    capabilities: ['web.search', 'web.fetch', 'social.search_content'],
  }),
  stage({
    id: 'trend_context',
    phase: 'research_strategy',
    owner: 'agent:trend-scout',
    inputs: ['JobIntake'],
    output: 'TrendResearchResult',
    capabilities: ['web.search', 'web.fetch', 'social.search_content'],
  }),
  stage({
    id: 'competitor_research',
    phase: 'research_strategy',
    owner: 'agent:competitor-researcher',
    inputs: ['BrandResearchResult'],
    output: 'CompetitorResearchResult',
    capabilities: ['web.search', 'web.fetch', 'memory.competitor.read', 'social.inspect_account', 'social.search_content'],
  }),
  stage({
    id: 'competitor_context',
    phase: 'research_strategy',
    owner: 'agent:competitor-researcher',
    inputs: ['BrandResearchResult'],
    output: 'CompetitorResearchResult',
    capabilities: ['web.search', 'web.fetch', 'memory.competitor.read', 'social.inspect_account', 'social.search_content'],
  }),
  stage({
    id: 'competitor_ad_research',
    phase: 'research_strategy',
    owner: 'agent:competitor-researcher',
    inputs: ['BrandResearchResult'],
    output: 'AdLibraryResearchResult',
    capabilities: ['web.search', 'web.fetch', 'memory.competitor.read', 'ads.research'],
  }),
  stage({
    id: 'ad_specific_research',
    phase: 'research_strategy',
    owner: 'agent:competitor-researcher',
    inputs: ['BrandResearchResult'],
    output: 'AdLibraryResearchResult',
    capabilities: ['web.search', 'web.fetch', 'ads.research'],
  }),
  stage({
    id: 'audience_research',
    phase: 'research_strategy',
    owner: 'agent:audience-researcher',
    inputs: ['BrandResearchResult'],
    output: 'AudienceResearchResult',
    capabilities: ['web.search', 'web.fetch', 'memory.brand.read', 'social.inspect_post'],
  }),
  stage({
    id: 'audience_funnel_message_strategy',
    phase: 'research_strategy',
    owner: 'agent:audience-researcher',
    inputs: ['BrandResearchResult'],
    output: 'AudienceResearchResult',
    capabilities: ['web.search', 'web.fetch', 'memory.brand.read', 'social.inspect_post'],
  }),
  stage({
    id: 'platform_analysis',
    phase: 'research_strategy',
    owner: 'agent:platform-analyst',
    inputs: ['BrandResearchResult'],
    output: 'PlatformPlan',
    capabilities: ['memory.brand.read'],
  }),

  // The supplied creative, whether it is a reference to work from or the finished
  // thing this job is built on.
  stage({
    id: 'reference_resolution',
    phase: 'research_strategy',
    owner: 'agent:media-librarian',
    inputs: ['JobIntake'],
    output: 'NormalizedAssetRecord',
    capabilities: ['media.probe', 'workspace.read', 'workspace.write'],
  }),
  stage({
    id: 'creative_decomposition',
    phase: 'research_strategy',
    owner: 'agent:video-analyst',
    inputs: ['NormalizedAssetRecord'],
    output: 'VideoCreativeAnalysis',
    capabilities: ['media.video_analyze', 'media.transcribe'],
  }),
  stage({
    id: 'creative_decomposition_image',
    phase: 'research_strategy',
    owner: 'agent:image-analyst',
    inputs: ['NormalizedAssetRecord'],
    output: 'ImageCreativeAnalysis',
    capabilities: ['media.image_analyze'],
  }),
  stage({
    id: 'creative_decomposition_script',
    phase: 'research_strategy',
    owner: 'agent:script-analyst',
    inputs: ['NormalizedAssetRecord'],
    output: 'ScriptAnalysis',
    capabilities: ['memory.brand.read', 'memory.creative.read'],
  }),
  stage({
    id: 'asset_analysis',
    phase: 'research_strategy',
    owner: 'agent:media-librarian',
    inputs: ['JobIntake'],
    output: 'NormalizedAssetRecord',
    capabilities: ['media.probe', 'media.extract_frames', 'media.extract_audio', 'workspace.read', 'workspace.write'],
  }),
  stage({
    id: 'asset_analysis_video',
    phase: 'research_strategy',
    owner: 'agent:video-analyst',
    inputs: ['NormalizedAssetRecord'],
    output: 'VideoCreativeAnalysis',
    capabilities: ['media.video_analyze', 'media.transcribe'],
  }),
  stage({
    id: 'platform_suitability',
    phase: 'research_strategy',
    owner: 'agent:platform-analyst',
    inputs: ['NormalizedAssetRecord'],
    output: 'PlatformPlan',
    capabilities: ['memory.brand.read'],
  }),

  // Strategy, one branch per route: `strategy` from research, `strategy_reference_mode`
  // from a supplied reference. A route never carries both.
  stage({
    id: 'strategy',
    phase: 'research_strategy',
    owner: 'agent:strategist',
    inputs: ['BrandResearchResult', 'PlatformPlan'],
    output: 'StrategySet',
    capabilities: ['memory.brand.read', 'memory.creative.read', 'memory.preference.read', 'memory.competitor.read'],
  }),
  stage({
    id: 'strategy_reference_mode',
    phase: 'research_strategy',
    owner: 'agent:strategist',
    inputs: ['BrandResearchResult', 'PlatformPlan'],
    output: 'StrategySet',
    capabilities: [
      'memory.brand.read',
      'memory.creative.read',
      'memory.preference.read',
      'memory.competitor.read',
      'creative.reference_get',
    ],
  }),
  stage({
    id: 'strategy_gate',
    phase: 'research_strategy',
    owner: 'gate:strategy',
    inputs: ['StrategySet'],
    gate: 'strategy',
    capabilities: ['review.strategy'],
  }),

  // The analysis only exit: a job that was asked to understand something, not make
  // anything, ends here rather than falling through the rest of the pipeline.
  stage({
    id: 'analysis_report',
    phase: 'research_strategy',
    owner: 'agent:creative-director',
    inputs: ['VideoCreativeAnalysis'],
    output: 'CreativeProfile',
    terminal: true,
    capabilities: ['memory.creative.read', 'memory.creative.propose'],
  }),

  // ---------------------------------------------------------------------------
  // Creative
  // ---------------------------------------------------------------------------
  stage({
    id: 'ugc_creative_direction',
    phase: 'media_production',
    owner: 'agent:ugc-creative-director',
    inputs: ['StrategySet', 'PlatformPlan', 'approval:strategy'],
    output: 'VideoScript',
    capabilities: ['memory.brand.read', 'memory.creative.read', 'memory.preference.read', 'workflow.method'],
  }),
  stage({
    id: 'copywriting',
    phase: 'media_production',
    owner: 'agent:copywriter',
    inputs: ['PlatformPlan'],
    output: 'CopyPackage',
    capabilities: ['memory.brand.read', 'memory.preference.read'],
  }),
  stage({
    id: 'copy_variants',
    phase: 'media_production',
    owner: 'agent:copywriter',
    inputs: ['PlatformPlan'],
    output: 'CopyPackage',
    capabilities: ['memory.brand.read', 'memory.preference.read'],
  }),
  stage({
    id: 'caption_copy',
    phase: 'media_production',
    owner: 'agent:copywriter',
    inputs: ['PlatformPlan'],
    output: 'CopyPackage',
    capabilities: ['memory.brand.read', 'memory.preference.read'],
  }),
  stage({
    id: 'concept_review',
    phase: 'media_production',
    owner: 'gate:concept',
    inputs: ['CopyPackage'],
    gate: 'concept',
    capabilities: ['review.concept'],
  }),

  // The existing creative path: a reuse brief says what the finished asset is for
  // and how it will be adapted, the person approves that brief, and the job goes to
  // release preparation without generating anything.
  stage({
    id: 'reuse_brief',
    phase: 'media_production',
    owner: 'agent:strategist',
    inputs: ['NormalizedAssetRecord', 'PlatformPlan'],
    output: 'ReuseBrief',
    capabilities: ['memory.brand.read', 'memory.creative.read', 'memory.preference.read'],
  }),
  stage({
    id: 'reuse_brief_gate',
    phase: 'media_production',
    owner: 'gate:concept',
    inputs: ['ReuseBrief'],
    gate: 'concept',
    capabilities: ['review.concept'],
  }),
  stage({
    id: 'subtitle_check',
    phase: 'media_production',
    owner: 'agent:subtitle-composer',
    inputs: ['NormalizedAssetRecord'],
    output: 'SubtitlePackage',
    capabilities: ['media.transcribe', 'generation.subtitle'],
  }),

  // ---------------------------------------------------------------------------
  // Cost and production. cost_gate always comes before media_production: nothing is
  // generated against an estimate nobody has seen.
  // ---------------------------------------------------------------------------
  stage({
    id: 'media_plan',
    phase: 'media_production',
    owner: 'agent:media-producer',
    inputs: ['CopyPackage', 'PlatformPlan'],
    output: 'MediaPlan',
    capabilities: ['memory.brand.read'],
  }),
  stage({
    id: 'cost_gate',
    phase: 'approval_cost',
    owner: 'gate:cost',
    inputs: ['MediaPlan'],
    gate: 'cost',
    capabilities: ['review.cost'],
  }),
  stage({
    id: 'media_production',
    phase: 'media_production',
    owner: 'agent:media-producer',
    inputs: ['MediaPlan', 'approval:cost'],
    output: 'GeneratedMediaPackage',
    capabilities: ['generation.image', 'generation.video'],
  }),
  stage({
    id: 'media_review',
    phase: 'media_production',
    owner: 'gate:media',
    inputs: ['GeneratedMediaPackage'],
    gate: 'media',
    capabilities: ['review.media'],
  }),

  // ---------------------------------------------------------------------------
  // Release and delivery. release_preparation runs for generated and supplied assets
  // alike, so an existing creative job reaches final review the same way.
  // ---------------------------------------------------------------------------
  stage({
    id: 'release_preparation',
    phase: 'final_review_publish',
    owner: 'system',
    inputs: ['CopyPackage'],
    output: RELEASE_OUTPUT,
    capabilities: ['workspace.read', 'workspace.write'],
  }),
  stage({
    id: 'final_review',
    phase: 'final_review_publish',
    owner: 'gate:final',
    inputs: [RELEASE_OUTPUT],
    gate: 'final',
    terminal: true,
    capabilities: ['review.final'],
  }),
  stage({
    id: 'final_ad_package',
    phase: 'final_review_publish',
    owner: 'gate:final',
    inputs: [RELEASE_OUTPUT],
    gate: 'final',
    terminal: true,
    capabilities: ['review.final'],
  }),
  stage({
    id: 'publish',
    phase: 'final_review_publish',
    owner: 'agent:publisher',
    inputs: ['approval:final'],
    output: 'PublishingResult',
    terminal: true,
    capabilities: ['publishing.schedule', 'publishing.publish'],
  }),
];

/** Every stage, by id. @type {Map<string, StageDefinition>} */
export const STAGES = new Map(LIST.map((entry) => [entry.id, entry]));

/** Every stage id, in definition order. */
export const STAGE_IDS = LIST.map((entry) => entry.id);

/**
 * The definition for a stage id, or null for a name Social Campaign does not know.
 * @param {string} id
 * @returns {StageDefinition|null}
 */
export function stageDefinition(id) {
  return STAGES.get(String(id)) ?? null;
}

/**
 * Who owns a stage, split into the shape a plan carries.
 * @param {string} id
 * @returns {{owner_agent: string|null, gate: string|null}}
 */
export function stageOwner(id) {
  const definition = stageDefinition(id);
  if (!definition) return { owner_agent: null, gate: null };
  if (definition.owner.startsWith('agent:')) return { owner_agent: definition.owner.slice('agent:'.length), gate: null };
  return { owner_agent: null, gate: definition.gate };
}

/**
 * Check that an ordered list of stage ids is a valid dependency graph: every id is
 * known, and every input a stage declares is either produced by an earlier stage in
 * the same list or handed over by intake. Returns the problems in plain words, empty
 * when the route is sound.
 * @param {string[]} ids
 * @returns {string[]}
 */
export function routeProblems(ids) {
  const problems = [];
  const available = new Set(INTAKE_OUTPUTS);
  const approved = new Set();
  for (const id of ids) {
    const definition = stageDefinition(id);
    if (!definition) {
      problems.push(`"${id}" is not a stage Social Campaign knows about.`);
      continue;
    }
    for (const input of definition.inputs) {
      if (input.startsWith('approval:')) {
        const scope = input.slice('approval:'.length);
        if (!approved.has(scope)) problems.push(`${id} needs the ${scope} approval, which no earlier stage opens.`);
        continue;
      }
      if (!available.has(input)) problems.push(`${id} needs a ${input}, which no earlier stage produces.`);
    }
    if (definition.output) available.add(definition.output);
    if (definition.gate) approved.add(definition.gate);
  }
  const last = ids.length > 0 ? stageDefinition(ids[ids.length - 1]) : null;
  if (ids.length === 0) problems.push('A route needs at least one stage.');
  else if (last && !last.terminal) problems.push(`${last.id} is not a stage a route may end on.`);
  return problems;
}
