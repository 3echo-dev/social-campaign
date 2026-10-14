#!/usr/bin/env node
/**
 * Hook forwarder. hooks/hooks.json runs this instead of the hook scripts themselves:
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/forward.mjs" hooks/board-stop.mjs
 *
 * Claude Code keeps using the version folder a chat started with for its hook commands, even after
 * the plugin was updated. This file resolves the newest installed version with the same resolver
 * the MCP launcher uses (scripts/lib/plugin-versions.mjs) and runs that version's copy of the named
 * script (a path under scripts/) with the same stdin, stdout, stderr and exit code.
 *
 * If anything about the newer version cannot be used (no cache layout, folder gone, script missing,
 * process could not start), the script of this folder runs instead. A script that ran and exited
 * non-zero is not retried: its exit code (2 blocks a tool call) belongs to the host.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveNewestRoot, samePath } from '../lib/plugin-versions.mjs';

const OWN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = process.argv[2] || '';

// Only a plain relative .mjs path under scripts/ is ever run.
if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.mjs$/.test(target)) {
  process.stderr.write('Social Campaign hook forwarder: no valid script name given.\n');
  process.exit(0);
}

function readInput() {
  if (process.stdin.isTTY) return Buffer.alloc(0);
  try {
    return readFileSync(0);
  } catch {
    return Buffer.alloc(0);
  }
}

function run(root, input) {
  return spawnSync(process.execPath, [...process.execArgv, join(root, 'scripts', target), ...process.argv.slice(3)], {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    windowsHide: true,
  });
}

function main() {
  const input = readInput();
  let root = OWN_ROOT;
  try {
    const found = resolveNewestRoot(OWN_ROOT, { entry: `scripts/${target}` });
    if (found.root && existsSync(join(found.root, 'scripts', target))) root = found.root;
  } catch {
    root = OWN_ROOT;
  }
  let result = run(root, input);
  if (result.error && !samePath(root, OWN_ROOT)) result = run(OWN_ROOT, input);
  if (result.error) {
    process.stderr.write(`Social Campaign hook forwarder: could not run ${target}: ${result.error.message}\n`);
    return 0;
  }
  return result.status ?? (result.signal ? 1 : 0);
}

process.exitCode = main();
