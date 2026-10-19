# A pasted link

Read by `skills/social-campaign/SKILL.md`. Each section is applied exactly as written here.

### A pasted link is a reference

When the person pastes any link, a Reel, TikTok, YouTube or other video, a picture, or a web page, and a job exists (create one first if none does), call `pipeline_reference_from_url` with that job and the link, with no extra question.
Pass their words about it as `note`.
It saves the link into the job's references and lists it in the references manifest: a video with its caption, thumbnail, sound and view counts, a picture as a picture, and a web page as its text and main picture.
Say in one line what you got ("Saved that Reel as a reference: 'Morning routine', 12 s, with its caption").

- Reference use only: learn from it, describe it, borrow the idea. Never repost it or use the downloaded file in a finished post, and say so if the person asks to.
- If it returns `needs_sign_in` (a login wall), do not ask in chat. Go straight to view the page in the person's signed-in Chrome with the Claude in Chrome tools (open the URL, read the caption and text, take screenshots or frames for reference), in a helper that works in the foreground (`run_in_background: false`), as `agents/producer.md` describes. Viewing is read-only: never post, like, follow, comment, message, change settings or type credentials. Claude Code may show its own tool permission prompt; that prompt is the person's to answer, and you never try to avoid it. This is for a link the person pasted themselves, one look and no repeat. If the Chrome tools are not available or the extension isn't connected, record that link as not fetched and carry on; the link goes into the one end-of-run question about links that could not be fetched, where the person can upload the file with the board's "Add a reference" button. Never pass `cookiesFromBrowser` unless the person asks for it and says yes.
- For `blocked`, `rate_limited`, `region_restricted`, `yt_dlp_missing`, `timed_out` or `too_large`, record the status for that link, leave the slot blank and carry on without retrying it. Mention it in one plain sentence, and offer the board upload button once, together with any other links that could not be fetched, never one question per link.
- For `save_failed`, `download_failed`, `impersonation_missing` or `ffmpeg_missing`, say the real cause from the result in one sentence, with its fix when it gives one; these are problems on this computer, not the platform refusing.
- A link the tool refuses as `private_address` or `invalid_url` is not retried.
- When the content of the saved file matters, a fresh helper watches it (the researcher, or the videographer for a teardown, started with its agent brief as `agents/producer.md` describes: `pipeline_agent_brief` for that agent, `job:<jobId>` first, the block unchanged once at the end, no spawn on `waiting`) and hands back a few lines and the path of its notes; the Director never watches the video or reads its frames itself.
