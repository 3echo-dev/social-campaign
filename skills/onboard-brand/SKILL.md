---
name: onboard-brand
description: >
  Creates or completes a local Social Campaign brand profile.
  Use when no onboarded brand exists, when a user chooses Brand onboarding, or when a ready brand needs profile updates.
user-invocable: false
metadata:
  version: 0.3.3
---

# Onboard a brand

## Contents

- Talking to the person
- 1. Inspect current brands
- 2. Collect declared brand context
- 3. Complete the profile
- 4. Brand research pass
- 5. Verify and show the board
- 6. Return to a pending job
- Local boundaries
- Failure handling

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Brand onboarding is required before a new job can be created.

The profile is reusable across local jobs.

The local pipeline records the onboarding revision and uses it as the brand gate.

## 1. Inspect current brands

Reuse a fresh pipeline_status snapshot supplied by the caller.

Call pipeline_status only when no current workspace and brand snapshot is available.

If a brand with onboardingStatus required matches the user's brand, continue that record and let the board prefill its safe profile fields.

If a ready brand matches, ask whether the user wants to update it or start a job.

When a brand is opened or chosen this way, call `pipeline_brand_tidy_check` once for that brand.
Quietly rewrite any research-filled field it flags into a short plain statement within the limits (audience and positioning under 400 characters, voice under 300 characters, 1 to 8 short content pillars of 60 characters or fewer) with `pipeline_brand_tidy_save`, keeping sources and evidence in the research file.
For a field the person typed, never change it; ask them in one plain line to shorten it on the brand card instead.

If the artifact board is ready, direct the user to its single inline Brand onboarding form and wait for one `onboard_brand` request.
The form collects the brand name, the four channel URLs, the target market, and the five declared context fields (audience, positioning, brand voice, content pillars, and competitors) in one submission.
Any of those five fields left blank is filled in by research.
A blank target market means Singapore, and research never fills it.
A field the person did not change is omitted from the submission, so a value research already filled in is kept.
Do not call `pipeline_brand_create` first, ask for a name-only draft, or repeat the form as a chat questionnaire.

Use the request's stable `requestId` for the entire create-and-complete operation.
Retrying that request with the same payload returns the same brand and onboarding receipt without creating a duplicate.

If the user explicitly supplies the complete profile in chat or asks to use chat intake, call `pipeline_brand_onboard` with `{ requestId, name, brand?, profile }`.
Use `brand` only when updating an existing draft or ready brand.

## 2. Collect declared brand context

Use the inline board fields when the artifact is ready.
The board collects the brand name, the four channel URLs, the target market, and the five declared context fields (audience, positioning, brand voice, content pillars, and competitors) in one submission.
For explicit chat intake, ask for the website URL.

For explicit chat intake, ask for the Facebook URL or the exact value Not available.

For explicit chat intake, ask for the Instagram URL or the exact value Not available.

For explicit chat intake, ask for the TikTok URL or the exact value Not available.

For explicit chat intake, ask for the target market, then audience, positioning, brand voice, content pillars, and competitors, and accept a blank answer for any of them.
A blank target market means Singapore.

In chat intake, keep only the first 3 competitors the person lists, and tell them that only 3 are kept.

Do not start a second round for fields that were already supplied by the board request.
A person may volunteer or correct audience, market, voice, content pillars, or competitor context in chat.
Record what they volunteer without asking for it again on the board.

Preserve uncertainty as an empty or unavailable field.

Do not infer a URL, audience, owner, approval, or brand fact.

Use only stable asset references without credentials.

## 3. Complete the profile

The default board path submits the `onboard_brand` operation with `{ requestId, name, brand?, profile }` through the board request flow.
The server validates the complete profile before creating or updating any brand files.
It returns `{ brand, profile, onboarding, created, idempotent }`.

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

Do not claim that a provider is authenticated because a profile URL was recorded.

## 4. Brand research pass

After any profile save, whether through the board's `onboard_brand` request, `pipeline_brand_onboard`, or the legacy `pipeline_brand_complete` path, call `pipeline_brand_research_start` with the brand right away, with no chat confirmation before starting: the board request (or the chat submission) already carries the person's approval.

