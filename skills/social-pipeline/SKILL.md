---
name: social-pipeline
description: Local alias for the Social Campaign entry flow backed by the vendored pipeline contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Social Pipeline local adapter

Read skills/social-campaign/SKILL.md, pipeline/LOCAL-ADAPTER.md, and pipeline/skills/social-pipeline/SKILL.md.

Use skills/social-campaign as the only local entry flow.

Reuse the current workspace and board snapshot before asking a question or creating a job.

Dispatch only active route tasks and reuse current artifacts and capability results.

Do not use gate-app, Drive configuration, legacy SQLite transport, or automatic research setup.
