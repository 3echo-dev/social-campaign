/**
 * Local speech to text for media_transcribe: faster-whisper on the CPU, run by python/local_whisper.py.
 *
 * It is the free fallback for a video that has no captions and no saved transcript: when no speech to text
 * provider is connected (the plugin has none of its own; ElevenLabs is a separate, paid connector), a faster-whisper
 * that already imports in this computer's Python is used. Measured live on 2026-10-13: the cached "small" model
 * transcribed 11 seconds of Japanese TikTok speech in 7 seconds on a laptop CPU.
 *
 * Nothing is installed here. The research helper installs faster-whisper into its own environment, and fetches the
 * model once in the background, after the person said yes to local speech to text (server/setup/research-helper.mjs,
 * speech-helper.mjs). The Python is found, in this order, among: a path named by SOCIAL_CAMPAIGN_WHISPER_PYTHON
 * (development and tests; under the test runner it is the only one tried), the research helper's own environment, and
 * the system Python; the first one that can `import faster_whisper` is used. The model is "small" (or "small.en" when
 * the speech is English and that model is on the computer; the multilingual "small" reads English too), CPU, int8
 * weights. A model that is not already on the computer is never downloaded here: the answer says which model is
 * missing, and the caller starts the background download only for a person who agreed to it.
 *
 * Every outcome is a plain object, never a throw: `{ok: true, ...}` or `{ok: false, status, message}` with a status
 * of not_installed, model_missing, too_long, timed_out, no_speech or failed, and a message for a person.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pythonChildEnv } from '../lib/python-env.mjs';
import { managedEnvironmentRoot, managedPythonPath } from '../setup/research-helper-record.mjs';
import { speechModelPresent } from '../setup/speech-helper.mjs';
import { killTree } from '../social/backends/ytdlp.mjs';

/** The Python worker. */
export const WHISPER_SCRIPT = fileURLToPath(new URL('../../python/local_whisper.py', import.meta.url));

/** The longest recording the local reader takes on (it runs on the CPU, at a fraction of real time). */
export const WHISPER_MAX_AUDIO_S = 15 * 60;

/** How long importing faster-whisper may take when looking for a Python that has it. */
export const WHISPER_PROBE_TIMEOUT_MS = 30_000;

/** How long a "found" and a "not found" answer are remembered, so a run of calls probes once. */
const FOUND_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 2 * 60_000;

/** Most worker output read. A 15 minute talk with word timings is well under this. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export const LOCAL_WHISPER_MISSING =
  'Local speech to text is not set up on this computer. The research helper can add it, free (about 150 MB of packages and a speech model of about 480 MB, installed in the background once you say yes). Or put faster-whisper in your own Python (pip install faster-whisper); Social Campaign does not install it there for you. Without it, a video with no captions is read from its frames only.';

/**
 * The model to use: the English only one for English speech, the multilingual one otherwise.
 * @param {string|null|undefined} language a BCP 47 tag such as en or en-US.
 * @returns {'small.en'|'small'}
 */
export function whisperModelFor(language) {
  return /^en([-_]|$)/i.test(String(language ?? '').trim()) ? 'small.en' : 'small';
}

/**
 * @typedef {{command: string, args: string[], source: 'configured'|'research_helper'|'system'}} PythonCandidate
 */

/**
 * The Pythons that may have faster-whisper, best first.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {PythonCandidate[]}
 */
