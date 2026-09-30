# Settings

Claude reads this file at the start of any job and honours every value.
To change something, edit it here. Asking in conversation does not change it.

## Settings you may change

These seven are yours. Everything below them is machinery.

| Setting | What it does | Default |
|---|---|---|
| `max_parallel_agents` | How many specialists work at once. Lower is slower and cheaper. | 5 |
| `max_open_jobs_per_brand` | How many jobs one brand may have unfinished at once. `new-job-guard.js` refuses a new job at the limit. | 5 |
| `require_*_human_approval` | Which points stop and wait for you. Turning one off means that thing ships without you seeing it. | all on |
| Where the work is kept | Not in this file. Run `set-root.js <folder>`, or pass `--root`, or set `SOCIAL_PIPELINE_ROOT`. | the current folder |
| Sync to a connected folder | `sync-manifest.js` lists what changed since the last copy. Nothing copies itself. | manual |

The approval flags are the reason this thing exists rather than a script that posts for you.
Claude will not change them on request, will not behave as though they were changed, and the write guard refuses to write this file at all.

```yaml
max_parallel_agents: 5
max_open_jobs_per_brand: 5

require_concept_human_approval: true       # before any credit is spent on media
require_storyboard_human_approval: true    # before any frame or clip is generated
require_content_human_approval: true       # the exact copy, media, claims and disclosures
require_publish_human_approval: true       # the account, the schedule, the final files
require_campaign_proposal_human_approval: true
require_campaign_activation_human_approval: true
```

## Internals

Change these only with a reason. The Enforcement column says what happens if an agent
ignores one: **Mechanical** means a script refuses, **Mechanical (function hook)** means
`hooks/hooks.mjs` refuses the tool call itself when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
and the written rule is the fallback when it is not, **Structural** means the agent cannot
do it at all, and Instruction means it is a rule the model follows.

```yaml
# Routing
route_confidence_threshold: 0.8            # below this the job is NEEDS_CLARIFICATION
max_intake_rounds: 2                       # job-intake may ask for missing fields this many times
merge_publish_into_content_gate: true      # one gate when schedule and account are visible at content review
platforms_v1: [facebook, instagram, tiktok]

# Delegation
max_agent_depth: 1                         # only the producer spawns; specialists are leaves
collect_artifacts_after_each_batch: true   # subagents may not share the workspace filesystem
max_machine_revisions_per_stage: 2         # third identical reason code escalates to the human

# Money
preflight_media_download: true             # prove one asset round-trips to disk before generating
media_fallback: thumbnail_review_only      # 480px thumbnails are for review, never for hand-off
one_hero_sample_before_batch: true         # generate one panel, look at it, then the rest

# Evidence
require_sources_for_material_claims: true
number_provenance_required: true           # every number in a skill has a row in docs/sources/

# Output style
verbose: false
```

| Setting | Meaning | Enforcement |
|---|---|---|
| `route_confidence_threshold` | `route-job.js` sets `NEEDS_CLARIFICATION` below it. The producer can add risk flags, never raise confidence. | **Mechanical.** The script is the only confidence source. |
| `merge_publish_into_content_gate` | When `job.schedule` and the account are present, the content gate also authorises the hand-off. Otherwise a separate publish gate. | **Mechanical.** `route-job.js` rule 14. |
| `max_agent_depth: 1` | Only `producer` spawns. | **Structural.** Every specialist sets `disallowedTools: Agent`. |
| `collect_artifacts_after_each_batch` | An agent reporting success is not evidence. `collect-artifacts.js` must exit 0 before a stage advances. | Instruction, with the script's exit code. |
| `max_machine_revisions_per_stage` | The editor may raise the same reason code for the same stage twice. The third time the job goes `ESCALATED`. | Instruction, counted in `revisions/`. |
| `require_*_human_approval` | Each gate: write the artifact, send it, set the state, end the turn. | Instruction, plus `check-approval.js` refusing hand-off without a matching approval record. The spend half is **Mechanical (function hook)**: no approved board, no agreed figure or no explicit yes, and the generation call is refused. |
| `preflight_media_download` | `preflight-media.js` runs before the first generation. Exit 3 means the host is unreachable: stop before spend and say so. | Instruction. The pre-spend gate `preflight-generation.js` is **Mechanical (function hook)**: the guard runs it on every generation call and refuses on anything but exit 0. |
| `one_hero_sample_before_batch` | Generate one panel or clip, inspect it, then generate the rest. | **Mechanical (function hook).** The first allowed call per deliverable locks the rest until `wait_for_job` or `get_job_result` comes back for it. |
| `verbose: false` | Files carry content, not explanations of the system. Chat says what is waiting and what to do. | Instruction. |

