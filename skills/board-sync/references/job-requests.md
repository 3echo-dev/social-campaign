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
