---
job: {job-id}
deliverable: D1
platform: facebook            # facebook | instagram | tiktok
version: 1
status: draft                 # draft | validated | approved | rejected | superseded
hook_family: H-CURIOSITY      # REQUIRED, from playbooks/hooks.md
hook_mechanism: curiosity_gap # from write-hook
hook_alternates:
  - ""
  - ""
char_count: 0                 # platform-check.js recomputes
visible_cutoff_ok: true       # hook lands inside the platform's visible-before-more cutoff
hashtags: []
media: []                     # paths under media/D1/, or [] for text only
accessibility_text: ""        # alt text for images, or the on-screen text summary for video
recipe:                       # creative choices and provenance for this deliverable
  pillar: proof
  angle: ""
  format: text_only           # text_only | static_image | carousel | ugc | brand_video
  cta_style: ""
  proof_style: ""
  duration_bucket: ""         # 0-15s | 15-30s | 30-60s for video
created: YYYY-MM-DD HH:MM {tz}
---

## What you're deciding

**This is:** {one line: what it is, for whom, on which platform}
**Decide:** approve · change {what} · start over
**Next:** {what happens after you approve, and what it costs}
**Spent so far:** {n} of {ceiling} credits

---

# Caption

The post exactly as it will appear. First line is the hook.

# Hashtags

# Media

Which file, and what it must show or must not show. For video: which script and board.

# CTA

## Variants

<!-- VIDEO posts only, two lines, a different hook and call to action each. Delete this section for any other post.
v2 | hook: {opening line} | cta: {call to action}
v3 | hook: {a different opening line} | cta: {a different call to action} -->


## Details

Everything below is the record: front matter, provenance, continuity and codes.
It is here so the decision above stays readable.

# Provenance

Every factual claim in the caption mapped to its source. The editor checks this list, not the open web. An unlisted claim is R-FACT.

- "{quoted claim}" -> `research/{file}.md#{anchor}` or `brand/positioning.md#{anchor}`

# Disclosure

Paid partnership, gifted product, affiliate, AI-generated media: the exact disclosure text and where it sits. "None" if none applies.

# Publish plan

| Account | Platform | Publish at (zone) | Destination URL | Settings |
|---|---|---|---|---|

# Notes for the editor

# Decision

Verdict here or in chat. Never written by the agent.
