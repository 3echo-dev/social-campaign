---
name: onboard-brand
description: >
  Internal step of social-campaign: builds or updates a brand profile ("set up my brand", "add my website and competitors", "update my brand voice").
  Use when no onboarded brand exists, when Brand onboarding is chosen, or when a ready brand needs profile updates. Reached through social-campaign.
user-invocable: false
metadata:
  version: 0.3.3
---

# Onboard a brand

## Contents

- Talking to the person
- The three steps
- 1. Inspect current brands
- 2. Collect declared brand context
- 3. Complete the profile
- 4. Brand research pass
- 4a. The kit step: a logo, colours and fonts from the brand's own places
- 4b. Industry and the brand library
- 4c. Your archive (optional)
- 4d. Folders added on the board
- 4e. Brand intelligence: the deep pass
- 5. Verify and show the board
- 6. Return to a pending job
- Local boundaries
- Failure handling

## Routing

Read a branch file only when its condition holds; every other path stays on this page.

- Read `references/metricool-brand.md` (relative to this skill folder) when Metricool is connected or the person picks or changes the brand's Metricool brand (section 2b); it covers reading and saving the Metricool brands and the pick and is done when the brands are saved and the pick is saved with the brand, or left for Needs you.
- Read `references/research-pass.md` (relative to this skill folder) when the profile is complete and the brand research pass must start, restart or be saved (section 4); it covers `pipeline_brand_research_start`, the parallel workers, `pipeline_brand_research_save` and what to tell the person and is done when the research is saved, or closed as failed after one restart, and the board is published.
- Read `references/kit-step.md` (relative to this skill folder) when research starts, or a save adds or changes the website or a social link (section 4a); it covers `web_brand_kit`, the logo candidate review, colours from videos and font guesses and is done when every logo candidate has a verdict and the suggestions are on the board.
- Read `references/industry-and-library.md` (relative to this skill folder) when research has saved and the industry must be asked, the library reported, or Instagram looked at behind a login (section 4b); it covers the industry question, `brand_bank_save`, the library lines and the one Chrome look at Instagram and is done when the industry is asked or saved and the library lines are said once.
- Read `references/archive.md` (relative to this skill folder) when the person offers a folder of past videos, pictures or audio in chat (section 4c); it covers `brand_footage_import`, the small first pass and the full breakdown after a yes and is done when the first pass is saved and the person knows how many files were looked at.
- Read `references/board-folders.md` (relative to this skill folder) when a `brand_folder_pick` or `brand_folder_add` request arrives (section 4d); it covers the pick, the first small look, `brand_footage_digest` and its offers and is done when the folder is imported or declined and what was found is told in plain words.
- Read `references/brand-intelligence.md` (relative to this skill folder) when research runs, a `subtopics_confirm` changes the subtopics, or the brand has no posts of its own (section 4e); it covers the checklist, the Trend Scout, viral teardown, six subtopics and the 6 by 5 plan and is done when the checklist is ready with the plan filed and the person is told what they now have.

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Brand onboarding is required before a new job can be created.

The profile is reusable across local jobs.

The local pipeline records the onboarding revision and uses it as the brand gate.

## The three steps

On the board, brand onboarding is three steps, and research starts only on the third.
Handle each request as board-sync describes, apply it with `pipeline_board_request_apply`, and publish the workspace projection after it.

1. New brand. The person gives only the brand's name, and the board sends `create_brand` with `{ requestId, name }`.
   Applying it creates the brand and its empty workspace folder and nothing else.
   Do not start research, do not call `web_brand_kit`, and do not ask about links, folders or the profile with `pipeline_board_ask`.
   Say it in one plain line, for example "Created Acme Goods. Add its website, social accounts and anything else you know on its page, then press Start research.", and offer the archive there as section 4c says.
