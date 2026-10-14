# Folders added on the board

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4d. Folders added on the board

The board's "Logo, colours and fonts" section has a "Your videos, photos and fonts" block.
The block sits on the brand's own page, so it works from the moment the brand is created, before research starts (step 2) as well as after.
The person first answers "Who owns the files in this folder?" with one of three cards: Ours (the rights `ours`), Client work, ask first (`client_ask`) or Reference only (`never`); the "Choose a folder..." button turns on once one is picked, and then they pick a folder of the brand's videos, photos or fonts in a dialog that opens on their own computer.
The board is a browser page and cannot read a path on this computer, so a pick arrives as a `brand_folder_pick` request with `{ brand, rights, label? }` and no path.
The person can also open "Or paste a path" and type the full path of a folder, which arrives as a `brand_folder_add` request with `{ brand, folder, rights, label? }`.
They can add as many folders as they like.
The rights are the person's own answer from the board: never change them and never ask again.
For a `brand_folder_pick`, land it with `pipeline_board_request_land`, then call `pipeline_folder_pick` with its `requestId` and `confirmedBy` set to `board request <requestId>`.
The tool opens the operating system's folder dialog on the person's computer, waits up to 3 minutes and imports the folder they choose exactly as `brand_folder_add` does (the same checks, the person's rights, the same receipt), so do not also call `pipeline_board_request_apply` or `brand_footage_import` for it.
Say once, in plain words, that a folder picker has opened on their computer and may be behind other windows; the board already says so.
Its `status` tells what happened: `applied` carries on below (it names the folder in `name`); `cancelled`, `timeout`, `unavailable` and `refused` mean it has already declined the request with a plain line the board shows, so say in one line what happened (for `unavailable`, that a picker could not open here and "Or paste a path" works instead), write its `artifactReceipt` to the board, publish the workspace projection and ask nothing more; `handledElsewhere` means another window has it, so say nothing.
For a typed path (`brand_folder_add`), land it with `pipeline_board_request_land` and apply it at once with `pipeline_board_request_apply`, `confirmedBy` set to the board request: the click is the approval, so there is no chat confirmation.
The apply imports the folder exactly as `brand_footage_import` does and starts reading it in the background, which is free; nothing is copied, moved or changed.
Do not call `brand_footage_import` for it as well.
If the apply refuses (the folder is not there, it is too broad, or it was already added with other rights), say the refusal's plain line in chat, decline the request with `pipeline_board_request_decline` and that line as the reason, and publish the workspace projection.
After a successful apply, publish the workspace projection so the board lists the folder.
When the folder arrives before research has started (the person is still filling in the brand's page, step 2), stop there: say in one line that the folder is being read, and do the steps below once the person has pressed Start research and the research pass is under way, so a person adding folders on the page is never held up.
Otherwise do the following in order.

1. Let it read. `brand_footage_status` shows how far each folder got; it carries on without you, so check it only when you have nothing else to do, and carry on with the steps around this one meanwhile.
2. Look at a few files, without asking: the board click already covers a small first pass. Describe at most 20 files per request, videos first (at most 10) and then pictures, never a file in a `never` folder and never a font. Use `brand_footage_search` with `analysed` none, and describe each as 4c says: for a video its frames and, at no cost, its first spoken words; for a picture, look at it (its `path`, or its `thumbnail`).
   Save stage `quick` with `brand_footage_analysis_save`. For a picture, `opening` says what is in it, with `products`, `mood`, `style`, `logoVisible` true when a logo shows and `isLogo` true when the picture is itself a logo. For a video, also give `hook` (its opening line or visual hook) and `style` (for example "talking head with captions"); the hook, style, shot types and on-screen text of a video go into the brand library as the brand's own proven lines by themselves, with the file as their proof.
3. Ask before the full pass, with the count. Say how many videos and photos there are and how many you looked at, then ask with `pipeline_board_ask` whether to break the best clips down in full, for example "I looked at 20 of your 52 videos and photos. Want me to break down your best clips in full? It reads each clip closely and uses model usage." Mark the files they pick with `brand_footage_mark`, tell them how many are marked, and ask again before you start. Then do the full pass as 4c says.
4. Call `brand_footage_digest` and report in plain words what was found, from its `summary`, for example "12 videos, 40 photos, 2 fonts: Montserrat, Playfair. I looked at 20 of them." Add one line for each thing it did or offers:
   - Fonts: when the kit had no fonts, the families found are already in the kit's Fonts, and the person confirms them with Save and continue like the rest of the kit; say so. When the kit has fonts and `fonts.offer` lists more, ask which to add with `pipeline_board_ask`, then call `brand_footage_adopt` with the `fonts` they chose.
   - Logo: only when `logos.offer` is not empty (the kit has no logo). Ask "Is this your logo?" with its file name, and on a yes call `brand_footage_adopt` with `logoFileId`. Never replace a logo the person already has; use `replaceLogo` only when they say so in their own words.
   - Photos of your world: when `photos.offer` has pictures and `photos.room` is above 0, pick at most that many that show the brand's place, people or product in use (not a logo, not a screenshot), say in one line what each shows, and ask once whether to add them. On a yes call `brand_footage_adopt` with `photoFileIds`. The photos the person chose themselves are never replaced, and when there is no room say nothing.
   - When the person says no to an offer, call `brand_footage_adopt` with `pass` so it is not offered again.
5. A file in a `ours` folder is free to use; a `client_ask` file needs the person's yes before it is posted, and learning from it or offering it here is not posting it; a `never` file is never described, offered or used. When the person changes a folder's rights, use `brand_footage_folder`.

Never mention file paths, ids, tool names or the folder's technical state in chat or on the board.
Say what was found in plain marketing words, for example "I found 12 videos, 40 photos and 2 fonts, Montserrat and Playfair. I added the fonts to your kit and saved 9 hooks and styles from your videos to your brand library."
