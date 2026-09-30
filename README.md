# Social Campaign

Social Campaign runs social content jobs in a local working folder and shows their progress, outputs, reviews, tokens, and timing on a board.
The current implementation adapts `social-media-pipeline` v0.12.13 and the board presentation from `CS-pre-production` v0.1.24.
The local workflow is ready for a supervised trial; a complete campaign in the real Claude host remains to be verified.
Version 0.7.3 keeps brand onboarding clear from start to save. The brand form stays in Researching until research is done, even in the moment before research starts or while it restarts, and lets you fill it in by hand if research never begins. The Inbox tells you when onboarding has started and when the profile is ready to check and save. Logo options no longer include icons from other brands such as Gmail or social networks, each option can be removed on its own, and Remove logo works while research runs. Choosing a post or campaign opens the New job form once a brand is ready, and Notify Claude only appears when the automatic message did not go through.
Version 0.3.18 reads the brief into the job at Create job so it routes and researches right away, adds a Finish the brief form for anything genuinely missing, and shows research, strategy, concepts, storyboard, price, final post and posting on the board to approve there or in chat.
Version 0.3.17 moves a board logo to the local workspace as a file, so its bytes never pass through Claude, and deletes the transit copy from claude.ai; board requests follow an exact step list.
Version 0.3.16 gives the brand card the same subtle border as the pre-production board instead of a gold one.
Version 0.3.15 keeps what the person typed in the brand card when they add a logo, colour or font.
Version 0.3.14 keeps keyboard focus in place when adding or removing colours, fonts and the logo, and shows the full brand status on phones.
Version 0.3.13 redesigns the brand card's logo, colours and fonts section to match the rest of the card, with an upload tile, colour and font rows, and clear empty states.
Version 0.3.12 brand onboarding captures the logo, colour palette and fonts from the website, shows them on the board to edit, and New job waits for Save and continue.
Version 0.3.11 keeps the brand context fields at one fixed height with their own scrollbar.
Version 0.3.10 applies board clicks immediately with no second approval in chat, including brand onboarding, connectors, new job entry, and gate decisions.
Credit approvals apply at the board-shown amount and are re-presented if the quote changed.
The onboarding button cycles through Start onboarding, Researching, and Save and continue states.
Research fills profile text fields directly without displaying source notes.
The Connectors step displays provider cards in a full-width stacked layout.
A Notify Claude button appears only on waiting requests and replaces the previous Signal pipeline action.
The board header displays when it was last updated.
Context fields are taller and scrollbars are styled to match the brand theme.

## Start with the current plugin

You need Claude Code installed and signed in, Node 22.13 or later on your PATH, and a browser only when you choose the explicit local board fallback.
The bundled server has no npm dependencies to install.
The source `social-media-pipeline` and `CS-pre-production` repositories are not required on the test machine.

Open a terminal in this checkout, then start a fresh Claude Code session:

```powershell
claude --plugin-dir .
```

If your terminal is elsewhere, pass the absolute path to the plugin folder instead of `.`.
Invoke `/social-campaign` from Claude's slash-command menu to open the existing board, or invoke `/social-campaign:setup` to set up the explicitly selected current project workspace.
Claude starts the bundled server.
When the current project already has a workspace, setup reuses it and its existing private artifact.
When the project is unbound, setup offers one current-project folder choice in chat and uses only the folder you explicitly select.
Setup creates, binds, and opens a new artifact automatically when that selected workspace has no artifact yet.
Invoke `/social-campaign:setup --new` only to publish and bind a replacement artifact for the same workspace from local authoritative data.
Use version 0.7.3 for this trial; an older 0.2.15 installation does not include the new workflow.

### Update an existing marketplace installation

Refresh the marketplace and update the plugin:

```powershell
claude plugin marketplace update 3echo-social-campaign
claude plugin update social-campaign@3echo-social-campaign
```

Restart Claude Code after the update to load version 0.7.3.
If you load the plugin with `--plugin-dir`, pull the latest checkout and start a fresh session with that directory instead.

## Set up a local workspace

The plugin folder contains the application; the working folder contains your brands, jobs, inputs, and results.
Choose a separate, dedicated local working folder for the first trial.

