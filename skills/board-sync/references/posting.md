# Posting through Metricool

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written there.

### Which Metricool brand posts

Each brand card shows where that brand's posts go, "Posts go out through Metricool, brand <name>", with a chip per platform: linked, not linked, a different handle than the brand card lists, or one that cannot be told apart (check it in Metricool), and a "Change" control listing every Metricool brand saved with `pipeline_metricool_brands_save`.
`pipeline_metricool_brands_save` never chooses a Metricool brand by itself, not even when Metricool has exactly one: it asks one Needs you question per brand that has none, or whose saved brand Metricool no longer lists, worded "Which Metricool brand should <brand> post through?". Each option shows the Metricool brand and the account it posts as, for example "Coach Fabian (Instagram @coachfabian)", and the last option is "Not through Metricool": that answer (or `pipeline_metricool_brand_unlink`, or the Change picker's same option, a `choose_metricool_brand` request with `blogId: "none"`) removes the brand's link, puts its unapproved plans on the "I'll Post It Myself" route and stops the question until the person picks a Metricool brand. Never unlink without the person's word.
A different handle, an account that could not be matched, an account only Metricool knows and a Metricool brand shared with another brand are warnings, not blocks: the card shows where the post would post, mention it once in one plain line, then send. Only no link, a network the chosen Metricool brand has no account for, an account that changed since it was picked, no account at all, and Metricool being disconnected block posting; for those ask the person to pick the Metricool brand again or correct the channel link on the brand profile (brand update).
To ask again for one brand (the posting check refused its link, or the person wants to move it), call `pipeline_metricool_brand_ask` with that brand after the Metricool brands are saved; it never chooses for the person.
Write the documents again after it, so the board shows the answer or the question.
A brand whose saved Metricool brand is gone is reported as `needsChoice` and gets the question even when only one Metricool brand is left; tell the person in one plain line, and apply their answer as below.
A board answer to that question arrives as an `answer_question` request and applies the pick when the request is applied.
A chat answer is applied with `pipeline_metricool_brand_choose` (`brand` and `blogId`), which also takes the open question back; do not record it with `pipeline_board_answer`.
Map the person's words to one of the brands saved with `pipeline_metricool_brands_save`, and ask once, naming the options, when the words fit more than one.
Then write the documents again.
The pick is made once, when the brand is onboarded: the onboarding form lists the saved Metricool brands when Metricool is connected, and a pick there arrives with the `onboard_brand` request (`metricoolBlogId`) and is saved with the brand. When Metricool is not connected, or the person leaves it on "Choose later", nothing waits on it and the question above is asked once the brands are saved. The person can change it later from the brand card's "Change", from the onboarding form when the brand is updated, or from "Change" on the posting plan card.
The posting plan card says where each post goes before it is approved, for example "Instagram @coachfabian, through Metricool brand Coach Fabian", read from the brand's own saved link; when the link is missing or the posting check refuses it, the card shows a plain warning in its place. Its "Change" switches the brand's Metricool brand (not just this job) and sends the same `choose_metricool_brand` request.
A pick on the brand card or the plan card arrives as a `choose_metricool_brand` request (`args: {brand, blogId}`); apply it immediately with `pipeline_board_request_apply`, the same as any other non-decision request, then publish the workspace projection. It rebuilds the brand's posting plans and presents the decision again, so write every entry of the documents afterwards and never apply an approval given for the earlier plan.
The posting card's routes are, in order, "Post Now" (`metricool_now`, selected by default when Metricool is usable), "Schedule a Post", "Save as Draft" and "I'll Post It Myself"; selecting one posts nothing. The one button beside "Ask for changes" is the approval: "Post Now", "Schedule Post" (held until every post has a time), "Save Draft", or "Download Files" ("Preparing download…" until the plan is ready). After a self-route click the board keeps the button as "Preparing download…" until every kit file has its download link, then it becomes a real "Download Files" that opens the files. Its click arrives as the `submit_decision` request for the publish gate and is the person's confirmation already: apply it with `pipeline_decision_apply` and send the posts as `skills/publish/SKILL.md` says, with no chat confirmation and no confirmation card.
A route pick at the posting decision arrives as a `choose_publish_route` request (`args: {requestId, brand, jobId, route, workspaceId}`, where `workspaceId` is the workspace the board belongs to and any other field is refused, and route is `metricool_schedule`, `metricool_draft`, `metricool_now` or `self`); apply it immediately with `pipeline_board_request_apply`, the same as any other non-decision request.
It rebuilds the posting plan and presents the decision again with it, so write every entry of the documents `pipeline_review_present` or `pipeline_status` returns afterwards, and never apply an approval given for the earlier plan.
A route chosen in chat is saved with `pipeline_publish_route_choose` instead.
A post type chosen for a post that has none arrives as a `choose_post_type` request (`args: {requestId, brand, jobId, deliverable, placement, workspaceId}`, where `workspaceId` is the workspace the board belongs to and any other field is refused); apply it immediately with `pipeline_board_request_apply`.
It is refused once the plan is approved or sent, for a post that already has a type, and for a type the post cannot be; otherwise it rebuilds the plan and presents the decision again, so write the documents afterwards and never apply an approval given for the earlier plan.
A type chosen in chat is saved with `pipeline_post_type_choose` instead.
A posting time chosen on a post of the Schedule route arrives as a `choose_post_time` request (`args: {requestId, brand, jobId, deliverable, dateTime, workspaceId}`, where `dateTime` is a plain local time `YYYY-MM-DDTHH:MM` in the plan's zone, `workspaceId` is the workspace the board belongs to and any other field is refused); apply it immediately with `pipeline_board_request_apply`.
It is refused once the plan is approved or sent, and for a time that is not real or less than 5 minutes ahead in the plan's zone; otherwise it stores the time on the post, rebuilds the plan and presents the decision again, so write the documents afterwards and never apply an approval given for the earlier plan.
The card also has one time for every post (two or more posts): that request carries no `deliverable`, and the time is stored on every post in one write with one rebuild; with a `deliverable` it is that one post, which overrides the time for all.
A time chosen in chat is saved with `pipeline_post_time_choose` instead (leave `deliverable` out for every post).
Read Metricool again with `getBrandSettings` at the start of a session or when the person says the brands changed, then save the result the same way; never read it on every board refresh.

### Where the posts stand

Posts sent to Metricool show on the job's board card as scheduled, saved as a draft, waiting in the app, posted (with a "View post" link), failed (with the reason), late, or "check in Metricool", and the board only shows what the plugin recorded, so it has to be brought up to date.
At the start of a session or a resume, and when a board refresh is asked for, do this for each job whose posts were sent to Metricool, meaning a job past the posting decision that used a Metricool route:

1. Call `pipeline_publish_reconcile` with that job's `brand` and `jobId` only.
   When `lookup.needed` is false there is nothing to read and nothing more to do for that job.
2. Otherwise call Metricool's `getScheduledPosts` (read-only, with `extendedRange` true) with `lookup.brandId`, `lookup.timezone` (the brand's own time zone when it is empty) and the span `lookup.from` to `lookup.to` as its `fromDate` and `toDate`, and never any tool that creates, updates or sends a post.
   The plugin keeps what it returned by itself.
3. Call `pipeline_publish_reconcile` again with the same `brand` and `jobId`: it reads what was kept and records what it proves.
4. Write every entry of the `documents` it returns, so the board shows the new status.

Metricool's own listing decides what the board says, never anything said in chat: a post it reports as published reads as posted, with the link to the post it gives.
A post still pending thirty minutes after its time reads as late, a post that Metricool reports with an error reads as failed with its reason, a post that a listing covering its time no longer shows reads as "check in Metricool", and a post whose automatic publishing is off reads as waiting for the person in the app.
Say in one plain line what changed, for example "Your TikTok post is live", and never call it posted before the plugin does.
A post the plugin cannot clearly find in Metricool, whether something similar is listed or nothing is, stays blocked and comes back as ambiguous: tell the person to check in Metricool, and do not send it again; only their answer on the board lets it go out again.
The same steps settle a send that had no known result, as `skills/publish/SKILL.md` describes.

#### Answers about one post

A post whose result is not known shows on the board as "Is this post in Metricool?" with two buttons, "It is in Metricool" and "It is not in Metricool", and the person's answer arrives as a `resolve_post` request (`args: {requestId, brand, jobId, postId, answer, lid, workspaceId}`, where `answer` is `in_metricool` or `not_in_metricool`, `lid` is the attempt the person was asked about, `workspaceId` is the workspace the board belongs to, and any other field is refused).
Apply it immediately with `pipeline_board_request_apply`, the same as any other non-decision request, then write every entry of the documents `pipeline_status` returns.
The plugin checks it before it saves anything: the post must be waiting for the answer, the answer must be for the attempt the post is at now (otherwise it is refused and the person is asked again), and "It is not in Metricool" is only taken ten minutes after the post's latest send, because Metricool may still be saving it.
When the plugin refuses, decline the request with `pipeline_board_request_decline` and the plugin's one plain sentence as the reason, and never answer for the person.
"It is in Metricool" records the post as sent by the person's word, and the board then reads "Check in Metricool" with a link when one is known.
"It is not in Metricool" is the only way that post can be sent again, and only through the normal send in `skills/publish/SKILL.md`.

#### Marking a post as posted

For "I'll Post It Myself" the board shows the posting kit, with a download link, the caption, the first comment and a short checklist per post, and a "Mark as posted" button with an optional link.
On a Metricool plan the kit lists only the posts Claude handed over with `pipeline_publish_hand_over`, and the person can mark those too; a post that reached Metricool and failed there is fixed in Metricool, never from the kit.
Marking arrives as a `mark_posted` request (`args: {requestId, brand, jobId, postId, link, workspaceId}`, where `link` is left out when the person gave none, is a full https address of at most 500 characters otherwise, and any other field is refused).
Apply it immediately with `pipeline_board_request_apply`, then write every entry of the documents `pipeline_status` returns.
The plugin records it in `publish/posted.json` as the person's own word, never as something a platform confirmed, which freezes the posting plan like a send does, and when every post is out (each sent through Metricool or marked) it closes the job with the same step as `pipeline_publish_close`: it builds the hand-off package if it is missing or stale, moves the job to `HANDOFF_READY`, writes the delivery record with the marks and completes it.
A post the person marked is final: the plugin refuses to send it.
When the answer says the job was not closed, call `pipeline_publish_close` (`brand`, `jobId`) yourself, which is safe to repeat, and tell the person in one plain line that their posts are marked and the job is done once it says `closed`.
Until the job is complete the board says "Claude is closing this job", so never say it is finished before `closed` is true.
When the plugin refuses (the plan is not approved, the post is not in the plan, the link is not valid), decline the request with its one plain sentence as the reason.
Never mark a post yourself, and never call a post posted because the person said so in chat: ask them to press the button on the board.
