/**
 * The research helper: detect it, install it, keep it current, report on it.
 *
 * Some sites show almost nothing to a plain page fetch. The helper puts Scrapling (a Python page reader that can drive a
 * real browser), yt-dlp and a private copy of the Chromium browser they drive on the person's computer, in their own
 * virtual environment, and optionally faster-whisper for speech to text on the CPU. All of it is somebody else's
 * software, so none of it is installed without the person choosing to (a fresh install needs `confirmed: true`, which
 * only an explicit yes in chat sets), and none of it is ever required. Python itself must already be there: it is never
 * installed for the person, who gets the command instead.
 *
 * The environment and its browser go in the plugin data folder when Claude Code provides one (removed on uninstall),
 * and in `~/.social-campaign/research-helper` otherwise. An install already in that older place keeps being used.
 *
 * What it installs is exactly what the code calls, and nothing else: Scrapling with its fetchers (plus Playwright and
 * Patchright, which Scrapling requires, and curl_cffi), yt-dlp with browser impersonation, and, only when asked,
 * faster-whisper. Earlier releases also installed the Crawl4AI browser worker and the two retired discovery libraries; no code
 * calls those now, so an update uninstalls them and the packages only they needed, from this environment only (helper-packages.mjs).
 *
 * Three rules hold this file together.
 *
 * Nothing runs through a shell. Every child process is `spawn` with an argument array, so a folder name with a space or a
 * quote in it is an argument, never syntax.
 *
 * Nothing blocks. `startInstall` returns the moment the work is handed to the event loop; `research_helper_status` and
 * `research_tools_check` read `installProgress()` and report the steps as they go by. Every step carries its own timeout,
 * so a wedged installer ends as a plain failure rather than a status that says "Installing" forever.
 *
 * Nothing throws at the caller. Every failure becomes a recorded state with a sentence a person can act on, because a
 * failed optional extra must never take the rest of setup down with it.
 *
 * What is recorded, and who reads it
 * ----------------------------------
 * The outcome is written to `<workspace>/.social-campaign/integrations.json` under `research_helper`, whose `state` is
 * `connected`, `not_connected` or `degraded`. That is the agreed handover point for the `research.browser` capability:
 * this file writes the state, and the capability resolver reads it.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { newId, nowIso } from '../lib/ids.mjs';
import { log } from '../lib/log.mjs';
import { pythonChildEnv } from '../lib/python-env.mjs';
import {
  managedBrowsersPath,
  managedEnvironmentRoot,
  managedPythonPath,
  pluginDataEnvironmentRoot,
  researchHelperChildEnv,
  hasUsableResearchHelperRecord,
  readResearchHelperRecord,
  updateResearchHelperRecord,
  RESEARCH_HELPER_ENVIRONMENT_KIND,
  RESEARCH_HELPER_KEY,
  RESEARCH_HELPER_RECORD_VERSION,
} from './research-helper-record.mjs';
import {
  STALE_LABELS,
  STALE_PACKAGES,
  compareVersions,
  installedVersions,
  normalizeDistName,
  planPrune,
  readLatestVersions,
  refreshLatestVersions,
  sitePackagesOf,
  whenLatestSettles,
} from './helper-packages.mjs';
import {
  FASTER_WHISPER_REQUIREMENT,
  SPEECH_MODEL,
  SPEECH_SIZE_WORDS,
  fetchSpeechModel,
  speechModelPresent,
} from './speech-helper.mjs';
import { globalConfigDir } from '../lib/paths.mjs';
import { killTree } from '../social/backends/ytdlp.mjs';
import { YTDLP_STALE_DAYS, findOnPath, ytdlpAgeDays } from '../lib/install-hints.mjs';

/** The capability this helper backs. The resolver reads the recorded state under this name. */
export const RESEARCH_CAPABILITY = 'research.browser';

/** The key inside integrations.json. */
export { RESEARCH_HELPER_KEY, RESEARCH_HELPER_RECORD_VERSION } from './research-helper-record.mjs';
export { installedVersions, sitePackagesOf } from './helper-packages.mjs';
export { whenLatestSettles as whenResearchLatestSettles } from './helper-packages.mjs';

/**
 * The one pin set. These versions fit together (checked with pip): Scrapling 0.4.15 needs playwright >= 1.62,
 * patchright >= 1.62.1 and curl_cffi >= 0.16.1; yt-dlp[curl-cffi] accepts them. Playwright and Patchright share one
 * Chromium build only while their versions match, so they move together. Every pip run in this file passes them as a
 * constraints file, so no install or upgrade can move these packages, and an update changes them here, in one place.
 */
export const SCRAPLING_VERSION = '0.4.15';
export const PLAYWRIGHT_VERSION = '1.63.0';
export const PATCHRIGHT_VERSION = '1.63.0';
export const CURL_CFFI_VERSION = '0.16.3';

/** Pinned packages by their normalised distribution name. */
export const PINNED_VERSIONS = {
  scrapling: SCRAPLING_VERSION,
  playwright: PLAYWRIGHT_VERSION,
  patchright: PATCHRIGHT_VERSION,
  'curl-cffi': CURL_CFFI_VERSION,
};

/** What pip is asked to install for the pinned set. */
export const PINNED_REQUIREMENTS = [
  `scrapling[fetchers]==${SCRAPLING_VERSION}`,
  `playwright==${PLAYWRIGHT_VERSION}`,
  `patchright==${PATCHRIGHT_VERSION}`,
  `curl_cffi==${CURL_CFFI_VERSION}`,
];

/** The constraints file written inside the environment folder; pip reads it with -c. */
export const CONSTRAINTS_FILE_NAME = 'social-campaign-pins.txt';

/** yt-dlp with curl_cffi, so TikTok's bot check can be answered with browser impersonation (--impersonate chrome). */
export const VIDEO_TOOLS_REQUIREMENT = 'yt-dlp[default,curl-cffi]';

/** A yt-dlp release this much older than the newest pip reports counts as outdated (it releases every few weeks). */
export const YTDLP_BEHIND_DAYS = 21;

/** The oldest Python the helper works on. */
export const MIN_PYTHON = { major: 3, minor: 10 };

/** The page the smoke run reads, chosen because it exists to be fetched. */
export const SMOKE_URL = 'https://example.com';

/** Plain names of the tracked packages. */
const PACKAGE_NAMES = {
  scrapling: 'Scrapling',
  playwright: 'Playwright',
  patchright: 'Patchright',
  'curl-cffi': 'curl_cffi',
  'yt-dlp': 'yt-dlp',
  'faster-whisper': 'faster-whisper',
};

/**
 * Every step, in the order they run, with the words the status shows and how far
 * through the bar sits once that step has finished.
 * @type {Array<{id: string, label: string, percent: number}>}
 */
export const INSTALL_STEPS = [
  { id: 'detecting', label: 'Checking what is already on this computer', percent: 6 },
  // Python is never installed for the person; this step only finds it, and is where
  // the install stops with the manual command when there is none.
  { id: 'python', label: 'Looking for Python', percent: 14 },
  { id: 'readers', label: 'Installing the page readers', percent: 55 },
  { id: 'browser', label: 'Installing the browser they drive', percent: 85 },
  { id: 'smoke', label: 'Reading a test page', percent: 96 },
  { id: 'done', label: 'Ready', percent: 100 },
];

/** The steps of the optional speech reader, which run after the helper itself is ready. */
export const SPEECH_STEPS = [
  { id: 'speech_package', label: 'Installing local speech to text', percent: 15 },
  { id: 'speech_model', label: 'Downloading the speech model', percent: 100 },
];

/** How long each step is given before it is called a failure. */
const STEP_TIMEOUT_MS = {
  probe: 20_000,
  python: 20 * 60_000,
  readers: 20 * 60_000,
  browser: 20 * 60_000,
  smoke: 3 * 60_000,
  prune: 10 * 60_000,
};

// A browser download can take close to an hour on a slow connection. The lease
// wait is therefore inside the install budget rather than a short 30 second probe
// that turns a healthy concurrent install into a misleading failure.
const INSTALL_LEASE_WAIT_MS = 65 * 60_000;
const INSTALL_LEASE_POLL_MS = 250;

/**
 * Whether this process is running under Node's test runner.
 *
 * Installer tests use a fake interpreter, but a missing or malformed fixture
 * override must never make a normal `npm test` reach the machine's Python or
 * package manager. `NODE_TEST_CONTEXT` is inherited by spawned test workers;
 * the argv checks cover Node versions that do not set it.
 * @returns {boolean}
 */
export function isNodeTestProcess() {
  return Boolean(
    process.env.NODE_TEST_CONTEXT ||
      process.argv.includes('--test') ||
      process.execArgv.includes('--test'),
  );
}

/**
 * A real installation is opt in when tests are running. This escape hatch is
 * intentionally explicit and is useful only for a separately invoked manual
 * acceptance run, never for `npm test`.
 * @returns {boolean}
 */
function realInstallAllowed() {
  return process.env.SOCIAL_CAMPAIGN_ALLOW_REAL_INSTALL === '1';
}

/**
 * The Python commands to try, most specific first. `py -3` is the Windows launcher,
 * which is the only one that reliably skips the Microsoft Store stub.
 * @returns {string[][]}
 */
export function pythonCandidates() {
  // Tests stand a small Node script in for Python rather than touching whatever is
  // really on the machine running them. Nothing in the product ever sets this.
  if (process.env.SOCIAL_CAMPAIGN_TEST_PYTHON) {
    try {
      const parsed = JSON.parse(process.env.SOCIAL_CAMPAIGN_TEST_PYTHON);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // A malformed test override is a test failure, not permission to probe the
      // host machine. The caller receives an ordinary "Python not found" result.
    }
    if (isNodeTestProcess() && !realInstallAllowed()) return [];
  }
  if (isNodeTestProcess() && !realInstallAllowed()) return [];
  return process.platform === 'win32'
    ? [['py', '-3'], ['python3'], ['python']]
    : [['python3'], ['python']];
}

/**
 * Under the test runner only: a fixture standing in for the environment's own interpreter, so the whole install path
 * (reuse of an existing environment included) runs against it. Nothing in the product ever sets this.
 * @returns {string[]|null}
 */
function testRuntimeCommand() {
  if (!isNodeTestProcess() || !process.env.SOCIAL_CAMPAIGN_TEST_RUNTIME_PYTHON) return null;
  try {
    const parsed = JSON.parse(process.env.SOCIAL_CAMPAIGN_TEST_RUNTIME_PYTHON);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** The one line Python prints so detection can read its version and its real path. */
const VERSION_SCRIPT = 'import sys;print("SCPY",sys.version_info[0],sys.version_info[1],sys.executable,sep="|")';

/**
 * Run a program and collect what it said. Never rejects: a program that is missing,
 * that fails, or that hangs all come back as a plain result object.
 * @param {string[]} command the program followed by its fixed arguments.
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} [env] the child's environment; omitted inherits this process's.
 * @param {string} [input] text written to the child's stdin; without it stdin is closed.
 * @returns {Promise<{ok: boolean, code: number|string|null, stdout: string, stderr: string, spawnFailed: boolean, timedOut: boolean}>}
 */
export function run(command, args, timeoutMs, env, input) {
  const [program, ...fixed] = command;
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    /** @type {import('node:child_process').ChildProcess|undefined} */
    let child;
    const keep = (/** @type {string} */ text, /** @type {Buffer|string} */ chunk) => (text + chunk).slice(-8 * 1024 * 1024);
    const finish = (/** @type {{ok: boolean, code: number|string|null, spawnFailed?: boolean}} */ outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, spawnFailed: false, timedOut, ...outcome });
    };
    // The deadline stops the whole tree: on Windows a pip or browser download runs as a child of
    // the launcher, and killing only the launcher would leave it running.
    const timer = setTimeout(() => {
      timedOut = true;
      if (child) killTree(child);
      finish({ ok: false, code: 'ETIMEDOUT' });
    }, timeoutMs);
    try {
      child = spawn(program, [...fixed, ...args], {
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        // Python prints its answers in UTF-8, whatever the console code page is.
        env: pythonChildEnv(env),
      });
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      finish({ ok: false, code: typeof code === 'string' ? code : null, spawnFailed: code === 'ENOENT' });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout = keep(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = keep(stderr, chunk); });
    child.on('error', (error) => {
      const code = /** @type {any} */ (error)?.code;
      finish({ ok: false, code: typeof code === 'string' ? code : null, spawnFailed: code === 'ENOENT' });
    });
    child.on('close', (code) => finish({ ok: code === 0, code }));
    if (input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
  });
}