2. Brand details. The brand's own page holds the website and social links, the target market, the five declared context fields (audience, positioning, brand voice, content topics, competitors), the Metricool pick, the logo, colours and fonts, the folders and the photos.
   The person saves them as often as they like: each save is `save_brand_details` with `{ requestId, brand, profile, kit? }`.
   `profile` is everything typed on the page (a link or Not available per channel, an empty value clears a saved one) and `kit` is the logo, colours and fonts; photos and the Metricool pick wait for the next step.
   Applying a save stores what was typed and starts nothing: no research and no profile revision.
   When the save added or changed the website or a social link, run the kit step of section 4a for the brand right after the apply, so the page soon shows a suggested logo, colours and fonts; it reads the brand's own pages and costs nothing, and it is not research.
   Say nothing about a save that worked.
   When the apply refuses it, decline it with `pipeline_board_request_decline` and the plain line, and say that line once in chat.
   `brand_rename` with `{ requestId, brand, name }` changes the brand's display name at any time and nothing else: the brand's folder and slug keep their original names.
   Apply it, and say in one line what the result says, including that the folder keeps its original name.
3. Start research. The Start research button turns on once the page has the brand's name and a website or at least one social account.
   The board sends `start_research` with `{ requestId, brand, profile, kit?, metricoolBlogId? }`, everything on the page at that moment.
   If `profile.targetMarket` is blank (and the brand has none saved), ask before applying, with `pipeline_board_ask` and buttons: your best country guess from the website and social accounts, "Global (no one country)" and "Other" (then ask for the market in words). Put the answer in `profile.targetMarket` ("Global" for no one country) and carry on; research never starts with a blank market.
   Applying it finishes the profile (a channel left empty is saved as Not available, a context field left blank is filled by research) and marks research as waiting, exactly as the old single form did.
   If the apply refuses it, for example because there is still no website or social account, decline it with the plain line.
   Only after a successful `start_research` apply, start the research pass in section 4 at once, with no chat confirmation.

The old single-form `onboard_brand` request (create, details and start in one) still works and counts as all three steps: apply it, then start the research pass.
A request that arrives for a brand that already started research (a late save, a repeated start) is not a new start: leave it to the apply's own refusal.

## 1. Inspect current brands

Reuse a fresh pipeline_status snapshot supplied by the caller.

Call pipeline_status only when no current workspace and brand snapshot is available.

If a brand with onboardingStatus required matches the user's brand, continue that record and let the board prefill its safe profile fields.

If a ready brand matches, ask whether the user wants to update it or start a job.

When a brand is opened or chosen this way, call `pipeline_brand_tidy_check` once for that brand.
Quietly rewrite any research-filled field it flags into a short plain statement within the limits (audience and positioning under 400 characters, voice under 300 characters, 1 to 8 short content pillars of 60 characters or fewer; research itself fills 3 to 5) with `pipeline_brand_tidy_save`, keeping sources and evidence in the research file.
For a field the person typed, never change it; ask them in one plain line to shorten it on the brand card instead.

If the artifact board is ready, direct the user to its Brand onboarding card and wait for its requests, one per step (see "The three steps"): `create_brand` with only the name, `save_brand_details` as the person fills the brand's page in, and `start_research` when they press Start research.
The brand's page collects the four channel URLs, the target market, and the five declared context fields (audience, positioning, brand voice, content topics, and competitors).
Any of those five fields left blank is filled in by research.
A blank target market is unknown, not Singapore: the Director asks for it before research starts (see step 3), and research never fills it.
A channel the person leaves empty is saved as Not available when research starts.
Do not call `pipeline_brand_create` yourself for a board brand, or repeat the page as a chat questionnaire.

Use each request's stable `requestId` for its own operation.
Retrying a request with the same payload returns the same receipt without creating a duplicate or starting research twice.
The old single `onboard_brand` request, which carries the whole profile and start, is still handled the same way as before.

If the user explicitly supplies the complete profile in chat or asks to use chat intake, call `pipeline_brand_onboard` with `{ requestId, name, brand?, profile }`.
Use `brand` only when updating an existing draft or ready brand.

## 2. Collect declared brand context

Use the brand page's fields when the artifact is ready.
The board collects the brand name (step 1), then on the brand's page the four channel URLs, the target market, and the five declared context fields (audience, positioning, brand voice, content topics, and competitors), saved as the person goes (step 2) and sent with Start research (step 3).
For explicit chat intake, ask for the website URL.

For explicit chat intake, ask for the Facebook URL or the exact value Not available.

For explicit chat intake, ask for the Instagram URL or the exact value Not available.

For explicit chat intake, ask for the TikTok URL or the exact value Not available.

