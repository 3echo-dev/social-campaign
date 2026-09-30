import { resolve } from 'node:path';

import { defineTool } from '../mcp/registry.mjs';
import { applyPermissionRules, previewPermissionRules } from '../setup/permissions.mjs';

const string = { type: 'string' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function projectRootOf(workspace) {
  return resolve((workspace && workspace.projectRoot) || process.cwd());
}

export const permissionsTools = [
  tool(
    'setup_permissions_preview',
    "Preview the local allow rules that let this project's own tools and its board run without extra approval prompts. Returns the exact rules, a rulesHash to pass to setup_permissions_apply, which rules are already allowed, and any existing rule that would still block one of them. Read only, writes nothing.",
    {},
    [],
    (_args, { workspace }) => previewPermissionRules({ projectRoot: projectRootOf(workspace) }),
  ),
  tool(
    'setup_permissions_apply',
    "Add the previewed allow rules to this project's local settings, but only when rulesHash matches what setup_permissions_preview just returned. Adds only the rules that are missing, keeps every other setting untouched, and never removes or reorders existing rules. When the settings file cannot be read as JSON, nothing is written and the lines to add by hand are returned instead.",
    { rulesHash: string },
    ['rulesHash'],
    (args, { workspace }) => applyPermissionRules({ projectRoot: projectRootOf(workspace), rulesHash: args.rulesHash }),
  ),
];
