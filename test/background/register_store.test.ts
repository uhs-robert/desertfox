import assert from "node:assert/strict";
import { test } from "node:test";
import { answer_register_request, create_register_store, describe_value } from "../../src/background/register_store.ts";
import { wire_private_cleanup } from "../../src/background/store_turns.ts";
import type { RegisterArea } from "../../src/background/register_store.ts";
import { REGISTER_PRIVATE_STORAGE_PREFIX, REGISTER_STORAGE_PREFIX } from "../../src/background/storage_keys.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";

function fake_area(values = new Map<string, unknown>()) {
  const area = {
    get: async (keys?: string | string[] | null) => {
      const wanted = keys === null || keys === undefined ? [...values.keys()] : typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(wanted.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]));
    },
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => values.delete(key)),
  } as unknown as RegisterArea;
  return { area, values };
}

// One browser: a local area, a session area and a clipboard, which every store view below shares.
function make_browser() {
  const local = fake_area();
  const session = fake_area();
  const clipboard = { text: "", reads: 0, fail: false };
  const deps = {
    local: () => local.area,
    session: () => session.area,
    clipboard: {
      read: async () => {
        clipboard.reads += 1;
        if (clipboard.fail) throw new Error("denied");
        return clipboard.text;
      },
      write: async (text: string) => void (clipboard.text = text),
    },
  };
  return { local, session, clipboard, deps, store: create_register_store(deps) };
}

const step = (id: string): BoundInvocation => ({ id });

test("a named register reads back what was written, and an empty one reads as nothing", async () => {
  const { store, local } = make_browser();
  await store.write("a", "hello", false);
  assert.equal(await store.read("a", false), "hello");
  assert.equal(await store.read("b", false), undefined);
  assert.deepEqual([...local.values.keys()], [`${REGISTER_STORAGE_PREFIX}a`]);
});

test("an uppercase name appends to the lowercase register and reads it", async () => {
  const { store } = make_browser();
  await store.write("A", "one", false);
  await store.write("A", " two", false);
  assert.equal(await store.read("a", false), "one two");
  assert.equal(await store.read("A", false), "one two");
});

test("steps append to steps, and text and steps do not mix", async () => {
  const { store } = make_browser();
  await store.write("m", [step("scroll.top")], false);
  await store.write("M", [step("tab.next")], false);
  assert.deepEqual(await store.read("m", false), [step("scroll.top"), step("tab.next")]);
  await assert.rejects(store.write("M", "text", false), /holds a macro, so text cannot join it/);
  await store.write("t", "text", false);
  await assert.rejects(store.write("T", [step("tab.next")], false), /holds text, so steps cannot join it/);
  assert.equal(await store.read("t", false), "text");
});

test("the black hole keeps nothing and reads as nothing", async () => {
  const { store, local } = make_browser();
  await store.write("_", "gone", false);
  assert.equal(await store.read("_", false), undefined);
  assert.equal(local.values.size, 0);
});

test("the plus register reads and writes the system clipboard and stores nothing", async () => {
  const { store, local, session, clipboard } = make_browser();
  await store.write("+", "from a register", false);
  assert.equal(clipboard.text, "from a register");
  clipboard.text = "typed elsewhere";
  assert.equal(await store.read("+", false), "typed elsewhere");
  await store.write("+", "private text", true);
  assert.equal(clipboard.text, "private text");
  assert.equal(local.values.size + session.values.size, 0);
  await assert.rejects(store.write("+", [step("tab.next")], false), /text only/);
});

test("a clipboard the browser refuses fails the read and leaves the list without a plus row", async () => {
  const { store, clipboard } = make_browser();
  await store.write("a", "x", false);
  clipboard.fail = true;
  await assert.rejects(store.read("+", false), /denied/);
  assert.deepEqual(await store.items(false), [{ name: "a", description: "x" }]);
});

test("the unnamed register and the search registers store like a named one", async () => {
  const { store } = make_browser();
  await store.write('"', "yanked", false);
  await store.write("/", "needle", false);
  await store.write("/:direction", "back", false);
  assert.equal(await store.read('"', false), "yanked");
  assert.equal(await store.read("/", false), "needle");
  assert.equal(await store.read("/:direction", false), "back");
});

test("a name that is not a register refuses on read and write", async () => {
  const { store } = make_browser();
  for (const name of ["", "ab", "1", "@", "-", "//"]) {
    await assert.rejects(store.read(name, false), /No register named/);
    await assert.rejects(store.write(name, "x", false), /No register named/);
  }
});

test("a private window keeps its registers apart from the normal ones, in the session area", async () => {
  const { store, local, session } = make_browser();
  await store.write("a", "normal", false);
  await store.write("a", "private", true);
  assert.equal(await store.read("a", false), "normal");
  assert.equal(await store.read("a", true), "private");
  assert.deepEqual([...local.values.keys()], [`${REGISTER_STORAGE_PREFIX}a`]);
  assert.deepEqual([...session.values.keys()], [`${REGISTER_PRIVATE_STORAGE_PREFIX}a`]);
  await store.write("b", "only normal", false);
  assert.equal(await store.read("b", true), undefined);
  assert.deepEqual(await store.items(true), [{ name: "a", description: "private" }]);
});

