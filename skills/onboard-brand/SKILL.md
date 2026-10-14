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
- 4d. Folders added on the board
- 4e. Brand intelligence: the deep pass
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
No field may be blank in that case, and the researcher then fills only the research, the brand files and the top posts (each video taken apart with its labels).
After that one run the notes are filled or say research found nothing, so the next start is skipped again.

Otherwise, dispatch the researcher once with workstream `brand-onboarding`, passing the returned `blankFields` and `alsoFill`, the declared competitors, `toFind`, the returned `market` as the target market, the returned `limits` (30 searches, 56 fetches and 120 turns: onboarding is always the deep pass, so it has far more than a campaign job's research budget), `draftPath`, and `rawDir`, the folder where it saves the text of every page it reads.
The file at `draftPath` already holds the right keys for the researcher to fill in.
Research on a brand is as deep as research on a job: the researcher reads the website, reads each declared social account and each competitor handle once with `social_profile_get` and `social_outliers_find` (TikTok, Instagram and YouTube; Instagram needs the research helper's stealth reader and shows no view counts, so its posts come back ranked by likes and are filed as top posts with their likes in place of views), and keeps a saved capture behind every source.
It has no Chrome tools; the Instagram look below is yours.
The researcher also takes at most 11 of the top videos apart in this dispatch (the 5 best own and the 2 best of each competitor, with `pipeline_video_teardown` and `media_transcribe`), gives each its labels on the format library's axes (format, editing style, visual hook, subtopic) and writes what it saw into `topPosts`; the 3 viral videos come in a second, short dispatch (section 4e); a teardown counts as one of its fetches, and a video whose download fails is skipped with a line in the gaps.
It then runs two more workstreams of the research skill, pain points (the comments on the best own and competitor videos, 2 forum threads, 2 competitor review pages, a competitor ad search and a landing page) and hooks, captions and CTAs, and writes what it found in the draft's `banks`: pains, desires and objections in the customers' own words with quotes from the pages it saved, angles that match a pain with a proof, and the best captions and calls to action.
The save checks every quote against its saved page, so a problem about a quote goes back to the researcher like any other problem about a source.
The result also holds `draftContract`, the exact shape of the draft (sources, evidence rows, competitor details, the optional findings keys).
Paste the returned `draftContract` verbatim into the researcher's spawn prompt, on every dispatch including a second round, and do not restate field formats in your own words.
In `fills`, competitors are brand names only; their details belong in `research.competitorDetails`.
The researcher uses plain dates (YYYY-MM-DD) for `observedAt` and never invents clock times.
Put `brand:<slug>` alone on the first line of the researcher's spawn prompt, on every dispatch including a second round, so the board can show the Researcher working.

Section 4e says what runs beside it (the Trend Scout) and what follows (the viral videos, the six subtopics, the plan), and how the checklist on the brand's page is kept; do those steps with this one.
Dispatch it in the background, then write the board documents right away (call `pipeline_status` and write its `documents`), so the onboarding page shows the Researcher working while it runs; write them again when it reports back.
If the researcher stops before it finished (it says it ran out of turns, or its draft lacks what it was asked for), dispatch it once more with the same prompt and say what the draft already holds: it carries on from there.
After the viral dispatch of section 4e (at once when there is none), call `pipeline_brand_research_save` with the brand and `runId`.

When the save returns `needs_changes`, never close the run and never tell the person about it.
Read `problems`: fix the draft file yourself when the fix is only wording or a stray key, otherwise dispatch the researcher once more with the `problems`, `draftPath` and `rawDir`, then save again.
Say this to the researcher in that second dispatch, word for word: "Rewrite the draft file with Write (you have no Edit tool), copying each quote exactly from its capture."
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
When `topPosts.breakdowns.videos` is more than 0, add one line in plain words, for example "I also watched 4 of the best videos and saved how they open, their style and their call to action."
When the save result's `banks` is there and `banks.saved` is more than 0, add one line in plain words from `banks.kinds`, for example "I also saved 9 customer pain points, 4 objections and 3 angles from comments, forums and reviews." Never name the banks, the kinds or the checks.
When it is missing, say nothing about it: a brand with no comments or reviews to read simply has none yet, and its pain points fill in from the research of its first jobs.
When no post was saved and Instagram is not the reason, say so once in plain words, for example "There are no posts to learn from yet, so your brand library starts empty. It fills as you make posts.", and carry on.

### Instagram behind a login

The research helper reads a public Instagram account when its stealth reader is installed (followers, bio, recent posts, and likes and comments per post, never views; its posts are filed with their likes). When that reader is missing or Instagram refuses it, the helper cannot read Instagram without a login, so a brand whose posts are on Instagram has none in its library after the save.
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
When the person would rather choose the folder than paste it, call `pipeline_folder_pick` with no request ID: it opens the folder dialog on their computer and returns `status` chosen with the `folder`, or cancelled, timeout or unavailable.
When a path arrives, ask who the footage belongs to with `pipeline_board_ask`, in plain words, with three buttons: "Ours, free to use" (rights ours), "Ask me each time before posting" (client_ask) and "Never use it" (never). Never guess the rights and never default them.
Then call `brand_footage_import` with the brand, the folder, the rights and a short label in the person's words. It reads the folder in the background, skips copies, makes small thumbnails and costs nothing; the files are never copied, moved or changed. Say so in one line, for example "Reading your folder now. It is free and runs in the background."
A bigger folder takes a while. `brand_footage_status` shows how far it got, and calling `brand_footage_import` again with the same folder carries on after a stop. A folder that moved shows its files as missing: ask the person for the new place and use `brand_footage_folder` with `relink`.

Describing the footage is what costs model usage, so keep the first pass small: at most 20 files, and only when the person agrees.
List them with `brand_footage_search` (`analysed` none, `kind` video). For each, call `media_extract_frames` on its `path` with a count of 3, Read the frames, and get the first spoken words with `media_transcribe` only when it answers with a transcript at no cost (a saved one, the platform captions, or the free local reader when faster-whisper is installed); when it says it needs a paid transcription provider, leave the spoken words out and do not run it. Then call `brand_footage_analysis_save` with stage `quick`: what the opening seconds show, the first spoken words if any, and the products, mood and shot types you can see. Never describe a file marked never. Describe more only when the person asks.
When the first pass is done, tell the person in plain words how many files there are and how many you looked at, and offer a full breakdown of the clips they care about: ask with `pipeline_board_ask` ("Want me to break down your best clips in full? It reads each one closely and uses model usage."). Mark the files they pick with `brand_footage_mark`. Its answer says how many files are marked and that a full pass uses model usage: tell the person that number and ask again before you start. Then watch each marked file (`media_extract_frames` with a count of 12 and the transcript) and save stage `full` with `brand_footage_analysis_save`: scenes, shot types, products, mood, on-screen text and usable moments, with start and end times in seconds.
When the first pass is saved, say what the person now has in one line, for example "Your archive has 128 files, and I have looked at 20 of them."
The person can also add folders themselves on the board, under Logo, colours and fonts; section 4d says how to handle those.

## 4d. Folders added on the board

The board's "Logo, colours and fonts" section has a "Your videos, photos and fonts" block.
The person presses "Choose a folder..." and picks a folder of the brand's videos, photos or fonts in a dialog that opens on their own computer, after answering "Who owns the files in this folder?" with one of three cards: Ours (the rights `ours`), Client work, ask first (`client_ask`) or Reference only (`never`).
The board is a browser page and cannot read a path on this computer, so a pick arrives as a `brand_folder_pick` request with `{ brand, rights, label? }` and no path.
The person can also open "Or paste a path" and type the full path of a folder, which arrives as a `brand_folder_add` request with `{ brand, folder, rights, label? }`.
They can add as many folders as they like.
The rights are the person's own answer from the board: never change them and never ask again.
For a `brand_folder_pick`, land it with `pipeline_board_request_land`, then call `pipeline_folder_pick` with its `requestId` and `confirmedBy` set to `board request <requestId>`.
The tool opens the operating system's folder dialog on the person's computer, waits up to 3 minutes and imports the folder they choose exactly as `brand_folder_add` does (the same checks, the person's rights, the same receipt), so do not also call `pipeline_board_request_apply` or `brand_footage_import` for it.
Say once, in plain words, that a folder picker has opened on their computer and may be behind other windows; the board already says so.
Its `status` tells what happened: `applied` carries on below (it names the folder in `name`); `cancelled`, `timeout`, `unavailable` and `refused` mean it has already declined the request with a plain line the board shows, so say in one line what happened (for `unavailable`, that a picker could not open here and "Or paste a path" works instead), write its `artifactReceipt` to the board, publish the workspace projection and ask nothing more; `handledElsewhere` means another window has it, so say nothing.
For a typed path (`brand_folder_add`), land it with `pipeline_board_request_land` and apply it at once with `pipeline_board_request_apply`, `confirmedBy` set to the board request: the click is the approval, so there is no chat confirmation.
The apply imports the folder exactly as `brand_footage_import` does and starts reading it in the background, which is free; nothing is copied, moved or changed.
Do not call `brand_footage_import` for it as well.
If the apply refuses (the folder is not there, it is too broad, or it was already added with other rights), say the refusal's plain line in chat, decline the request with `pipeline_board_request_decline` and that line as the reason, and publish the workspace projection.
After a successful apply, publish the workspace projection so the board lists the folder, then do the following in order.

1. Let it read. `brand_footage_status` shows how far each folder got; it carries on without you, so check it only when you have nothing else to do, and carry on with the steps around this one meanwhile.
2. Look at a few files, without asking: the board click already covers a small first pass. Describe at most 20 files per request, videos first (at most 10) and then pictures, never a file in a `never` folder and never a font. Use `brand_footage_search` with `analysed` none, and describe each as 4c says: for a video its frames and, at no cost, its first spoken words; for a picture, look at it (its `path`, or its `thumbnail`).
   Save stage `quick` with `brand_footage_analysis_save`. For a picture, `opening` says what is in it, with `products`, `mood`, `style`, `logoVisible` true when a logo shows and `isLogo` true when the picture is itself a logo. For a video, also give `hook` (its opening line or visual hook) and `style` (for example "talking head with captions"); the hook, style, shot types and on-screen text of a video go into the brand library as the brand's own proven lines by themselves, with the file as their proof.
3. Ask before the full pass, with the count. Say how many videos and photos there are and how many you looked at, then ask with `pipeline_board_ask` whether to break the best clips down in full, for example "I looked at 20 of your 52 videos and photos. Want me to break down your best clips in full? It reads each clip closely and uses model usage." Mark the files they pick with `brand_footage_mark`, tell them how many are marked, and ask again before you start. Then do the full pass as 4c says.
4. Call `brand_footage_digest` and report in plain words what was found, from its `summary`, for example "12 videos, 40 photos, 2 fonts: Montserrat, Playfair. I looked at 20 of them." Add one line for each thing it did or offers:
   - Fonts: when the kit had no fonts, the families found are already in the kit's Fonts, and the person confirms them with Save and continue like the rest of the kit; say so. When the kit has fonts and `fonts.offer` lists more, ask which to add with `pipeline_board_ask`, then call `brand_footage_adopt` with the `fonts` they chose.
   - Logo: only when `logos.offer` is not empty (the kit has no logo). Ask "Is this your logo?" with its file name, and on a yes call `brand_footage_adopt` with `logoFileId`. Never replace a logo the person already has; use `replaceLogo` only when they say so in their own words.
   - Photos of your world: when `photos.offer` has pictures and `photos.room` is above 0, pick at most that many that show the brand's place, people or product in use (not a logo, not a screenshot), say in one line what each shows, and ask once whether to add them. On a yes call `brand_footage_adopt` with `photoFileIds`. The photos the person chose themselves are never replaced, and when there is no room say nothing.
   - When the person says no to an offer, call `brand_footage_adopt` with `pass` so it is not offered again.
5. A file in a `ours` folder is free to use; a `client_ask` file needs the person's yes before it is posted, and learning from it or offering it here is not posting it; a `never` file is never described, offered or used. When the person changes a folder's rights, use `brand_footage_folder`.

Never mention file paths, ids, tool names or the folder's technical state in chat or on the board.
Say what was found in plain marketing words, for example "I found 12 videos, 40 photos and 2 fonts, Montserrat and Playfair. I added the fonts to your kit and saved 9 hooks and styles from your videos to your brand library."

## 4e. Brand intelligence: the deep pass

Onboarding always runs the deep pass: there is no quick option and nothing to ask the person about it.
The person sees it as a checklist on the brand's page, then as the brand intelligence tabs (the board draws `brand.intelligence` by itself).
It has four pillars, and each feeds a concept: the brand's own winners (Concept A), the top 3 competitors' winners (Concept B), what is viral in the niche now (Concept C), and the six subtopics that tie them together.
The 6 by 5 plan comes last.
Every video taken apart is labelled on the format library's axes (format, editing style, visual hook, subtopic) by the researcher; the library is `pipeline/library/formats.json`.

### The checklist

Keep the checklist current with `brand_intelligence_save` (action `progress`).
It starts by itself when `pipeline_brand_research_start` starts a run: the standard steps, the first one running.
Change one step at a time with `step` (`{ id, state, detail }`) and write the board documents (`pipeline_status`, then its `documents`) after each change, so the page moves.
Keep each detail to plain words with a number ("3 of 5 videos").
The standard ids are `website`, `accounts`, `own_top`, `own_teardown`, `competitors`, `rivals_teardown`, `viral`, `pains`, `subtopics`, `plan` and `files`.
The checklist turns ready by itself when every step is done.
Never mention the tool, the ids or the files in chat.

### The sequence

1. Right after `pipeline_brand_research_start` and `web_brand_kit`, dispatch the researcher in the background as section 4 says, and at the same moment spawn the Trend Scout in the background.
   Put `brand:<slug>` alone on the first line of its prompt, then the brand's niche (the industry pick when there is one, else the brand's market and content pillars), the target market, the saved competitor names, `trendsPath` and `viralPath` from the start result, and 30 turns.
   Add the block `pipeline_agent_brief` returns for it, unchanged.
   It looks for what is viral in the niche (niche topic search, YouTube search, TikTok Top Ads, Meta ads), saves the trends it finds and writes the most viewed videos to `viralPath`.
   Mark the step `viral` running with a line such as "Looking for what is viral in AI and automation".
2. When the researcher reports, its draft holds the account reads, the competitors, the top posts of the brand (its 5 best taken apart) and of each competitor (their top 2 each taken apart), every video with its labels, the pain points and the banks.
   Mark `website`, `accounts`, `own_top`, `own_teardown`, `competitors`, `rivals_teardown` and `pains` done as far as they went, with the numbers ("5 videos taken apart", "6 competitor videos").
3. When the Trend Scout has reported too, send the researcher a second, short dispatch with the workstream `viral-teardown`.
   Put `brand:<slug>` on the first line, then `viralPath`, `draftPath`, `rawDir`, the `draftContract` unchanged and `runId`.
   It takes apart the first 3 viral videos and adds them to the `topPosts` of the draft.
   When the Trend Scout failed or wrote nothing, skip the dispatch and mark `viral` done with the detail "Nothing viral found yet".
4. Save with `pipeline_brand_research_save` as section 4 says.
   The save checks the labels of every video taken apart like any other part of the draft, and a problem goes back to the researcher the same way.
   It files the posts it took apart in the brand's intelligence (`intelligence.posts.saved`) and the viral ones as trends too.
5. Subtopics (step `subtopics`): read the posts with `brand_intelligence_get`.
   Cluster their topics (the `subtopic` labels, the hooks and the captions) into six subtopics from all three pillars, a competitor's or a viral post counting as well as the brand's own.
   Each subtopic is a name of a few words and the ids of the posts that show it; rank them by the views of their best post.
   Save the draft with `brand_intelligence_save` (action `subtopics_draft`).
   A brand with few posts also draws topics from its website's offer (the brand files), with no post as evidence.
6. Ask the person to confirm on the board.
   The brand's page shows the six with Looks right and Edit by itself.
   Say it once in chat in one line, for example "Your 6 subtopics are on the brand page. Please check them, because every post will take its topic from them."
   The answer arrives as a `subtopics_confirm` request (section "Brand intelligence" of `skills/board-sync/SKILL.md`).
   Do not wait for it: carry on with the plan from the draft.
7. The plan (step `plan`): spawn the strategist with `brand:<slug>` on the first line and the plan task (the brand, no job), the library block, and the file `workspaces/<slug>/library/intelligence/plan-draft.json` to write.
   Then call `brand_intelligence_save` with action `plan`.
   When it returns `needs_changes`, send the problems to the strategist once as `problems` and call it again; after a second failure leave the plan for later and tell the person only "The plan is not quite ready yet".
8. Finish: mark `files` done and call `brand_intelligence_save` (action `progress`, `status` ready).
   Tell the person in plain words what they now have, from the results, for example "Your brand intelligence is ready: 11 top videos taken apart, 6 subtopics and a plan of 30 post ideas."

### A new company

A brand with no posts of its own (no social accounts, or accounts with nothing on them) still gets the whole pass.
Call `progress` with `newBrand` true, mark `own_top` and `own_teardown` done with the detail "No posts of your own yet", and say it once in one plain line, for example "You are new on social, so your plan comes from what works for your competitors and your niche. Post a few and I will learn what works for you."
The subtopics and the plan come from the competitors' and the viral posts and from the website, and Concept A says it has no post history yet.

### When the subtopics change

When a `subtopics_confirm` is applied and its result says the plan is stale (`planStale`), the plan lacks ideas for the subtopics that are new.
Spawn the strategist again, naming the new subtopics, and file its plan the same way.
A cell of the plan that the person clicks is a `plan_cell_start` request: it starts a post, as board-sync says.
Each later job files what it used on the four axes, and posted results rank the formats, editing styles, visual hooks and subtopics against the brand's own usual; trends refresh every 7 days, competitors' winners every 30 days.

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
