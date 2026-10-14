# The brand research pass

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4. Brand research pass

After the profile is completed, whether through the board's `start_research` request, the old `onboard_brand` request, `pipeline_brand_onboard`, or the legacy `pipeline_brand_complete` path, call `pipeline_brand_research_start` with the brand right away, with no chat confirmation before starting: the board request (or the chat submission) already carries the person's approval.
A `create_brand` or `save_brand_details` request never starts research; only the person pressing Start research does.

The brand's page lets the person add their logo, colours and fonts before research: `save_brand_details` stores them as `kit`, and the Start research click sends them again as `kit` on the `start_research` request.
If the person offers a logo, colours or fonts in chat before research, ask them to add those on the brand's page before pressing Start research, where the logo is an upload or a suggestion they take with Use this.
Do not call `pipeline_brand_kit_save` before research; it confirms the kit and is only for the review step in chat intake.
When that kit carries a logo, follow the Handling a board request procedure in `skills/board-sync/SKILL.md` before landing the request.

Right after the `pipeline_brand_research_start` call, even when it returns `skipped`, run the kit step of section 4a for the brand.
It is the Director's own share of the website and brand-facts work (a worker has no tool for it), so run it straight after spawning the workers and let them carry on meanwhile.
Run it once for a research start: when research is restarted after a failure, do not run it again, because the first read already stands.
The card also asks, as an optional extra, for 3 to 5 real photos of the brand's world: the place, the people, the product in use.
They travel on the Start research click as `kit.references` (a save of the details does not send them) and are saved under the brand's `assets/references` folder and listed in the brand profile as reference assets.
They are optional.
A brand finishes onboarding without them; when there are none, say once and gently that real photos make the pictures feel like the brand and can be added any time.
If the person offers photos in chat, ask them to add them on the board card, or save them with `pipeline_brand_references_save` once they are on this computer.
Never search the web for them and never make them up.

A logo comes from the person's upload, or from the brand's own places through the kit step of section 4a, and never from anywhere else.
Never search the web, an image search or a third-party page for a logo, and never save a logo you found that way.

If the `pipeline_brand_research_start` result is `skipped`, do not dispatch any worker.
There is nothing blank to fill, or research is already current.

A brand onboarded before research wrote its audience, positioning and platform notes still has them as the empty template, so its research is redone once even when it looks current.
When the start result carries a `refreshReason`, say it to the person as one short line, word for word, for example "Your brand files were never filled from research; refreshing them now", and then dispatch as usual.
No field may be blank in that case, and the researcher then fills only the research, the brand files and the top posts (each video taken apart with its labels).
After that one run the notes are filled or say research found nothing, so the next start is skipped again.

Otherwise, research runs as parallel workers, one for each part of the pass, and you spawn them all at once instead of sending one researcher through everything.
The start result lists them in `parts`: each has its `id`, `label`, whether it is `required`, its `partPath` (the file that worker writes), its `contractPath` (its whole contract, which it reads itself) and its `budget` of searches, fetches and turns.
The run's 30 searches, 56 fetches and 120 turns (onboarding is always the deep pass, so it has far more than a campaign job's research budget) are split between the parts and add up to the same total, so each worker keeps to its own share.
The parts are:

- `website`: the website and the brand's facts: offer, audience, proof points, voice and content pillars.
- `own`: the brand's own accounts: each profile and its outliers, and its top 5 videos taken apart and labelled. A brand with no social account has no `own` part.
- `competitors`: finds or confirms the top 3 competitors, reads their accounts and their outliers, and takes apart the top 2 videos of each, labelled. When `competitorSplit` is true all three are already named, and there is one part for each, `competitor-1`, `competitor-2` and `competitor-3`.
- `pains`: the pains, desires and objections in the customers' own words with quotes from the pages it saved, the angles that match a pain with a proof, and the best captions and calls to action, from comments, forums, reviews and ads.
- `viral`: what is viral in the niche now. The Trend Scout finds the videos and a short follow-up takes the first 3 apart (section 4e).

Spawn the researchers of `website`, `own`, `competitors` (or the three `competitor-N`) and `pains` in ONE message, in the background, together with the Trend Scout (section 4e).
Never send them one after another, and never wait for one before spawning the next: running at the same time is the point.
When there are workers to spawn, spawn them first and call `web_brand_kit` straight after, so they run while it reads the website.
Give each Agent call a plain description such as "Researcher: competitors".
Each researcher's prompt is short, because the worker reads its own contract:

- `brand:<slug>` alone on the first line, so the board shows the Researcher working.
- The workstream `brand-onboarding`, the part's `id`, the `runId`, the part's `partPath` and `contractPath`, the `rawDir` where it saves the text of every page it reads, and the returned `market` as the target market.
- The line "Read the file at contractPath first: it is your whole contract."
- The part's `budget`, as the start result gives it. A `competitor-N` part also gets its competitor's name, and `own` the platforms in its `accounts`.
- For `website`, the returned `blankFields` and `alsoFill`. For `competitors`, the declared competitors and `toFind`.
- The block `pipeline_agent_brief` returns for it with the job `onboarding-<runId>`, unchanged, at the end.

