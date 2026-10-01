# Facebook Page - platform rules (manual posting)

Owner file for every Facebook limit and option a human needs when posting by hand from a hand-off package. Checked 2026-09-02.
Legend: **[META]** Meta help centre / developers.facebook.com · **[MS]** third-party methodology (see THIRD_PARTY_NOTICES.md) · **[VERIFY]** not confirmed first-party.

```json
{
  "platform": "facebook",
  "checked": "2026-09-02",
  "caption": { "max_chars": 63206, "visible_cutoff_chars": 477, "ideal_min_chars": 40, "ideal_max_chars": 80 },
  "hashtags": { "max": null, "recommended_min": 0, "recommended_max": 2 },
  "media": { "required": false, "text_only_allowed": true, "kinds": ["text", "image", "video", "multi_image", "story"], "carousel_max_items": null },
  "video": { "aspect_ratios": ["9:16", "4:5", "1:1", "16:9"], "max_seconds": null, "recommended_min_seconds": 15, "recommended_max_seconds": 90, "safe_zone_px": { "canvas": "1080x1920", "top": 220, "bottom": 500, "left": 180, "right": 180 } },
  "image": { "aspect_ratios": ["1:1", "4:5", "9:16"], "min_width_px": 1080 },
  "disclosure": { "ai_generated_video_label_required": true, "paid_partnership_label_available": true },
  "links": { "clickable_in_caption": true },
  "manual_posting_checklist": [
    "Confirm you hold Admin or Editor role on the Page before opening the composer",
    "Open Meta Business Suite or the Page's native composer, not a personal profile",
    "Paste the caption exactly from the hand-off package; keep it 40-80 chars unless the format needs more",
    "Attach the exact image, video, or multi-photo files named in the hand-off package",
    "Paste the destination link directly into the caption text so Facebook renders the preview card",
    "If the video is AI-generated, open the post's ... menu and apply the AI info disclosure before publishing",
    "If this is a paid partnership, use the Paid Partnership label tool to tag the brand before publishing",
    "Publish, then record the live post URL and timestamp back into the hand-off package",
    "At 24h, 72h, and 7d open the post's Insights and export impressions, reactions, comments, shares into the results file"
  ],
  "sources": {
    "caption.max_chars": "HOUSE DEFAULT: widely cited legacy Facebook status-box ceiling, no confirming Meta developer page found (checked 2026-09-02) [VERIFY]",
    "caption.visible_cutoff_chars": "HOUSE DEFAULT: third-party character-counter tooling (typecount.com), unverified (checked 2026-09-02) [VERIFY]",
    "caption.ideal_min_chars/ideal_max_chars": "HOUSE DEFAULT: third-party methodology, engagement guidance, unverified (checked 2026-09-02)",
    "hashtags": "HOUSE DEFAULT: third-party methodology - Facebook is not a hashtag platform, unverified (checked 2026-09-02) [VERIFY]",
    "media.carousel_max_items": "HOUSE DEFAULT: no documented organic cap found for native multi-photo posts, unverified (checked 2026-09-02) [VERIFY]",
    "video.safe_zone_px": "HOUSE DEFAULT: third-party methodology, short-form video specs, unverified (checked 2026-09-02)",
    "video.recommended_min_seconds/recommended_max_seconds": "HOUSE DEFAULT: third-party methodology, short-form engagement guidance, unverified (checked 2026-09-02) [VERIFY]",
    "image.min_width_px": "HOUSE DEFAULT: Meta ad-spec baseline commonly cited, unverified (checked 2026-09-02) [VERIFY]",
    "disclosure.ai_generated_video_label_required": "SOURCED: https://transparency.meta.com/governance/tracking-impact/labeling-ai-content (checked 2026-09-02)",
    "disclosure.paid_partnership_label_available": "SOURCED: https://help.instagram.com/1372533836927082 - branded content rules span Instagram and Facebook (checked 2026-09-02)",
    "links.clickable_in_caption": "HOUSE DEFAULT: known Facebook composer behaviour, unverified (checked 2026-09-02)"
  }
}
```

## Content
- Facebook is the only one of our three platforms that accepts a text-only post with no media. [META] known composer behaviour, checked 2026-09-02 [VERIFY]
- A story needs at least one attachment, and each attachment publishes as its own story; they do not stack into one post. [MS] checked 2026-09-02 [VERIFY]
- Short posts perform better than long ones; the 63,206-char ceiling is a trap, not a target. [MS] checked 2026-09-02 [VERIFY]

## Account requirements
- The person posting needs Admin or Editor role on the Page; Moderators cannot create posts. [META] Page roles, checked 2026-09-02 [VERIFY]
- No professional/creator conversion is required to post to a Page (Pages are already business surfaces). [META] general knowledge, checked 2026-09-02 [VERIFY]

## Disclosure and policy
- Meta requires its AI disclosure tool for photorealistic video or realistic-sounding audio that was digitally created or altered; may apply penalties if skipped. [META] Transparency Center, checked 2026-09-02
- Branded content needs a "Paid partnership with..." label; both brand and creator need a Business/Creator surface to access the tool and its eligibility checks. [META] Instagram Help Center 1372533836927082 (branded content policy spans Facebook), checked 2026-09-02

## Analytics available to a human in the native app
- In Meta Business Suite or Page Insights: impressions, reach, engagement, followers gained. Export at 24h, 72h, and 7d after publish. [META] Business Suite, checked 2026-09-02 [VERIFY]
- Per-post metrics are visible under each post's "View insights" panel; screenshot or export to the results file. [META] checked 2026-09-02 [VERIFY]

## Writer checklist
- [ ] Aim for 40-80 characters unless the format genuinely needs more
- [ ] 1-2 hashtags at most, or none
- [ ] Link pasted directly into the caption so the preview card renders
- [ ] AI info label applied before publishing on any AI-generated video
- [ ] Paid Partnership label applied before publishing if this is branded content
- [ ] Multi-image stories written as separate stories, not one post
