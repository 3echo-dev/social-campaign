/**
 * The brand intelligence tools: brand_intelligence_get and brand_intelligence_save.
 *
 * Brand intelligence is what onboarding learns about a brand's niche: the posts it took apart and labelled, the six subtopics, the best formats
 * and the 6 by 5 plan (see server/pipeline/brand-intelligence.mjs for the files and rules, and pipeline/library/formats.json for the labels).
 * The onboarding save files the posts by itself. These tools are for the Director: it keeps the checklist the board shows while the pass runs,
 * writes the subtopic draft once the posts are filed, applies the person's answer to it, and checks the strategist's plan.
 */

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import {
  PLAN_FORMATS, STEP_DEFAULTS, SUBTOPIC_COUNT, SUBTOPICS_EDITING_MAX, boardIntelligence, confirmSubtopics, intelligenceCounts, rankFormats, readPlan, readPosts,
  readSubtopics, savePlan, saveSubtopicsDraft, writeFormatsRank, writeProgress,
} from '../pipeline/brand-intelligence.mjs';

const string = { type: 'string' };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function knownBrand(root, brand) {
  const slug = typeof brand === 'string' ? brand.trim() : '';
  if (!runtime.listBrands({ root }).some(item => item.slug === slug)) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return slug;
}

const folderOf = brand => `workspaces/${brand}/library/intelligence`;

