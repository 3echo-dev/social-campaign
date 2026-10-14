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

/** What the agent is told when an edit has used its verification attempts. */
const ATTEMPT_CAP_MESSAGE =
  `This edit has failed its check ${ATTEMPT_CAP} times. Stop here: show the user the last frame sheet and ` +
  'what failed, and ask how they want to go on before changing the edit again.';

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

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const editingTools = [

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
