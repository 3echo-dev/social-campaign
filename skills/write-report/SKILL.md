---
name: write-report
description: >
  Writes report/report.md in plain marketing language for a research, analysis, or video-breakdown job.
  Use for the Write the report task once that job's research or video analysis is complete.
user-invocable: false
metadata:
  version: 0.1.0
---

# Write report

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Writing up what the research found."

## When this runs

Use this skill only for the Write the report task on a `research`, `creative_analysis`, or `video_breakdown` job, once its research or video analysis is complete.

Read the job's own research files before writing: `research/sources.md` and `research/*.md` for a research job, `research/posts.md` and `research/video-analysis.md` for an analysis, or `research/video-analysis.md` for a breakdown.

Write exactly one file, `report/report.md`, in the job folder.

## What the report says

Write in plain marketing language a person outside the team can read without help.

Never use internal terms: no job IDs, stage names, file paths, tool names, schema names, or approval codes.

The report has these parts, in this order:

1. A short summary, two or three sentences, of the question and the headline answer.
2. Findings: the material points the research turned up, each as one plain sentence or short paragraph.
3. What to do with them: the action or decision each finding supports, in plain marketing terms.
4. Sources: one line per source, with its link, or its file name when it has no link, and the date it was seen or published.

Carry every source and date straight from the research files.
Never invent a source or a date, and never soften a date into "recently."

State plainly, in one short line, whatever the research could not check or confirm.

## A video breakdown adds a shot list

For a `video_breakdown` job, and for a `creative_analysis` job whose sources include a video, add a shot list after the findings.

One row per scene, in order, with its timecode range, what happens in it, the words spoken (or "no spoken words"), and any on-screen text.

Name the still for that scene by its file name only, exactly as it already sits in `report/stills/`; never write a full path.

Never mention how a still was made or copied.

The stills themselves are copied into `report/stills/` as files by the producer before this skill runs; this skill only names them, it never produces or asks for one through chat.

## Rules

Do not run any research yourself; this skill only writes up research that already exists.

Do not add a finding, a source, or a still that is not already in the job's research files or `report/stills/`.

Never leave a placeholder or a "TBD" in the report; when something is missing, say plainly that it was not found.

Write only `report/report.md`.
