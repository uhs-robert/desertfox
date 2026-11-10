import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { list_keys } from "../../src/background/list_keys.ts";
import { answer_mark_request, create_mark_store } from "../../src/background/mark_store.ts";
import { wire_private_cleanup } from "../../src/background/store_turns.ts";
import type { MarkArea } from "../../src/background/mark_store.ts";
import { MARK_PRIVATE_STORAGE_KEY, MARK_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { MAX_MARK_PAGES } from "../../src/shared/mark_names.ts";
import type { MarkRequest } from "../../src/shared/messages.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

function fake_area(delay = false) {
  const values = new Map<string, unknown>();
  // A slow read lets a second write start before the first one ends, which only a queue keeps in order.
  const tick = () => (delay ? new Promise((resolve) => setTimeout(resolve, 1)) : Promise.resolve());
  const area = {
    get: async (keys: string) => (await tick(), Object.fromEntries([keys].flat().filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]))),
    set: async (items: Record<string, unknown>) => (await tick(), void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value)))),
    remove: async (keys: string) => void [keys].flat().forEach((key) => values.delete(key)),
  } as unknown as MarkArea;
  return { area, values };
}

function make(delay = false) {
  const local = fake_area(delay);
  const session = fake_area(delay);
  let clock = 0;
  return { local, session, store: create_mark_store({ local: () => local.area, session: () => session.area, now: () => ++clock }) };
}

const no_global = async () => ({ ok: true as const });
const set = (key: string, y: number, url = "https://a.test/p", x = 0): MarkRequest => ({ type: "mark_set", key, url, x, y });
const jump = (key: string, y: number, url = "https://a.test/p", x = 0): MarkRequest => ({ type: "mark_jump", key, url, x, y });

test("a set and a jump read the position back, and the hash is not part of the page", async () => {
  const { store } = make();
  await store.run(set("a", 120.4), false);
  assert.deepEqual(await store.run(jump("a", 900, "https://a.test/p#section"), false), { ok: true, x: 0, y: 120 });
});

test("a jump to a missing mark refuses and stores nothing", async () => {
  const { store, local } = make();
  await assert.rejects(store.run(jump("z", 5), false), /No mark z/);
  assert.equal(local.values.size, 0);
});

test("a jump keeps the position it left as the previous one, so two jumps to the previous mark toggle", async () => {
  const { store } = make();
  await store.run(set("a", 100), false);
  await store.run(jump("a", 700), false);
  assert.deepEqual(await store.run(jump("'", 100), false), { ok: true, x: 0, y: 700 });
  assert.deepEqual(await store.run(jump("`", 700), false), { ok: true, x: 0, y: 100 });
  assert.deepEqual(await store.run(jump("'", 100), false), { ok: true, x: 0, y: 700 });
});

