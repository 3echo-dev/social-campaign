/**
 * Capability resolution.
 *
 * Turns the static registry into a live status map. Local capabilities are detected
 * for real: ffmpeg and ffprobe are probed on PATH, workspace and database state come
 * from the Workspace object. Remote providers report whatever integrations.json says,
 * which is written by integration_mark_connected until real OAuth detection lands.
 */

import { execFile } from 'node:child_process';

import { CAPABILITIES, RESOLVER_PROVIDER_KEY } from './registry.mjs';
import { log } from '../lib/log.mjs';
import { socialCapability } from '../social/router.mjs';
import { readPublisherConfig } from '../publishing/adapter.mjs';
import { hasUsableResearchHelperRecord, readResearchHelperRecord } from '../setup/research-helper-record.mjs';

/** Cached binary probes, so one tool call does not spawn ffprobe six times. */
const BINARY_CACHE = new Map();

/** How long a binary probe result is trusted. */
const BINARY_CACHE_MS = 30_000;

/**
 * How each external binary reports its version. FFmpeg and FFprobe take one dash;
 * yt-dlp reads "-version" as a bundle of short options, so it needs its own flag.
 * @type {Record<string, string[]>}
 */
const VERSION_ARGS = { ffmpeg: ['-version'], ffprobe: ['-version'], 'yt-dlp': ['--version'] };

/**
 * Ask a binary for its version. Arguments are passed as an array, so a path with
 * spaces is never handed to a shell.
 * @param {string} binary
 * @returns {Promise<{present: boolean, version: string|null}>}
 */
export function probeBinary(binary) {
  const cached = BINARY_CACHE.get(binary);
  if (cached && Date.now() - cached.at < BINARY_CACHE_MS) return Promise.resolve(cached.value);
  return new Promise((resolvePromise) => {
    execFile(binary, VERSION_ARGS[binary] ?? ['-version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const value = error
        ? { present: false, version: null }
        : { present: true, version: String(stdout).split('\n')[0].trim() || null };
      BINARY_CACHE.set(binary, { at: Date.now(), value });
      resolvePromise(value);
    });
  });
}

/**
 * Normalize whatever a provider wrote into integrations.json.
 * @param {unknown} raw
 * @returns {import('./registry.mjs').CapabilityState}
 */
function stateFromIntegration(raw) {
  const state = raw && typeof raw === 'object' ? String(/** @type {any} */ (raw).state ?? '') : '';
  if (state === 'connected' || state === 'ready') return 'ready';
  if (state === 'degraded') return 'degraded';
  if (state === 'unavailable') return 'unavailable';
  return 'not_connected';
}

/**
 * Resolve every capability.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {Promise<{capabilities: Record<string, import('./registry.mjs').CapabilityState>, details: Record<string, {state: string, provider: string, detail: string|null}>}>}
 */
