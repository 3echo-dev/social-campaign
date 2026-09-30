/**
 * Publishing tools.
 *
 * publishing_connect_open walks the user through connecting Blotato, Postiz or
 * Buffer via the canonical Connections page. publishing_status,
 * publishing_package_get, publishing_schedule, publishing_publish and
 * publishing_export are plain tools; schedule/publish/package_get all require an
 * approved final review first (docs/CONTRACTS.md, spec sections 32/36/37).
 *
 * The gate pattern here follows the shared Connections page: show
 * a screen, wait up to GATE_WAIT_MS (20 minutes), and hand back { status: "pending", screenId } for
 * Claude to resume with ui_wait when the user has not answered yet.
 */

import { defineTool } from '../mcp/registry.mjs';
import { GATE_WAIT_MS } from '../ui/server.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn } from '../lib/json.mjs';
import { InvalidInputError, UserFacingError } from '../lib/errors.mjs';
import { PLATFORMS, PROVIDER_LABELS, readPublisherConfig, writePublisherConfig } from '../publishing/adapter.mjs';
import { createBlotatoAdapter } from '../publishing/blotato.mjs';
import { createPostizAdapter } from '../publishing/postiz.mjs';
import { createBufferAdapter } from '../publishing/buffer.mjs';
import { exportPackage } from '../publishing/export.mjs';
import { dispatchPosts, listAttempts, reconcileRelease, ATTEMPT_STATE_LABEL } from '../publishing/dispatch.mjs';
import { intentPost, sameInstant } from '../publishing/intent.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';
import { buildRelease, currentRelease, hashFile, readRelease, resolveWorkspacePath, setReleaseStatus } from '../release/package.mjs';
import { approvedRelease } from '../review/approvals.mjs';
import { validateAgainstSchema, loadSchema } from '../planner/validate.mjs';
import { redact } from '../lib/secrets.mjs';
import { deleteCredential, getCredential } from '../lib/credentials.mjs';
import { showConnections } from './connections.mjs';

/**
 * @param {string} provider
 * @param {{apiKey: string, accountIds: Record<string, string>, baseUrl?: string|null}} config
 * @returns {import('../publishing/adapter.mjs').PublisherAdapter}
 */
function buildAdapter(provider, config) {
  if (provider === 'blotato') return createBlotatoAdapter(config);
  if (provider === 'postiz') return createPostizAdapter(config);
  if (provider === 'buffer') return createBufferAdapter(config);
  throw new InvalidInputError(`"${provider}" is not a publishing provider Social Campaign knows about.`, {
    fix: 'Use blotato, postiz or buffer.',
  });
}

/**
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {{connected: boolean, provider: string|null, adapter: import('../publishing/adapter.mjs').PublisherAdapter|null, config: any|null}}
 */
function currentPublisher(workspace) {
  const root = workspace.requireRoot();
  const config = readPublisherConfig(root);
  if (!config || config.state !== 'connected' || !config.provider || !config.api_key) {
    return { connected: false, provider: config ? config.provider ?? null : null, adapter: null, config };
  }
  const adapter = buildAdapter(config.provider, {
    apiKey: config.api_key,
    accountIds: config.account_ids ?? {},
    baseUrl: config.base_url ?? null,
  });
  return { connected: true, provider: config.provider, adapter, config };
}

/**
 * The campaign's brand name, for display, or null when the campaign has no brand or
 * the brand has none set.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {string|null}
 */
