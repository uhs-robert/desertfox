import { build } from "esbuild";
import { write_commands_json } from "./write_commands_json.mjs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";

const CONTENT_MAX_BYTES = 15 * 1024;

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const common = { bundle: true, format: "iife", target: "firefox140", logLevel: "warning" };

await build({ ...common, entryPoints: { background: "src/background/main.ts" }, outdir: "dist", sourcemap: true });
await build({ ...common, entryPoints: { help: "src/help/main.ts" }, outdir: "dist", sourcemap: true });
await build({ ...common, entryPoints: { content: "src/content/main.ts" }, outdir: "dist", minify: true });

for (const file of ["manifest.json", "managed_schema.json", "help/help.html"]) {
  await copyFile(`src/${file}`, `dist/${file.split("/").pop()}`);
}

const command_count = await write_commands_json("dist");

const content_bytes = (await stat("dist/content.js")).size;
if (content_bytes > CONTENT_MAX_BYTES) {
  console.error(`content.js is ${content_bytes} bytes minified, over the ${CONTENT_MAX_BYTES} byte limit`);
  process.exit(1);
}
console.log(`built dist/ (${command_count} commands, content.js ${content_bytes} of ${CONTENT_MAX_BYTES} bytes)`);
