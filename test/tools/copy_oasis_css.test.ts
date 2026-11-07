import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { LIGHT_INTENSITIES } from "../../src/shared/theme/roles.ts";

const script = fileURLToPath(new URL("../../tools/copy_oasis_css.ts", import.meta.url));
const THEME_COUNT = 16;

function temp_dir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A checkout holding `theme_count` themes, each with one dark file and one file per light intensity. File names carry the folder because the tool flattens them into one directory.
function make_checkout(t: TestContext, theme_count: number): string {
  const root = temp_dir(t, "desertfox-oasis-src-");
  const themes = join(root, "extras", "css", "themes");
  for (const folder of ["dark", ...LIGHT_INTENSITIES.map((intensity) => join("light", String(intensity)))]) {
    mkdirSync(join(themes, folder), { recursive: true });
    for (let n = 0; n < theme_count; n++) writeFileSync(join(themes, folder, `oasis_t${n}_${folder.replace("/", "_")}.css`), `/* ${folder} ${n} */\n:root { --x: ${n}; }\r\n`);
  }
  return root;
}

function run(checkout: string, out: string) {
  return spawnSync(process.execPath, ["--no-warnings", script, checkout, "--out", out], { encoding: "utf8" });
}

test("a checkout with a short file count copies nothing and exits 1", (t) => {
  const out = temp_dir(t, "desertfox-oasis-out-");
  const result = run(make_checkout(t, THEME_COUNT - 1), out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected/);
  assert.deepEqual(readdirSync(out), []);
});

test("a CSS file upstream dropped is removed from the output and other files are kept", (t) => {
  const out = temp_dir(t, "desertfox-oasis-out-");
  writeFileSync(join(out, "oasis_gone.css"), "stale");
  writeFileSync(join(out, "notes.txt"), "keep");
  assert.equal(run(make_checkout(t, THEME_COUNT), out).status, 0);
  const names = readdirSync(out);
  assert.equal(names.includes("oasis_gone.css"), false);
  assert.equal(names.includes("notes.txt"), true);
});

test("each copied file matches its source byte for byte", (t) => {
  const checkout = make_checkout(t, THEME_COUNT);
  const out = temp_dir(t, "desertfox-oasis-out-");
  assert.equal(run(checkout, out).status, 0);
  const source = readFileSync(join(checkout, "extras", "css", "themes", "dark", "oasis_t3_dark.css"));
  assert.deepEqual(readFileSync(join(out, "oasis_t3_dark.css")), source);
});

test("--out with no value fails with the usage message and copies nothing", (t) => {
  const checkout = make_checkout(t, THEME_COUNT);
  const result = spawnSync(process.execPath, ["--no-warnings", script, checkout, "--out"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/);
});
