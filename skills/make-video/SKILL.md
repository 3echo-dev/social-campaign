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
The hero clip's item carries `sample: true`, unless the clips start from the storyboard pictures: then the hero picture is the sample, as make-image says, and no clip is, because the clips need their pictures first.
Only one item per post is ever the sample.
Its landed sample is presented for approval on the board and in chat, the same as every other decision, and the rest is held until the person answers.
Reuse an observed provider result when its request ID, hash, and revision still match.
Leave unknown provider outcomes unresolved and do not retry blindly.

## Before the clips are made

- Every reference attached to a clip carries a short label and one phrase on what to keep.
  Fill the item's `references: [{ ref, label, keep }]` in the same order as its `assetIds`, and make the legend the very first thing in the prompt, for example `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.`
  Preflight refuses a mismatch in plain words; a job with no `references` still runs.
- The hook clip, the first in `stitch.order`, is asked for its beat length plus 1 s (whole seconds, 4 to 15) and its item carries `headroom: { askSec, inSec: 0.5, useSec }`.
  Set its `durationSeconds` to `askSec` so the estimate, the saved price and the create call all use the extra second; the length check compares that clip against `askSec`.
- When the script has voice-over lines and nobody speaks on camera, price each voice-over line like any other voice line, with `creative_generate_speech` and `estimate_only: true`, in the same price the person approves; spend nothing before that yes.
  A clip that already speaks on camera never gets a voice-over on top.

## After the clips are made, in this order

1. Voice-over: make each priced line and save it as `media/D{n}/vo/B{k}.mp3`, listed in the manifest's top-level `voiceover` as `{ beat, file, text }` (the nested contract's "Voice-over lines" section).
2. Music, settled without asking or waiting: a music file the person gave in chat goes to `pipeline_music_add`; otherwise choose the shelf track that fits the script's mood with `pipeline_music_choose` (see `pipeline_music_list`), or `none` when the shelf is empty.
3. Stitch, as the nested contract describes; the hook clip skips its first half second and keeps the beat length.
4. Finish: run `finish-video.py` on the manifest (the nested contract's step 12).
   It adds captions with the spoken word in gold, places the voice-over, mixes the music under speech, adds the end card and sets the final loudness, keeping the plain cut as `final-raw.mp4`.
   Exit 2 means there was no cut, exit 3 means ffmpeg or Pillow is missing, exit 5 means finishing failed; on 3 or 5 the plain cut stays as the final video: say so in one line and carry on.
5. Social check: run `social-check.py` on the manifest; it writes `validation/social-check.json`, four plain lines the board shows with the other checks at the final approval, and never blocks.
6. Test versions: render each `## Variants` line of the post's `post.md` with `finish-video.py --variant <id> --hook "<text>" --cta "<text>"`, which writes `media/D{n}/final-<id>.mp4`.
7. Post-production, once per job: follow `skills/send-to-post/SKILL.md`; when Post-production is installed it is offered as an option, and the job waits there only when the person says yes.
8. Then the logo and label check and the final approval, as usual.

Read the canonical nested contract for its output shape and checks.
