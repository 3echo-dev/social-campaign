---
name: brand-check
description: >-
  Checks a draft caption, script or brief against the brand's own voice file and positioning file across four dimensions: voice and tone, terminology, messaging and claims, and style. Use at stage 4 when compressing research into a brief and at stage 10 Validate on every draft. Flags AI-tell vocabulary, banned claims and copy that matches the brand's own "sounds wrong" examples. Raises R-VOICE. Never edits the draft.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Brand Check

**Purpose:** Decide whether a draft sounds like this brand, using the brand's own files as the only authority.
**Used by:** strategist (Brief), editor (Validate).

## Inputs

- `brand/brand-voice.md`: "We are / we are not", tone adjectives, person and tense, "Tone by context" row, Vocabulary, Rhythm and formatting, "Example posts that sound right/wrong".
- `brand/positioning.md`: the one line, Proof points, "Claims we may never make".
- `brief.md`: Angle, Core message, "Required and prohibited elements".
- `drafts/D*/post.md` Caption, Hashtags, CTA; `drafts/D*/script.md` beats and on-screen text; `recipe` front matter.

## Steps

1. Read the brand files fresh; judge tone only against the "Tone by context" row for the draft's `platform`.
2. Walk the four dimensions below; test each "We are" attribute for presence, each "We are not" for a crossing; compare against "sounds wrong" examples, the strongest signal.
3. Scan for AI-tell vocabulary using rule 7 tiers, matching inflected forms; check claims against "Claims we may never make" (fails regardless of evidence, also reported by fact-check).
4. Write `validation/brand-check.md`; on any High finding write `revisions/{n}.json` with `R-VOICE`, quoting the text and the brand-file line it breaks.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. Voice is constant, tone flexes: voice never changes by platform. "More casual" is a tone change, never a different voice.
2. The four dimensions, each producing findings:

| Dimension | What fails |
|---|---|
| Voice and tone | Missing attribute, "we are not" crossed, tone mismatched to platform, unexplained mid-caption shift |
| Terminology and language | Banned word, "instead of" for "we say", wrong capitalisation, jargon above audience |
| Messaging and claims | Contradicts positioning, drifts off angle, unlisted proof point, never-make claim |
| Style and formatting | Length, breaks, lists, capitalisation, emoji, hashtags, ALL CAPS or "!" against Rhythm and formatting |

3. Severity: **High** contradicts the voice file, breaks a never-make claim, or carries compliance risk; **Medium** is inconsistent but not damaging; **Low** is style or preference.
4. Quote the exact failing text and brand-file line it breaks. A finding with no named rule is dropped.
5. Never edit the draft; a gate, not an editor. Before and after is evidence, not a patch.
6. A draft opening with the brand name fails unless the brand is the story; copy-paste twins across platforms fail too.
7. AI-tell vocabulary in `playbooks/voice.md`: Tier 1A always replace, a cluster of three or more is High on its own; Tier 1B always replace, never counted toward the cluster.
8. No em dash, en dash or double dash anywhere; plain dash only. Brand file wins over a practitioner list; an owned word is recorded once, not re-flagged.

## Output contract

Write `validation/brand-check.md`: verdict, drafts checked, voice file version and read-at time, findings table `| Location | Severity | Code | Finding | Rule and source | Suggestion |`, then `## Before and after` with the top three to five High findings, original text then the direction a fix would take, evidence not a patch.

Required: `platform`, `hook_family`, `recipe.pillar`; missing is Low here and a platform-format fail. Revisions target `draft.copy` or `strategy.brief` with artifact refs; numeric `targetStage` is legacy.

## Boundary

Does not check claim truth (`fact-check`), disclosure (`policy-check`), or limits (`platform-format`). Does not write copy.

## Failure modes

| Failure | Fix |
|---|---|
| `brand-voice.md` unpopulated | Report GO, Low finding naming empty sections; never invent a voice |
| Word on AI-tell list and "we say" | Brand file wins; note once |
| Voice fine but angle drifted | R-ANGLE, not R-VOICE; own record |

Numbers in this file are recorded with their provenance in `docs/sources/checking.md`.
