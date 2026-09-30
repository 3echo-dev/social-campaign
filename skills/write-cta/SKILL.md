---
name: write-cta
description: Local adapter for the vendored write-cta contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Write Cta local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/write-cta/SKILL.md.
Use this adapter only when the active route and task contract name this skill.
Reuse the current job snapshot, input revision, accepted artifact hashes, and capability results.
Call pipeline_job_read only when no fresh snapshot is supplied or an external state change occurred.
Write only the output paths named by the active plan.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
Return the output paths, reused evidence, blockers, and next action.

## Work only from the chosen recipe

A post's or script's call to action is written only from the person's choice in `drafts/D<n>/recipe.json`.
When that file is missing, stop, write nothing, and return the blocker "the copy choices for D<n> are not picked yet" so the creative stage can ask the person.
Never pick the call-to-action style yourself.

- Use `post.cta_style` exactly as `recipe.cta_style`.
- Start from `post.cta_line`; change only its placement or a word the platform needs, never the ask.
- Before the recipe exists, write-cta only drafts the call-to-action options at the concept step and the brief's CTA intent.
