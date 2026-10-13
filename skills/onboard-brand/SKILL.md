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
- 1. Inspect current brands
- 2. Collect declared brand context
- 3. Complete the profile
- 4. Brand research pass
- 4b. Industry and the brand library
- 4c. Your archive (optional)
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
Quietly rewrite any research-filled field it flags into a short plain statement within the limits (audience and positioning under 400 characters, voice under 300 characters, 1 to 8 short content pillars of 60 characters or fewer; research itself fills 3 to 5) with `pipeline_brand_tidy_save`, keeping sources and evidence in the research file.
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

## 2b. Which Metricool brand posts

Each brand posts only through its own Metricool brand, picked once during onboarding and changeable later.
When Metricool is connected, read its brands with `getBrandSettings` (unless they were saved in this session) and save them with `pipeline_metricool_brands_save` before the person fills the form, so the form can list them.
The inline form then shows "Metricool brand for this brand's posts", each option as "Name (Instagram @handle)", with "Choose later" and "Not through Metricool" as the other answers; the pick travels with the `onboard_brand` request as `metricoolBlogId` and is saved with the brand.
For explicit chat intake, after `pipeline_brand_onboard` call `pipeline_metricool_brand_ask` for the brand, and apply a chat answer with `pipeline_metricool_brand_choose`.
Never pick one for the person, not even when Metricool lists only one brand.
When Metricool is not connected, or the person chooses later, do not block or delay onboarding: the question is asked in the Inbox once the brands are saved.
When a ready brand is updated, the same field shows its current Metricool brand and the person can change it there, on the brand card's "Change", or on the posting plan card; a change is applied with `pipeline_board_request_apply` (the `choose_metricool_brand` request) or `pipeline_metricool_brand_choose`, and the brand's posting plans are rebuilt and need approving again.

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
The card also asks, as an optional extra, for 3 to 5 real photos of the brand's world: the place, the people, the product in use.
They travel on the same click as `kit.references` and are saved under the brand's `assets/references` folder and listed in the brand profile as reference assets.
They are optional.
A brand finishes onboarding without them; when there are none, say once and gently that real photos make the pictures feel like the brand and can be added any time.
If the person offers photos in chat, ask them to add them on the board card, or save them with `pipeline_brand_references_save` once they are on this computer.
Never search the web for them and never make them up.

The logo is upload only: nothing looks for one, so never search a website or a social page for a logo and never offer logo choices.
`web_brand_kit` reads the website's colours and fonts only, and when the website shows no colours it uses the colours of the brand's social profile picture.
It returns `{status, brand, captureId, palette, paletteSource, fonts, code, reason, skippedParts}`.
It skips any part the person already provided and returns `skipped` when colours and fonts were both already provided; do not look for those parts another way.

If the `pipeline_brand_research_start` result is `skipped`, do not dispatch the researcher.
There is nothing blank to fill, or research is already current.

A brand onboarded before research wrote its audience, positioning and platform notes still has them as the empty template, so its research is redone once even when it looks current.
When the start result carries a `refreshReason`, say it to the person as one short line, word for word, for example "Your brand files were never filled from research; refreshing them now", and then dispatch as usual.
No field may be blank in that case, and the researcher then fills only the research, the brand files and the top posts.
After that one run the notes are filled or say research found nothing, so the next start is skipped again.

