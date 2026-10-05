---
name: write-caption
description: >-
  Writes the platform-native caption for one post on facebook, instagram or tiktok: line one wins line two, one idea, one CTA, hashtags at the platform count, disclosure inside the caption text, a provenance row for every claim, then a cleanup pass that subtracts and never adds. Use at the Posts and Ad copy stages for every post.md, when a editor raises R-VOICE, R-LIMIT or R-FACT on a caption, or when a post must be rewritten for a second platform.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Write Caption

## Inputs

- `drafts/D*/recipe.json`: the person's chosen pillar, angle, hook family and mechanism, call to action and hashtag set, in its `post` block. Required; without it, or while `brand/brand-voice.md` says `complete: false`, stop and report that the copy choices or the brand voice are not ready.
- `brief.md`: angle, core message, proof points with anchors, this D-id's deliverable row, `# CTA intent`, `objective`.
- `brand/brand-voice.md`, `brand/audience.md`, `brand/positioning.md`.
- `platform-rules/{platform}.md` json block: the `caption` and `hashtags` limits, `links.clickable_in_caption`.
- write-hook's winner (`hook_family`), write-cta's line (`cta_style`), both from the recipe.
- Video: the approved `drafts/D*/script.md`, for keyword and disclosure.
- Never raw `research/`; a brief gap is a brief problem, raise it.

## Steps

1. Create `drafts/D*/post.md` from the template, front matter first. Copy the recipe's `post` block: `recipe.pillar`, `recipe.angle`, `hook_family`, `hook_mechanism` and `recipe.cta_style` take its values exactly.
2. Pick the structure for `objective` below.
3. Line one: the write-hook winner, else run write-hook and put two runners-up in `hook_alternates`. It reads as the chosen mechanism.
4. Body: one idea, paragraphs of 1 to 3 sentences, white space between, paying off line one and never narrating the media. It serves the chosen angle and pillar.
5. Close on one write-cta line.
6. Hashtags last: exactly the recipe's `post.hashtags`, no more and no fewer, in `# Hashtags` and as a quoted list in front matter `hashtags` ("None" in the section when the chosen set is empty).
7. `# Disclosure`: exact words and placement. Paid partnership, gifted product, affiliate and AI-generated media sit in the caption text, not only a platform toggle.
8. `# Provenance`: each claim quoted against `research/{file}.md#{anchor}` or `brand/positioning.md#{anchor}`.
9. Cleanup, subtract only: AI-tell vocabulary, dashes, rule-of-three lists without concrete items, uniform rhythm, performed candour, manufactured stakes. Add no number, name, date, first person or stance.
10. Count against `caption.max_chars` and the cutoff.
11. Next platform: back to step 2, rewritten never pasted.

<!-- BEGIN test versions (0.14 task 4) -->
## Test versions (video posts only)

For a VIDEO post, add a `## Variants` section after `# CTA` and before `## Details` with two lines, each `v2 | hook: <text> | cta: <text>` (then `v3 | ...`).
Each line has a different hook line and a different call to action from the main post and from each other, in the same voice and under the same claim rules.
The caption, hashtags and media do not change, and the main post is the only one that is posted; the test versions are for ads or A/B tests.
Skip the section for a picture, carousel or text post.
<!-- END test versions -->

## Objective to structure

CTA style: see write-cta. Each opens on the hook, then:

- awareness: one sharp point, relatable close.
- engagement (comments): opinion or story, one answerable question.
- engagement (saves): stepped value, recap line.
- traffic: reason to click, one destination.
- leads: proof, offer.
- sales: proof, offer with a genuine reason to act now.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Line one is the hook and stands alone. Never open on the brand name, a greeting, a hashtag, a date or the image.
2. One caption, one message, one CTA.
3. A number beats an adjective, and every number has a `# Provenance` row; an unlisted claim is R-FACT.
4. Ceilings and visible cutoffs come from the limits block in `platform-rules/{platform}.md`; carry no number here or in your head.
5. Links are clickable on facebook, not instagram or tiktok, where the CTA points to bio, sticker, comment keyword or DM; never "click the link" where nothing is clickable.
6. Urgency only with a real deadline, batch or capacity limit in the text; manufactured urgency is R-VOICE.
7. Banned: everything in `playbooks/voice.md`, plus `brand/brand-voice.md`. 0 to 3 emoji, placed with intent.
8. No engagement bait: "double tap if", "comment YES", "tag 3 friends", "thoughts?".
9. For video the caption supports the hook in different words, never the spoken line; on instagram the script keyword is in the first sentence.
10. Audience language verbatim from `brand/audience.md`. Brand voice beats the brief; the conflict goes in Notes for the editor.
11. The pillar, angle, hook family and mechanism, call to action and hashtags are the person's choice from the recipe. A better idea is a note for the editor, never a swap.

## Output contract

One `drafts/D*/post.md` per platform, all of `templates/post.md` filled: `hook_family`, `hook_mechanism`, `hook_alternates`, `recipe.pillar`, `recipe.angle`, `recipe.cta_style`, `accessibility_text`, `# Caption` (hook line one, CTA last before hashtags), `# Hashtags` (the recipe's set), `# Provenance` (a row per claim), `# Disclosure` ("None" only when nothing applies), `# Notes for the editor`. platform-check.js recomputes `char_count` and `visible_cutoff_ok`, and fails a post that differs from its recipe or whose first line does not read as its hook mechanism.

## Boundary

Not this skill: write-hook, write-cta, write-script, storyboard, platform-format, fact-check, brand-check.

## Failure modes

- No provenance row: add the anchor or cut the claim, never soften it.
- Over `caption.max_chars` or past the cutoff: cut the body, not the hook, then re-count.
- Brief lacks the proof point: Notes for the editor, never `research/`.
- No recipe for the post, or the brand voice is unfinished: stop and report it; never fill the choices in yourself.
- Post differs from its recipe: copy the recipe's values back, never edit the recipe.

Numbers in this file are recorded with their provenance in `docs/sources/writing.md`.
