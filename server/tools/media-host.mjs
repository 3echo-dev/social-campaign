import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { linkHosted, lookupHosted, uploadHosted } from '../pipeline/media-host.mjs';

const string = { type: 'string' };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function jobDirFor(root, brand, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Say which job this file belongs to.');
  const job = runtime.listJobs({ root, brand }).find(item => item.jobId === id);
  if (!job) throw new Error('This job could not be found.');
  return job.path;
}

const brand = { ...string, description: 'The brand the job belongs to.' };
const jobId = string;
const path = { ...string, description: 'The file, relative to the job folder (for example media/D1/final.mp4).' };
const workspaceId = { ...string, description: 'The 3Echo workspaceId the session was created in. It must be the 3Echo workspace named in the approved post plan, which pipeline_media_hosted returns as workspaceId.' };
const assetId = { ...string, description: 'The assetId from create_asset_upload_session.' };

function unwrap(result) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

export const mediaHostTools = [
  defineTool({
    name: 'pipeline_media_hosted',
    description: [
      'Check whether a local image or video of a job is already in the person\'s 3Echo Studio workspace, before creating an upload session.',
      'Answers hosted:true with the assetId (and appUrl when saved) to reuse when the same bytes were uploaded earlier or are a clip or image 3Echo generated for this job. A generated asset with workspaceId null is from an older job: confirm it with get_asset in planWorkspaceId before using it.',
      'Answers hosted:false with the workspaceId, mime, bytes and filename to pass to create_asset_upload_session as workspaceId, mimeType, sizeBytes and filename.',
      'Either answer also carries mime, bytes and filename. Sends nothing. The job needs a post plan the person approved, that names a 3Echo workspace and the file.',
    ].join(' '),
    inputSchema: { type: 'object', properties: { brand, jobId, path }, required: ['brand', 'jobId', 'path'], additionalProperties: false },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return unwrap(await lookupHosted({ jobDir: jobDirFor(root, args.brand, args.jobId), path: args.path }));
    },
  }),
  defineTool({
    name: 'pipeline_media_upload',
    description: [
      'Upload a local image or video of a job to the person\'s own 3Echo Studio workspace so a post can use it, with the bytes going straight from this computer to 3Echo\'s storage and never through chat.',
      'Call 3Echo create_asset_upload_session first (workspaceId, filename, mimeType, sizeBytes) and pass its uploadUrl, headers and assetId here exactly as returned, then call 3Echo complete_asset_upload.',
      'Refuses, sending nothing, unless workspaceId is the 3Echo workspace named in the approved post plan, uploadUrl is the 3Echo storage address for exactly that workspace and assetId, headers is exactly one Content-Type that matches the file, and the file is an image or video of at most 100 MB in this job\'s media or handoff folder that is named, with its sha256, in the job\'s approved post plan.',
      'Returns ok, assetId, bytes and sha256, and records the file in publish/hosted-media.json. When the same bytes are already hosted it sends nothing and returns reused:true with the earlier assetId.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand,
        jobId,
        path,
        uploadUrl: { ...string, description: 'The uploadUrl from create_asset_upload_session, exactly as returned.' },
        headers: { type: 'object', additionalProperties: string, description: 'The headers from create_asset_upload_session, exactly as returned.' },
        assetId,
        workspaceId,
      },
      required: ['brand', 'jobId', 'path', 'uploadUrl', 'headers', 'assetId', 'workspaceId'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return unwrap(await uploadHosted({ jobDir: jobDirFor(root, args.brand, args.jobId), path: args.path, uploadUrl: args.uploadUrl, headers: args.headers, assetId: args.assetId, workspaceId: args.workspaceId }));
    },
  }),
  defineTool({
    name: 'pipeline_media_link',
    description: [
      'After 3Echo complete_asset_upload, save the asset\'s appUrl with the uploaded file so the posting kit can link to it.',
      'The appUrl must be exactly https://agentc.3echo.ai/assets/<assetId>?workspaceId=<workspaceId> for this asset, and the file must already have been uploaded as that asset by pipeline_media_upload.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand, jobId, path, workspaceId, assetId, appUrl: { ...string, description: 'The appUrl from complete_asset_upload, exactly as returned.' } },
      required: ['brand', 'jobId', 'path', 'workspaceId', 'assetId', 'appUrl'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return unwrap(await linkHosted({ jobDir: jobDirFor(root, args.brand, args.jobId), path: args.path, workspaceId: args.workspaceId, assetId: args.assetId, appUrl: args.appUrl }));
    },
  }),
];
