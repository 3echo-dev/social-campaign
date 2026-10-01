import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { getStudioWorkspace, saveStudioWorkspaceList } from '../pipeline/studio-workspace.mjs';
import { chooseStudioWorkspaceForJobs } from '../pipeline/board.mjs';

const string = { type: 'string' };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const studioWorkspaceTools = [
  defineTool({
    name: 'pipeline_studio_workspaces_save',
    description: 'Save the list of 3Echo Studio workspaces this account can charge, exactly as the connector\'s list_workspaces returned it, so the board can offer them on a job\'s price panel. Call this again whenever list_workspaces is read, since balances change.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaces: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              id: { ...string, description: 'The workspace id, from list_workspaces.' },
              name: { ...string, description: 'The workspace name, from list_workspaces.' },
              creditAvailable: { type: 'number', minimum: 0, description: 'Credits currently available in this workspace (displayBalanceCreds or creditAvailable from list_workspaces).' },
            },
            required: ['id', 'name', 'creditAvailable'],
            additionalProperties: false,
          },
        },
      },
      required: ['workspaces'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => saveStudioWorkspaceList(local(workspace), args.workspaces),
  }),
  defineTool({
    name: 'pipeline_studio_workspace_choose',
    description: 'Save which 3Echo Studio workspace pays for generation: the brand default when jobId is left out, or a one-job override when jobId is given. workspaceId must be one of the workspaces already saved with pipeline_studio_workspaces_save.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: { ...string, description: 'Only for a one-job override; leave out to set the brand default.' },
        workspaceId: string,
      },
      required: ['brand', 'workspaceId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => chooseStudioWorkspaceForJobs({ ...args, root: local(workspace) }),
  }),
  defineTool({
    name: 'pipeline_studio_workspace_get',
    description: 'Read which 3Echo Studio workspace currently pays for this brand, or this job when jobId is given: its id, name and saved credit balance, its source (job override or brand default), and every workspace saved with pipeline_studio_workspaces_save so a choice can be offered when none is made yet.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: { ...string, description: 'Include to also check for a one-job override.' },
      },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => getStudioWorkspace({ ...args, root: local(workspace) }),
  }),
];
