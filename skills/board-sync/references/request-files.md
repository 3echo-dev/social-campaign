# Files that travel with a board request

Read by `skills/board-sync/SKILL.md`. Each section is applied exactly as written here.

If `args.kit.logo.action` is `suggested`, the person took one of the logo suggestions of the kit step (`skills/onboard-brand/SKILL.md`, section 4a): the picture is already on this computer and the request carries only its id, so there is nothing to download and nothing to delete; land and apply `args` unchanged.
If `args.kit.logo.action` is `asset`, the board already uploaded the downscaled logo (and its thumb) to the artifact's own asset store instead of inlining it, so the request carries only ids, never bytes.
Call the Artifact tool's `read` action with `url` set to the board's artifact URL and `path` set to `args.kit.logo.assetId`; it saves the logo to a local file and returns that file's path.
Call `read` again the same way with `path` set to `args.kit.logo.thumbAssetId` when present, for the thumbnail.
Pass `args` to `pipeline_board_request_land` unchanged except for `kit.logo`, which becomes `{action: 'file', path: <saved logo path>, thumbPath: <saved thumb path>}`.
Then call `pipeline_board_request_apply` with `confirmedBy` set to `board request <requestId>`, and publish the workspace projection.
Once the apply has succeeded, delete both transit copies from the artifact's asset store with the Artifact tool's `delete` action: `url` set to the board's artifact URL and `path` set to `assetId`, then again with `path` set to `thumbAssetId`.
This is the owner's standing instruction: the asset store is only a transit path from the board to this computer, and the logo must never remain stored on claude.ai.
If the host asks the person to confirm either delete, that is expected; do not skip the delete to avoid the prompt.
From here on the logo lives only in the local workspace, under `workspaces/<brand>/brand/assets/`, recorded in that brand's `brand-kit.json` and `profile.json` and nowhere else.

Photos of the brand's world travel the same way, in `args.kit.references` (a list, optional, up to 5).
For each item whose `action` is `asset`, call the Artifact tool's `read` action with `path` set to its `assetId`, and pass that item to `pipeline_board_request_land` as `{path: <saved path>, fileName}`.
An item whose `action` is `upload` already carries its bytes and goes through unchanged.
After the apply has succeeded, delete each transit copy the same way as the logo's.
A photo that cannot be saved never stops onboarding: the result says how many were saved, and the rest can be added later.

A product photo, on `create_job` (`args.photo`) or `attach_product_photo` (`args.photo`), travels the same way: if `action` is `asset`, call the Artifact tool's `read` action with `path` set to `args.photo.assetId` to save it to a local file, then pass that saved path as `photo.path` (dropping `assetId`) to `pipeline_job_create` or `pipeline_product_photo_attach`.
If `action` is `upload` instead (the pre-assets fallback, `dataBase64`), decode those bytes to a local file yourself before calling either tool with that path; never type or re-key them.
Once the tool call succeeds, delete the transit copy from the artifact's asset store the same way as the logo's, with `path` set to `assetId`, when one was used.
The photo lives only under that brand's own `inputs/<brand>/`, recorded on the job as `productAsset`, and nowhere else.

A reference the person added on the job page (`add_reference`, `args.reference`) travels the same way: a picture, video, audio file or add-on arrives as `action` `asset` (an `assetId` in the artifact's asset store), `upload` (`dataBase64`, only for small files) or `text` (the caption or notes text itself, nothing to download).
For `asset`, call the Artifact tool's `read` action with `path` set to `args.reference.assetId` to save it to a local file, and pass `reference.path` as that saved path (dropping `assetId`) to `pipeline_board_request_land`.
For `upload`, decode those bytes to a local file yourself first; never type or re-key them.
Then apply with `pipeline_board_request_apply` like any other request, delete the transit copy from the artifact's asset store the same way as the logo's, and publish the workspace projection.
A `create_job` request can carry `args.references`, a list of up to 8 references the person added in the new-job form, each shaped exactly like `add_reference`'s `reference`.
Land each one the same way before landing the request: for `asset`, save it with the Artifact tool's `read` action using `path` set to its `assetId` and put the saved path in that reference's `path` (dropping `assetId`); for `upload`, decode the bytes to a local file first; `text` needs nothing.
Leave `references` in `args` otherwise unchanged, then apply once: the server checks every reference before the job exists (a bad one refuses the whole request, so tell the person the server's plain line and decline it), then saves them into the new job's `inputs/references/` and manifest, and reports how many it saved.
Delete each transit copy afterwards, as above.
A link the person pasted on the job page arrives as an `add_reference` whose `reference` is `{action: 'link', url, note}` (an https address, no file to land or download).
Apply it with `pipeline_board_request_apply` like any other request: the server saves the link as a job reference itself, the same way `pipeline_reference_from_url` does for a link pasted in chat (a video-site link is downloaded with its caption and thumbnail, a direct picture or video link or any web page is saved with its title, text and main picture), and it can take a minute.
Do not call `pipeline_reference_from_url` for it as well.
If the apply refuses it (a login wall, a private address, a page that could not be read), tell the person the server's plain line, suggest the upload button for a file they already have, and decline the request with that reason.
An `add_reference` request can also carry `to` (the agent chat the person sent it from, which then shows it as a chip) and `questionId` (an open question posted with `wantsUpload`, which the apply answers for you); land and apply it exactly as above, and do not answer that question again by hand.
The server checks the type, the extension and the file's own bytes, and saves it under that job's `inputs/references/<type>/<id>/`, recorded in `inputs/references/manifest.json`; nothing is saved outside the job folder.
If the apply refuses it (wrong kind of file, too big), tell the person the server's plain line and decline the request with that reason.
A reference can carry an optional `role` (`logo`, `product`, `person`, `style`, `motion` or `sound`); the server ignores any other value and stores a valid one on the manifest entry.
When the person picks a file already saved on the brand (the job page's "From this brand"), the `add_reference` request's `reference` is `{ action: 'brand', brandAssetId, note? }` with no file to download: land and apply it as is, and the server copies the brand's own saved logo (as a picture with role `logo`) or reference photo into the job. Never add a path to it.
A `remove_reference` request (`args.referenceId`) is the person taking a saved reference off the job page; it carries no file, so land and apply it like any other non-decision request, then publish the workspace projection.
The server takes the entry out of the manifest and moves its files to `inputs/references/.removed/<id>/` inside the job folder (nothing is deleted); an id that is no longer on the job is refused with a plain line, so decline the request with it. Do not use a removed reference afterwards.
