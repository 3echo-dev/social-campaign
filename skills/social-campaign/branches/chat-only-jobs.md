# Chat-only jobs

Read by `skills/social-campaign/SKILL.md`. Each section is applied exactly as written here.

When the person asks to work in chat without the board, set `chatOnly: true` on the job (in `job` when creating it, or in the intake patch later).
Present each step and every approval in chat, with pictures and videos as files, and take the approvals from chat.
First present the review with `pipeline_review_present` as usual, show its files in chat, then record the person's answer with `pipeline_chat_decision`.
Pass the gate you presented, approve or changes, and the person's own words as `confirmedBy`.
It writes the same approval the board would, so the spend guard, the price and the later steps work as on the board.
It refuses an answer to a review that was not presented, or whose files changed after the person saw them; present it again and ask again.
On a job that uses the board, the price, the sample and the posting plan still need the person's tap on the board.
Making the storyboard pictures (the sample first, up to 3 per panel) needs no question and no price: tell the producer to make the sample once the shot plan is written, and never write "no spend without approval" in a brief in a way that covers those pictures.
Never open or publish the board for that job.
