/**
 * Edit decision lists: check one against the contract and against the footage, snap
 * its cuts to word boundaries with padding, and hand back the list a render can
 * trust.
 *
 * The production correctness rules: never cut inside a word, pad every cut edge
 * inside a 30 to 200 millisecond working window because transcript timestamps
 * drift, and fade the sound at every cut. Everything else an edit might want is
 * the agent's call; this module only refuses what would render wrong or not at
 * all, and warns about what a person would want to know.
 *
 * The EDL is the Social Campaign EditDecisionList contract, sources must be
 * library assets, and the snapping is done here rather than left to an editor
 * sub-agent.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { PLATFORM_PRESETS } from '../generation/edit.mjs';
import { readTranscript, spokenWords } from './transcripts.mjs';
import { formatSeconds } from './pack.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

/** Padding before the first kept word. */
export const DEFAULT_PAD_BEFORE_S = 0.05;

/** Padding after the last kept word. */
export const DEFAULT_PAD_AFTER_S = 0.08;

/** The working window for padding. */
export const PAD_WINDOW_S = [0.03, 0.2];

/** How far a cut edge in a quiet gap may be moved to reach the nearest word. */
export const SNAP_WINDOW_S = 0.25;

/** Audio fade at every cut. */
export const DEFAULT_FADE_MS = 30;

/** How far past the end of a source a clip may run and still be clamped rather than refused. */
export const END_TOLERANCE_S = 0.05;

/** Shortest clip worth rendering. */
export const MIN_CLIP_S = 0.1;

/** The fields an EditDecisionList may have. */
const TOP_LEVEL_FIELDS = new Set(['schema_version', 'id', 'campaign_id', 'sources', 'clips', 'audio', 'overlays', 'subtitles', 'output', 'summary']);

/** Output sizes by aspect ratio when the list does not give one. */
export const ASPECT_SIZES = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
};

/**
 * The aspect ratio label for a width and height, or null when it is none of ours.
 * @param {number} width
 * @param {number} height
 * @returns {string|null}
 */
export function aspectLabel(width, height) {
  for (const [label, size] of Object.entries(ASPECT_SIZES)) {
    if (Math.abs(width / height - size.width / size.height) < 0.01) return label;
  }
  return null;
}

/**
 * @typedef {object} ResolvedSource
 * @property {string} id
 * @property {string} asset_id
 * @property {string} path
 * @property {string} filename
 * @property {number} duration
 * @property {number|null} width
 * @property {number|null} height
 * @property {number|null} fps
 * @property {boolean} has_audio
 * @property {string|null} sha256
 * @property {import('./transcripts.mjs').Transcript|null} transcript
 */

/**
 * @typedef {object} Adjustment
 * @property {string} clip_id
 * @property {number} in_before
 * @property {number} out_before
 * @property {number} in_s
 * @property {number} out_s
 * @property {string} note
 */

/**
 * @param {number} value
 * @returns {number}
 */
function ms(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Look a media reference up in the library: by asset id, or by the path it was
 * registered under.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{asset_id?: unknown, path?: unknown}} reference
 * @returns {{row: any|null, problem: string|null}}
 */
export function findLibraryAsset(db, reference) {
  const assetId = optionalString(reference.asset_id);
  const path = optionalString(reference.path);
  if (assetId) {
    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
    if (!row) return { row: null, problem: `there is no asset ${assetId} in the creative library` };
    if (path && resolve(path) !== resolve(String(row.path))) {
      return { row: null, problem: `asset ${assetId} is ${row.path}, not ${path}` };
    }
    return { row, problem: null };
  }
  if (path) {
    const row = db.prepare('SELECT * FROM assets WHERE path = ?').get(resolve(path));
    if (!row) return { row: null, problem: `${path} is not in the creative library; register it with asset_register first` };
    return { row, problem: null };
  }
  return { row: null, problem: 'it names no asset_id' };
}

/**
 * Resolve every source of a list to its library asset, file facts and transcript.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} workspaceRoot
 * @param {any[]} sources
 * @returns {{sources: Map<string, ResolvedSource>, problems: string[], warnings: string[]}}
 */
