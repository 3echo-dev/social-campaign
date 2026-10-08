/**
 * pipeline_video_teardown: watch a reference video and take it apart, so hook, framing, pacing and sound are
 * observed from frames and audio, never guessed from the caption.
 *
 * For one video (a pasted address, a reference already saved on the job, or a file on this computer):
 *   1. get the file: an address goes through referenceFromUrl (same SSRF guard, yt-dlp runner and layout as every
 *      other reference), so it lands in <job>/inputs/references/video/<id>/;
 *   2. ffprobe: duration, resolution, aspect ratio, audio track;
 *   3. ffmpeg scene detection (select='gt(scene,T)',showinfo) for the cuts, then one frame per shot and frames at
 *      0s, 0.5s, 1s, 2s and 3s (the hook);
 *   4. transcript: platform captions with yt-dlp (--write-subs --write-auto-subs) when the video came from an address;
 *      when there are none the audio is already saved as audio.wav and the result says transcription is needed;
 *   5. sound: the platform's music title where the metadata has it, the loudness, a tempo estimate from energy onsets,
 *      and how many cuts land on an onset (compared with how often an onset would be near by chance);
 *   6. <refdir>/teardown/teardown.json and <refdir>/teardown/frames/.
 *
 * Every process is started with spawn (argument arrays, no shell, a time limit), so the server is never blocked.
 * The measurements are plain heuristics and say so in the output: they are evidence to look at, not verdicts.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import { runYtDlp } from '../social/backends/ytdlp.mjs';
import { parseCaptions } from '../video/watch-transcript.mjs';
import { platformOf } from '../video/watch-source.mjs';
import { referenceFromUrl, referenceYtdlpBinary } from './url-reference.mjs';
import { readReferences, referencesDir } from './references.mjs';

export const SCENE_THRESHOLD = 0.3;
export const HOOK_TIMES_S = [0, 0.5, 1, 2, 3];
export const MAX_SHOT_FRAMES = 40;
export const MAX_ANALYSED_S = 600;
const MIN_SHOT_S = 0.25;
const FRAME_EDGE = 768;
const PCM_RATE = 8000;
const VIDEO_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/* ------------------------------------------------------------------ pure parsing and packaging */

/** Cut times in seconds from ffmpeg's showinfo lines (`pts_time:1.234`), ascending, with near duplicates merged. */
export function parseSceneTimes(stderr, { minGapS = MIN_SHOT_S } = {}) {
  const times = [];
  for (const match of String(stderr).matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)) times.push(Number(match[1]));
  times.sort((a, b) => a - b);
  const kept = [];
  for (const t of times) {
    if (t <= 0) continue;
    if (kept.length === 0 || t - kept[kept.length - 1] >= minGapS) kept.push(round(t, 3));
  }
  return kept;
}

/** Shots from cut times: [{ index, startS, endS, durationS }]. A cut within MIN_SHOT_S of the end is ignored. */
export function buildShots(cuts, durationS) {
  const bounds = [0, ...cuts.filter(t => t > 0 && t < durationS - MIN_SHOT_S), durationS];
  const shots = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    shots.push({ index: i + 1, startS: round(bounds[i], 3), endS: round(bounds[i + 1], 3), durationS: round(bounds[i + 1] - bounds[i], 3) });
  }
  return shots;
}

/** Cut count, shot count and shot lengths. Cut count is the number of edits between shots. */
export function pacingStats(shots) {
  if (shots.length === 0) return { shotCount: 0, cutCount: 0, averageShotS: null, medianShotS: null, shortestShotS: null, longestShotS: null, cutsPerMinute: null };
  const lengths = shots.map(s => s.durationS).sort((a, b) => a - b);
  const total = lengths.reduce((a, b) => a + b, 0);
  const mid = Math.floor(lengths.length / 2);
  const median = lengths.length % 2 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2;
  return {
    shotCount: shots.length,
    cutCount: shots.length - 1,
    averageShotS: round(total / shots.length),
    medianShotS: round(median),
    shortestShotS: round(lengths[0]),
    longestShotS: round(lengths[lengths.length - 1]),
    cutsPerMinute: total > 0 ? round(((shots.length - 1) / total) * 60, 1) : null,
  };
}

