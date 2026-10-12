# Paid campaign handoff

Read at the proposal and activation-checklist stages of `paid-ugc-campaign`.
This reference defines the setup information a human needs to reproduce the approved proposal.

| Field | Meaning | Required evidence |
| --- | --- | --- |
| Objective | The business outcome requested in the brief. | Approved job scope. |
| Conversion event | The one account event used for the proposed optimization setting. | User declaration or an authorized account check; otherwise unverified. |
| Qualified result | The user's criteria for a useful lead, sale or other action. | Explicit brief criteria; do not invent a threshold. |
| Audience and exclusions | Who may see the campaign and who is excluded. | Brand audience, job constraints and available account options. |
| Placement | The proposed platform and format destination. | Approved deliverable and platform rules. |
| Budget | Daily spend, duration and total ceiling in a named currency. | `job.json`; distinguish ad spend from production charges. |
| Tracking | Destination, UTM parameters and pixel/event setup required before activation. | Exact URL and verified setup or a clearly named manual check. |
| Creative reference | The approved copy and media assigned to each ad. | Relative file references and current approval hashes. |

Plan only the requested creative and budget.
User-supplied targets remain targets, with their assumptions recorded.
Do not infer account access, installation status or expected results from a public profile URL.

The activation checklist reproduces the approved proposal in click order.
Every object is created PAUSED first, and activation is the final separately approved action.
The handoff records instructions, not an assertion that account changes have happened.

## Test design

A test only teaches something when a result can be pinned on one idea part (`playbooks/awareness-stages.md`, `angles.md`, `visual-formats.md`, `hooks.md`, `attention-mechanics.md`, plus the anchor).
These are defaults for the proposal's Test plan. The approved number of deliverables still decides how many ads exist; the plan never adds production.

| Rule | Default |
| --- | --- |
| One change per pair | Two ads in a test pair share every part but one. Name that part in the Test plan. `node scripts/ad-variants.js <brand> <job-id>` warns when a pair changes more than one part, or a different part than it says. |
| Volume | About 8 new ads per platform per week at roughly $3k a month. Scale the count with the budget, and never below 2 ads per pair. |
| Pause rule | At 72h, pause an ad whose main metric is under half the median of its ad set. Keep paused ads in the record; a loser is evidence too. |
| Proven vs new | Put about 70% of the budget on proven ads (ones whose parts have won before) and 30% on new tests. With no results yet, everything is new; say so. |
| Judge by stage | Judge each ad on the main metric of its awareness stage (`awareness-stages.md`), not on one metric for all. |

Every ad carries a stable ad id from `scripts/ad-variants.js` (for example `V-3f9a2c-D1`).
The ad's name in Ads Manager ends with that id, so results read back later can be matched to the ad and its parts.
`build-handoff.js` writes `handoff/campaign/variants.json` with each ad's id, parts and test pair.
