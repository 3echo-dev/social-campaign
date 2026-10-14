/**
 * integration_probes_save: the connector checks of one setup, saved in a single call.
 *
 * Setup finds every connector that is present in the session (3Echo Studio, ElevenLabs, Metricool, Meta ads,
 * TikTok ads), runs each one's cheap read-only call in parallel in one message, and used to save every result with
 * its own integration_probe call, then pipeline_metricool_brands_save / pipeline_ad_accounts_save once more for the
 * ones that return a list. Each of those was a round trip. This saves them all at once and returns what each
 * save found (chosen, asked, waiting, needsChoice), so a first setup spends one call here instead of ten.
 *
 * integration_probe stays as it is. Each probe is recorded by the same function, one after the other under the
 * same file lock, so a result here is exactly what the single call would have written. One bad item never fails
 * the others: it comes back with its own error.
 */

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError, toErrorPayload } from '../lib/errors.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { saveBrandsAndChoose } from '../pipeline/metricool.mjs';
import { saveAdAccountsAndChoose } from '../pipeline/ad-accounts.mjs';
import { refreshPlansForBrand } from '../pipeline/board.mjs';
import { PROBE_PROVIDERS, recordIntegrationProbe } from './generation.mjs';

/** The most probes one call takes: every provider once. */
export const PROBES_PER_CALL = PROBE_PROVIDERS.length;

/** The providers whose connector returns a list that has its own save. */
const LIST_PROVIDERS = Object.freeze(['metricool', 'meta_ads', 'tiktok_ads']);

/** @param {unknown} value */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {import('../workspace/index.mjs').Workspace} workspace */
function localRoot(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

/**
 * Save the list a connector returned, the way the provider's own save tool does.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @param {string} provider
 * @param {unknown} data
 */
function saveList(workspace, provider, data) {
  const root = localRoot(workspace);
  if (provider === 'metricool') {
    const result = saveBrandsAndChoose({ root, brands: data });
    // A brand given a Metricool brand just now gets its posting plans brought up to date too.
    for (const item of result.chosen) refreshPlansForBrand(root, item.brand);
    for (const slug of result.unlinked || []) refreshPlansForBrand(root, slug);
    return result;
  }
  return saveAdAccountsAndChoose({ root, provider, accounts: data });
}

export const integrationProbesTools = [
  defineTool({
    name: 'integration_probes_save',
    description:
      'Save the connector checks of one setup in a single call, instead of one integration_probe call per provider ' +
      '(and then pipeline_metricool_brands_save / pipeline_ad_accounts_save for each list). Run every connector\'s ' +
      'read-only call first, all in parallel in one message, then pass one entry per provider that was present: ' +
      '{provider, ok, namespace, detail} exactly as integration_probe takes it, plus, for metricool, meta_ads and tiktok_ads ' +
      'when ok is true, `data`: the result of that connector\'s account listing (Metricool getBrandSettings, Meta ads_get_ad_accounts, ' +
      'TikTok auth_advertiser_get) passed on as it came back. Each entry is recorded the same way integration_probe records it, ' +
      'and each list is saved the same way its own save tool saves it; the answer has one result per entry with the ' +
      'chosen, asked, waiting and needsChoice of the list save, so the person can be told in one line what needs their answer. ' +
      'One entry that fails comes back with its own error and never stops the others. Never pass data from a tool that ' +
      'creates, changes or sends anything. Publish the workspace projection afterwards when any result lists asked or needsChoice.',
    inputSchema: {
      type: 'object',
      properties: {
        probes: {
          type: 'array',
          maxItems: PROBES_PER_CALL,
          description: 'One entry per provider that was present in this session.',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: PROBE_PROVIDERS, description: 'threeecho_studio, elevenlabs, metricool, meta_ads or tiktok_ads.' },
              ok: { type: 'boolean', description: 'true when the read-only call answered.' },
              namespace: { type: 'string', description: 'The tool namespace that answered, when available.' },
              detail: { type: 'string', description: 'One plain sentence about what happened.' },
              data: { description: 'metricool, meta_ads and tiktok_ads only, when ok is true: the account listing result as returned.' },
            },
            required: ['provider', 'ok'],
            additionalProperties: false,
          },
        },
      },
      required: ['probes'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const probes = Array.isArray(args.probes) ? args.probes : [];
      if (probes.length === 0) {
        throw new InvalidInputError('There is nothing to save.', { fix: 'Pass one entry for each connector that was present, with provider and ok.' });
      }
      if (probes.length > PROBES_PER_CALL) {
        throw new InvalidInputError(`At most ${PROBES_PER_CALL} entries fit in one call.`, { fix: 'Pass each provider once.' });
      }
      const seen = new Set();
      /** @type {Array<Record<string, any>>} */
      const results = [];
      /** @type {Record<string, unknown>} */
      let providers = {};
      for (const entry of probes) {
        const provider = String(entry?.provider ?? '');
        if (!PROBE_PROVIDERS.includes(provider)) {
          results.push({ provider, saved: false, error: { code: 'invalid_input', message: `"${provider}" is not a provider this tool can probe.`, fix: `Use one of ${PROBE_PROVIDERS.join(', ')}.` } });
          continue;
        }
        if (seen.has(provider)) {
          results.push({ provider, saved: false, error: { code: 'invalid_input', message: `${provider} is listed twice.`, fix: 'Pass each provider once.' } });
          continue;
        }
        seen.add(provider);
        const ok = Boolean(entry.ok);
        const probe = recordIntegrationProbe(workspace, {
          provider,
          ok,
          detail: optionalString(entry.detail) ?? (ok ? 'Answered a real request.' : 'The last request did not go through.'),
          namespace: optionalString(entry.namespace),
        });
        providers = probe.providers;
        /** @type {Record<string, any>} */
        const result = { provider, ok, state: probe.state, namespace: probe.namespace };
        if (ok && LIST_PROVIDERS.includes(provider) && entry.data !== undefined && entry.data !== null) {
          try {
            result.list = saveList(workspace, provider, entry.data);
          } catch (error) {
            const payload = toErrorPayload(error);
            result.list = null;
            result.error = { code: payload.code, message: payload.message, fix: payload.fix };
          }
        }
        results.push(result);
      }
      return { ok: results.every((item) => !item.error), results, providers };
    },
  }),
];
