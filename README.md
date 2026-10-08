# Social Campaign

A Claude Code plugin that takes a brand and a brief and gives back finished social content: posts, Reels, ad creative, or a written research report.
Current version: 0.16.2.

You describe a brand once, on a page called the board.
You write a brief for a job.
Claude researches the audience and the competitors, proposes an idea, writes the script and the storyboard, prices any images and video, makes them, checks them, and writes the captions.
It **stops for you** at the idea, at the price, at the sample image, at the final post and at where and when it goes out.
With Metricool connected, it can then schedule the posts, save them as drafts or post them now, exactly as you approved them.
Without Metricool, or if you prefer, it gives you a posting kit to post yourself.

Nothing paid runs before you approve the price on the board.
Nothing is sent to Metricool before you approve the posting plan.
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
   |                          |  connect 3echo Studio, ElevenLabs,
   |                          |  Metricool (or skip)
   +------------+-------------+
                v
   +--------------------------+
   |  BRAND ONBOARDING        |  name, site, channels, what you know
   |  (once per brand)        |  research fills the blanks
   |                          |  colours, fonts read from the site      
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

Ten agents, one file each.
The producer dispatches and verifies.
No specialist can spawn another agent, because every specialist file sets `disallowedTools: Agent`.
Each specialist gets only the tools its stage needs.

| Role | What it owns | Skills it uses | Model |
|---|---|---|---|
| `producer` | Intake, dispatch, checking each file on disk, state changes, gates, media spend, hand-off, and sending the posts to Metricool | all of them, as the plan names them | Sonnet 5.5 |
| `researcher` | One research workstream per dispatch: audience, competitors, product evidence, brand onboarding, reports. The only agent with web search, page fetch and the social lookup tools | research, source-validation, write-report | Sonnet 5.5 |
| `strategist` | The brief: angle, audience, proof points, per-platform treatment | write-hook, write-cta, brand-check, source-validation | Fable 5.1 |
| `scriptwriter` | Concepts, the script and the storyboard with stable panel ids | write-hook, write-script, write-cta, storyboard, policy-check | Opus 5.5, for the whole run including the script and storyboard step |
| `copywriter` | Captions, hashtags, ad copy, one coherent pass per platform | write-hook, write-caption, write-cta, platform-format | Opus 5.5 |
| `creative-director` | The visual plan: the storyboard, every picture and clip prompt, the video script, and the new prompt for a picture or clip you send back. It never spends credits | storyboard, write-script, brand-check, platform-format, write-hook | Opus 5.5 |
| `media-buyer` | Paid campaigns only: ad requirements, campaign proposal, activation checklist | write-cta, platform-format | Opus 5.5 |
| `videographer` | Watching and breaking down source video, and checking rendered clips | watch-video, analyze-video, source-validation, write-report | Sonnet 5.5 |
| `editor` | Check-only review: facts, brand, policy, platform rules | fact-check, brand-check, policy-check, platform-format, source-validation | Opus 5.5 |
| `publisher` | The hand-off record after the posting approval. It never sends a post | publish | Haiku 4.5 |

The strategist uses Fable 5.1 because the brief is the file every later stage reads.
A weak angle is copied faithfully into the concepts, the script and the copy, where no gate will catch it.
The scriptwriter runs on Opus 5.5 throughout, including the script and storyboard step.

---

## Skills

Claude runs almost all of these itself.
Three are for you to type.

| Skill | You type it | Runs when |
|---|---|---|
| `/social-campaign` | Yes | The entry point. Opens the board, sets up a workspace if there is none, and asks "What do you want to get done?" in a box on the board |
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
| `publish` | No | After the posting approval: uploading media to 3echo, sending to Metricool, the posting kit and the hand-off |

---

## What you get

**A brand card that fills itself in.**
Give a name, a site and your channel links.
Research fills audience, market and positioning, brand voice, content pillars and competitors where you left them blank.
A field you typed, or cleared, stays as you left it.
Colours and fonts are read from the website and shown for you to edit, with fonts shown by their real names.
If the website gives no colours, they are taken from your social profile picture when FFmpeg is installed, and the card says where they came from.
The logo is your own upload; nothing is picked for you.
Competitors you name stay first, and research adds more up to three.
If the site does not say who the brand is for, research suggests an audience from its competitors and marks it Suggested, please check.

