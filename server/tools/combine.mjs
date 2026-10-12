import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import * as facts from '../pipeline/facts.mjs';
import { registerTakes, setCombineRow } from '../pipeline/combine.mjs';
import { addToLibrary, listLibrary } from '../pipeline/library.mjs';

const string = { type: 'string' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function jobOf(root, args) {
  const job = facts.jobAt(root, args.brand, args.jobId);
  if (!job) throw new Error('Job not found in this workspace.');
  return job;
}

export const combineTools = [
  tool('pipeline_library_list', "List the workspace library (one shelf of music and voice recordings for every brand, each item tagged with a brand and keeping its licence note), in plain words, with the ids to choose by. Filter by kind (music or voice) and by brand. Tracks saved on a brand's older music shelf are listed too.", { kind: { type: 'string', enum: ['music', 'voice'] }, brand: string }, [], (args, { workspace }) => listLibrary({ root: local(workspace), kind: args.kind || null, brand: args.brand || null })),
  tool('pipeline_library_add', "Add an audio file (an absolute local path to an mp3, wav, m4a or aac file) the person gave to the workspace library, tagged with a brand, without choosing it for a job. Never saved twice (same bytes). Optional title and licence (\"the brand's own\" by default).", { kind: { type: 'string', enum: ['music', 'voice'] }, brand: string, path: string, title: string, licence: string }, ['kind', 'brand', 'path'], async (args, { workspace }) => {
    const root = local(workspace);
    const { item, saved } = await addToLibrary({ root, kind: args.kind, path: args.path, brand: args.brand, title: args.title, licence: args.licence, origin: 'upload', addedFrom: 'library' });
    return { id: item.id, title: item.title, licence: item.licence, saved };
  }),
  tool('pipeline_combine_set', 'Settle one row of the combine card after the joined video was approved: row music or voice with source library (id), upload (path of the file the person gave, saved to the library with the job\'s brand tag), make (with take: the label of the ElevenLabs take the person picked, such as "Take 2"; without take it only marks the row as waiting for the made track) or none; row captions with source voice, script or none. Refused until the cut is approved with a finishing choice. Making music or voice is priced first and always needs the person\'s price click on the board.', { ...{ brand: string, jobId: string }, row: { type: 'string', enum: ['music', 'voice', 'captions'] }, source: { type: 'string', enum: ['library', 'upload', 'make', 'none', 'voice', 'script'] }, id: string, take: string, path: string, title: string, licence: string, why: string }, ['brand', 'jobId', 'row', 'source'], async (args, { workspace }) => {
    const root = local(workspace);
    return setCombineRow({ root, job: jobOf(root, args), row: args.row, source: args.source, id: args.id, take: args.take, path: args.path, title: args.title, licence: args.licence, why: args.why });
  }),
  tool('pipeline_combine_takes', 'Register the audio files ElevenLabs made for the music or voice-over row (after the person approved the price), as takes. They are saved in the job and in the workspace library (licence "made with ElevenLabs", tagged with the brand). One take is used at once. Several are shown side by side on a board question so the person picks one; the question id comes back and the answer is a take label, recorded with pipeline_combine_set (source make, take).', { ...{ brand: string, jobId: string }, kind: { type: 'string', enum: ['voice', 'music'] }, files: { type: 'array', minItems: 1, maxItems: 6, items: string, description: 'Absolute paths, or paths relative to the job folder, of the made audio files.' }, text: { ...string, description: 'Optional question wording.' } }, ['brand', 'jobId', 'kind', 'files'], async (args, { workspace }) => {
    const root = local(workspace);
    return registerTakes({ root, job: jobOf(root, args), kind: args.kind, files: args.files, text: args.text });
  }),
];
