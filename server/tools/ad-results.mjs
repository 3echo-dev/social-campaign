import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { AD_RESULT_LEVELS, AD_RESULT_METRICS, AD_RESULTS_ROW_LIMIT, readAdResults, saveAdResults } from '../pipeline/ad-results.mjs';
import { AD_PROVIDERS } from '../pipeline/ad-accounts.mjs';

const string = { type: 'string' };
const amount = { type: ['number', 'string', 'null'] };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function brandSlug(root, brand) {
  const value = String(brand || '').trim();
  if (value && existsSync(join(root, 'workspaces', value, 'workspace.json'))) return value;
  const match = runtime.listBrands({ root }).find(entry => entry.id === value || entry.brandId === value || entry.slug === value);
  return match ? match.slug : value;
}

const rowProperties = {
  id: { ...string, description: 'The ad, ad set or campaign id exactly as the connector gave it.' },
  name: { ...string, description: 'Its name in Ads Manager.' },
  campaignName: string,
  adsetName: string,
  variant: { ...string, description: 'The job draft this ad is, such as D1, once the person has confirmed the match. Leave it out when not matched.' },
  resultType: { ...string, description: 'What a result is for this ad (purchase, lead, link click), as the connector named it.' },
  ...Object.fromEntries(AD_RESULT_METRICS.map(field => [field, { ...amount, description: `The ${field} the connector reported. Leave it out when it did not report it; never put 0 for unknown.` }])),
};

export const adResultsTools = [
  defineTool({
    name: 'pipeline_ad_results_save',
    description:
      'Save ad results read from the Meta Ads or TikTok for Business connector into a job, so the board shows them in the job\'s files as "Ad results". ' +
      'Read the results first with the connector\'s read-only tools only (Meta: ads_get_ad_entities and ads_insights_*; TikTok: report_integrated_get), ' +
      'for the ad account chosen for the job\'s brand, then pass one row per ad with the numbers exactly as reported. ' +
      'Never call a tool that creates, edits, turns on or pauses anything in an ad account. ' +
      'Totals, click rate, cost per click, cost per thousand views and cost per result are worked out here in code, never by you; an unknown number stays unknown. ' +
      'One call is one ad account, one currency, one level and one date range; saving the same range again replaces it. ' +
      'Returns the totals, rates, which totals are partial, and unmatched (ads not yet matched to a job draft): ask the person which draft each one is before calling it a result of this job.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        provider: { type: 'string', enum: AD_PROVIDERS },
        accountId: { ...string, description: 'The ad account the rows came from; it must be the one chosen for this brand.' },
        currency: { ...string, description: 'The account currency, a three-letter code such as USD.' },
        dateStart: { ...string, description: 'First day of the range, YYYY-MM-DD, in the account time zone.' },
        dateEnd: { ...string, description: 'Last day of the range, YYYY-MM-DD.' },
        level: { type: 'string', enum: AD_RESULT_LEVELS, description: 'ad (default), adset or campaign. Never mix levels in one call.' },
        sourceTool: { ...string, description: 'The base name of the connector tool the numbers came from.' },
        rows: {
          type: 'array',
          maxItems: AD_RESULTS_ROW_LIMIT,
          items: { type: 'object', properties: rowProperties, required: ['id'], additionalProperties: false },
        },
      },
      required: ['brand', 'jobId', 'provider', 'accountId', 'currency', 'dateStart', 'dateEnd', 'rows'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      return saveAdResults({
        root,
        brand: brandSlug(root, args.brand),
        jobId: args.jobId,
        provider: String(args.provider),
        accountId: args.accountId,
        currency: args.currency,
        dateStart: args.dateStart,
        dateEnd: args.dateEnd,
        level: args.level || 'ad',
        sourceTool: args.sourceTool ?? null,
        rows: args.rows,
      });
    },
  }),

  defineTool({
    name: 'pipeline_ad_results_read',
    description: 'The ad results already saved in a job, newest date range first, with their totals and rates. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { brand: string, jobId: string },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const job = runtime.resolveJobDir({ root, brand: brandSlug(root, args.brand), jobId: args.jobId });
      return { ok: true, results: readAdResults(job.dir) };
    },
  }),
];
