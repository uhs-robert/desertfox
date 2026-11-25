# amo

What the addons.mozilla.org listing needs from this repository. `just release` submits every stable version to it, and `just sign_listed` is the manual and recovery entry.

- `metadata.json`: the listing fields in the shape of the AMO add-on API (v5), passed to `web-ext sign --amo-metadata`. Name, summary (at most 250 characters), description, categories, homepage, support URL, the version license (`MPL-2.0`), a neutral release notes line and the notes for Mozilla's reviewers. The release notes line is a placeholder: `just release` converts the text of `RELEASE.md` to plain text (`tools/amo_notes.mjs`) and writes it into a temporary copy of this file for the submit, so the committed line never changes. A manual `just sign_listed` with no kept notes submits the placeholder. The category slugs `tabs` and `appearance` come from `GET /api/v5/addons/categories/` (Firefox, extension). The reviewer notes carry the permission reasons and the answers about user snippets and the native host, so keep them true when a permission, a request or the host changes. The API ignores a field it does not know, so check `support_url` on the listing page after the first submit.
- `icon.png`: the 128 px listing icon, rendered from `src/icons/desertfox.svg` by `tools/render_promo.sh`. The manifest icon is an SVG, and the API takes a PNG for the listing icon.

Two things stay outside the submit and are set on the listing page:

- The privacy policy: paste `docs/privacy.md` into the privacy policy field.
- The previews: `docs/images/hints.png`, `which-key.png`, `command-line.png`, `theme-switch.png` and `drag.png` (1280x800), and `assets/promo/amo-listing.png`. Not `demo.gif`: previews are static images.

The source archive for the submit comes from `just source_archive`. Its `BUILD.md` is the root `BUILD.md` of this repository.

## Order of a submission

`just release` runs steps 1 to 4 on a clean release branch with the release text under "# Next release" in `RELEASE.md`. Only stable (three-number) versions go to the listing. Betas (four numbers) stay unlisted and self-hosted.

1. Before anything changes, it checks that `RELEASE.md` is non-empty and converts to plain text (`tools/amo_notes.mjs` fails on an empty result or one over 3000 characters, the limit the AMO API answers with: its docs state none), that `amo/metadata.json` lints and that the source archive builds within AMO's 200 MB limit. A too-long text fails here with its length: shorten `# Next release` in `RELEASE.md`, or for a recovery `release-assets/release-notes-<version>.md`, to a short summary with a link to the GitHub release notes.
2. It bumps the patch version, stamps and hashes the hosts, builds, runs `web-ext lint` on `dist/`, and commits and pushes the bump.
3. It publishes the GitHub release with the hosts only and the `RELEASE.md` text as the body. The add-on's install command points at this release, so it comes before the submit.
4. It submits the listed version (`release_submit_listed`): stamp, build, source archive, then the converted notes in a temporary metadata copy. Last, it resets `RELEASE.md`. The reset waits for the submit on purpose: after a failed submit the text is still in `RELEASE.md` and in `release-assets/release-notes-<version>.md`.

Mozilla reviews the version, which takes days or weeks. No unlisted xpi is signed for a stable version and nothing is installed locally: install the approved version from AMO.

5. Set the privacy policy, upload `amo/icon.png` as the listing icon and add the previews on the listing page (once, after the first submit).
   Captions for the previews:
   - `docs/images/hints.png`: Press f. Every link and button gets a label. Type it to click.
   - `docs/images/which-key.png`: Forgot a key? The which-key popup lists every key and what it does.
   - `docs/images/command-line.png`: Press : to run any command by name, with completion as you type.
   - `docs/images/theme-switch.png`: 29 built-in themes. One command switches, and a message confirms it.
   - `docs/images/drag.png`: Drag and drop without the mouse: grab a card, then type the label on its target.
6. After approval, add the signed xpi to the GitHub release: download it from the version page on AMO, check that its manifest has no `update_url`, then `gh release upload v<version> desertfox-<version>.xpi`. A scheduled job for this is planned and not built yet.
7. Point the README at the listing.

## Dry run

`RELEASE_DRY_RUN=1 just release` rehearses the flow. It still bumps the version and commits the bump locally (undo with `git reset --hard HEAD~1`), and it builds, lints and makes the source archive. It pushes nothing, creates no GitHub release, submits nothing to AMO, needs no AMO key and leaves `RELEASE.md` alone.

## Recovery

AMO signs a version number once, so never run `just release` again after it bumped: it bumps a second version. Find the failed step and resume from it.

- The push or the GitHub release failed: the bump is committed or local, and nothing is on AMO. Fix the cause, then `just release_commit_push`, `just release_publish <version> "" release-assets/release-notes-<version>.md`, `just sign_listed` and `just release_notes_reset <version>`.
- The submit failed after the GitHub release: open the AMO developer hub first. If it lists the version, the number is burned. Open the version page and check that it has the source archive: the upload creates the version first and attaches the archive in a later request. If the archive is missing, upload `release-assets/desertfox-<version>-source.zip` there by hand, because a reviewer cannot rebuild without it. Then run `just release_notes_reset <version>`. If it does not, fix the cause and run `just sign_listed`, which takes the notes kept in `release-assets/` for the version in `src/manifest.json`, then `just release_notes_reset <version>`.
- Mozilla rejects the version: the number stays burned, and `just release` already reset `RELEASE.md`. Put the notes back before the next run: open `release-assets/release-notes-<version>.md`, copy its text without the `# DesertFox <version>` title line, and paste it under `# Next release` in `RELEASE.md`, above or merged with anything written since. Fix the cause, then run `just release` for the next patch version.
- `just release_notes_reset <version>` leaves `RELEASE.md` alone when it changed since the release took its text, and says so.

The AMO key stays in unexported shell variables, as in `just release`. `just sign_listed` refuses to run in CI.
