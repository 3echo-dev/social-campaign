/**
 * The operating system's own "choose a folder" dialog, opened on the person's computer.
 *
 * The board is a sandboxed browser page and cannot read a local path, so a board request (brand_folder_pick) asks the Director to open
 * this dialog through the pipeline_folder_pick tool. Nothing here reads, copies or changes a file: the dialog only returns the folder
 * the person chose.
 *
 *   Windows  PowerShell (-STA) shows the Explorer-style folder dialog (IFileOpenDialog with the pick-folders option) over a hidden,
 *            top-most owner window so it is never left behind other windows; if that cannot be built, the older folder dialog is used.
 *   macOS    osascript "choose folder".
 *   Linux    zenity, else kdialog (a computer with neither, or with no screen, cannot show a dialog).
 *
 * Every program is started with an argument list and never through a shell, and nothing the person typed ever goes into a command: the
 * dialog title is the one string passed in, and on Windows it travels in an environment variable the script reads, not in the script.
 * The dialog gives up after FOLDER_PICK_TIMEOUT_MS. The answer is always one of
 *   { status: 'chosen', folder }          the full path of the folder
 *   { status: 'cancelled' }               the person closed the dialog or pressed Cancel
 *   { status: 'timeout' }                 nobody answered in time (the dialog is closed)
 *   { status: 'unavailable', reason }     no dialog could be shown on this computer
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** How long the dialog may stay open with nobody answering. */
export const FOLDER_PICK_TIMEOUT_MS = 3 * 60 * 1000;
export const FOLDER_PICK_TITLE = 'Choose the folder of your videos, photos and fonts';
const TITLE_MAX = 120;
const OUTPUT_MAX = 64 * 1024;
const DIALOG_FAILED = /cannot open display|can't open display|no display|failed to (?:open|connect|initialize)|not running/i;
const NOT_AVAILABLE = 'A folder picker could not be opened on this computer.';

// The Windows script. It prints `PICKED:<base64 of the UTF-8 path>` or `CANCELLED` on its standard output (a path is never printed raw, so
// no console code page can change it) and exits with 0; anything it cannot do ends with a non-zero exit and a line on standard error.
export const WINDOWS_PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$title = [string]$env:SC_PICK_TITLE
$modern = $true
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SocialCampaignFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  private class FileOpenDialogCom { }
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  // Returns the chosen folder, or null when the person cancelled. FOS_NOCHANGEDIR | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST.
  public static string Pick(IntPtr owner, string title) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialogCom();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | 0x8u | 0x20u | 0x40u | 0x800u);
    if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
    int hr = dialog.Show(owner);
    if (hr == unchecked((int)0x800704C7)) return null;
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    IShellItem item;
    dialog.GetResult(out item);
    string path;
    item.GetDisplayName(0x80058000u, out path);
    return path;
  }
}
'@
} catch { $modern = $false }

# A tiny invisible window that is always on top owns the dialog, so the dialog opens in front of whatever else is open. The first window
# a process shows can be swallowed by the way the process was started, so a throw-away one is shown and closed first.
$spare = New-Object System.Windows.Forms.Form
$spare.ShowInTaskbar = $false
$spare.Opacity = 0
$spare.Width = 1
$spare.Height = 1
$spare.Show()
$spare.Close()
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Choose a folder'
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.Width = 1
$owner.Height = 1
# The dialog opens with its top-left corner at its owner, so the owner sits where a roughly 900 x 520 dialog is centred on the screen the mouse is on.
$area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(($area.Left + [Math]::Max(0, [int](($area.Width - 900) / 2))), ($area.Top + [Math]::Max(0, [int](($area.Height - 520) / 2))))
$owner.Show()
$owner.Activate()
[System.Windows.Forms.Application]::DoEvents()

