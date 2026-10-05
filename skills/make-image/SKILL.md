---
name: make-image
description: Local adapter for the vendored make-image contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Make Image local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/make-image/SKILL.md.


Run only after the active plan and current spending decision authorize the request.
`pipeline_quote_save` adds to the existing price rather than replacing it; an optional `drop` removes an item not yet made when the person asks for changes.
The hero panel's item carries `sample: true`.
Its landed sample is presented for approval on the board and in chat, the same as every other decision, and the rest is held until the person answers.
Reuse an observed provider result when its request ID, hash, and revision still match.
Leave unknown provider outcomes unresolved and do not retry blindly.

<!-- BEGIN labelled references (0.14 task 3) -->
Every reference attached to a picture carries a short label and one phrase on what to keep.
Fill the item's `references: [{ ref, label, keep }]` in the same order as its `assetIds`, and open the prompt with the legend in that order, for example `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.`
Preflight refuses a mismatch in plain words; a job with no `references` still runs.
<!-- END labelled references -->

Read the canonical nested contract for its output shape and checks.
