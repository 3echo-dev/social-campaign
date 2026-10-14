import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { captureBrandKit } from '../brand-kit/capture.mjs';
import { collectLogoCandidates } from '../brand-kit/logo-candidates.mjs';
import { coloursFromFrames, findOwnVideoFrames, framesToRead } from '../brand-kit/video-frames.mjs';
import { InvalidInputError } from '../lib/errors.mjs';

const require = createRequire(import.meta.url);
const brandProfileRuntime = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));
const libBrandKit = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-kit.js'));

const string = { type: 'string' };
const object = { type: 'object' };

const KIT_SCHEMA = {
  type: 'object',
  description: 'The brand kit. Every part is optional and a part left out (or logo null) stays as it is.',
  properties: {
    logo: {
      type: ['object', 'null'],
      description: 'What to do with the logo: {action: "keep"} (no change), {action: "remove"}, {action: "upload", mimeType, dataBase64} (PNG, WebP, JPEG or SVG, at most 40 KiB) or {action: "suggested", id} (one of the confirmed logo suggestions of web_brand_kit).',
    },
    palette: {
      type: 'array',
      description: 'Up to 8 colours.',
      items: { type: 'object', properties: { value: { type: 'string', description: 'Six-digit hex such as #1A2B3C.' }, role: { type: 'string', description: 'primary, secondary, accent, background, text or other.' }, name: string }, required: ['value', 'role'] },
    },
    fonts: {
      type: 'array',
      description: 'Up to 4 fonts.',
      items: { type: 'object', properties: { family: string, use: { type: 'string', description: 'headings, body, captions or other.' } }, required: ['family', 'use'] },
    },
  },
};

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function resolveBrandEntry(root, value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('A brand id or slug is required.');
  const brand = runtime.listBrands({ root }).find((entry) => entry.id === input || entry.brandId === input || entry.slug === input);
  if (!brand) throw new Error(`Brand not found: ${input}`);
  return brand;
}

function channelUrl(profile, name) {
  const channel = profile?.channels?.[name];
  if (!channel || channel.status === 'unavailable') return null;
  return typeof channel.url === 'string' && channel.url ? channel.url : null;
}

// What the person typed on the brand's details page before research started (a link or "Not available" for each channel), when there is any.
function detailUrl(details, name) {
  const value = details && details.channels && typeof details.channels[name] === 'string' ? details.channels[name].trim() : '';
  return value && !/^not available$/i.test(value) ? value : null;
}

function savedChannels(brand) {
  let profile = null;
  try { profile = brandProfileRuntime.read(brand.path); } catch { profile = null; }
  let details = null;
  try { details = typeof runtime.readBrandDetails === 'function' ? runtime.readBrandDetails(brand.path) : null; } catch { details = null; }
  const pick = (name) => channelUrl(profile, name) || detailUrl(details, name);
  return {
    website: pick('website'),
    social: { instagram: pick('instagram'), tiktok: pick('tiktok'), facebook: pick('facebook') },
  };
}

