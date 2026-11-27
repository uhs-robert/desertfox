import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { FIREFOX_PAGE_ADDRESSES, MODULE_FIREFOX_PAGES, MODULE_ONLY_FIREFOX_PAGES } from "../../src/shared/firefox_pages.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const PAGES_FILE = "desertfox-firefox-pages.js";
const SYSTEM_PRINCIPAL = { system: true };
type Reply = { ok: boolean; error?: string };
type Opened = { how: string; address: string; open_new?: boolean; params?: Record<string, unknown>; user_context_id?: unknown; where?: string };

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

// The module's table as data, read from the file as the core test reads the kind lists.
function module_table(): Record<string, { address?: string; addons_view?: string }> {
  const text = /const PAGES = Object\.freeze\((\{[\s\S]*?\})\);/.exec(source_of(PAGES_FILE))?.[1];
  assert.ok(text, "PAGES not found in the feature file");
  return plain(vm.runInNewContext(`(${text})`));
}

test("the module's page table equals the extension's, without about:logins and with the views that have no address", () => {
  const table = module_table();
  assert.deepEqual(Object.keys(table), [...MODULE_FIREFOX_PAGES]);
  for (const [page, entry] of Object.entries(table)) {
    if ((MODULE_ONLY_FIREFOX_PAGES as readonly string[]).includes(page)) assert.deepEqual(Object.keys(entry), ["addons_view"], page);
    else assert.deepEqual(entry, { address: FIREFOX_PAGE_ADDRESSES[page as keyof typeof FIREFOX_PAGE_ADDRESSES] }, page);
  }
  assert.equal("logins" in table, false);
});

// One browser window with two tabs, the module on, DesertFox running and its state written. Each Firefox entry point records what it was asked.
function world({ private_window = false, private_access = false, enabled = true, entry_points = true } = {}) {
  const firefox = create_firefox({ extra_files: { [PAGES_FILE]: source_of(PAGES_FILE) } });
  firefox.start_extension({ private_access });
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled, keys: [], tabs: {} });
  const services = firefox.Services as Record<string, unknown>;
  services.scriptSecurityManager = { getSystemPrincipal: () => SYSTEM_PRINCIPAL };
  // The add-on manager's load notice goes to the observers of EM-loaded, which the test fires.
  const em_loaded = new Set<(subject: unknown, topic: string) => void>();
  const obs = services.obs as { addObserver(fn: unknown, topic: string): void; removeObserver(fn: unknown, topic: string): void };
  services.obs = {
    addObserver: (fn: (subject: unknown, topic: string) => void, topic: string) => (topic === "EM-loaded" ? void em_loaded.add(fn) : obs.addObserver(fn, topic)),
    removeObserver: (fn: (subject: unknown, topic: string) => void, topic: string) => (topic === "EM-loaded" ? void em_loaded.delete(fn) : obs.removeObserver(fn, topic)),
  };
  const window = firefox.make_window({ private_window });
  const a = window.add_tab();
  const b = window.add_tab();
  const opened: Opened[] = [];
  // Which address an open tab shows, for the switch to find it.
  const shown = new Set<string>();
  if (entry_points) {
    Object.assign(window.win, {
      switchToTabHavingURI: (address: string, open_new: boolean, params: Record<string, unknown>, user_context_id: unknown) => {
        opened.push({ how: "switch", address, open_new, params: plain({ ...params, triggeringPrincipal: params.triggeringPrincipal === SYSTEM_PRINCIPAL ? "system" : params.triggeringPrincipal }), user_context_id });
        return shown.has(address);
      },
      openTrustedLinkIn: (address: string, where: string, params: Record<string, unknown>) => void opened.push({ how: "trusted", address, where, params: plain(params) }),
      BrowserAddonUI: { openAddonsMgr: async (view: string) => void opened.push({ how: "addons", address: view }) },
    });
  }
  window.load();
  // As the sandbox sees it, a tab's ownerGlobal hides gBrowser, so the module must find the window another way.
  for (const tab of [a.tab, b.tab]) Object.assign(tab, { closing: false, ownerGlobal: { closed: false } });
  const wm = services.wm as { getEnumerator(type: string | null): unknown[] };
  services.wm = { getEnumerator: (type: string | null) => (type === "navigator:browser" ? [window.win] : wm.getEnumerator(type)) };
  window.select(a.tab);
  services.focus = { activeWindow: window.win };
  // The ids the module reads for each tab, as the extension names them. The fake tracker hands them out on first sight.
  const tracker = (window.win as unknown as { ChromeUtils: { importESModule(url: string): { ExtensionParent: { apiManager: { global: { tabTracker: { getId(tab: unknown): number } } } } } } }).ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.apiManager.global.tabTracker;
  const ids = { a: tracker.getId(a.tab), b: tracker.getId(b.tab) };
  let next_id = 0;
  async function ask(args: Record<string, unknown>): Promise<Reply> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind: "firefox_page.open", args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as (Reply & { reply_to: string })[]).find((each) => each.reply_to === id);
    assert.ok(reply, "no reply");
    const { ok, error } = plain(reply) as Reply;
    return error === undefined ? { ok } : { ok, error };
  }
  const fire_em_loaded = (subject: unknown) => [...em_loaded].forEach((fn) => fn(subject, "EM-loaded"));
  return { firefox, window, a, b, ids, ask, opened, shown, em_loaded, fire_em_loaded };
}


