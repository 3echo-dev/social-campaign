---
name: social-campaign
description: >
  Entry point for the local Social Campaign workspace.
  Use when the user opens Social Campaign, invokes setup, starts a campaign, asks for a brand profile, or asks to see the board.
metadata:
  version: 0.3.3
---

# Social Campaign

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Use the local workspace as the source of truth for setup, brands, jobs, inputs, plans, stages, approvals, artifacts, and metrics.

The local files and runner work without network access.

Artifact presentation depends on the host Artifact, ArtifactData, and comments capabilities.

Studio database sync is parked.

Local drafts may stay unbound while the Studio identity is unavailable.

Use board-setup for first artifact publication and board-sync for later projection and request reconciliation.

The root entry tools own board setup and synchronization.

## Start every session

### Check for a finished update before anything else

The moment this session's first successful `pipeline_status`, `pipeline_board_open` or `pipeline_board_source` result arrives, before doing anything else with it, look at `updateWaiting` and `pluginVersion`.
Treat the server as a superseded install, waiting for the session to restart onto the newer one, when `updateWaiting` is `true`, or when the result carries no `pluginVersion` at all because the running server predates this check.
When that happens, say so once, in one plain line: "Social Campaign was just updated. Open a new chat and type /social-campaign to carry on. Your jobs and board are kept." and stop there for this turn.
Do not refresh or republish the board with that server this turn, on the board or through board-sync: it would publish an old page.
Never tell the person to quit Claude, and never mention `/reload-plugins`: neither reliably reconnects a plugin's MCP server in every session type.
Otherwise carry on as usual below.
A call that failed with an error proves nothing either way: handle the error as usual, for example a corrupt board binding, and run the check on the next successful result instead.
Run this check once per session, on the first successful result from any of these tools; do not repeat it on later calls.

The main entry opens a valid existing board directly and delegates missing workspace or artifact configuration to `setup`.

Call `workspace_status` once when no status context is already available.

If the status has no usable workspace, invoke `setup` with that status context and let it own current-project selection, initialization, artifact setup, and final routing.
When `workspaceRoot` is present for the current project, reuse it without showing historical folders or asking for a second choice.
When it is absent, let setup offer its single `suggestedRoot` and a choose-another fallback, then call `workspace_initialize` or `workspace_activate` for the user's explicit choice.
Never use `setup_open` or `setup_wait` to select a workspace in this chat flow.
Do not repeat workspace status, workspace initialization, source, or board-open calls after setup returns its ready projection.

For a selected healthy workspace, call `pipeline_board_open` once with its default artifact mode because workspace status does not prove that an artifact binding is valid.
Branch on that result: pass a `bound` result to `board-setup`, and invoke `setup` with a `needs_publication` result so setup continues without another status or open call.
A `bound` result with `sourceStatus: needs_refresh`, or `boardSourceOutdated: true`, is not the end by itself: board-setup refreshes it from `pipeline_board_source` before anything else, the same path the session-start reminder describes.
If opening reports a corrupt binding, explain that explicit `/social-campaign:setup --new` recovery is required and do not replace the binding automatically.

Use the fresh projection returned by `board-setup` or `setup` for brands, jobs, and later questions.

Call `pipeline_status` only when the board was not opened or a mutation made its projection stale.

When a `pipeline_status` result carries `boardSourceOutdated: true`, refresh the board from `pipeline_board_source` first, the same path as the session-start reminder describes, before anything else this turn.
A plugin reload in the middle of a session raises no new session-start reminder, so this later check is what catches it.

Reuse the bound artifact URL while the workspace stays selected.

Refresh the local snapshot after a mutation or external state change instead of reopening the board.

Open a returned artifact URL through the host's artifact view.

Open a localhost URL only after the user explicitly asks for the local board and `pipeline_board_open` is called with mode local.

Use `ui_wait` for ordinary pane screens.

Use `board-sync` and the artifact's comments or request records for the artifact board; before replying to anything else this session, follow its session-start procedure once: read and republish the bound board to re-arm the wake-up, which also records its alias automatically, then sweep its saved requests.

Use `pipeline_board_wait` only for an explicitly selected local board.

When a continue_job request arrives, apply it once and pass its returned snapshot to new-job to resume that same job.

Reuse current snapshots returned by tools instead of reading the same unchanged state again.

Use connections_wait only for the Connections screen.

Treat a pending response as an open decision and continue waiting with the same screen ID.

## Local workspace rules

Keep one resolved absolute root for the whole conversation.

Pass that root through the workspace tools and let the local runner resolve all other paths.

The local pipeline does not use Drive configuration, Drive URLs, remote-only inputs, or automatic downloads.

The research helper installs on its own in the background as soon as a workspace is approved.
Do not start it yourself and do not wait for it to finish.

