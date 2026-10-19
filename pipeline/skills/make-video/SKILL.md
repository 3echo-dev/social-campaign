---
name: make-video
description: Renders approved storyboard panels, QCs clips, and stitches the cut. Estimates first, gets approval, then leaves the on-screen text to finish-video.py, which draws it once. Use for media or one-shot regeneration.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Make video

The Creative Director writes every clip prompt, the script and the manifest items that hold them (Step 2, the Talking character lines, the Labelled references and the Hook clip headroom below say what goes in them).
The Director prices, makes the test clip, makes the rest, lands, signs the clips off, stitches, finishes and checks; the Director never writes or rewrites a prompt.

## Inputs

- `drafts/D{n}/generation-manifest.json`: its `kind: video` items and `stitch`; for a talking character deliverable also `characters` and each clip's `dialogue`.
- Approved `storyboard.md`/`script.md`, panels `media/D{n}/P{id}.png`.
- `job.json` for the deliverable's kind, `talkingCharacter`, `locale` and minimum runtime, and its `audience`; `approvals/concept-{n}.json`; `workspace.json`.

## Steps

1. Estimate and price (steps 3 to 5) before the storyboard is approved; do not run preflight yet, it needs the approved storyboard. Once the storyboard is approved, and before the first `create_video_job`, run `preflight-generation.js {brand} {job-id} {D}`; exit 0 permits making the clips. Confirm a validated `P{id}.png` per `seedFromPanelImage` item.
2. The Creative Director has written each clip prompt; it stands alone, from its panel, in the five-part order of `playbooks/video-prompting.md`: whose hand and how much arm, the shot size, one motion idea, one named camera move. Preflight refuses "same as above". On a talking character deliverable every clip that has a `dialogue` carries the line as `{Character} says: "line"` and that character's voice description verbatim (see Talking character below).
3. Find the 3Echo tools by their base name under any prefix. `list_workspaces` for the id and balance of every workspace the account can charge, then `pipeline_studio_workspaces_save` with that list. `pipeline_studio_workspace_get` for the job's current choice; pass its `workspaceId`. With no choice and more than one workspace, the person picks once in the price block of the storyboard card, or through an Inbox question asked in chat too, as board-sync's Questions in the Inbox describes; save whichever answer arrives first with `pipeline_studio_workspace_choose`. Then `check-3echo.js {brand} {job-id} --credits {balance}` (or `--unreachable`).
4. For every clip, call `estimate_video_job` with exactly the fields the create call will use: its `ratio`, `resolution`, `durationSeconds`, `generateAudio` and `assetIds`.
A clip that starts from its storyboard picture is estimated with that picture's `assetIds` (the pictures are made before the storyboard is shown); call `estimate_video_job` again right before `create_video_job`, because the guard checks the estimate for that exact call. The approval stands only when the shape (ratio), length, resolution and sound match the approved price and the call costs no more than the approved item; a change to any of those, or a higher cost, is refused by the guard and the new price needs the person's yes. The picture ids may differ.
The hook names the saved `estimateId` in one line after the call ("Price saved as est-…"); use that id in the matching quote item.
5. Put the price beside what they last agreed, never against it, with ways to **keep** it: fewer or shorter clips, audio off (`${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`). Do not offer 480p for final clips: finals are 720p or better.
Show every video price at 720p and at 1080p side by side (estimate each; 1080p costs about three times as much), so the person can choose. 720p is the default for finals. Never carry a sample's lower resolution into the final clips.
Call `pipeline_quote_save` before the storyboard is shown, with one item per clip: `{ key, provider: "threeEcho", kind: "video", deliverable, panel, credits, estimateId }`, plus one item per voice-over line and any music to be made (Voice-over lines and Music and voice-over below), so the storyboard card carries the whole price.
If the person deliberately picks a final resolution below 720p, add `lowResolutionAccepted: true` to those items; only their own explicit choice sets it, never you. Without it the quote is refused.
The hero clip's item always carries `sample: true` on a video post: it is the test clip, and the plugin holds every other clip until it is approved. The pictures on a video post carry no sample and are made all at once.
`pipeline_quote_save` adds to the existing price rather than replacing it: items already priced stay, saving the same key again re-prices an item not yet made, and an optional `drop` with those keys removes items not yet made when the person asks for changes.
Then present the storyboard (`pipeline_review_present` with `gate: "storyboard"`): its card shows this saved price and its redo line, and the person's one tap approves the pictures and the price together. There is no separate price stop. A later price (a redo beyond the allowance, a new shot) is its own card: `pipeline_review_present` with `gate: "price"` and no files.
6. **Wait for the storyboard approval.** The guard refuses `create_video_job` without that yes and that estimate (`${CLAUDE_PLUGIN_ROOT}/CONFIG.md`). Stills instead is a change of deliverable: `change-deliverable.js`, in their words.
7. `node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight-media.js" "<media-url>"` once, on an existing asset; exit 3 stops the spend.
8. **Hero clip first:** this is the test clip. Submit the peak beat, `idempotencyKey` set to the job key `{job-id}-D{n}-S{k}-v1`, poll `wait_for_job` (`timeoutSeconds` caps at 30). The hook lands the file and records the credit the moment a download link comes back; call `get_asset` yourself only when one did not. Publish it with `pipeline_status`, say what you saw, and present the test clip (the sample) for approval on the board and in chat, the same as every other decision.
End the turn: the batch waits for their yes.
A yes typed in chat is recorded with `pipeline_chat_decision` (gate `sample`, the person's words as `confirmedBy`) after the sample was presented with `pipeline_review_present`; without it the guard keeps holding the rest.
9. Batch the rest, same job key pattern with `v1`.
   Use `pipeline_generation_land` to see what has landed, what is pending and what failed, and to retry an unexpired link; for an expired 3Echo link, call `get_asset` again for that item.
   A picture or clip whose 3Echo job failed or was cancelled made nothing and spent nothing.
   Never make it again under the same key (3Echo hands back the same failed job) and never price a new version of it yourself.
   Tell the person at once, on the board with `pipeline_board_ask` (options "Try again" and "Leave it out"), and in chat, in one plain line such as "Clip 4 did not come out because 3Echo had a problem. It cost nothing. Try it again?".
   On "Try again", call `pipeline_generation_retry` with that item and the answer as `confirmedBy`: it swaps in the next version under the price already approved, so make that key next (pricing a seeded clip again first).
   On "Leave it out", carry on without it and say what changes.
10. ffprobe every clip: duration within 1 s of the manifest's `durationSeconds` (for the hook clip that is its `headroom.askSec`, not the beat), board ratio, a video stream, non-zero size. QC the **final 2 seconds** for intruders and drift.
    When every priced clip is made and landed and the test clip is approved, call `pipeline_clips_signoff` with the brand and job ID, then write the `documents` it returns and do its `next`. It refuses in plain words until that holds. Do not present a clips review: the plugin signs the clips off, and a person's own clips approval still counts.
11. Only after the clips are signed off: `python "${CLAUDE_PLUGIN_ROOT}/scripts/stitch-clips.py" "drafts/D{n}/generation-manifest.json"` stitches `stitch.order` into a plain cut with no text on it, and saves the on-screen text for finishing as `media/D{n}/onscreen.json`; `stitch.captions` in the manifest decides, so pass no `--captions`. It names the file to read, else the deliverable's `script.md`, then `storyboard.md` is used (its Duration and Spoken / on-screen columns, panels marked Cut skipped; with no `script.md`, plain text in that cell is read as on-screen text and quoted text as speech). An empty or `none` `stitch.captions` means no on-screen text, and a script with no on-screen text saves none and exits 0. Exit 4 means on-screen text was wanted but none could be saved: the cut is written (it is plain either way), the reason is printed, so say so plainly and fix the source or ask. To place a line or keep it off a face or logo, add `position` (`top`, `middle`) to its item in `onscreen.json`, or a top-level `avoid` list of `{x, y, w, h}` frame fractions.
12. Join, finish, then the rough cut. The stitch is a plain join and also writes `media/D{n}/final-raw.mp4`; nothing is added yet. First make what the price already covers: each priced voice-over line and any music (Voice-over lines and Music and voice-over below); several voice takes are shown side by side on a board question and the pick is recorded with `pipeline_combine_set`. The sound plan (music, voice-over, captions) was recorded with `pipeline_finishing_choice` before the storyboard; only when none is recorded, ask ONE question with `pipeline_board_ask` and record it. Never say the video has music or a voice-over unless it was added. For captions, get the spoken words first with `media_transcribe` on `media/D{n}/final-raw.mp4`. Then finish: `python "${CLAUDE_PLUGIN_ROOT}/scripts/finish-video.py" "drafts/D{n}/generation-manifest.json"`. It draws the post's on-screen text from `media/D{n}/onscreen.json` and, when chosen, the captions (from the transcript of the joined video, else the script wording, labelled as such), both bold white on a dark box inside the safe area, plus the chosen voice-over from `media/voice/choice.json` (one recording over the whole video) and the job's music from `media/music/choice.json` (ducked under the voice or speech), then the end card and the loudness set to -14 LUFS; "Skip" adds only the on-screen text. It writes `final-finished.sha256` and `finish-report.json` (where the caption words came from). The finished video is the rough cut: the Director presents it (`pipeline_review_present` with `gate: "cut"`, review copies as for any video) and waits for Approve or Ask for changes with a note. There is no separate finished-video review. Exit 6 means the clips are not signed off or no sound plan is recorded: do those first. Exit 7 means music or a voice-over was chosen and none is saved. Exit 2 means there was no stitched cut to finish; exit 3 means ffmpeg or Pillow is missing; exit 5 means finishing failed. On exit 3 or 5 the plain cut stays as `final.mp4`: say in one line that the video went out without its finishing, and carry on to the logo and label check.
   A change on the rough cut: a note that only asks for different captions or music records the new choice with `pipeline_finishing_choice` and finishes again (making new music or voice is priced first). A note about a clip goes to the Creative Director, who rewrites that one prompt; make the redo (Rule 10), call `pipeline_clips_signoff` again, join, finish and show the rough cut again.

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
3. `ratio` and `resolution` from the board; allowed values in `playbooks/video-prompting.md`, 720p by default for every final clip; only a sample clip may be lower.
4. `assetIds` takes 9 image, 3 video and 3 audio references at most.
5. `generateAudio` follows the manifest. The stitch keeps each clip's own audio, dialogue included, normalised per clip to -16 LUFS; it is never replaced, and a clip with no audio track gets silence. Music and captions for spoken lines are added after it by `finish-video.py` (step 12), which also ducks the music under speech.
6. No added text inside a clip. Every clip prompt ends with "No on-screen text, no captions, no subtitles, no watermark." (text a model draws cannot be removed and would show twice); the text is drawn once by `finish-video.py`, always from the plain `final-raw.mp4`, never from its own output. The product's label from the photo stays.
7. Watch every clip and say what you saw in one line: warped hands, changed framing, a redesigned product, unrequested brands. The person decides what is redone.
8. Stitching, loudness and drawtext escaping: `playbooks/video-prompting.md`, before the concat.
9. **The deliverable stays a video.** A price, a failure or a refusal is a gate, never a swap to stills, as fallback or as recommendation (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`).
10. **Regenerate one clip, never the set**, only one they sent back. The Director spawns the Creative Director once with the person's note and that clip, which rewrites that one prompt in the manifest. Then generate it with a fresh job key (`v` increased), land, validate, sign the clips off again, restitch and finish again. A redo inside the allowance (two per clip, up to the extra credits the price shows) needs no new price tap; beyond it, save the new version with `pipeline_quote_save` and wait for the price approval first. Landing promotes the new version to `S{k}.mp4` and archives the old one as `S{k}-r{n}.mp4` itself; never archive, rename or move media files by hand. To go back to an earlier version, ask for it as a redo; never copy files. A redo of the sample clip carries `sample: true` on that new version's `pipeline_quote_save` entry too, the same as the first time.

## Talking character

A deliverable with `talkingCharacter: true` has a person or character speaking to camera. The dialogue is made inside each clip; there is no separate voiceover stage and no speech call for these lines.

1. The manifest's `characters` lists each speaker once: `id`, a `description`, and one `voice` (accent, age, tempo, manner, pacing cue) written once for the whole job.
2. Each clip with speech has `dialogue: {character, line}`, one speaking person per clip (a second named cast member may appear when the brief's cast list says so). A silent beat has no `dialogue`.
3. The clip prompt carries the line as `{Character} says: "line"` and the character's `voice` pasted verbatim. Rewording it changes the voice.
4. `generateAudio` is `true` on every clip with a line. It is part of the price: `estimate_video_job` and `create_video_job` carry the same value, and audio off is a different price from audio on.
5. `preflight-generation.js` refuses a talking character manifest with no voice for a speaking character, no dialogue line, a line or voice missing from its prompt, or audio off on a clip that speaks.
6. When the person wants a voice from the library, or the job's language and accent must match, look voices up with `creative_list_voices`, passing `languages` (the language part of `deliverables[].locale`, e.g. `en` from `en-SG`, else the audience's `languages`), `accent` (only with exactly one language) and `age` (`young`, `middle_aged` or `old`, from the persona or the audience). Offer what comes back in plain words and write the chosen voice's accent, age and manner into the character's `voice`.
7. When the character is a child and voice design is blocked or refused, say that plainly in one line and offer library voices that fit the language and age instead. Never invent an adult voice for a child without asking.

## Music and voice-over

Music and voice-over are settled before the storyboard, as part of the sound plan: voice-over yes or no and which voice, music (a library track, the person's own file, made with ElevenLabs, or none) and captions. The Director records it with `pipeline_finishing_choice` (`combine`) before presenting the storyboard. The person's pick wins; never wait on it otherwise. Everything goes in the workspace library (one shelf for every brand, each item tagged with a brand and keeping its licence note): `pipeline_library_list` shows it, `pipeline_music_add` / `pipeline_library_add` add a file the person gave, and `pipeline_music_choose` picks a track. Making music is the one ElevenLabs route: price it with `creative_generate_in_flow` (`node_type: "music"`, an `eleven_music` model, `estimate_only: true`), save a `music` price item with `pipeline_quote_save` before the storyboard is shown, make it once after the storyboard tap, then `pipeline_combine_takes`. Voice-over made with ElevenLabs is priced and made the same way (`creative_generate_speech`, kind `voice`). Never synthesise audio by hand.
After the finish, say what the video really has: when `media/music/choice.json` or `media/voice/choice.json` says `none`, say "no music" or "no voice-over" plainly. Never say either was added unless the choice names a file.

<!-- BEGIN labelled references (0.14 task 3) -->
## Labelled references

Reference videos the person pasted as links are saved by `pipeline_reference_from_url` in `inputs/references/video/<id>/` and listed in `inputs/references/manifest.json`. Use their pacing, framing and hook as direction in the prompt text. The downloaded file is reference only: never stitch it into the cut or post it.

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
3. Price every line like any other voice line: `creative_generate_speech` with `estimate_only: true`, `generations_count: 1` and the job's context tag, then one `pipeline_quote_save` item per line (provider `elevenLabs`, kind `voice`, the captured `estimateId`) before the storyboard is shown. Spend nothing before the person approves the storyboard and its price; the spend guard blocks it otherwise.
4. After the approval, make each line with `creative_generate_speech` (same voice, same text, and `context: "job:<the item key>"`, for example `job:{job-id}-D1-VO1-v1`) and keep the file as `media/D{n}/vo/B{k}.mp3`.
5. List the files in the manifest's top-level `voiceover`: `[{ "beat": k, "file": "media/D{n}/vo/B{k}.mp3", "text": "<the words spoken>" }]`. `finish-video.py` places each file at its beat's start, ducks the music under it, and shows the text as captions with the spoken word in gold. A listed file that is missing is skipped with one plain line, so say so and offer to make it again.
6. Finish after the stitch as in step 12. The finished video is the main one; test versions (`finish-video.py <manifest> --variant <id> --hook "<text>" --cta "<text>"`) write `media/D{n}/final-<id>.mp4` from the same `final-raw.mp4` and never touch `final.mp4`. The hook is drawn as its own label in the on-screen text slot for the first 2 seconds (the first beat's own text starts after it), so make a test version only after the main one is finished.
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
| On-screen text requested, none saved | `stitch-clips.py` exits 4 after writing the plain cut: say the text is missing and why, then fix the source or ask. |
| `stitch-clips.py` exits 6 | The clips are not signed off yet: once every clip is made and the test clip is approved, call `pipeline_clips_signoff`. |
| `finish-video.py` exits 2 | No stitched cut was there to finish: run the stitch first. |
| `finish-video.py` exits 3 or 5 | ffmpeg or Pillow is missing (3), or the finishing failed (5). The plain cut stays as `final.mp4` and `final-raw.mp4` is the same cut: say the video has no captions, music or end card, then go on to the checks; fix the cause (an unreadable music file is the usual one) and run it again if the person wants it. |
| A tool fails silently | Run `check-3echo.js`. |
| An outcome that never resolves | Leave it unresolved; `pipeline_generation_land` says what is still pending. Never retry blindly. |

Numbers here carry their provenance in `docs/sources/media.md`, prices in `${CLAUDE_PLUGIN_ROOT}/docs/PRICING.md`.
