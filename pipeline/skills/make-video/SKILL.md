---
name: make-video
description: Renders approved storyboard panels, QCs clips, and stitches the cut. Estimates first, gets approval, then burns on-screen text. Use for media or one-shot regeneration.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Make video

The Creative Director writes every clip prompt, the script and the manifest items that hold them (Step 2, the Talking character lines, the Labelled references and the Hook clip headroom below say what goes in them).
The Director prices, makes the sample, makes the rest, lands, stitches, finishes and checks; the Director never writes or rewrites a prompt.

## Inputs

- `drafts/D{n}/generation-manifest.json`: its `kind: video` items and `stitch`; for a talking character deliverable also `characters` and each clip's `dialogue`.
- Approved `storyboard.md`/`script.md`, panels `media/D{n}/P{id}.png`.
- `job.json` for the deliverable's kind, `talkingCharacter`, `locale` and minimum runtime, and its `audience`; `approvals/concept-{n}.json`; `workspace.json`.

## Steps

1. `preflight-generation.js {brand} {job-id} {D}`; exit 0 permits quoting. Confirm a validated `P{id}.png` per `seedFromPanelImage` item.
2. The Creative Director has written each clip prompt; it stands alone, from its panel, in the five-part order of `playbooks/video-prompting.md`: whose hand and how much arm, the shot size, one motion idea, one named camera move. Preflight refuses "same as above". On a talking character deliverable every clip that has a `dialogue` carries the line as `{Character} says: "line"` and that character's voice description verbatim (see Talking character below).
3. Find the 3Echo tools by their base name under any prefix. `list_workspaces` for the id and balance of every workspace the account can charge, then `pipeline_studio_workspaces_save` with that list. `pipeline_studio_workspace_get` for the job's current choice; pass its `workspaceId`. With no choice and more than one workspace, the person picks once on the board's price panel, or through an Inbox question asked in chat too, as board-sync's Questions in the Inbox describes; save whichever answer arrives first with `pipeline_studio_workspace_choose`. Then `check-3echo.js {brand} {job-id} --credits {balance}` (or `--unreachable`).
4. For every clip, call `estimate_video_job` with exactly the fields the create call will use: its `ratio`, `resolution`, `durationSeconds`, `generateAudio` and `assetIds`.
A clip that starts from its storyboard picture has no picture to attach yet at pricing time: once that picture is made, call `estimate_video_job` again with its `assetIds`, right before `create_video_job`, because the guard checks the estimate for that exact call. When it costs no more than the approved item, the approval stands; when it costs more, the guard refuses and the new price needs the person's yes.
The hook names the saved `estimateId` in one line after the call ("Price saved as est-…"); use that id in the matching quote item.
5. Put the price beside what they last agreed, never against it, with ways to **keep** it: fewer or shorter clips, audio off, 480p (`${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`).
Call `pipeline_quote_save` with one item per clip: `{ key, provider: "threeEcho", kind: "video", deliverable, panel, credits, estimateId }`.
The hero clip's item also carries `sample: true`, so the plugin holds every other item until that sample is approved. When the clips start from the storyboard pictures, the hero picture is the sample instead and no clip is: one sample per post.
`pipeline_quote_save` adds to the existing price rather than replacing it: items already priced stay, saving the same key again re-prices an item not yet made, and an optional `drop` with those keys removes items not yet made when the person asks for changes.
Then the price gate: `pipeline_review_present` with `gate: "price"` and no files; it presents the saved quote.
6. **Wait for the price approval.** The guard refuses `create_video_job` without that yes and that estimate (`${CLAUDE_PLUGIN_ROOT}/CONFIG.md`). Stills instead is a change of deliverable: `change-deliverable.js`, in their words.
7. `node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight-media.js" "<media-url>"` once, on an existing asset; exit 3 stops the spend.
8. **Hero clip first:** submit the peak beat, `idempotencyKey` set to the job key `{job-id}-D{n}-S{k}-v1`, poll `wait_for_job` (`timeoutSeconds` caps at 30). The hook lands the file and records the credit the moment a download link comes back; call `get_asset` yourself only when one did not. Publish it with `pipeline_status`, say what you saw, and present the sample for approval on the board and in chat, the same as every other decision.
End the turn: the batch waits for their yes.
9. Batch the rest, same job key pattern with `v1`. Use `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link; for an expired 3Echo link, call `get_asset` again for that item. A picture or clip whose 3Echo job failed or was cancelled made nothing and spent nothing. Never make it again under the same key (3Echo hands back the same failed job) and never price a new version of it yourself. Tell the person at once, on the board with `pipeline_board_ask` (options "Try again" and "Leave it out") so it shows on the Director card, and in chat, in one plain line such as "Clip 4 did not come out because 3Echo had a problem. It cost nothing. Try it again?". On "Try again", call `pipeline_generation_retry` with that item and the answer as `confirmedBy`: it swaps in the next version under the price already approved, so make that key next (pricing a seeded clip again first). On "Leave it out", carry on without it and say what changes.
10. ffprobe every clip: duration within 1 s of the manifest's `durationSeconds` (for the hook clip that is its `headroom.askSec`, not the beat), board ratio, a video stream, non-zero size. QC the **final 2 seconds** for intruders and drift.
11. Only after the person has approved all the clips (the clips review): `python "${CLAUDE_PLUGIN_ROOT}/scripts/stitch-clips.py" "drafts/D{n}/generation-manifest.json"` stitches `stitch.order` and burns the on-screen text; `stitch.captions` in the manifest decides, so pass no `--captions`. It names the file to read, else the deliverable's `script.md`, then `storyboard.md` is used (its Duration and Spoken / on-screen columns, panels marked Cut skipped; with no `script.md`, plain text in that cell is read as on-screen text and quoted text as speech). An empty or `none` `stitch.captions` means no captions, and a script with no on-screen text burns none and exits 0. Exit 4 means captions were wanted but none were burned: the cut is written, the reason is printed, so say so plainly and fix the source or ask.
12. Right after the stitch and before the logo and label check, finish the video: `python "${CLAUDE_PLUGIN_ROOT}/scripts/finish-video.py" "drafts/D{n}/generation-manifest.json"`. It keeps the stitched cut as `final-raw.mp4`, then writes the finished `final.mp4` with captions for the spoken lines, the job's music from `media/music/choice.json` (quieter under speech, skipped when it is `none` or the file is missing), a logo and call to action over the last 2 seconds, and the loudness set to -14 LUFS. The stitch's burned on-screen text stays. Anything it has no input for is skipped, so exit 0 with no captions or no music is normal. Exit 2 means there was no stitched cut to finish; exit 3 means ffmpeg or Pillow is missing; exit 5 means finishing failed. On exit 3 or 5 the plain cut stays as `final.mp4`: say in one line that the video went out without its finishing, and carry on to the logo and label check.

## Formats and flags (so nobody reads the scripts)

- Manifest trims, per video item: `trimToSeconds` keeps only the first N seconds of the clip; the hook clip's `headroom: { askSec, inSec, useSec }` seeks `inSec` and keeps `useSec`. To keep a spoken word from being clipped, lengthen `trimToSeconds` (or `useSec`) of that clip and shorten a neighbour's by the same amount so the total length stays the same. Only the producer edits the manifest.
- `stitch-clips.py <manifest> [--out <file>]`; `stitch.captions` in the manifest decides the burned text, so pass no `--captions`.
- `finish-video.py <manifest> [--out <file>] [--music <choice.json>] [--post <post.md>]` and, for a test version, `--variant <id> --hook "<text>" --cta "<text>"`. Exit 2 no cut, 3 ffmpeg or Pillow missing, 5 finishing failed.
- The end card shows the logo and the post's `cta` (else the last caption line that is not the AI disclosure) only. The AI disclosure is never burned in: it stays in the caption and the platform AI label. A line too long for the card is left off, never shortened.
- A re-cut after a trim redoes only the stitch, the finish and the checks of what changed (length, the trimmed clip's frames and speech). It is not a new review of the whole job.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Seed every clip with an approved panel image; text to video is a recorded fallback.
2. Provider clip duration is a whole number 4 to 15 seconds; edited beats may be shorter and are grouped by the storyboard, while a longer beat splits at a hard cut. A short total is never a reason to make stills: the floor is the deliverable's own `durationSeconds.min`.
3. `ratio` and `resolution` from the board; allowed values in `playbooks/video-prompting.md`, 720p by default.
4. `assetIds` takes 9 image, 3 video and 3 audio references at most.
5. `generateAudio` follows the manifest. The stitch keeps each clip's own audio, dialogue included, normalised per clip to -16 LUFS; it is never replaced, and a clip with no audio track gets silence. Music and captions for spoken lines are added after it by `finish-video.py` (step 12), which also ducks the music under speech.
6. No added text inside a clip, burned in at the stitch; the product's label from the photo stays.
7. Watch every clip and say what you saw in one line: warped hands, changed framing, a redesigned product, unrequested brands. The person decides what is redone.
8. Stitching, loudness and drawtext escaping: `playbooks/video-prompting.md`, before the concat.
9. **The deliverable stays a video.** A price, a failure or a refusal is a gate, never a swap to stills, as fallback or as recommendation (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`).
10. **Regenerate one clip, never the set**, only one they sent back. The Director spawns the Creative Director once with the person's note and that clip, which rewrites that one prompt in the manifest. Then price and approve the redo on its own, then generate with a fresh job key (`v` increased), land, validate, restitch. Landing promotes the new version to `S{k}.mp4` and archives the old one as `S{k}-r{n}.mp4` itself; never archive, rename or move media files by hand. To go back to an earlier version, ask for it as a redo; never copy files. A redo of the sample clip carries `sample: true` on that new version's `pipeline_quote_save` entry too, the same as the first time.

