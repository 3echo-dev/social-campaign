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
    description: 'Save the ad accounts the Meta ads or TikTok ads connector lists, exactly as its read-only account listing returned them (Meta ads_get_ad_accounts, TikTok auth_advertiser_get), so the board can show which ad account each brand uses. Pass the result as the connector returned it, with its own field names; Meta ids are stored as act_<digits> whichever way the connector wrote them, and an unusable result is refused with an invalid_input code that names the accepted shapes. This only saves data; it never calls the connector and never changes anything in an ad account. Call integration_probe for meta_ads or tiktok_ads first, then this. It also gives each plugin brand with no ad account for that provider one: at once when there is exactly one account, otherwise it asks in the board\'s Inbox (waiting lists the brands still to be answered, asked the new questions). A chat answer to that question is applied with pipeline_ad_account_choose. A brand whose saved account is gone is never replaced silently: it is listed in needsChoice (with the account it had) and asked about, and the person must be told in one plain line. Returns the saved accounts, chosen, asked, waiting and needsChoice; write the board documents afterwards so the Inbox shows any new question.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { ...string, enum: [...AD_PROVIDERS], description: 'meta_ads or tiktok_ads.' },
        accounts: {
          description: 'The connector result as it came back, passed as is: the list itself or the whole result (it finds the list in data, ad_accounts, accounts or list), an empty list when it has none. Meta ads_get_ad_accounts entries: ad_account_id (act_123 or 123), ad_account_name, currency, business_name. TikTok auth_advertiser_get entries: advertiser_id, advertiser_name. The older id and name fields work too. Never rename or rebuild the fields yourself.',
          oneOf: [
            { type: 'array', maxItems: AD_ACCOUNT_LIMIT, items: { type: 'object', additionalProperties: true } },
            { type: 'object', additionalProperties: true },
          ],
        },
      },
      required: ['provider', 'accounts'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => saveAdAccountsAndChoose({ root: local(workspace), provider: String(args.provider), accounts: args.accounts }),
  }),
  defineTool({
    name: 'pipeline_ad_account_choose',
    description: 'Save which saved ad account a plugin brand uses for Meta ads or TikTok ads, for example when the person answers the Inbox question in chat. This only saves data; it never changes anything in an ad account. Pass the plugin brand, the provider (meta_ads or tiktok_ads) and the id of one of the accounts already saved with pipeline_ad_accounts_save (integration_probe for that provider comes first); the brand must have a finished profile. Takes back the open Inbox question for that brand and provider, so no other step is needed; write the board documents afterwards. The question also offers two answers that are not an account: pass accountId "none" when the person says they have no ad account yet (the brand is then not asked again until the connector lists an account it did not list before, and ad steps say plainly there is none), and "later" when they are not sure (the brand is not asked again until a step that needs the account asks).',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The plugin brand slug.' },
        provider: { ...string, enum: [...AD_PROVIDERS], description: 'meta_ads or tiktok_ads.' },
        accountId: { ...string, description: 'The id of a saved ad account, from pipeline_ad_accounts_save, or none (no ad account yet) or later (not sure, decide later).' },
      },
      required: ['brand', 'provider', 'accountId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => chooseAdAccount({ root: local(workspace), brand: args.brand, provider: String(args.provider), accountId: args.accountId }),
  }),
];
