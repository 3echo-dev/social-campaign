/**
 * The browser based research helper: detect it, install it, report on it.
 *
 * Some sites show almost nothing to a plain page fetch. A real browser driving the
 * page reads them properly, so Social Campaign can optionally install one: the
 * Crawl4AI package, in its own virtual environment, and the Chromium that package
 * drives. Both are somebody else's software living on the person's computer, so
 * neither is installed without them choosing to (every install entry point needs
 * `confirm: true`), and neither is ever required. Python itself must already be
 * there: it is never installed for the person, who gets the command instead.
 *
 * The environment and its browser go in the plugin data folder when Claude Code
 * provides one (removed on uninstall), and in `~/.social-campaign/research-helper`
 * otherwise. An install already in that older place keeps being used.
 *
 * Three rules hold this file together.
 *
 * Nothing runs through a shell. Every child process is `execFile` with an argument
 * array, so a folder name with a space or a quote in it is an argument, never syntax.
 *
 * Nothing blocks. `startInstall` returns the moment the work is handed to the event
 * loop; `research_helper_status` reads `installProgress()` and reports the steps as they
 * go by. Every step carries its own timeout, so a wedged installer ends as a
 * plain failure rather than a status that says "Installing" forever.
 *
 * Nothing throws at the caller. Every failure becomes a recorded state with a
 * sentence a person can act on, because a failed optional extra must never take the
 * rest of setup down with it.
 *
 * What is recorded, and who reads it
 * ----------------------------------
 * The outcome is written to `<workspace>/.social-campaign/integrations.json` under
 * `research_helper`, whose `state` is `connected`, `not_connected` or `degraded`.
 * That is the agreed handover point for the `research.browser` capability: this file
 * writes the state, and the capability resolver reads it.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { newId, nowIso } from '../lib/ids.mjs';
import { log } from '../lib/log.mjs';
import {
  managedBrowsersPath,
  managedEnvironmentRoot,
  managedPythonPath,
  pluginDataEnvironmentRoot,
  researchHelperChildEnv,
  hasUsableResearchHelperRecord,
  researchHelperWorkerSha256,
  readResearchHelperRecord,
  updateResearchHelperRecord,
  RESEARCH_HELPER_ENVIRONMENT_KIND,
  RESEARCH_HELPER_KEY,
  RESEARCH_HELPER_RECORD_VERSION,
} from './research-helper-record.mjs';
import { globalConfigDir } from '../lib/paths.mjs';

/** The capability this helper backs. The resolver reads the recorded state under this name. */
export const RESEARCH_CAPABILITY = 'research.browser';

/** The key inside integrations.json. */
export { RESEARCH_HELPER_KEY, RESEARCH_HELPER_RECORD_VERSION } from './research-helper-record.mjs';

/** The worker shipped beside this module in both source and extracted packages. */
export const DEFAULT_WORKER_PATH = fileURLToPath(new URL('../../python/social_fetch.py', import.meta.url));

/**
 * The Crawl4AI release this installs, verified as the current release on PyPI.
 * Pinned rather than floating so an install today and an install next month put the
 * same thing on two people's machines.
 */
export const CRAWL4AI_VERSION = '0.9.3';

/** yt-dlp with curl_cffi, so TikTok's bot check can be answered with browser impersonation (--impersonate chrome). */
export const VIDEO_TOOLS_REQUIREMENT = 'yt-dlp[default,curl-cffi]';

/**
 * Optional discovery libraries for finding popular in-niche Reels and TikToks: Instaloader (MIT) and TikTok-Api (MIT,
 * drives Playwright). Installed best effort, the same way as VIDEO_TOOLS_REQUIREMENT; a failure here never fails setup.
 */
export const DISCOVERY_TOOLS_REQUIREMENTS = ['instaloader', 'TikTokApi'];

/** The oldest Python the helper works on. */
export const MIN_PYTHON = { major: 3, minor: 10 };

