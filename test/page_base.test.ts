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

test("the help page keeps a 16px root and sets its font through the token a theme can replace", () => {
  const html = read("src/help/home.html");
  assert.match(html, /html \{[^}]*font-size: 16px/);
  const rule = /\n  \.desertfox-help \{([^}]*)\}/.exec(html)![1]!;
  assert.match(rule, /--desertfox-font: 0\.9375rem\/1\.5 system-ui, sans-serif;/);
  assert.match(rule, /font: var\(--desertfox-font\);/);
  assert.ok(!/(^|[\s;])font-size:/.test(rule), "a font-size longhand would beat the theme's --desertfox-font");
});

test("every control rule sits entirely in :where(), and the key capture box is covered", () => {
  const html = read("src/help/home.html");
  assert.match(html, /:where\(\.desertfox-help-page :is\([^\n]*, \.desertfox-settings-input\)\)/, "the capture box is a div with the input class, so the input rule must name that class");
  for (const state of ["button", "button:hover:not(:disabled)", "button:disabled"]) assert.ok(html.includes(`:where(.desertfox-help-page ${state}) {`), state);
  assert.ok(!/:where\(\.desertfox-help-page\) button/.test(html), "a selector part outside :where() would beat class rules");
});

test("heading sizes follow the body size", () => {
  const html = read("src/help/home.html");
  for (const level of ["h1", "h2", "h3"]) assert.match(html, new RegExp(`\\.desertfox-help ${level} \\{[^}]*font-size: [\\d.]+em`), level);
});
