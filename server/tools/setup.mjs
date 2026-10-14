/** Optional research helper setup. */

import { existsSync } from 'node:fs';

import { defineTool } from '../mcp/registry.mjs';
import {
  PINNED_VERSIONS,
  checkResearchTools,
  describeInstall,
  detect,
  installProgress,
  readRecord,
  researchToolsState,
  startInstall,
  writeRecord,
} from '../setup/research-helper.mjs';
import { hasUsableResearchHelperRecord, managedEnvironmentRoot, managedPythonPath, researchHelperChildEnv } from '../setup/research-helper-record.mjs';
import { readLatestVersions } from '../setup/helper-packages.mjs';

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const setupTools = [
  defineTool({
    name: 'research_helper_status',
    description:
      'Report whether the browser based research helper is installed on this computer: whether a recent ' +
      'enough Python is present, whether the page reader (Scrapling) is installed at the version Social Campaign ' +
      'expects, whether its browser is downloaded, what each package is at against the newest version pip last ' +
      'reported, and the optional local speech to text. Read only, and safe to call at any time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { workspace }) => {
      const existing = readRecord(workspace);
      const usable = hasUsableResearchHelperRecord(existing);
      const candidates = usable ? [[existing.python, ...(Array.isArray(existing.python_args) ? existing.python_args : [])]] : undefined;
      const found = await detect(candidates, usable ? researchHelperChildEnv(existing.environment_path) : undefined);
      const state = usable && found.state === 'connected' && found.scrapling.compatible ? 'connected' : found.state === 'degraded' ? 'degraded' : 'not_connected';
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
            scrapling_version: found.scrapling.version ?? record.scrapling_version ?? null,
          });
        }
      }
      const environmentRoot = existing?.environment_path || managedEnvironmentRoot();
      const latest = readLatestVersions(environmentRoot);
      const tools = researchToolsState(environmentRoot, {
        speechWanted: Boolean(existing?.speech_consent_at),
        latest: latest?.versions ?? null,
        latestCheckedAt: latest?.checkedAt ?? null,
      });
      const progress = installProgress(workspace);
      return {
        state,
        capability: 'research.browser',
        python: {
          found: found.python.found,
          version: found.python.version,
          path: found.python.executable,
          store_stub_only: !found.python.found && found.python.storeStub,
        },
        page_reader: { found: found.scrapling.found, version: found.scrapling.version, pinned: PINNED_VERSIONS.scrapling },
        browser: { found: found.chromium.found },
        speech: { ...tools.speech, ...(progress.speech ? { progress: progress.speech } : {}) },
        versions: tools.rows,
        latest_checked_at: tools.latestCheckedAt,
        install: progress,
      };
    },
  }),

  defineTool({
    name: 'research_tools_check',
    description:
      'Quick check of the research tools on this computer (the Python environment, the page reader, the ' +
      'browser, yt-dlp and FFmpeg, and the optional local speech to text) against the versions Social Campaign expects. ' +
      'It answers from what is on disk and from a cached look at the newest versions (never the network), and reports ' +
      'the real state: {ok, state, missing, outdated, newerAvailable, removing, versions, install, workspaceLinked}. ' +
      'If something that is already installed is missing, outdated or retired it starts the normal background update by itself and ' +
      'returns at once with updating: true; it never waits for the install. It never installs on a computer that has no ' +
      'research helper: that comes back as consentNeeded, and the install starts only after the person says yes ' +
      '(research_helper_install with confirm: true). Call it once at the start of /social-campaign, tell the person in one ' +
      'plain line if it is updating, and carry on. Pass force: true only to start again straight after an attempt that just ended.',
    inputSchema: {
      type: 'object',
      properties: { force: { type: 'boolean', description: 'true to start an update even if one was attempted in the last half hour.' } },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const check = checkResearchTools(workspace, { force: args?.force === true });
      const progress = installProgress(workspace);
      // The workspace's own record can lag behind the computer (a new workspace, a helper another workspace installed):
      // when the files on disk are healthy that is what the install state reports.
      const install = check.state === 'installed' && progress.state !== 'installed'
        ? { ...progress, state: 'installed', step: 'done', stepLabel: 'Ready', percent: 100, error: null }
        : progress;
      return {
        ...check,
        install,
        next: check.updating
          ? 'Say in one short line that the research tools are being updated in the background, then continue. Do not wait for it and do not ask the user to do anything.'
          : check.consentNeeded
            ? 'The research helper is not installed. Continue without it. Offer it once, in the setup question, and install it only after a yes (research_helper_install with confirm: true).'
            : check.ok
              ? 'Nothing to do. Continue.'
              : 'Continue. Research works with the tools that are ready; leave the rest blank.',
      };
    },
  }),

  defineTool({
    name: 'research_helper_install',
    description:
      'Install the optional browser based research helper: the page reader (Scrapling), yt-dlp and the browser they ' +
      'drive (a download of roughly 400 MB, about 1 GB on disk), and, only with speech: true, local speech to text (about ' +
      '150 MB of packages and a speech model of about 480 MB, downloaded once in the background). Needs Python 3.10 or ' +
      'newer already installed; never installs Python. Without confirm: true it installs nothing and returns what it ' +
      'would install, how big it is and where, and whether Python is here, to put to the user as one yes or no. ' +
      'Pass confirm: true only after the user has said yes; add speech: true only if that yes included local speech to text. ' +
      'Returns straight away; poll research_helper_status to watch each step, and nothing else waits on it.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'true only after the user has agreed to install the research helper. Anything else installs nothing.',
        },
        speech: {
          type: 'boolean',
          description: 'true only if the user also agreed to local speech to text (packages and a speech model, about 630 MB).',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const environmentRoot = managedEnvironmentRoot();
      const present = existsSync(managedPythonPath(environmentRoot));
      // The person's yes is the only thing that starts this: it downloads a browser and Python packages onto their computer.
      if (args?.confirm !== true) {
        const { plan, python } = await describeInstall();
        return {
          started: false,
          confirmation_required: true,
          already_on_this_computer: present,
          plan,
          python,
          next: python.found || present
            ? 'Tell the user in plain words what this installs, what it is for and how big it is, and offer local speech to text as part of the same yes. Call again with confirm: true (and speech: true if they want it) only if they say yes.'
            : `Python 3.10 or newer is needed first and Social Campaign never installs it. Tell the user: ${python.explanation} The command is: ${python.command}. Ask them to run it, then offer the helper again.`,
        };
      }
      if (!present) {
        const { python } = await describeInstall();
        if (!python.found) {
          return { started: false, python_missing: true, python, next: `Python 3.10 or newer is needed first. Tell the user: ${python.explanation} The command is: ${python.command}. Nothing was installed.` };
        }
      }
      const state = startInstall(workspace, { confirmed: true, speech: args?.speech === true, update: true });
      return { started: state.state === 'installing', install: state };
    },
  }),
];
