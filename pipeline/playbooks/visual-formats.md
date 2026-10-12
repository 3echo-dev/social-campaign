# Visual formats

The format is the container that carries the message. Every concept and post carries one `format_id`. Some formats suit some awareness stages much better than others; the pairing table is what the concept ranking reads as "fit".

## Formats

| Id (`format_id`) | What it looks like | Best stages | Platforms | Guard |
|---|---|---|---|---|
| F-TALKING-HEAD | One person to camera | problem_aware, product_aware | tiktok, instagram, facebook | The person is credible for the claim |
| F-FOUNDER-DESK | The founder at their desk or workplace, informal | problem_aware, product_aware | tiktok, instagram | A real founder or a clearly disclosed stand-in |
| F-UGC-SELFIE | A customer-style selfie video, phone held | problem_aware, solution_aware | tiktok, instagram | Disclosure when the creator is AI-generated or paid |
| F-SCREEN-WALK | A screen recording or walkthrough of the product | solution_aware | tiktok, instagram, facebook | The screens are real and current |
| F-PRODUCT-DEMO | The product shown working, hands and close-ups | solution_aware, product_aware | all | The product is never in the first shot of an unaware piece |
| F-TEXT-ON-SCREEN | Mostly text over simple footage or colour | unaware, most_aware | tiktok, instagram | Readable inside the 9:16 safe area |
| F-SPLIT-COMPARE | Split screen: before and after, or this against that | problem_aware, solution_aware | all | Both halves are honest |
| F-CAROUSEL | Swipeable slides, first slide is the hook | solution_aware, product_aware | instagram, facebook | 3 to 10 slides, one idea each |
| F-PROOF-CARD | A static image carrying one result, review or number | product_aware, most_aware | instagram, facebook | The proof has provenance |
| F-REPLY | A reply or duet answering a comment or another video | problem_aware, product_aware | tiktok, instagram | The comment is real |

## Stage pairing (read by `rank-concepts.js` as fit)

| Stage | Strong | Weak |
|---|---|---|
| unaware | F-TEXT-ON-SCREEN, F-UGC-SELFIE, F-REPLY | F-PROOF-CARD, F-SCREEN-WALK |
| problem_aware | F-TALKING-HEAD, F-FOUNDER-DESK, F-UGC-SELFIE, F-SPLIT-COMPARE, F-REPLY | F-PROOF-CARD |
| solution_aware | F-SCREEN-WALK, F-PRODUCT-DEMO, F-SPLIT-COMPARE, F-CAROUSEL | F-TEXT-ON-SCREEN |
| product_aware | F-PROOF-CARD, F-PRODUCT-DEMO, F-TALKING-HEAD, F-CAROUSEL, F-FOUNDER-DESK | F-TEXT-ON-SCREEN |
| most_aware | F-TEXT-ON-SCREEN, F-PROOF-CARD | F-SCREEN-WALK |

A format in neither column is neutral for that stage.
