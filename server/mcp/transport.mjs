/**
 * MCP over stdio.
 *
 * JSON-RPC 2.0, one message per line, read from stdin and written to stdout.
 * Nothing else may ever write to stdout: all diagnostics go to stderr through
 * server/lib/log.mjs.
 *
 * Supported methods: initialize, notifications/initialized, ping, tools/list,
 * tools/call. Anything else gets a method not found error, which keeps a client
 * that probes for resources or prompts from hanging.
 */

import { log, appendRotating } from '../lib/log.mjs';
import { toErrorPayload } from '../lib/errors.mjs';
import { toolFailuresLogPath } from '../lib/paths.mjs';
import { redact, looksLikeSecret } from '../lib/secrets.mjs';

/** The protocol revision this server is written against. */
export const PREFERRED_PROTOCOL_VERSION = '2025-06-18';

/** Revisions this server will echo back when a client asks for them. */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

const JSON_RPC = '2.0';
const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;
const PARSE_ERROR = -32700;
const INTERNAL_ERROR = -32603;

/** Tools that intentionally mutate or inspect the live workspace selection. */
const LIVE_WORKSPACE_TOOLS = new Set([
  'workspace_status',
  'workspace_switch_open',
  'workspace_activate',
  'workspace_forget',
  'workspace_initialize',
  'ui_open_url',
  'setup_open',
  'setup_wait',
  'capabilities_status',
  'doctor',
  'doctor_repair',
]);

/**
 * @typedef {object} TransportOptions
 * @property {import('./registry.mjs').ToolRegistry} registry
 * @property {import('./registry.mjs').ToolContext} context
 * @property {{name: string, version: string}} serverInfo
 * @property {NodeJS.ReadableStream} [input]
 * @property {NodeJS.WritableStream} [output]
 */

/**
 * Run the stdio transport until the input stream ends.
 */
export class StdioTransport {
  /** @param {TransportOptions} options */
  constructor(options) {
    this.registry = options.registry;
    this.context = options.context;
    this.serverInfo = options.serverInfo;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.buffer = '';
    /** @type {(() => void)|null} */
    this.onClose = null;
    /** @type {Map<string, {controller: AbortController, cancelled: boolean, name: string, workspace: any, requestId: string, heartbeatTimer: NodeJS.Timeout|null}>} */
    this.inFlight = new Map();
  }