The board card lets the person add their logo, colours and fonts before research, and those travel with the Start onboarding click as `kit` on the kickoff `onboard_brand` request.
If the person offers a logo, colours or fonts in chat before research, ask them to add those on the board card before clicking Start onboarding, where the logo is an upload.
Do not call `pipeline_brand_kit_save` before research; it confirms the kit and is only for the review step in chat intake.
When that kit carries a logo, follow the Handling a board request procedure in `skills/board-sync/SKILL.md` before landing the request.

Right after the `pipeline_brand_research_start` call, even when it returns `skipped`, call `web_brand_kit` with the brand once.
Never retry `web_brand_kit` against a blocked site.
Call it only once per onboarding: when research is restarted after a failure, do not call `web_brand_kit` again, because the first capture already stands.
The logo is upload only: nothing looks for one, so never search a website or a social page for a logo and never offer logo choices.
`web_brand_kit` reads the website's colours and fonts only, and when the website shows no colours it uses the colours of the brand's social profile picture.
It returns `{status, brand, captureId, palette, paletteSource, fonts, code, reason, skippedParts}`.
It skips any part the person already provided and returns `skipped` when colours and fonts were both already provided; do not look for those parts another way.

If the `pipeline_brand_research_start` result is `skipped`, do not dispatch the researcher.
There is nothing blank to fill, or research is already current.

Otherwise, dispatch the researcher once with workstream `brand-onboarding`, passing the returned `blankFields` and `alsoFill`, the declared competitors, `toFind`, the returned `market` as the target market, the returned `limits` (including its `turns` budget), and `draftPath`.
The file at `draftPath` already holds the right keys for the researcher to fill in.
Put `brand:<slug>` alone on the first line of the researcher's spawn prompt, on every dispatch including a second round, so the board can show the Researcher working.

Dispatch it in the background, then write the board documents right away (call `pipeline_status` and write its `documents`), so the onboarding page shows the Researcher working while it runs; write them again when it reports back.
Then call `pipeline_brand_research_save` with the brand and `runId`.

When the save returns `needs_changes`, never close the run and never tell the person about it.
Read `problems`: fix the draft file yourself when the fix is only wording or a stray key, otherwise dispatch the researcher once more with the `problems` and `draftPath`, then save again.
Never add, change or date a source, URL or piece of evidence yourself: anything about sources goes back to the researcher.
Do this for at most two rounds.
When `needsAudience` is true, the researcher either finds the brand's own audience or suggests one from the top competitors' audiences in the target market.
If audience alone still remains after the two rounds, save once more with `audienceUnavailable: true` and tell the person plainly that no audience could be found and that they can add one on the board.

Right after a successful save, tell the person plainly which fields research filled, from the `filled` list, in marketing words such as "Research filled in Audience, Brand voice and Content pillars."
If `competitorsAdded` lists names, say research added them as competitors, for example "Research added Northshore Grocer and FreshCart SG to your competitors."
If `suggested` lists a field, say it is a suggestion to check, for example "The audience is a suggestion based on competitors, so please check it."
Name `forbiddenClaims` as "words and claims to avoid" and `examples` as "example posts", and say once that they are suggestions taken from the brand's own pages, without asking the person anything about them.

Close the run as failed with `pipeline_brand_research_close`, `status: 'failed'` and a reason, only when a tool itself returns an error.
After a first failure, call `pipeline_brand_research_start` once more to restart the research, without calling `web_brand_kit` again; the board keeps showing that research is under way until the restart ends. A second failure is final.

Publish the board so the colours and fonts `web_brand_kit` proposed are visible.

Tell the person in one sentence to check the colours and fonts on the board, add their logo by uploading it if they have one, and click Save and continue.

If something about the profile or the research is worth flagging, for example the TikTok account reading as the US market while the website reads as Singapore, say so in chat in one plain sentence once research starts; do not block starting it, and do not turn it into a confirmation question.

Save and continue arrives as an `onboard_brand` request with `kit`.
Apply it immediately: a board click is the approval, so there is no chat confirmation.
When that kit carries a logo, follow the same Handling a board request procedure in `skills/board-sync/SKILL.md` before landing and applying it.

For chat intake, show the proposed kit in chat, take any changes the person wants, and call `pipeline_brand_kit_save` with the resulting kit.

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
