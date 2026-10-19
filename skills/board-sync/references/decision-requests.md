# Applying decisions

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

A `submit_decision` request from the board is the person's approval already, the same as any other board request: apply it immediately with `pipeline_decision_apply`, requestId and confirmedBy set to the board request, and no chat confirmation of the verdict.
The reply carries `documents` and `next`: write the returned documents to the board, then do `next`.
Pass `maxCredits` equal to the request's `args.credits`, the credits the board showed, when approving a concept.
A price approval carries its own `args.totals`, already matching the saved quote, and needs no `maxCredits`.
A concept pick arrives as `args.chosen` with the concept letter, and a request for changes carries the person's comment in `args.note`.
A concept pick's `args.note` can also carry the person's Strategy gate choices: a `Strategy picks:` line (industry, funnel stage, ad style, format, CTA, problem, angle, subtopic, editing, visual hook) and `Your own ...` lines for options they added (a problem or angle they add is saved to their brand library by the plugin).
Pass the note on unchanged and never edit or drop those lines: applying the decision saves the person's own options to the brand library, and the agents read the picks from the approval note, where they replace the concept's own fields.
The tool validates the exact registered file set, hashes, current gate, and revision before applying the decision.
Every decision card shows what it is about and its version, such as `Storyboard, version 3`: presenting the same files again keeps the version, and presenting changed files raises it.
`confirmedBy` is a local audit label and does not authenticate a Studio user.
When the job revision or the registered files no longer match, because the quote or the files changed since the person clicked on an older version of the card, the apply fails with the line `This changed, here is the latest`.
Decline that request with `pipeline_board_request_decline`, `reason` set to that exact line and `handled` left out, then merge the returned `artifactReceipt` into the request's board document: the board shows the line as it is and loads the latest card.
Then say so in chat in one line and re-present the current decision on the board if it is not already there, rather than asking in chat for approval.
If the tool reports `needs_reconciliation` instead, inspect the local request and approval record before taking any further action.
Use `pipeline_request_reconcile` only after establishing the actual outcome from local records.
Record `applied` when the effect is present, or `retry` when the effect did not apply, and include the evidence and confirmer.
Reconciliation changes only the request receipt; a retry still revalidates the job gate, revision, and exact hashes.

When only one job is waiting, apply the answer to that job.
An answer in chat is recorded with `pipeline_chat_decision`.
It works only for a review already presented with `pipeline_review_present` and shown to the person, and it writes the same approval a board click does.
Pass `brand`, `jobId`, `gate` (the review being answered), `decision` set to `approve` or `changes`, the person's words in `note`, and `confirmedBy` set to their own words or their name.
The reply carries `documents` and `next`: write the returned documents to the board (no `pipeline_status` call is needed), then do `next`.
Pictures, clips, cut and storyboard also take `panels`, one `{panel, deliverable?, verdict, note}` per panel; leave `panels` out to answer all of them.
A concept approval needs `maxCredits` equal to the credits the concept showed, plus `chosen` (the concept letter) and `recipe` (the copy picks) as the board would send them.
An approval of the cut may carry `finishing` or `combine`, and a final post approval may carry `acceptedFlagIds`.
If the call says the review was already answered, say so in one line and carry on; if it refuses because the review was not presented or its files changed after the person saw them, present it again and ask again.
This is for every gate it takes except the money and posting ones (see Money and posting need a click in `skills/board-sync/SKILL.md`), and for any request for changes.
The report (gate `findings`) and the paid campaign plan and going live are not gates it takes: for those, land a `submit_decision` with `pipeline_board_request_land`, `from` set to `chat`, and the workspace's `workspaceId`, using the `brand`, `jobId`, `revision` and `artifacts` from the `pipeline_review_present` result, `reviewId` set to its `gate`, a new `requestId`, `decision` set to `approve` or `request_changes` and the person's words in `note`, then apply it with `pipeline_decision_apply` and `confirmedBy` set to `chat`.
Write the documents again so the board no longer shows the decision.
Then tell the person in one plain line naming the job's brand and title what happened, for example 'SK-II "Anna Sawai serum Reel": concept B approved.'
