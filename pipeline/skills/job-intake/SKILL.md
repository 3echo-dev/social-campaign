---
name: job-intake
description: Validates job.json, batches blocking questions, then routes and plans. Use at intake or NEEDS_CLARIFICATION.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Job Intake

**Purpose:** a routable `job.json` with minimal questions.

**Used by:** the producer at stage 1 and stage 4b.

## Inputs

The request verbatim, `workspace.json` (account handles), the brand record in the job snapshot (its `timezone`), `brand/positioning.md`, `<root>/inputs/{brand}/` (beside `workspaces/`, not inside it), and `${CLAUDE_PLUGIN_ROOT}/templates/job.json`.

## Steps

1. **Check the requested outcome**, then fill everything you can infer.
   Reject platform-result reviews and briefs for real creators before scaffolding; explain that the requested workflow is unavailable.
   Never convert a real-creator request into generated video.

   - `kind`: "post" to organic_post; a post series to organic_series; creator-style clips to ugc_creative; "ads" or a budget to paid_campaign; "turn this video into" to content_repurpose
   - `objective`: the verb. Launch or announce is awareness, "get demos" is leads, "sell" is sales
   - `distribution`: a budget or the word ads means paid, otherwise organic
   - `platforms`: named, otherwise those with accounts in `workspace.json`
   - `deliverables`: the count and format asked for, one row per platform and format, ids `D1`, `D2`
   - `creativeDiscipline`: "creator", "testimonial", "UGC", "talking to camera" is ugc; no media is text_only
   - `subject`: ask whether the job is about a product, a character or neither, unless the request says; `product`, `character` or `none`

   Then: `sourceRefs` and `productAsset` from any URL or file they gave, `audience.description` from `brand/audience.md`, `evidence.supplied` only when their material answers the claims.

2. **Write `job.json`.**

3. **Route.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/route-job.js" "workspaces/{brand}/jobs/{job-id}/job.json"
   ```

4. **On exit 3, ask what is missing as one batch**: four at most, once, each with options and a recommended default first. Run `ask.js "{job-id}" "{questions.json}"`, make one bounded `wait-answer.js "{job-id}" 0` read, and end the turn when it returns `waiting`, per `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`.

   - `deliverables`, if unclear: "How many, on which platform, and in what format?"
   - `ugcSource`: UGC uses AI-generated media; explicit real-creator requests are unsupported.
   - `productAsset`, unless text only or `subject` is `character` or `none`: `ask-product-photo.js "{job-id}"`, a card with a drop area, two ways on and a box; never print a folder at them.
   - a `character` job with no reference is not blocked and gets no card: the first step after the brief is a small reference-art price and pictures, before the storyboard.
   - `account`, always: "Which account will post this?" Offer the `workspace.json` handles; `unknown` is a real answer.
   - `schedule.publishAt`, always: "When should it go out?" Offer "no date yet".
   - `schedule.timezone`, whenever the brand record's `timezone` is null or absent and the date question is in this batch: "Which time zone is that posting time in?" It sits next to the date question in this same batch, never a separate round, and "no date yet" makes it moot. When the brief already gives a time with a UTC offset, skip it.
   - `specWork`, if a URL was pasted or the brand is well known: "Your own brand, or spec work on someone else's?"
   - `budget` and `landingPageUrl`, if paid: ceiling, daily amount, landing page
   - `request` or `objective`, if not inferred: what this should say, and whether it is for awareness, engagement, traffic, leads or sales

   `land-photo.js` records the licence. Stock often bars AI derivatives: ask, and carry it as an open risk.

5. **Rewrite `job.json` and re-route.** Twice at most; a third `NEEDS_CLARIFICATION` stops the job with the gaps named.

5b. **On a `BLOCKED` route**, say the router's sentence and stop until what it names arrives. Routing already put the photo card up: make one bounded `wait-answer.js "{job-id}" 0` read, then `land-photo.js` and re-route, or use the way out they picked.

6. **On exit 4 (`UNSUPPORTED`)**, say what is unsupported and stop. Never substitute an unrouted discipline.

7. **On exit 0, plan.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-job.js" "workspaces/{brand}/jobs/{job-id}/route.json"
   ```

   Then run one bounded `sync-events.js` at the stage or turn boundary (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`).

8. **Lite brief, when strategy is not routed** (stage 4b). Use its template, `job.json`, brand files and applicable research. Keep proof-point sources; mark unsupported claims `unknown`.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Never invent a deliverable, a budget, a date or a claim. `null` is a real value; a plausible number is not.
2. The router is the only routing truth. Add a risk flag if you must; never remove one, change the owner or raise confidence.
3. `platforms` outside facebook, instagram and tiktok make the job `UNSUPPORTED`. Say so; never silently drop one.
4. Deliverable ids are stable: `D2` stays `D2` if `D1` is cut.
5. A schedule without a timezone is not a schedule: when `publishAt` has no UTC offset, use the brand record's `timezone` and say the zone back in plain words, for example "I'll set that for 9am Singapore time."
   Ask only through the step 4 time zone question, in that batch and never in a separate round.

## Output contract

`job.json` and `route.json` validated, `plan.md` frozen, and adjacent `task-contracts.json` written with semantic keys, canonical refs, capabilities and context; on stage 4b, `brief.md`.

## Boundary

Does not research, write a strategy brief (strategist), choose an angle, or dispatch an agent.
