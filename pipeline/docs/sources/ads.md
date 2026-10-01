# Sources: ads and performance

Rows cover `agents/media-buyer.md`, `agents/analyst.md`, and `skills/analytics/SKILL.md`.
Every source row was checked on 2026-09-02.
Rules from practitioner sources remain labelled HOUSE DEFAULT unless a primary platform source supports them.

| Our file | Origin | License | Usage | What was taken |
|---|---|---|---|---|
| agents/media-buyer.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | TCPL anchor, ad-count ceiling, testing and scaling budget split, data gates, graduation criteria, frequency bands, refresh timing, and controlled scaling steps. |
| agents/media-buyer.md, agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Attribution-window separation, verified-data guardrails, and the rule to diagnose lag and learning state before judging a CPA movement. |
| agents/media-buyer.md, agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Platform text limits, the minimum-impression gate, concept testing, and creative refresh rules. |
| agents/media-buyer.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Event-quality warning bands, conversion-history guidance, and Facebook campaign checks. All numeric bands are HOUSE DEFAULT. |
| agents/media-buyer.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Three to five concepts per test batch and faster TikTok fatigue assumptions, both labelled HOUSE DEFAULT. |
| agents/media-buyer.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Audience exclusions, bid-strategy history, campaign naming, and tracking-plan fields. |
| agents/media-buyer.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Score only verified evidence, count concepts by angle rather than resize, and diagnose fatigue from a time series. |
| agents/media-buyer.md | third-party reference, nothing copied | MIT with Commons Clause | inspiration, own words | The proven, iteration, and new-concept portfolio split only. The rule is flagged HOUSE DEFAULT and the source license is called out for sign-off. |
| agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | Apache-2.0 | adapted | Report structure, trend sample guidance, engagement and completion formulas, and a short prioritized action list. |
| agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Brand-relative pattern grouping, minimum post counts, and Do More, Do Less, Experiment With output. |
| agents/analyst.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Diagnostic separation of the opening hook, on-ramp, offer, and destination-page symptoms. |
| agents/analyst.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | The repeated low-completion signal as evidence to revisit hooks. |
| agents/analyst.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Four hook, hold, and CTR diagnostic cases. Product routing and tool instructions were removed. |
| skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Hook-rate and hold-rate formulas plus the ordered video funnel. |
| agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Goal-mapped metric filter, platform signal map, reporting fields, and social-attribution caveat. Vendor routing was removed. |
| agents/analyst.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Refresh-before-kill rule and weekly, monthly, quarterly review cadence. |
| agents/analyst.md, skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Predeclared segments, no peeking, practical significance, and sample reporting. |
| skills/analytics/SKILL.md | third-party methodology (see THIRD_PARTY_NOTICES.md) | MIT | adapted | Sample-size table by baseline conversion rate and detectable lift. |

## Conflicting practitioner ranges

| Metric | Values seen | Pipeline choice |
|---|---|---|
| Hook rate described as good | 20 to 25 percent in one practitioner source, 30 to 40 percent in a second, at least 40 percent in a third | 30 percent is the HOUSE DEFAULT and below 25 percent is a warning. Brand-relative history remains the decision baseline. |

## Numbers these files carry

Each row is a number that appears in an instruction file without a citation next to it.
The tag used to sit inline, which cost about 1,500 tokens a run and invited the model to
repeat the word "unverified" back to the user. The number stays where it is used; its
provenance lives here.

`HOUSE DEFAULT` means a practitioner source or our own bar, not a platform document.
`SOURCED` means it traces to the named document on the date given.

