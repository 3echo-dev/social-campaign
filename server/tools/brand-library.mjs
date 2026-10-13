/**
 * The brand library tools: brand_library_get, brand_bank_save, brand_library_file_job.
 *
 * The library is a brand's own shelf of what worked and what the person wrote (see server/pipeline/brand-library.mjs for the files).
 * Reading it is free. Saving to it is the person's choice: the "yours" bank holds the person's own words, so an agent adds to it only
 * on the person's word. Filing a finished job is idempotent.
 */

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import {
  BANKS, BANK_KINDS, PROVEN_SOURCES, addToBank, boardLibrary, editBankItem, fileJob, readBank, readFiledJobs, readPreferences, readProven, removeBankItem, researchIndex,
} from '../pipeline/brand-library.mjs';
import { jobResults } from '../pipeline/brand-results.mjs';
import { freshTrends } from '../pipeline/brand-trends.mjs';

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

const counts = (root, brand) => boardLibrary({ root, brand }).counts;

export const brandLibraryTools = [
  defineTool({
    name: 'brand_library_get',
    description: [
      'Read one brand\'s library: what the brand already has, so a job starts from it instead of from nothing. Changes nothing.',
      'Returns counts, industry (the person\'s industry pick, or null), yours (the person\'s own lines, to use word for word), proven (what worked, each with its evidence: link, views, date, and whether it came from the brand or a competitor),',
      'research (the research files already done, newest per topic, each with its age in days and whether it is young enough to reuse: brand and competitor research under 30 days, trends under 7),',
      'recentJobs (the last jobs filed, with their concept, opening line, how many approved media files and, once posted, their results: score, label and views), and preferences (what the person chose lately and what they passed on).',
      'Once posts have results, yours and proven come best first, each item with score (1.0 is the brand\'s usual), uses (how many jobs it rests on) and label (winner, average, weak or early; null when there are no results). Prefer winners, say their numbers, and avoid weak ones unless the person asks.',
      'trends lists what the Trend Scout found in the last 7 days (each with its kind, platform, industry, evidence links with views and dates, and when it was seen; empty when there are none): rising topics, formats, sounds and hashtags, and the hooks and captions of ads that keep running, whose evidence carries days running and variants because the ad libraries show no views. Reuse them for Concept C and the hook options instead of searching again.',
      'Pass kind to see only one kind of item (hook, angle, style, cta, caption, format, industry or funnel); trends are then left out.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        kind: { type: 'string', enum: BANK_KINDS, description: 'Only items of this kind.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Most items to return from each list. Defaults to 50.' },
      },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const limit = Number.isInteger(args.limit) ? args.limit : 50;
      const kind = args.kind || null;
      const proven = readProven({ root, brand, kind });
      const results = jobResults({ root, brand });
      return {
        brand,
        counts: boardLibrary({ root, brand }).counts,
        industry: readBank({ root, brand, bank: 'yours', kind: 'industry', limit: 1 })[0] ?? null,
        yours: readBank({ root, brand, bank: 'yours', kind, limit }),
        proven: proven.slice(0, limit).map(item => ({ ...item, source: item.source || 'brand' })),
        research: researchIndex({ root, brand }),
        trends: kind ? [] : freshTrends({ root, brand, limit }),
        recentJobs: readFiledJobs({ root, brand, limit: 10 }).map(record => ({ jobId: record.jobId, title: record.title, filedAt: record.filedAt, concept: record.concept, music: record.music, mediaCount: (record.media || []).length, ...(results.has(record.jobId) ? { results: results.get(record.jobId) } : {}) })),
        preferences: readPreferences({ root, brand, limit: 5 }),
      };
    },
  }),
  defineTool({
    name: 'brand_bank_save',
    description: [
      'Add to, edit or remove an item in a brand\'s bank. Two banks: "yours" (the default) holds the person\'s own lines and picks, such as an opening line they wrote, their industry or a call to action they like;',
      '"proven" holds what worked, and every proven item needs the https link of the post it comes from, with its views and date when known (evidence), and whether it came from the brand\'s own posts or a competitor\'s (source).',
      'Save to "yours" only what the person said or chose, or when they ask you to; never invent their words. Saving the same words twice keeps one item.',
      'action add needs kind and text. action edit needs id and the new text (the old words are kept as "was"). action remove needs id; it is also how a board request to remove an item is carried out.',
      'Kinds: hook, angle, style, cta, caption, format, industry, funnel. Returns the item and whether anything changed, plus the bank counts.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        action: { type: 'string', enum: ['add', 'edit', 'remove'] },
        bank: { type: 'string', enum: BANKS, description: 'yours (the person\'s own, the default) or proven (what worked, with its evidence).' },
        kind: { type: 'string', enum: BANK_KINDS, description: 'What the item is. Needed to add.' },
        text: { ...string, description: 'The words. Needed to add and to edit.' },
        id: { ...string, description: 'The item id from brand_library_get. Needed to edit and to remove.' },
        evidence: {
          type: 'object',
          description: 'Proven items only: where it was seen.',
          properties: {
            url: { ...string, description: 'The https link of the post. Required for a proven item.' },
            views: { type: 'number', description: 'How many views it had.' },
            date: { ...string, description: 'When it was posted, as YYYY-MM-DD. posted_at is accepted too.' },
            posted_at: { ...string, description: 'Same as date.' },
          },
          additionalProperties: false,
        },
        source: { type: 'string', enum: PROVEN_SOURCES, description: 'Proven items only: brand (one of the brand\'s own posts, the default) or competitor.' },
        competitor: { ...string, description: 'Proven items from a competitor: the competitor\'s name.' },
        concept: { ...string, description: 'Yours items only: the concept letter the line came from, for example B.' },
        jobId: { ...string, description: 'The job the item came from, if any.' },
        was: { ...string, description: 'Yours items only: the words this was edited from.' },
      },
      required: ['brand', 'action'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const bank = args.bank || 'yours';
      if (args.action === 'add') {
        if (!args.kind) throw new InvalidInputError('Say what kind of item this is.', { fix: `Use one of ${BANK_KINDS.join(', ')}.` });
        const out = addToBank({
          root, brand, bank, kind: args.kind, text: args.text, concept: args.concept ?? null, jobId: args.jobId ?? null, evidence: args.evidence ?? null,
          source: args.source ?? null, competitor: args.competitor ?? null, edited: typeof args.was === 'string' && args.was.trim() !== '', was: args.was ?? null,
        });
        return { brand, bank, action: 'add', item: out.item, changed: out.saved, counts: counts(root, brand) };
      }
      if (!args.id) throw new InvalidInputError('Say which item, with the id from brand_library_get.');
      if (args.action === 'edit') {
        const out = editBankItem({ root, brand, bank, id: args.id, text: args.text });
        return { brand, bank, action: 'edit', item: out.item, changed: out.changed, counts: counts(root, brand) };
      }
      const out = removeBankItem({ root, brand, bank, id: args.id });
      return { brand, bank, action: 'remove', item: out.item, changed: out.removed, counts: counts(root, brand) };
    },
  }),
  defineTool({
    name: 'brand_library_file_job',
    description: [
      'File a job in its brand\'s library once its final media is approved: a record that points at the job\'s approved pictures and videos, script, captions, music and voice, the research it left, and the concept it used. Nothing is copied.',
      'Safe to call again: filing the same job twice changes nothing, and filing it after more was approved updates the record. The board does this itself when the final media or the final post is approved and when a job is closed, so call it only to be sure.',
      'A job with nothing approved yet is not filed, and the reply says so. Returns filed, changed, jobId and the record.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand: { ...string, description: 'The brand slug.' }, jobId: string },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return fileJob({ root, brand: knownBrand(root, args.brand), jobId: args.jobId });
    },
  }),
];
