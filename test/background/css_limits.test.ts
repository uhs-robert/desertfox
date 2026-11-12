import assert from "node:assert/strict";
import { test } from "node:test";
import { read_import_source } from "../../src/background/config_import.ts";
import { ConfigRefusal } from "../../src/background/config_reload.ts";
import { css_limit_breaches } from "../../src/background/css_limits.ts";
import { create_user_css_gate } from "../../src/help/user_css_gate.ts";
import { write_zip } from "../../src/shared/zip.ts";

const breaches_of = (css: string) => css_limit_breaches({ "style.css": css }).map(({ line, what }) => `${line} ${what}`);

test("css limits: @import, @font-face and a remote url() are named with their line", () => {
  assert.deepEqual(breaches_of('a { color: red }\n@import "https://x.test/a.css";'), ["2 @import"]);
  assert.deepEqual(breaches_of("\n\n@font-face { src: local(x) }"), ["3 @font-face"]);
  assert.deepEqual(breaches_of('a[href^="https://a.test"] {\n  background: url(https://x.test/?a)\n}'), ["2 url() that is not data:"]);
  assert.deepEqual(breaches_of('a { background: URL( "x.png" ) }'), ["1 url() that is not data:"]);
  assert.deepEqual(breaches_of('a { background: image-set(url(data:,x) 1x, "x.png" 2x) }'), ["1 image-set("]);
  assert.deepEqual(breaches_of('a { background: -webkit-image-set("data:,x" 1x) }'), ["1 image-set("]);
  assert.deepEqual(breaches_of('a { background: src("x.png") }'), ["1 src("]);
});

test("css limits: data: urls and plain rules pass", () => {
  assert.deepEqual(breaches_of('a { background: url(data:image/png;base64,AAAA) }\nb { background: url( "data:image/svg+xml,x" ) }'), []);
  assert.deepEqual(breaches_of("a { color: red; --x: 1 }"), []);
});

test("css limits: nothing hides a loader, not strings, comments, escapes or line breaks", () => {
  assert.deepEqual(breaches_of('a{content:"/*"} b{background:url(https://x.test/x)} c{content:"*/"}'), ["1 url() that is not data:"]);
  assert.deepEqual(breaches_of(".x\\/*{} a{background:url(https://x.test/x)} .y*/{}"), ["1 url() that is not data:"]);
  assert.deepEqual(breaches_of("/* @import x */ a { color: red }"), ["1 @import"]);
  assert.deepEqual(breaches_of("/* a\nb */ a { background: url(x.png) }"), ["2 url() that is not data:"]);
  assert.deepEqual(breaches_of("a { background: u\\72l(x.png) }"), ["1 url() that is not data:"]);
  assert.deepEqual(breaches_of("a { background: \\75 rl(x.png) }"), ["1 url() that is not data:"]);
  assert.deepEqual(breaches_of("a {}\r\nb {}\rc {}\fd { background: url(x.png) }"), ["4 url() that is not data:"]);
});

test("css limits: a 1 MB file with many breaches finishes fast", () => {
  const css = "a {}\nb { background: url(x.png) }\n".repeat(30_000);
  const started = performance.now();
  const found = css_limit_breaches({ "style.css": css });
  assert.equal(found.length, 30_000);
  assert.equal(found.at(-1)!.line, 60_000);
  assert.ok(performance.now() - started < 1000);
});

test("css limits: style.d files count, other files do not", () => {
  const found = css_limit_breaches({ "style.d/b.css": "@import 'x';", "snippets/a.js": "url(x)", "notes.txt": "@import" });
  assert.deepEqual(found, [{ file: "style.d/b.css", line: 1, what: "@import" }]);
});

test("an import refuses a style.css with a remote url(), naming file and line", async () => {
  const bytes = write_zip({ "settings.toml": 'hint_letters = "ab"\n', "style.css": "a { color: red }\nb { background: url(https://x.test/a.png) }\n" });
  await assert.rejects(read_import_source({ kind: "zip", bytes }), (error: unknown) => {
    assert.ok(error instanceof ConfigRefusal);
    assert.match(error.message, /^Config not imported, the current one stays\. style\.css line 2 holds url\(\) that is not data:/);
    return true;
  });
  const folder = { kind: "folder", entries: [{ path: "style.d/x.css", text: "@font-face { }" }] };
  await assert.rejects(read_import_source(folder), /style\.d\/x\.css line 1 holds @font-face/);
});

test("an import reads a style.css with data: urls", async () => {
  const files = await read_import_source({ kind: "folder", entries: [{ path: "style.css", text: "a { background: url(data:,x) }" }] });
  assert.deepEqual(Object.keys(files), ["style.css"]);
});

test("the user css gate holds while any consent view is held, also when the text is set meanwhile", () => {
  // Like a style element: setting the text makes a new, enabled sheet, and `media` stays.
  const sheet = { media: "", disabled: false, set text(_: string) { this.disabled = false; } };
  const set_held = create_user_css_gate(sheet);
  set_held("grant_panel", true);
  sheet.text = "a { color: red }";
  assert.equal(sheet.media, "not all");
  set_held("import_review", true);
  set_held("import_review", true);
  set_held("grant_panel", false);
  assert.equal(sheet.media, "not all");
  set_held("import_review", false);
  assert.equal(sheet.media, "");
});
