#!/usr/bin/env node
/**
 * The bundled Social Campaign MCP server.
 *
 * Boot order:
 *   1. load the workspace pointer and open storage if a workspace already exists,
 *      which applies any pending migration after taking a backup
 *   2. compare the plugin version with the version the workspace was last opened by,
 *      record the new one, and write a line to .social-campaign/logs/boot.log
 *   3. start the pane on 127.0.0.1, reusing the saved port when it is free, or
 *      letting whichever process already holds it serve the browser: the screen
 *      itself lives in the workspace, so every process shows into the same pane
 *   4. start the MCP transport on stdio and serve until stdin closes
 *
 * stdout is the protocol. Every diagnostic goes to stderr.
 */

import { pathToFileURL } from 'node:url';

import { Workspace } from './workspace/index.mjs';
import { UiServer, isLivePaneForWorkspace } from './ui/server.mjs';
import { StdioTransport } from './mcp/transport.mjs';
import { buildRegistry } from './tools/index.mjs';
import { log } from './lib/log.mjs';
import { PLUGIN_VERSION, recordBoot } from './workspace/version.mjs';
import { rehydratePendingGate } from './review/gate.mjs';
import { cleanupExpiredCredentials } from './lib/credentials.mjs';

/**
 * Screen types that are gates (opened by server/review/gate.mjs) rather than plain
 * informational screens. Only these are worth checking against the reviews table
 * on restore; anything else has no pending decision to rehydrate.
 */
const GATE_SCREEN_TYPES = new Set([
  'strategy_review',
  'concept_review',
  'cost_review',
  'media_review',
  'final_review',
  'question',
]);

export { PLUGIN_VERSION, PLUGIN_VERSION_KEY, recordBoot } from './workspace/version.mjs';

/**
 * Build the server without starting the transport. Tests use this.
 * @returns {Promise<{workspace: Workspace, ui: UiServer, registry: import('./mcp/registry.mjs').ToolRegistry}>}
 */
export async function createServer() {
  const expiredCredentials = cleanupExpiredCredentials();
  if (expiredCredentials.failed) log.warn('Some expired credentials could not be removed; cleanup will retry on the next startup.');
  const workspace = new Workspace();
  const status = workspace.load();
  const boot = recordBoot(workspace);

  const savedPort = Number(/** @type {any} */ (workspace.readConfig())?.ui?.port) || 0;
  const ui = new UiServer({ port: savedPort, workspace });
  let adoptedExisting = false;
  try {
    await ui.start();
  } catch (error) {
    // The saved port is busy. Before assuming that is stale and grabbing a new
    // one, ask whether it is actually a live Social Campaign pane already
    // serving this exact workspace. If so, that is the pane the person has open
    // right now: opening a second one on a new port would be exactly the
    // "lost the screen I was on" failure this guard exists to prevent.
    const root = workspace.root;
    const liveElsewhere = savedPort > 0 && root ? await isLivePaneForWorkspace(savedPort, root) : false;
    if (liveElsewhere) {
      log.info('pane already running for this workspace, not starting a second one', {
        port: savedPort,
        root,
      });
      ui.adoptExternal(savedPort);
      adoptedExisting = true;
    } else {
      log.warn('saved pane port was busy and not a live pane for this workspace, picking another', {
        error: String(error),
      });
      ui.requestedPort = 0;
      await ui.start();
    }
  }
  workspace.uiUrl = ui.url();
  if (status.configured && !adoptedExisting) workspace.patchConfig({ ui: { port: ui.port } });

  // The screen a previous process last showed is already in front of this one: the
  // pane's state lives in the workspace, so opening the store reads it back rather
  // than starting blank. What still has to happen here is the bookkeeping that is
  // process memory and nothing else: a pending gate's in-memory entry. Re-arm it for
  // whatever screen is on show, whether this process bound the port or adopted
  // another session's, since either way a click on that screen has to resolve here.
  if (workspace.root) {
    const current = ui.screen;
    if (workspace.db && GATE_SCREEN_TYPES.has(current.type)) {
      const rehydrated = rehydratePendingGate(workspace.db, current.screenId);
      if (rehydrated) {
        log.info('pending gate re-armed', {
          review_id: rehydrated.review_id,
          kind: rehydrated.kind,
          screenId: current.screenId,
        });
      }
    }
  }

  const registry = buildRegistry();
  log.info('social campaign server ready', {
    configured: status.configured,
    version: boot.version,
    tools: registry.list().length,
    ui: ui.url(),
  });
  return { workspace, ui, registry };
}

/**
 * Boot and serve on stdio.
 * @returns {Promise<void>}
 */
export async function main() {
  const { workspace, ui, registry } = await createServer();
  const transport = new StdioTransport({
    registry,
    context: { workspace, ui },
    serverInfo: { name: 'social-campaign-core', version: PLUGIN_VERSION },
  });
  await transport.start();
  await ui.stop();
  workspace.close();
}

/**
 * Install process level guards against the two ways this server was seen to
 * disappear silently: an exception or rejection nothing downstream caught, and
 * stdout being written to after the reader on the other end of the MCP pipe has
 * gone away.
 *
 * Every tool call is already wrapped by the registry (server/mcp/registry.mjs)
 * via the transport's try/catch (server/mcp/transport.mjs #callTool), which
 * turns a thrown error or a rejected promise from a handler into a normal
 * isError tool result rather than letting it escape. These guards are the
 * backstop for everything that is not a tool call: a bug in the transport
 * itself, a stray timer callback, an error thrown from inside an 'error' event
 * handler, or anything else Node considers fatal by default. Without them, one
 * uncaught error silently kills the whole process (nothing is logged, because
 * the default handler prints to stderr and exits before this server's own
 * logger, which itself only writes on request, gets a turn), and Claude Code
 * restarts it as a fresh instance: new port, no memory of the screen the person
 * was looking at. That silent-then-restarted shape is exactly what was
 * diagnosed from this session's boot.log and server.log: a boot.log entry
 * timestamped ~42 minutes after the first boot, immediately preceded by
 * nothing at all in server.log, not even a warning.
 *
 * Never call process.exit() from either handler: the whole point is that the
 * process survives so the pane and any in-flight gate keep working.
 */
function installProcessGuards() {
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception, server staying alive', {
      error: String(error && error.stack ? error.stack : error),
    });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection, server staying alive', {
      error: String(reason && /** @type {any} */ (reason).stack ? /** @type {any} */ (reason).stack : reason),
    });
  });
  // EPIPE on stdout means the MCP client's read end has closed. Writing more
  // JSON-RPC lines into a broken pipe is itself an EPIPE-throwing operation;
  // letting that reach 'error' unguarded is a second way to crash on exactly
  // the condition this guard exists for.
  process.stdout.on('error', (error) => {
    if (/** @type {any} */ (error)?.code === 'EPIPE') return;
    log.error('stdout error', { error: String(error) });
  });
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly || process.env.SOCIAL_CAMPAIGN_FORCE_MAIN === '1') {
  installProcessGuards();
  main().catch((error) => {
    log.error('server crashed', { error: String(error && error.stack ? error.stack : error) });
    process.exit(1);
  });
}
