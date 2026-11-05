import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use.
const MAX_BYTES = {
  "content.js": 16 * 1024,
  "hints.js": 24 * 1024,
  "caret.js": 30 * 1024,
  "whichkey.js": 8 * 1024,
  "cmdline.js": 4 * 1024,
  "ui.js": 8 * 1024,
  "cmdline_page.js": 48 * 1024,
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const common = { bundle: true, format: "iife", target: "firefox140", logLevel: "warning" };

await build({ ...common, entryPoints: { background: "src/background/main.ts" }, outdir: "dist", sourcemap: true });
await build({ ...common, entryPoints: { help: "src/help/main.ts" }, outdir: "dist", sourcemap: true });
await build({ ...common, entryPoints: { newtab: "src/newtab/main.ts" }, outdir: "dist", sourcemap: true });
await build({ ...common, entryPoints: { options: "src/options/main.ts" }, outdir: "dist", sourcemap: true });
const minified_entries = {
  content: "src/content/main.ts",
  hints: "src/content/hints/main.ts",
  caret: "src/content/caret/main.ts",
  whichkey: "src/content/whichkey/main.ts",
  cmdline: "src/cmdline/host.ts",
  ui: "src/content/ui/main.ts",
  cmdline_page: "src/cmdline/page.ts",
};
for (const [name, entry] of Object.entries(minified_entries)) {
  await build({ ...common, entryPoints: { [name]: entry }, outdir: "dist", minify: true });
}

for (const file of ["manifest.json", "managed_schema.json", "help/help.html", "options/options.html", "newtab/newtab.html", "cmdline/cmdline.html"]) {
  await copyFile(`src/${file}`, `dist/${file.split("/").pop()}`);
}

// The font is copied as is with its licence: the licence reserves the name "DSEG", so a converted or edited font could not keep it.
for (const file of ["DSEG7Classic-Regular.ttf", "OFL-DSEG.txt"]) await copyFile(`src/newtab/fonts/${file}`, `dist/${file}`);

await mkdir("dist/icons", { recursive: true });
await copyFile("src/icons/oasisfox.svg", "dist/icons/oasisfox.svg");

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
