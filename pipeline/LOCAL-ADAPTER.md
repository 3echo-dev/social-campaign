# Social Campaign local adapter

The vendored pipeline files preserve the upstream route, agent, skill, workflow, schema, and script contracts.

The Social Campaign root adapter owns local setup, brand onboarding, job creation, input copying, board presentation, and decision application.

For the installed plugin, CLAUDE_PLUGIN_ROOT means the pipeline directory inside this plugin.

The selected workspace root is passed separately as an absolute --root argument and through SOCIAL_PIPELINE_ROOT.

Run pipeline scripts with Node argument arrays, an explicit workspace cwd, and shell disabled.

The local entry path is the pipeline_* tool set in server/tools/pipeline.mjs.

Use workspace_status, setup_open, and setup_wait for folder selection.

Use pipeline_status and pipeline_board_open for local projections.

The brand gate is the board's `onboard_brand` request, or `pipeline_brand_onboard` for chat intake.

`pipeline_brand_create` and `pipeline_brand_complete` are a compatibility path only.

After a profile save, the research pass runs `pipeline_brand_research_start`, one researcher dispatch for the `brand-onboarding` workstream, `pipeline_brand_research_save`, or `pipeline_brand_research_close` on failure.

Onboarding also runs `web_brand_kit`, a public, read-only website read by the server, and New job waits for the kit to be saved.

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