/** Hook frame times that fit inside the video. */
export function hookTimes(durationS) {
  return HOOK_TIMES_S.filter(t => t < durationS - 0.05);
}

/** Which shots get a frame when there are more than the cap: evenly spread, first and last kept. */
export function pickShotsForFrames(shots, max = MAX_SHOT_FRAMES) {
  if (shots.length <= max) return shots;
  const picked = [];
  for (let i = 0; i < max; i++) picked.push(shots[Math.round((i * (shots.length - 1)) / (max - 1))]);
  return [...new Map(picked.map(s => [s.index, s])).values()];
}

/** The time inside a shot to grab: just after the cut, clear of the transition, never past the middle. */
export function shotFrameTime(shot) {
  return round(shot.startS + Math.min(0.3, shot.durationS / 2), 3);
}

const aspectLabel = (w, h) => {
  if (!(w > 0 && h > 0)) return null;
  const ratio = w / h;
  const known = [['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]];
  const near = known.find(([, r]) => Math.abs(r - ratio) < 0.03);
  return near ? near[0] : `${round(ratio, 2)}:1`;
};

/** Facts from `ffprobe -print_format json -show_format -show_streams` output. */
export function summariseProbe(raw) {
  const streams = Array.isArray(raw?.streams) ? raw.streams : [];
  const video = streams.find(s => s.codec_type === 'video');
  const audio = streams.find(s => s.codec_type === 'audio');
  let width = Number(video?.width) || null;
  let height = Number(video?.height) || null;
  const rotation = Number(video?.tags?.rotate ?? video?.side_data_list?.find(x => x?.rotation !== undefined)?.rotation ?? 0) || 0;
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const [num, den] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const durationS = Number(raw?.format?.duration ?? video?.duration);
  return {
    durationS: Number.isFinite(durationS) && durationS > 0 ? round(durationS, 3) : null,
    width,
    height,
    aspect: aspectLabel(width, height),
    orientation: width && height ? (height > width ? 'vertical' : height < width ? 'horizontal' : 'square') : null,
    fps: den ? round(num / den, 2) : null,
    hasAudio: Boolean(audio),
  };
}

/** Music or sound title from yt-dlp's info.json: track, artist, album, and whether it is the poster's own sound. */
export function musicFromInfo(info) {
  if (!info || typeof info !== 'object') return { source: 'not_in_metadata', track: null, artist: null, album: null, originalSound: null };
  const track = [info.track, info.music?.title, info.music_title].find(v => typeof v === 'string' && v.trim()) ?? null;
  const artistList = Array.isArray(info.artists) ? info.artists.filter(a => typeof a === 'string') : [];
  const artist = [info.artist, artistList.join(', '), info.music?.author, info.music_author].find(v => typeof v === 'string' && v.trim()) ?? null;
  const album = typeof info.album === 'string' && info.album.trim() ? info.album.trim() : null;
  if (!track && !artist) return { source: 'not_in_metadata', track: null, artist: null, album, originalSound: null };
  const original = /original (sound|audio)|son original|sonido original|som original|origineel geluid|originalton/i.test(`${track ?? ''} ${album ?? ''}`);
  return { source: 'platform_metadata', track: track?.trim() ?? null, artist: artist?.trim() ?? null, album, originalSound: original };
}

/** Silent stretches from ffmpeg silencedetect stderr. */
export function parseSilence(stderr) {
  const out = [];
  let open = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[0-9.]+)/.exec(line);
    if (s) open = Number(s[1]);
    const e = /silence_end:\s*([0-9.]+)/.exec(line);
    if (e && open !== null) {
      out.push({ startS: round(Math.max(0, open), 3), endS: round(Number(e[1]), 3) });
      open = null;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ audio heuristics on raw samples */

/** Short-time level in dB per hop. `samples` is anything indexable with values in -32768..32767. */
export function levelEnvelope(samples, rate = PCM_RATE, hopS = 0.01) {
  const hop = Math.max(1, Math.round(rate * hopS));
  const env = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += (samples[j] / 32768) ** 2;
    env.push(10 * Math.log10(sum / hop + 1e-10));
  }
  return { hopS: hop / rate, db: env };
}

/** Onset times: rises in the level envelope that clear a local threshold. */
export function detectOnsets(envelope, { minSpacingS = 0.1, sensitivity = 1.0 } = {}) {
  const { hopS, db } = envelope;
  const flux = db.map((v, i) => (i === 0 ? 0 : Math.max(0, v - db[i - 1])));
  const smooth = flux.map((_, i) => (flux[i] + (flux[i + 1] ?? 0) + (flux[i + 2] ?? 0)) / 3);
  const win = Math.round(0.5 / hopS);
  const onsets = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    const lo = Math.max(0, i - win);
    const hi = Math.min(smooth.length, i + win);
    let mean = 0;
    for (let j = lo; j < hi; j++) mean += smooth[j];
    mean /= hi - lo;
    let variance = 0;
    for (let j = lo; j < hi; j++) variance += (smooth[j] - mean) ** 2;
    const sd = Math.sqrt(variance / (hi - lo));
    const peak = smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1];
    if (peak && smooth[i] > mean + sensitivity * sd && smooth[i] > 3) {
      const t = round(i * hopS, 3);
      if (onsets.length === 0 || t - onsets[onsets.length - 1] >= minSpacingS) onsets.push(t);
    }
  }
  return onsets;
}

