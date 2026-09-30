---
name: make-video
description: Renders approved storyboard panels, QCs clips, and stitches the cut. Estimates first, gets approval, then burns on-screen text. Use for media or one-shot regeneration.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Make video

## Inputs

- `drafts/D{n}/generation-manifest.json`: its `kind: video` items and `stitch`; for a talking character deliverable also `characters` and each clip's `dialogue`.
- Approved `storyboard.md`/`script.md`, panels `media/D{n}/P{id}.png`.
- `job.json` for the deliverable's kind, `talkingCharacter`, `locale` and minimum runtime, and its `audience`; `approvals/concept-{n}.json`; `workspace.json`.

## Steps

1. `preflight-generation.js {brand} {job-id} {D}`; exit 0 permits quoting. Confirm a validated `P{id}.png` per `seedFromPanelImage` item.
2. Each clip prompt stands alone, from its panel, in the five-part order of `playbooks/video-prompting.md`: whose hand and how much arm, the shot size, one motion idea, one named camera move. Preflight refuses "same as above". On a talking character deliverable every clip that has a `dialogue` carries the line as `{Character} says: "line"` and that character's voice description verbatim (see Talking character below).
3. Find the 3Echo tools by their base name under any prefix. `list_workspaces` for the id and balance of every workspace the account can charge, then `pipeline_studio_workspaces_save` with that list. `pipeline_studio_workspace_get` for the job's current choice; pass its `workspaceId`. With no choice and more than one workspace, the person picks once on the board's price panel, or through an Inbox question asked in chat too, as board-sync's Questions in the Inbox describes; save whichever answer arrives first with `pipeline_studio_workspace_choose`. Then `check-3echo.js {brand} {job-id} --credits {balance}` (or `--unreachable`).
4. For every clip, call `estimate_video_job` with exactly the fields the create call will use: its `ratio`, `resolution`, `durationSeconds`, `generateAudio` and `assetIds`.
The hook names the saved `estimateId` in one line after the call ("Price saved as est-…"); use that id in the matching quote item.
5. Put the price beside what they last agreed, never against it, with ways to **keep** it: fewer or shorter clips, audio off, 480p (`${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`).
Call `pipeline_quote_save` with one item per clip: `{ key, provider: "threeEcho", kind: "video", deliverable, panel, credits, estimateId }`.
The hero clip's item also carries `sample: true`, so the plugin holds every other item until that sample is approved.
`pipeline_quote_save` adds to the existing price rather than replacing it: items already priced stay, saving the same key again re-prices an item not yet made, and an optional `drop` with those keys removes items not yet made when the person asks for changes.
Then the price gate: `pipeline_review_present` with `gate: "price"` and no files; it presents the saved quote.
6. **Wait for the price approval.** The guard refuses `create_video_job` without that yes and that estimate (`${CLAUDE_PLUGIN_ROOT}/CONFIG.md`). Stills instead is a change of deliverable: `change-deliverable.js`, in their words.
7. `node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight-media.js" "<media-url>"` once, on an existing asset; exit 3 stops the spend.
8. **Hero clip first:** submit the peak beat, `idempotencyKey` set to the job key `{job-id}-D{n}-S{k}-v1`, poll `wait_for_job` (`timeoutSeconds` caps at 30). The hook lands the file and records the credit the moment a download link comes back; call `get_asset` yourself only when one did not. Publish it with `pipeline_status`, say what you saw, and present the sample for approval on the board and in chat, the same as every other decision.
End the turn: the batch waits for their yes.
9. Batch the rest, same job key pattern with `v1`. Use `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link; for an expired 3Echo link, call `get_asset` again for that item.
10. ffprobe every clip: duration within 1 s, board ratio, a video stream, non-zero size. QC the **final 2 seconds** for intruders and drift.
11. `python "${CLAUDE_PLUGIN_ROOT}/scripts/stitch-clips.py" "drafts/D{n}/generation-manifest.json"` stitches `stitch.order` and burns the on-screen text; `stitch.captions` in the manifest decides, so pass no `--captions`. It names the file to read, else the deliverable's `script.md`, then `storyboard.md` is used (its Duration and Spoken / on-screen columns, panels marked Cut skipped; with no `script.md`, plain text in that cell is read as on-screen text and quoted text as speech). An empty or `none` `stitch.captions` means no captions, and a script with no on-screen text burns none and exits 0. Exit 4 means captions were wanted but none were burned: the cut is written, the reason is printed, so say so plainly and fix the source or ask.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Seed every clip with an approved panel image; text to video is a recorded fallback.
2. Provider clip duration is a whole number 4 to 15 seconds; edited beats may be shorter and are grouped by the storyboard, while a longer beat splits at a hard cut. A short total is never a reason to make stills: the floor is the deliverable's own `durationSeconds.min`.
3. `ratio` and `resolution` from the board; allowed values in `playbooks/video-prompting.md`, 720p by default.
4. `assetIds` takes 9 image, 3 video and 3 audio references at most.
5. `generateAudio` follows the manifest. The stitch keeps each clip's own audio, dialogue included, normalised per clip to -16 LUFS; it is never replaced or ducked, and a clip with no audio track gets silence. Music under the cut is a separate edit, not this step.
6. No added text inside a clip, burned in at the stitch; the product's label from the photo stays.
7. Watch every clip and say what you saw in one line: warped hands, changed framing, a redesigned product, unrequested brands. The person decides what is redone.
8. Stitching, loudness and drawtext escaping: `playbooks/video-prompting.md`, before the concat.
9. **The deliverable stays a video.** A price, a failure or a refusal is a gate, never a swap to stills, as fallback or as recommendation (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`).
10. **Regenerate one clip, never the set**, only one they sent back. Price and approve the redo on its own, then generate with a fresh job key (`v` increased), land, validate, restitch. Landing promotes the new version to `S{k}.mp4` and archives the old one as `S{k}-r{n}.mp4` itself; never archive, rename or move media files by hand. To go back to an earlier version, ask for it as a redo; never copy files. A redo of the sample clip carries `sample: true` on that new version's `pipeline_quote_save` entry too, the same as the first time.

