---
name: research
description: >
  Runs the active local pipeline research workstream for a Social Campaign job.
  Use only when the frozen plan names research and the accepted evidence snapshot leaves a scoped gap.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local research adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, pipeline/agents/researcher.md, and pipeline/skills/research/SKILL.md.

For any competitor or market work, the target market comes from the spawn prompt, then `targetMarket` in `brand/profile.json`, and is Singapore when both are blank.

Reuse a fresh job snapshot supplied by the caller.

Research serves the direction the person approved for this job.
Read `topic` and `direction` (message, audience, offer, goal) from the job snapshot and the aim in the spawn prompt, and aim every question and search at them.
Never change the topic or re-decide the message, offer or call to action.
Audience research focuses on the direction's audience, and when the brand has three saved competitors, research those only.
Run only the workstream the route sent: product-evidence runs only for a job whose subject is a product.
Evidence that cuts against the direction is reported as a gap or risk with its source, never acted on by changing the direction.

When the task includes a video link (a Reel, TikTok, YouTube or other post) that is not yet in the job's `inputs/references/manifest.json`, call `pipeline_reference_from_url` for it before reading the post any other way, then watch it with `pipeline_video_teardown` (cuts, hook frames, a frame per shot, captions, music and beat check; Read the frames it returns), falling back to `video_watch` only if that cannot run. On any per-video failure (`needs_sign_in`, `blocked`, `timed_out`), record the status for that URL and leave the slot blank; never retry it. Only a link the person pasted themselves is looked at once in the person's signed-in Chrome with the Claude in Chrome tools, if connected (open the URL, read the caption and text, take screenshots or frames for reference), without asking in chat. Viewing is read-only: never post, like, follow, comment, message, change settings or type credentials. Claude Code may show its own tool permission prompt; that is the person's to answer, never avoid it. If the Chrome tools are not connected, say so in one line in the findings and go on; the Director asks for uploads once, at the end. Never read the person's browser cookies yourself. Downloaded videos are reference material only and are never reposted.

When the person asked for N reference videos (3 when they gave no number, never more unless they asked), find them with the discovery ladder in pipeline/skills/research/SKILL.md. The core rule: finding a URL and opening a URL are separate jobs. A walled search, hashtag or profile page never means "needs login" and never stops the run; a video counts as blocked only after its own single-video URL was tried with yt-dlp (`pipeline_reference_search` with `urls`) and failed. The ladder is: (1) real competitors' public videos, found by web-searching their single video URLs and then verifying them; (2) the `pipeline_reference_search` public routes, one call per route; (3) one niche keyword web search (one query set, no repeat) for single TikTok, Reel and short YouTube video URLs, then verify; (4) Claude in Chrome, only if connected, at most 3 URLs, one look each; (5) the Director asks the person once, without blocking the brief, listing the exact single URLs tried and what each returned. Every rung has a budget: if a rung used its budget or failed, log `skipped: <reason>` and move on, and the Director treats `skipped:` rungs as done and never sends you back for them. Found videos are still downloaded and watched (hooks, angle, framing, pacing, music). Run `pipeline_video_teardown` on every `ok` in-niche URL, count only verified, popular, in-niche ones (never off-niche results), look at each as described in pipeline/skills/research/SKILL.md, and report `References: n of N verified` (plus a status per URL) as counts ("found X public video links, Y downloaded, Z blocked individually") with the per-URL reasons to the Director; the Director asks the person once, without holding the brief back.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Dispatch exactly one workstream named by the active plan, or, for a `research` or `creative_analysis` job, exactly one Sources, Research, or Read the posts task named by the active plan.

A report job carries no research decision from the router; run its task the moment the active plan names it, never waiting for a decision that will not arrive.

The brand-onboarding workstream and its Hard limits, which a report job's task also keeps to, are defined in pipeline/skills/research/SKILL.md.

Read the brand profile, selected input revision, current research artifacts, source dates, and accepted evidence before searching.

Reuse an artifact when its scope and evidence-specific freshness cover the assigned questions.

Search only unresolved questions.

Do not add a generic research pass.

Do not repeat a provider probe that the current capability result already covers.

Never wait on or retry a source: one attempt, at most one proven fallback, then leave the slot blank and move on. For competitor ads, use the Meta Ads connector's `ads_library_search` first (if connected), then the plugin's `social_ad_search` once as the one fallback; TikTok Top Ads uses `social_ad_search` once. The TikTok for Business connector has no Top Ads tool. The researcher helper may not be able to reach a connector tool, so when the Meta Ads connector is connected and the job needs competitor ads, the Director runs `ads_library_search` itself once before handing research off and passes the results (page name, headline, dates, snapshot link) into the researcher's brief.

Record every material claim with its source and observation date.

Record uncertainty as Not verified.

Write only the artifact path named by the active task.

Reuse the existing board URL after the artifact lands and refresh the job snapshot after the mutation.

Call pipeline_board_open only when no board URL exists for the current workspace.

Return the artifact path, questions covered, reused evidence, new sources, gaps, and next action.

The local flow does not call the legacy campaign research tools.
