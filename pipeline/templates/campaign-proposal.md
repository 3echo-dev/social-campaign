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

| Ad | Ad set | Creative (approved file, hash prefix) | Primary text (from drafts) | Headline | Destination URL | Recipe (hook family, angle, format) |
|---|---|---|---|---|---|---|

## Naming

`{Platform}_{Objective}_{Audience}_{Offer}_{YYYYMM}` for the campaign; ad sets and ads follow the same pattern with a suffix.

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
