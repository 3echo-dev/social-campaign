import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { captureBrandKit } from '../brand-kit/capture.mjs';

const require = createRequire(import.meta.url);
const brandProfileRuntime = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));
const libBrandKit = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-kit.js'));

const string = { type: 'string' };
const object = { type: 'object' };

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

function websiteUrl(brand) {
  let profile = null;
  try { profile = brandProfileRuntime.read(brand.path); } catch { profile = null; }
  const website = profile?.channels?.website;
  if (!website || website.status === 'unavailable') return null;
  return typeof website.url === 'string' ? website.url : null;
}

function emptyKitOutput(status, brand, reason, skippedParts) {
  return { status, brand: brand.slug, captureId: null, logoCandidates: 0, palette: [], fonts: [], code: null, reason: reason || null, skippedParts };
}

function sectionSixOutput(brand, recorded, skippedParts) {
  const capture = recorded?.capture || {};
  const proposed = recorded?.proposed || null;
  return {
    status: capture.status || 'failed',
    brand: brand.slug,
    captureId: capture.captureId || null,
    logoCandidates: proposed && Array.isArray(proposed.logoCandidates) ? proposed.logoCandidates.length : 0,
    palette: (proposed && proposed.palette) || [],
    fonts: (proposed && proposed.fonts) || [],
    code: capture.code ?? null,
    reason: capture.reason ?? null,
    skippedParts,
  };
}

export const brandKitTools = [
  tool(
    'web_brand_kit',
    'Read a brand website\'s public logo, colour and font signals to propose a starter brand kit. Static read only, honours robots.txt, and never returns image bytes.',
    { brand: string, url: string },
    ['brand'],
    async (args, { workspace }) => {
      const root = local(workspace);
      const brand = resolveBrandEntry(root, args.brand);
      const provided = libBrandKit.providedParts(brand.path);
      const skippedParts = ['logo', 'palette', 'fonts'].filter((part) => provided?.[part]);
      if (provided?.logo && provided?.palette && provided?.fonts) {
        return emptyKitOutput('skipped', brand, 'The person provided the logo, colours and fonts.', skippedParts);
      }
      const url = (typeof args.url === 'string' && args.url.trim()) ? args.url.trim() : websiteUrl(brand);
      if (!url) {
        return emptyKitOutput('no_website', brand, 'No website is on file for this brand.', skippedParts);
      }
      const now = new Date();
      const captureId = libBrandKit.newCaptureId(now);
      const begun = libBrandKit.beginCapture(brand.path, { url, now, captureId });
      if (!begun.started) {
        const runningId = begun.record?.capture?.captureId || captureId;
        const reason = begun.record?.capture?.reason || 'A capture is already running for this brand.';
        return { status: 'already_running', brand: brand.slug, captureId: runningId, logoCandidates: 0, palette: [], fonts: [], code: null, reason, skippedParts };
      }
      let result;
      try {
        result = await captureBrandKit({ url, now });
      } catch (error) {
        result = { status: 'failed', code: 'unexpected', reason: error?.message || 'The capture failed.', candidates: [], palette: [], fonts: [] };
      }
      const recorded = libBrandKit.recordCapture(brand.path, captureId, result, { now });
      return sectionSixOutput(brand, recorded, skippedParts);
    },
  ),
  tool(
    'pipeline_brand_kit_save',
    'Save a confirmed brand kit (logo, colours and fonts) for an onboarded brand from chat intake.',
    { brand: string, requestId: string, kit: object, confirmedBy: string },
    ['brand', 'requestId', 'kit', 'confirmedBy'],
    (args, { workspace }) => {
      const root = local(workspace);
      return runtime.saveBrandKit({ root, brand: args.brand, requestId: args.requestId, kit: args.kit, confirmedBy: args.confirmedBy });
    },
  ),
];
