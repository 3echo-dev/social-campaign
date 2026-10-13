---
name: ad-results
description: >
  Internal step of social-campaign for "check how my ads did": reads how a job's ads did from the person's Meta or TikTok ad account, read-only, and saves the numbers into the job.
  Use when a Meta ads or TikTok ads connection is connected; reached through social-campaign.
user-invocable: false
metadata:
  version: 0.1.0
---

# Ad results

## Talking to the person

Speak in plain marketing language, one short line at a time, as the Director.
Never mention tool names, file paths, ids, schemas or connector names other than "your Meta ad account" or "your TikTok ad account".

## Read-only, always

This version only reads ad accounts.
Never call a connector tool that creates, edits, turns on, pauses or deletes anything, and never change a budget or targeting.
The plugin blocks those tools anyway; when the person asks for such a change, say in one line that Social Campaign keeps ad accounts read-only for now and they can make it in Ads Manager.

## When this runs

When the person asks how their ads did, for a job or in general.
Use the job they name, or the paid job they last handed off; ask which job only when two or more fit.

The job's brand needs a chosen ad account for that platform.
If none is chosen, run the connection check the setup skill describes for Meta ads or TikTok ads first.
If the connector is not there, say in one line how to add it (setup describes where) and stop.

## Steps

1. Ask nothing about dates unless the person gave none and the job has no hand-off date: then use the last 7 full days, and say so.
2. Read with the connector's read-only tools only, for the chosen ad account and that date range, at the ad level:
   Meta: `ads_get_ad_entities` for the ads and their names, and the `ads_insights_*` tools for the numbers.
   TikTok: `report_integrated_get` with the ad level and the account's advertiser id.
3. Keep only the ads that belong to this job: their names follow the naming in the job's campaign plan, or the person says which ones they are.
   Match each one to its job draft (D1, D2, ...) when the name or the person makes it clear; otherwise leave it unmatched.
4. Call `pipeline_ad_results_save` with one row per ad and the numbers exactly as reported.
   Leave a number out when the connector did not give it; never put 0 for unknown, and never work out a total, rate or cost yourself.
5. Tell the person in two or three plain lines what the saved totals say: spend, results and cost per result, from the tool's answer.
   Say the full table is in the job's files as "Ad results".
   When the answer lists ads still unmatched, ask once which draft each is, in Needs you and in chat together, and save again with the answers.
   When the answer carries `library`, say in one line that the matched ads now count toward which opening lines rank first in the person's brand library; say a line is a winner only when the answer names it.

## Saying what it means

Report what happened, not why.
Do not call an ad a winner from a higher click rate alone, from a few days, or from small numbers; say it is too early to tell.
A total marked partial covers only the ads that reported it; say so in plain words.