// The same website and accounts give the same kit, so a second call with nothing new to read answers from the first.
function channelsSignature(url, social) {
  const parts = [String(url || '').trim().toLowerCase(), ...['instagram', 'tiktok', 'facebook', 'youtube'].map((name) => String(social?.[name] || '').trim().toLowerCase())];
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

const SETTLED = new Set(['complete', 'partial']);

function emptyKitOutput(status, brand, reason, skippedParts) {
  return { status, brand: brand.slug, captureId: null, palette: [], paletteSource: null, fonts: [], code: null, reason: reason || null, skippedParts, logoCandidates: [], toReview: [] };
}

// What the kit holds now, from its record: the capture's own words, the proposed colours and fonts, and every logo candidate with the file
// the model reads to check it. No image bytes are returned.
function kitOutput(brand, record, skippedParts, extra = {}) {
  const capture = record?.capture || {};
  const proposed = record?.proposed || null;
  const logos = Array.isArray(record?.suggested?.logos) ? record.suggested.logos : [];
  const logoCandidates = logos.map((logo) => ({
    id: logo.id,
    source: logo.source,
    sources: Array.isArray(logo.sources) && logo.sources.length ? logo.sources : [logo.source],
    status: logo.checked === true ? 'confirmed' : 'needs_review',
    width: logo.width ?? null,
    height: logo.height ?? null,
    mimeType: logo.mimeType,
    path: join(brand.path, 'brand', String(logo.src)),
  }));
  return {
    status: capture.status || 'not_started',
    brand: brand.slug,
    captureId: capture.captureId || null,
    palette: (proposed && proposed.palette) || [],
    paletteSource: (proposed && proposed.paletteSource) || null,
    fonts: (proposed && proposed.fonts) || [],
    fontsSource: (proposed && proposed.fontsSource) || null,
    logoCandidates,
    toReview: logoCandidates.filter((logo) => logo.status === 'needs_review').map((logo) => logo.id),
    code: capture.code ?? null,
    reason: capture.reason ?? null,
    skippedParts,
    ...extra,
  };
}

// The colours of the best logo the model confirmed become the proposed palette ("From your logo"); with none confirmed they go away again.
function syncLogoPalette(brandDir, now) {
  const best = libBrandKit.checkedSuggestedLogos(brandDir)[0];
  return libBrandKit.suggestPalette(brandDir, { from: 'logo', colours: best ? best.colours : [] }, { now });
}

export const brandKitTools = [
  tool(
    'web_brand_kit',
    'Fill a brand\'s starter kit from the brand\'s own places, as suggestions the person can edit: colours and fonts from the website, the logo from the website\'s header or icon and from the brand\'s own TikTok, Instagram, Facebook and YouTube profile pictures (never a search engine, an image search or a third-party page), and, when the website gives no colours, colours from the suggested logo and from frames of the brand\'s own top videos. Works with no website at all. Read only, honours the site\'s rules for automated readers, and never returns image bytes. With only brand (and optionally url) it captures, and returns logoCandidates (at most 3, each with the local file path to Read): look at every candidate picture, then call again with review to say which show the brand\'s mark or name. Only a confirmed candidate is offered to the person. With videos true it reads colours from frames of the brand\'s own top videos once research took them apart and returns frames to Read for the on-screen typeface; with fontGuess it saves the closest Google font to that typeface as a "looks like" suggestion. Call it again when a website or social link is added or changed; asked again with nothing new it answers from the first read (refresh true reads again).',
    {
      brand: string,
      url: string,
      review: {
        type: 'array',
        maxItems: 3,
        description: 'Your verdict on each logo candidate after you looked at its picture: brand when it shows the brand\'s mark, initials or name (a SVG: read its text), not_brand for anything else (a photo, a person, a product, another company\'s mark, a placeholder). A not_brand picture is deleted and not offered again.',
        items: { type: 'object', properties: { id: string, verdict: { type: 'string', enum: ['brand', 'not_brand'] }, note: { type: 'string', description: 'What the picture shows, in a few words.' } }, required: ['id', 'verdict'] },
      },
      videos: { type: 'boolean', description: 'Read colours from frames of the brand\'s own top videos (those research took apart). Returns frames, the picture files to Read, to see which typeface the on-screen text uses.' },
      fontGuess: {
        type: 'array',
        maxItems: 2,
        description: 'The Google fonts that look closest to the on-screen text of the brand\'s videos, after you read the frames. A low confidence suggestion shown as "looks like"; ignored when the kit already has fonts from the website or the person.',
        items: { type: 'object', properties: { family: string, use: { type: 'string', enum: ['headings', 'body', 'captions', 'other'] } }, required: ['family', 'use'] },
      },
      refresh: { type: 'boolean', description: 'Read the website and accounts again even though nothing changed since the last read.' },
    },
    ['brand'],
    async (args, { workspace }) => {
      const root = local(workspace);
      const brand = resolveBrandEntry(root, args.brand);
      const provided = libBrandKit.providedParts(brand.path);
      const skippedParts = ['logo', 'palette', 'fonts'].filter((part) => provided?.[part]);
      const now = new Date();
      const saved = savedChannels(brand);

      // Follow-ups: the model's verdicts on the candidates, the colours of the videos, a typeface it read from their frames.
      if (Array.isArray(args.review) || args.videos === true || Array.isArray(args.fontGuess)) {
        const extra = {};
        if (Array.isArray(args.review)) {
          const reviewed = libBrandKit.reviewSuggestedLogos(brand.path, args.review, { now });
          const palette = syncLogoPalette(brand.path, now);
          extra.review = { accepted: reviewed.accepted, dropped: reviewed.dropped, unknown: reviewed.unknown, paletteFromLogo: palette.applied && palette.palette.some((entry) => entry.from === 'logo') };
        }
        if (Array.isArray(args.fontGuess)) {
          const guessed = libBrandKit.suggestFonts(brand.path, args.fontGuess, { now });
          extra.fontGuess = guessed.applied ? { applied: true, fonts: guessed.fonts } : { applied: false, reason: guessed.reason };
        }
        if (args.videos === true) {
          const found = findOwnVideoFrames({ brandDir: brand.path, social: saved.social });
          extra.videos = { count: found.videos, frames: framesToRead(found.frames) };
          if (!found.frames.length) {
            extra.videos.note = 'None of the brand\'s own videos has been taken apart yet, so there are no frames to read.';
          } else if (provided.palette) {
            extra.videos.colours = 'skipped: the person already gave colours';
          } else {
            const before = libBrandKit.read(brand.path)?.proposed?.palette || [];
            if (before.filter((entry) => entry && entry.from === 'logo').length >= 3) {
              extra.videos.colours = 'skipped: the logo already gave enough colours';
            } else {
              const read = await coloursFromFrames(found.frames);
              if (read.decoderMissing) extra.videos.colours = 'skipped: ffmpeg is not installed, so the frames cannot be read for colour';
              else if (!read.colours.length) extra.videos.colours = 'none: the frames show no brand colour (only greys, black and white)';
              else {
                const applied = libBrandKit.suggestPalette(brand.path, { from: 'videos', colours: read.colours.map((entry) => entry.hex) }, { now });
                extra.videos.colours = applied.applied ? 'suggested' : `skipped: ${applied.reason}`;
              }
            }
          }
        }
        return kitOutput(brand, libBrandKit.read(brand.path), skippedParts, extra);
      }

      if (provided?.logo && provided?.palette && provided?.fonts) {
        return emptyKitOutput('skipped', brand, 'The logo, colours and fonts were provided.', skippedParts);
      }
      const url = (typeof args.url === 'string' && args.url.trim()) ? args.url.trim() : saved.website;
      const signature = channelsSignature(url, saved.social);
      const existing = libBrandKit.read(brand.path);
      if (args.refresh !== true && existing?.proposed?.signature === signature && SETTLED.has(existing?.capture?.status)) {
        return kitOutput(brand, existing, skippedParts, { status: 'unchanged' });
      }
      const captureId = libBrandKit.newCaptureId(now);
      const begun = libBrandKit.beginCapture(brand.path, { url, now, captureId });
      if (!begun.started) {
        const runningId = begun.record?.capture?.captureId || captureId;
        const reason = begun.record?.capture?.reason || 'A capture is already running for this brand.';
        return { ...emptyKitOutput('already_running', brand, reason, skippedParts), captureId: runningId };
      }
      let result;
      try {
        // The accounts are read for their pictures below, so the website read gets none: its own colours, fonts and logo addresses only.
        const site = await captureBrandKit({ url, social: {}, wantPalette: !provided.palette });
        const wantLogos = !provided.logo;
        let logos = { candidates: [], dropped: [], accounts: {} };
        if (wantLogos) {
          try {
            logos = await collectLogoCandidates({ site, social: saved.social, workspaceRoot: root });
          } catch {
            logos = { candidates: [], dropped: [], accounts: {} };
          }
          // A read that found nothing (a network hiccup, a page that answered once) leaves what an earlier read found in place.
          if (logos.candidates.length) libBrandKit.saveSuggestedLogos(brand.path, logos.candidates, { now });
        }
        const hasColour = site.palette.some((entry) => entry.role !== 'background');
        const hasFonts = site.fonts.length > 0;
        const hasLogos = wantLogos && logos.candidates.length > 0;
        result = {
          ...site,
          signature,
          paletteSource: site.palette.length ? 'website' : null,
          fontsSource: hasFonts ? 'website' : null,
        };
        if (hasColour || (provided.palette && hasFonts)) {
          // The website gave the kit its colours (or the person did and the website gave fonts): captureBrandKit's own answer is complete.
        } else if (hasFonts || hasLogos) {
          // Something was found, but not everything: a partial kit, with no error to show.
          Object.assign(result, { status: 'partial', code: null, reason: null });
        } else if (site.code === 'nothing_found' || (!url && Object.values(saved.social).some(Boolean))) {
          Object.assign(result, { status: 'failed', code: 'nothing_found', reason: 'We could not find a logo, colours or fonts for this brand.' });
        }
      } catch {
        result = { status: 'failed', code: 'unexpected', reason: 'We could not read a logo, colours or fonts for this brand.', palette: [], paletteSource: null, fonts: [], fontsSource: null, signature };
      }
      const recorded = libBrandKit.recordCapture(brand.path, captureId, result, { now });
      // With no colour on the website, the colours of a logo the model already confirmed on an earlier read come back at once.
      if (!provided.palette && !(result.palette || []).some((entry) => entry.role !== 'background')) syncLogoPalette(brand.path, now);
      return kitOutput(brand, libBrandKit.read(brand.path) || recorded, skippedParts);
    },
  ),
  tool(
    'pipeline_brand_kit_save',
    'Save a confirmed brand kit (logo, colours and fonts) for an onboarded brand from chat intake. Every part of the kit is optional; a part left out stays as it is.',
    { brand: string, requestId: string, kit: KIT_SCHEMA, confirmedBy: string },
    ['brand', 'requestId', 'kit', 'confirmedBy'],
    (args, { workspace }) => {
      const root = local(workspace);
      if (!args.kit || typeof args.kit !== 'object' || Array.isArray(args.kit)) {
        throw new InvalidInputError('A brand kit is required.', { fix: 'Pass kit as an object with logo, palette and fonts.' });
      }
      let entry = null;
      try { entry = resolveBrandEntry(root, args.brand); } catch { entry = null; }
      const checked = libBrandKit.validateKitInput(args.kit, entry ? { record: libBrandKit.read(entry.path), brandDir: entry.path } : {});
      if (!checked.ok) {
        throw new InvalidInputError(`Fix the brand kit before submitting: ${checked.errors.join(' ')}`, { fix: 'Use logo {action: keep|remove|upload|suggested}, palette [{value: "#RRGGBB", role}] and fonts [{family, use}].' });
      }
      return runtime.saveBrandKit({ root, brand: args.brand, requestId: args.requestId, kit: args.kit, confirmedBy: args.confirmedBy });
    },
  ),
];