**Research with sources.**
Audience, competitors and product evidence, each claim traced to where it came from.
Competitor work covers at most three competitors.
Brand research uses the target market you name, and Singapore when you leave it blank.

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

**Posting, your way.**
Each post has its post type fixed when the job is planned, for example an Instagram Reel.
At the end you choose to schedule it with Metricool, save it as a draft there, post it now, or post it yourself from a posting kit.
Each posting time carries its time zone: the one set for the job, else the brand's, which follows its target market.
When no zone is known, the plan says so instead of guessing.
A hand-off package with the copy, media, schedule and a per-platform checklist is kept as the record, with a manifest.
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

<!-- pipelines:start -->

### Pipelines

Each kind of job below is its own pipeline.
This table is generated from the plugin's own registries, so it always matches what the plugin does.

| Pipeline | For | You give | Approvals | Who works on it | You get | Cost | Posts |
|---|---|---|---|---|---|---|---|
| Organic post | One finished social post for Facebook, Instagram or TikTok: the picture, the video, or a carousel of several pictures to swipe through, plus the caption and the posting details, ready for your approval. | The brand it is for; What it is meant to achieve; Whether it runs as organic posts, paid ads or both; Which platforms it is for; Which posts you need: the platform, the post type and how many; A photo of the product, when pictures or video are made | Pick a concept, Approve the storyboard, Approve the price, Check the sample, Approve the final post, Confirm where and when to post | Copywriter, Videographer, Researcher, Strategist, Scriptwriter, Creative Director, Editor | A delivery package for each post: the picture or video (or every slide of a carousel, in order), the caption, hashtags and the posting details, ready to schedule or post. | Credits are spent only when pictures or video are made, and you approve the price first. A carousel costs one picture for each slide. | Yes |
| Post series | A set of related posts planned together, so they read as one campaign across platforms and days. | The brand it is for; What it is meant to achieve; Whether it runs as organic posts, paid ads or both; Which platforms it is for; Which posts you need: the platform, the post type and how many; A photo of the product, when pictures or video are made | Pick a concept, Approve the storyboard, Approve the price, Check the sample, Approve the final post, Confirm where and when to post | Copywriter, Videographer, Researcher, Strategist, Scriptwriter, Creative Director, Editor | A delivery package for each post in the series: the pictures or video, the captions, hashtags and the posting details. | Credits are spent only when pictures or video are made, and you approve the price first. | Yes |
| Creator-style video | A short video that looks like a customer or creator talking to the camera: ideas to pick from, a script, a storyboard and the finished video. | The brand it is for; What it is meant to achieve; Whether it runs as organic posts, paid ads or both; Which platforms it is for; Which posts you need: the platform, the post type and how many; A photo of the product, when pictures or video are made | Pick a concept, Approve the storyboard, Approve the price, Check the sample, Approve the final post, Confirm where and when to post | Scriptwriter, Videographer, Researcher, Strategist, Creative Director, Copywriter, Editor | The finished video with its caption and the posting details, in a delivery package. | Credits are spent to make the video. You approve the price, then check a sample, before the rest is made. | Yes |
| Paid ad campaign | Ad creative and a campaign plan for paid social: audience, budget, placements and the setup steps. Nothing is switched on for you. | The brand it is for; What it is meant to achieve; Whether it runs as organic posts, paid ads or both; Which platforms it is for; Which posts you need: the platform, the post type and how many; A photo of the product, when pictures or video are made | Pick a concept, Approve the storyboard, Approve the price, Check the sample, Approve the final post, Approve the campaign plan, Approve going live | Media buyer, Videographer, Researcher, Strategist, Scriptwriter, Creative Director, Copywriter, Editor | The ad creative, the campaign plan and a checklist of setup steps for your ad manager. | Credits are spent only when pictures or video are made, and you approve the price first. | No |
| Repurpose a video | Turn a video you already have into new posts for other platforms, with new cuts and captions. | The brand it is for; What it is meant to achieve; Whether it runs as organic posts, paid ads or both; Which platforms it is for; Which posts you need: the platform, the post type and how many | Approve the storyboard, Approve the price, Check the sample, Approve the final post, Confirm where and when to post | Copywriter, Videographer, Researcher, Strategist, Editor | New cuts of your video with captions and the posting details, in a delivery package. | Credits are spent only when something new has to be made, and you approve the price first. | Yes |
| Post something I already have | Post a finished picture, a set of pictures or a video you already have, exactly as it is, with your own caption or one Claude writes. Nothing is researched or made, and no credits are spent. | The brand it is for; Which platforms it is for; The pictures or video to post (one video, or up to 35 pictures), given to Claude in chat | Approve the final post, Confirm where and when to post | Publisher, Copywriter | Your pictures or video with the caption and the posting details, scheduled or saved as a draft in Metricool, or with a posting kit so you can post it yourself. | No credits. Nothing is made, so nothing is priced. | Yes |
| Research | A written report about a product, a brand or its competitors, with a source for every claim. | Nothing required | Review the report | Researcher | A report you can read on the board and download. | No credits | No |
| Post or campaign analysis | A written report on why a post or campaign works or does not, from the links or files you give. | At least one link or file to look at | Review the report | Researcher, Videographer | A report you can read on the board and download. | No credits | No |
| Video breakdown | One video taken apart scene by scene: the shots, the spoken words, the on-screen text and how it is built from hook to call to action. | A video to break down, as a link or a file | Review the report | Videographer | A report with a still for each scene, which you can read on the board and download. | No credits | No |