test("closing the last private window drops the private registers and keeps the normal ones", async () => {
  const { store, session } = make_browser();
  session.values.set("desertfox_last_repeat_private", [step("tab.next")]);
  await store.write("a", "normal", false);
  await store.write("p", "private", true);
  let private_windows = 2;
  const has_private_window = async () => private_windows > 0;
  private_windows = 1;
  await store.clear_private_without_window(has_private_window);
  assert.equal(await store.read("p", true), "private");
  private_windows = 0;
  await store.clear_private_without_window(has_private_window);
  assert.equal(await store.read("p", true), undefined);
  assert.equal(await store.read("a", false), "normal");
  assert.deepEqual([...session.values.keys()], ["desertfox_last_repeat_private"]);
});

test("a store built later over the same storage sees what an earlier one wrote", async () => {
  const first = make_browser();
  await first.store.write("a", "kept", false);
  const second = create_register_store(first.deps);
  assert.equal(await second.read("a", false), "kept");
  await second.write("A", " more", false);
  assert.equal(await first.store.read("a", false), "kept more");
});

test("appends from two tabs at once both land", async () => {
  const { store } = make_browser();
  await Promise.all(["1", "2", "3", "4"].map((text) => store.write("A", text, false)));
  assert.equal((await store.read("a", false) as string).length, 4);
});

test("a failed write does not stop the writes after it", async () => {
  const { store } = make_browser();
  const failed = store.write("M", [step("x")], false).then(() => store.write("M", "text", false));
  await assert.rejects(failed, /holds a macro/);
  await store.write("b", "after", false);
  assert.equal(await store.read("b", false), "after");
});

test("a stored value of the wrong shape reads as empty", async () => {
  const { store, local } = make_browser();
  local.values.set(`${REGISTER_STORAGE_PREFIX}a`, { not: "a value" });
  local.values.set(`${REGISTER_STORAGE_PREFIX}b`, [{ no_id: true }]);
  assert.equal(await store.read("a", false), undefined);
  assert.equal(await store.read("b", false), undefined);
});

test("the list shows the unnamed, named and search registers in order, a macro as its step count, and the clipboard last", async () => {
  const { store, clipboard } = make_browser();
  await store.write("b", "two\n  lines", false);
  await store.write("a", [step("x"), step("y")], false);
  await store.write('"', "u".repeat(60), false);
  await store.write("/", "needle", false);
  clipboard.text = "clip";
  assert.deepEqual(await store.items(false), [
    { name: '"', description: `${"u".repeat(39)}…` },
    { name: "a", description: "2 steps" },
    { name: "b", description: "two lines" },
    { name: "/", description: "needle" },
    { name: "+", description: "clip" },
  ]);
  assert.equal(describe_value([step("x")]), "1 step");
});

test("a register message uses the sender tab's privacy, and only a tab may send one", async () => {
  const { store } = make_browser();
  await answer_register_request(store, { type: "register_write", name: "a", text: "private" }, { incognito: true });
  assert.equal(await answer_register_request(store, { type: "register_read", name: "a" }, { incognito: false }), undefined);
  assert.equal(await answer_register_request(store, { type: "register_read", name: "a" }, { incognito: true }), "private");
  assert.equal(await answer_register_request(store, { type: "register_read", name: "a" }, undefined), undefined);
  assert.deepEqual(await answer_register_request(store, { type: "register_write", name: "$", text: "x" }, { incognito: false }), { ok: false, message: "No register named $" });
  assert.deepEqual(await answer_register_request(store, { type: "register_write", name: "a", text: 5 as never }, { incognito: false }), { ok: false, message: "A register write needs text" });
});

test("a private write that lands while the window check runs survives the cleanup", async () => {
  const { store, session } = make_browser();
  let release!: () => void;
  const check_started = new Promise<void>((started) => {
    const cleanup = store.clear_private_without_window(async () => {
      started();
      await new Promise<void>((resume) => (release = resume));
      return false;
    });
    void cleanup.then(() => undefined);
  });
  await check_started;
  const write = store.write("p", "from a new window", true);
  release();
  await write;
  await store.clear_private_without_window(async () => true);
  assert.equal(await store.read("p", true), "from a new window");
  assert.ok(session.values.size > 0);
});

test("the cleanup runs at start and after each window closes, and a failure only warns", async () => {
  const { store } = make_browser();
  await store.write("p", "private", true);
  let listener: (() => void) | undefined;
  let windows = [{ incognito: true }];
  const warnings: unknown[][] = [];
  const original_warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    wire_private_cleanup([store], { onRemoved: { addListener: (fn) => void (listener = fn) }, getAll: async () => windows });
    await new Promise((resume) => setTimeout(resume, 0));
    assert.equal(await store.read("p", true), "private");
    windows = [{ incognito: false }];
    listener!();
    await new Promise((resume) => setTimeout(resume, 0));
    assert.equal(await store.read("p", true), undefined);
    windows = undefined as never;
    listener!();
    await new Promise((resume) => setTimeout(resume, 0));
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original_warn;
  }
});
