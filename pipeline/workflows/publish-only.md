# Workflow: publish-only (v1.0.0)

Kinds: `publish_post`.
Same condition syntax and column meanings as `organic-post.md`.
The person already has the pictures or video, so nothing is researched, planned, made or priced, and no credits are spent.
The plugin copies the files into the job under `media/supplied/` when the job is created, and every caption the person gives is kept word for word.
Two approvals guard the send: the final post, then the posting plan.
Tags used here: `social_post` (the route needs a caption written, because the person gave none).

| # | Stage | Task | Condition | Agent | Role | Owner | Skills | Artifact | State after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Intake | Confirm the brand, the files, the platforms, each post type, the caption and the time, then create the job with the files; the plugin copies each file into the job, measures it and writes one skeleton per platform | always | producer | producer | - | job-intake | job.json, route.json, media/supplied/, drafts/D*/post.md | ROUTED | |
| 2 | Plan | Freeze plan.md from this table and the route | always | scripts | - | - | plan-job.js | plan.md | PLANNED | |
| 3 | Caption as given | Check that each post lists its files and keeps the person's caption word for word | unless:social_post | producer | producer | - | platform-format | drafts/D*/post.md | DRAFTS_READY | |
| 3b | Caption | Write one caption per post from the brand voice and what the supplied pictures or video show, using the stills the producer saved; add no claim the brand profile does not support | if:social_post | copywriter | copywriter | support | write-caption, write-cta, platform-format | drafts/D*/post.md | DRAFTS_READY | |
| 4 | QC and platform checks | Producer runs platform-check.js in its supplied mode; the shape, length and limits of each post are checked again when it is shown | always | producer | producer | - | platform-format | validation/platform-check.json | VALIDATED | |
| 5 | Content gate | Show every draft with its files and its checks; the answer is waited for on the board | always | human | - | - | review | approvals/content-n.json | CONTENT_APPROVED | content |
| 6 | Publish gate | Account, platforms, time and the files that will go out; the answer is waited for on the board | always | human | - | - | review | approvals/publish-n.json | PUBLISH_APPROVED | publish |
| 7 | Hand-off | Host the files, send through Metricool or give the posting kit, then close the job with pipeline_publish_close | always | producer | producer | - | publish | handoff/README.md, handoff/manifest.json | COMPLETE | |
