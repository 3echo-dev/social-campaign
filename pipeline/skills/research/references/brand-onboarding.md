## Brand onboarding workstream

Fill only the blank fields listed in the spawn prompt.
The target market comes from the spawn prompt.
It is never assumed: when none is named, the Director asks the person before the research starts. `Global` means no one country.
Use it for the competitors and for the audience suggestion, and never fill it in.
Onboarding research is as good as a job's research: the same tools, the same budget, the same discovery ladder, and a saved capture behind every source.
Competitors are the declared first 3, else the top competitors for that product in the target market, up to 3 in total.
The file at `draftPath` already holds the right keys.
Read it, fill in its values and write the whole file back with Write (the researcher has no Edit tool), and never add, rename or remove a key.
The keys you add inside `research.findings` and inside `brandFiles` below are the exception, and so is `banks` when a draft started before it existed lacks it.
The file looks like this, with only the fields still blank in `fills`:

```json
{"version":1,"runId":"...","fills":{"audience":"","market":"","voice":"","contentPillars":[],"competitors":[]},"suggested":[],"research":{"sources":[],"evidenceMatrix":[],"competitorDetails":[],"findings":{},"gaps":[]},"brandFiles":{},"topPosts":[],"banks":{"pains":[],"desires":[],"objections":[],"angles":[],"captions":[],"ctas":[]},"budget":{"searches":0,"fetches":0,"stopReason":""}}
```

An empty value means not filled.
A source is `{url, observedAt, kind, title, provider, captureRef}`.
An evidence row is `{id, question, finding, confidence, source, observedAt, semantics, supportingExcerpt}`.
A competitor detail is `{name, rationale, origin: "research", handles, evidence}`.
`evidence` is 1 to 3 of your listed sources, each with its public `url` and the `observedAt` date you read it; when nothing could be read for a competitor, leave `evidence` out and add a gap that names the competitor instead.
Add at least one dated source.

Each fill is board content for a marketer to read, not a research note.
Write every fill as if it will be pasted straight onto the brand's board.
Evidence, citations and run details never belong in a fill; save validates this and rejects a draft that breaks it.

### Tools

