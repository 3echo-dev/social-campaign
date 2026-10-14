# Finding the top N reference videos

Read by `pipeline/skills/research/SKILL.md`. Each section is applied exactly as written here.

### Finding the top N reference videos (discovery ladder)

N is the number the person asked for, and 3 when they gave none; never more than 3 unless they named a bigger number. Stop the moment N in-niche popular videos with a readable view count are found. Do not fill the count from search-result titles.

**Nothing stalls the run.** Every rung has a budget (one pass over its sources, one `pipeline_reference_search` call per route, one query set for rung 3). If a rung used its budget or failed, log `skipped: <reason>` for it (for example `Rung 2: skipped: YouTube search timed_out`) and move to the next rung. Never retry a rung, never wait for a slow source, and never go back to a skipped rung. The videos that are found are still downloaded and WATCHED through `pipeline_video_teardown` (hooks, angle, framing, pacing, music), 3 by default; only the waiting and retrying are dropped.

**Step 0, pick the competitors first.** Reference videos come from the top competitors in the brand's niche, not from the open feed. A competitor is a real business offering the same thing to the same audience, in the brand's market first (`targetMarket`), then regional or global leaders. Government programmes, schools' umbrella bodies, media, news, aggregator and meme accounts and unrelated creators are not competitors. Reuse the competitor list in `brand/research.json` and `brand/profile.json` when it exists and passes this test, and replace any entry that fails it (say which and why). Rank the valid ones by audience size and recent engagement, using displayed followers and the typical views of their last posts. Take their best-performing recent short videos as the candidate pool, then pick the top N from that pool.

**The core rule: finding a URL and opening a URL are two different jobs.** A search page, a hashtag page, a profile page or a Reels tab is a listing page, and listing pages are the ones behind login and bot walls. A single public video has its own public address, and yt-dlp can usually download it with no login. So a walled listing page says nothing about whether a video is public.

- Never write "Instagram and TikTok need a login" (or any platform-wide login claim) as the reason references fell short, in the research file, in your summary or in the Director's question, and never stop because a search, hashtag or profile page was walled. Log that page in one line (host, page kind, symptom) and move to the next rung.
- A video counts as blocked only after its own single-video URL (`tiktok.com/@x/video/...`, `instagram.com/reel/...`, a short YouTube video address) was tried once with yt-dlp through `pipeline_reference_search` with `urls` and failed. Report it as `blocked`, `login_required`, `needs_sign_in`, `timed_out` or `not_found` for that URL, leave that slot blank and carry on. A per-video failure is never retried.
- Report counts, not platform verdicts: "found X public video links, Y downloaded, Z blocked individually".

**Harvesting single-video URLs (never opens a walled listing page).**
Get candidate URLs from places that are not the platform's own search, hashtag or profile pages:

- `social_outliers_find` and `social_profile_get` on each competitor's TikTok, Instagram and YouTube accounts: their best recent posts, each with its own address, views (likes on Instagram) and date.
  An account that posts rarely gets a wider window by itself and the result says `stale`: quote the newest post's date and do not call an old outlier recent.
- `social_search` with `platform: "instagram"` and one `#topic` (one call per topic): the reels on that topic with their exact play counts, owners and reel addresses, read from Instagram's public `/popular/<topic>/` page by the stealth reader.
  It lists no dates, likes or comments.
  Give one hashtag: two words are read as one hashtag, and a longer phrase is refused with hashtags to try, with no request made.
- `social_search` with `platform: "youtube"` and the niche keywords: Shorts ranked by view count, from yt-dlp's search, undated.
- The competitor's own website, Linktree, and press or news pages that embed their Reels and TikToks: fetch the page (`WebFetch` or `web_crawl`, one fetch per URL) and pull out every `tiktok.com/@x/video/...` and `instagram.com/reel/...` link.
- TikTok oEmbed, `https://www.tiktok.com/oembed?url=<video url>`, as a login-free check of a TikTok video's author and title.

Do not harvest with `WebSearch` and `site:` operators (`site:tiktok.com`, `site:instagram.com/reel`, `site:youtube.com/shorts`): in a live test seven such searches returned articles and no single video, and they spend the search budget.
TikTok hashtag and keyword pages are not a source either: the tag page answers a bot check on every read, so find TikTok posts through accounts.

Every harvested URL is a candidate only. Never invent or complete a URL, and cite only links that appeared in a page or result you read.

**Verify each candidate.** Call `pipeline_reference_search` with `urls: [...]` (up to 12 single-video URLs per call). It runs `yt-dlp --dump-json --skip-download --no-cookies` on each URL alone, with `--impersonate chrome` for TikTok when curl_cffi is installed, and returns per URL a status (`ok`, `blocked`, `not_found`, `login_required`, or `not_a_video_url` for a listing page that slipped in), views, likes, duration, upload date and uploader, plus a summary line with the counts. Each `ok` URL that is in the niche (title and uploader match the niche, not a kid-comedy or news account) goes to `pipeline_video_teardown` and counts toward N once its teardown has run. Always pass `brand` and `jobId` to `pipeline_reference_search` on every call, so the job's research coverage line (which platforms had data) is recorded.

**The ladder, in this order. Stop the moment N in-niche popular videos with a readable view count are verified.**

