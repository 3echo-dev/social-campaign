---
name: write-script
description: >-
  Writes a short-form UGC video script into templates/script.md: timed beats whose durations sum to target_duration_s and whose words equal duration x 2.5, a spoken line and different on-screen text per beat, silent action beat, product moment, disclosure, and voice notes reused verbatim in every generation prompt. Use at the Concepts, Script and board, and Cut plan stages for every video deliverable, and when a editor raises R-HOOK, R-SHOT or R-TIMING on a script.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Write Script

**Purpose:** Turn an approved concept into a beat table a storyboard can panel and 3echo can render.
**Used by:** scriptwriter, copywriter (repurpose-video).

## Inputs

- Approved `concepts.md`: persona, hook triple, narrative pattern, proof pattern, product moment, CTA, disclosure, target duration. Nothing scripted before approval.
- `brief.md` proof points with anchors; `brand/brand-voice.md`; `brand/audience.md`.
- `platform-rules/{platform}.md` json: `video.recommended_min_seconds/max_seconds`, `video.max_seconds`, `disclosure`.
- `playbooks/hooks.md`; write-hook's winner; write-cta's close; repurpose: `research/video-analysis.md` timestamps.

## Steps

1. Create `drafts/D*/script.md`; `target_duration_s` in range (tiktok 21 to 34 s; instagram/facebook 15 to 90 s, instagram ceiling 180 s); `words_per_second: 2.5`.
2. `# Premise`: one sentence, one idea. Time: hook 10%, setup 25%, demo 30%, proof 25%, CTA 10%.
3. Beats: 10 s = 2 to 3, 15 s = 3 to 4, scale proportionally, whole seconds summing to `target_duration_s`, one jump cut per beat. Editorial beats may be shorter than 4 seconds; the storyboard groups them when a provider clip needs the 4 to 15 second range.
4. Words per beat = duration x 2.5, rounded down; silent = 0.
5. Beat 1 = hook triple: motion or expression in the first 2 s, one-breath spoken line, different on-screen text, no product.
6. On-screen text first, 3 to 7 words, sound-off story; spoken lines to budget: first person, contractions, fragments, one filler or self-correction. One beat `(silent)` with an action.
7. Product named once or twice, never a pivot. Search keyword in beat 1 spoken/on-screen and the caption's first sentence.
8. New visual every 4 to 6 s; on-ramp extends the hook; close recontextualises frame one. Last beat = CTA line, ask on screen too.
9. `# Voice notes` once, reused verbatim; on a `talkingCharacter` deliverable, one voice description per character (accent, age, tempo, manner), and each beat's spoken line is that clip's dialogue, one speaker per beat. `# Claims in this script`: every claim and anchor; `disclosure`: exact text, AI creators always disclosed. Read aloud; cut words rather than speed up if it does not fit. Write `Total:`.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Beats sum to `target_duration_s`; spoken words are at or under duration x 2.5, within 2 words. Generated provider clips, not edited beats, must be 4 to 15 seconds.
2. Sentences of 15 words or fewer; at most 2 key points. Spoken line and on-screen text never share words in a beat; caption never repeats the spoken hook.
3. Numbers spoken as words, shown as digits, each with a claim row.
4. Refused: greeting, self-introduction, logo or slow zoom, "in this video", ALL CAPS, stacked asks, hook-as-setup, stating the conclusion instead of showing proof.
5. Refused everywhere: `playbooks/voice.md` plus `brand/brand-voice.md`. No dashes on screen; a line break beats a comma.
6. Eligible: original footage, no watermark, audio present, under `video.max_seconds`, one clear niche.
7. Payoff delivers what beat 1 promised; bait-and-switch is R-FACT.
8. Disclosure is exact text and its location, not a toggle; synthetic people always disclosed. Clips render 4 to 15 s; storyboard groups beats, never stretched to fit.

## Output contract

`templates/script.md` filled: front matter `platform`, `concept`, `persona`, `target_duration_s`, `words_per_second`, `hook_family`, `hook_mechanism`, `disclosure`; `# Premise`; `# Beats` table complete; `Total:` line; `# Voice notes`; `# Claims in this script`. `# Decision` stays empty.

## Boundary

Does not write the hook, CTA or caption (write-hook, write-cta, write-caption), panels or manifest (storyboard), render or QA, or check disclosure (policy-check).

## Failure modes

| Failure | Fix |
|---|---|
| Beats do not sum to `target_duration_s` | Rebalance; adjust the silent beat first |
| Words exceed duration x 2.5 | Cut filler, never raise the pace |
| On-screen text repeats the spoken line | Rewrite as a second angle |
| `disclosure` empty for an AI creator | Fill exact text and position first |

Numbers in this file are recorded with their provenance in `docs/sources/writing.md`.
