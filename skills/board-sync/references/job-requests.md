# Job requests

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.
Every request on this page comes from the board, so land it with `pipeline_board_request_land` and `from` set to `board`.

A `create_job` request from the board's "What do you want to get done?" box carries the person's own words as `brief`, a `title` made from the first line of them, and `brand` with `brandName` and `sourceRefs` only when the person chose a brand or gave links.
It carries no `kind`: the person never picks a job type, so you diagnose it.

Before landing a kind-less `create_job`:

1. Read `brief`, the links and the chosen brand's saved profile against `pipelines_list`, and pick the one pipeline that fits, as new-job's Pick the pipeline from the person's words describes.
   When two or more pipelines fit, or none does, never ask before the job exists and never leave a question with no job on the home page.
   Pick the likeliest pipeline, add `pipelineUnsure: true` to `args.job`, and land and apply the request as below, so the person lands on the new job at once with their words as the brief.
   Right after the apply, ask the pipeline question on that job with `pipeline_board_ask` and its `jobId`, with the likeliest pipelines' plain names or answers as options and a typed answer, write the returned `documents`, and say the same question in chat, as new-job's Pick the pipeline from the person's words describes.
   Nothing is planned or started until the answer sets the pipeline with `pipeline_intake_update`.
2. Put the pipeline's `kind` and, in `kindReason`, one short plain sentence of why into `args.job`, with every other field the words, the links and the brand profile state or clearly imply, so the job routes the moment it is created.
3. When `pipelines_list` says `Needs a brand: yes` and `args.brand` is empty, use the brand without asking when exactly one brand is ready; otherwise ask which brand with `pipeline_board_ask` (one card, no job yet) and in chat together, with the ready brands as options.
   Land the request with `args.brand` set to the brand's slug and `args.brandName` to its name, from the person's answer or the one ready brand, and nothing else.
   A pipeline that lists no brand needs none: land without one.
   A landing that fails with the brand line ("A post or campaign needs a brand") means this step was skipped: ask the brand question, then land again.
4. Land the request with `args` otherwise unchanged except for that added `job` object, then apply it with `pipeline_board_request_apply`.
   Do not publish the board between landing and applying: the board must never show a question the brief already answers.

An older request that does carry a `kind` is landed the same way, with `kindReason` added.
For a `publish_post` request, the box takes no files: after the apply, if the person has not given them, ask for the files with `pipeline_board_ask` (that `jobId`, `wantsUpload` with `type` picture or video) and the same question in chat, and add them with `pipeline_post_files_add`, as new-job describes.
A request never carries a file path from the person's computer.

If the applied job's route blocks with "a photo of the product" among its blockers and the brief gave no photo, do not publish or ask for one yet.
Look for the product's own page on the brand's official website, with web search restricted to that domain, then call web_product_photo_find with the brand, the job ID, and that page address.
When it returns attached, continue from the refreshed, no longer blocked route.
When it returns not_found, publish as usual so the board's Finish the brief form asks the one plain photo question.
Never mention rules, tools, files, or where the picture came from to the person.

Use these exact `job` field names and values:

- `request`: the brief, in the person's words.
- `kind`: the pipeline you picked, one of `organic_post`, `organic_series`, `ugc_creative`, `paid_campaign`, `content_repurpose`, `publish_post`, `research`, `creative_analysis`, `video_breakdown` or `results_review`.
- `kindReason`: one short plain sentence, at most 200 characters, of why that pipeline fits, in the person's terms; the board shows it under the job's title.
- `pipelineUnsure`: `true` only when the words fit more than one pipeline; it holds the job unplanned until `pipeline_intake_update` sets the kind. Leave it out otherwise.
- `sourceJobId`: for `results_review` only, the id of the earlier job whose results to read (it must be a job of the same brand); ask which job if the person has not said.
- `sourceRefs`: for every kind except `publish_post`, one object per link or file already given, each `{uri, mediaType}` where `mediaType` is `url` for a link or `video` for a video file.
  Never use it for the files of a `publish_post`: those go in `files`, as new-job describes.
