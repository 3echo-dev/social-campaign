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

Each concept comes from a different insight. Ranked, with a recommendation. No script and no media exist yet.

## Concept A: {title}  (recommended)

- Insight it rests on: `research/{file}.md#{anchor}`
- Creator persona: who is speaking, why they are credible, their setting
- Hook (spoken / on-screen text / opening visual, three different things):
- Narrative pattern: setup, demonstration, proof, verdict
- Proof pattern: what makes the claim believable on screen
- Product moment: when the product first appears and how (never in the first shot)
- CTA:
- Disclosure: AI-generated creator, paid partnership, or gifted, and where it sits
- Target duration:
- Why this wins:

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
