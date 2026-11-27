import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { grey_svg } from "./grey_svg.mjs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { refused_as } from "../src/shared/swallow.ts";
import { BUNDLE_NAMES } from "../src/shared/bundles.ts";
import { CMDLINE_STYLE } from "../src/cmdline/style.ts";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use. Raise one only as AGENTS.md, "Content script size", says, and name the feature in the commit.
const MAX_BYTES = {
  // Key listener, prefix tree, modes and scrolling. Runs on every page and frame (admission rule in AGENTS.md, "Content script size").
  "content.js": 23 * 1024,
  // Link hints and the grab target pass. Loads on the first hint command, not on every page.
  "hints.js": 52.75 * 1024,
  // Caret and visual mode.
  "caret.js": 32 * 1024,
  // The which-key panel. Loads on a pause in a prefix.
  "whichkey.js": 9.5 * 1024,
  // The command line host in the page, and the remote end for a subframe. Loads on the first `:`.
  "cmdline.js": 7 * 1024,
  // The mode badge and the toast.
  "ui.js": 8 * 1024,
  // Rare page commands: scroll alignment, page copy, marks and the jump list.
  "page.js": 6 * 1024,
  // The typed-text recorder for `.`.
  "text.js": 4 * 1024,
  // The external editor hand-off and the clipboard fallback for code editors.
  "editor.js": 6.5 * 1024,
  // Media keys. The background injects it into each frame.
  "media.js": 6.5 * 1024,
  // The media quality driver, injected on demand.
  "quality.js": 5 * 1024,
  // The only script the media_quality rule injects into every frame, so it stays small.
  "quality_probe.js": 2.5 * 1024,
  // Handlers of commands that site rows bind to keys.
  "site_actions.js": 4 * 1024,
  // Item mode and the item finder behind `page.item`. Loads on the first j or k on a list page.
  "item.js": 25.75 * 1024,
  // Item actions (Space, Enter) in item mode.
  "item_act.js": 4 * 1024,
  // page.tree and the fold keys. Loads on the first press.
  "tree.js": 5 * 1024,
  // page.follow (]] and [[). Loads on the first press.
  "next_page.js": 20 * 1024,
  // Keyboard drag.
  "grab.js": 6.5 * 1024,
  // The command line page: completion for every setting, the registry validator, and the key-capture matcher. Opened by the first `:`.
  "cmdline_page.js": 62 * 1024,
  // The regex page search Worker.
  "find_worker.js": 2 * 1024,
  // The history rank Worker. Loads once per background start, never in a page.
  "rank_worker.js": 11.5 * 1024,
  // The devtools page.
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
// The on-demand bundles come first, in BUNDLE_NAMES order: the shared mangle cache makes build order change bytes. A bundle's entry is src/content/<name>/main.ts. The command line host is the one exception.
const bundle_entries = Object.fromEntries(BUNDLE_NAMES.map((name) => [name, name === "cmdline" ? "src/cmdline/host.ts" : `src/content/${name}/main.ts`]));
const minified_entries = {
  ...bundle_entries,
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
// The command line's sheet lives in style.ts so another host can import it; the page gets it at the marker.
const cmdline_html = (await readFile("src/cmdline/cmdline.html", "utf8")).replace("<!--cmdline-style-->", () => `<style>${CMDLINE_STYLE}    </style>`);
await writeFile(`${out_dir}/cmdline.html`, cmdline_html);

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
