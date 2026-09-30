# Social Campaign

A Claude Code plugin that takes a brand and a brief and gives back finished social content: posts, Reels, ad creative, or a written research report.
Current version: 0.7.3.

You describe a brand once, on a page called the board.
You write a brief for a job.
Claude researches the audience and the competitors, proposes an idea, writes the script and the storyboard, prices any images and video, makes them, checks them, and writes the captions.
It **stops for you** at the idea, at the price, at the sample image, at the final post and at where and when it goes out.
It does not post for you: a job ends in a hand-off package that a person publishes.

Nothing paid runs before you approve the price on the board.
Nothing is posted.
Every research claim carries its source, and what could not be checked is said plainly.

---

## How it works

A workspace folder holds your brands and jobs.
A private board shows every job and asks for every decision.
A producer walks the job through its stages, handing each one to a specialist.

```
      /social-campaign
            |
            v
   +--------------------------+
   |  SETUP  (once)           |  pick a working folder
   |                          |  publish the private board
   |                          |  connect 3echo Studio, ElevenLabs (or skip)
   +------------+-------------+
                v
   +--------------------------+
   |  BRAND ONBOARDING        |  name, site, channels, what you know
   |  (once per brand)        |  research fills the blanks
   |                          |  logo, colours, fonts read from the site
   +------------+-------------+
                |         you check the brand card, Save and continue
                v
   +--------------------------+
   |  NEW JOB                 |  a brief on the board, links and files
   +------------+-------------+
                v
   +-------------+----------+-----------+-----------+-----------+
   | BRIEF       | RESEARCH | IDEA      | MEDIA     | POSTS     |
   | read, few   | audience | strategy  | price     | captions  |
   | questions   | rivals   | concepts  | sample    | checks    |
   |             | product  | storyboard| the rest  | labels    |
   +-------------+----------+-----------+-----------+-----------+
                                ^           ^   ^        ^
                            YOU PICK    YOU APPROVE   YOU APPROVE
                            the concept  the price    the final post
                            and the      and the      and where and
                            storyboard   sample       when it goes out
```

A job shows only the stages it needs.
A text-only post has no media stages.
A research job has no idea stage and no media at all: it ends with a report you approve.

**The board click is the approval.**
When you approve, choose or decline on the board, Claude applies it at once.
It does not ask you again in chat.
You can answer the same decision in chat instead, and the board follows.

**A decision is tied to what you saw.**
It is applied only if the job and the exact files are still the ones you reviewed.
If something changed in between, Claude shows you the current version instead.

**The plain-language rule.**
Claude does not narrate limits, file names, stage codes or internal states.
It fixes what it can quietly and asks one plain question when it needs you.

---

## Roles

Nine agents, one file each.
The producer dispatches and verifies.
No specialist can spawn another agent, because every specialist file sets `disallowedTools: Agent`.
Each specialist gets only the tools its stage needs.

| Role | What it owns | Skills it uses | Model |
|---|---|---|---|
| `producer` | Intake, dispatch, checking each file on disk, state changes, gates, media spend, hand-off | all of them, as the plan names them | sonnet |
| `researcher` | One research workstream per dispatch: audience, competitors, product evidence, brand onboarding, reports. The only agent with web search, page fetch and the social lookup tools | research, source-validation, write-report | sonnet |
| `strategist` | The brief: angle, audience, proof points, per-platform treatment | write-hook, write-cta, brand-check, source-validation | **opus** |
| `scriptwriter` | Concepts, the script and the storyboard with stable panel ids | write-hook, write-script, write-cta, storyboard, policy-check | sonnet |
| `copywriter` | Captions, hashtags, ad copy, one coherent pass per platform | write-hook, write-caption, write-cta, platform-format | sonnet |
| `media-buyer` | Paid campaigns only: ad requirements, campaign proposal, activation checklist | write-cta, platform-format | sonnet |
| `videographer` | Watching and breaking down source video, and checking rendered clips | watch-video, analyze-video, source-validation, write-report | sonnet |
| `editor` | Check-only review: facts, brand, policy, platform rules | fact-check, brand-check, policy-check, platform-format, source-validation | sonnet |
| `publisher` | The hand-off package after final approval | publish | sonnet |

The strategist keeps Opus because the brief is the file every later stage reads.
A weak angle is copied faithfully into the concepts, the script and the copy, where no gate will catch it.
The workflow also runs the scriptwriter on Opus for the script and storyboard step.

---

## Skills

Claude runs almost all of these itself.
Three are for you to type.

