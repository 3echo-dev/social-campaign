---
name: make-image
description: Generates the storyboard pictures through 3echo tools before the storyboard is approved, one sample first and then the rest, with no price click. Use for TO GENERATE panels or one-panel regeneration.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Make image

The Creative Director writes every picture prompt and the manifest items that hold them (Rules 1 to 4 and 9, and the Labelled references below, say how).
The Director makes the sample, then the rest, lands and checks; the Director never writes or rewrites a prompt.

## Inputs

- `drafts/D{n}/generation-manifest.json`: `kind: image` items, `style`, `continuity`, `negative`, `referenceAssets`.
- `drafts/D{n}/storyboard.md`: panel table, `# Not in frame`, `# Continuity`.
- `job.json`; `approvals/concept-{n}.json`; `workspace.json`; the brand's real photos under `brand/assets/references/` and the product photo.

## Steps

Pictures are made while the storyboard is still a draft: the storyboard text is written first, then these steps, then the storyboard is presented with a picture on every panel.
Pictures cost 1 credit each and need no price approval. Every one is still recorded and counted in the job's credit total, and the price card lists what pictures have used. The guard allows 3 pictures per panel (the first and two redos); a fourth needs a normal price approval. Video, voice and music always need one.

1. `preflight-generation.js {brand} {job-id} {D} --pictures`; exit 0 is the permission to start. It checks the manifest and that every image prompt carries the style preamble word for word. No product photo on a product job: `ask-product-photo.js`.
A `subject: character` job with no reference picture makes a small set of reference pictures of the character first, each keyed `{job-id}-D{n}-R{k}-v1`, with the prefix R and never P.
2. Find the 3Echo tools by their base name under any prefix. `list_workspaces` for the id and balance of every workspace the account can charge, then `pipeline_studio_workspaces_save` with that list. `pipeline_studio_workspace_get` for the job's current choice; pass its `workspaceId` on every call below. With no choice and more than one workspace, the person picks once on the board's price panel, or through an Inbox question asked in chat too, as board-sync's Questions in the Inbox describes; save whichever answer arrives first with `pipeline_studio_workspace_choose`.
3. Upload the references with `import_asset_from_url` or the connector's own upload tool and record the ids in `manifest.referenceAssets` and each item's `assetIds`. Every picture attaches the same references: the brand's real photos under `brand/assets/references/` if there are any (attached to every picture by default; leave them off only when the person asks), the product photo, and any approved faces.
4. `preflight-media.js "<media-url>"` on an existing asset; exit 0 is the permission to generate.
5. **Sample first.** Pick the one panel that best tests the style (the peak beat, or the one with the person, the place and the product together). `create_image_job` (`workspaceId`, `prompt`, `aspectRatio`, `assetIds`, `idempotencyKey` set to the job key `{job-id}-D{n}-P{id}-v1`), then `wait_for_job`. The hook lands the file and records the credit the moment a download link comes back; call `get_asset` yourself only when one did not. The first storyboard picture made is the sample: the guard holds every other panel until the person approves it.
Write the documents (`pipeline_status`) so the board shows the sample, say what you saw, and ask for the style check on the board and in chat the same as every other decision (`waitingOn` is `sample image`).
End the turn: wait for yes before making the rest, in chat or on the board. After a request for changes, redo the sample first (a new version of the same panel).
6. **The rest.** After the sample is approved, make a picture for every other panel that needs one, same job key pattern with `v1`, same preamble, continuity, references and negatives. Use `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link; for an expired 3Echo link, call `get_asset` again for that item. A picture whose 3Echo job failed or was cancelled made nothing and spent nothing. Never make it again under the same key (3Echo hands back the same failed job). Tell the person at once, on the board with `pipeline_board_ask` (options "Try again" and "Leave it out") so it shows on the Director card, and in chat, in one plain line such as "Picture 4 did not come out because 3Echo had a problem. It cost nothing. Try it again?". On "Try again", call `pipeline_generation_retry` with that item and the answer as `confirmedBy`. On "Leave it out", carry on without it and say what changes.
7. `python "${CLAUDE_PLUGIN_ROOT}/scripts/contact-sheet.py" "media/D{n}" --cols 4`.
8. Present the storyboard (`pipeline_review_present`, gate `storyboard`). It lists every panel with its picture, and is refused while a panel that needs a picture has none or the voice-over question is unanswered. Approving it approves those pictures as the start pictures for the clips, so there is no second pictures review.

A carousel is made the same way: one picture per slide, 1 credit each.
The sample is the slide that best tests the style, and every slide repeats the same style preamble, continuity and ratio, so the set looks like one piece.
Slides land as `P1`, `P2` and so on; the post lists them in that order.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Prompt order: the reference legend, the style preamble, the continuity block, then subject, setting, lighting, composition, technical; the ratio in the prompt and the parameter.
2. Prompts under 200 words.
3. Never request added text, headlines or UI screenshots; `finish-video.py` draws the text once, after the join. End the prompt with "No text, no captions, no watermark." The product's own label stays as photographed, never hidden.
4. Every prompt repeats `# Not in frame` verbatim.
4a. One style per job: every prompt opens with the manifest `style` preamble word for word (after the reference legend), then the continuity block for each recurring person, place and product that appears in it (3 to 6 attributes each), pasted verbatim. Never reword the preamble for one panel.
5. Landing is the hook's job: it saves the file the moment `wait_for_job`, `get_job_result` or `get_asset` returns a download link. Never call `fetch_asset_bytes` or a byte-saving script to save an output; that path fails over 1 MB and the hook already has the file.
6. Validate every landed file: opens with Pillow, short side 200 px or more.
7. Look at every panel; say what you saw in one line each (unrequested brands, a redesigned product, a beat not shown) and land it anyway. The person judges, picks the panel and writes the note; nothing is redone on your own reading.
8. Verify what a real place or landmark looks like first.
9. UGC stills name camera physics, not quality: front phone camera, 26 mm lens, deep focus, unbalanced exposure, mild grain, awkward crop; no studio lighting, stock look, perfect skin, centred framing or grading.
10. `assetIds` takes 16 references. `aspectRatio` is one of `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9`.
11. A redo is one panel: the Director spawns the Creative Director once with the person's note and that panel, which rewrites that one prompt in the manifest. The redo is a fresh job key with `v` increased and needs no price approval: it is the panel's second or third picture. Only the ids in `regenerate`, the note verbatim in its prompt (the Creative Director puts it there), then the storyboard again with the new picture in its place. Landing promotes the new version to `P{id}` and archives the old one as `P{id}-r{k}` itself; never archive, rename or move media files by hand. To go back to an earlier version, ask for it as a redo; never copy files. A panel's fourth picture is refused until a price for it is saved (`pipeline_quote_save`, the new key) and approved on the board.
12. Cutting a panel returns to the storyboard gate. Stills for a video job is a change of deliverable: `change-deliverable.js`, in their words.

