/**
 * Generation tools: media plan, cost estimate, the generation manifest, subtitles
 * and the final edit.
 *
 * Nothing in this file calls a generation provider. 3echo Studio and ElevenLabs are
 * remote MCP servers that Claude is signed in to, so the calls that spend credits
 * are made by the media-producer agent, not by this process. What lives here is
 * everything that must be true around those calls: the plan, the price, the cost
 * gate guard, where files land, and what the campaign remembers afterwards.
 *
 * The guard is the point of the module. generation_begin is the only way an item
 * moves into `generating`, and it refuses unless the campaign has an approved cost
 * review and the connection the item needs.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { parseJson, toJsonColumn, updateJsonFile } from '../lib/json.mjs';
import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { integrationsPath } from '../lib/paths.mjs';
import { loadSchema, validateAgainstSchema } from '../planner/validate.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';
import { registerFile } from '../media/ingest.mjs';
import { thumbsRoot } from '../media/frames.mjs';
import { buildEstimate } from '../generation/estimate.mjs';
import {
  attachDerivedAsset,
  beginItem,
  completeItem,
  createManifest,
  ledgerFor,
  markOutcomeUnknown,
  markRegenerate,
  readManifest,
  recordEstimate,
  requireItem,
  requireManifest,
  toPackage,
} from '../generation/manifest.mjs';
import { probeFile } from '../media/probe.mjs';
import { showConnections, THREEECHO_CONNECTOR_GUIDANCE } from './connections.mjs';
import { chunkSegments, renderSubtitles, toPackageCues, toSrt, toVtt } from '../generation/subtitles.mjs';
import {
  applyOperations,
  coverFrame,
  derivedPath,
  exportForPlatform,
  generatedDir,
  isImagePath,
  PLATFORM_PRESETS,
} from '../generation/edit.mjs';

/** What the user is shown when 3echo is needed and not connected, registry section 10. */
const THREEECHO_CONNECT_COPY = {
  provider: 'threeecho_studio',
  title: 'Image & Video Generation',
  providerLabel: '3echo Studio',
  reason: '3echo Studio needs to be connected before I can generate the approved creative.',
  connectLabel: 'Connect 3echo Studio',
};

/** The same, for voice and audio. */
const ELEVENLABS_CONNECT_COPY = {
  provider: 'elevenlabs',
  title: 'Voice & Audio',
  providerLabel: 'ElevenLabs',
  reason: 'ElevenLabs needs to be connected before I can make the voiceover or audio for this.',
  connectLabel: 'Connect ElevenLabs',
};

/** Which items need which connection. */
const PROVIDER_FOR_KIND = { image: 'threeecho_studio', video: 'threeecho_studio', voice: 'elevenlabs', audio: 'elevenlabs' };
const PROBE_PROVIDERS = ['threeecho_studio', 'elevenlabs'];

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Record one provider probe atomically.
 *
 * A session can expose the same provider under the plugin registration and under
 * a person's own connector. A failed check against one namespace must not replace
 * a working record established by the other namespace, so the decision is made
 * inside the locked JSON read-modify-write operation rather than from a stale
 * read followed by a separate write.
 *
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{provider: string, ok: boolean, detail: string, namespace: string|null}} input
 * @returns {{state: string, namespace: string|null, providers: Record<string, unknown>}}
 */
