/**
 * The brand results tools: brand_results_save, brand_results_get.
 *
 * What a posted video earned (views, watch time, saves, ad spend) is kept beside the brand's library and tied to the lines and choices
 * the filed job used, so winners rank first in the bank and feed the next Concept A (see server/pipeline/brand-results.mjs for the
 * files and the score). Ads read with pipeline_ad_results_save and Metricool rows read by import-metrics.js are filed there already;
 * call brand_results_save for the rest, after reading Metricool or an ad account.
 */

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { RESULT_SOURCES, SCORE_WORDS, rankBank, readResults, recordResults } from '../pipeline/brand-results.mjs';

const string = { type: 'string' };
const amount = { type: ['number', 'string', 'null'] };

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

const metricProperties = {
  views: { ...amount, description: 'Plays or video views.' },
  reach: amount,
  impressions: amount,
  likes: amount,
  comments: amount,
  shares: amount,
  saves: amount,
  clicks: amount,
  watchPct: { ...amount, description: 'Average share of the video watched, as a percent from 0 to 100.' },
  avgWatchSec: { ...amount, description: 'Average watch time per view, in seconds.' },
  watchTimeSec: { ...amount, description: 'Total watch time, in seconds. The average is worked out from it when avgWatchSec is left out.' },
  durationSec: { ...amount, description: 'Video length in seconds. With avgWatchSec it gives watchPct when that is left out.' },
  spend: { ...amount, description: 'Paid only: what was spent, in the account currency.' },
  results: { ...amount, description: 'Paid only: conversions or leads.' },
  linkClicks: amount,
  thruplays: amount,
  ctr: { ...amount, description: 'Paid only: click rate as a fraction such as 0.012. Worked out from clicks and impressions when left out.' },
  cpa: { ...amount, description: 'Paid only: cost per result. Worked out from spend and results when left out.' },
  roas: { ...amount, description: 'Paid only: return on ad spend, for example 3.2.' },
  currency: { ...string, description: 'Paid only: the three-letter currency code.' },
  resultType: { ...string, description: 'Paid only: what a result is (purchase, lead).' },
};

export const brandResultsTools = [
  defineTool({
    name: 'brand_results_save',
    description: [
      'Save what a posted video or ad earned into the brand library, so the lines and choices the job used are ranked by how they did. Call it after you read Metricool analytics or an ad account for a posted job; read the numbers with the read-only tools first and pass them exactly as reported.',
      'One call is one post (give its postUrl) or one ad (paid, with its adId). Pass only numbers the source gave: an unknown number is left out, never 0.',
      'Pass postedAt (when it went live) when you know it: a post under 48 hours old is marked early. Pass hook only when this post or ad used a different opening line from the one the job picked, for example an ad variant.',
      'Saving the same numbers twice changes nothing, and reading a post again the same day keeps the later numbers. A job that is not filed in the library yet is filed.',
      'Replies with the saved reading, where the job stands (score, label, early), and any opening line that just became a winner and moved to the proven bank.',
      `Scoring: ${SCORE_WORDS}`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand slug.' },
        jobId: { ...string, description: 'The job the post came from.' },
        platform: { ...string, description: 'tiktok, instagram, facebook, youtube and so on.' },
        postUrl: { ...string, description: 'The https link of the public post (organic). Keeps two posts of one job apart.' },
        paid: { type: 'boolean', description: 'True for an ad. The default is an organic post.' },
        adId: { ...string, description: 'Paid only: the ad id from the ad account.' },
        variant: { ...string, description: 'The job draft this post or ad is, such as D1.' },
        hook: { ...string, description: 'The opening line this post or ad used, when it is not the line the job picked.' },
        postedAt: { ...string, description: 'When it went live (YYYY-MM-DD or a full date and time). For an ad, the day it started.' },
        at: { ...string, description: 'When the numbers were read. Defaults to now.' },
        source: { ...string, description: `Where the numbers came from: ${RESULT_SOURCES.join(', ')}. Defaults to manual.` },
        metrics: {
          type: 'object',
          description: 'The numbers, by name. Other names for the same thing (videoViews, avg_watch_pct, costPerResult) are read too.',
          properties: metricProperties,
          additionalProperties: true,
        },
      },
      required: ['brand', 'jobId', 'platform', 'metrics'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const out = recordResults({
        root, brand, jobId: args.jobId, platform: args.platform, postUrl: args.postUrl ?? null, paid: args.paid === true, adId: args.adId ?? null, variant: args.variant ?? null,
        hook: args.hook ?? null, postedAt: args.postedAt ?? null, at: args.at, source: args.source || 'manual', metrics: args.metrics,
      });
      return { brand, saved: out.saved, record: out.record, job: out.job, promoted: out.promoted.map(item => ({ jobId: item.jobId, text: item.item.text, kind: item.item.kind })) };
    },
  }),
  defineTool({
    name: 'brand_results_get',
    description: [
      'Read what the brand\'s posted results say. Changes nothing.',
      'Returns results (the latest readings, newest first), jobs (each job\'s score, label winner, average, weak or early, posts and views, with the reading behind each post), items (the yours and proven bank items that have results behind them, best first, each with score, uses, label and views),',
      'dimensions (the same for the concept source, style, call to action, format, angle, voice and music the filed jobs used), baseline (the brand\'s own medians per platform) and cutoffs.',
      'Pass jobId to see one job. A score of 1.0 is this brand\'s usual. Say the numbers when you use a winner; avoid a weak line unless the person asks.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand: { ...string, description: 'The brand slug.' }, jobId: { ...string, description: 'Only this job.' } },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const jobId = typeof args.jobId === 'string' && args.jobId.trim() ? args.jobId.trim() : null;
      const ranking = rankBank({ root, brand });
      return {
        brand, ...(jobId ? { jobId } : {}), hasResults: ranking.hasResults, how: ranking.how,
        results: readResults({ root, brand, jobId }),
        jobs: jobId ? ranking.jobs.filter(job => job.jobId === jobId) : ranking.jobs,
        items: ranking.items, dimensions: ranking.dimensions, baseline: ranking.baseline, cutoffs: ranking.cutoffs,
      };
    },
  }),
];
