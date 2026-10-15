# Brand intelligence: the deep pass

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4e. Brand intelligence: the deep pass

Onboarding always runs the deep pass: there is no quick option and nothing to ask the person about it.
The person sees it as a checklist on the brand's page, then as the brand intelligence tabs (the board draws `brand.intelligence` by itself).
It has four pillars, and each feeds a concept: the brand's own winners (Concept A), the top 3 competitors' winners (Concept B), what is viral in the niche now (Concept C), and the six subtopics that tie them together.
The 6 by 5 plan comes last.
Every video taken apart is labelled on the format library's axes (format, editing style, visual hook, subtopic) by the researcher that took it apart; the library is `pipeline/library/formats.json`.
The research itself runs as parallel workers (section 4): the pillars are read at the same time, so the pass takes as long as its slowest worker, not the sum of them.

### The checklist

Keep the checklist current with `brand_intelligence_save` (action `progress`).
It starts by itself when `pipeline_brand_research_start` starts a run: the standard steps, the first one running.
The steps of the research parts move by themselves: each time you call `pipeline_status`, the server reads the part files of the open run and shows `website`, `accounts`, `own_top`, `own_teardown`, `competitors`, `rivals_teardown` and `pains` running while their workers go (with the numbers so far, "3 of 5 videos") and done when their part is done, and `viral` once its follow-up has started.
So call `pipeline_status` and write its `documents` each time a worker reports, and the page shows the parallel progress.
Change by hand, one step at a time with `step` (`{ id, state, detail }`), only what no part owns: `viral` while the Trend Scout works, `subtopics`, `plan` and `files`, and `newBrand`; write the board documents after each change.
Keep each detail to plain words with a number ("3 of 5 videos").
The standard ids are `website`, `accounts`, `own_top`, `own_teardown`, `competitors`, `rivals_teardown`, `viral`, `pains`, `subtopics`, `plan` and `files`.
The checklist turns ready by itself when every step is done.
Never mention the tool, the ids or the files in chat.

### The sequence

For every helper below, call `pipeline_agent_brief` with the brand, that agent and job `onboarding-<runId>`.
Keep `brand:<slug>` first and include `Brief job: onboarding-<runId>` in the prompt.
With a returned block, include `Agent brief fallback: unavailable.` and append the whole block unchanged, including its opening and closing markers.
With no block, include `Agent brief: none.` instead.

1. Right after `pipeline_brand_research_start` (and straight before `web_brand_kit`), spawn in ONE message, in the background, the researchers of the parts as section 4 says and the Trend Scout, so every pillar starts at the same moment.
   Put `brand:<slug>` alone on the first line of the Trend Scout's prompt, then the brand's niche (the industry pick when there is one, else the brand's market and content pillars), the target market, the saved competitor names, `trendsPath` and `viralPath` from the start result, and the Trend Scout's share of the budget from the `viral` part (`scout`: 11 searches, 10 fetches and 20 turns).
   Use the briefing rule above.
   It looks for what is viral in the niche (niche topic search, YouTube search, TikTok Top Ads, Meta ads), saves the trends it finds and writes the most viewed videos to `viralPath`.
   Mark the step `viral` running with a line such as "Looking for what is viral in AI and automation".
2. The researchers report one by one, each when its part is done, and the order does not matter.
   Call `pipeline_status` and write its `documents` each time, so the checklist moves by itself.
   Together the parts hold the account reads, the competitors, the top posts of the brand (its 5 best taken apart) and of each competitor (their top 2 each taken apart), every video with its labels, the pain points and the banks.
   A worker that stopped early is dispatched again for its own part only (section 4); the others carry on.
   When the `own` part reports done and the kit still has no colours or no fonts, run step 4 of the kit step (section 4a) on the frames of the brand's own videos.
3. As soon as the Trend Scout has reported, without waiting for the other workers, send a researcher a short dispatch with the workstream `viral-teardown`: the `viral` part.
   Put `brand:<slug>` on the first line, then the part id `viral`, the `runId`, the `viral` part's `partPath` and `contractPath`, `viralPath`, `rawDir` and its `teardown` budget (3 fetches and 6 turns).
   Use the briefing rule above.
   It takes apart the first 3 viral videos and writes them in the `topPosts` of the `viral` part file, with its status done.
   When the Trend Scout failed or wrote nothing, skip the dispatch and mark `viral` done with the detail "Nothing viral found yet"; the save notes it as a gap by itself.
4. When every part is done, save with `pipeline_brand_research_save` as section 4 says.
   The save checks the labels of every video taken apart like any other part of the draft, and a problem goes back to the part that wrote the video the same way.
   It files the posts it took apart in the brand's intelligence (`intelligence.posts.saved`) and the viral ones as trends too.
5. Subtopics (step `subtopics`): read the posts with `brand_intelligence_get`.
   Cluster their topics (the `subtopic` labels, the hooks and the captions) into six subtopics from all three pillars, a competitor's or a viral post counting as well as the brand's own.
   Each subtopic is a name of a few words and the ids of the posts that show it; rank them by the views of their best post.
   Save the draft with `brand_intelligence_save` (action `subtopics_draft`).
   A brand with few posts also draws topics from its website's offer (the brand files), with no post as evidence.
6. Ask the person to confirm on the board.
   The brand's page shows the six with Looks right and Edit by itself.
   Say it once in chat in one line, for example "Your 6 subtopics are on the brand page. Please check them, because every post will take its topic from them."
   The answer arrives as a `subtopics_confirm` request (section "Brand intelligence" of `skills/board-sync/SKILL.md`).
   Do not wait for it: carry on with the plan from the draft.
7. The plan (step `plan`): spawn the strategist with `brand:<slug>` on the first line and the plan task (the brand, no job), the brief from the rule above, and the file `workspaces/<slug>/library/intelligence/plan-draft.json` to write.
   Then call `brand_intelligence_save` with action `plan`.
   When it returns `needs_changes`, send the problems to the strategist once as `problems` and call it again; after a second failure leave the plan for later and tell the person only "The plan is not quite ready yet".
8. Finish: mark `files` done and call `brand_intelligence_save` (action `progress`, `status` ready).
   Tell the person in plain words what they now have, from the results, for example "Your brand intelligence is ready: 11 top videos taken apart, 6 subtopics and a plan of 30 post ideas."

### A new company

A brand with no posts of its own (no social accounts, or accounts with nothing on them) still gets the whole pass.
Call `progress` with `newBrand` true, mark `own_top` and `own_teardown` done with the detail "No posts of your own yet", and say it once in one plain line, for example "You are new on social, so your plan comes from what works for your competitors and your niche. Post a few and I will learn what works for you."
The subtopics and the plan come from the competitors' and the viral posts and from the website, and Concept A says it has no post history yet.

### When the subtopics change

When a `subtopics_confirm` is applied and its result says the plan is stale (`planStale`), the plan lacks ideas for the subtopics that are new.
Spawn the strategist again, naming the new subtopics, and file its plan the same way.
A cell of the plan that the person clicks is a `plan_cell_start` request: it starts a post, as board-sync says.
Each later job files what it used on the four axes, and posted results rank the formats, editing styles, visual hooks and subtopics against the brand's own usual; trends refresh every 7 days, competitors' winners every 30 days.