File length is no longer a setting. `scripts/test/size.smoke.js` enforces 900 words per agent
and 700 per skill, and fails the build.

## The gate app

Gates can be decided in a grid of panels instead of a wall of text.
The gate app is not declared in `.mcp.json`, because it needs a per-client key and a shipped file must not carry one.
In Cowork and the desktop app it arrives through the claude.ai connector you added.
In the Claude Code CLI add it once with the key as a header: `claude mcp add --transport http gate-app https://gate-app-bice.vercel.app/api/mcp --header "Authorization: Bearer <client key>"`.
Get the key from the gate-app dashboard: sign in, open the client you are approving for, and copy its key when it is shown.
Unset, the server fails to load and every gate falls back to the chat path, which is the whole behaviour in the Claude Code CLI, where the grid does not render.

### Connect the pane from scripts

In the Claude Code tab the plugin's own scripts talk to the gate app over plain HTTP, so the pane keeps working even when the connector is offered without its newer tools.
The key is the same client key as above: sign in to the gate-app dashboard, open the clients page, open the client you are approving for, and copy its key when it is shown.
Then run this once per project folder, with the key as the second argument:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/set-gate-app.js" https://gate-app-bice.vercel.app <client key>
```

It writes `gate-app.json` in the same workspace root `set-root.js` chose, prints `saved`, and never prints the key back.
That file is ignored by git, like `.pane/` and `.social-pipeline/`.
Without it every pane script says so in one line and the run carries on in the chat.

### The workspace pane

The Claude Code tab in the desktop app has something the other surfaces do not: a browser pane beside the chat.
The pane is where a reviewer answers, while the current turn presents the card and ends.
In the Code tab the gate is a card on the job page, opened with `open_review` and read once with `get_review_decision` when the presenting turn resumes.
In Cowork and on claude.ai it stays `review_gate` and `get_gate_decision`.
The click saves straight to gate-app.
A host notification or a later manual resume consumes that saved decision, so no model turn waits on a human.

The pane opens at the start, not only at gates.
Every page has a key: `home` for the start page, `brand:{slug}` for a brand, the job id for a job.
The agent calls `workspace_url({ key })` the moment the key is known, opens that page in the pane, reports each stage with `set_progress`, and runs one bounded sync at the stage or turn boundary.
It is the running view of the job.

This needs the desktop app's Code tab: it is the only surface with the pane.
In Cowork, on claude.ai and in the CLI there is no preview tool, the paragraph above does not apply, and the inline widget stays the gate.

## Tokens

What a job cost in tokens is recorded where it can be: the environment decides, not a setting.

In Claude Code the `Stop` and `SubagentStop` hooks in `hooks/hooks.json` run `scripts/hooks/tokens.js` at the end of every turn.
It reads the session transcript from the offset it last stopped at, sums `usage` per model, and appends one `tokens.observed` line per model to the open job's `events.jsonl`.
Offsets live in `<job>/.tokens-cursor.json`, keyed by session and agent, so the main session and each subagent are counted once each.
Read the numbers back with `node scripts/tokens-summary.js <brand> <job-id>`, which prices them from the table in `docs/benchmarks.md`.

Cowork does not fire plugin hooks at all, so no `tokens.observed` event is ever written there and the dashboard shows tokens as "not reported".
The credit tally in `status.md` is the only cost figure a Cowork run produces.

If you already run an OpenTelemetry collector, Claude Code can export the same counters to it: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
Nothing in this repo reads or requires them; the transcript gives the same per-job numbers without a collector.

## Function hooks

Most of what this plugin promises is a rule the model is asked to follow.
Function hooks are the first thing here that can refuse a step outright, and they are off unless you turn them on.

Three entry points turn them on for you, so nobody has to know they exist.
`set-root.js` when you pick the folder, `scaffold-brand.js` when the first brand lands, and the session hook in a folder that is already the pipeline's.
A folder is the pipeline's when it carries a root setting or at least one brand with a `workspace.json`; a `workspaces/` folder that means something else to some other project is never touched.
Settings are read when a session starts, so the session that arms them is still unguarded and the next one is not.
It merges the one line into the project's `.claude/settings.json`, keeping every other key that file already had.
A settings file it cannot parse is left exactly as it is, and the line to add is printed instead, because somebody's own configuration is worth more than this convenience.
Pass `--no-guards` to skip it.

To do it by hand, put this in the project's `.claude/settings.json` and start a new session:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

Setting `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the shell before `claude` does the same thing.
`check-deps.js` says the flag is off at the start of every session that has not set it, so nobody assumes a guard is on when it is not.