## Talking character

A deliverable with `talkingCharacter: true` has a person or character speaking to camera. The dialogue is made inside each clip; there is no separate voiceover stage and no speech call for these lines.

1. The manifest's `characters` lists each speaker once: `id`, a `description`, and one `voice` (accent, age, tempo, manner, pacing cue) written once for the whole job.
2. Each clip with speech has `dialogue: {character, line}`, one speaker per clip. A silent beat has no `dialogue`.
3. The clip prompt carries the line as `{Character} says: "line"` and the character's `voice` pasted verbatim. Rewording it changes the voice.
4. `generateAudio` is `true` on every clip with a line. It is part of the price: `estimate_video_job` and `create_video_job` carry the same value, and audio off is a different price from audio on.
5. `preflight-generation.js` refuses a talking character manifest with no voice for a speaking character, no dialogue line, a line or voice missing from its prompt, or audio off on a clip that speaks.
6. When the person wants a voice from the library, or the job's language and accent must match, look voices up with `creative_list_voices`, passing `languages` (the language part of `deliverables[].locale`, e.g. `en` from `en-SG`, else the audience's `languages`), `accent` (only with exactly one language) and `age` (`young`, `middle_aged` or `old`, from the persona or the audience). Offer what comes back in plain words and write the chosen voice's accent, age and manner into the character's `voice`.
7. When the character is a child and voice design is blocked or refused, say that plainly in one line and offer library voices that fit the language and age instead. Never invent an adult voice for a child without asking.

## Output contract

`media/D{n}/S{k}.mp4` per clip, `S{k}-r{n}.mp4` per archived regeneration, `media/D{n}/final.mp4` when ffmpeg is present. The hooks record every paid call, its credits and its landed file, and move the job's state; nothing here updates the manifest `status` or `file`, the job state, or a credit tally by hand.

## Boundary

Does not write the script or board, generate stills, judge the render (`videographer`) or approve.

## Failure modes

| Failure | Fix |
|---|---|
| The video cannot be made | A gate: `BLOCKED`, the options, their answer. |
| Duration off by more than 1 s | Re-request; if it repeats, shorten the beat. |
| ffmpeg missing | `stitch-clips.py` exits 3: ship numbered clips, no cut. |
| Captions requested, none burned | `stitch-clips.py` exits 4 after writing the cut: say the text is missing and why, then fix the source or ask. |
| A tool fails silently | Run `check-3echo.js`. |
| An outcome that never resolves | Leave it unresolved; `pipeline_generation_land` says what is still pending. Never retry blindly. |

Numbers here carry their provenance in `docs/sources/media.md`, prices in `${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`.
