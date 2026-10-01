---
name: doctor
description: >
  Manual compatibility diagnostics for the local Social Campaign workspace.
  Use only when the user explicitly asks for a health check or repair.
  Use when the user types /social-campaign:doctor, says "social campaign is broken",
  "check social campaign", or "why can't it generate video".
metadata:
  version: 0.3.1
disable-model-invocation: true
---

# Social Campaign doctor

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

This is a manual compatibility check and is outside the active local pipeline route.

Do not run it as a new-job preflight, a research preflight, or a provider discovery pass.

The local flow uses workspace_status, pipeline_status, and the active board blockers instead.

## Steps

### 1. Run the check

Call the `doctor` tool.

It returns `checks`, each with an `id`, a `name`, a `status` of ok, warn or fail, a `detail`, a `fix` and a `repairable` flag.
It also returns `repairable`, the list of check ids that can be fixed automatically, and a one line `summary`.

Board problems are handled through `board-setup`.

### 2. Report it as a checklist

One line per check, in this order: failures first, then warnings, then the things that work.

Use plain marks and plain words:

```
FAIL  Workspace folders   2 folders are missing: campaigns, generated.
      Fix: I can put them back for you.
WARN  FFmpeg              Not found on this computer.
      Fix: open Terminal and run: winget install Gyan.FFmpeg
OK    Board
```

Then give the one line `summary` the tool returned.

### 3. Offer the repair

If `repairable` is not empty, offer to fix those items, in one sentence each, and wait for a yes.

- Ask before each repair. Never repair without being asked to.
- On yes, call `doctor_repair({check: "<id>"})` once per item, one at a time.
- `doctor_repair` returns `repaired`, a `detail` to read out, sometimes `restart_needed`, and a fresh `checks` list.
  Report the `detail` in the user's words, and if `restart_needed` is true tell them to close this Claude session and start a new one.
- If `repaired` is false, read the `detail` and stop. Do not try the same repair again.

What the repairs actually do, in case the user asks:

- `workspace_pointer` makes this computer remember the right workspace folder again.
- `workspace_folders` creates folders that went missing. Nothing already there is touched.
- `storage` finishes an interrupted storage update, after copying everything aside first.
- `storage_integrity` puts back the most recent good copy of the user's work and keeps the damaged one.
- `research_helper` sets up the optional research helper, or finishes a half done one. It returns straight away and carries on in the background, so tell the user it is running and that nothing waits on it, rather than waiting for it yourself.
- `legacy_publishing_credentials` removes an old publishing key that an earlier version stored on this computer.
  The key still works at the provider, so tell the person to revoke it there.
- Pipeline workspace, `board` and `board_requests` are not repaired automatically.
  Each one's `fix` says what to do next: rerun setup, or ask Claude to publish, refresh or reconcile.

Anything not on that list is for the user to do, using the `fix` text.
FFmpeg, yt-dlp and connecting a provider are always in that group.
The research helper and the old publishing key are the exceptions: they are repairable, because Social Campaign installs the helper itself when asked and removes the stored key itself.
Never install or update them yourself: read the user the one line from `fix` and let them run it.

### 4. Say what it means for the user

Translate, do not dump.

- A failed workspace or storage check means Social Campaign cannot remember anything yet. Offer the repair, or `/social-campaign` if there is none.
- A missing FFmpeg or FFprobe means video and audio analysis will not work. Everything else still does.
- A yt-dlp warning means social research reads less directly.
  Without yt-dlp, TikTok posts and video addresses fall back to web search; without browser impersonation, or on an old version, TikTok answers about half of its reads with a bot check.
  Read out the version from `detail` and the one line from `fix`, which already names the right command for how yt-dlp was installed.
- A research helper warning is never urgent. Research still runs on public pages and web search; the helper only adds the ability to read pages that show almost nothing to a plain reader. If a previous attempt failed, `detail` names what happened in full; read it out rather than summarizing it away. Offer to set it up, say it takes several minutes and downloads a few hundred megabytes, and move on either way.
- A provider that is not connected is normal. It only matters when a job reaches a stage that needs it. Say which one: Image & Video, Voice & Audio, or Publishing.
- A failed pipeline workspace check means the vendored pipeline cannot read its own configuration.
  Offer to run `/social-campaign:setup` again.
- A board that is not ok is usually not urgent.
  Not published yet is normal before the first board-setup.
  Needing a refresh only matters the next time someone opens the board.
  A corrupt or invalid binding needs a fresh board, which `/social-campaign:setup --new` or board-setup provides.
- Board requests waiting on reconciliation mean an earlier board action did not confirm cleanly.
  Nothing is lost while they wait.
  Offer to have Claude reconcile them.

### 5. Offer the next step

If everything essential works, say so in one sentence and stop.
If something failed and cannot be repaired automatically, offer to walk the user through the `fix` one step at a time.

Never show the user a raw tool result, a file path they did not ask for, or anything about storage internals.