/**
 * Installer command execution is deliberately sealed in the test runner. A fake
 * interpreter is allowed because it is the fixture under test; host package
 * managers and Python launchers are denied unless the caller explicitly opts in.
 * @param {string[]} command
 * @param {{allowRealInstall?: boolean}} [options]
 * @returns {boolean}
 */
function canRunInstallCommand(command, options = {}) {
  if (!isNodeTestProcess() || realInstallAllowed() || options.allowRealInstall) return true;
  const program = command[0] ?? '';
  // Test fixtures use the current Node executable as a stand in for Python.
  if (program === process.execPath) return true;
  return false;
}

/**
 * Run an installer mutation with the test safety gate applied.
 * @param {string[]} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {{allowRealInstall?: boolean, env?: NodeJS.ProcessEnv, input?: string}} [options]
 */
function runInstallCommand(command, args, timeoutMs, options = {}) {
  if (canRunInstallCommand(command, options)) return run(command, args, timeoutMs, options.env, options.input);
  return Promise.resolve({
    ok: false,
    code: 'test_install_blocked',
    stdout: '',
    stderr: 'Real installer commands are disabled during tests. Use SOCIAL_CAMPAIGN_TEST_PYTHON with a fixture.',
    spawnFailed: false,
    timedOut: false,
  });
}

/**
 * Is this the Microsoft Store stub rather than a real Python?
 *
 * Windows ships a `python.exe` that is not Python: it prints a line pointing at the
 * Store and exits, classically with 9009. Treating it as Python is the single most
 * common way a Windows install of anything Python goes wrong, so it is named and
 * rejected here rather than being allowed to fail later with a confusing message.
 * @param {{code: number|string|null, stdout: string, stderr: string}} result
 * @returns {boolean}
 */
export function isStoreStub(result) {
  const said = `${result.stdout} ${result.stderr}`;
  if (/microsoft store|app installer|windows store/i.test(said)) return true;
  // 9009 with nothing recognisable said is the stub's other shape.
  return result.code === 9009 && !said.includes('SCPY');
}

/**
 * Is this the macOS placeholder rather than a real Python?
 *
 * A Mac with neither Xcode nor the Command Line Tools installed still has a
 * `/usr/bin/python3`: it is a shim that shells out to `xcrun`, which either pops up
 * a "install the Command Line Tools" dialog or, with no GUI session to show that
 * dialog in, fails at once with a message naming `xcrun` or "Command Line Tools".
 * Either way it is not a Python that can run anything, so it is named and skipped
 * here the same way the Windows Store stub is.
 * @param {{code: number|string|null, stdout: string, stderr: string}} result
 * @returns {boolean}
 */
export function isXcodeCLTStub(result) {
  const said = `${result.stdout} ${result.stderr}`;
  return /xcrun|command line developer tools|command line tools|invalid active developer path/i.test(said) && !said.includes('SCPY');
}

/**
 * Did pip refuse because this Python's packages are marked externally managed?
 *
 * Homebrew's Python (and most current Linux distributions) ship a PEP 668 marker
 * file that makes a plain `pip install` fail on purpose, to stop it from clobbering
 * whatever the package manager put there. The production installer creates a
 * managed virtual environment before pip runs, so it never needs to override that
 * protection. This predicate remains available for diagnostics and focused tests.
 * @param {{code: number|string|null, stdout: string, stderr: string}} result
 * @returns {boolean}
 */
export function isExternallyManaged(result) {
  return /externally[- ]managed[- ]environment/i.test(`${result.stdout} ${result.stderr}`);
}

/**
 * Did pip refuse to run at all because this Python has no pip module installed?
 *
 * Some Windows Python installs, notably winget's, land without pip: `python -m pip`
 * fails at once with "No module named pip" rather than the usual refusal a broken or
 * outdated pip gives. That is a different, earlier problem, fixed with `ensurepip`
 * rather than anything `pip` itself can do, since pip is exactly the thing missing.
 * @param {{code: number|string|null, stdout: string, stderr: string}} result
 * @returns {boolean}
 */
export function isPipMissing(result) {
  return /no module named pip/i.test(`${result.stdout} ${result.stderr}`);
}

/**
 * Read the one line VERSION_SCRIPT prints.
 * @param {string} stdout
 * @returns {{major: number, minor: number, executable: string}|null}
 */
