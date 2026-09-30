---
name: new-job
description: Starts a new job for a brand, from the request through intake, routing, planning, and the first human gate.
argument-hint: "[brand] and what you want made"
metadata:
  version: 1.1.0
---

# Start a new job

## Social Campaign local adapter

Read pipeline/LOCAL-ADAPTER.md before following this vendored flow.

The root new-job skill creates the local job through pipeline_job_create after brand onboarding is complete.

Use pipeline_job_read for route blockers and the actual plan.

Use pipeline_inputs_import for selected local paths after the job ID exists.

Do not use scaffold-job directly from the chat entry path.

Do not invent owner, route, platform, deliverable, approval, or completed-stage values.

Complete workspace, capability, and brand readiness before execution.
A draft brief may be saved while a later prerequisite is unresolved.

### Local authority

The local adapter above is authoritative for this installation.
The upstream steps below remain as a reference for the source contract and are not an entry path.
Do not execute their new-job-guard, scaffold-job, pane.js, Drive, gate-app, or automatic research commands.
Use the root new-job skill with pipeline_job_create, pipeline_job_read, pipeline_inputs_import, and the board tools.

## Steps

1. Check that the request is for campaign production.
   For a platform-results review, say "Performance review is not included in this build" and stop before creating a job.
   Resolve the brand from the workspace list.
   Never guess a brand or create a second workspace.
   If it is missing, use `onboard-brand`.

2. Check the queue and onboarding.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/new-job-guard.js" {brand}
   ```

   Exit 1 prints the blocking reason.
   Completed production and retired review jobs do not consume active production capacity.
   Feedback is optional and independent of starting the next job.
   Complete onboarding and return if the required profile is missing.
   Profile URLs identify research sources and do not authenticate social accounts.

3. Check only the capabilities needed by this brief.
   Local state and the chosen output destination must be readable and writable.
   A Drive desktop folder proves local access only until synchronization is confirmed.
   Do not block research or export because an unavailable social account or publishing connector is absent.

4. Ask for the request if it was not supplied.
   Read `<root>/inputs/{brand}/` silently for supplied material.
   Read `brand/profile.json` and `brand/research.json` once.
   Pass each specialist only the declared facts, relevant evidence, constraints, approvals, and expected output.
   Use `brand-research.js` freshness and refresh planning when claims or scope changed.

5. Derive a lowercase slug and scaffold the draft job.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-job.js" {brand} {slug} "{title}"
   ```

   Bind the job to this chat with `select-job.js {brand} {job-id} --session {session-id}` when available.
   Open the job pane as soon as the id exists.

6. Run `job-intake` once for the blocking brief questions, then route and plan.
   Saving a draft brief is allowed before job readiness passes.
   Do not execute research, production, export, or publishing while readiness is blocked.

7. Follow the plan as the producer and stop at the first required gate.
   Write the artifact, record the state through the owning script, explain the single decision, and end the turn.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Ask the blocking intake questions once as one batch.
2. Preserve every requested deliverable and never invent one.
3. Never pass a gate or spend before the matching approval is saved.
4. Never generate media in this skill.

## Output contract

The job folder contains the brief, route, plan, status, and produced artifacts.
The job ends at a human decision with its next action named.

## Boundary

This skill does not onboard a brand, approve an artifact, or build a handoff.
