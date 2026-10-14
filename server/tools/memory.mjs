/**
 * Memory tools: brand identity, creative profile, competitor intelligence,
 * preferences, memory proposals, the precedence resolver and the brand wiki.
 *
 * Specialists never write canonical memory directly. brand_propose_update and
 * creative_profile_propose_update apply the precedence rule from docs/CONTRACTS.md
 * section 7 and spec 19, and queue anything that loses it as a memory_proposals row.
 * Only memory_promote moves a queued proposal into canonical memory.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { isId } from '../lib/ids.mjs';
import {
  createBrand,
  listBrands,
  getBrand,
  proposeBrandUpdate,
  correctBrandField,
  writeBrandWiki,
  getPillars,
  savePillars,
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

/**
 * Move whatever a draft's staged reference uploads collected into the real
 * brand's references folder, once the brand exists. Only legacy workspaces have
 * staged uploads under a draft id; a draft id with nothing staged is ignored.
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
          description: 'Legacy workspaces only: a draft id whose staged reference uploads move into this brand. Ignored when nothing is staged under it.',
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
];
