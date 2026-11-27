import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const PANEL_FILE = "desertfox-cmdline-panel.js";
const BASE_URI = "moz-extension://uuid/";
type Reply = { reply_to: string; ok: boolean; error?: string };
type Listener = (event: { preventDefault(): void; data?: unknown }) => void;

// Just enough of a XUL element: attributes, style, listeners and children.
function fake_element(local_name: string, log: string[]) {
  const listeners = new Map<string, Listener[]>();
  const element = {
    localName: local_name,
    id: "",
    attributes: new Map<string, string>(),
    style: {} as Record<string, string>,
    children: [] as unknown[],
    state: "closed",
    setAttribute: (name: string, value: string) => void element.attributes.set(name, value),
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: Listener) => void listeners.set(type, (listeners.get(type) ?? []).filter((each) => each !== listener)),
    fire: (type: string, data?: unknown) => {
      const event = { prevented: false, data, preventDefault: () => void (event.prevented = true) };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
    appendChild: (child: unknown) => void element.children.push(child),
    remove: () => void log.push(`remove ${local_name}`),
  };
  return element;
}

function panel_world({ private_window = false, private_access = false, enabled = true, popup_set = true } = {}) {
  const firefox = create_firefox({ extra_files: { [PANEL_FILE]: source_of(PANEL_FILE) } });
  const extension = Object.assign(firefox.start_extension({ private_access }), {
    remote: true,
    remoteType: "extension",
    policy: { browsingContextGroupId: 42 },
    principal: { name: "the extension principal" },
    baseURI: { resolve: (path: string) => BASE_URI + path },
  });
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled, keys: [], tabs: {} });
  const log: string[] = [];
  const opener = { localName: "browser", focus: () => log.push("focus opener"), getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  const tab_a = { linkedBrowser: opener, closing: false };
  const tab_b = { linkedBrowser: { localName: "browser" }, closing: false };
  const emitted: unknown[] = [];
  firefox.module_exports = {
    ExtensionParent: {
      GlobalManager: { getExtension: (id: string) => (id === extension.id ? extension : undefined) },
      apiManager: { global: { tabTracker: { getId: (tab: unknown) => (tab === tab_a ? 7 : tab === tab_b ? 8 : -1) } }, emit: (name: string, browser: unknown) => emitted.push([name, browser]) },
    },
  };
  const window = firefox.make_window({ private_window });
  window.load();
  let selected: typeof tab_a | typeof tab_b = tab_a;
  const created: ReturnType<typeof fake_element>[] = [];
  const tab_container = fake_element("tabs", log);
  const popups = fake_element("popupset", log);
  const gBrowser = window.win.gBrowser as Record<string, unknown>;
  Object.defineProperty(gBrowser, "selectedTab", { get: () => selected });
  Object.defineProperty(gBrowser, "selectedBrowser", { get: () => selected.linkedBrowser });
  gBrowser.tabContainer = tab_container;
  const loaded: { url: string; principal: unknown }[] = [];
  const messages: unknown[] = [];
  Object.assign(window.win.document, {
    getElementById: (id: string) => (id === "mainPopupSet" && popup_set ? popups : created.find((element) => element.id === id && element.localName === "panel") ?? null),
    createXULElement: (name: string) => {
      const element = fake_element(name, log);
      if (name === "panel") {
        Object.assign(element, {
          openPopup: () => {
            element.state = "open";
            element.fire("popupshown");
          },
          hidePopup: () => {
            element.state = "closed";
            element.fire("popuphidden");
          },
          moveToAnchor: (_anchor: unknown, _position: string, _x: number, y: number) => log.push(`move to ${y}`),
        });
      } else {
        const resize_listeners: ((message: { data: unknown }) => void)[] = [];
        Object.assign(element, {
          focus: () => log.push("focus panel browser"),
          fixupAndLoadURIString: (url: string, options: { triggeringPrincipal: unknown }) => loaded.push({ url, principal: options.triggeringPrincipal }),
          messageManager: {
            addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => name === "Extension:BrowserResized" && resize_listeners.push(listener),
            removeMessageListener: () => undefined,
            loadFrameScript: (url: string) => messages.push(url),
            sendAsyncMessage: (name: string, data: unknown) => messages.push([name, data]),
          },
          resized: (height: unknown) => resize_listeners.forEach((listener) => listener({ data: { height } })),
        });
      }
      created.push(element);
      return element;
    },
  });
  const services = firefox.Services as Record<string, unknown>;
  services.focus = { activeWindow: window.win };
  let next_id = 0;
  async function ask(args: Record<string, unknown>): Promise<Omit<Reply, "reply_to">> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind: "cmdline_panel.open", args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as Reply[]).find((each) => each.reply_to === id);
    assert.ok(reply, "no reply");
    const { reply_to: _id, v: _v, ...rest } = JSON.parse(JSON.stringify(reply)) as Reply & { v: number };
    return rest;
  }
  const panel = () => created.find((element) => element.localName === "panel");
  const browser = () => created.find((element) => element.localName === "browser") as (ReturnType<typeof fake_element> & { resized(height: unknown): void }) | undefined;
  return { firefox, extension, ask, log, loaded, messages, emitted, panel, browser, tab_container, select_b: () => void (selected = tab_b), created };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the panel opens over the selected tab with DesertFox's own page, its principal and its process, and only after it is shown", async () => {
  const world = panel_world();
  const reply = await world.ask({ tab_id: 7 });
  assert.deepEqual(reply, { ok: true });
  const browser = world.browser()!;
  assert.equal(browser.attributes.get("remoteType"), "extension");
  assert.equal(browser.attributes.get("initialBrowsingContextGroupId"), 42);
  assert.equal(browser.attributes.get("webextension-view-type"), "popup");
  // Remote: the page loads one microtask after the frame loader exists.
  assert.deepEqual(world.loaded, []);
  browser.fire("XULFrameLoaderCreated");
  await settle();
  assert.deepEqual(world.loaded, [{ url: `${BASE_URI}cmdline.html`, principal: world.extension.principal }]);
  assert.deepEqual(world.emitted, [["extension-browser-inserted", browser]]);
  assert.ok(world.panel()!.children.includes(browser), "the browser joined the panel when it was shown");
  assert.ok(world.log.includes("focus panel browser"));
  // The page grows the panel upward, within the page's height.
  browser.resized(200);
  assert.equal(browser.style.height, "200px");
  assert.ok(world.log.includes("move to 400"));
  browser.resized(5000);
  assert.equal(browser.style.height, "600px");
  browser.resized("tall");
  assert.equal(browser.style.height, "600px");
});

