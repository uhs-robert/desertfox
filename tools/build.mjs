import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { grey_svg } from "./grey_svg.mjs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { refused_as } from "../src/shared/swallow.ts";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use.
const MAX_BYTES = {
  // 20 KB (admission clause A, it runs before the first key): the layout fallback reads a letter of another script by its physical key. The proxy that holds a plain NORMAL badge until the load event (clause C) took it past 19.5 KB.
  // 20.5 KB (clause A, it decides what happens to a key): a site row bind's focus guard picks the bind or the leaf it replaced (`leaf_for_focus`), for the Maps row's hjkl.
  // 21 KB (clause A, it decides what happens to a key): a site mode with the `sticky` flag keeps running through a mouse press and a key the page keeps, and a toggle of `mode.site` leaves a text field and the mode it came from before it starts the mode.
  // 21.5 KB (clause A, it decides what happens to a key): a site row bind's `when_present` guard and its choices pick the leaf a key runs (`leaf_for_page`), reading which matches the page shows (`is_shown`), for gg and G on every page.item row.
  "content.js": 21.5 * 1024,
  // 49 KB: hints.js loads on the first hint command, not on every page. Cross-frame text mode (#536) and the per-site tracking strip (#538) pushed it past 44.5 KB, and the jump list's leave watch (`src/content/page/leave_watch.ts`, #523) past 45.5 KB, and the key hand-off across frames (#521) past 46 KB. Together with the leave watch's same-document exit (#547) it passed 46.5 KB. Rect-first collect (`collect` with `only_in_view`) passed 47 KB. The `draggable` filter (grab group selector and cursor test) passed 47.5 KB. The draggable filter's touch-action sign and the eight resize cursors (#630) passed 48 KB. The three newtab_weather settings add their default values, which every bundle that imports the defaults carries.
  // 50.5 KB: the `drop` filter of the grab target pass (`drop_targets.ts`, the Tab widen key and the fallback) passed 49 KB.
  // 50.75 KB: the review fixes of the `drop` filter (shadow-root climb, tag escape, warn_and_go) passed 50.5 KB.
  // 51.75 KB: raised by 1 KB ahead of the next change to the file, with no feature behind it.
  "hints.js": 51.75 * 1024,
  "caret.js": 32 * 1024,
  // 8.5 KB: a panel for a subframe's keys relays to the top frame (`relay.ts`, the draw and erase handlers and the `relayed_panel` guard). The bundle loads on a pause in a prefix, not on every page.
  // 9 KB: the top frame keeps its own panel when a subframe's late erase arrives (`relayed_panel.ts`, #619).
  "whichkey.js": 9 * 1024,
  // 7 KB: the line opens in the top frame for a subframe's keys, which takes the subframe's end (keys sent up, the focus and the late keys taken back) and the top frame's handlers. The subframe also hides its focus loss from the page while the line is open (#634), so a popup that closes on blur stays open. The bundle loads on the first `:`, not on every page.
  "cmdline.js": 7 * 1024,
  "ui.js": 8 * 1024,
  // 6 KB: the page copy reads the strip list and drops tracking parameters, and the jump list's leave watch (#523) records a single-page app's address change. `scroll.align` reads the heading jump and aligns its frame chain. The bundle loads on first use, not on every page.
  "page.js": 6 * 1024,
  "text.js": 4 * 1024,
  "editor.js": 6.5 * 1024, // 6.5 KB: the clipboard fallback for CodeMirror, Ace and Monaco, with its copy checks and paste read-back. The bundle loads on first use.
  // 6.5 KB: the fullscreen key looks for the site player's own button, clicks its control and waits for the answer, the captions and frame keys read the text tracks and step the time, and the volume and play keys go through the YouTube player (#632, #656). The bundle loads on first use, not on every page.
  "media.js": 6.5 * 1024,
  // 5 KB: the YouTube driver gained the captions toggle and its state read, and the rule answers a frame without a video by waiting for a media event and looking again for 10 s, inside open shadow roots too. The bundle loads on first use.
  "quality.js": 5 * 1024,
  // 2.5 KB: the probe queues a report asked for while another is out. It is the only script the media_quality rule injects into every frame, so it stays small. The names of the plain HTML elements, which the custom-element search for a video in shadow roots leaves out, are most of it.
  "quality_probe.js": 2.5 * 1024,
  "site_actions.js": 4 * 1024,
  // 4.5 KB: page.item, the box it draws around a result (search-site-rows), and the last move that ]] reads to put the box on the first item a load added. The bundle loads on the first j or k on a result page.
  "item.js": 4.5 * 1024,
  // 18.5 KB: page.follow (]] and [[): the detector with its next pass and load step, the load words in nine languages, the collect walk and the click it borrows from the hints code, the wait for loaded content (one load at a time, none counted after the page hides), and the move of the item box to the first item a load added.
  // 19 KB: the load step also takes a role-less div with its own pointer cursor and a load word, and the item box move stops when the user pressed a key, used the wheel or pointer or hid the tab. The bundle loads on the first ]] or [[.
  "next_page.js": 19 * 1024,
  // 6.5 KB: the thumb press point, the per-drag step keys (`[` and `]`), the swipe fling (`snap_scroll`, `start_fling`) and the start step read from `grab_step_px`.
  "grab.js": 6.5 * 1024,
  // 59 KB: the lazy bundle carries every setting's completion entry, and the bridge settings add to it. The verbatim subject needs a lazy tokenizer and its completion path. The key-capture matcher and the registry validator ship in this lazy bundle, and the registers and macros pieces add to them. The three editable_ settings add their completion entries and help text, and so does strip_tracking. The grab_step_px setting adds its completion entry, and so do the five newtab_closed_tabs, newtab_closed_tabs_max, newtab_top_sites, newtab_top_sites_max and newtab_command_hint settings, and the three newtab_weather settings. `set theme` also offers the theme files and imports of the config, which the page gets when the line opens.
  // 59.5 KB: the lists that rank the history come ranked from the background over a port (`ranked_client.ts`), the finder merges its tab rows into them, and keys that act on the list wait for rows on their way.
  // 60 KB: behind a key that waits for rows, the page looks up each later key in the keymap, so only typed keys and row keys wait in order and every other key acts at once. A failed answer reads as empty for its word without being kept.
  // 60.5 KB: the font_family, font_family_mono and font_scale settings add their completion entries.
  // 61 KB: the site_rules setting accepts the keymap column, and its check reads the key clash between bind and keymap.normal.
  "cmdline_page.js": 61 * 1024,
  "find_worker.js": 2 * 1024,
  // 10.5 KB: the Worker holds the history cache and builds and ranks the rows of `open`, `history` and the finder. It loads once per background start, never in a page.
  // 11 KB: the Worker also answers `usage_for` (the bookmark list's use boosts) and `pick_history` (Enter on `history <text>`), so the background no longer copies the 20000 rows.
  "rank_worker.js": 11 * 1024,
  "devtools.js": 2 * 1024,
};

