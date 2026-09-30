---
name: policy-check
description: >-
  Checks disclosure and platform policy on a draft or script: paid partnership and gifted-product disclosure, AI-generated media labels, compliance trigger words for health, income and outcome claims, and the wording that gets a post or ad rejected. Use at stage 5 when writing UGC concepts and at stage 10 Validate on every draft. Raises R-POLICY. Never edits the draft and never decides the disclosure is optional.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Policy Check

## Inputs

`drafts/D*/post.md` (Caption, Hashtags, CTA, Disclosure, `media`); `drafts/D*/script.md` (beats, on-screen text, `disclosure`); `platform-rules/{platform}.md` json `disclosure.ai_generated_video_label_required`/`disclosure.paid_partnership_label_available`; `job.json`/`route.json` (paid/organic, `synthetic_person`); `brand/positioning.md` never-make claims; `brief.md` "Required and prohibited elements".

## Steps

1. Decide the situation from `job.json`, brief, Media: paid, gifted, affiliate, employee/founder, whitelisted/Spark ad, UGC-as-ad, or nothing exchanged. Apply rules 3-4: exact wording, real placement, never "None". Video or `synthetic_person` routes with `ai_generated_video_label_required: true`: name the label and where; TikTok is unconditional.
2. Scan copy against rules 6-8; write `validation/policy-check.md`, on a fail `revisions/{n}.json` with `R-POLICY`.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Disclosure is not a style choice: a material connection with no clear disclosure is NEEDS REVISION, every time.
2. A material connection: money, free/discounted product/services, affiliate commission, employment, or a personal/family relationship. Unrequested free product still counts.
3. Disclosure by situation, upfront and inside the endorsement: paid -> "#ad"/"paid partnership" + platform label; gifted, no fee -> "#ad"/"#gifted"; affiliate -> "#ad"/"commission earned"; employee/founder -> state relationship; creator asset as ad -> it is an ad, never a review; AI video/realistic audio -> the platform's AI label in the composer; nothing exchanged, no brand control -> nothing to disclose.
4. Placement: with the endorsement, hard to miss. Fails on a profile only, at the end only, behind MORE, or in a hashtag/link block. Video: in the video, not just the description; audio and on-screen for muted viewers; live stream, repeated. Plain words pass ("advertisement", "ad", "sponsored", "Thanks to {brand} for the free product"); "sp", "spon", "collab", "thanks" or "ambassador" alone fail. A label never replaces text.
5. Platform labels come from the json block, never memory: Facebook, Instagram, TikTok set `ai_generated_video_label_required: true`, `paid_partnership_label_available: true`, checked 2026-09-02. TikTok requires labelling AI-generated/altered content across organic, branded, paid; Meta requires its AI tool for photorealistic video/realistic audio. A draft claiming a label is unavailable loses to the json block.
6. Trigger words, failing -> compliant: lose weight/burn fat/melt pounds -> manage weight, support metabolism; diabetes, cure/reverse diabetes -> blood sugar concerns; anti-aging, look younger, turn back the clock -> skin health, vitality; named disease as the problem -> function/body area; cure, treat, diagnose, fix, eliminate, prevent -> helps, supports, may help, promotes, aids in; guaranteed/passive income, $X/month -> potential opportunity, results vary; best, only solution, guaranteed results -> a strong option; X results in Y days -> no timeline unless sourced. Any unsoftened health/outcome verb is High.
7. Rejection triggers: ALL CAPS, excessive punctuation, "#1", unproven superlatives, "guaranteed" outcomes, health/beauty before-after shots, financial promises, click-bait, naming a viewer's attribute, platform names, unowned trademarks.
8. A customer quote must be a real named person or a recorded review with consent. Fabricated, AI-written or bought reviews, and fake followers, violate the FTC testimonial rule.
9. A tag is not a license: resharing needs consent, usage rights; paid use needs likeness rights; no rights line is a finding.
10. Never edit the draft; never decide disclosure is unnecessary because a human sees it later.

## Output contract

`validation/policy-check.md`: verdict, drafts, situation, AI media, label need, findings table, and each disclosure decision. Revisions target `draft.copy` or `creative.storyboard` with canonical refs; numeric `targetStage` is legacy.

## Boundary

Not claim support (`fact-check`), voice (`brand-check`), or caption limits (`platform-format`, failing an absent disclosure). No legal advice.

## Failure modes

No json block: NEEDS REVISION with R-LIMIT, never an assumed label. Disclosure in the hashtag block: R-POLICY High on rule 4. Unlabelled AI media under compliant copy: R-POLICY High. Health claim softened but unsourced: R-POLICY Medium, R-FACT.

Numbers in this file are recorded with their provenance in `docs/sources/checking.md`.
