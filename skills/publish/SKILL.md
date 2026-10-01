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

Publishing is a separate human action.

At the posting decision, call pipeline_review_present with each `drafts/D*/post.md`, whose Publish plan table carries the platform, account, time and destination, and write every entry of its returned `documents`.

Follow the hand-off in `board-sync` under Decisions on the board and in chat: one short chat summary of where and when each post goes, answerable here or on the board, applied with the same decision tools, and never asked twice.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

If no publishing provider is configured, write the local handoff package and leave the job waiting for manual posting.

Reuse the existing board URL after the handoff is recorded and refresh the job snapshot after the mutation.

Then call pipeline_status and write its `documents`, so the board shows the delivered package.

Call pipeline_board_open only when no board URL exists for the current workspace.

The local flow does not call the legacy campaign publishing tools.
