/**
 * The five phases a person sees, and the map from every internal stage name to one
 * of them.
 *
 * The board never learns a stage name: every view that carries a
 * `phase` field builds it from this module, so the mapping lives in exactly one
 * place. A stage that shows up in registry/routes.json or server/planner/plan.mjs
 * without an entry here is a bug, not a silent fallback - see
 * server/planner/phases.test.mjs, which fails the build until it is added.
 */

import { ROUTES } from './plan.mjs';
import { STAGES, STAGE_IDS } from './stages.mjs';
import { progressStages } from '../workflow/stage.mjs';

/**
 * @typedef {'to_do'|'in_progress'|'done'|'waiting'|'skipped'} PhaseStatus
 */

/** The five phases, in order, exactly as the product owner named them. */
export const PHASES = ['intake', 'research_strategy', 'approval_cost', 'media_production', 'final_review_publish'];

/** The label a person sees for each phase. */
export const PHASE_LABEL = {
  intake: 'Intake',
  research_strategy: 'Research & Strategy',
  approval_cost: 'Approval & Cost Estimate',
  media_production: 'Media Production',
  final_review_publish: 'Final Review & Publish',
};

/**
 * Every stage, mapped to the phase it belongs to, read straight off the one stage
 * table in server/planner/stages.mjs. `intake` has no stage of its own - it is the
 * work already done before a plan exists - so nothing maps to it here; it is always
 * shown as done once a plan is on screen.
 * @type {Record<string, string>}
 */
export const STAGE_PHASE = Object.fromEntries(STAGE_IDS.map((id) => [id, STAGES.get(id).phase]));

/**
 * The phase a stage belongs to. Falls back to `final_review_publish` for a name this
 * module has never seen, which the completeness test treats as a failure rather than
 * letting it pass quietly.
 * @param {string} stage
 * @returns {string}
 */
export function phaseForStage(stage) {
  return STAGE_PHASE[String(stage)] ?? null;
}

/**
 * Every stage name that appears in registry/routes.json or as a literal pushed by
 * server/planner/plan.mjs (the synthetic `competitor_ad_research` entry it adds for
 * ad campaigns is already a route stage, so routes.json alone covers it).
 * @returns {string[]}
 */
export function allKnownStageNames() {
  const names = new Set();
  for (const route of ROUTES) {
    for (const entry of route.stages) names.add(String(entry));
  }
  return [...names];
}

/**
 * Roll a phase's stage statuses up into one status for the phase.
 *
 * `completed`, `skipped` and `not_applicable` are all terminal: the phase has no
 * more work in it either way. The old rule only treated `completed` as finished, so
 * a phase whose stages were all done or all deliberately not needed still read
 * "in progress" forever.
 *
 * - Every stage terminal, and at least one of them completed -> done.
 * - Every stage terminal, none of them completed -> skipped ("Not needed").
 * - A phase with no stages at all (Intake) -> done.
 * - Any stage `needs_rework` -> in_progress: the work came back.
 * - Any stage `waiting` -> waiting.
 * - A mix of terminal and outstanding -> in_progress.
 * - Otherwise (all outstanding, none started) -> to_do.
 * @param {Array<{status: string}>} stages
 * @returns {PhaseStatus}
 */
export function rollUpPhaseStatus(stages) {
  if (stages.length === 0) return 'done';
  const statuses = stages.map((stage) => String(stage.status));
  const terminal = (status) => status === 'completed' || status === 'skipped' || status === 'not_applicable';
  if (statuses.every(terminal)) return statuses.some((status) => status === 'completed') ? 'done' : 'skipped';
  if (statuses.some((status) => status === 'needs_rework')) return 'in_progress';
  if (statuses.some((status) => status === 'waiting')) return 'waiting';
  if (statuses.some(terminal)) return 'in_progress';
  return 'to_do';
}

/**
 * The phase a JobExecutionPlan is currently sitting at: the first phase (after
 * Intake) that is not done or skipped, or the last phase when every stage is done.
 * Used by every tool that reports a `phase` field, e.g. the review
 * gates, so the board can draw the compact five dot strip without knowing a single
 * stage name.
 * @param {any} plan
 * @returns {string}
 */
export function currentPhase(plan) {
  const groups = groupStagesByPhase(plan?.stages ?? []);
  for (const phase of PHASES.slice(1)) {
    const status = rollUpPhaseStatus(groups.get(phase) ?? []);
    if (status !== 'done' && status !== 'skipped') return phase;
  }
  return PHASES[PHASES.length - 1];
}

/**
 * Look up the current phase for a campaign, for tools that only have a campaign id
 * and a database handle (every review gate).
 *
 * This reads the same source as everything else: the current plan's stages, each
 * carrying the status its newest execution record gives it. It used to read the
 * saved plan JSON while stage moves were written to a different table, which is how
 * the phase strip could disagree with work that was demonstrably finished. Returns
 * null when the campaign has no plan yet, so callers can omit `phase` rather than
 * send a wrong guess.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {string|null}
 */
export function phaseForCampaign(db, campaignId) {
  try {
    const stages = progressStages(db, campaignId);
    if (stages.length === 0) return null;
    return currentPhase({ stages });
  } catch {
    return null;
  }
}

/**
 * Group a JobExecutionPlan's `stages[]` by phase, in phase order, dropping phases
 * with no stages in this particular plan only when building the detail list (the
 * caller still shows all five markers regardless).
 * @param {Array<{stage: string, status: string, gate: string|null, order?: number}>} stages
 * @returns {Map<string, Array<{stage: string, status: string, gate: string|null}>>}
 */
export function groupStagesByPhase(stages) {
  /** @type {Map<string, Array<{stage: string, status: string, gate: string|null}>>} */
  const groups = new Map(PHASES.map((phase) => [phase, []]));
  for (const stage of stages) {
    const phase = phaseForStage(stage.stage) ?? 'final_review_publish';
    groups.get(phase)?.push(stage);
  }
  return groups;
}
