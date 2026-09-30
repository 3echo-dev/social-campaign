---
name: write-hook
description: Local adapter for the vendored write-hook contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Write Hook local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/write-hook/SKILL.md.
Use this adapter only when the active route and task contract name this skill.
Reuse the current job snapshot, input revision, accepted artifact hashes, and capability results.
Call pipeline_job_read only when no fresh snapshot is supplied or an external state change occurred.
Write only the output paths named by the active plan.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
Return the output paths, reused evidence, blockers, and next action.

## Work only from the chosen recipe

A post's or script's hook is written only from the person's choice in `drafts/D<n>/recipe.json`.
When that file is missing, stop, write nothing, and return the blocker "the copy choices for D<n> are not picked yet" so the creative stage can ask the person.
Never pick the hook family or mechanism yourself.

- Use `post.hook_family` and `post.hook_mechanism` exactly, in `hook_family` and `hook_mechanism`.
- Write every candidate in that family; the winner uses the chosen mechanism, and the runners-up may use the family's other mechanisms.
- The winning first line must read as its mechanism: a question mechanism asks a question with a question mark, and a number-led mechanism carries a real number.
- Before the recipe exists, write-hook only drafts the example first lines for the hook options at the concept step.