| Skill | You type it | Runs when |
|---|---|---|
| `/social-campaign` | Yes | The entry point. Opens the board, sets up a workspace if there is none, and asks "What do you need?" |
| `/social-campaign:setup` | Yes | Set up or recover the workspace and its private board. `--new` publishes a replacement board for the same workspace |
| `/social-campaign:doctor` | Yes, only you | A health check and repair. Claude never starts it on its own |
| `board-setup` | No | The first publication of the board as a private claude.ai artifact |
| `board-sync` | No | Pushing the current state to the board, and applying what you decided there |
| `onboard-brand` | No | Building a brand profile and running the brand research |
| `new-job` | No | Creating a job from a brief and resuming a saved one |
| `job-intake`, `resume-job`, `social-pipeline` | No | The pipeline's own intake, resume and entry contracts |
| `research`, `strategy`, `creative` | No | The research, strategy and copy or script stages of a job |
| `generate`, `make-image`, `make-video` | No | Pricing and making media, sample first |
| `write-hook`, `write-script`, `write-caption`, `write-cta`, `storyboard`, `platform-format` | No | Craft skills for the writers |
| `fact-check`, `brand-check`, `policy-check`, `source-validation` | No | The editor's checks, and the label and logo check on every image and video |
| `watch-video`, `analyze-video`, `write-report` | No | Frames, transcript and breakdown of a video, and the written report |
| `review` | No | Presenting a decision and landing the answer |
| `publish` | No | The hand-off after final approval |

---

## What you get

**A brand card that fills itself in.**
Give a name, a site and your channel links.
Research fills audience, market and positioning, brand voice, content pillars and competitors where you left them blank.
A field you typed, or cleared, stays as you left it.
The logo, colours and fonts are read from the website and shown for you to edit.

**Research with sources.**
Audience, competitors and product evidence, each claim traced to where it came from.
Competitor work covers at most three competitors.
Research defaults to the Singapore market.

**An idea you pick.**
Ranked concepts with a hook, the proof pattern and the credit price of making them.
Copy choices such as pillar, angle, hook, call to action and hashtags can be picked with the concept.

**A script and a storyboard you approve panel by panel.**
Each panel keeps its id.
You approve or change each one.

**Images and video, sample first.**
One sample image is made and shown before the rest of the batch.
Images and clips play on the board from small review copies.

**Posts that were checked.**
Captions and ad copy per platform, a platform-rules check, an editor review, and a label and logo check on every image and video, including footage you supplied.
You can accept a flagged item as it is.

**A hand-off package.**
Copy, media, schedule and a per-platform checklist, with a manifest.
For paid work, a campaign proposal and an activation checklist to set up in Ads Manager.

**Reports for three more kinds of work.**
Research, an analysis of a post or campaign, and a breakdown of a video each end in one report you approve.
It downloads as Markdown or HTML.
A brand is optional for all three.

**Usage by stage.**
The board shows tokens and time for each stage and for the whole job.
Time you spent deciding is its own row.
Media shows in 3echo credits.
A figure that was not measured reads "Not reported".

---

## What it costs

The plugin is free.
Thinking, research and writing run in your own Claude session.
Only media generation spends anything else.

| Step | Cost |
|---|---|
| Brand onboarding, research, strategy, script, storyboard, captions, checks | No credits |
| Research, analysis and video breakdown jobs | No credits |
| A still image | 1 credit each on 3echo Studio |
| A video clip | Priced per clip by 3echo Studio before it is made |
| A voice line | Priced by ElevenLabs before it is made, through your own ElevenLabs connector |
| A regenerated image, clip or line | Priced again, and shown again |
| Hand-off | No credits, and nothing is posted |

A clip is 4 to 15 seconds.
Its price moves with the length, the resolution and whether sound is generated.
The plugin does not model that curve, so every clip is estimated on its own and the price you see is the sum of what came back.
One example from a run, 720p with sound: a 4 second clip quoted 15 credits and a 5 second clip 19.
Your quote will differ.

**Nothing paid runs before you approve the price.**
Every image, clip and voice line is estimated first.
The board then shows each item, its credits and the total, with Approve at that total and Ask for changes.
A request for changes is re-priced and shown again.
The concept approval also carries the most you agreed to spend, and the plugin refuses to go past it.
If a paid call is blocked, the run stops and tells you what it is waiting on.
It does not work around the block.

3echo Studio credits are drawn from a Studio workspace.
When your account has more than one, the price panel asks which one pays, and you can set it per job or as the brand's default.

---

## Install

### 1. Add the plugin

```bash
/plugin marketplace add 3echo-dev/social-campaign
```

```bash
/plugin install social-campaign@3echo-social-campaign
```

Or try it from a checkout without installing:

```bash
claude --plugin-dir <path to this folder>
```

### 2. Moving from an earlier install

The repository was republished with a fresh history, so an update cannot pull.
Remove the marketplace and add it again.

```bash
/plugin marketplace remove 3echo-social-campaign
```

```bash
/plugin marketplace add 3echo-dev/social-campaign
```

```bash
/plugin install social-campaign@3echo-social-campaign
```

Then open a new chat.
Your workspace, brands and jobs are kept, because they live in your working folder and not in the plugin.

