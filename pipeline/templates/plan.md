# Plan: {job-id}

**Workflow:** {workflowId} v{workflowVersion} · **Frozen:** {timestamp} · **Route:** {route sha256 prefix}
**Owner:** {owner} · **Support:** {support}
**Gates:** {gates}

Rows come from `workflows/{workflowId}.md`, filtered by the route's tags. Only `Status` and `Verified` change after freezing.
Status: `pending | skipped | dispatched | returned | verified | failed | gate_open | approved | changes_requested | invalidated`.
`returned` becomes `verified` only after `collect-artifacts.js` exits 0.

| # | Stage | Task | Agent | Role | Owner | Skills | Artifact | State after | Gate | Status | Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