test("only a jump sets the previous position, and a set cannot name it", async () => {
  const { store } = make();
  await store.run(set("a", 100), false);
  await assert.rejects(store.run(jump("'", 5), false), /No mark '/);
  await assert.rejects(store.run(set("'", 5), false), /a to z and A to Z/);
  await assert.rejects(store.run(set("1", 5), false), /a to z and A to Z/);
});

test("rapid sets from several tabs all land, in order", async () => {
  const { store } = make(true);
  await Promise.all("abcdefghij".split("").map((key, index) => store.run(set(key, index * 10, "https://a.test/p"), false)));
  await Promise.all(["x", "y"].map((key) => store.run(set(key, 1, "https://b.test/q"), false)));
  assert.deepEqual((await store.items("https://a.test/p", false)).map((item) => item.key), "abcdefghij".split(""));
  assert.deepEqual((await store.items("https://b.test/q", false)).map((item) => item.key), ["x", "y"]);
});

test("a failed write does not block the next one", async () => {
  const { store } = make();
  await assert.rejects(store.run(set("a", Number.NaN), false));
  await store.run(set("a", 3), false);
  assert.equal((await store.items("https://a.test/p", false))[0]?.y, 3);
});

test("a private window keeps its marks in the session area and never touches the local one", async () => {
  const { store, local, session } = make();
  await store.run(set("a", 50), true);
  assert.deepEqual([...local.values.keys()], []);
  assert.deepEqual([...session.values.keys()], [MARK_PRIVATE_STORAGE_KEY]);
  await assert.rejects(store.run(jump("a", 0), false), /No mark a/);
  assert.deepEqual(await store.items("https://a.test/p", false), []);
  await store.run(set("b", 60), false);
  assert.deepEqual([...local.values.keys()], [MARK_STORAGE_KEY]);
  assert.deepEqual((await store.items("https://a.test/p", true)).map((item) => item.key), ["a"]);
});

test("cleanup drops the private marks only when no private window is open", async () => {
  const { store, local, session } = make();
  await store.run(set("a", 50), true);
  await store.run(set("a", 50), false);
  await store.clear_private_without_window(async () => true);
  assert.equal(session.values.size, 1);
  await store.clear_private_without_window(async () => false);
  assert.equal(session.values.size, 0);
  assert.equal(local.values.size, 1);
});

test("the wiring cleans at start and when a window closes", async () => {
  const { store, session } = make();
  await store.run(set("a", 50), true);
  let on_removed = () => {};
  let private_open = true;
  wire_private_cleanup([store], { onRemoved: { addListener: (listener) => void (on_removed = listener) }, getAll: async () => [{ incognito: private_open }] });
  await store.clear_private_without_window(async () => true);
  assert.equal(session.values.size, 1);
  private_open = false;
  on_removed();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.values.size, 0);
});

test("past 500 pages a new page drops the page written longest ago, and a write refreshes its page", async () => {
  const { store, local } = make();
  for (let index = 0; index < MAX_MARK_PAGES; index++) await store.run(set("a", index, `https://a.test/${index}`), false);
  await store.run(set("b", 1, "https://a.test/0"), false);
  await store.run(set("a", 1, "https://a.test/new"), false);
  const pages = Object.keys((local.values.get(MARK_STORAGE_KEY) as { pages: object }).pages);
  assert.equal(pages.length, MAX_MARK_PAGES);
  assert.ok(pages.includes("https://a.test/0"));
  assert.ok(!pages.includes("https://a.test/1"));
});

test("an address over 2048 characters refuses, and the hash does not count", async () => {
  const { store } = make();
  await assert.rejects(store.run(set("a", 1, `https://a.test/${"x".repeat(2048)}`), false), /too long/);
  await store.run(set("a", 1, `https://a.test/${"x".repeat(2000)}#${"h".repeat(500)}`), false);
});

test("a damaged stored value reads as no marks", async () => {
  const { store, local } = make();
  local.values.set(MARK_STORAGE_KEY, { v: 2, pages: 7 });
  assert.deepEqual(await store.items("https://a.test/p", false), []);
  await store.run(set("a", 1), false);
  assert.equal((await store.items("https://a.test/p", false)).length, 1);
});

test("the answer takes its privacy from the sender tab, and a message with no tab is refused", async () => {
  const { store, local, session } = make();
  assert.deepEqual(await answer_mark_request(store, set("a", 1), { incognito: true }, no_global), { ok: true, x: 0, y: 1 });
  assert.equal(local.values.size, 0);
  assert.equal(session.values.size, 1);
  assert.equal((await answer_mark_request(store, set("a", 1), undefined, no_global)).ok, false);
  assert.deepEqual(await answer_mark_request(store, jump("q", 1), { incognito: false }, no_global), { ok: false, message: "No mark q" });
});