- `caption` and `aiMade`: for `publish_post` only, exactly as new-job's "The job for `publish_post`" describes; the caption word for word, `aiMade` a yes or a no.
- `objective`: `awareness`, `engagement`, `traffic`, `leads`, `sales`, `app_installs` or `retention`.
- `distribution`: `organic`, `paid` or `both`.
- `platforms`: a list of `facebook`, `instagram` and `tiktok`.
- `deliverables`: one object per platform and format, `{id: "D1", platform, count, creativeDiscipline, placement}`, where `placement` is the fixed post type (instagram `post`, `reel` or `story`; facebook `post`, `reel` or `story`; tiktok `video` or `photo`), read from the brief and left out when the brief does not settle it, and `creativeDiscipline` is `static_image`, `carousel`, `brand_video`, `ugc`, `motion_graphic` or `text_only`, a `ugc` item adds `ugcSource: "ai"`, a `ugc` or `brand_video` item where a person or character speaks to camera adds `talkingCharacter: true`, and a stated shape adds `aspectRatios` (for example `["9:16"]`) and `durationSeconds: {min, max}`.
- `audience`: `{description}`, only when the brief itself narrows the audience; leave it out otherwise, and never copy the brand profile's audience in. The router falls back to the brand profile's own audience on its own.
- `budget` and `landingPageUrl`, only when the brief states them for paid work: `{currency, maxTotalAmount}` and an https URL.
- `schedule`: `{publishAt, timezone}`, only when the brief states a time.

The product or subject stays in `request`; a product photo goes in as an https link in `productAsset` when the words give one; the box takes no photo, and a photo file arrives later on the board's own Finish the brief photo field.
For `research`, `creative_analysis`, `video_breakdown` or `results_review`, leave out `objective`, `distribution`, `platforms` and `deliverables` entirely; they do not apply.
Leave out anything the brief and profile do not say; references and supporting material are never required.

Talk to the person in plain marketing language only: never mention limits, character counts, validation, routing, blocked states, file paths or tool names.
Fix quietly whatever can be fixed without changing what they meant; otherwise ask one plain question.

For an `update_intake` request, the person answered the board's Finish the brief form: `args` carries `brand`, `jobId`, `expectedRevision` and `patch`.
Land it, then apply it immediately with `pipeline_board_request_apply`; the click is the approval, and the apply runs the same update as `pipeline_intake_update`.
If the apply refuses because the job changed or an answer is invalid, nothing was written: decline the request with `pipeline_board_request_decline` and the refusal as the reason, then publish, so the board shows the current questions.
After a successful apply, publish, then continue the job as for `continue_job`.
An intake answer given in chat instead is applied with `pipeline_intake_update` and then published the same way.

For an `attach_product_photo` request, the person added a photo on the board's own Finish the brief field because the router was blocked on one: `args` carries `brand`, `jobId`, `expectedRevision` and `photo`, transited as `references/request-files.md` describes.
Land it with the saved local path in `photo.path`, then apply it immediately with `pipeline_board_request_apply`; the click is the approval, same as `update_intake`.
If the apply refuses because the job changed or the file is not a usable image, nothing was written: decline the request with `pipeline_board_request_decline` and the refusal as the reason, then publish.
After a successful apply, publish, then continue the job as for `continue_job`.

