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

// browser_module/sources/whichkey.js bundles these into chrome code, which has no page, no `browser` and another document.
for (const file of ["src/content/whichkey/render.ts", "src/content/whichkey/timer.ts"]) {
  test(`${file} reads no page or extension global`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(document|window|browser|chrome|globalThis|location)\./);
    assert.ok(source.split("\n").filter((line) => /^\s*import\b/.test(line)).every((line) => /^import type\b/.test(line) || /from "\.\/layout\.ts"/.test(line)), file);
  });
}
