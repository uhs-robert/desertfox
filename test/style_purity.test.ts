import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// DesertBird vendors these files, so they may import nothing from the browser, the DOM or the extension.
const SHARED_STYLE_FILES = ["src/cmdline/style.ts", "src/content/whichkey/style.ts", "src/content/whichkey/layout.ts"];

for (const file of SHARED_STYLE_FILES) {
  test(`${file} has no imports and no browser or DOM use`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /^\s*import\b/m);
    assert.doesNotMatch(source, /\b(document|window|browser|chrome|globalThis)\./);
  });
}

test("the command line page keeps its sheet marker for the build", () => {
  const html = readFileSync(new URL("../src/cmdline/cmdline.html", import.meta.url), "utf8");
  assert.equal(html.split("<!--cmdline-style-->").length, 2);
});
