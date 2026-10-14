# Applying decisions

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

A `submit_decision` request from the board is the person's approval already, the same as any other board request: apply it immediately with `pipeline_decision_apply`, requestId and confirmedBy set to the board request, and no chat confirmation of the verdict.
Pass `maxCredits` equal to the request's `args.credits`, the credits the board showed, when approving a concept.
A price approval carries its own `args.totals`, already matching the saved quote, and needs no `maxCredits`.
A concept pick arrives as `args.chosen` with the concept letter, and a request for changes carries the person's comment in `args.note`.
A concept pick's `args.note` can also carry the person's Strategy gate choices: a `Strategy picks:` line (industry, funnel stage, ad style, format, CTA, problem, angle, subtopic, editing, visual hook) and `Your own ...` lines for options they added (a problem or angle they add is saved to their brand library by the plugin).
Pass the note on unchanged and never edit or drop those lines: applying the decision saves the person's own options to the brand library, and the agents read the picks from the approval note, where they replace the concept's own fields.
The tool validates the exact registered file set, hashes, current gate, and revision before applying the decision.
`confirmedBy` is a local audit label and does not authenticate a Studio user.
When the job revision or the registered files no longer match, because the quote or the files changed since the person clicked, the apply fails: say so in chat in one line and re-present the current decision on the board, rather than asking in chat for approval.
If the tool reports `needs_reconciliation` instead, inspect the local request and approval record before taking any further action.
Use `pipeline_request_reconcile` only after establishing the actual outcome from local records.
Record `applied` when the effect is present, or `retry` when the effect did not apply, and include the evidence and confirmer.
Reconciliation changes only the request receipt; a retry still revalidates the job gate, revision, and exact hashes.

When only one job is waiting, apply the answer to that job.
An answer in chat is applied with the same tools: land a `submit_decision` with `pipeline_board_request_land` and the workspace's `workspaceId`, using the `brand`, `jobId`, `revision` and `artifacts` from the `pipeline_review_present` result, `reviewId` set to its `gate`, a new `requestId`, `decision` set to `approve` or `request_changes`, the person's words in `note`, `chosen` for a concept letter, `credits` for a concept approval, and `totals` matching the saved quote for a price approval.
Then apply it with `pipeline_decision_apply`, `confirmedBy` set to `chat`, and `maxCredits` equal to those `credits` for a concept approval.
This is for the concept, the storyboard, the pictures, the clips, the cut, the final post and the report, and for any request for changes. Money and posting approvals are not landed from chat (see below).
Write the documents again so the board no longer shows the decision.
Then tell the person in one plain line naming the job's brand and title what happened, for example 'SK-II "Anna Sawai serum Reel": concept B approved.'