Do not paste a contract or restate field formats in your own words; the workers have them in their contract files.
Each worker writes its part file `<part>.json` in the shape of the draft, for its own keys only, and saves the text of every page it reads under `rawDir`; its last write sets the part's `status` to `done`.
Research on a brand is as deep as research on a job: the workers read the website and each declared social account and each competitor handle once with `social_profile_get` and `social_outliers_find` (TikTok, Instagram and YouTube; Instagram needs the research helper's stealth reader and shows no view counts, so its posts come back ranked by likes and are filed as top posts with their likes in place of views), and keep a saved capture behind every source.
A researcher reads Instagram only through the research helper. It has no Chrome tools; the Instagram look below is yours.
Between them the `own` and competitors workers take apart at most 11 of the top videos (the 5 best own and the 2 best of each competitor, with `pipeline_video_teardown` and `media_transcribe`), give each its labels on the format library's axes (format, editing style, visual hook, subtopic) and write what they saw into `topPosts`; the 3 viral videos come in the short follow-up (section 4e); a teardown counts as one of their fetches, and a video whose download fails is skipped with a line in the gaps.
The save checks every quote against its saved page, so a problem about a quote goes back to the part that wrote it like any other problem about a source.
In `fills`, competitors are brand names only; their details belong in `research.competitorDetails`.
The researchers use plain dates (YYYY-MM-DD) for `observedAt` and never invent clock times.

Section 4e says what runs beside them (the Trend Scout) and what follows (the viral videos, the six subtopics, the plan), and how the checklist on the brand's page is kept; do those steps with this one.
Right after spawning, write the board documents (call `pipeline_status` and write its `documents`), so the onboarding page shows the workers running; do the same each time a worker reports back, because the steps of the parts move by themselves each time `pipeline_status` runs.
If a worker stops before it finished (it says it ran out of turns, or its part file still says it is working), dispatch that part once more with the same prompt and say what its part file already holds: it carries on from there.
When every part is done, and the viral follow-up of section 4e has run (at once when there is none), call `pipeline_brand_research_save` with the brand and `runId`.
The server merges the part files into the draft and checks it as one.

When the save returns `needs_changes`, never close the run and never tell the person about it.
A part that is missing or not finished comes back alone, before anything else is checked: dispatch only that part again, wait for its worker to report, and save again.
Otherwise every problem names the `part` it came from (or `candidates`, when it could be any of several), `parts` shows how each part stands, and `redo` lists the parts to dispatch again: dispatch only those, never the parts that had no problem.
Fix the part file yourself when the fix is only wording or a stray key; otherwise dispatch that part's researcher once more with only the `problems` of that part, its `partPath`, `contractPath` and `rawDir`, then save again.
Say this to the researcher in that second dispatch, word for word (its draft file is its part file): "Rewrite the draft file with Write (you have no Edit tool), copying each quote exactly from its capture."
Never add, change or date a source, URL or piece of evidence yourself: anything about sources, captures, excerpts, competitor handles, or the files and top posts a part carries goes back to the researcher of that part.
Do this for at most two rounds.
When `needsAudience` is true, the problem names the `website` part: dispatch it again, now that the competitors part is done, to find the brand's own audience or to suggest one from the top competitors' audiences in the target market.
If audience alone still remains after the two rounds, save once more with `audienceUnavailable: true` and tell the person plainly that no audience could be found and that they can add one on the board.

Right after a successful save, tell the person plainly which fields research filled, from the `filled` list, in marketing words such as "Research filled in Audience, Brand voice and Content pillars."
If `competitorsAdded` lists names, say research added them as competitors, for example "Research added Northshore Grocer and FreshCart SG to your competitors."
If `suggested` lists a field, say it is a suggestion to check, for example "The audience is a suggestion based on competitors, so please check it."
Name `forbiddenClaims` as "words and claims to avoid" and `examples` as "example posts", and say once that they are suggestions taken from the brand's own pages, without asking the person anything about them.
The save also writes the brand's audience, positioning and platform notes and files the research in the brand library.
When `brandFiles.enoughForJobs` is true, say in one line that research also filled in the audience and positioning notes, for example "Research also filled in your audience and positioning notes, with the proof behind them."
When it is false, say nothing about them; the notes keep their empty template and a job researches what it needs.
Never mention file names, tool names or the checks behind `brandFiles`, `library`, `toolCalls` or `warnings`.

Close the run as failed with `pipeline_brand_research_close`, `status: 'failed'` and a reason, only when a tool itself returns an error.
After a first failure, call `pipeline_brand_research_start` once more to restart the research, without calling `web_brand_kit` again; the board keeps showing that research is under way until the restart ends. A second failure is final.

Publish the board so the logo suggestion, colours and fonts the kit step proposed are visible.

Tell the person in one sentence to check the logo, colours and fonts on the board (a suggested logo has Use this and Not this, and they can upload their own instead), add a few real photos of their place, people or product if they have them, and click Save and continue.

While they do that, follow 4b below.

If something about the profile or the research is worth flagging, for example the TikTok account reading as a different market from the website, say so in chat in one plain sentence once research starts; do not block starting it, and do not turn it into a confirmation question.

Save and continue arrives as an `onboard_brand` request with `kit`.
Apply it immediately: a board click is the approval, so there is no chat confirmation.
When that kit carries a logo, follow the same Handling a board request procedure in `skills/board-sync/SKILL.md` before landing and applying it.

For chat intake, show the proposed kit in chat, take any changes the person wants, and call `pipeline_brand_kit_save` with the resulting kit.
A confirmed logo suggestion the person takes is saved as `logo: { action: "suggested", id }`.