With the flag on, `hooks/hooks.json` loads `hooks/hooks.mjs` beside the five command hooks, which stay.
Today that module registers seven events: `session.start`, `tool.call`, `skill.prompt`, `turn.start`, `turn.complete`, `prompt.submit` and `tool.describe`.
The guards land one at a time, and `docs/FUNCTION-HOOKS-PLAN.md` is the order they land in.

### What the model is told, every turn

`prompt.submit` attaches a block to every prompt a person submits, which the model reads and the person never sees: the brand and the job, where it is up to in the wording table's own words, the open gate and whether it is still theirs to decide, what they were asked, and what the job has cost against the figure agreed at the gate.
With it go the two standing orders: read the decision before answering "continue", and put a verdict or an answer typed in the chat on record with `record-chat.js` or `record-approval.js --from-chat` before acting on it.
Nothing is attached when no job is open, and the prompt itself is never rewritten.

While a question or a review is open, `prompt.submit` also says what the prompt itself looks like: a verdict, an answer, or nothing worth naming, from the recorder's own vocabulary, with a small model asked only when the words are ambiguous.
A prompt named as either gets one more line saying to record it with `record-chat.js` or `record-approval.js --from-chat` before acting on it, and a turn that ends with neither having run tells the person their verdict is not on record yet.
The prompt is never rewritten and never dropped.

### What watches the pane

With somebody at the prompt, `session.start` does not start a gate timer.
The turn that presents a question or review makes one bounded read through `wait-answer.js` or `wait-decision.js`, then ends with the waiting status.
The address and the key stay in `gate-app.json` and never enter the module.
A host notification or a later manual resume reads the saved result and records it once before continuing.
A headless run follows the same one-shot rule.
Provider job polling remains allowed only inside a bounded provider operation with explicit progress and cancellation.

`tool.describe` appends one paragraph to the description of `AskUserQuestion`, the two spenders and the write tools: that a question goes through `ask.js` and one-shot `wait-answer.js` while a page is connected, the `idempotencyKey` format the spend guard reads, and what the write guard refuses.
That is decoration and not a guard. An MCP tool's schema is deferred, so the rewrite lands only once the model has materialised the tool; the deny is what stops anything.

### What refuses a spend