function recordIntegrationProbe(workspace, input) {
  const at = nowIso();
  const lastProbe = {
    ok: input.ok,
    namespace: input.namespace,
    detail: input.detail,
    at,
  };
  let observedState = input.ok ? 'connected' : 'degraded';
  let observedNamespace = input.namespace;
  const updated = updateJsonFile(
    integrationsPath(workspace.requireRoot()),
    (current) => {
      const currentProviders =
        current && typeof current === 'object' && !Array.isArray(current) && current.providers && typeof current.providers === 'object' && !Array.isArray(current.providers)
          ? current.providers
          : {};
      const providers = { ...currentProviders };
      const previous =
        providers[input.provider] && typeof providers[input.provider] === 'object' && !Array.isArray(providers[input.provider])
          ? providers[input.provider]
          : {};
      const previousState = typeof previous.state === 'string' ? previous.state : '';
      const previousNamespace = optionalString(previous.namespace);
      const failedAlternateNamespace =
        !input.ok &&
        (previousState === 'connected' || previousState === 'ready') &&
        Boolean(previousNamespace && input.namespace && previousNamespace !== input.namespace);

      const state = failedAlternateNamespace ? previousState : input.ok ? 'connected' : 'degraded';
      const record = {
        ...previous,
        state,
        detail: failedAlternateNamespace ? previous.detail ?? null : input.detail,
        updated_at: at,
        last_probe: lastProbe,
      };
      if (input.namespace && !failedAlternateNamespace) record.namespace = input.namespace;
      observedState = state;
      observedNamespace = optionalString(record.namespace);
      providers[input.provider] = record;
      return { ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}), providers };
    },
    { providers: {} },
  );
  const providers =
    updated && typeof updated === 'object' && !Array.isArray(updated) && updated.providers && typeof updated.providers === 'object' && !Array.isArray(updated.providers)
      ? updated.providers
      : {};
  return { state: observedState, namespace: observedNamespace, providers };
}

/**
 * Reconstruct the canonical generation request for an item straight from the media
 * plan that was actually priced, for a caller that passed only a bare `prompt`. The
 * field defaults mirror `estimate.mjs`'s `itemRequestHash` exactly, so the hash this
 * produces is the same hash `cost_estimate` already computed and `review_cost`
 * already approved.
 *
 * Every priced field (everything but the prompt) comes from the plan, not from the
 * caller, on purpose: a bare `prompt` is the legacy, unbound shorthand, so those
 * fields can only ever resolve to what was actually priced. The prompt itself comes
 * from the manifest item's own current prompt, which already reflects an approved
 * `generation_regenerate` (headroom-gated, not hash-gated); a caller who means to
 * submit a materially different prompt on a first attempt has to say so through
 * `request`, which this cost gate will then correctly refuse until it is
 * re-estimated and re-approved.
 * @param {any} manifest
 * @param {any} item the manifest item, for its current prompt.
 * @returns {Record<string, unknown>}
 */
function requestFromPlan(manifest, item) {
  const planItem = (Array.isArray(manifest?.media_plan?.items) ? manifest.media_plan.items : []).find(
    (entry) => String(entry.id) === String(item.id),
  );
  const source = planItem ?? {};
  return {
    tool: source.kind === 'video' ? 'create_video_job' : 'create_image_job',
    provider: '3echo_studio',
    model: source.model ?? null,
    prompt: item.prompt ?? source.prompt ?? null,
    reference_asset_ids: source.reference_asset_ids ?? [],
    duration_s: source.duration_s ?? null,
    resolution: source.resolution ?? null,
    ratio: source.ratio ?? null,
    generate_audio: source.generate_audio ?? false,
    count: source.count ?? 1,
  };
}

/**
 * Is a provider connected, according to integrations.json?
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} provider
 * @returns {boolean}
 */
function isConnected(workspace, provider) {
  const record = workspace.readIntegrations()[provider];
  const state = record && typeof record === 'object' ? String(/** @type {any} */ (record).state ?? '') : '';
  return state === 'connected' || state === 'ready';
}

/**
 * Show the canonical Connections page focused on one provider.
 * @param {import('../ui/server.mjs').UiServer} ui
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{provider: string, title: string, providerLabel: string, reason: string, connectLabel: string}} copy
 * @param {string} [reason]
 */
async function showConnect(ui, workspace, copy, reason) {
  const focus = copy.provider === 'elevenlabs' ? 'voice_audio' : 'image_video';
  const screen = await showConnections(ui, workspace, {
    focus,
    reason: reason ?? copy.reason,
  });
  return { url: ui.url(), screenId: screen.screenId, provider: copy.provider, message: reason ?? copy.reason };
}

