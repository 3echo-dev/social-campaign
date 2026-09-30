---
name: make-video
description: Local adapter for the vendored make-video contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Make Video local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/make-video/SKILL.md.


Run only after the active plan and current spending decision authorize the request.
`pipeline_quote_save` adds to the existing price rather than replacing it; an optional `drop` removes an item not yet made when the person asks for changes.
The hero clip's item carries `sample: true`.
Its landed sample is presented for approval on the board and in chat, the same as every other decision, and the rest is held until the person answers.
Reuse an observed provider result when its request ID, hash, and revision still match.
Leave unknown provider outcomes unresolved and do not retry blindly.

Read the canonical nested contract for its output shape and checks.