export const brandIntelligenceTools = [
  defineTool({
    name: 'brand_intelligence_get',
    description: [
      'Read one brand\'s intelligence: what onboarding learned about its niche. Changes nothing.',
      'Returns counts (posts taken apart: own, competitor, viral), the posts (id, pillar, platform, url, views or likes, date, the hook, the labels on the four format library axes and the subtopic, and where the board shows them), the subtopics (status draft or confirmed, each with its id, name, evidence post ids, top views), the formats ranking (the brand\'s best formats with their evidence, and their result score once posts have results), the plan (the 6 by 5 grid, stale when the confirmed subtopics changed since it was made), the checklist the board shows while the pass runs, and the folder of the files.',
      'The format library itself (the story structures, editing styles, visual hooks and series with their definitions) is pipeline/library/formats.json.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        posts: { type: 'boolean', description: 'Also return every post taken apart (not only the counts). Defaults to true.' },
      },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const board = boardIntelligence({ root, brand });
      return {
        brand,
        counts: intelligenceCounts({ root, brand }),
        ...(args.posts === false ? {} : { posts: readPosts({ root, brand }) }),
        subtopics: readSubtopics({ root, brand }),
        formats: rankFormats({ root, brand }),
        plan: readPlan({ root, brand }),
        status: board ? board.status : null,
        steps: board ? board.steps : [],
        newBrand: board ? board.newBrand : false,
        folder: folderOf(brand),
      };
    },
  }),
  defineTool({
    name: 'brand_intelligence_save',
    description: [
      'Write the parts of a brand\'s intelligence that onboarding does not file by itself. Only the Director calls this. The posts the researcher took apart (with their labels) are filed when pipeline_brand_research_save succeeds; the person\'s subtopic confirmation arrives as a board request (subtopics_confirm) and is applied with pipeline_board_request_apply.',
      `action progress keeps the onboarding checklist the board shows while the pass runs: pass step ({ id, state: done, running or todo, label?, detail? }) to change one step, or steps to replace the list, status running or ready, and newBrand true when the brand has no posts of its own yet. The standard step ids are ${STEP_DEFAULTS.map(([id]) => id).join(', ')} (their labels are filled in for you); the first call without steps gives the standard list, every step still to do. The checklist turns ready by itself when every step is done. Details are plain words for the person ("3 of 5 videos").`,
      `action subtopics_draft saves the draft of the six subtopics from the posts filed in posts.jsonl: items is [{ name, evidence: [post ids], source? }], the topics clustered from the posts' labels, hooks and captions, most viewed first (${SUBTOPIC_COUNT} of them; for a new company with few posts the topics also come from the website's offer, with no evidence). Each item gets its post count and top views from its evidence. A set the person already confirmed is kept unless replace is true. The board then asks the person to confirm.`,
      `action subtopics_confirm applies the person's answer when it came in chat: items is [{ id?, name }], exactly ${SUBTOPIC_COUNT} (an id in the draft keeps its evidence; a name without an id is one the person added). A board answer is applied by pipeline_board_request_apply instead.`,
      `action plan checks the strategist's plan and files it: it reads plan-draft.json in the brand's intelligence folder (or plan, passed here): { subtopics: [ids], formats: [${PLAN_FORMATS} format ids from the library], cells: [{ subtopic, format, idea, angle?, hook? }] }, one cell for every subtopic and format. It returns saved, or needs_changes with every problem; the strategist is then asked to rewrite the draft.`,
      'action rank rewrites the formats ranking from the posts and the results (it is also refreshed when a job is filed or results are read).',
      `At most ${SUBTOPICS_EDITING_MAX} subtopics while the person edits them.`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        action: { type: 'string', enum: ['progress', 'subtopics_draft', 'subtopics_confirm', 'plan', 'rank'] },
        status: { type: 'string', enum: ['running', 'ready'], description: 'progress: the checklist\'s state.' },
        newBrand: { type: 'boolean', description: 'progress: true when the brand has no posts of its own yet.' },
        step: {
          type: 'object',
          description: 'progress: one step to change or add.',
          properties: { id: string, state: { type: 'string', enum: ['done', 'running', 'todo'] }, label: string, detail: string },
          required: ['id'],
          additionalProperties: false,
        },
        steps: {
          type: 'array',
          description: 'progress: the whole checklist, replacing the old one.',
          items: {
            type: 'object',
            properties: { id: string, state: { type: 'string', enum: ['done', 'running', 'todo'] }, label: string, detail: string },
            required: ['id'],
            additionalProperties: false,
          },
        },
        items: {
          type: 'array',
          maxItems: SUBTOPICS_EDITING_MAX,
          description: 'subtopics_draft and subtopics_confirm: the subtopics.',
          items: {
            type: 'object',
            properties: {
              id: { ...string, description: 'subtopics_confirm: the id of a subtopic that is in the draft.' },
              name: { ...string, description: 'The subtopic in a few words.' },
              evidence: { type: 'array', items: string, maxItems: 40, description: 'subtopics_draft: the post ids (from posts.jsonl) that show it.' },
              source: { type: 'string', enum: ['data', 'yours'], description: 'subtopics_draft: data (from the posts) or yours.' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        replace: { type: 'boolean', description: 'subtopics_draft: replace a set the person already confirmed. Only when they asked to start over.' },
        plan: { type: 'object', description: 'plan: the plan, when it is passed here instead of read from plan-draft.json.' },
      },
      required: ['brand', 'action'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      if (args.action === 'progress') {
        const progress = writeProgress({ root, brand, status: args.status ?? null, steps: args.steps ?? null, step: args.step ?? null, newBrand: typeof args.newBrand === 'boolean' ? args.newBrand : undefined });
        return { brand, action: 'progress', ...progress };
      }
      if (args.action === 'subtopics_draft') {
        if (!Array.isArray(args.items)) throw new InvalidInputError('Pass the subtopics in items.', { fix: 'Each item is { name, evidence: [post ids] }.' });
        return { brand, action: 'subtopics_draft', ...saveSubtopicsDraft({ root, brand, items: args.items, replace: args.replace === true }) };
      }
      if (args.action === 'subtopics_confirm') {
        if (!Array.isArray(args.items)) throw new InvalidInputError('Pass the six subtopics in items.', { fix: 'Each item is { id?, name }.' });
        return { brand, action: 'subtopics_confirm', ...confirmSubtopics({ root, brand, items: args.items }) };
      }
      if (args.action === 'plan') {
        return { brand, action: 'plan', ...savePlan({ root, brand, plan: args.plan ?? null }), folder: folderOf(brand) };
      }
      const doc = writeFormatsRank({ root, brand });
      return { brand, action: 'rank', updatedAt: doc.updatedAt, formats: doc.formats.length };
    },
  }),
];
