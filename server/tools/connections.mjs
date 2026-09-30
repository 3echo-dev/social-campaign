/**
 * Shared data and routing for the canonical Connections page.
 *
 * Every tool that opens a provider connection uses this module so the pane has
 * one screen shape, one setup/home context rule and one set of card copy.
 */

import { resolveCapabilities } from '../capabilities/resolve.mjs';
import { PROVIDER_LABELS } from '../publishing/adapter.mjs';

/** The card keys, in the order they are shown. */
export const CONNECTION_CARDS = ['image_video', 'voice_audio', 'publishing'];

/** @type {Record<string, {provider: string, title: string, purpose: string, actions: string[]}>} */
const CARD_COPY = {
  image_video: {
    provider: 'threeecho_studio',
    title: '3Echo Studio',
    purpose: 'Generate images and videos.',
    actions: ['check_again', 'skip'],
  },
  voice_audio: {
    provider: 'elevenlabs',
    title: 'ElevenLabs',
    purpose: 'Generate the voice-over for your videos.',
    actions: ['check_again', 'skip'],
  },
  publishing: {
    provider: 'publisher',
    title: 'Publishing',
    purpose: 'Post to social media.',
    actions: ['connect', 'skip'],
  },
};

export const THREEECHO_CONNECTOR_GUIDANCE = 'Add 3Echo Studio in claude.ai: Settings, Connectors, then come back and say done.';

/** The statuses shown on every card. */
export const STATE_TEXT = {
  connected: 'Connected',
  connected_own: 'Connected',
  not_connected: 'Not connected',
  problem: 'Needs attention',
};

/**
 * Kept as an export for callers that imported the old setup module constant.
 * The canonical page no longer includes a social research note in its data.
 */
export const SOCIAL_RESEARCH_NOTE = [
  'Social research needs nothing connected.',
  'Some sites show very little to a signed out reader, so findings always say where they came from and how sure Social Campaign is.',
].join(' ');

const PROVIDER_TO_CARD = {
  threeecho_studio: 'image_video',
  threeecho: 'image_video',
  elevenlabs: 'voice_audio',
  publisher: 'publishing',
};

/**
 * Resolve a provider name to the canonical card key.
 * @param {unknown} provider
 * @returns {'image_video'|'voice_audio'|'publishing'|null}
 */
export function connectionKeyForProvider(provider) {
  const key = typeof provider === 'string' ? PROVIDER_TO_CARD[provider.trim()] : null;
  return key ?? null;
}

/**
 * Resolve the setup/home context for a Connections opener.
 *
 * An explicit boolean is authoritative. When omitted, a Connections refresh
 * inherits the current setup context so a focused provider check cannot replace
 * the setup page with the home page. Focusing publishing from setup still moves
 * to the home variant; the card itself is hidden everywhere until publishing is
 * back in use, but the connect action it would use stays reachable there.
 * @param {import('../ui/server.mjs').UiServer} ui
 * @param {unknown} requestedSetup
 * @param {unknown} focus
 * @returns {boolean}
 */
export function resolveConnectionsSetup(ui, requestedSetup, focus = null) {
  if (typeof requestedSetup === 'boolean') return requestedSetup;
  const current = ui?.screen;
  if (focus === 'publishing' && current?.type === 'connections' && current.data?.setup === true) return false;
  return current?.type === 'connections' ? Boolean(current.data?.setup) : false;
}

/**
 * Which of the four card states a provider is in.
 * @param {Record<string, any>|null|undefined} record
 * @param {string|undefined} capabilityState
 * @returns {'connected'|'connected_own'|'not_connected'|'problem'}
 */
export function cardStateOf(record, capabilityState) {
  const recorded = record && typeof record === 'object' ? String(record.state ?? '') : '';
  if (capabilityState === 'degraded') return 'problem';
  if (capabilityState && capabilityState !== 'ready') return 'not_connected';
  if (recorded === 'degraded') return 'problem';
  if (recorded === 'connected' || capabilityState === 'ready') {
    const namespace = record && typeof record.namespace === 'string' ? record.namespace : '';
    return namespace && !namespace.startsWith('plugin_social-campaign') ? 'connected_own' : 'connected';
  }
  return 'not_connected';
}

