import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { addMusic, chooseMusic, listMusic } from '../pipeline/music.mjs';

const string = { type: 'string' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const musicTools = [
  tool('pipeline_music_add', "Add a music file the person gave (an absolute local path to an mp3, wav, m4a or aac file) to a video job. It is checked to be audio, copied into the job and saved in the workspace library for later, tagged with the brand (never twice), and becomes the job's music. Optional title (the file name by default) and licence (\"the brand's own\" by default).", { brand: string, jobId: string, path: string, title: string, licence: string }, ['brand', 'jobId', 'path'], (args, { workspace }) => addMusic({ root: local(workspace), ...args })),
  tool('pipeline_music_list', "List the library's music tagged with a brand (and the brand's older shelf), in plain words, with the ids to choose by. pipeline_library_list shows every brand's items and the voice recordings.", { brand: string }, ['brand'], (args, { workspace }) => listMusic({ root: local(workspace), brand: args.brand })),
  tool('pipeline_music_choose', "Record the music for a video job: a track id from the library, or none. Say briefly why it fits.", { brand: string, jobId: string, id: { ...string, description: 'A library track id, or none.' }, why: string }, ['brand', 'jobId', 'id'], (args, { workspace }) => chooseMusic({ root: local(workspace), ...args })),
];