1. Real competitors' public videos.
   For each competitor from Step 0, run `social_outliers_find` (and `social_profile_get` for the account facts) on its TikTok, Instagram and YouTube accounts.
   The posts it returns are single-video addresses: verify the best in-niche ones with `pipeline_reference_search` `urls`, then run `pipeline_video_teardown` on the in-niche `ok` ones.
   A 503, `blocked`, `login_required`, `timed_out`, `not_found` or empty result for one account is one line in the log and the ladder moves on.
   One failure on a host ends the helper for that host for the run.
2. Topic discovery.
   (a) `social_search` with `platform: "instagram"` and one `#topic` for the niche (one call per topic, two topics at most): reels with their play counts and addresses, undated.
   (b) `social_search` with `platform: "youtube"` and the niche keywords, and `pipeline_reference_search` with the niche keywords (add the local market, for example `youth football coaching singapore`): it runs `yt-dlp "ytsearch{K}:{niche keywords} shorts" --flat-playlist --dump-json` from the research helper's environment, ranks by `view_count` and keeps only videos of 90 seconds or less.
   Do not pass `tiktokTags`: TikTok hashtag pages answered a bot check on every live read, so `pipeline_reference_search` reports them as skipped.
   Each route gets one call and its status is recorded.
   The Instaloader and TikTok-Api library routes (`platform: "instagram"` and `"tiktok_api"`) were retired: signed out, none of five live reads worked, and a call that still asks for one answers `route_retired`.
   The candidates the routes return are verified and torn down through `pipeline_video_teardown` like any other.
   A candidate whose own download then fails is a per-video `blocked`, not a verdict on the platform.
3. Pages that embed videos: the competitor's short-video tab, Linktree, and press or news pages, opened with `web_crawl` or `WebFetch` when they load without a login (one fetch each).
   Pull out every single `tiktok.com/@x/video/...`, `instagram.com/reel/...` and short YouTube address they embed, verify them with `pipeline_reference_search` `urls`, and run `pipeline_video_teardown` on the in-niche `ok` ones.
   There is no keyword web search rung: do not run `site:` searches, and do not run a second round with other keywords.
   TikTok Top Ads is not opened here, it belongs to "Ad research".
4. Claude in Chrome, the person's own signed-in browser, read-only, only if it is connected. At most 3 URLs, one look each: take the single video URLs that failed in yt-dlp (best candidates first), read views, likes, date and caption from the page, and move on whatever the page shows. Never reopen a URL, never search or browse profiles here. Never post, like, follow, comment, message, change settings or type credentials. If the Chrome tools are not connected, log `Rung 4: skipped: Chrome not connected` and go on.
5. Report, do not wait. If fewer than N are verified after the rungs have run or been skipped, finish the file anyway and hand the Director the counts and the exact single video URLs that were tried with the status of each (`References: {n} of {N} verified` plus a status per URL), never a platform-wide login claim. The Director asks the person once, without holding the brief back (see the Director question in `skills/social-campaign/SKILL.md`). Never pad the count with off-niche or unreadable results. You are never sent back to run a rung again: a rung logged as `skipped:` counts as done. If the person later answers with links, those links go through `pipeline_reference_from_url` and the teardown, and nothing else is re-run. An answer without links, including "continue", means continue with the blank slots; it never restarts the ladder.

A walled listing page (an Instagram search, hashtag or profile page, a TikTok tag or keyword page) is logged in one line and the ladder moves on. It is never a rung's last word and never a reason to stop. Search-result titles and view counts alone never count: a reference counts only after its teardown. If `yt-dlp` is not installed, say so and use the other sources.

**What counts as top.** Rank by views. Where follower or recent-views data exists, break ties and reorder by outlier score (the video's views divided by the account's typical recent views). Prefer the last 12 months. The video must match the niche and be a short vertical video. Exclude reposts by aggregator or media accounts (unless the niche is entertainment) and government accounts.

**What to write.** In `research/competitors.md`, under a `## Reference videos` heading:

- Competitors chosen: name, handle, platform, why it is a valid competitor, followers, typical views of recent posts, and the date read; plus any entry from the brand research that was replaced and why.
- One row per candidate, counted or not: URL, account, views, likes, posted date, length, ladder rung that found it, read date, and whether it counts (and if not, why: off-niche, no readable views, over 12 months, repost).
- A line per ladder rung saying what it returned or why it was skipped (for example `Rung 1: social_outliers_find on @x returned 503` or `Rung 4: skipped: Chrome not connected`), so the file shows the search was done. Rung 2 has its own line or lines (the queries run and each route's status from `pipeline_reference_search`). A `skipped: <reason>` line counts as done; the Director never sends you back for it. A walled listing page is one line (`Listing page: instagram.com/explore/tags/x, login wall, moved on`).
- A count line, in these words: "found X public video links, Y downloaded, Z blocked individually". Never "Instagram and TikTok need a login" or any platform-wide login claim as the reason; each blocked video is listed with its own URL and status.
- `References: {n} of {N} verified` at the top of the file when short, followed by one line per URL that was tried with its status (`ok`, `blocked`, `needs_sign_in`, `timed_out`, `not_found`, `skipped`). The slots that could not be filled stay blank.
- A reference is tagged `Do Not Copy` only for a real reason, written on the same row. The reasons are: the clip is a competitor's own brand content (their logo, name, product or face carries it, so a copy would look like theirs), or it has a rights issue (licensed music, a person's likeness, a claim the brand cannot make). A high or low view count, a likes count, and plain words in the title or caption such as "viral", "copy", "original" or "official" are never a reason. A top video with 164,600 views is a model to learn the pattern from, not a reason to tag it. With no real reason, leave the row untagged.

Never estimate a view count. Record a displayed number with the date read, or record it as not readable.
