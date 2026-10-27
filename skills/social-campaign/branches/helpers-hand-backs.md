# Helpers and hand-backs

Read by `skills/social-campaign/SKILL.md`. Each section is applied exactly as written here.

## Helpers and hand-backs

When you hand a routed job to the producer, tell it in one line that every helper it starts runs with `run_in_background: false` and that it answers only when the step is done.
The producer may still hand back "not finished", or the host may report a helper as launched. That means the work is still going, not that it failed.

1. Never decide that a step "did not land" from a short look at the job folder. A helper takes 5 to 15 minutes, and a file that is not there after seconds says nothing.
2. Before you resume the producer, start any helper again or say that something stopped, Read `agents.jsonl` in the job folder. A `started` line for a helper with no later `stopped`, `finished` or `failed` line for it means it is still working: wait for its hand-back, which arrives by itself, and do not send the producer a message that says the work did not land.
A run started more than 2 hours ago with no end line is stale: do not assume it is still working or that it stopped. Reconcile first (call `pipeline_agent_brief` for that agent and read `waiting`, and check whether the file it owes exists), and only then start it again once, and say so.
Within about 5 minutes of any "waiting" or "launched" notice, do not wait for the 2 hours: Read `agents.jsonl`, look for the file the helper owes, and look in the job's media folder for new pictures or clips.
Say "in progress" to the person only when the log shows an open helper or the folder shows a new file since the notice; when neither does, never repeat "in progress": reconcile as above and tell the producer to carry on from the files (item 3).
3. Never start a second producer. If the producer handed back without its work and no helper is open in `agents.jsonl`, continue the same producer once with a plain instruction to carry on from the files, and tell it to start only the helper that is missing.
4. Tell the person only what the log and the files show. Say "the first try stopped" or "I restarted it" only when `agents.jsonl` has a `failed` or `stopped` line for that helper and a second one really was started. A helper that was merely slow was not restarted, and the message says it is still working.
5. When the producer's hand-back says the brief and the ideas disagree ("BRIEF AND IDEAS DISAGREE"), or that a helper was run twice, say it in the chat message that opens the concept pick, in one plain line: for example "The plan behind these ideas was rewritten once, so it differs a little from them in the angle. The script follows the idea you pick." Do not leave it out because it is awkward.
6. A question whose answer can change the ideas (real screens or an invented example, which helpers to show, whether a promise is real) is asked before the ideas are written, as a `pipeline_board_ask` question with `blocking: true` and the recommended answer first. The ideas wait for the answer: nothing is started on a default, "go" on another card does not answer it, and the concept pick is never opened while a blocking question of yours is open (the server refuses). Questions that only matter for the script or the pictures are held until the idea is picked, then asked at the script step without `blocking`.
The producer posts the board question with `pipeline_board_ask` and names it in its hand-back; the main session (the Director's chat) says the same one line in chat and records a chat answer with `pipeline_board_answer`, and never posts a second card for a question the producer already posted.
