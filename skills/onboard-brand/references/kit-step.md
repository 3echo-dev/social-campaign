# The kit step

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4a. The kit step: a logo, colours and fonts from the brand's own places

The kit step fills the brand's logo, colours and fonts from the brand's own places, so the card is not left empty when the brand has no website or the website shows no colours.
Everything it finds is a suggestion: the person says Use this or Not this to a logo, edits the colours and fonts like any others, and a logo they upload always wins.
Run it at the start of research, and again when a save of the details adds or changes the website or a social link.

1. Call `web_brand_kit` with the brand.
   It reads the website's colours, fonts and logo addresses, and the profile pictures of the brand's own TikTok, Instagram, Facebook and YouTube accounts (a YouTube channel the website links to counts too), and it works with no website at all.
   Logos come from those places only: never search the web, an image search or any other page for a logo, and never save one you found that way.
   Asked again with nothing new to read, it answers from the first read, and a site that blocks automated readers is not tried again.
   It returns `{status, brand, captureId, palette, paletteSource, fonts, fontsSource, logoCandidates, toReview, code, reason, skippedParts}`.
   It skips any part the person already provided and returns `skipped` when the logo, colours and fonts were all provided; do not look for those parts another way.
2. Look at every logo candidate before it is offered.
   Each of `logoCandidates` (at most 3) has an `id`, its `source` and a local `path`.
   Read the picture at `path` and decide whether it shows the brand's own mark, initials or name.
   An SVG cannot be drawn here, so read it as text: confirm it only when its title, label or words name the brand, and when you cannot tell, turn it down.
   A photo, a person, a product, another company's mark, a default avatar or a placeholder is not the logo.
   Then call `web_brand_kit` again with `review`: one entry for each candidate, `{ id, verdict: "brand" }` or `{ id, verdict: "not_brand" }`, with a few words of what you saw as `note`.
   A candidate you do not confirm is never shown to the person, and one you turn down is deleted and not offered again.
   Say nothing about this in chat.
3. What the person then sees: on the Logo card, the best confirmed candidate with "Suggested from your TikTok profile picture" (or the places it was found), Use this and Not this, the other candidates as small pictures, and the upload tile beneath.
   The same picture on several of the brand's places ranks first, then the website's header logo before its icon.
   Colours the website gave stay as they are.
   When it gave none, the colours of the confirmed logo take their place, labelled "From your logo".
4. Videos. When the research has taken the brand's own top videos apart (section 4e, step 2) and the kit still has no colours or no fonts, call `web_brand_kit` with `videos: true`.
   It reads the dominant colours of the frames of the brand's own videos (never a competitor's, and never greys, black or white) and adds them as suggestions labelled "From your videos", at most 5 colours in all, and it returns `videos.frames`.
   When the kit has no fonts (none from the website, the person or the folders), Read those frames: if the on-screen text clearly uses one typeface, call `web_brand_kit` with `fontGuess`, one or two Google fonts that look closest, each `{ family, use }`.
   They are shown as "Looks like the text in your videos", with low confidence, so never present one as the brand's font; guess nothing when there is no readable on-screen text.
5. Fonts otherwise come from the website's CSS as always, and from the folder digest (section 4d) when the website names none.
