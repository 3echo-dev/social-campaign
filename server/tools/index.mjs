/**
 * Every bundled tool, in one registry.
 *
 * To add a tool: create or open a file in this folder, export an array of
 * defineTool(...) results, and add it to ALL_TOOL_MODULES below. Nothing else in the
 * server needs to change. See docs/ARCHITECTURE.md, "How to add a tool".
 *
 * One import and one array entry per line, so parallel work on different domains
 * never edits the same line.
 */

import { ToolRegistry } from '../mcp/registry.mjs';
import { workspaceTools } from './workspace.mjs';
import { uiTools } from './ui.mjs';
import { setupTools } from './setup.mjs';
import { diagnosticsTools } from './diagnostics.mjs';
import { eventTools } from './events.mjs';
import { campaignTools } from './campaign.mjs';
import { reviewTools } from './review.mjs';
import { memoryTools } from './memory.mjs';
import { mediaTools } from './media.mjs';
import { assetTools } from './assets.mjs';
import { generationTools } from './generation.mjs';
import { publishingTools } from './publishing.mjs';
import { publishingResolutionTools } from './publishing-resolution.mjs';
import { strategyTools } from './strategy.mjs';
import { methodTools } from './methods.mjs';
import { socialTools } from './social.mjs';
import { videoTools } from './video.mjs';
import { editingTools } from './editing.mjs';
import { pipelineTools } from './pipeline.mjs';
import { brandKitTools } from './brand-kit.mjs';
import { brandTidyTools } from './brand-tidy.mjs';
import { productPhotoTools } from './product-photo.mjs';
import { permissionsTools } from './permissions.mjs';
import { labelQcTools } from './label-qc.mjs';
import { recipeTools } from './recipe.mjs';
import { reviewCopiesTools } from './review-copies.mjs';
import { studioWorkspaceTools } from './studio-workspace.mjs';
import { questionTools } from './questions.mjs';

/** @type {import('../mcp/registry.mjs').ToolDefinition[][]} */
export const ALL_TOOL_MODULES = [
  workspaceTools,
  uiTools,
  setupTools,
  diagnosticsTools,
  eventTools,
  campaignTools,
  reviewTools,
  memoryTools,
  mediaTools,
  assetTools,
  generationTools,
  publishingTools,
  publishingResolutionTools,
  strategyTools,
  methodTools,
  socialTools,
  videoTools,
  editingTools,
  pipelineTools,
  brandKitTools,
  brandTidyTools,
  productPhotoTools,
  permissionsTools,
  labelQcTools,
  recipeTools,
  reviewCopiesTools,
  studioWorkspaceTools,
  questionTools,
];

/**
 * @returns {ToolRegistry}
 */
export function buildRegistry() {
  const registry = new ToolRegistry();
  for (const module of ALL_TOOL_MODULES) registry.registerAll(module);
  return registry;
}
