import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { registry } from "../../src/shared/registry/builtin.ts";
import { create_registry } from "../../src/shared/registry/index.ts";

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

test("importing the registry index registers no command", () => {
  assert.equal(typeof create_registry, "function");
  assert.equal(registry.list().length, 0);
});
