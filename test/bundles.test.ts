import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { release_options } from "./support/metafile.ts";
import { BUNDLE_FOR_MODE, BUNDLE_NAMES, is_bundle_name } from "../src/shared/bundles.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// A bundle is src/content/<name>/main.ts and tools/build.mjs derives its entry from BUNDLE_NAMES. These two folders hold a main.ts and are injected by the background, not loaded through the bundle host.
const BACKGROUND_INJECTED = ["media", "quality"];
const entry_of = (name: string) => (name === "cmdline" ? "src/cmdline/host.ts" : `src/content/${name}/main.ts`);

test("every bundle name has a source file and a size limit", () => {
  const build_script = read("tools/build.mjs");
  for (const name of BUNDLE_NAMES) {
    assert.ok(existsSync(new URL(`../${entry_of(name)}`, import.meta.url)), `${entry_of(name)} is missing`);
    assert.match(build_script, new RegExp(`"${name}\\.js": \\d+`), `${name}.js has no size limit`);
  }
  assert.ok(existsSync(new URL("../src/cmdline/cmdline.html", import.meta.url)));
});

test("a folder under src/content with a main.ts is a bundle name or injected by the background", () => {
  const folders = readdirSync(new URL("../src/content", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`../src/content/${entry.name}/main.ts`, import.meta.url)))
    .map((entry) => entry.name);
  const known = [...BUNDLE_NAMES, ...BACKGROUND_INJECTED] as string[];
  for (const folder of folders) assert.ok(known.includes(folder), `src/content/${folder}/main.ts is not in BUNDLE_NAMES; add it, or list it as injected by the background`);
});

test("the command line page can be framed by web pages", () => {
  assert.deepEqual(JSON.parse(read("src/manifest.json")).web_accessible_resources, ["cmdline.html"]);
});

test("each sink mode names a bundle and only real bundles load", () => {
  for (const name of Object.values(BUNDLE_FOR_MODE)) assert.ok(is_bundle_name(name));
  assert.deepEqual(Object.keys(BUNDLE_FOR_MODE).sort(), ["caret", "cmdline", "grab", "hint", "tab_visual", "visual", "visual_line"]);
  assert.equal(is_bundle_name("../background"), false);
});

test("the manifest CSP keeps scripts, fonts and sheets local and blocks remote images and allows remote fetches", () => {
  const policy = JSON.parse(read("src/manifest.json")).content_security_policy as string;
  const directives = Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["font-src"], ["'self'"]);
  assert.deepEqual(directives["worker-src"], ["'self'"]);
  assert.deepEqual(directives["style-src"], ["'self'", "'unsafe-inline'"]);
  // Only the image copy and the weather fetch reach remote hosts, and they use fetch.
  assert.ok(!directives["img-src"]!.some((source: string) => source === "https:" || source === "http:"));
  assert.ok(directives["img-src"]!.includes("data:"));
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
      const result = await build(release_options({ [name]: entry }, key_test));
      return result.outputFiles[0]!.text;
    };
    const attribute = attributes[name as keyof typeof attributes];
    const release = await bundle_with(false);
    for (const named of ["data-desertfox-mode", "data-desertfox-whichkey", "data-desertfox-tree-read-ms"]) assert.ok(!release.includes(named), `the release ${name}.js holds ${named}`);
    assert.ok((await bundle_with(true)).includes(attribute), `the key-test ${name}.js lacks ${attribute}`);
  }
});
