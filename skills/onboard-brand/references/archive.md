# The brand archive

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4c. Your archive (optional)

The brand's archive is a folder of past videos, pictures or audio on this computer (a Drive folder pulled to this computer works too).
It is optional. A brand with no archive skips this step and onboards exactly as before; say nothing about it when the person has none.

The archive is offered once, while the person is filling in the brand's details (step 2 in "The three steps"), and never after research has started.
Offer it in the same chat line that tells them the brand is created, by pointing at the brand page: under "Your videos, photos and fonts" they choose who owns the files, then press "Choose a folder..." and a folder picker opens on their computer.
Do not ask for a typed path, do not post a `pipeline_board_ask` question for it, and do not ask again after research starts; the card stays on the page for as long as the person wants it. A folder they add there arrives as a request that section 4d handles, and the files are read before or after research, whenever they add them.

Only when the person offers a folder in chat (they type or paste a path, or say they have one), take it from there:
When they would rather choose the folder than paste it, call `pipeline_folder_pick` with no request ID: it opens the folder dialog on their computer and returns `status` chosen with the `folder`, or cancelled, timeout or unavailable.
When a path arrives, ask who the footage belongs to with `pipeline_board_ask`, in plain words, with three buttons: "Ours, free to use" (rights ours), "Ask me each time before posting" (client_ask) and "Never use it" (never). Never guess the rights and never default them.
Then call `brand_footage_import` with the brand, the folder, the rights and a short label in the person's words. It reads the folder in the background, skips copies, makes small thumbnails and costs nothing; the files are never copied, moved or changed. Say so in one line, for example "Reading your folder now. It is free and runs in the background."
A bigger folder takes a while. `brand_footage_status` shows how far it got, and calling `brand_footage_import` again with the same folder carries on after a stop. A folder that moved shows its files as missing: ask the person for the new place and use `brand_footage_folder` with `relink`.

Describing the footage is what costs model usage, so keep the first pass small: at most 20 files, and only when the person agrees.
List them with `brand_footage_search` (`analysed` none, `kind` video). For each, call `media_extract_frames` on its `path` with a count of 3, Read the frames, and get the first spoken words with `media_transcribe` only when it answers with a transcript at no cost (a saved one, the platform captions, or the free local reader when faster-whisper is installed); when it says it needs a paid transcription provider, leave the spoken words out and do not run it. Then call `brand_footage_analysis_save` with stage `quick`: what the opening seconds show, the first spoken words if any, and the products, mood and shot types you can see. Never describe a file marked never. Describe more only when the person asks.
When the first pass is done, tell the person in plain words how many files there are and how many you looked at, and offer a full breakdown of the clips they care about: ask with `pipeline_board_ask` ("Want me to break down your best clips in full? It reads each one closely and uses model usage."). Mark the files they pick with `brand_footage_mark`. Its answer says how many files are marked and that a full pass uses model usage: tell the person that number and ask again before you start. Then watch each marked file (`media_extract_frames` with a count of 12 and the transcript) and save stage `full` with `brand_footage_analysis_save`: scenes, shot types, products, mood, on-screen text and usable moments, with start and end times in seconds.
When the first pass is saved, say what the person now has in one line, for example "Your archive has 128 files, and I have looked at 20 of them."
The person can also add folders themselves on the board, under Logo, colours and fonts; section 4d says how to handle those.