function parseVersionLine(stdout) {
  const line = String(stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCPY|'));
  if (!line) return null;
  const [, major, minor, executable] = line.split('|');
  const majorNumber = Number(major);
  const minorNumber = Number(minor);
  if (!Number.isInteger(majorNumber) || !Number.isInteger(minorNumber)) return null;
  return { major: majorNumber, minor: minorNumber, executable: String(executable ?? '').trim() };
}

/**
 * Find a usable Python.
 *
 * Every candidate is tried in order and the first one new enough wins. A candidate
 * that turns out to be the Store stub is remembered separately, so the failure text
 * can say "Windows is offering you its Store placeholder" rather than "not found",
 * which is what the person's own eyes are telling them.
 * @param {string[][]} [candidates]
 * @returns {Promise<{found: boolean, command: string[]|null, executable: string|null, version: string|null, storeStub: boolean, xcodeStub: boolean, tooOld: boolean}>}
 */
export async function detectPython(candidates = pythonCandidates()) {
  let storeStub = false;
  let xcodeStub = false;
  let tooOld = false;
  for (const command of candidates) {
    const result = await run(command, ['-c', VERSION_SCRIPT], STEP_TIMEOUT_MS.probe);
    if (result.spawnFailed) continue;
    if (isStoreStub(result)) {
      storeStub = true;
      continue;
    }
    if (isXcodeCLTStub(result)) {
      xcodeStub = true;
      continue;
    }
    const parsed = parseVersionLine(result.stdout);
    if (!parsed) continue;
    const newEnough =
      parsed.major > MIN_PYTHON.major || (parsed.major === MIN_PYTHON.major && parsed.minor >= MIN_PYTHON.minor);
    if (!newEnough) {
      tooOld = true;
      continue;
    }
    return {
      found: true,
      command,
      executable: parsed.executable || null,
      version: `${parsed.major}.${parsed.minor}`,
      storeStub,
      xcodeStub,
      tooOld,
    };
  }
  return { found: false, command: null, executable: null, version: null, storeStub, xcodeStub, tooOld };
}

/** The one line the package prints so detection can read its version. */
const SCRAPLING_SCRIPT =
  'import importlib.metadata as metadata;import scrapling;print("SCSC|"+metadata.version("scrapling"))';

/**
 * Is Scrapling importable by this Python?
 * @param {string[]} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{found: boolean, version: string|null, compatible: boolean}>}
 */
export async function detectScrapling(command, env) {
  const result = await run(command, ['-c', SCRAPLING_SCRIPT], STEP_TIMEOUT_MS.probe, env);
  const line = String(result.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCSC|'));
  if (!result.ok || !line) return { found: false, version: null, compatible: false };
  const version = line.slice('SCSC|'.length) || null;
  return { found: true, version, compatible: version === SCRAPLING_VERSION };
}

/**
 * The browser is a download, not a package, so importing the package says nothing about whether the browser itself is on
 * disk. This asks Patchright (the driver Scrapling's stealth fetcher uses) for the executable path and then asks the
 * filesystem, through Python, whether it is really there.
 * @param {string[]} command
 * @param {NodeJS.ProcessEnv} [env] carries PLAYWRIGHT_BROWSERS_PATH for an environment with its own browsers folder.
 * @returns {Promise<{found: boolean}>}
 */
export async function detectChromium(command, env) {
  const script =
    'import os\n' +
    'from patchright.sync_api import sync_playwright\n' +
    'with sync_playwright() as p:\n' +
    '    print("SCCR|" + str(os.path.exists(p.chromium.executable_path)))\n';
  const result = await run(command, ['-c', script], STEP_TIMEOUT_MS.probe, env);
  const line = String(result.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCCR|'));
  return { found: Boolean(result.ok && line && line.endsWith('True')) };
}

/** The one line faster-whisper prints so detection can read its version. */
const WHISPER_SCRIPT =
  'import importlib.metadata as metadata;import faster_whisper;print("SCWH|"+metadata.version("faster-whisper"))';

/**
 * Is faster-whisper importable by this Python?
 * @param {string[]} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{found: boolean, version: string|null}>}
 */
export async function detectFasterWhisper(command, env) {
  const result = await run(command, ['-c', WHISPER_SCRIPT], STEP_TIMEOUT_MS.probe, env);
  const line = String(result.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCWH|'));
  if (!result.ok || !line) return { found: false, version: null };
  return { found: true, version: line.slice('SCWH|'.length) || null };
}

/**
 * Everything detection knows, in one object.
 * @param {string[][]} [candidates]
 * @param {NodeJS.ProcessEnv} [env] from `researchHelperChildEnv`, for a managed environment's own command.
 * @returns {Promise<{python: Awaited<ReturnType<typeof detectPython>>, scrapling: {found: boolean, version: string|null, compatible: boolean}, chromium: {found: boolean}, state: 'connected'|'degraded'|'not_connected'}>}
 */
export async function detect(candidates = pythonCandidates(), env) {
  const key = JSON.stringify([candidates, env?.PLAYWRIGHT_BROWSERS_PATH ?? null]);
  const cached = DETECT_CACHE.get(key);
  if (cached && Date.now() - cached.at < DETECT_CACHE_MS) return cached.value;
  const value = await detectUncached(candidates, env);
  DETECT_CACHE.set(key, { at: Date.now(), value });
  return value;
}

/** Detection spawns up to four processes, and the doctor and the status
 * tool both ask within moments of each other. Cached the same way and for the same
 * reason `probeBinary` caches its own answers. */
const DETECT_CACHE = new Map();
const DETECT_CACHE_MS = 30_000;

/** Forget what detection found. Used after an install, and by tests. */
export function clearDetectCache() {
  DETECT_CACHE.clear();
}

/**
 * @param {string[][]} candidates
 * @param {NodeJS.ProcessEnv} [env]
 */
async function detectUncached(candidates, env) {
  const python = await detectPython(candidates);
  if (!python.found || !python.command) {
    return { python, scrapling: { found: false, version: null, compatible: false }, chromium: { found: false }, state: 'not_connected' };
  }
  const scrapling = await detectScrapling(python.command, env);
  const chromium = scrapling.found ? await detectChromium(python.command, env) : { found: false };
  const state = scrapling.compatible && chromium.found ? 'connected' : scrapling.found ? 'degraded' : 'not_connected';
  return { python, scrapling, chromium, state };
}

// --- the pinned set: what is installed against what is expected ---

/**
 * Where Playwright keeps its browsers for this environment.
 * @param {string} environmentRoot
 * @returns {string}
 */
function browsersFolder(environmentRoot) {
  const managed = managedBrowsersPath(environmentRoot);
  if (managed) return managed;
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (fromEnv && fromEnv !== '0') return fromEnv;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

/**
 * The browser builds a package version expects, read from the browsers.json that ships inside it: the folder names its
 * Chromium and the headless shell it runs in headless mode live under.
 * @param {string} environmentRoot
 * @param {'playwright'|'patchright'} pkg
 * @returns {string[]|null} folder names such as `chromium-1243`, or null when the package is not readable.
 */
export function browserFoldersFor(environmentRoot, pkg) {
  const site = sitePackagesOf(environmentRoot);
  if (!site) return null;
  try {
    const listing = JSON.parse(readFileSync(join(site, pkg, 'driver', 'package', 'browsers.json'), 'utf8'));
    const browsers = Array.isArray(listing?.browsers) ? listing.browsers : [];
    /** @type {string[]} */
    const folders = [];
    for (const name of ['chromium', 'chromium-headless-shell']) {
      const entry = browsers.find((/** @type {any} */ item) => item?.name === name);
      if (entry?.revision) folders.push(`${name.replace(/-/g, '_')}-${entry.revision}`);
    }
    return folders.length > 0 ? folders : null;
  } catch {
    return null;
  }
}

/**
 * Whether the Chromium that a package version expects is on disk. Each release names the browser build it wants in its
 * own browsers.json, so a package upgrade that wants a newer build shows up here as missing. The headless shell counts
 * too: the reader runs headless, which is the shell.
 * @param {string} environmentRoot
 * @param {'playwright'|'patchright'} pkg
 * @returns {boolean}
 */
export function chromiumPresentFor(environmentRoot, pkg) {
  const folders = browserFoldersFor(environmentRoot, pkg);
  if (!folders) return false;
  const root = browsersFolder(environmentRoot);
  return folders.every((folder) => existsSync(join(root, folder)));
}

/**
 * Write the constraints file that every pip run uses, so nothing can move the pinned set.
 * @param {string} environmentRoot
 * @returns {string|null} the file path, or null when it could not be written.
 */
export function writeConstraintsFile(environmentRoot) {
  try {
    mkdirSync(environmentRoot, { recursive: true });
    const file = join(environmentRoot, CONSTRAINTS_FILE_NAME);
    const lines = [
      `scrapling==${SCRAPLING_VERSION}`,
      `playwright==${PLAYWRIGHT_VERSION}`,
      `patchright==${PATCHRIGHT_VERSION}`,
      `curl_cffi==${CURL_CFFI_VERSION}`,
    ];
    const text = `${lines.join('\n')}\n`;
    let current = '';
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      current = '';
    }
    if (current !== text) writeFileSync(file, text);
    return file;
  } catch {
    return null;
  }
}

/** The pip arguments that apply the constraints file, when there is one. */
function constraintArgs(file) {
  return file ? ['-c', file] : [];
}

/** pip writes 2026.09.29 as 2026.9.29; the age helper wants the padded date. */
function paddedDate(version) {
  return String(version).replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, (_all, y, m, d) => `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`);
}

/**
 * @typedef {object} VersionRow
 * @property {string} id the package's normalised name.
 * @property {string} name its plain name.
 * @property {string|null} installed
 * @property {string|null} expected the version Social Campaign keeps it at; null when it follows the newest.
 * @property {string|null} latest the newest pip last reported (cached; null when never checked).
 * @property {'current'|'missing'|'outdated'|'newer_available'} state `newer_available`: the kept version is installed and a
 * newer one exists, which Social Campaign tests before it moves to it.
 */

/**
 * @typedef {object} ResearchToolsState
 * @property {boolean} venv the managed Python environment exists.
 * @property {string[]} missing plain names of what is not installed.
 * @property {string[]} outdated plain names of what is installed at the wrong version.
 * @property {string[]} stale plain names of installed packages that nothing calls any more and an update removes.
 * @property {string[]} manual missing system tools only the person can install (FFmpeg).
 * @property {boolean} needsUpdate something the installer can fix is missing, outdated or retired.
 * @property {Record<string, string|null>} versions what is installed, by package.
 * @property {VersionRow[]} rows the same, one row per package, with what is expected and what is newest.
 * @property {{installed: boolean, version: string|null, wanted: boolean, modelReady: boolean}} speech local speech to text.
 * @property {string|null} latestCheckedAt when pip was last asked for the newest versions.
 */

/**
 * Compare what is installed against the pin set. File reads only, so it is safe to call
 * from the session start hook and from a tool that must answer in a few seconds.
 * @param {string} [environmentRoot]
 * @param {{now?: number, ffmpeg?: boolean, speechWanted?: boolean, latest?: Record<string, string>|null, latestCheckedAt?: string|null}} [options]
 * `ffmpeg` overrides the PATH lookup, for tests; `speechWanted` is whether the person said yes to local speech to text.
 * @returns {ResearchToolsState}
 */
export function researchToolsState(environmentRoot = managedEnvironmentRoot(), options = {}) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const outdated = [];
  /** @type {string[]} */
  const stale = [];
  /** @type {string[]} */
  const manual = [];
  /** @type {Record<string, string|null>} */
  const versions = {};
  /** @type {VersionRow[]} */
  const rows = [];
  const latest = options.latest ?? {};
  const venv = existsSync(managedPythonPath(environmentRoot));
  const installed = venv ? installedVersions(environmentRoot) : null;
  const speech = { installed: false, version: /** @type {string|null} */ (null), wanted: Boolean(options.speechWanted), modelReady: false };
  if (!venv || !installed) {
    missing.push('Python environment');
  } else {
    for (const [pkg, expected] of Object.entries(PINNED_VERSIONS)) {
      const have = installed.get(pkg) ?? null;
      versions[pkg] = have;
      const label = PACKAGE_NAMES[/** @type {keyof typeof PACKAGE_NAMES} */ (pkg)];
      const newest = latest[pkg] ?? null;
      /** @type {VersionRow['state']} */
      let state = 'current';
      if (!have) {
        missing.push(label);
        state = 'missing';
      } else if (have !== expected) {
        outdated.push(label);
        state = 'outdated';
      } else if (newest && compareVersions(have, newest) < 0) {
        state = 'newer_available';
      }
      rows.push({ id: pkg, name: label, installed: have, expected, latest: newest, state });
    }
    if (installed.get('patchright') && !chromiumPresentFor(environmentRoot, 'patchright')) missing.push('Browser');
    const ytdlp = installed.get('yt-dlp') ?? null;
    versions['yt-dlp'] = ytdlp;
    const newestYtdlp = latest['yt-dlp'] ?? null;
    /** @type {VersionRow['state']} */
    let ytdlpState = 'current';
    if (!ytdlp) {
      missing.push('yt-dlp');
      ytdlpState = 'missing';
    } else {
      const age = ytdlpAgeDays(paddedDate(ytdlp), options.now);
      const behind = newestYtdlp ? compareVersions(ytdlp, newestYtdlp) < 0 : false;
      if ((age !== null && age > YTDLP_STALE_DAYS) || (behind && age !== null && age > YTDLP_BEHIND_DAYS)) {
        outdated.push('yt-dlp');
        ytdlpState = 'outdated';
      } else if (behind) {
        ytdlpState = 'newer_available';
      }
    }
    rows.push({ id: 'yt-dlp', name: 'yt-dlp', installed: ytdlp, expected: null, latest: newestYtdlp, state: ytdlpState });
    for (const name of STALE_PACKAGES) {
      if (installed.has(name)) stale.push(STALE_LABELS[/** @type {keyof typeof STALE_LABELS} */ (name)] ?? name);
    }
    const whisper = installed.get('faster-whisper') ?? null;
    speech.installed = Boolean(whisper);
    speech.version = whisper;
    speech.modelReady = speechModelPresent(SPEECH_MODEL);
    if (whisper) {
      const newestWhisper = latest['faster-whisper'] ?? null;
      rows.push({ id: 'faster-whisper', name: 'faster-whisper', installed: whisper, expected: null, latest: newestWhisper, state: newestWhisper && compareVersions(whisper, newestWhisper) < 0 ? 'newer_available' : 'current' });
    }
    if (options.speechWanted) {
      if (!whisper) missing.push('Local speech to text');
      else if (!speech.modelReady) missing.push('Speech model');
    }
  }
  const hasFfmpeg = options.ffmpeg ?? (findOnPath('ffmpeg') !== null && findOnPath('ffprobe') !== null);
  if (!hasFfmpeg) manual.push('FFmpeg');
  return {
    venv,
    missing,
    outdated,
    stale,
    manual,
    needsUpdate: missing.length > 0 || outdated.length > 0 || stale.length > 0,
    versions,
    rows,
    speech,
    latestCheckedAt: options.latestCheckedAt ?? null,
  };
}

// --- what is remembered between sessions ---

/**
 * Read the `research_helper` entry out of integrations.json.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {Record<string, any>|null}
 */
export function readRecord(workspace) {
  return readResearchHelperRecord(workspace?.root ?? null);
}

/**
 * Write the `research_helper` entry, leaving every other provider alone.
 *
 * `Workspace#writeIntegration` only carries state and a detail, and this record also
 * has to remember which Python was used and what went wrong last time, so the file is
 * read and written here instead. The shape around it, `{ providers: { ... } }`, is
 * exactly the one every other provider is stored in.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>|null}
 */
export function writeRecord(workspace, record) {
  const saved = updateResearchHelperRecord(workspace?.root ?? null, (previous) => ({ ...(previous ?? {}), ...record }));
  return saved && workspace?.root ? workspace.readIntegrations() : null;
}

// --- the install, which runs in the background and is watched through installProgress() ---

/**
 * @typedef {object} SpeechProgress
 * @property {'not_installed'|'installing'|'installed'|'failed'} state
 * @property {string} step `speech_package` or `speech_model`.
 * @property {string} stepLabel that step in words.
 * @property {number} percent how far the model download is, 0 to 100.
 * @property {string|null} message one plain sentence about it.
 * @property {string|null} error
 * @property {string|null} model
 */

/**
 * @typedef {object} InstallProgress
 * @property {'not_installed'|'installing'|'installed'|'failed'} state
 * @property {string} step the id of the step running now, or the last one that ran.
 * @property {string} stepLabel that step in words.
 * @property {number} percent
 * @property {string|null} error the plain reason it failed, with what to do about it.
 * @property {string|null} pythonVersion
 * @property {string|null} scraplingVersion
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 * @property {boolean} [consentNeeded] nothing was started because the person has not said yes to the install yet.
 * @property {SpeechProgress} [speech] the optional local speech to text, which installs after the helper is ready.
 */

/** @returns {InstallProgress} */
function initialProgress() {
  return {
    state: 'not_installed',
    step: 'detecting',
    stepLabel: INSTALL_STEPS[0].label,
    percent: 0,
    error: null,
    pythonVersion: null,
    scraplingVersion: null,
    startedAt: null,
    finishedAt: null,
  };
}

/** Every process gets a stable owner id, while each install gets its own job id. */
const INSTALL_OWNER_ID = `${process.pid}:${newId()}`;

/** @type {Map<string, {root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}>} */
const installJobs = new Map();

/** A compatibility view for callers that have not yet supplied a workspace. */
let lastJobRoot = null;
let fallbackProgress = initialProgress();

/** @param {unknown} value @returns {string|null} */
function workspaceRootOf(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof /** @type {any} */ (value).root === 'string' && /** @type {any} */ (value).root.trim()) {
    return /** @type {any} */ (value).root.trim();
  }
  return null;
}

/** @param {string|null} root @returns {any|null} */
function jobFor(root) {
  return root ? installJobs.get(root) ?? null : lastJobRoot ? installJobs.get(lastJobRoot) ?? null : null;
}

/**
 * A connected state is useful only when the complete versioned record points at
 * files that still exist. This is the guard shared by progress projection and the
 * setup summary, so a legacy `connected` flag cannot suppress repair.
 * @param {Record<string, any>|null} record
 * @returns {boolean}
 */
function healthyResearchHelperRecord(record) {
  return hasUsableResearchHelperRecord(record);
}

/** @param {Record<string, any>|null} record @returns {string[]|null} */
function commandFromRecord(record) {
  if (!healthyResearchHelperRecord(record)) return null;
  return [record.python, ...(Array.isArray(record.python_args) ? record.python_args : [])];
}

/**
 * The speech block of the durable record, in the shape the status shows.
 * @param {Record<string, any>|null} record
 * @returns {SpeechProgress|undefined}
 */
function speechFromRecord(record) {
  const saved = record?.speech && typeof record.speech === 'object' ? record.speech : null;
  if (!saved) return undefined;
  const state = ['installing', 'installed', 'failed'].includes(saved.state) ? saved.state : 'not_installed';
  const step = SPEECH_STEPS.find((entry) => entry.id === saved.step) ?? SPEECH_STEPS[0];
  return {
    state,
    step: step.id,
    stepLabel: step.label,
    percent: Number.isFinite(Number(saved.percent)) ? Number(saved.percent) : state === 'installed' ? 100 : 0,
    message: typeof saved.message === 'string' ? saved.message : null,
    error: typeof saved.error === 'string' ? saved.error : null,
    model: typeof saved.model === 'string' ? saved.model : null,
  };
}

/**
 * Reconstruct the progress shape from the durable record when another
 * process owns the installer job. This is deliberately a projection of persisted
 * data, so it never claims local ownership or creates a second installer.
 * @param {Record<string, any>|null} record
 * @returns {InstallProgress|null}
 */
function progressFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const install = record.install && typeof record.install === 'object' ? record.install : null;
  const durableState = String(install?.state ?? '');
  const healthyPaths = healthyResearchHelperRecord(record);
  const state = durableState === 'installing'
    ? 'installing'
    : durableState === 'failed'
      ? 'failed'
      : (durableState === 'installed' || record.state === 'connected') && healthyPaths
        ? 'installed'
        : null;
  if (!state) return null;
  const step = String(install?.step ?? (state === 'installed' ? 'done' : INSTALL_STEPS[0].id));
  const stepInfo = INSTALL_STEPS.find((entry) => entry.id === step) ?? INSTALL_STEPS[0];
  const speech = speechFromRecord(record);
  return {
    state,
    step: stepInfo.id,
    stepLabel: stepInfo.label,
    percent: Number.isFinite(Number(install?.percent)) ? Number(install.percent) : state === 'installed' ? 100 : stepInfo.percent,
    error: typeof record.last_error === 'string' ? record.last_error : typeof install?.error === 'string' ? install.error : null,
    pythonVersion: typeof record.python_version === 'string' ? record.python_version : null,
    scraplingVersion: typeof record.scrapling_version === 'string' ? record.scrapling_version : null,
    startedAt: typeof install?.started_at === 'string' ? install.started_at : null,
    finishedAt: typeof install?.finished_at === 'string' ? install.finished_at : null,
    ...(speech ? { speech } : {}),
  };
}

