---
name: setup
description: >
  Set up or recover the Social Campaign workspace and its private board, and install the research helpers.
  Use for "set up social campaign", "get started", "install social campaign", "connect my tools", "my board is missing or broken", or /social-campaign:setup.
  For everyday requests once set up (make a post, open the board, continue a job) use social-campaign instead.
user-invocable: true
argument-hint: "[--new]"
metadata:
  version: 0.4.0
---

# Setup

## Contents

- Talking to the person
- Select the workspace
- Ask once
- Normal artifact setup
- Connectors
- Explicit replacement with `--new`
- Route after readiness

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
When `workspaceRoot` is absent, the current project's `suggestedRoot` is the one create-or-use choice, with a choose-another fallback; it is asked in the Ask once step below, never as a prompt of its own.
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

## Ask once

Setup has at most three things to ask the person: the folder, the permissions, and the research helper.
Ask whatever is still open together, in one AskUserQuestion call with one question each, so the person answers once and setup carries on; never as separate prompts one after another.
When nothing is open, there is no prompt at all and nothing is said about it.

First, in one message and in parallel, call: `workspace_status` (unless a status was supplied), `setup_permissions_preview`, and `research_tools_check`.
Add `research_helper_install` with no arguments when `research_tools_check` reports `consentNeeded: true`: with no `confirm` it installs nothing and returns what the helper is, how big it is, and whether Python is on this computer.

The questions, each only when it is open:

1. The folder, when `workspaceRoot` is absent: "Set up Social Campaign in <the suggested folder>?" with "Yes, use this folder" and "Choose another folder".
2. The permissions, when `setup_permissions_preview` lists a rule that is not yet present and nothing blocks it.
   Tell the person in one or two plain sentences what the rules allow, for example: "So board clicks work without extra prompts, I'd let Social Campaign's tools run and let Claude read and update your board without asking each time. OK to add that to this project's local settings?" with "Yes, add it" and "No, ask me each time".
   If every rule is already present, or one is blocked by an existing rule, this question is not asked.
3. The research helper, when `consentNeeded` is true and Python is found.
   Say in plain words what it is and costs: a free helper that lets Claude read TikTok and Instagram profiles, ad libraries and protected sites that a plain reader cannot, and download reference videos; a download of roughly 400 MB and about 1 GB on disk; it installs in the background, nothing waits for it, and uninstalling the plugin removes it.
   Offer local speech to text in the same question, as a separate choice, because it is free but large: it transcribes videos that have no captions on this computer, and adds about 150 MB of packages and a speech model of about 480 MB.
   The choices are "Yes, install the helper", "Yes, and add speech to text for videos without captions" and "Not now".
   When Python is not found, do not ask: say in one plain line what `research_helper_install` said about it (the explanation and the one command the person can run themselves), say that the helper can be added once Python is there, and move on.

Then act on the answers, and do not wait for any install:

1. Select and initialize the workspace as above.
2. In one message, in parallel: `setup_permissions_apply` with the same `rulesHash` `setup_permissions_preview` returned (on a yes), and `research_helper_install` with `confirm: true` (and `speech: true` only for the speech choice) on a yes to the helper.
   Setup never installs the helper without that yes, and a "Not now" is final for this setup: it is not asked again.
3. When `research_helper_install` started, say one short line: "Installing the research helper in the background; nothing waits for it." Then go straight on to the board.

When the result of the permissions apply is `manual`, show the person the returned lines and ask them to add those lines to their local settings themselves.
When the result still names a blocking rule, or the person says no, say once in plain words that board clicks may still ask for approval, then move on.
Never narrate rule names, file paths, hashes, or any other internal detail in this step; keep every sentence plain.

## Normal artifact setup

The research helper (Scrapling, yt-dlp and a private browser, plus speech to text when it was asked for) installs only after the person's yes in Ask once, and then in the background.
A copy that is already on this computer from an earlier workspace is attached by `workspace_initialize` without a question, because that downloads nothing.
Setup is the only place a helper is first installed; research never installs anything while it runs.
Later sessions keep what is installed current through `research_tools_check` (see the main entry), which also runs in the background, removes packages nothing uses any more, never installs on a computer that has no helper, and never holds anything up.
Say nothing about its state in setup's summary beyond the one line above; the install progress is not news to them.

Check the connectors (the Connectors section below) and save the results before the board is opened or its documents are written, so the first board already shows what is connected.
Then call `pipeline_board_open` once after the selected workspace is ready and the Ask once step is done.
If the main entry already has a board result for this selected workspace from this same turn, reuse that result and do not repeat status, source, or open calls.
Before doing anything else with whichever successful `pipeline_board_open`, `pipeline_status` or `pipeline_board_source` result this turn sees first, apply social-campaign/SKILL.md's "Check for a finished update before anything else": when it finds the server superseded, deliver its one plain line and stop without publishing, refreshing, or binding anything with this server; a result already checked this same turn by the caller does not need checking again.
Pass the result to `board-setup` so a current binding opens directly, a routine source refresh updates the same artifact, and `needs_publication` follows the shared first-publication lifecycle.
Routine freshness updates keep the existing artifact URL and never create a replacement artifact.
A board already existing for this workspace is not the end by itself: a `bound` result with `sourceStatus: needs_refresh`, or `boardSourceOutdated: true`, is refreshed in place before setup is reported ready, whether that result came from `pipeline_board_open` or from a `pipeline_status` call later in the same setup.
Use the fresh projection returned by `board-setup` for the final route.

## Connectors

Detect the connectors the person already added in Claude before the board's Connectors step is shown.
A connector counts when its tools are available in this session under any namespace; match on tool base names, never on the namespace string, because a Claude connector's namespace is an opaque id.