/** Beats per minute from onset spacing, 60..200 bpm; confidence 0..1 is how much of the onsets sit on that grid. */
export function estimateTempo(onsets, { minBpm = 60, maxBpm = 200 } = {}) {
  if (onsets.length < 6) return { bpm: null, confidence: 0 };
  let best = { bpm: null, score: 0 };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 1) {
    const period = 60 / bpm;
    let sx = 0;
    let sy = 0;
    for (const t of onsets) {
      const angle = (2 * Math.PI * t) / period;
      sx += Math.cos(angle);
      sy += Math.sin(angle);
    }
    const score = Math.hypot(sx, sy) / onsets.length;
    if (score > best.score) best = { bpm, score };
  }
  return { bpm: best.bpm, confidence: round(best.score) };
}

/** Do the cuts land on audio onsets? Compared with how often a random time would be that close to an onset. */
export function cutsOnBeat(cuts, onsets, durationS, toleranceS = 0.08) {
  if (cuts.length === 0 || onsets.length === 0) return { cuts: cuts.length, onOnset: 0, share: null, chanceShare: null, toleranceS, verdict: 'not_observed' };
  const near = t => onsets.some(o => Math.abs(o - t) <= toleranceS);
  const on = cuts.filter(near).length;
  const step = 0.01;
  let hit = 0;
  let total = 0;
  for (let t = 0; t < durationS; t += step, total++) if (near(t)) hit++;
  const share = on / cuts.length;
  const chance = total ? hit / total : 0;
  let verdict = 'no_clear_sync';
  if (cuts.length < 4) verdict = 'too_few_cuts_to_say';
  else if (share >= 0.5 && share >= chance + 0.25) verdict = 'cuts_follow_audio_onsets';
  return { cuts: cuts.length, onOnset: on, share: round(share), chanceShare: round(chance), toleranceS, verdict };
}

/** Average level (dB, full scale) over stretches of the envelope. */
function meanDb(envelope, windows) {
  let sum = 0;
  let n = 0;
  for (const [a, b] of windows) {
    for (let i = Math.floor(a / envelope.hopS); i < Math.min(envelope.db.length, Math.ceil(b / envelope.hopS)); i++) {
      sum += 10 ** (envelope.db[i] / 10);
      n++;
    }
  }
  return n ? round(10 * Math.log10(sum / n), 1) : null;
}

