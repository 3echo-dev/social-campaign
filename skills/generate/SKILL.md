---
name: generate
description: >
  Runs the active local pipeline media production task after the current cost decision is applied.
  Use only when the frozen plan names media production.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local generation adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, pipeline/agents/producer.md, pipeline/skills/make-image/SKILL.md, and pipeline/skills/make-video/SKILL.md.

Reuse a fresh job snapshot supplied by the caller.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Verify the current cost decision, approved generation manifest, input revision, and exact request hashes.

Find the 3Echo and ElevenLabs tools by their base name under any prefix; the namespace a Claude connector uses is opaque and never part of the match.

Call `list_workspaces` for every workspace the account can charge and its balance, then `pipeline_studio_workspaces_save` with that list so the board can offer it. Call `pipeline_studio_workspace_get` for the job's current choice; use its `workspaceId` on every paid or estimate call below. With no choice and more than one workspace, the person picks once: the board's price panel offers its own Change control, and Claude also asks in the board's Inbox and in chat together, as board-sync's Questions in the Inbox describes, with each saved workspace name as an option. Save whichever answer arrives first with `pipeline_studio_workspace_choose`.

For every clip, call `estimate_video_job` with exactly the fields the create call will use. For every voice line, call `creative_generate_speech` with `estimate_only: true`, `generations_count: 1`, and the job's context tag.
After each estimate, the plugin's hook names the saved `estimateId` in one line ("Price saved as est-…").
Use that id in the matching quote item.

The cost decision is the price approval: once every image, clip and voice line has a captured price, call `pipeline_quote_save` with one item per line, then `pipeline_review_present` with `gate: "price"` and no files; it presents the one saved quote for the job.
`pipeline_quote_save` adds to the existing price rather than replacing it.
Items already priced stay, saving the same key again re-prices an item not yet made, and an optional `drop` with those keys removes items not yet made when the person asks for changes.

The board then shows each item, its credits, the total, and the ceiling or balance when known, with Approve at that total and Ask for changes.

Follow the hand-off in `board-sync` under Decisions on the board and in chat: post one short chat summary with the same total and options, and apply whichever answer comes first with the same decision tools.
`maxCredits` is for a concept approval only, equal to the credits shown.
A price approval carries `totals` equal to the `pipeline_quote_save` totals and is applied with no `maxCredits`.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

An applied price approval is the explicit yes to that quote; spend nothing before it, and nothing beyond it.

A request for changes means re-price and present the price again.

Reuse a completed media result when its request ID, artifact hash, and plan revision still match.

Do not re-price, re-probe, or resend a provider request that already has an observed outcome.

An unknown provider outcome remains unresolved and is not retried blindly.

Stop at the first spend-guard block: do not retry the call, work around the guard, or try another tool for the same spend, and tell the person in one plain line what the block is waiting on.

Use the provider only through the person's own claude.ai connector; the plugin has no sign-in of its own.

Keep hero first, then batch, exactly as `pipeline/skills/make-image/SKILL.md` and `pipeline/skills/make-video/SKILL.md` detail, with the job key as `idempotencyKey`.
The hero item's `pipeline_quote_save` entry carries `sample: true`.
Once that sample lands, present it for approval on the board and in chat like every other decision, and hold the rest until the person answers.
A redo of the sample is priced the same way: its new version's `pipeline_quote_save` entry also carries `sample: true`, so the rest of the batch keeps waiting on it.

The hooks record every paid call and its credits, land every output the moment a download link comes back, and move the job's state at the first paid call and once every quoted item lands; never write credits, a manifest `status` or `file`, or the job state for media by hand.

Call `get_asset` for an item only when no download link came back, and call `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link.

Reuse the existing board URL after each observed result and refresh the job snapshot after the mutation.

After media lands, call pipeline_status and write its `documents`, so the board shows the new images and each video's poster frame and duration.

Call pipeline_board_open only when no board URL exists for the current workspace.

The local flow does not call the legacy campaign generation tools.
