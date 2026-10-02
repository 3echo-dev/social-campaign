# Social Campaign local adapter

## Contents

- Agent routing
- Posting files the person already has (publish_post)
- Publishing

The vendored pipeline files preserve the upstream route, agent, skill, workflow, schema, and script contracts.

The Social Campaign root adapter owns local setup, brand onboarding, job creation, input copying, board presentation, and decision application.

For the installed plugin, CLAUDE_PLUGIN_ROOT means the pipeline directory inside this plugin.

The selected workspace root is passed separately as an absolute --root argument and through SOCIAL_PIPELINE_ROOT.

Run pipeline scripts with Node argument arrays, an explicit workspace cwd, and shell disabled.

The local entry path is the pipeline_* tool set in server/tools/pipeline.mjs.

Use workspace_status and workspace_initialize for folder selection.

Use pipeline_status and pipeline_board_open for local projections.

The brand gate is the board's `onboard_brand` request, or `pipeline_brand_onboard` for chat intake.

`pipeline_brand_create` and `pipeline_brand_complete` are a compatibility path only.

After a profile save, the research pass runs `pipeline_brand_research_start`, one researcher dispatch for the `brand-onboarding` workstream, and `pipeline_brand_research_save`.
A save that returns `needs_changes` leaves the run open, so the draft is fixed and saved again, and `pipeline_brand_research_close` is used only when a tool itself fails.

Onboarding also runs `web_brand_kit`, a public, read-only read by the server that returns colours and fonts only, and New job waits for the kit to be saved.
The logo is upload only.

Limits: Hard limits table in pipeline/skills/research/SKILL.md.

Old `brand_*` tools are refused.

Use pipeline_job_create for a new draft, pipeline_intake_update to answer blockers on that same draft, pipeline_job_read when a fresh snapshot is absent or stale, and pipeline_inputs_import for local inputs.

Use pipeline_board_requests, pipeline_board_request_land, and pipeline_decision_apply for board intent and decisions.

Gate-app files and gate-app transport are compatibility inputs only.

When a local workspace contains .social-pipeline/config.json with storage.mode local and pipeline provenance, lib-gate.js is offline and parked even if a legacy gate-app.json remains.

The local pipeline does not use Drive configuration, remote-only paths, automatic research downloads, or a second job authority.

The local route dispatches only active plan tasks.

A current accepted artifact is reused when its scope, revision, input hash, and rule hash still match.

Research is dispatched once per named workstream.

A later stage reads the saved research artifact instead of probing the provider again.

A provider is checked only when the active task requires it and its current capability result is absent or stale.

Human approval is saved and applied through the root pipeline tools after revision and artifact hash validation.

This file is the transport and entry override for the vendored execution docs.

## Agent routing

The local route uses the registry in pipeline/registry and the canonical contracts under pipeline/agents.
Each route role has a root adapter at agents/<role>.md and a canonical contract at pipeline/agents/<role>.md.
The roles are producer, researcher, strategist, copywriter, scriptwriter, media-buyer, videographer, editor, and publisher.
The root adapters point those contracts at the installed plugin and the local runtime.
When a contract refers to CLAUDE_PLUGIN_ROOT, resolve it to the installed plugin's pipeline directory.

The active route in route.json and the rows in plan.md decide which agent is eligible.
The workflow for a job is the pipeline/workflows file its route names, and pipeline/registry/workflows.json lists them.
The orchestrator dispatches only the active task and its named owner.
route-job.js and plan-job.js are the only workflow selectors.
Do not select a workflow from conversation memory.

Brand-researcher, competitor-researcher, trend-scout, audience-researcher, and brand-onboarding are workstream labels for the researcher contract.
They are not independent routes when the plan names one researcher workstream.
A researcher dispatch covers exactly one named workstream and reads the accepted evidence snapshot before searching.
A strategist reuses current research and raises a named gap instead of redoing research.
A video specialist reuses the current watch report and probes only changed or missing media.
A validation specialist reuses cached checks only when artifact and rule hashes match.
A provider check belongs to the active task that needs the provider, and the same provider is not probed again while the current capability result is still valid.

The local runtime keeps jobs unbound when no verified Studio owner exists.
The outbound sync layer may reject or retain unbound events without blocking local work.

## Posting files the person already has (publish_post)

Use these exact calls and nothing else for this job.
- Caption stage: when the copywriter writes the caption, pass at most 5 frame paths in the spawn prompt, spread from the first to the last, even when `pipeline_qc_frames` saved more.
- Platform check: `node "${CLAUDE_PLUGIN_ROOT}/scripts/platform-check.js" {brand} {jobId} --root "{workspace root}"`.
- Show the final post: `pipeline_review_present {brand, jobId, gate:'content'}`, with no `paths`: every post file and every supplied file is presented.
- Posting decision on a Metricool route: this job has no price step, so first call 3echo `list_workspaces` and `pipeline_studio_workspaces_save` with that list. With exactly one workspace, call `pipeline_studio_workspace_choose {brand, jobId, workspaceId}` without asking; with several, ask which one in plain words, on the board and in chat, and save the first answer the same way.
- Review copies: `pipeline_review_copies_prepare {brand, jobId}`, upload each `toUpload[].path`, and only when the upload was not matched, `pipeline_review_copies_record {brand, jobId, items:[{path, assetId, url}]}`, one item per copy.

## Publishing

The posting decision has its own approval, which covers the posting plan.
The publisher role builds the hand-off record only.
Metricool is the only publishing connector, and the person chooses the route at the posting decision: schedule, save as a draft, post now, or post it themselves.
The route arrives as a `choose_publish_route` board request, or through `pipeline_publish_route_choose` for chat.
A post with no post type (an older job) gets one through a `choose_post_type` board request, or through `pipeline_post_type_choose` for chat, only at the posting decision before approval.
A posting time chosen on the card for a post arrives as a `choose_post_time` board request, or through `pipeline_post_time_choose` for chat, only at the posting decision before approval, and the plan uses it before the post's publish plan and the job schedule.
Uploading media to 3echo and sending the posts run in the main session, never in a publisher dispatch, because subagents cannot rely on connector tools.
A guard lets through only Metricool calls that exactly match the approved posting plan.
A post whose result is not known is settled by the person, through a `resolve_post` request, and a post the person made themselves is closed by a `mark_posted` request.
`skills/publish/SKILL.md` is the full contract.
