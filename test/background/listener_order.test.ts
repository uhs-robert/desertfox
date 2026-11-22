import assert from "node:assert/strict";
import { test } from "node:test";

// A browser whose every member is a recording stub, so `main.ts` can load in node.
// A storage read answers after a macrotask, the way a real read does, and the log marks when it does.
function recording_browser() {
  const log: string[] = [];
  const lists = ["query", "getAll", "getAllFrames", "getRecentlyClosed", "search", "getTopSites", "getVisits"];
  const answer = (path: string): unknown => {
    const member = path.slice(path.lastIndexOf(".") + 1);
    if (path === "storage.local.get") {
      return new Promise((resolve) =>
        setImmediate(() => {
          log.push("storage read resolved");
          resolve({});
        }),
      );
    }
    if (path === "runtime.getManifest") return { version: "test", web_accessible_resources: [], browser_action: {}, commands: {} };
    if (path === "runtime.getURL") return "moz-extension://test/";
    if (path === "runtime.sendNativeMessage") return Promise.reject(new Error("no host"));
    if (lists.includes(member)) return Promise.resolve([]);
    if (["set", "remove", "clear"].includes(member)) return Promise.resolve();
    return stub(`${path}()`);
  };
  const stub = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_target, name) => {
        if (typeof name === "symbol" || name === "then") return undefined;
        if (name === "addListener") return () => void log.push(`listen ${path}`);
        return stub(`${path}.${name}`);
      },
      apply: () => answer(path),
    });
  const browser = new Proxy({}, { get: (_target, name) => (typeof name === "string" ? stub(name) : undefined) });
  return { browser, log };
}

const listeners_of = (log: string[]) => log.filter((entry) => entry.startsWith("listen "));

// A listener registered after the first read resolved could miss an event that fires while the config loads.
// The first `storage.onChanged` listener is the keymap source, which must run ahead of the others (see `keymap_source.ts`).
test("every listener of the background page registers in the first turn, in a fixed order", async () => {
  const { browser, log } = recording_browser();
  Object.assign(globalThis, { browser });
  // The page starts timers that outlive the test, so each one lets the process end.
  const real_set_timeout = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => real_set_timeout(...args).unref()) as typeof setTimeout;
  let listened_at_load: string[];
  try {
    await import("../../src/background/main.ts");
    listened_at_load = listeners_of(log);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.setTimeout = real_set_timeout;
  }
  assert.ok(log.includes("storage read resolved"), "main.ts reads storage while it loads");
  assert.deepEqual(listeners_of(log), listened_at_load, "a listener registered after the load turn");
  assert.deepEqual(listened_at_load, GOLDEN_LISTENERS);
});

// Moving a listener or adding an await ahead of one changes this list. Update it only when the change is meant.
const GOLDEN_LISTENERS = [
  "listen storage.onChanged",
  "listen storage.onChanged",
  "listen webNavigation.onCommitted",
  "listen webNavigation.onCommitted",
  "listen windows.onFocusChanged",
  "listen windows.onRemoved",
  "listen windows.onFocusChanged",
  "listen windows.onRemoved",
  "listen runtime.onConnect",
  "listen windows.onFocusChanged",
  "listen tabs.onActivated",
  "listen tabs.onUpdated",
  "listen tabs.onRemoved",
  "listen permissions.onAdded",
  "listen storage.onChanged",
  "listen permissions.onAdded",
  "listen runtime.onInstalled",
  "listen commands.onCommand",
  "listen omnibox.onInputChanged",
  "listen omnibox.onInputEntered",
  "listen tabs.onUpdated",
  "listen storage.onChanged",
  "listen runtime.onMessage",
  "listen tabs.onUpdated",
  "listen tabs.onRemoved",
  "listen windows.onRemoved",
  "listen windows.onRemoved",
  "listen windows.onRemoved",
  "listen runtime.onConnect",
  "listen history.onVisited",
  "listen history.onTitleChanged",
  "listen history.onVisitRemoved",
  "listen history.onVisitRemoved",
  "listen tabs.onActivated",
  "listen tabs.onRemoved",
  "listen tabs.onCreated",
  "listen tabs.onRemoved",
  "listen tabs.onUpdated",
  "listen tabs.onMoved",
  "listen tabs.onDetached",
  "listen tabs.onAttached",
  "listen tabs.onActivated",
  "listen tabGroups.onCreated",
  "listen tabGroups.onUpdated",
  "listen tabGroups.onRemoved",
  "listen tabGroups.onMoved",
  "listen windows.onCreated",
  "listen windows.onRemoved",
  "listen contextualIdentities.onCreated",
  "listen contextualIdentities.onUpdated",
  "listen contextualIdentities.onRemoved",
  "listen runtime.onConnect",
];