/**
 * @param {any} db
 * @param {string} assetId
 * @returns {{id: string, path: string, kind: string, duration: number|null, width: number|null, height: number|null}}
 */
function requireAssetRow(db, assetId) {
  const row = db.prepare('SELECT id, path, kind, duration, width, height FROM assets WHERE id = ?').get(assetId);
  if (!row) throw new InvalidInputError('No asset with that id is in the library.');
  return {
    id: String(row.id),
    path: String(row.path),
    kind: String(row.kind),
    duration: row.duration == null ? null : Number(row.duration),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
  };
}

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
 * Store a contract artifact, checked against its schema, the same way artifact_save
 * does. Used for SubtitlePackage, which generation writes on the user's behalf.
 * @param {any} db
 * @param {string} campaignId
 * @param {string} kind
 * @param {any} json
 * @param {string|null} [path]
 * @returns {{id: string, version: number}}
 */
function saveContractArtifact(db, campaignId, kind, json, path = null) {
  const problems = validateAgainstSchema(loadSchema(kind), json);
  if (problems.length > 0) {
    throw new InvalidInputError(`That ${kind} result is not complete: ${problems[0]}`, { details: { problems } });
  }
  const version =
    Number(
      db.prepare('SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = ?').get(campaignId, kind)
        ?.version ?? 0,
    ) + 1;
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
  return { id, version };
}

/**
 * @param {any} db
 * @param {string} campaignId
 * @returns {any|null}
 */
function readSubtitlePackage(db, campaignId, assetId) {
  const json = currentArtifact(db, campaignId, 'SubtitlePackage')?.json ?? null;
  return json && String(/** @type {any} */ (json).asset_id) === assetId ? json : null;
}

/**
 * Download a generated file the provider handed back as a url.
 * @param {string} url
 * @param {string} folder
 * @param {string} nameHint
 * @returns {Promise<string>} the file it was saved to
 */
