# Job status: {job-id}

> **When resuming any job, read this file first.** Do not infer state from conversation.
> Every time carries its zone. Get one with `date '+%Y-%m-%d %H:%M %Z'`, never from memory.

**Brand:** {brand}
**Job:** `{job-id}`
**Title:** {title}
**Folder:** `workspaces/{brand}/jobs/{job-id}/`
**Current state:** `INTAKE_PENDING`
**Last updated:** YYYY-MM-DD HH:MM
**Next action:** {what happens next, in one line}
**Blocked on:** {who or what, or "Nothing"}

---

## States

Full state list and transitions: the `producer` agent.
This file records where **this** job is, not how the pipeline works.

---

## Stage log

Append a row at every transition. Never rewrite history.

| Timestamp | From | To | By | Note |
|---|---|---|---|---|
| YYYY-MM-DD HH:MM | - | `INTAKE_PENDING` | producer | Job folder created |

---

## Artifact checklist

Generated from `plan.md` once the job is planned. Tick after `collect-artifacts.js` exits 0, never before.

| Stage | Artifact | Exists | Verified (time, sha256 prefix) |
|---|---|---|---|

---

## Approval record

| Gate | Round | Decision | By | When | Hash prefix |
|---|---|---|---|---|---|

---

## Revisions

| # | Raised by | Stage | Code | Attempt | Resolved |
|---|---|---|---|---|---|

---

## Notes

**This section describes the CURRENT state only. Rewrite it at every transition, do not append.**

A note that says "do not generate media" is read as a live command by the next session, so it must
be deleted the moment it stops being true.

{Current state summary. Live constraints. Open items. Running credit tally.}
