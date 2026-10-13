# Ad styles

The ad style is the character of a piece: what the viewer walks away with.
The angle says which strategy tells the offer; the style says what the piece delivers on screen.
Every concept and post carries one `ad_style_id`.
Pick the style after the awareness stage (see `awareness-stages.md`) and before the hook, so the hook can promise what the style delivers.

## Industry tags

These tags are shared by `ad-styles.md`, `ctas.md` and `hook-lines.md`.
Read the brand's industry from the brand files and use exactly one of these tags.

| Tag | Covers |
|---|---|
| beauty-skincare | Skincare, cosmetics, hair, nails, salons, aesthetic clinics |
| food-beverage | Restaurants, cafes, packaged food, drinks, meal kits |
| fitness-health | Gyms, coaches, supplements, wellness, clinics that are not aesthetic |
| education | Courses, schools, tutoring, coaching programs |
| finance | Banking, lending, insurance, accounting, investing tools |
| real-estate | Agents, developers, rentals, property management |
| saas-ai-tech | Software, AI tools, apps, hardware with a software core |
| retail-ecommerce | Physical products sold online or in store, not covered above |
| hospitality-travel | Hotels, tours, venues, travel services |
| professional-services | Agencies, consultants, legal, trades, B2B services |
| gaming-entertainment | Games, streaming, events, media, creators |
| other | Anything that fits none of the above. Say what it is in one line |

## Styles

| Id (`ad_style_id`) | What it delivers | Funnel and stages | Pairs well with | Industries | Guard | First 6 s must |
|---|---|---|---|---|---|---|
| AS-PROBLEM-SOLUTION | A pain the viewer feels, then the way out | TOFU, MOFU: problem_aware, solution_aware | A-STATUS-QUO-COST, A-HIDDEN-STEP; H-QUESTION (relatable_callout), H-STORY (confession); M-STAKES-RISE, M-OPEN-LOOP | Suits all. Strongest in saas-ai-tech, professional-services, fitness-health | The problem is quoted from the anchor or research, never invented | Show the problem in the viewer's words before any product appears |
| AS-BEFORE-AFTER | The same person, place or thing, changed | TOFU, MOFU: problem_aware, solution_aware | A-BEFORE-AFTER; H-STORY (transformation), H-PROOF (cold_open_result); M-REVEAL, M-COMPARE | Suits beauty-skincare, fitness-health, real-estate, professional-services. Avoid in finance unless the result is documented and compliant | Real before and after only, same lighting and angle. Staged or generated results are R-FACT | Show the before state, or a flash of the after, so the change is the question |
| AS-ROI-SAVINGS | "Save X, get Y": a concrete gain in time or money | MOFU, BOFU: solution_aware, product_aware | A-STATUS-QUO-COST, A-RECEIPT; H-PROOF (stakes_cost), H-VALUE (specificity); M-PROOF-STACK, M-COUNTDOWN | Suits saas-ai-tech, finance, professional-services, retail-ecommerce. Avoid in beauty-skincare and hospitality-travel, where the buy is emotional | Every figure has provenance in `research/` or the brand files. No "up to" figures without the source | Put the real number and its unit on screen and in the voice |
| AS-PATTERN-BREAK | Curiosity from an unexpected visual: CGI, scale play, an object doing something it should not | TOFU: unaware | A-MYTH, A-IDENTITY; H-CURIOSITY (pattern_interrupt, curiosity_gap); M-PATTERN-BREAK, M-REVEAL | Suits retail-ecommerce, food-beverage, gaming-entertainment, beauty-skincare. Avoid in finance and professional-services, where it reads as unserious | The visual connects to the product's real benefit by the end. A clearly impossible visual needs no disclosure; a realistic fake of a real result does | Show the unexpected image in the first second, with no logo |
| AS-HOW-IT-WORKS | The process explained simply, step by step | MOFU: solution_aware | A-HOW-IT-WORKS, A-HIDDEN-STEP; H-VALUE (tutorial_cold_start), H-UTILITY (framework); M-COUNTDOWN, M-LIVE-DEMO | Suits saas-ai-tech, education, finance, food-beverage. Weak in hospitality-travel | The steps shown are the real steps, on current screens or the real product | Start mid-action on step one, and say what the viewer ends up with |
| AS-SOCIAL-PROOF | Real people saying it worked: testimonial, review, UGC | MOFU, BOFU: product_aware, most_aware | A-SOCIAL-PROOF, A-RECEIPT, A-OBJECTION; H-PROOF (authority_proof), H-STORY (transformation); M-PROOF-STACK | Suits all. Influencer-led UGC only when the brand already has a creator; otherwise use real customer reviews | Real customers with permission. A paid or AI-generated creator is disclosed | Show a real person or a real review, with the result they got |
| AS-OFFER | The offer and the first step, plainly | BOFU: most_aware | A-FIRST-STEP; H-VALUE (specificity), H-PROOF (cold_open_result); M-REVEAL, M-LIST-REVEAL | Suits retail-ecommerce, food-beverage, hospitality-travel, fitness-health, education | The offer is real and in the brand files or the job. A deadline that is not real is R-FACT | Name what they get and what it costs them, in plain words |
| AS-FOUNDER-STORY | Why the person behind it started, told by them | MOFU: problem_aware, product_aware | A-FOUNDER-WHY, A-IDENTITY; H-STORY (in_medias_res, confession); M-STAKES-RISE, M-CALLBACK | Suits professional-services, food-beverage, beauty-skincare, saas-ai-tech. Weak in gaming-entertainment | A real founder or a clearly disclosed stand-in, with a genuine, specific story | Open inside the moment that started it, not on a name or title |
| AS-COMPARISON | This way against the usual way, side by side | MOFU: solution_aware, product_aware | A-COMPARISON, A-OBJECTION; H-CONTRARIAN (contrarian), H-QUESTION (question); M-COMPARE | Suits saas-ai-tech, finance, retail-ecommerce, fitness-health | Fair to both sides. Never name a competitor unless the brand allows it | Show both options at once, so the difference is visible before it is explained |
| AS-MYTH-BUST | A common belief that is wrong, and the evidence | TOFU, MOFU: unaware, problem_aware | A-MYTH; H-CONTRARIAN (myth_bust); M-OPEN-LOOP, M-REVEAL | Suits fitness-health, beauty-skincare, finance, education. Use care in finance and fitness-health, where claims are regulated | Evidence in `research/`. No health or financial claim the brand files do not support | State the belief the viewer holds, then signal it is wrong |

## Rules

1. One style per piece. If a piece needs two, it is two pieces.
2. The style follows the stage: a TOFU style on a most_aware viewer, or the reverse, needs a one-line reason.
3. Every guard is checked against the brand files before the concept is ranked. A style whose guard fails is dropped, not softened.
4. The first 6 seconds belong to the viewer or the tension, never to the logo. The brand appears after the style has delivered its first beat.
5. Industry fit is a default, not a rule. A brand rule the person set always beats it.
6. If no style fits, write `ad_style_id: AS-OTHER` and say why in one line.
