/** Connections tool entry points and optional research helper setup. */

import { defineTool } from '../mcp/registry.mjs';
import { GATE_WAIT_MS } from '../ui/server.mjs';
import { handleConnectAction } from './publishing.mjs';
import { redact } from '../lib/secrets.mjs';
import { CRAWL4AI_VERSION, detect, installProgress, readRecord, startInstall, writeRecord } from '../setup/research-helper.mjs';
import { hasUsableResearchHelperRecord } from '../setup/research-helper-record.mjs';
import { showConnections } from './connections.mjs';

export {
  CONNECTION_CARDS,
  STATE_TEXT,
  SOCIAL_RESEARCH_NOTE,
  cardStateOf,
  connectionsScreenData,
  showConnections,
} from './connections.mjs';

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const setupTools = [
  defineTool({
    name: 'connections_open',
    description:
      'Show the canonical Connections page with cards for 3Echo Studio and ElevenLabs. Use it at ' +
      'the end of setup and whenever the user asks to see or change a connection. Omit setup when refreshing ' +
      'the page so its current setup or home context is preserved. Wait with connections_wait or ui_wait; ' +
      'the action contract is check_again, fix_in_chat, skip, connect or continue_home.',
    inputSchema: {
      type: 'object',
      properties: {
        setup: { type: 'boolean', description: 'Optional. True for first run setup, false for the home page. Omit to preserve the current Connections context.' },
        focus: { type: 'string', description: 'Optional card to call out: image_video, voice_audio or publishing.' },
        reason: { type: 'string', description: 'Optional one sentence saying why that card matters right now.' },
        note: { type: 'string', description: 'Optional connection detail kept for compatibility; technical errors are shown as connectionDetail on the focused card.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace }) => {
      const focus = typeof args.focus === 'string' ? args.focus : null;
      const screen = await showConnections(ui, workspace, {
        setup: typeof args.setup === 'boolean' ? args.setup : undefined,
        focus,
        reason: typeof args.reason === 'string' ? args.reason : null,
        note: typeof args.note === 'string' ? args.note : null,
      });
      // A check_again probe that finds nothing new leaves the card's data
      // unchanged, so showConnections's show() has no revision bump through
      // which to clear busy. This call ends it anyway: connections_open is
      // always the authoritative "the check is done, here is the card" step.
      if (typeof ui.clearBusy === 'function') ui.clearBusy();
      return { url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'connections_wait',
    description:
      'Wait for the user to act on the Connections screen. Returns status "pending" if they have not acted ' +
      'yet, in which case call it again with the same screenId. On "check_again" go and really try that ' +
      'provider, record it with integration_probe, then call connections_open again with the same focus so the ' +
      'card shows what was found. "fix_in_chat" means the user asked Claude to fix a failed provider or the ' +
      'research helper itself. "connect" is consumed securely on the server. "continue_home" means open home.',
    inputSchema: {
      type: 'object',
      properties: {
        screenId: { type: 'string', description: 'The screenId connections_open returned.' },
      },
      required: ['screenId'],
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace, signal }) => {
      const screenId = String(args.screenId);
      const result = await ui.waitForAction(screenId, { timeoutMs: GATE_WAIT_MS, signal });
      if (!result) {
        return {
          status: 'pending',
          screenId,
          hint: 'The user has not acted yet. Call connections_wait with this screenId to keep waiting.',
          url: ui.url(),
        };
      }
      const setup = Boolean(/** @type {any} */ (ui.screen.data)?.setup);
      if (result.action === 'connect') {
        // The publishing key is typed into the pane and consumed here, in the server,
        // by the same function the publisher connect screen already uses. It is never
        // part of anything this tool returns.
        const outcome = await handleConnectAction(workspace, ui, result);
        ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
        const screen = await showConnections(ui, workspace, {
          setup,
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
      // Every other action is the user's, and the session acts on it: probing a
      // provider, starting the install, or moving on. redact() is the same backstop
      // every other gate tool uses.
      ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
      // check_again keeps the card's pressed state and gold border trail running:
      // the real check (integration_probe, then connections_open) still has to
      // happen, and clearing busy here - before that work even starts - cuts the
      // trail short well before the card updates with the probe result. The
      // connections_open call that follows ends busy instead, either through its
      // own show() when the card's data changes or the clearBusy() fallback below
      // when a probe finds nothing new to show.
      if (result.action !== 'check_again' && typeof ui.clearBusyForAction === 'function') {
        ui.clearBusyForAction(result.screenId, result.actionId ?? null);
      }
      return { status: 'resolved', action: result.action, payload: redact(result.payload), screenId, url: ui.url() };
    },
  }),

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
      const found = await detect(candidates);
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
      'Install the browser based research helper: a recent Python, the page reader package and the browser ' +
      'it drives. Only call this when the user has asked for it, typically from the doctor. Returns straight ' +
      'away; poll research_helper_status to watch each step, and nothing else waits on it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { ui, workspace }) => {
      const state = startInstall(workspace);
      return { started: true, install: state, url: ui.url() };
    },
  }),
];