export async function resolveCapabilities(workspace) {
  const status = workspace.status();
  const integrations = status.configured ? workspace.readIntegrations() : {};
  let publisher = null;
  if (status.configured) {
    try { publisher = readPublisherConfig(status.workspaceRoot); }
    catch { publisher = { state: 'degraded', detail: 'Unlock the credential store and reconnect the publishing service.' }; }
    if (publisher?.state === 'connected' && (!publisher.api_key || !publisher.provider)) {
      publisher = { state: 'not_connected', detail: 'Connect a publishing service on this computer.' };
    }
  }
  const [ffmpeg, ffprobe, ytdlp] = await Promise.all([probeBinary('ffmpeg'), probeBinary('ffprobe'), probeBinary('yt-dlp')]);

  /** @type {Record<string, import('./registry.mjs').CapabilityState>} */
  const capabilities = {};
  /** @type {Record<string, {state: string, provider: string, detail: string|null}>} */
  const details = {};

  for (const capability of CAPABILITIES) {
    let state = /** @type {import('./registry.mjs').CapabilityState} */ ('not_connected');
    let detail = null;

    switch (capability.resolver) {
      case 'core':
        if (status.configured) {
          state = 'ready';
        } else {
          state = 'unavailable';
          detail = 'No workspace has been set up yet.';
        }
        break;
      case 'claude':
        // Provided by the host session rather than by this plugin.
        state = 'ready';
        detail = 'Provided by Claude.';
        break;
      case 'ffmpeg':
        state = ffmpeg.present ? 'ready' : 'unavailable';
        detail = ffmpeg.present ? ffmpeg.version : 'FFmpeg was not found on this computer.';
        // Frame and audio extraction also need ffprobe to read the file first.
        if (state === 'ready' && !ffprobe.present && (capability.name.startsWith('media.extract_') || capability.name === 'media.video_analyze')) {
          state = 'unavailable';
          detail = 'FFprobe was not found on this computer.';
        }
        break;
      case 'ffprobe':
        state = ffprobe.present ? 'ready' : 'unavailable';
        detail = ffprobe.present ? ffprobe.version : 'FFprobe was not found on this computer.';
        break;
      case 'ytdlp':
        // Without yt-dlp the social tools still answer from public pages and a web
        // evidence plan, so a missing binary lowers coverage rather than blocking.
        state = ytdlp.present ? 'ready' : 'degraded';
        detail = ytdlp.present ? `yt-dlp ${ytdlp.version}` : 'yt-dlp was not found, so social research falls back to web search.';
        break;
      case 'social':
        // Fed by social_backends_status once it has run, else by the coverage verified
        // live on 2026-09-12. Never worse than degraded: a web evidence plan fills gaps.
        ({ state, detail } = socialCapability(capability.name, ytdlp));
        break;
      case 'research_browser': {
        // Written by the setup flow's research helper installer into
        // integrations.json.research_helper is the workspace enablement record, but
        // the reader only accepts the versioned shape and paths that still exist on
        // this machine. A copied or legacy {state: 'connected'} record must never
        // advertise a browser backend that cannot run.
        const entry = readResearchHelperRecord(status.workspaceRoot);
        const usable = hasUsableResearchHelperRecord(entry);
        const helperState = entry && typeof entry === 'object' ? String(entry.state ?? '') : '';
        state = usable ? 'ready' : helperState === 'degraded' ? 'degraded' : 'not_connected';
        detail =
          usable && typeof entry?.detail === 'string'
            ? entry.detail
            : !entry
              ? 'Browser research helper not connected; JavaScript heavy pages fall back to web evidence plans.'
              : helperState === 'degraded' && typeof entry.detail === 'string'
                ? entry.detail
                : 'The saved research helper record is incomplete, so it cannot be used until setup runs again.';
        break;
      }
      default: {
        const key = RESOLVER_PROVIDER_KEY[capability.resolver];
        const record = key === 'publisher' ? publisher : key ? integrations[key] : null;
        state = stateFromIntegration(record);
        detail = record && typeof record === 'object' ? (/** @type {any} */ (record).detail ?? null) : null;
        break;
      }
    }

    // Generation is the capability that spends money and leaves this computer,
    // so it reports what integrations.json currently says rather
    // than what was true when the session started. integration_probe writes a
    // failed real call there as "degraded", and it shows up here on the next read.
    if (capability.name.startsWith('generation.')) {
      const providerKey = RESOLVER_PROVIDER_KEY[capability.resolver];
      const record = providerKey ? integrations[providerKey] : null;
      if (record) {
        state = stateFromIntegration(record);
        detail = typeof (/** @type {any} */ (record).detail) === 'string' ? /** @type {any} */ (record).detail : detail;
      }
    }

    // Transcripts come from saved ones and platform captions, never from a speech to text
    // service; without yt-dlp only saved ones remain, and without either a video is
    // analysed from its frames.
    if (capability.name === 'media.transcribe') {
      detail = ytdlp.present
        ? 'Saved transcripts and platform captions. A video without either is analysed from its frames only.'
        : 'yt-dlp was not found, so only transcripts already saved can be used. Other videos are analysed from their frames only.';
    }

    // Subtitle files are written without any tool; only burning them into the
    // picture needs FFmpeg, so a missing FFmpeg lowers what subtitles can do.
    if (capability.name === 'generation.subtitle' && !ffmpeg.present) {
      state = 'degraded';
      detail = 'Subtitle files can be written, but burning them into the video needs FFmpeg.';
    }
    if (capability.name === 'media.edit' && state === 'ready' && !ffprobe.present) {
      state = 'unavailable';
      detail = 'FFprobe was not found on this computer, and editing reads every clip with it.';
    }

    capabilities[capability.name] = state;
    details[capability.name] = { state, provider: capability.provider, detail };
  }

  log.debug('capabilities resolved', { configured: status.configured });
  return { capabilities, details };
}
