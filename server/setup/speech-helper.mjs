/**
 * The optional local speech to text of the research helper: faster-whisper and the speech model it runs.
 *
 * Videos without captions are transcribed on the person's own computer (CPU, int8 weights; python/local_whisper.py runs
 * it). That needs the faster-whisper package in the helper's environment and one speech model on disk. Both are big and
 * both are somebody else's software, so they go in only after the person said yes to them (the same one yes that covers
 * the rest of the helper; see research-helper.mjs), and the model is downloaded once, in the background, with a progress
 * figure the status can show.
 *
 * Sizes, measured: the "small" model is 464 MiB (about 480 MB) on disk. The packages (faster-whisper, CTranslate2,
 * onnxruntime, PyAV, tokenizers, NumPy, huggingface_hub) add roughly 150 MB beside the helper's other packages.
 *
 * The model is stored in Hugging Face's own cache (`~/.cache/huggingface/hub`, or HF_HUB_CACHE / HF_HOME when set), the
 * place every tool that uses these models looks, so a model that is already on the computer is found and never fetched
 * twice. Nothing here installs a package; research-helper.mjs does that and calls `fetchSpeechModel` afterwards.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package, with a floor and a ceiling so an install today and one next month behave alike. */
export const FASTER_WHISPER_REQUIREMENT = 'faster-whisper>=1.1.0,<2';

/** The multilingual model, fetched once; it also reads English, so the English only model is never fetched on its own. */
export const SPEECH_MODEL = 'small';

/** The models the worker may ask for (python/local_whisper.py is given the name, never a path). */
export const SPEECH_MODELS = Object.freeze(['small', 'small.en']);

/** About how big the model download is, in bytes, for a progress figure. */
export const SPEECH_MODEL_BYTES = 484_000_000;

/** What the person is told it costs. */
export const SPEECH_SIZE_WORDS = Object.freeze({ packages: 'about 150 MB of Python packages', model: 'a speech model of about 480 MB' });

/** The worker, shipped beside the other Python scripts. */
export const SPEECH_SCRIPT = fileURLToPath(new URL('../../python/local_whisper.py', import.meta.url));

/** Longest the model download is given. */
export const SPEECH_MODEL_TIMEOUT_MS = 40 * 60_000;

/**
 * Hugging Face's hub cache folder, the same one huggingface_hub resolves.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function huggingfaceHubCache(env = process.env) {
  const direct = env.HF_HUB_CACHE?.trim();
  if (direct) return direct;
  const home = env.HF_HOME?.trim();
  if (home) return join(home, 'hub');
  const xdg = env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(homedir(), '.cache'), 'huggingface', 'hub');
}

/**
 * @param {string} model small or small.en.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} the model's folder in the cache.
 */
export function speechModelFolder(model, env = process.env) {
  return join(huggingfaceHubCache(env), `models--Systran--faster-whisper-${model}`);
}

/**
 * Whether the model is fully on disk: a snapshot that holds its weights.
 * @param {string} model
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function speechModelPresent(model, env = process.env) {
  try {
    const snapshots = join(speechModelFolder(model, env), 'snapshots');
    return readdirSync(snapshots).some((entry) => existsSync(join(snapshots, entry, 'model.bin')));
  } catch {
    return false;
  }
}

/**
 * Bytes of the model on disk so far, including a download that has not finished.
 * @param {string} model
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function speechModelBytes(model, env = process.env) {
  try {
    const blobs = join(speechModelFolder(model, env), 'blobs');
    let total = 0;
    for (const entry of readdirSync(blobs)) total += statSync(join(blobs, entry)).size;
    return total;
  } catch {
    return 0;
  }
}

/**
 * Download the model once. Resolves when the worker has finished; never rejects. While it runs, `onProgress` is called
 * about every `pollMs` with the share of the model on disk (never 100 until the worker says it is done).
 * @param {object} options
 * @param {string[]} options.python the environment's Python, as a command array.
 * @param {string} [options.model]
 * @param {NodeJS.ProcessEnv} [options.env] the child's environment.
 * @param {(command: string[], args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv, input?: string) => Promise<{ok: boolean, stdout: string, stderr: string, timedOut?: boolean}>} options.runner
 * @param {string} [options.script] overrides python/local_whisper.py, for tests.
 * @param {(progress: {percent: number, bytes: number}) => void} [options.onProgress]
 * @param {number} [options.pollMs]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok: true, model: string}|{ok: false, model: string, reason: string}>}
 */
export async function fetchSpeechModel(options) {
  const model = SPEECH_MODELS.includes(String(options.model)) ? String(options.model) : SPEECH_MODEL;
  const env = { ...process.env, ...(options.env ?? {}), HF_HUB_DISABLE_PROGRESS_BARS: '1', HF_HUB_DISABLE_TELEMETRY: '1' };
  if (speechModelPresent(model, env)) return { ok: true, model };
  const poll = options.onProgress
    ? setInterval(() => {
        const bytes = speechModelBytes(model, env);
        options.onProgress?.({ bytes, percent: Math.min(99, Math.floor((bytes / SPEECH_MODEL_BYTES) * 100)) });
      }, options.pollMs ?? 2_000)
    : null;
  poll?.unref?.();
  try {
    const out = await options.runner(
      options.python,
      [options.script ?? SPEECH_SCRIPT],
      options.timeoutMs ?? SPEECH_MODEL_TIMEOUT_MS,
      env,
      JSON.stringify({ fetch_model: model }),
    );
    let answer = null;
    try {
      answer = JSON.parse(String(out.stdout).trim());
    } catch {
      answer = null;
    }
    if (out.timedOut) return { ok: false, model, reason: 'The speech model download did not finish in time. It carries on from where it stopped the next time.' };
    if (answer?.status === 'ok' && speechModelPresent(model, env)) {
      options.onProgress?.({ bytes: speechModelBytes(model, env), percent: 100 });
      return { ok: true, model };
    }
    if (answer?.status === 'not_installed') return { ok: false, model, reason: 'The speech package is not installed in the research helper.' };
    return { ok: false, model, reason: typeof answer?.detail === 'string' && answer.detail ? answer.detail : 'The speech model could not be downloaded. Check the internet connection and try again.' };
  } finally {
    if (poll) clearInterval(poll);
  }
}