export function resolveSources(db, workspaceRoot, sources) {
  /** @type {Map<string, ResolvedSource>} */
  const resolved = new Map();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const id = String(source?.id ?? '');
    if (resolved.has(id)) {
      problems.push(`Source id ${id} is used twice; give each source its own id.`);
      continue;
    }
    const { row, problem } = findLibraryAsset(db, source ?? {});
    if (!row) {
      problems.push(`Source ${id} cannot be used: ${problem}.`);
      continue;
    }
    const path = String(row.path);
    if (!existsSync(path)) {
      problems.push(`Source ${id} (${path}) is missing from disk.`);
      continue;
    }
    if (String(row.kind) !== 'video') {
      problems.push(`Source ${id} is ${row.kind === 'image' ? 'an image' : `a ${row.kind} file`}, not a video clip.`);
      continue;
    }
    const duration = Number(row.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      problems.push(`Source ${id} has no readable length; probe it with media_probe to see what is wrong with the file.`);
      continue;
    }
    const transcript = readTranscript(db, workspaceRoot, { id: String(row.id), sha256: row.sha256 ? String(row.sha256) : null });
    const wanted = optionalString(source?.transcript_id);
    if (wanted && transcript && transcript.transcript_id !== wanted) {
      warnings.push(`Source ${id} names transcript ${wanted}, but the saved transcript is ${transcript.transcript_id}; the saved one is used.`);
    }
    resolved.set(id, {
      id,
      asset_id: String(row.id),
      path,
      filename: path.split(/[\\/]/).pop() ?? path,
      duration,
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      fps: row.fps == null ? null : Number(row.fps),
      has_audio: Number(row.audio_tracks ?? 0) > 0,
      sha256: row.sha256 ? String(row.sha256) : null,
      transcript,
    });
  }
  return { sources: resolved, problems, warnings };
}

/**
 * Snap and pad one clip against its source's words. Pure.
 *
 * An edge inside a word moves to that word's edge, so the word is kept whole. An
 * edge in a quiet gap moves to the nearest word within SNAP_WINDOW_S; farther than
 * that it is taken as a deliberate lead in or tail and left alone. Padding then
 * moves a snapped edge out into the gap, never into a neighbouring word. Running
 * the result through again changes nothing.
 *
 * @param {{in_s: number, out_s: number}} clip
 * @param {import('./transcripts.mjs').Word[]} words spoken words in time order
 * @param {{padBefore: number, padAfter: number, duration: number}} options
 * @returns {{in_s: number, out_s: number, notes: string[]}}
 */
export function snapClip(clip, words, options) {
  /** @type {string[]} */
  const notes = [];
  let inS = clip.in_s;
  let outS = clip.out_s;
  let padIn = true;
  let padOut = true;

  const inside = words.find((word) => word.start_s < inS && inS < word.end_s);
  if (inside) {
    inS = inside.start_s;
    notes.push(`start moved back to the start of "${inside.text}"`);
  } else {
    const next = words.find((word) => word.start_s >= inS);
    if (next && next.start_s - inS <= SNAP_WINDOW_S) {
      if (next.start_s !== inS) notes.push(`start moved to "${next.text}"`);
      inS = next.start_s;
    } else padIn = false;
  }
  const insideOut = words.find((word) => word.start_s < outS && outS < word.end_s);
  if (insideOut) {
    outS = insideOut.end_s;
    notes.push(`end moved on to the end of "${insideOut.text}"`);
  } else {
    const previous = [...words].reverse().find((word) => word.end_s <= outS);
    if (previous && outS - previous.end_s <= SNAP_WINDOW_S) {
      if (previous.end_s !== outS) notes.push(`end moved to "${previous.text}"`);
      outS = previous.end_s;
    } else padOut = false;
  }

  if (padIn) {
    const before = [...words].reverse().find((word) => word.end_s <= inS);
    inS = Math.max(before ? before.end_s : 0, inS - options.padBefore);
  }
  if (padOut) {
    const after = words.find((word) => word.start_s >= outS);
    outS = Math.min(after ? after.start_s : options.duration, outS + options.padAfter);
  }
  return { in_s: ms(Math.max(0, inS)), out_s: ms(Math.min(options.duration, outS)), notes };
}

/**
 * A stable hash of what a render depends on, so a list saved again unchanged keeps
 * its attempt count.
 * @param {any} edl
 * @returns {string}
 */
export function edlHash(edl) {
  const essential = {
    sources: (edl.sources ?? []).map((source) => [source.id, source.asset_id ?? null, source.path ?? null]),
    clips: (edl.clips ?? []).map((clip) => [clip.source_id, clip.in_s, clip.out_s, clip.audio_fade_ms ?? null]),
    audio: edl.audio ?? null,
    overlays: edl.overlays ?? [],
    subtitles: edl.subtitles ?? null,
    output: edl.output ?? null,
  };
  return createHash('sha256').update(JSON.stringify(essential)).digest('hex');
}

/**
 * The target length the campaign planned for, from its newest VideoScript.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {number|null}
 */
