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
  BANKS, BANK_KINDS, PROVEN_SOURCES, addToBank, bankKindCounts, boardLibrary, editBankItem, fileJob, readBank, readFiledJobs, readPreferences, readProven, removeBankItem, researchIndex,
} from '../pipeline/brand-library.mjs';
import { AWARENESS_STAGES, CTA_TYPES } from '../pipeline/brand-bank-items.mjs';
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
      'Returns counts, industry (the person\'s industry pick, or null), yours (the person\'s own lines, to use word for word), proven (what worked, each with its evidence: link, views (or likes for Instagram, which shows a signed-out reader no views), date, a thumbnail picture address when the post had one, and whether it came from the brand or a competitor),',
      'research (the research files already done, newest per topic, each with its age in days and whether it is young enough to reuse: brand and competitor research under 30 days, trends under 7),',
      'recentJobs (the last jobs filed, with their concept, opening line, how many approved media files and, once posted, their results: score, label and views), and preferences (what the person chose lately and what they passed on).',
      'Once posts have results, yours and proven come best first, each item with score (1.0 is the brand\'s usual), uses (how many jobs it rests on) and label (winner, average, weak or early; null when there are no results). Prefer winners, say their numbers, and avoid weak ones unless the person asks.',
      'trends lists what the Trend Scout found in the last 7 days (each with its kind, platform, industry, evidence links with views and dates, and when it was seen; empty when there are none): rising topics, formats, sounds and hashtags, and the hooks and captions of ads that keep running, whose evidence carries days running and variants because the ad libraries show no views. Reuse them for Concept C and the hook options instead of searching again.',
      'Pass kind to see one whole bank: hook, caption, cta, format, style, angle, industry, funnel, or the audience banks pain, desire and objection. yours and proven then hold every item of that kind (up to limit), and trends are left out.',
      'The audience banks hold what the audience says in its own words (text), who says it (who), how aware of the problem they are (awarenessStage), how often it came up (count) and quotes ([{ text, url, date }] with the page each came from); the pains that came up most come first. An angle is a pain matched with a proof (pain, proof). A caption has its structure and a cta its ctaType. Every item has a source: brand, competitor, community, review, ad or starter (the person\'s own lines are in yours).',
      'kinds counts the items of each kind in both banks, so you know which banks to ask for. Name the id of every item you use.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        kind: { type: 'string', enum: BANK_KINDS, description: 'Only items of this kind: the whole bank of that kind.' },
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
        kinds: bankKindCounts({ root, brand }),
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
      '"proven" holds what worked, and every proven item needs the https link of the post it comes from, with its views (or likes for Instagram), date and thumbnail picture when known (evidence), and whether it came from the brand\'s own posts or a competitor\'s (source).',
      'An item learned from a file in the brand\'s own footage library (brand_footage_analysis_save feeds these by itself) names that file in evidence.file instead of a link.',
      'Save to "yours" only what the person said or chose, or when they ask you to; never invent their words. Saving the same words twice keeps one item.',
      'action add needs kind and text. action edit needs id and the new text (the old words are kept as "was"). action remove needs id; it is also how a board request to remove an item is carried out.',
      'Kinds: hook, angle, style, cta, caption, format, industry, funnel, and the audience banks pain, desire and objection (the problem, want or doubt in the customer\'s own words).',
      'A proven pain, desire or objection carries who (who has it), awarenessStage (unaware, problem_aware, solution_aware, product_aware or most_aware), count (how many times it came up) and quotes ([{ text, url, date }]: words copied from a page you read, with its https link); it needs no evidence, because its first quote is its proof, and its source is community (a forum or comments), review, ad, competitor or brand.',
      'An angle is a pain matched with a proof: text is the line, pain the pain it answers (painId when that pain is in the bank) and proof the claim that backs it. A caption can carry its structure ({ hook, body, cta, hashtags }) and a cta its ctaType.',
      'Saving the same words again adds the new quotes to the item and counts them, and changes nothing when there is nothing new. Returns the item and whether anything changed, plus the bank counts.',
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
            url: { ...string, description: 'The https link of the post. Required for a proven item, unless it was learned from the brand\'s own footage (then pass file instead).' },
            file: {
              type: 'object',
              description: 'A proven item learned from a file in the brand\'s own footage library instead of a post: the file is the proof. Never a path.',
              properties: { fileId: { ...string, description: 'The fileId from brand_footage_search.' }, name: { ...string, description: 'The file\'s name.' }, kind: { type: 'string', enum: ['video', 'image'] }, folder: { ...string, description: 'The folder\'s name.' } },
              required: ['fileId', 'name'],
              additionalProperties: false,
            },
            views: { type: 'number', description: 'How many views it had.' },
            likes: { type: 'number', description: 'How many likes it had. Only for an Instagram post, which shows no views to a signed-out reader; leave out when views are given.' },
            date: { ...string, description: 'When it was posted, as YYYY-MM-DD. posted_at is accepted too.' },
            posted_at: { ...string, description: 'Same as date.' },
            thumbnail: { ...string, description: 'The https address of the thumbnail picture of the post, as a social read returned it in thumbnail_url, so the board can draw the post. Leave it out when the read gave none; an address that is not https, carries a user name or password, or is over 600 characters is dropped.' },
          },
          additionalProperties: false,
        },
        source: { type: 'string', enum: PROVEN_SOURCES, description: 'Proven items only: brand (one of the brand\'s own posts, the default), competitor, community (a forum, comments), review, ad, or starter (the plugin\'s own line, needs no link).' },
        competitor: { ...string, description: 'Proven items from a competitor, a review of one or one of its ads: the competitor\'s name.' },
        who: { ...string, description: 'Pain, desire and objection items: who has it, in a few words, for example office workers who use ChatGPT.' },
        awarenessStage: { type: 'string', enum: AWARENESS_STAGES, description: 'Pain, desire and objection items: how aware of the problem the people are.' },
        count: { type: 'integer', minimum: 1, maximum: 9999, description: 'Pain, desire and objection items: how many comments, reviews or posts you read that said it.' },
        quotes: {
          type: 'array',
          maxItems: 5,
          description: 'Pain, desire and objection items: words copied from pages you read, each with the https link of its page.',
          items: {
            type: 'object',
            properties: { text: { ...string, description: 'The words, exactly as the page has them.' }, url: { ...string, description: 'The https link of the page.' }, date: { ...string, description: 'When it was written, as YYYY-MM-DD, if the page shows it.' } },
            required: ['text', 'url'],
            additionalProperties: false,
          },
        },
        pain: { ...string, description: 'Angle items: the text of the pain the angle answers.' },
        painId: { ...string, description: 'Angle items: the id of that pain in the bank, when it is there.' },
        proof: { ...string, description: 'Angle items: the claim, number or result that backs the angle.' },
        structure: {
          type: 'object',
          description: 'Caption items: how the caption is built.',
          properties: { hook: string, body: string, cta: string, hashtags: { type: 'array', items: string, maxItems: 8 } },
          additionalProperties: false,
        },
        ctaType: { type: 'string', enum: CTA_TYPES, description: 'Cta items: what kind of ask it is.' },
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
          details: {
            who: args.who, awarenessStage: args.awarenessStage, count: args.count, quotes: args.quotes, pain: args.pain, painId: args.painId,
            proof: args.proof, structure: args.structure, ctaType: args.ctaType,
          },
        });
        return { brand, bank, action: 'add', item: out.item, changed: out.saved || out.merged === true, counts: counts(root, brand) };
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
      'A job with nothing approved yet is not filed, and the reply says so. Filing also adds what the job\'s researchers learned about the audience (the research/banks-*.json files they wrote) to the brand\'s banks, each quote checked against the pages the job saved, even when nothing else is approved. Returns filed, changed, jobId and the record.',
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
