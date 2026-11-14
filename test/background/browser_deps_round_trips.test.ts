import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepeatMemory } from "../../src/background/repeat_memory.ts";
import type { MergedConfig } from "../../src/shared/config.ts";

type Change = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

// The calls the router makes to the browser, a window of three tabs, and the one `storage.onChanged` listener the module registers when it loads.
const calls: string[] = [];
const listeners: Change[] = [];
let stored_disabled: boolean | undefined;
const tabs = [0, 1, 2].map((index) => ({ id: 10 + index, index, windowId: 1, active: index === 0, url: `https://site${index}.test/` }));

(globalThis as unknown as { browser: unknown }).browser = {
  storage: {
    local: {
      get: async (key: string) => (calls.push(`storage.get ${key}`), stored_disabled === undefined ? {} : { [key]: stored_disabled }),
      set: async () => undefined,
      remove: async () => undefined,
    },
    session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: (listener: Change) => void listeners.push(listener) },
  },
  tabs: {
    get: async (id: number) => (calls.push("tabs.get"), tabs.find((tab) => tab.id === id)),
    query: async () => (calls.push("tabs.query"), tabs),
    update: async (id: number) => void calls.push(`tabs.update ${id}`),
  },
  contextualIdentities: { query: async () => (calls.push("contextualIdentities.query"), [{ name: "Work", cookieStoreId: "c1" }]) },
  runtime: { onMessage: { addListener() {} }, getURL: (path: string) => `moz-extension://test/${path}` },
};

// Imported after the stub, because browser_deps picks its storage source when it loads.
await import("../../src/background/command_modules.ts");
const { make_router_deps } = await import("../../src/background/browser_deps.ts");
const { create_router } = await import("../../src/background/router.ts");
const { DISABLED_STORAGE_KEY } = await import("../../src/background/storage_keys.ts");
const { registry } = await import("../../src/shared/registry/builtin.ts");

const memory: RepeatMemory = { save: async () => undefined, load: async () => undefined };
const config = async () => ({ search_engines: {}, settings: {} }) as unknown as MergedConfig;
const router = create_router(make_router_deps(config, memory));
const run = (id: string, args?: Record<string, unknown>) => router.run({ invocations: [{ id, ...(args && { args }) }], mode: "normal", sender_tab_id: 10 });
const set_disabled = (value: boolean | undefined) => {
  listeners.forEach((listener) => listener({ [DISABLED_STORAGE_KEY]: { newValue: value } }, "local"));
};
const count = (name: string) => calls.filter((call) => call === name).length;

test("tab.next and tab.prev switch tabs, wrapping, with one tab read and no container query", async () => {
  calls.length = 0;
  assert.deepEqual(await run("tab.next"), { ok: true });
  assert.deepEqual(await run("tab.prev"), { ok: true });
  assert.equal(count("tabs.update 11"), 1);
  assert.equal(count("tabs.update 12"), 1);
  assert.equal(count("tabs.get"), 2);
  assert.equal(count("contextualIdentities.query"), 0);
});

test("the off flag is read from storage once, then follows storage.onChanged on and off", async () => {
  calls.length = 0;
  assert.equal((await run("tab.next")).ok, true);
  assert.equal((await run("tab.next")).ok, true);
  assert.equal(count(`storage.get ${DISABLED_STORAGE_KEY}`) <= 1, true);

  set_disabled(true);
  calls.length = 0;
  const refused = await run("tab.next");
  assert.deepEqual(refused, { ok: false, refusal: { id: "desertfox.off", message: "DesertFox is off" } });
  assert.equal(count("tabs.update 11"), 0);
  assert.equal(count(`storage.get ${DISABLED_STORAGE_KEY}`), 0);

  // Turning it on removes the key, so the event carries no new value.
  set_disabled(undefined);
  assert.deepEqual(await run("tab.next"), { ok: true });
  assert.equal(count(`storage.get ${DISABLED_STORAGE_KEY}`), 0);
});

test("a change for another key or area leaves the off flag alone", async () => {
  set_disabled(true);
  listeners.forEach((listener) => listener({ [DISABLED_STORAGE_KEY]: { newValue: false } }, "sync"));
  listeners.forEach((listener) => listener({ other: { newValue: false } }, "local"));
  assert.equal((await run("tab.next")).ok, false);
  set_disabled(undefined);
});

test("a command with a container param still gets the containers", async () => {
  calls.length = 0;
  const sources = make_router_deps(config, memory).get_enum_sources;
  assert.deepEqual((await sources(registry.get("open.url")!)).containers, ["Work"]);
  assert.equal(count("contextualIdentities.query"), 1);
  assert.deepEqual((await sources()).containers, ["Work"]);
  assert.equal((await sources(registry.get("tab.next")!)).containers, undefined);
  assert.equal(count("contextualIdentities.query"), 2);
});
