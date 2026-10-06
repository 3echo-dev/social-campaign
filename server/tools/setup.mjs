/** Optional research helper setup. */

import { defineTool } from '../mcp/registry.mjs';
import { CRAWL4AI_VERSION, detect, installPlan, installProgress, readRecord, startInstall, writeRecord } from '../setup/research-helper.mjs';
import { hasUsableResearchHelperRecord, researchHelperChildEnv } from '../setup/research-helper-record.mjs';

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const setupTools = [
  defineTool({
    name: 'research_helper_status',
    description:
      'Report whether the browser based research helper is installed on this computer: whether a recent ' +
      'enough Python is present, whether the page reader package is installed, and whether its browser is ' +
      'downloaded. Read only, and safe to call at any time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { workspace }) => {
      const existing = readRecord(workspace);
      const usable = hasUsableResearchHelperRecord(existing);
      const candidates = usable ? [[existing.python, ...(Array.isArray(existing.python_args) ? existing.python_args : [])]] : undefined;
      const found = await detect(candidates, usable ? researchHelperChildEnv(existing.environment_path) : undefined);
      const state = usable && found.state === 'connected' && found.crawl4ai.compatible ? 'connected' : found.state === 'degraded' ? 'degraded' : 'not_connected';
      // Detection is the truth about this computer, so the recorded state is brought
      // back in line with it here: a helper uninstalled outside Social Campaign stops
      // claiming to be connected the next time anybody asks.
      if (workspace.root) {
        const record = existing ?? {};
        if (String(record.state ?? '') !== state || (state === 'connected' && !usable)) {
          writeRecord(workspace, {
            ...record,
            state,
            python_version: found.python.version,
            crawl4ai_version: found.crawl4ai.version,
          });
        }
      }
      return {
        state,
        capability: 'research.browser',
        python: {
          found: found.python.found,
          version: found.python.version,
          path: found.python.executable,
          store_stub_only: !found.python.found && found.python.storeStub,
        },
        page_reader: { found: found.crawl4ai.found, version: found.crawl4ai.version, pinned: CRAWL4AI_VERSION },
        browser: { found: found.chromium.found },
        install: installProgress(workspace),
      };
    },
  }),

  defineTool({
    name: 'research_helper_install',
    description:
      'Install the optional browser based research helper: the page reader package and the browser it ' +
      'drives (several hundred MB). Needs Python 3.10 or newer already installed; never installs Python. ' +
      'Without confirm: true it installs nothing and returns what it would install, how big it is and where, ' +
      'to put to the user. Pass confirm: true only after the user has said yes. Returns straight away; poll ' +
      'research_helper_status to watch each step, and nothing else waits on it.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'true only after the user has agreed to install the research helper. Anything else installs nothing.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      // The person's yes is the only thing that starts this: it downloads a browser
      // and Python packages onto their computer.
      if (args?.confirm !== true) {
        return {
          started: false,
          confirmation_required: true,
          plan: installPlan(),
          next: 'Tell the user in plain words what this installs, what it is for and how big it is, and call again with confirm: true only if they say yes.',
        };
      }
      const state = startInstall(workspace);
      return { started: true, install: state };
    },
  }),
];