function normal_keymap(default_keymap: object = DEFAULT_KEYMAP) {
  const { compiled } = compile_config({ config: { ...empty_config() }, default_keymap: default_keymap as never, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  return { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never;
}

test("the default keys capture one key after m, a quote and a backtick", () => {
  const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  for (const [key, id] of [["m", "mark.add"], ["'", "mark.jump"], ["`", "mark.jump"]] as const) {
    const branch = compiled.modes.normal!.children[key];
    assert.equal(branch?.kind, "branch", key);
    const leaf = branch?.kind === "branch" ? branch.children[""] : undefined;
    assert.equal(leaf?.kind === "leaf" && leaf.steps[0]!.invocation.id, id, key);
  }
});

test("which-key lists the page's marks with their offsets, and keeps the <key> row for a page with none", async () => {
  const items = async () => [
    { key: "'", x: 0, y: 30 },
    { key: "b", x: 0, y: 1240 },
    { key: "a", x: 15, y: 7 },
  ];
  const rows = async (prefix: string[], marks = items) => (await list_keys(normal_keymap(), () => undefined, { mode: "normal", prefix }, undefined, [], undefined, marks)).rows;
  assert.deepEqual(await rows(["'"]), [
    { keys: "a", command: "x 15 y 7", description: "", more: false },
    { keys: "b", command: "y 1240", description: "", more: false },
    { keys: "'", command: "y 30", description: "", more: false },
  ]);
  assert.deepEqual((await rows(["m"])).map((row) => row.keys), ["a", "b"]);
  assert.deepEqual((await rows(["`"])).map((row) => row.keys), ["a", "b", "'"]);
  assert.deepEqual((await rows(["m"], async () => [])).map((row) => row.keys), ["<key>"]);
  assert.deepEqual((await rows(["m"], async () => Promise.reject(new Error("x")))).map((row) => row.keys), ["<key>"]);
  assert.ok((await rows(["g"])).length > 1);
});

test("a user binding of m to another command keeps its own tree", async () => {
  const keymap = normal_keymap({ ...DEFAULT_KEYMAP, normal: { ...(DEFAULT_KEYMAP as { normal: object }).normal, m: { id: "tab.next" } } });
  const panel = await list_keys(keymap, () => undefined, { mode: "normal", prefix: ["m"] }, undefined, [], undefined, async () => [{ key: "a", x: 0, y: 1 }]);
  assert.deepEqual(panel.rows, []);
});

test("a value stored before global marks has no globals and keeps its local marks", async () => {
  const { store, local } = make();
  local.values.set(MARK_STORAGE_KEY, { v: 1, pages: { "https://a.test/p": { at: 3, marks: { a: [0, 80] } } } });
  assert.deepEqual(await store.run(jump("a", 5), false), { ok: true, x: 0, y: 80 });
  assert.equal(await store.global_of("A", false), undefined);
  await store.run(set("A", 9, "https://b.test/q"), false);
  assert.deepEqual(await store.global_of("A", false), { url: "https://b.test/q", x: 0, y: 9 });
  assert.deepEqual(await store.run(jump("a", 5), false), { ok: true, x: 0, y: 80 });
});

test("a damaged globals field reads the whole value as damaged", async () => {
  const { store, local } = make();
  local.values.set(MARK_STORAGE_KEY, { v: 1, pages: {}, globals: { A: { url: 3 } } });
  assert.equal(await store.global_of("A", false), undefined);
});

test("a global mark keeps its address and position, and a set of the same key replaces it", async () => {
  const { store } = make();
  assert.deepEqual(await store.run(set("A", 120.4, "https://a.test/p#frag", 7), false), { ok: true, x: 7, y: 120 });
  assert.deepEqual(await store.global_of("A", false), { url: "https://a.test/p", x: 7, y: 120 });
  await store.run(set("A", 5, "https://b.test/"), false);
  assert.deepEqual(await store.global_of("A", false), { url: "https://b.test/", x: 0, y: 5 });
  await assert.rejects(store.run(set("A", 1, `https://a.test/${"x".repeat(2048)}`), false), /too long/);
});

test("a global jump answers the stored position and keeps the page's previous position", async () => {
  const { store } = make();
  await store.run(set("A", 300, "https://a.test/p"), false);
  assert.deepEqual(await store.run(jump("A", 40, "https://c.test/other"), false), { ok: true, x: 0, y: 300 });
  assert.deepEqual(await store.run(jump("'", 0, "https://c.test/other"), false), { ok: true, x: 0, y: 40 });
  await assert.rejects(store.run(jump("B", 0), false), /No mark B/);
});

test("normal and private global marks are two sets", async () => {
  const { store, local, session } = make();
  await store.run(set("A", 50, "https://a.test/p"), true);
  assert.deepEqual([...local.values.keys()], []);
  assert.deepEqual([...session.values.keys()], [MARK_PRIVATE_STORAGE_KEY]);
  assert.equal(await store.global_of("A", false), undefined);
  await assert.rejects(store.run(jump("A", 0), false), /No mark A/);
  await store.run(set("B", 60, "https://b.test/"), false);
  assert.equal(await store.global_of("B", true), undefined);
  assert.deepEqual((await store.items("https://z.test/", true)).map((item) => item.key), ["A"]);
  await store.clear_private_without_window(async () => false);
  assert.equal(await store.global_of("A", true), undefined);
  assert.deepEqual(await store.global_of("B", false), { url: "https://b.test/", x: 0, y: 60 });
});

test("items list the page's marks first, then the global marks with their address", async () => {
  const { store } = make();
  await store.run(set("b", 2, "https://a.test/p"), false);
  await store.run(set("a", 1, "https://a.test/p"), false);
  await store.run(set("Z", 9, "https://z.test/"), false);
  await store.run(set("A", 8, "https://a.test/other"), false);
  assert.deepEqual(await store.items("https://a.test/p", false), [
    { key: "a", x: 0, y: 1 },
    { key: "b", x: 0, y: 2 },
    { key: "A", x: 0, y: 8, url: "https://a.test/other" },
    { key: "Z", x: 0, y: 9, url: "https://z.test/" },
  ]);
});

const top_tab = { incognito: false, id: 4, window_id: 1, url: "https://a.test/p#x", frame_id: 0 };

test("a global set takes the tab's address from the tab, never from the page", async () => {
  const { store } = make();
  assert.deepEqual(await answer_mark_request(store, set("A", 5, "https://frame.test/"), top_tab, no_global), { ok: true, x: 0, y: 5 });
  assert.equal((await store.global_of("A", false))?.url, "https://a.test/p");
});

test("a global set from a frame, or on a page that is not http or https, is refused", async () => {
  const { store, local } = make();
  assert.deepEqual(await answer_mark_request(store, set("A", 5), { ...top_tab, frame_id: 3 }, no_global), { ok: false, message: "Global marks need the top frame" });
  for (const url of ["file:///tmp/a.html", "about:blank", "moz-extension://x/help.html", undefined]) {
    assert.deepEqual(await answer_mark_request(store, set("A", 5), { ...top_tab, url }, no_global), { ok: false, message: "Global marks need a web page" }, String(url));
  }
  assert.equal(local.values.size, 0);
});

test("a global jump goes through the global jump, and a local key does not", async () => {
  const { store } = make();
  const seen: string[] = [];
  const global_jump = async (request: { key: string }) => (seen.push(request.key), { ok: true as const });
  assert.deepEqual(await answer_mark_request(store, jump("A", 1), top_tab, global_jump), { ok: true });
  assert.deepEqual(await answer_mark_request(store, jump("a", 1), top_tab, global_jump), { ok: false, message: "No mark a" });
  assert.deepEqual(seen, ["A"]);
});

test("which-key lists the page's marks, then the global marks with the address and the offset", async () => {
  const items = async () => [
    { key: "b", x: 0, y: 1240 },
    { key: "a", x: 15, y: 7 },
    { key: "B", x: 0, y: 5, url: "https://www.example.org/a/very/long/path/that/goes/on/and/on" },
    { key: "A", x: 0, y: 6, url: "http://github.com/foo/bar" },
  ];
  const { rows } = await list_keys(normal_keymap(), () => undefined, { mode: "normal", prefix: ["'"] }, undefined, [], undefined, items);
  assert.deepEqual(rows.map((row) => row.keys), ["a", "b", "A", "B"]);
  assert.equal(rows[2]!.command, "github.com/foo/bar  y 6");
  assert.equal(rows[3]!.command, "www.example.org/a/very/long/path/th\u2026  y 5");
});

test("m accepts a capital letter and refuses a digit", async () => {
  const { store } = make();
  await store.run(set("Q", 1), false);
  await assert.rejects(store.run(set("1", 1), false), /a to z/);
});
