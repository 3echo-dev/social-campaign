---
name: resume-job
description: 'Internal step of social-campaign for "continue my job" or "what''s waiting on me": picks an existing job back up from where it stopped. Reached through social-campaign.'
user-invocable: false
metadata:
  version: 0.3.1
---

# Resume Job local adapter

## Talking to the person

Use plain, professional language in chat and on the board.
Ask only for information needed to continue.
Give one-sentence progress updates only for meaningful changes.
Fix internal issues quietly when meaning is unchanged.
Keep implementation details out of routine messages.
Provide relevant details for informed decisions or requested diagnostics, without secrets or private information.
After a failure, name the failed action and give one supported next step.
Claim success, saved diagnostics or team notification only when tool results confirm that specific outcome.

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/resume-job/SKILL.md.


Reuse a fresh job snapshot supplied by the caller.
Call pipeline_job_read only when the snapshot is absent or an external state change occurred.
Never pass a human gate or infer approval from conversation text.
Reuse current artifacts and the existing bound artifact URL.

Within about 5 minutes of a "waiting" notice, check the log, the file the helper owes and the media folder before saying "in progress", as social-campaign's Helpers and hand-backs describes.

Call pipeline_board_open when the binding is missing or the workspace changed.

If it returns needs_publication, invoke board-setup before presenting the resumed job.

Use board-sync for projection refresh and artifact requests.

Read the canonical nested contract for its output shape and checks.
Where it differs from this adapter, this adapter wins:
For an open gate, do not run `wait-decision.js` or `open-review.js`; re-present it with `pipeline_review_present` and the one summary line, as board-sync's "Decisions on the board and in chat" describes.
On a job that uses the board, do not ask for the verdict as a chat-only question; chat answers are still accepted and recorded with `pipeline_chat_decision`, and chat-only jobs keep their chat flow.
When several jobs could be resumed, ask which one with `pipeline_board_ask` and in chat.

When a resumed job has posts sent to Metricool, bring their status up to date first, with the steps in `skills/board-sync/references/posting.md` under "Where the posts stand": `pipeline_publish_reconcile` with only the job, then `getScheduledPosts` for the span it names, and `pipeline_publish_reconcile` again, when it says a lookup is needed.
A post with no known result is never sent again, whatever the lookup shows; only the person's answer on the board allows it.

Before asking the person anything in the chat, post the same question on the board first, publish the board, then ask in chat; a chat answer is recorded with `pipeline_board_answer`, and a board answer arrives as an `answer_question` request (`skills/board-sync/SKILL.md` has the steps).
When a job is stuck for a reason the person can fix (missing information, an approval, a clarification, an outside account), ask with `pipeline_board_ask` so the question appears on the board, and say the same one-line question in chat.
Take the answer from either place, the first one wins, and record a chat answer with `pipeline_board_answer`; `skills/board-sync/SKILL.md` has the steps under "Stuck jobs".
Never ask the person to fix a code problem: explain the failed action using the communication rules above, and retry the failed step once.
