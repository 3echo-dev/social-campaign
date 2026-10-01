# Social Pipeline

A Claude Code and Cowork plugin that takes a request like *"three TikToks about the new runner"* and
gives you back finished posts, ready to publish.

It works out what kind of job that is, researches only what your brand files cannot already answer,
writes the strategy, the script and the storyboard, **stops and waits for you**, generates the video,
checks every claim and platform limit, and hands you a folder you can post from.

Up to three hard stops on an organic job, five on a paid one. Nothing external happens without your
verdict, and nothing is generated before you have seen the plan it will be generated from.

---

## How it works

A request becomes a typed job. A script routes it. Specialist agents own disciplines and share atomic
skills. The producer is the only thing that can spend credits, and it cannot pass a gate.

```
      "three TikToks about the new runner"
                     │
                     ▼
       ┌─────────────────────────────┐
       │   INTAKE  ·  job-intake     │  four questions, in one batch
       │   job.json                  │  a product photo is asked for here, not at the board
       └──────────────┬──────────────┘
                      ▼
       ┌─────────────────────────────┐
       │   ROUTE  ·  route-job.js    │  14 rules, deterministic, no model judgement
       │   route.json  →  plan.md    │  picks the workflow, the owner, the gates
       └──────────────┬──────────────┘
                      │
   ┌──────────┬───────┴───┬───────────┬───────────┬───────────┬───────────┐
   ▼          ▼           ▼           ▼           ▼           ▼           ▼
┌────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│RESEARCH│  BRIEF   │ CONCEPTS │  SCRIPT  │  MEDIA   │  POSTS   │ HAND-OFF │
│ stage 3│ stage 4  │ stage 5  │ + BOARD  │ stage 7  │ stage 9  │ stage 13 │
│        │          │          │ stage 6  │          │ stage 10 │ stage 14 │
├────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│research│strategist│ script-  │ script-  │ producer │copywriter│ producer │
│   -er  │  (opus)  │  writer  │  writer  │  3echo   │  editor  │  build-  │
│ x1or3  │          │          │          │ images,  │ 4 checks │  handoff │
│skipped │          │min(3,n+1)│4 to 15 s │  video   │          │ receipt  │
│when the│          │150 words │per clip  │  stitch  │          │          │
│brand   │          │  each    │          │          │          │          │
│answers │          │          │          │          │          │          │
└────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
                          ▲          ▲                    ▲          ▲
                       GATE 1     GATE 2               GATE 3    GATE 4
                                                                (merged into
                                                                 GATE 3 when
                                                                 you gave a
                                                                 schedule)

     1 pick a concept  ·  2 approve the board  ·  3 approve the post  ·  4 approve publishing
              free through GATE 2. only media generation costs credits.
```

**The gates are the point.** Claude cannot pass one. An approval is a JSON record bound to the
sha256 of the exact file you saw, so editing a draft after approving it invalidates the approval and
`build-handoff.js` refuses to package it.

**Two axes, not one pipeline.** UGC is a creative format and paid is a distribution discipline, so a
job can be either, both or neither. The router reads both off `job.json` and can put the scriptwriter
and the media-buyer on the same job.

**Skills reference each other downward, never in a loop:**

```
source-validation  →  every research, checking and reporting skill
research           →  strategist  →  every writing skill
write-hook         →  write-caption, write-script
storyboard         →  make-image  →  make-video  →  stitch
platform-rules/*   →  write-caption, write-hook, platform-format, media-buyer
```

---

## Roles

Eight roles, one agent file each. The producer dispatches; nobody else can, because every specialist
sets `disallowedTools: Agent`. No specialist holds an MCP tool, so no specialist can spend a credit.

| Role | What it owns | Skills | Model |
|---|---|---|---|
| `producer` | States, dispatch, disk verification, gates, every credit spent, the hand-off | job-intake, make-image, make-video, watch-video, storyboard, publish | sonnet |
| `researcher` | One evidence workstream per spawn, fetch-before-cite, gaps recorded as findings | research, source-validation | sonnet |
| `strategist` | `brief.md`: angle, audience, proof points with provenance, deliverable map | write-hook, write-cta, brand-check, source-validation | **opus** |
| `copywriter` | Platform-native posts: hook inside the cutoff, caption, CTA, media spec | write-hook, write-caption, write-cta, platform-format | sonnet |
| `scriptwriter` | Concepts, persona, script beats, storyboard, generation manifest | write-hook, write-script, write-cta, storyboard, policy-check | sonnet |
| `media-buyer` | Objective, audience, budget, tracking, creative map, proposal, activation checklist | write-cta, platform-format | sonnet |
| `videographer` | Source video analysis and QA of rendered clips against the board | watch-video, analyze-video, source-validation | sonnet |
| `editor` | GO or NEEDS REVISION on fact, brand, policy and platform. Never edits | fact-check, brand-check, policy-check, platform-format, source-validation | sonnet |

