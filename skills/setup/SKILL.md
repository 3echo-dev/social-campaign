---
name: setup
description: Set up or recover the selected Social Campaign workspace and its private artifact board.
user-invocable: true
argument-hint: "[--new]"
metadata:
  version: 0.3.3
---

# Setup

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Use this skill for `/social-campaign:setup` and when the main Social Campaign entry has no usable workspace configuration.
The local workspace is authoritative for brands, jobs, files, projections, metrics, and request history.
Use `board-setup` for the shared artifact publication, metadata, watch, notify, and open lifecycle instead of repeating that lifecycle here.

Read `$ARGUMENTS` before calling any tool.
Accept an empty argument list or exactly `--new`.
For any other argument, show `Usage: /social-campaign:setup [--new]` and stop without workspace, source, publication, or binding mutation.

## Select the workspace

Use an existing status object supplied by the main entry when one is already available.
Call `workspace_status` once when no status context is available.
When the caller supplies a workspace root and board result from an explicit user selection, reuse that selection and do not ask for the folder again.
When setup is invoked directly without an explicitly selected workspace, use `workspaceRoot` when it is present and healthy without asking the user to choose again.
When `workspaceRoot` is absent, present the current project's `suggestedRoot` as the one create-or-use choice and offer a choose-another fallback.
If status contains an issue for a project binding, show that specific issue and bound path first; do not present the home default as a replacement.
Do not list or select historical workspaces during ordinary setup.
Only when the user explicitly asks to reconnect to an older workspace, list the known workspaces with `workspace_switch_open`, then call `workspace_activate` with the root they choose.
Do not infer a folder from a machine-wide pointer or from the order of historical workspaces.

Reuse a healthy active workspace when the user explicitly selects it.
Call `workspace_activate` once when the user selects a different known workspace.
Ask for the exact folder path only when the user chooses another folder, then call `workspace_initialize` once with that path.
If the user accepts the suggested current-project folder, call `workspace_initialize` once with `suggestedRoot`.
When the selected existing folder needs initialization, call `workspace_initialize` with that exact folder and preserve all files already there.
Keep the selected absolute root for every later tool call in this conversation.
An existing `Social Campaign Workspace` child beside the current project is already the selected workspace after restart, so reuse it without creating a nested child.
If a project binding points to a missing or invalid folder, show that exact path and ask whether to choose another folder or explicitly reconnect by listing with `workspace_switch_open` and then calling `workspace_activate` with the chosen root; do not silently discover a different workspace.

## Normal artifact setup

The research helper installs on its own in the background as soon as `workspace_initialize` returns.
Say so to the user in one line.
Do not wait for it and do not call a research helper tool here.

For normal setup, call `pipeline_board_open` once after the selected workspace is ready.
If the main entry already has a board result for this selected workspace from this same turn, reuse that result and do not repeat status, source, or open calls.
Before doing anything else with whichever successful `pipeline_board_open`, `pipeline_status` or `pipeline_board_source` result this turn sees first, apply social-campaign/SKILL.md's "Check for a finished update before anything else": when it finds the server superseded, deliver its one plain line and stop without publishing, refreshing, or binding anything with this server; a result already checked this same turn by the caller does not need checking again.
Pass the result to `board-setup` so a current binding opens directly, a routine source refresh updates the same artifact, and `needs_publication` follows the shared first-publication lifecycle.
Routine freshness updates keep the existing artifact URL and never create a replacement artifact.
A board already existing for this workspace is not the end by itself: a `bound` result with `sourceStatus: needs_refresh`, or `boardSourceOutdated: true`, is refreshed in place before setup is reported ready, whether that result came from `pipeline_board_open` or from a `pipeline_status` call later in the same setup.
Use the fresh projection returned by `board-setup` for the final route.

