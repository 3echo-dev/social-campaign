---
name: onboard-brand
description: Complete the required brand profile, save reusable brand research, and prepare campaign context. Use before the first job or when brand details change.
argument-hint: "[brand] and available sources"
metadata:
  version: 1.1.0
---

# Brand onboarding

## Social Campaign local adapter

Read pipeline/LOCAL-ADAPTER.md before following this vendored flow.

The root onboard-brand skill creates or completes the local profile through pipeline_brand_create and pipeline_brand_complete.

The four channel fields are required and accept a full URL or Not available.

Do not require Studio identity, Drive, gate-app, a remote database, or automatic research downloads to complete local onboarding.

The profile revision is the brand gate for local job creation.

Complete this before starting a new job.
The setup order is workspace and storage, needed connector checks, brand onboarding, then a job brief and its preflight.
Existing jobs can resume without repeating onboarding.

### Local authority

The local adapter above is authoritative for this installation.
The upstream steps below remain as a reference for the source contract and are not an entry path.
Do not execute their scaffold-brand, pane.js, Drive, gate-app, brand-research, or automatic network research commands.
Use the root onboard-brand skill with pipeline_brand_create, pipeline_brand_complete, and the local board.
Research is optional and user-directed after onboarding; it is never downloaded as part of local setup.

1. Resolve or scaffold the brand with `scaffold-brand.js {brand} "{Brand Name}"`.
   Select local storage or a Drive desktop folder through the existing workspace setting.
   Check local list, read, write, and stat access before calling storage ready.
   Report Drive synchronization as unconfirmed unless the existing connector proves it.
   Read existing brand files before updating anything.
   Open the brand pane with `pane.js "brand:{brand}" "{Brand Name}, brand setup"`.
2. Use `brand-profile.js {brand} --questions` for the first question batch.
   Website, Facebook, Instagram and TikTok are separate required fields.
   Each must contain a full URL or an explicit N/A / Not available.
   Never turn a blank answer into N/A, and never search for accounts declared unavailable.
   Account URLs are research references; they do not authenticate publishing.
3. Ask for up to three competitors and the market, geography, audience, language, plus any existing palette, fonts, voice, strategy, content pillars and asset references.
   Prefill known answers from supplied material and ask only about gaps that affect the work.
   Save the complete declared profile through `brand-profile.js {brand} --file {profile-input.json}`.
   Fields are website, facebook, instagram, tiktok, competitors (array), palette (hex array), fonts (array), voice, strategy, market and contentPillars (array).
   On updates, preserve earlier declared values unless the user changes them.
4. Read `brand-research.js {brand}` before research.
   Reuse current saved competitors and findings.
   Refresh when stale, the market or declared profile changes, evidence conflicts, or the user requests it.
   If no competitors were declared or saved, select up to three relevant competitors and explain why.
   If fewer than three have evidence, record that gap instead of inventing competitors.
5. Research supplied sources and a representative set of accessible recent posts.
   Save dated source URLs, a social strategy assessment, content pillars, voice, visual identity, a post audit and campaign decomposition through `brand-research.js {brand} --file {research-input.json}`.
   The input contains sources [{url, observedAt}], competitors (names), and text fields summary, strategy, voice, visualIdentity, contentPillars, postAudit, campaignDecomposition and competitorRationale.
   Declared facts take precedence over research findings.
   Inaccessible posts remain explicit gaps.
   Do not rerun broad competitor discovery for every job.
6. Prepare brand-voice.md, audience.md, positioning.md and platform-playbook.md from the saved context using the existing templates.
   Put palette, fonts and marks in the relevant brand files as well as the declared profile.
   Preserve source references and label unknowns and recommendations.
   Open one review with `open-review.js --brand {brand}`.
   Check `wait-decision.js "brand:{brand}" brand 0` once, then end the turn if awaiting the user.
   An approval accepts the brand context; requested changes update only the relevant sections.
7. Return to new-job after the profile is saved and the review is handled.
   Do not require unavailable social accounts or a publishing connector for research-only work.

The shared rules in `${CLAUDE_PLUGIN_ROOT}/docs/SHARED-RULES.md` apply.
Persist context at brand scope; each specialist receives only the relevant facts and source references.
Research memory is not permission to publish or spend.
