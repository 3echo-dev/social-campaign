/**
 * Postiz adapter.
 *
 * Source: https://docs.postiz.com/public-api/introduction, https://docs.postiz.com/public-api
 * and https://docs.postiz.com/public-api/uploads/upload-file (fetched 2026-09-11).
 *
 *   - Default base URL (self-hosted or the hosted service): https://api.postiz.com/public/v1
 *     A self-hosted instance's own origin plus /public/v1 also works; base_url in
 *     integrations.json overrides the default.
 *   - Auth header: Authorization: <api-key> (no "Bearer " prefix).
 *   - POST /public/v1/upload, multipart/form-data with a `file` field, uploads media
 *     first and returns {id, path}; posts reference media by that id.
 *   - POST /public/v1/posts creates a draft, schedules or publishes now depending on
 *     `type`: "draft" | "schedule" | "now".
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requestJson } from './http.mjs';
import { UserFacingError } from '../lib/errors.mjs';

const DEFAULT_BASE_URL = 'https://api.postiz.com/public/v1';

/**
 * @param {{apiKey: string, accountIds: Record<string, string>, baseUrl?: string|null}} config
 * @returns {import('./adapter.mjs').PublisherAdapter}
 */
export function createPostizAdapter(config) {
  const apiKey = config.apiKey ?? '';
  const accountIds = config.accountIds ?? {};
  const baseUrl = config.baseUrl && config.baseUrl.trim().length > 0 ? config.baseUrl : DEFAULT_BASE_URL;

  const headers = { Authorization: apiKey };

  async function uploadMedia(path) {
    const bytes = readFileSync(path);
    const form = new FormData();
    form.append('file', new Blob([bytes]), basename(path));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}/upload`, { method: 'POST', headers, body: form, signal: controller.signal });
      let text;
      try {
        text = await response.text();
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new UserFacingError('Postiz did not respond in time while uploading media.', {
            code: 'publisher_timeout',
            fix: 'Try again in a moment, or reconcile before trying the post again.',
          });
        }
        throw new UserFacingError('Postiz stopped responding while returning the media upload.', {
          code: 'publisher_unreachable',
          fix: 'Check the provider status, then reconcile before retrying.',
        });
      }
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!response.ok) {
        throw new UserFacingError(`Postiz rejected the media upload (status ${response.status}).`, {
          code:
            response.status === 401 || response.status === 403
              ? 'publisher_auth_failed'
              : response.status >= 500
                ? 'publisher_server_failed'
                : 'publisher_request_failed',
          details: { status: response.status, body: json ?? text },
        });
      }
      return json;
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      if (error && error.name === 'AbortError') {
        throw new UserFacingError('Postiz did not respond in time while uploading media.', {
          code: 'publisher_timeout',
          fix: 'Try again in a moment, or reconcile before trying the post again.',
        });
      }
      throw new UserFacingError(`Postiz could not be reached to upload media: ${String(error && error.message ? error.message : error)}.`, {
        code: 'publisher_unreachable',
        fix: 'Check your internet connection and the provider status, then reconcile before retrying.',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function captionWithHashtags(post) {
    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
    return hashtags.length > 0 ? `${post.caption}\n\n${hashtags.join(' ')}` : post.caption;
  }

  async function submit(post, type, when) {
    const media = Array.isArray(post.media) ? post.media : [];
    const uploaded = [];
    for (const item of media) uploaded.push(await uploadMedia(item.path));

    const body = {
      type,
      date: when ?? new Date().toISOString(),
      posts: [
        {
            integration: { id: post.account_id ?? accountIds[post.platform] ?? null },
          value: [{ content: captionWithHashtags(post), image: uploaded.map((item) => ({ id: item.id })) }],
          settings: { __type: post.platform },
        },
      ],
    };
    const { json } = await requestJson(`${baseUrl}/posts`, {
      method: 'POST',
      headers,
      body,
      providerLabel: 'Postiz',
    });
    return {
      provider_ref: json && (json.id ?? (Array.isArray(json.posts) && json.posts[0] && json.posts[0].id) ?? null),
      post_url: json && (json.url ?? null),
      status: json && (json.status ?? json.state ?? null),
    };
  }

  return {
    name: 'postiz',
    platforms: ['facebook', 'instagram', 'tiktok'],
    isConnected() {
      return Boolean(apiKey);
    },
    connectInstructions() {
      return 'In Postiz, open Settings and copy your Public API key, then paste it in here along with the integration ids for each connected channel.';
    },
    async schedule({ post, when }) {
      return submit(post, 'schedule', when);
    },
    async publish({ post }) {
      return submit(post, 'now', null);
    },
    async status({ external_id }) {
      const { json } = await requestJson(`${baseUrl}/posts/${encodeURIComponent(external_id)}`, {
        method: 'GET',
        headers,
        providerLabel: 'Postiz',
      });
      return { status: (json && json.state) ?? 'unknown', post_url: json && (json.url ?? null) };
    },
  };
}