## Talking character

A deliverable with `talkingCharacter: true` has a person or character speaking to camera. The dialogue is made inside each clip; there is no separate voiceover stage and no speech call for these lines.

1. The manifest's `characters` lists each speaker once: `id`, a `description`, and one `voice` (accent, age, tempo, manner, pacing cue) written once for the whole job.
2. Each clip with speech has `dialogue: {character, line}`, one speaker per clip. A silent beat has no `dialogue`.
3. The clip prompt carries the line as `{Character} says: "line"` and the character's `voice` pasted verbatim. Rewording it changes the voice.
4. `generateAudio` is `true` on every clip with a line. It is part of the price: `estimate_video_job` and `create_video_job` carry the same value, and audio off is a different price from audio on.
5. `preflight-generation.js` refuses a talking character manifest with no voice for a speaking character, no dialogue line, a line or voice missing from its prompt, or audio off on a clip that speaks.
6. When the person wants a voice from the library, or the job's language and accent must match, look voices up with `creative_list_voices`, passing `languages` (the language part of `deliverables[].locale`, e.g. `en` from `en-SG`, else the audience's `languages`), `accent` (only with exactly one language) and `age` (`young`, `middle_aged` or `old`, from the persona or the audience). Offer what comes back in plain words and write the chosen voice's accent, age and manner into the character's `voice`.
7. When the character is a child and voice design is blocked or refused, say that plainly in one line and offer library voices that fit the language and age instead. Never invent an adult voice for a child without asking.

