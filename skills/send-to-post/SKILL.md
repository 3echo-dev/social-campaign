---
name: send-to-post
description: Offers a finished video to Post-production for a full edit when it is installed, sends it there on a yes, and brings the final video back. Use for a made video job once its clips are stitched, and on each board sync while it is with Post-production.
user-invocable: false
metadata:
  version: 0.1.0
---

# Send to Post-production

This is optional.
It only applies when Post-production is installed, and the job never waits on it unless the person says yes.

## Talking to the person

Use short, simple words a child could follow.
Never show file paths, tool names, ids or technical words, in chat or on the board.

## Steps

1. Call `pipeline_handoff_post_status` for the job.
   Its `next` says what to do.
   - `none`: stop here and carry on with the job as usual.
   - `offer`: ask once, on the board and in chat: "Send this to Post-production for a full edit, or finish it here?"
     Wait for the answer.
     Never ask again for the same job.
   - `wait`: it is with Post-production.
     Say nothing new, keep the line from the result on the board, and do not move the job on.
   - `offer_return`: ask once, on the board and in chat: "The edit is released. Bring the final video back?"
   - `continue`: the final video is back, so carry on below.
2. On no, call `pipeline_handoff_post_decline` and finish the video here as usual.
3. On yes, call `pipeline_handoff_post_prepare`.
   If it refuses, say why in one plain line and finish the video here.
   Otherwise run the skill it names (`startSkill`) with exactly the arguments it returns, with the Skill tool.
   Post-production's scripts live in its plugin's `post/scripts/` folder: when one of its steps names a script with no folder, or under a `scripts/` folder that does not exist, run it from `post/scripts/` and never change any Post-production file.
   Then call `pipeline_handoff_post_started` with the job id and folder that skill made, and sync the board.
   Say in one line: "It is with Post-production now. I will tell you when the edit is released."
4. While it is with Post-production, each board sync calls `pipeline_handoff_post_status` again so the board line stays current.
   Do not run the logo and label check or ask for the final approval yet.
5. When it is released and the person says yes, call `pipeline_handoff_post_return`.
   If it cannot find the final video, ask the person where it is and pass that file.
6. After the return, run the logo and label check on the new video, then ask for the final approval, exactly as for any video.
7. If the person says to stop waiting and finish it here, call `pipeline_handoff_post_decline`.

## Board buttons

The board shows the offer and the "Bring the final video back" card by itself once the status says so: write the documents after each status call, and say the same question once in chat.
A button press arrives as a board request; apply it with `pipeline_board_request_apply` as board-sync describes, then do the step it stands for:

- `handoff_send` ("Send to Post-production") is the yes in step 3.
- `handoff_decline` ("Finish it here") is the no in step 2.
- `handoff_return` ("Bring the final video back") is the yes in step 5.

A yes or no said in chat counts the same; never ask twice.

Never change anything in the Post-production folders.
Never send a video that is not finished being made.
