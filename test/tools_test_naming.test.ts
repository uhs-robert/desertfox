import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";

// Test files from before the rule that break it. The list only shrinks: rename or move a file and delete its entry.
const ALLOWED_MISFITS: string[] = [
  "amazon_row.test.ts",
  "arrow_mode.test.ts",
  "build_config_cli.test.ts",
  "bundle_handlers.test.ts",
  "capture_branch.test.ts",
  "contract.test.ts",
  "engine_keyword.test.ts",
  "examples_engines.test.ts",
  "fallback_engine.test.ts",
  "hint_modifiers.test.ts",
  "import_boundaries.test.ts",
  "integration_w4.test.ts",
  "key_param.test.ts",
  "lint_silent_catch.test.ts",
  "macro_keys.test.ts",
  "native_host_files.test.ts",
  "newtab.test.ts",
  "owner_test.test.ts",
  "register_prefix.test.ts",
  "run_content_failed_step.test.ts",
  "settings_contract.test.ts",
  "settings_follow.test.ts",
  "settings_prefixes.test.ts",
  "source_scan.test.ts",
  "style_purity.test.ts",
];

const root = new URL("../", import.meta.url);
const list = (dir: string) =>
  readdirSync(new URL(dir, root), { recursive: true, encoding: "utf8" });

// Names that say nothing about which source folder a test covers.
const NOT_FOLDER_NAMES = new Set(["test", "tests", "fixtures", "node_modules"]);
const directory_names = (top: string) =>
  readdirSync(new URL(top, root), { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.parentPath.includes("node_modules") &&
        !NOT_FOLDER_NAMES.has(entry.name),
    )
    .map((entry) => entry.name);
const folder_names = new Set([
  ...directory_names("src"),
  ...directory_names("tools"),
  "tools",
]);
// Harness folders that hold test files but are not source folders, so they never prefix a root name.
const SUBFOLDER_ONLY = new Set(["key", "support"]);
const source_stems = new Set(
  list("src")
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"))
    .map((path) => basename(path, ".ts")),
);

const test_files = list("test")
  .filter((path) => path.endsWith(".test.ts") && !path.startsWith("fixtures/"))
  .sort();

// Returns why a test path breaks the rule, or undefined when it follows it.
function naming_problem(
  path: string,
  folders = folder_names,
  stems = source_stems,
): string | undefined {
  const parts = path.split("/");
  if (parts.length > 1) {
    return folders.has(parts[0]!) || SUBFOLDER_ONLY.has(parts[0]!)
      ? undefined
      : `its folder test/${parts[0]}/ is not a directory name under src/ or tools/`;
  }
  const stem = path.slice(0, -".test.ts".length);
  if (stems.has(stem)) return undefined;
  if ([...folders].some((folder) => stem.startsWith(`${folder}_`)))
    return undefined;
  return "at test/ root its name is neither <folder>_<topic>.test.ts nor a src file stem";
}

const RULE =
  "Rule (AGENTS.md): a test file sits in test/<folder>/, or at test/ root as <folder>_<topic>.test.ts or named after a src file, where <folder> is a directory name under src/ or tools/ (or key, support as subfolders only).";

test("every test file follows the naming rule or is a listed misfit", () => {
  const broken = test_files
    .filter((path) => !ALLOWED_MISFITS.includes(path))
    .flatMap((path) => {
      const problem = naming_problem(path);
      return problem ? [`test/${path}: ${problem}`] : [];
    });
  assert.deepEqual(
    broken,
    [],
    `${RULE}\nThese test files break it. Rename or move them instead of listing them:\n${broken.join("\n")}`,
  );
});

test("the misfit list is sorted and plain names", () => {
  assert.deepEqual(ALLOWED_MISFITS, [...ALLOWED_MISFITS].sort());
  assert.ok(ALLOWED_MISFITS.every((name) => name.endsWith(".test.ts")));
});

test("every listed misfit still exists and still breaks the rule", () => {
  const stale = ALLOWED_MISFITS.filter(
    (path) =>
      !existsSync(new URL(`test/${path}`, root)) ||
      naming_problem(path) === undefined,
  );
  assert.deepEqual(
    stale,
    [],
    `These misfit entries are gone or now pass. Remove them from test/tools_test_naming.test.ts:\n${stale.join("\n")}`,
  );
});

test("the rule accepts and rejects each name shape", () => {
  const folders = new Set(["help"]);
  const stems = new Set(["align"]);
  const check = (path: string) => naming_problem(path, folders, stems);
  assert.equal(check("help/anything.test.ts"), undefined);
  assert.equal(check("help_sidebar.test.ts"), undefined);
  assert.equal(check("align.test.ts"), undefined);
  assert.ok(check("sidebar.test.ts"));
  assert.ok(check("helpful.test.ts"));
  assert.ok(check("nowhere/x.test.ts"));
  assert.equal(check("key/x.test.ts"), undefined);
  assert.equal(check("support/x.test.ts"), undefined);
  assert.ok(check("fixtures/x.test.ts"));
});
