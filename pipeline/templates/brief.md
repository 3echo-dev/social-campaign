---
job: {job-id}
brand: {brand}
version: 1
status: draft                 # draft | approved | superseded
pillar: proof                 # from brand/platform-playbook.md
angle: ""                     # one sentence: a specific claim or story, never a topic
angle_id: A-STATUS-QUO-COST   # which strategy the angle uses, from playbooks/angles.md
anchor: ""                    # the one pain or desire this rests on, quoted in the audience's words
awareness_stage: problem_aware # playbooks/awareness-stages.md: unaware | problem_aware | solution_aware | product_aware | most_aware
objective: engagement
distribution: organic
created: YYYY-MM-DD HH:MM {tz}
learnings_used: []            # optional supplied historical IDs; otherwise []
brand_files_reviewed: true    # false when onboarding was accepted as drafts
---

## What you're deciding

**This is:** {one line: what it is, for whom, on which platform}
**Decide:** approve · change {what} · start over
**Next:** {what happens after you approve, and what it costs}
**Spent so far:** {n} of {ceiling} credits
{Delete this line unless the reference evidence fell short of what was asked: **References:** {n} of {N} verified, {why the rest were blocked}, and you chose {paste links / continue with what was found}.}
{Delete this line unless brand_files_reviewed is false: **Brand files are unreviewed drafts,** so the voice here is a guess. Tell me what is off and it gets fixed for every job after this one.}

---

Fill every section from the approved direction in `job.json` (`direction`) first. Research fills only what the direction leaves open. Never change the topic.
The direction's message is a working line: when research shows a sharper line in the audience's own words, propose it under Core message as "Sharpened", with the reason, and the person approves it at the strategy gate. Never change it silently.

# Angle

One sentence. "Our booking assistant recovers the bookings you lose to missed calls" is an angle. "Booking software" is a topic.

# Anchor

The one pain or desire this content rests on, quoted in the audience's own words, with its source and the awareness stage it was spoken from.

> "{verbatim words}" - source: `brand/audience.md#{anchor}` or `research/{file}.md#{anchor}` - stage: {awareness_stage}

# Audience

Which segment from `brand/audience.md` (the direction's audience when it is narrower), what they already believe, and what this content changes.

**Tension:** what they want against what stops them, in their words.

# Viewer problem

The one problem the viewer has, in their role and their words, spoken in the content by 10 seconds and before the product is explained.
Take it from the problem bank in `research/audience.md`, label it FACT, INFERENCE or HYPOTHESIS, and say how a HYPOTHESIS gets tested.
A happy testimonial is not a problem; when the only quotes are positive, name the cost they imply (time, money, stress, risk).

# Ad style, funnel stage and CTA

- Industry: {tag} from the tag list in `playbooks/ad-styles.md`, from `brand/profile.json` `industry` when set, else inferred from the brand files and marked inferred, so the person can correct it at the strategy gate.
- Ad style: {AS-* id} from `playbooks/ad-styles.md`, filtered by the brand's industry.
- Funnel stage: TOFU | MOFU | BOFU, and why it fits the direction's success measure.
- CTA: {CTA-* id} from `playbooks/ctas.md`, matching the funnel stage.

# Honest trade-off

One real limit or cost of the product, said plainly, which builds trust. It is never the main benefit restated.

# Proof moment and numbers

- Proof moment: the one thing the viewer sees working (a real screen, a built artefact, a sourced claim shown with its source), and whether it is real or rebuilt.
- Numbers to use: 2 to 4 concrete numbers from the number bank in `research/product-evidence.md`, each with its source.

# Message budget

How often the core message may be said: once spoken and once on screen by default, carried by the structure the rest of the time.

# Supply questions

Every fact or asset only the person can give (real screens, an example result, a price, an account, an accent colour), each with a likely answer.
The Director asks these on the board before the concepts are written, not after the script.

# Core message

The one thing to say, from the direction's message. One sentence, plus up to three supporting points.

# Tone for this job

How this piece should sound, from the brand voice and the direction.

# Keep from the reference, change for us

Delete this section unless the job has a reference video. A reference video sets the format, never the topic.

- Keep: the reference's look, structure and pacing.
- Change: the subject (this job's topic), the hook line, the steps and the ending.

# Proof points

These are the reasons to believe the message. Each with provenance to a research file or brand file. A bullet with no source is not a proof point.

- {claim} - source: `research/{file}.md#{anchor}` - label: FACT | OBSERVATION | INFERENCE

# Deliverable map

| ID | Platform | Count | Format | Role in the set | Stage | Visual format | Hook family | Mechanic | Why this differs from the others |
|---|---|---|---|---|---|---|---|---|---|
| D1 | | | | | | | | | |

# CTA intent

What the viewer should do (the direction's call to action), and the CTA style per platform.

# Required and prohibited elements

The mandatories: the direction's must say and must not say come first.

- Required:
- Prohibited (from `brand/positioning.md` claims we never make, plus this job):

# Schedule

| Deliverable | Publish at (zone) | Platform | Notes |
|---|---|---|---|

# Success looks like

The direction's success measure first. Which metric, roughly what number, judged at which checkpoint (24h, 72h, 7d).

# Out of scope

What this brief deliberately does not cover.

# Evidence gaps

Raised as R-EVIDENCE with a specific list, never "research was inadequate".

# Changelog

- v1 YYYY-MM-DD created