  /**
   * Start reading. Resolves when stdin closes.
   * @returns {Promise<void>}
   */
  start() {
    this.input.setEncoding('utf8');
    return new Promise((resolveClose) => {
      this.onClose = resolveClose;
      this.input.on('data', (chunk) => this.#onData(String(chunk)));
      this.input.on('end', () => {
        this.#cancelFlights();
        log.info('mcp stdin closed');
        resolveClose();
      });
      this.input.on('error', (error) => {
        this.#cancelFlights();
        log.error('mcp stdin error', { error: String(error) });
        resolveClose();
      });
    });
  }

  /** @param {string} chunk */
  #onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) void this.#onLine(line);
      index = this.buffer.indexOf('\n');
    }
  }

  /** @param {string} line */
  async #onLine(line) {
    /** @type {any} */
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#send({ jsonrpc: JSON_RPC, id: null, error: { code: PARSE_ERROR, message: 'Invalid JSON' } });
      return;
    }
    if (Array.isArray(message)) {
      for (const entry of message) await this.#dispatch(entry);
      return;
    }
    await this.#dispatch(message);
  }

  /** @param {any} message */
  async #dispatch(message) {
    if (!message || message.jsonrpc !== JSON_RPC || typeof message.method !== 'string') {
      if (message && message.id !== undefined) {
        this.#send({
          jsonrpc: JSON_RPC,
          id: message.id,
          error: { code: INVALID_REQUEST, message: 'Invalid JSON-RPC request' },
        });
      }
      return;
    }
    const isNotification = message.id === undefined || message.id === null;
    if (message.method === 'notifications/cancelled') {
      await this.#handle(message.method, message.params ?? {});
      return;
    }
    const requestKey = !isNotification ? String(message.id) : null;
    const flight = requestKey
      ? { controller: new AbortController(), cancelled: false, name: String(message.method), workspace: null, requestId: requestKey, heartbeatTimer: null }
      : null;
    if (requestKey && flight) this.inFlight.set(requestKey, flight);
    try {
      const result = await this.#handle(message.method, message.params ?? {}, flight?.controller.signal, flight);
      if (result === undefined) return; // notification, nothing to answer
      if (!isNotification && !flight?.cancelled) this.#send({ jsonrpc: JSON_RPC, id: message.id, result });
    } catch (error) {
      const payload = toErrorPayload(error);
      log.error('mcp method failed', { method: message.method, message: payload.message });
        if (!isNotification && !flight?.cancelled) {
        this.#send({
          jsonrpc: JSON_RPC,
          id: message.id,
          error: {
            code: error && error.rpcCode ? error.rpcCode : INTERNAL_ERROR,
            message: payload.message,
            data: { code: payload.code },
          },
        });
      }
    } finally {
      if (requestKey && this.inFlight.get(requestKey) === flight) this.inFlight.delete(requestKey);
      if (flight) this.#clearActivity(flight);
    }
  }

  /**
   * @param {string} method
   * @param {any} params
   * @returns {Promise<unknown>} undefined means the message was a notification.
   */
  async #handle(method, params, signal, flight = null) {
    switch (method) {
      case 'initialize':
        return this.#initialize(params);
      case 'notifications/initialized':
      case 'initialized':
        return undefined;
      case 'notifications/cancelled': {
        const requestId = params && (params.requestId ?? params.id);
        const requestKey = requestId === undefined || requestId === null ? '' : String(requestId);
        const pending = requestKey ? this.inFlight.get(requestKey) : null;
        if (pending) {
          pending.cancelled = true;
          pending.controller.abort();
        }
        return undefined;
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: this.registry.list() };
      case 'tools/call':
        return await this.#callTool(params, signal, flight);
      default: {
        if (method.startsWith('notifications/')) return undefined;
        const error = new Error(`Method not found: ${method}`);
        // @ts-expect-error attaching a transport hint to a plain Error
        error.rpcCode = METHOD_NOT_FOUND;
        throw error;
      }
    }
  }

  /** Abort tool calls when the MCP peer disconnects, releasing any pane leases. */
  #cancelFlights() {
    for (const flight of this.inFlight.values()) {
      flight.cancelled = true;
      flight.controller.abort();
    }
  }

  /** @param {any} params */
  #initialize(params) {
    const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : null;
    const protocolVersion =
      requested && SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PREFERRED_PROTOCOL_VERSION;
    log.info('mcp initialize', { protocolVersion, client: params?.clientInfo?.name ?? 'unknown' });
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.serverInfo,
    };
  }

  /**
   * Run one tool and shape the result.
   *
   * A failed tool is not a JSON-RPC error. It comes back as a normal result with
   * isError true, so the model sees the friendly message and can recover.
   * @param {any} params
   */
  /**
   * Public entry point for tests that want to exercise tool-call error handling
   * directly, without going through a JSON-RPC message. Production code always
   * reaches this through #dispatch's 'tools/call' case.
   * @param {any} params
   */
  async callToolForTests(params) {
    return this.#callTool(params, undefined, null);
  }

  async #callTool(params, signal, flight = null) {
    const name = typeof params?.name === 'string' ? params.name : '';
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    const startedAt = Date.now();
    let captured = null;
    let activityContext = null;
    let callContext = this.context;
    try {
      // Activity belongs to the workspace that was active when the request
      // started, including a live control request that later switches roots.
      // Control handlers still receive the mutable live workspace below.
      activityContext = this.context.workspace?.captureContext?.() ?? null;
    } catch {
      activityContext = null;
    }
    if (!LIVE_WORKSPACE_TOOLS.has(name)) {
      captured = activityContext;
      // Cancellation belongs to the request even when the tool starts before a
      // workspace has been configured, or captureContext cannot open one. Keep the
      // live workspace fallback in that case while still passing the signal to the
      // handler, so an async setup or diagnostic call never becomes uncancellable.
      callContext = { ...this.context, workspace: captured ?? this.context.workspace, signal };
    } else if (signal) {
      callContext = { ...this.context, signal };
    }
    if (flight) {
      flight.name = name;
      flight.workspace = activityContext;
    }
    this.#setActivity(activityContext, flight, true);
    if (flight) {
      flight.heartbeatTimer = setInterval(() => {
        if (!flight.cancelled) this.#setActivity(activityContext, flight, true);
      }, 10_000);
      if (typeof flight.heartbeatTimer.unref === 'function') flight.heartbeatTimer.unref();
    }
    try {
      // Every handler already runs inside this try, so a synchronous throw and a
      // rejected promise land in the same catch below either way: await on a
      // function that throws synchronously rejects the surrounding async call
      // exactly like a real rejection would.
      const run = () => this.registry.call(name, args, callContext);
      const value = this.context.ui && typeof this.context.ui.withWorkspaceContext === 'function'
        ? await this.context.ui.withWorkspaceContext(captured, run)
        : await run();
      const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
      // Transport level backstop: every tool result is redacted before it is
      // serialised, whatever tool built it. This is what protects against a
      // future tool leaking a secret field by accident, not just the ones this
      // change already redacted at the source.
      const structuredContent = /** @type {Record<string, unknown>} */ (redact(raw));
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
        isError: false,
      };
    } catch (error) {
      const payload = toErrorPayload(error);
      const durationMs = Date.now() - startedAt;
      log.warn('tool failed', { tool: name, message: payload.message, durationMs });
      this.#logToolFailure({ tool: name, message: payload.message, durationMs }, captured?.root ?? null);
      const structuredContent = /** @type {Record<string, unknown>} */ (redact({ ok: false, ...payload }));
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
        isError: true,
      };
    } finally {
      if (flight?.heartbeatTimer) clearInterval(flight.heartbeatTimer);
      if (flight) flight.heartbeatTimer = null;
    }
  }

  /** @param {any} captured @param {any} flight @param {boolean} active */
  #setActivity(captured, flight, active) {
    if (!flight) return;
    const ui = this.context.ui;
    if (!ui || typeof ui.setChatActivity !== 'function') return;
    const apply = () => ui.setChatActivity(active ? { active: true, tool: flight?.name, requestId: flight?.requestId } : { active: false, requestId: flight?.requestId });
    try {
      if (typeof ui.withWorkspaceContext === 'function') ui.withWorkspaceContext(captured, apply);
      else apply();
    } catch (error) {
      log.debug('chat activity update skipped', { error: String(error) });
    }
  }

  /** @param {any} flight */
  #clearActivity(flight) {
    if (!flight) return;
    const ui = this.context.ui;
    if (!ui || typeof ui.setChatActivity !== 'function') return;
    const apply = () => ui.setChatActivity({ active: false, requestId: flight.requestId });
    try {
      if (typeof ui.withWorkspaceContext === 'function') ui.withWorkspaceContext(flight.workspace, apply);
      else apply();
    } catch (error) {
      log.debug('chat activity cleanup skipped', { error: String(error) });
    }
  }

  /**
   * Append one line to <workspace>/.social-campaign/logs/tool-failures.log, so a
   * later investigation (this diagnosis included) has evidence of every failed
   * tool call, not just whatever happened to also hit a warn-level server.log
   * line. Rotated the same way server.log is. Best effort: a workspace that
   * has not been opened yet, or a filesystem hiccup, never turns a tool
   * failure into a second failure.
   * @param {{tool: string, message: string, durationMs: number}} entry
   */
  #logToolFailure(entry, capturedRoot = null) {
    const root = capturedRoot ?? (this.context && this.context.workspace ? this.context.workspace.root : null);
    if (!root) return;
    const safeEntry = { ...redact(entry), message: looksLikeSecret(entry.message) ? '[redacted]' : entry.message };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...safeEntry });
    appendRotating(toolFailuresLogPath(root), line);
  }

  /** @param {Record<string, unknown>} message */
  #send(message) {
    this.output.write(`${JSON.stringify(message)}\n`);
  }
}