Use these tools, one attempt each, and count every call against the budget in Hard limits (30 searches, 56 fetches, 120 turns; a video teardown is a fetch).
`web_crawl` reads the brand's website and each competitor's website, one page per call; `WebFetch` is its one fallback.
`social_profile_get` reads a declared own account or a competitor handle once: followers, bio and recent posts.
`social_outliers_find` reads the same account once more: the posts that beat that account's own usual.
Both read TikTok, Instagram and YouTube (a channel's Shorts). Posts are ranked by views; Instagram shows a signed out reader no view count at all, so there they are ranked by likes against that account's own median likes (the read opens up to 8 posts one by one, so it takes about 20 seconds).
A TikTok profile read can take up to 75 seconds, and the tool reloads an empty video list once by itself; that is inside the one attempt, never yours to repeat. An answer of `empty_page` with the profile facts means the videos could not be listed: write the gap and go on.
`social_post_get` reads one post you want to quote.
`social_comments_get` reads the comments on one top post, once, for the audience's own words (the pain points below).
`social_ad_search` reads a competitor's ads once (the Meta Ad Library or TikTok Top Ads), for the hooks, captions and calls to action of ads that keep running.
`social_search` finds posts on one platform, at most once per platform.
`WebSearch` only finds addresses: competitors, their handles, coverage of the brand.
A search result is never a source, and a page you did not read is never cited.
The flow is the one a job uses.
Make one attempt per source, at most one fallback, and never wait on or retry a source.
Two failures on one host end that host for the run.
A source that used its budget or failed is one line in `research.gaps` and the run moves on.
Finding an address and opening it are two jobs: a walled profile page never stops the run and never becomes a claim about the whole platform.
The research helper reads a public Instagram account through its stealth reader when that is installed: the coverage is `partial` (followers, bio and recent posts with their dates, then likes and comments per post for the outliers read, and never a view count).
When the reader is not installed or Instagram refuses it, the coverage is `none`: make the one call anyway, write a gap that names the account, and go on; the person's signed-in Chrome is used for it after the save, not by you.
For each account that does work, read the profile once and its outliers once, for every declared own account and every competitor handle, within the budget.
For video posts the rules under "Finding the top N reference videos (discovery ladder)" below apply unchanged; onboarding reads the posts' numbers first and then takes the best videos apart ("Taking the best videos apart" below).

### Competitors

Apply the same test as a job's research (Step 0 under "Finding the top N reference videos (discovery ladder)").
A competitor is a real business offering the same thing to the same buyer, in the brand's market first, then regional or global leaders.
Government programmes, schools and umbrella bodies, media and publishers, news, aggregators, meme accounts and unrelated creators are never competitors.
Declared competitors stay first and are not tested again; you add the rest up to 3.
Every competitor, declared or found, gets a `competitorDetails` entry with:

- `rationale`: one line on what it sells to the same buyer.
- `handles`: its accounts found on its own website or in a search result, such as `{"instagram": "@name", "tiktok": "@name"}`, never guessed.
- `website` when it has one, and `evidence` from your listed competitor sources.

A competitor with no account found gets a gap that names it; so does one with nothing readable.
The save refuses a competitor on a government or education address.

### Evidence

Save the text of every page you read before you cite it.
Write one file per page under the `rawDir` of the spawn prompt, at `<rawDir>/<YYYY-MM-DD>/<slug>.md`.
Its first line is the page address, then the date and the tool, then the text the tool returned.
Name that file in the source as `captureRef`, as a path from the run folder, such as `raw/2026-10-13/acme-about.md`.
`provider` is the tool that read the page: `web_crawl`, `social_profile_get`, `social_outliers_find`, `social_post_get`, `social_comments_get`, `social_search`, `social_ad_search`, `WebFetch` or `chrome`.
`kind` is exactly one of the following, and it sets how long the source stays fresh:

| kind | what it is | fresh for |
|---|---|---|
| `brand_identity` | the brand's own website | 365 days |
| `brand_social` | the brand's own account or post | 30 days |
| `competitor` | a competitor's website | 30 days |
| `competitor_social` | a competitor's account or post | 30 days |
| `audience` | a study, article or comments about the audience | 90 days |
| `product_claims` | what the brand states about its product | 30 days |
| `market` | coverage of the category or the market | 90 days |

Every evidence row needs a `question`, a `finding` and a `supportingExcerpt`.
The excerpt is copied exactly from the saved capture of its `source`; use `...` to skip words.
`semantics` is `FACT`, `OBSERVATION`, `INFERENCE` or `HYPOTHESIS`.
The save checks all of this against your files and the run's own tool log before it writes anything, and it lists every problem at once.

### What each fill holds

- `audience`: who the brand speaks to.
  1 to 3 plain sentences, at most 400 characters.
- `market`: what the brand offers and what makes it different, its positioning.
  1 to 3 plain sentences, at most 400 characters.
  This is not the geographic market, and it never describes the research run; the target market is kept separately from this fill.
- `voice`: how the brand sounds.
  3 to 5 descriptive words, followed by one short example line written in that voice, at most 300 characters in total.
- `contentPillars`: 3 to 5 short topic names, 2 to 6 words each.
  No explanations, no sentences, names only.
- `competitors`: brand names only, the top 3 for that product in the target market, the declared ones listed first.
  List only the names you found, and the save keeps the declared ones first and adds yours up to 3.
  Find enough to make 3 in total unless fewer genuine competitors exist for that product in the target market.
  When fewer exist, record why in `research.gaps` instead of padding the list to 3.

### Also fill when blank

`forbiddenClaims` and `examples` appear in `fills` only when the person left them blank, and save never overwrites a value they typed.
Take both from the brand's own pages and posts you have already fetched; run no extra search or fetch for them.
Each is at most 600 characters of plain text, with no URL, domain or date.

- `forbiddenClaims`: wording or promises the brand's own pages avoid or hedge, one short line each.
  Leave it blank when nothing in the fetched pages shows one.
- `examples`: 2 or 3 lines the brand really published, copied as written and separated by new lines.
  Leave it blank when you cannot quote the brand itself; never write an example yourself.

Save marks a filled `forbiddenClaims` or `examples` as a suggestion automatically.

### Strategic findings

In the same run, and from fetches you already made, add any of these keys to `research.findings` that the pages support.
They are all optional, and a missing key is fine.
Each is plain text (or a list of text lines) of at most 1,500 characters with no URL, domain, date or the word "fetched"; refer to evidence by its `id` instead.

- `uniqueMechanism`: why the product works or differs from alternatives, and how the brand backs that up.
- `alternativeSolution`: what customers did or used before choosing this kind of product.
- `heroProduct`: the main product or products, or the catalogue highlights.
- `constraints`: creative and claims limits, one per line.
  Start every line with `Confirmed` or `Inferred`, followed by the evidence `id` where there is one.
  Use `Confirmed` only for what the brand states itself; everything else is `Inferred`, and an inferred line is never worded as a brand fact.
- `strategy`: context a marketer must know, such as seasonality, a subscription model, key channels or use of customer content.

Open questions you could not close go in `research.gaps` as before.

### Files for the brand

`brandFiles` becomes the brand's audience, positioning and platform playbook files, which every job reads before it researches.
Fill only what the pages you read support, and leave a part out when they do not; that file then keeps the template text and says research found nothing.
Every `source` below is the address of one of your listed sources.
Every `phrase` and `quote` is copied exactly from the saved capture of its source, and the save looks for it there.

```json
{"audience":{"segments":[{"name":"","who":"","goal":"","beliefs":"","objections":"","platforms":"","trigger":""}],"phrases":[{"phrase":"","source":"","segment":""}],"objections":[{"objection":"","answer":"","source":""}],"notFor":[""]},
 "positioning":{"line":"","category":"","offer":"","offerSource":"","proof":[{"claim":"","source":"","quote":""}],"competitors":[{"name":"","says":"","differs":"","source":""}],"switching":{"push":"","pull":"","habit":"","anxiety":""},"neverClaim":[""]},
 "platforms":{"pillars":[{"name":"","purpose":""}],"cadence":[{"platform":"","postsPerWeek":"","source":""}],"notes":[{"platform":"","suits":"","doesNot":"","notes":""}]}}
```

At most 3 segments, 8 phrases, 5 objections, 8 proof points, 3 competitors, 6 never-claim lines, 3 cadence rows and 3 notes.
A proof point is something the brand shows or states on a page you read: a number, a result, a credential, a follower or post count.
It is not an adjective or a promise, and three of them with a customer phrase are what lets a job skip its own brand research.
A phrase is words a customer or the audience used, taken from comments, reviews or posts; never write one yourself.
`postsPerWeek` comes from the dates of the recent posts you read, in words such as "about 3 (12 posts from 2026-09-01 to 2026-10-10)".
`pillars` gives each of the fill's pillar names a one-line purpose.
`platform` is `instagram`, `tiktok` or `facebook`.

### Top posts

`topPosts` lists the best posts `social_outliers_find` showed: at most 5 per declared own account, 2 per competitor, and the viral posts of "Viral now" below, 24 in all.
Each is `{source, competitor, platform, url, text, views, date}`; an Instagram post carries `likes` in place of `views`, and a video that was taken apart (next section) also carries `caption` and `breakdown`.
`source` is `brand`, `competitor` or `viral`, and `competitor` is the competitor's name from `competitorDetails` (only for a competitor's post).
`platform` is `instagram`, `tiktok`, `facebook` or `youtube`.
`text` is the post's opening words exactly as its caption has them, `views` is the number shown, and `date` is the day it was published as YYYY-MM-DD.
Instagram shows no view counts to a signed out reader, so for an Instagram post give `likes` (the number shown on the post, from `social_outliers_find`, which ranks Instagram by likes) and leave `views` out; the library labels it as likes.
Leave out a post with no caption, no views (no likes for Instagram) or no date, and never fill in or round a figure.
A post may also carry `outlierRatio`: how many times its account's usual views (likes for Instagram) it got, as `social_outliers_find` shows it; leave it out when the read gave none, and never work it out yourself.
A post may also carry `thumbnail`: its `thumbnail_url` from the `social_outliers_find` or `social_profile_get` result, copied as it came, so the board can show the post.
Leave `thumbnail` out when the read gave none, and never build or guess an address; a value that is not an https address is dropped, and the post is still saved.
Save files the brand's and the competitors' posts in the brand library as proven hooks, each keeping its `thumbnail` in its evidence, and files every post that was taken apart, with its labels, in the brand's intelligence (the viral ones also as trends).

