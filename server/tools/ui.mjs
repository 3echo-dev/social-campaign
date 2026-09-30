/**
 * Pane tools: setup, home and the shared gate waiter.
 *
 * The gate pattern
 * ----------------
 * A tool that needs a human decision shows a screen and waits up to GATE_WAIT_MS
 * (see server/ui/server.mjs; 20 minutes by default). If the user has not decided by
 * then it returns { status: "pending", screenId } and Claude calls ui_wait with that
 * screenId, which waits another GATE_WAIT_MS. Repeat until status is "resolved". No
 * MCP tool call ever blocks past that ceiling.
 */

import { defineTool } from '../mcp/registry.mjs';
import { GATE_WAIT_MS } from '../ui/server.mjs';
import { defaultWorkspaceRoot } from '../lib/paths.mjs';
import { CONNECTION_ROWS } from '../capabilities/registry.mjs';
import { resolveCapabilities } from '../capabilities/resolve.mjs';
import { recordBoot } from '../workspace/version.mjs';
import { redact } from '../lib/secrets.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { handleConnectAction } from './publishing.mjs';
import { connectionKeyForProvider, showConnections } from './connections.mjs';
import { installProgress, readRecord, startInstallIfNeeded } from '../setup/research-helper.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boardSnapshot } from '../pipeline/board.mjs';

/**
 * The shape every gate tool returns.
 * @param {import('../ui/server.mjs').ActionResult|null} result
 * @param {string} screenId
 * @param {Record<string, unknown>} [extra]
 */
function gateResult(result, screenId, extra = {}) {
  if (!result) {
    return {
      status: 'pending',
      screenId,
      hint: 'The user has not answered yet. Call ui_wait with this screenId to keep waiting.',
      ...extra,
    };
  }
  // A secret never leaves the server: a resolved action's payload is what a
  // person typed into the pane, and the one screen that ever collects a secret
  // (the publisher connect screen) consumes it server side before this ever
  // runs (see handleConnectAction in server/tools/publishing.mjs). redact() is
  // the backstop for every other gate tool that funnels through gateResult.
  return { status: 'resolved', screenId, action: result.action, payload: redact(result.payload), ...extra };
}

/**
 * Consume an action from the canonical Connections page.
 *
 * Publisher credentials are consumed on the server before the result can reach
 * the generic ui_wait response. All other actions are acknowledged here so a
 * completed click cannot keep the pane busy or be replayed after a refresh.
 * @param {import('../ui/server.mjs').ActionResult} result
 * @param {{ui: import('../ui/server.mjs').UiServer, workspace: import('../workspace/index.mjs').Workspace}} context
 */
async function connectionGateResult(result, { ui, workspace }) {
  const current = ui.screen;
  const publisherConnect =
    result.action === 'connect' &&
    (result.screenType === 'connections' ||
      (result.screenType === 'integration_connect' && current?.data?.mode === 'publisher'));
  if (!publisherConnect) {
    ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
    if (result.action !== 'check_again' && typeof ui.clearBusyForAction === 'function') ui.clearBusyForAction(result.screenId, result.actionId ?? null);
    return gateResult(result, result.screenId, { url: ui.url() });
  }

  const outcome = await handleConnectAction(workspace, ui, result);
  ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
  const screen = await showConnections(ui, workspace, {
    setup: false,
    focus: 'publishing',
    reason: outcome.connected ? 'Connection saved.' : null,
    connectionDetail: outcome.error ? String(outcome.error) : null,
    canRetry: !outcome.connected,
    acknowledgeActionId: result.actionId ?? null,
  });
  return {
    status: 'resolved',
    action: 'connect',
    connected: Boolean(outcome.connected),
    error: outcome.error ?? null,
    screenId: screen.screenId,
    url: ui.url(),
  };
}

/**
 * Build the connection strip shown on the home screen.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 */
async function connectionStrip(workspace) {
  const { capabilities } = await resolveCapabilities(workspace);
  return CONNECTION_ROWS.map((row) => {
    const states = row.capabilities.map((name) => capabilities[name]);
    const state = states.every((entry) => entry === 'ready')
      ? 'ready'
      : states.some((entry) => entry === 'ready' || entry === 'degraded')
        ? 'degraded'
        : 'not_connected';
    return { key: row.key, label: row.label, provider: row.provider, state };
  });
}

/**
 * The one quiet line home shows about the research helper. It is not a connector, so
 * it never gets its own chip: nothing is shown once it is installed or has never been
 * attempted, only while it is installing or once it has failed. `failed` is true only
 * for a failed install, never while one is still running, since that is the only case
 * that gets a "Ask chat to fix it" button next to the note.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{text: string, failed: boolean}|null}
 */
