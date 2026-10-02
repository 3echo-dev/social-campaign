---
name: publish
description: >
  Runs the active local pipeline publishing or handoff task after final approval.
  Use only when the frozen plan names publishing.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local publishing adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, pipeline/agents/publisher.md, and pipeline/skills/publish/SKILL.md.

Reuse a fresh job snapshot supplied by the caller.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Verify the current final decision revision and exact approved delivery artifact hashes.

Reuse the approved delivery package exactly.

Do not repeat research, probe unrelated providers, edit approved content, or create a replacement package.

Nothing goes out until the person approves the posting plan on the board, and from then on only what that plan says.
When Metricool is connected and the brand's Metricool brand is chosen, the posts go out through it as the sections below describe, and otherwise the person posts them themselves from the posting kit.

At the posting decision, call pipeline_review_present with each `drafts/D*/post.md`, whose Publish plan table carries the platform, account, time and destination, and write every entry of its returned `documents`.

Follow the hand-off in `board-sync` under Decisions on the board and in chat: one short chat summary of where and when each post goes, answerable here or on the board, applied with the same decision tools, and never asked twice.
When a failing check keeps Approve off on the posting card, name that check in the chat summary in plain words and say what is needed first; never tell the person to press Approve then.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

With no Metricool connected or chosen, the only route is "I'll post it myself": the person approves the plan, the board shows the posting kit, and the person posts each one and marks it as posted.

Reuse the existing board URL after the handoff is recorded and refresh the job snapshot after the mutation.

Then call pipeline_status and write its `documents`, so the board shows the delivered package.

Call pipeline_board_open only when no board URL exists for the current workspace.

The local flow does not call the legacy campaign publishing tools.

## Posts made from files the person supplied

A publish_post job posts pictures or video the person already had, copied into the job under `media/supplied/`.
There is nothing to make, so the posting decision, the hosting and the send work exactly as below, with no changes: the files are hosted like any other local file in the job's media folder, with the steps in "Local media to 3echo".
The posts, the post types and the caption were fixed at the final approval, and the posting plan is built from that approval as always.
A file over 100 MB cannot be uploaded to 3echo: the plan says so, and the person posts that one themselves with the posting kit.
There is no hashing, copying or editing of the person's files here, and the label check never applies to them.

## Where and when the posts go

Every job that publishes has its own posting decision, with no exception: it is never folded into the final approval, whatever the schedule says and including "I'll post it myself".

Each job has one route for its posts: schedule with Metricool, save as drafts in Metricool, post now, or the person posts it themselves.
Scheduling with Metricool is the route when the brand's Metricool brand is chosen and Metricool is connected, and the person posting it themselves is the route otherwise.
The person picks the route on the board at the posting decision.
A choice made in chat is saved with `pipeline_publish_route_choose` (`brand`, `jobId`, `route`), which takes `metricool_schedule`, `metricool_draft`, `metricool_now` or `self`, then write every entry of the `documents` it returns.
Post now means a few minutes after the person approves, never the moment of the request.

A job planned before 0.8 whose posting decision was folded into the final approval has no posting decision to make: it ends with the hand-off package, and the board says so.
Tell the person that plainly if they ask, and never try to schedule it through Metricool.

The plugin builds the posting plan, and Claude never writes or edits it.
It is made from the approved posts, each platform's fixed post type, the brand's Metricool choice and the job's schedule: one Metricool post per platform, with its text, time, media and checks.
It is made only from posts and files the final approval covers, so a post changed since then is shown as changed and the person approves the final post again first.
It is built again every time `pipeline_review_present` presents the posting decision and every time the route changes, and the decision always covers it, so the person approves exactly the plan they see.
The route can only change before the posting plan is approved and before anything is sent; after that the tool refuses.
The approval itself is refused until every check on the card passes and the plan is still the one shown.

