import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the build ships page_base.css and both pages link it before any style", () => {
  assert.match(read("tools/build.mjs"), /copyFile\("src\/shared\/page_base\.css", "dist\/page_base\.css"\)/);
  for (const page of ["src/help/home.html", "src/newtab/newtab.html"]) {
    const html = read(page);
    const link = html.indexOf('<link rel="stylesheet" href="page_base.css">');
    assert.ok(link > 0, page);
    assert.ok(link < html.indexOf("<style>"), `${page} links the base before its own styles`);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="icons\/desertfox\.svg">/, page);
  }
});

test("the base declares each fallback at zero specificity so a theme always wins", () => {
  const css = read("src/shared/page_base.css");
  assert.ok(!/^:root/m.test(css), "every :root rule is wrapped in :where()");
  assert.match(css, /:where\(:root\)/);
});

test("every class the base defines is on the Styling page", async () => {
  const { STYLE_CLASSES } = await import("../src/help/model.ts");
  const listed = STYLE_CLASSES.map((entry) => entry.name);
  const defined = new Set(read("src/shared/page_base.css").match(/\.desertfox-[a-z-]+/g)!.map((name) => name.slice(1)));
  for (const name of defined) assert.ok(listed.includes(name), name);
});