export function whisperPythonCandidates(options = {}) {
  const env = options.env ?? process.env;
  /** @type {PythonCandidate[]} */
  const list = [];
  const configured = env.SOCIAL_CAMPAIGN_WHISPER_PYTHON?.trim();
  if (configured) list.push({ command: configured, args: [], source: 'configured' });
  // Under the test runner only a Python a test names is used, so a faster-whisper on the machine that runs the tests
  // never turns an offline test into a real transcription (SOCIAL_CAMPAIGN_ALLOW_HOST_WHISPER=1 opts back in).
  const underTestRunner = Boolean(env.NODE_TEST_CONTEXT || process.argv.includes('--test') || process.execArgv.includes('--test'));
  if (underTestRunner && !env.SOCIAL_CAMPAIGN_ALLOW_HOST_WHISPER) return list;
  try {
    const helper = managedPythonPath(managedEnvironmentRoot());
    if (existsSync(helper)) list.push({ command: helper, args: [], source: 'research_helper' });
  } catch {
    // No plugin data folder to look in: the system Python is still tried.
  }
  const system = process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const [command, ...args] of system) list.push({ command, args, source: 'system' });
  return list;
}

/**
 * Run a program, feed it stdin, collect stdout, stop its whole tree at the deadline. Never rejects.
 * @param {string} command
 * @param {string[]} args
 * @param {{input?: string, timeoutMs: number, env?: NodeJS.ProcessEnv}} options
 * @returns {Promise<{stdout: string, exitCode: number|null, timedOut: boolean, spawnFailed: boolean}>}
 */
function runCollect(command, args, options) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let settled = false;
    let timedOut = false;
    /** @type {import('node:child_process').ChildProcess|undefined} */
    let child;
    const finish = (/** @type {Partial<{exitCode: number|null, spawnFailed: boolean}>} */ patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, exitCode: null, timedOut, spawnFailed: false, ...patch });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child) killTree(child);
      finish({});
    }, options.timeoutMs);
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32', env: pythonChildEnv(options.env) });
    } catch {
      finish({ spawnFailed: true });
      return;
    }
    child.on('error', () => finish({ spawnFailed: true }));
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        if (child) killTree(child);
        finish({});
      }
    });
    child.on('close', (code) => finish({ exitCode: code }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input ?? '');
  });
}

/** @type {Map<string, {at: number, value: (PythonCandidate & {version: string})|null}>} */
const probeCache = new Map();

/** Forget which Python was found (tests, and after an install). */
export function resetLocalWhisperCache() {
  probeCache.clear();
}

/**
 * The first Python that can import faster-whisper, or null.
 * @param {{candidates?: PythonCandidate[], env?: NodeJS.ProcessEnv, now?: () => number}} [options]
 * @returns {Promise<(PythonCandidate & {version: string})|null>}
 */
export async function findLocalWhisper(options = {}) {
  const candidates = options.candidates ?? whisperPythonCandidates({ env: options.env });
  const now = options.now ?? (() => Date.now());
  const key = JSON.stringify(candidates.map((c) => [c.command, c.args]));
  const cached = probeCache.get(key);
  if (cached && now() - cached.at < (cached.value ? FOUND_TTL_MS : MISSING_TTL_MS)) return cached.value;
  /** @type {(PythonCandidate & {version: string})|null} */
  let found = null;
  for (const candidate of candidates) {
    const out = await runCollect(candidate.command, [...candidate.args, '-c', 'import faster_whisper;print("SCWH|"+getattr(faster_whisper,"__version__","unknown"))'], {
      timeoutMs: WHISPER_PROBE_TIMEOUT_MS,
      env: options.env,
    });
    const line = out.stdout.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.startsWith('SCWH|'));
    if (out.exitCode === 0 && line) {
      found = { ...candidate, version: line.slice(5) };
      break;
    }
  }
  probeCache.set(key, { at: now(), value: found });
  return found;
}

/**
 * Whether a local speech to text can be used on this computer right now.
 * @param {Parameters<typeof findLocalWhisper>[0]} [options]
 * @returns {Promise<boolean>}
 */
export async function localWhisperAvailable(options = {}) {
  return (await findLocalWhisper(options)) !== null;
}

/**
 * The one line that fetches a model into this Python's cache.
 * @param {PythonCandidate} python
 * @param {string} model
 * @returns {string}
 */
function fetchModelCommand(python, model) {
  return `${[python.command, ...python.args].join(' ')} -c "from faster_whisper import WhisperModel; WhisperModel('${model}')"`;
}

