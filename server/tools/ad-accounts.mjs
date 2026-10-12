import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { AD_ACCOUNT_LIMIT, AD_PROVIDERS, chooseAdAccount, saveAdAccountsAndChoose } from '../pipeline/ad-accounts.mjs';

const string = { type: 'string' };

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const adAccountTools = [
  defineTool({
    name: 'pipeline_ad_accounts_save',
    description: 'Save the ad accounts the Meta ads or TikTok ads connector lists, exactly as its read-only account listing returned them (Meta ads_get_ad_accounts, TikTok auth_advertiser_get), so the board can show which ad account each brand uses. This only saves data; it never calls the connector and never changes anything in an ad account. Call integration_probe for meta_ads or tiktok_ads first, then this. It also gives each plugin brand with no ad account for that provider one: at once when there is exactly one account, otherwise it asks in the board\'s Inbox (waiting lists the brands still to be answered, asked the new questions). A chat answer to that question is applied with pipeline_ad_account_choose. A brand whose saved account is gone is never replaced silently: it is listed in needsChoice (with the account it had) and asked about, and the person must be told in one plain line. Returns the saved accounts, chosen, asked, waiting and needsChoice; write the board documents afterwards so the Inbox shows any new question.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { ...string, enum: [...AD_PROVIDERS], description: 'meta_ads or tiktok_ads.' },
        accounts: {
          type: 'array',
          maxItems: AD_ACCOUNT_LIMIT,
          description: 'The accounts as the connector returned them, an empty list when it has none. Meta: id (such as act_123), name, currency, timezone_name. TikTok: advertiser_id, advertiser_name.',
          items: { type: 'object', additionalProperties: true },
        },
      },
      required: ['provider', 'accounts'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => saveAdAccountsAndChoose({ root: local(workspace), provider: String(args.provider), accounts: args.accounts }),
  }),
  defineTool({
    name: 'pipeline_ad_account_choose',
    description: 'Save which saved ad account a plugin brand uses for Meta ads or TikTok ads, for example when the person answers the Inbox question in chat. This only saves data; it never changes anything in an ad account. Pass the plugin brand, the provider (meta_ads or tiktok_ads) and the id of one of the accounts already saved with pipeline_ad_accounts_save (integration_probe for that provider comes first); the brand must have a finished profile. Takes back the open Inbox question for that brand and provider, so no other step is needed; write the board documents afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The plugin brand slug.' },
        provider: { ...string, enum: [...AD_PROVIDERS], description: 'meta_ads or tiktok_ads.' },
        accountId: { ...string, description: 'The id of a saved ad account, from pipeline_ad_accounts_save.' },
      },
      required: ['brand', 'provider', 'accountId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => chooseAdAccount({ root: local(workspace), brand: args.brand, provider: String(args.provider), accountId: args.accountId }),
  }),
];