<!-- BEGIN labelled references (0.14 task 3) -->
## Labelled references

Every reference attached to an image job carries a short label and what to keep, and the prompt opens with a legend of them in attachment order.

1. The manifest item's `references` has one `{ ref, label, keep }` per entry of its `assetIds`, in the same order; `ref` is that asset id.
2. `label` is short: the product, the persona or mascot name, or the location ("Mealbox box", "Mina", "Mina's kitchen"). `keep` is one phrase ("the exact box and logo", "her face and black bob").
3. The prompt starts with the legend, one line per attachment, numbered the way the model counts them, before the subject: `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.` A character reference picture `R{k}` is labelled with the character's name.
4. Upload in that order and record the ids in `assetIds` in that order, so the legend and the attachments cannot drift apart.
5. `preflight-generation.js` refuses an item whose `references` do not match its `assetIds` (a different count, a missing label, or a different order). An old job with no `references` still runs.
<!-- END labelled references -->

## Output contract

`media/D{n}/P{id}.png` per panel, `P{id}-r{k}.png` per archived regeneration, `media/D{n}/contact-sheet.png` rebuilt on every change. The hooks record every paid call, its credits and its landed file, and move the job's state; nothing here updates the manifest `status` or `file`, the job state, or a credit tally by hand.

## Boundary

Does not write the board or the prompts (the Creative Director does), animate (`make-video`) or approve.
Does not price or ask for a click for pictures within 3 per panel.

## Failure modes

| Failure | Fix |
|---|---|
| `preflight-media.js` exits 3 | Allowlist the host; do not generate. |
| A generation tool fails silently | `check-3echo.js`; three in a row is reachability. |
| Competitor packaging or a redesigned product | Say so; on their note, repeat `# Not in frame`, pass the pack shot. |
| An outcome that never resolves | Leave it unresolved; `pipeline_generation_land` says what is still pending. Never retry blindly. |

Numbers here carry provenance in `docs/sources/media.md`.
