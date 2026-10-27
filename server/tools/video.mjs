/**
 * Video understanding tools: video_watch, media_transcribe and transcript_save.
 *
 * Thin handlers over server/video/watch*.mjs, which hold the watch helpers.
 * Transcription is captions first: a transcript already saved for the same
 * media, then platform captions fetched with yt-dlp. media_transcribe then tries a
 * free local faster-whisper (the small model on the CPU) when one already imports in
 * this computer's Python. No paid speech to text service is connected, so without
 * captions and without that, video_watch's package and media_transcribe answer
 * needs_transcription_provider, the package covers the frames only, and a person's
 * transcript can still be stored with transcript_save.
 */

import { defineTool } from '../mcp/registry.mjs';
import { saveTranscript, transcribeMedia, watchVideo } from '../video/watch.mjs';

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const videoTools = [
  defineTool({
    name: 'video_watch',
    description:
      'Watch a video from a post address, a file on this computer or a library asset: returns timestamped frames to look at, ' +
      'the transcript when the platform has captions, and the video facts, as one evidence package.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'A post or video address, a file path, or a library asset id.' },
        detail: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'quick is a handful of frames, deep is dense coverage. Default standard.',
        },
        start: { type: 'number', minimum: 0, description: 'Seconds. Focus on a window instead of the whole video.' },
        end: { type: 'number', minimum: 0, description: 'Seconds.' },
        campaign_id: { type: 'string', description: 'Keep the package with this job.' },
      },
      required: ['source'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const result = await watchVideo({
        workspace,
        source: String(args.source),
        detail: typeof args.detail === 'string' ? args.detail : undefined,
        start: /** @type {number|undefined} */ (args.start),
        end: /** @type {number|undefined} */ (args.end),
        campaignId: typeof args.campaign_id === 'string' ? args.campaign_id : null,
      });
      // A download that failed comes back as a plain status: record it, leave the slot blank and move on.
      if (result.ok === false) return result;
      return {
        ok: true,
        package: result.package,
        package_path: result.package_path,
        artifact: result.artifact,
        hint: 'Read the frame files to look at them, in order; each has its timestamp in the package.',
      };
    },
  }),
  defineTool({
    name: 'media_transcribe',
    description:
      'Get a timestamped transcript for a video or audio. Returns a transcript already saved for it, or the platform captions when they exist, ' +
      'or, when faster-whisper is installed in this computer\'s Python and its small model is downloaded, a free local transcript (CPU, up to 15 minutes; source local_whisper, stored for every later step). ' +
      'When none of those is possible it answers needs_transcription_provider, with local_transcription saying why the local reader could not run. ' +
      'If the free reader is still being put on this computer, the answer says so in plain words (Claude is still getting ready to turn speech into text, try again in a few minutes) and offers nothing paid. ' +
      'Otherwise, when ElevenLabs is connected and a job is known (job_id, or the job this window is working on), the answer carries a ready offer: the next free transcription item to price on that job, and the steps in order (creative_transcribe_audio with estimate_only, a transcription price item saved with pipeline_quote_save, the price presented for a tap on the board, the same call again without estimate_only once it is approved, then transcript_save with source elevenlabs). ' +
      'This tool never spends: the person approves the price with a tap on the board, at any job stage. Without a connected ElevenLabs or a job, offer is null and the answer says what to do instead: carry on from the frames, or store a transcript the person has with transcript_save.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        path: { type: 'string' },
        url: { type: 'string' },
        language: { type: 'string', description: 'BCP 47 tag, for example en.' },
        job_id: { type: 'string', description: 'The job a paid transcription would be priced on. Optional: without it, the job this window is working on is used.' },
      },
      additionalProperties: false,
    },
    handler: (args, { workspace }) =>
      transcribeMedia({ workspace, assetId: args.asset_id, path: args.path, url: args.url, language: args.language, jobId: args.job_id }),
  }),
  defineTool({
    name: 'transcript_save',
    description:
      'Store a transcript for a video or audio, from platform captions, a script or transcript the person supplies, or a speech to text file they bring, so every later step can reuse it.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        path: { type: 'string' },
        segments: { type: 'array', minItems: 1, description: '[{start_s, end_s, text, speaker?}]', items: { type: 'object' } },
        words: { type: 'array', description: '[{start_s, end_s, text}]', items: { type: 'object' } },
        source: { type: 'string', enum: ['platform_captions', 'elevenlabs', 'manual'] },
        language: { type: 'string' },
      },
      required: ['segments', 'source'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) =>
      saveTranscript({
        workspace,
        assetId: args.asset_id,
        path: args.path,
        segments: args.segments,
        words: args.words,
        source: args.source,
        language: args.language,
      }),
  }),
];