If the plan changes after the person approved it, that approval no longer applies.
While nothing has been sent, the person can still change an approved plan, and a "Post now" approval that has expired is handled the same way: call `pipeline_publish_reopen` (`brand`, `jobId`), which takes the job back to the posting decision and presents it again with a fresh plan.
Then say in one plain line that the plan changed, and wait for a new answer before uploading or sending anything.
Once anything has gone to Metricool the plan is frozen: the tool refuses with "Some posts already went to Metricool, so this plan can't change. A post Claude cannot send is handed over to you in the posting kit on the board, and the ones that went out are changed in Metricool.", a post you cannot send is handed over to the person (see "The posting kit"), and the person changes the sent ones in Metricool.
When a check on the plan fails, tell the person in their own terms and fix the cause at the right step, such as the post type, the media or the schedule.
A job made from files the person already has skips the price step, which is where the 3echo workspace is normally chosen.
So before presenting the posting decision on any Metricool route, call `list_workspaces` and then `pipeline_studio_workspaces_save` with that list.
With exactly one workspace, choose it with `pipeline_studio_workspace_choose` (`brand`, `jobId`, `workspaceId`) without asking.
With several, ask the person in plain words on the board and in chat which one their files should go to, and save the first answer the same way; the posting card also lists them.
A post of an older job that has no post type says "Choose what kind of ... post this is", and the card shows a "Post type" select with only the kinds that fit: the person chooses there, or says it in chat and you save it with `pipeline_post_type_choose` (`brand`, `jobId`, `deliverable`, `placement`), which refuses once the plan is approved or sent and never replaces a type that is set.
The plan is rebuilt and the decision presented again, so say that the plan changed and wait for the new answer.
A post with no posting time says "Choose when this post goes out.", and on the Schedule route the card shows a date and time input in the plan's zone, which the person fills in there, or says it in chat and you save it with `pipeline_post_time_choose` (`brand`, `jobId`, `deliverable`, `dateTime` as `YYYY-MM-DDTHH:MM` local to the plan's zone), which refuses a time that is not real or less than 5 minutes ahead, and once the plan is approved or sent.
With two or more posts the card also has one "same time for every post" field, and in chat you set every post at once by leaving `deliverable` out of `pipeline_post_time_choose`; a time chosen for one post afterwards overrides just that post.
On Draft the same field is a date in the Metricool planner and a draft is not published.
The time chosen this way is the one the plan sends: it is read before the post's own publish plan and before the job schedule, and it works for every route except Post now.
The plan is rebuilt and the decision presented again, so say that the plan changed and wait for the new answer.
Never get around a check by editing the plan or by choosing another route for the person.

## Local media to 3echo

Posts can only use media that lives in the person's own 3echo Studio workspace, so any local image or video a post needs is uploaded there first.
The file's bytes never go through chat: Claude only handles the upload address, and the plugin sends the file itself.
Use only the 3echo workspace named in the approved post plan, which `pipeline_media_hosted` returns as `workspaceId`, and never any other workspace id.
Uploading needs the post plan the person approved, and it must be unchanged since: prepare it and get it approved first, and upload only files it names.
When the plan does not name a workspace, or the person wants a different one, send them back to the approval on the board instead of changing the workspace yourself.

For each local file a post uses, in this order:

1. Call `pipeline_media_hosted` with `brand`, `jobId` and `path`.
   When it answers `hosted: true` with a `workspaceId`, use that `assetId` and stop: generated images and clips, and files already uploaded, are never uploaded again.
   When `hosted` is true but `workspaceId` is null, the clip or image was made by an older job: call 3echo `get_asset` for that `assetId` in the answer's `planWorkspaceId`, use it only if it is found there, and otherwise treat the file as not hosted and use `planWorkspaceId` as the `workspaceId` below.
2. Otherwise call 3echo `create_asset_upload_session` with the `workspaceId`, `filename`, `mime` as `mimeType` and `bytes` as `sizeBytes` from that answer, plus `tags`, so the signed Content-Type matches the file.
   The reply has `assetId`, `uploadUrl`, `headers` and `expiresAt`, and the link works for 15 minutes.
3. Call `pipeline_media_upload` with `brand`, `jobId`, `path`, `workspaceId`, and the `assetId`, `uploadUrl` and `headers` exactly as 3echo returned them, with nothing edited or added.
   It answers `ok`, `assetId`, `bytes` and `sha256`.
4. Call 3echo `complete_asset_upload` with `workspaceId` and `assetId`.
   The reply is the asset, with its `appUrl` and a short-lived `media.mediaUrl`.
5. Call `pipeline_media_link` with `brand`, `jobId`, `path`, `workspaceId`, `assetId` and that `appUrl` exactly as returned, so the app link is saved with the file for the posting kit.

