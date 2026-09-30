---
name: review
description: >
  Applies a human verdict at a gate: approve, edit, change or start over. Hashes artifacts at
  decision time, writes the approval record, moves the job on, then continues or opens a revision.
  Use for "/social-pipeline:review", "approve", "send it back", "start over", or any verdict.
argument-hint: "[job] approve | change | start over"
metadata:
  version: 1.0.0
---

# Apply a verdict

## Social Campaign local adapter

Read pipeline/LOCAL-ADAPTER.md before this vendored flow.

Present the current revision and exact artifact hashes through the local board.

Persist intent with pipeline_board_request_land and apply it with pipeline_decision_apply after confirmation.

Gate-app transport is parked for local work even when a legacy configuration file exists.

Reject a stale revision or changed artifact and return the user to the current board review.

### Local authority

The local adapter above is authoritative for this installation.
The upstream steps below remain a reference for approval protections and artifact hashing.
Do not execute the Through gate-app, pane, or remote review commands below.
Use pipeline_board_request_land and pipeline_decision_apply after the local board confirmation wrapper validates the revision and exact artifact hashes.

## Read the request

`$ARGUMENTS` holds the whole message; pull each piece by shape, case-insensitively. Brand: the first word matching a folder under the workspace root (`list-jobs.js --json`), else ask, and never guess one not on disk. Job: the first token starting `job-`, else the only job waiting. Verdict: the first verdict word, the rest is the comment.

Four verdicts: **approve** (ok, yes, go, ship) moves the job on; **change** (update, revise, fix) reruns the stage; **start over** (reject, no, redo) rolls back; **edit** approves the file as hand-edited.

## Steps

1. **Identify the open gate** with `list-jobs.js {brand}`; if none is waiting, say so and stop. What that gate covers is the table in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`.

2. **On `edit`, apply the edit first**, literally, before hashing. If it breaks something adjacent, say so rather than rewrite neighbours.

3. **Say it back in one line and wait for a yes**: verdict, gate, job, decider. Skip it when the verdict arrived unprompted with the job named, or from the pane.

4. **Record:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/record-approval.js" {brand} {job-id} {gate} {verdict} --by "{name}" --comment "{comment}" {artifact...}
   ```

   Concept gate: add `--max-credits {quoted}`; a content gate authorising posting: `--publish-plan`; on `pick_one`, `--chosen {id}`.

5. **On change or start over**, write `revisions/{n}.json` with `targetTask`, refs, revision, directive and dependencies. Adapt numeric targets through `task-contracts.json`; reject ambiguity; reset that task.

6. **The job moves itself**: `record-approval.js` calls `set-state.js`; if that failed, run the printed line. `set-state.js` posts the stage reached by itself.

7. **Continue**, handing back to the producer for the next supported production task.
   Historical report gates are read-only; their decisions cannot promote learning records or restart work.

## Through gate-app

**In the Code tab** the review is a card on the job page, with no widget in chat.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/open-review.js" "{brand}" "{job-id}" "{gate}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-decision.js" "{job-id}" "{gate}" 0
```

`open-review.js` builds the items from the artifacts on disk, panels as images once their frames exist, clips as video, concepts and captions as text, `pick_one` for alternatives and `review_all` otherwise, and prints the chat summary itself. Check once, then end the turn while the review stays open.
On the next user turn, read the saved decision before doing more work.
Never use repeated polling to wait for a person.

**In Cowork or on claude.ai**, unchanged: `review_gate({ job, gate, title, mode, panels })`, one panel per artifact, end the turn, then `get_gate_decision`.

**Either way** the record is the verdict, never a chat message. `approve` records `approve --score {score} --why "{comments}" --gate-app-decision-id {id}`; `changes` records `change` plus one revision per id in `regenerate`, quoting that id's comment; `reject` records `start over`. On `pick_one`, `chosen` is the approved candidate and the others are dropped, not regenerated. At a media gate `changes` then follows "Redoing a picture the person sent back" in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`. A verdict typed in chat while the review is open is recorded with `--from-chat`, which closes the card too.

## Rules

Shared rule 6 pushes decision events.

1. Hash at decision time: an edited file is approved as edited.
2. Never infer approval from silence, urgency or vague positivity.
3. One gate at a time: content approval doesn't approve activation or spend.
4. Every verdict is recorded, including those sending work back.
5. Never delete a superseded approval; `supersedes` links it.
6. A comment contradicting its verdict ("approve, but change the hook") is `changes`, and say why.

## Output contract

`record-approval.js` writes it, never by hand: `approvals/{gate}-{n}.json` against `schemas/approval.schema.json`, times with zones; on `changes` or `reject`, `revisions/{n}.json`; `status.md` and `events.jsonl` updated. Never approves for anyone, edits beyond the instruction, or builds the hand-off.

## Failure modes

| Failure | Fix |
|---|---|
| Recording `decidedBy` as "user" | Ask their name once, it's an audit record |
| Acting on a chat verdict, pane still asking | Record it first |
