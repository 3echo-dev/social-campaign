---
name: storyboard
description: >-
  Builds a storyboard with permanent panel IDs, one panel per beat, one picture style and a picture for every panel before it is approved.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Storyboard

The Creative Director writes the storyboard, the picture and clip prompts and the generation manifest for the media spec rows (organic post and paid campaign).
The Director never writes them; it verifies the files, makes the storyboard pictures (`make-image`), then runs the gate.
The storyboard is judged by its pictures, not its words: the storyboard is shown with a picture on every panel, and the person approves it that way.
The copywriter or scriptwriter uses this skill only where a workflow row still names one of them, for example a UGC concept's storyboard.

## Inputs

- The approved `script.md`, or for static media the brief's deliverable map row.
- `brief.md` for ratio and platform; `platform-rules/{platform}.md`; `playbooks/video-prompting.md`; the product photo.
- The chosen concept in `concepts.md` and the creative strategy: the picture style comes from them.
- The person's answer to the voice-over question (see Voice-over).
- Brand real photos under `brand/assets/references/`, if any, the product photo and any approved faces: every picture attaches the same references.
- On revision: the change instructions and current `storyboard.md`.

## Steps

1. Aspect ratio from the brief or the deliverable's post type (a Reel, a Story and a TikTok video are 9:16), never inferred any other way. If silent, `aspect_ratio: unconfirmed`, raised first.
2. Panel count follows the script's editorial beats. A panel may carry a shorter edited beat, but every generated provider clip is 4 to 15 s; group adjacent short beats when the manifest needs one provider clip.
3. One picture style per job, taken from the chosen concept in the creative strategy, for example "live pictures, daylight, everyday phone photo with real, ordinary clutter". Unless the brand or brief sets another look, that daylight phone look is the default. Write it once as the front matter `style` preamble (treatment, light, colour, casting, setting). Every image prompt repeats it word for word at its start (after the reference legend), then the Continuity block verbatim. The Continuity block gives 3 to 6 attributes for each recurring person, place and product, pasted into every prompt where they appear; it quotes the brief's Cast section for each person. The product's (cap, finish, colour, label placement) are read off its photo, never from memory. `preflight-generation.js --pictures` refuses an image prompt that lacks the preamble or the continuity block.
4. One row per panel on `templates/storyboard.md`; the Frame cell carries first-frame contents only: the picture, never hook text, captions or subtitles (those live in the Spoken / on-screen cell and are drawn once, later, by `finish-video.py`).
5. Write the Not in frame block.
6. `generation-manifest.json`: one image item per panel and one clip item per generated video panel; every prompt stands alone (preamble + continuity + panel + negative; clips in the playbook's five-part order), never "same as above". For a `talkingCharacter` deliverable also fill `characters` (one `voice` each, from the script's Voice notes) and each speaking clip's `dialogue: {character, line}`, with `generateAudio: true`.
7. Voice-over: the Director has asked the person "Voice-over: yes or no, and which voice?" before this step. Write the answer in the front matter as `voice_over: yes` or `voice_over: no`, and `voice: {the voice}` when yes. With yes, the script and the clip lengths fit speaking the lines; with no, they fit the music and the on-screen text alone. Music and captions are not written here: the Director asks them with the voice-over and records them before the storyboard is shown. A video storyboard is not presented without the field.
8. Revision log line, Decision empty, report path.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Panel IDs are permanent: a cut leaves the rest unchanged; a new panel takes the next unused number.
2. Frame is one of `TO GENERATE` (shot size, setting, what the camera sees), `ASSET: {id}` (validated file) or `TO PRODUCE` (real footage).
3. The pictures come before the approval: once the storyboard text is written, the Director makes ONE sample panel first (the one that best tests the style), the person checks the style, and only after that approval are the other panel pictures made. The storyboard review then shows every panel with its picture. The approved panel pictures are the start pictures for the clips. Pictures need no price approval (1 credit each, counted in the job total, 3 per panel at most: the first picture and two redos); video, voice and music always do.
4. 9:16 safe zone on 1080x1920: a 720x1200 centred band, margins 220 top, 500 bottom, 180 sides (platform UI takes the bottom 320 px).
5. Burned captions at 1080p: 42 px+, 32 to 42 characters a line, 2 lines at most, 21 characters a second.
6. One beat per panel; two actions is two panels. Dialogue and on-screen text are final copy.
7. Only the brand's product appears; a prompt that could show packaging carries verbatim: "Any other products or packaging in shot are plain and unbranded. No other brand names, labels or logos anywhere in the frame. The only branded item is {product}."
8. No added text in generated frames or clips: every image and clip prompt ends with "No on-screen text, no captions, no subtitles, no watermark, no logos other than the product's own." The text is drawn once, after the join, by `finish-video.py`. The product's own label stays as photographed, never angled away, blurred or "not legible".
9. Product-hero panels use `ASSET: {id}` or the product photo, never a description.
10. Apply revisions literally; if a cut breaks the flow, say so and ask. Increment `revision` and `boardVersion`; log each change by panel ID; a cut panel stays restorable.
11. Regeneration after approval targets one panel by ID; a cut or insert returns to this gate. What a job delivers changes only at a gate.
12. Shot, on-screen text and voiceover are written in plain words for a person: no task numbers, stage codes, file names or production notes. Production notes belong in `generation-manifest.json` only.

