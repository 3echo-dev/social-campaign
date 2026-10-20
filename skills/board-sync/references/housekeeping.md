# Housekeeping

Read by `skills/board-sync/SKILL.md`.
Each section is applied exactly as written here.

After acknowledging a request, delete request documents whose `artifactReceipt.status` is `applied` and whose `artifactReceipt.appliedAt` is more than 7 days old, using the host's ArtifactData `batch` action with delete entries of at most 50 per call.
Delete request documents whose `artifactReceipt.status` is `declined` and whose `artifactReceipt.declinedAt` is more than 7 days old the same way.
Also delete any leftover documents in a `bells` collection; the board writes only a single `meta/bell` document now, so any `bells/*` documents that remain are cruft from an older publish.
Never delete a document marked `requested` or `needs_reconciliation`.
Never clear a whole collection blindly; list or query first and delete only the documents that match these rules.

Session start in `references/board-refresh.md` already re-arms the wake-up by reading and republishing the board; this housekeeping runs afterward, not as a separate wake-up proof.
