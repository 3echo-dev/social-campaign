# Strategy

Read by `strategist` when turning research into a brief.

## Content pillars

Three to five recurring themes per brand, decided at onboarding and stored in `brand/platform-playbook.md`. Every brief names the pillar it serves. A deliverable that fits no pillar is either a new pillar or should not be made.

A workable default shape until the playbook says otherwise:

| Pillar | Purpose | Rough share |
|---|---|---|
| Proof | results, cases, numbers, demos | 30% |
| Teach | how-to, frameworks, mistakes | 30% |
| Perspective | opinion, industry take, contrarian | 20% |
| Product | features, launches, offers | 15% |
| Human | behind the scenes, team, process | 5% |

Tune the shares per brand and record the intended mix in the playbook.
No pillar takes more than 60 percent of a week, and trend rides are seasoning, 1 to 2 a week.

## content_repurpose yields

One source, many deliverables. The map, not a guess:

| Source | Yields |
|---|---|
| Long article or blog post | 1 carousel (the framework), 3 to 5 single posts (one idea each), 1 short video (the strongest single point), 1 quote card |
| Video or podcast | 3 to 5 clips, 1 transcript-derived carousel, 2 to 3 quote posts, 1 lessons-learned post |
| Customer conversation | 1 objection-handling post, 1 verbatim-language post, 1 case snippet, with permission |
| Product update | 1 announcement, 1 "why we built it", 1 demo video, 1 before and after |

Rules: one idea per deliverable, never a summary of the whole source; each must stand alone without the source; the source is cited in the brief so the fact-checker can trace every claim.

## Calendar shape

The brief carries a calendar, not a pile of posts. Per item: date, time with zone, platform, pillar, format, hook family.

- Cadence is a decision recorded in `workspace.json` and `brand/platform-playbook.md`, not an ambition. Three good posts a week beats seven mediocre ones, and the pipeline costs per deliverable.
- Never schedule the same post to facebook, instagram and tiktok unchanged. Write per platform, always.
- Leave one slot a week unplanned for reactive content.
- Batch by pillar, not by platform. It keeps the voice consistent within a run.

## What makes a brief good

A brief the writer executes without asking a question:

1. **Angle**: the specific claim or story, in one sentence. Not a topic.
2. **Audience**: which segment from `brand/audience.md`, what they already believe, and what this changes.
3. **Core message**: one sentence, plus at most three supporting points.
4. **Proof points**: each with provenance to `research/` or a brand file, and a label. No source, not a proof point.
5. **Per-platform treatment**: what each platform gets and why it differs from the others.
6. **Hook family**: an `H-*` tag from `hooks.md`, per deliverable.
7. **CTA intent**: one action, specific and performable, per platform.
8. **Calendar**: dates and times with zones, inside the cadence.
9. **Intended outcome**: the business objective, with any user-supplied target labelled as a target rather than a forecast.
10. **Out of scope**: what this brief deliberately does not cover.

## What the strategist refuses to do

- Write a brief with no proof points. Raise `R-EVIDENCE` with a **specific gap list**, for example "no published pricing for competitor X", "no customer language for the 'too expensive' objection", never "research was inadequate".
- Carry a claim forward that has no source in `research/` or a brand file.
- Reuse an angle used in the last 30 days without saying so explicitly.
- Plan more deliverables than the cadence allows.
- Stack several messages into one deliverable. One brief, one angle, one CTA.
- Rest an angle on a hunch when the research offers customer verbatim or a competitor pattern.

## Optional historical context

Use an existing approved historical record only when the task contract supplies it and its source, date, audience, objective, platform and format apply to the brief.
Preserve its confidence and limitations; it is not a declared brand fact.

Keep `learnings_used: []` when no applicable historical record is supplied.
Missing historical files never block production or trigger a new analysis task.
Brand onboarding and accepted research remain the sources for current brand context.

Numbers in this file are recorded with their provenance in `docs/sources/research.md`.