Never paste, read, encode or send file contents yourself, and never use `upload_asset` for a local file.
Never change the upload address or its headers, and never point it at another place: the plugin refuses anything that is not 3echo's storage for this brand's workspace and this asset, any header other than the file's own Content-Type, and any file that is not an image or video in this job's media folder named in the post plan.
Files are at most 100 MB.

When the upload is refused or fails, say in plain words that the file could not be uploaded and why, in the person's terms.
When the link has expired, create a new session and upload again, once.
Fetch a fresh `media.mediaUrl` with `get_asset` right before it is used, because it only lasts about 10 minutes.

## Sending the posts to Metricool

Only when the job's route is one of the Metricool routes, the person approved the posting plan, and every file a post uses is in the plan's 3echo workspace.
Publishing runs in this session, never in a subagent, because only this session has the Metricool tools.
Find the Metricool tools by base name under any prefix: `createScheduledPost` and `getScheduledPosts`.
Never use Metricool's reviewer tools (`createScheduledPostForReview`, `sendScheduledPostForReview`) or `updateScheduledPost`: the person approves on the board, a scheduled post is changed or cancelled by the person in Metricool, and the plugin refuses all three.

Claude confirms the send in chat before it posts, schedules or saves a draft, and the board has to say so first.
Call `pipeline_board_ask` for the job with `inChat` true and the same plain words you will say in chat (for example "Post these 2 posts now? Yes or No"), write the returned `documents` to the board, then ask in chat.
After the answer, record it with `pipeline_board_answer` before sending, and write the documents again, so the board stops asking.
On a no, nothing is sent.

Send the plan's posts one at a time, each exactly as the plan has it:

1. For each file, call 3echo `get_asset` for its asset id in the plan's workspace right before the send, and use `media.mediaUrl` exactly as returned, in the plan's order.
   The plugin records what 3echo says about the file, and accepts a media link only when 3echo returned it in the last few minutes, for a file of the approved size in the plan's workspace.
   So never reuse an old link, build one, or change one, and never upload the file again to get around a refusal.
2. Call `createScheduledPost` with `blogId` as in the plan, `date` as the planned time in ISO form with its offset from UTC (`Z` or `+hh:mm`), and `info` as a JSON string holding only these fields, each spelled exactly as listed and none repeated:
   - `providers`: exactly `[{"network": "<the post's platform>"}]`
   - `publicationDate`: `{dateTime, timezone}` as in the plan
   - `text`: the plan's text, word for word
   - `media`: the links from step 1
   - `firstCommentText`, `draft` and `autoPublish`: as in the plan, always present
   - `mediaAltText`: leave it out
   - the one network's settings: for Instagram `instagramData` with `type` as in the plan's `type`, `showReelOnFeed` true for a reel and left out otherwise, and `isAiGenerated` as in `aiGenerated`; for Facebook `facebookData` with `type`; for TikTok `tiktokData` with `privacyOption`, `title`, `isAigc` and `commercialContentOwnBrand` as in the plan
3. For "Post now" the plan has a zone and no time: set `publicationDate` and `date` to five minutes from now in the plan's own time zone (the `timezone` the plan gives for the post), and send straight away.
   The plugin accepts a time between 3 and 30 minutes from now, and only within a day of the person's approval; after that, while nothing is sent, call `pipeline_publish_reopen` and present the posting decision again so the person approves it again, and if anything was already sent, the unsent posts go to the posting kit instead.
4. Never add anything else: no boost, no picture descriptions, no TikTok music or interaction switches, no extra settings of any kind (even empty or false ones), no reworded text, no second network in one call.
   The plugin checks the call against the approved plan before it goes out and says in plain words what differs.
   When it refuses, tell the person in their terms what is wrong and fix it at the right step, and never reword the call to get past it.
5. After each call the plugin saves what happened and says so.
   Only a refusal that Metricool makes before it saves anything (a missing title, for example) is a clear failure: tell the person what to fix, and only send that post again once it is fixed.
   Any other error leaves the post with no known result, as the next section describes.

## When a send has no known result