The strategist keeps Opus because `brief.md` is the one file every other agent reads, and a weak
brief is copied faithfully into everything downstream where no gate will catch it. The script and
board stage spawns the scriptwriter on Opus too: it is the one creative judgement in the run that
nothing afterwards can check.

---

## Skills

Claude invokes these itself. Five are for you.

| Skill | Runs when |
|---|---|
| `job-intake` | Turning a request into `job.json`. Asks the missing fields once, in one batch |
| `research` | One named workstream: audience, competitors, product-evidence or customer |
| `source-validation` | Claim labels, source ranking, traceability blocks, the never-fabricate list |
| `fact-check` | Every checkable statement against its cited source, and the never-make list |
| `brand-check` | Voice against the brand files, plus the AI-tell vocabulary |
| `policy-check` | FTC disclosure, platform policy, compliance trigger words |
| `platform-format` | The mechanical limits check, then the judgements a script cannot make |
| `write-hook` | Three-component hooks across mechanisms, labelled by family |
| `write-caption` | Platform-native captions, one CTA, no dead closers |
| `write-cta` | One ask, shaped to the goal |
| `write-script` | Beats with timing, on-screen text, the 4-second floor |
| `storyboard` | Panels with stable IDs, safe zones, the not-in-frame list |
| `make-image` | Panels through 3echo, one hero first, then the batch |
| `make-video` | Clips through 3echo, quoted and confirmed, QC'd, stitched |
| `watch-video` | Probe, frames, transcript, and an honest report of what was not analysed |
| `analyze-video` | Classifying a video into hook, pillar, angle, proof, funnel stage |
| `publish` | The hand-off package, and the contract a backend would implement |
| `/social-pipeline` | The entry point. What is in progress and where to go next |
| `/onboard-brand` | Drafting the four brand files from whatever you have |
| `/new-job` | Starting a job and running to the first gate |
| `/resume-job` | Picking one back up |
| `/review` | Applying your verdict at a gate |

Twenty-nine scripts do the work that must not depend on remembering: routing, planning, scaffolding,
state transitions, hashing, approval checking, pre-spend preflights, artifact recovery, media
stitching, metric import, and a health check on 3echo before anything is quoted.

---

## What you get

**A brief that names its evidence.** Every proof point carries a source and a date, or says
`Not verified` and what was searched. Claims your brand may never make are copied forward verbatim so
the writer can see them, not just the editor.

**Concepts sized to the job.** `min(3, deliverables + 1)`, 150 words each. One video gets two
concepts, not three fully-developed ones you throw away. The persona detail and the runner-up hooks
are written only for the one you pick.

**A script and a board before anything is drawn.** Beats with timing and on-screen text, panels with
IDs that never move, so "change P5" means the same panel in every round. Still free, still text.

**Video with your actual product in it.** The product photo you supplied seeds the panels; the panels
seed the clips. Nothing is invented from a description.

**Posts that pass the platform before you see them.** Caption length, hook inside the visible cutoff,
hashtag count, disclosure, and a media file that actually exists on disk, all checked mechanically
against the same JSON block the writer was told to read.

**A hand-off folder.** Per-platform files, a schedule, and a README, bound to the approval hash.

---

## What it costs

**Everything through Gate 2 is free.** Intake, routing, research, the brief, all the concepts, the
script and the full storyboard as text. You can run a whole job, pick a concept, cut half the beats
and rewrite the rest without spending anything.

| Step | Cost |
|---|---|
| Intake, routing, research, brief, concepts, script, board | **Free** |
| Image panels | 1 credit each |
| Video clips | Quoted per job before submission |
| Regenerating one panel or one clip | 1 panel, 1 credit; one clip re-quoted |
| Validation and handoff | No generation credits; observed model and tool usage remains in the receipt. |

The quote appears at Gate 1 and your approval records it as a ceiling. `credit_ceiling_per_job` in
`CONFIG.md` is the hard limit above that, and it is 30.

**Two checks run before any spend.** `check-3echo.js` confirms 3echo is answering and that your
balance covers this job's ceiling. `preflight-media.js` fetches one existing asset and confirms it
reaches disk, because a clip that generates but cannot be downloaded is a credit spent on a file you
never receive.

### How much research

Decided by the router, not asked. It reads your brand files:

| Your brand files | What happens |
|---|---|
| 3+ sourced proof points and verbatim customer language | **No research.** The answers are already there |
| Thin or not yet onboarded | One workstream, 25 turns, only the claims this job makes |
| Any paid job | Full research, three workstreams in parallel |

