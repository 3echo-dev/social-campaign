---
name: board-setup
description: Publish the Social Campaign workspace board as a private Claude artifact.
user-invocable: false
metadata:
  version: 0.3.3
---

# Board setup

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

This skill owns the shared artifact projection, metadata, watch, Signal, and open lifecycle for both the main entry and `/social-campaign:setup`.
The caller owns explicit workspace selection and the normal versus `--new` decision.
The `--new` caller must complete its source-first host publication and replacement bind before handing the result here.

Reuse the current workspace status supplied by the entry flow.
Call `workspace_status` only when that context is missing or the selected workspace changed.
An artifact URL already known for that workspace is reused as an address, never as proof that its source is current.

For normal setup, call `pipeline_board_open` whenever no result from this same turn already carries a `sourceStatus` for that URL, and select exactly one lifecycle mode from its result.
Before publishing anything, apply social-campaign/SKILL.md's "Check for a finished update before anything else" to the first successful `pipeline_board_open`, `pipeline_status` or `pipeline_board_source` result this session sees, unless the caller already checked one: when it finds the server superseded, deliver its one plain line and publish, refresh and bind nothing with this server.
A board already existing for this workspace is not the end by itself: its `sourceStatus` decides the mode, not the mere presence of a URL.
For a `bound` result with `sourceStatus: current`, keep the existing URL and use its returned `documents` for the document write below.
For a `bound` result with `sourceStatus: needs_refresh`, call `pipeline_board_source` once, read the existing board with the Artifact tool's `read` action, publish the returned `filePath` and `files` with that same `url` plus the returned `capabilities` and `icon`, and bind that same URL with the new `workspaceId`, `sourceHash`, and `sourceVersion` receipt.
A session-start reminder that the board page is out of date follows this exact same path, without calling `pipeline_board_open` first to learn `sourceStatus`.
So does a `pipeline_status` result carrying `boardSourceOutdated: true` mid-session, since a plugin reload raises no new session-start reminder.
For a `bound` result with `sourceStatus: unverified`, call `pipeline_board_source` once when safe source documents are not already supplied, read the existing board with the Artifact tool's `read` action, publish the returned `filePath` and `files` with that same `url`, and bind the same URL with the resulting source receipt.
Every bound mode keeps the existing URL and never starts a second artifact publication.
An existing board must always be read before it is published again; a publish with `url` to an artifact this conversation has not read or published is refused.
The board page is a small shell; its code and styles are the supporting files `board.js` and `board.css`, returned by `pipeline_board_source` as a `files` map (published path to source file). Every publish of the board passes the returned `filePath` as the page and the returned `files` map as `files`, exactly as returned.
So the first publish to an existing board `url` in a session goes in this order: in one message, issue both calls in parallel, the Artifact tool's `read` action on that `url` and its `list` action with `scope: "files"` and that `url` (so the existing supporting files count as seen); then publish once with `file_path` set to the returned `filePath`, `files` set to the returned map, and that same `url`. The small page comes back inline, so there is nothing to Read.
Skip the read when this session already read or published that `url`.
One-time migration: if the live page is still the old large single-file board, the `read` result says it was saved to a file instead of returning the page inline. Then Read that saved file completely, as the host requires for a large page, in parallel chunks in one message. Long minified lines can push a chunk over the Read tool's 25,000 token limit, so check line lengths first (for example `awk '{ if (length($0) > m) m = length($0) } END { print NR, m }'` on the saved file) and size chunks by line count to stay under it, about 150 to 200 lines each unless the longest lines call for fewer; re-read a failed chunk in smaller pieces. Then publish as above. This happens once, on the first publish after the shell format ships, and never again.
If a publish is refused as not having viewed the live version, do the same: Read the saved file path given in the refusal as the migration step describes, then publish again. If it is refused because a supporting file path was not seen, call the Artifact tool's `list` action with `scope: "files"` and that `url`, then publish again. Never pass `overwrite_unread`. Say nothing about any of this to the person.
For a `needs_publication` result, call `pipeline_board_source` once for the current source revision.
Publish its returned `filePath` as a new private artifact, passing its returned `files` map as `files`, using the host's actual Artifact tool with the returned `capabilities` object and `icon`, exactly as returned.
Use the returned title and description.
Inspect that tool's schema rather than inventing a tool name or capability option.
Bind the publish result immediately with `pipeline_board_bind`, passing the returned `workspaceId`, `sourceHash`, and `sourceVersion`.
Retrying a publish must reuse the known returned URL and must never publish a second artifact.
If a normal open or binding inspection reports a corrupt, incomplete, or invalid saved binding, explain that `/social-campaign:setup --new` is the explicit recovery path and stop without auto-replacing it.

For an explicit `--new` handoff, use the caller's returned URL, source receipt, and safe `source.documents` directly.
The replacement handoff skips only status, board-open discovery, source, publication, and bind calls that the caller has already completed.

## Shared readiness

`pipeline_board_open` and `pipeline_board_source` return `documents`: a list of `{collection, doc_id, file_path}` entries, the job documents first and the workspace projection last.
Use the returned `documents` for a current bound result, and use the supplied `source.documents` for refresh, first publication, and replacement modes.
Write every entry, in order, with the host's ArtifactData `set` action and exactly those three values; never type or paste the document contents yourself.
A `jobDocs` entry carries one job's review, research, strategy and output contents for the board, and needs no read first.
For the `socialCampaign` `workspace` entry, also set `if_version` to the last read version.
On a version conflict, read the document once more and write once more.
Each `set` result is the confirmation of that write; do not read the documents back, and never read them at a lower access level, which shows an empty board.
Publishing the board above already re-arms this session's wake-up, the same way a later read-then-republish does; there is nothing further to observe before reporting the board ready.
When this turn published the board, the publish already shows it in chat, so do not call the Artifact tool's `open` action and do not paste the URL again.
Only when nothing was published this turn, as with a `current` bound board, open the URL through the host's artifact view.
Tell the user, in one plain sentence, that when the board opens claude.ai asks once whether the board may send their clicks to Claude, and that they should press Allow so board buttons reach Claude.
Use the final summary from the shared document write, its `setupStep`, `brands` and `jobs`, for the readiness route.
The board requires brand onboarding before the first job.
If artifact publishing or database capabilities are unavailable, explain the unavailable host capability and stop the setup flow.

The artifact contains a workspace metadata projection.
Each job's board document also carries that job's text files (trimmed), small image thumbnails, and the prompts used to make its pictures and clips.
The workspace's folder path and credentials are not included.
Any preview upload needs a deliberate selection of the intended output.
Studio database sync stays `not_configured` until its authenticated API contract is implemented.
The artifact database is a separate relay and must not be presented as the live Studio database.

For subsequent updates and requests, follow `board-sync`, including its session-start read, re-arm, and sweep on every later resume.
Use the returned publication URL directly for binding the new artifact.
