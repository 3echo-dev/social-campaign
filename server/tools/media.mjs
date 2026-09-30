/**
 * Media tools: probe, frames, audio.
 *
 * Thin wrappers over server/media/ for the Media Librarian and the analysts. Each
 * accepts either a registered asset_id or a raw file path. Derived files always land
 * inside the workspace; the original is only ever read.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { newId } from '../lib/ids.mjs';
import { probeFile } from '../media/probe.mjs';
import { extractImageThumbnail, extractVideoFrames, listFrames } from '../media/frames.mjs';
import { extractAudio } from '../media/audio.mjs';
import { detectType } from '../media/mime.mjs';
import { assetFromRow } from '../media/ingest.mjs';

/**
 * Resolve the file behind asset_id or path. When only a path is given the asset id
 * is a fresh one, so derived files still get their own folder.
 * @param {Record<string, unknown>} args
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{path: string, assetId: string, asset: Record<string, any>|null}}
 */
export function resolveTarget(args, workspace) {
  if (typeof args.asset_id === 'string' && args.asset_id) {
    const row = workspace.requireDb().prepare('SELECT * FROM assets WHERE id = ?').get(args.asset_id);
    if (!row) throw new InvalidInputError('No asset with that id is in the library.');
    const asset = assetFromRow(row, workspace.requireRoot());
    return { path: asset.path, assetId: asset.id, asset };
  }
  if (typeof args.path === 'string' && args.path.trim()) {
    const path = resolve(args.path.trim());
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new InvalidInputError('That file could not be found.');
    }
    return { path, assetId: newId(), asset: null };
  }
  throw new InvalidInputError('Give either an asset_id or a file path.');
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const mediaTools = [
  defineTool({
    name: 'media_probe',
    description:
      'Read the objective facts about a media file: duration, width, height, frame rate, codec, audio ' +
      'track count and container. Works on video, image and audio files. The file is only read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file.' },
        asset_id: { type: 'string', description: 'Alternatively, a registered asset id.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const target = resolveTarget(args, workspace);
      const type = detectType(target.path);
      const probe = await probeFile(target.path);
      return { path: target.path, mime: type.mime, kind: type.kind, bytes: statSync(target.path).size, ...probe };
    },
  }),

  defineTool({
    name: 'media_extract_frames',
    description:
      'Extract the first frame plus evenly spaced representative frames from a video as small jpg files ' +
      'inside the workspace, ready to be read for visual analysis. For an image it writes one thumbnail. ' +
      'Returns the frame paths.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'A registered asset id.' },
        path: { type: 'string', description: 'Alternatively, an absolute path to a file.' },
        count: { type: 'number', description: 'Evenly spaced frames on top of the first one. Default 4, maximum 24.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = workspace.requireRoot();
      const target = resolveTarget(args, workspace);
      const type = detectType(target.path);
      if (type.kind !== 'video' && type.kind !== 'image') {
        throw new InvalidInputError('Frames can only be extracted from a video or an image.');
      }
      let duration = target.asset?.duration ?? null;
      if (type.kind === 'video' && duration == null) {
        duration = (await probeFile(target.path)).duration;
      }
      const result =
        type.kind === 'video'
          ? await extractVideoFrames({ filePath: target.path, assetId: target.assetId, workspaceRoot: root, duration, count: Number(args.count) || undefined })
          : await extractImageThumbnail({ filePath: target.path, assetId: target.assetId, workspaceRoot: root });
      if (target.asset && result.thumbnail) {
        workspace
          .requireDb()
          .prepare('UPDATE assets SET thumbnail_path = ?, updated_at = ? WHERE id = ?')
          .run(result.thumbnail, new Date().toISOString(), target.assetId);
      }
      return {
        asset_id: target.asset ? target.assetId : null,
        path: target.path,
        kind: type.kind,
        thumbnail_path: result.thumbnail || null,
        frames: listFrames(root, target.assetId),
        hint: 'Read the frame files to look at them.',
      };
    },
  }),

  defineTool({
    name: 'media_extract_audio',
    description:
      'Extract the audio track of a video or audio file into the workspace as a 16 kHz mono wav (or mp3), ' +
      'for transcription. Only call this when a transcript is actually needed.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'A registered asset id.' },
        path: { type: 'string', description: 'Alternatively, an absolute path to a file.' },
        format: { type: 'string', description: 'wav (default) or mp3.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = workspace.requireRoot();
      const target = resolveTarget(args, workspace);
      const type = detectType(target.path);
      if (type.kind !== 'video' && type.kind !== 'audio') {
        throw new InvalidInputError('Audio can only be extracted from a video or an audio file.');
      }
      const result = await extractAudio({
        filePath: target.path,
        assetId: target.assetId,
        workspaceRoot: root,
        format: args.format === 'mp3' ? 'mp3' : 'wav',
      });
      return { asset_id: target.asset ? target.assetId : null, source: target.path, audio_path: result.path, format: result.format };
    },
  }),
];