Paid always researches because money is at stake and a competitor's ad library is not something a
brand file can answer. After a job, `promote-verbatim.js` copies the sourced customer phrases into
your brand files, so the second job on a brand researches less than the first.

---

## Install

### 1. Add the plugin

```bash
/plugin marketplace add 3echo-dev/social-media-pipeline
```

```bash
/plugin install social-pipeline@3echo
```

Or try it without installing:

```bash
claude --plugin-dir ./social-media-pipeline
```

### 2. Dependencies

A `SessionStart` hook checks these every session and tells Claude what is missing, with the command
to fix it. You do not need to memorise this list.

**Required:**

```bash
python -m pip install Pillow
```

**Recommended.** The pipeline runs without them and says which step is degraded:

```bash
winget install Gyan.FFmpeg
```

```bash
python -m pip install yt-dlp
```

Without ffmpeg you get the clips as separate numbered files instead of one stitched cut, and the
hand-off says so rather than implying a cut exists. Without yt-dlp there are no captions from a
source video URL, and the analysis states that it had no transcript. On macOS or Linux use your
package manager for ffmpeg.

### 3. Connect 3echo

Declared in `.mcp.json`. Claude Code prompts on first use, or run `/mcp` to check.

Needed only for image and video generation, which happens after Gate 2. Everything before that runs
without it.

### 3b. Connect the gate app (optional)

Gates render as a grid of panels you click through, in claude.ai and Cowork.
Sign in to the gate-app dashboard, open the client you approve for, and copy its client key.
In Cowork and the desktop app the gate arrives through the claude.ai connector; in the CLI run `claude mcp add --transport http gate-app https://gate-app-bice.vercel.app/api/mcp --header "Authorization: Bearer <client key>"` once.
`.mcp.json` expands that variable into the server URL, so the key never lands in the repository.
Leave it unset and every gate happens in chat exactly as before, which is what the Claude Code CLI does anyway, because the grid does not render there.

### 4. Pick a folder to work in

Run Claude from wherever you want the work to live. **You do not need to create anything first.**

```bash
node scripts/set-root.js "D:/social"
```

Or pass `--root`, or set `SOCIAL_PIPELINE_ROOT`, or just run in the folder you want. The first run
makes `workspaces/` and `inputs/` itself.

That command also turns the guards on, so a spend without an approval on disk is refused rather
than merely discouraged. It writes one line into the project's `.claude/settings.json`, keeps
everything else that file had, and never touches one it cannot parse. Start a new session for the
guards to load. `--no-guards` skips it.

The plugin holds the agents, skills and scripts; your folder holds the brands, jobs and media. They
stay separate on purpose, so updating the plugin never touches your work.

### 5. Onboard a brand, once

```
/onboard-brand acme
```

Give it whatever you have: a website, a deck, a few posts you liked. It drafts the four brand files,
then asks one question: accept them as drafts and start a job, or review them one at a time. Most
people take the first, and it is the better default, because the files improve fastest against a real
draft rather than in the abstract.

---

## Use

### Before you start

- **A photo of the product**, if you want images or video. Not a render, the actual thing. The run
  stops at intake without one rather than at the storyboard, which is where it used to stop after
  the research had already been paid for.
- **Which accounts you post from.** Only needed at the end, when the schedule is written.

### Start

```
/social-pipeline
```

Or just say it: **"make me three TikToks about the new runner"**, **"we need a Facebook post about
the promo"**.

It reads what is already in your folder, leads with whichever job is waiting on you, and asks whether
to start something new, resume, or onboard a brand. Nothing runs until you answer.

Skip the menu if you know what you want:

```
/new-job acme
```

Four questions in one batch, then it routes, plans, and runs to the first gate.

### Gate 1: which concept

Ranked concepts, each from a different insight, with a recommendation and the credit quote for the
media. **No script is written yet**, because writing one per concept wastes the ones you did not pick.

```
Go with B.
B, but make it the shop owner rather than the runner.
None of these. Build one on the missed-bookings finding.
```

Your own concept is a first-class option, not a fallback.

### Gate 2: the script and board

Beats with timing, panels with permanent IDs, and the generation manifest. Still text, still free.

```
Cut P4. Change P5's line to "...". Add a beat after P6 where she checks the phone.
```

This is the last free stop. Approving it is what unlocks generation.

### Gate 3: the post

The finished draft with the media attached, after the editor has been through it on fact, brand,
policy and platform grounds.

```
approve
change the CTA, it's too pushy
start over
```

"approve", "ok", "yes", "go" and "ship" all mean the same thing. So do "change", "revise" and "fix".
You do not have to remember a keyword.

### Gate 4: publishing

Merged into Gate 3 when you gave a schedule and the account is on file, since there is nothing new to
decide. Otherwise it is a separate stop before the hand-off is built.

