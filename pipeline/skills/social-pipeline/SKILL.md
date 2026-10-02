---
name: social-pipeline
description: >
  Entry point for Social Pipeline. Reads what is already in progress, then asks whether to start a
  new job, resume one, or onboard a brand, and routes accordingly. Use when the user types
  /social-pipeline or says any of "start social pipeline", "run the pipeline", "make me a post",
  "I need content", "let's do some ads", or asks what this plugin does or where a job got to.
metadata:
  version: 1.0.0
---

# Social Pipeline

## Contents

- Social Campaign local adapter
  - Local authority
- Steps
  - 1. Look before you speak
  - 2. Say what this is, in one line
  - 3. Read intent and ask only when needed
  - 4. Route
  - 5. Mention setup only if something is missing
- Rules
- Output contract
- Boundary
- Failure modes

## Social Campaign local adapter

Read pipeline/LOCAL-ADAPTER.md before following this vendored flow.

The root Social Campaign skill and pipeline_* tools own local setup, brand onboarding, board presentation, and decisions.

Use the route and plan files from the selected local workspace.

Do not use pane.js, set-gate-app.js, gate-app.json, Drive configuration, or a remote-only root for local work.

Resolve CLAUDE_PLUGIN_ROOT to the installed plugin's pipeline directory and pass the workspace root explicitly to every script.

Dispatch only active plan tasks and reuse current accepted artifacts instead of repeating research or provider probes.

### Local authority

The local adapter above is authoritative for this installation.
The upstream steps below remain as a reference for the source contract and are not an entry path.
Do not execute their pane.js, ask.js, wait-answer.js, gate-app, Drive, or remote setup commands.
Use the root social-campaign skill, pipeline_status, pipeline_board_open, and board-setup or board-sync for the local flow.

**Purpose:** the one thing a user has to remember. Everything else is reachable from here.

## Steps

### 1. Look before you speak

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-jobs.js"
```

One row per job, in plain words. Never ask a question this answers.

### 2. Say what this is, in one line

> Request in, approved content out. You decide at every gate, including where and when it posts.

Only for someone with no brands yet. With a job on disk, show what `list-jobs.js` printed, in its words.

### 3. Read intent and ask only when needed

If the request is for platform-results review, say "Performance review is not included in this build" and stop.
The current journey ends with approved production, delivery and its usage receipt.

If the message names `new`, `resume` or `onboard` plus an unambiguous brand or job, route directly;
otherwise use the two-question start page.

**In the Code tab:** open the start page first with `pane.js "home"` (`${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md`).
Use `previewUrl` with `preview_start` before anything else.
Show `fallbackFile` only if the pane did not open by itself.
Then ask:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/ask.js" "home" "{questions.json}" --title "Social pipeline"
node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-answer.js" "home" 0
```

Two questions, always the same two, whatever is on disk:

1. `choice`, single, "What would you like to do?", always all three options: `new` "Start a new job", `resume` "Resume a job", `onboard` "Onboard a brand".
2. `which`, text, "Which brand, or what would you like made?", placeholder "sk-ii, three TikToks about Trial 2".

Order by what is likely: a job waiting on a decision puts `resume` first and names it, otherwise `new` leads, and with no brand `onboard` leads.
Never drop an option for looking unlikely; the box alone is also a complete answer, so read the intent and route on it.

**Anywhere else:** `AskUserQuestion`, unless intent and target are already unambiguous.

Every option line says what happens next, not what it is called:

> **Resume job-20260902-tiktok-ugc** - Waiting for you to approve the storyboard. Nothing is spent yet.

### 4. Route

| They chose | Do |
|---|---|
| Resume | `resume-job` with that brand and job id. It continues; it does not reintroduce it. |
| New job | `new-job` with the brand, which scaffolds and asks the intake questions. |
| Onboard | `onboard-brand` with the brand slug. |

What runs next must not repeat the table or question.

### 5. Mention setup only if something is missing

The SessionStart hook already reported what is missing. Repeat only that, with the command. The 3echo MCP is needed only after storyboard approval.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Read the disk before asking anything.
2. Offer all three choices every time; order them, never remove one.
3. Never start work because someone typed the command. Ask, then act.
4. Never list every skill, and never print a state id.
5. Never search email, Drive, Slack or any connector looking for briefs or brands.

## Output contract

Writes nothing. Routes to `new-job`, `resume-job` or `onboard-brand`.

## Boundary

Does not scaffold, intake, route, or run any stage. Does not ask for a brief; `new-job` finds it. Does not open a job page; the skill it routes to does.

## Failure modes

| Failure | Fix |
|---|---|
| Dropping a choice that looked unlikely | All three are always offered |
| Making them type a job id you already read | Offer it by name |
| Burying a job that is waiting on a decision | Lead with it |
| Asking in the chat with the pane open | Ask on the start page |
| Printing the web address | Use `previewUrl` only with `preview_start`; show `fallbackFile` in the response |