| Connector | Provider | Present when a tool's base name is | The one read-only call |
| --- | --- | --- | --- |
| 3Echo Studio | `threeecho_studio` | `list_workspaces` | `list_workspaces` |
| ElevenLabs | `elevenlabs` | `creative_list_voices` | `creative_list_voices` |
| Metricool (optional) | `metricool` | `getBrandSettings` | `getBrandSettings` |
| Meta ads (optional) | `meta_ads` | `ads_get_ad_accounts` | `ads_get_ad_accounts` |
| TikTok ads (optional) | `tiktok_ads` | `auth_advertiser_get` | `auth_advertiser_get` |

Run the one read-only call of every connector that is present together, in parallel, in one message; never one after another.
Never use an estimate, create, generate or send tool, and never a tool that creates, updates, activates, pauses or deletes anything in an ad account or uploads to it: these connectors are read-only here.
If a surface is not present, make no call for it and do not push it: the optional ones stay optional cards on the board.

Then save everything in one `integration_probes_save` call with one entry per present provider: `{provider, ok, namespace, detail}`, where `ok` is whether the call answered, `namespace` is the one that answered, and `detail` is one plain sentence when it failed.
For `metricool`, `meta_ads` and `tiktok_ads`, when `ok` is true, add `data`: the connector's result exactly as it came back.
Pass it as is, with the connector's own field names (Meta's `ad_account_id`, `ad_account_name`, `currency`, `business_name`; TikTok's `advertiser_id`, `advertiser_name`); never rename, rebuild or trim the fields yourself.
One entry that fails comes back with its own error and does not stop the others.
This save comes before the board's documents are written, so the first board already shows every connector as connected; if the documents were written earlier (a later connection request), call `pipeline_status` and write them again afterwards, otherwise the board still shows the old state.
The single `integration_probe` and the per-provider save tools still work for a one-off check later.

Read the answer for what needs a sentence:

- Metricool, `list.asked`: publish the workspace projection so the board's Needs you shows the question, and say in one plain line that Claude needs to know which Metricool brand each brand should post through.
  `list.chosen`: say nothing; the brand card shows where posts go.
  `list.needsChoice`: a brand that already posted through one Metricool brand has lost it, and it is never replaced silently; say in one plain line which brand lost which Metricool brand (`was`) and that Claude needs to know which one to use now, after publishing the workspace projection so Needs you shows the question.
- Meta ads and TikTok ads, `list.asked`: publish the workspace projection so Needs you shows the question, and say in one plain line that Claude needs to know which ad account belongs to each brand.
  The question also lets the person answer "No ad account yet" or "Not sure, decide later"; neither is asked again until it matters (a new account appears, or a step needs the account).
  `list.chosen`: say nothing.
  `list.needsChoice`: say in one plain line which brand lost which ad account (`was`) and that Claude needs to know which one to use now.
- A `connect_provider` request that names `metricool`, `meta_ads` or `tiktok_ads` (the board's Connect or Refresh brands) repeats the check for that one provider, with the same read-only call and a one-entry `integration_probes_save`, and is applied only if the probe was `ok: true`, or declined with one plain reason such as that the connector is not connected yet.

When 3Echo is missing, say in plain words that they can add the 3Echo Studio connector from claude.ai Settings > Connectors; the plugin has no sign-in of its own.
When Metricool is missing and the person wants it, say that they can add Metricool from claude.ai Settings > Connectors, then come back and say done.
When Meta ads or TikTok ads is missing and the person wants it, say that Meta ads is added in claude.ai Settings > Connectors as a custom connector with the URL https://mcp.facebook.com/ads, and TikTok ads from the connector directory as "TikTok for Business"; then they come back and say done.
Recommend they keep write permissions for Meta switched off in Business Suite.
Only the providers still not connected are asked about, through the board.
Do this check once per setup; do not repeat it on every board refresh.

A new workspace's board always opens on its Connectors step, `setupStep: "connectors"`, even when every connector already answered, so the person sees what is connected.
It stays there until the person presses Continue (a `connectors_continue` request), which moves on from anything not connected yet; the cards have no separate skip.
After that, the step comes back only when a required connector is neither `connected` nor continued past.
When you give the board link, say in one plain line which connectors are already connected and that they can connect the rest, then press Continue to set up their brand.
If they say in chat to carry on, record it through the same `connectors_continue` board request path a board click would use: land the request with `pipeline_board_request_land` and `from` set to `chat`, then apply it immediately; the person's answer in chat is the approval.
A connector marked `optional`, which is Metricool, Meta ads and TikTok ads, never holds the step back and stays reachable from the board's Connectors link.
A connector left unconnected is not asked again during this setup.
It can still be connected later, from the board or the next time a stage needs it.
A skip that an earlier version recorded in a workspace is still read as continued past; nothing is offered or written for it now.

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

## Route after readiness

Use the final workspace projection without reopening the board or rereading unchanged status.
When no brand has `onboardingStatus: complete`, direct the user to the artifact's inline Brand onboarding form and wait for its request to arrive.
Do not launch a duplicate chat questionnaire when the board is ready.
Use chat intake only when the user explicitly supplies the profile in chat or asks to complete onboarding there.
When a complete brand exists, offer New job, Brand onboarding, and continuation of each existing named job.
Keep incomplete typed briefs and existing jobs resumable with their current IDs.

Setup ends after the selected workspace is confirmed, the artifact is bound and opened or a precise native-capability failure is reported, the safe projection write is confirmed, and the route reflects the fresh brand and job state.
Setup does not start research, run paid generation, call Studio, or synchronize with Supabase.
