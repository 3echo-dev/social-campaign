---
name: make-image
description: Local adapter for the vendored make-image contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Make Image local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/make-image/SKILL.md.


The Creative Director writes the picture prompts and the manifest items that hold them, and rewrites the one prompt of a picture the person sends back.
The Director never writes a prompt; it makes the sample, then the rest, lands and checks.

Pictures are made before the storyboard is approved, once its text is written, and need no price click: 1 credit each, recorded and counted in the job total, 3 per panel at most (the first picture and two redos). A fourth picture of a panel needs a price saved with `pipeline_quote_save` and approved on the board. Video, voice and music always need a price approval.
On a picture-only post the first picture made is the sample: pick the one panel that best tests the style. It is presented for the style check on the board and in chat, the same as every other decision, and the rest is held until the person approves it. On a video post there is no sample picture: every picture is made at once and the test clip is the sample.
Run `preflight-generation.js {brand} {job-id} {D} --pictures` first: it refuses an image prompt that does not carry the job's style preamble word for word.
One style per job and one set of references: every picture opens with the same style preamble, repeats the continuity block for each recurring person, place and product, and attaches the same references (the brand's real photos under `brand/assets/references/`, the product photo, approved faces).
Once every panel has its picture, present the storyboard (`pipeline_review_present` with `gate: "storyboard"`): it shows every panel with its picture, and approving it approves the pictures. A change on a picture is a redo, made as a new version of that panel.
A redo of a picture that was mostly right is an edit, not a new picture: the earlier picture is the only reference and the prompt is the one short change line the Creative Director saved, under the next version key, with the same price rules. Only a person who rejects the whole picture gets a fresh prompt. The steps are in make-image Rule 11a.
Reuse an observed provider result when its request ID, hash, and revision still match.
Leave unknown provider outcomes unresolved and do not retry blindly.

<!-- BEGIN labelled references (0.14 task 3) -->
Every reference attached to a picture carries a short label and one phrase on what to keep.
Fill the item's `references: [{ ref, label, keep }]` in the same order as its `assetIds`, and open the prompt with the legend in that order, for example `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.`
Preflight refuses a mismatch in plain words; a job with no `references` still runs.
<!-- END labelled references -->

<!-- BEGIN brand photos -->
Attach the brand's own reference photos by default.
They are the profile assets of kind `reference`, kept under the brand's `assets/references` folder, 3 to 5 real photos of its place, people and product in use.
Put them in each picture's `assetIds` after the job's own references, as many as the picture's reference limit allows, each with a label and a `keep` phrase, for example `[Image 3] The shop front: keep the real look of the place.`
Leave them off a picture only when the person asks for that, or when the picture is of something they do not show.
When the brand has none, carry on without and add nothing to the picture.
<!-- END brand photos -->

Read the canonical nested contract for its output shape and checks.
