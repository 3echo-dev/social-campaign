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
  brand_onboarding_open: 'pipeline_board_open',
  brand_onboarding_progress: 'pipeline_board_open',
};

export function assertLegacyExecutionAllowed(root,toolName,args = {}) {
  if(root && /^brand_/.test(toolName) && existsSync(join(root,'.social-pipeline','config.json'))) {
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
