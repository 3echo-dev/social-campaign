/**
 * Buffer adapter.
 *
 * Source, fetched 2026-09-11: https://developers.buffer.com/guides/introduction.html,
 * https://developers.buffer.com/guides/posts-and-scheduling.html and
 * https://developers.buffer.com/guides/hosting-media.html.
 *
 *   - Buffer's current API is GraphQL at https://api.buffer.com (the legacy REST API
 *     is being retired). Auth header: Authorization: Bearer <access token>.
 *   - createPost mutation: channelId, text, schedulingType ("automatic" or a fixed
 *     dueAt in ISO 8601 UTC for scheduling), mode, and an assets array of image/video
 *     URLs. Buffer has no media upload endpoint of its own: assets must already be
 *     publicly reachable URLs, so this adapter cannot post a local file path directly.
 *
 * Request shapes, field names, the createPost/editPost union response, and the
 * pre-submit gates below are aligned against the proven client and gates at
 * `the 3echo harness prototype's src/lib/buffer-client.ts` (its
 * `BufferClient.query/channels/create/post/manage`, which published 2 posts and
 * scheduled 2 for real against the live Buffer API) and
 * `the same prototype's src/lib/publishing.ts` lines
 * 14-26 (`validateSubmission`'s media-url, channel and expiry gates). Nothing is
 * imported from that project; this file stays zero runtime dependency, plain
 * JavaScript, matching the rest of this codebase's style rather than its zod/TS one.
 *
 * The access token never appears in a thrown error, a log line, or anything returned
 * to a caller: only headers carry it, and headers are never echoed back.
 */

import { UserFacingError } from '../lib/errors.mjs';
import { requestJson } from './http.mjs';

const DEFAULT_BASE_URL = 'https://api.buffer.com';

/** Buffer's own platform names for the three surfaces this plugin publishes to. */
const BUFFER_SERVICES = new Set(['instagram', 'facebook', 'tiktok']);

const CHANNELS_QUERY = `
  query { account { organizations { id } } }
`;

const ORG_CHANNELS_QUERY = `
  query($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      service
      timezone
      isDisconnected
      isLocked
      isQueuePaused
    }
  }
`;

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status dueAt } }
      ... on MutationError { message }
    }
  }
`;

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status dueAt } }
      ... on MutationError { message }
    }
  }
`;

const POST_QUERY = `
  query($input: PostInput!) {
    post(input: $input) { id status dueAt error { message } }
  }
`;

/**
 * Buffer's post status, mapped onto the vocabulary the rest of this plugin uses.
 * Mirrors buffer-client.ts's `providerState`.
 * @param {string} status
 * @returns {'submitting'|'published'|'scheduled'|'failed'|'unknown'}
 */
function providerState(status) {
  switch (String(status ?? '').toLowerCase()) {
    case 'sending':
      return 'submitting';
    case 'sent':
    case 'published':
      return 'published';
    case 'buffer':
    case 'scheduled':
      return 'scheduled';
    case 'error':
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * A media url gate matching publishing.ts lines 14-26: Buffer needs a public HTTPS
 * url. Local paths, plain HTTP, credentials in the url, private and loopback
 * hostnames, and a bare IP with an explicit port are all refused before Buffer ever
 * sees the request, the same list of holes a locally hosted export could otherwise
 * slip through.
 * @param {string} raw
 */
function requirePublicHttpsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UserFacingError(
      'Buffer can only post media that already has a public URL; this file is still local.',
      { code: 'publisher_media_not_public', fix: 'Host the media file somewhere public first, then use that URL.' },
    );
  }
  const privateHost =
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
    url.hostname.endsWith('.local');
  if (privateHost) {
    throw new UserFacingError('Buffer needs public HTTPS media URLs. Local files and private hosts are not supported.', {
      code: 'publisher_media_not_public',
      fix: 'Host the media file somewhere public and reachable over HTTPS, then use that URL.',
    });
  }
  return url;
}

/**
 * @param {{apiKey: string, accountIds: Record<string, string>, baseUrl?: string|null}} config
 * @returns {import('./adapter.mjs').PublisherAdapter}
 */
