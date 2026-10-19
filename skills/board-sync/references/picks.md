# Picks on the board and in chat

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written there.

### Recipe picks on the board and in chat

A post's recipe (its topic, angle, hook, call to action and hashtags) is answered once, on the board or in chat, the same as any other decision.
When the concept decision opens and a post has recipe options but no chosen recipe yet, say in the same chat summary that its copy choices can be picked here too, and list each field's options in one line.
A concept `submit_decision` that also carries `recipe`, one `{pillar, angle, hookFamily, cta, hashtags}` object per post still needing a pick, is applied by `pipeline_decision_apply` in that same call; nothing extra runs afterward.
A post with no concept step open, or one whose recipe options arrived after its concept was already approved, is answered through its own `choose_recipe` request: apply it immediately with `pipeline_board_request_apply`, the same as any other non-decision request.
An answer given in chat instead is applied with `pipeline_recipe_choose`, `via` set to `chat` and `chosenBy` set to the person's name, then publish the workspace projection.
A post already marked chosen in its `drafts/D<n>/recipe.json` is never asked about again, on the board or in chat.

### Which Studio workspace pays

The board's price panel shows which saved 3Echo Studio workspace pays for a job's media, with its name and credit balance, and a "Change" control listing every workspace saved with `pipeline_studio_workspaces_save`.
A pick there arrives as a `choose_studio_workspace` request (`args: {jobId, workspaceId, scope}`); apply it immediately with `pipeline_board_request_apply`, the same as any other non-decision request, then publish the workspace projection.
`scope: "job"` sets a one-job override; `scope: "brand"` sets that brand's default, shown on its brand card.
When several workspaces exist and the job has no choice yet, the price panel asks for one before its Approve button is enabled; nothing else about the price decision changes.
