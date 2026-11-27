import assert from "node:assert/strict";
import { test } from "node:test";

// A browser whose every member is a recording stub, so `main.ts` can load in node.
// A storage read answers after a macrotask, the way a real read does, and the log marks when it does.
function recording_browser() {
  const log: string[] = [];
  // Counts microtask turns from the first registration on, so a registration behind any await sees a count above zero.
  let turns = 0;
  const late: string[] = [];
  let counting = false;
  const count_turns = () => {
    if (counting) return;
    counting = true;
    const step = () => {
      if (++turns < 500) queueMicrotask(step);
    };
    queueMicrotask(step);
  };
  const registered_by = () => /src\/([\w/]+\.ts)/.exec(new Error().stack?.split("\n").slice(3).find((frame) => frame.includes("/src/")) ?? "")?.[1] ?? "unknown";
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
        if (name === "addListener") {
          return () => {
            count_turns();
            const entry = `listen ${path} from ${registered_by()}`;
            log.push(entry);
            if (turns > 0) late.push(entry);
          };
        }
        return stub(`${path}.${name}`);
      },
      apply: () => answer(path),
    });
  const browser = new Proxy({}, { get: (_target, name) => (typeof name === "string" ? stub(name) : undefined) });
  return { browser, log, late };
}

const listeners_of = (log: string[]) => log.filter((entry) => entry.startsWith("listen "));

// A listener registered behind an await, or after the first read resolved, could miss an event that fires while the config loads.
// The keymap source registers its `storage.onChanged` listener ahead of every one from main.ts (see `keymap_source.ts`).
test("every listener of the background page registers in the first turn, in a fixed order, each from its module", async () => {
  const { browser, log, late } = recording_browser();
  Object.assign(globalThis, { browser });
  // The page retries its rank Worker on a timer chain, and node cannot start that Worker. A timer set after the test body ends (a retry fires from a timer callback) would keep the process alive, so the patch stays for the whole process. Each test file runs in its own process.
  const real_set_timeout = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => real_set_timeout(...args).unref()) as typeof setTimeout;
  await import("../../src/background/main.ts");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(late, [], "a listener registered after an await");
  const first_read = log.indexOf("storage read resolved");
  assert.ok(first_read > 0, "main.ts reads storage while it loads");
  assert.deepEqual(listeners_of(log), listeners_of(log.slice(0, first_read)), "a listener registered after the first storage read resolved");
  assert.deepEqual(listeners_of(log), GOLDEN_LISTENERS);
});

// Moving a listener or adding an await ahead of one changes this list. Update it only when the change is meant.
const GOLDEN_LISTENERS = [
  "listen storage.onChanged from background/browser_deps.ts",
  "listen storage.onChanged from background/keymap_source.ts",
  "listen webNavigation.onCommitted from background/main.ts",
  "listen webNavigation.onCommitted from background/main.ts",
  "listen windows.onFocusChanged from background/window_focus.ts",
  "listen windows.onRemoved from background/window_focus.ts",
  "listen windows.onFocusChanged from background/main.ts",
  "listen windows.onRemoved from background/main.ts",
  "listen runtime.onConnect from background/main.ts",
  "listen storage.onChanged from background/main.ts",
  "listen windows.onFocusChanged from background/bridge_browser.ts",
  "listen tabs.onActivated from background/bridge_browser.ts",
  "listen tabs.onUpdated from background/bridge_browser.ts",
  "listen tabs.onRemoved from background/bridge_browser.ts",
  "listen permissions.onAdded from background/bridge_browser.ts",
  "listen storage.onChanged from background/bridge_browser.ts",
  "listen permissions.onAdded from background/main.ts",
  "listen runtime.onInstalled from background/main.ts",
  "listen commands.onCommand from background/main.ts",
  "listen omnibox.onInputChanged from background/main.ts",
  "listen omnibox.onInputEntered from background/main.ts",
  "listen tabs.onUpdated from background/main.ts",
  "listen storage.onChanged from background/main.ts",
  "listen runtime.onMessage from background/main.ts",
  "listen tabs.onUpdated from background/main.ts",
  "listen tabs.onRemoved from background/main.ts",
  "listen windows.onRemoved from background/main.ts",
  "listen windows.onRemoved from background/main.ts",
  "listen windows.onRemoved from background/store_turns.ts",
  "listen runtime.onConnect from background/main.ts",
  "listen history.onVisited from background/main.ts",
  "listen history.onTitleChanged from background/main.ts",
  "listen history.onVisitRemoved from background/main.ts",
  "listen history.onVisitRemoved from background/main.ts",
  "listen tabs.onActivated from background/main.ts",
  "listen tabs.onRemoved from background/main.ts",
  "listen tabs.onCreated from background/tab_model.ts",
  "listen tabs.onRemoved from background/tab_model.ts",
  "listen tabs.onUpdated from background/tab_model.ts",
  "listen tabs.onMoved from background/tab_model.ts",
  "listen tabs.onDetached from background/tab_model.ts",
  "listen tabs.onAttached from background/tab_model.ts",
  "listen tabs.onActivated from background/tab_model.ts",
  "listen tabGroups.onCreated from background/tab_model.ts",
  "listen tabGroups.onUpdated from background/tab_model.ts",
  "listen tabGroups.onRemoved from background/tab_model.ts",
  "listen tabGroups.onMoved from background/tab_model.ts",
  "listen windows.onCreated from background/tab_model.ts",
  "listen windows.onRemoved from background/tab_model.ts",
  "listen contextualIdentities.onCreated from background/tab_model.ts",
  "listen contextualIdentities.onUpdated from background/tab_model.ts",
  "listen contextualIdentities.onRemoved from background/tab_model.ts",
  "listen runtime.onConnect from background/tab_model.ts",
];
