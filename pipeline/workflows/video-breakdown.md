# Workflow: video-breakdown (v1.0.0)

Kinds: `video_breakdown`.
Same condition syntax and column meanings as `organic-post.md`.
One video broken into its scenes, shots, spoken words and structure, written up as one report at `report/report.md` in the job folder, with its stills in `report/stills/`.
Nothing here is posted or paid for, no product photo is needed, and a brand is optional.

| # | Stage | Task | Condition | Agent | Role | Owner | Skills | Artifact | State after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Intake | Confirm the video (a file or a link), what the person wants from the breakdown, and the brand when one is named; write job.json; run route-job.js | always | producer | producer | - | job-intake | job.json, route.json | ROUTED | |
| 2 | Plan | Freeze plan.md | always | scripts | - | - | plan-job.js | plan.md | PLANNED | |
| 3 | Sources | Read what is known about the video before it is watched: for a post link, its caption, account and date with social_post_get; for a file, its name and length with media_probe | always | producer | producer | - | - | research/sources.md | RESEARCH_RUNNING | |
| 4 | Watch the video | Producer runs watch-video.py on the video with --out research/source-watch/ in the job folder: probe, scene frames, transcript or caption status | always | producer | producer | - | watch-video | research/watch-report.md, research/source-watch/ | RESEARCH_RUNNING | |
| 5 | Break down the video | Scenes and shots with timestamps, the spoken words, the on-screen text, and the structure from hook to call to action, using the canonical watch report; name the frame that best shows each scene | always | videographer | videographer | owner | analyze-video, source-validation | research/video-analysis.md | RESEARCH_COMPLETE | |
| 6 | Stills | Producer copies the frame the breakdown names for each scene into report/stills/, as files and never through the chat | always | producer | producer | - | - | report/stills/ | RESEARCH_COMPLETE | |
| 7 | Write the report | report/report.md: the scenes and shots in order with timestamps and a still for each from report/stills/, the spoken words, the on-screen text, and how the video is built from hook to call to action | always | videographer | videographer | owner | write-report, source-validation | report/report.md | REPORT_DRAFTING | |
| 8 | Report review | Present report/report.md with its stills, one panel, with review_gate mode review_all; end turn; get_gate_decision next turn. Approval completes the job; asking for changes goes back to Write the report | always | human | - | - | review | approvals/findings-n.json | AWAITING_REPORT_REVIEW | findings |
| 9 | Done | Say the report is ready on the board, where it downloads as Markdown or HTML | always | producer | producer | - | - | status.md | COMPLETE | |
