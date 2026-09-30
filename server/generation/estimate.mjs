/**
 * The cost estimate behind the cost gate.
 *
 * buildEstimate turns a media plan into the itemized estimate review_cost shows.
 * It is pure: no database, no network, no clock. Everything it needs about price
 * arrives in the plan, because only Claude can ask a provider for a quote.
 *
 * Pricing rules, from spec sections 29 to 31 and the live 3echo tool surface:
 *   image      1 credit per generated image, flat rate, never worth a quote call
 *   video      variable, so the plan must carry provider_quote from estimate_video_job
 *   voice/audio billed by ElevenLabs against the user's own plan, not in 3echo credits
 *   subtitle   local ffmpeg work, free
 *
 * An item without the quote it needs is not guessed at. It comes back with
 * needs_quote set, and the estimate reports complete: false so the caller knows to
 * fetch the missing quotes before opening the gate.
 */

import { InvalidInputError } from '../lib/errors.mjs';
import { requestHash } from './cost-gate.mjs';

/** The kinds a media plan item may ask for. */
export const MEDIA_KINDS = ['image', 'video', 'voice', 'audio', 'subtitle'];

/** Credits for one generated image. Flat rate on 3echo Studio. */
export const IMAGE_CREDITS_EACH = 1;

/** Characters assumed per second of speech when a voice item gives only a duration. */
const CHARS_PER_SECOND = 14;

/**
 * @typedef {object} MediaPlanItem
 * @property {string} id
 * @property {'image'|'video'|'voice'|'audio'|'subtitle'} kind
 * @property {number} [count]
 * @property {number} [duration_s]
 * @property {string} [resolution]
 * @property {string} [ratio]
 * @property {string} [label]
 * @property {string} [prompt]
 * @property {string} [text]
 * @property {number} [characters]
 * @property {{credits?: number, per?: 'clip'|'batch', quoted_at?: string}} [provider_quote]
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

/**
 * How many characters a voice or audio item will send to the provider.
 * @param {MediaPlanItem} item
 * @returns {number}
 */
export function characterCount(item) {
  if (Number.isFinite(Number(item.characters)) && Number(item.characters) > 0) {
    return Math.round(Number(item.characters));
  }
  if (typeof item.text === 'string' && item.text.trim().length > 0) {
    return item.text.trim().length * positiveInt(item.count, 1);
  }
  const duration = Number(item.duration_s);
  if (Number.isFinite(duration) && duration > 0) {
    return Math.round(duration * CHARS_PER_SECOND) * positiveInt(item.count, 1);
  }
  return 0;
}

/**
 * A short human label for a plan item, used on the cost screen.
 * @param {MediaPlanItem} item
 * @returns {string}
 */
function labelFor(item) {
  if (typeof item.label === 'string' && item.label.trim()) return item.label.trim();
  const count = positiveInt(item.count, 1);
  const noun = { image: 'image', video: 'video clip', voice: 'voiceover', audio: 'audio track', subtitle: 'subtitle track' }[
    item.kind
  ];
  const plural = count === 1 ? noun : `${noun}s`;
  const size = item.resolution || item.ratio ? ` ${[item.resolution, item.ratio].filter(Boolean).join(' ')}` : '';
  return `${count} ${plural}${size}`;
}

/**
 * The canonical request hash for a media plan item, using the fields the plan itself
 * carries. This is the hash the cost gate binds an approval to; `generation_begin`
 * recomputes the same hash from the exact request the agent is about to submit and
 * refuses when the two disagree, per server/generation/cost-gate.mjs.
 * @param {MediaPlanItem} item
 * @param {string} tool
 * @returns {string}
 */
function itemRequestHash(item, tool) {
  return requestHash({
    tool,
    provider: '3echo_studio',
    model: /** @type {any} */ (item).model ?? null,
    prompt: item.prompt ?? null,
    reference_asset_ids: /** @type {any} */ (item).reference_asset_ids ?? [],
    duration_s: item.duration_s ?? null,
    resolution: item.resolution ?? null,
    ratio: item.ratio ?? null,
    generate_audio: /** @type {any} */ (item).generate_audio ?? false,
    count: item.count ?? 1,
  });
}

/**
 * Price one plan item.
 * @param {MediaPlanItem} item
 * @returns {{item_id: string, label: string, kind: string, provider: string, units: number, unit_label: string, unit_cost: number|null, credits: number|null, needs_quote: boolean, provider_billed: boolean, note: string|null}}
 */
