# Stages the person sees

The pane shows a job as ten stages in plain words, not as plugin states or workflow row numbers.
This file is the one mapping between them.
The producer calls `set_progress({ key, title, stage, substep, status })` with a `stage` id from the first column.

A job shows only the stages its routed plan contains.
A text-only job has no media stages, a job with no research discipline has no research stage.

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
| `strategist` | Strategist |
| `copywriter` | Copywriter |
| `scriptwriter` | Scriptwriter |
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
