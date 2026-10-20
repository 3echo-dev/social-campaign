# Board refresh and session start

Read by `skills/board-sync/SKILL.md`.
Each section is applied exactly as written here.

### Session start

At the start of every new session or resume, and whenever a reminder says to re-arm the board's wake-up, read the bound board with the Artifact tool's `read` action (together with its `list` action, `scope: "files"`, as board-setup's order describes), then republish that same page to the same `url` right away, even when nothing else changed.
Only the one-time migration from the old large board has a saved file to Read completely, in the parallel Reads sized by characters that board-setup's migration step describes, before publishing.
Reading it that way records its long id as the alias automatically; there is no separate call to make for that.

### When the board page is out of date

When a reminder says the board page is out of date instead, refresh it rather than republishing the same page: call `pipeline_board_source` with `url` set to the bound board's address, apply that update check to its result if no earlier result this session was checked, read the bound board with the Artifact tool's `read` action (issuing every Read in the result's `reads` in the same message), publish the returned `filePath` and `files` (only the files that changed) to that same `url` with the returned `capabilities` and `icon`, then call `pipeline_board_bind` with that same `url` and the returned `sourceHash` and `sourceVersion`, exactly as board-setup's refresh path describes.
That refresh already re-arms the wake-up too, so no separate republish is needed after it.

### After either

List the board's saved `requests` and handle every one still marked `requested` or `received` through Land and apply requests in `skills/board-sync/SKILL.md`, exactly as if a comment had just woken the session.

### The board's long address

A comment that names the board by its long `claude.ai/code/artifact/<uuid>` form is the same board as the bound `claude.ai/artifact/<id>` link; treat either address as this session's board.
If a comment's address is not recognized as this board, call `pipeline_board_bind` with `aliasUrl` set to that long form to record it directly.

### A `refresh_board` request

The header button reads Update board when a newer board page is installed.
Follow the refresh path above: call `pipeline_board_source` with `url` set to the bound board's address and check `updateWaiting` and `pluginVersion` first.
If `updateWaiting` is true or `pluginVersion` is missing, publish nothing, decline the request with one plain reason, and tell the person once to open a new chat.
After a plugin update the server normally switches itself to the new version, so this only happens when that switch failed; when the result says `swapped: true` and carries `boardRefresh`, republish the board now without asking.
Otherwise republish and bind the board as that path says, call `pipeline_status` again and write the documents it returns so the board stops offering the update, then mark the request applied with `pipeline_board_request_apply` and the requestId and confirmedBy, the same as any other non-decision request.

### When `pipeline_board_open` reports `needs_refresh`

When `pipeline_board_open` reports `sourceStatus: needs_refresh`, call `pipeline_board_source` with `url` set to the bound board's address, read the existing board with the Artifact tool's `read` action (issuing every Read in the result's `reads` in the same message, as board-setup's order describes), then publish the returned `filePath` and `files` with that same `url` and the returned `capabilities`, which declare the `jobDocs` collection.
Call `pipeline_board_bind` with the same URL and the new publish receipt only after the host update succeeds.
A changed source hash does not prove that the host update happened.
Keep the source file path out of the artifact database.
