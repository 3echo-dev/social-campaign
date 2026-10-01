/**
 * Editing tools: timeline view, transcript packing, edit decision lists, render and verify.
 *
 * Thin handlers over server/editing/, which holds the editing helpers implemented
 * in Node (docs/CONTRACTS.md section 1a). The order an agent follows is:
 * pack the transcripts, look at timeline views where a cut is unclear, save an
 * edit decision list with video_build_edl, render it with video_render_edl, and
 * check the render with video_verify_render before showing anyone. Verification
 * may fail at most three times per edit; after that these tools refuse and the
 * media-producer has to take it to the user.
 *
 * Source footage is never modified. Every render lands in
 * <workspace>/generated/<campaign_id>/ and is registered with origin "generated".
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn } from '../lib/json.mjs';
import { loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { probeFile } from '../media/probe.mjs';
import { registerFile } from '../media/ingest.mjs';
import { generatedDir } from '../generation/edit.mjs';
import { attachDerivedAsset, readManifest } from '../generation/manifest.mjs';
import { resolveTarget } from './media.mjs';
import { detectSilences } from '../editing/detect.mjs';
import { packTranscripts, phrasesFor } from '../editing/pack.mjs';
import { readTranscript } from '../editing/transcripts.mjs';
import { MAX_WINDOW_S, renderTimeline } from '../editing/timeline.mjs';
import { checkEdl, edlHash, resolveSources } from '../editing/edl.mjs';
import { renderEdl, RENDER_PRESET_NAMES } from '../editing/render.mjs';
import { ATTEMPT_CAP, verifyRender } from '../editing/verify.mjs';

/** The render presets: the edit_export platform presets plus a full quality master. */
export const RENDER_PRESETS = RENDER_PRESET_NAMES;

/** What the agent is told when an edit has used its verification attempts. */
const ATTEMPT_CAP_MESSAGE =
  `This edit has failed its check ${ATTEMPT_CAP} times. Stop here: show the user the last frame sheet and ` +
  'what failed, and ask how they want to go on before changing the edit again.';

/**
 * @param {any} db
 * @param {string|null} campaignId
 * @param {string} name
 * @param {Record<string, unknown>} payload
 */
function logEvent(db, campaignId, name, payload) {
  db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    campaignId,
    name,
    toJsonColumn(payload),
    nowIso(),
  );
}

/**
 * @param {any} db
 * @param {string} campaignId
 */
function requireCampaign(db, campaignId) {
  if (!db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignId)) {
    throw new InvalidInputError('There is no job with that campaign id.');
  }
}

/**
 * Store a contract artifact after checking it against its schema.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @param {(version: number) => any} build the artifact, given the version it will be saved as
 * @param {string|null} path
 * @returns {{id: string, version: number, json: any}}
 */
function saveArtifact(db, campaignId, kind, build, path = null) {
  const version =
    Number(db.prepare('SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = ?').get(campaignId, kind)?.version ?? 0) + 1;
  const json = build(version);
  const problems = validateAgainstSchema(loadSchema(kind), json);
  if (problems.length > 0) {
    throw new InvalidInputError(`That ${kind} is not complete: ${problems[0]}`, { details: { problems } });
  }
  const id = newId();
  db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    campaignId,
    kind,
    path,
    toJsonColumn(json),
    version,
    nowIso(),
  );
  return { id, version, json };
}

/**
 * Read a stored edit decision list by its edl_id, `EditDecisionList:<version>`.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} edlId
 * @returns {{version: number, edl: any}}
 */
function readEdl(db, campaignId, edlId) {
  const match = /^(?:EditDecisionList:)?(\d+)$/.exec(String(edlId).trim());
  if (!match) throw new InvalidInputError('That edl_id is not one video_build_edl returned; it looks like EditDecisionList:1.');
  const version = Number(match[1]);
  const row = db
    .prepare("SELECT json FROM artifacts WHERE campaign_id = ? AND kind = 'EditDecisionList' AND version = ?")
    .get(campaignId, version);
  if (!row) throw new InvalidInputError(`This job has no edit decision list ${edlId}.`, { fix: 'Save the edit with video_build_edl first.' });
  return { version, edl: parseJson(String(row.json), null) };
}

/**
 * How many verifications an edit has had, and how many failed.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} hash
 * @returns {{total: number, failed: number}}
 */