| Our file | The line it appears in | Where the number came from |
|---|---|---|
| `agents/media-buyer.md` | - The creative test plan: hooks by formats, 3 to 5 concepts per batch | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/media-buyer.md` | 3. Set the anchor: target cost per qualified result (TCPL). From deal math where the brief gives it, else from trailing history, else state it as an assumption to confirm. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 4. Derive the ad-count ceiling: `daily budget x 14 / (2 x TCPL)`, so each ad can earn 2x TCPL of spend inside a 14-day read. Run fewer ads than the ceiling. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 5. Split the budget: about 80 percent to the scaling campaign holding graduated ads, about 20 percent to a testing campaign with its own protected budget. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 6. Write the audience per ad set. Target broadly and let the creative do the targeting; audience knowledge belongs in the copy before the targeting filters. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 7. Write the exclusion list. Always exclude existing customers and recent converters, with the converter window stated in days. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 8. Set each ad set's daily budget to at least 5x the target CPA, below which the algorithm cannot exit learning. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 9. Build the creative test plan as a hooks by formats matrix, 3 to 5 concepts per batch, image-first: validate a new concept as a static before commissioning the video version, except... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 1. Meta ad text: primary text 125 characters visible and up to 2,200, headline 40, description 30. TikTok ad text 80 recommended and 100 maximum. Platforms truncate without warning. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/media-buyer.md` | 2. Never judge an ad before 1,000 impressions. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/media-buyer.md` | 3. Verify pixel or events coverage before launch, and require an Event Match Quality of at least 8.0 on the conversion event, treating below 6.0 as critical. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 4. Day 7 delivery check per test ad: minimum expected spend is `(campaign daily budget / active ads) x 7 x 0.5`. Below that, or zero spend, propose a kill. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 5. Data gate: below 3x TCPL of spend, propose nothing. Wait. No winner is declared before the gate. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 6. Qualified-rate swap: pixel results but zero qualified, swap and change the angle. Qualified rate below 40 percent, swap and add filtering language. 40 to 60 percent, monitor one more... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 7. Cost check: at or below TCPL is a candidate winner, 1 to 1.5x TCPL is monitor, above 1.5x TCPL is a swap. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 8. Graduation from testing to scaling needs all of: at least 5 qualified results, qualified rate at or above 60 percent, cost per qualified result at or below TCPL, running at least 14... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 9. Frequency bands: cold prospecting safe 1.0 to 2.5, warning 2.5 to 4.0, critical above 4.0. Retargeting safe 2.0 to 4.0, warning 4.0 to 6.0, critical above 6.0. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 10. Lifespan by format before a refresh is due: statics 14 to 28 days, short video and carousels 21 to 35, UGC and testimonial 28 to 42. On tiktok, plan a refresh every 7 to 14 days... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 10. Lifespan by format before a refresh is due: statics 14 to 28 days, short video and carousels 21 to 35, UGC and testimonial 28 to 42 [HOUSE DEFAULT, from... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 11. Never edit a performing ad. Editing resets learning; pausing does not. Launch a new ad alongside it instead. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 12. Iteration priority when refreshing a winner: hook, then visual, then format, then copy. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 13. Scale at plus 20 percent every 5 days, never plus 30 percent or more in one move. Roll back by cutting 20 to 30 percent when cost per qualified result exceeds 1.5x TCPL after a step. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 14. Propose an Advantage+ transition only after a proven offer, a validated audience and about 50 conversions per week on the optimisation event. Switch a bid strategy to automated only... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 14. Propose an Advantage+ transition only after a proven offer, a validated audience and about 50 conversions per week on the optimisation event [HOUSE DEFAULT, from... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 15. Keep at least three tests running at any time across creative, offer and destination. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 16. Audit guardrails: score only what you verified, and say "not checked" rather than "failing". Never sum conversions across attribution windows; report each window side by side. A CPA... | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/media-buyer.md` | 17. A resize or a recolour is not a distinct concept. Count concepts by angle, not by asset. Diagnose fatigue from a time series, never from an ad's age alone. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 17. A resize or a recolour is not a distinct concept. Count concepts by angle, not by asset. Diagnose fatigue from a time series, never from an ad's age alone. | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/media-buyer.md` | 18. Maintain a proven / iteration / new-concept split of roughly 50 / 30 / 20 in the active library. Iterating on a winner converts more often than a cold concept, so a library that is... | HOUSE DEFAULT, from third-party methodology, unverified |
| `agents/analyst.md` | - Pausing, killing or refreshing anything. You propose; the human decides, and kills are always human-approved. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 7. Fill Results by deliverable, using the platform's signal metric: instagram saves and sends, tiktok shares and completion, facebook shares and saves. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 9. Run the pattern method: group the settled set by pillar, format, posting time, length, hook family, tone and platform, rank each dimension by the brand's own engagement rate, and... | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 12. Close with exactly three next actions, prioritised, each naming the skill or agent that would act. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 1. Only `settlement: settled` observations may produce a learning. Provisional observations may raise an alert and nothing else. Settlement is 3 days after windowEnd for engagement... | SOURCED: CONFIG.md metric_settlement_days_engagement and metric_settlement_days_conversion, checked 2026-09-02 |
| `agents/analyst.md` | 2. A pattern needs at least 30 posts; below 15 posts patterns are unreliable and you say so and proceed with caveats; below 10 posts you do not attempt pattern analysis. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 3. A trend needs at least 8 to 12 data points over time. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 4. No ad is judged before 1,000 impressions. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 5. Diagnostic funnel: weak thumbstop or 3-second view rate points at the visual opening. Weak hold rate points at the on-ramp, seconds 3 to 15, not at the hook. Weak CTR points at the... | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 6. Hook rate bands: 30 percent or above is good, below 25 percent is a warning. Alternatives seen are listed in `docs/sources/ads.md`. | HOUSE DEFAULT, from third-party methodology reconciled, unverified |
| `agents/analyst.md` | 7. Four scenarios: good hook and poor hold, rebuild seconds 3 onward and keep the opening. Average everything, improve the hook first. Poor hook, rebuild the hook completely against the... | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 8. Five or more videos under 1 percent completion rate means change the hooks, not the content. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 9. Score on signal, not vanity: saves, shares, replies and the goal-mapped metric. Low likes is never a kill criterion. Propose refresh before kill. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 10. Assume social attribution undercounts by 30 to 50 percent and say so wherever a conversion figure carries a decision. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 11. Never sum conversions across attribution windows. Report each window side by side. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 12. Report only segments defined before you looked. No post-hoc segments, no peeking, no stopping at the first favourable read. | SOURCED: third-party methodology, checked 2026-09-02 |
| `agents/analyst.md` | 14. Cadence: a weekly pulse, a monthly trend read, a quarterly strategy review. | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| Engagement rate \| `(likes + comments + shares + saves) / reach` \| Reach, not impressions, not followers \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| Hook rate \| `3-second views / impressions`; on Meta `actions[video_view] / video_play_actions` \| Never `video_p25_watched_actions` \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| Hold rate \| `thruplays / 3-second views` \| Thruplay is 15 s or completion \| | SOURCED: same file, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| Completion rate \| `completed views / total views` \| \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 2. Video funnel order: plays, then hook rate, then 3-second views, then hold rate, then thruplays. Read the whole funnel before crediting the hook. | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 3. Never sum overlapping conversion action types and never sum conversions across attribution windows. Pick one and name it. | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 4. Platform signal map: instagram saves and sends, tiktok shares and completion, facebook shares and saves. Followers, impressions and likes alone are vanity. | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 5. Three-test metric filter: keep a metric only if it maps to the stated goal, it can be pulled from a native dashboard or export, and it would change next week's action. One primary... | SOURCED: same file, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 6. Assume social attribution undercounts by 30 to 50 percent. Say so wherever a conversion figure carries a decision. | SOURCED: same file, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 7. Settlement: an observation is provisional until `collectedAt` is at least 3 days after `windowEnd` for engagement metrics, and at least 28 days after `windowEnd` when a conversion... | SOURCED: CONFIG.md metric_settlement_days_engagement and metric_settlement_days_conversion, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| A trend \| 8 to 12 data points over time \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| Judging one ad \| 1,000 impressions \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | \| A content pattern \| 30 posts; caveat below 15; refuse below 10 \| | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 9. Test discipline: run to the sample size decided in advance. No peeking and stopping at the first favourable read, no post-hoc segments, and report only segments named before looking.... | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 10. Sample size per variant at 95 percent confidence and 80 percent power, for the lift you want to detect: | SOURCED: third-party methodology, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | Three variants need about 1.5x, four about 2x. Run at least one full week regardless of sample, and stop by 4 to 8 weeks. At our volumes most single-post reads will not clear these rows;... | SOURCED: same file, checked 2026-09-02 |
| `skills/analytics/SKILL.md` | 11. Benchmarks: this file states none as fact. Benchmarks are brand-relative, so compare to the brand's own average on the same platform and format. Where a practitioner range is quoted... | HOUSE DEFAULT, from third-party methodology reconciled, unverified |