// The content.js guard (its MAX_BYTES entry) may rise in steps, never past this. See AGENTS.md, "Content script size".
const CONTENT_CEILING_BYTES = 32 * 1024;
if (MAX_BYTES["content.js"] > CONTENT_CEILING_BYTES) {
  console.error(`the content.js guard of ${MAX_BYTES["content.js"]} bytes is over the ${CONTENT_CEILING_BYTES} byte ceiling`);
  process.exit(1);
}

// KEY_TEST_BUILD=1 builds the extension the key test loads into dist-key-test/. It defines `__KEY_TEST__`, which turns on the page-readable test attributes (src/shared/key_test_build.ts). The release build never carries them, so the size guards below measure the release only.
const key_test_build = process.env.KEY_TEST_BUILD === "1";
const out_dir = key_test_build ? "dist-key-test" : "dist";
const common = { bundle: true, format: "iife", target: "firefox140", logLevel: "warning", mangleProps: /_$/, define: { __KEY_TEST__: String(key_test_build) } };
await rm(out_dir, { recursive: true, force: true });
await mkdir(out_dir, { recursive: true });

// A property name that ends in `_` is internal to the extension's own scripts, and the build shortens it. One cache serves every build, so a name that crosses bundles (the bundle host API) gets the same short name in each. esbuild does not change the cache it is given. It returns the grown one, so `build_with_cache` passes that on to the next build. Never end a name in `_` when it crosses storage, a runtime message, the manifest, a DOM attribute, CSS, a page or browser API, or a file on disk.
let mangle_cache = {};
async function build_with_cache(options) {
  const result = await build({ ...common, ...options, mangleCache: mangle_cache });
  mangle_cache = result.mangleCache;
}

// content.js builds first, on the empty cache: esbuild gives the shortest names to the first build's most used names, so content.js then depends on its own source alone. Any build before it makes a bundle's edit move content.js's size.
const content_options = { entryPoints: { content: "src/content/main.ts" }, outdir: out_dir, minify: true };
await build_with_cache(content_options);
await build_with_cache({ entryPoints: { background: "src/background/main.ts" }, outdir: out_dir, minify: true, sourcemap: true });
await build_with_cache({ entryPoints: { help: "src/help/main.ts" }, outdir: out_dir, minify: true, sourcemap: true });
await build_with_cache({ entryPoints: { newtab: "src/newtab/main.ts" }, outdir: out_dir, minify: true, sourcemap: true });
await build_with_cache({ entryPoints: { popup: "src/popup/main.ts" }, outdir: out_dir, minify: true, sourcemap: true });
const minified_entries = {
  hints: "src/content/hints/main.ts",
  caret: "src/content/caret/main.ts",
  whichkey: "src/content/whichkey/main.ts",
  cmdline: "src/cmdline/host.ts",
  ui: "src/content/ui/main.ts",
  page: "src/content/page/main.ts",
  text: "src/content/text/main.ts",
  editor: "src/content/editor/main.ts",
  site_actions: "src/content/site_actions/main.ts",
  grab: "src/content/grab/main.ts",
  item: "src/content/item/main.ts",
  next_page: "src/content/next_page/main.ts",
  // Not loaded by the content script: the background injects it into every frame for each media command (background/media_actions.ts).
  media: "src/content/media/main.ts",
  // Injected the same way, for each quality request and into each frame whose probe found a video (background/quality_levels.ts).
  quality: "src/content/quality/main.ts",
  // Injected into every frame at each navigation by the media_quality rule (background/media_quality.ts).
  quality_probe: "src/content/quality/probe_main.ts",
  cmdline_page: "src/cmdline/page.ts",
  // Not an injected bundle: the background starts it as a Worker for each regex page search (find_scan.ts).
  find_worker: "src/background/find_worker.ts",
  // Started the same way, once, to hold the history and rank the lists of `open`, `history` and the finder (rank_service.ts).
  rank_worker: "src/background/rank_worker.ts",
  // The page that DevTools loads in each toolbox (the manifest's `devtools_page`).
  devtools: "src/devtools/main.ts",
};
for (const [name, entry] of Object.entries(minified_entries)) {
  await build_with_cache({ entryPoints: { [name]: entry }, outdir: out_dir, minify: true });
}

