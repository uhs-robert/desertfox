# amo

What the addons.mozilla.org listing needs from this repository. `just sign_listed` submits it.

- `metadata.json`: the listing fields in the shape of the AMO add-on API (v5), passed to `web-ext sign --amo-metadata`. Name, summary (at most 250 characters), description, categories, homepage, support URL, the version license (`MPL-2.0`), the release notes and the notes for Mozilla's reviewers. The category slugs `tabs` and `appearance` come from `GET /api/v5/addons/categories/` (Firefox, extension). The reviewer notes carry the permission reasons and the answers about user snippets and the native host, so keep them true when a permission, a request or the host changes. The API ignores a field it does not know, so check `support_url` on the listing page after the first submit.
- `icon.png`: the 128 px listing icon, rendered from `src/icons/desertfox.svg` by `tools/render_promo.sh`. The manifest icon is an SVG, and the API takes a PNG for the listing icon.

Two things stay outside the submit and are set on the listing page:

- The privacy policy: paste `docs/privacy.md` into the privacy policy field.
- The previews: `docs/images/hints.png`, `which-key.png`, `command-line.png` and `theme-switch.png` (1280x800), and `assets/promo/amo-listing.png`. Not `demo.gif`: previews are static images.

The source archive for the submit comes from `just source_archive`. Its `BUILD.md` is the root `BUILD.md` of this repository.
