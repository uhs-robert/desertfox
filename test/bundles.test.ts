import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BUNDLE_FOR_MODE, BUNDLE_NAMES, is_bundle_name } from "../src/shared/bundles.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every bundle name has a build entry, a size limit and a source file", () => {
  const build = read("tools/build.mjs");
  const entries = Object.fromEntries([...build.matchAll(/^\s+(\w+): "(src\/[^"]+)",$/gm)].map((match) => [match[1], match[2]]));
  for (const name of BUNDLE_NAMES) {
    assert.ok(entries[name], `${name} has no entry in tools/build.mjs`);
    assert.ok(existsSync(new URL(`../${entries[name]}`, import.meta.url)), `${entries[name]} is missing`);
    assert.match(build, new RegExp(`"${name}\\.js": \\d+`), `${name}.js has no size limit`);
  }
  assert.ok(entries.cmdline_page && existsSync(new URL("../src/cmdline/cmdline.html", import.meta.url)));
});

test("the command line page can be framed by web pages", () => {
  assert.deepEqual(JSON.parse(read("src/manifest.json")).web_accessible_resources, ["cmdline.html"]);
});

test("each sink mode names a bundle and only real bundles load", () => {
  for (const name of Object.values(BUNDLE_FOR_MODE)) assert.ok(is_bundle_name(name));
  assert.deepEqual(Object.keys(BUNDLE_FOR_MODE).sort(), ["caret", "cmdline", "hint", "visual"]);
  assert.equal(is_bundle_name("../background"), false);
});
