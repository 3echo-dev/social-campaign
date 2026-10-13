import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { UserFacingError } from '../lib/errors.mjs';

/**
 * Every legacy `brand_*` tool, mapped to the local pipeline tool that replaces it.
 * A name with no explicit mapping falls back to `pipeline_status`.
 */
const LEGACY_BRAND_TOOL_REPLACEMENTS = {
  brand_create: 'pipeline_brand_onboard',
  brand_propose_update: 'pipeline_brand_onboard',
  brand_field_correct: 'pipeline_brand_onboard',
  brand_pillars_save: 'pipeline_brand_onboard',
  brand_get: 'pipeline_status',
  brand_list: 'pipeline_status',
  brand_pillars_get: 'pipeline_status',
  brand_wiki_write: 'pipeline_brand_research_start',
};

// The brand library tools are new, not legacy: they keep the brand_ prefix and work in every workspace.
const BRAND_LIBRARY_TOOLS = new Set(['brand_library_get','brand_bank_save','brand_library_file_job']);
// So are the brand footage tools (server/tools/brand-footage.mjs), a brand's archive kept in its library.
for(const name of ['brand_footage_import','brand_footage_status','brand_footage_search','brand_footage_analysis_save','brand_footage_mark','brand_footage_folder'])BRAND_LIBRARY_TOOLS.add(name);
// And the brand results tools (server/tools/brand-results.mjs): what a posted video earned, ranking the bank.
for(const name of ['brand_results_save','brand_results_get'])BRAND_LIBRARY_TOOLS.add(name);

export function assertLegacyExecutionAllowed(root,toolName,args = {}) {
  if(root && /^brand_/.test(toolName) && !BRAND_LIBRARY_TOOLS.has(toolName) && existsSync(join(root,'.social-pipeline','config.json'))) {
    const replacement=LEGACY_BRAND_TOOL_REPLACEMENTS[toolName] ?? 'pipeline_status';
    throw new UserFacingError(
      `\`${toolName}\` is retired in this workspace: brands live in the local pipeline now. Use \`${replacement}\` instead.`,
      {code:'legacy_brand_tool_retired',fix:`Use \`${replacement}\` instead.`},
    );
  }
  if(root && /^(agent_run_record|event_log|stage_update|stage_complete)$/.test(toolName) && existsSync(join(root,'.social-pipeline','config.json'))) {
    throw new UserFacingError(
      'This step isn\'t needed here. Carry on with the job; usage is recorded automatically.',
      {code:'legacy_event_tool_retired'},
    );
  }
  if(!root || toolName.startsWith('pipeline_') || /_(get|read|list|status|stats)$/.test(toolName))return;
  const campaignId=args.campaign_id || args.campaignId;
  if(!campaignId)return;
  const dir=join(root,'.social-pipeline','migrations');
  if(!existsSync(dir))return;
  for(const name of readdirSync(dir).filter(name=>name.endsWith('.legacy-freeze.json'))) {
    let freeze;
    try {freeze=JSON.parse(readFileSync(join(dir,name),'utf8'));}
    catch {throw new Error('Migration protection cannot be read. Resolve the migration report before executing legacy jobs.');}
    if(freeze.legacyExecutionDisabled && freeze.jobs?.some(job=>job.legacySourceId===campaignId)) {
      throw new Error('This job was migrated to the local pipeline. Resume its pipeline job instead of running the legacy workflow.');
    }
  }
}
