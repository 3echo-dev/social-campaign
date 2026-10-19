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
For the media spec rows the Creative Director writes the storyboard and the generation manifest; the Director never does.
The storyboard carries one picture style for the job (a `style` preamble from the chosen concept, repeated word for word in every picture prompt), a continuity block of 3 to 6 attributes for each recurring person, place and product, and the voice-over answer (`voice_over: yes` or `no`, and `voice`). The Director asks "Voice-over: yes or no, and which voice?" before the storyboard is written, so the script and clip lengths fit it; music and captions are asked in the same place and recorded before the storyboard is shown.
The storyboard is shown with a picture on every panel. On a video post the Director makes all the pictures at once, because the test clip is the sample; on a picture-only post it makes the sample picture first, then the rest, before presenting it.
Do not repeat research, repeat provider probes, use gate-app transport, use Drive configuration, or create a second job authority.
Preserve approval, revision, ownership, and state protections.
<!-- BEGIN labelled references (0.14 task 3) -->
Every manifest item that attaches pictures also gets `references: [{ ref, label, keep }]` in attachment order, and its prompt opens with the matching legend (the nested contract's Labelled references section).
<!-- END labelled references -->
Return the output paths, reused evidence, blockers, and next action.
