# Diagnosing what the person wants

Read by `skills/social-campaign/SKILL.md`. Each section is applied exactly as written here.

## What does the person want to get done

A job starts from the person's own words, never from a job type they pick.
The board asks one question, "What do you want to get done?", in a box on the home page and in Needs you.
The person writes it in their own words, may choose a brand and add links, and sends it.
It arrives as a `create_job` request that carries no kind: `brief` is their words, `title` is the first line of them, and `brand` and `sourceRefs` are there only when they chose a brand or gave links.
In chat, what the person says is the same thing: treat their words as the brief.

Never ask "What do you need?" with a list of job types, and never ask the person to pick a pipeline.
You diagnose which one fits, then create and route the job.
When the person has not said what they want yet, point them to the box in one plain line, for example "Tell me what you want to get done in the box on the board and I will take it from there", or let them say it in chat.

Diagnose in this order:

1. Read the words against `pipelines_list`.
   In the Markdown each pipeline has a short description, then its Examples, Not for and Needs lists, and its heading names its `kind` in brackets.
   Call it once per session with `format` set to `markdown`, which has all the diagnosis needs, and reuse the answer; ask for one pipeline by its id when you need its stages.
2. Pick one pipeline, and keep its `kind`.
   `publish_post` is for the person who already has the finished picture, pictures or video and only wants it posted as it is; new-job says how to tell it from a job that makes or edits something.
3. Ask only for what is still missing, through the questions this skill and new-job already describe: a brand when the pipeline needs one and none was chosen, then the intake questions in one batch after the job exists.
   Never ask again for what the words, the links or the brand profile already say.
4. Create the job and route it as new-job describes, with the `kind` you picked and, in `kindReason`, one short plain sentence of why.
   The board shows it under the job's title as "Claude planned this as <pipeline name>: <reason>".

When the person asks how their ads did, that is not a new job: follow the ad-results skill on the job it is about.

When two or more pipelines fit, or none does, never ask before the job exists: create the job right away with the likeliest pipeline and ask which one on that job, as new-job describes, so the person lands on the job and the Director asks there.
Board-sync's Questions on the board describes how to ask it.

Parse every link already in the request into `sourceRefs` before asking anything else, each `{uri, mediaType}`: a web link is `url`, a video file link is `video`.
The files of a `publish_post` are never `sourceRefs`: they go in `files`, as new-job describes.
Never re-ask for a link or a file the request already gave.

Files come in through chat, after the person sends the request; the board does not take them.
The box says so ("Have files? Add them in chat after you send this.").

A pipeline needs a brand when `pipelines_list` says `Needs a brand: yes`.
A pipeline that lists no brand runs with `brand: "no-brand"`, unless the person names a brand that already exists in the workspace.
When the pipeline needs a brand and the request carries none, use the brand without asking when exactly one brand is ready; otherwise ask which one in Needs you and in chat together, with the ready brands as the options, and wait for whichever answer arrives first.
When no brand is ready, go through the brand gate below first, and let the board's onboarding card and its Needs you item lead.
A request whose brand you have had to ask for is landed with the brand the person chose, as board-sync describes.

When the person says in a comment that the planned pipeline is not right, ask what they want in Needs you and in chat together, as board-sync describes, and carry on from their answer.
