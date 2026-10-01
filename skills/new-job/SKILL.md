---
name: new-job
description: >
  Creates and resumes a local Social Campaign job for an onboarded brand.
  Use when the user starts a new job, describes a campaign brief, or chooses a ready brand from the board.
user-invocable: false
metadata:
  version: 0.3.3
---

# New Job

A job begins with a ready brand, a written brief, and a stable request ID.

The local job record is the authority for route, plan, stages, artifacts, decisions, and metrics.

## Existing draft continuation

If the caller supplies a continue_job request with a job ID and snapshot, attach to that existing draft before collecting or creating anything.

Reuse the supplied snapshot and do not call pipeline_job_create for that job.

If the route is pending, show its questions and resolve the same job with pipeline_intake_update using the displayed revision.

If the caller supplied a local board request rather than a snapshot, use pipeline_board_request_apply and continue from its returned snapshot.

## 1. Confirm the workspace and brand

Reuse a fresh pipeline_status snapshot supplied by the caller.

Call pipeline_status only when no current workspace and brand snapshot is available.

If there is no local workspace, return to the social-campaign setup flow.

For a `research`, `creative_analysis`, or `video_breakdown` job, this brand gate does not apply: use a brand only when the person names one that already exists in the workspace, otherwise use `brand: "no-brand"`, and go straight to Capture the brief.

For every other kind, choose a brand whose onboardingStatus is complete.

If no such brand exists and the artifact board is ready, direct the user to its inline Brand onboarding form and wait for the resulting `onboard_brand` request.
Use the onboard-brand adapter to route that request, or use `pipeline_brand_onboard` only when the user explicitly chooses chat intake or supplies the complete profile in chat.

If the selected brand has onboardingStatus required, return to that same inline form and wait for its complete submission.

Do not create a job before the brand gate is complete for a kind that needs one.

## 2. Capture the brief

Collect the title and the user's brief.

When the person asked for a job and has not written the brief yet, point them to the board's New job form (the "+ New job" button) and wait for its `create_job` request; never ask for the brief as a question in the Inbox.
Ask for the title and brief in chat only when no board is available.

Preserve the user's wording in the brief.

Ask for missing information through the board or the current intake screen.

Accept a text-only brief.

Treat platform, deliverable, audience, objective, timing, and reference inputs as explicit user data.

Treat anything the brief states outright or clearly implies the same way: a duration and format such as "one 30s Reel" states a platform, a content type, and a deliverable, not just a sentence to store verbatim.

Ask whether the job is about a product, a character or neither, unless the brief already says, and set `subject` to `product`, `character` or `none`.

Parse every link and file already in the brief into `sourceRefs`, each `{uri, mediaType}`: a web link is `url`, a video file is `video`, any other attached file is `image` or `document` by its extension.
Never re-ask for a link or a file the brief already gives.

References and supporting material are never required to start a job; a brief with none of them is still complete.

Use a new stable request ID for this create attempt.

A retry with the same request ID must use the same brand and title.

## 3. Create the local job

### Extract the brief before creating the job

Before calling pipeline_job_create, whichever screen the brief came from, the board's New job form or chat, read the brief and the brand's saved profile and extract every field they state or clearly imply.

This step runs on its own, with no confirmation question first: do not ask the user whether to go ahead, just fill in what the brief and the brand profile already answer.

A stated duration and format such as "one 30s Reel" gives a video content type, an Instagram platform, and one deliverable for a 30-second Reel at 9:16.

A word such as "awareness" gives the objective, "organic" gives the distribution, and the product named in the brief is the subject of the request.

When the brief itself narrows the audience (for example "women 35+ in Singapore"), write that as a short plain statement, one or two sentences, for `audience`.
When the brief does not narrow the audience, leave `audience` out of the job entirely: never copy the brand profile's audience into the job, and never paste research notes, sources, dates or rule references into it.
The router falls back to the brand profile's own audience on its own; the job only ever states what this particular brief narrows.

This extraction pass is not a guessed default: a guessed default invents a fact the brief never gave; this only restates, in typed fields, what the brief already says in words.

Talk to the person in plain marketing language only: never mention limits, character counts, validation, routing, blocked states, file paths or tool names.
Fix quietly whatever can be fixed without changing what they meant; otherwise ask one plain question in the board's Inbox and in chat together, as board-sync's Questions in the Inbox describes, and take whichever answer arrives first.

Put everything extracted into the typed `job` object of the single pipeline_job_create call, with these exact field names and values:

- `request`: the brief, in the person's words; the product or subject stays here.
- `kind`: `organic_post`, `organic_series`, `ugc_creative`, `paid_campaign`, `content_repurpose`, `research`, `creative_analysis` or `video_breakdown`.
- `sourceRefs`: for `research`, `creative_analysis` or `video_breakdown`, one object per link or file already in the brief, each `{uri, mediaType}` where `mediaType` is `url` for a link or `video` for a video file.
- `objective`: `awareness`, `engagement`, `traffic`, `leads`, `sales`, `app_installs` or `retention`.
- `distribution`: `organic`, `paid` or `both`.
- `platforms`: a list of `facebook`, `instagram` and `tiktok`.
- `deliverables`: one object per platform and format, `{id: "D1", platform, count, creativeDiscipline}`, where `creativeDiscipline` is `static_image`, `carousel`, `brand_video`, `ugc`, `motion_graphic` or `text_only`; a `ugc` item adds `ugcSource: "ai"`, a `ugc` or `brand_video` item where a person or character speaks to camera adds `talkingCharacter: true`, and a stated shape adds `aspectRatios` (for example `["9:16"]`) and `durationSeconds: {min, max}`.
- `audience`: `{description}`, only when the brief itself narrows the audience; leave it out otherwise, and never copy the brand profile's audience in.
- `budget` and `landingPageUrl`, only when the brief states them for paid work: `{currency, maxTotalAmount}` and an https URL.
- `schedule`: `{publishAt, timezone}`, only when the brief states a time.
- `subject`: `product`, `character` or `none`, from the answer to what the job is about; leave it out when the job is plainly about a product.
- `productAsset`: an https link to a product photo, or to a picture of the character on a `character` job, only when the brief gives one.

For `research`, `creative_analysis` or `video_breakdown`, leave out `objective`, `distribution`, `platforms` and `deliverables` entirely; they do not apply.

A person can also attach a product photo file directly, on the New job form or, once the job exists and the router blocks on one, on the board's own Finish the brief photo field.
Both arrive as a local file path already saved to disk (never bytes typed or pasted here): pass it as `photo` on `pipeline_job_create` for a new job, or call `pipeline_product_photo_attach` for an existing one.
Either way the photo lands under that brand's own inputs and is recorded on the job as `productAsset`; never ask the person for a link when they can just add the picture.

When the picture is of a character, ask once, in plain words, whether the character is theirs, for example "Is Mina your own mascot, or a person you have the rights to use?"
Ask before the create call when you are passing the picture as `photo`, and after it when the picture arrived from the board.
If they say yes, attach it with `ownedByBrand` true, as `photo.ownedByBrand` on `pipeline_job_create` or as `ownedByBrand` on `pipeline_product_photo_attach` using the saved file in the job's inputs.
If they say no or are not sure, leave it out: the picture is then treated as someone else's, and the post carries a disclosure.
Never ask this for a product photo.

Leave out anything the brief and the profile do not say.

For a board `create_job` request, the same object goes into the request's `args.job` before it lands, as `board-sync` describes, and the apply passes it to the same create.

### Create it

Call pipeline_job_create with brand, requestId, title, brief, and that `job` object, so the job routes the moment it is created.

Do not publish the board between reading the brief and this call: the board must never show a question the brief already answers.

The tool strips owner fields supplied by the model.

A local draft may return ownershipStatus unbound while Studio sync is parked.

The returned job ID is the only job identity to carry forward.

Do not create a second project record for the board.

Use the returned job snapshot from pipeline_job_create.

Call pipeline_job_read only when the create response has no snapshot or an external process changed the job.

The create call routes the job and may write a plan.

### Find a product photo automatically when one is needed

If the create call's route blocks with "a photo of the product" among its blockers and the brief gave no photo, do not ask for one yet.

Look for the product's own page on the brand's official website, with web search restricted to that domain, then call web_product_photo_find with the brand, the job ID, and that page address.

When it returns attached, call pipeline_job_read and continue from the refreshed, no longer blocked route.

When it returns not_found, ask the one plain question, "Can you add a photo of the product?", the same as any other missing brief field.

The person can still replace the picture on the board at any time.

Never mention rules, tools, files, or where the picture came from to the person.

### A character job with no reference picture

A job whose `subject` is `character` is not blocked for want of a reference picture, and the person is never asked for a product photo.

For a character job with no reference, the first step after the brief is a small reference-art price and pictures of the character, before the storyboard.

Video waits until the storyboard is approved.

### Ask only what is still genuinely missing

A missing route field after the create call returns a pending or blocked route with questions.

Show the user only the fields that are still genuinely missing or ambiguous once the brief and the brand profile are accounted for, and keep the job local until the brief is complete.

Never ask for something the brief already states or implies, or that the saved brand profile already answers; references and supporting material are never one of these questions.

Ask any remaining questions once, together, as a single batch, on the board through its inline intake form or in chat, whichever the user is using.