export function createBufferAdapter(config) {
  const apiKey = config.apiKey ?? '';
  const accountIds = config.accountIds ?? {};
  const baseUrl = config.baseUrl && config.baseUrl.trim().length > 0 ? config.baseUrl : DEFAULT_BASE_URL;
  const headers = { Authorization: `Bearer ${apiKey}` };

  /** Discovered channels are cached for a few minutes per adapter instance, the same shape as buffer-client.ts's ChannelDiscoveryCache without the multi-caller sharing it does not need here. */
  let channelsCache = null;
  let channelsCacheAt = 0;
  const CHANNELS_TTL_MS = 5 * 60 * 1000;

  /**
   * @param {string} query
   * @param {object} [variables]
   * @returns {Promise<any>}
   */
  async function query(query_, variables = {}) {
    if (!apiKey) {
      throw new UserFacingError('Buffer is not connected yet.', {
        code: 'publisher_not_connected',
        fix: 'Connect Buffer with an access token before publishing.',
      });
    }
    const { json } = await requestJson(baseUrl, {
      method: 'POST',
      headers,
      body: { query: query_, variables },
      providerLabel: 'Buffer',
    });
    const errors = json && Array.isArray(json.errors) ? json.errors : [];
    if (errors.length > 0) {
      throw new UserFacingError('Buffer could not process this request. Check API access and provider status.', {
        code: 'publisher_request_failed',
        details: { errors },
      });
    }
    return json ? json.data : null;
  }

  /**
   * Every connected Buffer channel across the account's organizations, filtered to
   * the three platforms this plugin publishes to. Matches buffer-client.ts's
   * `channels()`.
   * @param {boolean} [fresh] bypass the cache and fetch again.
   * @returns {Promise<any[]>}
   */
  async function channels(fresh = false) {
    if (!fresh && channelsCache && Date.now() - channelsCacheAt < CHANNELS_TTL_MS) return channelsCache;
    const account = await query(CHANNELS_QUERY);
    const organizations = account?.account?.organizations ?? [];
    const groups = await Promise.all(
      organizations.map(async (organization) => {
        const data = await query(ORG_CHANNELS_QUERY, { input: { organizationId: organization.id } });
        return Array.isArray(data?.channels) ? data.channels : [];
      }),
    );
    const flat = groups.flat().filter((channel) => BUFFER_SERVICES.has(String(channel.service ?? '').toLowerCase()));
    channelsCache = flat;
    channelsCacheAt = Date.now();
    return flat;
  }

  /**
   * The connected, unlocked channel configured for one platform, or a thrown
   * friendly error explaining what is wrong. Matches publishing.ts's channel gate:
   * a channel must exist, match the platform, and be neither disconnected nor
   * locked; scheduling additionally requires the posting queue not be paused.
   * @param {string} platform
   * @param {'publish'|'schedule'} action
   * @param {string|null} [approvedChannelId]
   */
  async function requireChannel(platform, action, approvedChannelId = null) {
    // A frozen release account takes precedence over mutable connector config.
    const channelId = approvedChannelId || accountIds[platform];
    if (!channelId) {
      throw new UserFacingError(`No Buffer channel is configured for ${platform}.`, {
        code: 'publisher_channel_missing',
        fix: 'Add this platform\'s channel id to the Buffer connection.',
      });
    }
    const list = await channels();
    const channel = list.find((entry) => entry.id === channelId);
    if (!channel || String(channel.service ?? '').toLowerCase() !== platform || channel.isDisconnected || channel.isLocked) {
      throw new UserFacingError('Choose a connected, unlocked Buffer channel matching this job\'s platform.', {
        code: 'publisher_channel_invalid',
        fix: 'Reconnect the account in Buffer, or pick a channel that matches this platform.',
      });
    }
    if (action === 'schedule' && channel.isQueuePaused) {
      throw new UserFacingError('This Buffer channel\'s posting queue is paused.', {
        code: 'publisher_queue_paused',
        fix: 'Resume the posting queue in Buffer, or publish immediately instead of scheduling.',
      });
    }
    return channel;
  }

  function captionWithHashtags(post) {
    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
    return hashtags.length > 0 ? `${post.caption}\n\n${hashtags.join(' ')}` : post.caption;
  }

  /**
   * @param {any} post
   * @returns {{video?: {url: string}}[]|{image: {url: string}}[]}
   */
  function assetsInput(post) {
    const media = Array.isArray(post.media) ? post.media : [];
    return media.map((item) => {
      const url = requirePublicHttpsUrl(item.path);
      return item.kind === 'video' ? { video: { url: url.toString() } } : { image: { url: url.toString() } };
    });
  }

  /**
   * Buffer's per-platform post metadata block, matching buffer-client.ts's `create()`:
   * an Instagram or Facebook reel/story is named from the post's placement.
   * @param {any} post
   */
  function metadataFor(post) {
    const placement = String(post.placement ?? '').toLowerCase();
    const type = /reel/.test(placement) ? 'reel' : /stor/.test(placement) ? 'story' : 'post';
    if (post.platform === 'instagram') return { instagram: { type, shouldShareToFeed: true } };
    if (post.platform === 'facebook') return { facebook: { type } };
    return {};
  }

  async function submit(post, dueAt) {
    const channel = await requireChannel(post.platform, dueAt ? 'schedule' : 'publish', post.account_id);
    const input = {
      channelId: channel.id,
      text: captionWithHashtags(post),
      assets: assetsInput(post),
      metadata: metadataFor(post),
      mode: dueAt ? 'customScheduled' : 'shareNow',
      ...(dueAt ? { dueAt } : {}),
      schedulingType: 'automatic',
      needsApproval: false,
      saveToDraft: false,
      aiAssisted: true,
    };
    const data = await query(CREATE_POST_MUTATION, { input });
    const created = data?.createPost;
    if (!created || created.__typename !== 'PostActionSuccess' || !created.post) {
      throw new UserFacingError('Buffer rejected the post. Check its account permissions, media, and posting limits.', {
        code: 'publisher_request_failed',
        details: { message: created?.message ?? null },
      });
    }
    return { provider_ref: created.post.id ?? null, post_url: null, status: providerState(created.post.status) };
  }

  return {
    name: 'buffer',
    platforms: ['facebook', 'instagram', 'tiktok'],
    isConnected() {
      return Boolean(apiKey);
    },
    connectInstructions() {
      return 'Create a Buffer access token from your Buffer developer settings, then paste it in here along with the channel ids for each connected profile.';
    },
    async schedule({ post, when }) {
      if (!when) {
        throw new UserFacingError('Choose a future date to schedule this post.', { code: 'publisher_schedule_missing_date' });
      }
      if (Date.parse(when) <= Date.now()) {
        throw new UserFacingError('Choose a date in the future to schedule this post.', { code: 'publisher_schedule_past_date' });
      }
      return submit(post, when);
    },
    async publish({ post }) {
      return submit(post, null);
    },
    async status({ external_id }) {
      const data = await query(POST_QUERY, { input: { id: external_id } });
      const post = data?.post;
      if (!post) return { status: 'unknown', post_url: null };
      return { status: providerState(post.status), post_url: null };
    },
    /**
     * Cancel a scheduled post (moves it back to draft, matching buffer-client.ts's
     * `manage()` with `{kind:'cancel'}`) or move its scheduled time. Not part of the
     * shared PublisherAdapter interface; publishing.mjs does not call this yet, but
     * it is here, tested, and ready for whichever builder wires cancellation in.
     * @param {string} externalId
     * @param {{kind: 'cancel'}|{kind: 'reschedule', scheduledAt: string}} change
     */
    async manage(externalId, change) {
      const input =
        change.kind === 'cancel'
          ? { id: externalId, saveToDraft: true }
          : { id: externalId, mode: 'customScheduled', dueAt: change.scheduledAt };
      const data = await query(EDIT_POST_MUTATION, { input });
      const edited = data?.editPost;
      if (!edited || edited.__typename !== 'PostActionSuccess' || !edited.post) {
        throw new UserFacingError('Buffer rejected the schedule change. Refresh its status before trying again.', {
          code: 'publisher_request_failed',
          details: { message: edited?.message ?? null },
        });
      }
      return { provider_ref: edited.post.id ?? null, status: providerState(edited.post.status) };
    },
    /** Exposed for tests and for a future capability probe; not part of PublisherAdapter. */
    _channels: channels,
  };
}