async function downloadTo(url, folder, nameHint) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new UserFacingError('That generated file could not be downloaded.', {
      code: 'download_failed',
      fix: 'Try the download again, or ask for the file to be made again.',
    });
  }
  if (!response.ok) {
    throw new UserFacingError('That generated file could not be downloaded.', {
      code: 'download_failed',
      details: { status: response.status },
    });
  }
  const fromUrl = extname(new URL(url).pathname);
  const extension = fromUrl && fromUrl.length <= 5 ? fromUrl : extensionForType(response.headers.get('content-type'));
  mkdirSync(folder, { recursive: true });
  const target = join(folder, `${nameHint}${extension}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

/**
 * @param {string|null} contentType
 * @returns {string}
 */
function extensionForType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim();
  const known = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
  };
  return known[type] ?? '.bin';
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const generationTools = [
  defineTool({
    name: 'media_plan_save',
    description:
      'Store what this job is going to make: a list of items, each with an id, a kind (image, video, voice, ' +
      'audio or subtitle), how many, and for video items the quote from the provider. Saving the plan again ' +
      'keeps the progress of anything already made.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        media_plan: {
          type: 'object',
          description:
            '{ items: [{id, kind, count, duration_s?, resolution?, ratio?, prompt?, text?, provider_quote?}], ' +
            'regeneration_headroom?: {images, videos, video_credits_each} }',
        },
      },
      required: ['campaign_id', 'media_plan'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const mediaPlan = /** @type {any} */ (args.media_plan) ?? {};
      // Price it once now so a malformed plan is refused here rather than at the gate.
      buildEstimate({ media_plan: mediaPlan });
      const { manifest, version } = createManifest(db, campaignId, mediaPlan);
      return { ok: true, version, items: manifest.items, summary: manifest.summary };
    },
  }),

  defineTool({
    name: 'cost_estimate',
    description:
      'Work out what this job will cost from its saved media plan and keep the result. Images are one credit ' +
      'each. Video items use the quote in the plan; anything still missing a quote is listed in needs_quote ' +
      'and must be quoted before the cost approval is worth showing.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const manifest = requireManifest(db, campaignId);
      const estimate = buildEstimate({ media_plan: manifest.media_plan ?? {} });
      const saved = recordEstimate(db, campaignId, estimate);
      logEvent(db, campaignId, 'cost.estimated', {
        total_credits: estimate.total_credits,
        needs_quote: estimate.needs_quote.length,
      });
      return { ok: true, estimate, ledger: ledgerFor(saved) };
    },
  }),

  defineTool({
    name: 'generation_begin',
    description:
      'Say that one item from the media plan is about to be made, before calling the provider. This is the ' +
      'cost guard: it refuses unless this job has an approved cost review, unless the exact request matches ' +
      'what was priced and approved for this item, unless the running spend still has room, and unless the ' +
      "hero-first rule for a video batch is satisfied. It also refuses when the provider that item needs is " +
      'not connected yet. Pass "request" as the exact request you are about to submit to the provider: tool, ' +
      'model, prompt, reference_asset_ids, duration_s, resolution, ratio, generate_audio, count; a field the plan did not ' +
      'set may be left out, since it means the same default the estimate used. On success, ' +
      'pass the returned idempotency_key into the 3echo submission call. Never call a generation tool for an ' +
      'item this has not cleared. A bare "prompt" string is still accepted for a plan item that has no other ' +
      'priced fields (image or simple video with nothing else set); it is resolved against the media plan the ' +
      'same way "request" would be, so the hash still has to match what was estimated.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        item_id: { type: 'string' },
        provider_job_id: { type: 'string', description: 'The provider job id, when it is already known.' },
        request: {
          type: 'object',
          description:
            'The exact request about to be submitted: { tool, model?, prompt, reference_asset_ids?, ' +
            'duration_s?, resolution?, ratio?, generate_audio?, count? }. Its hash must match the item that ' +
            'was priced at cost_estimate and approved at review_cost.',
        },
        prompt: {
          type: 'string',
          description:
            'Accepted for backward compatibility only and otherwise ignored: when "request" is omitted, the ' +
            'request is rebuilt from the media plan item, using its current prompt (the one on file, including ' +
            'after generation_regenerate), not this argument. Pass "request" to submit a genuinely different prompt.',
        },
      },
      required: ['campaign_id', 'item_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const itemId = String(args.item_id);
      const manifest = requireManifest(db, campaignId);
      const item = requireItem(manifest, itemId);

      const provider = PROVIDER_FOR_KIND[item.kind];
      if (provider && !isConnected(workspace, provider)) {
        const copy = provider === 'elevenlabs' ? ELEVENLABS_CONNECT_COPY : THREEECHO_CONNECT_COPY;
        return {
          ok: false,
          blocked: provider === 'elevenlabs' ? 'connect_elevenlabs' : 'connect_threeecho',
          ...(await showConnect(ui, workspace, copy)),
        };
      }

      // "request" is the real contract; a bare "prompt" resolves against the media
      // plan item that was actually priced, so a caller who has nothing else to
      // report (an image, or a video whose duration/resolution/ratio/references never
      // left the plan) does not have to restate every field by hand. Either way the
      // hash generation_begin checks below is the one cost_estimate already computed.
      const request = args.request ? /** @type {any} */ (args.request) : requestFromPlan(manifest, item);
      try {
        const started = beginItem({
          db,
          campaign_id: campaignId,
          item_id: itemId,
          request,
          provider_job_id: optionalString(args.provider_job_id) ?? undefined,
        });
        return {
          ok: true,
          item: started.item,
          cost_approval_id: started.cost_approval_id,
          idempotency_key: started.idempotency_key,
          summary: started.manifest.summary,
        };
      } catch (error) {
        if (error instanceof UserFacingError) {
          const knownCodes = ['needs_cost_approval', 'outcome_unknown', 'stale_approval', 'request_changed', 'spend_cap_exceeded', 'hero_first_required'];
          if (knownCodes.includes(error.code)) {
            return { ok: false, blocked: error.code, message: error.message, fix: error.fix, details: error.details ?? null };
          }
        }
        throw error;
      }
    },
  }),

  defineTool({
    name: 'generation_outcome_unknown',
    description:
      'Record that a submission to the provider ended without a known result: a timeout, a crash, or any ' +
      'other case where you cannot tell whether it went through. This never auto-retries. The item is parked ' +
      'until a human clears it at media review or a fresh cost approval is granted.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        item_id: { type: 'string' },
        detail: { type: 'string', description: 'One plain sentence about what happened.' },
      },
      required: ['campaign_id', 'item_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const result = markOutcomeUnknown(db, campaignId, String(args.item_id), optionalString(args.detail));
      logEvent(db, campaignId, 'generation.outcome_unknown', { item_id: String(args.item_id), detail: optionalString(args.detail) });
      return {
        ok: true,
        item: result.item,
        summary: result.manifest.summary,
        message: 'Recorded as an unclear outcome. I will not try this again on my own; it needs a human decision.',
      };
    },
  }),

  defineTool({
    name: 'generation_complete',
    description:
      'Record what the provider produced for one item: pass either the file on this computer or the url to ' +
      'download. The file is kept with the job, added to the creative library as generated work, and the ' +
      'item is marked as made.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        item_id: { type: 'string' },
        file_path: { type: 'string', description: 'Absolute path to the file the provider produced.' },
        url: { type: 'string', description: 'A url to download instead, when the provider returned one.' },
        kind: { type: 'string', description: 'image, video or audio.' },
        brand_id: { type: 'string' },
        idempotency_key: { type: 'string', description: 'The key generation_begin returned for this attempt.' },
        requested_audio: {
          type: 'boolean',
          description: 'Whether this video was requested with an audio track. Checked against the imported file.',
        },
      },
      required: ['campaign_id', 'item_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      const itemId = String(args.item_id);
      const manifest = requireManifest(db, campaignId);
      const item = requireItem(manifest, itemId);
      if (workspace.root) ui.thumbsRoot = thumbsRoot(workspace.root);

      const folder = generatedDir(root, campaignId);
      const filePath = optionalString(args.file_path);
      const url = optionalString(args.url);
      if (!filePath && !url) {
        throw new InvalidInputError('Tell me where the generated file is: either a file on this computer or a url.');
      }
      const source = filePath ?? (await downloadTo(String(url), folder, `${itemId}-${newId().slice(0, 8)}`));
      if (!existsSync(source)) throw new InvalidInputError('That generated file could not be found.');

      const registered = await registerFile({
        db,
        workspaceRoot: root,
        path: source,
        brandId: optionalString(args.brand_id),
        origin: 'generated',
        campaignId,
      });

      const duration = registered.asset.duration ?? null;
      let ratio = null;
      if (registered.asset.width && registered.asset.height) {
        ratio = `${registered.asset.width}x${registered.asset.height}`;
      }
      const kind = optionalString(args.kind) ?? registered.asset.kind ?? item.kind;

      // Import-time audio check: probe the file itself rather than trust what the
      // provider said it made, and flag a mismatch against what was requested.
      let audioCheck = null;
      if (kind === 'video' && typeof args.requested_audio === 'boolean') {
        try {
          const probed = await probeFile(registered.asset.path);
          audioCheck = { expected: Boolean(args.requested_audio), observed: Boolean(probed.has_audio) };
        } catch {
          audioCheck = null;
        }
      }

      const result = completeItem({
        db,
        campaign_id: campaignId,
        item_id: itemId,
        asset_id: registered.asset.id,
        path: registered.asset.path,
        kind: kind === 'voice' ? 'audio' : kind,
        duration_s: duration,
        aspect_ratio: ratio,
        idempotency_key: optionalString(args.idempotency_key) ?? undefined,
        audio_check: audioCheck,
      });
      logEvent(db, campaignId, 'asset.generated', {
        item_id: itemId,
        asset_id: registered.asset.id,
        kind,
        cost_approval_id: item.cost_approval_id ?? null,
        audio_mismatch: Boolean(result.audio_mismatch),
      });
      return {
        ok: true,
        asset: registered.asset,
        item: result.item,
        summary: result.manifest.summary,
        audio_mismatch: result.audio_mismatch,
      };
    },
  }),

  defineTool({
    name: 'generation_regenerate',
    description:
      'Mark one item to be made again, optionally with a new prompt, after the user asked for a change at ' +
      'media review. Making something again costs credits too: if the approved estimate did not leave room ' +
      'for it, this returns needs_cost_approval and nothing is started.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        item_id: { type: 'string' },
        new_prompt: { type: 'string' },
      },
      required: ['campaign_id', 'item_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const campaignId = String(args.campaign_id);
      const outcome = markRegenerate({
        db,
        campaign_id: campaignId,
        item_id: String(args.item_id),
        new_prompt: optionalString(args.new_prompt) ?? undefined,
      });
      if ('needs_cost_approval' in outcome) {
        return { ok: false, blocked: 'needs_cost_approval', message: outcome.reason };
      }
      return { ok: true, item: outcome.item, headroom_left: outcome.headroom_left, summary: outcome.manifest.summary };
    },
  }),

  defineTool({
    name: 'generation_package_get',
    description:
      'Read where generation has got to for this job: every planned item with its state, plus the package of ' +
      'finished media to show at media review.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const manifest = readManifest(db, String(args.campaign_id));
      if (!manifest) return { exists: false, manifest: null, package: null, ledger: null };
      return { exists: true, manifest, package: toPackage(manifest), ledger: ledgerFor(manifest) };
    },
  }),

  defineTool({
    name: 'subtitles_build',
    description:
      'Turn a transcript into subtitle files for one video: short cues of at most two lines, written next to ' +
      'the job as .srt and .vtt. Pass segments as [{start, end, text}] in seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        asset_id: { type: 'string' },
        segments: { type: 'array', description: '[{start, end, text}] in seconds, from the transcript.' },
        language: { type: 'string', description: 'A language tag such as en. Defaults to en.' },
        style: { type: 'object', description: 'Optional look for a burned in render: font_family, font_size, position.' },
      },
      required: ['campaign_id', 'asset_id', 'segments'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      const assetId = String(args.asset_id);
      const asset = requireAssetRow(db, assetId);
      const segments = Array.isArray(args.segments) ? args.segments : [];
      if (segments.length === 0) {
        throw new InvalidInputError('There is no transcript to make subtitles from.', {
          fix: 'Transcribe the video first, then try again.',
        });
      }
      const cues = chunkSegments(/** @type {any} */ (segments));
      const folder = generatedDir(root, campaignId);
      const stem = basename(asset.path, extname(asset.path)).replace(/[^\w.-]+/g, '-');
      const srtPath = join(folder, `${stem}.srt`);
      const vttPath = join(folder, `${stem}.vtt`);
      writeFileSync(srtPath, toSrt(cues), 'utf8');
      writeFileSync(vttPath, toVtt(cues), 'utf8');

      const style = /** @type {any} */ (args.style) ?? null;
      const subtitlePackage = {
        schema_version: 1,
        asset_id: assetId,
        language: optionalString(args.language) ?? 'en',
        source: 'transcription',
        cues: toPackageCues(cues),
        files: { srt_path: srtPath, vtt_path: vttPath, burned_in_path: null },
        style: style
          ? {
              font_family: style.font_family ?? null,
              font_size: style.font_size ?? null,
              position: style.position ?? 'bottom',
              max_chars_per_line: 32,
              max_lines: 2,
            }
          : null,
        summary: `${cues.length} subtitle cue${cues.length === 1 ? '' : 's'} ready as .srt and .vtt.`,
      };
      const saved = saveContractArtifact(db, campaignId, 'SubtitlePackage', subtitlePackage, srtPath);
      return { ok: true, version: saved.version, srt_path: srtPath, vtt_path: vttPath, cues: subtitlePackage.cues };
    },
  }),

  defineTool({
    name: 'subtitles_render',
    description:
      'Burn the subtitles already built for a video into a copy of it, so the captions are visible with the ' +
      'sound off. The new file is added to the library and kept with the job.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        asset_id: { type: 'string' },
        style: { type: 'object', description: 'font_family, font_size, position (top, middle, lower_third, bottom).' },
      },
      required: ['campaign_id', 'asset_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      const assetId = String(args.asset_id);
      const asset = requireAssetRow(db, assetId);
      const subtitlePackage = readSubtitlePackage(db, campaignId, assetId);
      if (!subtitlePackage) {
        throw new InvalidInputError('This video has no subtitles yet.', { fix: 'Build the subtitles first.' });
      }
      if (workspace.root) ui.thumbsRoot = thumbsRoot(workspace.root);

      const folder = generatedDir(root, campaignId);
      const outPath = derivedPath(folder, asset.path, 'subtitled', '.mp4');
      const style = { ...(subtitlePackage.style ?? {}), ...(/** @type {any} */ (args.style) ?? {}) };
      await renderSubtitles({
        video_path: asset.path,
        srt_path: String(subtitlePackage.files?.srt_path),
        out_path: outPath,
        style,
      });

      const registered = await registerFile({
        db,
        workspaceRoot: root,
        path: outPath,
        origin: 'generated',
        campaignId,
      });
      saveContractArtifact(
        db,
        campaignId,
        'SubtitlePackage',
        { ...subtitlePackage, files: { ...subtitlePackage.files, burned_in_path: registered.asset.path } },
        registered.asset.path,
      );
      if (readManifest(db, campaignId)) {
        attachDerivedAsset(db, campaignId, {
          asset_id: registered.asset.id,
          kind: 'video',
          path: registered.asset.path,
          provider: 'local',
          prompt: null,
          panel_id: `subtitled:${assetId}`,
        });
      }
      return { ok: true, asset: registered.asset, path: registered.asset.path };
    },
  }),

  defineTool({
    name: 'edit_export',
    description:
      'Make the platform ready files from one asset: ' +
      Object.keys(PLATFORM_PRESETS).join(', ') +
      '. Optional operations are applied first: trim, joining other clips on the end, and adding an audio ' +
      'track such as a voiceover over music. Every file is added to the library and a cover frame is taken.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        asset_id: { type: 'string' },
        platforms: { type: 'array', description: 'One or more preset names.' },
        operations: {
          type: 'object',
          description:
            '{ trim: {start, duration|end}, concat_with: [paths], audio: {path, mode: mix|replace, duck, ' +
            'voice_volume, bed_volume}, fit: pad|crop, cover_at: seconds }',
        },
      },
      required: ['campaign_id', 'asset_id', 'platforms'],
      additionalProperties: false,
    },
    handler: async (args, { workspace, ui }) => {
      const db = workspace.requireDb();
      const root = workspace.requireRoot();
      const campaignId = String(args.campaign_id);
      const asset = requireAssetRow(db, String(args.asset_id));
      const platforms = (Array.isArray(args.platforms) ? args.platforms : []).map((entry) => String(entry));
      if (platforms.length === 0) throw new InvalidInputError('Say which platforms to export for.');
      for (const platform of platforms) {
        if (!PLATFORM_PRESETS[platform]) {
          throw new InvalidInputError(`Social Campaign does not have a size for "${platform}".`, {
            fix: `Choose from: ${Object.keys(PLATFORM_PRESETS).join(', ')}.`,
          });
        }
      }
      if (workspace.root) ui.thumbsRoot = thumbsRoot(workspace.root);

      const operations = /** @type {any} */ (args.operations) ?? {};
      const folder = generatedDir(root, campaignId);
      const prepared = isImagePath(asset.path)
        ? { path: asset.path, applied: [] }
        : await applyOperations({ input: asset.path, out_dir: folder, operations });

      /** @type {any[]} */
      const exports = [];
      for (const platform of platforms) {
        const result = await exportForPlatform({
          input: prepared.path,
          out_dir: folder,
          platform,
          fit: operations.fit === 'crop' ? 'crop' : 'pad',
        });
        const registered = await registerFile({
          db,
          workspaceRoot: root,
          path: result.path,
          origin: 'generated',
          campaignId,
        });
        if (readManifest(db, campaignId)) {
          attachDerivedAsset(db, campaignId, {
            asset_id: registered.asset.id,
            kind: isImagePath(result.path) ? 'image' : 'video',
            path: registered.asset.path,
            provider: 'local',
            prompt: null,
            panel_id: `export:${platform}:${asset.id}`,
            aspect_ratio: `${result.width}x${result.height}`,
          });
        }
        exports.push({
          platform,
          label: result.label,
          path: registered.asset.path,
          asset_id: registered.asset.id,
          width: result.width,
          height: result.height,
          fit: result.fit,
        });
      }

      let cover = null;
      if (!isImagePath(prepared.path)) {
        const coverPath = derivedPath(folder, prepared.path, 'cover', '.jpg');
        await coverFrame({ input: prepared.path, out: coverPath, at: Number(operations.cover_at) || 0 });
        cover = coverPath;
      }

      return { ok: true, applied: prepared.applied, exports, cover_frame: cover };
    },
  }),

  defineTool({
    name: 'integration_connect_threeecho_open',
    description:
      '3Echo Studio connects only through the person\'s own claude.ai connector, so this opens no sign-in of ' +
      'its own. Call it when image or video generation is next and 3Echo Studio is not present yet; it returns ' +
      'plain guidance for adding the connector in claude.ai and coming back once it is added.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const reason = optionalString(args.reason);
      return {
        ok: true,
        provider: 'threeecho_studio',
        message: reason ? `${reason} ${THREEECHO_CONNECTOR_GUIDANCE}` : THREEECHO_CONNECTOR_GUIDANCE,
      };
    },
  }),

  defineTool({
    name: 'integration_connect_elevenlabs_open',
    description:
      'Show the canonical Connections page focused on ElevenLabs when a voiceover, sound or transcript is next ' +
      'and the provider is not connected. Wait with ui_wait; the action contract is check_again, fix_in_chat, skip or continue_home.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (args, { ui, workspace }) => showConnect(ui, workspace, ELEVENLABS_CONNECT_COPY, optionalString(args.reason) ?? undefined),
  }),

  defineTool({
    name: 'integration_probe',
    description:
      'Report whether a call to a connected provider actually worked, so the rest of Social Campaign knows ' +
      'what is really available. Call it after the first real call to 3echo Studio or ElevenLabs in a ' +
      'session and include the namespace that answered when one is available. A failed check in another ' +
      'namespace does not discard an already connected provider.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: PROBE_PROVIDERS, description: 'threeecho_studio or elevenlabs.' },
        ok: { type: 'boolean' },
        namespace: { type: 'string', description: 'The tool namespace that answered, when available.' },
        detail: { type: 'string', description: 'One plain sentence about what happened.' },
      },
      required: ['provider', 'ok'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const provider = String(args.provider);
      if (!PROBE_PROVIDERS.includes(provider)) {
        throw new InvalidInputError(`"${provider}" is not a provider this tool can probe.`, {
          fix: `Use one of ${PROBE_PROVIDERS.join(', ')}.`,
        });
      }
      const ok = Boolean(args.ok);
      const detail = optionalString(args.detail) ?? (ok ? 'Answered a real request.' : 'The last request did not go through.');
      const probe = recordIntegrationProbe(workspace, {
        provider,
        ok,
        detail,
        namespace: optionalString(args.namespace),
      });
      return { ok: true, provider, state: probe.state, providers: probe.providers };
    },
  }),
];
