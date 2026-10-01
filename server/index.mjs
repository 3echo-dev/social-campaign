#!/usr/bin/env node
/**
 * The bundled Social Campaign MCP server.
 *
 * Boot order:
 *   1. load the workspace pointer and open storage if a workspace already exists,
 *      which applies any pending migration after taking a backup
 *   2. compare the plugin version with the version the workspace was last opened by,
 *      record the new one, and write a line to .social-campaign/logs/boot.log
 *   3. start the MCP transport on stdio and serve until stdin closes
 *
 * stdout is the protocol. Every diagnostic goes to stderr.
 */

import { pathToFileURL } from 'node:url';

import { Workspace } from './workspace/index.mjs';
import { StdioTransport } from './mcp/transport.mjs';
import { buildRegistry } from './tools/index.mjs';
import { log } from './lib/log.mjs';
import { PLUGIN_VERSION, recordBoot } from './workspace/version.mjs';

export { PLUGIN_VERSION, PLUGIN_VERSION_KEY, recordBoot } from './workspace/version.mjs';

/**
 * Build the server without starting the transport. Tests use this.
 * @returns {Promise<{workspace: Workspace, registry: import('./mcp/registry.mjs').ToolRegistry}>}
 */
export async function createServer() {
  const workspace = new Workspace();
  const status = workspace.load();
  const boot = recordBoot(workspace);

  const registry = buildRegistry();
  log.info('social campaign server ready', {
    configured: status.configured,
    version: boot.version,
    tools: registry.list().length,
  });
  return { workspace, registry };
}

/**
 * Boot and serve on stdio.
 * @returns {Promise<void>}
 */
export async function main() {
  const { workspace, registry } = await createServer();
  const transport = new StdioTransport({
    registry,
    context: { workspace },
    serverInfo: { name: 'social-campaign-core', version: PLUGIN_VERSION },
  });
  await transport.start();
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
 * restarts it as a fresh instance with no memory of what was in flight. That
 * silent-then-restarted shape is exactly what was
 * diagnosed from this session's boot.log and server.log: a boot.log entry
 * timestamped ~42 minutes after the first boot, immediately preceded by
 * nothing at all in server.log, not even a warning.
 *
 * Never call process.exit() from either handler: the whole point is that the
 * process survives so in-flight tool calls keep working.
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