function attemptsFor(db, campaignId, hash) {
  const row = db
    .prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed FROM edit_verifications WHERE campaign_id = ? AND edl_hash = ?')
    .get(campaignId, hash);
  return { total: Number(row?.total ?? 0), failed: Number(row?.failed ?? 0) };
}

/**
 * Resolve a stored list's sources or refuse with every reason.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {any} edl
 */
function sourcesOrThrow(workspace, edl) {
  const resolved = resolveSources(workspace.requireDb(), workspace.requireRoot(), edl.sources);
  if (resolved.problems.length > 0) {
    throw new UserFacingError(`This edit cannot be rendered: ${resolved.problems[0]}`, {
      code: 'edl_sources_unavailable',
      details: { problems: resolved.problems },
    });
  }
  return resolved.sources;
}

/**
 * @param {string} text
 * @returns {string}
 */
function slug(text) {
  return basename(text, extname(text)).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'clip';
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const editingTools = [
  defineTool({
    name: 'video_timeline_view',
    description:
      'Draw one picture of a stretch of video: a strip of frames above the sound waveform, with the quiet gaps marked, to decide where to cut.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        path: { type: 'string' },
        start: { type: 'number', minimum: 0, description: 'Seconds. Default 0.' },
        end: { type: 'number', minimum: 0, description: 'Seconds. Default the end, capped at 60 seconds after start.' },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = workspace.requireRoot();
      const target = resolveTarget(args, workspace);
      const probe = await probeFile(target.path);
      const duration = probe.duration ?? 0;
      if (!probe.has_video && !probe.has_audio) throw new InvalidInputError('That file has neither picture nor sound to draw.');
      const start = Number(args.start) || 0;
      if (start >= duration) {
        throw new InvalidInputError(`That file is only ${duration.toFixed(2)} seconds long, so it cannot start at ${start}.`);
      }
      const asked = Number.isFinite(Number(args.end)) ? Number(args.end) : duration;
      if (asked <= start) throw new InvalidInputError('The end of the window must come after its start.');
      const end = Math.min(asked, duration, start + MAX_WINDOW_S);
      const silences = probe.has_audio ? await detectSilences(target.path, { start, end, noiseDb: -40, minSeconds: 0.4 }) : [];
      const transcript = target.asset
        ? readTranscript(workspace.requireDb(), root, { id: target.asset.id, sha256: target.asset.sha256 ?? null })
        : null;
      const phrases = phrasesFor('S', transcript).map((phrase, index) => ({
        number: index + 1,
        start_s: phrase.start_s,
        end_s: phrase.end_s,
        text: phrase.text,
      }));
      const inWindow = phrases.filter((phrase) => phrase.start_s <= end && phrase.end_s >= start);
      const out = join(root, 'imports', 'timeline', `${slug(target.path)}-${target.asset?.id ?? 'file'}-${start.toFixed(2)}-${end.toFixed(2)}.png`);
      const drawn = await renderTimeline({
        filePath: target.path,
        outPath: out,
        probe,
        start,
        end,
        silences,
        phrases: inWindow.map((phrase) => ({ id: `#${phrase.number}`, start_s: phrase.start_s, end_s: phrase.end_s })),
      });
      return {
        ok: true,
        image_path: drawn.image_path,
        start_s: start,
        end_s: Math.round(end * 1000) / 1000,
        frames: drawn.frames,
        silences,
        width: drawn.width,
        height: drawn.height,
        phrases: inWindow,
        note:
          asked > start + MAX_WINDOW_S
            ? `One view covers at most ${MAX_WINDOW_S} seconds, so this one stops at ${end.toFixed(2)} s.`
            : null,
        hint: 'Read the image file to look at it. Orange marks #n are phrase n of this clip in the packed transcript.',
      };
    },
  }),

  defineTool({
    name: 'video_pack_transcript',
    description:
      'Put the word level transcripts of several clips into one compact, timestamped text, so an edit can be planned from what is said.',
    inputSchema: {
      type: 'object',
      properties: { asset_ids: { type: 'array', minItems: 1, items: { type: 'string' } } },
      required: ['asset_ids'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const assetIds = /** @type {string[]} */ (args.asset_ids).map((id) => String(id));
      /** @type {import('../editing/pack.mjs').PackSource[]} */
      const sources = [];
      /** @type {string[]} */
      const missing = [];
      assetIds.forEach((assetId, index) => {
        const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
        if (!row) throw new InvalidInputError(`There is no asset ${assetId} in the creative library.`);
        const transcript = readTranscript(db, root, { id: assetId, sha256: row.sha256 ? String(row.sha256) : null });
        if (!transcript) missing.push(assetId);
        sources.push({
          source_id: `S${index + 1}`,
          asset_id: assetId,
          filename: basename(String(row.path)),
          duration_s: row.duration == null ? null : Number(row.duration),
          transcript,
        });
      });
      const packed = packTranscripts(sources);
      const key = createHash('sha256').update(assetIds.join('\n')).digest('hex').slice(0, 16);
      const folder = join(root, 'imports', 'edit');
      mkdirSync(folder, { recursive: true });
      const path = join(folder, `packed-${key}.md`);
      writeFileSync(path, packed.text, 'utf8');
      return {
        ok: true,
        text: packed.text,
        path,
        sources: sources.map((source) => ({
          source_id: source.source_id,
          asset_id: source.asset_id,
          duration_s: source.duration_s,
          transcript_id: source.transcript?.transcript_id ?? null,
        })),
        phrases: packed.phrases,
        missing,
      };
    },
  }),

  defineTool({
    name: 'video_build_edl',
    description:
      'Check and store an edit decision list for a job: which clips, in which order, cut where. Snaps cuts to word boundaries, ' +
      'adds padding, and lists any problem before anything is rendered.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        edl: { type: 'object', description: 'An EditDecisionList, schemas/edit-decision-list.schema.json.' },
      },
      required: ['campaign_id', 'edl'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      requireCampaign(db, campaignId);
      const checked = checkEdl({ db, workspaceRoot: root, campaignId, edl: args.edl });
      if (!checked.ok) return { ok: false, problems: checked.problems, warnings: checked.warnings };

      const folder = generatedDir(root, campaignId);
      const saved = saveArtifact(db, campaignId, 'EditDecisionList', (version) => ({ ...checked.edl, id: `EditDecisionList:${version}` }), null);
      const filePath = join(folder, `edit-decision-list-v${saved.version}.json`);
      writeFileSync(filePath, `${JSON.stringify(saved.json, null, 2)}\n`, 'utf8');
      db.prepare('UPDATE artifacts SET path = ? WHERE id = ?').run(filePath, saved.id);
      return {
        ok: true,
        edl_id: `EditDecisionList:${saved.version}`,
        version: saved.version,
        edl: saved.json,
        duration_s: checked.duration_s,
        warnings: checked.warnings,
        adjustments: checked.adjustments,
        path: filePath,
      };
    },
  }),

  defineTool({
    name: 'video_render_edl',
    description: 'Render a stored edit decision list into a finished video for one platform preset, on this computer, without changing any source file.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        edl_id: { type: 'string', description: 'The edl_id video_build_edl returned.' },
        preset: { type: 'string', enum: RENDER_PRESETS },
      },
      required: ['campaign_id', 'edl_id', 'preset'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      requireCampaign(db, campaignId);
      const preset = String(args.preset);
      if (!RENDER_PRESETS.includes(preset)) {
        throw new InvalidInputError(`There is no render preset called "${preset}".`, { fix: `Choose one of: ${RENDER_PRESETS.join(', ')}.` });
      }
      const { version, edl } = readEdl(db, campaignId, String(args.edl_id));
      const hash = edlHash(edl);
      const attempts = attemptsFor(db, campaignId, hash);
      if (attempts.failed >= ATTEMPT_CAP) {
        return { ok: false, blocked: 'attempt_cap', attempt: attempts.total, retries_left: 0, message: ATTEMPT_CAP_MESSAGE };
      }
      const sources = sourcesOrThrow(workspace, edl);

      const folder = generatedDir(root, campaignId);
      const name = `edit-v${version}-${preset}-${newId().slice(-6).toLowerCase()}`;
      const rendered = await renderEdl({ db, edl, sources, preset, outDir: folder, name });
      const registered = await registerFile({ db, workspaceRoot: root, path: rendered.out_path, origin: 'generated', campaignId });
      const asset = registered.asset;

      const rowId = newId();
      db.prepare(
        'INSERT INTO edit_renders (id, campaign_id, render_id, edl_version, edl_hash, preset, path, json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(rowId, campaignId, asset.id, version, hash, preset, asset.path, toJsonColumn({ ...rendered, path: asset.path, preset }), nowIso());

      if (rendered.srt_path && rendered.cues.length > 0) {
        saveArtifact(
          db,
          campaignId,
          'SubtitlePackage',
          () => ({
            schema_version: 1,
            asset_id: asset.id,
            language: sources.values().next().value?.transcript?.language ?? 'en',
            source: 'transcription',
            cues: rendered.cues.map((cue) => ({ start_s: cue.start, end_s: cue.end, text: cue.text })),
            files: { srt_path: rendered.srt_path, vtt_path: rendered.vtt_path, burned_in_path: rendered.subtitles_mode === 'burn_in' ? asset.path : null },
            style: null,
            summary: `${rendered.cues.length} subtitle cues on the cut timeline of edit ${version}, ${rendered.subtitles_mode === 'burn_in' ? 'burned in' : 'as a separate file'}.`,
          }),
          rendered.srt_path,
        );
      }
      if (readManifest(db, campaignId)) {
        attachDerivedAsset(db, campaignId, {
          asset_id: asset.id,
          kind: 'video',
          path: asset.path,
          provider: 'local',
          prompt: null,
          panel_id: `edit:EditDecisionList:${version}:${preset}`,
          aspect_ratio: `${rendered.width}x${rendered.height}`,
        });
      }
      logEvent(db, campaignId, 'asset.generated', {
        asset_id: asset.id,
        kind: 'video',
        source: 'edit_render',
        edl_id: `EditDecisionList:${version}`,
        preset,
        duration_s: rendered.duration_s,
      });
      return {
        ok: true,
        render_id: asset.id,
        asset,
        path: asset.path,
        duration_s: rendered.duration_s,
        preset,
        edl_id: `EditDecisionList:${version}`,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.fps,
        subtitles: { mode: rendered.subtitles_mode, srt_path: rendered.srt_path, vtt_path: rendered.vtt_path, cues: rendered.cues.length },
        loudness_normalised: rendered.loudness_normalised,
        warnings: rendered.warnings,
        next: 'Check it with video_verify_render before showing it to anyone.',
      };
    },
  }),

  defineTool({
    name: 'video_verify_render',
    description:
      'Check a rendered video against its edit: length, picture size, black or frozen frames, silence, jumps in sound at the cuts and subtitle timing.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        render_id: { type: 'string', description: 'The render_id video_render_edl returned.' },
      },
      required: ['campaign_id', 'render_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      const renderId = String(args.render_id);
      const row = db
        .prepare('SELECT * FROM edit_renders WHERE campaign_id = ? AND render_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
        .get(campaignId, renderId);
      if (!row) throw new InvalidInputError('This job has no render with that id.', { fix: 'Use the render_id video_render_edl returned.' });
      const hash = String(row.edl_hash);
      const before = attemptsFor(db, campaignId, hash);
      if (before.failed >= ATTEMPT_CAP) {
        return { ok: false, blocked: 'attempt_cap', passed: false, attempt: before.total, retries_left: 0, message: ATTEMPT_CAP_MESSAGE };
      }
      const { edl } = readEdl(db, campaignId, String(row.edl_version));
      const sources = sourcesOrThrow(workspace, edl);
      const render = /** @type {any} */ (parseJson(String(row.json), {}));
      render.path = String(row.path);
      render.preset = String(row.preset);
      const attempt = before.total + 1;
      const sheetPath = join(generatedDir(root, campaignId), 'verify', `${renderId}-attempt-${attempt}.png`);
      const result = await verifyRender({ render, edl, sources, sheetPath });

      db.prepare(
        'INSERT INTO edit_verifications (id, campaign_id, edit_render_id, render_id, edl_version, edl_hash, attempt, passed, json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(newId(), campaignId, String(row.id), renderId, Number(row.edl_version), hash, attempt, result.passed ? 1 : 0, toJsonColumn(result), nowIso());
      const failed = before.failed + (result.passed ? 0 : 1);
      const retriesLeft = Math.max(0, ATTEMPT_CAP - failed);
      return {
        ok: true,
        passed: result.passed,
        checks: result.checks,
        frames: result.frames,
        attempt,
        retries_left: retriesLeft,
        reasons: result.checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail}`),
        suggested_fix: result.suggested_fix,
        message: result.passed
          ? 'The render passed. Look at the frame sheet with Read before showing it.'
          : retriesLeft > 0
            ? `The render failed ${failed} of ${ATTEMPT_CAP} allowed times. Fix the edit, save it, render and check again.`
            : ATTEMPT_CAP_MESSAGE,
      };
    },
  }),
];
