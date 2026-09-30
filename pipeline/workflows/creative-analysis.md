# Workflow: creative-analysis (v1.0.0)

Kinds: `creative_analysis`.
Same condition syntax and column meanings as `organic-post.md`.
Analysis of a social post or campaign from the links or files the person gave, written up as one report at `report/report.md` in the job folder.
Nothing here is posted or paid for, no product photo is needed, and a brand is optional.
Extra tag: `reference_video`, when at least one source is a video.

| # | Stage | Task | Condition | Agent | Role | Owner | Skills | Artifact | State after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Intake | Confirm what to analyse, the links or files (at least one), what the person wants to learn from it, and the brand when one is named; write job.json; run route-job.js | always | producer | producer | - | job-intake | job.json, route.json | ROUTED | |
| 2 | Plan | Freeze plan.md | always | scripts | - | - | plan-job.js | plan.md | PLANNED | |
| 3 | Sources | Open each link and read each file: the post or ad, its caption, the account, the date and the public numbers shown, keeping the address or path of each | always | researcher | researcher | owner | research, source-validation | research/sources.md | RESEARCH_RUNNING | |
| 4 | Watch the video | Producer runs watch-video.py on each video source with --out research/source-watch/ in the job folder: probe, scene frames, transcript or caption status | if:reference_video | producer | producer | - | watch-video | research/watch-report.md, research/source-watch/ | RESEARCH_RUNNING | |
| 5 | Break down the video | Say what each video does: its hook, its scenes, its spoken words, its product moment and its call to action, with timestamps, using the canonical watch report | if:reference_video | videographer | videographer | support | analyze-video, source-validation | research/video-analysis.md | RESEARCH_COMPLETE | |
| 6 | Read the posts | Read each post: for a link, the post and its comments with social_post_get and social_comments_get; for a file, what it shows. Note the hook, the format, the copy, the call to action and what people say, with the source of every point | always | researcher | researcher | owner | research, source-validation | research/posts.md | RESEARCH_COMPLETE | |
| 7 | Write the report | report/report.md: what the post or campaign does, why it works or does not, what the person can take from it, and a source for every claim; say plainly what could not be checked | always | researcher | researcher | owner | write-report, source-validation | report/report.md | REPORT_DRAFTING | |
| 8 | Report review | Present report/report.md, one panel, with review_gate mode review_all; end turn; get_gate_decision next turn. Approval completes the job; asking for changes goes back to Write the report | always | human | - | - | review | approvals/findings-n.json | AWAITING_REPORT_REVIEW | findings |
| 9 | Done | Say the report is ready on the board, where it downloads as Markdown or HTML | always | producer | producer | - | - | status.md | COMPLETE | |
