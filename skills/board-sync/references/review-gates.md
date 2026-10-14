# Review gates and media

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

### Storyboard panels

The board shows every panel of the storyboard in one strip, and the person approves or changes each panel in turn.
The panel verdicts arrive together in one `submit_decision` as `args.panels`, a list of `{panel, verdict, note}` where `verdict` is `approve` or `changes`, and a `deliverable` such as `D1` when the job has more than one storyboard.
Apply it with `pipeline_decision_apply` like any other decision; each panel with `changes` carries what the person wants in its `note`.
A storyboard answer given in chat is landed the same way: put each panel the person named in `panels`, and put anything they said about the whole storyboard in `note`.
An approval with `panels` must approve every panel; if the person approved only some, land it as `request_changes` with the panels they want changed.

### Sample image

Once the sample image has been saved and before the rest of the batch is made, the job's `pipeline_status` line shows `waitingOn` set to `sample image`, and the board asks for it.
Write the documents as soon as the sample lands so the board shows it.
Post one chat line naming the job's brand and title with the same decision, for example 'SK-II "Anna Sawai serum Reel": the sample is ready, approve it here or on the board, or say what to change.'
A board answer arrives as a `submit_decision` with `reviewId` `sample`: apply it with `pipeline_decision_apply` right away.
When the person types an approval in chat instead, do not land it: tell them to tap Approve on the sample card (see Money and posting need a click above).
A request for changes typed in chat is landed as a `submit_decision` with `reviewId` `sample`, `decision` `request_changes`, the `revision` and `artifacts` from calling `pipeline_review_present` with `gate: "sample"`, and the person's words in `note`.
Then apply it with `pipeline_decision_apply` and `confirmedBy` `chat`, and tell the person in one plain line naming the job's brand and title what happened.
The applied decision is saved as the job's `approvals/sample.json`; make the rest of the batch only after an approval, and after a request for changes redo the sample first.

### Pictures and clips

