---
name: creative
description: >
  Runs the active local pipeline copy, script, storyboard, or media-plan task after strategy is current.
  Use only when the frozen plan names the corresponding stage.
user-invocable: false
metadata:
  version: 0.3.0
---

# Local creative adapter

## Talking to the person

Speak in plain marketing language.

Never mention internal limits, character counts, schemas, validation, routing, planning, or blocked states, file paths, tool names, request ids, or stage codes, in chat or on the board.

When something internal can be fixed without changing meaning, fix it quietly and say nothing about it.

When the person is needed, ask one plain question in their terms, for example "Who is this Reel for?" or "Can you add a photo of the product?", with no technical reason.

Progress updates are one short line in plain words, for example "Researching SK-II's audience and competitors now."

Read pipeline/LOCAL-ADAPTER.md (its Agent routing section applies), the workflow file under pipeline/workflows that the route names, and the canonical copywriter or scriptwriter contract under pipeline/agents.

Reuse a fresh job snapshot supplied by the caller.

Call pipeline_job_read only when the snapshot is absent or an external state change occurred.

Read the approved brief, current input revision, brand restrictions, platform rules, and accepted evidence.

Reuse the approved angle and current claims.

Do not repeat research or provider probes.

Write only artifacts named by the active plan.

Keep generated media requests as producer inputs.

Leave concept, storyboard, and content decisions to the board and pipeline decision tools.

## Copy choices at the concept step

Before any copy is written, the person picks, for every post (D1, D2 and so on), the content pillar, the angle, the hook family, the call to action and the hashtag set.
Do this at the concept step, alongside the concepts.
A post that goes straight to copy with no concept step gets the same choices first, as their own question.

1. Read the front matter of `brand/brand-voice.md`.
   When `complete` is false, the brand voice is not finished: ask one plain question for what its "Still to fill in" section lists, for example "How should SK-II sound in its posts?", save the answer to the brand profile as `onboard-brand` describes for a ready brand (`pipeline_brand_onboard` with the existing brand), and continue once the voice is complete.
   Never write copy while the voice is unfinished.
2. Build 2 or 3 options per field for each post from the research the job already has: hooks seen in competitor and brand posts, comment mining and customer words, ad library findings, standout posts, and the brand's own hashtags.
   Only when a field has no evidence at all, look it up within the hard limits: at most 3 searches for that question, at most 3 competitors, in the brand's target market (Singapore when the profile names none).
   Every option cites where it comes from: a research file in the job (for example `research/competitors.md#hooks`), a brand file, or a public link to the post or ad.
3. Shape each field:
   - Pillar: only the brand's saved content pillars, spelled as on the profile.
     A brand with one pillar gets one option.
   - Angle: one line each, and genuinely different directions.
   - Hook family: a different family per option from `pipeline/playbooks/hooks.md`, with its mechanism and an example first line that reads that way: a question mechanism asks a question with a question mark, and a number-led mechanism carries a real number.
   - Call to action: a style that works on the post's platform, with the line itself.
   - Hashtags: each set sized for the platform, niche to broad, including the brand's own tags when research shows it uses them, no repeats, at most 30; on Facebook one set may be no hashtags.
4. Save each post's options with `pipeline_recipe_options_save`.
   Fix any refusal it returns and save again; a refusal about the brand voice goes back to step 1.
5. Present the choices with the concepts.
   The board shows them; in chat, give one short summary per post, each option as its plain label and a few words on why, answerable here or on the board.
   Say where an option comes from in plain words, such as "from the comments on a competitor's top post", never a file name.
6. Apply the person's picks the moment they arrive, and never ask for them twice.
   From the board: call `pipeline_recipe_choose` with `via` board, the board request's id as `requestId`, and the board request as `chosenBy`.
   From chat: call `pipeline_recipe_choose` with `via` chat and the person's name as `chosenBy`; their own wording for a field goes in as a written-in choice, and their words go in `note`.
   A later change names only the fields that change.
   When the person wants fresh options after choosing, save new options with `replace` true, then ask again.
7. Copy is written only once every post has its recipe; write-hook, write-cta and write-caption work from it.

Never say "recipe", option ids, family codes such as H-QUESTION, or file names to the person.
Say "the angle", "the hook style", "the call to action" and "the hashtags".

End this stage by writing the board documents: when it reaches a decision (concepts, storyboard, or the final post), call pipeline_review_present with the exact files and write every entry of its returned `documents`; otherwise call pipeline_status and write its `documents`.

Then follow the hand-off in `board-sync` under Decisions on the board and in chat: one short chat summary of the same decision with the same options, answerable here or on the board, applied with the same decision tools, and never asked twice.
Follow social-campaign's Never stop waiting on an open gate rule: keep the decision open until an answer arrives, and never fall back to asking the person to reply in chat.

Reuse the existing board URL after each artifact set and refresh the job snapshot after the mutation.

Call pipeline_board_open only when no board URL exists for the current workspace.

The local flow does not call the legacy campaign creative tools.
