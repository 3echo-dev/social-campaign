---
name: platform-format
description: >-
  Consumes the producer's platform-check.json and applies prose judgements: hook, muted viewing, media kind, links and hashtags. Use when drafting, packaging ads or reviewing.
metadata:
  version: 1.0.0
user-invocable: false
---

# Skill: Platform Format

**Purpose:** Apply rules a script cannot evaluate after the producer's check.
**Used by:** producer for the mechanical command, then copywriter, scriptwriter, media-buyer and editor for scoped interpretation.

## Inputs

`drafts/D*/post.md`; `platform-rules/{platform}.md`, the json block and its prose; `playbooks/hooks.md` for the `H-*` families; `validation/platform-check.json`; `route.json` for `synthetic_person`.

## Steps

1. The producer runs this deterministic check from the workspace root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/platform-check.js" {brand} {job-id}
```

Specialists do not run shell commands. They read `validation/platform-check.json`, confirm its
artifact revision matches the files they were assigned, and report any prose-only finding.

2. The producer records exit `0` all pass, `1` a fail, or `2` a caller mistake. An editor treats a missing or stale result as `not run`, never as a pass.
3. Carry every `drafts[].findings` entry into the report with its code and `msg`, attributed per rule 2.
4. Run the rule 4 prose checks: those are what the script cannot do.
5. GO when the script exits 0 and no prose check fails. Otherwise NEEDS REVISION, one row per finding.

## Rules

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.

1. The json block is the only authority for a number. Read it every run, never from memory or a practitioner list.
2. Every finding carries its own `msg`; do not re-derive it. Add the semantic owner task: `media.render` for `R-VISUAL` when media is absent, `draft.copy` for copy findings, and `review.editor` for review-only findings.
3. Where a practitioner source and the block disagree, the block wins and the report names the rejected figure. Known conflicts are in the platform file's provenance notes.
4. Prose checks, one pass per draft:

| Check | What fails |
|---|---|
| Hook quality | The first line fits the cutoff but spends it on a greeting or wind-up |
| Muted viewing | The promise lives only in the voiceover |
| Media kind | No attachment where one is required; a TikTok post mixing video and photos |
| Account requirements | The plan assumes Insights or a label the account type lacks |
| Link handling | A URL in an unclickable caption, no bio link, sticker or first comment named |
| Hashtag mix | A legal count, but all broad, all one niche, or stacked on top |
| Settings that exist | The Publish plan names a toggle the platform file lacks |
| Cross-draft difference | Two platforms carrying the same caption unchanged |

Each lives in the platform file's prose. Name the section.
5. A figure marked `reported` or `HOUSE DEFAULT` is a direction, never a gate. Label it and never raise a finding on it alone.
6. A warn is a finding, not a pass: report it at Low or Medium. Only a fail forces NEEDS REVISION.
7. Never edit a draft to make the script pass.

## Output contract

The producer writes `validation/platform-check.json`. Add its exit, counts and one row per finding to the caller's report.

Every row names the json field or prose section its rule came from. A finding without one is not reportable.

## Boundary

Does not judge truth (`fact-check`), voice (`brand-check`) or disclosure wording (`policy-check`); it fails only an absent disclosure. Writes no revision record.

## Failure modes

| Failure | Fix |
|---|---|
| Exit 2 | Brand or job id missing; fix the command, do not report a draft finding |
| No json block for the platform | The `platform` value is wrong or not in `platforms_v1`; R-LIMIT at High |
| `R-VISUAL` on every file | Media is not generated yet; the stage order is wrong |
| Script passes but the hook is a greeting | A character count is not hook quality; raise the prose finding |

Numbers in this file are recorded with their provenance in `docs/sources/checking.md`.
