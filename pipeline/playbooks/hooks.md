# Hooks

Hook families are the `H-*` tags every post and script carries in `hook_family`. Analytics joins metrics on the tag; a draft without one teaches nothing. `write-hook` picks the family, writes the candidates and records the mechanism in `hook_mechanism`.

## Where the hook lives

| Platform | Hook surface | Cutoff |
|---|---|---|
| instagram | first caption line | 125 chars |
| tiktok | first 1 to 3 s of video (visual, spoken, on-screen text); the caption reinforces with different words | 150 chars |
| facebook | first line | 40 to 80 chars |

If the hook needs the reader to already care, it is not a hook.

## Families

| Family | Mechanisms (`hook_mechanism`) | Serves | Guard |
|---|---|---|---|
| H-CURIOSITY | curiosity_gap, pattern_interrupt, timeliness | completion, comments | The loop closes inside the post or video. An unclosed loop is clickbait and costs trust. |
| H-VALUE | specificity, listicle_promise, tutorial_cold_start | saves | The number and the timeframe are real and appear in the body. |
| H-STORY | in_medias_res, confession, transformation | completion | Needs a genuine, specific incident. An invented anecdote is R-FACT. |
| H-CONTRARIAN | contrarian, myth_bust | shares, comments | Only with evidence in `research/`. Highest variance: strong engagement, or an argument you did not want. |
| H-PROOF | cold_open_result, authority_proof, stakes_cost | completion, conversion | Every figure has provenance to a `research/` file. Fails fact-check fast when the number is soft. |
| H-UTILITY | framework, checklist, copyable_artifact | saves | Deliver the artefact in the post. A promise plus a gated link is a different, weaker format. |
| H-QUESTION | question, identity_callout, relatable_callout | comments, shares | Answerable in under five words. Open-ended questions get silence. |

## Shapes per family

H-CURIOSITY
- "The [thing] nobody mentions about [topic]"
- "I tried [thing] for [timeframe]. Not what I expected."
- "The reason [common approach] doesn't work is..."

H-VALUE
- "How to [outcome] in [specific timeframe]"
- "[Number] [things] that [benefit]"
- "The fastest way to [outcome] without [common cost]"

H-STORY
- "Last [timeframe] I [specific event]."
- "A customer asked me [question]. I didn't have an answer."
- "We got this wrong for [duration]."

H-CONTRARIAN
- "[Popular advice] is wrong for [audience]."
- "Stop [common practice]. Do [alternative] instead."
- "Everyone says [X]. Our numbers say [Y]."

H-PROOF
- "[Specific number] [unit] in [timeframe]."
- "Here's exactly what [outcome] cost us."
- "We tested [N] versions. This is what happened."

H-UTILITY
- "Save this for the next time you [situation]."
- "The checklist we use for [task]."
- "[Template/script/prompt] you can copy."

H-QUESTION
- "What would you do with [constraint]?"
- "Which of these two would you pick?"
- "If you're a [specific person] doing [specific thing], stop."

## Goal to family

| Goal | Reach for first | Avoid |
|---|---|---|
| completion (video watch-through) | H-PROOF (cold_open_result), H-CURIOSITY (pattern_interrupt), H-STORY (in_medias_res) | H-QUESTION alone |
| saves | H-VALUE, H-UTILITY | H-STORY on static |
| comments | H-QUESTION, H-CONTRARIAN, H-STORY (confession) | H-UTILITY |
| shares | H-CONTRARIAN (myth_bust), H-QUESTION (relatable_callout) | H-PROOF when the numbers are not ours |
| conversion | H-PROOF, H-VALUE | H-CURIOSITY |

## Platform notes

- instagram: the tightest cutoff. H-VALUE and H-PROOF compress best. "How I" beats "How to".
- tiktok: shot 1 of the storyboard carries the hook; the caption reinforces it with different words.
- facebook: H-QUESTION and H-STORY suit the surface; H-UTILITY does well in groups.

## Rules

1. Write the candidates `write-hook` asks for, pick one, keep two runners-up in `hook_alternates`. Rejected hooks are data.
2. Never open with the brand name unless the brand is the story.
3. No hook makes a claim the body does not support. That is an automatic R-FACT.
4. If two platforms get the same hook verbatim, one of them is wrong.
5. The tag is not optional: `hook_family` and `hook_mechanism` in every post and script front matter.

Numbers in this file are recorded with their provenance in `docs/sources/writing.md`.
