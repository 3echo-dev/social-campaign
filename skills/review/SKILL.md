---
name: review
description: Local adapter for the vendored review contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Review local adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/review/SKILL.md.


Present the current revision and exact artifact hashes through the board.
Call pipeline_review_present with the exact files and write every entry of its returned `documents`, so the board shows the decision from the job document.

Before presenting the final post for its content approval, run the label and brand-mark check exactly as `skills/brand-check/SKILL.md` describes, for every image and video the post names.
This check cannot be skipped: never call pipeline_review_present with gate content until the check is current for exactly those files.
When the person accepts a flagged item in chat instead of on the board, carry its id in `acceptedFlagIds` on the final decision, alongside every id already accepted earlier.

Follow the hand-off in `board-sync` under Decisions on the board and in chat at every decision: concept, storyboard, price, final post, posting, and for paid work the campaign plan and going live.
Post one short chat summary of the same decision, naming the job's brand and title, with the same options, and say it can be answered here or on the board.
When the person answers in chat and more than one job is waiting on a decision, and they did not say which one, ask which job it's for in the board's Inbox and in chat together, as board-sync's Questions in the Inbox describes, with each waiting job's brand and title as an option, before landing anything.
When only one job is waiting on a decision, apply the chat answer to that job.
Apply whichever answer comes first with pipeline_board_request_land and pipeline_decision_apply, then write the documents again, name the job's brand and title in the result, and never ask the same decision twice.
Reject stale revisions and changed files.
Never apply an approval from agent context.

Read the canonical nested contract for its output shape and checks.