/**
 * Everything the canonical Connections screen shows.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{setup?: boolean, reason?: string|null, focus?: string|null, connectionDetail?: string|null, note?: string|null, canRetry?: boolean}} [options]
 */
export async function connectionsScreenData(workspace, options = {}) {
  const setup = Boolean(options.setup);
  const { capabilities, details } = await resolveCapabilities(workspace);
  const integrations = workspace.root ? workspace.readIntegrations() : {};
  const capabilityFor = { image_video: 'generation.image', voice_audio: 'generation.voice', publishing: 'publishing.schedule' };
  // Publishing is not in use right now, so its card is hidden everywhere the
  // Connections page shows, in setup and from home alike. The publisher tools
  // and the `connect` action stay registered - only the card stops rendering.
  const visibleCards = CONNECTION_CARDS.filter((key) => key !== 'publishing');

  const cards = visibleCards.map((key) => {
    const copy = CARD_COPY[key];
    const record = integrations[copy.provider];
    const state = cardStateOf(record, capabilities[capabilityFor[key]]);
    const recordedDetail = record && typeof record === 'object' && typeof record.detail === 'string' ? record.detail.trim() : '';
    const resolvedDetail = details[capabilityFor[key]] && typeof details[capabilityFor[key]].detail === 'string' ? details[capabilityFor[key]].detail.trim() : '';
    const contextualDetail = options.focus === key
      ? typeof options.connectionDetail === 'string'
        ? options.connectionDetail.trim()
        : typeof options.note === 'string'
          ? options.note.trim()
          : ''
      : '';
    const detail = contextualDetail || resolvedDetail || recordedDetail;
    const card = {
      key,
      provider: copy.provider,
      title: copy.title,
      purpose: copy.purpose,
      state,
      stateText: STATE_TEXT[state],
      connectionVersion: record && typeof record === 'object' && typeof record.updated_at === 'string' ? record.updated_at : null,
      connectionDetail: state === 'problem' || contextualDetail ? detail || null : null,
      actions: copy.actions,
      reason: options.focus === key && options.reason ? String(options.reason) : null,
      canRetry: Boolean(state === 'problem' || (options.focus === key && options.canRetry)),
      note: key === 'image_video' && state === 'not_connected' ? THREEECHO_CONNECTOR_GUIDANCE : null,
    };
    return card;
  });

  const publisher = integrations.publisher && typeof integrations.publisher === 'object' ? integrations.publisher : null;
  const publisherConnection = publisher
    ? {
        provider: typeof publisher.provider === 'string' ? publisher.provider : null,
        base_url: typeof publisher.base_url === 'string' ? publisher.base_url : null,
        account_ids:
          publisher.account_ids && typeof publisher.account_ids === 'object'
            ? Object.fromEntries(
                Object.entries(publisher.account_ids)
                  .filter(([, value]) => typeof value === 'string')
                  .map(([platform, value]) => [platform, value]),
              )
            : {},
      }
    : null;

  return {
    title: 'Connect your tools',
    setup,
    focus: typeof options.focus === 'string' ? options.focus : null,
    cards,
    providers: Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label })),
    publisherConnection,
    continueLabel: setup ? 'Continue to Social Campaign' : 'Back to Social Campaign',
  };
}

/**
 * Show the canonical Connections screen and register its live refresher.
 * @param {import('../ui/server.mjs').UiServer} ui
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {{setup?: boolean, reason?: string|null, focus?: string|null, connectionDetail?: string|null, note?: string|null, canRetry?: boolean, acknowledgeActionId?: string|null}} [options]
 * @returns {Promise<import('../ui/server.mjs').ScreenState>}
 */
export async function showConnections(ui, workspace, options = {}) {
  const focus = typeof options.focus === 'string' ? options.focus : null;
  const setup = resolveConnectionsSetup(ui, options.setup, focus);
  const normalized = { ...options, setup };
  const screen = ui.show('connections', await connectionsScreenData(workspace, normalized), {
    contextKey: setup ? 'setup' : 'home',
  });
  ui.registerRefresher('connections', () => connectionsScreenData(workspace, normalized));
  if (options.acknowledgeActionId && typeof ui.clearBusyForAction === 'function') {
    ui.clearBusyForAction(screen.screenId, options.acknowledgeActionId);
  }
  return screen;
}