<!-- BEGIN labelled references (0.14 task 3) -->
## Labelled references

Each manifest item that attaches pictures (`assetIds`) also gets `references: [{ ref, label, keep }]`, one per attachment, in attachment order, `ref` being the asset id.
`label` is short: the product, the persona or mascot name, or the location. `keep` is one phrase on what must stay the same ("the exact box and logo").
The item's prompt opens with the legend, one line per attachment, before the preamble: `[Image 1] Mina: keep her face and black bob. [Image 2] Mealbox box: keep the exact box and logo.`
`make-image` and `playbooks/video-prompting.md` say how it is numbered; preflight refuses a mismatch and skips a manifest with no `references`.
<!-- END labelled references -->

## Carousel

A carousel (an Instagram carousel, a Facebook post with several pictures, a TikTok photo post) is one post of 3 to 10 slides, never more than the job names.
Set `format: carousel` in the board's front matter; its panels are then the slides, shown in swiping order and approved one by one.
One panel per slide, `Duration` 0 (a picture has none), one ratio for all of them, never a 9:16 vertical on a feed unless the post type needs it.
The Frame cell is the picture only, with no words in it; the `Spoken / on-screen` cell holds `On-screen: the short slide text`, or `(silent)` for a picture alone.
The first slide is the hook, the middle slides carry one idea each, the last slide asks for the action.
The caption goes with the whole post and is written later, so a slide carries no caption.
`generation-manifest.json` has one image item per slide, so the price counts one image per slide.

## Edit protocol

Put this verbatim under the board:

```
Cut P3.
Edit P5 spoken line to "..."
Insert after P4: {the new beat}
Reorder: P1, P2, P4, P3, P5
Replace the board entirely: {new direction}
```

A person may call a panel by its ID, its position, or a plain description: "P2", "panel 2" and "the second shot" all mean the same panel.

## Output contract

`templates/storyboard.md` filled: `aspect_ratio` confirmed, `style`, `voice_over` (and `voice`), Sequence line, panel table, Not in frame, Continuity, Revision log, Decision empty.
`templates/generation-manifest.json` filled: `boardVersion` equals `revision`; one image item per panel and one clip item per generated video panel, `durationSeconds` a whole 4 to 15; `stitch.order` matches the Sequence line; files by panel ID, never display number; the first clip in `stitch.order` (the hook) also carries `headroom: { askSec, inSec: 0.5, useSec }` with `askSec` = its beat plus 1 s (4 to 15) = its `durationSeconds`, and `make-video` explains it.

## Boundary

Does not generate or validate frames (`make-image`, `make-video`, run by the Director), write lines (`write-script`), apply disclosure (`policy-check`) or send the board.

## Failure modes

| Failure | Fix |
|---|---|
| Renumbering after a cut | Only the Sequence line changes |
| Frame described as if it exists | `TO GENERATE`, `ASSET: id`, or `TO PRODUCE` |
| Rewriting neighbours on edit | Apply literally; flag the flow |
| Storyboard shown with a panel that has no picture | Make the picture first; the review is refused until every panel has one |
| Pictures in different styles | One `style` preamble, pasted word for word into every image prompt |
| Voice-over not asked | Ask once before writing; the storyboard is not presented without `voice_over` |
| Product from memory, label hidden | Read the photo; preflight refuses a hidden label |

Numbers in this file are recorded with their provenance in `docs/sources/social.md`.