1. Invoke `/social-campaign:setup` and choose the one current-project folder offered when the project is not already bound.
2. Use the artifact that setup creates or reopens for that workspace.
3. If no brand is ready, submit the inline Brand onboarding form before starting a job.
4. Once a brand is ready, choose New job or Brand onboarding to add another profile or update an existing one.

You can also reopen a recognized workspace to continue its saved brands and jobs.
The workspace folder can be moved or renamed and it keeps working; a copy of it becomes its own separate workspace the next time it is opened.
Keep the Claude session running while using the artifact so the local runner can handle requests.
Setup also asks whether to connect 3Echo Studio and ElevenLabs, with an option to skip either one and connect it later from Connectors on the board.

Workspace setup and onboarding do not require Google Drive, a Studio account, or a research helper installation.
The local files and runner do not make network requests.
Artifact presentation and later online research or provider tasks have their own host and connectivity requirements.
The research helper installs automatically in the background once a workspace is approved.
Media tasks may require ffmpeg, ffprobe, or yt-dlp; check those tools only when the active task needs them.

### Complete brand onboarding

Submit the inline form once with a brand name, its website, Facebook, Instagram, and TikTok links, and anything you already know about its audience, market and positioning, brand voice, content pillars, and competitors.
Each channel accepts a full URL or its explicit `Not available` toggle.
The top 3 competitors default to Singapore market research when you list fewer than 3; the profile keeps your own entries when you add them.

After you save the profile, a research pass runs with Claude's web tools while the local runner stays offline.
Any of the five context fields left blank is filled in by the research; a field you changed, including one you cleared, stays as you entered it.
The research finds articles, social posts, ad samples and brand statements as evidence; you can review these sources and findings before accepting them.

New job becomes available after the profile is saved as complete.
The saved profile can be reused across jobs, and entering a social account URL does not authenticate a publishing connector.

## Run the first job

After workspace selection, the private Claude artifact is the default board.
If the host cannot publish or sync the artifact, setup stops with the missing native capability and the local browser board remains available only after you explicitly request local mode.

Start with one organic text-only post and local delivery.

1. Choose New job for an onboarded brand and enter a title and written brief.
   Specify the platform, audience, objective, deliverable, and any timing or brand restrictions you know.
2. Optionally select local source files or folders outside the working folder.
   Imports copy the selected files into immutable revisions and preserve the originals.
3. Answer the intake questions shown for missing information.
   Continue the saved draft with the same job ID until its route is ready.
4. Follow the stages generated from the job's plan on the board.
   Claude runs the planned agents and asks for a provider connection only when a stage needs it.
5. Review the generated outputs and request one revision during the trial.
   Approve the current files at each required gate before continuing to local delivery.
6. Inspect the saved outputs, events, token observations, and timing.
   Missing measurements should remain unavailable.
7. Restart Claude with the same plugin, reopen the working folder, and continue the same job.
   Confirm that its outputs, decisions, and progress remain present without duplicated work.

Incomplete intake stays on the existing draft; use its continuation action rather than creating a replacement job.
If a review becomes stale after an edit, refresh it and approve the current revision.
Record the job ID and exact action if anything fails during the trial.
Use `/social-campaign:doctor` only when you need the manual compatibility diagnostic.

## Workflow and guardrails

The bundled runtime under `pipeline/` owns routing, frozen plans, state transitions, research budgets, artifact validation, approvals, delivery, and reporting.
Its local overrides are recorded in [LOCAL-ADAPTER.md](pipeline/LOCAL-ADAPTER.md).

The nine active agents are producer, researcher, strategist, copywriter, scriptwriter, media-buyer, videographer, editor, and publisher.
Their permissions, task ownership, and dispatch rules follow the source pipeline.

Dispatch only the active tasks in the current plan.
Reuse accepted evidence, media analysis, validation results, tool responses, and board addresses while their inputs and revisions remain current.
Research covers one named workstream per dispatch and searches only a documented gap.
Provider checks belong to the task that needs the provider.

Paid generation requires its spending approval.
Scheduling and publishing require final approval.
A board decision must match the current gate, job revision, and exact reviewed file hashes before the local runner applies it.

## Board and local files

