# The publishing backend contract

The plugin sends posts through Metricool from the main session, and `handoff/` is the record of what was approved and the package a person posts by hand.
This file is what a different backend would have to implement to take that last step over, so the
agents, workflows and gates would not have to change. It is design, not a dependency, and
no skill reads it at runtime.

## The MCP tool contract

A backend that implements these tools replaces step 2 and 3 without changing any agent, workflow or gate. The shape merges the pipeline's own state and approval needs with the publishing surface a scheduler exposes.

| Group | Tools |
|---|---|
| State | `job.create`, `job.get`, `job.transition` |
| Artifacts | `artifact.put`, `artifact.get`, `artifact.list` |
| Approvals | `approval.request`, `approval.decide`, `approval.get` |
| Accounts | `integration.list`, `integration.schema` |
| Publishing | `media.upload`, `post.schedule_or_draft`, `post.list`, `post.settings`, `publish.preflight`, `publish.post`, `publish.reconcile` |
| Paid | `campaign.create_paused`, `campaign.activate`, `campaign.reconcile` |

Three properties the backend must hold, each learned from a real failure:

- **Idempotent by content hash.** A sandbox tool call can time out with the work done. Publishing the same approved hash twice returns the first result rather than creating a second post.
- **Reconcile by lookup, not by key.** Meta stores no caller-supplied idempotency key, so after an unknown response the backend searches for the object by the deterministic name it assigned, within a time window. The key is internal dedup only.
- **Preflight before the first external write.** Token scopes, account reachability, quota headroom where queryable, and one real media fetch. A preflight costing one request is worth more than an approval costing a budget.