for (const file of ["manifest.json", "help/home.html", "newtab/newtab.html", "popup/popup.html", "cmdline/cmdline.html", "devtools/devtools.html"]) {
  await copyFile(`src/${file}`, `${out_dir}/${file.split("/").pop()}`);
}

// The shared base sheet of the help and new tab pages, linked by both.
await copyFile("src/shared/page_base.css", `${out_dir}/page_base.css`);

// The font is copied as is with its licence: the licence reserves the name "DSEG", so a converted or edited font could not keep it.
for (const file of ["DSEG7Classic-Regular.ttf", "OFL-DSEG.txt"]) await copyFile(`src/newtab/fonts/${file}`, `${out_dir}/${file}`);

// The theme colors ship compiled into themes.ts, so the credits and the Apache-2.0 text (section 4(a)) travel with the package.
for (const file of ["NOTICE.md", "LICENSE-Apache-2.0.txt"]) await copyFile(`themes/${file}`, `${out_dir}/${file}`);

await mkdir(`${out_dir}/icons`, { recursive: true });
await copyFile("src/icons/desertfox.svg", `${out_dir}/icons/desertfox.svg`);
await writeFile(`${out_dir}/icons/desertfox-off.svg`, grey_svg(await readFile("src/icons/desertfox.svg", "utf8")));
// The keycap mark lives with the docs images; the help welcome page shows it, so it ships from there.
await copyFile("docs/images/desertfox-keycap.svg", `${out_dir}/icons/desertfox-keycap.svg`);

// The sample engines the Search engines section adds in one click. The background fetches this copy.
await copyFile("examples/engines.toml", `${out_dir}/starter_engines.toml`);

// A doc the renderer cannot read fails the build here, with the file and line.
const { parse_markdown } = await import("./render_docs.ts");
const guide_blocks = parse_markdown("docs/search_engines.md", await readFile("docs/search_engines.md", "utf8"));
await writeFile(`${out_dir}/search_engines_guide.json`, `${JSON.stringify(guide_blocks)}\n`);

// Rebuild content.js on an empty cache. A different result means something built before it.
const content_alone = await build({ ...common, ...content_options, write: false, mangleCache: {} });
if (!Buffer.from(content_alone.outputFiles[0].contents).equals(await readFile(`${out_dir}/content.js`))) {
  console.error(`${out_dir}/content.js differs from a build on an empty mangle cache: content.js must be the first build in tools/build.mjs`);
  process.exit(1);
}

const command_count = await write_commands_json(out_dir);

// `just release_stamp` hashes the stamped hosts. The signed build carries those hashes, and a host updates only to files
// that match them. A build with no stamp of its own version carries none, so its hosts never update themselves.
const release_assets_dir = process.env.RELEASE_ASSETS_DIR || "release-assets";
const manifest_version = JSON.parse(await readFile("src/manifest.json", "utf8")).version;
const host_hashes_text = await refused_as(readFile(`${release_assets_dir}/host_sha256.json`, "utf8"), null);
if (host_hashes_text !== null && JSON.parse(host_hashes_text).version === manifest_version) {
  await writeFile(`${out_dir}/host_sha256.json`, host_hashes_text);
}

if (key_test_build) {
  console.log(`built ${out_dir}/ (${command_count} commands, key-test build, no size guards)`);
  process.exit(0);
}
const sizes = [];
let over_limit = false;
for (const [file, limit] of Object.entries(MAX_BYTES)) {
  const bytes = (await stat(`${out_dir}/${file}`)).size;
  sizes.push(`${file} ${bytes} of ${limit}`);
  if (bytes > limit) {
    console.error(`${file} is ${bytes} bytes minified, over the ${limit} byte limit`);
    over_limit = true;
  }
}
if (over_limit) process.exit(1);
console.log(`built ${out_dir}/ (${command_count} commands, ${sizes.join(", ")} bytes)`);
