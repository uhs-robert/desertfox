# amo

What the addons.mozilla.org listing needs from this repository. `just sign_listed` submits it.

- `metadata.json`: the listing fields in the shape of the AMO add-on API (v5), passed to `web-ext sign --amo-metadata`. Name, summary (at most 250 characters), description, categories, homepage, support URL, the version license (`MPL-2.0`), the release notes and the notes for Mozilla's reviewers. The category slugs `tabs` and `appearance` come from `GET /api/v5/addons/categories/` (Firefox, extension). The reviewer notes carry the permission reasons and the answers about user snippets and the native host, so keep them true when a permission, a request or the host changes. The API ignores a field it does not know, so check `support_url` on the listing page after the first submit.
- `icon.png`: the 128 px listing icon, rendered from `src/icons/desertfox.svg` by `tools/render_promo.sh`. The manifest icon is an SVG, and the API takes a PNG for the listing icon.

Two things stay outside the submit and are set on the listing page:

- The privacy policy: paste `docs/privacy.md` into the privacy policy field.
- The previews: `docs/images/hints.png`, `which-key.png`, `command-line.png`, `theme-switch.png` and `drag.png` (1280x800), and `assets/promo/amo-listing.png`. Not `demo.gif`: previews are static images.

The source archive for the submit comes from `just source_archive`. Its `BUILD.md` is the root `BUILD.md` of this repository.

## Order of a submission

1. Bump the version in `package.json`, `package-lock.json` and `src/manifest.json` to a new three-number version, commit it on a release branch and push. `sign_listed` refuses a dirty tree and signs the version in the manifest, and AMO signs a version number once.
2. Publish the GitHub release with the hosts before the submit: `just release_stamp <version>` then `just release_publish <version>`. The release has no xpi, because a listed submit downloads none. The add-on's install command points at this release, so it must exist before AMO approves. The tag targets HEAD, so the push comes first.
3. Run `just sign_listed`. It stamps and builds again, which writes the same host bytes, and uploads the build, the metadata and the source archive.
4. Set the privacy policy, upload `amo/icon.png` as the listing icon and add the previews on the listing page.
   Captions for the previews:
   - `docs/images/hints.png`: Press f. Every link and button gets a label. Type it to click.
   - `docs/images/which-key.png`: Forgot a key? The which-key popup lists every key and what it does.
   - `docs/images/command-line.png`: Press : to run any command by name, with completion as you type.
   - `docs/images/theme-switch.png`: 29 built-in themes. One command switches, and a message confirms it.
   - `docs/images/drag.png`: Drag and drop without the mouse: grab a card, then type the label on its target.
5. After approval, add the signed xpi to the release with `gh release upload v<version> <file>` if you want it there.

After the add-on is listed, `just release` signs the unlisted channel. It does not touch the listing, and a new listed version still follows the steps above.
