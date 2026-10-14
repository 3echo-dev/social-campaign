#!/usr/bin/env node
/**
 * Social Campaign MCP launcher. The one file Claude Code starts, and the file that does not change.
 *
 * Claude Code keeps running the version folder a chat started with, even after the plugin is
 * updated (hooks, MCP servers and skills keep the old path until /reload-plugins or a new chat),
 * and Claude cannot type slash commands. So this launcher owns the MCP connection and runs the
 * real server (server/main.mjs) of the newest installed version as a child process:
 *
 *   Claude Code <-- stdio --> launcher <-- stdio --> server/main.mjs of the newest version
 *
 * Why a child process and not a dynamic import: the server keeps module-level state and open
 * database handles, and a version swap needs the old code fully gone and the new code fully
 * fresh. Two versions of the same module graph in one process, one stdin reader, and no way to
 * unload the old one is fragile; a child can be started, handshaken and stopped independently,
 * and its stdout can never corrupt the launcher's framing. The cost is one extra process.
 *
 * Swap, when the install record names a different (newer) version folder, checked on each request
 * and every 5 seconds:
 *   1. wait until no request is in flight (new requests queue behind the swap, for a moment)
 *   2. start the newer server and replay the client's `initialize` handshake to it privately
 *   3. check that it answers tools/list
 *   4. route new requests to it, retire the old server, send notifications/tools/list_changed
 * Any failure keeps the old server running, is written to the swap record (so the old server's
 * updateWaiting turns true and the Director says "open a new chat"), and is not retried for the
 * same version more than twice.
 *
 * Nothing but JSON-RPC may go to stdout. Diagnostics go to stderr.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SERVER_ENTRY, clearSwapFailure, pathKey, readManifest, recordSwapFailure, resolveNewestRoot, samePath,
} from '../scripts/lib/plugin-versions.mjs';

const OWN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = Number(process.env.SOCIAL_CAMPAIGN_SWAP_POLL_MS) || 5000;
const CHECK_GAP_MS = 1000;
const HANDSHAKE_MS = Number(process.env.SOCIAL_CAMPAIGN_SWAP_HANDSHAKE_MS) || 30000;
const RETRY_AFTER_MS = [20000, 120000];
const LIST_CHANGED = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };

const say = (message, extra) => process.stderr.write(`[social-campaign launcher] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`);
const writeClient = message => {
  try {
    process.stdout.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  } catch { /* the client went away */ }
};
const keyOf = id => JSON.stringify(id);
const errorReply = (id, message) => ({ jsonrpc: '2.0', id, error: { code: -32603, message } });

/** What the launcher remembers about the client's handshake, so a new server can be given the same one. */
const client = { initParams: null, initialized: false };
/** Requests sent to a server and not answered yet: key -> {backend, line, init}. */
const pending = new Map();
/** Requests a server sent to the client and not answered yet: key -> backend. */
const serverAsks = new Map();
/** Internal requests (handshake replay, tools/list check): key -> {resolve, timer}. */
const internal = new Map();
/** Versions the launcher could not move to: pathKey -> {count, retryAt}. */
const failed = new Map();
let internalSeq = 0;
let active = null;
let lastGoodRoot = null;
let lastCheckAt = 0;
let stopping = false;
const crashes = [];

class Backend {
  constructor(root, version) {
    this.root = root;
    this.version = version;
    this.retiring = false;
    this.responded = false;
    this.exited = false;
    this.buffer = '';
    const entry = join(root, SERVER_ENTRY);
    this.child = spawn(process.execPath, [...process.execArgv, entry], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
        SOCIAL_CAMPAIGN_LAUNCH_ROOT: OWN_ROOT,
        SOCIAL_CAMPAIGN_LAUNCH_VERSION: String(readManifest(OWN_ROOT)?.version ?? ''),
      },
    });
    this.child.stdin.on('error', () => { /* the exit handler reports it */ });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.#onData(chunk));
    this.child.on('error', error => this.#onExit(`spawn failed: ${error.message}`));
    this.child.on('exit', (code, signal) => this.#onExit(`exited code=${code} signal=${signal}`));
  }

  send(message) {
    if (this.exited) return false;
    try {
      this.child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  #onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) onBackendLine(this, line);
      index = this.buffer.indexOf('\n');
    }
  }

  #onExit(why) {
    if (this.exited) return;
    this.exited = true;
    onBackendExit(this, why);
  }

  /** Close stdin so the server finishes and exits by itself, then make sure. */
  retire() {
    this.retiring = true;
    try { this.child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => { if (!this.exited) this.child.kill('SIGTERM'); }, 5000).unref();
  }

  inFlight() {
    let count = 0;
    for (const entry of pending.values()) if (entry.backend === this) count += 1;
    return count;
  }
}