/**
 * Sound summary from the envelope and the transcript. Voice and music cannot be separated without a model, so the
 * levels compare the stretches where the captions say someone speaks with the stretches where nobody does.
 */
export function summariseSound({ envelope, onsets, segments, cuts, durationS }) {
  const overallDb = meanDb(envelope, [[0, durationS]]);
  const speech = (segments ?? []).filter(s => s.end_s > s.start_s).map(s => [s.start_s, s.end_s]);
  const gaps = [];
  let cursor = 0;
  for (const [a, b] of [...speech].sort((x, y) => x[0] - y[0])) {
    if (a - cursor > 0.4) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (durationS - cursor > 0.4) gaps.push([cursor, durationS]);
  const speechDb = speech.length ? meanDb(envelope, speech) : null;
  const gapDb = speech.length ? meanDb(envelope, gaps) : null;
  const tempo = estimateTempo(onsets);
  const density = durationS > 0 ? onsets.length / durationS : 0;
  const silent = overallDb !== null && overallDb < -55;
  const energy = silent ? 'silent' : overallDb > -16 && density > 3 ? 'high' : overallDb < -30 || density < 1 ? 'low' : 'medium';
  return {
    loudnessDbfs: overallDb,
    energy,
    onsetsPerSecond: round(density),
    tempo,
    tempoFeel: tempo.bpm === null || tempo.confidence < 0.3 ? 'no steady beat found' : tempo.bpm < 90 ? 'slow' : tempo.bpm < 125 ? 'mid tempo' : 'fast',
    cutsOnBeat: cutsOnBeat(cuts, onsets, durationS),
    levels: speech.length
      ? { speechDb, nonSpeechDb: gapDb, note: 'Level while the captions say someone speaks versus the gaps between lines; the gap level is mostly music or sound effects. Voice and music are not separated.' }
      : { speechDb: null, nonSpeechDb: null, note: 'Not observed: there is no timed transcript, so voice and background levels cannot be compared.' },
    method: 'Heuristic from an 8 kHz mono level envelope: onsets are rises above a local threshold, tempo is the best-fitting beat grid. It cannot tell music from speech or name a song.',
  };
}

/** Raw 16 bit little endian mono samples. */
export function pcmToSamples(buffer) {
  const copy = Buffer.from(buffer);
  return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 2));
}

/* ------------------------------------------------------------------ processes */

/** Run a binary with an argument array. Never rejects. */
export function runProcess(command, args, { timeoutMs = 60_000, maxStdout = 64 * 1024 * 1024, maxStderr = 8 * 1024 * 1024 } = {}) {
  return new Promise(resolvePromise => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolvePromise({ ok: false, code: null, missing: true, stdout: Buffer.alloc(0), stderr: String(error.message) });
      return;
    }
    const out = [];
    let outBytes = 0;
    let err = '';
    let missing = false;
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => { outBytes += chunk.length; if (outBytes <= maxStdout) out.push(chunk); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (err.length < maxStderr) err += chunk; });
    const finish = code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise({ ok: code === 0 && !timedOut, code, missing, timedOut, stdout: Buffer.concat(out), stderr: err });
    };
    child.on('error', error => { if (error.code === 'ENOENT') missing = true; else err += `\n${error.message}`; finish(null); });
    child.on('close', finish);
  });
}

async function inPool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i], i); }
  }));
  return results;
}

const stamp = t => t.toFixed(2).padStart(5, '0');

async function grabFrame(ffmpeg, video, t, file) {
  const run = await runProcess(ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `scale='min(${FRAME_EDGE},iw)':-2`, '-q:v', '3', file], { timeoutMs: 30_000 });
  return run.ok && existsSync(file);
}

/* ------------------------------------------------------------------ captions */