/**
 * Persisted installer records outlive a crashed process. A still running owner is
 * safe to join; an owner whose process disappeared must be allowed to resume after
 * the SQLite lease has been released.
 * @param {unknown} value
 * @returns {boolean}
 */
function installOwnerAlive(value) {
  const pid = Number.parseInt(String(value ?? '').split(':', 1)[0], 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the status tool reads. A copy, so nothing outside this file can
 * reach in and change a step.
 * @param {import('../workspace/index.mjs').Workspace|string} [workspace]
 * @returns {InstallProgress}
 */
export function installProgress(workspace) {
  const root = workspaceRootOf(workspace);
  const job = jobFor(root);
  if (job) return { ...job.progress };
  const shared = root ? progressFromRecord(readResearchHelperRecord(root)) : null;
  return shared ? { ...shared } : root ? initialProgress() : { ...fallbackProgress };
}

/** Put the module back to its starting state. Used by tests. */
export function resetInstallProgress(workspace) {
  clearDetectCache();
  const root = workspaceRootOf(workspace);
  if (root) installJobs.delete(root);
  else installJobs.clear();
  lastJobRoot = root;
  fallbackProgress = initialProgress();
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {string} id
 * @param {Partial<InstallProgress>} [extra]
 */
function step(job, id, extra = {}) {
  const found = INSTALL_STEPS.find((entry) => entry.id === id) ?? INSTALL_STEPS[0];
  job.progress = { ...job.progress, step: found.id, stepLabel: found.label, percent: found.percent, ...extra };
  fallbackProgress = job.progress;
  persist(job, job.progress.state === 'installing' ? 'installing' : job.progress.state);
}

/**
 * The commands a person can paste in themselves, for when this cannot do it for them.
 * The first one installs Python, which Social Campaign never does on its own: it is
 * system software with its own licence, so the person runs that one themselves.
 * @returns {string[]}
 */
export function manualCommands() {
  const install =
    process.platform === 'win32'
      ? 'winget install --id Python.Python.3.12 -e'
      : process.platform === 'darwin'
        ? 'brew install python@3.12'
        : 'sudo apt install python3 python3-pip';
  // The word used to run Python matches whichever candidate detection actually
  // finds first on each platform, so a person pasting these gets the same
  // interpreter the automatic install would have used. Dependencies go into
  // the managed environment, never the user's or system site's packages.
  const py = process.platform === 'win32' ? 'py -3' : 'python3';
  const environment = managedEnvironmentRoot();
  const runtime = managedPythonPath(environment);
  // An environment in the plugin data folder keeps its browser beside it, so the
  // pasted command has to put it in the same place the reader will look.
  const browsers = managedBrowsersPath(environment);
  const browsersPrefix = !browsers
    ? ''
    : process.platform === 'win32'
      ? `$env:PLAYWRIGHT_BROWSERS_PATH=${JSON.stringify(browsers)}; `
      : `PLAYWRIGHT_BROWSERS_PATH=${JSON.stringify(browsers)} `;
  const requirements = [...PINNED_REQUIREMENTS, VIDEO_TOOLS_REQUIREMENT].map((entry) => JSON.stringify(entry)).join(' ');
  return [
    install,
    `${py} -m venv ${JSON.stringify(environment)} && ${JSON.stringify(runtime)} -m pip install ${requirements}`,
    `${browsersPrefix}${JSON.stringify(runtime)} -m patchright install chromium`,
  ];
}

/**
 * The failure text for a computer with no recent enough Python. Social Campaign
 * does not install Python itself on any platform, so this names the exact
 * commands for the person to run.
 * @returns {string}
 */
export function noPythonReason() {
  const [first, second, third] = manualCommands();
  const opener =
    process.platform === 'darwin'
      ? 'The research helper needs Python 3.10 or newer, and Social Campaign does not install Python for you. ' +
        'If Homebrew is not installed yet, get it first from https://brew.sh.'
      : 'The research helper needs Python 3.10 or newer, and Social Campaign does not install Python for you.';
  return `${opener} To set it up yourself, open a terminal and run these three, in order: ${first} then ${second} then ${third}`;
}

/**
 * What installing the helper would put on this computer, in plain words, for the
 * person to say yes or no to. Returned by every install entry point that was
 * called without `confirm: true`, and by `workspace_initialize`.
 *
 * Sizes are measured: the browser takes about 700 MB on disk (Chromium and its headless shell, 433 MB and 271 MB), the
 * Python packages about 250 MB after retired ones are removed, and the download is roughly 400 MB. Local speech to text is
 * a separate yes inside the same question: about 150 MB of packages and a speech model of about 480 MB.
 * @returns {{summary: string, needs: string, size: string, location: string, removal: string, speech: {summary: string, size: string}}}
 */
export function installPlan() {
  const environment = managedEnvironmentRoot();
  const home = dirname(environment);
  const inPluginData = pluginDataEnvironmentRoot() !== null && resolve(environment) === pluginDataEnvironmentRoot();
  return {
    summary:
      'An optional research helper lets Social Campaign read pages and profiles that show almost nothing to a plain ' +
      'page reader, such as TikTok and Instagram profiles, protected shops and ad libraries, and download reference videos. ' +
      'It installs Scrapling (a Python page reader), yt-dlp and a private copy of the Chromium browser they drive. ' +
      'Research works without it, on public pages and web search.',
    needs: 'Python 3.10 or newer already on this computer. Social Campaign never installs Python itself.',
    size: 'A download of roughly 400 MB, about 1 GB on disk (the browser is about 700 MB of that). It takes several minutes and carries on in the background.',
    location: home,
    removal: inPluginData
      ? 'Uninstalling the Social Campaign plugin removes it.'
      : `To remove it later, delete the folder ${home}${managedBrowsersPath(environment) ? '' : ' and Playwright\'s browser cache'}.`,
    speech: {
      summary: 'Optional, in the same yes: local speech to text, so a video without captions can be transcribed on this computer for free (faster-whisper, CPU only).',
      size: `${SPEECH_SIZE_WORDS.packages} and ${SPEECH_SIZE_WORDS.model}, downloaded once in the background.`,
    },
  };
}

/**
 * Describe the install for the person to say yes or no to, including whether Python is here. This is what the setup
 * question is built from; it installs nothing.
 * @returns {Promise<{plan: ReturnType<typeof installPlan>, python: {found: boolean, version: string|null, explanation: string, command: string|null}}>}
 */
export async function describeInstall() {
  const plan = installPlan();
  const found = await detectPython();
  const [first] = manualCommands();
  const explanation = found.found
    ? `Python ${found.version} is already on this computer, so nothing else needs installing first.`
    : found.storeStub
      ? 'Windows is offering its Store placeholder instead of a real Python. Python 3.10 or newer has to be installed first.'
      : found.xcodeStub
        ? 'This Mac only offers to install the Command Line Tools placeholder, not a real Python. Python 3.10 or newer has to be installed first.'
        : found.tooOld
          ? 'The Python on this computer is older than version 3.10, so a newer one has to be installed first.'
          : 'There is no Python on this computer yet, and the helper needs Python 3.10 or newer.';
  return { plan, python: { found: found.found, version: found.version, explanation, command: found.found ? null : first } };
}

/**
 * The one sentence that goes with a step that failed, written for someone who has
 * never opened a terminal and never wants to.
 * @param {string} stepId
 * @param {{stdout: string, stderr: string, code: number|string|null, timedOut?: boolean}} result
 * @param {string} [subject]
 * @returns {string}
 */
function reasonFor(stepId, result, subject = '') {
  const lines = `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const failure = lines.find((line) =>
    /\b(error|failed?|failure|fatal|exception|traceback|permission|denied|cannot|could not|no module|not found|unable|refused|invalid|timed out|timeout)\b/i.test(line),
  );
  const detailLine = failure ?? lines.at(-1);
  const status = result.timedOut || result.code === 'ETIMEDOUT'
    ? ' It timed out.'
    : result.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      ? ' It produced more output than the installer allows.'
      : result.code !== null && result.code !== undefined && result.code !== 0
        ? ` It ended with code ${result.code}.`
        : '';
  const punctuation = detailLine && /[.!?]$/.test(detailLine) ? '' : '.';
  const detail = detailLine ? ` It said: ${detailLine}${punctuation}${status}` : status;
  const [first, second, third] = manualCommands();
  if (stepId === 'python') return `Installing Python did not finish.${detail} You can install it yourself with: ${first}`;
  if (stepId === 'readers') {
    const thing = subject || 'the page readers';
    return `Installing ${thing} did not finish.${detail} You can install it yourself with: ${second}`;
  }
  if (stepId === 'browser') return `Installing the browser did not finish.${detail} You can install it yourself with: ${third}`;
  if (stepId === 'speech') return `Local speech to text did not install.${detail}`;
  return `The test page could not be read, so the helper is installed but not working yet.${detail}`;
}

/**
 * Make sure this Python's pip actually runs, fixing it with `ensurepip` first when it
 * does not.
 *
 * Some fresh Python installs land with no pip at all: Windows Python.org and winget
 * builds are the common case, but nothing here is Windows specific. `ensurepip` is
 * the standard library module built for exactly this, bundled with the interpreter
 * itself, so it works even though pip, the thing that would normally install things,
 * is the very thing missing. The command always targets the managed environment, so
 * it does not retry by writing into a user or system site-packages directory.
 *
 * Nothing here changes behaviour when pip already works: the very first check is
 * `pip --version`, and any answer other than "no module named pip" is left alone, so
 * a pip that is merely old or broken in some other way still fails, and fails with
 * its own real message, at the readers step that actually needed it.
 * @param {string[]} python
 * @param {{allowRealInstall?: boolean}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
async function ensurePipReady(python, options = {}) {
  const check = await run(python, ['-m', 'pip', '--version'], STEP_TIMEOUT_MS.probe);
  if (check.ok || !isPipMissing(check)) return { ok: true, reason: null };

  let ensured = await runInstallCommand(python, ['-m', 'ensurepip', '--upgrade', '--default-pip'], STEP_TIMEOUT_MS.readers, options);
  if (!ensured.ok) {
    ensured = await runInstallCommand(python, ['-m', 'ensurepip', '--upgrade', '--default-pip'], STEP_TIMEOUT_MS.readers, options);
  }

  const recheck = ensured.ok ? await run(python, ['-m', 'pip', '--version'], STEP_TIMEOUT_MS.probe) : ensured;
  if (ensured.ok && recheck.ok) return { ok: true, reason: null };

  // pip is missing and ensurepip could not put it there either, so the person is
  // told to run ensurepip first, then the pip install that would otherwise just fail
  // again the same way.
  const ensurepipCommand = [...python, '-m', 'ensurepip', '--upgrade', '--default-pip'].join(' ');
  const pipCommand = [...python, '-m', 'pip', 'install', ...PINNED_REQUIREMENTS].join(' ');
  return {
    ok: false,
    reason: `This Python has no pip, and ensurepip could not install it either. You can install it yourself with: ${ensurepipCommand} then ${pipCommand}`,
  };
}

/**
 * Whether the person has said yes to installing the helper here: a yes recorded for this workspace, an explicit
 * `confirmed`, or an environment that already exists on this computer (it only exists because somebody said yes, and the
 * update of a copy that is already there downloads nothing new). Local speech to text is separate: see `speechConsent`.
 * @param {Record<string, any>|null} record
 * @param {{confirmed?: boolean}} options
 * @param {string} environmentRoot
 * @returns {boolean}
 */
function installConsented(record, options, environmentRoot) {
  return options.confirmed === true || Boolean(record?.consent_at) || existsSync(managedPythonPath(environmentRoot));
}

/**
 * Install whatever is missing, in order, reporting each step as it goes.
 *
 * Returns immediately. The result is watched through `installProgress()` and recorded
 * in integrations.json when it ends, either way.
 *
 * A fresh install is started only with the person's yes: `confirmed: true`. Without it, and with no copy of the helper on
 * this computer already, nothing is started and the answer says `consentNeeded`. `speech: true` adds the optional local
 * speech to text (its own yes, taken in the same question).
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{candidates?: string[][], environmentRoot?: string, smokeUrl?: string, allowRealInstall?: boolean, runtimeCommand?: string[], update?: boolean, confirmed?: boolean, speech?: boolean, speechScript?: string, speechPollMs?: number}} [options]
 * `runtimeCommand` is a test fixture hook and is never supplied by a product tool. `update: true` runs the
 * install again over a healthy install to add or refresh the pinned tools; without it a healthy install is left alone.
 * @returns {InstallProgress} the state as of this call, always `installing` unless one was already finished.
 */
export function startInstall(workspace, options = {}) {
  const root = workspaceRootOf(workspace);
  if (!root) return installProgress();
  const existing = installJobs.get(root);
  if (existing?.inFlight) return { ...existing.progress };
  const persistedRecord = readResearchHelperRecord(root);
  const persisted = progressFromRecord(persistedRecord);
  const persistedInstall = persistedRecord?.install && typeof persistedRecord.install === 'object' ? persistedRecord.install : null;
  if (persisted?.state === 'installing' && installOwnerAlive(persistedInstall?.owner_id)) {
    lastJobRoot = root;
    fallbackProgress = persisted;
    return { ...persisted };
  }
  // A completed record is reusable only when the current versioned contract and
  // every path it names are still usable. This check stays at the record level so
  // an older reader cannot make an incomplete `installed` flag suppress repair.
  if (persisted?.state === 'installed' && healthyResearchHelperRecord(persistedRecord) && !options.update && options.speech !== true) {
    lastJobRoot = root;
    fallbackProgress = persisted;
    return { ...persisted };
  }
  const environmentRoot = options.environmentRoot ?? managedEnvironmentRoot();
  if (!installConsented(persistedRecord, options, environmentRoot)) {
    return { ...initialProgress(), consentNeeded: true };
  }
  const now = nowIso();
  try {
    updateResearchHelperRecord(root, (previous) => ({
      ...(previous ?? {}),
      ...(options.confirmed === true && !previous?.consent_at ? { consent_at: now } : {}),
      ...(options.speech === true && !previous?.speech_consent_at ? { speech_consent_at: now } : {}),
    }));
  } catch {
    // an unwritable record is a doctor problem; the install can still run
  }
  const job = {
    root,
    jobId: newId(),
    ownerId: INSTALL_OWNER_ID,
    progress: {
      state: /** @type {const} */ ('installing'),
      step: 'detecting',
      stepLabel: INSTALL_STEPS[0].label,
      percent: INSTALL_STEPS[0].percent,
      error: null,
      pythonVersion: null,
      scraplingVersion: null,
      startedAt: nowIso(),
      finishedAt: null,
    },
    inFlight: null,
  };
  installJobs.set(root, job);
  lastJobRoot = root;
  fallbackProgress = job.progress;
  persist(job, 'installing');
  job.inFlight = runInstall(job, options)
    .catch((error) => {
      // Nothing above is allowed to throw, so reaching here is a bug rather than a
      // user's problem. It still ends as a recorded failure rather than an unhandled
      // rejection that takes the server down.
      log.error('research helper install threw', { error: String(error), workspace_root: root, job_id: job.jobId });
      job.progress = {
        ...job.progress,
        state: 'failed',
        error: error instanceof Error && /still being installed in another/.test(error.message)
          ? error.message
          : 'Something went wrong while installing the research helper. Try again from the doctor.',
        finishedAt: nowIso(),
      };
      fallbackProgress = job.progress;
      persist(job, 'degraded');
      return { ...job.progress };
    })
    .finally(() => {
      job.inFlight = null;
    });
  return { ...job.progress };
}

/**
 * Wait for the install in flight for one workspace, if there is one. Tests use
 * this; nothing in the server ever does, because nothing in the server is
 * allowed to block on it.
 * @param {import('../workspace/index.mjs').Workspace|string} [workspace]
 * @returns {Promise<InstallProgress>}
 */
export function whenInstallSettles(workspace) {
  const job = jobFor(workspaceRootOf(workspace));
  return job?.inFlight ?? Promise.resolve(job ? { ...job.progress } : { ...fallbackProgress });
}

/**
 * Where the helper stands for one workspace. `offer` says what it is and how big,
 * for the doctor to explain when the helper is missing.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{installed: boolean, state: InstallProgress['state'], offer: ReturnType<typeof installPlan>|null}}
 */
export function researchHelperSummary(workspace) {
  const progress = installProgress(workspace);
  const installed = healthyResearchHelperRecord(readRecord(workspace));
  const state = installed ? 'installed' : progress.state;
  return { installed, state, offer: installed || state === 'installing' ? null : installPlan() };
}

/** How long a failed or finished update is left alone before the next check may start another. */
const TOOLS_UPDATE_PAUSE_MS = 30 * 60_000;

/**
 * Where the tools check reads the environment from: the recorded one, else the managed one.
 * @param {Record<string, any>|null} record
 * @param {string|undefined} override
 * @returns {string}
 */
function environmentFor(record, override) {
  return override ?? (typeof record?.environment_path === 'string' && record.environment_path ? record.environment_path : managedEnvironmentRoot());
}

/**
 * @param {string} environmentRoot
 * @param {Record<string, any>|null} record
 * @param {{ffmpeg?: boolean, now?: number}} options
 */
function stateForCheck(environmentRoot, record, options) {
  const latest = readLatestVersions(environmentRoot, options.now);
  return {
    latest,
    state: researchToolsState(environmentRoot, {
      ffmpeg: options.ffmpeg,
      now: options.now,
      speechWanted: Boolean(record?.speech_consent_at),
      latest: latest?.versions ?? null,
      latestCheckedAt: latest?.checkedAt ?? null,
    }),
  };
}

/**
 * Ask pip for the newest versions in the background, when the cached answer is old. Never awaited, never throws, and
 * never runs under the test runner unless a test passes its own Python.
 * @param {string} environmentRoot
 * @param {{refreshLatest?: boolean, latestPython?: string[], now?: number}} options
 */
function refreshLatestInBackground(environmentRoot, options) {
  try {
    const allowed = options.refreshLatest ?? (!isNodeTestProcess() || realInstallAllowed());
    if (!allowed) return;
    const python = options.latestPython ?? [managedPythonPath(environmentRoot)];
    if (!existsSync(python[0])) return;
    void refreshLatestVersions({
      environmentRoot,
      command: python,
      runner: (command, args, timeoutMs, env) => run(command, args, timeoutMs, env),
      env: researchHelperChildEnv(environmentRoot),
      now: options.now,
    });
  } catch {
    // a failed look at the newest versions is never a problem
  }
}

/**
 * @typedef {object} ResearchToolsCheck
 * @property {boolean} ok nothing the installer can fix is missing or outdated.
 * @property {'installed'|'installing'|'update_needed'|'not_installed'|'failed'} state where the helper really stands on this computer.
 * @property {string[]} missing
 * @property {string[]} outdated
 * @property {Array<{name: string, installed: string, latest: string}>} newerAvailable installed at the version Social Campaign tested; a newer one exists.
 * @property {string[]} removing retired packages an update removes.
 * @property {string[]} manual system tools the person has to install (FFmpeg).
 * @property {VersionRow[]} versions every tracked package: installed, expected, newest.
 * @property {boolean} updating a background install or update is running now.
 * @property {boolean} started this call started it.
 * @property {boolean} linking the only thing running is the connection of this workspace to a helper already on this computer.
 * @property {boolean} consentNeeded the helper is not on this computer and nothing is installed until the person says yes.
 * @property {boolean} workspaceLinked this workspace's record points at a working helper.
 * @property {{installed: boolean, version: string|null, wanted: boolean, modelReady: boolean}} speech
 * @property {string|null} latestCheckedAt
 * @property {string|null} note one plain sentence, or null.
 */

/**
 * The quick startup check: what is installed against the pin set. When something is missing or
 * outdated it STARTS the normal background install or update (same lease, same progress record) and returns
 * straight away; a fresh computer is never installed on, because that needs the person's yes. Only file reads happen
 * here, so it never blocks for more than a moment, and it never waits for the install or for the network: the newest
 * versions come from a cached answer, refreshed in the background when it is old.
 * @param {import('../workspace/index.mjs').Workspace|string} workspace
 * @param {{force?: boolean, environmentRoot?: string, ffmpeg?: boolean, now?: number, install?: Record<string, any>, refreshLatest?: boolean, latestPython?: string[]}} [options]
 * `install` is passed to startInstall (test fixtures use it); `force` ignores the short pause after an earlier attempt.
 * @returns {ResearchToolsCheck}
 */
export function checkResearchTools(workspace, options = {}) {
  const root = workspaceRootOf(workspace);
  const record = root ? readResearchHelperRecord(root) : null;
  const environmentRoot = environmentFor(record, options.environmentRoot);
  const { latest, state } = stateForCheck(environmentRoot, record, options);
  if (state.venv && (!latest || !latest.fresh)) refreshLatestInBackground(environmentRoot, options);
  const linked = healthyResearchHelperRecord(record);
  const newerAvailable = state.rows
    .filter((row) => row.state === 'newer_available' && row.installed && row.latest)
    .map((row) => ({ name: row.name, installed: /** @type {string} */ (row.installed), latest: /** @type {string} */ (row.latest) }));
  const progress = installProgress(workspace);
  /** @type {ResearchToolsCheck} */
  const result = {
    ok: !state.needsUpdate,
    state: progress.state === 'installing' ? 'installing' : !state.venv ? 'not_installed' : state.needsUpdate ? 'update_needed' : progress.state === 'failed' ? 'failed' : 'installed',
    missing: state.missing,
    outdated: state.outdated,
    newerAvailable,
    removing: state.stale,
    manual: state.manual,
    versions: state.rows,
    updating: false,
    started: false,
    linking: false,
    consentNeeded: false,
    workspaceLinked: linked,
    speech: state.speech,
    latestCheckedAt: state.latestCheckedAt,
    note: null,
  };
  const ffmpegNote = state.manual.length > 0 ? `${state.manual.join(' and ')} is not installed. Video and audio features need it; research works without it.` : null;
  if (progress.state === 'installing') {
    if (state.venv && !state.needsUpdate) {
      // Only the connection of this workspace to the helper that is already here is running: nothing to tell the person.
      result.linking = true;
      result.state = 'installed';
      return result;
    }
    result.updating = true;
    result.note = 'The research tools are being installed in the background. Carry on; research uses what is ready.';
    return result;
  }
  if (!state.venv && !record?.consent_at) {
    // A fresh computer: nothing is installed without the person's yes.
    result.consentNeeded = true;
    result.note = 'The research helper is not on this computer yet. It is installed only after the person says yes.';
    return result;
  }
  const needsLink = !state.needsUpdate && !linked && root;
  if (!state.needsUpdate && !needsLink) {
    result.note = outdatedSentence(result) ?? ffmpegNote;
    return result;
  }
  if (!root) {
    result.note = state.needsUpdate
      ? 'No workspace is set up yet, so the research tools are not updated. They update when the workspace is set up.'
      : null;
    return result;
  }
  // Under the test runner only fixtures that stand a fake Python in may start an install.
  if (isNodeTestProcess() && !process.env.SOCIAL_CAMPAIGN_TEST_PYTHON && !options.install && !realInstallAllowed()) {
    result.note = 'Installs are disabled in this process.';
    return result;
  }
  const attemptedAt = Date.parse(String(record?.tools_update_attempted_at ?? ''));
  const now = options.now ?? Date.now();
  if (!options.force && Number.isFinite(attemptedAt) && now - attemptedAt >= 0 && now - attemptedAt < TOOLS_UPDATE_PAUSE_MS) {
    result.note = progress.error
      ? `The last update did not finish: ${progress.error}`
      : 'The research tools were updated a few minutes ago. They are checked again later.';
    return result;
  }
  try {
    updateResearchHelperRecord(root, (previous) => ({ ...(previous ?? {}), tools_update_attempted_at: new Date(now).toISOString() }));
  } catch {
    // an unwritable record is a doctor problem; the update can still run
  }
  const started = startInstall(workspace, { ...(options.install ?? {}), update: true });
  const running = started.state === 'installing';
  const doing = [...state.missing, ...state.outdated];
  if (running && !state.needsUpdate) {
    // Only linking this workspace to the helper already on this computer: it is installed, and there is nothing to say.
    result.linking = true;
    result.state = 'installed';
    result.started = true;
    return result;
  }
  result.updating = running;
  result.started = running;
  if (started.consentNeeded) result.consentNeeded = true;
  result.state = result.updating ? 'installing' : result.state;
  result.note = result.updating
    ? `${[doing.length > 0 ? `Installing or updating ${doing.join(', ')}` : null, state.stale.length > 0 ? `removing ${state.stale.join(', ')}, which nothing uses any more` : null].filter(Boolean).join(' and ')} in the background. Carry on; research uses what is ready.`
    : started.error ?? null;
  return result;
}

/**
 * One plain sentence about what is outdated or has a newer version, or null when nothing is.
 * @param {ResearchToolsCheck} check
 * @returns {string|null}
 */
function outdatedSentence(check) {
  const parts = [];
  if (check.outdated.length > 0) parts.push(`${check.outdated.join(', ')} ${check.outdated.length === 1 ? 'is' : 'are'} out of date`);
  if (check.newerAvailable.length > 0) {
    parts.push(`newer versions exist of ${check.newerAvailable.map((item) => `${item.name} (${item.installed} installed, ${item.latest} out)`).join(', ')}, which Social Campaign keeps at the version it tested until its own release moves them`);
  }
  return parts.length > 0 ? `${parts.join('; ')}.` : null;
}

/** The code the detached updater runs: check, start the update, wait for it, exit. */
const BACKGROUND_UPDATE_SCRIPT =
  'const [moduleUrl, root] = process.argv.slice(1);' +
  'try { const m = await import(moduleUrl); m.checkResearchTools(root); await m.whenInstallSettles(root); await m.whenResearchLatestSettles(m.managedEnvironmentForCheck(root)); } catch {}' +
  'process.exit(0);';

/**
 * The environment the check for one workspace reads. Used by the detached updater to wait for the version lookup.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function managedEnvironmentForCheck(workspaceRoot) {
  return environmentFor(readResearchHelperRecord(workspaceRoot), undefined);
}

/**
 * For the session start hook: when the research tools are missing or out of date, run the
 * normal update in a detached background process and return at once. It never throws, never
 * blocks, and does nothing at all unless a research helper was set up before (a record or a
 * managed environment exists), so a fresh computer is left to workspace setup. The caller
 * limits how often this runs. The same process refreshes the cached newest versions when they are a day old.
 * @param {string} workspaceRoot
 * @param {{env?: NodeJS.ProcessEnv, environmentRoot?: string, spawnFn?: typeof spawn, ffmpeg?: boolean}} [options]
 * @returns {'started'|'up_to_date'|'not_set_up'|'disabled'|'failed'}
 */
export function startToolsUpdateInBackground(workspaceRoot, options = {}) {
  try {
    const env = options.env ?? process.env;
    if (env.SOCIAL_CAMPAIGN_NO_AUTO_UPDATE || env.NODE_TEST_CONTEXT) return 'disabled';
    const record = readResearchHelperRecord(workspaceRoot);
    const environmentRoot = environmentFor(record, options.environmentRoot);
    if (!record && !existsSync(managedPythonPath(environmentRoot))) return 'not_set_up';
    const { latest, state } = stateForCheck(environmentRoot, record, { ffmpeg: options.ffmpeg ?? true });
    const refreshDue = state.venv && (!latest || !latest.fresh);
    if (!state.needsUpdate && !refreshDue) return 'up_to_date';
    const child = (options.spawnFn ?? spawn)(
      process.execPath,
      ['--input-type=module', '-e', BACKGROUND_UPDATE_SCRIPT, import.meta.url, workspaceRoot],
      { detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    child.on?.('error', () => {});
    child.unref?.();
    return 'started';
  } catch {
    return 'failed';
  }
}

/**
 * Setup's part of the helper. It never installs anything the person has not said yes to: a fresh computer gets
 * `consentNeeded` and the plan to put to them (`offer`). A copy that is already on this computer is attached to the new
 * workspace at once, because that downloads nothing; it also brings that copy up to date. The install runs in the
 * background and nothing waits on it.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{installed: boolean, state: InstallProgress['state'], started: boolean, consentNeeded: boolean, offer?: ReturnType<typeof installPlan>}}
 */
export function ensureResearchHelper(workspace) {
  const summary = researchHelperSummary(workspace);
  if (summary.installed || summary.state === 'installing') return { installed: summary.installed, state: summary.state, started: false, consentNeeded: false };
  // Under the test runner only installer tests, which stand a fake Python in, start one.
  if (isNodeTestProcess() && !process.env.SOCIAL_CAMPAIGN_TEST_PYTHON && !realInstallAllowed()) {
    return { installed: false, state: summary.state, started: false, consentNeeded: !existsSync(managedPythonPath(managedEnvironmentRoot())) };
  }
  const progress = startInstall(workspace);
  if (progress.consentNeeded) {
    return { installed: false, state: 'not_installed', started: false, consentNeeded: true, offer: installPlan() };
  }
  return { installed: progress.state === 'installed', state: progress.state, started: progress.state === 'installing', consentNeeded: false };
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {'connected'|'not_connected'|'degraded'|'installing'} state
 * @param {{pythonPath?: string|null, pythonArgs?: string[], environmentRoot?: string|null, packageVersions?: Record<string, string|null>}} [extra]
 */
function persist(job, state, extra = {}) {
  try {
    const progressState = state === 'connected' ? 'installed' : state === 'installing' ? 'installing' : state === 'degraded' ? 'failed' : 'not_installed';
    updateResearchHelperRecord(job.root, (previous) => ({
      ...(previous ?? {}),
      state: state === 'installing' ? previous?.state ?? 'not_connected' : state,
      detail:
        state === 'connected'
          ? 'The research helper is installed and read a test page.'
          : job.progress.error ?? 'The research helper is not installed.',
      python: extra.pythonPath ?? previous?.python ?? null,
      python_args: extra.pythonArgs ?? previous?.python_args ?? [],
      environment_path: extra.environmentRoot ?? previous?.environment_path ?? managedEnvironmentRoot(),
      python_version: job.progress.pythonVersion,
      ...(extra.packageVersions
        ? {
            scrapling_version: extra.packageVersions.scrapling ?? null,
            playwright_version: extra.packageVersions.playwright ?? null,
            patchright_version: extra.packageVersions.patchright ?? null,
            curl_cffi_version: extra.packageVersions['curl-cffi'] ?? null,
            yt_dlp_version: extra.packageVersions['yt-dlp'] ?? null,
            faster_whisper_version: extra.packageVersions['faster-whisper'] ?? null,
          }
        : {}),
      last_error: job.progress.error,
      install: {
        job_id: job.jobId,
        owner_id: job.ownerId,
        workspace_root: job.root,
        state: progressState,
        step: job.progress.step,
        percent: job.progress.percent,
        started_at: job.progress.startedAt,
        finished_at: job.progress.finishedAt,
        error: job.progress.error,
      },
      ...(job.progress.speech
        ? {
            speech: {
              state: job.progress.speech.state,
              step: job.progress.speech.step,
              percent: job.progress.speech.percent,
              message: job.progress.speech.message,
              error: job.progress.speech.error,
              model: job.progress.speech.model,
            },
          }
        : {}),
    }));
  } catch (error) {
    // A workspace that cannot be written to is already a doctor problem of its own.
    log.warn('research helper state could not be recorded', { error: String(error), workspace_root: job.root });
  }
}

/**
 * Update progress and make the workspace record observable to another process.
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {Partial<InstallProgress>} patch
 */
function updateProgress(job, patch) {
  job.progress = { ...job.progress, ...patch };
  fallbackProgress = job.progress;
  persist(job, job.progress.state === 'installed' ? 'connected' : 'installing');
}

/**
 * Acquire a machine-wide lease for the managed environment. The transaction is
 * held until the install finishes, so two MCP processes cannot mutate the same
 * virtual environment at once. A process crash rolls the transaction back and
 * leaves the next process free to resume the persisted job.
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null} [job]
 * @param {string} [environmentRoot] the environment being installed.
 * @returns {Promise<{close: () => void}>}
 */
async function acquireInstallLease(job, environmentRoot) {
  // The lease lives beside the environment it guards when that is the plugin data
  // folder, so nothing is left in the per machine folder by a new install.
  const preferred = pluginDataEnvironmentRoot();
  const lockDir = preferred && environmentRoot && resolve(environmentRoot) === preferred
    ? dirname(preferred)
    : join(globalConfigDir(), 'research-helper');
  const lockPath = join(lockDir, 'install.lock.db');
  mkdirSync(lockDir, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < INSTALL_LEASE_WAIT_MS) {
    let lock = null;
    try {
      lock = new DatabaseSync(lockPath);
      lock.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;');
      return {
        close: () => {
          try {
            lock?.exec('ROLLBACK');
          } catch {
            // The transaction may already have been rolled back by process exit.
          }
          try {
            lock?.close();
          } catch {
            // Nothing else can be done with a closed lock handle.
          }
        },
      };
    } catch {
      try {
        lock?.close();
      } catch {
        // Try again after another process releases the lease.
      }
      if (job) {
        const shared = progressFromRecord(readResearchHelperRecord(job.root));
        if (shared?.state === 'installing' && shared.step !== job.progress.step) {
          // Show the owner process's durable step while this process waits for the
          // machine lease. Do not write it back, because this process does not own it.
          job.progress = { ...job.progress, ...shared };
          fallbackProgress = job.progress;
        }
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, INSTALL_LEASE_POLL_MS));
    }
  }
  throw new Error('The research helper is still being installed in another Social Campaign session. It will be available when that install finishes.');
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {Record<string, any>} options
 * @returns {Promise<InstallProgress>}
 */
async function runInstall(job, options) {
  const lease = await acquireInstallLease(job, options.environmentRoot ?? managedEnvironmentRoot());
  try {
    return await runInstallWithLease(job, options);
  } finally {
    lease.close();
  }
}

/**
 * Whether a Python lives inside the environment, so an uninstall can only ever reach the helper's own packages.
 * @param {string} python
 * @param {string} environmentRoot
 * @returns {boolean}
 */
function insideEnvironment(python, environmentRoot) {
  const prefix = resolve(environmentRoot) + sep;
  return resolve(python).toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Remove, from the helper's environment only, the packages nothing calls any more (see STALE_PACKAGES) and
 * the ones only they needed. Logged, recorded, and never fatal: a package that will not uninstall is left, and the next
 * update tries again.
 * @param {string[]} python
 * @param {string} environmentRoot
 * @param {{wantSpeech: boolean, installOptions: Record<string, any>, trusted: boolean}} context `trusted` is a test fixture: its Python is not inside the folder.
 * @returns {Promise<{removed: string[], failed: boolean}>}
 */
export async function pruneStalePackages(python, environmentRoot, context) {
  const plan = planPrune(environmentRoot, { speech: context.wantSpeech });
  if (!plan.ok || plan.remove.length === 0) {
    if (!plan.ok) log.info('research helper prune skipped', { reason: plan.reason });
    return { removed: [], failed: false };
  }
  // Never touch a Python that is not the helper's own: this is the line that keeps the system Python out of reach.
  if (!context.trusted && !insideEnvironment(python[0], environmentRoot)) {
    log.warn('research helper prune refused: the Python is not inside the helper environment', { python: python[0] });
    return { removed: [], failed: true };
  }
  const done = await runInstallCommand(python, ['-m', 'pip', 'uninstall', '-y', ...plan.remove], STEP_TIMEOUT_MS.prune, context.installOptions);
  log.info('research helper pruned retired packages', { removed: plan.remove, ok: done.ok, stale: plan.stale });
  return { removed: done.ok ? plan.remove : [], failed: !done.ok };
}

/**
 * Delete browser builds in the helper's own browsers folder that no installed package expects any more (an older
 * Chromium left behind by an upgrade). Only the plugin data folder is touched: Playwright's shared cache may be used by
 * other tools, so builds there are never deleted.
 * @param {string} environmentRoot
 * @returns {string[]} the folders removed.
 */
export function pruneOldBrowserBuilds(environmentRoot) {
  const own = managedBrowsersPath(environmentRoot);
  if (!own || !existsSync(own)) return [];
  const wanted = new Set([...(browserFoldersFor(environmentRoot, 'patchright') ?? []), ...(browserFoldersFor(environmentRoot, 'playwright') ?? [])]);
  if (wanted.size === 0) return [];
  /** @type {string[]} */
  const removed = [];
  for (const entry of readdirSync(own)) {
    if (!/^(chromium|chromium_headless_shell|ffmpeg)-\d+$/.test(entry) || wanted.has(entry)) continue;
    try {
      rmSync(join(own, entry), { recursive: true, force: true });
      removed.push(entry);
    } catch {
      // a folder in use is left for the next update
    }
  }
  return removed;
}

/**
 * Install the optional local speech to text: the package into the helper's environment, then the speech model, once.
 * Never fatal to the helper, and recorded with its own progress so the status can say what it is doing.
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {{python: string[], environmentRoot: string, installOptions: Record<string, any>, options: Record<string, any>, pinArgs: string[]}} context
 * @returns {Promise<boolean>} whether the package is installed (the model may still be on its way).
 */
async function installSpeechPackage(job, context) {
  const have = installedVersions(context.environmentRoot)?.get('faster-whisper');
  if (have) return true;
  job.progress = { ...job.progress, speech: { state: 'installing', step: 'speech_package', stepLabel: SPEECH_STEPS[0].label, percent: SPEECH_STEPS[0].percent, message: 'Installing local speech to text.', error: null, model: null } };
  persist(job, 'installing');
  const done = await runInstallCommand(context.python, ['-m', 'pip', 'install', ...context.pinArgs, FASTER_WHISPER_REQUIREMENT], STEP_TIMEOUT_MS.readers, context.installOptions);
  if (!done.ok) {
    job.progress = { ...job.progress, speech: { state: 'failed', step: 'speech_package', stepLabel: SPEECH_STEPS[0].label, percent: 0, message: null, error: reasonFor('speech', done), model: null } };
    persist(job, 'installing');
    return false;
  }
  return true;
}

/**
 * Download the speech model once, with progress, after the helper is ready.
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {{python: string[], installOptions: Record<string, any>, options: Record<string, any>}} context
 */
async function installSpeechModel(job, context) {
  const model = SPEECH_MODEL;
  const write = (/** @type {Partial<SpeechProgress>} */ patch) => {
    const previous = job.progress.speech ?? { state: 'installing', step: 'speech_model', stepLabel: SPEECH_STEPS[1].label, percent: 0, message: null, error: null, model };
    job.progress = { ...job.progress, speech: { ...previous, ...patch, model } };
    persist(job, 'connected');
  };
  if (speechModelPresent(model)) {
    write({ state: 'installed', step: 'speech_model', stepLabel: SPEECH_STEPS[1].label, percent: 100, message: 'Local speech to text is ready.', error: null });
    return;
  }
  write({ state: 'installing', step: 'speech_model', stepLabel: SPEECH_STEPS[1].label, percent: 0, message: 'Downloading the speech model (about 480 MB). It carries on in the background.', error: null });
  let lastWritten = -10;
  const fetched = await fetchSpeechModel({
    python: context.python,
    model,
    env: context.installOptions.env,
    script: context.options.speechScript,
    pollMs: context.options.speechPollMs,
    runner: (command, args, timeoutMs, env, input) => runInstallCommand(command, args, timeoutMs, { ...context.installOptions, env, input }),
    onProgress: ({ percent }) => {
      // Written about every 5 percent, so the record is not rewritten every poll.
      if (percent >= 100 || percent - lastWritten >= 5) {
        lastWritten = percent;
        write({ state: percent >= 100 ? 'installed' : 'installing', percent, message: percent >= 100 ? 'Local speech to text is ready.' : `Downloading the speech model: ${percent}%.` });
      }
    },
  });
  if (fetched.ok) write({ state: 'installed', percent: 100, message: 'Local speech to text is ready.', error: null });
  else write({ state: 'failed', message: null, error: fetched.reason });
  try {
    const { resetLocalWhisperCache } = await import('../video/local-whisper.mjs');
    resetLocalWhisperCache();
  } catch {
    // the cache simply expires on its own
  }
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {{candidates?: string[][], environmentRoot?: string, smokeUrl?: string, allowRealInstall?: boolean, runtimeCommand?: string[], speech?: boolean, speechScript?: string, speechPollMs?: number}} options
 * @returns {Promise<InstallProgress>}
 */
async function runInstallWithLease(job, options) {
  const candidates = options.candidates ?? pythonCandidates();
  const environmentRoot = options.environmentRoot ?? managedEnvironmentRoot();
  // Every command run with the managed Python sees the same browsers folder, so
  // the browser is downloaded to, and looked for in, one place.
  const env = researchHelperChildEnv(environmentRoot);
  const installOptions = { ...options, env };
  const recorded = readResearchHelperRecord(job.root);
  const wantSpeech = options.speech === true || Boolean(recorded?.speech_consent_at);
  /** @type {string[]|null} a fixture's interpreter, when a test supplies one. */
  const fixtureRuntime = Array.isArray(options.runtimeCommand) && options.runtimeCommand.length > 0 ? options.runtimeCommand : testRuntimeCommand();

  step(job, 'detecting');
  clearDetectCache();
  // A healthy managed environment can be shared by several workspaces, but a
  // compatible package in the user's base interpreter is never accepted as an
  // isolated install. Reuse a recorded managed command first, then an existing
  // managed executable, and create the venv for every other case.
  /** @type {string[]|null} */
  let python = null;
  let runtimeProbe = null;
  const recordedCommand = commandFromRecord(recorded);
  if (recordedCommand && recorded?.environment_path === environmentRoot) {
    clearDetectCache();
    const checked = await detect(recordedCommand, env);
    if (checked.python.found && checked.scrapling.found) {
      python = recordedCommand;
      runtimeProbe = checked;
    }
  }
  // The managed environment is machine owned, so it can remain usable even when
  // the base Python that originally created it is no longer on PATH. Check it before
  // asking for a base interpreter, which also lets a second workspace attach after
  // the first workspace has finished installing the shared runtime.
  const managedPath = managedPythonPath(environmentRoot);
  if (!python && existsSync(managedPath)) {
    clearDetectCache();
    const managedCommand = fixtureRuntime ?? [managedPath];
    const checked = await detect([managedCommand], env);
    if (checked.python.found) {
      python = managedCommand;
      runtimeProbe = checked;
    }
  }

  let basePython = null;
  let found = runtimeProbe;
  if (!python) {
    found = await detect(candidates);
    if (!found.python.found) {
      // Python is system software with its own licence terms, so it is never
      // installed on the person's behalf. They get the exact commands instead.
      step(job, 'python');
      return fail(job, noPythonReason());
    }
    basePython = /** @type {string[]} */ (found.python.command);
    updateProgress(job, { pythonVersion: found.python.version });
  } else {
    updateProgress(job, { pythonVersion: runtimeProbe?.python.version ?? null });
  }

  const constraints = writeConstraintsFile(environmentRoot);
  const pinArgs = constraintArgs(constraints);
  const trusted = fixtureRuntime !== null;

  if (!python) {
    step(job, 'readers');
    mkdirSync(dirname(environmentRoot), { recursive: true });
    const created = await runInstallCommand(/** @type {string[]} */ (basePython), ['-m', 'venv', environmentRoot], STEP_TIMEOUT_MS.readers, installOptions);
    if (!created.ok) return fail(job, reasonFor('readers', created, 'managed environment'));
    python = fixtureRuntime ? [...fixtureRuntime] : [managedPath];
    if (!trusted && !existsSync(managedPath)) {
      return fail(job, 'Python did not create the managed virtual environment. Remove its folder and try again.');
    }
    const pipReady = await ensurePipReady(python, installOptions);
    if (!pipReady.ok) return fail(job, /** @type {string} */ (pipReady.reason));
  }
  const pythonCommand = /** @type {string[]} */ (python);

  // The pinned set. A fresh environment installs it in one pip run, and a failure there ends the install; over an
  // existing one only what differs from the pins is touched, and a failure leaves the copy that already works.
  const before = installedVersions(environmentRoot);
  const needPin = (/** @type {string} */ pkg, /** @type {string} */ expected) => !before || before.get(pkg) !== expected;
  /** @type {string[]} */
  const pins = [];
  if (needPin('scrapling', SCRAPLING_VERSION)) pins.push(PINNED_REQUIREMENTS[0]);
  if (needPin('playwright', PLAYWRIGHT_VERSION)) pins.push(PINNED_REQUIREMENTS[1]);
  if (needPin('patchright', PATCHRIGHT_VERSION)) pins.push(PINNED_REQUIREMENTS[2]);
  if (needPin('curl-cffi', CURL_CFFI_VERSION)) pins.push(PINNED_REQUIREMENTS[3]);
  let pinnedChanged = false;
  if (pins.length > 0) {
    step(job, 'readers');
    const done = await runInstallCommand(pythonCommand, ['-m', 'pip', 'install', ...pinArgs, ...pins], STEP_TIMEOUT_MS.readers, installOptions);
    pinnedChanged = done.ok;
    if (!done.ok && (!before || !before.get('scrapling'))) return fail(job, reasonFor('readers', done));
  }

  // Video downloads for reference teardowns. Never fatal: without it the research helper still reads pages,
  // and a missing downloader is reported plainly when a video is asked for. yt-dlp is the one package that is
  // kept current (upgrade when it is missing or old); the constraints stop the upgrade moving curl_cffi.
  try {
    const latest = readLatestVersions(environmentRoot)?.versions ?? null;
    const state = researchToolsState(environmentRoot, { latest, ffmpeg: true });
    if (state.missing.includes('yt-dlp') || state.outdated.includes('yt-dlp')) {
      await runInstallCommand(pythonCommand, ['-m', 'pip', 'install', '--upgrade', ...pinArgs, VIDEO_TOOLS_REQUIREMENT], STEP_TIMEOUT_MS.readers, installOptions);
    }
  } catch {
    // keep going
  }

  // The optional speech reader's package goes in before the clean up, so the clean up sees what it needs and keeps it.
  const speechInstalled = wantSpeech ? await installSpeechPackage(job, { python: pythonCommand, environmentRoot, installOptions, options, pinArgs }) : false;

  // Retired packages (STALE_PACKAGES) and what only they needed. Best effort.
  let pruned = { removed: /** @type {string[]} */ ([]), failed: false };
  try {
    pruned = await pruneStalePackages(pythonCommand, environmentRoot, { wantSpeech: speechInstalled, installOptions, trusted });
  } catch {
    // the next update tries again
  }

  // The browser: Patchright's Chromium, the one Scrapling's stealth fetcher drives. Playwright shares the same build while
  // the two versions match, and nothing here runs `playwright install` or `scrapling install`, so there is one download.
  const browserWasThere = chromiumPresentFor(environmentRoot, 'patchright');
  if (!browserWasThere || pinnedChanged) {
    if (!chromiumPresentFor(environmentRoot, 'patchright')) {
      step(job, 'browser');
      const installed = await runInstallCommand(pythonCommand, ['-m', 'patchright', 'install', 'chromium'], STEP_TIMEOUT_MS.browser, installOptions);
      if (!installed.ok && !browserWasThere) return fail(job, reasonFor('browser', installed));
    }
  }
  try {
    const removedBuilds = pruneOldBrowserBuilds(environmentRoot);
    if (removedBuilds.length > 0) log.info('research helper removed old browser builds', { removed: removedBuilds });
  } catch {
    // old builds are left for the next update
  }
  clearDetectCache();
  runtimeProbe = await detect([pythonCommand], env);
  if (!runtimeProbe.python.found || !runtimeProbe.scrapling.found || !runtimeProbe.chromium.found) {
    return fail(job, 'The install finished, but the managed environment still cannot load Scrapling and its browser. Try the install again.');
  }
  updateProgress(job, { pythonVersion: runtimeProbe.python.version, scraplingVersion: runtimeProbe.scrapling.version });

  step(job, 'smoke');
  const versions = Object.fromEntries(installedVersions(environmentRoot) ?? []);
  const smoke = await smokeThroughStealth(pythonCommand, environmentRoot, options.smokeUrl ?? SMOKE_URL, versions.scrapling ?? runtimeProbe.scrapling.version ?? 'unknown');
  if (!smoke.ok) {
    // Everything is on disk but the browser did not come back with a page. That is a
    // working install with a problem, so it is recorded as degraded and the doctor
    // offers to run it again.
    job.progress = { ...job.progress, state: 'failed', error: smoke.reason, finishedAt: nowIso() };
    fallbackProgress = job.progress;
    persist(job, 'degraded', { pythonPath: pythonCommand[0], pythonArgs: pythonCommand.slice(1), environmentRoot, packageVersions: versions });
    return { ...job.progress };
  }

  clearDetectCache();
  step(job, 'done', { state: 'installed', error: null, finishedAt: nowIso() });
  persist(job, 'connected', { pythonPath: pythonCommand[0], pythonArgs: pythonCommand.slice(1), environmentRoot, packageVersions: versions });
  if (pruned.removed.length > 0) {
    try {
      updateResearchHelperRecord(job.root, (previous) => ({ ...(previous ?? {}), last_prune: { at: nowIso(), removed: pruned.removed } }));
    } catch {
      // the log line above already has it
    }
  }
  log.info('research helper installed', { python: found?.python.version ?? job.progress.pythonVersion, scrapling: job.progress.scraplingVersion, workspace_root: job.root });

  // The speech model is the long download. The helper is already usable, so it is fetched after, in the same job.
  if (speechInstalled) {
    try {
      await installSpeechModel(job, { python: pythonCommand, installOptions, options });
    } catch (error) {
      log.warn('speech model download threw', { error: String(error) });
    }
    persist(job, 'connected', { pythonPath: pythonCommand[0], pythonArgs: pythonCommand.slice(1), environmentRoot, packageVersions: Object.fromEntries(installedVersions(environmentRoot) ?? []) });
  }
  return { ...job.progress };
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {string} reason
 * @returns {InstallProgress}
 */
function fail(job, reason) {
  job.progress = { ...job.progress, state: 'failed', error: reason, finishedAt: nowIso() };
  fallbackProgress = job.progress;
  persist(job, 'not_connected');
  log.warn('research helper install failed', { step: job.progress.step, workspace_root: job.root });
  return { ...job.progress };
}

/**
 * Read the test page through the same StealthBackend production uses, in a real browser (`render: true`), so the install
 * is only called ready when the browser itself launches and comes back with a page, and a missing worker file or a
 * protocol mismatch is caught here and not in the person's first research.
 * @param {string[]} python
 * @param {string} environmentRoot
 * @param {string} url
 * @param {string} scraplingVersion
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 */
async function smokeThroughStealth(python, environmentRoot, url, scraplingVersion) {
  try {
    const { StealthBackend } = await import('../social/backends/stealth.mjs');
    const backend = new StealthBackend({
      python: python[0],
      timeoutMs: STEP_TIMEOUT_MS.smoke,
      state: () => ({
        state: 'connected',
        record_version: RESEARCH_HELPER_RECORD_VERSION,
        python: python[0],
        environment_kind: RESEARCH_HELPER_ENVIRONMENT_KIND,
        environment_path: environmentRoot,
        python_args: python.slice(1),
        scrapling_version: scraplingVersion,
      }),
    });
    const result = await backend.page(url, { render: true, timeoutMs: STEP_TIMEOUT_MS.smoke });
    if (!result.ok) return { ok: false, reason: `The test page could not be read in the browser. ${result.reason}` };
    if (!String(result.text ?? '').trim()) return { ok: false, reason: 'The test page returned no readable content.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `The browser reader could not be checked: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// --- the speech model, outside an install ---

/** @type {Map<string, Promise<void>>} */
const speechFetches = new Map();

/**
 * Start the speech model download in the background when a transcription needs it, but only for a person who said yes to
 * local speech to text and whose helper has the package. Returns at once; the status shows the progress. Safe to call
 * again while it runs.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} [model]
 * @param {{python?: string[], script?: string, pollMs?: number}} [options] `python` and `script` are test fixture hooks.
 * @returns {{started: boolean, state: 'downloading'|'no_consent'|'not_installed'|'ready'}}
 */
export function ensureSpeechModel(workspace, model = SPEECH_MODEL, options = {}) {
  const root = workspaceRootOf(workspace);
  const record = root ? readResearchHelperRecord(root) : null;
  if (!root || !record?.speech_consent_at) return { started: false, state: 'no_consent' };
  if (speechModelPresent(model)) return { started: false, state: 'ready' };
  const environmentRoot = environmentFor(record, undefined);
  if (!installedVersions(environmentRoot)?.get('faster-whisper')) return { started: false, state: 'not_installed' };
  const python = options.python ?? commandFromRecord(record) ?? [managedPythonPath(environmentRoot)];
  if (speechFetches.has(model)) return { started: false, state: 'downloading' };
  const env = researchHelperChildEnv(environmentRoot);
  /** @param {Partial<SpeechProgress>} patch */
  const save = (patch) => {
    try {
      updateResearchHelperRecord(root, (previous) => ({
        ...(previous ?? {}),
        speech: { ...(previous?.speech ?? {}), step: 'speech_model', model, ...patch },
      }));
    } catch {
      // the download carries on whether or not the record could be written
    }
  };
  save({ state: 'installing', percent: 0, message: 'Downloading the speech model (about 480 MB). It carries on in the background.', error: null });
  const work = fetchSpeechModel({
    python,
    model,
    env,
    script: options.script,
    pollMs: options.pollMs,
    runner: (command, args, timeoutMs, childEnv, input) => runInstallCommand(command, args, timeoutMs, { env: childEnv, input }),
    onProgress: ({ percent }) => save({ state: 'installing', percent, message: `Downloading the speech model: ${percent}%.` }),
  })
    .then(async (fetched) => {
      if (fetched.ok) save({ state: 'installed', percent: 100, message: 'Local speech to text is ready.', error: null });
      else save({ state: 'failed', message: null, error: fetched.reason });
      try {
        const { resetLocalWhisperCache } = await import('../video/local-whisper.mjs');
        resetLocalWhisperCache();
      } catch {
        // the cache simply expires on its own
      }
    })
    .catch(() => {})
    .finally(() => {
      speechFetches.delete(model);
    });
  speechFetches.set(model, work);
  return { started: true, state: 'downloading' };
}

/** Wait for the speech model download in flight, if any. Tests use this. */
export async function whenSpeechModelSettles() {
  await Promise.all([...speechFetches.values()]);
}

/** Exposed for tests: the normalised retired package names an update removes. */
export const RETIRED_PACKAGES = STALE_PACKAGES.map(normalizeDistName);
