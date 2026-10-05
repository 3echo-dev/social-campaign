import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { declineHandoff, handoffStatus, prepareHandoff, recordStarted, returnHandoff } from '../pipeline/handoff.mjs';

const string = { type: 'string' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

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

const ref = { brand: string, jobId: string };

export const handoffTools = [
  tool('pipeline_handoff_post_prepare', "Get a finished video job ready to send to Post-production (only when it is installed). Builds the hand-over folder from the job's made clips, outside the job and the Post-production folders, and returns startSkill (the exact skill name to run) and args (client, title, footageFolder, releaseFolder, aspectRatio, deliverableDurationSec, audioLed, footageSource, referenceCutPath) plus startArguments, the same as one line. Run that skill with exactly those arguments, then call pipeline_handoff_post_started. Refuses in plain words when Post-production or its spreadsheet helper is missing, or the video shape is not supported.", ref, ['brand', 'jobId'], (args, { workspace }) => {
    const root = local(workspace);
    return prepareHandoff({ root, brand: brandSlug(root, args.brand), jobId: args.jobId });
  }),
  tool('pipeline_handoff_post_started', 'Record that the Post-production job was started for this video, with its job id and its job folder (both from the start skill result). From then on the job is waiting on Post-production.', { ...ref, studioJobId: string, studioJobDir: { ...string, description: 'The absolute path of the Post-production job folder.' } }, ['brand', 'jobId', 'studioJobId', 'studioJobDir'], (args, { workspace }) => {
    const root = local(workspace);
    return recordStarted({ root, brand: brandSlug(root, args.brand), jobId: args.jobId, studioJobId: args.studioJobId, studioJobDir: args.studioJobDir });
  }),
  tool('pipeline_handoff_post_status', 'Where this video stands with Post-production, as one plain line, read from the Post-production job without changing it. Returns status (suggested, sent, released, returned or null), line, and next: offer (ask whether to send it), wait (it is with Post-production), offer_return (ask whether to bring the final video back), continue (it is back) or none. Marks the job released once Post-production says so. Call it on each board sync for a video job.', ref, ['brand', 'jobId'], (args, { workspace }) => {
    const root = local(workspace);
    return handoffStatus({ root, brand: brandSlug(root, args.brand), jobId: args.jobId });
  }),
  tool('pipeline_handoff_post_return', "Bring the final video back from Post-production once it is released. Copies the video into the job as the deliverable's final video (the newest export in the Post-production job unless filePath is given), keeps the earlier cut beside it, records its hash, and sends a job already past the checks back to them. Then run the logo and label check and the final approval on the new video.", { ...ref, filePath: { ...string, description: 'Optional absolute path of the final video; otherwise the newest export in the Post-production job.' } }, ['brand', 'jobId'], (args, { workspace }) => {
    const root = local(workspace);
    return returnHandoff({ root, brand: brandSlug(root, args.brand), jobId: args.jobId, filePath: args.filePath ?? null });
  }),
  tool('pipeline_handoff_post_decline', 'Record that the person does not want this video sent to Post-production (or wants to finish it here instead). The job carries on in Social Campaign as usual.', ref, ['brand', 'jobId'], (args, { workspace }) => {
    const root = local(workspace);
    return declineHandoff({ root, brand: brandSlug(root, args.brand), jobId: args.jobId });
  }),
];