$path = $null
$done = $false
try {
  if ($modern) {
    try {
      $path = [SocialCampaignFolderPicker]::Pick($owner.Handle, $title)
      $done = $true
    } catch { $done = $false }
  }
  if (-not $done) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $title
    $dialog.ShowNewFolderButton = $true
    try { $dialog.UseDescriptionForTitle = $true } catch { }
    try { $dialog.AutoUpgradeEnabled = $true } catch { }
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $path = $dialog.SelectedPath }
  }
} finally {
  $owner.Close()
  $owner.Dispose()
}
if ([string]::IsNullOrWhiteSpace($path)) {
  [Console]::Out.WriteLine('CANCELLED')
} else {
  [Console]::Out.WriteLine('PICKED:' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($path)))
}
`;

/** The Windows PowerShell program: the full path under the system folder, so a look-alike earlier on the PATH is never run. */
function powershellProgram(env) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const full = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(full) ? full : 'powershell.exe';
}

const encodeScript = script => Buffer.from(script, 'utf16le').toString('base64');

/** A title that is safe to hand to a dialog: one line of plain text, never empty. */
export function cleanTitle(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return text || FOLDER_PICK_TITLE;
}

/**
 * The commands to try, in order, on this platform: [{ command, args, env?, parse(stdout, code) }]. `parse` turns what the program printed
 * into { status: 'chosen', folder } or { status: 'cancelled' }, or throws when the output cannot be trusted.
 */
export function folderPickCommands({ platform = process.platform, title, env = process.env } = {}) {
  const shown = cleanTitle(title);
  if (platform === 'win32') {
    return [{
      command: powershellProgram(env),
      args: ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeScript(WINDOWS_PICKER_SCRIPT)],
      env: { SC_PICK_TITLE: shown },
      parse: stdout => {
        const line = stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean).at(-1) ?? '';
        if (line === 'CANCELLED') return { status: 'cancelled' };
        const found = /^PICKED:([A-Za-z0-9+/=]+)$/.exec(line);
        if (!found) throw new Error('The folder dialog gave no answer.');
        return { status: 'chosen', folder: Buffer.from(found[1], 'base64').toString('utf8') };
      },
    }];
  }
  const oneLine = stdout => stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean)[0] ?? '';
  if (platform === 'darwin') {
    return [{
      command: 'osascript',
      // The title is a separate argument the script reads (item 1 of argv), never part of the script text.
      args: ['-e', 'on run argv', '-e', 'return POSIX path of (choose folder with prompt (item 1 of argv))', '-e', 'end run', shown],
      parse: stdout => ({ status: 'chosen', folder: oneLine(stdout) }),
      cancelled: (code, stderr) => code === 1 && /-128|cancel/i.test(stderr),
    }];
  }
  const shownOnX = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (!shownOnX) return [];
  return [
    { command: 'zenity', args: ['--file-selection', '--directory', `--title=${shown}`], parse: stdout => ({ status: 'chosen', folder: oneLine(stdout) }), cancelled: (code, stderr) => (code === 1 || code === 5) && !DIALOG_FAILED.test(stderr) },
    { command: 'kdialog', args: ['--getexistingdirectory', env.HOME || '/', '--title', shown], parse: stdout => ({ status: 'chosen', folder: oneLine(stdout) }), cancelled: (code, stderr) => code === 1 && !DIALOG_FAILED.test(stderr) },
  ];
}

/** Run one program to its end or to the timeout. Never rejects: { code, stdout, stderr, timedOut, missing, error }. */
function run({ command, args, env, timeoutMs, spawnImpl, baseEnv, signal }) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: { ...baseEnv, ...(env ?? {}) } });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, missing: error?.code === 'ENOENT', error });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ stdout, stderr, timedOut, missing: false, error: null, code: null, ...result });
    };
    const stop = () => { try { child.kill(); } catch { /* Already gone. */ } };
    const onAbort = () => { timedOut = true; stop(); };
    const timer = setTimeout(onAbort, timeoutMs);
    timer.unref?.();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.stdout?.on('data', chunk => { if (stdout.length < OUTPUT_MAX) stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { if (stderr.length < OUTPUT_MAX) stderr += chunk.toString('utf8'); });
    child.on('error', error => finish({ code: null, missing: error?.code === 'ENOENT', error }));
    child.on('close', code => finish({ code }));
  });
}

/** A path the dialog gave back, tidied: one absolute folder path without a trailing separator (a drive or the root keeps its own). */
export function cleanPickedPath(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!text || text.length > 1000) return null;
  const trimmed = text.replace(/[\\/]+$/, '');
  const path = /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed || text;
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? path : null;
}

/**
 * Open the folder dialog and wait for the person. Never throws. `platform`, `spawnImpl` and `env` are for tests; `signal` closes the dialog
 * when the caller stops waiting.
 */
export async function pickFolder({ title, timeoutMs = FOLDER_PICK_TIMEOUT_MS, platform = process.platform, spawnImpl = spawn, env = process.env, signal } = {}) {
  const commands = folderPickCommands({ platform, title, env });
  if (!commands.length) return { status: 'unavailable', reason: `${NOT_AVAILABLE} Paste the folder's path instead.` };
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : FOLDER_PICK_TIMEOUT_MS;
  const started = Date.now();
  let reason = NOT_AVAILABLE;
  for (const command of commands) {
    const left = Math.max(1, limit - (Date.now() - started));
    const outcome = await run({ ...command, timeoutMs: left, spawnImpl, baseEnv: env, signal });
    if (outcome.timedOut) return { status: 'timeout' };
    if (outcome.missing) { reason = `${NOT_AVAILABLE} Install zenity or kdialog, or paste the folder's path instead.`; continue; }
    if (outcome.error) { reason = NOT_AVAILABLE; continue; }
    if (command.cancelled?.(outcome.code, outcome.stderr)) return { status: 'cancelled' };
    if (outcome.code !== 0) {
      // A program that exits with an error and says nothing is a dialog the person closed (osascript, zenity); anything with a message is a real failure.
      if (!outcome.stderr.trim() && !outcome.stdout.trim() && platform !== 'win32') return { status: 'cancelled' };
      reason = NOT_AVAILABLE;
      continue;
    }
    let answer;
    try { answer = command.parse(outcome.stdout, outcome.code); } catch { reason = NOT_AVAILABLE; continue; }
    if (answer.status === 'cancelled') return answer;
    const folder = cleanPickedPath(answer.folder);
    return folder ? { status: 'chosen', folder } : { status: 'cancelled' };
  }
  return { status: 'unavailable', reason: `${reason} Paste the folder's path instead.` };
}
