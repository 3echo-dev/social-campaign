/**
 * Memory tools: brand identity, creative profile, competitor intelligence,
 * preferences, memory proposals, the precedence resolver, the brand wiki, and the
 * brand onboarding screen.
 *
 * Specialists never write canonical memory directly. brand_propose_update and
 * creative_profile_propose_update apply the precedence rule from docs/CONTRACTS.md
 * section 7 and spec 19, and queue anything that loses it as a memory_proposals row.
 * Only memory_promote moves a queued proposal into canonical memory.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { isId, newId } from '../lib/ids.mjs';
import {
  createBrand,
  listBrands,
  getBrand,
  proposeBrandUpdate,
  correctBrandField,
  writeBrandWiki,
  getPillars,
  savePillars,
  PILLAR_KEYS,
  PILLAR_HELP,
} from '../memory/brand.mjs';
import { getCreativeProfile, proposeCreativeProfileUpdate } from '../memory/creative.mjs';
import { getCompetitor, saveCompetitorAnalysis, listCompetitors } from '../memory/competitor.mjs';
import { recordEvidence, getPreferences } from '../memory/preference.mjs';
import { listProposals, promoteProposal, rejectProposal, resolveContext } from '../memory/promotion.mjs';

const FIELD_SCHEMA = {
  type: 'object',
  required: ['key', 'value', 'source_type'],
  properties: {
    key: { type: 'string' },
    value: {},
    source_type: {
      type: 'string',
      description: 'user_correction, user_brand_guide, official_source, verified_research or model_inference.',
    },
    source_ref: { type: 'string' },
    observed_at: { type: 'string' },
    confidence: { type: 'number' },
  },
};

/** Matches the pane's own cap in server/ui/server.mjs; kept in sync by inspection. */
const MAX_REFERENCES_PER_BRAND = 50;

const ONBOARDING_STEPS = [
  { key: 'ingest', label: 'Ingest what you provided' },
  { key: 'research', label: 'Research the brand' },
  { key: 'inspect', label: 'Inspect creative references' },
  { key: 'analyze', label: 'Analyze patterns' },
  { key: 'build_profiles', label: 'Build brand and creative profiles' },
];

/** The only statuses the progress screen knows how to render. */
const ONBOARDING_STEP_STATUSES = ['pending', 'active', 'done'];

/**
 * Every step the progress screen renders needs a real label and a known status.
 * A step missing either is refused here, in one plain sentence, rather than
 * rendered as "undefined": the contract is that the caller supplies `label`
 * (not `name`, not just `key`) on every step object.
 * @param {unknown} steps
 * @returns {Array<{key: string, label: string, status: string}>}
 */
function normalizeOnboardingSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return ONBOARDING_STEPS.map((step) => ({ ...step, status: 'pending' }));
  }
  return steps.map((step, index) => {
    const raw = step && typeof step === 'object' ? step : {};
    const key = typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : null;
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null;
    const status = typeof raw.status === 'string' ? raw.status : '';
    if (!key) {
      throw new InvalidInputError(`Step ${index + 1} of the onboarding progress is missing its "key".`, {
        fix: 'Pass every step as { key, label, status }, with a non-empty key.',
      });
    }
    if (!label) {
      throw new InvalidInputError(`The "${key}" onboarding step is missing its "label".`, {
        fix: 'Pass every step as { key, label, status }, with a non-empty, human readable label.',
      });
    }
    if (!ONBOARDING_STEP_STATUSES.includes(status)) {
      throw new InvalidInputError(`The "${key}" onboarding step has an unknown status "${status}".`, {
        fix: `Use one of: ${ONBOARDING_STEP_STATUSES.join(', ')}.`,
      });
    }
    return { key, label, status };
  });
}

/**
 * The data behind the phase two pillars screen: the four pillar values, what each
 * is for, and which are still gaps research could not close.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, any>} brand
 * @param {string|null} [campaignId] The job this onboarding detour belongs to, if
 *   any, carried through so "Start a Job" can resume it instead of guessing.
 * @returns {Record<string, unknown>}
 */
function pillarsScreenData(db, brand, campaignId = null) {
  const pillars = getPillars(db, brand.id);
  return {
    mode: 'pillars',
    title: `${brand.name}: Brand Pillars`,
    brand_id: brand.id,
    brand_name: brand.name,
    campaign_id: campaignId,
    pillars,
    pillar_help: PILLAR_HELP,
    gaps: PILLAR_KEYS.filter((key) => pillars[key].gap),
  };
}

