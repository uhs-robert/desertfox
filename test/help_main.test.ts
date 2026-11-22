import assert from "node:assert/strict";
import { test } from "node:test";

// Drives the real `main.ts` on a permissive fake page, to pin how the Settings boxes mount: their order, the storage listeners they take, and the user CSS holds the import and files boxes take and release around each render.

const BOX_CLASSES = ["settings", "site-keys", "keys", "engines", "aliases", "quickmarks", "themes", "host-start", "transfer", "files"].map((name) => `.desertfox-${name}`);

// Any property reads as a no-op function and any write sticks, so the real page code runs on it.
function permissive(store: Record<string | symbol, unknown> = {}): any {
  const target = function () {} as unknown as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "then") return undefined;
      if (key in store) return store[key];
      if (key === "children" || key === "options" || key === "files") return [];
      if (key === "classList") return { toggle() {}, add() {}, remove() {}, contains: () => false };
      if (key === "style" || key === "dataset") return {};
      return () => permissive();
    },
    set: (_t, key, value) => {
      store[key] = value;
      return true;
    },
    apply: () => permissive(),
    construct: () => permissive() as object,
  });
}

const MEDIA = 'media ""';
const find = (selector: string) => `find ${selector}`;
const LISTEN = "on_changed";
// Mount order, not page order. Every box except the settings fields and the host banner takes a storage listener when it mounts.
const BOXES_IN_ORDER = [
  find(".desertfox-settings"),
  find(".desertfox-site-keys"), LISTEN,
  find(".desertfox-keys"), LISTEN,
  find(".desertfox-engines"), LISTEN,
  find(".desertfox-aliases"), LISTEN,
  find(".desertfox-quickmarks"), LISTEN,
  find(".desertfox-themes"), LISTEN,
  find(".desertfox-host-start"),
];
// The transfer and files boxes dispose their old hold and open a new one before they mount, found or not. Each dispose and each `set` writes the gate's sheet once (the MEDIA lines). The first render has nothing to dispose.
const FIRST_RENDER = [...BOXES_IN_ORDER, find(".desertfox-transfer"), MEDIA, find(".desertfox-files"), MEDIA];
// The stops: one listener removed each for settings, site keys, keys, engines, aliases, quickmarks and themes. The two holds are disposed with no box to mount.
const LEAVE_SETTINGS = [...Array(7).fill("off_changed"), MEDIA, MEDIA];
const RETURN_TO_SETTINGS = [...BOXES_IN_ORDER, find(".desertfox-transfer"), MEDIA, MEDIA, find(".desertfox-files"), MEDIA, MEDIA];

// The part of the log the boxes write: it starts at the first box lookup (the page's own listeners come before) and ends where the expected part ends (the page's own later sheet writes follow).
const box_part = (log: string[], expected: string[]): string[] => {
  const start = log.findIndex((line) => line.startsWith("find "));
  return log.slice(start === -1 ? 0 : start, (start === -1 ? 0 : start) + expected.length);
};

async function settled(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("the Settings route mounts the boxes in table order and takes a fresh CSS hold for transfer and files at every render", async () => {
  const log: string[] = [];
  const window_listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const location = { hash: "#/settings" };
  const g = globalThis as Record<string, unknown>;
  const names = ["location", "fetch", "ResizeObserver", "CSS", "HTMLElement", "browser", "window", "document"];
  const saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(g, name)]));
  const set_global = (name: string, value: unknown) => Object.defineProperty(g, name, { value, configurable: true, writable: true });
  const commands = { commands: [], version: 1 };
  set_global("location", location);
  set_global("fetch", async (url: string) => ({ json: async () => (url === "commands.json" ? commands : []) }));
  set_global("ResizeObserver", class { observe() {} disconnect() {} });
  set_global("HTMLElement", class {});
  set_global("CSS", { escape: (text: string) => text });
  set_global("browser", {
    runtime: { getURL: (path: string) => path, sendMessage: async () => ({ ok: false, message: "fake" }), onMessage: { addListener() {} } },
    storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) }, onChanged: { addListener: () => log.push("on_changed"), removeListener: () => log.push("off_changed") } },
  });
  set_global("window", {
    scrollY: 0,
    addEventListener: (name: string, listener: (event?: unknown) => void) => (window_listeners[name] ??= []).push(listener),
    removeEventListener() {},
    scrollTo() {},
  });
  // The gate writes the sheet's `media` on every hold change, so the writes are the hold log.
  const style_sheet = () => ({ textContent: "", append() {}, set media(value: string) { log.push(`media ${JSON.stringify(value)}`); } });
  set_global("document", {
    head: permissive(),
    body: permissive(),
    documentElement: permissive({ scrollHeight: 0 }),
    activeElement: null,
    createElement: (tag: string) => {
      return tag === "style" ? style_sheet() : permissive();
    },
    createElementNS: () => permissive(),
    createTextNode: () => permissive(),
    createDocumentFragment: () => permissive(),
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: (selector: string) => {
      if (!BOX_CLASSES.includes(selector)) return null;
      log.push(`find ${selector}`);
      return location.hash.startsWith("#/settings") ? permissive() : null;
    },
    addEventListener() {},
  });
  try {
    await import("../src/help/main.ts");
    await settled();
    assert.deepEqual(box_part(log, FIRST_RENDER), FIRST_RENDER);
    log.length = 0;
    location.hash = "#/commands";
    for (const listener of window_listeners["hashchange"] ?? []) listener();
    await settled();
    assert.deepEqual(box_part(log, LEAVE_SETTINGS), LEAVE_SETTINGS);
    log.length = 0;
    location.hash = "#/settings";
    for (const listener of window_listeners["hashchange"] ?? []) listener();
    await settled();
    assert.deepEqual(box_part(log, RETURN_TO_SETTINGS), RETURN_TO_SETTINGS);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(g, name, descriptor);
      else delete g[name];
    }
  }
});
