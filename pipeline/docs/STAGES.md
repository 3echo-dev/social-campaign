# Stages the person sees

The pane shows a job as ten stages in plain words, not as plugin states or workflow row numbers.
This file is the one mapping between them.
The producer calls `set_progress({ key, title, stage, substep, status })` with a `stage` id from the first column.

A job shows only the stages its routed plan contains.
A text-only job has no media stages, a job with no research discipline has no research stage.
A generated video post, a picture post and a report show one fixed list of stops instead (see Fixed stops below).

## Job stages

| Stage id | What the person reads | Sub-steps while it is current | Workflow rows and states it covers |
|---|---|---|---|
| `getting-your-brief` | Getting your brief | Reading the request, A few questions | Intake, Plan; `INTAKE_PENDING`, `ROUTED`, `PLANNED` |
| `researching` | Researching | Looking at the audience and competitors, Checking the research, Pulling it together | Research, Research (lite), Keep the words; `RESEARCH_RUNNING`, `RESEARCH_COMPLETE` |
| `shaping-the-idea` | Shaping the idea | Strategy, Concepts, Storyboard | Brief, Lite brief, Ad requirements, Concepts, Script and board, Media spec, Cut plan |
| `your-approval-of-the-idea` | Your approval of the idea | | The concept gate and the storyboard gate; `AWAITING_CONCEPT_APPROVAL`, `AWAITING_STORYBOARD_APPROVAL` |
| `pricing-the-media` | Pricing the media | Getting a quote | The estimate calls inside `make-image` and `make-video` |
| `your-approval-of-the-price` | Your approval of the price | | The credit quote question, asked in the pane |
| `making-the-images-and-video` | Making the images and video | Images, Video clips, Checking them | Media, Video QA, Brand marks; `MEDIA_GENERATING`, `MEDIA_READY` |
| `writing-the-posts` | Writing the posts | Captions, Ad copy, Checks | Posts, Ad copy, QC checklist, Validate; `DRAFTS_READY`, `VALIDATED` |
| `your-final-approval` | Your final approval | | The content gate, and the publish, proposal and activation gates on the routes that require them |
| `ready-to-post` | Ready to post | | Hand-off; `HANDOFF_READY` and everything after it |

## Fixed stops (jobs routed on 0.18)

A generated video post, a picture post and a report show the same list of stops from the first screen to the last.
The list never grows, shrinks or renumbers while the job runs.
The route says which list in `stops` (`video`, `pictures` or `report`), set by routing rule 15 in `route-job.js`.
The lists live in `STOP_LISTS` in `lib-states.js`, and `server/pipeline/runtime.mjs` regroups the plan's stages into them.
Every stop ends at one decision of the person's.
A stop is over when its decision is recorded, when the job has moved past it, or when a later stop is over.
A decision counts only once the job has got to where it can be made, so an older decision does not count after the job goes back.
The count follows where the job is, so it drops only when the job really goes back, such as a clip being made again.
A job asked for changes, held up, stuck or stopped is read at the last state it was in on the normal flow (the stage log), and keeps its count.
The stop it was on stays the current one, and "Making your changes" shows on it.
Two stops do not end on their decision alone.
The posting plan stop ends when the post is delivered, so an approved plan is not yet a finished stop.
The picture stop ends when the pictures are made and checked, not on the sample alone.

A job routed before 0.18 keeps its ten-stage rows.
So does any other kind of job, such as a text-only post, a post made from supplied files or a paid campaign.
A post planned on 0.18.0 or 0.18.1 has no `stops` in its route, but its media row names the plugin's clip sign-off, and that is how it is recognised.
Its list is the kind the post was planned for (read from the first entry of `deliverableChanges` in `job.json` when the kind was changed), so it does not swap when the deliverables change.
When the person changes a deliverable between video and pictures, `change-deliverable.js` restamps `stops` in the route, so the list changes once, with the change.
A 0.18.0 or 0.18.1 post is restamped the same way.

### Video post

| Stop id | What the person reads | The decision that ends it | Plan rows and states it covers |
|---|---|---|---|
| `getting-your-brief` | Idea | The concept | Everything up to `AWAITING_CONCEPT_APPROVAL` |
| `storyboard` | Storyboard and price | The storyboard, which approves the price with it | Rows up to `AWAITING_STORYBOARD_APPROVAL` |
| `making-the-images-and-video` | Test clip | The test clip | The media row, shown as the step "Making the test clip" |
| `rough-cut` | Rough cut | The rough cut | The same media row, shown as "Making the rough cut", up to `MEDIA_READY` |
| `post-text` | Post text | The final post | Rows up to `CONTENT_APPROVED` |
| `posting-plan` | Posting plan | The posting plan | Rows up to `COMPLETE`; over when the post is delivered (`HANDOFF_READY`) |

The test clip and the rough cut always show for a video, even before their gate opens.

### Picture post

| Stop id | What the person reads | The decision that ends it | Plan rows and states it covers |
|---|---|---|---|
| `getting-your-brief` | Idea | The concept | Everything up to `AWAITING_CONCEPT_APPROVAL` |
| `storyboard` | Storyboard and price | The storyboard, which approves the price with it | Rows up to `AWAITING_STORYBOARD_APPROVAL` |
| `making-the-images-and-video` | Pictures | The sample picture | The media row, up to `MEDIA_READY`; over at `DRAFTS_READY` |
| `post-text` | Post text | The final post | Rows up to `CONTENT_APPROVED` |
| `posting-plan` | Posting plan | The posting plan | Rows up to `COMPLETE`; over when the post is delivered (`HANDOFF_READY`) |