Do not ask for a connector before creating a local draft.

Use a stable request ID for every create or import request.

Retrying the same request ID with the same arguments must return the existing result.

## What does the person need

If the person has not already said what they need, ask once, in the board's Inbox and in chat together, as board-sync's Questions in the Inbox describes.
The question is "What do you need?", with the options "A post or campaign", "Research", "An analysis of a post or campaign" and "A breakdown of a video".

Route whichever answer arrives first to the matching kind.

Once the kind is known, never ask for the job's details (the product, who it is for, where it will run, the format) as a question in the Inbox, and never as a free-text question in chat.
The board's New job form asks for exactly those details, and it opens on its own when the person picks a kind on the board, but only when the job can start now.
A research, analysis or video breakdown job can start without a brand, so the form opens with the kind chosen, unless the workspace has no ready brand and its first brand's onboarding is running, in which case the onboarding card stays in front.
A post or campaign needs a ready brand: once one is ready the form opens with the kind chosen, and with the brand chosen when the question was about a ready brand or only one brand is ready, and the Inbox shows "Start the job: fill in the brief" until the request is sent.
Until a brand is ready, do not point the person to the New job form for a post or campaign; go through the brand gate below first, and let the board's onboarding card and its Inbox item lead.
When the job can start, say it once, in one plain line in chat, for example "Fill in the New job form on the board and I will take it from there", naming the "+ New job" button when the person answered in chat.
Then wait for the form's `create_job` request and continue as new-job describes.
Ask for the brief in chat only when no board is available.

A post or campaign keeps the flow below: the brand gate, then new-job.

Research is kind `research`.

An analysis of a post or campaign is kind `creative_analysis`.

A breakdown of a video is kind `video_breakdown`.

Never ask this question again once the person's own words already say which one they mean.

Parse every link and file already in the request into `sourceRefs` before asking anything else, each `{uri, mediaType}`: a web link is `url`, a video file is `video`.

Never re-ask for a link or a file the request already gave.

Only a post or campaign needs the brand gate below.
For research, an analysis, or a breakdown, use a brand only when the person names one that already exists in the workspace; otherwise the job runs with no brand.

## Brand gate

This gate is for a post or campaign; the other kinds are covered above.

Read the brands in pipeline_status before creating a job.

A brand with onboardingStatus complete may be selected for a new job.

When a brand is chosen for a new job, call `pipeline_brand_tidy_check` once for that brand.
Quietly rewrite any research-filled field it flags into a short plain statement within the limits (audience and positioning under 400 characters, voice under 300 characters, 1 to 8 short content pillars of 60 characters or fewer) with `pipeline_brand_tidy_save`, keeping sources and evidence in the research file.
For a field the person typed, never change it; ask them in one plain line to shorten it on the brand card instead.

A brand with onboardingStatus required must go through onboard-brand before a job is created.

If there are no complete brands and the artifact is ready, direct the user to its inline Brand onboarding form and wait for the resulting request.
Do not repeat the form as a chat questionnaire unless the user explicitly asks for chat intake or supplies the complete profile in chat.

Never create a job for an incomplete brand to reserve a slot.

An existing ready brand leaves both actions available: start a new job or update the brand profile.

## Job and input flow

Invoke new-job after a ready brand is selected, or, for research, an analysis, or a breakdown, once the kind and any named brand are settled.

Collect a written brief before creating the job.

Keep an incomplete typed brief as a local job with route blockers when the user chooses to save it.

Do not invent platforms, deliverables, route fields, approvals, owners, or completed stages.

After a stable job ID exists, use pipeline_inputs_import for selected local files or folders.

The import copies files into an immutable input revision and preserves the originals.

Use the job snapshot to show the current route, missing fields, questions, plan, stages, artifacts, decisions, and metrics.

Route blockers are actionable questions.

Do not run stages while the route is waiting for clarification.

## Board and decisions

pipeline_board_open defaults to the bound private Claude artifact URL and returns `setupStep`, `connectors`, `brands` and one short `jobs` entry per job.

When no artifact is bound, it returns needs_publication without a localhost URL.

Pass mode local only for an explicit local browser fallback.

Each `jobs` entry has jobId, brand, brandSlug, title, state, revision and waitingOn; full detail comes from `pipeline_job_read`.

Read pipeline_board_requests before handling a request submitted from a board artifact.

Board requests are intent only until the local runner validates them; server validation still runs on every apply.

Use pipeline_board_request_land to persist a request with its stable request ID.

A request from the session's own bound board is the person's approval already: apply it immediately with pipeline_board_request_apply or, for submit_decision, pipeline_decision_apply, confirmedBy set to the board request itself, and no chat confirmation prompt.

