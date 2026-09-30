/**
 * Frames for video_watch.
 *
 * The frame budget comes from the detail level and the length of what is watched, so
 * a short clip is covered densely and a long one stays affordable to look at. Frames
 * are chosen in three tiers: scene changes first (ffmpeg's scene score, with the
 * timestamps read back from showinfo), then keyframes, then even intervals, and the
 * first and last frames are always kept. Every candidate pass also has ffmpeg write a
 * 16 by 16 grayscale thumbnail per frame, and near identical neighbours are dropped
 * in Node by comparing those thumbnails: the mean pixel difference catches held
 * shots, and a difference hash catches the same shot under a small exposure change.
 * With a focus window the whole budget is spent inside it.
 *
 * The budgets are scaled to quick, standard and deep levels, the tiers fill a
 * budget together instead of replacing each other, and near duplicate frames are
 * dropped with a difference hash.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { run } from '../media/probe.mjs';

/** Never sample faster than this, whatever a budget implies. */
export const MAX_FPS = 2;

/** ffmpeg scene score above which a frame counts as a cut. */
export const SCENE_THRESHOLD = 0.2;

/** Longest edge of a frame handed to the agent, in pixels. */
export const FRAME_MAX_EDGE = 768;

/** Side of the grayscale thumbnail used to compare frames. */
export const THUMB_SIZE = 16;

/** Mean per pixel difference (0 to 255) at or below which two frames are the same shot. */
export const DEDUPE_MEAN = 2;

/** Above DEDUPE_MEAN but at or below this, frames are the same shot when their difference hashes agree. */
export const DEDUPE_MEAN_WITH_HASH = 8;

/** Most differing difference hash bits for two frames to still agree. */
export const DEDUPE_HASH_BITS = 6;

/** A neighbour must be this much brighter to set a difference hash bit, so flat areas do not flicker. */
const HASH_TOLERANCE = 2;

/**
 * Frame caps per detail level and the budget steps below the cap for short videos,
 * as [longest duration in seconds, frames].
 * @type {Record<'quick'|'standard'|'deep', {cap: number, steps: Array<[number, number]>}>}
 */
export const FRAME_BUDGETS = {
  quick: { cap: 8, steps: [[15, 4], [30, 6]] },
  standard: { cap: 24, steps: [[15, 12], [30, 16], [60, 20]] },
  deep: { cap: 60, steps: [[15, 24], [30, 36], [60, 48]] },
};

/**
 * @typedef {'quick'|'standard'|'deep'} Detail
 */

/**
 * How many frames to aim for. A whole video gets the step for its length; a focus
 * window gets the full cap, because the person is zooming in. Either way the count
 * never implies more than two frames a second, and the first and last always fit.
 * @param {Detail} detail
 * @param {number} spanS seconds being watched
 * @param {boolean} focused
 * @returns {number}
 */
export function frameBudget(detail, spanS, focused) {
  const budget = FRAME_BUDGETS[detail] ?? FRAME_BUDGETS.standard;
  if (!Number.isFinite(spanS) || spanS <= 0) return 1;
  const step = budget.steps.find(([limit]) => spanS <= limit);
  const base = focused || !step ? budget.cap : step[1];
  return Math.max(1, Math.min(base, Math.max(2, Math.floor(spanS * MAX_FPS))));
}

/**
 * Indices of n evenly spaced items out of count, first and last included.
 * @param {number} count
 * @param {number} n
 * @returns {number[]}
 */
export function evenIndices(count, n) {
  if (n >= count) return Array.from({ length: count }, (_, index) => index);
  if (n <= 0) return [];
  if (n === 1) return [0];
  return Array.from({ length: n }, (_, index) => Math.round((index * (count - 1)) / (n - 1)));
}

// ---------------------------------------------------------------------------
// Near duplicate detection, pure
// ---------------------------------------------------------------------------

/**
 * Mean absolute per pixel difference of two grayscale thumbnails, 0 to 255.
 * Thumbnails of different sizes are as different as frames get.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {number}
 */
