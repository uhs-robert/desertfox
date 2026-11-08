import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const areas_module_path = join(import.meta.dirname, "areas.mjs");
const { area_names, area_rules, areas_of_file, read_piece_areas, select_pieces } = await import(areas_module_path);

const src_files: string[] = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: join(import.meta.dirname, "..", "..") })
  .split("\n")
  .filter(Boolean);

test("every src file matches an area rule", () => {
  const unplaced = src_files.filter((path) => areas_of_file(path) === null);
  assert.deepEqual(unplaced, [], "add a glob to area_rules in test/key/areas.mjs for each of these files");
});

test("every rule names known areas", () => {
  for (const rule of area_rules) for (const area of rule.areas) assert.ok(area_names.includes(area), `unknown area ${area}`);
});

test("every piece exports a non-empty list of known areas",  () => {
  const piece_areas: Map<string, string[]> = read_piece_areas();
  assert.ok(piece_areas.size > 0);
  for (const [name, areas] of piece_areas) {
    assert.ok(Array.isArray(areas) && areas.length > 0, `${name} must export a non-empty areas`);
    for (const area of areas) assert.ok(area_names.includes(area), `${name} lists unknown area ${area}`);
  }
});

test("every area has a rule and a piece", () => {
  const piece_areas: Map<string, string[]> = read_piece_areas();
  for (const area of area_names) {
    assert.ok(src_files.some((path) => areas_of_file(path)?.length === 1 && areas_of_file(path)[0] === area), `no src file maps to only ${area}`);
    assert.ok([...piece_areas.values()].some((areas) => areas.includes(area)), `no piece lists ${area}`);
  }
});

test("a shared file selects every piece, a docs file none, a missing src change none", () => {
  const piece_areas: Map<string, string[]> = read_piece_areas();
  assert.equal(select_pieces(["src/background/main.ts"], piece_areas).pieces.length, piece_areas.size);
  assert.deepEqual(select_pieces(["src/help/README.md"], piece_areas).pieces, []);
  assert.deepEqual(select_pieces(["docs/design.md"], piece_areas).pieces, []);
  assert.ok(select_pieces(["src/content/hints/labels.ts"], piece_areas).pieces.includes("p5_hints"));
  assert.equal(select_pieces(["src/manifest.json"], piece_areas).pieces.length, piece_areas.size);
  assert.equal(select_pieces(["test/key/harness.mjs"], piece_areas).pieces.length, piece_areas.size);
  assert.equal(select_pieces(["tools/build.mjs"], piece_areas).pieces.length, piece_areas.size);
  assert.deepEqual(select_pieces(["test/key/p7_caret.mjs"], piece_areas).pieces, ["p7_caret"]);
});
