import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_PROTOCOL_VERSION as V, MESSAGE_MIN_GAP_MS } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";

const PDF = "https://example.org/paper.pdf";

// main.ts loads against a browser whose storage holds data and whose tab 7 shows a PDF. The push goes through the wiring main.ts builds between `send_to_tab`, the rpc and the base channel.
async function locked_tab_env() {
  const session = new Map<string, unknown>();
  const local = new Map<string, unknown>();
  const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
  const area_of = (data: Map<string, unknown>, name: string) => ({
    get: async (key: string | string[] | null) => Object.fromEntries([...data].filter(([name_in]) => key === null || [key].flat().includes(name_in))),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      for (const listener of listeners) listener(Object.fromEntries(Object.keys(items).map((key) => [key, { newValue: items[key] }])), name);
    },
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  });
  const tab = { id: 7, url: PDF, index: 0, highlighted: false, active: true, pinned: false, incognito: false };
  const quiet = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_target, name) => (typeof name === "symbol" || name === "then" ? undefined : quiet(`${path}.${String(name)}`)),
      apply: () => (/(query|getAll|getAllFrames|search|getTopSites|getVisits|getRecentlyClosed)$/.test(path) ? Promise.resolve([]) : /\.(set|remove|clear)$/.test(path) ? Promise.resolve() : Promise.resolve(undefined)),
    });
  const overrides: Record<string, unknown> = {
    "storage.session": area_of(session, "session"),
    "storage.local": area_of(local, "local"),
    "storage.onChanged": { addListener: (listener: (typeof listeners)[number]) => listeners.push(listener) },
    "tabs.get": async () => tab,
    "tabs.query": async () => [tab],
    "tabs.sendMessage": async () => Promise.reject(new Error("Could not establish connection")),
    "runtime.getManifest": () => ({ version: "test", web_accessible_resources: [], browser_action: {}, commands: {} }),
    "runtime.getURL": () => "moz-extension://test/",
    "runtime.sendNativeMessage": () => Promise.reject(new Error("no host")),
  };
  const lookup = (path: string): unknown => (path in overrides ? overrides[path] : new Proxy(function () {}, { get: (_t, name) => (typeof name === "symbol" || name === "then" ? undefined : lookup(`${path}.${String(name)}`)), apply: (_t, _this, args) => (quiet(path) as (...a: unknown[]) => unknown)(...args) }));
  Object.assign(globalThis, { browser: new Proxy({}, { get: (_t, name) => (typeof name === "string" ? lookup(name) : undefined) }) });
  const real_set_timeout = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => real_set_timeout(...args).unref()) as typeof setTimeout;
  await import("../../src/background/main.ts");
  const { send_to_tab } = await import("../../src/background/browser_deps.ts");
  const settle = async () => {
    // The module reads its list at most once per MESSAGE_MIN_GAP_MS, on the real clock here.
    await new Promise((resolve) => real_set_timeout(resolve, 3 * MESSAGE_MIN_GAP_MS));
  };
  await settle();
  // The start-up read replaced the status with the defaults, so the settings go on now.
  await area_of(local, "local").set({ [CONFIG_STATUS_STORAGE_KEY]: { settings: { browser_module: true, browser_module_pages: true } } });
  await settle();
  // The page's first call marks tab 7 as locked.
  await area_of(session, "session").set({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: [{ v: V, id: "c1", kind: "page_call", args: { tab_id: 7, document_id: 1, message: JSON.stringify({ type: "run", invocations: [], mode: "normal" }) } }] });
  await settle();
  const pushed = (type: string): number => ((session.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) as { kind: string; args: { message: string } }[] | undefined) ?? []).filter((message) => message.kind === "page_push" && (JSON.parse(message.args.message) as { type: string }).type === type).length;
  return { session, local, area_of, settle, send_to_tab, pushed, tab };
}

let shared: ReturnType<typeof locked_tab_env> | undefined;
// main.ts loads once per process, so every test in this file shares one locked tab.
const env = () => (shared ??= locked_tab_env());

// main.ts loads against a browser whose storage holds data and whose tab 7 shows a PDF. The push goes through the wiring main.ts builds between `send_to_tab`, the rpc and the base channel.
test("a push to a locked page through main.ts's wiring gets the module's answer", async () => {
  const { session, area_of, settle, send_to_tab } = await env();
  const answer = send_to_tab(7, { type: "get_selection" } as never);
  const settled = answer.then((value) => ({ value }), (error: Error) => ({ error: error.message }));
  await settle();
  const push = (session.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) as { id: string; kind: string }[]).find((message) => message.kind === "page_push");
  assert.ok(push, "the module sees the push");
  await area_of(session, "session").set({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: [{ v: V, reply_to: push.id, ok: true, value: JSON.stringify({ value: "picked" }) }] });
  assert.deepEqual(await settled, { value: "picked" });
});

// The three places that tell every tab to read its keymap again must reach a locked tab too, or its page keeps the old keys and the old recording state.
test("starting a macro recording tells a locked tab to read its keymap again", async () => {
  const { settle, pushed } = await env();
  const { browser_macro_recorder } = await import("../../src/background/macro_recorder.ts");
  const before = pushed("tree_updated");
  await browser_macro_recorder.start("a", false);
  await settle();
  assert.equal(pushed("tree_updated"), before + 1);
  await browser_macro_recorder.stop(false);
});

test("a config publish tells a locked tab to read its keymap again", async () => {
  const { settle, pushed } = await env();
  const { change_edits } = await import("../../src/background/config_main.ts");
  const before = pushed("tree_updated");
  // The publish rebuilds the stored status from the config, so the two settings that keep the locked tab served go in as edits.
  await change_edits(() => ({ saved: {}, temp: { browser_module: true, browser_module_pages: true } }));
  await settle();
  assert.ok(pushed("tree_updated") > before);
});

test("the status bar coming up tells a locked tab to read its keymap again", async () => {
  const { session, area_of, settle, pushed } = await env();
  const before = pushed("tree_updated");
  await area_of(session, "session").set({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { v: V, module_version: "1", bar: true } });
  // The hello is read at most once a second, so under load the push can come a turn later.
  for (let turn = 0; turn < 14 && pushed("tree_updated") === before; turn++) await settle();
  assert.ok(pushed("tree_updated") > before);
});
