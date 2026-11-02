import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";

// Minified size limits. content.js loads on every page, so its limit is the tightest. The rest load on first use.
const MAX_BYTES = {
  "content.js": 15 * 1024,
  "hints.js": 24 * 1024,
  "caret.js": 24 * 1024,
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

for (const file of ["manifest.json", "managed_schema.json", "help/help.html", "options/options.html", "cmdline/cmdline.html"]) {
  await copyFile(`src/${file}`, `dist/${file.split("/").pop()}`);
}

await mkdir("dist/icons", { recursive: true });
await copyFile("src/icons/oasisfox.svg", "dist/icons/oasisfox.svg");

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