const SWITCH_PARAMS = (ignoreFragment: string) => ({ ignoreFragment, triggeringPrincipal: "system", relatedToCurrent: true });

test("the hello says firefox_pages once the feature has started", () => {
  const { firefox } = world();
  assert.equal((firefox.hello() as Record<string, unknown>).firefox_pages, true);
});

test("each page with an address opens through switchToTabHavingURI in the asking tab's window, with the system principal and no container", async () => {
  for (const [page, entry] of Object.entries(module_table())) {
    if (entry.address === undefined || entry.address.startsWith("about:preferences")) continue;
    const { ask, ids, opened } = world();
    assert.deepEqual(await ask({ page, where: "tab", tab_id: ids.a }), { ok: true }, page);
    assert.deepEqual(opened, [{ how: "switch", address: entry.address, open_new: true, params: SWITCH_PARAMS(entry.address.includes("#") ? "whenComparingAndReplace" : "whenComparing"), user_context_id: 0 }], page);
  }
});

test("settings switches to an open about:settings tab first, as Firefox's own opener does, and a pane moves that tab to the pane", async () => {
  {
    const { ask, ids, opened } = world();
    await ask({ page: "settings", tab_id: ids.a });
    assert.deepEqual(
      opened.map(({ address, open_new, params }) => [address, open_new, params?.ignoreFragment]),
      [["about:settings", false, "whenComparing"], ["about:preferences", true, "whenComparing"]],
    );
  }
  const { ask, ids, opened, shown } = world();
  shown.add("about:settings#privacy");
  await ask({ page: "settings-privacy", tab_id: ids.a });
  assert.deepEqual(opened.map(({ address, open_new, params }) => [address, open_new, params?.ignoreFragment]), [["about:settings#privacy", false, "whenComparingAndReplace"]]);
});

test("where=here loads the page into the asking tab while it is selected, with no container", async () => {
  const { ask, ids, opened } = world();
  assert.deepEqual(await ask({ page: "config", where: "here", tab_id: ids.a }), { ok: true });
  assert.deepEqual(opened, [{ how: "trusted", address: "about:config", where: "current", params: { userContextId: 0 } }]);
});

test("where=here refuses a stale tab, a tab that is gone, a wrong tab id and a request with no tab, and opens nothing", async () => {
  const { ask, ids, opened, window, b } = world();
  window.select(b.tab);
  assert.deepEqual(await ask({ page: "config", where: "here", tab_id: ids.a }), { ok: false, error: "The tab that asked is no longer selected" });
  assert.deepEqual(await ask({ page: "config", where: "here", tab_id: 9999 }), { ok: false, error: "The tab that asked is gone" });
  (b.tab as unknown as { closing: boolean }).closing = true;
  assert.deepEqual(await ask({ page: "config", where: "here", tab_id: ids.b }), { ok: false, error: "The tab that asked is gone" });
  assert.deepEqual(await ask({ page: "config", where: "here" }), { ok: false, error: "Opening a page here needs the tab that asked" });
  assert.deepEqual(opened, []);
});

test("where=tab opens in the asking tab's window even when another tab is selected there, and with no tab in the focused window", async () => {
  const { ask, ids, opened, window, b } = world();
  window.select(b.tab);
  assert.deepEqual(await ask({ page: "downloads", tab_id: ids.a }), { ok: true });
  assert.deepEqual(await ask({ page: "support" }), { ok: true });
  assert.deepEqual(opened.map(({ address }) => address), ["about:downloads", "about:support"]);
});

test("the add-on manager opens through Firefox's own opener, and a view with no address opens in it", async () => {
  const { ask, ids, opened } = world();
  await ask({ page: "addons", tab_id: ids.a });
  await ask({ page: "addons-shortcuts", tab_id: ids.a });
  assert.deepEqual(opened, [{ how: "switch", address: "about:addons", open_new: true, params: SWITCH_PARAMS("whenComparing"), user_context_id: 0 }, { how: "addons", address: "addons://shortcuts/shortcuts" }]);
});

