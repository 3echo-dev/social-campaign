---
name: make-image
description: Generates storyboard panels through 3echo tools, lands them, gets a quote and explicit yes, shows a hero in the pane, then batches the rest. Use for TO GENERATE panels or one-panel regeneration.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Make image

## Inputs

- `drafts/D{n}/generation-manifest.json`: `kind: image` items, `style`, `continuity`, `negative`, `referenceAssets`.
- `drafts/D{n}/storyboard.md`: panel table, `# Not in frame`, `# Continuity`.
- `job.json`; `approvals/storyboard-{n}.json`; `approvals/concept-{n}.json`; `workspace.json`.

## Steps

1. `preflight-generation.js {brand} {job-id} {D}`; exit 0 is the permission to quote. No product photo on a product job: `ask-product-photo.js`.
A `subject: character` job with no reference picture starts here, before the storyboard: price a small set of `kind: image` reference pictures of the character and make them.
Key each one `{job-id}-D{n}-R{k}-v1`, with the prefix R and never P, and never mark one `sample: true`; the storyboard hero keeps its own P key and its own sample.
The guard allows only these R images until the storyboard is approved, in `CHANGES_REQUESTED` too unless the storyboard was approved and not rewound, so video and voice wait.
2. Find the 3Echo tools by their base name under any prefix. `list_workspaces` for the id and balance of every workspace the account can charge, then `pipeline_studio_workspaces_save` with that list. `pipeline_studio_workspace_get` for the job's current choice; pass its `workspaceId` on every call below. With no choice and more than one workspace, the person picks once on the board's price panel, or through an Inbox question asked in chat too, as board-sync's Questions in the Inbox describes; save whichever answer arrives first with `pipeline_studio_workspace_choose`.
3. Quote `count x 1 credit` for `kind: image` items not yet landed; more than they last agreed, say so beside it.
Call `pipeline_quote_save` with one item per panel: `{ key, provider: "threeEcho", kind: "image", deliverable, panel, credits: 1 }`.
The hero panel's item also carries `sample: true`, so the plugin holds every other item until that sample is approved.
`pipeline_quote_save` adds to the existing price rather than replacing it: items already priced stay, saving the same key again re-prices an item not yet made, and an optional `drop` with those keys removes items not yet made when the person asks for changes.
Then the price gate: `pipeline_review_present` with `gate: "price"` and no files; it presents the saved quote.
4. **Wait for the price approval.** The guard refuses generation without it (`${CLAUDE_PLUGIN_ROOT}/CONFIG.md`). Then `check-3echo.js {brand} {job-id} --credits {balance}` (or `--unreachable`) and `preflight-media.js "<media-url>"` on an existing asset; exit 0 from both is the permission to generate.
5. Upload the board's reference assets with `import_asset_from_url` or the connector's own upload tool; record the ids in `manifest.referenceAssets` and each item's `assetIds`.
6. **Hero panel first:** `create_image_job` (`workspaceId`, `prompt`, `aspectRatio`, `assetIds`, `idempotencyKey` set to the job key `{job-id}-D{n}-P{id}-v1`), then `wait_for_job`. The hook lands the file and records the credit the moment a download link comes back; call `get_asset` yourself only when one did not. Publish it with `pipeline_status`, say what you saw, and present the sample for approval on the board and in chat, the same as every other decision.
End the turn: wait for yes before batching, in chat or on the board.
7. Batch the rest, same job key pattern with `v1`, same preamble, continuity and negatives. Use `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link; for an expired 3Echo link, call `get_asset` again for that item. A clip or picture whose 3Echo job failed or was cancelled made nothing and spent nothing: make it again under the same key, still `v1`, as it is still in the approved price; a new version (`v2`) is only for a redo the person asked for, and needs its own price. Then `pipeline_status` again: the whole grid goes to the person at once, and the turn ends there.
8. `python "${CLAUDE_PLUGIN_ROOT}/scripts/contact-sheet.py" "media/D{n}" --cols 4`.

A carousel is made the same way: one `kind: image` item per slide, so the quote counts one credit per slide and the one price approval covers all of them.
The hero is slide 1, and every slide repeats the same style preamble, continuity and ratio, so the set looks like one piece.
Slides land as `P1`, `P2` and so on; the post lists them in that order.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Prompt order: subject, setting, style, lighting, composition, technical; the ratio in the prompt and the parameter.
2. Prompts under 200 words.
3. Never request added text, headlines or UI screenshots; `stitch-clips.py` burns text in. The product's own label stays as photographed, never hidden.
4. Every prompt repeats `# Not in frame` verbatim.
5. Landing is the hook's job: it saves the file the moment `wait_for_job`, `get_job_result` or `get_asset` returns a download link. Never call `fetch_asset_bytes` or a byte-saving script to save an output; that path fails over 1 MB and the hook already has the file.
6. Validate every landed file: opens with Pillow, short side 200 px or more.
7. Look at every panel; say what you saw in one line each (unrequested brands, a redesigned product, a beat not shown) and land it anyway. The person judges, picks the panel and writes the note; nothing is redone on your own reading.
8. Verify what a real place or landmark looks like first.
9. UGC stills name camera physics, not quality: front phone camera, 26 mm lens, deep focus, unbalanced exposure, mild grain, awkward crop; no studio lighting, stock look, perfect skin, centred framing or grading.
10. `assetIds` takes 16 references. `aspectRatio` is one of `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9`.
11. A redo is one panel: price and approve it again exactly as a first generation, per "Redoing a picture the person sent back" in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`. Only the ids in `regenerate`, the note verbatim in its prompt, a fresh job key with `v` increased, then the grid again with the new picture in its place. Landing promotes the new version to `P{id}` and archives the old one as `P{id}-r{k}` itself; never archive, rename or move media files by hand. To go back to an earlier version, ask for it as a redo; never copy files. A redo of the sample panel carries `sample: true` on that new version's `pipeline_quote_save` entry too, the same as the first time.
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

Does not write the board, animate (`make-video`) or approve.

## Failure modes

| Failure | Fix |
|---|---|
| `preflight-media.js` exits 3 | Allowlist the host; do not generate. |
| A generation tool fails silently | `check-3echo.js`; three in a row is reachability. |
| Competitor packaging or a redesigned product | Say so; on their note, repeat `# Not in frame`, pass the pack shot. |
| An outcome that never resolves | Leave it unresolved; `pipeline_generation_land` says what is still pending. Never retry blindly. |

Numbers here carry provenance in `docs/sources/media.md`.
