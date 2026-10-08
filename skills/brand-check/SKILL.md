---
name: brand-check
description: Local adapter for the vendored brand-check contract, plus the label and brand-mark check that reads every image and video, including footage supplied as a reference, before the final approval. Posts made from the person's own finished files skip it.
user-invocable: false
metadata:
  version: 0.3.0
---

# Brand Check local adapter

## Label and brand-mark check

This check runs before the final approval on every job that has an image or video, including footage the person supplied as a reference.
It cannot be skipped, with one exception: a publish_post job (the person's own finished pictures or video, posted as they are) has no label check.
Its files were made and approved by the person, the board does not ask for the check on its final-post card, and the final approval is refused or accepted on the checks that card shows instead.
Never run this check on a publish_post job: it would flag every word printed in the person's own picture.
The final approval is refused until a current check covers every image and video being approved, contact sheets included, and every item it found is fixed or accepted by the person.
Run it once all the images and video for the final approval are in place, and again whenever one of them changes.
Follow these steps exactly and never read plugin code while doing them.

1. Call `pipeline_qc_frames` with `brand` and `jobId`.
   It already takes every image and video registered for the pending review, including a contact sheet, so leave `paths` out unless you will show an image or video at the final approval that is not registered for the review yet.
2. Open every returned frame `path` with Read, one at a time, and skip none; every slide of a carousel is one frame and gets the same reading as any other picture.
3. For each frame, write down what it shows:
   - `text`: every word printed on the product, its pack or label, and every caption or overlay on screen.
     Copy it letter by letter exactly as printed, in the order shown.
     Never correct the spelling and never fill in a word from what it should say.
     A word you can only partly make out is written the way it looks.
   - `marks`: every logo or brand mark, by the name it shows, for example `SK-II`.
   - `scene`: any other writing in the scene, such as street signs, shop fronts or screens.
   - `notes`: anything else that looks wrong, such as a warped, cut-off or blurred label.
   A frame with no writing still gets a reading with empty `text` and `marks` lists.
4. Call `pipeline_qc_save` with `brand`, `jobId` and one reading per `frameId`.
   If it lists frames with no reading, open those frames and call it again with every reading.
   If it says a file changed, start again from step 1.
5. When the result has no flags, say nothing about the check.
6. For each flag, tell the person in one plain line what the frame shows and where, then ask what to do in the board's Needs you and in chat together, as board-sync's Questions on the board describes, with the options "Keep it" and "Swap the shot".
   For example: "The pack in 0:04 reads 'TRTATMENT'. Keep it, or swap the shot?"
   Name the image instead of a time for a still.
7. Take whichever answer arrives first: "Keep it", chosen on the board or in chat, or "Accept as is" clicked directly on the board, is the acceptance of that item.
   A "Swap the shot" answer, or anything else they say, means fix or swap the file, then run this check again from step 1.
8. Never mention frames, flags, scores, file paths or tool names to the person.

## Voice check

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/brand-check/SKILL.md.
Also read "Words and claims we never use" in `brand/brand-voice.md` (the profile's `forbiddenClaims`) as claims the draft must not make, and report any use of one as a finding.
Use this adapter only when the active route and task contract name this skill.
Reuse the current job snapshot, input revision, accepted artifact hashes, and capability results.
Call pipeline_job_read only when no fresh snapshot is supplied or an external state change occurred.
Write only the output paths named by the active plan.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
Return the output paths, reused evidence, blockers, and next action.
