import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { UserFacingError } from '../lib/errors.mjs';

const require = createRequire(import.meta.url);
const brandProfileRuntime = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));

const string = { type: 'string' };
const object = { type: 'object' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new UserFacingError('Choose your local working folder through setup first.', { code: 'workspace_not_configured' });
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function resolveBrandEntry(root, value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new UserFacingError('A brand id or slug is required.', { code: 'invalid_input' });
  const brand = runtime.listBrands({ root }).find((entry) => entry.id === input || entry.brandId === input || entry.slug === input);
  if (!brand) throw new UserFacingError(`Brand not found: ${input}`, { code: 'invalid_input' });
  return brand;
}

function readProfileOrThrow(brand) {
  const profile = brandProfileRuntime.read(brand.path);
  if (!profile) throw new UserFacingError('This brand has no saved profile yet.', { code: 'invalid_input' });
  return profile;
}

export const brandTidyTools = [
  tool(
    'pipeline_brand_tidy_check',
    'List the context fields on an onboarded brand profile that are over their length limit or still read like a research note (a link, a bare domain, a date, or a citation word) rather than brand copy.',
    { brand: string },
    ['brand'],
    (args, { workspace }) => {
      const root = local(workspace);
      const brand = resolveBrandEntry(root, args.brand);
      const profile = readProfileOrThrow(brand);
      return { brand: brand.slug, revision: profile.revision, fields: brandProfileRuntime.profileTidyReport(profile) };
    },
  ),
  tool(
    'pipeline_brand_tidy_save',
    'Save rewritten values for context fields a research pass filled in on an onboarded brand profile. A field the person typed on the brand card is refused; it is edited there instead.',
    { brand: string, fields: object },
    ['brand', 'fields'],
    (args, { workspace }) => {
      const root = local(workspace);
      const brand = resolveBrandEntry(root, args.brand);
      const profile = readProfileOrThrow(brand);
      const fields = args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields) ? args.fields : null;
      const names = fields ? Object.keys(fields) : [];
      if (!names.length) throw new UserFacingError('Name at least one field to tidy.', { code: 'invalid_input' });
      const researchFilled = (profile.provenance && profile.provenance.researchFilled) || {};
      for (const name of names) {
        if (!brandProfileRuntime.CONTEXT_FIELDS.includes(name)) {
          throw new UserFacingError(`"${name}" is not a context field that can be tidied.`, { code: 'invalid_input' });
        }
        if (!researchFilled[name]) {
          throw new UserFacingError(`"${name}" was typed on the brand card. Edit it there instead.`, { code: 'invalid_input' });
        }
      }
      const saved = brandProfileRuntime.save(brand.path, fields, {});
      runtime.writeBrandVoice({ root, brand: brand.slug });
      return { brand: brand.slug, revision: saved.revision, fields: brandProfileRuntime.profileTidyReport(saved) };
    },
  ),
];