function campaignBrandName(db, campaignId) {
  const campaign = db.prepare('SELECT brand_id FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign || !campaign.brand_id) return null;
  const brand = db.prepare('SELECT name FROM brands WHERE id = ?').get(campaign.brand_id);
  return brand && brand.name ? String(brand.name) : null;
}

/**
 * The old reconstruction path: build posts from the latest CopyPackage and
 * GeneratedMediaPackage.
 *
 * This is a legacy fallback only, for a campaign old enough to have no release. It
 * refuses outright once a release exists, because reading "the latest artifacts"
 * there is exactly how an approved subtitled export got replaced by the raw original
 * on the way to a provider. Everything that publishes reads the release.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} campaignId
 * @returns {Array<Record<string, unknown>>}
 */
export function assemblePosts(db, campaignId) {
  if (currentRelease(db, campaignId)) {
    throw new UserFacingError('This campaign has a release, so its posts come from that release rather than being rebuilt.', {
      fix: 'Use the release the person approved.',
    });
  }
  const copyPackage = currentArtifact(db, campaignId, 'CopyPackage')?.json ?? null;
  if (!copyPackage) {
    throw new UserFacingError('This campaign has no copy to publish yet.', {
      fix: 'Write and approve the copy for this campaign first.',
    });
  }
  const mediaPackage = currentArtifact(db, campaignId, 'GeneratedMediaPackage')?.json ?? null;
  const assets = mediaPackage && Array.isArray(mediaPackage.assets) ? mediaPackage.assets : [];

  const variants = Array.isArray(copyPackage.variants) ? copyPackage.variants : [];
  return variants
    .filter((variant) => PLATFORMS.includes(variant.platform))
    .map((variant) => ({
      platform: variant.platform,
      caption: variant.caption ?? '',
      hashtags: Array.isArray(variant.hashtags) ? variant.hashtags : [],
      media: assets
        .filter((asset) => asset.review_state === 'approved' || !asset.review_state)
        .map((asset) => ({ path: asset.path, kind: asset.kind === 'video' ? 'video' : 'image' })),
      first_comment: null,
    }));
}

/**
 * Whether this campaign is approved to publish right now, and which release that
 * approval is about. Delegates to the one approval rule in server/review/approvals.mjs
 * so publishing refuses for exactly the reasons approval_check reports.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} campaignId
 * @returns {{ok: true, release: any, review_id: string}|{ok: false, reason: string, message: string}}
 */
export function finalApproval(workspace, campaignId) {
  return approvedRelease(workspace.requireDb(), campaignId);
}

/**
 * Re-hash every post's file and refuse the whole dispatch if any of them differs from
 * the bytes that were approved. A release names the sha256 of each file at build time;
 * if the file on disk has changed since, the person approved something else.
 * @param {string} root
 * @param {Array<any>} posts
 * @returns {{ok: true}|{ok: false, message: string}}
 */
function verifyReleaseBytes(root, posts) {
  for (const post of posts) {
    if (!post.asset_path) continue;
    const actual = hashFile(resolveWorkspacePath(root, post.asset_path));
    if (!actual) {
      return { ok: false, message: `The file for the ${post.platform} post is missing, so nothing was sent.` };
    }
    if (post.asset_sha256 && actual !== post.asset_sha256) {
      return {
        ok: false,
        message: `The file for the ${post.platform} post has changed since it was approved, so nothing was sent. It needs approving again.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Check that the action still matches the provider intent the person approved.
 * A release without an intent is a legacy release and keeps its existing manual
 * action path; once an intent exists, every destination and schedule field is
 * immutable through dispatch.
 * @param {{release: any, provider: string|null, mode: 'publish'|'schedule', when?: string|null, posts: Array<any>}} input
 * @returns {{ok: true}|{ok: false, message: string, code: string}}
 */
function verifyReleaseIntent({ release, provider, mode, when, posts }) {
  const intent = release?.intent;
  if (!intent || !intent.provider || !intent.mode || !intent.timezone) {
    return {
      ok: false,
      code: 'release_intent_missing',
      message: 'This release has no complete approved provider, account and UTC schedule intent. Build and review it again before sending anything.',
    };
  }
  if (String(intent.provider) !== String(provider ?? '')) {
    return {
      ok: false,
      code: 'release_intent_changed',
      message: 'The connected publishing provider is different from the provider approved for this release. Review the release again before sending it.',
    };
  }
  if (!intent.mode || String(intent.mode) !== mode) {
    return {
      ok: false,
      code: 'release_intent_changed',
      message: 'The requested publishing action is different from the action approved for this release. Review the release again before sending it.',
    };
  }
  for (const post of posts) {
    const frozen = intentPost(intent, post.post_index);
    if (!frozen) {
      return {
        ok: false,
        code: 'release_intent_changed',
        message: 'This release is missing the approved destination for one post. Build and review the release again.',
      };
    }
    if (!frozen.account_id || !post.account_id) {
      return {
        ok: false,
        code: 'release_intent_missing',
        message: `The approved account for the ${post.platform} post is missing. Build and review the release with an account id before sending it.`,
      };
    }
    if (String(frozen.account_id ?? '') !== String(post.account_id ?? '')) {
      return {
        ok: false,
        code: 'release_intent_changed',
        message: `The approved account for the ${post.platform} post changed. Review the release again before sending it.`,
      };
    }
    if (mode === 'schedule') {
      if (!frozen.scheduled_at || !sameInstant(frozen.scheduled_at, when)) {
        return {
          ok: false,
          code: 'release_schedule_changed',
          message: 'The requested schedule is different from the UTC time approved for this release. Review the release again with the new time.',
        };
      }
      if (!sameInstant(frozen.scheduled_at, post.scheduled_at)) {
        return {
          ok: false,
          code: 'release_schedule_changed',
          message: 'A post no longer carries the UTC schedule that was approved for this release. Review the release again.',
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Save a PublishingResult artifact and log the matching event.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} campaignId
 * @param {Record<string, unknown>} result
 */
function saveResult(workspace, campaignId, result) {
  const db = workspace.requireDb();
  const problems = validateAgainstSchema(loadSchema('PublishingResult'), result);
  if (problems.length > 0) {
    throw new UserFacingError(`Could not save the publishing result: ${problems[0]}`);
  }
  const version =
    Number(
      db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE campaign_id = ? AND kind = 'PublishingResult'").get(campaignId)
        ?.version ?? 0,
    ) + 1;
  db.prepare('INSERT INTO artifacts (id, campaign_id, kind, path, json, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    newId(),
    campaignId,
    'PublishingResult',
    result.export_path ?? null,
    toJsonColumn(result),
    version,
    nowIso(),
  );
  db.prepare('INSERT INTO events (id, campaign_id, name, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    campaignId,
    result.outcome === 'scheduled' ? 'publish.scheduled' : 'publish.completed',
    toJsonColumn({ outcome: result.outcome, provider: result.provider }),
    nowIso(),
  );
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const publishingTools = [
  defineTool({
    name: 'publishing_connect_open',
    description:
      'Show the canonical Connections page focused on Publishing, with provider choice, API key and per-platform ' +
      'account ids. Waits up to GATE_WAIT_MS (20 minutes); if it returns pending, use ui_wait with the same screenId. ' +
      'The action contract is connect, skip, check_again, fix_in_chat or continue_home. A connect action is verified ' +
      'and consumed on the server before the result returns.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { workspace, ui, signal }) => {
      const screen = await showConnections(ui, workspace, {
        setup: false,
        focus: 'publishing',
        reason: 'Connect Blotato, Postiz or Buffer to schedule and publish posts directly from Social Campaign.',
      });
      const result = await ui.waitForAction(screen.screenId, { timeoutMs: GATE_WAIT_MS, signal });
      if (!result) {
        return {
          status: 'pending',
          screenId: screen.screenId,
          hint: 'The user has not answered yet. Call ui_wait with this screenId to keep waiting.',
          url: ui.url(),
        };
      }
      if (result.action === 'connect') {
        const outcome = await handleConnectAction(workspace, ui, result);
        ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
        const refreshed = await showConnections(ui, workspace, {
          setup: false,
          focus: 'publishing',
          reason: outcome.connected ? 'Connection saved.' : null,
          connectionDetail: outcome.error ? String(outcome.error) : null,
          canRetry: !outcome.connected,
          acknowledgeActionId: result.actionId ?? null,
        });
        return { ...outcome, screenId: refreshed.screenId, url: ui.url() };
      }
      const outcome = await handleConnectAction(workspace, ui, result);
      ui.acknowledgeAction(result.actionId ?? '', result.consumerId ?? null);
      if (typeof ui.clearBusyForAction === 'function') ui.clearBusyForAction(result.screenId, result.actionId ?? null);
      return { ...outcome, payload: redact(result.payload), screenId: result.screenId, url: ui.url() };
    },
  }),

  defineTool({
    name: 'publishing_status',
    description: 'Report whether a publishing provider is connected, which one, and its per-platform account ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, { workspace }) => {
      // integrations.json holds the api_key alongside provider/state/account ids
      // (see server/publishing/adapter.mjs). This tool reports connection facts
      // only: provider, state and account ids, never the key. Built by hand
      // rather than spreading `config`, so a future field added to that file
      // does not silently start flowing through here; redact() is the backstop
      // in case it ever does.
      const root = workspace.requireRoot();
      const config = readPublisherConfig(root);
      if (!config || config.state !== 'connected') {
        return redact({ connected: false, provider: config ? config.provider ?? null : null, account_ids: null });
      }
      return redact({
        connected: true,
        provider: config.provider,
        account_ids: config.account_ids ?? {},
        base_url: config.base_url ?? null,
      });
    },
  }),

  defineTool({
    name: 'publishing_package_get',
    description:
      'Assemble the final publishable package (per-platform caption, hashtags and media) from campaign ' +
      'artifacts. Requires an approved final review; returns a friendly refusal, not an error, if that ' +
      'approval is missing.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const campaignId = String(args.campaign_id);
      const approval = finalApproval(workspace, campaignId);
      if (!approval.ok) {
        return { ok: false, reason: approval.message, code: approval.reason };
      }
      const db = workspace.requireDb();
      const brandName = campaignBrandName(db, campaignId);
      return {
        ok: true,
        campaign_id: campaignId,
        final_approval_id: approval.review_id,
        release_id: approval.release.release_id,
        release_version: approval.release.version,
        digest: approval.release.digest,
        posts: approval.release.posts.map(toDisplayPost),
        attempts: listAttempts(db, approval.release.release_id),
        brand_name: brandName ?? 'Your brand',
      };
    },
  }),

  defineTool({
    name: 'publishing_schedule',
    description:
      'Schedule the approved posts for a campaign through the connected publishing provider. Refuses with a ' +
      'friendly message and makes no changes if final review has not been approved. Falls back to exporting ' +
      'a hand-postable package when no provider is connected.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        when: { type: 'string', description: 'ISO 8601 date-time to schedule for.' },
        platforms: { type: 'array', description: 'Optional subset of facebook, instagram, tiktok.' },
      },
      required: ['campaign_id', 'when'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      return await doSchedulePublish({ workspace, args, mode: 'schedule' });
    },
  }),

  defineTool({
    name: 'publishing_publish',
    description:
      'Publish the approved posts for a campaign right now through the connected publishing provider. ' +
      'Refuses with a friendly message and makes no changes if final review has not been approved. Falls ' +
      'back to exporting a hand-postable package when no provider is connected.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        platforms: { type: 'array', description: 'Optional subset of facebook, instagram, tiktok.' },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      return await doSchedulePublish({ workspace, args, mode: 'publish' });
    },
  }),

  defineTool({
    name: 'publishing_export',
    description: 'Export a hand-postable package for a campaign to the workspace outputs folder, no provider required.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const campaignId = String(args.campaign_id);
      const approval = finalApproval(workspace, campaignId);
      if (!approval.ok) {
        return { ok: false, reason: approval.message, code: approval.reason };
      }
      const root = workspace.requireRoot();
      const verified = verifyReleaseBytes(root, approval.release.posts);
      if (!verified.ok) return { ok: false, reason: verified.message, code: 'asset_changed' };
      const exported = exportPackage({ campaign_id: campaignId, workspace, posts: approval.release.posts });
      setReleaseStatus(workspace.requireDb(), approval.release.release_id, 'exported');
      return { ok: true, release_id: approval.release.release_id, release_version: approval.release.version, ...exported };
    },
  }),

  defineTool({
    name: 'release_build',
    description:
      'Freeze exactly what will be published into one release: per platform the caption, hashtags, first ' +
      'comment, target account, schedule and the one exact file, with a fingerprint of that file taken from ' +
      'its bytes. Called with no posts it builds the release from the approved copy and the exported files. ' +
      'Building a new release replaces any earlier draft, and final approval is given to one release.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        posts: {
          type: 'array',
          description:
            'Optional exact posts: [{platform, caption, hashtags, first_comment, account_id, scheduled_at, ' +
            'media: {asset_id} or {path}}].',
        },
        intent: {
          type: 'object',
          description: 'Optional immutable provider intent: {provider, mode, timezone, original_timezone}.',
        },
      },
      required: ['campaign_id'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const release = buildRelease({
        db: workspace.requireDb(),
        root: workspace.requireRoot(),
        campaign_id: String(args.campaign_id),
        posts: Array.isArray(args.posts) ? args.posts : undefined,
        intent: args.intent && typeof args.intent === 'object' ? args.intent : null,
      });
      return { ok: true, ...release, posts: release.posts.map(toDisplayPost) };
    },
  }),

  defineTool({
    name: 'publishing_reconcile',
    description:
      'Check with the publishing service what happened to any post whose outcome was never learned, and ' +
      'record the answer. Anything the service cannot be asked about is left exactly as it is, with a plain ' +
      'sentence about what the person can check themselves. Never sends a post again.',
    inputSchema: {
      type: 'object',
      properties: { release_id: { type: 'string' } },
      required: ['release_id'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const db = workspace.requireDb();
      const releaseId = String(args.release_id);
      const release = readRelease(db, releaseId);
      if (!release) throw new InvalidInputError('There is no release with that id.');
      const { adapter } = currentPublisher(workspace);
      const result = await reconcileRelease({ db, release_id: releaseId, adapter });
      return {
        ok: true,
        release_id: releaseId,
        ...result,
        summary:
          result.checked === 0
            ? 'Every post has a clear outcome; there was nothing to check.'
            : `Checked ${result.checked} unclear post${result.checked === 1 ? '' : 's'} and settled ${result.resolved}.`,
      };
    },
  }),
];

/**
 * A release post in the shape the screens and the package readers expect.
 * @param {any} post
 * @returns {Record<string, unknown>}
 */
function toDisplayPost(post) {
  return {
    post_index: post.post_index,
    platform: post.platform,
    caption: post.caption ?? '',
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
    first_comment: post.first_comment ?? null,
    account_id: post.account_id ?? null,
    scheduled_for: post.scheduled_at ?? null,
    asset_id: post.asset_id ?? null,
    asset_sha256: post.asset_sha256 ?? null,
    media: post.asset_path
      ? [
          {
            path: post.asset_path,
            kind: post.asset_kind === 'image' ? 'image' : 'video',
            duration_s: post.duration_s ?? null,
            subtitles_burned_in: post.subtitles_burned_in ?? null,
          },
        ]
      : [],
  };
}

/**
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {import('../ui/server.mjs').UiServer} ui
 * @param {import('../ui/server.mjs').ActionResult} result
 */
export async function handleConnectAction(workspace, ui, result) {
  // The pane's connect screen is the one place a secret is typed in. result.payload
  // holds the raw api_key here, in this function's local scope only: every branch
  // below consumes it server side (writePublisherConfig) and returns only
  // {provider, connected}, never the key itself, per the rule in
  // skills/social-campaign/SKILL.md, "Secrets never leave the server".
  const { action, payload } = result;
  if (action === 'skip') {
    return { status: 'resolved', action, connected: false, url: ui.url() };
  }
  if (action === 'mark_connected') {
    const root = workspace.requireRoot();
    const existing = readPublisherConfig(root);
    if (!existing?.provider || !existing.api_key) {
      return {
        status: 'resolved',
        action,
        connected: false,
        state: 'degraded',
        error: 'There is no verified publishing connection on this computer. Choose Connect and enter the provider key in the pane.',
        url: ui.url(),
      };
    }
    const adapter = buildAdapter(existing.provider, {
      apiKey: existing.api_key,
      accountIds: existing.account_ids ?? {},
      baseUrl: existing.base_url ?? null,
    });
    try {
      await adapter.status({ external_id: 'social-campaign-connection-check' });
    } catch (error) {
      const authenticatedNotFound = Boolean(
        error?.authenticated_not_found === true ||
          error?.details?.authenticated_not_found === true ||
          error?.details?.authenticated === true,
      );
      if (!authenticatedNotFound) {
        return {
          status: 'resolved',
          action,
          connected: false,
          state: 'degraded',
          error: 'The saved publishing connection could not be verified. Check the provider and try Connect again.',
          url: ui.url(),
        };
      }
    }
    writePublisherConfig(root, { state: 'connected', detail: null });
    return { status: 'resolved', action, connected: true, provider: existing.provider, url: ui.url() };
  }
  if (action !== 'connect') {
    return { status: 'resolved', action, connected: false, url: ui.url() };
  }

  const provider = String(payload?.provider ?? '');
  const credentialRef = typeof payload?.credential_ref === 'string' ? payload.credential_ref.trim() : '';
  const accountIds = payload?.account_ids && typeof payload.account_ids === 'object' ? payload.account_ids : {};
  const baseUrl = typeof payload?.base_url === 'string' && payload.base_url ? payload.base_url : null;
  let apiKey = '';

  try {
    apiKey = credentialRef ? String(getCredential(credentialRef) ?? '') : String(payload?.api_key ?? '');

  if (!PROVIDER_LABELS[provider] || !apiKey) {
    return {
      status: 'resolved',
      action,
      connected: false,
      error: 'Choose a provider and enter its API key to connect.',
      url: ui.url(),
    };
  }

  const root = workspace.requireRoot();
  const adapter = buildAdapter(provider, { apiKey, accountIds, baseUrl });
  try {
    await adapter.status({ external_id: 'social-campaign-connection-check' });
  } catch (error) {
    // A failed connection probe is not proof that credentials work.  A timeout,
    // network error or server response leaves this attempt degraded and keeps the
    // key out of the portable config until a provider request succeeds.
    if (error && error.code === 'publisher_auth_failed') {
      return {
        status: 'resolved',
        action,
        connected: false,
        error: `${PROVIDER_LABELS[provider]} rejected that API key. Check it and try again.`,
        url: ui.url(),
      };
    }
    const authenticatedNotFound = Boolean(
      error?.authenticated_not_found === true ||
        error?.details?.authenticated_not_found === true ||
        error?.details?.authenticated === true,
    );
    if (!authenticatedNotFound) {
      const code = String(error?.code ?? 'publisher_probe_failed');
      const reason =
        code === 'publisher_timeout'
          ? `${PROVIDER_LABELS[provider]} did not respond while checking the connection.`
          : code === 'publisher_unreachable'
            ? `${PROVIDER_LABELS[provider]} could not be reached while checking the connection.`
            : `${PROVIDER_LABELS[provider]} could not verify the connection (${code}).`;
      return {
        status: 'resolved',
        action,
        connected: false,
        state: 'degraded',
        error: `${reason} Check the base URL and try again.`,
        url: ui.url(),
      };
    }
  }

  writePublisherConfig(root, {
    state: 'connected',
    provider,
    api_key: apiKey,
    base_url: baseUrl,
    account_ids: accountIds,
  });

  return { status: 'resolved', action, connected: true, provider, url: ui.url() };
  } finally {
    // The pane receipt only needs this short lived reference to bridge the HTTP
    // request into this consumer. The permanent publisher credential is stored by
    // writePublisherConfig under its own reference, so the temporary one can be
    // removed on both success and failure.
    if (credentialRef) deleteCredential(credentialRef);
  }
}

/**
 * @param {object} args
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {Record<string, unknown>} args.args
 * @param {'schedule'|'publish'} args.mode
 */
async function doSchedulePublish({ workspace, args, mode }) {
  const campaignId = String(args.campaign_id);
  const approval = finalApproval(workspace, campaignId);
  if (!approval.ok) {
    return { ok: false, reason: approval.message, code: approval.reason };
  }

  const db = workspace.requireDb();
  const root = workspace.requireRoot();
  const release = approval.release;

  const verified = verifyReleaseBytes(root, release.posts);
  if (!verified.ok) return { ok: false, reason: verified.message, code: 'asset_changed' };

  const platformFilter = Array.isArray(args.platforms) ? args.platforms.map(String) : null;
  const posts =
    platformFilter && platformFilter.length > 0
      ? release.posts.filter((post) => platformFilter.includes(post.platform))
      : release.posts;

  const { connected, provider, adapter } = currentPublisher(workspace);

  if (!connected) {
    const exported = exportPackage({ campaign_id: campaignId, workspace, posts: release.posts });
    const result = {
      schema_version: 1,
      campaign_id: campaignId,
      final_approval_id: approval.review_id,
      outcome: 'exported',
      provider: null,
      posts: posts.map((post) => ({ post_index: post.post_index, platform: post.platform, status: 'exported' })),
      export_path: exported.export_path,
      summary: 'No publishing service is connected, so your posts were saved for you to upload yourself.',
    };
    saveResult(workspace, campaignId, result);
    setReleaseStatus(db, release.release_id, 'exported');
    return {
      ok: true,
      ...result,
      release_id: release.release_id,
      release_version: release.version,
      message: `No publisher is connected. Exported a package to ${exported.export_path} instead.`,
    };
  }

  const intentCheck = verifyReleaseIntent({
    release,
    provider,
    mode,
    when: args.when ? String(args.when) : null,
    posts,
  });
  if (!intentCheck.ok) return { ok: false, reason: intentCheck.message, code: intentCheck.code };

  const dispatched = await dispatchPosts({
    db,
    release,
    posts,
    adapter,
    mode,
    when: args.when ? String(args.when) : undefined,
    intent: release.intent ?? null,
  });

  const resultPosts = dispatched.map((post) => ({
    post_index: post.post_index,
    platform: post.platform,
    status: ATTEMPT_STATE_LABEL[post.attempt_state] ?? post.attempt_state,
    scheduled_for: post.scheduled_for,
    published_at: post.published_at,
    post_url: post.post_url,
    provider_ref: post.provider_ref,
    media_asset_ids: post.media_asset_ids,
    error: post.error,
  }));

  const anyFailed = dispatched.some((post) => post.attempt_state === 'failed');
  const anyUnclear = dispatched.some((post) => post.attempt_state === 'unknown');
  const anyPending = dispatched.some((post) => post.attempt_state === 'pending');
  const anyAccepted = dispatched.some((post) => post.attempt_state === 'accepted');
  const allPublished = dispatched.length > 0 && dispatched.every((post) => post.attempt_state === 'published');
  const allScheduled = dispatched.length > 0 && dispatched.every((post) => post.attempt_state === 'scheduled');

  const outcome = anyUnclear
      ? 'unclear'
      : anyPending
        ? 'pending'
        : anyFailed
          ? 'failed'
          : allPublished
            ? 'published'
            : allScheduled
              ? 'scheduled'
              : anyAccepted
                ? 'accepted'
                : 'unclear';

  const result = {
    schema_version: 1,
    campaign_id: campaignId,
    final_approval_id: approval.review_id,
    outcome,
    provider,
    posts: resultPosts,
    export_path: null,
    summary: anyUnclear
      ? 'Some posts have an unclear outcome; check with your publishing service before sending them again.'
      : anyFailed
        ? 'Some posts could not be sent to the publishing provider; see each post for details.'
        : anyPending
          ? 'Some publishing requests are still in progress and were left alone until their outcome can be checked.'
          : anyAccepted
            ? 'The provider accepted some requests but has not confirmed that those posts were published.'
            : mode === 'schedule'
          ? 'Posts were scheduled with the connected publishing provider.'
          : 'Posts were published with the connected publishing provider.',
  };
  saveResult(workspace, campaignId, result);
  if (allPublished) setReleaseStatus(db, release.release_id, 'published');

  return {
    ok: true,
    ...result,
    release_id: release.release_id,
    release_version: release.version,
    attempts: dispatched.map((post) => ({
      platform: post.platform,
      post_index: post.post_index,
      state: post.attempt_state,
      state_label: ATTEMPT_STATE_LABEL[post.attempt_state],
      attempt: post.attempt,
      idempotency_key: post.idempotency_key,
      provider_ref: post.provider_ref,
      error: post.error,
      note: post.note,
    })),
    can_retry_failed: anyFailed,
    needs_check_with_provider: anyUnclear,
  };
}