`tool.call` is the spend guard. It refuses `generate_*`, `create_studio_*`, `start_studio_flow`, `advance_studio_flow` and `refresh_studio_*` outright: nothing in this pipeline needs them.
On `create_image_job` and `create_video_job` it refuses unless all of this holds at once:

- a job is open in this folder, and `preflight-generation.js` exits 0 for it, which is the approved board, the manifest and the tool limits; the figure they last agreed is reported beside the quote, never enforced, because panels are added and cut after a gate
- the call's `idempotencyKey` reads `{job-id}/D{n}/{panel or clip id}` and names a panel the approved plan actually covers
- the panel or clip has a price: one credit for an image, and for a clip the figure in the plan or the one `estimate_video_job` returned for those exact arguments
- an explicit yes to the quote is on record, which the guard learned by watching `wait-answer.js` print it
- the hero panel of that deliverable has come back, unless this is the hero

Every refusal is one plain sentence with no path and no state id in it, because the model reads it as its next instruction.
Anything that throws inside the check is a refusal too: a guard that fails open is not a guard.
`scripts/test/function-hooks.unit.js` drives every one of those refusals on every commit.

With the flag off, the module is never loaded and the plugin is exactly the plugin that shipped before it.
That is a test, not an intention: `scripts/test/function-hooks.e2e.js` starts a session without the flag and fails if the module appears.

### What refuses a write

The same `tool.call` guard reads every `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash`.
It refuses:

- a job's `status.md` written by hand; `set-state.js` is the only thing that moves a job
- an approval record, `events.jsonl` or `events.pushed` written by hand; `record-approval.js` writes all three
- a brand file or `learnings.md`, unless the `onboard-brand` skill is running in this session, which is the one place a person is being asked about them
- anything inside the plugin's own folder, and `CONFIG.md` wherever it sits
- any markdown write or edit that puts a verdict under a `# Decision` heading, which is a forged approval, because `hash-artifact.js` drops that section before hashing
- a `Bash` command carrying a shell heredoc, which loses the file on this machine; a plain redirect is not touched
- a write outside `workspaces/`, `inputs/`, `.pane/` and `.social-pipeline/`, which belongs to no job and which nothing here would ever read

Per-agent `writes:` contracts stay Instruction, and always will.
A subagent's tool calls arrive in the parent session's module with the same session id and nothing at all naming the agent, so the guard protects paths for every caller alike; it cannot tell the editor's write from the producer's.

### What says the run is alive

The same `tool.call` hook also runs `scripts/hooks/heartbeat.js` on the side, at most once every fifteen seconds, never waited for and never able to fail a call, so the pane keeps ticking through the long stretches where a run is reading and thinking and calling nothing this plugin owns.

### What says whose turn it is

At the start of every turn the module pins one line under the prompt: the brand, the job and where the job is up to, in the wording table's own words, and nothing at all when no job is open in the folder.
At the end of a turn that hands the job back to the person, it puts the waiting card on the pane through `scripts/hooks/turn.js` and draws that same sentence beneath the answer, once per job and state, so the question exists on both surfaces rather than only in the chat.

### The rule about asking

A hook may put a question up itself only when a person is at the prompt, no `gate-app.json` resolves for the workspace, the question is a yes or no about spending or about a destructive write, and it has not already been asked for that same tool call.
When the pane is connected the hook refuses instead and the question goes through `ask.js`, so it lands on both surfaces.
With nobody at the prompt a hook never asks; it decides from what it already knows and refuses if that is not enough.

## Environment notes

- Windows: use `python`, not `python3` (the Store stub). Use project-relative paths, never `/tmp`.
- Set `PYTHONUTF8=1` for any Python reading markdown with curly quotes.
- Cowork: MCP calls work, HTTP egress to the 3echo asset host may be blocked. `preflight-media.js` finds out for one request.
- 3echo video jobs: 4 to 15 s per clip, up to 9 image references, quote with `estimate_video_job` first. Images: 1 credit each, up to 16 references.
