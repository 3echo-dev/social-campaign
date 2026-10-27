/**
 * Watching a video: the VideoEvidencePackage, media_transcribe and transcript_save.
 *
 * watchVideo resolves the source, downloads an address with its captions, reads the
 * media facts, picks the frames, attaches the transcript and writes one package that
 * holds only what was seen and heard, never an interpretation of it.
 *
 * Transcription is captions first: a transcript already saved for the same media,
 * then platform captions. No paid speech to text service is connected (see
 * docs/CONTRACTS.md, "Video watch tools"), so video_watch on a video without captions
 * degrades to frames only: it comes back with its frames, transcript status
 * needs_transcription_provider and an honest note that the spoken words are missing.
 * media_transcribe goes one step further for free: when a faster-whisper that already
 * imports in this computer's Python is there, it transcribes the audio locally
 * (local-whisper.mjs) and stores the result like any other transcript, source
 * local_whisper. A person can still supply a transcript through transcript_save, and
 * every later watch reuses it.
 *
 * The flow is captions before any download of audio, a focus window that filters
 * the transcript too, and a report of what was missing, expressed as a validated
 * contract rather than a markdown report.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn } from '../lib/json.mjs';
import { log } from '../lib/log.mjs';
import { sha256File } from '../media/hash.mjs';
import { probeFile } from '../media/probe.mjs';
import { loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { LOCAL_WHISPER_MISSING, localWhisperAvailable, transcribeLocally } from './local-whisper.mjs';
import { ensureSpeechModel, installProgress } from '../setup/research-helper.mjs';
import * as pipelineFacts from '../pipeline/facts.mjs';
import { windowSessionId } from '../pipeline/session-claims.mjs';
import { extractWatchFrames } from './watch-frames.mjs';
import {
  captionLanguageTag,
  fetchUrl,
  isUrl,
  resolveWatchSource,
  urlKey,
  watchRoot,
} from './watch-source.mjs';
import {
  filterToWindow,
  normalizeSegments,
  normalizeWords,
  parseCaptionFile,
  readTranscript,
  transcriptPath,
  writeTranscript,
} from './watch-transcript.mjs';

/** The detail levels video_watch accepts. */
export const DETAILS = /** @type {const} */ (['quick', 'standard', 'deep']);

/** The transcript sources transcript_save accepts. */
export const TRANSCRIPT_SOURCES = /** @type {const} */ (['platform_captions', 'elevenlabs', 'manual']);

/** Confidence of a direct read of the video itself. */
const DIRECT_READ_CONFIDENCE = 0.9;

/**
 * Why a transcript cannot be made today, in one sentence for a person.
 */
export const NO_SPEECH_TO_TEXT =
  'This video has no captions and no speech to text service is connected, so the spoken words are not in this package; it covers the pictures only.';

/**
 * The one transcript status for "the words need a transcription nobody here can do".
 * video_watch's package and media_transcribe both use it.
 */
export const NEEDS_TRANSCRIPTION_PROVIDER = 'needs_transcription_provider';

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * The library asset a file belongs to, by path or by content.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} path
 * @param {string} sha256
 * @returns {string|null}
 */
