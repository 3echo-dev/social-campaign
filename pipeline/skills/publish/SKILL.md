---
name: publish
description: Delivers an approved posting package after verifying current approvals. Use at the hand-off stage of every content workflow.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Publish

**Purpose:** record approved content in a package a person can post.

**Used by:** the producer, at the hand-off stage of `organic-post`, `paid-ugc-campaign` and `repurpose-video`.

**This skill never sends a post.** The tool contract below documents a backend.

## Inputs

`route.json` (`gates`), `approvals/*.json`, every `drafts/D*/post.md` with its front matter `media` list, the files under `media/`, `campaign/` for paid jobs, `workspace.json` (accounts), and `platform-rules/{platform}.md` (the `manual_posting_checklist` array in the json block).

The schedule was settled at intake, so use `schedule.publishAt` as approved.
The build in step 2 writes the time zone, in `schedule.csv` and the README, when the time has no UTC offset: the job's zone, else the brand's.
When neither is known, the README says plainly that the posting time has no time zone.
Never edit it by hand, since the manifest hashes those files, and never ask about a time zone at this step.

## Steps

1. **Verify every consuming approval.** For each gate in `content`, `publish`, `campaign_proposal`, `campaign_activation` that the route requires:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-approval.js" {brand} {job-id} {gate}
   ```

   Exit 1: an artifact changed after approval; name the file, re-send it, ask for a new verdict, and stop. Exit 3: no approval exists; stop.

2. **Build the package.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/build-handoff.js" {brand} {job-id}
   ```

   It re-runs the same checks and refuses on anything but a clean pass. It writes, per platform, the caption and hashtags as a `.txt`, the media beside it, `schedule.csv`, a `README.md` with the per-post details and the platform posting checklists, and `manifest.json` hashing every file.

3. **Deliver it.** Send `handoff/README.md` with `SendUserFile`, `display: "render"`, plus every media file the human needs. Say where the folder is and what the first step is. A package they cannot see has not been delivered.

4. **Complete production after delivery.** Move to `HANDOFF_READY` with `set-state.js`, then run `complete-job.js {brand} {job-id} --delivery-ref "{delivered package or message reference}" --by producer`.
   Use the actual delivered package or message reference, never a placeholder.
   Completion verifies the package manifest, current required approvals and delivery reference.
   If verification fails, keep the job recoverable and repair only the named problem.
   Say "All done. See where each post stands on the board."
5. **Provide the production usage receipt** through `campaign-report.js` and one bounded `sync-events.js` at the turn boundary.
   Missing provider usage or offline sync stays explicitly incomplete and does not reopen production.
   `close-job.js {brand} {job-id} --rating 1-5` can record optional feedback later.

## Rules

1. Never write `handoff/` when `check-approval.js` exits non-zero. The approval is the authorisation; a stale one is not an authorisation.
2. Never edit a caption, a hashtag or a media file while packaging. If it is wrong, it goes back to the draft and through the gate again.
3. Every file in the package is hashed in the manifest. A file that reached the package without an approval covering it is a defect.
4. The disclosure line travels with the post, not in a side note. A generated video carries its AI-made label on the platform per `platform-rules/{platform}.md`.
5. Never claim something was published unless a send or the person recorded it.
6. TikTok and Instagram captions are not clickable: the checklist tells the human where the link actually goes.

## Output contract

For backend integration, read `docs/publishing-backend.md`; routine handoff needs no publishing tool.

`handoff/` contains `README.md`, `manifest.json`, `schedule.csv`, and per-platform copy and media.
Verified delivery reaches `COMPLETE` and has a production usage receipt.
Publication is recorded only if actually confirmed; it is not required to complete production.

## Boundary

Does not approve, does not edit drafts, does not post, does not create or mutate a campaign. The activation checklist tells a human what to click; nothing here clicks it.

## Failure modes

| Failure | Fix |
|---|---|
| Building the package with a stale approval | `check-approval.js` first; re-send and re-ask |
| Media referenced by a draft but missing on disk | Stop and name it; the script refuses |
| Recording the publish time without a zone | Every timestamp carries its zone |
