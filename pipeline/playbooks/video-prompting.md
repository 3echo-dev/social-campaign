# Video prompting for the 3echo video tool

## Contents

- The tool
- The rule that saves the most money
- Prompt order
- Camera vocabulary
- Rules
- Motion budget
- Known failure cases
- Stitching the cut
- When a shot is wrong

Read by the scriptwriter when writing `generation-manifest.json`, and by the producer when running `make-video`.

## The tool

| Fact | Value |
|---|---|
| Clip length | 4 to 15 s per clip |
| Ratio | `9:16` for every short-form deliverable; confirmed in the board, never inferred |
| Resolution | `480p`, `720p` or `1080p`; `720p` unless the brief says otherwise; `480p` only for a cost-capped preview |
| Audio | `generateAudio: true` by default; the persona's voice and room ambience come from the prompt. A talking character's lines are generated in the clip, and audio on or off changes the price |
| References | up to 9 images per clip; the approved panel image seeds every clip, the product asset rides along |
| Assembly | the producer stitches clips with ffmpeg in `stitch.order`, burns on-screen text from the script, outputs `media/D{n}/final.mp4` |
| Quote | `estimate_video_job` before any clip; one hero clip, inspect, then the batch |

## The rule that saves the most money

Seed every clip with its approved panel image. Image-to-video from an approved frame keeps the persona, the product and the room the human already signed off; text-to-video is a deliberate exception recorded in the board with a reason.

## Prompt order

Five parts, in this order, each its own sentence or short block:

1. Subject: who or what, with the 3 to 6 identity attributes from the board's Continuity block, verbatim. A hand is a person: say whose (a woman in her thirties), and how much of the arm is in frame (wrist only). Left unsaid, a clip put a man's forearm to the elbow into a video about a woman's skin.
2. Subject motion: what they do, in the order it happens. One action beat per sentence.
3. Scene: setting, time of day, light source named, what else moves.
4. Spatial relations: shot size named again even though the seed frame shows it (tight macro, bottle filling the frame), where the subject sits, foreground and background, and how that changes. A clip seeded from a tight still pulled back to a wide shot because the prompt never said the framing held.
5. Camera: height, angle, focus, steadiness, then the move.

Then the voice paragraph, the dialogue, and the negative constraints. Prompt length: 200 to 400 words for a hero shot, 80 to 150 for an insert.

## Camera vocabulary

| Say | Meaning | Not the same as |
|---|---|---|
| dolly in / out | the camera body moves toward or away | zoom (lens only, camera still) |
| truck left / right | the camera body slides sideways | pan (the camera pivots in place) |
| pan, tilt | rotation in place | truck, pedestal (translation) |
| static | nothing moves: no drift, no focus change, no zoom | handheld micro-shake, slow push |
| handheld | small irregular movement, phone in hand | stabilised drift |
| rack focus | focus shifts from one plane to another | zoom |

Name exactly one move per clip. Silence lets the model choose, and it chooses too much.

## Rules

1. One motion idea per clip. A rotate plus a push plus a light change produces mush.
2. Repeat identity verbatim in every clip: the same 3 to 6 attributes, the same outfit, the same room. "The same woman" and pronouns do not carry across clips.
3. Dialogue as `{Persona} says: "line"`. On fast cuts each line is 6 words or fewer. One speaker per clip.
4. Voice described once (the manifest's `characters[].voice`, from the script's Voice notes: accent, tempo, manner, pacing cue) and pasted verbatim into every clip where that character speaks. Rewording it changes the voice.
5. Say what must not appear: added text, subtitles, logos other than the brand, other products, extra people, extra hands. Negative constraints matter more than adjectives.
6. No added text in generation. Captions and on-screen text are burned at stitch from the script, where they are sharp and correct. The product's own label is not added text: it comes from the product photo and stays as photographed. Asking for it "angled away" or "not legible" returns a blank white sticker and a brand nobody can name.
7. Replace emotional adjectives with their visible cause: not "excited" but "eyebrows up, leans toward the lens, half laugh".
8. Never cinematic, professional, stunning, 8k, studio, perfect. Ask for phone quality, window light, visible skin texture, grain.
9. Keep physics simple: pick up, hold, turn, set down. Anchor hands to an object.
10. First 2 seconds of the first clip carry motion or a strong expression; a scene-setting first clip is already too slow.
11. Every clip prompt stands alone. "Same as the P1 image prompt above, animated" reaches the model as those words and nothing else. Repeat the subject, the product as photographed, the setting and the light in every clip.
12. Describe the product from its photo, never from memory: the cap, the finish, the colour of the liquid, where the label sits. A bottle described from memory came back with the wrong cap and a clear body, and the real one has neither.
13. No notes to yourself in a prompt. A remark about a brand file, a hex value nobody knows or a path is read as part of the picture; `preflight-generation.js` refuses a prompt that names a file.

## Motion budget

| Clip length | Sensible motion |
|---|---|
| 4 to 5 s | one small move: a push in, a turn, a reveal |
| 6 to 9 s | one move plus one change: turn while the light shifts, or one line of dialogue |
| 10 to 15 s | two beats at most, or split the panel |

No panel is shorter than 4 s, because the tool will not render a shorter clip. `write-script` floors beats there.

## Known failure cases

| Ask | What happens | Do instead |
|---|---|---|
| Sustained physical contact, two bodies touching throughout | limbs merge and drift | hold and show, a single touch, or cut around it |
| Singing | mouth and audio desync | spoken lines only |
| Crowds, several faces | faces drift generic by the third cut | one persona per clip; extras out of focus or out of frame |
| Eating or drinking on camera | hallucinated food and hands | hold and smile, or cut before the sip |
| Small product label in a busy room | garbled label | product large and close, 30 to 40 percent of frame |
| Label "soft-focus so no text is legible" | a blank white sticker; the brand vanishes | keep the label as photographed, ban added text only |
| A clip prompt that points at another prompt | the words "same as above" rendered literally | every clip prompt complete on its own |
| A hand with no owner named | a different person's arm, to the elbow | whose hand, and how much arm, in every clip |
| Framing left to the seed frame | the clip pulls back to a wide shot | name the shot size and say it holds |
| Four or more simultaneous actions | coherence collapses | split into panels |

## Stitching the cut

Read before the concat, in `make-video` step 9.

1. **Normalise before you concat**: one resolution, frame rate, pixel format and codec.
2. Concat same-codec clips with the concat demuxer over a file list, not a filter graph; re-encode only the non-conforming.
3. **Hard cuts by default.** A 0.5 s crossfade only at a topic change.
4. Normalise loudness across the cut. Each clip keeps its own audio, dialogue included; the stitch does not replace or duck it. Music spanning a join is one track over the concat.
5. Escape the drive colon and every backslash in drawtext filters; an unescaped `C:` kills the burn.

## When a shot is wrong

Regenerate that clip only, never the whole video, and only when the person sends it back. Never offer to build the video from the stills instead: that changes what the job delivers, which is theirs to do, and `ask.js` refuses the question. A bad render is `R-RENDER`: same prompt, new run, or one edited sentence. A bad plan is `R-SHOT`: the board goes back to its gate and only the changed panels re-render. Three failures on the same clip means the prompt is wrong, not the model: rewrite the panel, note it for the analyst. Every generation is logged against the job's credit ceiling.

Numbers in this file are recorded with their provenance in `docs/sources/social.md`.