### Taking the best videos apart

Onboarding is always the deep pass, and a caption says little about why a video worked, so take the best videos themselves apart once the accounts are read.
Take apart at most 14: the 5 best own videos by views (likes for Instagram) across all the brand's accounts, the 2 best videos of each competitor (6 in all), and the 3 viral videos of "Viral now" below.
A TikTok or an Instagram Reel comes first.
A brand with no posts of its own yet (a new company, or accounts with nothing readable) has no own videos to take apart: add one entry to `research.gaps` that says so in plain words, for example "No posts of your own yet, so your plan starts from your competitors and your niche", and carry on with the competitors and the viral videos.
Each teardown is one fetch of the budget, so do this only with fetches left; with none left, skip it and add one entry to `research.gaps` saying so.
For each video call `pipeline_video_teardown` with the brand, `jobId` set to `onboarding-<runId>` (the `runId` from the start, so the video and its teardown are saved in the run's own folder) and the post's `url`.
It downloads the video, finds the cuts, saves frames, and returns the shot list, the cut count, the music title and a timed transcript when the platform has captions.
Read at most 3 of the frames it returns: the frames at 0 s and 1 s (the hook) and one from the middle of the video (how it is edited).
When it says `needsTranscription`, or the transcript is empty, call `media_transcribe` with the `path` of the saved video: it uses the free local reader when that is installed, and when it says a paid provider is needed, leave the spoken words out.
Skip a video cleanly when its download or its teardown fails: leave its `breakdown` out, keep the post as it is, and add one entry to `research.gaps` that says which video and why in plain words, for example "Could not break down the TikTok video of 2026-09-14: the download needs a sign-in".
Never retry a failed teardown and never take apart a replacement for it.
Put what you saw in the post's `breakdown`: `{spokenHook, onScreenHook, format, style, shotTypes, cutsPer10s, presenter, sound, cta, transcriptExcerpt, labels}`.
`spokenHook` is the first spoken sentence exactly as the transcript has it, and `onScreenHook` is the text shown at the start exactly as the frames show it; leave either out when the video has none.
`format` is what kind of video it is in a few words, such as "talking head", "screen recording with captions" or "product demo"; it is required (the name of `labels.format` stands in when you leave it out).
`style` is one short line on how it feels, such as "fast-cut talking head with trending music".
`shotTypes` is up to 6 short names such as "close up" or "over the shoulder", from the frames you read.
`cutsPer10s` is the teardown's cut count divided by the video's length in seconds, times 10.
`presenter` is `true` when a person talks or shows themselves on camera and `false` when none does.
`sound` is `music`, `voiceover`, `music and voiceover` or `none`, from the teardown's music and the transcript.
`cta` is the call to action said or shown, exactly as it is, or left out.
`transcriptExcerpt` is the start of the transcript, copied as the transcript has it, at most 600 characters: the script as it was said. Leave it out when there is no transcript.
`labels` is described in "Labels" below, and every video taken apart needs it.
Anything the teardown did not show is left out, never guessed.
For a post with a breakdown, `text` is the spoken hook when it has one (else the on-screen hook) and the post's caption goes in `caption`; save makes the same swap when the draft puts the caption in `text`.
Save then files the hook in the proven bank with the caption as its note, files the format, style and call to action there as proven `format`, `style` and `cta` items with the post's link as their evidence, adds a "What the best videos do" table to the platform playbook, and files the video with its labels in the brand's intelligence.
Save refuses a breakdown the tool log shows no teardown for, a breakdown without its labels, and more than 5 own, 6 competitor (2 each) and 3 viral breakdowns.
The deep pass is long, so write the whole draft file back with Write after each major step (the accounts read, the own videos taken apart, the competitors' videos taken apart, the pain points): what is done is then on disk if you run out of turns, and a second dispatch carries on from the draft.

### Labels

Every video taken apart carries `breakdown.labels`, so any video, the brand's, a competitor's or a viral one, is described the same four ways and the labels can be counted and compared.
Read the format library, `pipeline/library/formats.json`: four axes, `format`, `editing`, `visualHook` and `series`, each a list of entries with an `id`, a name, a definition and why it works.
Pick from what the frames and the transcript showed, never from what the caption claims:

```json
{"format":"F-TUTORIAL","editing":"E-SCREEN-RECORDING","visualHook":"V-RESULT-FIRST","series":"S-TOOL-OF-DAY","subtopic":{"custom":"Private AI"}}
```

- `format` is the story structure (ids start `F-`): tutorial, listicle, breakdown, story, before and after, myth against fact, comparison, case study, POV, reaction, day in the life, Q and A.
- `editing` is how it looks on screen (ids start `E-`): talking head, faceless b-roll with voice-over, screen recording, split screen, text-led, cinematic, lo-fi phone, motion graphics.
- `visualHook` is what the first two seconds show, from the frames at 0 s and 1 s (ids start `V-`).
- `series` is optional: only when the account clearly posts the video as a repeatable episode (ids start `S-`).
- `subtopic` is the topic the video is about, in a few words ("private AI", "RAG that cites sources"), always `{"custom": "..."}`; the Director groups these into the brand's six subtopics afterwards, so use the same words for the same topic in every video.
A label is one library id, or `{"custom": "text"}` when no entry fits; never make up an id, and a library name ("Tutorial") is read as its id.
`format`, `editing`, `visualHook` and `subtopic` are required.

### Viral now

The Trend Scout runs beside the workers during onboarding (the Director spawns it in the same message as them, with the brand's niche, and it saves the trends it finds) and writes the most viral videos it found to a file, `viralPath`, as a list of `{platform, url, views, date, caption, thumbnail}` ordered by views.
The Director then sends you a second, short dispatch with the workstream `viral-teardown`, `viralPath`, your part file (`partPath`, the `viral` part, which has no other worker) and `rawDir`.
In it, read the file and take apart the first 3 videos that can be opened, as "Taking the best videos apart" says (one attempt each, no replacement for one that fails, labels included), and add each to `topPosts` with `source` `viral`, the platform and link it has in the file, and its numbers exactly as the file gives them, with the date it gives (a find from an Instagram topic or a YouTube search has none: leave `date` out, never make one up).
Read your part file, add those posts to `topPosts`, and write the whole file back with Write with `status` set to `done`; change nothing else in it.
A viral post needs no account read in the tool log. When the file is missing or lists nothing, add one entry to `research.gaps` that says what is viral could not be found and write the part file back as it was, with `status` set to `done`.

### Pain points

A second workstream finds what the audience struggles with, wants and doubts, in their own words.
When the pass runs in parts it is the `pains` part, which starts at once beside the others and does not wait for the accounts to be read.
It has its own reads inside the totals above: the budget of its part, 10 fetches and 5 searches at most, and it never takes a fetch a teardown needs.
When fetches run short, drop its reads in this order: the landing page, the ad search, the second review page, the second thread.
Use these sources, one attempt each, and save every page you read as a capture under `rawDir` first (see Evidence):

- Comments: `social_comments_get` once on the best own video and once on the best competitor video you read (provider `social_comments_get`; kind `brand_social` for your own, `competitor_social` for a competitor's).
  In parts, take those two videos from the `topPosts` of the own and competitors part files when they already list them, and otherwise find each with one `social_outliers_find` call.
- Forums: 2 `WebSearch` searches in the words the audience would use (a question they ask, a complaint, "has anyone"), then `WebFetch` at most 2 of the threads they found, such as a Reddit thread, a forum or a Q and A page (kind `audience`).
  A refused page is a gap, never a retry.
- Reviews: 2 review pages of competitors (Google reviews, a review site, the reviews on a course or product page), with `WebFetch` or `web_crawl` (kind `audience`).
- Competitor ads and a landing page: one `social_ad_search` (Meta or TikTok, whichever has the competitor's ads; provider `social_ad_search`, kind `competitor_social`) and one competitor landing page with `web_crawl` (kind `competitor`).
  The ad search also feeds "Hooks, captions and CTAs" below, and the whole run makes at most 2 `social_ad_search` calls.

From what you read, write `banks.pains`, `banks.desires` and `banks.objections`.
A pain is a problem the audience has, a desire is what they want, and an objection is why they hesitate ("too technical", "no time", "is it worth the price").
Each item is `{text, who, awarenessStage, count, source, competitor, quotes}`:

- `text` is the customer's own words, one problem, want or doubt per item, 8 to 300 characters, the way a customer would say it ("I tried n8n and got stuck"), never marketing language and never a link.
- Group the comments, reviews and threads that say the same thing into one item: `count` is how many of the ones you read said it, and `quotes` holds up to 5 of them.
- A quote is `{text, url, date}`.
  `text` is copied exactly from the saved capture of its page, 12 to 300 characters (use `...` to skip words).
  `url` is the address of one of your listed sources, because the save looks the quote up in that source's capture.
  `date` is the day the comment was written as YYYY-MM-DD when the page shows it, else leave it out.
- `who` says who has it, in a few words ("office workers who use ChatGPT"); `awarenessStage` is one of `unaware`, `problem_aware`, `solution_aware`, `product_aware` or `most_aware` (`playbooks/awareness-stages.md`).
- `source` is `brand` (comments on the brand's own posts, its FAQ), `competitor` (comments on a competitor's posts, with `competitor` set to its name), `community` (forums and Q and A), `review` (review pages, with `competitor` set when it is a competitor's) or `ad` (an ad or a landing page).
- Keep at most 12 pains, 8 desires and 8 objections.
  A pain seen once has `count` 1.
  Never write a quote you did not read, and leave a list empty when nothing was found.

An angle matches a pain with a proof the brand really has: `{text, pain, proof, proofSource}`.
`pain` is the `text` of one of your pains, word for word.
`proof` is a claim, number or result copied exactly from a page of the brand you saved, and `proofSource` is that page's address.
`text` is the angle in one line ("Your AI makes things up, here is RAG that cites sources").
Write at most 6, and none for a pain no proof page answers.

### Hooks, captions and CTAs

A third workstream, from reads you have already made, gives the brand its caption and call to action banks, and its hooks beyond the videos you took apart.
It needs no fetch of its own except the one ad search above.

- Hooks and calls to action of the videos you took apart are filed from their `breakdown` (the spoken hook, the on-screen hook, the format, the style and the `cta`), so do not repeat them.
- Captions: the best captions of `topPosts` (the brand's own and each competitor's, at most 10 in all) go in `banks.captions` as `{text, source, competitor, url, structure}`.
  `source` is `brand` or `competitor`, `url` is that post's link from `topPosts`, and `text` is the caption exactly as the post has it.
  `structure` takes it apart as `{hook, body, cta, hashtags}`; leave out a part the caption does not have.
- Competitor ads: from the ad search, the ads that keep running longest (the Meta Ad Library shows how long, TikTok Top Ads does not) go in `banks.captions`.
  Give each `source` `ad`, `url` the ad page you saved, `text` the primary text exactly as the ad has it, `structure.hook` its opening line, and `runningDays` when the library gives the days.
  The save also files each `structure.hook` as a hook.
- Calls to action: `banks.ctas` holds the ask exactly as a post, video or ad has it, as `{text, type, source, competitor, url}`, at most 10.
  `type` is one of `comment keyword`, `link in bio`, `dm`, `follow`, `sign up`, `book a call`, `shop`, `watch`, `save or share` or `other`.
  Add only the asks the captions, comments and ads show that the breakdowns do not.

### The banks in the draft

`banks` sits at the top of the draft next to `topPosts`, with these lists only (empty when nothing was found):

```json
{"pains":[{"text":"","who":"","awarenessStage":"problem_aware","count":3,"source":"community","competitor":"","quotes":[{"text":"","url":"","date":""}]}],
 "desires":[],"objections":[],
 "angles":[{"text":"","pain":"","proof":"","proofSource":""}],
 "captions":[{"text":"","source":"","competitor":"","url":"","structure":{"hook":"","body":"","cta":"","hashtags":[""]},"runningDays":30}],
 "ctas":[{"text":"","type":"","source":"","competitor":"","url":""}]}
```

Save looks every quote up in the capture of its source, finds each caption and call to action in its post or in the capture of its ad page, and lists a problem for a quote that is not there, a source that is not listed, a competitor that is not one of the three, or an angle whose pain is not in the list.
It then files the items in the brand's banks through the same call `brand_bank_save` makes, so the same research twice adds nothing, a pain seen again gains its new quotes and count, and an item the person removed stays removed.
The banks are what every later job starts from: its agents' briefs list the top pains, objections, angles, hooks and calls to action, and the Strategy step offers them as choices.

### Audience fallback

Look for the brand's own audience first, in its own site, its social pages and coverage of the brand.
When no reliable source describes the brand's own audience, fill `audience` with a suggestion instead of leaving it blank.
Derive the suggestion from the audiences of the top competitors for the same product niche in the target market from the spawn prompt.
The target market is never assumed: when none is named, the Director asks the person before the research starts.
`Global` means no one country.
Use only sources from the last 12 months.
Record each competitor audience source in `research.sources` and `research.evidenceMatrix` as usual.
Write the fill as a plain audience description with no marker and no competitor names.
List `audience` in `suggested`, a top-level array in the draft next to `fills`, so save records the field as a research suggestion and the board labels it "Suggested, please check".
Never list `audience` in `suggested` when a source describes the brand's own audience.
Never suggest `market`, `voice`, `contentPillars` or `competitors`; leave them blank when they cannot be sourced.

### No evidence in a fill

A fill never contains a URL, a domain, a date, the word "fetched", the word "observed", a source note, a quote marked as verbatim, or any commentary about the research run itself.
All of that belongs in `research.sources`, `research.evidenceMatrix` and `research.findings`, never in `fills`.
`pipeline_brand_research_save` checks the whole draft before writing anything and returns every problem at once, naming the field and the rule it broke.
The run stays open and nothing is written; rewrite each named field as plain board content and save again.
When the spawn prompt passes `problems`, read the file at `draftPath`, change exactly those, rewrite the whole file with Write (you have no Edit tool), copying each quote exactly from its capture, and finish.

### Working in parts

Onboarding research runs as parallel workers, one for each part of the pass, and the server merges their part files when the Director saves.
`pipeline_brand_research_start` lists the parts and writes, for each, its part file and its contract in the `parts` folder of the run: `<part>.json` and `<part>.contract.md`.
The Director spawns every worker in one message, so the parts run at the same time and none waits for another.
Your spawn prompt names your part, your `partPath`, your `contractPath` (the file you are reading), the `rawDir`, the target market and your budget.
In this contract "the draft" and `draftPath` mean your part file, which holds only the keys of your part.
A part file starts as the empty shape with `"status": "pending"`; keep every key it has, and keep `runId`, `part` and `competitor` exactly as they are.

The parts, and the keys each fills:

- `website`: the website and the brand's facts. Fills `fills`, `research.findings` and `brandFiles`.
- `own`: the brand's own accounts. Fills `topPosts` (source `brand`), `brandFiles.platforms` and its captions and calls to action in `banks`.
- `competitors`: the top 3 competitors, found or confirmed. Fills `competitorDetails`, `fills.competitors`, `topPosts` (source `competitor`) and its captions and calls to action in `banks`. When all three competitors are already named there is one part for each, `competitor-1`, `competitor-2` and `competitor-3`, and each covers its own competitor only.
- `pains`: the audience's pains, desires and objections, the angles, and the captions and calls to action of ads. Fills `banks` and the customer phrases of `brandFiles.audience`.
- `viral`: what is viral in the niche now. The Trend Scout finds the videos, then a short `viral-teardown` dispatch takes the first 3 apart. Fills `topPosts` (source `viral`).

Rules for every part:

- Write your part file with Write (the whole file) as soon as you have a first result, with `"status": "working"`, and again after each major step (the accounts read, the videos taken apart, the pain points read). Your last write sets `"status": "done"`, and the server reads nothing as finished before that. A part with nothing to report is still written, with `"status": "done"` and a line in `research.gaps` that says why.
- Write only your part file and your captures. Never write another part's file or `research-draft.json`.
- Name each capture `<rawDir>/<YYYY-MM-DD>/<part>-<slug>.md`, with your part id in front, so two workers never write the same file. The captures of other workers are in `rawDir` too: you may quote from them, and a page you can find there need not be read again.
- Begin every evidence `id` with your part id (`website-1`, `own-2`), so ids from different parts never collide.
- A source address listed by two parts is kept once, from the first part in this order: `website`, `own`, `competitors`, `pains`. List the pages you read even when another part may have read them too; the merge drops the repeat.
- Stay inside your budget, which is your share of the run's totals; a video teardown counts as a fetch. Wherever "Tools" or "Hard limits" speak of the run's 30 searches, 56 fetches and 120 turns, your share is what applies to you. When your fetches or searches run out, write what you have and add a gap line for what is left.
- Keep an evidence row only for a finding that something else uses, and no more than 6 in `website`, 4 in `own`, 3 for each competitor and 4 in `pains`: the saved research record has a size limit.
- The other workers run beside you and may not be done when you would like their results. Use another part's file only where your part's rules below say so, read it only once it holds what you need (its `status` is `done`, or it already lists what you look for), and otherwise do the one lookup yourself inside your budget.
- When the spawn prompt passes `problems`, they are what the save found in your part: read your part file, change exactly those, rewrite the whole file with Write, copying each quote exactly from its capture, set `status` to `done` again and finish.

The share of the budget of each part (the run's 30 searches, 56 fetches, 120 turns and 20 sources):

| Part | Searches | Fetches | Turns | Sources |
| --- | --- | --- | --- | --- |
| `website` | 2 | 5 | 14 | 3 |
| `own` | 3 | 12 | 28 | 3 |
| `competitors` | 9 | 16 | 34 | 8 |
| `pains` | 5 | 10 | 18 | 6 |
| `viral` | 11 | 13 | 26 | 0 |

The `viral` row holds the Trend Scout (11 searches, 10 fetches, 20 turns) and the short follow-up that takes the first 3 videos apart (3 fetches, 6 turns).
When the competitors are split, `competitor-1`, `competitor-2` and `competitor-3` share the `competitors` row between them (3 searches each, 6, 5 and 5 fetches, 12, 11 and 11 turns, 3, 3 and 2 sources).

#### Part website

You read the brand's website: its offer, who it speaks to, what it proves and how it sounds.
Read the home page and up to 3 more pages that show the offer, the pricing or the proof, with `web_crawl` (one page per call, `WebFetch` as the one fallback), each saved as a capture and listed as a source of kind `brand_identity`, or `product_claims` for what the brand states about its product.
You fill `fills` (`audience`, `market`, `voice`, `contentPillars`, and `forbiddenClaims` and `examples` when your file has them), `research.findings`, `brandFiles.audience` (`segments`, `notFor` and `objections` from a FAQ), `brandFiles.positioning` (`line`, `category`, `offer`, `offerSource`, `proof`, `switching` and `neverClaim`) and `brandFiles.platforms.pillars`.
The competitors are not yours: leave `fills.competitors`, `brandFiles.positioning.competitors` and `competitorDetails` to the competitors part.
The colours and fonts of the website are not yours either: the Director reads them with `web_brand_kit`, and a logo is only ever uploaded.
The audience is yours.
When the brand's own pages do not describe it, leave `audience` blank and add a gap line that says so.
The server then sends you back once the competitors part is done: read the competitors' part files in the `parts` folder and their captures in `rawDir`, suggest an audience from the audiences of the top competitors in the target market as "Audience fallback" says with no new fetch, and list `audience` under `suggested`.

#### Part own

You read the brand's own accounts, the platforms your prompt lists: each once with `social_profile_get` and once with `social_outliers_find`, as "Tools" says, with a source of kind `brand_social` for each account.
Put the best posts in `topPosts` with `source` `brand`, at most 5 for each account and 10 in all, and take apart the 5 best videos by views (likes for Instagram) across the accounts, labelled, as "Taking the best videos apart" and "Labels" say.
You fill `brandFiles.platforms` (`cadence` and `notes`, from the dates of the posts you read) and, in `banks`, only `captions` (the best captions of your own posts, at most 3) and `ctas` (at most 2).
When your file has a `fills` block the brand has no website: fill those fields from its profile bios and posts.
An account with no readable posts is one gap line that names it; a brand with no readable post at all gets the line "No posts of your own yet, so your plan starts from your competitors and your niche", and the part is written `done`.

#### Part competitors

You find or confirm the top 3 competitors for the brand's product in the target market, as "Competitors" says: the declared ones from your prompt come first and are not tested again.
Each gets a `competitorDetails` entry (`rationale`, `handles`, `website` and `evidence`), and the names you found go in `fills.competitors` when your file has it.
For each competitor read its website once with `web_crawl` (source kind `competitor`) and its best account once with `social_profile_get` and once with `social_outliers_find` (kind `competitor_social`), put its best 2 videos in `topPosts` with `source` `competitor` and `competitor` set to its name, and take those 2 apart with their labels.
In `brandFiles.positioning.competitors` give what each says and how the brand differs, with a source.
In `banks` you fill only `captions` and `ctas`, at most 4 and 3 in all, or 2 and 1, 1 and 1, 1 and 1 for `competitor-1`, `competitor-2` and `competitor-3`; items past that are dropped from the end, so list the best first.
A `competitor-N` part covers its one competitor with its share of the budget, and writes `fills.competitors` only when its file has it.

#### Part pains

You find what the audience struggles with, wants and doubts, in their own words, as "Pain points" and "Hooks, captions and CTAs" say, and fill `banks.pains`, `banks.desires`, `banks.objections`, `banks.angles` and the ad `captions` and `ctas` (`source` `ad`, at most 3 captions and 5 calls to action), and the customer `phrases` and `objections` of `brandFiles.audience`.
You start at once and do not wait for the accounts to be read.
For the comments you need a best own video and a best competitor video: take them from the `topPosts` of the own and competitors part files when those already list them, and otherwise find each with one `social_outliers_find` call (an own account, and one competitor handle you find with one search).
For the angles you need a page of the brand that shows a proof: look in `rawDir` for `website-*.md` (Glob), and when the website part saved one, read it and use its address as `proofSource` (list it in your sources too; the merge keeps one entry), and when none is there yet, read the brand's home page once with `web_crawl`.
A pain's `competitor` is the name of a declared competitor from your prompt, or of one the competitors part already lists.

#### Part viral

This part is written by the short `viral-teardown` dispatch, after the Trend Scout has written `viralPath`; the Trend Scout itself writes no part file.
Take apart the first 3 videos of `viralPath` as "Viral now" says, and put those posts in `topPosts` of your part file with `source` `viral`.