/** The page the smoke run reads, chosen because it exists to be fetched. */
export const SMOKE_URL = 'https://example.com';

/**
 * Every step, in the order they run, with the words the status shows and how far
 * through the bar sits once that step has finished.
 * @type {Array<{id: string, label: string, percent: number}>}
 */
export const INSTALL_STEPS = [
  { id: 'detecting', label: 'Checking what is already on this computer', percent: 8 },
  // Python is never installed for the person; this step only finds it, and is where
  // the install stops with the manual command when there is none.
  { id: 'python', label: 'Looking for Python', percent: 30 },
  { id: 'crawl4ai', label: 'Installing the page reader', percent: 60 },
  { id: 'browser', label: 'Installing the browser it drives', percent: 85 },
  { id: 'smoke', label: 'Reading a test page', percent: 96 },
  { id: 'done', label: 'Ready', percent: 100 },
];

/** How long each step is given before it is called a failure. */
const STEP_TIMEOUT_MS = {
  probe: 20_000,
  python: 20 * 60_000,
  crawl4ai: 20 * 60_000,
  browser: 20 * 60_000,
  smoke: 3 * 60_000,
};

// A browser download can take close to an hour on a slow connection. The lease
// wait is therefore inside the install budget rather than a short 30 second probe
// that turns a healthy concurrent install into a misleading failure.
const INSTALL_LEASE_WAIT_MS = 65 * 60_000;
const INSTALL_LEASE_POLL_MS = 250;

/**
 * The Python commands to try, most specific first. `py -3` is the Windows launcher,
 * which is the only one that reliably skips the Microsoft Store stub.
 * @returns {string[][]}
 */
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

/** The one line Python prints so detection can read its version and its real path. */
const VERSION_SCRIPT = 'import sys;print("SCPY",sys.version_info[0],sys.version_info[1],sys.executable,sep="|")';

/**
 * Run a program and collect what it said. Never rejects: a program that is missing,
 * that fails, or that hangs all come back as a plain result object.
 * @param {string[]} command the program followed by its fixed arguments.
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} [env] the child's environment; omitted inherits this process's.
 * @returns {Promise<{ok: boolean, code: number|string|null, stdout: string, stderr: string, spawnFailed: boolean, timedOut: boolean}>}
 */