Some approvals appear only when they apply, for example the price check only when pictures or video are made.

<!-- pipelines:end -->

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
| Posting through Metricool, or the posting kit | No credits |
| Hand-off record | No credits |

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
In a Social Campaign workspace, paid images, video and voice are made only inside a job, so every credit is tied to an approved price.
An item that failed at 3echo can be made again; one that was made needs a redo, priced again.

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

### 2. Updating an earlier install

Update the marketplace, then the plugin.
This also works for a copy installed before the repository was republished.

```bash
claude plugin marketplace update 3echo-social-campaign
```

```bash
claude plugin update social-campaign@3echo-social-campaign
```

Then open a new chat.
Your workspace, brands and jobs are kept, because they live in your working folder and not in the plugin.
If the update reports an error, remove the marketplace with `claude plugin marketplace remove 3echo-social-campaign`, then add and install it again as in step 1.

### 3. Dependencies

A hook checks these each time a session starts and says what is missing.

**Required:** Node 22.13 or later.
The plugin has no npm packages to install.
If Node is older, the start of the session says so.

**Recommended:** FFmpeg, for video and audio.
`winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on a Mac.
Without it video work cannot be analysed, and clips are delivered numbered instead of joined into one cut.
It is also what reads colours from a social profile picture when a website gives none.

**Recommended:** yt-dlp, for TikTok posts and video addresses.

**Optional:** a browser-driven research helper, for sites that show almost nothing to a plain page fetch.
It needs Python 3.10 or later, and it installs itself in the background once your workspace is set up.
Nothing else waits for it.
`/social-campaign:doctor` reports on it and offers a repair.

### 4. Connect 3echo Studio, ElevenLabs and Metricool

They connect through your own claude.ai connectors.
Add them in claude.ai under Settings > Connectors.
The plugin has no sign-in of its own and stores no keys.

- 3echo Studio makes images and video, and hosts the media of a post so Metricool can fetch it.
- ElevenLabs makes voice lines.
- Metricool schedules, saves as drafts and posts to Facebook, Instagram and TikTok. It is optional: without it, you get a posting kit and post yourself.

Setup detects a connector you already added and shows it as Connected.
It asks about 3echo Studio and ElevenLabs when they are missing, each with Connect or Skip for now.
A skipped connector is asked about again only when a stage needs it.
Metricool never holds setup up: its card stays on the board, and you can connect it any time.
With one Metricool brand, your brand uses it.
With several, Claude asks which one each of your brands posts through.
Text-only jobs and all research jobs need none of them.

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
On the board, fill in the brand form once: the name, the website, Facebook, Instagram and TikTok links, the target market if it is not Singapore, and anything you already know about the audience, positioning, voice, content pillars and competitors.
Each link can be marked Not available.
Upload a logo if you have one, and add colours and fonts if you already know them.
Click Start onboarding.

Research then fills the blanks.
Claude tells you which fields it filled and which are only suggestions to check.
Look over the card and click Save and continue.

### First job

Type what you want to get done in the box on the home page or in Needs you, or click **+ New job**.
Choose a brand if it is for one, and add links if you have them.
Give Claude any files in chat after you send it.
Claude reads your words and picks the pipeline that fits, and the job page says which one and why.
It fills in every field your words and the brand profile already answer.
It asks only for what is genuinely missing, one plain question at a time.
Your original files are copied in and left untouched.
A picture of a character you upload is treated as not yours until you say it is, so the post carries the right disclosure.

For a first run, one organic text-only post is the smallest test.

### Reviews and approvals on the board

The board opens beside the chat.
Each stage shows in plain words, and the current decision shows on the job.

- **Pick a concept**, and any copy choices that come with it.
- **Approve the storyboard**, panel by panel.
- **Approve the price.** The total and each item are shown.
- **Approve the sample image**, before the rest is made.
- **Approve the final post.** Any label or logo item found is shown with Accept as is.
- **Confirm where and when to post.** See below.
- **Approve the report**, for the three report kinds.

Ask for changes on any of them and the job goes back to that stage with your note.

### The Agent Box

On a job page, **Agents on this job** lists the Director first, then each agent working on it.
Each one shows its state (Needs you, Working, Waiting, Up next or Done), what it is doing, and its files.
The Director card holds everything waiting on you: decisions, questions and anything stuck.
Use **Message this agent** to write to one of them.
The Director answers in a line, and the message shows as Sent, Delivered or Answered.
A message never approves, spends or posts: use the board buttons for that.
If a job gets stuck, the Director asks you in chat and on the board, and the first answer counts.
If something goes wrong on our side, press **Try again**.
The **Needs you** list on the home page shows what is waiting on you across every job.

### Where and when it goes out

At **Confirm where and when to post** you pick one:

- **Schedule with Metricool**, the default. Each post goes out at its planned time.
- **Save as a draft in Metricool.** You publish it from Metricool.
- **Post now.** Each post goes out within a few minutes of your approval, and the approval is good for 24 hours.
- **I'll post it myself.** A posting kit: a 3echo download link for each file, Copy caption, Copy first comment, a checklist and Mark as posted.

Checks run before you can Approve: the channel is linked, the media fits the post type, the caption and title rules, a time in the future and the file size.
Approve covers exactly the plan you see.
If a post changes afterwards, you approve again.

After Approve, Claude uploads the media to your 3echo Studio workspace and sends each post to Metricool.
A guard lets through only calls that exactly match the approved plan.
The board shows each post as Scheduled, Posted with View post, Failed, Late, Waiting for you in the Metricool app, or Check in Metricool.
When Claude cannot tell whether a post reached Metricool, it asks you, and only your answer "It is not in Metricool" allows a resend.

Nothing is changed after the first send.
You change or cancel a scheduled post in Metricool itself.
An approved plan can be reopened only while nothing was sent or marked as posted.
Jobs planned before 0.8 get the posting kit only.

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

### The board

The board is the decision surface.
It shows what needs you, the brands, every job with its stages and outputs, the decision waiting on you, and the usage footer.

It is a private page on your claude.ai account.
Your decisions come back to Claude as saved requests, and Claude applies them.
While a chat is open Claude picks them up as they arrive.
If a chat was closed, the next session sweeps what was saved.

Your source files and local file paths stay on your computer.
Only after you approve a posting plan are the files of its posts uploaded to your own 3echo Studio workspace.
Small review copies of images and clips are uploaded to your private board so you can view them there.
They are removed after the final approval, or when the job is cancelled.

The bundled runtime under `pipeline/` owns routing, plans, state changes and approvals.
Its local overrides are in [pipeline/LOCAL-ADAPTER.md](pipeline/LOCAL-ADAPTER.md).

---

## Requirements

Claude Code with subagents and claude.ai artifacts · Node 22.13+ · a 3echo Studio connector for images, video and post media · an ElevenLabs connector for voice · a Metricool connector to schedule posts (optional) · FFmpeg and yt-dlp recommended · Python 3.10+ optional.
