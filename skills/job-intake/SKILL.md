---
name: job-intake
description: Local adapter for the vendored job-intake contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Job Intake local adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/job-intake/SKILL.md.


Use this adapter only for the intake task named by the active plan.
Reuse the current job snapshot and ask only the named blocking questions.
Persist answers through pipeline_intake_update with the displayed revision.
Keep the existing job ID and never create a replacement job to resolve a blocker.

Read the canonical nested contract for its output shape and checks.
