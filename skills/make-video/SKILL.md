---
name: make-video
description: Local adapter for the vendored make-video contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Make Video local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/make-video/SKILL.md.


The Creative Director writes the clip prompts, the script and the manifest items that hold them (labels, legend and hook clip headroom included), and rewrites the one prompt of a clip the person sends back.
The Director never writes a prompt; it prices, makes the sample, makes the rest, lands, stitches, finishes and checks.

Run only after the active plan and current spending decision authorize the request.
`pipeline_quote_save` adds to the existing price rather than replacing it; an optional `drop` removes an item not yet made when the person asks for changes.
The hero clip's item carries `sample: true`, unless the clips start from the storyboard pictures: then the hero picture was the sample, made and approved before the storyboard (as make-image says), and no clip is, because the clips need their pictures first.
Only one item per post is ever the sample.
Its landed sample is presented for approval on the board and in chat, the same as every other decision, and the rest is held until the person answers.
When the clips start from the storyboard pictures, the approved panel pictures are the start pictures: the person saw every one in the storyboard review, and approving the storyboard approved them, so there is no second pictures review. A picture redone after that opens the pictures review again (`gate: "pictures"`) and no clip is made until it is approved; every clip is shown together once they are all made (`gate: "clips"`) before anything is joined. See Pictures and clips in the board-sync skill. A change on a clip is a redo: price it as a new version and get the extra cost approved before making it. Video, voice and music always need a price approval.
Reuse an observed provider result when its request ID, hash, and revision still match.
Leave unknown provider outcomes unresolved and do not retry blindly.

## Before the clips are made

- A reference video the person pasted as a link is already saved by `pipeline_reference_from_url` under `inputs/references/video/<id>/` (see the manifest). Use it to match pacing, framing and hook style, and describe what to borrow in the clip prompts. Never cut, re-upload or ship the downloaded file itself; it is reference only.

- Every reference attached to a clip carries a short label and one phrase on what to keep.
  Fill the item's `references: [{ ref, label, keep }]` in the same order as its `assetIds`, and make the legend the very first thing in the prompt, for example `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.`
  Preflight refuses a mismatch in plain words; a job with no `references` still runs.
- The hook clip, the first in `stitch.order`, is asked for its beat length plus 1 s (whole seconds, 4 to 15) and its item carries `headroom: { askSec, inSec: 0.5, useSec }`.
  Set its `durationSeconds` to `askSec` so the estimate, the saved price and the create call all use the extra second; the length check compares that clip against `askSec`.
- When the script has voice-over lines and nobody speaks on camera, price each voice-over line like any other voice line, with `creative_generate_speech` and `estimate_only: true`, in the same price the person approves; spend nothing before that yes.
  A clip that already speaks on camera never gets a voice-over on top.

## After the clips are made, in this order

1. Voice-over: make each priced line and save it as `media/D{n}/vo/B{k}.mp3`, listed in the manifest's top-level `voiceover` as `{ beat, file, text }` (the nested contract's "Voice-over lines" section).
2. Music is settled on the combine card at the joined video (step 5), not before: a track the person gave goes to the library (`pipeline_music_add` or `pipeline_library_add`); music made with ElevenLabs is the only way to make one, priced first and clicked by the person. Report "no music" plainly when the choice is `none`.
3. Clips review: present all the clips (`gate: "clips"`) and wait for the person to approve them all. `stitch-clips.py` exits 6 before that. A change on a clip is a redo, priced again as a new version before it is made.
4. Stitch, as the nested contract describes; the hook clip skips its first half second and keeps the beat length. The stitch is a plain join with no text on it and also writes `media/D{n}/final-raw.mp4`; the script's on-screen text is saved as `media/D{n}/onscreen.json` for finishing. Nothing is added to the cut yet.
5. Joined video review: present it (`pipeline_review_present` with `gate: "cut"`, review copies as for the clips) and wait. Only the Director presents it. It carries the combine card, three rows each with its own choice: Music (library, upload, make with ElevenLabs, none), Voice-over (library, upload, make with ElevenLabs from the script, none; defaulted from the storyboard's `voice_over`) and Captions (voice-over words, script words, none). `pipeline_decision_apply` approves the cut and records the picks in one step. A change note that only asks for captions or music is read the same way, not as a redo. A note that asks for a real edit goes back to the clips or the trim: a trim needs no new clip, a redo of a clip is a new version priced again (`pipeline_quote_save`, price approval, spend guard) before it is made, and then the clips review and the join come again.
6. Rows left to do come back in the reply of `pipeline_decision_apply` (`next`). Upload: `pipeline_board_ask` with `wantsUpload` audio, then `pipeline_combine_set` (source `upload`, path). Make with ElevenLabs: price it (`creative_generate_speech` or, for music, `creative_generate_in_flow` with `node_type: "music"`, both with `estimate_only: true`), save the item (`pipeline_quote_save`, kind `voice` or `music`), wait for the price click, make it once, then `pipeline_combine_takes`: several voice takes are shown side by side on the board for the person to pick (the answer is a take label, recorded with `pipeline_combine_set`). Only when the cut was approved some other way (in chat) ask ONE question and record it with `pipeline_finishing_choice` (`combine`, or captions, music, both, skip). Never make audio by hand, and never say the video has music or a voice-over unless one was added.
7. Finish: for captions, first get the spoken words (`media_transcribe` on `media/D{n}/final-raw.mp4`, see its answer). Then run `finish-video.py` on the manifest (the nested contract's step 12). It draws the post's on-screen text and the captions in one style, mixes the chosen voice-over and the music bed (ducked under the voice), then the end card and the final loudness. Captions come from the transcript; without one they come from the script wording and the run says so ("not checked against the speech"): tell the person. "Skip" adds nothing except the on-screen text, if the script has any. `final-raw.mp4` stays the plain cut. Then present the finished video (`pipeline_review_present` with `gate: "finish"`) and wait; a change asked there reruns finishing only.
   Exit 6 means the joined video is not approved or the choice is not recorded: do those first, never work around it. Exit 7 means music was chosen and no track is saved. Exit 2 means there was no cut, exit 3 means ffmpeg or Pillow is missing, exit 5 means finishing failed; on 3 or 5 the plain cut stays as the final video: say so in one line and carry on.
8. Social check: run `social-check.py` on the manifest; it writes `validation/social-check.json`, four plain lines the board shows with the other checks at the final approval, and never blocks.
9. Test versions: render each `## Variants` line of the post's `post.md` with `finish-video.py --variant <id> --hook "<text>" --cta "<text>"`, which writes `media/D{n}/final-<id>.mp4`.
10. Post-production, once per job: follow `skills/send-to-post/SKILL.md`; when Post-production is installed it is offered as an option, and the job waits there only when the person says yes.
11. Then the logo and label check and the final approval, as usual.

Read the canonical nested contract for its output shape and checks.
