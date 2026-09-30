# What media costs, and how the quote is put to a person

Every credit figure a person ever sees comes from an estimate call, never from arithmetic done here.
This file records the tool contract, the working from the run that got it wrong, and the shape of the question that replaced it.

## The tools

| Call | What it prices | What comes back |
|---|---|---|
| `estimate_image_job` | one still frame | `quotedCostCreds`, `quoteVersion` |
| `estimate_video_job` | one clip, at its exact `duration`, `ratio`, `resolution`, `generateAudio` and `assetIds` | `quotedCostCreds`, `quotedCostUsd`, `quoteVersion`, `canReserve`, `availableBalanceCreds`, `referenceBudget` |

A still frame is 1 credit.
A clip is priced per call, and the price moves with the duration, the resolution and whether sound is generated.
Nothing in the plugin models that curve.
Every clip in a plan is estimated on its own, and the plan's price is the sum of what came back.

`referenceBudget.limits` on a video estimate is the reference cap the tool will honour: 9 image, 3 video, 3 audio.

## Clip length

A clip is a whole number of seconds, 4 to 15, from the tool schema.
`scripts/lib-deliverable.js` holds that pair, and `preflight-generation.js` and `price-options.js` both read it, so the quote and the pre-spend gate cannot drift apart.

A beat longer than 15 seconds splits into two clips at a hard cut.
**A short total runtime is never a reason to give up on video.**
The floor is whatever the job asked for in the deliverable's `durationSeconds.min`, and a 15 second TikTok is a finished TikTok.
`price-options.js` refuses a trimmed plan that comes in under that floor, and refuses nothing for being short in itself.

## The run that got it wrong, and the arithmetic

SK-II, one TikTok, five clips seeded from five approved panels, 9:16, 720p, sound on.
The four estimates that came back on 2026-09-04, quote version `pricing-prod-2026-05-29`:

| Duration | Resolution | Sound | Credits |
|---|---|---|---|
| 4 s | 720p | on | 15 |
| 5 s | 720p | on | 19 |
| 4 s | 480p | on | 7 |
| 5 s | 480p | on | 9 |

The board was one 4 second clip and four 5 second clips, 24 seconds in all.

```
720p, sound on:  15 + 19 + 19 + 19 + 19 = 91
five still frames at 1 credit each        =  5
                                            96 against a ceiling of 30
```

**91 is right.** It is the five estimates added up, each for the exact clip on the board.
The 5 credits for the frames are right: one credit per frame, five frames, and the seed panels are not charged again when a clip references them.
Sound is inside the clip price, counted once.

Two things were wrong with what the person then read.

- One option, "one clip first", was shown at 6 credits.
  Its parts are one still frame at 1 and one 4 second clip at 480p at 7, which is 8.
  Nobody had estimated anything that came to 6.
- The only options that kept the video were 96 and 48, both over the 30 ceiling, so in practice the only thing inside the budget was to drop the video.
  Three 5 second clips at 480p is 27 credits and a 15 second cut, inside the ceiling, and it was never priced.
  Sound off was never priced at all, and the question still asserted that sound is what makes a clip expensive.

## The shape of the question now

`scripts/price-options.js` builds it, from a quotes file written straight off the tool results.
It refuses to produce a question at all unless:

- every clip and frame carries a `credits` figure and the `quoteVersion` it came back with, so a guess cannot reach a person;
- every option's total equals the still frames plus the clips underneath it, added up;
- the full plan is offered, and at least two of `fewer-clips`, `shorter-clips`, `no-audio`, `lower-resolution` are priced beside it;
- the first option keeps the video;
- any trimmed plan still runs at least as long as the job asked for;
- dropping the video is last, and says out loud that it changes what the job delivers;
- no label or hint carries a file name, a state id, a panel id or a deliverable id.

Options are ordered cheapest first among the ones that fit the budget, then the ones that need the budget raised, then the one that gives the video up.
The working is written to `drafts/D{n}/quote.json` so the record shows the parts, not only the total.

A `stills-only` answer is a change of deliverable.
It goes through `change-deliverable.js` with the person's own words, and never happens because the run decided it: `docs/SHARED-RULES.md`, "The deliverable kind is not the run's to change".

## What binds a spend

One thing: `scope.maxSpendCredits` on the latest approved concept record.

There is no preset budget on a brand or in the plugin's own settings.
The estimate says what each way costs, the person picks one, and nothing is made until they do.
A fixed ceiling turned a 91-credit quote into a dead end instead of a decision, and it also refused figures the person had chosen themselves.

What still refuses is spending more than they agreed to when they approved the idea.
That is not a budget question.
It is spending money nobody authorised, and `preflight-generation.js` stops it before a credit moves.
