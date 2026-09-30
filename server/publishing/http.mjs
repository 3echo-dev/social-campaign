/**
 * Shared HTTP helper for publisher adapters.
 *
 * A thin wrapper around fetch: applies a timeout, maps failures into friendly
 * UserFacingError instances, and centralizes JSON request/response handling so each
 * adapter file only has to describe endpoints, headers and body shapes.
 */

import { UserFacingError } from '../lib/errors.mjs';

/** Default request timeout, generous enough for a media upload. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {string} url
 * @param {{method?: string, headers?: Record<string, string>, body?: unknown, timeoutMs?: number, providerLabel?: string}} [options]
 * @returns {Promise<{status: number, ok: boolean, json: any, text: string}>}
 */
export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    providerLabel = 'The publishing provider',
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new UserFacingError(`${providerLabel} did not respond in time.`, {
          code: 'publisher_timeout',
          fix: 'Try again in a moment, or check the provider status page.',
        });
      }
      throw new UserFacingError(`${providerLabel} stopped responding while returning its answer.`, {
        code: 'publisher_unreachable',
        fix: 'Check your internet connection and the provider status, then reconcile before retrying.',
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
      const message = extractErrorMessage(json) ?? `${providerLabel} returned status ${response.status}.`;
      throw new UserFacingError(message, {
        code:
          response.status === 401 || response.status === 403
            ? 'publisher_auth_failed'
            : response.status >= 500
              ? 'publisher_server_failed'
              : 'publisher_request_failed',
        fix:
          response.status === 401 || response.status === 403
            ? 'Check the API key and account ids for this provider.'
            : 'Check the request details and try again.',
        details: {
          status: response.status,
          body: json ?? text,
          ...(response.status === 404 ? { authenticated_not_found: true } : {}),
        },
      });
    }

    return { status: response.status, ok: response.ok, json, text };
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    if (error && error.name === 'AbortError') {
      throw new UserFacingError(`${providerLabel} did not respond in time.`, {
        code: 'publisher_timeout',
        fix: 'Try again in a moment, or check the provider status page.',
      });
    }
    throw new UserFacingError(`${providerLabel} could not be reached: ${String(error && error.message ? error.message : error)}.`, {
      code: 'publisher_unreachable',
      fix: 'Check your internet connection and the base URL for this provider.',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best effort extraction of a human readable message from a provider error body.
 * @param {any} json
 * @returns {string|null}
 */
function extractErrorMessage(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.error === 'string') return json.error;
  if (json.error && typeof json.error.message === 'string') return json.error.message;
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const first = json.errors[0];
    if (typeof first === 'string') return first;
    if (first && typeof first.message === 'string') return first.message;
  }
  return null;
}
