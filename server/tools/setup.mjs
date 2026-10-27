/** Research helper setup: it installs by itself, in the background. */

import { defineTool } from '../mcp/registry.mjs';
import {
  PINNED_VERSIONS,
  checkResearchTools,
  claimInstallAnnouncement,
  detect,
  installProgress,
  readRecord,
  researchToolsState,
  startInstall,
  writeRecord,
} from '../setup/research-helper.mjs';
import { hasUsableResearchHelperRecord, managedEnvironmentRoot, researchHelperChildEnv } from '../setup/research-helper-record.mjs';
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
        speechWanted: true,
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
      'browser, yt-dlp, FFmpeg and local speech to text) against the versions Social Campaign expects. ' +
      'It answers from what is on disk and from a cached look at the newest versions (never the network), and reports ' +
      'the real state: {ok, state, missing, outdated, newerAvailable, removing, versions, install, workspaceLinked}. ' +
      'If something is missing, outdated or retired it starts the install or update in the background by itself, with no ' +
      'question, and returns at once; it never waits for it. A computer with nothing installed gets the full install. ' +
      'The result has a say field only when a first install just started, or when none can start (not enough free space, ' +
      'or no recent Python). Tell the person that line once, word for word, and nothing else about the install. ' +
      'Without say, say nothing about it. Call it once at the start of /social-campaign and carry on. ' +
      'Pass force: true only to start again straight after an attempt that just ended.',
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
        next: check.say
          ? 'Tell the person the say line once, word for word, and nothing else about the install. Then continue; never wait for it.'
          : 'Say nothing about the install or any update. Continue; research uses the tools that are ready.',
      };
    },
  }),

  defineTool({
    name: 'research_helper_install',
    description:
      'Install the research helper and local speech to text in the background: the page reader (Scrapling), yt-dlp, ' +
      'the browser they drive and the speech reader with its model, as one install. It needs no question and no ' +
      'confirmation. Needs Python 3.10 or newer already installed; never installs Python. Returns straight away; ' +
      'poll research_helper_status to watch each step, and nothing else waits on it. The result has a say field only ' +
      'when a first install just started, or when none can start (not enough free space, or no recent Python). Tell the ' +
      'person that line once, word for word, and nothing else about the install. confirm and speech are still accepted ' +
      'and ignored, so an older caller keeps working.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'Ignored. Nothing waits for a yes any more.' },
        speech: { type: 'boolean', description: 'Ignored. Local speech to text is always part of the install.' },
      },
      additionalProperties: false,
    },
    handler: async (_args, { workspace }) => {
      const { say: startedSay, blocked: _blocked, ...install } = startInstall(workspace, { update: true });
      const say = startedSay ?? claimInstallAnnouncement(workspace);
      return {
        started: install.state === 'installing',
        ...(say ? { say } : {}),
        install,
        next: say
          ? 'Tell the person the say line once, word for word, and nothing else about the install.'
          : 'Say nothing about the install.',
      };
    },
  }),
];
