// The DevTools `:` key (browser_module/desertfox-devtools.js): it asks the extension for the command line panel over the tab that the toolbox inspects.
// A docked toolbox sits in the browser container of that tab. A toolbox opened as a tab names the tab in its address. A DevTools window of its own has neither (measured), so it maps to no tab.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { Node } from "./chrome_dom.ts";
import { create_firefox, key_event } from "./fake_firefox.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const STATE = { v: 1, enabled: true, keys: [], tabs: {} };
const TABLE = [...protocol.DEVTOOLS_TREE_KEYS, ...protocol.DEVTOOLS_FLAGGED_KEYS.flatMap(({ keys }) => keys), protocol.DEVTOOLS_CMDLINE_KEY];
const INSPECTED_BROWSER_ID = 55;
const toolbox_address = (id: number, type = "tab") => `about:devtools-toolbox?type=${type}&id=${id}`;
const BARE = "about:devtools-toolbox";

type Host = "docked" | "window" | "tab";

// The toolbox document and the frame above it. Docked, the frame is in the inspected tab's browser container. In a window, it is in a window with no tab list. As a tab, the toolbox is the tab's own document.
function toolbox_document(host: Host, win: { document: unknown }, address: string, container: { contains(node: unknown): boolean; frame?: unknown }) {
  const holder = { classList: { contains: (name: string) => name === "devtools-toolbox-iframe" }, ownerDocument: { defaultView: host === "window" ? {} : win, ...(win.document as object) } };
  if (host === "docked") container.frame = holder;
  const view = Object.assign(new Node("#view"), { frameElement: null, browsingContext: { isContent: false, embedderElement: holder } });
  const doc = { documentURI: address, defaultView: view };
  return (local_name: string) => Object.assign(new Node(local_name), { ownerDocument: doc }) as unknown as Node;
}

function world({ host = "docked" as Host, address = undefined as string | undefined, mapped = true, table = TABLE as unknown, private_inspected = false } = {}) {
  address ??= host === "tab" ? toolbox_address(INSPECTED_BROWSER_ID) : BARE;
  const firefox = create_firefox();
  firefox.start_extension();
  const inspected = { linkedBrowser: { browsingContext: { browserId: INSPECTED_BROWSER_ID } } };
  const other_tab = { linkedBrowser: { browsingContext: { browserId: 99 } } };
  const browser_window = firefox.make_window();
  browser_window.load();
  browser_window.add_tab();
  const container: { contains(node: unknown): boolean; frame?: unknown } = { contains: (node) => node === container.frame };
  const other_container = { contains: () => false };
  Object.assign(browser_window.win.gBrowser, { tabs: mapped ? [other_tab, inspected] : [other_tab], getBrowserContainer: (browser: unknown) => (browser === inspected.linkedBrowser ? container : other_container) });
  const listed_window = private_inspected ? Object.assign(firefox.make_window({ private_window: true }).win, { gBrowser: (browser_window.win as { gBrowser: unknown }).gBrowser }) : browser_window.win;
  (firefox.Services.wm as { getEnumerator: (type: string | null) => unknown[] }).getEnumerator = (type) => (type === "navigator:browser" ? [listed_window] : []);
  // The id the extension's tab tracker gives that tab.
  const tab_id = (browser_window.win as unknown as { ChromeUtils: { importESModule(url: string): { ExtensionParent: { apiManager: { global: { tabTracker: { getId(tab: unknown): number } } } } } } }).ChromeUtils.importESModule("x").ExtensionParent.apiManager.global.tabTracker.getId(inspected);
  const devtools_window = host === "window" ? firefox.make_window({ devtools_window: true }) : undefined;
  if (devtools_window) devtools_window.open();
  const host_window = devtools_window ?? browser_window;
  firefox.write_state(STATE);
  const make = toolbox_document(host, browser_window.win, address, container);
  const field = make("input");
  const area = make("div");
  if (table !== null) firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id: "t0", kind: "devtools.keys", args: { keys: table }, sent_at: Date.now() }]);
  const press = (key: string, target: Node = area, patch = {}) => host_window.press(key_event(key, { target, originalTarget: target, ...patch })).prevented;
  const asks = () => (firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) as { kind?: string; args?: Record<string, unknown> }[] | undefined ?? []).map((message) => JSON.parse(JSON.stringify(message)) as { kind?: string; args?: Record<string, unknown> }).filter((message) => message.kind === "devtools_cmdline.ask").map((message) => message.args);
  return { firefox, press, asks, field, area, tab_id };
}

// A toolbox opened as a tab reaches this claim only once the core treats its document as DevTools (a change of the core's guard that is not in yet). The stand-in gives its frame the toolbox class so the key arrives, and only the address then names the tab.
for (const host of ["docked", "tab"] as const) {
  test(`${host}: : asks for the line over the tab the toolbox inspects, and the key stops in the module`, async () => {
    const env = world({ host });
    await settle();
    assert.equal(env.press(":"), true);
    await settle();
    assert.deepEqual(env.asks(), [{ tab_id: env.tab_id }]);
  });
}

test("a DevTools window of its own maps to no tab, so the ask goes without one and the extension refuses with a notice", async () => {
  const env = world({ host: "window" });
  await settle();
  assert.equal(env.press(":"), true);
  await settle();
  assert.deepEqual(env.asks(), [{}]);
});

test(": in an editable DevTools field still types, and a modifier or a frame target passes too", async () => {
  const env = world();
  await settle();
  assert.equal(env.press(":", env.field), false);
  assert.equal(env.press(":", env.area, { ctrlKey: true }), false);
  assert.equal(env.press(":", Object.assign(env.area, { localName: "iframe" })), false);
  assert.deepEqual(env.asks(), []);
});

test("a toolbox that maps to no tab asks without one", async () => {
  const cases = [{ host: "tab", address: toolbox_address(INSPECTED_BROWSER_ID, "other") }, { host: "tab", address: toolbox_address(1234) }, { host: "tab", mapped: false }, { host: "tab", address: `${BARE}?type=tab` }, { host: "tab", address: `${BARE}?type=tab&id=x` }, { host: "docked", mapped: false }] as const;
  for (const options of cases) {
    const env = world(options);
    await settle();
    assert.equal(env.press(":"), true, JSON.stringify(options));
    await settle();
    assert.deepEqual(env.asks(), [{}], JSON.stringify(options));
  }
});

// A docked toolbox is in the window the core already checked for the key, so only a toolbox tab can name a tab of another window.
test("a toolbox tab for a tab of a window the module may not act in names no tab", async () => {
  const env = world({ host: "tab", private_inspected: true });
  await settle();
  assert.equal(env.press(":"), true);
  await settle();
  assert.deepEqual(env.asks(), [{}]);
});

test("a table without the row, as from an older extension, leaves : to DevTools", async () => {
  const env = world({ table: protocol.DEVTOOLS_TREE_KEYS });
  await settle();
  assert.equal(env.press(":"), false);
  assert.deepEqual(env.asks(), []);
});
