// Bundles each browser module source in browser_module/sources/ into its desertfox-*.js drop-in, with the src/shared code it imports.
// The output is committed: install.sh copies the drop-ins from the checkout and runs no node. test/tools/build_browser_module.test.ts fails when a committed file differs from a fresh build.
// Usage: node tools/build_browser_module.ts --write | --check

import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo_root = fileURLToPath(new URL("../", import.meta.url));
const module_dir = new URL("../browser_module/", import.meta.url);
export const BROWSER_MODULE_BUNDLES: readonly Bundle[] = [
  { source: "sources/commands.js", output: "desertfox-commands.js" },
  { source: "sources/whichkey.js", output: "desertfox-whichkey.js" },
];

const banner = (source: string) => `// Generated from browser_module/${source} by tools/build_browser_module.ts (just browser-module). Do not edit: change the source and build again.`;

// No minify and no property mangling: the file runs with browser privileges, so a user who installs it can read what it does.
type Bundle = { source: string; output: string };

export async function bundle_text({ source }: Bundle): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(source, module_dir))],
    // The path comments in the output are relative to this folder, so a build from any working folder gives the same file.
    absWorkingDir: repo_root,
    bundle: true,
    format: "iife",
    target: "firefox140",
    write: false,
    legalComments: "none",
    charset: "utf8",
    banner: { js: banner(source) },
    logLevel: "warning",
  });
  return result.outputFiles[0]!.text;
}

export const output_path = ({ output }: Bundle): string => fileURLToPath(new URL(output, module_dir));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  if (write === process.argv.includes("--check")) {
    console.error("usage: node tools/build_browser_module.ts --write | --check");
    process.exit(2);
  }
  let stale = false;
  for (const bundle of BROWSER_MODULE_BUNDLES) {
    const text = await bundle_text(bundle);
    if (existsSync(output_path(bundle)) && readFileSync(output_path(bundle), "utf8") === text) continue;
    if (write) writeFileSync(output_path(bundle), text);
    else {
      console.error(`browser_module/${bundle.output} is stale: run just browser-module`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
}
