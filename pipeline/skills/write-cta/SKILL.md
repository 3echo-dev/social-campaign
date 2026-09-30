---
name: write-cta
description: >-
  Writes the single call to action for a post, script, brief, concept or ad: one verb, one thing the viewer gets, matched to the job objective (awareness, engagement, traffic, leads, sales) and to what the platform can do (facebook links are clickable; instagram and tiktok captions are not, so the ask points to bio, sticker, comment keyword or DM). Use whenever a brief sets CTA intent, a concept or script needs its closing beat, a post.md needs its # CTA section and recipe.cta_style, or ad requirements name a conversion action.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Write CTA

**Purpose:** Produce one CTA line, its `cta_style` code and placement so every deliverable ends on the action needed.
**Used by:** strategist, scriptwriter, copywriter, media-buyer.

## Inputs

- `drafts/D*/recipe.json`: the person's chosen `post.cta_style` and `post.cta_line`. Required for a post or script CTA; without it, stop and report that the copy choices are not picked yet.
- `brief.md`: `objective`, `# CTA intent`, deliverable map row.
- `job.json`: destination URL, landing page, conversion event if present.
- `platform-rules/{platform}.md` json: `links.clickable_in_caption`, `media.kinds`.
- `brand/brand-voice.md` (CTA phrasing used/refused), `brand/positioning.md` (offer, risk-reversal).
- Video: script's last spoken line, matched by a comment keyword.

At the concept step, before any recipe exists, this skill drafts the 2 or 3 CTA options (style and line) the person chooses from, and the brief's `# CTA intent`; it never settles a post's CTA on its own.

## Steps

1. Read the objective; one primary CTA. Two intents in the brief: keep the one the objective names, record the other in Notes.
2. For a post or script, the style is the recipe's `post.cta_style` and the line starts from `post.cta_line`; change only placement or a word the platform needs, never the ask. For concept options, pick styles from the objective table and check them against the platform table; an unexecutable style is replaced, not softened.
3. Write verb + what they get + qualifier only when needed. Verbs: get, start, see, save, send, comment, try, download, join. Refused: submit, sign up, learn more, click here, get started.
4. Name the payoff. Comment keyword: one word, capitalised, identical in spoken line, on-screen text and caption. Reduce risk only where true, only claims `brand/positioning.md` supports.
5. Place it: last caption line before hashtags; final script beat (~2 s), ask on screen; final storyboard panel.
6. Record `recipe.cta_style` exactly as the recipe says and the line in `# CTA`; in a brief, one row per platform under `# CTA intent`.

## Objective to style

| Objective | Primary style |
|---|---|
| awareness | share_send or none |
| engagement | question, save, comment_keyword |
| traffic | link_caption (facebook); link_bio/story_sticker (instagram, tiktok) |
| leads | comment_keyword, dm |
| sales | link_caption, link_bio or dm, genuine reason to act now |

## Platform

| Platform | Clickable link | Not usable |
|---|---|---|
| facebook | yes, paste URL so preview card renders | link_bio, story_sticker |
| instagram | no | link_caption |
| tiktok | no | link_caption, story_sticker |

`cta_style` vocabulary: `link_caption`, `link_bio`, `story_sticker`, `comment_keyword`, `dm`, `save`, `share_send`, `question`, `follow`, `none`.

## Rules

1. One primary CTA per deliverable; a second ask is a second post.
2. Verb names the action, object names the reward; "Learn more" names neither.
3. Urgency needs a real deadline, batch or capacity limit in the line, otherwise none. Manufactured urgency is R-VOICE; a false limit is R-FACT.
4. Never stack "like, comment, follow, share, save"; never "double tap if", "comment YES", "tag 3 friends", "thoughts?".
5. Instagram/tiktok: never "click the link" or a pasted URL. Facebook: never "link in bio".
6. A comment keyword is spoken, shown, captioned identically; `# Publish plan` names who answers.
7. A video CTA is one beat tied to the value, after the payoff, not a sign-off.
8. Ad CTA matches the `job.json` conversion event; a traffic CTA on a lead objective is R-SCOPE.

## Output contract

Post: `# CTA` and front matter `recipe.cta_style`. Script: CTA words in the last spoken beat and on-screen column. Brief: `# CTA intent`: `| Platform | cta_style | Line | Destination |`. Concept: `CTA:` bullet. Ads: button label and destination URL.

## Boundary

Does not write the caption, hook or beats before the close (write-caption, write-hook, write-script). Does not check URLs, or judge disclosure (policy-check).

## Failure modes

| Failure | Fix |
|---|---|
| Weak verb ("learn more", "submit") | Rewrite as verb + reward |
| Two asks in one deliverable | Keep the objective's row; drop the other |
| "Link in bio" on facebook | Paste the URL into the caption |
| URL or "click here" on instagram/tiktok | Switch to link_bio or comment_keyword |
| No recipe for the post | Stop and report that the copy choices are not picked yet |
| The chosen style reads badly here | Note it for the editor; never swap the person's choice |

Numbers in this file are recorded with their provenance in `docs/sources/writing.md`.
