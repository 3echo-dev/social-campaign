# Workflow: results-review (v1.0.0)

Kinds: `results_review`.
Same condition syntax and column meanings as `organic-post.md`.
Reads the results of an earlier, already handed-off job (`sourceJobId`, a job of the same brand) and ends with one written findings report at `report/report.md`.
Nothing here is posted or paid for, nothing is written to an ad account, and no product photo is needed.
Extra tag: `paid`, when the earlier job is a `paid_campaign`; its ads are read from the ad accounts. Any other earlier job is read from Metricool.

| # | Stage | Task | Condition | Agent | Role | Owner | Skills | Artifact | State after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Intake | Confirm which earlier job to read (sourceJobId) and which dates; write job.json; run route-job.js | always | producer | producer | - | job-intake | job.json, route.json | ROUTED | |
| 2 | Plan | Freeze plan.md | always | scripts | - | - | plan-job.js | plan.md | PLANNED | |
| 3 | Read ad results | For each connected ad account (Meta Ads, TikTok for Business; read-only), read the results for the earlier job's ads with the connector's read-only tools and save them with pipeline_ad_results_save into the earlier job; when no ad account is connected, ask the person for a CSV export from Ads Manager and pass it to the importer in the next stage | if:paid | researcher | researcher | owner | ad-results | results/ | RESEARCH_RUNNING | |
| 4 | Read post results | Read the numbers of each posted post with Metricool's analytics tools (getAnalyticsDataByMetrics) and write them as a JSON list to results/metricool-rows.json: one row per post with deliverable (D1...) or postUrl, publishedAt, and whichever counts Metricool gave (impressions, reach, likes, comments, shares, saves, videoViews); a count it did not give is left out, never zero | unless:paid | researcher | researcher | owner | - | results/metricool-rows.json | RESEARCH_RUNNING | |
| 5 | Match and import | node scripts/import-metrics.js <brand> <job-id>: reads the earlier job's results, matches each row to an ad by its ad id, writes metrics/*.json and results/matching.md; with a CSV add --csv <file> --provider meta_ads or tiktok_ads, --currency, --date-start and --date-end; with Metricool rows add --metricool results/metricool-rows.json | always | scripts | - | - | import-metrics.js | results/matching.md, results/summary.json | RESEARCH_COMPLETE | |
| 6 | Write the findings | report/report.md: what ran, how each ad or post did on the main metric of its awareness stage (playbooks/awareness-stages.md), which idea parts the winners and the losers share, which results are provisional and which are settled, and what could not be matched; every number comes from results/summary.json, never worked out by hand | always | researcher | researcher | owner | write-report | report/report.md | REPORT_DRAFTING | |
| 7 | Report review | Present report/report.md, one panel, with review_gate mode review_all; end turn; get_gate_decision next turn. Approval completes the job; asking for changes goes back to Write the findings | always | human | - | - | review | approvals/findings-n.json | AWAITING_REPORT_REVIEW | findings |
| 8 | Done | node scripts/attribute-results.js <brand> --accept <job-id> saves the approved Lessons to brand/learnings.json and refreshes brand/scorecard.json from settled results; then say the findings are ready on the board, where they download as Markdown or HTML | always | producer | producer | - | attribute-results.js | brand/learnings.json, brand/scorecard.json, status.md | COMPLETE | |
