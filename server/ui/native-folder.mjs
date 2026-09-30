/**
 * The operating system's own folder chooser.
 *
 * Most people expect a Browse button to open the dialog their file explorer uses, not
 * a list drawn inside a web page. This module is that button's other half: it spawns
 * the platform's folder chooser and resolves with the path the person picked.
 *
 * Three rules hold here, because this is the one place the plugin starts a process:
 *
 *   - No shell. Every spawn passes an argument array and the command script is a
 *     constant in this file, so nothing a user types can become part of a command.
 *   - Always bounded. A dialog nobody answers is killed after DIALOG_TIMEOUT_MS.
 *   - Never fatal. A missing binary, a cancel, a crash and a timeout all resolve with
 *     null, and the caller falls back to the picker inside the pane.
 *
 * The pane never waits on this through an MCP tool call. It starts a request over
 * POST /api/native-folder, gets a ticket back at once, and polls that ticket, which
 * is the same shape as the gate pattern the review tools use.
 */

import { spawn } from 'node:child_process';
import { isAbsolute, normalize } from 'node:path';

import { log } from '../lib/log.mjs';

/** How long a dialog nobody answers is allowed to stay open. */
export const DIALOG_TIMEOUT_MS = 120_000;

/**
 * The PowerShell that drives the standard Windows folder browser. It is a constant:
 * no value from the pane is ever interpolated into it. It prints the chosen path on
 * stdout, or nothing when the person presses Cancel.
 */
const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
  '$dialog.Description = "Choose the folder for Social Campaign";',
  '$dialog.ShowNewFolderButton = $true;',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
].join(' ');

/**
 * The command for this platform, or null when there is nothing to try.
 * @param {string} platform
 * @returns {{command: string, args: string[]}|null}
 */
export function dialogCommand(platform) {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
    };
  }
  if (platform === 'darwin') {
    return { command: 'osascript', args: ['-e', 'POSIX path of (choose folder)'] };
  }
  // Every other platform is treated as Linux-like. zenity is the only chooser tried;
  // when it is not installed the pane's own picker is the answer.
  return { command: 'zenity', args: ['--file-selection', '--directory'] };
}

/**
 * Open the operating system's folder chooser.
 *
 * @param {{platform?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{path: string|null, reason: string}>} `path` is null whenever the
 *   caller should fall back to the picker in the pane. `reason` says why, for the log
 *   and for a plain sentence in the pane: "chosen", "cancelled", "unavailable" or
 *   "timeout".
 */
export function chooseFolderNative(options = {}) {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? DIALOG_TIMEOUT_MS;
  const chosen = dialogCommand(platform);
  if (!chosen) return Promise.resolve({ path: null, reason: 'unavailable' });

  return new Promise((resolvePromise) => {
    let settled = false;
    /** @param {string|null} path @param {string} reason */
    const finish = (path, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.info('native folder dialog closed', { reason, platform });
      resolvePromise({ path, reason });
    };

    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      // No shell: the command and its arguments go across as an array.
      child = spawn(chosen.command, chosen.args, { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return finish(null, 'unavailable');
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The dialog may already be gone; nothing to do either way.
      }
      finish(null, 'timeout');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      out += chunk;
      if (out.length > 8192) out = out.slice(0, 8192);
    });
    // stderr is drained and dropped: a chooser that complains still just means fallback.
    child.stderr?.resume();
    child.on('error', () => finish(null, 'unavailable'));
    child.on('close', (code) => {
      const line = out.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? '';
      // osascript and zenity exit non-zero on Cancel; PowerShell exits 0 and prints
      // nothing. Either way an empty line means the person backed out.
      if (line.length === 0) return finish(null, code === 0 ? 'cancelled' : 'cancelled');
      if (!isAbsolute(line)) return finish(null, 'unavailable');
      // `choose folder` on macOS hands back a trailing separator; normalize drops it.
      finish(normalize(line), 'chosen');
    });
  });
}
