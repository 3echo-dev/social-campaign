/**
 * Workspace tools.
 *
 * workspace_status is the first call in every session. workspace_initialize is the
 * only way a workspace comes into being, and setup normally reaches it after one
 * explicit folder choice in chat.
 */

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { defaultWorkspaceRoot } from '../lib/paths.mjs';
import { RESOLVER_PROVIDER_KEY } from '../capabilities/registry.mjs';
import { recordBoot } from '../workspace/version.mjs';
import { listKnownWorkspaces, removeKnownWorkspace } from '../workspace/index.mjs';
import { startInstallIfNeeded } from '../setup/research-helper.mjs';

/**
 * The providers a user signs in to, read by the capability resolver. Social and ad
 * research have no connection: their coverage is measured by social_backends_status.
 */
export const CONNECTABLE_PROVIDERS = [...new Set(Object.values(RESOLVER_PROVIDER_KEY).filter((key) => typeof key === 'string'))];

/** The states integration_mark_connected records. */
export const CONNECTION_STATES = ['connected', 'not_connected', 'degraded', 'unavailable'];

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const workspaceTools = [
  defineTool({
    name: 'workspace_status',
    description:
      'Check whether the current project has a Social Campaign workspace and whether it is healthy. ' +
      'Returns one suggested folder for an unbound project. Historical workspaces are available only through ' +
      'the explicit workspace switch tool. Call this first in any Social Campaign conversation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { workspace, ui }) => {
      const status = workspace.status();
      return {
        ...status,
        uiUrl: ui.url() || status.uiUrl,
        suggestedRoot: status.issues.length > 0
          ? null
          : status.suggestedRoot ?? status.workspaceRoot ?? defaultWorkspaceRoot(),
      };
    },
  }),

  defineTool({
    name: 'workspace_switch_open',
    description:
      'Explicitly reconnect to a workspace remembered on this computer. This is the only action that lists ' +
      'historical workspaces; it never changes files until a workspace is selected.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { workspace, ui }) => {
      const status = workspace.status();
      const screen = ui.open('workspace_switch', {
        title: 'Switch workspace',
        intro: 'Pick which Social Campaign workspace this session should use.',
        activeRoot: status.workspaceRoot,
        projectRoot: status.projectRoot,
        suggestedRoot: status.suggestedRoot,
        workspaces: listKnownWorkspaces(),
        defaultRoot: defaultWorkspaceRoot(),
      });
      return { ok: true, url: ui.url(), screenId: screen.screenId };
    },
  }),

  defineTool({
    name: 'workspace_activate',
    description:
      'Switch the running server to a different, already set up workspace: closes and reopens the database, ' +
      'reloads integrations, and clears caches, all without a restart. Records the choice for this project and ' +
      'keeps the machine-wide list for explicit reconnects.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute path to the workspace folder to switch to.' },
      },
      required: ['root'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const status = workspace.activate(String(args.root ?? ''));
      const pane = typeof ui.rebindWorkspace === 'function' ? await ui.rebindWorkspace() : { url: ui.url(), port: ui.port ?? 0, external: false };
      return { ok: true, health: { ...status, uiUrl: pane.url }, pane };
    },
  }),

  defineTool({
    name: 'workspace_forget',
    description:
      'Remove a stale entry from the list of known workspaces. Never deletes any files; the workspace can be ' +
      're-added later by initializing or switching to that folder again.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute path of the workspace entry to remove.' },
      },
      required: ['root'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = String(args.root ?? '');
      if (workspace.root && root === workspace.root) {
        throw new InvalidInputError('The active workspace cannot be removed from the list.', {
          fix: 'Switch to another workspace first.',
        });
      }
      const known = removeKnownWorkspace(root);
      return { ok: true, knownWorkspaces: known };
    },
  }),

  defineTool({
    name: 'workspace_initialize',
    description:
      'Create or adopt a Social Campaign workspace in the given folder: build the folder tree, prepare ' +
      'storage, and write the settings. Pass the one folder selected in chat. Safe to call again on an existing workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description:
            'Absolute folder path. A leading ~ or %USERPROFILE% is expanded. Leave empty to use the ' +
            'default folder in the user home directory.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const result = workspace.initialize(
        typeof args.root === 'string' && args.root.trim().length > 0 ? args.root : defaultWorkspaceRoot(),
      );
      // A workspace created mid session has not been through boot, so stamp the
      // plugin version and open its boot log here.
      recordBoot(workspace);
      const pane = typeof ui.rebindWorkspace === 'function' ? await ui.rebindWorkspace() : { url: ui.url(), port: ui.port ?? 0, external: false };
      // The research helper install is part of approving the workspace: it starts
      // the moment the workspace exists, not whenever the Connections screen happens
      // to be shown. Idempotent, so calling this on an already set up workspace does
      // nothing.
      const researchHelperInstallStarted = startInstallIfNeeded(workspace);
      return {
        ok: true,
        workspaceRoot: result.root,
        createdFolders: result.created,
        storageUpdates: result.applied,
        storageVersion: result.version,
        backupPath: result.backupPath,
        uiUrl: pane.url,
        pane,
        health: workspace.status(),
        researchHelperInstallStarted,
      };
    },
  }),

  defineTool({
    name: 'integration_mark_connected',
    description:
      'Record the connection state of an optional provider so the rest of Social Campaign can see it. ' +
      `Providers: ${CONNECTABLE_PROVIDERS.join(', ')}. ` +
      'States: connected, not_connected, degraded, unavailable. Social and ad research need no connection.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: CONNECTABLE_PROVIDERS, description: 'Provider key.' },
        state: { type: 'string', enum: CONNECTION_STATES, description: 'connected, not_connected, degraded or unavailable.' },
        detail: { type: 'string', description: 'Optional note shown in diagnostics.' },
      },
      required: ['provider', 'state'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      if (!CONNECTABLE_PROVIDERS.includes(String(args.provider))) {
        throw new InvalidInputError(`"${args.provider}" is not something Social Campaign connects to.`, {
          fix: `Use one of ${CONNECTABLE_PROVIDERS.join(', ')}. Social and ad research need no connection; their coverage is checked automatically.`,
        });
      }
      if (!CONNECTION_STATES.includes(String(args.state))) {
        throw new InvalidInputError(`"${args.state}" is not a connection state.`, { fix: `Use one of ${CONNECTION_STATES.join(', ')}.` });
      }
      const providers = workspace.writeIntegration(
        String(args.provider),
        String(args.state),
        typeof args.detail === 'string' ? args.detail : undefined,
      );
      return { ok: true, providers };
    },
  }),
];