For explicit chat intake, ask for the target market, then audience, positioning, brand voice, content topics, and competitors, and accept a blank answer for any of them.
A blank target market is asked for in chat with buttons before research starts (see step 3), never assumed.

In chat intake, keep only the first 3 competitors the person lists, and tell them that only 3 are kept.

Do not start a second round for fields that were already supplied by the board request.
A person may volunteer or correct audience, market, voice, content topics, or competitor context in chat.
Record what they volunteer without asking for it again on the board.

Preserve uncertainty as an empty or unavailable field.

Do not infer a URL, audience, owner, approval, or brand fact.

Use only stable asset references without credentials.

## 2b. Which Metricool brand posts

Moved to `references/metricool-brand.md` (relative to this skill folder); see Routing above for when to read it.

## 3. Complete the profile

The default board path completes the profile with the `start_research` operation, `{ requestId, brand, profile, kit?, metricoolBlogId? }`, through the board request flow (the old single form used `onboard_brand` with `{ requestId, name, brand?, profile }`, which still works).
The server validates the complete profile before creating or updating any brand files.
Both return `{ brand, profile, onboarding, created, idempotent }`, and `start_research` adds `started: true`.

Keep the legacy two-step `pipeline_brand_create` and `pipeline_brand_complete` path only for an explicitly requested chat fallback or a compatibility caller.
Call `pipeline_brand_complete` with the brand ID and a profile object only on that legacy path.

The profile object must include channels.website, channels.facebook, channels.instagram, and channels.tiktok.

Each channel value must be a full URL or Not available.

Social URLs must point to the official platform host.

Include the declared context fields that the user provided.

The target market goes in the profile as `targetMarket`, and positioning goes in `market`.

A profile can be completed without competitors, palette, fonts, or creative references.

The tool validates and writes a new profile revision before marking onboarding complete.

The returned onboarding record includes status complete, profileRevision, completedAt, and reviewStatus.

When the result carries `brandFilesPending`, the brand notes are still blank templates: start the brand research (section 4) before any post is planned, as its note says, and tell the person only that the brand research is starting, with nothing technical.

Do not claim that a provider is authenticated because a profile URL was recorded.

## 4. Brand research pass

Moved to `references/research-pass.md` (relative to this skill folder); see Routing above for when to read it.

## 4a. The kit step: a logo, colours and fonts from the brand's own places

Moved to `references/kit-step.md` (relative to this skill folder); see Routing above for when to read it.

## 4b. Industry and the brand library

Moved to `references/industry-and-library.md` (relative to this skill folder); see Routing above for when to read it.

## 4c. Your archive (optional)

Moved to `references/archive.md` (relative to this skill folder); see Routing above for when to read it.

## 4d. Folders added on the board

Moved to `references/board-folders.md` (relative to this skill folder); see Routing above for when to read it.

## 4e. Brand intelligence: the deep pass

Moved to `references/brand-intelligence.md` (relative to this skill folder); see Routing above for when to read it.

## 5. Verify and show the board

Use the onboarding result returned by `onboard_brand` or `pipeline_brand_onboard`, or by the explicit legacy completion call.

Call pipeline_status again only when the completion response has no onboarding record or an external process changed the brand.

Confirm that the selected brand has onboardingStatus complete.

Call pipeline_board_open only when the workspace has no bound board URL.

If it returns needs_publication, invoke board-setup and bind the host's publish result before presenting the board.

The board may now offer New job for this brand.

If the profile is still incomplete, keep the brand in onboarding and show the validation question.
For an existing draft, return the same draft to the inline form with its allowlisted profile fields prefilled.

## 6. Return to a pending job

When this skill was invoked from new-job, return the completed brand ID to that flow.

The caller must attach the brand to the pending local job and read its route again.

Do not create a replacement job from memory.

Show the plan only after the route has been rebuilt from the current brand profile.

## Local boundaries

This flow is local-only.

It does not require Drive, a Studio account, a remote database, or a research-helper download.

Studio ownership remains unbound until the separate sync path is available.

Do not include owner IDs supplied by the user in a create call.

## Failure handling

If validation rejects a channel, ask for a full URL or Not available.

If the brand request is already used, read the existing brand and continue that record.

If the profile cannot be saved, leave the brand draft intact and tell the user which field needs correction.

Never mark onboarding complete by writing a status directly.
