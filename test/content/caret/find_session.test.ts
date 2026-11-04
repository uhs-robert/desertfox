import assert from "node:assert/strict";
import { test } from "node:test";
import { create_find } from "../../../src/content/caret/find_session.ts";
import type { FindDeps } from "../../../src/content/caret/find_session.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

// A page of "ab ab ab": matches of "ab" start at 0, 3 and 6.
function fake_page() {
  const painted: { current: number; count: number }[] = [];
  const toasts: string[] = [];
  const registers = new Map<string, string>();
  const gates: (() => void)[] = [];
  let clears = 0;
  let selection = ["start"];
  let clock = 0;
  const make_model = (): TextModel =>
    ({ text: "ab ab ab", trees: [], point_at: (index: number) => ({ node: { index }, offset: 0 }), index_of: (node: { index: number }) => node.index }) as unknown as TextModel;
  const deps: FindDeps = {
    build_model: make_model,
    start_index: () => 0,
    painter: {
      paint: (_model, matches, current) => (painted.push({ current, count: matches.from.length }), 0),
      clear: () => void clears++,
    },
    scroll_to: () => {},
    read_colors: async () => ({ all: { dark: ["#1", "#2"], light: ["#1", "#2"] }, current: { dark: ["#1", "#2"], light: ["#1", "#2"] } }),
    get_register: async (name) => registers.get(name),
    set_register: async (name, text) => void registers.set(name, text),
    // Each match ends a slice, and the page runs only when the test lets the scan go on.
    slicing: (is_stale) => ({ is_stale, now: () => (clock += 10), slice_ms: 8, yield_to_page: () => new Promise<void>((resume) => gates.push(resume)) }),
    selection_key: () => selection,
  };
  const settle = async () => {
    for (let round = 0; round < 30; round++) {
      while (gates.length > 0) gates.shift()!();
      await new Promise((resume) => setImmediate(resume));
    }
  };
  return { deps, painted, toasts, registers, settle, clears: () => clears, set_selection: (next: string[]) => (selection = next), host: { show_toast: (message: string) => void toasts.push(message) } };
}

test("a search begun while Enter waits for the old scan keeps its own state", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  const ending = find.end(true);
  find.begin("forward");
  await page.settle();
  await ending;
  find.update("ab", () => {});
  await page.settle();
  assert.equal(page.painted.length > 0, true, "the new line found nothing");
  const before = page.clears();
  await find.end(false);
  assert.equal(page.clears(), before + 1, "Escape did not clear the highlights of the new line");
});

test("n right after Enter waits for the search to finish and then steps", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  void find.end(true);
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.deepEqual(page.toasts, ["2 of 3"]);
});

test("Escape clears the highlights, keeps the query and the match, and n goes on from it", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  const before = page.clears();
  await find.end(false);
  assert.equal(page.clears(), before + 1);
  assert.equal(page.registers.get("/"), "ab");
  assert.equal(page.registers.get("/:direction"), "forward");
  await find.step(false);
  assert.deepEqual(page.toasts, ["2 of 3"]);
  await find.step(true);
  assert.deepEqual(page.toasts, ["2 of 3", "1 of 3"]);
});

test("a caret session starts at the match until a later selection takes its place", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const model = page.deps.build_model();
  assert.equal(find.position(model), 0);
  page.set_selection(["clicked"]);
  assert.equal(find.position(model), undefined);
});

test("n with no search made answers failed and shows nothing itself", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  assert.deepEqual(await find.step(false), { ok: false, message: "No previous search" });
  assert.deepEqual(page.toasts, []);
});

test("n answers done on a match and failed when the last search has no match any more", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const found = find.step(false);
  await page.settle();
  assert.deepEqual(await found, { ok: true });
  page.registers.set("/", "zz");
  const lost = create_find(page.host, page.deps).step(false);
  await page.settle();
  assert.deepEqual(await lost, { ok: false, message: "Not found: zz" });
  assert.deepEqual(page.toasts, ["1 of 3"]);
});

test("a step that a newer one replaced answers cancelled", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const first = find.step(false);
  find.begin("forward");
  await page.settle();
  assert.deepEqual(await first, { ok: true, cancelled: true });
});

test("two quick n presses move two matches, even when the register still has to be read", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const first = find.step(false);
  const second = find.step(false);
  await page.settle();
  await Promise.all([first, second]);
  assert.deepEqual(page.toasts, ["1 of 3", "2 of 3"]);
});

test("a search that finds nothing, or ends with Escape, does not keep the old match as the position", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const model = page.deps.build_model();
  assert.equal(find.position(model), 0);
  find.begin("forward");
  find.update("zz", () => {});
  await page.settle();
  await find.end(false);
  assert.equal(find.position(model), undefined);
});
