/**
 * The brand trends tool: brand_trends_save.
 *
 * The Trend Scout files what is rising now in the brand's industry (see server/pipeline/brand-trends.mjs for the file and the rules),
 * so a job in the next week starts from it and Concept C names a trend that was really seen. It also files the hooks and captions of
 * ads that keep running. Reading them is brand_library_get.
 */

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { EVIDENCE_SOURCES, MAX_EVIDENCE, MAX_RUNNING_DAYS, MAX_TRENDS_PER_SAVE, TREND_KINDS, TREND_MAX_AGE_DAYS, WINNER_RUNNING_DAYS, freshTrends, saveTrends } from '../pipeline/brand-trends.mjs';
import { backfillBrandThumbs } from '../pipeline/post-thumbs.mjs';

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

export const brandTrendsTools = [
  defineTool({
    name: 'brand_trends_save',
    description: [
      'Save the trends the Trend Scout found into the brand library, so later jobs reuse them instead of searching again. Only the Trend Scout calls this, after it has read the posts.',
      'One item is one rising topic, format, sound or hashtag on one platform, in the brand\'s industry, or the hook (opening line) or caption (primary text) of an ad that keeps running. Every item needs evidence: the https link of a post, ad or page that shows it, with its views and date exactly as the source displays them (leave a number or date out when it is not shown, never estimate one).',
      `An ad has no views or spend in the Meta Ad Library or TikTok Top Ads, so its evidence carries what stands in for them: startedAt (the day it started), runningDays (how many days it had run when you saw it; ${WINNER_RUNNING_DAYS} or more is a likely winner), variants (how many ads use the same text), advertiser and source (${EVIDENCE_SOURCES.join(', ')}). Use the ad snapshot link as the url, and say in why that days running is the proxy. Pass these only when the source gave them.`,
      'Any evidence entry may also carry thumbnail, the https address of the picture of the post or ad so the board can draw it: the thumbnail_url a social tool returned for that post, or for an ad the thumbnail_url of its ad record (TikTok Top Ads records have one; never use a media_urls video file). Pass it as the tool gave it and leave it out when the tool gave none; never build or guess one. An address that is not https, carries a user name or password, or is over 600 characters is dropped, and the trend is still saved.',
      `A trend seen again on the same platform (same kind, same words, ignoring case and punctuation) is not added twice: it is updated, with when it was seen now and the new evidence added in front of the old. A trend is fresh for ${TREND_MAX_AGE_DAYS} days after it was last seen; brand_library_get lists the fresh ones.`,
      'Industry defaults to the person\'s industry pick in the library. Why is one plain line on why the trend fits this brand.',
      `Pass at most ${MAX_TRENDS_PER_SAVE} items. Every item is checked first, and when one is wrong nothing is saved and the reply names it. Returns saved (each with its id, kind, text, platform, industry, seenAt and status new or updated), created, updated and fresh (how many trends the brand has now that are under ${TREND_MAX_AGE_DAYS} days old).`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_TRENDS_PER_SAVE,
          description: 'The trends to save.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: TREND_KINDS, description: 'topic (a subject people are posting about), format (a way of making the video), sound (a song or audio), hashtag, hook (the opening line of an ad that keeps running) or caption (its primary text).' },
              text: { ...string, description: 'The trend in plain words: the topic, the format\'s name, the sound\'s title and artist, the hashtag, or for an ad the opening line (hook) or the primary text (caption) as the ad shows it.' },
              platform: { ...string, description: 'Where it is rising: tiktok, instagram, facebook, youtube and so on.' },
              industry: { ...string, description: 'The industry it was found for. Defaults to the person\'s industry pick.' },
              evidence: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_EVIDENCE,
                description: 'The posts, ads or pages that show it. At least one.',
                items: {
                  type: 'object',
                  properties: {
                    url: { ...string, description: 'The https link of the post, the ad snapshot or the page.' },
                    views: { type: 'number', description: 'Views as displayed. Leave out when not shown.' },
                    date: { ...string, description: 'When the post was published, as YYYY-MM-DD. Leave out when not shown.' },
                    startedAt: { ...string, description: 'Ads only: the day the ad started running, as YYYY-MM-DD.' },
                    runningDays: { type: 'integer', minimum: 0, maximum: MAX_RUNNING_DAYS, description: 'Ads only: how many days the ad had been running when you saw it.' },
                    variants: { type: 'integer', minimum: 1, description: 'Ads only: how many ads use the same text.' },
                    advertiser: { ...string, description: 'Ads only: the advertiser or page name.' },
                    source: { type: 'string', enum: EVIDENCE_SOURCES, description: 'Where it was seen: the Meta Ad Library, TikTok Top Ads or an organic post.' },
                    thumbnail: { ...string, description: 'The https address of the picture of the post or ad: the thumbnail_url a social tool returned for the post or ad record. Leave out when none was given.' },
                  },
                  required: ['url'],
                  additionalProperties: false,
                },
              },
              why: { ...string, description: 'One plain line on why it fits this brand.' },
            },
            required: ['kind', 'text', 'platform', 'evidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['brand', 'items'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const out = saveTrends({ root, brand, items: args.items });
      // The posts and ads that show the trends get their small picture now, for the board's cards (post-thumbs.mjs).
      await backfillBrandThumbs({ root, brand, limit: 20, remoteLimit: 16, deadlineMs: 25000 });
      return { brand, ...out, fresh: freshTrends({ root, brand }).length };
    },
  }),
];