function targetDuration(db, campaignId) {
  const script = /** @type {any} */ (currentArtifact(db, campaignId, 'VideoScript')?.json ?? null);
  const target = Number(script?.target_duration_s);
  return Number.isFinite(target) && target > 0 ? target : null;
}

/**
 * The words a clip keeps, clipped to it.
 * @param {ResolvedSource} source
 * @param {number} inS
 * @param {number} outS
 * @returns {import('./transcripts.mjs').Word[]}
 */
export function wordsInClip(source, inS, outS) {
  return spokenWords(source.transcript).filter((word) => word.start_s < outS && word.end_s > inS);
}

/**
 * @typedef {object} EdlCheck
 * @property {boolean} ok
 * @property {string[]} problems
 * @property {string[]} warnings
 * @property {Adjustment[]} adjustments
 * @property {any} edl the list with snapped, padded and clamped cuts
 * @property {number} duration_s
 * @property {Map<string, ResolvedSource>} sources
 */

/**
 * Check an edit decision list and resolve its cuts.
 * @param {{db: import('node:sqlite').DatabaseSync, workspaceRoot: string, campaignId: string, edl: any}} options
 * @returns {EdlCheck}
 */
export function checkEdl({ db, workspaceRoot, campaignId, edl }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Adjustment[]} */
  const adjustments = [];
  // The campaign is already named by the call, so a list may leave it out.
  const input = edl && typeof edl === 'object' && !Array.isArray(edl) ? { ...edl, campaign_id: edl.campaign_id ?? campaignId } : {};

  for (const problem of validateAgainstSchema(loadSchema('EditDecisionList'), input)) problems.push(`The list is not complete: ${problem}`);
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.has(key)) problems.push(`"${key}" is not part of an edit decision list; remove it.`);
  }
  if (input.campaign_id !== undefined && input.campaign_id !== campaignId) {
    problems.push(`The list says campaign ${input.campaign_id}, but it is being saved to ${campaignId}.`);
  }
  if (problems.length > 0) return { ok: false, problems, warnings, adjustments, edl: input, duration_s: 0, sources: new Map() };

  const resolvedSources = resolveSources(db, workspaceRoot, input.sources);
  problems.push(...resolvedSources.problems);
  warnings.push(...resolvedSources.warnings);
  const sources = resolvedSources.sources;

  /** @type {any[]} */
  const clips = [];
  const clipIds = new Set();
  for (const [index, raw] of input.clips.entries()) {
    const clip = { ...raw };
    const label = `Clip ${clip.id}`;
    if (clipIds.has(clip.id)) problems.push(`Clip id ${clip.id} is used twice; give each clip its own id.`);
    clipIds.add(clip.id);
    const source = sources.get(String(clip.source_id));
    if (!source) {
      if (!input.sources.some((entry) => entry.id === clip.source_id)) problems.push(`${label} uses source ${clip.source_id}, which the list does not have.`);
      continue;
    }
    if (!(clip.out_s > clip.in_s)) {
      problems.push(`${label} ends (${clip.out_s} s) before it starts (${clip.in_s} s).`);
      continue;
    }
    if (clip.in_s >= source.duration) {
      problems.push(`${label} starts at ${clip.in_s} s, but ${source.id} (${source.filename}) is only ${formatSeconds(source.duration)} s long.`);
      continue;
    }
    if (clip.out_s > source.duration + END_TOLERANCE_S) {
      problems.push(`${label} ends at ${clip.out_s} s, but ${source.id} (${source.filename}) is only ${formatSeconds(source.duration)} s long.`);
      continue;
    }
    for (const key of ['pad_before_s', 'pad_after_s']) {
      const value = clip[key];
      if (typeof value === 'number' && (value < PAD_WINDOW_S[0] || value > PAD_WINDOW_S[1])) {
        warnings.push(`${label} ${key} is ${value} s; cut padding usually sits between 0.03 and 0.2 seconds.`);
      }
    }

    const words = spokenWords(source.transcript);
    const snap = clip.snap_to_words === false ? false : words.length > 0;
    if (clip.snap_to_words === true && words.length === 0) {
      warnings.push(`${label} asks to snap to words, but ${source.id} has no word timings saved; its cuts are used as given.`);
    }
    const before = { in_s: clip.in_s, out_s: clip.out_s };
    /** @type {string[]} */
    let notes = [];
    if (snap) {
      const padBefore = typeof clip.pad_before_s === 'number' ? clip.pad_before_s : DEFAULT_PAD_BEFORE_S;
      const padAfter = typeof clip.pad_after_s === 'number' ? clip.pad_after_s : DEFAULT_PAD_AFTER_S;
      const snapped = snapClip(clip, words, { padBefore, padAfter, duration: source.duration });
      clip.in_s = snapped.in_s;
      clip.out_s = snapped.out_s;
      clip.pad_before_s = padBefore;
      clip.pad_after_s = padAfter;
      notes = snapped.notes;
    } else {
      const padBefore = typeof clip.pad_before_s === 'number' ? clip.pad_before_s : 0;
      const padAfter = typeof clip.pad_after_s === 'number' ? clip.pad_after_s : 0;
      clip.in_s = ms(Math.max(0, clip.in_s - padBefore));
      clip.out_s = ms(Math.min(source.duration, clip.out_s + padAfter));
      if (padBefore || padAfter) notes.push('padding applied');
      // The times are now final, so saving the result again does not pad twice.
      clip.pad_before_s = 0;
      clip.pad_after_s = 0;
      for (const edge of [clip.in_s, clip.out_s]) {
        const cut = words.find((word) => word.start_s < edge && edge < word.end_s);
        if (cut) warnings.push(`${label} cuts through the word "${cut.text}" at ${formatSeconds(edge)} s, which will sound clipped.`);
      }
    }
    if (clip.out_s > source.duration) clip.out_s = ms(source.duration);
    if (before.out_s > source.duration) notes.push(`end clamped to the end of ${source.id}`);
    clip.snap_to_words = snap;
    clip.audio_fade_ms = Number.isInteger(clip.audio_fade_ms) ? clip.audio_fade_ms : DEFAULT_FADE_MS;
    if (clip.out_s - clip.in_s < MIN_CLIP_S) {
      problems.push(`${label} is ${formatSeconds(clip.out_s - clip.in_s)} s long after snapping, too short to render; widen it.`);
      continue;
    }
    if (clip.in_s !== before.in_s || clip.out_s !== before.out_s) {
      adjustments.push({ clip_id: String(clip.id), in_before: before.in_s, out_before: before.out_s, in_s: clip.in_s, out_s: clip.out_s, note: notes.join('; ') || 'adjusted' });
    }
    clips.push({ clip, before, index });
  }

  // Overlaps: the same source stretch used twice is refused unless the later clip says it is meant.
  for (let a = 0; a < clips.length; a += 1) {
    for (let b = a + 1; b < clips.length; b += 1) {
      const first = clips[a];
      const second = clips[b];
      if (first.clip.source_id !== second.clip.source_id) continue;
      const overlaps = first.before.in_s < second.before.out_s && second.before.in_s < first.before.out_s;
      if (!overlaps) continue;
      const where = `${first.clip.source_id} ${formatSeconds(Math.max(first.before.in_s, second.before.in_s))}-${formatSeconds(Math.min(first.before.out_s, second.before.out_s))} s`;
      if (second.clip.allow_overlap === true) {
        warnings.push(`Clips ${first.clip.id} and ${second.clip.id} both use ${where}; kept because ${second.clip.id} allows it.`);
      } else {
        problems.push(`Clips ${first.clip.id} and ${second.clip.id} both use ${where}, so those words would play twice. Tighten one, or set allow_overlap on ${second.clip.id} if the repeat is meant.`);
      }
    }
  }
  // Padding may make neighbours from one source overlap a little in the gap between them; meet in the middle.
  for (let index = 1; index < clips.length; index += 1) {
    const first = clips[index - 1].clip;
    const second = clips[index].clip;
    const wasApart = clips[index - 1].before.out_s <= clips[index].before.in_s;
    if (first.source_id === second.source_id && wasApart && first.out_s > second.in_s) {
      const middle = ms((first.out_s + second.in_s) / 2);
      first.out_s = middle;
      second.in_s = middle;
    }
  }

  const resolvedClips = clips.map((entry) => entry.clip);
  const duration = ms(resolvedClips.reduce((sum, clip) => sum + (clip.out_s - clip.in_s), 0));

  // Output shape.
  const output = { ...input.output };
  const hasWidth = output.width != null;
  const hasHeight = output.height != null;
  if (hasWidth !== hasHeight) problems.push('Give the output width and height together, or neither.');
  if (hasWidth && hasHeight) {
    if (output.width < 16 || output.height < 16 || output.width % 2 || output.height % 2) {
      problems.push('The output width and height must be even numbers of at least 16 pixels.');
    } else if (aspectLabel(output.width, output.height) !== output.aspect_ratio) {
      problems.push(`An output of ${output.width}x${output.height} is not ${output.aspect_ratio}.`);
    }
  }
  if (output.fps != null && !(output.fps > 0 && output.fps <= 120)) problems.push('The output frame rate must be between 1 and 120.');
  const platformFits = Object.entries(PLATFORM_PRESETS).filter(([, preset]) => aspectLabel(preset.width, preset.height) === output.aspect_ratio);
  if (platformFits.length === 0) {
    warnings.push(`No platform preset is ${output.aspect_ratio}, so this edit can only be rendered as master.`);
  }

  // Overlays.
  for (const [index, overlay] of (input.overlays ?? []).entries()) {
    const label = `Overlay ${index + 1}`;
    if (!(overlay.end_s > overlay.start_s)) problems.push(`${label} ends before it starts.`);
    if (overlay.start_s >= duration) problems.push(`${label} starts at ${overlay.start_s} s, after the edit ends at ${formatSeconds(duration)} s.`);
    else if (overlay.end_s > duration + END_TOLERANCE_S) warnings.push(`${label} runs past the end of the edit and is cut at ${formatSeconds(duration)} s.`);
    if (overlay.kind === 'text' && !optionalString(overlay.text)) problems.push(`${label} is a text overlay with no text.`);
    if (overlay.kind === 'image') {
      const { row, problem } = findLibraryAsset(db, { asset_id: overlay.asset_id });
      if (!row) problems.push(`${label} cannot be used: ${problem}.`);
      else if (String(row.kind) !== 'image') problems.push(`${label} must be an image, and asset ${row.id} is ${row.kind}.`);
      else if (!existsSync(String(row.path))) problems.push(`${label} image ${row.path} is missing from disk.`);
    }
  }

  // Audio.
  const audio = input.audio ?? {};
  for (const key of ['voiceover', 'music']) {
    const track = audio[key];
    if (!track || (!track.asset_id && !track.path)) continue;
    const { row, problem } = findLibraryAsset(db, track);
    if (!row) problems.push(`The ${key} cannot be used: ${problem}.`);
    else if (!['audio', 'video'].includes(String(row.kind))) problems.push(`The ${key} must be a sound file, and asset ${row.id} is ${row.kind}.`);
    else if (Number(row.audio_tracks ?? 1) === 0) problems.push(`The ${key} file has no sound in it.`);
    else if (!existsSync(String(row.path))) problems.push(`The ${key} file ${row.path} is missing from disk.`);
  }
  const keepSource = audio.keep_source_audio !== false;
  const anySourceSound = resolvedClips.some((clip) => sources.get(String(clip.source_id))?.has_audio);
  if (!(keepSource && anySourceSound) && !audio.voiceover?.asset_id && !audio.voiceover?.path && !audio.music?.asset_id && !audio.music?.path) {
    warnings.push('This edit has no sound at all.');
  }

  // Subtitles.
  const subtitles = input.subtitles ?? null;
  if (subtitles && subtitles.mode && subtitles.mode !== 'none') {
    if (subtitles.source === 'script') {
      problems.push('Subtitles from the script have no timings for this cut. Use source "transcript", or build them with subtitles_build after the render.');
    } else {
      const used = [...new Set(resolvedClips.map((clip) => String(clip.source_id)))];
      const without = used.filter((id) => !sources.get(id)?.transcript);
      if (used.length > 0 && without.length === used.length) {
        problems.push('Subtitles need a saved transcript, and none of the sources in this edit has one. Transcribe them first.');
      } else if (without.length > 0) {
        warnings.push(`${without.join(', ')} ${without.length === 1 ? 'has' : 'have'} no saved transcript, so those clips will have no subtitles.`);
      }
      const segmentOnly = used.filter((id) => sources.get(id)?.transcript && spokenWords(sources.get(id)?.transcript ?? null).length === 0);
      if (segmentOnly.length > 0) warnings.push(`${segmentOnly.join(', ')} only ${segmentOnly.length === 1 ? 'has' : 'have'} segment timings, so subtitles there are timed by sentence rather than by word.`);
    }
  }

  // Length against the plan.
  const target = targetDuration(db, campaignId);
  if (target && Math.abs(duration - target) > Math.max(1, target * 0.1)) {
    warnings.push(`The edit runs ${formatSeconds(duration)} s against a planned ${formatSeconds(target)} s.`);
  }

  const resolvedEdl = {
    ...input,
    campaign_id: campaignId,
    clips: resolvedClips,
    output,
    overlays: input.overlays ?? [],
  };
  return { ok: problems.length === 0, problems, warnings, adjustments, edl: resolvedEdl, duration_s: duration, sources };
}