## Music

Before the video is finished, settle its music. If the finishing choice offers the person music, their pick wins; otherwise do not wait on it.
After the finish, say what the video really has: when `media/music/choice.json` says `none`, say "no music" plainly. Never say music was added unless the choice names a file.

1. If the person gave a music file in chat, call `pipeline_music_add` with `brand`, `jobId` and the file's path.
2. Otherwise call `pipeline_music_list`. Pick the track whose title fits the script's mood and call `pipeline_music_choose` with its id and one short reason. When the shelf is empty, call it with `none`.

<!-- BEGIN labelled references (0.14 task 3) -->
## Labelled references

Every reference attached to a clip carries a short label and what to keep, and the prompt opens with a legend of them in attachment order.

1. The clip item's `references` has one `{ ref, label, keep }` per entry of its `assetIds`, in the same order, the panel image that seeds the clip included.
2. `label` is short: the product, the persona or mascot name, or the location. `keep` is one phrase ("the exact box and logo").
3. The legend is the very first thing in the prompt, before the five parts, one line per attachment: `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.` Number pictures `[Image n]`, clips `[Video n]` and sound `[Audio n]`, each counted in its own kind and in attachment order. The nine-picture cap counts the legend lines too.
4. `preflight-generation.js` refuses a clip whose `references` do not match its `assetIds` (a different count, a missing label, or a different order). An old job with no `references` still runs.
<!-- END labelled references -->

<!-- BEGIN clip headroom (0.14 task 2) -->
## Hook clip headroom

The first clip in `stitch.order`, the hook, is generated one second longer than its beat, because the first frames of a generated clip are often weak.
The stitch then starts half a second in and keeps only the beat's length.
Only that clip gets this; every other clip is asked for exactly its beat.

1. On the hook clip's video item, set `headroom: { askSec, inSec, useSec }`: `askSec` is the beat length plus 1 s, rounded up to a whole number, never under 4 or over 15; `inSec` is `0.5`; `useSec` is the beat length (at most `askSec - 0.5`).
2. Set that item's `durationSeconds` to `askSec` too. The estimate, the price saved in `pipeline_quote_save`, the guard and `create_video_job` all use `durationSeconds`, so the person is quoted for the clip that is really made, extra second included.
3. The ffprobe length check (step 10) compares each clip against its `durationSeconds`, so the hook clip is checked against `askSec`.
4. `stitch-clips.py` reads `headroom` itself (seek `inSec`, keep `useSec`); do not trim by hand. The on-screen text timing still follows the script's beat lengths, which is `useSec`.
5. Say it to the person in plain words only if they ask why the first clip costs a bit more: "the opening clip is made one second longer so the first frames can be cut away".
<!-- END clip headroom -->

<!-- BEGIN social check and test versions (0.14 task 4) -->
## Social check and test versions

Run these right after `finish-video.py` (step 12), before the logo and label check. Neither one blocks the job.

