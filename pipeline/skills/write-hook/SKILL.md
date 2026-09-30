---
name: write-hook
description: Writes the opening of a post or video as three components (visual action, spoken line, on-screen or caption text) across several hook mechanisms, scores them, picks one and tags it with an H-* family. Use whenever a brief, concept, post or script needs its first line or first three seconds, when a editor raises R-HOOK, or when a draft's hook_family is empty.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Write Hook

**Purpose:** Produce one chosen hook, its runners-up and H-* tag from the strongest true element of the material.
**Used by:** strategist, scriptwriter, copywriter.

## Inputs

- `drafts/D*/recipe.json`: the person's chosen `post.hook_family`, `post.hook_mechanism` and `post.angle`. Required for a post or script hook; without it, stop and report that the copy choices are not picked yet.
- `brief.md`: angle, audience, proof points with anchors, objective, deliverable map row.
- `brand/brand-voice.md` (banned words); `brand/audience.md` (customer language).
- `playbooks/hooks.md`: families, mechanisms, goal map, shapes.
- `platform-rules/{platform}.md` json: `caption.visible_cutoff_chars`, `caption.ideal_max_chars`.
- Video: `concepts.md` persona, target duration.

At the concept step, before any recipe exists, this skill only drafts one example first line per hook family option; it never chooses the family for a post.

## Steps

1. Mine the material for its strongest true element: surprising result, highest cost, specific number, sharpest view, relatable moment, each with a source anchor. No anchor, no hook.
2. Read the visible cutoff from the limits block in `platform-rules/{platform}.md`, the only authority. Video's surface is the opening seconds, not a character count.
3. Take the family and mechanism from the recipe; never choose another. At the concept step, shortlist families for the options from the goal table. Cell: segment x motivation (audience words) x format.
4. Write 5 to 10 candidates in the chosen family: the winner's candidates in the chosen mechanism, runners-up may use the family's other mechanisms; ten rewordings of one count as one. Video: three components (visual, spoken line, on-screen text); post: two (visual, first line). Never repeat words across components.
5. Score: real gap; specific; true to the body; inside the cutoff; sounds like the brand; a stranger needs the next beat; reads as its mechanism (a question mechanism asks with a question mark, a number-led one carries a real number). Drop failures.
6. Pick one in the chosen mechanism; record `hook_family` and `hook_mechanism` exactly as the recipe says, two runners-up as `hook_alternates`.
7. Check the on-ramp (seconds 3 to 15 on video, line two of a caption) extends the hook's premise; a pivot to the pitch means rewriting the on-ramp.

## Opening moves

| Move | Shape | Fails when |
|---|---|---|
| Curiosity gap | withhold the noun, promise the answer | payoff never arrives |
| Bold claim | specific, falsifiable statement | unsubstantiated |
| Confession | "I was doing [thing] wrong" | no lived-in detail |
| Before and after | two states in one beat | not visually honest |
| Question | the exact buyer phrasing | not in their words |
| Proof first | receipt, stat, demo shot | no provenance |

## Rules

1. The hook is extracted from the content, never bolted on; a hook the body cannot pay off is R-FACT, not R-HOOK.
2. Spoken line and on-screen text carry different words toward one promise; a muted viewer relies on the text.
3. Spoken line is one breath; on-screen text is 3 to 7 words. Say the number aloud too.
4. Frame one shows the result, tension or interrupt; a reason to stay by 3 s.
5. Refused: greeting, "in this video", logo or slow zoom, reading the caption aloud, ALL CAPS, a self-answering hook, brand name unless it is the story.
6. Prefer odd figures over round, "How I" over "How to"; never invent a number. No AI-tell vocabulary, no dashes on screen; never the same hook on two platforms.
7. H-CONTRARIAN, H-PROOF only with evidence in `research/`.
8. The family and mechanism are the person's choice from the recipe. A better idea in another family is a note for the editor, never a swap.

## Output contract

Front matter: `hook_family` and `hook_mechanism` exactly as `recipe.json` `post` says, `hook_alternates` (two lines). Video: components fill beat 1 of the script, panel 1 of the storyboard. Post: chosen line is line one of `# Caption`. `brief.md`/`concepts.md`: `| # | Family | Mechanism | Visual action | Spoken line | On-screen or caption text | Source anchor |`.

## Boundary

Does not write the caption, CTA or beats after beat 1 (write-caption, write-cta, write-script). Does not verify claims or count characters (fact-check, platform-format).

## Failure modes

| Failure | Fix |
|---|---|
| Ten rewordings of one line | Regenerate across the family's mechanisms, the winner in the chosen one |
| No recipe for the post | Stop and report that the copy choices are not picked yet |
| First line does not read as its mechanism | Rewrite the line, never the tag |
| Spoken line and on-screen text match | Rewrite one as a second angle |
| Hook promises what body never delivers | Change the hook, not the truth |
| Hook past the visible cutoff | Cut to the json figure |

Numbers in this file are recorded with their provenance in `docs/sources/writing.md`.
