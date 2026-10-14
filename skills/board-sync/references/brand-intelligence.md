# Brand intelligence requests

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.


Onboarding builds each brand's intelligence (section 4e of `skills/onboard-brand/SKILL.md`): the posts it took apart and labelled, the six subtopics, the formats that work and a 6 by 5 plan.
The board draws it from `brand.intelligence` in the workspace projection, so publish the workspace projection after every change to it: the checklist while the pass runs, the subtopic draft, the confirmed subtopics, the plan.
Two requests come from that panel.

A `subtopics_confirm` request is the person answering "Do these 6 subtopics look right?" (its args are `brand` and `items`: exactly six `{ id?, name }`; a subtopic that was kept carries its `id`, one the person added has none).
It is their answer and it is already approved: land it and apply it immediately with `pipeline_board_request_apply`, `confirmedBy` set to the board request, with no chat confirmation and without changing a name.
The apply saves the six as the brand's subtopics, keeps the evidence of the ones that stay, and marks the plan stale when a subtopic changed.
Then publish the workspace projection, and when the receipt says the plan needs ideas for the new subtopics, follow "When the subtopics change" in section 4e of `skills/onboard-brand/SKILL.md`.
If the apply refuses it (not exactly six, a name twice), say the refusal's plain line, decline the request with `pipeline_board_request_decline` and that line as the reason, and publish the workspace projection.
The same answer typed in chat is applied with `brand_intelligence_save` (action `subtopics_confirm`).

A `plan_cell_start` request is the person clicking a cell of the 6 by 5 plan to start a post (its args are `brand`, `subtopic`, the subtopic's id, and `format`, a format library id, as they are in `plan.cells`).
It is a new job request like `create_job`, already approved: land it and apply it immediately with `pipeline_board_request_apply`.
The apply creates an organic post job whose `job.json` carries the pick (an `intelligence` block with the subtopic, the format, the cell's idea, angle and hook, and the brand's best examples of that format) and whose topic is the cell's idea, then queues the job's `continue_job` request, which you handle next like any new job: intake, then the strategist, with the subtopic and the format already chosen (`agents/producer.md`).
Then publish the workspace projection so the job shows.
If the apply refuses it (the brand is not ready for jobs, the subtopic or the format is not the brand's), say the plain line, decline the request with `pipeline_board_request_decline` and that line as the reason.

The Strategy gate offers the brand's subtopics, the format library's story structures, editing styles and visual hooks as rows to click, with "+ Add your own".
The person's choices arrive in the concept pick's `args.note` as `Subtopic: "..."`, `Format: "..."`, `Editing: "..."` and `Visual hook: "..."` in the `Strategy picks:` line, with `Your own subtopic|editing|visual hook: "..."` lines for options they added; pass the note on unchanged like the rest of it, and the plugin saves their own options to the brand library when the decision is applied.