export function meanDifference(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

/**
 * Difference hash of a square grayscale thumbnail: one bit per horizontal neighbour
 * pair, set when the left pixel is brighter than the right by more than a small
 * tolerance.
 * @param {Uint8Array} thumb
 * @param {number} [side]
 * @returns {Uint8Array} one entry per bit, 0 or 1
 */
export function differenceHash(thumb, side = THUMB_SIZE) {
  const bits = new Uint8Array(side * (side - 1));
  let bit = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side - 1; x += 1) {
      bits[bit] = thumb[y * side + x] > thumb[y * side + x + 1] + HASH_TOLERANCE ? 1 : 0;
      bit += 1;
    }
  }
  return bits;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {number}
 */
export function hammingDistance(a, b) {
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) distance += 1;
  return distance;
}

/**
 * Whether two frames show the same thing. Conservative on purpose: a slide gaining a
 * line or a caption changing survives; a held shot, a paused frame or a small
 * exposure drift does not. Missing thumbnails never collapse frames.
 * @param {Uint8Array|null|undefined} a
 * @param {Uint8Array|null|undefined} b
 * @returns {boolean}
 */
export function isNearDuplicate(a, b) {
  if (!a || !b || a.length !== THUMB_SIZE * THUMB_SIZE || b.length !== a.length) return false;
  const mean = meanDifference(a, b);
  if (mean <= DEDUPE_MEAN) return true;
  if (mean > DEDUPE_MEAN_WITH_HASH) return false;
  return hammingDistance(differenceHash(a), differenceHash(b)) <= DEDUPE_HASH_BITS;
}

// ---------------------------------------------------------------------------
// Selection, pure
// ---------------------------------------------------------------------------

/**
 * @typedef {'first'|'last'|'scene'|'keyframe'|'interval'} Tier
 */

/**
 * @typedef {object} Candidate
 * @property {number} t absolute seconds in the source
 * @property {Tier} tier
 * @property {string} [path]
 * @property {Uint8Array|null} [thumb]
 * @property {number|null} [score] scene score when the scene pass found it
 */

/** Lower wins when two candidates compete. */
const RANK = /** @type {Record<Tier, number>} */ ({ first: 0, last: 0, scene: 1, keyframe: 2, interval: 3 });

/**
 * @param {Candidate} candidate
 * @returns {boolean}
 */
function pinned(candidate) {
  return candidate.tier === 'first' || candidate.tier === 'last';
}

/**
 * Choose the frames to keep from every candidate the passes produced.
 *
 * 1. Spacing: a candidate closer than minGap to a better ranked one is the same
 *    moment and goes.
 * 2. Dedupe: walking in time order, a frame that looks like the last kept one goes;
 *    when the new one ranks higher it takes the old one's place. The first and last
 *    frames are never dropped.
 * 3. Budget: over the target, the first and last stay, then scene changes, then
 *    keyframes, then intervals, each tier thinned evenly when it does not fit whole.
 *
 * @template {Candidate} T
 * @param {T[]} candidates
 * @param {{target: number, minGap: number}} options
 * @returns {{kept: T[], afterDedupe: number}}
 */
export function selectFrames(candidates, options) {
  const byRank = [...candidates].sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.t - b.t);
  /** @type {T[]} */
  const spaced = [];
  for (const candidate of byRank) {
    if (pinned(candidate) || !spaced.some((other) => Math.abs(other.t - candidate.t) < options.minGap)) spaced.push(candidate);
  }
  spaced.sort((a, b) => a.t - b.t || (a.tier === 'first' ? -1 : b.tier === 'first' ? 1 : 0) || (a.tier === 'last' ? 1 : b.tier === 'last' ? -1 : 0));

  /** @type {T[]} */
  const deduped = [];
  for (const candidate of spaced) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !isNearDuplicate(previous.thumb, candidate.thumb)) {
      deduped.push(candidate);
    } else if (pinned(candidate)) {
      // The first or last frame stays; a plain neighbour it repeats makes way, a scene change does not.
      if (!pinned(previous) && previous.tier !== 'scene') deduped[deduped.length - 1] = candidate;
      else deduped.push(candidate);
    } else if (!pinned(previous) && RANK[candidate.tier] < RANK[previous.tier]) {
      deduped[deduped.length - 1] = candidate;
    }
  }

  const target = Math.max(1, options.target);
  if (deduped.length <= target) return { kept: deduped, afterDedupe: deduped.length };

  const chosen = deduped.filter(pinned).slice(0, target);
  let slots = target - chosen.length;
  for (const tier of /** @type {Tier[]} */ (['scene', 'keyframe', 'interval'])) {
    if (slots <= 0) break;
    const inTier = deduped.filter((candidate) => candidate.tier === tier);
    const picked = inTier.length <= slots ? inTier : evenIndices(inTier.length, slots).map((index) => inTier[index]);
    chosen.push(...picked);
    slots -= picked.length;
  }
  chosen.sort((a, b) => a.t - b.t || RANK[a.tier] - RANK[b.tier]);
  return { kept: chosen, afterDedupe: deduped.length };
}

