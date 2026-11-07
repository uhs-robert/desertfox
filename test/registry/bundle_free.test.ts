import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Every entry except the background must stay free of the registry definer and the built-in singleton. Bundling the real entries catches every import path.
const ENTRIES_WITHOUT_REGISTRY = {
  content: "src/content/main.ts",
  hints: "src/content/hints/main.ts",
  caret: "src/content/caret/main.ts",
  whichkey: "src/content/whichkey/main.ts",
  cmdline: "src/cmdline/host.ts",
  ui: "src/content/ui/main.ts",
  cmdline_page: "src/cmdline/page.ts",
  find_worker: "src/background/find_worker.ts",
  help: "src/help/main.ts",
  newtab: "src/newtab/main.ts",
};

for (const [name, entry] of Object.entries(ENTRIES_WITHOUT_REGISTRY)) {
  test(`the ${name} bundle has no registry definer or built-in registry`, async () => {
    const result = await build({ bundle: true, format: "iife", target: "firefox140", logLevel: "silent", entryPoints: { [name]: entry }, write: false, metafile: true, minify: true, outdir: "dist" });
    const offenders = Object.keys(result.metafile.inputs).filter((path) => /registry\/(builtin|define)/.test(path));
    assert.deepEqual(offenders, []);
  });
}

// A one-line entry that takes a helper from the index. It must not pull in the definer, so the index must not run `create_registry` at import.
test("a helper import from the registry index keeps no registry definer in the output", async () => {
  const result = await build({ bundle: true, format: "iife", target: "firefox140", logLevel: "silent", stdin: { contents: 'import { tokenize } from "./src/shared/registry/index.ts"; console.log(tokenize);', resolveDir: "." }, write: false, metafile: true, minify: true, outdir: "dist" });
  // esbuild lists a tree-shaken re-export target in the inputs, so count the bytes that reach the output.
  const [output] = Object.values(result.metafile.outputs);
  assert.ok(output, "the bundle has an output");
  const offenders = Object.entries(output.inputs).filter(([path, used]) => used.bytesInOutput > 0 && /registry\/(builtin|define)/.test(path));
  assert.deepEqual(offenders, []);
});