A comment that says the job is not the kind the person meant, for example 'This is not the kind of job I meant for "Serum Reel". Please ask me what I want.', comes from the "Not right? Tell Claude" button under a job's title.
The comment names the job and carries its id in brackets: find the job by that id.
Hold that job: do no further work on it (no research, drafting, making, checking or posting) until the person decides, and answer any decision it is waiting on only if the person asks.
Ask what they want with `pipeline_board_ask` for that job (`jobId` set) and in chat together, never only in chat, with the names of the likely pipelines from `pipelines_list` as the options and a typed answer, and name the job in the question.
A chat answer is recorded with `pipeline_board_answer`, a board answer arrives as `answer_question`, and the first one wins.
When the answer is a pipeline and the job has not been planned yet, call `pipeline_intake_update` with a patch of `kind` and a new `kindReason`, then let the job carry on.
When it has been planned, its pipeline cannot change: only after the person has chosen another pipeline, create a new job from the same words with it, as new-job describes, and say in one plain line that the first job stays on the board as it was and is not being worked on.
Never start a second job without that answer, and never cancel or edit the first.
When the person says the plan was right after all, let the job carry on.
When the answer is a new description of what they want, treat it as the words of a new request.

For a `continue_job` request, apply it once and pass its returned snapshot to `new-job` to resume the existing job when it is still in intake (state `INTAKE_PENDING` or `NEEDS_CLARIFICATION`), or to `resume-job` when it is established (routed or later).
Never create a replacement job to answer missing intake fields.
Local imports use a source folder selected on the runner's computer, never a Drive URL.

## A brief change from the board

A tap on a word of the brief, or on the shape, voice, music or subtitles picker, reaches the Director as an `agent_message` request whose `about` is `{kind: "brief", field, version}`.
A tapped word carries no value: the person's own words are the message.
A picker also carries `value`, the new value, which the Director reads as `change to "..."`.
The `version` is the brief version the person was looking at.
The `value` is the new ratio for `shape`, and `word`, `line` or `none` for `subtitles`.
For `music` it is a mood word for a made track (`warm`, `upbeat`, `calm` or `minimal`), `library <id>` or `none`.
For `voice` it is `elevenlabs <id> <name>`, `library <id>` or `none`.
A voice picker that finds nothing sends "Find voices like ..." with `field` `voice` and no `value`; treat it as a request for voices, below.
Land it with `pipeline_board_request_land` and apply it with `pipeline_board_request_apply`, as board-sync's Agent Box describes, then apply the change through the engine.
Never edit `brief.md`, `job.json` or a finishing record by hand.
When the brief is already at a higher version than the one the person saw, read the new brief first and apply the change only if it still fits; otherwise answer with one line that the brief changed.

Apply the change by its `field`:

