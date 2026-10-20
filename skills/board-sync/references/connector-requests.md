# Connector requests

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

The board no longer offers a Skip button on a connector card; a `skip_provider` request left by an older board page is applied immediately with `pipeline_board_request_apply` and the requestId and confirmedBy, the same as any other non-decision request.
It records the choice in the workspace's `integrations.json` and never touches the other connector.

For `connectors_continue` (the Continue on the setup Connectors step), apply it immediately the same way, then publish the workspace projection so the board moves on to the brand.
It skips for now every connector that is not connected yet.

For `connect_provider`, walking the person through connecting that provider is not a chat confirmation prompt; it is real work the apply depends on, and stays.
When the provider's tools are already present in this session, verify the connection with the same read-only probe instead of walking the person through connecting.
Otherwise, first walk the person through connecting that provider in chat: 3Echo Studio through the person's claude.ai connector (Settings > Connectors), ElevenLabs through their Claude connector.
Then call the existing probe or mark-connected tool and verify it truly works.
Only call `pipeline_board_request_apply` once that verification is in hand.
Applying it before the provider is actually connected fails and leaves the request needing reconciliation.
A `skip_provider` or `connect_provider` request can be declined the same way as any other, through `pipeline_board_request_decline`.
For Metricool, a `connect_provider` request is also the board's Connect or Refresh brands button, and the verification is the full check in `skills/setup/SKILL.md`.
Find Metricool by the tool base name `getBrandSettings`, under any prefix, since the prefix is an opaque per-connection id.
Call `getBrandSettings` (read-only), then `integration_probe` with provider `metricool`, then `pipeline_metricool_brands_save` with the `data` list exactly as returned.
Apply the request only when the probe was `ok: true`; when Metricool is missing or the call fails, probe with `ok: false`, decline the request with one plain reason, and publish the workspace projection.
Never call a Metricool tool that creates, updates or sends a post while handling a connection request.

For `meta_ads` and `tiktok_ads`, a `connect_provider` request is verified the same way, with the full check in `skills/setup/SKILL.md`.
Find Meta ads by the tool base name `ads_get_ad_accounts` and TikTok ads by `auth_advertiser_get`, under any prefix.
Call only that read-only listing tool, then `integration_probe` with provider `meta_ads` or `tiktok_ads`, then `pipeline_ad_accounts_save` with the list exactly as returned.
Apply the request only when the probe was `ok: true`; when the connector is missing or the call fails, probe with `ok: false`, decline the request with one plain reason, and publish the workspace projection.
Never call an ad tool that creates, updates, activates, pauses or deletes anything while handling a connection request.
When a person answers the "Which Meta ad account belongs to ..." or "Which TikTok ad account belongs to ..." question in chat, call `pipeline_ad_account_choose` with the account id, or with `none` when they have no ad account yet or `later` when they are not sure; a board answer (its last two buttons are "No Meta ad account yet" and "Not sure, decide later") is applied for you.
A single connection check can also use `integration_probes_save` with one entry, the same as setup does for all of them at once.

### Native connectors

Use Claude's authenticated native connectors from the running session for supported generation and asset tools.
Keep their actual workspace and generation job IDs with the local execution record.
Do not infer a pipeline ingestion API from the presence of generation tools.
Owner binding for future Studio ingestion must be refreshed from authenticated membership.
