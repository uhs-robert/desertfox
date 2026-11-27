import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BROWSER_MODULE_BUNDLES, bundle_text, output_path } from "../../tools/build_browser_module.ts";

// install.sh copies the committed drop-ins and builds nothing, so a source change (the matcher, the token, the tree check) reaches users only through a fresh build committed beside it.
test("every committed browser module bundle equals a fresh build of its source", async () => {
  for (const bundle of BROWSER_MODULE_BUNDLES) {
    assert.ok((await bundle_text(bundle)) === readFileSync(output_path(bundle), "utf8"), `browser_module/${bundle.output} is stale: run just browser-module`);
  }
});