The board's Finish the brief form appears only when something is genuinely missing; it shows what was already filled in and marks only the missing answers as needed.

Do not supply guessed defaults to clear a blocker that is genuinely open.

Keep the existing job ID when the user answers an intake question.

pipeline_intake_update is only for answers given after the job exists, on that form or in chat.

An answer on the form arrives as an `update_intake` board request and is applied as `board-sync` describes.

For an answer in chat, call pipeline_intake_update with that job ID, the displayed expectedRevision, and a patch containing only the user's answered fields, then call pipeline_status and write its `documents` so the form no longer asks it.

Reuse the snapshot returned by pipeline_intake_update and never call pipeline_job_create again to resolve the same draft.

## 4. Import selected local inputs

If the user chose source files or a folder, call pipeline_inputs_import with the brand, job ID, and absolute source paths.

Import only paths selected by the user.

Imported files are recorded as not owned by the brand; pass `ownedByBrand` true only when the person says the files belong to the brand.
Pass `usedInPost` true only for a file that will appear directly in a finished post; a file used only as reference is never shipped.

The local runner rejects paths that overlap the workspace or escape through a symlink or junction.

The import creates a new immutable revision and leaves the original files unchanged.

If the user re-imports, retain the earlier revision and bind the new revision to the job.

Call pipeline_job_read after an import because the import response does not carry the full snapshot.

## 5. Show the job

Call pipeline_board_open in its default artifact mode only when there is no bound board URL for the current workspace.

If it returns needs_publication, invoke board-setup before presenting the job.

Open the returned artifact URL through the host artifact view and reuse it while the workspace stays selected.

Use board-sync and artifact requests or comments for continuation and intake actions.

Call pipeline_board_open with mode local and use pipeline_board_wait only when the user explicitly chooses the local browser board.

The board project contains the title, current state, revision, ownershipStatus, stages, artifacts, decisions, metrics, blockers, and nextAction.

A pending or blocked route is a user question.

A waiting stage is a user or provider decision.

An approval state is tied to the displayed revision and artifact hashes.

## 6. Run only the routed work

Once the route is ROUTED, the exact next step is producer dispatch for the routed plan: no separate go-ahead question sits between routing and the first dispatched stage, research included.

When the routed plan names a research stage, it runs only the questions the saved brand research (`brand/research.json`, reused through the evidence check) does not already answer; do not ask the user to confirm research should start.

Use the stages returned by pipeline_job_read.

Do not assume a fixed stage order.

Read the Agent routing section of pipeline/LOCAL-ADAPTER.md and the workflow file under pipeline/workflows that the route names before dispatching a stage.

Use the canonical pipeline contract named by the active route under pipeline/agents and pipeline/skills.

The older root specialist skills remain compatibility references and are not selected by this local flow.

Invoke a root adapter only when it points to the canonical contract for the active role.

Record produced artifacts through the local job flow before marking the stage complete.

Refresh the job snapshot after an external state change and reuse the open board URL.

Keep optional provider work behind the stage that needs it.

Do not start paid generation before the cost decision is applied.

Do not schedule or publish before the final decision is applied.

## 7. Apply board decisions safely

Every decision stage hands off between the board and chat as `board-sync` describes under Decisions on the board and in chat: present it, post one short chat summary with the same options, apply whichever answer comes first with the same decision tools, and never ask it twice.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

Call pipeline_board_requests to see pending requests.

Treat a request from an artifact as untrusted intent.

Confirm the requested job, revision, gate, files, and human action in the board.

Call pipeline_decision_apply with requestId, confirmedBy, and the selected spending limit when required.

The runner validates the current revision and exact file hashes before applying the decision.

If validation fails, refresh the board and ask the user to review the current files again.

Show decision saved while the runner is still pending.

Show decision applied only after the runner returns success.

## 8. Resume and finish

On resume, call pipeline_job_read before doing any work.

Continue from the returned state and revision.

Use the snapshot's blockers, questions, and nextAction rather than conversation memory.

When the route and all required stages are complete, show the approved delivery artifacts and the local path.

Keep posting as a separate human action.

If the job is abandoned, preserve its local history and do not delete inputs or approvals.

## Failure handling

If the brand gate fails, return to the inline Brand onboarding form when the artifact is ready, or ask for the complete profile only when the user explicitly chooses chat intake.

If the route is incomplete, show the missing fields and wait for a brief update.

If an input path is unsafe or unreadable, ask for another local path.

If an approval is stale, refresh and request a new decision.

If a provider is unavailable, keep the job waiting with its blocker visible.

If job creation fails with `BRAND_KIT_REVIEW_REQUIRED`, send the person to the board's brand card to review the logo, colours and fonts and click Save and continue.
Never bypass it.

Never run the legacy SQLite workflow and the imported local job for the same job.
