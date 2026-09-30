# Instagram - platform rules (manual posting)

Owner file for every Instagram limit and option a human needs when posting by hand from a hand-off package. Checked 2026-09-02. v1 does not publish through any API or Postiz.
Legend: **[META]** Meta help centre / developers.facebook.com · **[MS]** marketingskills (MIT) · **[VERIFY]** not confirmed first-party.

```json
{
  "platform": "instagram",
  "checked": "2026-09-02",
  "caption": { "max_chars": 2200, "visible_cutoff_chars": 125, "ideal_min_chars": null, "ideal_max_chars": null },
  "hashtags": { "max": 30, "recommended_min": 3, "recommended_max": 5 },
  "media": { "required": true, "text_only_allowed": false, "kinds": ["image", "carousel", "video"], "carousel_max_items": 10 },
  "video": { "aspect_ratios": ["9:16", "4:5", "1:1"], "max_seconds": 180, "recommended_min_seconds": 15, "recommended_max_seconds": 90, "safe_zone_px": { "canvas": "1080x1920", "top": 220, "bottom": 500, "left": 180, "right": 180 } },
  "image": { "aspect_ratios": ["1:1", "4:5", "9:16"], "min_width_px": 1080 },
  "disclosure": { "ai_generated_video_label_required": true, "paid_partnership_label_available": true },
  "links": { "clickable_in_caption": false },
  "manual_posting_checklist": [
    "Confirm the account is a Business or Creator account if Insights or Paid Partnership tagging will be needed",
    "Open the Instagram app and start a new post, reel, or story matching the media kind in the hand-off package",
    "Upload the exact image, carousel, or video files from the hand-off package without recropping",
    "Paste the caption exactly; the hook must survive inside the first ~125 visible characters",
    "Add 3-5 hashtags from the hand-off package; extra hashtags beyond 5 are ignored for reach",
    "If the video is AI-generated, open Advanced Settings and enable the AI-generated content disclosure before sharing",
    "If this is a paid partnership, toggle Add Paid Partnership Label and tag the brand under Branded content",
    "Put the destination link only in the bio-link tool or a Story link sticker; captions do not render clickable links",
    "Share the post, then log the live URL and publish time in the hand-off package",
    "At 24h, 72h, and 7d open the post's or reel's Insights and export reach, likes, comments, shares, saves into the results file"
  ],
  "sources": {
    "caption.max_chars": "SOURCED: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ - \"Maximum 2200 characters, 30 hashtags, and 20 @ tags\" (checked 2026-09-02)",
    "caption.visible_cutoff_chars": "HOUSE DEFAULT: marketingskills practitioner figure, unverified (checked 2026-09-02) [VERIFY]",
    "hashtags.max": "SOURCED: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ - API field cap of 30 (checked 2026-09-02)",
    "hashtags.recommended_min/recommended_max": "SOURCED: Instagram's own @Creators account and Adam Mosseri announced (2025-12-19) that feed posts and reels count only the first 5 hashtags toward reach, extras are ignored; reported via https://www.techbuzz.ai/articles/instagram-caps-hashtags-at-five-to-combat-spam (checked 2026-09-02) [VERIFY primary Instagram post not independently fetched]",
    "media.carousel_max_items": "SOURCED: https://developers.facebook.com/docs/instagram-platform/content-publishing/ - carousels are limited to 10 items (checked 2026-09-02)",
    "video.max_seconds": "HOUSE DEFAULT: widely reported reels ceiling of 180s, no Meta help-center page independently fetched, unverified (checked 2026-09-02) [VERIFY]",
    "video.recommended_min_seconds/recommended_max_seconds": "HOUSE DEFAULT: marketingskills short-form engagement guidance, unverified (checked 2026-09-02) [VERIFY]",
    "video.safe_zone_px": "HOUSE DEFAULT: marketingskills short-form-video-specs (MIT), unverified (checked 2026-09-02)",
    "image.min_width_px": "HOUSE DEFAULT: Meta ad-spec baseline commonly cited, unverified (checked 2026-09-02) [VERIFY]",
    "disclosure.ai_generated_video_label_required": "SOURCED: https://transparency.meta.com/governance/tracking-impact/labeling-ai-content (checked 2026-09-02)",
    "disclosure.paid_partnership_label_available": "SOURCED: https://help.instagram.com/1372533836927082 (checked 2026-09-02)",
    "links.clickable_in_caption": "HOUSE DEFAULT: known Instagram composer behaviour - captions render as plain text, unverified (checked 2026-09-02)"
  }
}
```

## Content
- At least one attachment is always required; there is no text-only Instagram post. [META] general knowledge, checked 2026-09-02 [VERIFY]
- A story takes a single picture; a reel is a single video. [META] known app behaviour, checked 2026-09-02 [VERIFY]
- Caption field technically allows up to 30 hashtags, but only the first 5 count toward reach as of the December 2025 change; write 3-5 and stop there. [META] developers.facebook.com media reference + Instagram @Creators announcement, checked 2026-09-02

## Account requirements
- A personal account can post manually with no restriction, but Insights and the Paid Partnership tool require a Business or Creator (professional) account linked from Settings > Account type and tools. [META] help.instagram.com/502981923235522, checked 2026-09-02
- Both the brand and the creator need a professional account to use branded content tagging. [META] help.instagram.com/1372533836927082, checked 2026-09-02

## Disclosure and policy
- Meta requires its AI disclosure tool for photorealistic video or realistic-sounding audio; it may apply penalties if skipped. [META] Transparency Center, checked 2026-09-02
- Branded content needs the "Paid partnership with..." label, applied through Advanced Settings > Branded content before sharing. [META] help.instagram.com/1372533836927082, checked 2026-09-02

## Analytics available to a human in the native app
- Per-post/per-reel Insights: reach, likes, comments, shares, saves, replies, follows. Export at 24h, 72h, and 7d after publish. [META] app Insights panel, checked 2026-09-02 [VERIFY]
- Instagram is our best per-post measurement surface of the three platforms; screenshot or copy figures into the results file each check-in. [MS] checked 2026-09-02 [VERIFY]

## Writer checklist
- [ ] Caption <=2,200 characters
- [ ] Hook lands within the first ~125 characters
- [ ] 3-5 hashtags, no more
- [ ] Every post has at least one attachment; story = one picture, reel = one video
- [ ] AI-generated content disclosure enabled on every AI-made video
- [ ] Paid Partnership tag applied only if a real brand agreement exists
