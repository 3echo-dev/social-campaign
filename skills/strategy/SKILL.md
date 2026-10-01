---
name: strategy
description: >
  Runs the active local pipeline strategy task after its required research artifacts are current.
  Use only when the frozen plan names strategy.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local strategy adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, pipeline/agents/strategist.md, and the named strategy skills under pipeline/skills.

Reuse a fresh job snapshot supplied by the caller.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Read the current brand profile, input revision, accepted research artifacts, and route plan.

Reuse current evidence whose scope and hashes still match.

Do not redo research.

Raise a named evidence gap to the researcher role when the brief cannot be supported.

Write only the strategy artifact named by the active plan.

Leave the human strategy decision to the local board and pipeline decision tools.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

Reuse the existing board URL after the artifact lands and refresh the job snapshot after the mutation.

Call pipeline_board_open only when no board URL exists for the current workspace.

The local flow does not call the legacy campaign strategy tools.
