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

Whenever you talk to the person, in chat or on the board, use short, simple words a child could follow.
This covers questions, clarifications, approvals, stuck notices, replies and status.
Never show jargon, code, field names, schema names, tool names, file paths or ids.
Good: "Which product is this post for?"
Bad: "kind: missing field brand_profile".
When a step fails on our side, say for example "Something went wrong on our side while saving your video. Press Try again, or tell me to."
After a second failure, say "It didn't work again. We've saved the details for our team. There's nothing you need to do."

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/resume-job/SKILL.md.


Reuse a fresh job snapshot supplied by the caller.
Call pipeline_job_read only when the snapshot is absent or an external state change occurred.
Never pass a human gate or infer approval from conversation text.
Reuse current artifacts and the existing bound artifact URL.

Call pipeline_board_open when the binding is missing or the workspace changed.

If it returns needs_publication, invoke board-setup before presenting the resumed job.

Use board-sync for projection refresh and artifact requests.

Read the canonical nested contract for its output shape and checks.

When a resumed job has posts sent to Metricool, bring their status up to date first, with the steps in `skills/board-sync/SKILL.md` under "Where the posts stand": `pipeline_publish_reconcile` with only the job, then `getScheduledPosts` for the span it names, and `pipeline_publish_reconcile` again, when it says a lookup is needed.
A post with no known result is never sent again, whatever the lookup shows; only the person's answer on the board allows it.

Before asking the person anything in the chat, put the same question on the Director card first, publish the board, then ask in chat; record the answer wherever it comes from first with `pipeline_board_answer`.
When a job is stuck for a reason the person can fix (missing information, an approval, a clarification, an outside account), ask with `pipeline_board_ask` so the question shows on the Director card, and say the same one-line question in chat.
Take the answer from either place, the first one wins, and record a chat answer with `pipeline_board_answer`; `skills/board-sync/SKILL.md` has the steps under "Stuck jobs".
Never ask the person to fix a code problem: say "Something went wrong on our side", leave the technical details out of chat (the board already keeps them with the job), and retry the failed step once.
