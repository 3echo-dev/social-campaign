# Sources: media and video

Rows for `skills/make-image`, `skills/make-video`, `skills/watch-video`, `skills/analyze-video`, `agents/videographer.md`, `scripts/watch-video.py` and `scripts/stitch-clips.py`.
Every source file was reviewed on 2026-09-02 before use.
One item here is **vendored** rather than adapted: `scripts/watch-video.py` is derived from MIT-licensed third-party scripts; the notice is in THIRD_PARTY_NOTICES.md. Everything else is rewritten in our voice, and nothing is taken as prose from the AGPL source.

| Our file | Origin | License | Usage | What was taken |
|---|---|---|---|---|
| `scripts/watch-video.py`, `skills/watch-video/SKILL.md` | third-party code and methodology (see THIRD_PARTY_NOTICES.md) | MIT | vendored | The frame-selection engine: ffprobe metadata probe, scene-change selection with `showinfo` timestamps in one decode, uniform fallback below the scene-frame floor, keyframe-only tier, duration-scaled frame budget, 16x16 grayscale dedup with its threshold, aspect-safe downscale clamped for reading, fast-seek caveat. |
| `scripts/watch-video.py` | third-party code and methodology (see THIRD_PARTY_NOTICES.md) | MIT | vendored | The WebVTT and SRT parser, tag stripping, and the rolling-caption dedup that YouTube auto-captions require, plus timestamp formatting as `[MM:SS]`. |
| `scripts/watch-video.py` | third-party code and methodology (see THIRD_PARTY_NOTICES.md) | MIT | vendored | Captions-only yt-dlp invocation, the manual-subtitle preference order, the height-capped format string, and the rule that a non-zero yt-dlp exit with the file present is a success. |
| `scripts/watch-video.py` | third-party code and methodology (see THIRD_PARTY_NOTICES.md) | MIT | vendored | The report shape: a header counting frames selected of candidates with the method and transcript source, a per-frame reason field, and the self-diagnosing warning when coverage is sparse for the duration. |
| `skills/watch-video/SKILL.md`, `agents/videographer.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Read every frame path in one message so they are seen together; the transcript-cue re-run for moments the speech flags that the pixels do not; do not re-run for a follow-up in the same session; state plainly that audio is not heard, so a spoken claim exists only when a transcript exists. |
| `skills/watch-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Manually uploaded subtitles are reliable while auto-generated ones duplicate lines and need post-processing; cap comment harvesting; the ordered fallback chain with a hard retry cap. |
| `skills/analyze-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | The seven analysis dimensions (structure and pacing, camera and framing, edit style, dialogue structure, tone and energy, lighting and technical, what makes this style different); hook formats; beat and spoken-word counts per 15 seconds; no open-ended variables in a derived template. |
| `skills/analyze-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Hook-to-formula classification with explicit confidence bands, and the rule that a low-confidence classification is reported as unclassified rather than forced into the nearest family. |
| `skills/analyze-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | The counterfactual test (remove this element, does it still work) to separate real drivers from incidental ones; one example is an anecdote so a pattern needs several; never fabricate frames or lines that were not given, and name the gaps instead. WoopSocial routing text stripped. |
| `skills/analyze-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Gather a corpus, take the top decile, extract patterns across format, timing and topic, then layer the brand's own voice rather than copying the source. |
| `skills/analyze-video/SKILL.md` | third-party reference, nothing copied | AGPL-3.0 | inspiration, re-derived | Facts only, restated in our words: sample the first, middle and last frame as a minimum; sample strategically rather than exhaustively on long video; numeric accept and reject bands for blur, brightness and contrast; use the pass as a gate on rendered output. No prose or code taken. |
| `skills/make-image/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | The prompt formula (subject, setting, style, lighting, composition, technical); keep prompts short enough that the model does not lose focus; always state the aspect ratio; never request legible text or a UI screenshot. |
| `skills/make-image/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Imperfection cues that make a still read as real (grain, overexposure, focus hunting, a lived-in background) and the exclusion list (studio lighting, stock-photo polish, perfect skin, centred staging). |
| `skills/make-image/SKILL.md` | third-party reference, nothing copied | AGPL-3.0 | inspiration, re-derived | Two ideas only, in our words: generate one hero asset and get it approved before any batch; verify what a real place, person or product actually looks like before generating rather than trusting the model's training data. No prose taken. |
| `skills/make-video/SKILL.md` | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | One dominant motion per beat; keep composition stable within a beat; pass the approved first beat as a reference for later beats; QC the final two seconds of every clip for intruding objects; cut at sentence boundaries and burn short caption groups. |
| `skills/make-video/SKILL.md`, `scripts/stitch-clips.py` | third-party reference, nothing copied | AGPL-3.0 | inspiration, re-derived | Mechanical facts, restated in our words and re-implemented: normalise resolution, fps and codec before concatenating; the concat demuxer suits same-codec segments; stream copy can drop video when the seek point is not a keyframe, so re-encode; probe before assuming; normalise loudness; escape Windows paths in subtitle and drawtext filters. No prose or code taken. |
| `playbooks/video-prompting.md`, `skills/make-video/SKILL.md` | third-party reference, nothing copied | AGPL-3.0 | inspiration, re-derived | The five-part prompt order (subject, subject motion, scene, spatial relations, camera); camera vocabulary distinctions (dolly is translation, zoom is focal length, pan rotates, truck translates); static means no movement, focus change or zoom; emotions written as observable actions; never vague adjectives or legible text. No prose taken. |
| `playbooks/video-prompting.md` | third-party reference, nothing copied | AGPL-3.0 | inspiration, re-derived | Repeat three to six disambiguating identity attributes verbatim in every shot; one action beat per sentence; dialogue written as a short quoted line and kept brief on fast cuts; describe a voice once and reuse the wording; per-shot prompt length bands; known failure cases (sustained contact, singing, crowded multi-character scenes). Reference-count guidance was re-scoped to our tool's real limits. No prose taken. |

