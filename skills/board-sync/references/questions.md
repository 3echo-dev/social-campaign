# Questions on the board: special cases

Read by `skills/board-sync/SKILL.md`.
Each section is applied exactly as written here.

### Special cases

A question about anything on the video itself (the captions on the video, on-screen text, a moment) carries the frames it is about.
Take 2 to 4 frames of the finished video at those moments with `media_extract_frames` into the job folder, pass them as `stills` on `pipeline_board_ask`, with `about` set to that video file and its revision, then run `pipeline_review_copies_prepare` so the board shows them.
Call the words posted under the video "the post text", never "captions", so the two are never confused.

The sound plan question of a video opens with "Sound plan" and is answered before the price is saved; its answer replaces any plan recorded earlier (see the sound plan paragraph of the Director agent).

Making the storyboard pictures is not spending to ask about: up to 3 pictures per panel are made with no question and counted in the job total (make-image), so never ask "may I make the sample".
Extra pictures for one panel beyond the free 3 are priced as make-image Rule 11 says, one line with `count` (the number of extra pictures), and is approved with the board tap, never with a question or a typed yes.
On a picture-only post the first picture is the sample, approved on its own card; on a video post the test clip is the sample.

A go-ahead for sending or spending outside the posting decision is answered in chat only: still post it with `pipeline_board_ask` and `inChat` true, with the same words you will say in chat, so the board shows the notice.
The posting decision is the exception: the person's click on the board's Approve and post now, Approve and schedule, Approve and save as a draft or Approve and download is the go-ahead, so never ask for another confirmation in chat after it.
A typed "yes" never stands in for that click: see Money and posting need a click in `skills/board-sync/SKILL.md`.

Trying a failed picture or clip again is not new spending, since it stays inside the price already approved, so it is a normal board question with "Try again" and "Leave it out" buttons; its answer goes to `pipeline_generation_retry` as described in make-image and make-video.

For an `inChat` question, the board shows a notice to answer in chat instead of answer buttons.
Publish the board before asking in chat, take the answer from the chat only, and record it with `pipeline_board_answer` (`choice` or `text`), then write the documents again so the notice clears.
The notice also clears by itself when the send happens; call `pipeline_board_withdraw` if the person says no and nothing is sent.

Fixed approvals and intake fields keep their existing flow, since Needs you already shows them without a separate question.
Never use a question to collect the details of a job the person wants made, such as the product, who it is for, where it will run or the format: their own words, the links and the brand profile already carry what they said, and the board's Finish the brief form asks for the rest once the job exists.
The questions this skill and new-job describe for diagnosing a job stay: which pipeline fits when two do, and which brand when the pipeline needs one.
Free-text questions stay for genuinely open questions in the middle of a job.