For a concept approval, pass maxCredits equal to the credits the board showed for that decision.

A price approval carries its own totals, matching the saved quote, and needs no maxCredits.

The runner rechecks the job revision and exact artifact hashes before applying a decision; when they no longer match, say so in chat in one line and re-present the current decision on the board instead of asking for approval again.

Show decision saved and decision applied as separate states.

Every decision, from the concept pick to going live, is presented on the board from the job document and summarised once in chat with the same options; follow `board-sync` under Decisions on the board and in chat.
Every decision summary and every result line, in chat or in a board comment reply, names the job's brand and title in plain words, for example 'SK-II "Anna Sawai serum Reel": price approved.'
An answer on the board is applied immediately and acknowledged in chat in one line; an answer in chat is applied with the same decision tools and the board is written again.
When the person types a decision in chat and more than one job is waiting on a decision, and they did not say which one, ask which job it's for in the board's Inbox and in chat together, as board-sync's Questions in the Inbox describes, with each waiting job's brand and title as an option, and wait for whichever answer arrives first.
Never apply a chat decision to a guessed job.
When only one job is waiting on a decision, apply the chat answer to that job, and still name it in the reply.
Never ask a decision twice, and never leave the board showing a decision that chat already resolved, or the reverse.

A request from another workspace is refused, never applied.

When the person says no to a request in chat, decline it through pipeline_board_request_decline instead of applying it.

### Never stop waiting on an open gate

This is the rule every Social Campaign skill that opens a gate follows.
The other skills point back here instead of repeating it.

A gate is any pane screen or job decision that can come back pending: setup, the Connections screen, and every job decision from the concept pick to going live.

Keep waiting rather than giving up on it.
For a pane screen, call the matching wait tool again immediately, with the same screen ID, until it resolves: `setup_wait` or `connections_wait`, as Start every session describes above.
For a board or chat job decision, apply whichever answer arrives first the moment it arrives, as Board and decisions describes above, then finish the turn: a board decision that has not arrived yet is not a stalled call to retry, it is the doorbell comment, or the next session's sweep of saved requests, still to come.
A decision typed in chat is recorded the same way, with the same `pipeline_decision_apply` call a board click uses.

Never ask the person to reply approve in chat.
Never tell them to send me any short message so I pick it up, or so I can pick it up.
Never say the click was queued, or that a spinner just meant the click was queued.
Those are all the same mistake: giving up on the pane or the board and falling back to chat because a single wait call returned, or a decision was still open, before the person had acted.
A wait call timing out, or a decision that is still open, is normal and expected; it is not a signal to stop waiting, and it is not an error.

The only chat line allowed while a gate is open is the one short summary this file already describes, said once; do not repeat it on every pending wait.

## Stage behavior

Use the stages returned by the frozen job plan and readJobSnapshot.

Do not maintain a second stage order in chat or in this skill.

Use the existing research, strategy, creative, generation, review, and publishing skills only for stages present in the snapshot.

3Echo Studio and ElevenLabs are asked for once during setup, each with a Connect or Skip for now choice.
A stage that needs a connector the user skipped asks again at that point, before the stage can run.

Keep the Connections screen open while the user decides.

Do not start paid generation before its cost approval.

Do not schedule or publish before the final approval.

Record stage output through the local pipeline and refresh the snapshot after each external state transition.

## Operating practice

When anything unexpected happens, find out why before acting on it: read the snapshot or the error first, then choose one next step.

Confirm with the person before a tool call that goes beyond what they asked for in chat or on the board, such as a new job, another brand, extra deliverables, or a bigger spend.

Treat the brand's market and accent as hard filters on every creative choice, including scripts, wording, casting, voices and locations.

Before driving a browser for the person, check which account it is signed in to, and stop and ask when it is not the one the job needs.

## Artifact handoff

Use board-setup for first artifact presentation and board-sync for subsequent artifact state reconciliation.

Keep the board projection scoped to the selected workspace and job.

Local paths are valid only for the local runner.

pipeline_board_source returns a filePath for the host Artifact tool, the `documents` to write, and the same short summary.

Keep that file path out of the artifact database.

Use registered artifact metadata and hashes for board previews and decisions.

Do not expose credentials, local absolute paths, or unverified ownership claims in a board request.

Treat the artifact URL binding as a presentation address and keep account access and ownership unverified until the host proves them.

## Recovery

If a tool fails, explain the user-visible problem in one sentence and give one next action.

If a route is blocked, show the missing fields or questions from the snapshot.

If an import is rejected, ask the user to choose a readable local path outside the workspace.

If a decision is stale, refresh the board and ask the user to review the current files again.

If migration is requested, run pipeline_migration_preview before pipeline_migrate.

Never run both the legacy SQLite workflow and the imported local job for the same job.