The board uses the reference repository's navy and gold presentation with a production slate, routed job stages, output details, decisions, and metrics.
Artifact mode is the default presentation for a selected workspace.
The workspace projection is written to `.social-pipeline/board/workspace-projection.json`, and the artifact database stores it with db (with access rules) and comments capabilities.
The Claude artifact adapter is available through `board-setup` and `board-sync` when the host exposes its Artifact, ArtifactData, and comments tools.
The local browser board remains an explicit mode outside the setup flow.
Use `/social-campaign:setup --new` only for explicit recovery when the old artifact needs replacement.
Replacement publication binds the new host URL immediately, keeps the old binding when publication fails, and preserves local brands, jobs, files, approvals, events, and metrics.
The backend preserves the prior binding bytes in a local recovery backup at `.social-pipeline/board/binding.json.recovery-<sha256>.bak`, adding a unique suffix on collision.
Requests or comments that existed only on an inaccessible old artifact cannot be restored from the local projection.
Routine source freshness updates keep the existing artifact URL.
Local absolute paths and source file bytes stay on the local runner and are not entered into the artifact database.
Live host publication, metadata writes, artifact watch, and automatic decision wake-up still require verification on the supported host.

Brand onboarding and new job intake stay inline in the board, preserve drafts while Claude validates requests, and use explicit `Not available` channel controls when a profile has no URL.

```text
<working folder>/
  .social-pipeline/                 Workspace identity, requests, and migration records
  inputs/<brand>/<job>/              Immutable source revisions
  workspaces/<brand>/brand/          Reusable brand profile
  workspaces/<brand>/onboarding/     Research runs with evidence and findings
  workspaces/<brand>/jobs/           Briefs, routes, plans, outputs, approvals, and events
```

The board shows routed stages, current outputs, review decisions, and metrics at the bottom: a "Usage by stage" footer with Claude tokens (native token count) and wall-clock elapsed time per stage and per job from start to end, including separate rows for time waiting for your approval, media generation shown in 3echo credits with ElevenLabs marked "Not reported", and Brand research metrics shared across every job for that brand.
Unknown measurements remain unavailable instead of displaying invented zeroes.
Stop and SubagentStop hooks collect supported Claude Code usage without replaying an existing receipt.
The API-equivalent cost estimate stays in local report data only and is not shown on the board.
Tool-call records with timestamps and durations stay local for the team to review and are never shown on the board.

Legacy SQLite workspaces have a previewable, resumable migration with backups and verification.
Imported approvals remain history, and imported jobs stay blocked until reviewed.
Migrated jobs cannot execute through both workflow engines.

## Optional connectors and parked Studio sync

When a job needs supported generation or asset operations, use the authenticated native connectors actually available in that Claude session.
3Echo Studio connects only through the person's own claude.ai connector, added from Settings > Connectors; the plugin no longer bundles a Studio MCP entry or a sign-in of its own.
Local setup and text-only trials can proceed without authenticating that optional connection.
The Studio MCP extension and Supabase implementation are parked while the plugin is tested.
Local jobs can remain unbound, and their data is not synchronized into Studio.

The reference repository uses Studio generation calls, but its artifact database is a separate Claude relay.
It does not establish a Studio API for ingesting our workflow jobs and metrics.
Live database ingestion requires implementing the proposed backend contract.
Future outbound records require a verified Studio owner user ID, with verified email as metadata.
Workspace ownership alone is not proof of the current authenticated user.

The agreed destination for new Social Campaign records is a separate Supabase PostgreSQL database reached through that backend.
Existing Studio MongoDB, authentication, media, and generation remain in place.

## Verification status

The 0.3.5 backend focused checks passed 31 cases plus 2 artifact-refresh cases, and the active tool reference and manifest checks passed.
The frontend artifact transport checks passed 5 of 5 cases, the board escaping check passed, and `buildBoard` embedded the exact supplied logo bytes without a machine path.
An isolated browser fixture using the actual artifact-mode board and mocked native database, comments, permissions, and runner controls covered the inline onboarding gate, live draft and focus preservation, pending combined requests, applied brand readiness, existing-brand receipt gating, inline New job entry with an existing project, and applied job navigation with metrics visible.
The browser fixture was a local contract mock and does not prove live host publication, native artifact availability, or hosted comments and watch behavior.
The current CUA surface did not expose a narrow viewport override or a filesystem screenshot path, so the focused browser evidence is desktop-only and its screenshot is available inline in the QA task transcript.
Live generation, publishing, Studio ingestion, host artifact publication, metadata writes, artifact watch, and decision wake-up remain unverified.

Historical validation reports describe earlier releases and do not prove the new workflow.

