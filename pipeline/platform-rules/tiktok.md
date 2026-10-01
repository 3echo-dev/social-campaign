# TikTok - platform rules (manual posting)

Owner file for every TikTok limit and option a human needs when posting by hand from a hand-off package. Checked 2026-09-02. v1 does not publish through any API or Postiz; the Content Posting API figures below are cited only because they are TikTok's own documented ceilings, not because we call the API.
Legend: **[TIKTOK]** TikTok developer docs / help centre · **[MS]** third-party methodology (see THIRD_PARTY_NOTICES.md) · **[VERIFY]** not confirmed first-party.

```json
{
  "platform": "tiktok",
  "checked": "2026-09-02",
  "caption": { "max_chars": 2200, "visible_cutoff_chars": 150, "ideal_min_chars": null, "ideal_max_chars": null },
  "hashtags": { "max": null, "recommended_min": 3, "recommended_max": 5 },
  "media": { "required": true, "text_only_allowed": false, "kinds": ["video", "photo_carousel"], "carousel_max_items": 35 },
  "video": { "aspect_ratios": ["9:16", "1:1", "16:9"], "max_seconds": 3600, "recommended_min_seconds": 21, "recommended_max_seconds": 34, "safe_zone_px": { "canvas": "1080x1920", "top": 220, "bottom": 500, "left": 180, "right": 180 } },
  "image": { "aspect_ratios": ["9:16", "1:1"], "min_width_px": 1080 },
  "disclosure": { "ai_generated_video_label_required": true, "paid_partnership_label_available": true },
  "links": { "clickable_in_caption": false },
  "manual_posting_checklist": [
    "Confirm the TikTok account exists and is logged in on the posting device",
    "Open the TikTok app and upload the exact video or photo-carousel files from the hand-off package",
    "Paste the caption exactly; the hook must survive inside the first ~150 visible characters",
    "Add 3-5 hashtags from the hand-off package",
    "Because every video is AI-generated (Seedance), tap More options and turn on the AI-generated content toggle before posting, every time",
    "If this is a paid partnership, also turn on the Branded content toggle and select the correct disclosure (promoting your own business vs a paid third-party partnership)",
    "Do not paste the destination link into the caption as clickable text; use the bio link field or TikTok's link sticker if the account is eligible",
    "Post, then log the live URL and publish time in the hand-off package",
    "At 24h, 72h, and 7d open the video's Analytics in the app and export views, likes, comments, shares, and average watch time into the results file"
  ],
  "sources": {
    "caption.max_chars": "SOURCED: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post - \"2200 in UTF-16 runes\" (checked 2026-09-02)",
    "caption.visible_cutoff_chars": "HOUSE DEFAULT: third-party methodology, practitioner figure, unverified (checked 2026-09-02) [VERIFY]",
    "hashtags": "HOUSE DEFAULT: third-party methodology, practitioner figure, no separate TikTok hashtag-count cap found - bounded by the 2200-char caption field, unverified (checked 2026-09-02) [VERIFY]",
    "media.carousel_max_items": "SOURCED: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post - photo array holds up to 35 items (checked 2026-09-02)",
    "video.max_seconds": "HOUSE DEFAULT: widely reported 60-minute ceiling for pre-recorded uploads (10 minutes for in-app recording), no TikTok help-center page independently fetched, unverified (checked 2026-09-02) [VERIFY]",
    "video.recommended_min_seconds/recommended_max_seconds": "HOUSE DEFAULT: third-party methodology, short-form engagement guidance, unverified (checked 2026-09-02) [VERIFY]",
    "video.safe_zone_px": "HOUSE DEFAULT: third-party methodology, short-form video specs, unverified (checked 2026-09-02)",
    "image.min_width_px": "HOUSE DEFAULT: 1080x1920 slideshow canvas commonly cited, unverified (checked 2026-09-02) [VERIFY]",
    "disclosure.ai_generated_video_label_required": "SOURCED: https://www.tiktok.com/creator-academy/en/article/ai-generated-content-label - toggle in More options on the post screen (checked 2026-09-02)",
    "disclosure.paid_partnership_label_available": "SOURCED: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post - brand_content_toggle / brand_organic_toggle field descriptions confirm the in-app Branded content disclosure exists (checked 2026-09-02)",
    "links.clickable_in_caption": "HOUSE DEFAULT: TikTok captions do not render clickable links outside the bio field for most accounts, unverified (checked 2026-09-02) [VERIFY]"
  }
}
```

## Content
- One video or a photo carousel, never mixed in one post. [TIKTOK] app behaviour, checked 2026-09-02 [VERIFY]
- At least one attachment is required; there is no text-only TikTok post. [TIKTOK] checked 2026-09-02 [VERIFY]
- The 2,200 UTF-16-rune caption ceiling is TikTok's own documented figure for the `title` field; the in-app composer is widely reported to allow up to 4,000 characters when typed by hand, but that figure is not first-party. [MS] widely reported, checked 2026-09-02 [VERIFY]

## Account requirements
- A standard TikTok account, logged into the app on the device doing the posting, is sufficient for manual publishing. [TIKTOK] general knowledge, checked 2026-09-02 [VERIFY]
- No developer app, audit, or API credential is needed for manual posting; the Content Posting API audit status only matters if we ever automate posting. [TIKTOK] content-sharing-guidelines, checked 2026-09-02

## Disclosure and policy
- TikTok requires labelling AI-generated or significantly AI-altered content across organic posts, branded content, and paid ads. [TIKTOK] creator-academy AI-generated-content-label, checked 2026-09-02
- Because our video is always AI-generated (Seedance), the AI-generated content toggle is turned on for every post, no exceptions. Decision recorded 2026-09-02.
- Branded content needs both the Branded content toggle and the correct sub-choice (own business vs paid third-party partnership) before posting. [TIKTOK] Direct Post API field docs (brand_content_toggle / brand_organic_toggle), checked 2026-09-02

## Analytics available to a human in the native app
- Per-video Analytics: views, likes, comments, shares, average watch time, traffic source. Export at 24h, 72h, and 7d after publish. [TIKTOK] in-app Analytics tab, checked 2026-09-02 [VERIFY]
- Account-level Analytics also shows followers, profile views, and content trends over 7/28/60-day windows. [TIKTOK] checked 2026-09-02 [VERIFY]

## Writer checklist
- [ ] Caption <=2,200 characters
- [ ] Hook lands within the first ~150 characters
- [ ] 3-5 hashtags
- [ ] AI-generated content toggle turned on for every video, no exceptions
- [ ] Branded content toggle set correctly if this is a paid or organic brand promotion
- [ ] Post is one video or a photo carousel, never both