function estimateItem(item) {
  const count = positiveInt(item.count, 1);
  const base = {
    item_id: String(item.id),
    label: labelFor(item),
    kind: item.kind,
    units: count,
    unit_label: 'item',
    needs_quote: false,
    provider_billed: false,
    note: /** @type {string|null} */ (null),
  };

  switch (item.kind) {
    case 'image':
      return {
        ...base,
        provider: '3echo_studio',
        unit_label: 'image',
        unit_cost: IMAGE_CREDITS_EACH,
        credits: count * IMAGE_CREDITS_EACH,
        request_hash: itemRequestHash(item, 'create_image_job'),
      };
    case 'video': {
      const quote = item.provider_quote ?? {};
      const quoted = Number(quote.credits);
      if (!Number.isFinite(quoted) || quoted < 0) {
        return {
          ...base,
          provider: '3echo_studio',
          unit_label: 'clip',
          unit_cost: null,
          credits: null,
          needs_quote: true,
          note: 'Video pricing depends on length and resolution, so this item still needs a quote.',
          request_hash: itemRequestHash(item, 'create_video_job'),
        };
      }
      const perBatch = quote.per === 'batch';
      return {
        ...base,
        provider: '3echo_studio',
        unit_label: 'clip',
        unit_cost: perBatch ? null : quoted,
        credits: perBatch ? quoted : quoted * count,
        request_hash: itemRequestHash(item, 'create_video_job'),
      };
    }
    case 'voice':
    case 'audio': {
      const characters = characterCount(item);
      return {
        ...base,
        provider: 'elevenlabs',
        units: characters,
        unit_label: 'character',
        unit_cost: null,
        credits: 0,
        provider_billed: true,
        note: 'Billed by your voice and audio provider, not in generation credits.',
      };
    }
    case 'subtitle':
      return {
        ...base,
        provider: 'local',
        unit_label: 'track',
        unit_cost: 0,
        credits: 0,
        note: 'Made on this computer at no cost.',
      };
    default:
      throw new InvalidInputError(`"${item.kind}" is not something Social Campaign can make.`, {
        fix: `Use one of: ${MEDIA_KINDS.join(', ')}.`,
      });
  }
}

/**
 * Extra allowance so a regeneration after media review does not need a second
 * trip through the cost gate. The plan says how many retries to cover.
 * @param {any} headroom
 * @returns {{item_id: string, label: string, kind: string, provider: string, units: number, unit_label: string, unit_cost: number|null, credits: number|null, needs_quote: boolean, provider_billed: boolean, note: string|null}|null}
 */
function headroomItem(headroom) {
  if (!headroom || typeof headroom !== 'object') return null;
  const images = positiveInt(/** @type {any} */ (headroom).images, 0);
  const videos = positiveInt(/** @type {any} */ (headroom).videos, 0);
  if (images === 0 && videos === 0) return null;
  const videoEach = Number(/** @type {any} */ (headroom).video_credits_each);
  const needsQuote = videos > 0 && !(Number.isFinite(videoEach) && videoEach >= 0);
  const credits = needsQuote ? null : images * IMAGE_CREDITS_EACH + videos * (Number.isFinite(videoEach) ? videoEach : 0);
  const parts = [];
  if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'}`);
  if (videos > 0) parts.push(`${videos} video clip${videos === 1 ? '' : 's'}`);
  return {
    item_id: 'regeneration_headroom',
    label: `Room to redo ${parts.join(' and ')}`,
    kind: 'regeneration',
    provider: '3echo_studio',
    units: images + videos,
    unit_label: 'item',
    unit_cost: null,
    credits,
    needs_quote: needsQuote,
    provider_billed: false,
    note: 'Covers changes asked for at media review without another approval.',
  };
}

/**
 * Turn a media plan into the estimate review_cost expects.
 * @param {{media_plan: {items?: MediaPlanItem[], regeneration_headroom?: any}}} options
 * @returns {{items: any[], total_credits: number, needs_quote: string[], complete: boolean, provider_billed_characters: number, regeneration_headroom: {images: number, videos: number}|null, currency_note: string, summary: string}}
 */
export function buildEstimate({ media_plan: mediaPlan }) {
  const plan = mediaPlan ?? {};
  const rawItems = Array.isArray(plan.items) ? plan.items : [];
  if (rawItems.length === 0) {
    throw new InvalidInputError('There is nothing to make yet.', {
      fix: 'Add at least one image, video, voiceover or audio item to the plan.',
    });
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || !item.id) {
      throw new InvalidInputError('Every item in the plan needs its own id.');
    }
    if (seen.has(String(item.id))) {
      throw new InvalidInputError(`Two items in the plan share the id "${item.id}".`);
    }
    seen.add(String(item.id));
  }

  const items = rawItems.map((item) => estimateItem(item));
  const extra = headroomItem(plan.regeneration_headroom);
  if (extra) items.push(extra);

  const totalCredits = items.reduce((sum, item) => sum + (Number.isFinite(Number(item.credits)) ? Number(item.credits) : 0), 0);
  const needsQuote = items.filter((item) => item.needs_quote).map((item) => item.item_id);
  const characters = items.reduce((sum, item) => sum + (item.provider_billed ? item.units : 0), 0);

  const pieces = [`${totalCredits} credit${totalCredits === 1 ? '' : 's'} for image and video generation`];
  if (characters > 0) pieces.push(`${characters} characters of voice or audio billed by your provider`);
  if (needsQuote.length > 0) pieces.push(`${needsQuote.length} item${needsQuote.length === 1 ? '' : 's'} still needs a quote`);

  return {
    items,
    total_credits: totalCredits,
    needs_quote: needsQuote,
    complete: needsQuote.length === 0,
    provider_billed_characters: characters,
    regeneration_headroom: extra
      ? { images: positiveInt(plan.regeneration_headroom?.images, 0), videos: positiveInt(plan.regeneration_headroom?.videos, 0) }
      : null,
    currency_note: 'Credits are spent in your 3echo Studio workspace. Voice and audio are billed by your voice provider.',
    summary: pieces.join(', ') + '.',
  };
}