## Licence notes

- **The vendored source is MIT licensed.** `scripts/watch-video.py` is a derived work and its notice is in THIRD_PARTY_NOTICES.md. No Whisper API call is made in v1; the transcript path is captions or a supplied file only, so no key is ever needed.
- **The reference-only source is AGPL-3.0.** Every row above is marked inspiration. Only facts and numbers are carried, restated in our own words; no prose block and no code was copied. Its reference-count and duration figures describe a different provider tier and were replaced with our tool's real limits (images 1 credit each and up to 16 references; video 4 to 15 seconds per clip and up to 9 image references).

## Numbers replaced rather than inherited

| Figure in a source | Why not used | What we use |
|---|---|---|
| Seedance 2.5 asset ceilings (30 images, 10 videos, 10 audio) | Describes a provider route we do not call | The 3echo tool schema: 9 image, 3 video, 3 audio references per video job |
| Seedance clip durations of 4 to 30 seconds | Same | 4 to 15 seconds, integer, per the tool schema |
| Retention percentages quoted without a citation | Uncited in the source | Not restated as facts; pacing rules are kept, the percentages are not |

## Numbers these files carry

Each row is a number that appears in an instruction file without a citation next to it.
The tag used to sit inline, which cost about 1,500 tokens a run and invited the model to
repeat the word "unverified" back to the user. The number stays where it is used; its
provenance lives here.

`HOUSE DEFAULT` means a practitioner source or our own bar, not a platform document.
`SOURCED` means it traces to the named document on the date given.

| Our file | The line it appears in | Where the number came from |
|---|---|---|
| `skills/make-image/SKILL.md` | 2. Count the `kind: image` items whose `status` is not `validated`. Quote `count x 1 credit`. The preflight already compared the total against `scope.maxSpendCredits` and... | SOURCED: 3echo `create_image_job` tool schema, checked 2026-09-02 |
| `skills/make-image/SKILL.md` | 1. **Prompt formula:** subject + setting + style + lighting + composition + technical, in that order. State the aspect ratio in the prompt as well as the parameter. | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-image/SKILL.md` | 2. Keep a prompt under about 200 words. Past that the model loses the subject. Specific beats comprehensive. | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-image/SKILL.md` | 7. Validate every file: it opens with Pillow and is at least 200 px on its short side. An error page saves happily as a `.png` and reaches a hand-off without complaint. | HOUSE DEFAULT, from our `contact-sheet.py`, unverified |
| `skills/make-image/SKILL.md` | 9. Verify what a real place, product or landmark actually looks like before writing its prompt. Model training data is stale, and a confidently wrong landmark is a defect nobody catches... | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-image/SKILL.md` | 10. For UGC-style stills, name the camera physics rather than quality words: front phone camera, roughly 26 mm wide lens, deep focus, unbalanced exposure, mild grain, awkward crop.... | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-image/SKILL.md` | 11. `assetIds` accepts at most 16 references per job. `aspectRatio` is one of `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9`; a ratio outside that list is a board error, not a rounding decision. | SOURCED: 3echo `create_image_job` tool schema, checked 2026-09-02 |
| `skills/make-video/SKILL.md` | 8. Validate every clip with ffprobe when it is available: duration within 1 s of the requested integer, the ratio matching the board, a video stream present and a non-zero file size. | HOUSE DEFAULT, from our own QA bar, unverified |
| `skills/make-video/SKILL.md` | 9. QC the **final 2 seconds** of every clip. That is where intruding objects, hands entering frame and style drift appear. Trim before them or regenerate; never ship a clip that drifts... | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-video/SKILL.md` | 2. Duration is an integer 4 to 15 seconds. A beat longer than 15 s is split into two clips at a hard cut, never stretched. | SOURCED: 3echo `create_video_job` tool schema, checked 2026-09-02 |
| `skills/make-video/SKILL.md` | 3. `ratio` is one of `16:9 4:3 1:1 3:4 9:16 21:9 adaptive` and comes from the board, never from a guess. `resolution` is `480p`, `720p` or `1080p`; 720p is the default and 1080p needs a... | HOUSE DEFAULT, from our own cost bar, unverified |
| `skills/make-video/SKILL.md` | 4. `assetIds` accepts at most 15 references, of which at most 9 image, 3 video and 3 audio. | SOURCED: 3echo `create_video_job` tool schema, checked 2026-09-02 |
| `skills/make-video/SKILL.md` | 8. **Normalise before you concat**: every clip to the same resolution, frame rate, pixel format and codec first. Mixed codecs or a variable frame rate produce drift and glitching at the... | HOUSE DEFAULT, from third-party methodology, unverified |
| `skills/make-video/SKILL.md` | 10. **Hard cuts by default.** A short crossfade of about 0.5 s belongs only at a topic change or a section break. In short-form, a dissolve between two beats of the same scene reads as a... | HOUSE DEFAULT, from third-party methodology, unverified |
