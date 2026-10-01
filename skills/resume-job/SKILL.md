---
name: resume-job
description: Local adapter for the vendored resume-job contract.
user-invocable: false
metadata:
  version: 0.3.1
---

# Resume Job local adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/resume-job/SKILL.md.


Reuse a fresh job snapshot supplied by the caller.
Call pipeline_job_read only when the snapshot is absent or an external state change occurred.
Never pass a human gate or infer approval from conversation text.
Reuse current artifacts and the existing bound artifact URL.

Call pipeline_board_open when the binding is missing or the workspace changed.

If it returns needs_publication, invoke board-setup before presenting the resumed job.

Use board-sync for projection refresh and artifact requests.

Read the canonical nested contract for its output shape and checks.