### 3. Dependencies

A hook checks these each time a session starts and says what is missing.

**Required:** Node 22.13 or later.
The plugin has no npm packages to install.
If Node is older, the start of the session says so.

**Recommended:** FFmpeg, for video and audio.
`winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac.
Without it video work cannot be analysed, and clips are delivered numbered instead of joined into one cut.

**Recommended:** yt-dlp, for TikTok posts and video addresses.

**Optional:** a browser-driven research helper, for sites that show almost nothing to a plain page fetch.
It needs Python 3.10 or later, and it installs itself in the background once your workspace is set up.
Nothing else waits for it.
`/social-campaign:doctor` reports on it and offers a repair.

### 4. Connect 3echo Studio and ElevenLabs

Both connect through your own claude.ai connectors.
Add them in claude.ai under Settings > Connectors.
The plugin has no sign-in of its own and stores no keys.

- 3echo Studio makes images and video.
- ElevenLabs makes voice lines.

Setup detects a connector you already added and shows it as Connected.
It asks about the ones that are missing, each with Connect or Skip for now.
A skipped connector is asked about again only when a stage needs it.
Text-only jobs and all research jobs need neither.

### 5. Pick a working folder

Type `/social-campaign` in the folder of your project.
If it has no workspace, setup suggests one folder for it and offers a choose-another option.
Your brands, jobs, inputs and results live there.
The folder can be moved or renamed and it keeps working.
Setup may also ask once to let the plugin's tools and the board update run without a prompt for each click.

### 6. After a plugin update

Open a new chat and type `/social-campaign`.
A running chat keeps the old version until you do.
Quitting Claude is not needed.
Your jobs and board are kept.

---

## Use

### Start

```
/social-campaign
```

It opens your board.
On a new workspace it sets one up first.
It then asks what you need: a post or campaign, research, an analysis of a post or campaign, or a breakdown of a video.

### Onboard a brand

A post or campaign needs a brand that is ready.
On the board, fill in the brand form once: the name, the website, Facebook, Instagram and TikTok links, and anything you already know about the audience, market, voice, content pillars and competitors.
Each link can be marked Not available.
Add a logo, colours and fonts on the card if you have them.
Click Start onboarding.

Research then fills the blanks.
Claude tells you which fields it filled and which are only suggestions to check.
Look over the card and click Save and continue.

### First job

Click **+ New job**, or answer the question in the Inbox, and fill in the form with a title and a brief.
Add links or local files if you have them.
Claude reads the brief and the brand profile first and fills in every field they already answer.
It asks only for what is genuinely missing, one plain question at a time.
Your original files are copied in and left untouched.

For a first run, one organic text-only post is the smallest test.

### Reviews and approvals on the board

The board opens beside the chat.
Each stage shows in plain words, and the current decision shows on the job.

- **Pick a concept**, and any copy choices that come with it.
- **Approve the storyboard**, panel by panel.
- **Approve the price.** The total and each item are shown.
- **Approve the sample image**, before the rest is made.
- **Approve the final post.** Any label or logo item found is shown with Accept as is.
- **Confirm where and when it goes out.**
- **Approve the report**, for the three report kinds.

Ask for changes on any of them and the job goes back to that stage with your note.

### Resume

Reopen the same working folder and type `/social-campaign`.
Jobs, decisions and progress are still there.
A job that was waiting on you is still waiting, and nothing is done twice.
An unfinished brief stays a draft under its own job, so continue it rather than starting a new one.

---

## Where it runs

| Environment | How |
|---|---|
| **Claude Code CLI and Desktop** | `/plugin marketplace add`, then `/plugin install`, or `--plugin-dir` for a checkout |
| **Board** | A private claude.ai artifact bound to your workspace. It needs the host to offer the Artifact, ArtifactData and comments tools. If it does not, setup stops and says which one is missing |
| **Local browser board** | Available only when you explicitly ask for it. It is never a fallback inside setup |

### The board

The board is the decision surface.
It shows the Inbox, the brands, every job with its stages and outputs, the decision waiting on you, and the usage footer.

It is a private page on your claude.ai account.
Your decisions come back to Claude as saved requests, and Claude applies them.
While a chat is open Claude picks them up as they arrive.
If a chat was closed, the next session sweeps what was saved.

Your source files and local file paths stay on your computer.
Small review copies of images and clips are uploaded to your private board so you can view them there.
They are removed after the final approval, or when the job is cancelled.

The bundled runtime under `pipeline/` owns routing, plans, state changes and approvals.
Its local overrides are in [pipeline/LOCAL-ADAPTER.md](pipeline/LOCAL-ADAPTER.md).

---

## Requirements

Claude Code with subagents and claude.ai artifacts · Node 22.13+ · a 3echo Studio connector for images and video · an ElevenLabs connector for voice · FFmpeg and yt-dlp recommended · Python 3.10+ optional.