### Report

A report keeps the stages its plan makes (`getting-your-brief`, `gathering`, `writing-the-report`, `your-review-of-the-report`, `report-ready`).
They are marked fixed so the board counts them once.

### Rules the board relies on

- The first stop is always `getting-your-brief`: the person's request and the Director's questions are attached to it.
- The stop that makes the media is always `making-the-images-and-video`: the job's media credits show while it exists, and a media review the plan does not name is drawn in it.
- There is no pricing stage.
  The price is approved with the storyboard and shows as a price row inside the Storyboard and price stop, with its itemised list.
  A later price (a redo beyond the allowance, a new shot) waits as a row in the stop the job is on.
- A reference-only price is not a media price, so it never shows as that row.
- A job asked for changes, held up or cancelled keeps all its stops.
  Where it was is read from the stage log (the last state before it left the normal flow) and the decisions recorded, not from the state alone.

## Checked handoffs

Work never goes straight from one employee to the next.
A video post's plan has two Editor check rows (`Editor check (script)` and `Editor check (post text)`).
The script check ends at `AWAITING_STORYBOARD_APPROVAL`, right after the script row, so it sits in the Storyboard and price stop; it runs before the storyboard and its price are shown, and a send-back is fixed before the person sees them.
The post text check ends at `CONTENT_APPROVED`, right after the Content gate row, so it sits in the Post text stop.
The Director confirms the file is on disk and current, the Editor checks it against the brief, and the work moves on or goes back to its author with the reason.
A card is raised only when the fix changes the idea, the price or the posting.

## Handoff lines in the stage log

Each handoff is a row in the stage log of `status.md`, written by `set-state.js` and read by the room feed (`handoffLines` in `server/pipeline/agent-box.mjs`).
A handoff does not move the job: its state and revision stay as they were.
The row's To cell says `handoff`, which is no state, so every reader of the state moves skips it and an older log reads as before.
The Note cell is the plain line the person reads, then a bracket: `handoff=checked`, `handoff=handed` or `handoff=back`, and `with=` the agents whose threads show the line.
`set-state.js {brand} {job-id} handoff passed {author} {to} --by {checker} --note "{piece}"` writes two rows, a millisecond apart:

```
| 2026-10-20T01:05:00.000Z | - | handoff | editor | Script checked by the Editor [revision=4; handoff=checked; with=scriptwriter,editor] |
| 2026-10-20T01:05:00.001Z | - | handoff | producer | Handed to the Creative Director [revision=4; handoff=handed; with=creative-director] |
```

A checked script goes to the Creative Director, who draws the storyboard pictures; the Videographer is handed the work only after the person has approved the storyboard.
For the two pieces the log knows, "Script" and "Post text" (to the Publisher), the command picks who gets the work next, so `{to}` may be left out and a wrong one is replaced.

`set-state.js {brand} {job-id} handoff back {author} --by {checker} --note "{reason}"` writes one row:

```
| 2026-10-20T01:07:00.000Z | - | handoff | editor | Back to the Scriptwriter: too long for 22 seconds [revision=4; handoff=back; with=scriptwriter] |
```

The agent names are the ones in the table above, plus `publisher` (the posting step).
The command makes the words, so the lines read the same every time.
The piece in `--note` is plain words ("Script", "Post text"), the reason is under 100 characters, and a bracket or a bar in either is dropped.

## Brand page stages

A brand page uses the key `brand:{slug}` and its own shorter list.

| Stage id | What the person reads | The `onboard-brand` step it covers |
|---|---|---|
| `reading-your-site-and-files` | Reading your site and files | Step 3, gathering from the site, repo or deck |
| `a-few-questions` | A few questions | Any batch asked in the pane, `status: "waiting"` |
| `writing-the-brand-files` | Writing the brand files | Step 4, drafting all four |
| `your-approval` | Your approval | The `open_review` of the four summaries, `status: "waiting"` |
| `done` | Done | Step 8, before handing to `new-job` |

## How to call it

Start of a row: `set_progress({ key, title, stage, substep, status: "running" })`.
End of the row, once the artifact is verified on disk: the same call with `status: "done"`.
While a person has to answer a question or decide a review: `status: "waiting"`.

`substep` is one of the sub-steps above, in those words.
Several rows map to one stage, so the stage repeats with a different `substep` rather than moving on.
Move the stage only when the last row mapped to it has landed.

## Who the person sees working

The stepper also names the roles working under the current stage, so a long stage shows movement rather than a bar.
`scripts/stage.js` takes `--agents "name:running|done"` and maps each name to the words below; nothing else reaches the pane.

| Name given | What the person reads |
|---|---|
| `producer` | Social media manager |
| `researcher` | Researcher |
| `trend-scout` | Trend Scout |
| `strategist` | Strategist |
| `copywriter` | Copywriter |
| `scriptwriter` | Scriptwriter |
| `creative-director` | Creative Director |
| `media-buyer` | Media buyer |
| `videographer` | Videographer |
| `editor` | Editor |
| `audience` | Audience researcher |
| `competitors` | Competitor researcher |
| `product-evidence` | Product researcher |
| `customer` | Customer researcher |
| `watch-video` | Video interpretation |
| `brand` | Brand researcher |

A research spawn is one entry, not a share of one: three workstreams start as three working roles and each turns to finished as its file lands on disk.
The app keeps eight, so a row with more than eight workers reports the eight it started.