- `shape` (9:16, 4:5, 1:1 or 16:9): call `pipeline_intake_update` with the job's current `expectedRevision` and a `patch` of only `{shape: "<ratio>"}`.
  The engine changes the first post, the one the brief is about; add `deliverable` (that post's id from `pipeline_job_read`) only when the job has several posts and the change is for another.
  It works from the plan up to the ideas, and the update refuses once an idea is picked, because the storyboard is drawn in that shape.
  It also refuses a Reel, a Story or a TikTok video asked for any shape but 9:16.
  Each refusal comes in plain words: pass the sentence on in one line.
  The brief file keeps its old Shape row until the brief is written again; the board and the Creative Director read the shape from the job, so both use the new shape.
  Write the `documents` it returns.
- `voice`, `music` or `subtitles`: call `pipeline_finishing_choice` with `by` set to `the person` and a `combine` that holds only the row that changes, because a row left out keeps what is recorded.
  Before the sound plan question is answered, such a tap is kept as the person's pick for that one part (the reply says `partial`).
  It is not the sound plan: the other parts are not chosen, the storyboard price still waits for the answer, and the plan recorded from the answer carries the pick.
  - Voice from the ElevenLabs list: `voice: {source: "make", voiceId, voiceName}` with the id and name exactly as the saved voice list gives them.
  - Voice from the library: `voice: {source: "library", id}`.
  - No voice-over: `voice: {source: "none"}`.
  - Music: `music: {source: "library", id}` for a library track, `music: {source: "make", mood}` for a track made to the mood the person named (`warm`, `upbeat`, `calm` or `minimal`), or `music: {source: "none"}`.
    Always pass `source` with the `mood`, and name a mood only when the person did.
  - Subtitles: `captions: {source, style: "word"}` for word by word or `captions: {source, style: "line"}` for one line, or `captions: {source: "none"}`.
    Always pass `source` with the style: the source the subtitles already have, or when they have none, `voice` when the video has a voice-over and `script` when it has none.
    Leave the style out when the person gave none, because the shape decides (word by word on 9:16, one line on every other shape).
  - A voice or a mood the person picked stays theirs: a suggestion and the plan recorded from their answer (`voice: {source: "make"}`, `music: {source: "make"}`) carry it, so never pick another voice or mood for them.
- Any other word (topic, message, who is in it, look, ending, posting): ask the Strategist for the brief again with that one change, naming the field and the new value in its brief.
  The new brief keeps the front matter `version` one higher with a Changelog line, as the Strategist's procedure says.
  Write the job's documents again so the paragraph shows the new version.

The sound picks never approve money:

- Recording a voice or music pick makes nothing and buys nothing, and a pick made with ElevenLabs stays priced with the storyboard.
- Never call `creative_generate_speech` or `creative_generate_in_flow` for a pick, and never treat typed words as the price click.
- When the reply from `pipeline_finishing_choice` says the saved price does not follow the plan, do what it says, then present the storyboard again.
- A voice preview is free and plays from the saved list without making anything.

When the person types a voice instead of tapping one ("use Adam from ElevenLabs", "something warmer"):

- A voice id comes only from `creative_list_voices` or from the person, never from memory.
  Search `creative_list_voices` for the name or the description, and save what came back as below.
- When exactly one voice fits the name, record it as above.
  When several fit, ask which one with `pipeline_board_ask` and the same question in chat, naming each voice in plain words.

When the person asks for voices ("find voices like Adam", "show me calmer voices"):

1. Call `creative_list_voices` with the name or description they gave.
2. Keep the closest matches, at most 50, and call `pipeline_voice_catalog_save` with `voices`, one `{id, name, line, previewUrl}` for each: the voice id as given, its name, one plain line about its tone or accent, and its free preview link.
   The save replaces the whole saved list, so pass the full result of this search.
3. Write the job's documents again so the picker shows the new list, then answer with one line.

After any of these changes, answer with one plain line through `pipeline_agent_reply`, for example "Voice set to Adam. The voice-over is priced with the storyboard." or "Subtitles set to word by word."
Use plain words only: no ids, file names, tool names or field names.
Do not add a line for the work itself, because the room stays quiet.

## An ideas message from the board

Two buttons on the ideas step talk to the Director and approve nothing: "Pick for me" sends "Pick an idea for me", and "Mix two" starts a message with "Mix two ideas: " that the person finishes.
Both arrive as an `agent_message` request whose `about` is `{label: "Ideas", revision}`; land and apply them like a brief change above.
Never approve an idea for the person: the pick stands only when the board sends their tap on the idea card.

- "Pick an idea for me": read `concepts.md` and choose the idea marked recommended, or the one with the strongest proof when none is marked.
  Answer with one plain line through `pipeline_agent_reply` that names the idea by its number and title, says why in a few words, and asks the person to confirm it with the "Pick idea" button on the card.
  Do not call `pipeline_chat_decision` or `pipeline_decision_apply` for this message.
- "Mix two ideas: ...": ask the Creative Director to write the mix the person described as one more idea in `concepts.md`, with the same fields and the other ideas kept.
  When the person named no two ideas or no way to mix them, ask one question with `pipeline_agent_reply` and wait.
  Then call `pipeline_review_present` for the concept pick again, so the card shows the new version and a tap on the older one is refused as changed, and write the `documents` it returns.
  Answer with one plain line that the mixed idea is on the card.
- When the ideas are already picked, answer with one line saying so and change nothing.
