---
name: write-caption
description: Local adapter for the vendored write-caption contract.
user-invocable: false
metadata:
  version: 0.3.0
---

# Write Caption local adapter

Read pipeline/LOCAL-ADAPTER.md and pipeline/skills/write-caption/SKILL.md.
Use this adapter only when the active route and task contract name this skill.
Reuse the current job snapshot, input revision, accepted artifact hashes, and capability results.
Call pipeline_job_read only when no fresh snapshot is supplied or an external state change occurred.
Write only the output paths named by the active plan.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
Return the output paths, reused evidence, blockers, and next action.

For a video post, also write the `## Variants` section described in `pipeline/skills/write-caption/SKILL.md` (two lines, `v2 | hook: <text> | cta: <text>`, after `# CTA` and before `## Details`).

## Work only from the chosen recipe

A caption is written only from the person's choice in `drafts/D<n>/recipe.json` and a finished `brand/brand-voice.md`.
When the recipe is missing, or the brand voice front matter says `complete: false`, stop, write nothing, and return the blocker so the creative stage can ask the person.
Never pick the pillar, angle, hook family, call to action or hashtags yourself.

Copy the recipe's `post` block into `post.md` exactly:

- `recipe.pillar` is `post.pillar` and `recipe.angle` is `post.angle`.
- `hook_family` and `hook_mechanism` are `post.hook_family` and `post.hook_mechanism`.
- `recipe.cta_style` is `post.cta_style`.
- `# Hashtags` holds exactly the tags in `post.hashtags`, and the front matter `hashtags` lists the same tags, each in quotes.

The platform check fails a post whose pillar, angle, hook, call to action or hashtags differ from the recipe, or whose first line does not read as its hook mechanism.