function startBackend(root) {
  const version = String(readManifest(root)?.version ?? '');
  say('starting server', { root, version });
  return new Backend(root, version);
}

/** Ask a server something privately and wait for the answer. */
function ask(backend, method, params) {
  const id = `__sc_${++internalSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { internal.delete(keyOf(id)); reject(new Error(`${method} timed out`)); }, HANDSHAKE_MS);
    internal.set(keyOf(id), { resolve: message => { clearTimeout(timer); message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result); }, backend, reject, timer });
    if (!backend.send({ jsonrpc: '2.0', id, method, params })) {
      clearTimeout(timer);
      internal.delete(keyOf(id));
      reject(new Error('server is not running'));
    }
  });
}

function onBackendLine(backend, line) {
  backend.responded = true;
  let message = null;
  try { message = JSON.parse(line); } catch { /* forward as is */ }
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const isResponse = message.id !== undefined && message.id !== null && message.method === undefined;
    if (isResponse) {
      const key = keyOf(message.id);
      const wait = internal.get(key);
      if (wait) {
        internal.delete(key);
        wait.resolve(message);
        return;
      }
      const entry = pending.get(key);
      if (entry && entry.backend === backend) {
        pending.delete(key);
        if (entry.init && message.result) {
          // The client sees the first server's handshake for good; tell it the tool list may change.
          const capabilities = message.result.capabilities ?? {};
          message.result = { ...message.result, capabilities: { ...capabilities, tools: { ...(capabilities.tools ?? {}), listChanged: true } } };
          writeClient(message);
        } else {
          writeClient(line);
        }
        enqueue(maybeSwap);
        return;
      }
    } else if (message.id !== undefined && message.id !== null && message.method !== undefined) {
      serverAsks.set(keyOf(message.id), backend);
    }
  }
  writeClient(line);
}

function onBackendExit(backend, why) {
  for (const [key, wait] of internal) if (wait.backend === backend) { internal.delete(key); wait.reject(new Error(`server ${why}`)); }
  if (backend.retiring || stopping) {
    for (const [key, entry] of pending) if (entry.backend === backend) { pending.delete(key); writeClient(errorReply(JSON.parse(key), 'Social Campaign switched versions; please repeat the request.')); }
    return;
  }
  say('server stopped unexpectedly', { root: backend.root, why });
  const orphaned = [...pending].filter(([, entry]) => entry.backend === backend);
  const bootFailure = !backend.responded && orphaned.some(([, entry]) => entry.init);
  const wasActive = active === backend;
  if (wasActive) active = null;
  if (bootFailure) {
    // It died before the client's handshake got an answer: mark this version bad and start the folder this launcher came from.
    failed.set(pathKey(backend.root), { count: 9, retryAt: Infinity });
    const fallback = samePath(backend.root, OWN_ROOT) ? null : OWN_ROOT;
    if (fallback) {
      const next = startBackend(fallback);
      active = next;
      for (const [key, entry] of orphaned) {
        entry.backend = next;
        pending.set(key, entry);
        next.send(entry.line);
      }
      return;
    }
  }
  for (const [key] of orphaned) {
    pending.delete(key);
    writeClient(errorReply(JSON.parse(key), 'The Social Campaign server stopped while handling this request. Try again.'));
  }
  if (wasActive) crashes.push(Date.now());
}

/** One serial queue: client lines, the poll timer and swaps never run at the same time. */
let chain = Promise.resolve();
function enqueue(task) {
  chain = chain.then(task).catch(error => say('task failed', { error: String(error?.stack ?? error) }));
  return chain;
}

async function bringUpAfterCrash() {
  const recent = crashes.filter(at => Date.now() - at < 60000).length;
  if (recent >= 4) throw new Error('the server keeps stopping');
  const pick = resolveNewestRoot(OWN_ROOT);
  const root = failed.get(pathKey(pick.root))?.retryAt === Infinity ? (lastGoodRoot ?? OWN_ROOT) : pick.root;
  const next = startBackend(root);
  try {
    if (client.initParams) await handshake(next);
  } catch (error) {
    next.retiring = true;
    try { next.child.kill('SIGTERM'); } catch { /* gone */ }
    throw error;
  }
  active = next;
}

/** Give a fresh server the handshake the client already did with the old one, and check it can list tools. */
async function handshake(backend) {
  await ask(backend, 'initialize', client.initParams);
  if (client.initialized) backend.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const listed = await ask(backend, 'tools/list', {});
  if (!Array.isArray(listed?.tools) || listed.tools.length === 0) throw new Error('tools/list returned no tools');
  return listed.tools.length;
}

/** Move to the newest installed version when it differs from the running one and nothing is in flight. */
async function maybeSwap() {
  if (stopping || !active || active.inFlight() > 0 || !client.initParams) return;
  const now = Date.now();
  if (now - lastCheckAt < CHECK_GAP_MS) return;
  lastCheckAt = now;
  const found = resolveNewestRoot(OWN_ROOT);
  if (!found.root || samePath(found.root, active.root)) return;
  const record = failed.get(pathKey(found.root));
  if (record && now < record.retryAt) return;

  const old = active;
  say('swapping', { from: old.version, to: found.version, root: found.root });
  let next = null;
  try {
    next = startBackend(found.root);
    const tools = await handshake(next);
    if (next.exited) throw new Error('the new server stopped during the handshake');
    active = next;
    lastGoodRoot = found.root;
    failed.delete(pathKey(found.root));
    clearSwapFailure(process.pid);
    old.retire();
    say('swapped', { to: found.version, tools });
    if (client.initialized) writeClient(LIST_CHANGED);
  } catch (error) {
    const count = (record?.count ?? 0) + 1;
    failed.set(pathKey(found.root), { count, retryAt: count > RETRY_AFTER_MS.length ? Infinity : Date.now() + RETRY_AFTER_MS[count - 1] });
    say('swap failed, keeping the running server', { to: found.version, error: String(error?.message ?? error) });
    if (next) { next.retiring = true; try { next.child.kill('SIGTERM'); } catch { /* gone */ } }
    active = old;
    recordSwapFailure(process.pid, { fromRoot: old.root, fromVersion: old.version, toRoot: found.root, toVersion: found.version, error: String(error?.message ?? error) });
  }
}

async function onClientLine(line) {
  let message = null;
  try { message = JSON.parse(line); } catch { /* the server answers with a parse error */ }
  const isMessage = message && typeof message === 'object' && !Array.isArray(message);
  const isRequest = isMessage && message.method !== undefined && message.id !== undefined && message.id !== null;

  if (!active && !stopping) {
    try { await bringUpAfterCrash(); } catch (error) {
      if (isRequest) writeClient(errorReply(message.id, `The Social Campaign server could not be started: ${error.message}`));
      return;
    }
  }
  if (isRequest || (isMessage && message.method === 'notifications/initialized')) await maybeSwap();
  if (!active) return;

  if (isMessage && message.method === 'initialize' && isRequest) {
    client.initParams = message.params ?? {};
    pending.set(keyOf(message.id), { backend: active, line, init: true });
  } else if (isMessage && (message.method === 'notifications/initialized' || message.method === 'initialized')) {
    client.initialized = true;
  } else if (isRequest) {
    pending.set(keyOf(message.id), { backend: active, line, init: false });
  } else if (isMessage && message.method === 'notifications/cancelled') {
    const target = pending.get(keyOf(message.params?.requestId ?? message.params?.id));
    (target?.backend ?? active).send(line);
    return;
  } else if (isMessage && message.method === undefined && message.id !== undefined) {
    const owner = serverAsks.get(keyOf(message.id));
    serverAsks.delete(keyOf(message.id));
    (owner && !owner.exited ? owner : active).send(line);
    return;
  }
  if (!active.send(line) && isRequest) {
    pending.delete(keyOf(message.id));
    writeClient(errorReply(message.id, 'The Social Campaign server is not running.'));
  }
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearSwapFailure(process.pid);
  for (const backend of new Set([active, ...[...pending.values()].map(entry => entry.backend)])) backend?.retire();
  setTimeout(() => process.exit(0), 3000).unref();
  // Exit as soon as the servers have.
  const done = () => { if (![active, ...[...pending.values()].map(entry => entry.backend)].some(backend => backend && !backend.exited)) process.exit(0); };
  const poll = setInterval(done, 50);
  poll.unref?.();
  done();
}

function main() {
  process.stdout.on('error', () => { /* EPIPE: the client went away */ });
  process.on('uncaughtException', error => say('uncaught exception', { error: String(error?.stack ?? error) }));
  process.on('unhandledRejection', error => say('unhandled rejection', { error: String(error?.stack ?? error) }));
  process.on('exit', () => clearSwapFailure(process.pid));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, shutdown);

  const first = resolveNewestRoot(OWN_ROOT);
  lastGoodRoot = first.root;
  active = startBackend(first.root);

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) enqueue(() => onClientLine(line));
      index = buffer.indexOf('\n');
    }
  });
  // The client closed the connection: give answers already in flight a moment to reach it, then stop the server.
  const clientGone = async () => {
    for (let waited = 0; pending.size > 0 && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    shutdown();
  };
  process.stdin.on('end', () => enqueue(clientGone));
  process.stdin.on('error', () => enqueue(clientGone));

  let polling = false;
  setInterval(() => {
    if (polling || stopping) return;
    polling = true;
    enqueue(maybeSwap).finally(() => { polling = false; });
  }, POLL_MS).unref();
}

main();
