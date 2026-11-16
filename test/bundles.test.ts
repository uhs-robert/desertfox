import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
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
  assert.deepEqual(Object.keys(BUNDLE_FOR_MODE).sort(), ["caret", "cmdline", "grab", "hint", "visual", "visual_line"]);
  assert.equal(is_bundle_name("../background"), false);
});

test("the manifest CSP keeps scripts, fonts and sheets local and allows remote images and fetches", () => {
  const policy = JSON.parse(read("src/manifest.json")).content_security_policy as string;
  const directives = Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["font-src"], ["'self'"]);
  assert.deepEqual(directives["worker-src"], ["'self'"]);
  assert.deepEqual(directives["style-src"], ["'self'", "'unsafe-inline'"]);
  // Favicons, the image copy and the weather fetch reach remote hosts. The docs state this gap.
  assert.ok(directives["img-src"]!.includes("https:"));
  assert.ok(directives["connect-src"]!.includes("https:"));
  assert.ok(!policy.includes("unsafe-eval"));
});

test("the release bundles hold none of the page-readable test attributes, and the key-test build holds them", async () => {
  // The test builds with its own esbuild call, not tools/build.mjs: that script clears dist/ and dist-key-test/, which a key test may be using. So pin the define it passes.
  assert.match(read("tools/build.mjs"), /define: \{ __KEY_TEST__: String\(key_test_build\) \}/);
  assert.match(read("tools/build.mjs"), /key_test_build = process\.env\.KEY_TEST_BUILD === "1"/);
  const entries = { content: "src/content/main.ts", whichkey: "src/content/whichkey/main.ts", ui: "src/content/ui/main.ts" };
  const attributes = { content: "data-desertfox-tree-read-ms", whichkey: "data-desertfox-whichkey", ui: "data-desertfox-mode" };
  for (const [name, entry] of Object.entries(entries)) {
    const bundle_with = async (key_test: boolean) => {
      const result = await build({ bundle: true, format: "iife", target: "firefox140", logLevel: "silent", entryPoints: { [name]: entry }, write: false, minify: true, define: { __KEY_TEST__: String(key_test) } });
      return result.outputFiles[0]!.text;
    };
    const attribute = attributes[name as keyof typeof attributes];
    const release = await bundle_with(false);
    for (const named of ["data-desertfox-mode", "data-desertfox-whichkey", "data-desertfox-tree-read-ms"]) assert.ok(!release.includes(named), `the release ${name}.js holds ${named}`);
    assert.ok((await bundle_with(true)).includes(attribute), `the key-test ${name}.js lacks ${attribute}`);
  }
});