function researchNoteFor(workspace) {
  const live = installProgress(workspace);
  if (live.state === 'installing') return { text: 'Setting up research tools in the background.', failed: false };
  if (live.state === 'failed') {
    return { text: 'Research tools did not finish installing. Run the doctor to see why.', failed: true };
  }
  const record = readRecord(workspace);
  const recorded = record ? String(record.state ?? '') : '';
  if (recorded === 'degraded') {
    return { text: 'Research tools did not finish installing. Run the doctor to see why.', failed: true };
  }
  return null;
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const uiTools = [
  defineTool({
    name: 'ui_open_url',
    description: 'Get the address of the Social Campaign pane so it can be opened in the browser pane.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { ui }) => ({ url: ui.url(), screenId: ui.screen.screenId, screenType: ui.screen.type }),
  }),

  defineTool({
    name: 'ui_wait',
    description:
      'Keep waiting for the user to act on a screen that is already open. Returns as soon as the user ' +
      'clicks, or after about 20 minutes with status "pending", in which case call this again immediately ' +
      'with the same screenId and keep doing so until it resolves. On Connections, actions are ' +
      'check_again, fix_in_chat, skip, connect or continue_home; publisher connect is consumed securely ' +
      'before this tool returns. Never stop waiting and fall back to chat.',
    inputSchema: {
      type: 'object',
      properties: {
        screenId: { type: 'string', description: 'The screenId returned by the tool that opened the screen.' },
        timeoutMs: { type: 'number', description: 'Optional override, capped at GATE_WAIT_MS (20 minutes).' },
      },
      required: ['screenId'],
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace, signal }) => {
      const screenId = String(args.screenId);
      const timeoutMs = Math.min(Number(args.timeoutMs) || GATE_WAIT_MS, GATE_WAIT_MS);
      const result = await ui.waitForAction(screenId, { timeoutMs, signal });
      if (!result) return gateResult(null, screenId, { url: ui.url() });
      if (!['connections', 'integration_connect'].includes(result.screenType)) return gateResult(result, screenId, { url: ui.url() });
      return connectionGateResult(result, { ui, workspace });
    },
  }),

  defineTool({
    name: 'setup_open',
    description:
      'Show the first run setup screen, where the user picks the folder Social Campaign will work in. ' +
      'When this session\'s folder has no workspace of its own, shows one current-folder choice and a pick-another fallback. ' +
      'The chat setup flow uses workspace_status and workspace_initialize directly; this pane tool remains a compatibility surface. ' +
      'Returns a url to open in the pane and a screenId to wait on.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { ui, workspace }) => {
      const status = workspace.status();
      if (status.suggestion) {
        const screen = ui.show('setup', {
          mode: 'choose',
          title: 'Set up Social Campaign',
          intro: 'This folder does not have a Social Campaign workspace yet.',
          suggestionRoot: status.suggestion.root,
        });
        return {
          url: ui.url(),
          screenId: screen.screenId,
          message:
            'Ask the user to choose the current project folder or pick another folder in the pane.',
        };
      }
      const screen = ui.show('setup', {
        title: 'Set up Social Campaign',
        intro: 'Choose the folder where Social Campaign keeps your work.',
        keeps: [
          'Brand profiles',
          'Creative library',
          'Campaigns',
          'Generated media',
          'Memory and preferences',
        ],
        defaultRoot: defaultWorkspaceRoot(),
      });
      return {
        url: ui.url(),
        screenId: screen.screenId,
        message: 'Ask the user to choose a folder in the pane.',
      };
    },
  }),

  defineTool({
    name: 'setup_wait',
    description:
      'Wait for the user to choose a folder on the setup screen, then set the workspace up in it. ' +
      'Returns status "pending" if the user has not chosen yet, in which case call this tool again.',
    inputSchema: {
      type: 'object',
      properties: {
        screenId: { type: 'string', description: 'Optional. Defaults to the setup screen that is open.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace, signal }) => {
      const screenId = typeof args.screenId === 'string' && args.screenId ? args.screenId : ui.screen.screenId;
      const result = await ui.waitForAction(screenId, { timeoutMs: GATE_WAIT_MS, signal });
      if (!result) return gateResult(null, screenId, { url: ui.url() });

      if (result.action === 'choose_other') {
        // The chooser's third option: fall through to the plain folder picker,
        // the same screen shown when there is no other workspace to offer.
        const retry = ui.show('setup', {
          title: 'Set up Social Campaign',
          intro: 'Choose the folder where Social Campaign keeps your work.',
          keeps: ['Brand profiles', 'Creative library', 'Campaigns', 'Generated media', 'Memory and preferences'],
          defaultRoot: defaultWorkspaceRoot(),
        });
        return {
          status: 'pending',
          screenId: retry.screenId,
          hint: 'The user chose to pick another folder. The folder picker is open. Call setup_wait with the new screenId.',
          url: ui.url(),
        };
      }

      const payload = /** @type {{root?: string}} */ (result.payload ?? {});
      const chosen =
        result.action === 'use_default_folder' || !payload.root ? defaultWorkspaceRoot() : String(payload.root);

      try {
        const outcome = workspace.initialize(chosen);
        // A workspace created mid session has not been through boot, so stamp the
        // plugin version and open its boot log here.
        recordBoot(workspace);
        if (typeof ui.rebindWorkspace === 'function') await ui.rebindWorkspace();
        // The research helper install is part of approving the workspace: it starts
        // right here, the moment the folder is confirmed and created, not whenever
        // the Connections screen happens to be shown. Idempotent and never blocking.
        const researchHelperInstallStarted = startInstallIfNeeded(workspace);
        // Setup does not end at the folder. It ends on the Connections screen, so
        // everything a job might need is offered once, up front, rather than
        // interrupting the first job to ask. Nothing there blocks: its Continue
        // button goes straight to home whatever is or is not connected.
        const connections = await showConnections(ui, workspace, { setup: true });
        return {
          status: 'resolved',
          screenId,
          workspaceRoot: outcome.root,
          createdFolders: outcome.created,
          storageVersion: outcome.version,
          health: workspace.status(),
          next: 'connections',
          connectionsScreenId: connections.screenId,
          researchHelperInstallStarted,
          message:
            'The workspace is ready and the Connections screen is open. Wait on connectionsScreenId with ' +
            'connections_wait; "continue_home" means open home.',
          url: ui.url(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retry = ui.show('setup', {
          title: 'Set up Social Campaign',
          intro: 'Choose the folder where Social Campaign keeps your work.',
          keeps: ['Brand profiles', 'Creative library', 'Campaigns', 'Generated media', 'Memory and preferences'],
          defaultRoot: defaultWorkspaceRoot(),
          error: message,
        });
        return {
          status: 'pending',
          screenId: retry.screenId,
          problem: message,
          hint: 'The folder did not work. The setup screen is open again. Call setup_wait with the new screenId.',
          url: ui.url(),
        };
      }
    },
  }),

  defineTool({
    name: 'home_open',
    description:
      'Open the local board with required brand onboarding and New job for ready brands. Returns its URL and snapshot. ' +
      'Unadopted legacy workspaces return their existing home screenId for ui_wait.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { ui, workspace }) => {
      if(workspace.root && existsSync(join(workspace.root,'.social-pipeline','config.json'))) {
        return {url:new URL('/board',await ui.servedUrl()).href,snapshot:boardSnapshot({root:workspace.root}),next:'board'};
      }
      const status = workspace.status();
      const research = researchNoteFor(workspace);
      const screen = ui.show('home', {
        title: 'What would you like to do?',
        workspaceRoot: status.workspaceRoot,
        cards: [
          {
            action: 'start_job',
            title: 'Start a New Job',
            body: 'Create a social post, UGC concept, or ad campaign for Facebook, Instagram, or TikTok.',
          },
          {
            action: 'onboard_brand',
            title: 'Onboard a Brand',
            body: 'Build a reusable brand profile from guidelines, websites, social channels, and creative references.',
          },
          {
            action: 'build_library',
            title: 'Build Creative Library',
            body: 'Select an existing media folder to organize, analyze, and learn from past videos, images, audio, and scripts.',
          },
        ],
        connections: await connectionStrip(workspace),
        connectionsLink: 'Connections',
        researchNote: research ? research.text : null,
        researchNoteFailed: research ? research.failed : false,
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'integration_connect_open',
    description:
      'Show the canonical Connections page focused on one provider when a job reaches a stage that needs it. ' +
      'Wait with ui_wait; the action contract is check_again, fix_in_chat, skip, connect or continue_home. ' +
      'Publisher connect is consumed securely by ui_wait.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['threeecho_studio', 'elevenlabs', 'publisher'], description: 'threeecho_studio, elevenlabs or publisher.' },
        reason: { type: 'string', description: 'One sentence saying why it is needed right now.' },
      },
      required: ['provider'],
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace }) => {
      const provider = String(args.provider);
      const focus = connectionKeyForProvider(provider);
      if (!focus) throw new InvalidInputError(`"${provider}" is not a connection Social Campaign knows about.`);
      const screen = await showConnections(ui, workspace, {
        setup: focus === 'publishing' ? false : undefined,
        focus,
        reason:
          typeof args.reason === 'string' && args.reason
            ? args.reason
            : 'This job needs this connection before it can continue.',
      });
      return { url: ui.url(), screenId: screen.screenId, provider, focus };
    },
  }),

  defineTool({
    name: 'message_show',
    description: 'Show a plain message in the pane. Use for progress notes that need no decision.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        tone: { type: 'string', description: 'neutral, success or warning.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: (args, { ui }) => {
      const screen = ui.show('message', {
        title: String(args.title),
        body: typeof args.body === 'string' ? args.body : '',
        tone: typeof args.tone === 'string' ? args.tone : 'neutral',
      });
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),
];
