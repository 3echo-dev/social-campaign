---
job: {job-id}
brand: {brand}
version: 1
status: draft                 # draft | approved | superseded
use: organic                  # organic | paid; paid adds the hook test matrix, primary text and headline
concepts: 3
credits_quoted: 0             # images at 1 credit each, video per estimate_video_job
credits_ceiling: 0            # from workspace.json creditCeilingPerJob
created: YYYY-MM-DD HH:MM {tz}
---

## What you're deciding

**This is:** {one line: what it is, for whom, on which platform}
**Decide:** approve · change {what} · start over
**Next:** {what happens after you approve, and what it costs}
**Spent so far:** {n} of {ceiling} credits

---

# Concepts for {job-id}

Open the card with the strategy the person approves here, from the brief, one line each: industry, viewer problem, awareness stage, ad style, funnel stage, CTA, proof moment, honest trade-off, and any sharpened message. The person can change any of them with the concept pick.

Concept A comes from the brand (the bank's proven items, the person's own items and its own best posts), Concept B from top competitors, Concept C from what is trending, each with its evidence.

Each concept comes from a different insight. Ranked, with a recommendation. No script and no media exist yet.
Every concept names one value for each idea part (anchor, stage, angle, format, hook family, mechanic). Concepts in one set differ in at least one part, and the "Why this differs" line in the brief's deliverable map says which.

## Concept A: {title}  (recommended)

- In one line: {the idea in one plain sentence, under 25 words; the board shows it first on the card}
- Source: from the brand | from top competitors | from what's trending, with the posts it rests on (link, views, date)
- Insight it rests on: `research/{file}.md#{anchor}`
- Anchor: "{the pain or desire, in the audience's own words}"
- Awareness stage: {unaware | problem_aware | solution_aware | product_aware | most_aware} (playbooks/awareness-stages.md)
- Angle: {A-* id} - {the angle in one sentence} (playbooks/angles.md)
- Subtopic: {one of the brand's six subtopics: its id and name} (workspaces/{brand}/library/intelligence/subtopics.json)
- Format: {F-* id and name from the format library} (pipeline/library/formats.json)
- Editing style: {E-* id and name} (pipeline/library/formats.json)
- Visual hook: {V-* id and name} (pipeline/library/formats.json)
- Visual format: {F-* id} (playbooks/visual-formats.md; the container the stage pairing table reads)
- Attention mechanic: {M-* id} (playbooks/attention-mechanics.md)
- Micropersona (optional): the narrower group inside the segment, by life context, with the words they use
- Creator persona (UGC only): who is speaking, why they are credible, their setting
- Hook, family {H-* family} (spoken / on-screen text / opening visual, three different things):
- Narrative pattern: setup, demonstration, proof, verdict
- Proof pattern: what makes the claim believable on screen
- Product moment: when the product first appears and how (never in the first shot)
- Ad style: {AS-* id} (playbooks/ad-styles.md)
- Hook options (first 2 seconds, pick one): 1) {line} 2) {line} 3) {line}
- Problem line (by 10 s):
- Loop: {what opens} at {s}, paid off at {s}
- Beats and takeaways: 1) {beat} - {takeaway} 2) ... 3) ...
- Proof moment:
- Honest trade-off:
- Camera and sound:
- CTA: {CTA-* id} - {the line}
- Disclosure (UGC only): AI-generated creator, paid partnership, or gifted, and where it sits
- Target duration:
- Why this wins:
- Rubric pre-score: hook {n}/10, problem {n}/10, takeaways {n}/10, proof {n}/10, loop {n}/10, trade-off {n}/10 (playbooks/creative-rubric.md)
- Ranking: written by `rank-concepts.js`, never by hand

## Concept B: {title}

(same fields)

## Concept C: {title}

(same fields)


## Paid only

Filled only when `use: paid`; on an organic job every cell stays empty.

| Concept | Hook variants to test (one per hook family) | Primary text | Headline |
|---|---|---|---|

## Details

Everything below is the record: front matter, provenance, continuity and codes.
It is here so the decision above stays readable.

# Media quote

| Concept | Panels (images, 1 credit each) | Video clips (estimate_video_job) | Total credits |
|---|---|---|---|

Ceiling for this job: {credits_ceiling}. Nothing is generated before the storyboard is approved.

# Decision

Pick one, pick one with changes, write your own, or send all back. Never written by the agent.
