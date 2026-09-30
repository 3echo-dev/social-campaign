---
name: storyboard
description: >-
  Builds a storyboard with permanent panel IDs, one panel per beat, text only until approved.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Storyboard

## Inputs

- The approved `script.md`, or for static media the brief's deliverable map row.
- `brief.md` for ratio and platform; `platform-rules/{platform}.md`; `playbooks/video-prompting.md`; the product photo.
- On revision: the change instructions and current `storyboard.md`.

## Steps

1. Aspect ratio from the brief, never inferred. If silent, `aspect_ratio: unconfirmed`, raised first.
2. Panel count follows the script's editorial beats. A panel may carry a shorter edited beat, but every generated provider clip is 4 to 15 s; group adjacent short beats when the manifest needs one provider clip.
3. Front matter `style` preamble: treatment, light, colour, casting, setting. Every prompt opens with it and repeats the Continuity block verbatim: 3 to 6 attributes per subject, setting and light. The product's (cap, finish, colour, label placement) are read off its photo, never from memory.
4. One row per panel on `templates/storyboard.md`; the Frame cell carries first-frame contents, hook text and subtitle positions.
5. Write the Not in frame block.
6. `generation-manifest.json`: one image item per panel and one clip item per generated video panel; every prompt stands alone (preamble + continuity + panel + negative; clips in the playbook's five-part order), never "same as above". For a `talkingCharacter` deliverable also fill `characters` (one `voice` each, from the script's Voice notes) and each speaking clip's `dialogue: {character, line}`, with `generateAudio: true`.
7. Revision log line, Decision empty, report path.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Panel IDs are permanent: a cut leaves the rest unchanged; a new panel takes the next unused number.
2. Frame is one of `TO GENERATE` (shot size, setting, what the camera sees), `ASSET: {id}` (validated file) or `TO PRODUCE` (real footage).
3. Text only before approval: no frame, free or paid, before the record.
4. 9:16 safe zone on 1080x1920: a 720x1200 centred band, margins 220 top, 500 bottom, 180 sides (platform UI takes the bottom 320 px).
5. Burned captions at 1080p: 42 px+, 32 to 42 characters a line, 2 lines at most, 21 characters a second.
6. One beat per panel; two actions is two panels. Dialogue and on-screen text are final copy.
7. Only the brand's product appears; a prompt that could show packaging carries verbatim: "Any other products or packaging in shot are plain and unbranded. No other brand names, labels or logos anywhere in the frame. The only branded item is {product}."
8. No added text in generated frames or clips; burned at stitch. The product's own label stays as photographed, never angled away, blurred or "not legible".
9. Product-hero panels use `ASSET: {id}` or the product photo, never a description.
10. Apply revisions literally; if a cut breaks the flow, say so and ask. Increment `revision` and `boardVersion`; log each change by panel ID; a cut panel stays restorable.
11. Regeneration after approval targets one panel by ID; a cut or insert returns to this gate. What a job delivers changes only at a gate.
12. Shot, on-screen text and voiceover are written in plain words for a person: no task numbers, stage codes, file names or production notes. Production notes belong in `generation-manifest.json` only.

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

`templates/storyboard.md` filled: `aspect_ratio` confirmed, Sequence line, panel table, Not in frame, Continuity, Revision log, Decision empty.
`templates/generation-manifest.json` filled: `boardVersion` equals `revision`; one image item per panel and one clip item per generated video panel, `durationSeconds` a whole 4 to 15; `stitch.order` matches the Sequence line; files by panel ID, never display number.

## Boundary

Does not generate or validate frames (`make-image`, `make-video`), write lines (`write-script`), apply disclosure (`policy-check`) or send the board.

## Failure modes

| Failure | Fix |
|---|---|
| Renumbering after a cut | Only the Sequence line changes |
| Frame described as if it exists | `TO GENERATE`, `ASSET: id`, or `TO PRODUCE` |
| Rewriting neighbours on edit | Apply literally; flag the flow |
| Generation before approval | Text only at this gate; stop |
| Product from memory, label hidden | Read the photo; preflight refuses a hidden label |

Numbers in this file are recorded with their provenance in `docs/sources/social.md`.
