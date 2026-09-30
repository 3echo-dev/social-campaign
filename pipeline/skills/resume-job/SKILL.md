---
name: resume-job
description: >
  Resumes an existing job. Reads status.md, reconciles it against what is on disk, reloads the
  context the next stage needs, and continues from the correct place. Never passes a human gate.
  Use for "resume", "continue the job", "where were we", "pick up {job-id}", or after a verdict.
argument-hint: "[brand or job]"
metadata:
  version: 1.0.0
---

# Resume a job

## Social Campaign local adapter

Read pipeline/LOCAL-ADAPTER.md before this vendored flow.

Read pipeline_job_read before dispatching any work.

Resume from the current route, plan, revision, blockers, and artifact hashes.

Reuse current accepted artifacts and capability results instead of repeating research, provider probes, or media extraction.

Keep a stale decision waiting for re-review.

**Purpose:** continue a job from disk, not from memory of a conversation. Used by the user, `social-pipeline`, and `review`.

### Local authority

The local adapter above is authoritative for this installation.
The upstream steps below remain a reference for reconciliation and artifact rules.
Do not execute their pane.js, gate-app, or remote sync commands.
Use pipeline_job_read and the existing board URL, refreshing only after a mutation or external state change.

## Steps

1. **Find the job.** If either argument is missing, `node "${CLAUDE_PLUGIN_ROOT}/scripts/list-jobs.js" {brand}`. One job: take it. Several: ask, most recent first.

   The id is the page key, so open the job page now, before reading anything: `pane.js "{job-id}" "{title}"` (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`); never print the web address. The title is the scope in the words `status.md` uses today, "SK-II, 1 TikTok about Trial 2", not the scope the job was first asked for. `set-state.js` reports the stage when step 3 moves the job, and every row resumed from here says its own stage at both ends with `stage.js {job-id} <stage-id> running|done`.

2. **Check execution availability** with `job-context.js --brand {brand} --job {job-id} --json` before opening any decision or dispatching a task.
   An unavailable review job stays readable as history; report the reason and stop.
   A production job with an obsolete saved plan needs the compatibility step before resume, preserving accepted artifacts.
   Then read `status.md` Notes for live constraints, scope overrides and revisions.
   Use `pipeline_generation_land` or the job read for what has been spent and made; credits are no longer a note in `status.md`.

3. **Reconcile supported production work against disk.** Use the current plan, revision-bound approvals and validated artifacts, with the table in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`.
   File presence alone cannot prove approval or delivery.
   Correct state only through its owning command with the current revision, and name the correction.

   **Never redo work that exists.** Re-delegate only the missing workstreams, generate only the missing panels.

4. **Check the gate artifact's Decision section**, and `wait-decision.js "{job-id}" "{gate}" 0`: the verdict may be in the file or already clicked in the pane. Act on whichever exists. With function hooks on, the context block on every prompt names the open gate and tells you to read the decision first, so this step is a rule you keep only when they are off.

   With neither, the gate is still open, so run `open-review.js` again: it rebuilds the items from the artifacts on disk now, never the set it was opened with. A deliverable cut since then must not still be offered for approval (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`). Then report what is pending and stop.

5. **Reload only the context the next task contract names**, from disk, never from a conversation summary: read the frozen `task-contracts.json` entry for the next semantic task, then its `contextRefs` and the current revision-bound artifacts. Do not reload unrelated input files in full.

6. **Verify.** If the last batch was never checked, run `collect-artifacts.js` now. If an artifact revision changed, invalidate only the task dependencies recorded in the contract and recheck those outputs.

## The states you cannot resume past

Every state whose row in `scripts/lib-states.js` names a `gate`.

**Resuming is not approval.** "Continue" while a gate is open asks you to run the step only they can run. Ask for the verdict, in the words `lib-wording.js` gives.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

## Output contract

Writes nothing of its own. Corrects `status.md` where it disagreed with disk.

## Report back

Two lines: what is waiting, and what to do about it. Then end the turn.

> **job-20260902-tiktok-ugc** - 3 boards, 12 credits quoted.
>
> Approve the storyboard, or name a panel to change. Nothing is spent until you do.

## Failure modes

| Failure | Fix |
|---|---|
| Inferring the stage from the conversation | Read `status.md`, then the disk |
| Re-running a batch to fill one gap | Re-delegate only what is missing |
| Saying the job is `AWAITING_CONTENT_APPROVAL` | Say what `list-jobs.js` printed |