async function fetchCaptions({ url, dir, binary, cookies }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const args = [
    '--ignore-config', '--no-update', '--no-progress', '--no-playlist', '--socket-timeout', '20',
    ...(cookies ? ['--cookies-from-browser', cookies] : ['--no-cookies', '--no-cookies-from-browser']),
    '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,en,-live_chat', '--sub-format', 'vtt/srt/best',
    ...(platformOf(url) === 'tiktok' ? ['--impersonate', 'chrome'] : []),
    '-o', join(dir, 'captions.%(ext)s'), '--', url,
  ];
  const run = await runYtDlp(args, { binary: referenceYtdlpBinary(binary), timeoutMs: 60_000 });
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /\.(vtt|srt)$/i.test(f)) : [];
  return { run, files };
}

/* ------------------------------------------------------------------ the teardown */

function resolveFromManifest(jobDir, referenceId) {
  const entry = readReferences(jobDir).find(e => e.id === referenceId && e.type === 'video');
  if (!entry) return null;
  const file = join(referencesDir(jobDir), entry.path);
  return existsSync(file) ? { entry, file, dir: join(referencesDir(jobDir), 'video', entry.id) } : null;
}

function localDirFor(jobDir, file) {
  const st = statSync(file);
  const id = `local-${createHash('sha256').update(`${resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12)}`;
  return { id, dir: join(referencesDir(jobDir), 'video', id) };
}

function relativeTo(base, file) {
  return file.startsWith(base) ? file.slice(base.length + 1).replace(/\\/g, '/') : file;
}

/**
 * @param {{jobDir: string, url?: string, referenceId?: string, path?: string, note?: string, cookiesFromBrowser?: string,
 *   force?: boolean, ffmpeg?: string, ffprobe?: string, ytdlpBinary?: string, assertHost?: Function, now?: () => Date,
 *   sceneThreshold?: number}} options
 */
export async function videoTeardown(options) {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? 'ffprobe';
  const threshold = options.sceneThreshold ?? SCENE_THRESHOLD;
  const now = options.now ?? (() => new Date());

  // 1. the file
  let id;
  let dir;
  let file;
  let entry = null;
  let sourceUrl = null;
  if (options.url) {
    const got = await referenceFromUrl({ jobDir: options.jobDir, url: options.url, note: options.note, cookiesFromBrowser: options.cookiesFromBrowser, binary: options.ytdlpBinary, assertHost: options.assertHost, now });
    if (!got.ok) return got;
    entry = got.entry;
    id = entry.id;
    dir = join(referencesDir(options.jobDir), 'video', id);
    file = join(referencesDir(options.jobDir), entry.path);
    sourceUrl = entry.sourceUrl;
  } else if (options.referenceId) {
    const found = resolveFromManifest(options.jobDir, options.referenceId);
    if (!found) return { ok: false, status: 'reference_not_found', message: 'No saved video reference with that id is on this job. List them with pipeline_references_list or pass url.', next: ['Call pipeline_references_list, or pass the video address as url.'] };
    ({ entry, file, dir } = found);
    id = entry.id;
    sourceUrl = entry.sourceUrl ?? null;
  } else if (options.path) {
    const source = resolve(String(options.path));
    if (!existsSync(source) || !statSync(source).isFile() || !VIDEO_EXT.includes(extname(source).toLowerCase())) {
      return { ok: false, status: 'invalid_file', message: 'That path is not a video file (mp4, mkv, webm, mov or m4v) on this computer.', next: ['Ask the person for the saved file path, or an address.'] };
    }
    ({ id, dir } = localDirFor(options.jobDir, source));
    mkdirSync(dir, { recursive: true });
    file = join(dir, `video${extname(source).toLowerCase()}`);
    if (!existsSync(file)) copyFileSync(source, file);
  } else {
    return { ok: false, status: 'invalid_url', message: 'Pass url, referenceId or path.', next: [] };
  }

  const out = join(dir, 'teardown');
  const jsonPath = join(out, 'teardown.json');
  if (!options.force && existsSync(jsonPath)) {
    try {
      const cached = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (cached.video?.bytes === statSync(file).size) return { ok: true, status: 'already_done', ...packageResult(cached) };
    } catch { /* redo it */ }
  }

  // 2. facts
  const probeRun = await runProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30_000 });
  if (probeRun.missing) return { ok: false, status: 'ffmpeg_missing', message: 'ffmpeg and ffprobe are not installed on this computer, so a video cannot be taken apart.', next: ['Ask the person to install ffmpeg, or use the Chrome fallback to look at the video.'] };
  let probe = null;
  try { probe = summariseProbe(JSON.parse(probeRun.stdout.toString('utf8'))); } catch { probe = null; }
  if (!probe?.durationS || !probe.width) return { ok: false, status: 'unreadable_video', message: 'The file could not be read as a video.', next: ['Ask the person to upload the file again.'] };
  const durationS = probe.durationS;
  const analysedS = Math.min(durationS, MAX_ANALYSED_S);

  rmSync(out, { recursive: true, force: true });
  const framesDir = join(out, 'frames');
  mkdirSync(framesDir, { recursive: true });

  // 3. cuts, audio and captions run side by side
  const sceneJob = runProcess(ffmpeg, ['-v', 'info', '-t', String(analysedS), '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 120_000 });
  const audioFile = join(out, 'audio.wav');
  const audioJob = probe.hasAudio
    ? runProcess(ffmpeg, ['-v', 'error', '-y', '-t', String(analysedS), '-i', file, '-vn', '-ac', '1', '-ar', '16000', audioFile, '-vn', '-ac', '1', '-ar', String(PCM_RATE), '-f', 's16le', 'pipe:1'], { timeoutMs: 120_000 })
    : Promise.resolve(null);
  const captionJob = sourceUrl
    ? fetchCaptions({ url: sourceUrl, dir: join(out, 'captions'), binary: options.ytdlpBinary, cookies: options.cookiesFromBrowser ? String(options.cookiesFromBrowser).toLowerCase() : null })
    : Promise.resolve(null);
  const [sceneRun, audioRun, captionRes] = await Promise.all([sceneJob, audioJob, captionJob]);

  const cuts = sceneRun.ok ? parseSceneTimes(sceneRun.stderr) : [];
  const shots = buildShots(cuts, analysedS);
  const pacing = pacingStats(shots);

  // 4. frames
  const hook = hookTimes(durationS).map(t => ({ kind: 'hook', timeS: t, file: join(framesDir, `hook-${stamp(t)}s.jpg`) }));
  const chosen = pickShotsForFrames(shots);
  const shotFrames = chosen.map(s => ({ kind: 'shot', shot: s.index, timeS: shotFrameTime(s), file: join(framesDir, `shot-${String(s.index).padStart(2, '0')}-${stamp(shotFrameTime(s))}s.jpg`) }));
  const wanted = [...hook, ...shotFrames];
  const okFlags = await inPool(wanted, 4, f => grabFrame(ffmpeg, file, f.timeS, f.file));
  const frames = wanted.filter((_, i) => okFlags[i]).map(f => ({ ...f, rel: `teardown/frames/${basename(f.file)}` }));

  // 5. transcript
  const transcript = { status: 'none', source: null, segments: [], text: '', note: '' };
  if (captionRes && captionRes.files.length) {
    const pick = captionRes.files.find(f => /\.en[.-]/i.test(f) && !/auto/i.test(f)) ?? captionRes.files[0];
    try {
      const segments = parseCaptions(readFileSync(join(out, 'captions', pick), 'utf8'));
      if (segments.length) Object.assign(transcript, { status: 'platform_captions', source: pick, segments, text: segments.map(s => s.text).join(' '), note: 'Platform captions; auto captions can misspell names and miss lyrics.' });
    } catch { /* leave as none */ }
  }
  if (transcript.status === 'none') {
    transcript.note = !probe.hasAudio
      ? 'The video has no audio track.'
      : captionRes
        ? 'The platform has no captions for this video. The audio is saved as audio.wav: run it through a connected speech to text tool (media_transcribe, or creative_transcribe_audio when ElevenLabs is connected) before quoting what is said. Until then the spoken words are "not observed".'
        : 'No captions were fetched for a local file. The audio is saved as audio.wav: use a connected speech to text tool before quoting what is said. Until then the spoken words are "not observed".';
  }
  transcript.needsTranscription = transcript.status === 'none' && probe.hasAudio;

  // 6. sound
  let info = null;
  try { info = JSON.parse(readFileSync(join(dir, 'info.json'), 'utf8')); } catch { /* local file or no metadata */ }
  let sound = { hasAudio: probe.hasAudio, music: musicFromInfo(info) };
  if (probe.hasAudio && audioRun?.ok && audioRun.stdout.length > PCM_RATE) {
    const samples = pcmToSamples(audioRun.stdout);
    const envelope = levelEnvelope(samples, PCM_RATE);
    const onsets = detectOnsets(envelope);
    sound = { ...sound, ...summariseSound({ envelope, onsets, segments: transcript.segments, cuts, durationS: Math.min(analysedS, samples.length / PCM_RATE) }), audioFile: 'teardown/audio.wav' };
  } else if (probe.hasAudio) {
    sound.note = 'Audio could not be analysed; sound is not observed.';
  }

  const teardown = {
    schemaVersion: 1,
    id,
    sourceUrl,
    title: entry?.title ?? null,
    author: entry?.author ?? null,
    platformCaption: entry?.caption ?? null,
    createdAt: now().toISOString(),
    video: { file: relativeTo(dir, file), bytes: statSync(file).size, ...probe, analysedS: round(analysedS, 3) },
    cuts: { method: `ffmpeg select='gt(scene,${threshold})' with showinfo`, threshold, times: cuts, note: 'Hard cuts and big visual jumps. Soft dissolves, zooms and on-screen animation can be missed or over-counted; check against the frames.' },
    shots,
    pacing,
    frames: frames.map(f => ({ kind: f.kind, shot: f.shot ?? null, timeS: f.timeS, file: f.rel })),
    framesNote: shots.length > MAX_SHOT_FRAMES ? `More than ${MAX_SHOT_FRAMES} shots; frames cover an even spread of them.` : null,
    transcript,
    sound,
    folder: dir,
  };
  writeFileSync(`${jsonPath}.tmp`, `${JSON.stringify(teardown, null, 2)}\n`, 'utf8');
  renameSync(`${jsonPath}.tmp`, jsonPath);
  return { ok: true, status: 'done', ...packageResult(teardown) };
}

/** What the agent gets back: the teardown with absolute paths to Read, and how to use it. */
export function packageResult(teardown) {
  const folder = teardown.folder;
  const abs = rel => join(folder, rel);
  return {
    id: teardown.id,
    folder,
    teardownJson: abs('teardown/teardown.json'),
    framesFolder: abs('teardown/frames'),
    audioFile: teardown.sound?.audioFile ? abs(teardown.sound.audioFile) : null,
    videoFile: abs(teardown.video.file),
    summary: {
      durationS: teardown.video.durationS,
      resolution: `${teardown.video.width}x${teardown.video.height}`,
      aspect: teardown.video.aspect,
      cutCount: teardown.pacing.cutCount,
      averageShotS: teardown.pacing.averageShotS,
      transcript: teardown.transcript.status,
      needsTranscription: teardown.transcript.needsTranscription,
      music: teardown.sound?.music ?? null,
      cutsOnBeat: teardown.sound?.cutsOnBeat?.verdict ?? 'not_observed',
    },
    shots: teardown.shots,
    frames: teardown.frames.map(f => ({ ...f, path: abs(f.file) })),
    transcript: { status: teardown.transcript.status, note: teardown.transcript.note, segments: teardown.transcript.segments.slice(0, 60) },
    sound: teardown.sound,
    hint: 'Read every hook frame and every shot frame with the Read tool, in order, before writing the breakdown. Frames name their time. Anything the frames, audio numbers or transcript do not show is "not observed".',
  };
}
