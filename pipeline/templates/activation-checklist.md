---
job: {job-id}
proposal_hash: ""             # sha256 prefix of the approved campaign/proposal.md
version: 1
status: draft
created: YYYY-MM-DD HH:MM {tz}
---

# Activation checklist

Reproduces proposal `{proposal_hash}` in Ads Manager, in order. Everything is created PAUSED. The last step flips to ACTIVE only after this checklist is approved.

- [ ] 1. Confirm the ad account, pixel and payment method named in the proposal
- [ ] 2. Create the campaign PAUSED with the objective and name from the proposal
- [ ] 3. Create each ad set PAUSED: targeting, exclusions, placements, optimisation goal, daily budget
- [ ] 4. Upload each creative from `handoff/` and confirm the file hash prefix matches the manifest
- [ ] 5. Create each ad PAUSED with the primary text, headline, description and destination URL from the proposal map
- [ ] 6. Verify the hierarchy: names, budgets, dates, and that every object shows PAUSED
- [ ] 7. Record the external IDs here: campaign, ad sets, ads
- [ ] 8. Only now, and only if this checklist is approved: set the campaign ACTIVE

| Object | Name | External ID | Status |
|---|---|---|---|

# Decision

Never written by the agent.