function findAssetId(workspace, path, sha256) {
  if (!workspace.status().configured) return null;
  const row = workspace
    .requireDb()
    .prepare('SELECT id FROM assets WHERE path = ? OR sha256 = ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .get(path, sha256);
  return row ? String(row.id) : null;
}

/**
 * Keep a transcript with its library asset, so asset_search finds the words and the
 * editing tools find the timings. One transcript row per asset; a newer one replaces it.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} assetId
 * @param {import('./watch-transcript.mjs').StoredTranscript} transcript
 */
function recordTranscriptAnalysis(workspace, assetId, transcript) {
  const db = workspace.requireDb();
  db.prepare("DELETE FROM asset_analyses WHERE asset_id = ? AND analyst = 'transcript'").run(assetId);
  db.prepare('INSERT INTO asset_analyses (id, asset_id, analyst, json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    assetId,
    'transcript',
    toJsonColumn({
      transcript_id: transcript.transcript_id,
      source: transcript.source,
      language: transcript.language,
      text: transcript.text,
      segments: transcript.segments,
      words: transcript.words.length,
      source_type: transcript.source_type,
      source_ref: transcript.source_ref,
      observed_at: transcript.observed_at,
      confidence: transcript.confidence,
    }),
    nowIso(),
  );
}

/**
 * Store a transcript and log where it came from.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {Parameters<typeof writeTranscript>[0]} options
 */
function storeTranscript(workspace, options) {
  const saved = writeTranscript(options);
  if (options.assetId) recordTranscriptAnalysis(workspace, options.assetId, saved.transcript);
  log.info('transcript saved', {
    transcript_id: saved.transcript.transcript_id,
    source: saved.transcript.source,
    source_type: saved.transcript.source_type,
    source_ref: saved.transcript.source_ref,
    asset_id: options.assetId,
    segments: saved.transcript.segments.length,
    words: saved.transcript.words.length,
  });
  return saved;
}

/**
 * Parse the caption track yt-dlp fetched and store it. Empty captions store nothing.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{key: string, sha256: string|null, url: string, assetId: string|null, mediaPath: string|null, captions: {path: string, language: string}}} options
 */
function storeCaptions(workspace, options) {
  let segments;
  try {
    segments = parseCaptionFile(options.captions.path);
  } catch (error) {
    log.warn('caption file could not be read', { path: options.captions.path, error: String(error) });
    return null;
  }
  if (segments.length === 0) return null;
  return storeTranscript(workspace, {
    workspaceRoot: workspace.requireRoot(),
    key: options.key,
    sha256: options.sha256,
    url: options.url,
    assetId: options.assetId,
    mediaPath: options.mediaPath,
    source: 'platform_captions',
    language: captionLanguageTag(options.captions.language),
    segments,
    sourceType: 'public_platform',
    sourceRef: options.url,
  }).transcript;
}

/**
 * Validate the watch window against the media length.
 * @param {unknown} start
 * @param {unknown} end
 * @param {number} duration
 * @returns {{startS: number, endS: number, focused: boolean}}
 */
export function resolveWindow(start, end, duration) {
  const has = (/** @type {unknown} */ value) => value !== undefined && value !== null && value !== '';
  const startS = has(start) ? Number(start) : 0;
  const rawEnd = has(end) ? Number(end) : duration;
  if (!Number.isFinite(startS) || startS < 0) throw new InvalidInputError('start must be a number of seconds, 0 or more.');
  if (!Number.isFinite(rawEnd) || rawEnd < 0) throw new InvalidInputError('end must be a number of seconds, 0 or more.');
  if (has(start) && has(end) && rawEnd <= startS) throw new InvalidInputError('end must be later than start.');
  if (duration > 0 && startS >= duration) {
    throw new InvalidInputError(`start is past the end of the video, which is ${round3(duration)} seconds long.`);
  }
  const endS = duration > 0 ? Math.min(rawEnd, duration) : rawEnd;
  return { startS, endS, focused: has(start) || has(end) };
}

/** How each platform writes its own name. */
const PLATFORM_NAMES = /** @type {Record<string, string>} */ ({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' });

/**
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * A short plain description of what the package holds. Facts only.
 * @param {{durationS: number, window: {start_s: number, end_s: number|null}|null, platform: string|null, author: string|null, frames: Array<{reason: string}>, transcript: {status: string, source: string, segments: unknown[]}}} facts
 * @returns {string}
 */
function describe(facts) {
  const where = facts.platform && PLATFORM_NAMES[facts.platform] ? `${PLATFORM_NAMES[facts.platform]} ` : '';
  const by = facts.author ? ` by ${facts.author}` : '';
  const span = facts.window
    ? `seconds ${round1(facts.window.start_s)} to ${round1(facts.window.end_s ?? facts.durationS)} of a ${round1(facts.durationS)} second ${where}video${by}`
    : `a ${round1(facts.durationS)} second ${where}video${by}`;
  const scenes = facts.frames.filter((frame) => frame.reason === 'scene_change').length;
  const frames = `${facts.frames.length} frame${facts.frames.length === 1 ? '' : 's'}${scenes ? ` (${scenes} at scene changes)` : ''}`;
  let heard;
  if (facts.transcript.status === 'ready') {
    const label =
      facts.transcript.source === 'platform_captions'
        ? 'platform captions'
        : facts.transcript.source === 'elevenlabs'
          ? 'a speech to text transcript'
          : facts.transcript.source === 'local_whisper'
            ? 'a local speech to text transcript'
            : 'a transcript a person supplied';
    heard = `a transcript from ${label} with ${facts.transcript.segments.length} segment${facts.transcript.segments.length === 1 ? '' : 's'}`;
  } else if (facts.transcript.status === 'no_audio') {
    heard = 'no audio track';
  } else {
    heard = 'no transcript';
  }
  return `Watched ${span}: ${frames}, ${heard}.`;
}

/**
 * Watch one video and write its VideoEvidencePackage.
 * @param {{
 *   workspace: import('../workspace/index.mjs').Workspace,
 *   source: string,
 *   detail?: string,
 *   start?: number,
 *   end?: number,
 *   campaignId?: string|null,
 *   language?: string|null,
 *   jobDir?: string|null,
 *   breaker?: import('../social/breaker.mjs').Breaker,
 * }} options jobDir (optional) is a job folder whose inputs/references/video already holds the video, so it is not downloaded twice.
 * @returns {Promise<{package: Record<string, any>, package_path: string, artifact: {id: string, version: number}|null}|{ok: false, status: string, message: string, next: string, details: Record<string, unknown>, package: null, package_path: null, artifact: null}>}
 */
export async function watchVideo(options) {
  const { workspace } = options;
  const root = workspace.requireRoot();
  const detail = /** @type {import('./watch-frames.mjs').Detail} */ (optionalString(options.detail) ?? 'standard');
  if (!DETAILS.includes(detail)) throw new InvalidInputError(`detail must be one of ${DETAILS.join(', ')}.`);
  const campaignId = optionalString(options.campaignId);
  if (campaignId && !workspace.requireDb().prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignId)) {
    throw new InvalidInputError('No job with that campaign_id exists.');
  }

  const source = resolveWatchSource(options.source, workspace);
  const observedAt = nowIso();

  /** @type {import('./watch-source.mjs').FetchedUrl|null} */
  let fetched = null;
  if (source.kind === 'url') {
    const got = await fetchUrl({ url: /** @type {string} */ (source.url), workspaceRoot: root, language: options.language ?? null, jobDir: options.jobDir ?? null, breaker: options.breaker });
    // An ordinary download failure is a result, not an error: the caller records the status and leaves the slot blank.
    if (!got.ok) return { ok: false, status: got.status, message: got.message, next: got.next, details: got.details, package: null, package_path: null, artifact: null };
    fetched = got;
    source.path = fetched.videoPath;
  }
  const mediaPath = /** @type {string} */ (source.path);
  const probe = await probeFile(mediaPath);
  const duration = probe.duration ?? fetched?.durationS ?? 0;
  const { startS, endS, focused } = resolveWindow(options.start, options.end, duration);
  const window = focused ? { start_s: round3(startS), end_s: round3(endS) } : null;

  const sha256 = source.asset?.sha256 ?? (await sha256File(mediaPath));
  const assetId = source.assetId ?? findAssetId(workspace, mediaPath, sha256);

  const packageId = newId();
  const packageDir = join(watchRoot(root), packageId);
  mkdirSync(packageDir, { recursive: true });

  /** @type {import('./watch-frames.mjs').FrameResult} */
  let frameResult = { frames: [], target: 0, extracted: 0, keptAfterDedupe: 0, tiers: [] };
  if (probe.has_video && endS > startS) {
    frameResult = await extractWatchFrames({ videoPath: mediaPath, outDir: packageDir, detail, startS, endS, focused });
  }

  let stored = readTranscript(root, sha256);
  if (!stored && fetched?.captions) {
    stored = storeCaptions(workspace, {
      key: sha256,
      sha256,
      url: /** @type {string} */ (source.url),
      assetId,
      mediaPath,
      captions: fetched.captions,
    });
  }
  /** @type {Record<string, any>} */
  let transcript;
  if (stored) {
    transcript = {
      status: 'ready',
      source: stored.source,
      language: stored.language,
      transcript_id: stored.transcript_id,
      audio_path: null,
      segments: filterToWindow(stored.segments, window).map((segment) => ({
        start_s: segment.start_s,
        end_s: segment.end_s,
        text: segment.text,
        speaker: segment.speaker ?? null,
      })),
      words_available: stored.words.length > 0,
    };
  } else if (!probe.has_audio) {
    transcript = { status: 'no_audio', source: 'none', language: null, transcript_id: null, audio_path: null, segments: [], words_available: false };
  } else {
    // No captions and no speech to text: the package degrades to frames only.
    transcript = { status: NEEDS_TRANSCRIPTION_PROVIDER, source: 'none', language: null, transcript_id: null, audio_path: null, segments: [], words_available: false };
  }

  let coverage;
  let degradedReason = null;
  if (frameResult.frames.length === 0) {
    coverage = duration > 0 || fetched?.metadata ? 'metadata_only' : 'none';
    degradedReason = probe.has_video
      ? 'No frame could be read from this video.'
      : 'This file has no picture, so there are no frames to look at.';
  } else if (transcript.status === 'ready' || transcript.status === 'no_audio') {
    coverage = 'full';
  } else {
    coverage = 'frames_only';
    degradedReason = NO_SPEECH_TO_TEXT;
  }

  const sourceKind = source.kind;
  const evidence = {
    schema_version: 1,
    id: packageId,
    campaign_id: campaignId,
    source: {
      kind: sourceKind,
      url: source.url,
      path: sourceKind === 'url' ? null : mediaPath,
      asset_id: assetId,
      platform: source.platform,
    },
    detail,
    window,
    media: {
      path: mediaPath,
      asset_id: assetId,
      duration_s: round3(duration),
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      has_audio: probe.has_audio,
    },
    source_metadata: fetched?.metadata ?? null,
    frames: frameResult.frames,
    // Every count says what it counts: returned is the number of frames to read, the
    // two removed counts explain the gap to extracted, and kept_after_dedupe stays for
    // readers written before returned existed.
    frame_budget: {
      target: frameResult.target,
      returned: frameResult.frames.length,
      extracted: frameResult.extracted,
      duplicates_removed: Math.max(0, frameResult.extracted - frameResult.keptAfterDedupe),
      kept_after_dedupe: frameResult.keptAfterDedupe,
      over_budget: Math.max(0, frameResult.keptAfterDedupe - frameResult.frames.length),
    },
    transcript,
    source_type: sourceKind === 'url' ? (isAdLibrary(/** @type {string} */ (source.url)) ? 'ad_library' : 'public_platform') : 'local_media',
    source_ref: sourceKind === 'url' ? /** @type {string} */ (source.url) : sourceKind === 'asset' ? `asset:${assetId}` : mediaPath,
    observed_at: observedAt,
    confidence: DIRECT_READ_CONFIDENCE,
    coverage,
    degraded_reason: degradedReason,
    summary: describe({
      durationS: duration,
      window,
      platform: source.platform,
      author: fetched?.metadata?.author_handle ?? null,
      frames: frameResult.frames,
      transcript,
    }),
  };

  const problems = validateAgainstSchema(loadSchema('VideoEvidencePackage'), evidence);
  if (problems.length > 0) {
    throw new UserFacingError('The video was watched but its evidence could not be put together.', {
      code: 'internal_error',
      details: { problems },
    });
  }

  const packagePath = join(packageDir, 'package.json');
  writeFileSync(packagePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  let artifact = null;
  if (campaignId) {
    const db = workspace.requireDb();
    const version =
      Number(db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = 'VideoEvidencePackage'").get(campaignId)?.version ?? 0) + 1;
    const id = newId();
    db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      campaignId,
      'VideoEvidencePackage',
      packagePath,
      toJsonColumn(evidence),
      version,
      nowIso(),
    );
    artifact = { id, version };
  }

  log.info('video watched', {
    package_id: packageId,
    source_type: evidence.source_type,
    source_ref: evidence.source_ref,
    frames: frameResult.frames.length,
    tiers: frameResult.tiers,
    transcript: transcript.status,
    coverage,
  });
  return { package: evidence, package_path: packagePath, artifact };
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isAdLibrary(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)facebook\.com$/.test(parsed.hostname) && parsed.pathname.startsWith('/ads/library')
      || /(^|\.)tiktok\.com$/.test(parsed.hostname) && parsed.hostname.startsWith('library.');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// media_transcribe
// ---------------------------------------------------------------------------

/**
 * @param {import('./watch-transcript.mjs').StoredTranscript} stored
 * @param {string} path
 * @param {boolean} reused
 */
function readyAnswer(stored, path, reused) {
  return {
    status: /** @type {const} */ ('ready'),
    reused,
    transcript: {
      transcript_id: stored.transcript_id,
      source: stored.source,
      language: stored.language,
      segments: stored.segments,
      words_available: stored.words.length > 0,
      path,
    },
  };
}

/** What the person is told while the free speech to text is still being put on this computer. */
export const GETTING_READY = 'Claude is still getting ready to turn speech into text. Try this video again in a few minutes.';

/** Is the free local speech to text on its way (the helper or the speech model is being installed or downloaded now)? */
function localReaderGettingReady(workspace, local) {
  if (!local || local.ok) return false;
  if (local.message === GETTING_READY) return true;
  if (local.status !== 'not_installed' && local.status !== 'model_missing') return false;
  try {
    const progress = installProgress(workspace);
    return progress.state === 'installing' || progress.speech?.state === 'installing';
  } catch {
    return false;
  }
}

/** Is ElevenLabs marked connected in this workspace (the same record integration_probe keeps)? */
function elevenLabsConnected(workspace) {
  try {
    const record = workspace.readIntegrations().elevenlabs;
    const state = record && typeof record === 'object' ? String(record.state ?? '') : '';
    return state === 'connected' || state === 'ready';
  } catch {
    return false;
  }
}

/**
 * The job a paid transcription would be priced on: the one named, else the one this window is bound to. Null when there is none,
 * it cannot be found, or it is finished (a finished job cannot pay for a transcription).
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {unknown} jobId
 */
function jobForOffer(workspace, jobId) {
  const root = workspace.root;
  if (!root) return { job: null, why: null };
  try {
    const named = optionalString(jobId);
    const bound = named ? null : pipelineFacts.readSessionBinding(root, windowSessionId());
    const job = named ? pipelineFacts.findJob(root, named) : bound ? pipelineFacts.jobAt(root, bound.brand, bound.jobId) : null;
    if (!job) return { job: null, why: named ? 'That job was not found, so the cost cannot be tied to it.' : null };
    if (pipelineFacts.isFinishedState(job.state)) return { job: null, why: 'That job is finished, so the cost cannot be tied to it.' };
    return { job, why: null };
  } catch {
    return { job: null, why: null };
  }
}

/** The next transcription number nothing has used: TR1, else one past the highest in the price, the estimates and the records. */
function nextTranscriptionNumber(job) {
  const keys = [];
  for (const item of pipelineFacts.readQuote(job)?.quote.items ?? []) keys.push(item?.key);
  for (const entry of [...pipelineFacts.readRecords(job), ...pipelineFacts.readLanded(job), ...pipelineFacts.readEstimates(job)]) keys.push(entry?.key, entry?.priceKey);
  let top = 0;
  for (const key of keys) {
    const parsed = typeof key === 'string' ? pipelineFacts.parseJobKey(key) : null;
    const hit = parsed ? /^TR(\d+)$/.exec(parsed.item) : null;
    if (hit) top = Math.max(top, Number(hit[1]));
  }
  return top + 1;
}

/**
 * The paid route, ready to offer: the transcription key to price on the job and the steps in order. Nothing here spends; the price is
 * approved by a tap on the board.
 * @param {{jobId: string, brand: string}} job
 * @param {{mediaPath: string|null, assetId: string|null}} media
 */
function transcriptionOffer(job, media) {
  const panel = `TR${nextTranscriptionNumber(job)}`;
  const itemKey = pipelineFacts.formatJobKey({ jobId: job.jobId, deliverable: 'D1', item: panel, version: 1 });
  const context = `job:${job.jobId} D1 ${panel}`;
  const saved = media.assetId ? `asset_id "${media.assetId}"` : `path "${media.mediaPath}"`;
  return {
    provider: 'elevenLabs',
    kind: 'transcription',
    brand: job.brand,
    job_id: job.jobId,
    deliverable: 'D1',
    panel,
    item_key: itemKey,
    context,
    media_path: media.mediaPath,
    asset_id: media.assetId,
    spends_nothing: true,
    steps: [
      'Ask the person whether they want the words checked, and say it costs credits they approve on the board.',
      `Put the file on a flow (creative_create_asset_upload, creative_finalize_asset_upload), then call creative_transcribe_audio with the returned node_id as connect_from, the context "${context}" and estimate_only true.`,
      `Save the price with pipeline_quote_save: the item {key: "${itemKey}", provider: "elevenLabs", kind: "transcription", deliverable: "D1", panel: "${panel}", credits: the estimate, estimateId}.`,
      'Present it with pipeline_review_present and gate "price".',
      'Stop there. The price is approved only by the person tapping it on the board; a typed yes does not approve it.',
      'Once the board shows it approved, call creative_transcribe_audio again with the same inputs and context, without estimate_only.',
      `Store the result with transcript_save, source "elevenlabs" and ${saved}.`,
    ],
  };
}

/**
 * What the agent should do when there is no transcript to be had.
 * @param {{mediaPath: string|null, assetId: string|null, url: string|null, durationS: number|null}} facts
 * @param {Awaited<ReturnType<typeof transcribeLocally>>|null} [local] why the free local speech to text did not give one.
 * @param {{workspace?: import('../workspace/index.mjs').Workspace, jobId?: unknown}} [context] the workspace and the job asked about, for the paid offer.
 */
function noProviderAnswer(facts, local = null, context = {}) {
  const workspace = context.workspace;
  const gettingReady = Boolean(workspace) && localReaderGettingReady(workspace, local);
  const manual = 'If the person has the script, a transcript or a subtitle file for this video, store it with transcript_save and source "manual"; every later watch will use it.';
  const connected = Boolean(workspace) && !gettingReady && elevenLabsConnected(/** @type {any} */ (workspace));
  const found = connected ? jobForOffer(/** @type {any} */ (workspace), context.jobId) : { job: null, why: null };
  const offer = found.job ? transcriptionOffer(found.job, facts) : null;
  const tried = local && !local.ok ? `The free local speech to text could not be used: ${local.message} ` : '';
  let next;
  if (gettingReady) {
    next = `${GETTING_READY} Do not offer anything paid while it is getting ready. ${manual}`;
  } else if (offer) {
    next =
      tried +
      'No speech to text service is connected to the plugin itself, but ElevenLabs is connected and the job is known, so the paid route is ready in offer. ' +
      'Offer it only if the person wants the spoken words checked, then follow offer.steps in order. This tool never spends: the cost is approved by a tap on the board price. ' +
      'It has its own approval, works in any job state including research, and never touches the media price or starts media. ' +
      'If the person says no, carry on with the frames from video_watch and say the spoken words were not available. ' +
      manual;
  } else {
    next =
      tried +
      'No speech to text service is connected to the plugin itself. ' +
      (connected
        ? `ElevenLabs is connected but this call has no open job to tie the cost to. ${found.why ?? ''} ` +
          'Call this tool again with job_id for a priced offer. Without a job, creative_transcribe_audio can still read the words once the person says yes (the file goes on a flow first, as connect_from); the cost is then not tracked against a job. '
        : 'ElevenLabs can read the words with creative_transcribe_audio, but it is not marked connected here. If the person says it is, record it with integration_probe, then call this tool again with job_id for a priced offer. ') +
      'Otherwise carry on with the frames from video_watch and say the spoken words were not available. ' +
      manual;
  }
  return {
    status: /** @type {const} */ (NEEDS_TRANSCRIPTION_PROVIDER),
    provider_available: false,
    reason: NO_SPEECH_TO_TEXT,
    media_path: facts.mediaPath,
    asset_id: facts.assetId,
    source_url: facts.url,
    duration_s: facts.durationS === null ? null : round3(facts.durationS),
    local_transcription: local && !local.ok ? { status: local.status, message: gettingReady ? GETTING_READY : local.message } : null,
    ...(gettingReady ? { getting_ready: true } : {}),
    offer,
    next,
  };
}

/**
 * Transcribe a media file with the local faster-whisper and store the result like any other transcript.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{key: string, sha256: string|null, url: string|null, assetId: string|null, mediaPath: string, language: string|null, durationS: number|null}} facts
 * @returns {Promise<{ok: true, stored: import('./watch-transcript.mjs').StoredTranscript, path: string, model: string}|{ok: false, local: Awaited<ReturnType<typeof transcribeLocally>>}>}
 */
async function transcribeWithLocalReader(workspace, facts) {
  const local = await transcribeLocally({ path: facts.mediaPath, language: facts.language, durationS: facts.durationS });
  if (!local.ok) {
    // The speech model is part of the install: it starts now, in the background, and the answer says so instead of
    // asking the person to run a command.
    if (local.status === 'model_missing') {
      const fetching = ensureSpeechModel(workspace, local.model);
      if (fetching.state === 'downloading') {
        return { ok: false, local: { ...local, message: GETTING_READY } };
      }
    }
    return { ok: false, local };
  }
  const { segments } = normalizeSegments(local.segments);
  if (segments.length === 0) return { ok: false, local: { ok: false, status: 'no_speech', message: 'No speech was found in that audio.', model: local.model } };
  const saved = storeTranscript(workspace, {
    workspaceRoot: workspace.requireRoot(),
    key: facts.key,
    sha256: facts.sha256,
    url: facts.url,
    assetId: facts.assetId,
    mediaPath: facts.mediaPath,
    source: 'local_whisper',
    language: local.language ?? facts.language,
    segments,
    words: normalizeWords(local.words),
    sourceType: 'local_media',
    sourceRef: `local_whisper:${local.model}:${facts.assetId ? `asset:${facts.assetId}` : facts.url ?? facts.mediaPath}`,
  });
  return { ok: true, stored: saved.transcript, path: saved.path, model: local.model };
}

/**
 * The answer for a transcript the local reader just made.
 * @param {{stored: import('./watch-transcript.mjs').StoredTranscript, path: string, model: string}} made
 */
function localAnswer(made) {
  return { ...readyAnswer(made.stored, made.path, false), transcribed_with: { engine: 'faster-whisper', model: made.model, device: 'cpu', compute_type: 'int8' } };
}

/**
 * Find or fetch a transcript. Never sends anything anywhere and never spends: when only the paid route is left, the answer carries an
 * offer for the job (jobId, else the job this window is bound to) that Claude prices on the board.
 * @param {{workspace: import('../workspace/index.mjs').Workspace, assetId?: unknown, path?: unknown, url?: unknown, language?: unknown, jobId?: unknown, breaker?: import('../social/breaker.mjs').Breaker}} options
 */
export async function transcribeMedia(options) {
  const { workspace } = options;
  const root = workspace.requireRoot();
  const given = [options.assetId, options.path, options.url].filter((value) => optionalString(value) !== null);
  if (given.length !== 1) throw new InvalidInputError('Give exactly one of asset_id, path or url.');
  const language = optionalString(options.language);

  const url = optionalString(options.url);
  if (url) {
    if (!isUrl(url)) throw new InvalidInputError('url must be an address that starts with http:// or https://.');
    const fetched = await fetchUrl({ url, workspaceRoot: root, language, skipDownload: true, breaker: options.breaker });
    if (!fetched.ok) return { ok: false, status: fetched.status, message: fetched.message, next: fetched.next, details: fetched.details };
    const sha256 = fetched.videoPath ? await sha256File(fetched.videoPath) : null;
    const key = sha256 ?? urlKey(url);
    const existing = readTranscript(root, key);
    if (existing) return readyAnswer(existing, transcriptPath(root, key), true);
    if (fetched.captions) {
      const stored = storeCaptions(workspace, { key, sha256, url, assetId: null, mediaPath: fetched.videoPath, captions: fetched.captions });
      if (stored) return readyAnswer(stored, transcriptPath(root, key), false);
    }
    // No captions. The video is downloaded for the free local speech to text only when it can actually run.
    if (!(await localWhisperAvailable())) {
      return noProviderAnswer({ mediaPath: fetched.videoPath, assetId: null, url, durationS: fetched.durationS }, { ok: false, status: 'not_installed', message: LOCAL_WHISPER_MISSING }, { workspace, jobId: options.jobId });
    }
    const downloaded = fetched.videoPath ? fetched : await fetchUrl({ url, workspaceRoot: root, language, breaker: options.breaker });
    if (!downloaded.ok || !downloaded.videoPath) {
      return noProviderAnswer({ mediaPath: null, assetId: null, url, durationS: fetched.durationS }, { ok: false, status: 'failed', message: 'The video could not be downloaded for the local speech to text.' }, { workspace, jobId: options.jobId });
    }
    const downloadedSha = await sha256File(downloaded.videoPath);
    const probed = await probeFile(downloaded.videoPath);
    if (!probed.has_audio) return { status: /** @type {const} */ ('no_audio') };
    const known = readTranscript(root, downloadedSha);
    if (known) return readyAnswer(known, transcriptPath(root, downloadedSha), true);
    const made = await transcribeWithLocalReader(workspace, { key: downloadedSha, sha256: downloadedSha, url, assetId: null, mediaPath: downloaded.videoPath, language, durationS: probed.duration });
    if (made.ok) return localAnswer(made);
    if (made.local.status === 'no_speech') return { status: /** @type {const} */ ('no_speech'), local_transcription: { status: made.local.status, message: made.local.message } };
    return noProviderAnswer({ mediaPath: downloaded.videoPath, assetId: null, url, durationS: probed.duration }, made.local, { workspace, jobId: options.jobId });
  }

  const source = resolveWatchSource(/** @type {string} */ (optionalString(options.assetId) ?? optionalString(options.path)), workspace);
  if (source.kind === 'url') throw new InvalidInputError('Put an address in url, not in path.');
  const mediaPath = /** @type {string} */ (source.path);
  const sha256 = source.asset?.sha256 ?? (await sha256File(mediaPath));
  const existing = readTranscript(root, sha256);
  if (existing) return readyAnswer(existing, transcriptPath(root, sha256), true);
  const probe = await probeFile(mediaPath);
  if (!probe.has_audio) return { status: /** @type {const} */ ('no_audio') };
  const assetId = source.assetId ?? findAssetId(workspace, mediaPath, sha256);
  // No saved transcript and no captions: the free local speech to text, when this computer has one.
  const made = await transcribeWithLocalReader(workspace, { key: sha256, sha256, url: null, assetId, mediaPath, language, durationS: probe.duration });
  if (made.ok) return localAnswer(made);
  if (made.local.status === 'no_speech') return { status: /** @type {const} */ ('no_speech'), local_transcription: { status: made.local.status, message: made.local.message } };
  return noProviderAnswer({ mediaPath, assetId, url: null, durationS: probe.duration }, made.local, { workspace, jobId: options.jobId });
}

// ---------------------------------------------------------------------------
// transcript_save
// ---------------------------------------------------------------------------

/**
 * Store a transcript from captions, a person, or a speech to text file the person brings, against the media.
 * @param {{workspace: import('../workspace/index.mjs').Workspace, assetId?: unknown, path?: unknown, segments: unknown, words?: unknown, source: unknown, language?: unknown}} options
 */
export async function saveTranscript(options) {
  const { workspace } = options;
  const root = workspace.requireRoot();
  const source = /** @type {import('./watch-transcript.mjs').TranscriptSource} */ (String(options.source));
  if (!TRANSCRIPT_SOURCES.includes(/** @type {any} */ (source))) {
    throw new InvalidInputError(`source must be one of ${TRANSCRIPT_SOURCES.join(', ')}.`);
  }
  const assetArg = optionalString(options.assetId);
  const pathArg = optionalString(options.path);
  if ((assetArg ? 1 : 0) + (pathArg ? 1 : 0) !== 1) throw new InvalidInputError('Give exactly one of asset_id or path.');

  const target = resolveWatchSource(/** @type {string} */ (assetArg ?? pathArg), workspace);
  if (target.kind === 'url') {
    throw new InvalidInputError('A transcript is kept with a file or a library asset.', {
      fix: 'Watch the address with video_watch first, then save the transcript with the path of the downloaded video in its package.',
    });
  }
  const mediaPath = resolve(/** @type {string} */ (target.path));
  if (!existsSync(mediaPath) || !statSync(mediaPath).isFile()) throw new InvalidInputError('That file could not be found.');

  const { segments, problems } = normalizeSegments(/** @type {unknown[]} */ (options.segments));
  if (problems.length > 0 || segments.length === 0) {
    throw new InvalidInputError(`That transcript is not complete: ${problems[0] ?? 'it has no segments'}.`, {
      fix: 'Every segment needs start_s, end_s and text, in seconds from the start of the video.',
      details: { problems },
    });
  }
  const words = normalizeWords(/** @type {unknown[]} */ (options.words ?? []));

  const sha256 = target.asset?.sha256 ?? (await sha256File(mediaPath));
  const assetId = target.assetId ?? findAssetId(workspace, mediaPath, sha256);
  const sourceType = source === 'manual' ? 'user_supplied' : source === 'platform_captions' ? 'public_platform' : 'local_media';
  const sourceRef = source === 'elevenlabs' ? `transcript_save:${assetId ? `asset:${assetId}` : mediaPath}` : assetId ? `asset:${assetId}` : mediaPath;

  const saved = storeTranscript(workspace, {
    workspaceRoot: root,
    key: sha256,
    sha256,
    url: null,
    assetId,
    mediaPath,
    source,
    language: optionalString(options.language),
    segments,
    words,
    sourceType,
    sourceRef,
  });
  return {
    ok: true,
    transcript_id: saved.transcript.transcript_id,
    asset_id: assetId,
    path: saved.path,
    media_path: mediaPath,
    segments: segments.length,
    words: words.length,
  };
}