// ---------------------------------------------------------------------------
// ffmpeg passes
// ---------------------------------------------------------------------------

/** Fits a frame inside FRAME_MAX_EDGE without upscaling. */
const SCALE_FILTER = `scale='min(${FRAME_MAX_EDGE},iw)':'min(${FRAME_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;

const SHOWINFO_RE = /Parsed_showinfo[^\]]*\]\s*n:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:(-?[0-9.]+)/g;
const SCENE_SCORE_RE = /lavfi\.scene_score=([0-9.]+)/g;

/**
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * One ffmpeg pass that writes candidate JPEGs, a grayscale thumbnail per candidate
 * and the timestamps, from one decode.
 * @param {{
 *   videoPath: string,
 *   workDir: string,
 *   prefix: string,
 *   tier: Tier,
 *   inputArgs: string[],
 *   filter: string,
 *   offsetS: number,
 *   maxFrames?: number,
 *   timeoutMs: number,
 * }} options
 * @returns {Promise<Candidate[]>}
 */
async function extractPass(options) {
  const pattern = join(options.workDir, `${options.prefix}_%04d.jpg`);
  const grayPath = join(options.workDir, `${options.prefix}.gray`);
  const limit = options.maxFrames ? ['-frames:v', String(options.maxFrames)] : [];
  const graph =
    `[0:v]${options.filter},showinfo,split=2[big][small];` +
    `[big]${SCALE_FILTER}[frames];[small]scale=${THUMB_SIZE}:${THUMB_SIZE}:flags=area,format=gray[thumbs]`;
  const { stderr } = await run(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-loglevel', 'info', '-y',
      ...options.inputArgs,
      '-i', options.videoPath,
      '-filter_complex', graph,
      '-map', '[frames]', '-fps_mode', 'vfr', ...limit, '-q:v', '3', pattern,
      '-map', '[thumbs]', '-fps_mode', 'vfr', ...limit, '-f', 'rawvideo', grayPath,
    ],
    { timeoutMs: options.timeoutMs },
  );

  const times = [...stderr.matchAll(SHOWINFO_RE)].map((match) => Number(match[2]));
  const scores = [...stderr.matchAll(SCENE_SCORE_RE)].map((match) => Number(match[1]));
  const files = readdirSync(options.workDir)
    .filter((name) => name.startsWith(`${options.prefix}_`) && name.endsWith('.jpg'))
    .sort();
  const gray = existsSync(grayPath) ? readFileSync(grayPath) : Buffer.alloc(0);
  const chunk = THUMB_SIZE * THUMB_SIZE;
  // A thumbnail stream that does not line up one to one is ignored rather than trusted.
  const thumbsUsable = gray.length === chunk * files.length;

  /** @type {Candidate[]} */
  const candidates = [];
  files.forEach((name, index) => {
    if (index >= times.length) return;
    candidates.push({
      t: round3(options.offsetS + Math.max(0, times[index])),
      tier: options.tier,
      path: join(options.workDir, name),
      thumb: thumbsUsable ? new Uint8Array(gray.subarray(index * chunk, (index + 1) * chunk)) : null,
      score: options.tier === 'scene' && index < scores.length ? round3(scores[index]) : null,
    });
  });
  return candidates;
}

/**
 * @typedef {object} WatchFrame
 * @property {string} path
 * @property {number} timestamp_s
 * @property {'scene_change'|'keyframe'|'interval'|'focus_window'|'first'|'last'} reason
 * @property {number|null} scene_score
 */

/**
 * @typedef {object} FrameResult
 * @property {WatchFrame[]} frames
 * @property {number} target
 * @property {number} extracted every candidate the passes wrote
 * @property {number} keptAfterDedupe candidates left after spacing and dedupe, before the budget
 * @property {Tier[]} tiers the passes that ran
 */

/**
 * Extract the frames for one watch into outDir, as frame-001.jpg and on, and remove
 * every candidate that was not chosen.
 * @param {{
 *   videoPath: string,
 *   outDir: string,
 *   detail: Detail,
 *   startS: number,
 *   endS: number,
 *   focused: boolean,
 * }} options
 * @returns {Promise<FrameResult>}
 */
export async function extractWatchFrames(options) {
  const span = Math.max(0, options.endS - options.startS);
  const target = frameBudget(options.detail, span, options.focused);
  const workDir = join(options.outDir, '.candidates');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const timeoutMs = 120_000 + Math.ceil(span * 2000);
  const minGap = Math.max(0.2, span / (target * 3));
  const windowArgs = options.startS > 0 || options.focused ? ['-ss', options.startS.toFixed(3), '-t', span.toFixed(3)] : [];
  const common = { videoPath: options.videoPath, workDir, offsetS: options.startS, timeoutMs };
  /** @type {Tier[]} */
  const tiers = [];

  try {
    const scene = await extractPass({
      ...common,
      prefix: 's',
      tier: 'scene',
      inputArgs: windowArgs,
      filter: `select='eq(n\\,0)+gt(scene\\,${SCENE_THRESHOLD})',metadata=mode=print:key=lavfi.scene_score`,
    });
    if (scene.length > 0 && scene[0].t - options.startS < minGap) scene[0].tier = 'first';
    tiers.push('scene');

    const last = await extractLast({ ...common, endS: options.endS, span });
    /** @type {Candidate[]} */
    let candidates = [...scene, ...last];
    let selection = selectFrames(candidates, { target, minGap });

    if (selection.kept.length < target) {
      const keyframes = await extractPass({ ...common, prefix: 'k', tier: 'keyframe', inputArgs: ['-skip_frame', 'nokey', ...windowArgs], filter: 'null' });
      tiers.push('keyframe');
      candidates = [...candidates, ...keyframes];
      selection = selectFrames(candidates, { target, minGap });
    }
    if (selection.kept.length < target && span > 0) {
      const rate = Math.min(MAX_FPS, target / span);
      const interval = await extractPass({ ...common, prefix: 'i', tier: 'interval', inputArgs: windowArgs, filter: `fps=${rate.toFixed(6)}`, maxFrames: target });
      tiers.push('interval');
      candidates = [...candidates, ...interval];
      selection = selectFrames(candidates, { target, minGap });
    }

    /** @type {WatchFrame[]} */
    const frames = [];
    selection.kept.forEach((candidate, index) => {
      if (!candidate.path) return;
      const path = join(options.outDir, `frame-${String(index + 1).padStart(3, '0')}.jpg`);
      renameSync(candidate.path, path);
      frames.push({
        path,
        timestamp_s: candidate.t,
        reason: reasonFor(candidate.tier, options.focused),
        scene_score: candidate.score ?? null,
      });
    });
    return { frames, target, extracted: candidates.length, keptAfterDedupe: selection.afterDedupe, tiers };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * @param {Tier} tier
 * @param {boolean} focused
 * @returns {WatchFrame['reason']}
 */
function reasonFor(tier, focused) {
  if (tier === 'scene') return 'scene_change';
  if (tier === 'interval') return focused ? 'focus_window' : 'interval';
  return tier;
}

/**
 * The last frame of the watched span. A decoder may return nothing at the very last
 * instant, so it steps back a little, and a bit further if that still fails.
 * @param {{videoPath: string, workDir: string, offsetS: number, timeoutMs: number, endS: number, span: number}} options
 * @returns {Promise<Candidate[]>}
 */
async function extractLast(options) {
  if (options.span <= 0.1) return [];
  for (const back of [0.25, 1]) {
    const at = Math.max(options.offsetS, options.endS - Math.min(back, options.span / 2));
    const found = await extractPass({
      videoPath: options.videoPath,
      workDir: options.workDir,
      prefix: `l${String(back).replace('.', '')}`,
      tier: 'last',
      inputArgs: ['-ss', at.toFixed(3)],
      filter: 'null',
      offsetS: at,
      maxFrames: 1,
      timeoutMs: options.timeoutMs,
    });
    if (found.length > 0) return found;
  }
  return [];
}
