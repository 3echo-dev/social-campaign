# Workflow: research-report (v1.0.0)

Kinds: `research`.
Same condition syntax and column meanings as `organic-post.md`.
Research about a product, a brand or its competitors, written up as one report at `report/report.md` in the job folder.
Nothing here is posted or paid for, no product photo is needed, and a brand is optional.
Extra tag: `sources`, when the person gave at least one link or file.

| # | Stage | Task | Condition | Agent | Role | Owner | Skills | Artifact | State after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Intake | Confirm the question, what it is about (the product, the brand or its competitors), the market, and any links or files; write job.json; run route-job.js | always | producer | producer | - | job-intake | job.json, route.json | ROUTED | |
| 2 | Plan | Freeze plan.md | always | scripts | - | - | plan-job.js | plan.md | PLANNED | |
| 3 | Sources | Open each link and read each file the person gave; note its address or path, who published it, when, and what it says | if:sources | researcher | researcher | owner | research, source-validation | research/sources.md | RESEARCH_RUNNING | |
| 4 | Research | One workstream on the question in the request: the product, the brand, or at most three competitors in the market named; every material claim carries a traceability block | always | researcher | researcher | owner | research, source-validation | research/*.md | RESEARCH_COMPLETE | |
| 5 | Write the report | report/report.md: the question, what was found, what it means for the person, and a source for every claim; say plainly what could not be checked | always | researcher | researcher | owner | write-report, source-validation | report/report.md | REPORT_DRAFTING | |
| 6 | Report review | Present report/report.md, one panel, with review_gate mode review_all; end turn; get_gate_decision next turn. Approval completes the job; asking for changes goes back to Write the report | always | human | - | - | review | approvals/findings-n.json | AWAITING_REPORT_REVIEW | findings |
| 7 | Done | Say the report is ready on the board, where it downloads as Markdown or HTML | always | producer | producer | - | - | status.md | COMPLETE | |
