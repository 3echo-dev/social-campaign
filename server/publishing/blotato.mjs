/**
 * Blotato adapter.
 *
 * Source: https://help.blotato.com/api/start and https://help.blotato.com/api/publish-post
 * (fetched 2026-09-11).
 *
 *   - Base URL: https://backend.blotato.com/v2
 *   - Auth header: blotato-api-key: <key>, sent as-is (no trim, no URL-encoding).
 *   - POST /v2/posts creates/publishes a post.
 *   - Media referenced by a post must be a URL Blotato can fetch; POST /v2/media
 *     uploads a local file first and returns the URL to reference.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requestJson } from './http.mjs';

const BASE_URL = 'https://backend.blotato.com/v2';

/**
 * @param {{apiKey: string, accountIds: Record<string, string>, baseUrl?: string|null}} config
 * @returns {import('./adapter.mjs').PublisherAdapter}
 */
export function createBlotatoAdapter(config) {
  const apiKey = config.apiKey ?? '';
  const accountIds = config.accountIds ?? {};
  const baseUrl = config.baseUrl && config.baseUrl.trim().length > 0 ? config.baseUrl : BASE_URL;

  const headers = { 'blotato-api-key': apiKey };

  async function uploadMedia(path) {
    const bytes = readFileSync(path);
    const base64 = bytes.toString('base64');
    const { json } = await requestJson(`${baseUrl}/media`, {
      method: 'POST',
      headers,
      body: { file: `data:application/octet-stream;base64,${base64}`, name: basename(path) },
      providerLabel: 'Blotato',
    });
    return json && (json.url ?? json.mediaUrl ?? json.id ?? null);
  }

  async function mediaUrls(post) {
    const media = Array.isArray(post.media) ? post.media : [];
    const urls = [];
    for (const item of media) {
      urls.push(await uploadMedia(item.path));
    }
    return urls;
  }

  function captionWithHashtags(post) {
    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
    return hashtags.length > 0 ? `${post.caption}\n\n${hashtags.join(' ')}` : post.caption;
  }

  async function submit(post, when) {
    const mediaUrlList = await mediaUrls(post);
    const body = {
      post: {
        // A release carries the account that was approved.  Keep the config
        // fallback for direct adapter callers that do not have a release yet.
        accountId: post.account_id ?? accountIds[post.platform] ?? null,
        target: { targetType: post.platform },
        content: {
          text: captionWithHashtags(post),
          mediaUrls: mediaUrlList,
          platform: post.platform,
        },
      },
    };
    if (when) body.post.scheduledTime = when;
    const { json } = await requestJson(`${baseUrl}/posts`, {
      method: 'POST',
      headers,
      body,
      providerLabel: 'Blotato',
    });
    return {
      provider_ref: json && (json.id ?? json.postId ?? null),
      post_url: json && (json.url ?? json.postUrl ?? null),
      status: json && (json.status ?? json.state ?? null),
    };
  }

  return {
    name: 'blotato',
    platforms: ['facebook', 'instagram', 'tiktok'],
    isConnected() {
      return Boolean(apiKey);
    },
    connectInstructions() {
      return 'Create a Blotato API key from your Blotato account settings, then paste it in here along with your Facebook, Instagram and TikTok account ids.';
    },
    async schedule({ post, when }) {
      return submit(post, when);
    },
    async publish({ post }) {
      return submit(post, null);
    },
    async status({ external_id }) {
      const { json } = await requestJson(`${baseUrl}/posts/${encodeURIComponent(external_id)}`, {
        method: 'GET',
        headers,
        providerLabel: 'Blotato',
      });
      return {
        status: (json && (json.status ?? json.state)) ?? 'unknown',
        post_url: json && (json.url ?? json.postUrl ?? null),
      };
    },
  };
}
