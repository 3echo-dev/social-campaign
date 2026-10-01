import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { METRICOOL_BRAND_LIMIT, saveBrandsAndChoose } from '../pipeline/metricool.mjs';
import { chooseMetricoolBrandForJobs, refreshPlansForBrand } from '../pipeline/board.mjs';

const string = { type: 'string' };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const publishingConnectTools = [
  defineTool({
    name: 'pipeline_metricool_brands_save',
    description: 'Save the Metricool brands this account can post through, exactly as the Metricool connector\'s getBrandSettings returned them (its data list), so the board can show where each brand\'s posts go. Call integration_probe for metricool first, then this. It also gives each plugin brand that has no Metricool brand yet one: at once when Metricool has exactly one brand, otherwise it asks in the board\'s Inbox (waiting lists the brands still to be answered, asked the new questions). A chat answer to that question is applied with pipeline_metricool_brand_choose. A brand whose saved Metricool brand is gone is never replaced silently: it is listed in needsChoice (with the brand it had) and asked about, and the person must be told in one plain line. Returns the saved brands, chosen, asked, waiting and needsChoice; write the board documents afterwards so the Inbox shows any new question.',
    inputSchema: {
      type: 'object',
      properties: {
        brands: {
          type: 'array',
          maxItems: METRICOOL_BRAND_LIMIT,
          description: 'The brands from getBrandSettings: its data list, an empty list when the account has none.',
          items: {
            type: 'object',
            properties: {
              id: { description: 'The Metricool brand id (its blogId), from getBrandSettings.' },
              label: { ...string, description: 'The brand name in Metricool.' },
              timezone: { ...string, description: 'The brand time zone, such as Asia/Manila.' },
              networksData: {
                type: 'object',
                description: 'The connected accounts: facebookData, instagramData and tiktokData, as returned.',
                properties: { facebookData: {}, instagramData: {}, tiktokData: {} },
                additionalProperties: true,
              },
            },
            required: ['id'],
            additionalProperties: true,
          },
        },
      },
      required: ['brands'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const result = saveBrandsAndChoose({ root, brands: args.brands });
      // A brand given a Metricool brand just now gets its posting plans brought up to date too.
      for (const item of result.chosen) refreshPlansForBrand(root, item.brand);
      return result;
    },
  }),
  defineTool({
    name: 'pipeline_metricool_brand_choose',
    description: 'Save which saved Metricool brand a plugin brand posts through, for example when the person answers the Inbox question in chat. Pass the plugin brand and the blogId of one of the brands already saved with pipeline_metricool_brands_save; the brand must have a finished profile. Takes back the open Inbox question for that brand, so no other step is needed; write the board documents afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The plugin brand slug.' },
        blogId: { ...string, description: 'The id of a saved Metricool brand, from pipeline_metricool_brands_save.' },
      },
      required: ['brand', 'blogId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => chooseMetricoolBrandForJobs({ root: local(workspace), brand: args.brand, blogId: args.blogId }),
  }),
];