/**
 * Move whatever a draft's staged reference uploads collected into the real
 * brand's references folder, once the brand exists. A draft id is handed out by
 * brand_onboarding_open before a brand has been created, so the uploader in
 * server/ui/server.mjs has somewhere safe to write phase one attachments.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {Record<string, any>} brand
 * @param {string} draftId
 */
function adoptDraftReferences(workspace, brand, draftId) {
  if (!isId(draftId) || !workspace.root) return;
  const draftBase = join(workspace.root, '.social-campaign', 'uploads', draftId);
  const draftDir = join(draftBase, 'references');
  if (!existsSync(draftDir)) return;
  const targetDir = join(workspace.root, 'brands', brand.slug, 'references');
  mkdirSync(targetDir, { recursive: true });
  const db = workspace.requireDb();
  for (const name of readdirSync(draftDir)) {
    const oldPath = join(draftDir, name);
    if (!statSync(oldPath).isFile()) continue;
    let newPath = join(targetDir, name);
    if (existsSync(newPath)) {
      const ext = extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let i = 2;
      while (existsSync(newPath)) {
        newPath = join(targetDir, `${stem}-${i}${ext}`);
        i += 1;
      }
    }
    renameSync(oldPath, newPath);
    db.prepare('UPDATE assets SET path = ?, brand_id = ? WHERE path = ?').run(newPath, brand.id, oldPath);
  }
  rmSync(draftBase, { recursive: true, force: true });
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const memoryTools = [
  defineTool({
    name: 'brand_create',
    description:
      'Legacy workspaces only. Create a new brand memory record from whatever the user supplied: name, a free text brief (the ' +
      'research agents pull the website and social links out of it themselves), a source media folder, and ' +
      'any references already attached under draft_id. Returns the brand with its identity and provenance.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        brief: { type: 'string', description: 'The free text brief: website, socials, what the brand sells, anything else.' },
        source_media_folder: { type: 'string' },
        creative_references: { type: 'array', items: { type: 'string' } },
        draft_id: {
          type: 'string',
          description: 'The draft id from brand_onboarding_open, so its staged reference uploads move into this brand.',
        },
        website: { type: 'string' },
        socials: {
          type: 'object',
          properties: { facebook: { type: 'string' }, instagram: { type: 'string' }, tiktok: { type: 'string' } },
        },
        guidelines_text: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const brand = createBrand(workspace.requireDb(), { ...args, workspaceRoot: workspace.requireRoot() });
      if (typeof args.draft_id === 'string' && args.draft_id) {
        adoptDraftReferences(workspace, brand, args.draft_id);
      }
      return getBrand(workspace.requireDb(), brand.id);
    },
  }),

  defineTool({
    name: 'brand_list',
    description: 'Legacy workspaces only. List every brand Social Campaign knows about.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { workspace }) => ({ brands: listBrands(workspace.requireDb()) }),
  }),

  defineTool({
    name: 'brand_get',
    description:
      'Legacy workspaces only. Load a brand: its identity, every field with its provenance, its creative profile, and its social ' +
      'profiles.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: { brand_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => getBrand(workspace.requireDb(), String(args.brand_id)),
  }),

  defineTool({
    name: 'brand_propose_update',
    description:
      'Legacy workspaces only. Propose updates to brand facts, each with its own provenance. A field replaces the live value when ' +
      'its source is equal or higher precedence, or the live value has gone stale; otherwise it is queued ' +
      'for a human to promote or reject. Returns what was applied and what was queued.',
    inputSchema: {
      type: 'object',
      required: ['brand_id', 'fields', 'proposed_by'],
      properties: {
        brand_id: { type: 'string' },
        fields: { type: 'array', items: FIELD_SCHEMA },
        proposed_by: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => proposeBrandUpdate(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'brand_field_correct',
    description:
      'Legacy workspaces only. Correct a brand fact directly from the user. A user correction is the highest precedence source ' +
      'there is, so this always replaces the live value.',
    inputSchema: {
      type: 'object',
      required: ['brand_id', 'key', 'value'],
      properties: { brand_id: { type: 'string' }, key: { type: 'string' }, value: {} },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => correctBrandField(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'creative_profile_get',
    description: 'Load the current creative profile for a brand, if one has been built.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: { brand_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => getCreativeProfile(workspace.requireDb(), String(args.brand_id)) ?? { brand_id: args.brand_id, profile: null },
  }),

  defineTool({
    name: 'creative_profile_propose_update',
    description:
      'Propose a refreshed creative profile for a brand. This is always queued for promotion: the Creative ' +
      'Director cannot write creative memory directly.',
    inputSchema: {
      type: 'object',
      required: ['brand_id', 'profile', 'proposed_by'],
      properties: { brand_id: { type: 'string' }, profile: { type: 'object' }, proposed_by: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => proposeCreativeProfileUpdate(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'competitor_get',
    description: 'Load tracked competitors for a brand, or one competitor by name, with their analyses.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: { brand_id: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({ competitors: getCompetitor(workspace.requireDb(), args) }),
  }),

  defineTool({
    name: 'competitor_save_analysis',
    description: 'Save a competitor analysis. Creates the competitor record if it does not exist yet.',
    inputSchema: {
      type: 'object',
      required: ['brand_id', 'name', 'analysis'],
      properties: {
        brand_id: { type: 'string' },
        name: { type: 'string' },
        analysis: { type: 'object' },
        source_ref: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => saveCompetitorAnalysis(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'competitor_list',
    description: 'List every tracked competitor across all brands.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { workspace }) => ({ competitors: listCompetitors(workspace.requireDb()) }),
  }),

  defineTool({
    name: 'preference_get',
    description: 'Load promoted preferences, and evidence for a campaign when one is given.',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' }, campaign_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => getPreferences(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'preference_record_evidence',
    description:
      'Record a preference signal. An explicit signal promotes immediately. An inferred signal is campaign ' +
      'evidence only, until at least three consistent observations across at least two campaigns promote it. ' +
      'A one_off signal never promotes.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'signal', 'value'],
      properties: {
        kind: { type: 'string', description: 'explicit, inferred or one_off.' },
        signal: { type: 'string' },
        value: { type: 'string' },
        campaign_id: { type: 'string' },
        brand_id: { type: 'string' },
        note: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => recordEvidence(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'memory_proposals_list',
    description: 'List memory proposals awaiting promotion, or filtered by status.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', description: 'proposed, promoted or rejected.' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({ proposals: listProposals(workspace.requireDb(), args) }),
  }),

  defineTool({
    name: 'memory_promote',
    description: 'Promote a queued memory proposal into canonical memory.',
    inputSchema: {
      type: 'object',
      required: ['proposal_id'],
      properties: { proposal_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => promoteProposal(workspace.requireDb(), String(args.proposal_id)),
  }),

  defineTool({
    name: 'memory_reject',
    description: 'Reject a queued memory proposal so it is never applied.',
    inputSchema: {
      type: 'object',
      required: ['proposal_id'],
      properties: { proposal_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => rejectProposal(workspace.requireDb(), String(args.proposal_id)),
  }),

  defineTool({
    name: 'memory_context',
    description:
      'Resolve the merged memory context for a brand and, when given, a campaign: current instruction, ' +
      'campaign reference, brand guidelines, explicit preferences, creative memory, inferred preferences, ' +
      'competitor intelligence and trend intelligence, in that order of precedence.',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' }, campaign_id: { type: 'string' }, instruction: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => resolveContext(workspace.requireDb(), args),
  }),

  defineTool({
    name: 'brand_wiki_write',
    description:
      'Legacy workspaces only. Render the brand and creative profile markdown pages for a brand from memory, into its brands folder.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: { brand_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => writeBrandWiki(workspace.requireDb(), workspace.requireRoot(), String(args.brand_id)),
  }),

  defineTool({
    name: 'brand_pillars_get',
    description:
      'Legacy workspaces only. Read the four brand pillars (brand voice, audience, positioning, platform playbook) for a brand, ' +
      'each with its current value and whether it is still a gap research has not filled in.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: { brand_id: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => ({ pillars: getPillars(workspace.requireDb(), String(args.brand_id)) }),
  }),

  defineTool({
    name: 'brand_pillars_save',
    description:
      'Legacy workspaces only. Save the person\'s edits to the four brand pillars. Each edited pillar is recorded as a user ' +
      'correction, the top precedence source, so it outranks whatever research proposed there before. Also ' +
      'writes the pillar markdown files into the brand\'s folder and refreshes the brand wiki.',
    inputSchema: {
      type: 'object',
      required: ['brand_id', 'pillars'],
      properties: {
        brand_id: { type: 'string' },
        pillars: {
          type: 'object',
          properties: {
            brand_voice: { type: 'string' },
            audience: { type: 'string' },
            positioning: { type: 'string' },
            platform_playbook: { type: 'string' },
          },
        },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const result = savePillars(db, root, args);
      writeBrandWiki(db, root, String(args.brand_id));
      return result;
    },
  }),

  defineTool({
    name: 'brand_onboarding_open',
    description:
      'Legacy workspaces only. Show the brand onboarding screen. With no brand_id, shows phase one: brand name, a free text brief, ' +
      'a references dropzone, and a source media folder, plus a draft_id that reference uploads attach to ' +
      'before the brand exists. With a brand_id, shows phase two directly: the four pillars, prefilled and ' +
      'ready to edit, since this screen is also the edit screen for a brand that already exists. Pass ' +
      'campaign_id when this onboarding is a detour from a job that had no brand yet, so the job can be ' +
      'resumed afterwards instead of started over: it is carried through every onboarding screen and handed ' +
      'back in the submit_brief and start_job payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        campaign_id: {
          type: 'string',
          description: 'The job this onboarding detour belongs to, if a new job sent the user here for a missing brand.',
        },
      },
      additionalProperties: false,
    },
    handler: (args, { ui, workspace }) => {
      const campaignId = typeof args.campaign_id === 'string' && args.campaign_id ? args.campaign_id : null;
      if (args.brand_id && workspace.db) {
        let existing = null;
        try {
          existing = getBrand(workspace.requireDb(), String(args.brand_id));
        } catch {
          existing = null;
        }
        if (existing) {
          const screen = ui.show('brand_onboarding', pillarsScreenData(workspace.requireDb(), existing, campaignId));
          return { url: ui.url(), screenId: screen.screenId };
        }
      }
      // Reuse the draft id already on screen when the brief is already showing,
      // rather than minting a fresh one on every call: a fresh id would point
      // reference uploads already attached under the old draft folder at a
      // draft the new screen no longer knows about, orphaning them the moment
      // this tool is called a second time (a status re-check, a retry) while
      // the person is still filling the form in.
      const alreadyOnBrief = ui.screen.type === 'brand_onboarding' && ui.screen.data?.mode === 'brief';
      const draftId = alreadyOnBrief && ui.screen.data?.draft_id ? String(ui.screen.data.draft_id) : newId();
      const screen = ui.show('brand_onboarding', {
        mode: 'brief',
        title: 'Onboard a Brand',
        draft_id: draftId,
        campaign_id: campaignId,
        max_references: MAX_REFERENCES_PER_BRAND,
        values: {},
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'brand_onboarding_progress',
    description:
      'Legacy workspaces only. Show onboarding progress for a brand: ingest, research, inspect, analyze, build profiles. When every ' +
      'step is done, shows phase two, the pillars screen, instead: brand voice, audience, positioning and ' +
      'platform playbook, prefilled from research and ready to edit. Pass steps as [{key, label, status}], ' +
      'every field required: key is the stage identifier, label is the human readable text the screen shows ' +
      '(never omit it, and never call it "name"), status one of pending, active, done. Pass campaign_id when ' +
      'this onboarding is a detour from a job that had no brand yet, so it reaches the pillars screen and ' +
      'the start_job payload too.',
    inputSchema: {
      type: 'object',
      required: ['brand_id'],
      properties: {
        brand_id: { type: 'string' },
        campaign_id: {
          type: 'string',
          description: 'The job this onboarding detour belongs to, if a new job sent the user here for a missing brand.',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'label', 'status'],
            properties: { key: { type: 'string' }, label: { type: 'string' }, status: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    handler: (args, { ui, workspace }) => {
      const steps = normalizeOnboardingSteps(args.steps);
      const campaignId = typeof args.campaign_id === 'string' && args.campaign_id ? args.campaign_id : null;

      const allDone = steps.every((step) => step.status === 'done');
      if (!allDone) {
        const screen = ui.show('brand_onboarding', {
          mode: 'progress',
          title: 'Building the brand profile',
          brand_id: String(args.brand_id),
          campaign_id: campaignId,
          steps,
        });
        return { url: ui.url(), screenId: screen.screenId };
      }

      const brand = getBrand(workspace.requireDb(), String(args.brand_id));
      const screen = ui.show('brand_onboarding', pillarsScreenData(workspace.requireDb(), brand, campaignId));
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),
];