1. Social check: `python "${CLAUDE_PLUGIN_ROOT}/scripts/social-check.py" "drafts/D{n}/generation-manifest.json"`. It writes `validation/social-check.json` with four plain lines: a hook in the first 2 seconds (words or speech), captions inside the platform's safe zone, a call to action (the last beat or the end card), and a length inside the platform's band. A line is a pass or a heads-up. Show the heads-ups to the person in one plain sentence each at the final approval, where the board lists them with the other checks, and never redo the video because of one unless they ask.
2. Test versions: read `drafts/D{n}/post.md` for a `## Variants` section (the copywriter writes it for a video post). For each line `v2 | hook: <text> | cta: <text>`, run `python "${CLAUDE_PLUGIN_ROOT}/scripts/finish-video.py" "drafts/D{n}/generation-manifest.json" --variant v2 --hook "<text>" --cta "<text>"`. Each writes `media/D{n}/final-v2.mp4` from the same raw cut and leaves `final.mp4` alone. A variant that fails is skipped with one plain line; the main video is never held for it. No `## Variants` section means no test versions.
3. The final approval shows the test versions under the post as "Test versions", and the posting kit lists them with the line "Test versions for ads or A/B tests". The posting plan still posts the main video only.
<!-- END social check and test versions -->

<!-- begin: voice-over lines and finishing options (finish-video.py) -->
## Voice-over lines

Only when the script has voice-over lines and nobody speaks on camera (no `talkingCharacter`, no clip `dialogue`).
A clip that speaks keeps its own speech; never add a voice-over on top of it.

1. Each voice-over line belongs to one beat, counted from 1 in `stitch.order`. Give it a quote key `{jobId}-D{n}-VO{k}-v1` (VO, never R or TR).
2. Pick one voice for the whole job: `creative_list_voices` with the job's language, accent and age as in Talking character step 6, offered in plain words. The person's own choice wins.
3. Price every line like any other voice line: `creative_generate_speech` with `estimate_only: true`, `generations_count: 1` and the job's context tag, then one `pipeline_quote_save` item per line (provider `elevenLabs`, kind `voice`, the captured `estimateId`) before the price approval. Spend nothing before the person approves the price; the spend guard blocks it otherwise.
4. After the approval, make each line with `creative_generate_speech` (same voice, same text, the key as the context tag) and keep the file as `media/D{n}/vo/B{k}.mp3`.
5. List the files in the manifest's top-level `voiceover`: `[{ "beat": k, "file": "media/D{n}/vo/B{k}.mp3", "text": "<the words spoken>" }]`. `finish-video.py` places each file at its beat's start, ducks the music under it, and shows the text as captions with the spoken word in gold. A listed file that is missing is skipped with one plain line, so say so and offer to make it again.
6. Finish after the stitch as in step 12. The finished video is the main one; test versions (`finish-video.py <manifest> --variant <id> --hook "<text>" --cta "<text>"`) write `media/D{n}/final-<id>.mp4` from the same `final-raw.mp4` and never touch `final.mp4`. The hook is drawn as a solid box over the area where the stitch burned the first beat's text for the first 2 seconds, so make a test version only after the main one is finished.
<!-- end: voice-over lines and finishing options -->

## Output contract

`media/D{n}/S{k}.mp4` per clip, `S{k}-r{n}.mp4` per archived regeneration, `media/D{n}/final.mp4` when ffmpeg is present. The hooks record every paid call, its credits and its landed file, and move the job's state; nothing here updates the manifest `status` or `file`, the job state, or a credit tally by hand.

## Boundary

Does not write the script, the board or the prompts (the Creative Director does), generate stills, judge the render (`videographer`) or approve.

## Failure modes

| Failure | Fix |
|---|---|
| The video cannot be made | A gate: `BLOCKED`, the options, their answer. |
| Duration off by more than 1 s | Re-request; if it repeats, shorten the beat. |
| ffmpeg missing | `stitch-clips.py` exits 3: ship numbered clips, no cut. |
| Captions requested, none burned | `stitch-clips.py` exits 4 after writing the cut: say the text is missing and why, then fix the source or ask. |
| `stitch-clips.py` exits 6 | The person has not approved all the clips yet: present the clips review and wait. |
| `finish-video.py` exits 2 | No stitched cut was there to finish: run the stitch first. |
| `finish-video.py` exits 3 or 5 | ffmpeg or Pillow is missing (3), or the finishing failed (5). The plain cut stays as `final.mp4` and `final-raw.mp4` is the same cut: say the video has no captions, music or end card, then go on to the checks; fix the cause (an unreadable music file is the usual one) and run it again if the person wants it. |
| A tool fails silently | Run `check-3echo.js`. |
| An outcome that never resolves | Leave it unresolved; `pipeline_generation_land` says what is still pending. Never retry blindly. |

Numbers here carry their provenance in `docs/sources/media.md`, prices in `${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`.
