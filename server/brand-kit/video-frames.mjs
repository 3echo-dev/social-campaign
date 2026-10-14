/**
 * Frames of a brand's own top videos, for the colours and the typeface the brand's videos show.
 *
 * Onboarding research takes the brand's best videos apart (pipeline_video_teardown) and keeps their frames in the run's folder:
 *   workspaces/<brand>/onboarding/<runId>/inputs/references/video/<id>/teardown/{teardown.json,frames/}
 * The run also takes competitors' and viral videos apart in the same folder, and their colours are not this brand's, so a video counts
 * only when the research named it as one of the brand's own posts (the topPosts of the draft or of a part file, source "brand") or its
 * address is on one of the brand's own accounts. Nothing is downloaded and no path comes from outside the brand's folder.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeRgba, dominantColours } from './palette.mjs';
import { parseHandle } from '../social/records.mjs';

export const MAX_OWN_VIDEOS = 5;
export const MAX_PALETTE_FRAMES = 12;
export const MAX_READ_FRAMES = 6;
const RUN_FOLDER = /^run-\d{8}T\d{6}Z-[a-f0-9]{6}$/;

/** A post address reduced to what makes it the same post: host and path, no www, no query, no trailing slash. */
function urlKey(value) {
  try {
    const url = new URL(String(value));
    return `${url.hostname.replace(/^www\./i, '')}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** The addresses of the brand's own posts that a run's draft and part files name. */
function ownPostKeys(runDir) {
  const files = [join(runDir, 'research-draft.json'), join(runDir, 'research-draft.merged.json')];
  const partsDir = join(runDir, 'parts');
  try {
    for (const name of readdirSync(partsDir)) if (name.endsWith('.json')) files.push(join(partsDir, name));
  } catch { /* no parts */ }
  const keys = new Set();
  for (const file of files) {
    const doc = readJson(file);
    for (const post of Array.isArray(doc?.topPosts) ? doc.topPosts : []) {
      if (post && post.source === 'brand' && typeof post.url === 'string') keys.add(urlKey(post.url));
    }
  }
  keys.delete('');
  return keys;
}

/** Whether a video address is on one of the brand's own accounts (a TikTok or YouTube video under the brand's @handle). The video's author, when the teardown kept one, is matched the same way. */
function onOwnAccount(url, ownHandles) {
  try {
    const parsed = new URL(url);
    const first = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return first.startsWith('@') && ownHandles.has(first.slice(1).toLowerCase());
  } catch {
    return false;
  }
}

/** @param {Record<string, string|null|undefined>} social */
function handlesOf(social) {
  const handles = new Set();
  for (const platform of ['tiktok', 'instagram', 'youtube']) {
    const target = typeof social?.[platform] === 'string' && social[platform] ? parseHandle(/** @type {any} */ (platform), social[platform]) : null;
    if (target) handles.add(target.handle.toLowerCase());
  }
  return handles;
}

/** The frames of one video to look at: the hook around one second, then the middle shot and a sample, with the hook first. */
function pickFrames(frames) {
  const hook = frames.filter((frame) => frame.kind === 'hook');
  const shots = frames.filter((frame) => frame.kind === 'shot' || frame.kind === 'sample');
  const first = hook.find((frame) => frame.timeS === 1) ?? hook.find((frame) => frame.timeS === 0.5) ?? hook[0] ?? shots[0];
  const middle = shots.length ? shots[Math.floor(shots.length / 2)] : null;
  const last = shots.length > 2 ? shots[shots.length - 1] : null;
  return [first, middle, last].filter((frame, index, all) => frame && all.indexOf(frame) === index);
}

/**
 * The frames of the brand's own top videos from the newest research run that took some apart.
 * @param {{brandDir: string, social?: Record<string, string|null|undefined>}} input
 * @returns {{videos: number, frames: string[], runId: string|null}} frames are absolute paths, at most MAX_PALETTE_FRAMES.
 */
export function findOwnVideoFrames({ brandDir, social = {} }) {
  const onboarding = join(brandDir, 'onboarding');
  let runs = [];
  try {
    runs = readdirSync(onboarding, { withFileTypes: true }).filter((entry) => entry.isDirectory() && RUN_FOLDER.test(entry.name)).map((entry) => entry.name).sort().reverse();
  } catch { /* no research run yet */ }
  const ownHandles = handlesOf(social);
  for (const runId of runs) {
    const runDir = join(onboarding, runId);
    const videosDir = join(runDir, 'inputs', 'references', 'video');
    let ids = [];
    try { ids = readdirSync(videosDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); } catch { continue; }
    const ownKeys = ownPostKeys(runDir);
    const found = [];
    for (const id of ids) {
      const dir = join(videosDir, id);
      const teardown = readJson(join(dir, 'teardown', 'teardown.json'));
      if (!teardown || !Array.isArray(teardown.frames) || typeof teardown.sourceUrl !== 'string') continue;
      const author = typeof teardown.author === 'string' ? teardown.author.replace(/^@/, '').trim().toLowerCase() : '';
      if (!ownKeys.has(urlKey(teardown.sourceUrl)) && !onOwnAccount(teardown.sourceUrl, ownHandles) && !(author && ownHandles.has(author))) continue;
      const frames = pickFrames(teardown.frames.filter((frame) => frame && typeof frame.file === 'string' && /\.(jpe?g|png)$/i.test(frame.file)))
        .map((frame) => join(dir, frame.file))
        .filter((file) => existsSync(file));
      if (frames.length) found.push(frames);
      if (found.length >= MAX_OWN_VIDEOS) break;
    }
    // The opening frame of every video comes first, so the first few frames are one from each video.
    if (found.length) return { videos: found.length, frames: [...found.map((frames) => frames[0]), ...found.flatMap((frames) => frames.slice(1))].slice(0, MAX_PALETTE_FRAMES), runId };
  }
  return { videos: 0, frames: [], runId: null };
}

/**
 * The main colours of some frame files, skipping near white, near black and greys.
 * @param {string[]} files
 * @param {{decode?: typeof decodeRgba, read?: (file: string) => Buffer}} [deps]
 * @returns {Promise<{colours: Array<{hex: string, share: number}>, decoderMissing: boolean, read: number}>}
 */
export async function coloursFromFrames(files, { decode = decodeRgba, read = (file) => readFileSync(file) } = {}) {
  const sets = [];
  let decoderMissing = false;
  for (const file of files) {
    let bytes;
    try { bytes = read(file); } catch { continue; }
    const decoded = await decode(bytes);
    if (decoded.ok) sets.push(decoded.pixels);
    else if (decoded.code === 'decoder_missing') { decoderMissing = true; break; }
  }
  return { colours: sets.length ? dominantColours(sets) : [], decoderMissing, read: sets.length };
}

/** The frames to show the model so it can read the typeface of the on-screen text: the hook frame of each video first, at most MAX_READ_FRAMES. */
export function framesToRead(frames) {
  return frames.slice(0, MAX_READ_FRAMES);
}
