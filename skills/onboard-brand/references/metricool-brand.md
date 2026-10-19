# Which Metricool brand posts

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 2b. Which Metricool brand posts

Each brand posts only through its own Metricool brand, picked once during onboarding and changeable later.
When Metricool is connected, read its brands with `getBrandSettings` (unless they were saved in this session) and save them with `pipeline_metricool_brands_save` before the person fills the form, so the form can list them.
The inline form then shows "Metricool brand for this brand's posts", each option as "Name (Instagram @handle)", with "Choose later" and "Not through Metricool" as the other answers; the pick travels with the `start_research` request (or the old `onboard_brand` request) as `metricoolBlogId` and is saved with the brand.
For explicit chat intake, after `pipeline_brand_onboard` call `pipeline_metricool_brand_ask` for the brand, and apply a chat answer with `pipeline_metricool_brand_choose`.
Never pick one for the person, not even when Metricool lists only one brand.
When Metricool is not connected, or the person chooses later, do not block or delay onboarding: the question is asked in Needs you once the brands are saved.
When a ready brand is updated, the same field shows its current Metricool brand and the person can change it there, on the brand card's "Change", or on the posting plan card; a change is applied with `pipeline_board_request_apply` (the `choose_metricool_brand` request) or `pipeline_metricool_brand_choose`, and the brand's posting plans are rebuilt and need approving again.