Paid jobs add two more: approve the campaign proposal, then separately approve turning it on.
Everything is written to be created paused, and the plugin never touches an ad account.

### Resume

```
/resume-job acme
```

Reads `status.md`, reconciles it against what is actually on disk, and continues. Close the session
for a week; the job remembers. It will not walk through a gate you did not answer.

---

## Configuration

`CONFIG.md` splits into two parts. The first is five things you may change: the credit ceiling, how
many agents run at once, which approvals are on, where the work is kept, and syncing to a connected
folder. The second is machinery, with a column saying whether each setting is enforced by a script,
by structure, or by instruction.

The `require_*_human_approval` flags are the reason this exists rather than a script that posts for
you. Claude will not change them on request and will not behave as though they were changed.

---

## Where it runs

| Environment | How it gets there |
|---|---|
| **Claude Code CLI / Desktop** | `/plugin marketplace add` then `/plugin install`, or `--plugin-dir` for local testing |
| **Cowork** | **Customize → Plugins → Add marketplace**, then install from there. Or upload the packaged plugin as a file |
| **Cloud sessions** | Enable it for your claude.ai account as above, or declare it in the repo's `.claude/settings.json` under `enabledPlugins` |
| **With the guards switched on** | Add `"env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }` to the project's `.claude/settings.json`. Off, the plugin behaves exactly as it does without it. See CONFIG.md |

### What refuses what

With the guards switched on, a generation call is refused outright unless the board is approved, the plan passes the pre-spend gate, the panel is one the approved plan covers, its price fits the figure agreed at the gate, an explicit yes to the quote is on record, and the hero panel has already come back.
The studio tools that spend without passing any of that are refused whatever else is true.
Switched off, every one of those is still written down as a rule, in `CONFIG.md` and in the two media skills, and the model is asked to follow it.
That difference is the point of the flag.

### Media download needs a local run

Generated images and clips live on 3echo and have to reach disk before a hand-off can contain them.
**This works in Claude Code and not in a Cowork cloud session.**

| | Cowork cloud session | Claude Code on your machine |
|---|---|---|
| Where it runs | Anthropic's servers | Your machine |
| Outbound HTTP | Mandatory proxy, allowlist only | Unrestricted |
| Reaching `agentc.3echo.ai` | Refused | Works |

MCP calls are the exception, because connector calls are made server-side and never enter the
sandbox. That is why generation works in Cowork while downloading does not.

`preflight-media.js` finds this out for one request before any credit is spent, and exits 3 with the
two ways out rather than discovering it after the spend.

**The proper fix** is the egress allowlist at **Organization settings → Capabilities → Code
execution**. Add `agentc.3echo.ai` there and downloads work in Cowork like anywhere else. Two
conditions: it is described as a Team or Enterprise control, and it is read when a session starts, so
add the domain first and then begin a new session.

Until then, two workable shapes:

| | How |
|---|---|
| **Split** | Gates in Cowork, where Markdown opens in the document editor. Then `/resume-job {brand}` in Claude Code for media and the hand-off. State reconciles against disk, so the handover is clean |
| **All local** | Everything in Claude Code. Nothing is blocked, but review documents render as plain files |

### Installing in Cowork

Open the **Cowork** tab, then **Customize → Plugins**.

**From this repository:** select **Add marketplace** and enter either
`https://github.com/3echo-dev/social-media-pipeline` or the `3echo-dev/social-media-pipeline`
shorthand. A private repository works, provided the account you are signed into on claude.ai can
reach it.

**From a file:** use the upload option and select the packaged `.plugin` file. This needs no GitHub
access at all, which is the route to use while the repository is private.

Cowork parses frontmatter with a **strict** YAML parser where Claude Code is lenient. One description
containing `": "` as a bare scalar fails the entire plugin load with `Unknown command`, not just that
one file. A frontmatter check in the build catches exactly that shape, and it is why every
description here is a folded block scalar.

### Updating

Changes do not arrive on their own. Update the marketplace to pull the latest commit, then update the
plugin to install it. The version in `.claude-plugin/plugin.json` gates this: a change pushed without
a version bump reaches nobody. A file-uploaded plugin has no marketplace behind it and never updates;
re-upload instead.

Well inside the limits: 200 MB and 5,000 files per package, against 165 files and 331 KB here.

---

## Provenance

The skills are adapted from open-source repositories rather than written from nothing.
The licenses and copyright notices for that material are in `THIRD_PARTY_NOTICES.md` at the plugin root.
`docs/sources/` records where each number in an instruction came from,
so a figure that looks wrong can be traced rather than argued about.

---

## Requirements

Claude Code or Cowork with subagents · Node 18+ · Python 3.9+ with Pillow · a 3echo workspace for
media generation · ffmpeg and yt-dlp optional.