Before the board's Connectors step is shown, detect a connector the person already added in Claude.
A connector counts when its tools are available in this session under any namespace; match on tool base names, never on the namespace string, because a Claude connector's namespace is an opaque id.
3Echo Studio (`threeecho_studio`) is present when a tool's base name is `list_workspaces`, under any prefix.
ElevenLabs (`elevenlabs`) is present when a tool's base name is `creative_list_voices`, under any prefix.
When the surface is present, call one cheap read-only tool from it, a workspace listing or a voice listing, never an estimate, create, or generate tool.
If it answers, call `integration_probe` with that provider, `ok: true`, and the namespace that answered.
If it fails, call `integration_probe` with `ok: false` and one plain sentence.
If no surface is present, make no provider call.
When 3Echo is missing, say in plain words that they can add the 3Echo Studio connector from claude.ai Settings > Connectors; the plugin has no sign-in of its own.
Then refresh the board projection as this skill already does, so a connected provider shows as Connected and the Connectors step is skipped entirely once both are connected.
Only the providers still not connected are asked about, through the board.
Do this check once per setup; do not repeat it on every board refresh.

The board opens on its Connectors step and stays there, `setupStep: "connectors"`, until every connector in its `connectors` list is `connected` or `skipped`.
A Skip the person gives in chat is recorded through the same `skip_provider` board request path a board click would use: land the request, then apply it immediately, the same as a board click; the person's answer in chat is the approval.
A connector the user skips is not asked again during this setup.
It can still be connected later, from the board or the next time a stage needs it.

## Explicit replacement with `--new`

Treat `--new` as explicit recovery for the selected workspace, and do not request a second confirmation.
Call `pipeline_board_source` directly before any artifact open or binding read.
Use its summary, source hash, source version, file path, title, description, icon, and capabilities to seed one private host artifact through the host's actual Artifact API, publishing with the returned `capabilities` object and `icon` exactly as returned.
Keep the returned file path on the host publication boundary and keep local absolute paths, source bytes, credentials, and prompts out of the artifact database.
Preserve the selected workspace's local brands, jobs, files, approvals, events, and metrics, and never reset the workspace or create a campaign as part of recovery.
Requests or comments that existed only on an inaccessible old artifact cannot be restored from the local projection.

After host publication succeeds, call `pipeline_board_bind` immediately with the returned URL, the source `workspaceId`, `replace: true`, `sourceHash`, and `sourceVersion`.
If binding fails after publication, retry with the same returned URL and the same source values before considering another action.
Never publish a second artifact for that bind retry.
If publication fails, leave the old binding untouched, report the host failure, and stop setup.
After a successful replacement bind, retain the complete source result and hand its safe `documents` projection together with the binding and source receipt to `board-setup`.
The shared lifecycle must seed metadata and the final route from those handed-off source documents and receipts without another status or source call.

Use the host's actual Artifact, ArtifactData, and ArtifactComments schemas, and report the capability that is unavailable when any required native capability is missing.
Stop setup when the host cannot publish or persist the private artifact, and name the missing host tool.
Do not claim metadata access, a watch, notification delivery, or automatic wake until the host result or an observed board comment proves it in this session.

## Permissions

After the board is published for this setup, call `setup_permissions_preview`.
If every rule it lists is already present and nothing blocks one, move on without telling the person.
Otherwise tell the person in one or two plain sentences what the rules allow, for example: "So board clicks work without extra prompts, I'd let Social Campaign's tools run and let Claude read and update your board without asking each time. OK to add that to this project's local settings?"
Ask once and wait for a plain yes or no.
On yes, call `setup_permissions_apply` with the same `rulesHash` `setup_permissions_preview` returned.
When the result is `manual`, show the person the returned lines and ask them to add those lines to their local settings themselves.
When the result still names a blocking rule, or the person says no, say once in plain words that board clicks may still ask for approval, then move on.
Never narrate rule names, file paths, hashes, or any other internal detail in this step; keep every sentence plain.

## Route after readiness

Use the final workspace projection without reopening the board or rereading unchanged status.
When no brand has `onboardingStatus: complete`, direct the user to the artifact's inline Brand onboarding form and wait for its request to arrive.
Do not launch a duplicate chat questionnaire when the board is ready.
Use chat intake only when the user explicitly supplies the profile in chat or asks to complete onboarding there.
When a complete brand exists, offer New job, Brand onboarding, and continuation of each existing named job.
Keep incomplete typed briefs and existing jobs resumable with their current IDs.

Setup ends after the selected workspace is confirmed, the artifact is bound and opened or a precise native-capability failure is reported, the safe projection write is confirmed, and the route reflects the fresh brand and job state.
Setup does not start research, run paid generation, call Studio, or synchronize with Supabase.
