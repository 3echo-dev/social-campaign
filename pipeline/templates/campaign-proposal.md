---
job: {job-id}
brand: {brand}
version: 1
status: draft                 # draft | approved | superseded
platform: facebook            # Meta covers facebook and instagram placements
objective: leads
conversion_event: ""
budget_currency: USD
budget_daily: 0
budget_max_total: 0           # never above job.json budget.maxTotalAmount
start_at: ""
end_at: ""
created: YYYY-MM-DD HH:MM {tz}
---

# Campaign proposal

Everything here is created PAUSED first. Activation is a separate approval.

## Objective and conversion event

## Audience

| Ad set | Targeting | Exclusions | Placements | Optimisation goal | Daily budget |
|---|---|---|---|---|---|

## Creative-to-ad map

| Ad | Ad id | Ad set | Creative (approved file, hash prefix) | Primary text (from drafts) | Headline | Destination URL | Parts (stage, angle, format, hook, mechanic) |
|---|---|---|---|---|---|---|---|

Ad ids come from `scripts/ad-variants.js`; never invent one.

## Test plan

Each pair changes one part (`playbooks/ads.md`, Test design). Ads are named by deliverable (D1, D2).

| Pair | Ad A | Ad B | Differs by (one part) | Proven or new | Main metric (from the stage) |
|---|---|---|---|---|---|

Budget split: proven {n}% / new {n}%. Pause rule: at 72h, pause an ad under half its ad set's median on the main metric, and keep it in the record.

## Naming

`{Platform}_{Objective}_{Audience}_{Offer}_{YYYYMM}` for the campaign; ad sets and ads follow the same pattern with a suffix.
Every ad name ends with its ad id, for example `Meta_Leads_Owners_Trial_202610_Hook-B_V-3f9a2c-D2`, so its results can be matched later.

## Tracking

Pixel or events, UTM scheme, what counts as a qualified lead.

## Budget

| Item | Amount | Rule |
|---|---|---|
| Daily | | |
| Ceiling | | equals job budget maxTotalAmount |
| Duration | | fits daily budget within the total ceiling |

## Compliance

Special ad category, claims checked, disclosure on UGC creatives.

# Decision

Never written by the agent.
