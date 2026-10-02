import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { extractQcFrames, saveLabelCheck } from '../pipeline/label-qc.mjs';
import { reviewMediaPaths } from '../pipeline/board.mjs';

const string = { type: 'string' };
const textList = { type: 'array', items: string };

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

export const labelQcTools = [
  defineTool({
    name: 'pipeline_qc_frames',
    description: 'Take review stills for the label and brand-mark check from every image and video in a job: the finished media each post names (or the latest landed outputs when no post names any), every image or video registered for the pending review (a contact sheet included), plus every supplied source video or image. A video gets one still per scene change and at least one every 2 seconds at a size where small label text stays readable; an image is used as is unless it is huge. Pass paths only for an extra image or video that will be shown at the final approval and is not yet registered for the review. Returns each frame id with its local path, source file and time. Open every frame with Read, then save what each one shows with pipeline_qc_save.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        paths: { type: 'array', items: string, description: 'Optional extra image or video files, relative to the job folder or absolute.' },
      },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = brandSlug(root, args.brand);
      // The files the final approval will show are checked too, so a review picture no post names (a contact sheet) is never missed.
      let reviewPaths = [];
      try { reviewPaths = reviewMediaPaths({ root, brand, jobId: args.jobId }); } catch { reviewPaths = []; }
      return extractQcFrames({ root, brand, jobId: args.jobId, paths: args.paths, reviewPaths });
    },
  }),
  defineTool({
    name: 'pipeline_qc_save',
    description: 'Save the label and brand-mark check for the latest set of review stills from pipeline_qc_frames. Give one reading per frame: every word on the product, pack or on-screen captions exactly as printed and never corrected, the brand marks or logos seen, other writing in the scene, and optional notes. Refuses when any frame has no reading or a file changed since the stills were taken. Compares the text with the brand and product names and the approved on-screen copy, flags possible misspellings and unexpected text, and saves the check bound to the file contents. The final approval is refused until the check is current and every flag is fixed or accepted by the person.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        readings: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              frameId: string,
              text: { ...textList, description: 'Every word on the product, its pack or label, and every on-screen caption, letter by letter exactly as printed.' },
              marks: { ...textList, description: 'Every logo or brand mark, by the name it shows.' },
              scene: { ...textList, description: 'Other writing in the scene, such as street signs, shop fronts or screens.' },
              notes: string,
            },
            required: ['frameId', 'text', 'marks'],
            additionalProperties: false,
          },
        },
      },
      required: ['brand', 'jobId', 'readings'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      return saveLabelCheck({ root, brand: brandSlug(root, args.brand), jobId: args.jobId, readings: args.readings });
    },
  }),
];
