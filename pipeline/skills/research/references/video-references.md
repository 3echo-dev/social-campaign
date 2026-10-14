# Reference videos: watching and writing them up

Read by `pipeline/skills/research/SKILL.md`. Each section is applied exactly as written here.

### Video links

A Reel, TikTok, YouTube or other video link given as evidence is saved first with `pipeline_reference_from_url` (yt-dlp, no login), then watched with `video_watch`. Order for Instagram: yt-dlp download, then the public page, then the browser. A per-video failure (`needs_sign_in`, `blocked`, `timed_out`, `not_found`, `login_required`, or `audio_only` for a photo slideshow that has a soundtrack and no video, whose caption, author and sound come back in `details`) is recorded against that URL under `Not found` and the slot is left blank; the video is never retried. A video the person pasted themselves may be looked at once in the person's signed-in Chrome, only if the Claude in Chrome tools are connected (open the URL, read the caption and text, take screenshots or frames for reference), without asking in chat. Viewing is read-only: never post, like, follow, comment, message, change settings or type credentials. Claude Code may show its own tool permission prompt; that is the person's to answer, never avoid it. If the Chrome tools are not connected, record the host in one line under `Not found` and go on; the Director collects every link that could not be fetched into one question at the end of the run. Browser cookies are only used when the person has said yes to `cookiesFromBrowser`. The file is reference only, never reposted.

Every verified video reference is watched, not read: call `pipeline_video_teardown` with the job and the link (it downloads through the same path as `pipeline_reference_from_url`, so its statuses and the Chrome fallback above apply unchanged), or with `referenceId` for one already saved, or `path` for an uploaded file. It cuts the video into shots with ffmpeg and returns: duration, resolution, aspect, cut count, average shot length, the shot list with timestamps, frames at 0s, 0.5s, 1s, 2s and 3s (the hook) and one frame per shot, the platform captions as a timed transcript (or `needsTranscription` with `audio.wav` saved: run it through `media_transcribe` or a connected speech to text tool, and until then the spoken words are "not observed"), the platform's music or sound title, and loudness, tempo and whether the cuts land on audio beats. Its files are in `inputs/references/video/<id>/teardown/`. `video_watch` is the older, coarser tool for the same job; use it only if the teardown cannot run. A video seen only in the Chrome fallback gets the same breakdown from its screenshots, with every field the screenshots cannot show marked "not observed".

Number of reference videos: N is the number the person asked for, and 3 when they gave none; never more than 3 unless they named a bigger number. Write the breakdown and the pattern section for that N. Only popular, in-niche references count toward it, and off-niche results never do. When fewer than N are verified, open `research/competitors.md` with `References: {n} of {N} verified` and the reason each one was blocked, and tell the Director, who asks the person before the brief.

#### Looking, then writing

1. Run the teardown. Then Read every hook frame and every shot frame it lists, in order, with the Read tool: you must see them. Also read `teardown.json` for the numbers. Never write a field from the caption, the title or the view count.
2. Write one block per video in `research/competitors.md`, labelled OBSERVATION, in the file's Claim, Evidence and Source blocks (Evidence names the frame files and timestamps or the audio numbers that show it). A field the frames, audio numbers or transcript do not show is written "not observed", never filled in.

```markdown
### Reference {k}: {title}, {platform}, {link}, seen {YYYY-MM-DD}
OBSERVATION. {duration}s, {aspect}, {cut count} cuts, average shot {s}s.

- **Hook (0 to 3s):** what is on screen (frames 0, 0.5, 1, 2, 3s); on-screen text verbatim; first spoken line verbatim (from the transcript).
- **Angle:** what the video is really selling or claiming; the viewer it speaks to; the emotional or logical lever.
- **Shots:** one line each, `{start}-{end}s | shot type | framing | subject | motion | text overlay`.
- **Pacing:** cut count, average and shortest shot, where it speeds up or slows down.
- **Audio:** voice (who, tone, delivery) | music: named sound and artist from the metadata, or "original sound", or "not in metadata"; energy and tempo feel | do the cuts land on the beat (share of cuts on an onset against the chance share the teardown gives) | voice against music level.
- **Idea parts:** awareness stage, angle id, visual format, hook family and mechanism, attention mechanic, using the ids in `playbooks/awareness-stages.md`, `angles.md`, `visual-formats.md`, `hooks.md` and `attention-mechanics.md`, so the brief and concepts can reuse the breakdown directly. Write `unclear` rather than guess.
- **Labels:** the video on the format library's four axes, from `pipeline/library/formats.json`: `format` (F- id), `editing` (E- id), `visual hook` (V- id), `series` when it clearly is one (S- id), and the `subtopic` it is about, each a library id or `custom: <words>` when nothing fits, as "Labels" in the brand onboarding workstream says. Write them from the frames and the audio, never the caption; `unclear` rather than guess.
- **Captions style:** burned-in text: position, size, colour, word by word or whole lines.
- **CTA:** what it asks for, where, in words.
- **Why it works:** two sentences, tied to what was seen above. This line is INFERENCE.

> **Claim:** one sentence
> **Evidence:** frame files and timestamps, audio numbers, transcript lines
> **Source:** the video, platform and author
> (then the rest of the traceability block)
```

3. After all N blocks, write `## Patterns across the {N} videos`: hooks, angles, framing, pacing and music, each pattern as `{pattern} in {x} of {N}` with the video numbers, e.g. "face to camera in the first second: 2 of 3 (1, 3)". A pattern in 1 video is listed as a single case, never as a pattern. Only what was observed is counted; a video whose field was "not observed" is counted out of the N for that field, and the line says so ("music: 2 of 2 observed").