Otherwise, dispatch the researcher once with workstream `brand-onboarding`, passing the returned `blankFields` and `alsoFill`, the declared competitors, `toFind`, the returned `market` as the target market, the returned `limits` (12 searches, 16 fetches and 40 turns, the budget of a campaign job's research), `draftPath`, and `rawDir`, the folder where it saves the text of every page it reads.
The file at `draftPath` already holds the right keys for the researcher to fill in.
Research on a brand is as deep as research on a job: the researcher reads the website, reads each declared social account and each competitor handle once with `social_profile_get` and `social_outliers_find`, and keeps a saved capture behind every source.
It has no Chrome tools; the Instagram look below is yours.
The result also holds `draftContract`, the exact shape of the draft (sources, evidence rows, competitor details, the optional findings keys).
Paste the returned `draftContract` verbatim into the researcher's spawn prompt, on every dispatch including a second round, and do not restate field formats in your own words.
In `fills`, competitors are brand names only; their details belong in `research.competitorDetails`.
The researcher uses plain dates (YYYY-MM-DD) for `observedAt` and never invents clock times.
Put `brand:<slug>` alone on the first line of the researcher's spawn prompt, on every dispatch including a second round, so the board can show the Researcher working.

Dispatch it in the background, then write the board documents right away (call `pipeline_status` and write its `documents`), so the onboarding page shows the Researcher working while it runs; write them again when it reports back.
Then call `pipeline_brand_research_save` with the brand and `runId`.

When the save returns `needs_changes`, never close the run and never tell the person about it.
Read `problems`: fix the draft file yourself when the fix is only wording or a stray key, otherwise dispatch the researcher once more with the `problems`, `draftPath` and `rawDir`, then save again.
Never add, change or date a source, URL or piece of evidence yourself: anything about sources, captures, excerpts, competitor handles, or the files and top posts the draft carries goes back to the researcher.
Do this for at most two rounds.
When `needsAudience` is true, the researcher either finds the brand's own audience or suggests one from the top competitors' audiences in the target market.
If audience alone still remains after the two rounds, save once more with `audienceUnavailable: true` and tell the person plainly that no audience could be found and that they can add one on the board.

Right after a successful save, tell the person plainly which fields research filled, from the `filled` list, in marketing words such as "Research filled in Audience, Brand voice and Content pillars."
If `competitorsAdded` lists names, say research added them as competitors, for example "Research added Northshore Grocer and FreshCart SG to your competitors."
If `suggested` lists a field, say it is a suggestion to check, for example "The audience is a suggestion based on competitors, so please check it."
Name `forbiddenClaims` as "words and claims to avoid" and `examples` as "example posts", and say once that they are suggestions taken from the brand's own pages, without asking the person anything about them.
The save also writes the brand's audience, positioning and platform notes and files the research in the brand library.
When `brandFiles.enoughForJobs` is true, say in one line that research also filled in the audience and positioning notes, for example "Research also filled in your audience and positioning notes, with the proof behind them."
When it is false, say nothing about them; the notes keep their empty template and a job researches what it needs.
Never mention file names, tool names or the checks behind `brandFiles`, `library`, `toolCalls` or `warnings`.

Close the run as failed with `pipeline_brand_research_close`, `status: 'failed'` and a reason, only when a tool itself returns an error.
After a first failure, call `pipeline_brand_research_start` once more to restart the research, without calling `web_brand_kit` again; the board keeps showing that research is under way until the restart ends. A second failure is final.

Publish the board so the colours and fonts `web_brand_kit` proposed are visible.

Tell the person in one sentence to check the colours and fonts on the board, add their logo by uploading it if they have one, add a few real photos of their place, people or product if they have them, and click Save and continue.

While they do that, follow 4b below.

If something about the profile or the research is worth flagging, for example the TikTok account reading as the US market while the website reads as Singapore, say so in chat in one plain sentence once research starts; do not block starting it, and do not turn it into a confirmation question.

Save and continue arrives as an `onboard_brand` request with `kit`.
Apply it immediately: a board click is the approval, so there is no chat confirmation.
When that kit carries a logo, follow the same Handling a board request procedure in `skills/board-sync/SKILL.md` before landing and applying it.

For chat intake, show the proposed kit in chat, take any changes the person wants, and call `pipeline_brand_kit_save` with the resulting kit.

## 4b. Industry and the brand library

Once research has saved, ask what kind of business the brand is, once, with `pipeline_board_ask` for the brand.
Offer the closest industries from `pipeline/playbooks/ad-styles.md` as buttons in plain words, at most 6, the best fit from the brand's pages first, and let the person type another, for example "Which of these is closest to what SK-II does?". Show no tags or ids.
Do not wait for the answer: until it comes, the strategist infers the industry and marks it inferred.
When the answer arrives (see Questions on the board in `skills/board-sync/SKILL.md`), save it with `brand_bank_save` as the brand's industry item: bank `yours`, kind `industry`, and as its text the industry's name exactly as the Strategy step lists it.
Those names are Beauty and skincare; Food and beverage; Fitness and health; Education; Finance; Real estate; Software, AI and tech; Retail and e-commerce; Hospitality and travel; Professional services; Gaming and entertainment.
When none fits, the text is the person's own words.
The Strategy step then opens with that industry already chosen, so never save the tag or an id as the text.
On an update of a ready brand, edit its existing industry item rather than adding a second.

The brand library already has what the research found, so the first concepts do not start blank.
The save filed the research for the next job to reuse (brand and competitor research stay fresh for 30 days), and it saved the best posts the researcher read on the brand's own accounts and on each competitor's as proven hooks, from the `topPosts` in the researcher's draft.
Do not call `social_outliers_find` again for those accounts, and never guess a handle.
When the save result's `topPosts.saved` is more than 0, say so in one line, for example "Saved 5 top posts to your brand library."
When no post was saved and Instagram is not the reason, say so once in plain words, for example "There are no posts to learn from yet, so your brand library starts empty. It fills as you make posts.", and carry on.

### Instagram behind a login

The research helper cannot read Instagram without a login, so a brand whose posts are on Instagram has none in its library after the save.
Look at its declared Instagram once through the person's own signed-in Chrome, but only when the Claude in Chrome browser tools are among your tools.
Do it in a background helper, so you keep answering board requests.
Open the declared profile (its Reels tab when it has one), then at most 3 of its posts, one look each; never reopen a page, never scroll hunting for more, and never open a competitor's page.
Read what the pages show: the followers and post count, and for the 3 posts with the most views their link, views, date and the opening words of the caption.
Viewing is read-only: never post, like, follow, comment, message, change settings or type credentials.
Claude Code may show its own tool permission prompt; that prompt is the person's to answer, and you never try to avoid it.
Save each post with `brand_bank_save`: bank `proven`, kind `hook`, source `brand`, the caption's opening words exactly as the page has them as the text, and the post's link, views and date (YYYY-MM-DD) as the evidence.
Skip a post that has no caption, views or date; never fill in or round a figure.
When the Chrome tools are not among your tools, or the page will not open, do not ask the person to connect anything in chat.
Record the gap in one plain line instead, for example "I could not read your Instagram because it needs a login, so there are no Instagram posts to learn from yet. They will come in as you make posts."

## 4c. Your archive (optional)

Once the industry question is asked, offer the brand's archive, once: a folder of past videos, pictures or audio on this computer (a Drive folder pulled to this computer works too).
It is optional. A brand with no archive skips this step and onboards exactly as before; say nothing about it when the person has none.

Ask with `pipeline_board_ask` for the brand, for example "Do you have a folder of past videos or photos I can learn from? Paste its full path, or choose Not now.", with "Not now" as the one button and a typed answer allowed. Do not wait for the answer; carry on with the steps around this one.
When a path arrives, ask who the footage belongs to with `pipeline_board_ask`, in plain words, with three buttons: "Ours, free to use" (rights ours), "Ask me each time before posting" (client_ask) and "Never use it" (never). Never guess the rights and never default them.
Then call `brand_footage_import` with the brand, the folder, the rights and a short label in the person's words. It reads the folder in the background, skips copies, makes small thumbnails and costs nothing; the files are never copied, moved or changed. Say so in one line, for example "Reading your folder now. It is free and runs in the background."
A bigger folder takes a while. `brand_footage_status` shows how far it got, and calling `brand_footage_import` again with the same folder carries on after a stop. A folder that moved shows its files as missing: ask the person for the new place and use `brand_footage_folder` with `relink`.

Describing the footage is what costs model usage, so keep the first pass small: at most 20 files, and only when the person agrees.
List them with `brand_footage_search` (`analysed` none, `kind` video). For each, call `media_extract_frames` on its `path` with a count of 3, Read the frames, and get the first spoken words with `media_transcribe` only when it answers with a transcript at no cost; when it says it needs a paid transcription provider, leave the spoken words out and do not run it. Then call `brand_footage_analysis_save` with stage `quick`: what the opening seconds show, the first spoken words if any, and the products, mood and shot types you can see. Never describe a file marked never. Describe more only when the person asks.
When the first pass is done, tell the person in plain words how many files there are and how many you looked at, and offer a full breakdown of the clips they care about: ask with `pipeline_board_ask` ("Want me to break down your best clips in full? It reads each one closely and uses model usage."). Mark the files they pick with `brand_footage_mark`. Its answer says how many files are marked and that a full pass uses model usage: tell the person that number and ask again before you start. Then watch each marked file (`media_extract_frames` with a count of 12 and the transcript) and save stage `full` with `brand_footage_analysis_save`: scenes, shot types, products, mood, on-screen text and usable moments, with start and end times in seconds.
When the first pass is saved, say what the person now has in one line, for example "Your archive has 128 files, and I have looked at 20 of them."

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
