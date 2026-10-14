# Industry and the brand library

Read by `skills/onboard-brand/SKILL.md`. Each section is applied exactly as written here.

## 4b. Industry and the brand library

Once research has saved, ask what kind of business the brand is, once, with `pipeline_board_ask` for the brand.
Offer the closest industries from `pipeline/playbooks/ad-styles.md` as buttons in plain words, at most 6, the best fit from the brand's pages first, and let the person type another, for example "Which of these is closest to what SK-II does?". Show no tags or ids.
Do not wait for the answer: until it comes, the strategist infers the industry and marks it inferred.
When the answer arrives (see Questions on the board in `skills/board-sync/SKILL.md`), save it with `brand_bank_save` as the brand's industry item: bank `yours`, kind `industry`, and as its text the industry's name exactly as the Strategy step lists it.
Those names are Beauty and skincare; Food and beverage; Fitness and health; Education; Finance; Real estate; Software, AI and tech; Retail and e-commerce; Hospitality and travel; Professional services; Gaming and entertainment.
When none fits, the text is the person's own words.
The Strategy step then opens with that industry already chosen, so never save the tag or an id as the text.
On an update of a ready brand, edit its existing industry item rather than adding a second.

The brand library already has what the research found, so the first concepts do not start blank.
The save filed the research for the next job to reuse (brand and competitor research stay fresh for 30 days), and it saved the best posts the researcher read on the brand's own accounts and on each competitor's as proven hooks, from the `topPosts` in the researcher's draft.
Do not call `social_outliers_find` again for those accounts, and never guess a handle.
When the save result's `topPosts.saved` is more than 0, say so in one line, for example "Saved 5 top posts to your brand library."
When `topPosts.breakdowns.videos` is more than 0, add one line in plain words, for example "I also watched 4 of the best videos and saved how they open, their style and their call to action."
When the save result's `banks` is there and `banks.saved` is more than 0, add one line in plain words from `banks.kinds`, for example "I also saved 9 customer pain points, 4 objections and 3 angles from comments, forums and reviews." Never name the banks, the kinds or the checks.
When it is missing, say nothing about it: a brand with no comments or reviews to read simply has none yet, and its pain points fill in from the research of its first jobs.
When no post was saved and Instagram is not the reason, say so once in plain words, for example "There are no posts to learn from yet, so your brand library starts empty. It fills as you make posts.", and carry on.

### Instagram behind a login

The research helper reads a public Instagram account when its stealth reader is installed (followers, bio, recent posts, and likes and comments per post, never views; its posts are filed with their likes). When that reader is missing or Instagram refuses it, the helper cannot read Instagram without a login, so a brand whose posts are on Instagram has none in its library after the save.
Look at its declared Instagram once through the person's own signed-in Chrome, but only when the Claude in Chrome browser tools are among your tools.
Do it in a background helper, so you keep answering board requests.
Open the declared profile (its Reels tab when it has one), then at most 3 of its posts, one look each; never reopen a page, never scroll hunting for more, and never open a competitor's page.
Read what the pages show: the followers and post count, and for the 3 posts with the most views their link, views, date and the opening words of the caption.
Viewing is read-only: never post, like, follow, comment, message, change settings or type credentials.
Claude Code may show its own tool permission prompt; that prompt is the person's to answer, and you never try to avoid it.
Save each post with `brand_bank_save`: bank `proven`, kind `hook`, source `brand`, the caption's opening words exactly as the page has them as the text, and the post's link, views and date (YYYY-MM-DD) as the evidence.
Skip a post that has no caption, views or date; never fill in or round a figure.
When the Chrome tools are not among your tools, or the page will not open, do not ask the person to connect anything in chat.
Record the gap in one plain line instead, for example "I could not read your Instagram because it needs a login, so there are no Instagram posts to learn from yet. They will come in as you make posts."