/**
 * Transcribe a media file with the local faster-whisper.
 * @param {{
 *   path: string,
 *   language?: string|null,
 *   durationS?: number|null,
 *   timeoutMs?: number,
 *   allowDownload?: boolean,
 *   candidates?: PythonCandidate[],
 *   script?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 * @returns {Promise<
 *   {ok: true, model: string, language: string|null, durationS: number|null, segments: Array<Record<string, any>>, words: Array<Record<string, any>>, python: PythonCandidate['source']}
 *   | {ok: false, status: 'not_installed'|'model_missing'|'too_long'|'timed_out'|'no_speech'|'failed', message: string, model?: string}
 * >}
 */
export async function transcribeLocally(options) {
  const durationS = typeof options.durationS === 'number' && options.durationS > 0 ? options.durationS : null;
  if (durationS !== null && durationS > WHISPER_MAX_AUDIO_S) {
    return { ok: false, status: 'too_long', message: `The local speech to text takes recordings up to ${WHISPER_MAX_AUDIO_S / 60} minutes; this one is ${Math.round(durationS / 60)} minutes long.` };
  }
  const found = await findLocalWhisper({ candidates: options.candidates, env: options.env });
  if (!found) return { ok: false, status: 'not_installed', message: LOCAL_WHISPER_MISSING };
  // English speech prefers the English only model; when only the multilingual one is on the computer it reads English too,
  // so the second download is never needed.
  let model = whisperModelFor(options.language);
  if (found.source !== 'configured' && model === 'small.en' && !speechModelPresent('small.en', options.env) && speechModelPresent('small', options.env)) model = 'small';
  // The CPU reads at several times real time; two times the recording and a minute is room for a slow laptop.
  const timeoutMs = options.timeoutMs ?? Math.min(25 * 60_000, 60_000 + (durationS ?? 120) * 2_000);
  const out = await runCollect(found.command, [...found.args, options.script ?? WHISPER_SCRIPT], {
    input: JSON.stringify({ path: options.path, model, language: options.language ? String(options.language).split(/[-_]/)[0].toLowerCase() : null, allow_download: Boolean(options.allowDownload) }),
    timeoutMs,
    env: options.env,
  });
  if (out.spawnFailed) return { ok: false, status: 'not_installed', message: LOCAL_WHISPER_MISSING };
  if (out.timedOut) return { ok: false, status: 'timed_out', message: `The local speech to text did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`, model };
  let result = null;
  try {
    result = JSON.parse(out.stdout.trim());
  } catch {
    result = null;
  }
  if (!result || typeof result !== 'object') return { ok: false, status: 'failed', message: 'The local speech to text answered with something unreadable.', model };
  const detail = typeof result.detail === 'string' ? result.detail : '';
  switch (result.status) {
    case 'ok':
      return {
        ok: true,
        model: String(result.model ?? model),
        language: typeof result.language === 'string' ? result.language : null,
        durationS: typeof result.duration_s === 'number' ? result.duration_s : durationS,
        segments: Array.isArray(result.segments) ? result.segments : [],
        words: Array.isArray(result.words) ? result.words : [],
        python: found.source,
      };
    case 'no_speech':
      return { ok: false, status: 'no_speech', message: detail || 'No speech was found in that audio.', model };
    case 'model_missing':
      return {
        ok: false,
        status: 'model_missing',
        model,
        message: found.source === 'research_helper'
          ? `Local speech to text is installed, but its "${model}" speech model (about 480 MB) is not downloaded yet.`
          : `faster-whisper is installed, but its "${model}" model is not downloaded on this computer, and Social Campaign does not download it for you. Fetching it once (about 480 MB) is: ${fetchModelCommand(found, model)}`,
      };
    case 'not_installed':
      return { ok: false, status: 'not_installed', message: LOCAL_WHISPER_MISSING, model };
    default:
      return { ok: false, status: 'failed', message: detail || 'The local speech to text failed.', model };
  }
}