test("the page's window.close() closes the panel and the focus goes back to the page", async () => {
  const world = panel_world();
  await world.ask({ tab_id: 7 });
  const closed = world.browser()!.fire("DOMWindowClose");
  assert.equal(closed.prevented, true);
  assert.equal(world.panel()!.state, "closed");
  assert.ok(world.log.includes("remove panel"));
  assert.equal(world.log.at(-1), "focus opener");
});

test("a tab switch closes the panel and leaves the focus where the switch put it", async () => {
  const world = panel_world();
  await world.ask({ tab_id: 7 });
  world.select_b();
  world.tab_container.fire("TabSelect");
  assert.equal(world.panel()!.state, "closed");
  assert.equal(world.log.includes("focus opener"), false);
});

test("it refuses a tab that is not selected, a second panel, a window it may not act in and a Firefox with no popup set", async () => {
  {
    const world = panel_world();
    assert.deepEqual(await world.ask({ tab_id: 8 }), { ok: false, error: "The tab that asked is no longer selected" });
    assert.equal(world.created.length, 0);
    assert.deepEqual(await world.ask({ tab_id: 7 }), { ok: true });
    assert.deepEqual(await world.ask({ tab_id: 7 }), { ok: false, error: "The command line is already open" });
  }
  assert.equal((await panel_world({ enabled: false }).ask({ tab_id: 7 })).ok, false);
  assert.equal((await panel_world({ private_window: true }).ask({ tab_id: 7 })).ok, false);
  assert.equal((await panel_world({ private_window: true, private_access: true }).ask({ tab_id: 7 })).ok, true);
  assert.deepEqual(await panel_world({ popup_set: false }).ask({ tab_id: 7 }), { ok: false, error: "This Firefox has no place for the panel" });
  assert.deepEqual(await panel_world().ask({ tab_id: "7" }), { ok: false, error: "cmdline_panel.open tab_id has the wrong shape" });
});