test("the shortcuts view here loads about:addons into the tab, then shows the view in the first manager that loads in this window", async () => {
  const { ask, ids, opened, window, fire_em_loaded, em_loaded, firefox } = world();
  assert.deepEqual(await ask({ page: "addons-shortcuts", where: "here", tab_id: ids.a }), { ok: true });
  assert.deepEqual(opened, [{ how: "trusted", address: "about:addons", where: "current", params: { userContextId: 0 } }]);
  const views: string[] = [];
  fire_em_loaded({ browsingContext: { topChromeWindow: {} }, loadView: (view: string) => views.push(`other ${view}`) });
  fire_em_loaded({ browsingContext: { topChromeWindow: window.win }, loadView: (view: string) => views.push(view) });
  fire_em_loaded({ browsingContext: { topChromeWindow: window.win }, loadView: (view: string) => views.push(`again ${view}`) });
  assert.deepEqual(views, ["addons://shortcuts/shortcuts"]);
  assert.equal(em_loaded.size, 0);
  // A manager that never loads: the wait ends on its own.
  firefox.chrome_now += 2000;
  await ask({ page: "addons-shortcuts", where: "here", tab_id: ids.a });
  assert.equal(em_loaded.size, 1);
  firefox.run_timers();
  assert.equal(em_loaded.size, 0);
});

test("a second request for the same page in the same window within a second opens nothing more and answers ok", async () => {
  const { ask, ids, opened, firefox } = world();
  assert.deepEqual(await ask({ page: "config", tab_id: ids.a }), { ok: true });
  firefox.chrome_now += 500;
  assert.deepEqual(await ask({ page: "config", tab_id: ids.a }), { ok: true });
  assert.equal(opened.length, 1);
  firefox.chrome_now += 600;
  assert.deepEqual(await ask({ page: "config", tab_id: ids.a }), { ok: true });
  assert.equal(opened.length, 2);
});

test("a request read twice opens once", async () => {
  const { firefox, ids, opened } = world();
  const message = { v: 1, id: "same", kind: "firefox_page.open", args: { page: "memory", tab_id: ids.a }, sent_at: Date.now() };
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [message]);
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [message]);
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.length, 1);
});

test("at most five pages open in ten seconds, then the module refuses until the oldest open is ten seconds old", async () => {
  const { ask, ids, opened, firefox } = world();
  const pages = ["config", "memory", "support", "crashes", "policies", "profiles"];
  for (const page of pages.slice(0, 5)) assert.deepEqual(await ask({ page, tab_id: ids.a }), { ok: true }, page);
  firefox.chrome_now += 9000;
  assert.deepEqual(await ask({ page: "profiles", tab_id: ids.a }), { ok: false, error: "Too many Firefox pages opened at once" });
  firefox.chrome_now += 1001;
  assert.deepEqual(await ask({ page: "profiles", tab_id: ids.a }), { ok: true });
  assert.equal(opened.length, 6);
});

test("a private window opens the page only with DesertFox's private window access, and the module refuses where the switch is off", async () => {
  {
    const { ask, ids, opened } = world({ private_window: true });
    assert.deepEqual(await ask({ page: "config", tab_id: ids.a }), { ok: false, error: "The browser module may not act in this window" });
    assert.deepEqual(opened, []);
  }
  {
    const { ask, ids, opened } = world({ private_window: true, private_access: true });
    assert.deepEqual(await ask({ page: "config", tab_id: ids.a }), { ok: true });
    assert.equal(opened.length, 1);
  }
  const { ask, ids, opened } = world({ enabled: false });
  assert.equal((await ask({ page: "config", tab_id: ids.a })).ok, false);
  assert.deepEqual(opened, []);
});

test("the core refuses a page off the list, logins, an address, an unknown where and a text tab id with its fixed wrong-shape text", async () => {
  const { ask, ids, opened } = world();
  assert.deepEqual(await ask({ page: "logins", tab_id: ids.a }), { ok: false, error: "firefox_page.open page has the wrong shape" });
  assert.deepEqual(await ask({ page: "about:config", tab_id: ids.a }), { ok: false, error: "firefox_page.open page has the wrong shape" });
  assert.deepEqual(await ask({ page: "telemetry", tab_id: ids.a }), { ok: false, error: "firefox_page.open page has the wrong shape" });
  assert.deepEqual(await ask({ page: "config", where: "window", tab_id: ids.a }), { ok: false, error: "firefox_page.open where has the wrong shape" });
  assert.deepEqual(await ask({ page: "config", tab_id: String(ids.a) }), { ok: false, error: "firefox_page.open tab_id has the wrong shape" });
  // A field the kind does not list never reaches the handler.
  assert.deepEqual(await ask({ page: "config", tab_id: ids.a, address: "https://example.com/" }), { ok: true });
  assert.deepEqual(opened.map(({ address }) => address), ["about:config"]);
});

test("a Firefox without the entry points refuses with a fixed text and keeps the module on", async () => {
  const { ask, ids, firefox } = world({ entry_points: false });
  for (const [page, where] of [["config", "tab"], ["config", "here"], ["addons-shortcuts", "tab"], ["addons-shortcuts", "here"]] as const) {
    firefox.chrome_now += 2000;
    assert.deepEqual(await ask({ page, where, tab_id: ids.a }), { ok: false, error: "This Firefox cannot open that page" }, `${page} ${where}`);
  }
  assert.equal(typeof firefox.Services.desertfox_browser_module, "object");
});