A call that failed with an error, timed out, came back unreadable, or was declined at a prompt leaves that post with no known result, and the plugin will not send it again.
Never send it again, and never retry blind: Metricool cannot delete a post, so a duplicate can only be removed by the person.
The plugin looks for it only in what `getScheduledPosts` really returned, which it keeps by itself, so nothing is passed in, and it never decides on its own that a post is safe to send again:

1. Call `pipeline_publish_reconcile` with `brand` and `jobId` only.
   Its `lookup` says whether Metricool has to be read, for which posts, the `brandId` and `timezone` to use, and the span `from` to `to` to ask for.
2. Call `getScheduledPosts` (read-only, with `extendedRange` true) with `brandId` as given, `fromDate` and `toDate` set to `from` and `to`, and `timezone` as given (the brand's own time zone when it gives none).
3. Call `pipeline_publish_reconcile` again with the same `brand` and `jobId`.
   Each post comes back as `sent` (exactly one post in Metricool is clearly it, now recorded), `ambiguous` (anything else, an empty listing included), `no_listing` (nothing was listed since the send: ask for the span in step 2), or `still_sending` (the call was made minutes ago and may still finish: wait about ten minutes).
4. For an `ambiguous` post, say in plain words that you cannot tell whether it went out, and ask the person to look in Metricool.
   The board then asks them "It is in Metricool" or "It is not in Metricool", and only their answer lets the post be sent again.
   Never send it again yourself, whatever the listing showed.

Then write every entry of the `documents` it returns.

## Finishing the job

A job is finished when every post of the plan is out: each one sent through Metricool (the note after the last send says so, and `pipeline_publish_reconcile` returns `allSent`), or marked as posted by the person from the posting kit.
For a draft route the posts are saved as drafts, and the person publishes them in Metricool.

Close it with `pipeline_publish_close` (`brand`, `jobId`), and never by building the hand-off or running `complete-job.js` yourself.
It is safe to call again at any time, including after a failure part-way through: it builds the hand-off package when it is missing or no longer matches, moves the job on, writes the delivery record with every post's Metricool reference and the person's marks, and completes the job.
It answers `closed` and, when it did not close, a plain `reason`, for example that a post is neither sent nor marked yet.
Then tell the person in one plain line how many posts are scheduled (or saved as drafts) and where, and write the documents.

When a post cannot be sent and is handed over, the person posts it themselves from the posting kit and the job closes once each post is sent or marked.
A post that reached Metricool and then failed there is never handed over: the board tells the person to fix it in Metricool, and it does not hold the job open.
For "I'll post it myself" there is nothing to send: the posting kit is the delivery, the person marks each post, and the last mark closes the job.

## Changing or cancelling a post after it was scheduled

There is no way to change or cancel a scheduled post from here, and the plugin refuses `updateScheduledPost` outright.
Say so in plain words, and give the person the link to the post in Metricool ("Open in Metricool") so they change or cancel it there; the plugin's refusal names that link when it knows it.
Never try to remove or replace a post any other way, and never send it again as a new post.

## The posting kit

For "I'll post it myself" the board shows the posting kit as soon as the person approves the plan: per post its time and account, the caption and first comment, a short checklist, the AI label line, and a download link for each file.
On a Metricool plan the kit lists only the posts you hand over with `pipeline_publish_hand_over` (`brand`, `jobId`, `postId`), which writes it to the send log and from then on the plugin never sends that post.
Hand a post over only when you cannot send it: a refusal you cannot fix, a "Post now" approval that expired, or the person asking you to, and tell the person in one plain line when you do.
Never hand over a post because a send failed or has no known result, and never one that may already be in Metricool: the tool refuses while the send is open, unknown, ambiguous or sent.
A post the person marks as posted is final: the plugin refuses to send it, so never try to send it.
The download link is the file's page in the plan's 3echo workspace, so host every file the kit names with the steps in "Local media to 3echo" (the plan's `workspaceId`, `pipeline_media_hosted`, and `pipeline_media_link` last), then write the documents.
Until a file is hosted the board says "Claude is preparing the download link".
Nothing is sent anywhere for a post in the kit.
The person posts it themselves and presses "Mark as posted" on the board, which arrives as a `mark_posted` request that `skills/board-sync/SKILL.md` describes; the plugin closes the job with `pipeline_publish_close` when every post is out, so never complete it before that.