export function run(command, args, timeoutMs, env) {
  const [program, ...fixed] = command;
  return new Promise((resolvePromise) => {
    execFile(
      program,
      [...fixed, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...(env ? { env } : {}) },
      (error, stdout, stderr) => {
        const rawCode = error ? /** @type {any} */ (error).code : 0;
        const code = error && (typeof rawCode === 'number' || typeof rawCode === 'string') ? rawCode : error ? null : 0;
        resolvePromise({
          ok: !error,
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          // ENOENT means there is no such program, which is a different answer from
          // a program that ran and said no.
          spawnFailed: Boolean(error && rawCode === 'ENOENT'),
          timedOut: Boolean(error && (rawCode === 'ETIMEDOUT' || /** @type {any} */ (error).killed)),
        });
      },
    );
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
 * @param {{allowRealInstall?: boolean, env?: NodeJS.ProcessEnv}} [options]
 */
function runInstallCommand(command, args, timeoutMs, options = {}) {
  if (canRunInstallCommand(command, options)) return run(command, args, timeoutMs, options.env);
  return Promise.resolve({
    ok: false,
    code: 'test_install_blocked',
    stdout: '',
    stderr: 'Real installer commands are disabled during tests. Use SOCIAL_CAMPAIGN_TEST_PYTHON with a fixture.',
    spawnFailed: false,
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
const CRAWL4AI_SCRIPT =
  'import importlib.metadata as metadata;import crawl4ai;print("SCC4|"+metadata.version("crawl4ai"))';

/**
 * Is Crawl4AI importable by this Python?
 * @param {string[]} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{found: boolean, version: string|null, compatible: boolean}>}
 */
export async function detectCrawl4ai(command, env) {
  const result = await run(command, ['-c', CRAWL4AI_SCRIPT], STEP_TIMEOUT_MS.probe, env);
  const line = String(result.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCC4|'));
  if (!result.ok || !line) return { found: false, version: null, compatible: false };
  const version = line.slice('SCC4|'.length) || null;
  return { found: true, version, compatible: version === CRAWL4AI_VERSION };
}

/**
 * Playwright's Chromium is a download, not a package, so importing playwright says
 * nothing about whether the browser itself is on disk. This asks for the executable
 * path and then asks the filesystem, through Python, whether it is really there.
 * @param {string[]} command
 * @param {NodeJS.ProcessEnv} [env] carries PLAYWRIGHT_BROWSERS_PATH for an environment with its own browsers folder.
 * @returns {Promise<{found: boolean}>}
 */
export async function detectChromium(command, env) {
  const script =
    'import os\n' +
    'from playwright.sync_api import sync_playwright\n' +
    'with sync_playwright() as p:\n' +
    '    print("SCCR|" + str(os.path.exists(p.chromium.executable_path)))\n';
  const result = await run(command, ['-c', script], STEP_TIMEOUT_MS.probe, env);
  const line = String(result.stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SCCR|'));
  return { found: Boolean(result.ok && line && line.endsWith('True')) };
}

/**
 * Everything detection knows, in one object.
 * @param {string[][]} [candidates]
 * @param {NodeJS.ProcessEnv} [env] from `researchHelperChildEnv`, for a managed environment's own command.
 * @returns {Promise<{python: Awaited<ReturnType<typeof detectPython>>, crawl4ai: {found: boolean, version: string|null, compatible: boolean}, chromium: {found: boolean}, state: 'connected'|'degraded'|'not_connected'}>}
 */
export async function detect(candidates = pythonCandidates(), env) {
  const key = JSON.stringify([candidates, env?.PLAYWRIGHT_BROWSERS_PATH ?? null]);
  const cached = DETECT_CACHE.get(key);
  if (cached && Date.now() - cached.at < DETECT_CACHE_MS) return cached.value;
  const value = await detectUncached(candidates, env);
  DETECT_CACHE.set(key, { at: Date.now(), value });
  return value;
}

/** Detection spawns up to five processes, and the doctor and the status
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
    return { python, crawl4ai: { found: false, version: null, compatible: false }, chromium: { found: false }, state: 'not_connected' };
  }
  const crawl4ai = await detectCrawl4ai(python.command, env);
  const chromium = crawl4ai.found ? await detectChromium(python.command, env) : { found: false };
  const state = crawl4ai.compatible && chromium.found ? 'connected' : crawl4ai.found ? 'degraded' : 'not_connected';
  return { python, crawl4ai, chromium, state };
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
 * @typedef {object} InstallProgress
 * @property {'not_installed'|'installing'|'installed'|'failed'} state
 * @property {string} step the id of the step running now, or the last one that ran.
 * @property {string} stepLabel that step in words.
 * @property {number} percent
 * @property {string|null} error the plain reason it failed, with what to do about it.
 * @property {string|null} pythonVersion
 * @property {string|null} crawl4aiVersion
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
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
    crawl4aiVersion: null,
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
  return {
    state,
    step: stepInfo.id,
    stepLabel: stepInfo.label,
    percent: Number.isFinite(Number(install?.percent)) ? Number(install.percent) : state === 'installed' ? 100 : stepInfo.percent,
    error: typeof record.last_error === 'string' ? record.last_error : typeof install?.error === 'string' ? install.error : null,
    pythonVersion: typeof record.python_version === 'string' ? record.python_version : null,
    crawl4aiVersion: typeof record.crawl4ai_version === 'string' ? record.crawl4ai_version : null,
    startedAt: typeof install?.started_at === 'string' ? install.started_at : null,
    finishedAt: typeof install?.finished_at === 'string' ? install.finished_at : null,
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
  return [
    install,
    `${py} -m venv ${JSON.stringify(environment)} && ${JSON.stringify(runtime)} -m pip install crawl4ai==${CRAWL4AI_VERSION}`,
    `${browsersPrefix}${JSON.stringify(runtime)} -m playwright install chromium`,
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
 * @returns {{summary: string, needs: string, size: string, location: string, removal: string}}
 */
export function installPlan() {
  const environment = managedEnvironmentRoot();
  const home = dirname(environment);
  const inPluginData = pluginDataEnvironmentRoot() !== null && resolve(environment) === pluginDataEnvironmentRoot();
  return {
    summary:
      'An optional research helper lets Social Campaign read web pages that show almost nothing to a plain ' +
      'page reader, such as some social profiles and shops. It installs the Crawl4AI page reader (a Python ' +
      'package) and a private copy of the Chromium browser it drives. Research works without it, on public pages and web search.',
    needs: 'Python 3.10 or newer already on this computer. Social Campaign never installs Python itself.',
    size: 'Chromium alone is about 150 MB, and the page reader\'s Python packages add a few hundred MB more. It takes several minutes.',
    location: home,
    removal: inPluginData
      ? 'Uninstalling the Social Campaign plugin removes it.'
      : `To remove it later, delete the folder ${home}${managedBrowsersPath(environment) ? '' : ' and Playwright\'s browser cache'}.`,
  };
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
    .filter(Boolean)
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
  if (stepId === 'crawl4ai') {
    const thing = subject || 'the page reader';
    return `Installing ${thing} did not finish.${detail} You can install it yourself with: ${second}`;
  }
  if (stepId === 'browser') return `Installing the browser did not finish.${detail} You can install it yourself with: ${third}`;
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
 * its own real message, at the crawl4ai step that actually needed it.
 * @param {string[]} python
 * @param {{allowRealInstall?: boolean}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
async function ensurePipReady(python, options = {}) {
  const check = await run(python, ['-m', 'pip', '--version'], STEP_TIMEOUT_MS.probe);
  if (check.ok || !isPipMissing(check)) return { ok: true, reason: null };

  let ensured = await runInstallCommand(python, ['-m', 'ensurepip', '--upgrade', '--default-pip'], STEP_TIMEOUT_MS.crawl4ai, options);
  if (!ensured.ok) {
    ensured = await runInstallCommand(python, ['-m', 'ensurepip', '--upgrade', '--default-pip'], STEP_TIMEOUT_MS.crawl4ai, options);
  }

  const recheck = ensured.ok ? await run(python, ['-m', 'pip', '--version'], STEP_TIMEOUT_MS.probe) : ensured;
  if (ensured.ok && recheck.ok) return { ok: true, reason: null };

  // pip is missing and ensurepip could not put it there either, so the person is
  // told to run ensurepip first, then the pip install that would otherwise just fail
  // again the same way.
  const ensurepipCommand = [...python, '-m', 'ensurepip', '--upgrade', '--default-pip'].join(' ');
  const pipCommand = [...python, '-m', 'pip', 'install', `crawl4ai==${CRAWL4AI_VERSION}`].join(' ');
  return {
    ok: false,
    reason: `This Python has no pip, and ensurepip could not install it either. You can install it yourself with: ${ensurepipCommand} then ${pipCommand}`,
  };
}

/**
 * Install whatever is missing, in order, reporting each step as it goes.
 *
 * Returns immediately. The result is watched through `installProgress()` and recorded
 * in integrations.json when it ends, either way.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{candidates?: string[][], environmentRoot?: string, workerPath?: string, smokeUrl?: string, allowRealInstall?: boolean, runtimeCommand?: string[]}} [options]
 * `runtimeCommand` is a test fixture hook and is never supplied by a product tool.
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
  if (persisted?.state === 'installed' && healthyResearchHelperRecord(persistedRecord)) {
    lastJobRoot = root;
    fallbackProgress = persisted;
    return { ...persisted };
  }
  const job = {
    root,
    jobId: newId(),
    ownerId: INSTALL_OWNER_ID,
    progress: {
      state: 'installing',
      step: 'detecting',
      stepLabel: INSTALL_STEPS[0].label,
      percent: INSTALL_STEPS[0].percent,
      error: null,
      pythonVersion: null,
      crawl4aiVersion: null,
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
        error: 'Something went wrong while installing the research helper. Try again from the doctor.',
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

/**
 * Setup installs the helper on its own, so the person is never asked. The helper
 * lives once per computer, so a copy an earlier workspace installed is found and
 * reused within seconds. The install runs in the background and nothing waits on
 * it; without Python 3.10 or newer it stops quietly and research works without it.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{installed: boolean, state: InstallProgress['state'], started: boolean}}
 */
export function ensureResearchHelper(workspace) {
  const summary = researchHelperSummary(workspace);
  if (summary.installed || summary.state === 'installing') return { installed: summary.installed, state: summary.state, started: false };
  // Under the test runner only installer tests, which stand a fake Python in, start one.
  if (isNodeTestProcess() && !process.env.SOCIAL_CAMPAIGN_TEST_PYTHON && !realInstallAllowed()) {
    return { installed: false, state: summary.state, started: false };
  }
  const progress = startInstall(workspace);
  return { installed: progress.state === 'installed', state: progress.state, started: progress.state === 'installing' };
}

/**
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {'connected'|'not_connected'|'degraded'|'installing'} state
 * @param {{pythonPath?: string|null, pythonArgs?: string[], environmentRoot?: string|null, workerPath?: string|null, workerSha256?: string|null}} [extra]
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
      worker_path: extra.workerPath ?? previous?.worker_path ?? DEFAULT_WORKER_PATH,
      worker_sha256: extra.workerSha256 ?? previous?.worker_sha256 ?? null,
      python_version: job.progress.pythonVersion,
      crawl4ai_version: job.progress.crawl4aiVersion,
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
  persist(job, 'installing');
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
 * @param {{candidates?: string[][], environmentRoot?: string, workerPath?: string, smokeUrl?: string, allowRealInstall?: boolean, runtimeCommand?: string[]}} options
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
 * @param {{root: string, jobId: string, ownerId: string, progress: InstallProgress, inFlight: Promise<InstallProgress>|null}} job
 * @param {{candidates?: string[][], environmentRoot?: string, workerPath?: string, smokeUrl?: string, allowRealInstall?: boolean}} options
 * @returns {Promise<InstallProgress>}
 */
async function runInstallWithLease(job, options) {
  const candidates = options.candidates ?? pythonCandidates();
  const environmentRoot = options.environmentRoot ?? managedEnvironmentRoot();
  const workerPath = options.workerPath ?? DEFAULT_WORKER_PATH;
  // Every command run with the managed Python sees the same browsers folder, so
  // the browser is downloaded to, and looked for in, one place.
  const env = researchHelperChildEnv(environmentRoot);
  const installOptions = { ...options, env };

  step(job, 'detecting');
  clearDetectCache();
  // A healthy managed environment can be shared by several workspaces, but a
  // compatible package in the user's base interpreter is never accepted as an
  // isolated install. Reuse a recorded managed command first, then an existing
  // managed executable, and create the venv for every other case.
  let python = null;
  let runtimeEnvironment = environmentRoot;
  let runtimeProbe = null;
  const recorded = readResearchHelperRecord(job.root);
  const recordedCommand = commandFromRecord(recorded);
  if (
    recordedCommand &&
    recorded?.environment_path === environmentRoot &&
    recorded?.worker_path === workerPath
  ) {
    clearDetectCache();
    const checked = await detect(recordedCommand, env);
    if (checked.python.found && checked.crawl4ai.compatible && checked.chromium.found) {
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
    const checked = await detect([[managedPath]], env);
    if (checked.python.found && checked.crawl4ai.compatible && checked.chromium.found) {
      python = [managedPath];
      runtimeProbe = checked;
    }
  }

  let found = runtimeProbe;
  let basePython = null;
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
  }

  if (!python) {
    step(job, 'crawl4ai');
    mkdirSync(dirname(environmentRoot), { recursive: true });
    const created = await runInstallCommand(/** @type {string[]} */ (basePython), ['-m', 'venv', environmentRoot], STEP_TIMEOUT_MS.crawl4ai, installOptions);
    if (!created.ok) return fail(job, reasonFor('crawl4ai', created, 'managed environment'));
    python = Array.isArray(options.runtimeCommand) && options.runtimeCommand.length > 0
      ? [...options.runtimeCommand]
      : [managedPath];
    if (!options.runtimeCommand && !existsSync(managedPath)) {
      return fail(job, 'Python did not create the managed virtual environment. Remove its folder and try again.');
    }
    const pipReady = await ensurePipReady(python, installOptions);
    if (!pipReady.ok) return fail(job, /** @type {string} */ (pipReady.reason));
    const installed = await runInstallCommand(
      python,
      ['-m', 'pip', 'install', `crawl4ai==${CRAWL4AI_VERSION}`],
      STEP_TIMEOUT_MS.crawl4ai,
      installOptions,
    );
    if (!installed.ok) return fail(job, reasonFor('crawl4ai', installed));
    const after = await detectCrawl4ai(python, env);
    if (!after.found || !after.compatible) {
      return fail(
        job,
        after.found
          ? `The managed environment installed Crawl4AI ${after.version ?? 'an unknown version'}, but ${CRAWL4AI_VERSION} is required.`
          : 'Crawl4AI installed, but the managed environment could not import its distribution metadata.',
      );
    }
    updateProgress(job, { crawl4aiVersion: after.version });
    clearDetectCache();
    runtimeProbe = await detect([python], env);
  } else {
    updateProgress(job, { crawl4aiVersion: runtimeProbe?.crawl4ai.version ?? null });
  }

  if (!runtimeProbe?.python.found || !runtimeProbe.crawl4ai.compatible) {
    return fail(job, 'The managed environment cannot load the pinned page reader. Try the install again.');
  }
  updateProgress(job, { pythonVersion: runtimeProbe.python.version, crawl4aiVersion: runtimeProbe.crawl4ai.version });

  // Video downloads for reference teardowns. Never fatal: without it the research helper still reads pages,
  // and a missing downloader is reported plainly when a video is asked for.
  try {
    const have = await runInstallCommand(python, ['-c', 'import yt_dlp, curl_cffi'], STEP_TIMEOUT_MS.probe, installOptions);
    if (!have.ok) await runInstallCommand(python, ['-m', 'pip', 'install', '--upgrade', VIDEO_TOOLS_REQUIREMENT], STEP_TIMEOUT_MS.crawl4ai, installOptions);
  } catch {
    // keep going
  }

  // Discovery libraries (Instaloader, TikTok-Api). Best effort and never fatal: without them the discovery routes
  // report not_installed and research goes on with the other routes.
  try {
    const haveDiscovery = await runInstallCommand(python, ['-c', 'import instaloader, TikTokApi'], STEP_TIMEOUT_MS.probe, installOptions);
    if (!haveDiscovery.ok) await runInstallCommand(python, ['-m', 'pip', 'install', '--upgrade', ...DISCOVERY_TOOLS_REQUIREMENTS], STEP_TIMEOUT_MS.crawl4ai, installOptions);
  } catch {
    // keep going
  }

  if (!runtimeProbe?.chromium.found) {
    step(job, 'browser');
    const installed = await runInstallCommand(python, ['-m', 'playwright', 'install', 'chromium'], STEP_TIMEOUT_MS.browser, installOptions);
    if (!installed.ok) return fail(job, reasonFor('browser', installed));
    clearDetectCache();
    runtimeProbe = await detect([python], env);
    if (!runtimeProbe.crawl4ai.compatible || !runtimeProbe.chromium.found) {
      return fail(job, 'The browser install finished, but the managed environment still cannot load the pinned page reader and Chromium. Try the install again.');
    }
  }

  // TikTok-Api drives the same Playwright Chromium. Normally already there from the step above; this is a cheap,
  // best effort top-up that never fails the install.
  try {
    await runInstallCommand(python, ['-m', 'playwright', 'install', 'chromium'], STEP_TIMEOUT_MS.browser, installOptions);
  } catch {
    // keep going
  }

  const workerSha256 = researchHelperWorkerSha256(workerPath);
  if (!workerSha256) return fail(job, 'The browser research worker is missing or is not a regular file. Reinstall Social Campaign and try again.');
  step(job, 'smoke');
  const smoke = await smokeThroughBrowser(python, runtimeEnvironment, workerPath, options.smokeUrl ?? SMOKE_URL, workerSha256);
  if (!smoke.ok) {
    // Everything is on disk but the browser did not come back with a page. That is a
    // working install with a problem, so it is recorded as degraded and the doctor
    // offers to run it again.
    job.progress = { ...job.progress, state: 'failed', error: smoke.reason, finishedAt: nowIso() };
    fallbackProgress = job.progress;
    persist(job, 'degraded', {
      pythonPath: python[0],
      pythonArgs: python.slice(1),
      environmentRoot: runtimeEnvironment,
      workerPath,
      workerSha256,
    });
    return { ...job.progress };
  }

  // Hash again after the smoke read. A worker replaced while it was being
  // checked must not be recorded as the bytes that were actually tested.
  const verifiedWorkerSha256 = researchHelperWorkerSha256(workerPath);
  if (!verifiedWorkerSha256 || verifiedWorkerSha256 !== workerSha256) {
    return fail(job, 'The browser research worker changed while it was being checked. Reinstall Social Campaign and try again.');
  }

  clearDetectCache();
  step(job, 'done', { state: 'installed', error: null, finishedAt: nowIso() });
  persist(job, 'connected', {
    pythonPath: python[0],
    pythonArgs: python.slice(1),
    environmentRoot: runtimeEnvironment,
    workerPath,
    workerSha256: verifiedWorkerSha256,
  });
  log.info('research helper installed', { python: found.python.version, crawl4ai: job.progress.crawl4aiVersion, workspace_root: job.root });
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
 * Run the shipped worker through the same BrowserBackend production uses. Keeping
 * the smoke path there catches a missing worker file, an incompatible record and
 * a worker protocol mismatch before the installer reports success.
 * @param {string[]} python
 * @param {string} environmentRoot
 * @param {string} workerPath
 * @param {string} url
 * @param {string} workerSha256
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 */
async function smokeThroughBrowser(python, environmentRoot, workerPath, url, workerSha256) {
  try {
    const { BrowserBackend } = await import('../social/backends/browser.mjs');
    const backend = new BrowserBackend({
      scriptPath: workerPath,
      state: () => ({
        state: 'connected',
        record_version: RESEARCH_HELPER_RECORD_VERSION,
        python: python[0],
        environment_kind: RESEARCH_HELPER_ENVIRONMENT_KIND,
        environment_path: environmentRoot,
        python_args: python.slice(1),
        worker_path: workerPath,
        worker_sha256: workerSha256,
      }),
      timeoutMs: STEP_TIMEOUT_MS.smoke,
      killGraceMs: 5_000,
    });
    const result = await backend.fetch({ url, timeout_ms: STEP_TIMEOUT_MS.smoke });
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.result?.blocked) return { ok: false, reason: 'The test page was blocked by the browser worker.' };
    if (!String(result.result?.text ?? '').trim()) return { ok: false, reason: 'The test page returned no readable content.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `The browser worker could not be checked: ${error instanceof Error ? error.message : String(error)}` };
  }
}
