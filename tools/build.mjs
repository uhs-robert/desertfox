import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { grey_svg } from "./grey_svg.mjs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use.
const MAX_BYTES = {
  "content.js": 16 * 1024,
  // 40 KB: hints.js loads on the first hint command, not on every page, and the filters keep growing it.
  "hints.js": 40 * 1024,
  "caret.js": 32 * 1024,
  "whichkey.js": 8 * 1024,
  "cmdline.js": 4 * 1024,
  "ui.js": 8 * 1024,
  "page.js": 4 * 1024,
  // 45 KB: the verbatim subject needs a lazy tokenizer and its completion path.
  "cmdline_page.js": 45 * 1024,
  "find_worker.js": 2 * 1024,
  "devtools.js": 2 * 1024,
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

// A property name that ends in `_` is internal to the extension's own scripts, and the build shortens it. One cache serves every build, so a name that crosses bundles (the bundle host API) gets the same short name in each. esbuild does not change the cache it is given. It returns the grown one, so `build_with_cache` passes that on to the next build. Never end a name in `_` when it crosses storage, a runtime message, the manifest, a DOM attribute, CSS, a page or browser API, or a file on disk.
let mangle_cache = {};
const common = { bundle: true, format: "iife", target: "firefox140", logLevel: "warning", mangleProps: /_$/ };
async function build_with_cache(options) {
  const result = await build({ ...common, ...options, mangleCache: mangle_cache });
  mangle_cache = result.mangleCache;
}

await build_with_cache({ entryPoints: { background: "src/background/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { help: "src/help/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { newtab: "src/newtab/main.ts" }, outdir: "dist", sourcemap: true });
await build_with_cache({ entryPoints: { popup: "src/popup/main.ts" }, outdir: "dist", sourcemap: true });
const minified_entries = {
  content: "src/content/main.ts",
  hints: "src/content/hints/main.ts",
  caret: "src/content/caret/main.ts",
  whichkey: "src/content/whichkey/main.ts",
  cmdline: "src/cmdline/host.ts",
  ui: "src/content/ui/main.ts",
  page: "src/content/page/main.ts",
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

const command_count = await write_commands_json("dist");

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
