import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { prepareReviewCopies, recordReviewUploads, reviewCopiesCleanup } from '../pipeline/review-copies.mjs';

const string = { type: 'string' };

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

export const reviewCopiesTools = [
  defineTool({
    name: 'pipeline_review_copies_prepare',
    description: 'Make small review copies (mp4 H.264, webp or jpeg, each under 20 MiB) of the job\'s review media: every landed output in generation/landed.jsonl and every file named in each drafts/D*/post.md. Returns the local copy paths still needing an upload, each with its source sha, plus every copy already uploaded with its asset url. Upload the new ones with the Artifact tool (asset: true, file_paths) against the bound board, then write the board.',
    inputSchema: {
      type: 'object',
      properties: { brand: string, jobId: string },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return prepareReviewCopies({ root, brand: brandSlug(root, args.brand), jobId: args.jobId });
    },
  }),
  defineTool({
    name: 'pipeline_review_copies_record',
    description: 'Manual fallback for recording a review copy upload, for when the automatic hook could not read the asset id and url from the Artifact tool result. Give the local copy path returned by pipeline_review_copies_prepare together with the assetId and url the Artifact tool returned for it.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { path: string, assetId: string, url: string },
            required: ['path', 'assetId', 'url'],
            additionalProperties: false,
          },
        },
      },
      required: ['brand', 'jobId', 'items'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      return recordReviewUploads({ root, brand: brandSlug(root, args.brand), jobId: args.jobId, items: args.items });
    },
  }),
  defineTool({
    name: 'pipeline_review_copies_cleanup',
    description: 'After a job\'s final approval or cancellation, list the review copies still uploaded to the board so they can be taken down. Pass force to clean up a cancelled job before its state file catches up. Returns each uploaded copy\'s asset id and url, plus the plain step to delete them with the Artifact tool (action delete, path = id).',
    inputSchema: {
      type: 'object',
      properties: { brand: string, jobId: string, force: { type: 'boolean' } },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return reviewCopiesCleanup({ root, brand: brandSlug(root, args.brand), jobId: args.jobId, force: args.force === true });
    },
  }),
];
