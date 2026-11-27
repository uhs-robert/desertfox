import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { make_tmp_dir } from "../support/tmp_dir.ts";

const script = new URL("../../browser_module/install.sh", import.meta.url).pathname;
const module_dir = new URL("../../browser_module/", import.meta.url).pathname;
const module_names = readdirSync(module_dir).filter((name) => /^desertfox-[a-z0-9-]+\.js$/.test(name)).sort();

// A user namespace maps the test user to root, so the root checks pass on files the test owns, with no sudo.
const as_root = (firefox_dir: string, ...args: string[]) => as_root_with(firefox_dir, {}, ...args);
const as_root_with = (firefox_dir: string, env: Record<string, string>, ...args: string[]) =>
  spawnSync("unshare", ["-r", "bash", script, ...args], { env: { ...process.env, DESERTFOX_FIREFOX_DIR: firefox_dir, ...env }, encoding: "utf8" });
const as_user = (firefox_dir: string, ...args: string[]) => spawnSync("bash", [script, ...args], { env: { ...process.env, DESERTFOX_FIREFOX_DIR: firefox_dir }, encoding: "utf8" });

const namespaces_work = spawnSync("unshare", ["-r", "true"]).status === 0;

function firefox_dir_with_drop_ins(t: Parameters<typeof make_tmp_dir>[1]) {
  const dir = make_tmp_dir("desertfox-module-install-", t);
  mkdirSync(join(dir, "chrome.d"), { mode: 0o755 });
  writeFileSync(join(dir, "mozilla.cfg"), "// loader\n");
  return dir;
}

test("the folder holds the core and at least one feature file, and every feature sorts after the core", () => {
  assert.ok(module_names.includes("desertfox-browser.js"));
  assert.ok(module_names.length >= 2);
  assert.equal(module_names[0], "desertfox-browser.js", "a feature file that sorts before the core loads before the core exists");
});

test("install puts every module file in chrome.d as 0644, keeps other drop-ins and leaves mozilla.cfg alone", { skip: !namespaces_work }, (t) => {
  const dir = firefox_dir_with_drop_ins(t);
  writeFileSync(join(dir, "chrome.d", "bigicons.uc.js"), "// other\n");
  const result = as_root(dir);
  assert.equal(result.status, 0, result.stderr);
  for (const name of module_names) {
    assert.equal(readFileSync(join(dir, "chrome.d", name), "utf8"), readFileSync(join(module_dir, name), "utf8"));
  }
  assert.deepEqual(readdirSync(join(dir, "chrome.d")).sort(), ["bigicons.uc.js", ...module_names].sort());
  assert.equal(readFileSync(join(dir, "mozilla.cfg"), "utf8"), "// loader\n");
  assert.match(result.stdout, /desertfox\.browser_module\.enabled/);
});

test("install removes a module file the checkout no longer has, and uninstall removes only module files", { skip: !namespaces_work }, (t) => {
  const dir = firefox_dir_with_drop_ins(t);
  writeFileSync(join(dir, "chrome.d", "desertfox-old-feature.js"), "// gone\n");
  writeFileSync(join(dir, "chrome.d", "bigicons.uc.js"), "// other\n");
  assert.equal(as_root(dir).status, 0);
  assert.ok(!existsSync(join(dir, "chrome.d", "desertfox-old-feature.js")));
  const result = as_root(dir, "--uninstall");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(join(dir, "chrome.d")), ["bigicons.uc.js"]);
  assert.ok(existsSync(join(dir, "mozilla.cfg")));
});

test("install refuses a missing, linked or group-writable folder, and a run without root", { skip: !namespaces_work }, (t) => {
  const missing = make_tmp_dir("desertfox-module-install-", t);
  assert.match(as_root(missing).stderr, /chrome\.d is missing/);
  assert.ok(!existsSync(join(missing, "chrome.d")), "the script must never create the folder");

  const linked = make_tmp_dir("desertfox-module-install-", t);
  const elsewhere = make_tmp_dir("desertfox-module-install-", t);
  symlinkSync(elsewhere, join(linked, "chrome.d"));
  assert.match(as_root(linked).stderr, /not a real folder/);
  assert.deepEqual(readdirSync(elsewhere), []);

  const open = firefox_dir_with_drop_ins(t);
  chmodSync(join(open, "chrome.d"), 0o775);
  assert.match(as_root(open).stderr, /written by group or others/);
  assert.deepEqual(readdirSync(join(open, "chrome.d")), []);

  const plain = firefox_dir_with_drop_ins(t);
  const result = as_user(plain);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sudo/);
});

// In a user namespace every file the test can make belongs to root, so a `stat` ahead on PATH gives the folder another owner.
test("install refuses a folder that root does not own", { skip: !namespaces_work }, (t) => {
  const dir = firefox_dir_with_drop_ins(t);
  const shims = make_tmp_dir("desertfox-module-install-shims-", t);
  writeFileSync(join(shims, "stat"), `#!/usr/bin/env bash\nif [ "$1" = -c ] && [ "$2" = %u ]; then echo 1000; else exec /usr/bin/env -u PATH PATH=/usr/bin:/bin stat "$@"; fi\n`, { mode: 0o755 });
  const result = as_root_with(dir, { PATH: `${shims}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not owned by root/);
  assert.deepEqual(readdirSync(join(dir, "chrome.d")), []);
});

test("install refuses an unknown argument", { skip: !namespaces_work }, (t) => {
  const result = as_root(firefox_dir_with_drop_ins(t), "--force");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown argument/);
});
