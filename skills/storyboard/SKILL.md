---
name: storyboard
description: Local adapter for the vendored storyboard contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Storyboard local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/storyboard/SKILL.md.
Use this adapter only when the active route and task contract name this skill.
Reuse the current job snapshot, input revision, accepted artifact hashes, and capability results.
Call pipeline_job_read only when no fresh snapshot is supplied or an external state change occurred.
Write only the output paths named by the active plan.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
Return the output paths, reused evidence, blockers, and next action.
