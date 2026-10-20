# Brand and onboarding requests

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

For brand creation, onboarding, new jobs, or local imports, apply immediately with `pipeline_board_request_apply` and the requestId and confirmedBy.
Every request on this page comes from the board, so land it with `pipeline_board_request_land` and `from` set to `board`.
Brand onboarding on the board is three requests, and research starts only on the third (the steps are in `skills/onboard-brand/SKILL.md`, "The three steps"):
- `create_brand` (`name`) is the person naming a new brand.
  Apply it, publish the workspace projection and say in one line that the brand is created and its page is ready for details.
  Do not start research.
- `save_brand_details` (`brand`, `profile`, optional `kit`) is the person saving what they typed on the brand's page, as often as they like.
  Apply it and publish the workspace projection.
  Do not start research, and say nothing about a save that worked.
  If the apply refuses it, decline it with the plain line.
- `start_research` (`brand`, `profile`, optional `kit` and `metricoolBlogId`) is the person pressing Start research.
  Apply it, publish the workspace projection, then start the brand research pass from `skills/onboard-brand/SKILL.md` right away, then publish the projection again so the board reflects any research-filled fields.
  If the apply refuses it (it needs a website or at least one social account), decline it with the plain line.
- `brand_rename` (`brand`, `name`) changes the brand's display name only.
  Apply it, publish the workspace projection and say in one line what the result says: the name changed and the brand's folder keeps its original name.
  If the apply refuses it (the name is empty or another brand has it), decline it with the plain line.

A `kit.logo` or `kit.references` on a `save_brand_details` or `start_research` request travels exactly as `references/request-files.md` describes for `onboard_brand`: read each asset, pass the saved paths when landing the request, and delete the transit copies after the apply.
The stable request ID of each request makes a retry return the same receipt, so a retry never creates a second brand or starts research twice.

The old single-form operation `onboard_brand` carries the name plus all four channel answers in one profile and still works, as create, details and start in one request.
Validate the full profile before applying it, with each channel as a URL or explicit `Not available`.
The stable request ID covers creation and completion together, so a retry resumes the same brand and never creates a second one.
After applying `onboard_brand`, publish the workspace projection, then start the brand research pass from `skills/onboard-brand/SKILL.md` right away, then publish the projection again so the board reflects any research-filled fields.
An `onboard_brand` request that carries `kit` and `brand` for a brand that already did research is the Save and continue submission: apply it immediately with `pipeline_board_request_apply`, then publish the workspace projection so the board moves to New job.
If something about the submitted profile is worth flagging, for example a mismatched region between two channels, say so in chat in one plain sentence once research starts; do not block on it.
Existing drafts use the safe profile projection to prefill the same page (a brand that has not started research shows what was saved with Save details).
New jobs require a completed brand profile, except for a pipeline whose required inputs in `pipelines_list` do not list a brand (today `research`, `creative_analysis` and `video_breakdown`), which may carry `brand: "no-brand"` or a brand that already exists in the workspace.

A `bank_remove` request is the person removing one of their own items from the Brand library on the board: land it, remove the item it names with `brand_bank_save`, apply it immediately with `pipeline_board_request_apply`, then publish the workspace projection.
If the removal fails, decline the request with `pipeline_board_request_decline` and one plain reason.

A `brand_folder_add` request is the person adding a folder of the brand's videos, photos or fonts on the onboarding page (its args are `brand`, `folder`, `rights` and an optional `label`; the rights are their own answer, never change them).
Land it and apply it immediately with `pipeline_board_request_apply`: the apply imports the folder the way `brand_footage_import` does and reads it in the background, for free, without copying or changing a file.
Then publish the workspace projection and follow section 4d of `skills/onboard-brand/SKILL.md` to look at a few files, ask before a full pass and report what was found.
If the apply refuses it (the folder is not there, it is too broad, or it was already added with other rights), say the refusal's plain line, decline the request with `pipeline_board_request_decline` and that line as the reason, and publish the workspace projection.

A `brand_folder_pick` request is the person pressing "Choose a folder..." on the onboarding page, after picking who owns the files (its args are `brand`, `rights` and an optional `label`; there is no path, because the board cannot read one, and the rights are their own answer, never change them).
Land it, then call `pipeline_folder_pick` with its `requestId` and `confirmedBy` set to `board request <requestId>`: it opens the operating system's folder dialog on the person's computer, waits up to 3 minutes and imports the chosen folder exactly like `brand_folder_add`, so do not also call `pipeline_board_request_apply` or `brand_footage_import` for it.
When its `status` is `applied`, write its `artifactReceipt` to the request's board document, publish the workspace projection and follow section 4d of `skills/onboard-brand/SKILL.md`.
When it is `cancelled`, `timeout`, `unavailable` or `refused`, the tool has already declined the request with a plain line (the person closed the dialog, left it open too long, no dialog can open on this computer, or the folder was refused): write the `artifactReceipt` it returns, publish the workspace projection and say in one line what happened.
When it is `handledElsewhere`, another window has the request: say nothing.
When the call was stopped (`stopped`), the request is still waiting (marked `requested` or `received`): leave it and land it again on the next pass.
