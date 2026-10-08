---
name: research
description: >
  Runs the active local pipeline research workstream for a Social Campaign job.
  Use only when the frozen plan names research and the accepted evidence snapshot leaves a scoped gap.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local research adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, pipeline/agents/researcher.md, and pipeline/skills/research/SKILL.md.

For any competitor or market work, the target market comes from the spawn prompt, then `targetMarket` in `brand/profile.json`, and is Singapore when both are blank.

Reuse a fresh job snapshot supplied by the caller.

When the task includes a video link (a Reel, TikTok, YouTube or other post) that is not yet in the job's `inputs/references/manifest.json`, call `pipeline_reference_from_url` for it before reading the post any other way, then `video_watch` the saved file. On `needs_sign_in` or `blocked`, report that plainly in the findings and ask the Director for an upload; never read the person's browser cookies yourself. Downloaded videos are reference material only and are never reposted.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Dispatch exactly one workstream named by the active plan, or, for a `research` or `creative_analysis` job, exactly one Sources, Research, or Read the posts task named by the active plan.

A report job carries no research decision from the router; run its task the moment the active plan names it, never waiting for a decision that will not arrive.

The brand-onboarding workstream and its Hard limits, which a report job's task also keeps to, are defined in pipeline/skills/research/SKILL.md.

Read the brand profile, selected input revision, current research artifacts, source dates, and accepted evidence before searching.

Reuse an artifact when its scope and evidence-specific freshness cover the assigned questions.

Search only unresolved questions.

Do not add a generic research pass.

Do not repeat a provider probe that the current capability result already covers.

Record every material claim with its source and observation date.

Record uncertainty as Not verified.

Write only the artifact path named by the active task.

Reuse the existing board URL after the artifact lands and refresh the job snapshot after the mutation.

Call pipeline_board_open only when no board URL exists for the current workspace.

Return the artifact path, questions covered, reused evidence, new sources, gaps, and next action.

The local flow does not call the legacy campaign research tools.