The sample is not the only look the person gets. Two more reviews sit between it and the final post, each shown on the board as a grid with one card per panel (the picture or a player, and the storyboard's words for it), a per-card "Ask for changes" with a note, and "Approve all" under the grid. Only the Director presents them; a helper never does.

1. **Pictures** (`gate` `pictures`): the storyboard review already shows every panel with its picture, and approving the storyboard approves them, so this review appears only when a picture was redone after that. Then stop: call `pipeline_review_present` with `gate: "pictures"`, prepare review copies of every picture (`pipeline_review_copies_prepare`, then upload them as described under Review media on the board), write the returned `documents`, and post one chat line naming the job. No video clip is made until the person approves all the pictures: the spend guard refuses `create_video_job` before that, so do not start a clip while the review is open.
2. **Clips** (`gate` `clips`): once every clip is made, stop the same way. The clips are not joined until the person approves them all: `stitch-clips.py` refuses (exit 6) before that.
3. **Joined video** (`gate` `cut`): the clips are joined plain (`media/D{n}/final-raw.mp4`, no captions, music or end card). Present it the same way (review copies, then `pipeline_review_present` with `gate: "cut"`): one player, "Ask for changes" with a note, and the combine card: Music, Voice-over and Captions rows, each with its own choice (library, upload, make with ElevenLabs which is priced, none; captions from the voice-over words, the script words, none), one "Approve + add these" button. `pipeline_decision_apply` approves the cut and records the picks in one step (its reply lists what is left in `next`), and reads a change note that only asks for captions or music the same way; a note about the cut itself goes back to the clips or the trim. Several voice (or music) takes made by ElevenLabs are shown side by side on a board question (`pipeline_combine_takes`; prepare review copies and write the board so they play); the person's answer is a take label for `pipeline_combine_set`. `finish-video.py` refuses (exit 6) until the cut is approved and the choice recorded.
4. **Finished video** (`gate` `finish`): after `finish-video.py` ran (captions, music and the post's on-screen text, in one style), present `media/D{n}/final.mp4` the same way (review copies, then `pipeline_review_present` with `gate: "finish"`): one player, "Ask for changes", "Approve". A change reruns finishing only; the approved cut stays. The post text comes after this approval.

A board answer arrives as a `submit_decision` with `reviewId` `pictures`, `clips`, `cut` or `finish`: apply it with `pipeline_decision_apply` right away. Each panel with `changes` carries what the person wants in its `note` (the `panels` list names them). An approval needs every panel approved.
The applied decision is saved as `approvals/pictures.json` or `approvals/clips.json`, with the exact files shown, so a redo (a new file) opens the review again.

**A change is a redo, and a redo is priced again.** For each panel with changes, have the Creative Director rewrite that one prompt, then add the redo as a new version of that panel (`-v2`) with `pipeline_quote_save`, present the price (`gate: "price"`), and wait for the person to approve the extra cost. Nothing is made before that: the spend guard refuses an item that is not in the approved price.

### The report

A `research`, `creative_analysis`, `video_breakdown`, or `results_review` job ends at its own approval, `findings`, shown on the board as "Report".
Once the report is written, call `pipeline_review_present` with `gate: "findings"` and `report/report.md`, and for a video breakdown also every still in `report/stills/`, then write every entry of its returned `documents`.
Post one chat line naming the job the same way as any other decision, by its brand and title, or by its title alone when it has no brand, for example '"Competitor pricing research": the report is ready, approve it here or on the board, or say what to change.'
A board answer arrives as a `submit_decision` with `gate` (or `reviewId`) `findings`: apply it with `pipeline_decision_apply` right away, the same as any other decision.
An answer in chat is worked out and landed the same way as Decisions on the board and in chat above, using `pipeline_review_present` with `gate: "findings"` for the revision and file list.
Approving the report completes the job.
Asking for changes returns the job to Write the report; write the documents again so the board shows the current stage.
Tell the person in one plain line naming the job what happened, for example '"Competitor pricing research": report approved.' or '"Competitor pricing research": back to the researcher with your notes.'

### Final approval and the label check

Before presenting the final post, run the label check from `skills/brand-check/SKILL.md`, then write the documents so the board shows any item it found.
The board shows each found item in plain words with "Accept as is", and a board approval carries the accepted ones in `args.acceptedFlagIds`.
When the person accepts an item in chat instead, add its id from the `pipeline_qc_save` result to `acceptedFlagIds` on the `submit_decision` you land for them.
`pipeline_decision_apply` refuses a final approval when the check is missing, out of date, or has an item nobody accepted.
Then decline that request with `pipeline_board_request_decline` and one plain reason naming the job's brand and title, for example 'SK-II "Anna Sawai serum Reel": the labels and logos are checked first.', run or finish the label check, and write the documents again.
Never name files, frames or ids to the person.

### Review media on the board

The Reel and the images play and open full size on the board from small review copies uploaded to the board, never from the originals.

1. When a job reaches a review with images or video (the sample, the final post, or a storyboard that already has made frames), call `pipeline_review_copies_prepare` with the `brand` and `jobId`.
2. Upload every `toUpload[].path` to the bound board with the Artifact tool: `action` publish, `asset: true`, `file_paths` set to those paths, and `url` set to the bound board.
3. Write the documents again in one batch call (`pipeline_status`), so the board links each output to its copy.
   `pipeline_review_present` also returns `reviewCopies.missing`; while it lists anything for a sample, the final post or the posting plan, the board keeps Approve off and tells the person you are adding copies, so do steps 1 to 3 before you ask them to look.
   Approving in chat still works meanwhile.
4. If the upload result or a reminder says the copies could not be matched, call `pipeline_review_copies_record` with each path and the `assetId` and `url` the Artifact tool returned for it, then write the documents again.
5. After the final approval, or when the job is cancelled, call `pipeline_review_copies_cleanup` with the `brand` and `jobId` (add `force: true` for a cancel).
   Delete each returned item with the Artifact tool: `action` delete, `url` set to the bound board, and `path` set to its `assetId`.
   If the host asks the person to confirm a delete, that is expected; do not skip it.
