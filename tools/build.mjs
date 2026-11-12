import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { grey_svg } from "./grey_svg.mjs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use.
const MAX_BYTES = {
  "content.js": 18.5 * 1024,
  // 46 KB: hints.js loads on the first hint command, not on every page. Cross-frame text mode (#536) and the per-site tracking strip (#538) pushed it past 44.5 KB, and the jump list's leave watch (`src/content/page/leave_watch.ts`, #523) past 45.5 KB.
  "hints.js": 46 * 1024,
  "caret.js": 32 * 1024,
  "whichkey.js": 8 * 1024,
  "cmdline.js": 4 * 1024,
  "ui.js": 8 * 1024,
  // 5.5 KB: the page copy reads the strip list and drops tracking parameters, and the jump list's leave watch (#523) records a single-page app's address change. The bundle loads on first use, not on every page.
  "page.js": 5.5 * 1024,
  "text.js": 4 * 1024,
  "editor.js": 5 * 1024, // 5 KB: CodeMirror, Ace and Monaco go through the clipboard. The bundle loads on first use.
  // 5.5 KB: the fullscreen key looks for the site player's own button, clicks its control and waits for the answer, and the captions and frame keys read the text tracks and step the time. The bundle loads on first use, not on every page.
  "media.js": 5.5 * 1024,
  // 4.5 KB: the YouTube driver gained the captions toggle and its state read. The bundle loads on first use.
  "quality.js": 4.5 * 1024,
  "site_actions.js": 4 * 1024,
  // 57 KB: the lazy bundle carries every setting's completion entry, and the bridge settings add to it. The verbatim subject needs a lazy tokenizer and its completion path. The key-capture matcher and the registry validator ship in this lazy bundle, and the registers and macros pieces add to them. The three editable_ settings add their completion entries and help text, and so does strip_tracking.
  "cmdline_page.js": 57 * 1024,
  "find_worker.js": 2 * 1024,
  "devtools.js": 2 * 1024,
};

// The content.js guard (its MAX_BYTES entry) may rise in steps, never past this. See AGENTS.md, "Content script size".
const CONTENT_CEILING_BYTES = 32 * 1024;
if (MAX_BYTES["content.js"] > CONTENT_CEILING_BYTES) {
  console.error(`the content.js guard of ${MAX_BYTES["content.js"]} bytes is over the ${CONTENT_CEILING_BYTES} byte ceiling`);
  process.exit(1);
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

// A property name that ends in `_` is internal to the extension's own scripts, and the build shortens it. One cache serves every build, so a name that crosses bundles (the bundle host API) gets the same short name in each. esbuild does not change the cache it is given. It returns the grown one, so `build_with_cache` passes that on to the next build. Never end a name in `_` when it crosses storage, a runtime message, the manifest, a DOM attribute, CSS, a page or browser API, or a file on disk.
let mangle_cache = {};
const common = { bundle: true, format: "iife", target: "firefox140", logLevel: "warning", mangleProps: /_$/ };
async function build_with_cache(options) {
  const result = await build({ ...common, ...options, mangleCache: mangle_cache });
  mangle_cache = result.mangleCache;
}

// content.js builds first, on the empty cache: esbuild gives the shortest names to the first build's most used names, so content.js then depends on its own source alone. Any build before it makes a bundle's edit move content.js's size.
const content_options = { entryPoints: { content: "src/content/main.ts" }, outdir: "dist", minify: true };
await build_with_cache(content_options);
await build_with_cache({ entryPoints: { background: "src/background/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { help: "src/help/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { newtab: "src/newtab/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { popup: "src/popup/main.ts" }, outdir: "dist", sourcemap: true });
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
  // Not loaded by the content script: the background injects it into every frame for each media command (background/media_actions.ts).
  media: "src/content/media/main.ts",
  // Injected the same way, for each quality request (background/quality_levels.ts).
  quality: "src/content/quality/main.ts",
  cmdline_page: "src/cmdline/page.ts",
  // Not an injected bundle: the background starts it as a Worker for each regex page search (find_scan.ts).
  find_worker: "src/background/find_worker.ts",
  // The page that DevTools loads in each toolbox (the manifest's `devtools_page`).
  devtools: "src/devtools/main.ts",
};
for (const [name, entry] of Object.entries(minified_entries)) {
  await build_with_cache({ entryPoints: { [name]: entry }, outdir: "dist", minify: true });
}

for (const file of ["manifest.json", "help/home.html", "newtab/newtab.html", "popup/popup.html", "cmdline/cmdline.html", "devtools/devtools.html"]) {
  await copyFile(`src/${file}`, `dist/${file.split("/").pop()}`);
}

// The font is copied as is with its licence: the licence reserves the name "DSEG", so a converted or edited font could not keep it.
for (const file of ["DSEG7Classic-Regular.ttf", "OFL-DSEG.txt"]) await copyFile(`src/newtab/fonts/${file}`, `dist/${file}`);

await mkdir("dist/icons", { recursive: true });
await copyFile("src/icons/desertfox.svg", "dist/icons/desertfox.svg");
await writeFile("dist/icons/desertfox-off.svg", grey_svg(await readFile("src/icons/desertfox.svg", "utf8")));
// The keycap mark lives with the docs images; the help welcome page shows it, so it ships from there.
await copyFile("docs/images/desertfox-keycap.svg", "dist/icons/desertfox-keycap.svg");

// A doc the renderer cannot read fails the build here, with the file and line.
const { parse_markdown } = await import("./render_docs.ts");
const guide_blocks = parse_markdown("docs/search_engines.md", await readFile("docs/search_engines.md", "utf8"));
await writeFile("dist/search_engines_guide.json", `${JSON.stringify(guide_blocks)}\n`);

// Rebuild content.js on an empty cache. A different result means something built before it.
const content_alone = await build({ ...common, ...content_options, write: false, mangleCache: {} });
if (!Buffer.from(content_alone.outputFiles[0].contents).equals(await readFile("dist/content.js"))) {
  console.error("dist/content.js differs from a build on an empty mangle cache: content.js must be the first build in tools/build.mjs");
  process.exit(1);
}

const command_count = await write_commands_json("dist");

// `just release_stamp` hashes the stamped hosts. The signed build carries those hashes, and a host updates only to files
// that match them. A build with no stamp of its own version carries none, so its hosts never update themselves.
const release_assets_dir = process.env.RELEASE_ASSETS_DIR || "release-assets";
const manifest_version = JSON.parse(await readFile("src/manifest.json", "utf8")).version;
const host_hashes_text = await readFile(`${release_assets_dir}/host_sha256.json`, "utf8").catch(() => null);
if (host_hashes_text !== null && JSON.parse(host_hashes_text).version === manifest_version) {
  await writeFile("dist/host_sha256.json", host_hashes_text);
}

const sizes = [];
let over_limit = false;
for (const [file, limit] of Object.entries(MAX_BYTES)) {
  const bytes = (await stat(`dist/${file}`)).size;
  sizes.push(`${file} ${bytes} of ${limit}`);
  if (bytes > limit) {
    console.error(`${file} is ${bytes} bytes minified, over the ${limit} byte limit`);
    over_limit = true;
  }
}
if (over_limit) process.exit(1);
console.log(`built dist/ (${command_count} commands, ${sizes.join(", ")} bytes)`);
