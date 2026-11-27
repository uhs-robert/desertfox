// Hints on Firefox's own pages in the parent process (browser_module/desertfox-chrome-hints.js, the page place): about:preferences, about:addons, about:config and the rest of its allowlist.
// It drives the security rules of that place: a session starts only from the user's own hint key (a token used once), a pick runs only when the user's keys spelled its label, a grant and every about:config write wait for the user's Enter,
// the Enter note carries its own look, and a new tab or a copy takes only a web address, which never leaves the module.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { key_event } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import { box, button, chrome_document, chrome_window, plain, settle, started } from "./chrome_windows.ts";
import type { Firefox } from "./chrome_windows.ts";

const PAGE_LAYER = "desertfox-page-hints";
// How long a grant's mark shows before an Enter counts: Firefox's `security.notification_enable_delay` when unset.
const DWELL_MS = 500;

type Opened = { address: string; options: { inBackground: boolean; triggeringPrincipal: unknown } };

// A browser window whose selected tab shows `url` in this process, under the system principal. `build` fills the page. The page sits 80 px down, under the toolbars.
function about_page(firefox: Firefox, url: string, build: (root: Node) => void, { remote = false, principal = { isSystemPrincipal: true } as unknown } = {}) {
  const browser = Object.assign(new Node("browser", { box: box(0, 80, 1200, 700) }), { isRemoteBrowser: remote, innerWindowID: 10, contentDocument: undefined as unknown });
  const opened: Opened[] = [];
  const tabs = {
    selectedTab: { userContextId: 0 } as unknown,
    selectedBrowser: browser as unknown,
    addTab: (address: string, options: Opened["options"]) => (opened.push({ address, options }), { opened: address }),
  };
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10), browser));
  Object.assign(window.win, { gBrowser: tabs });
  const page_view = Object.assign(new Node("#pagewindow"), { browsingContext: { embedderElement: browser } });
  const page_root = new Node("html");
  build(page_root);
  const page = chrome_document(page_root, page_view, url);
  Object.assign(page.document, { nodePrincipal: principal });
  page.own();
  browser.contentDocument = page.document;
  window.own();
  const body = new Node("body");
  window.focus(body);
  Object.assign(body, { ownerDocument: page.document });
  return { ...window, browser, page_root, page_view, page: page.document, tabs, opened };
}

// An element of a page with a box in the page's own pixels.
const el = (local_name: string, left: number, top: number, props: Partial<Node> & Record<string, unknown> = {}) => Object.assign(new Node(local_name, { box: box(left, top) }), props);
const link = (href: string, left: number, top: number) => el("a", left, top, { href });
const field = (left: number, top: number) => {
  const node = Object.assign(el("input", left, top, { type: "search" }), { focused: 0 });
  return Object.assign(node, { focus: () => void node.focused++ });
};

type Page = ReturnType<typeof about_page>;

function start_on(url: string, build: (root: Node) => void, options: Parameters<typeof about_page>[3] = {}) {
  const run = started((firefox) => about_page(firefox, url, build, options), { state: { v: 1, enabled: true, keys: [], tabs: {}, page_hints: true } });
  const chrome = run.chrome as unknown as Page;
  const copied: string[] = [];
  run.firefox.Components.classes["@mozilla.org/widget/clipboardhelper;1"] = { getService: () => ({ copyString: (text: string) => copied.push(text) }) };
  Object.assign(run.firefox.Components.interfaces, { nsIClipboardHelper: {} });
  Object.assign(run.firefox.Services.scriptSecurityManager as object, { createNullPrincipal: (attrs: unknown) => ({ null_principal: attrs }) });
  const core = run.firefox.Services.desertfox_browser_module as { page_hints(): { handles(browser: unknown): boolean; start(args: unknown): boolean } | undefined };
  // The key taker's call on the user's hint key, with the key's own event.
  const hint_key = (keys = "f", count = 0, event = key_event("f")) => core.page_hints()!.start({ window: chrome.win, browser: chrome.browser, event, keys, count });
  const wants = () => run.pushes("page_hints.want");
  const collect = async (session: number, action = "follow", start = wants().at(-1)?.start as number) => {
    const id = run.send("page_hints.collect", { session, start, action, colors: "" });
    await settle();
    return run.reply(id);
  };
  // The targets of `session`, by the element each is at.
  const rows = (session: number) => run.pushes("chrome_hints.targets").filter((args) => args.session === session).flatMap((args) => JSON.parse(args.targets as string) as number[][]);
  const id_of = (session: number, element: Node) => rows(session).find(([, left, top]) => left === Math.round(element.box.left) && top === Math.round(element.box.top) + 80)?.[0];
  // Labels the session's targets "a", "b", ... in the order collected.
  const label_all = async (session: number) => {
    const labelled = rows(session).map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]);
    await run.draw(session, labelled);
    return new Map(labelled);
  };
  const page_layers = () => chrome.root.children.filter((child) => child.className === PAGE_LAYER);
  const marked = () => page_layers().some((host) => host.shadow!.descendants().some((node) => node.className === "desertfox-confirm"));
  return { ...run, chrome, copied, core, hint_key, wants, collect, rows, id_of, label_all, page_layers, marked };
}

// A session of `action` on the page, its targets labelled, and the user's keys for `element` typed so its pick may run.
async function labelled_session(run: ReturnType<typeof start_on>, session: number, action = "follow") {
  assert.equal(run.hint_key(), true);
  assert.equal((await run.collect(session, action))?.ok, true);
  const labels = await run.label_all(session);
  const pick = async (element: Node, typed = true) => {
    const id = run.id_of(session, element);
    assert.ok(id, `no label on ${element.id || element.localName}`);
    if (typed) run.chrome.press(labels.get(id)!);
    return run.pick(session, id);
  };
  return { labels, pick };
}

const preferences = () => {
  const parts = { toggle: el("moz-toggle", 20, 20), search: field(200, 20), learn_more: link("https://support.mozilla.org/kb/x", 20, 100), anchor: link("about:preferences#privacy", 200, 100) };
  return { parts, build: (root: Node) => root.append(...Object.values(parts)) };
};

test("the key taker's start asks the extension once with a token and holds the window's keys, and the collect for it labels the page's controls, links and fields in the page's own layer", async () => {
  const { parts, build } = preferences();
  const run = start_on("about:preferences", build);
  assert.equal(run.core.page_hints()!.handles(run.chrome.browser), true);
  assert.equal(run.hint_key("F", 3), true);
  assert.deepEqual(run.wants().map(({ keys, count }) => ({ keys, count })), [{ keys: "F", count: 3 }]);
  assert.ok(protocol.validate_message_list(run.from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
  assert.equal(run.held(), "chrome_hints");
  assert.deepEqual(await run.collect(5), { v: 1, reply_to: "r0", ok: true });
  assert.equal(run.rows(5).length, 4);
  for (const element of Object.values(parts)) assert.ok(run.id_of(5, element), `${element.localName} got no label`);
  assert.equal(run.page_layers().length, 1, "the labels are not in the window's own page layer");
  assert.equal(run.chrome.page_root.children.length, 4, "a label went into the page's own DOM");
  assert.equal((run.firefox.hello() as { page_hints?: true }).page_hints, true);
});

test("a token works once, only for a page collect, and only while fresh; a chrome collect_here with it opens nothing", async () => {
  const { build } = preferences();
  const run = start_on("about:preferences", build);
  run.hint_key();
  const token = run.wants()[0]!.start as number;
  assert.equal((await run.collect_here(5, token))?.error, "The hint key is stale", "a page token opened a chrome session");
  assert.equal((await run.collect(6, "follow", token))?.error, "The hint key is stale", "the token outlived its refused use");
  run.hint_key();
  const second = run.wants()[1]!.start as number;
  assert.equal((await run.collect(7, "follow", second))?.ok, true);
  assert.equal((await run.collect(8, "follow", second))?.error, "The hint key is stale");
  assert.equal((await run.collect(9, "follow", second + 1))?.error, "The hint key is stale", "a token the module never made opened a session");
  run.send("chrome_hints.clear", { session: 7 });
  await settle();
  run.hint_key();
  run.chrome.fire_timers();
  assert.equal(run.held(), undefined, "an unanswered start kept the window's keys");
  assert.equal((await run.collect(10))?.error, "The hint key is stale");
});

test("no start comes from a key a script made, from a page the module does not label, or from a page another process shows", () => {
  const { build } = preferences();
  const synthetic = start_on("about:preferences", build);
  assert.equal(synthetic.hint_key("f", 0, key_event("f", { isTrusted: false })), false);
  for (const [url, options] of [["about:support", {}], ["about:logins", {}], ["about:preferences", { remote: true }], ["about:preferences", { principal: { isSystemPrincipal: false } }]] as const) {
    const run = start_on(url, preferences().build, options);
    assert.equal(run.core.page_hints()!.handles(run.chrome.browser), false, `${url} ${JSON.stringify(options)}`);
    assert.equal(run.hint_key(), false, `${url} ${JSON.stringify(options)}`);
    assert.deepEqual(run.wants(), []);
    assert.equal(run.held(), undefined);
  }
  assert.deepEqual(synthetic.wants(), []);
});

test("the extension's refusal of the start ends it at once and gives the keys back", async () => {
  const run = start_on("about:preferences", preferences().build);
  run.hint_key("; v");
  const want = run.from_module().find((message) => message.kind === "page_hints.want") as unknown as { id: string };
  const list = (run.firefox.read_holder(protocol.BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as unknown[];
  run.firefox.extension_writes(protocol.BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [...list, { v: 1, reply_to: want.id, ok: false, error: "the request failed" }]);
  await settle();
  assert.equal(run.held(), undefined, "a refused start held the window's keys");
  assert.equal(run.chrome.press("j").prevented, false);
});

test("a pick runs only when the user's own keys spelled its label: a message alone, another label's keys or old keys click nothing", async () => {
  const { parts, build } = preferences();
  const run = start_on("about:preferences", build);
  const { pick } = await labelled_session(run, 5);
  assert.equal((await pick(parts.toggle, false))?.error, "The keys typed do not name this hint");
  assert.equal(parts.toggle.clicks, 0, "an extension's pick with no key clicked");
  assert.equal(run.held(), undefined, "a refused pick left the session holding the keys");

  const other = start_on("about:preferences", preferences().build);
  const second = await labelled_session(other, 6);
  const toggle = other.chrome.page_root.children[0]!;
  const id = other.id_of(6, toggle)!;
  // "b" spells another target's label.
  other.chrome.press(second.labels.get(id) === "a" ? "b" : "a");
  assert.equal((await other.pick(6, id))?.error, "The keys typed do not name this hint");
  assert.equal(toggle.clicks, 0);

  const late = start_on("about:preferences", preferences().build);
  const third = await labelled_session(late, 7);
  const late_toggle = late.chrome.page_root.children[0]!;
  const late_id = late.id_of(7, late_toggle)!;
  late.chrome.press(third.labels.get(late_id)!);
  late.chrome.clock.now += 3000;
  assert.equal((await late.pick(7, late_id))?.error, "The keys typed do not name this hint", "keys typed long before the pick still counted");
  assert.equal(late_toggle.clicks, 0);

  const right = start_on("about:preferences", preferences().build);
  const fourth = await labelled_session(right, 8);
  const right_toggle = right.chrome.page_root.children[0]!;
  assert.equal((await fourth.pick(right_toggle))?.ok, true);
  assert.equal(right_toggle.clicks, 1, "the user's own keys did not click");
});

test("Backspace takes a typed letter back, a letter that continues no label changes nothing, and a later draw may not swap labels", async () => {
  const run = start_on("about:preferences", preferences().build);
  run.hint_key();
  await run.collect(5);
  const rows = run.rows(5);
  const [first, second] = [rows[0]![0]!, rows[1]![0]!];
  await run.draw(5, rows.map(([id], index) => [id!, ["aa", "ab", "ba", "bb"][index]!]));
  for (const key of ["a", "z", "Backspace", "b", "a"]) run.chrome.press(key);
  // Typed now: "ba", the third label. The extension's draw that gives the first target "ba" is dropped.
  await run.draw(5, [[first, "ba"], [second, "aa"]], 2);
  assert.equal((await run.pick(5, first))?.error, "The keys typed do not name this hint");
  const again = start_on("about:preferences", preferences().build);
  again.hint_key();
  await again.collect(6);
  const target = again.rows(6)[2]![0]!;
  await again.draw(6, again.rows(6).map(([id], index) => [id!, ["aa", "ab", "ba", "bb"][index]!]));
  for (const key of ["a", "Backspace", "b", "a"]) again.chrome.press(key);
  assert.equal((await again.pick(6, target))?.ok, true);
});

test("a first draw with two targets under one label shows nothing", async () => {
  const run = start_on("about:preferences", preferences().build);
  run.hint_key();
  await run.collect(5);
  await run.draw(5, run.rows(5).map(([id]) => [id!, "a"]));
  const labels = run.page_layers()[0]!.shadow!.children.find((child) => child.className === "desertfox-hints")!.children;
  assert.equal(labels.length, 0);
});

test("a field pick focuses it and ends the session, so the bar can say INSERT and Escape is #1027's again; while the session runs, Escape ends it here", async () => {
  const { parts, build } = preferences();
  const run = start_on("about:preferences", build);
  const { pick } = await labelled_session(run, 5);
  assert.equal((await pick(parts.search))?.ok, true);
  assert.equal(parts.search.focused, 1);
  assert.equal(run.held(), undefined);
  assert.equal(run.page_layers().length, 0, "the page layer outlived the pick, so the bar keeps HINT");

  const escape = start_on("about:preferences", preferences().build);
  await labelled_session(escape, 6);
  const event = escape.chrome.press("Escape");
  assert.ok(event.prevented && event.stopped, "the session's Escape went on to the core, which would blur a field");
  assert.equal(escape.held(), undefined);
  assert.equal(escape.page_layers().length, 0);
  assert.deepEqual(escape.pushes("chrome_hints.end").map((args) => args.session), [6]);
});

test("a click on the page, a tab switch and the page going away each end the start and the session", async () => {
  for (const end of ["mousedown", "pagehide", "TabSelect"]) {
    for (const phase of ["start", "session"]) {
      const run = start_on("about:preferences", preferences().build);
      run.hint_key();
      if (phase === "session") assert.equal((await run.collect(5))?.ok, true);
      if (end === "TabSelect") run.chrome.win.fire(end);
      else run.chrome.page_view.fire(end);
      assert.equal(run.held(), undefined, `${end} during the ${phase}`);
      assert.equal(run.page_layers().length, 0, `${end} during the ${phase}`);
    }
  }
});

test("a collect for a page that changed since the key opens nothing", async () => {
  const run = start_on("about:preferences", preferences().build);
  run.hint_key();
  run.chrome.browser.innerWindowID = 11;
  assert.equal((await run.collect(5))?.error, "The page changed");
  assert.equal(run.page_layers().length, 0);
});

test("on about:addons a grant control and Remove only mark the control, and the user's own Enter in that window clicks it", async () => {
  const permission = el("moz-toggle", 20, 20);
  permission.setAttribute("permission-key", "history");
  const private_allow = el("input", 20, 60, { type: "radio", name: "private-browsing" });
  private_allow.setAttribute("type", "radio");
  const remove = el("panel-item", 20, 100);
  remove.setAttribute("action", "remove");
  const remove_button = el("button", 20, 100);
  remove.openOrClosedShadowRoot = Object.assign(new Node("#shadow"), { host: remove });
  remove.openOrClosedShadowRoot.append(remove_button);
  const enable = el("moz-toggle", 20, 140);
  const parts = { permission, private_allow, remove_button, enable };
  for (const target of [permission, private_allow, remove_button]) {
    const run = start_on("about:addons", (root) => root.append(permission, private_allow, remove, enable));
    const { pick } = await labelled_session(run, 5);
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 0, `a pick of ${target.localName} granted with no Enter`);
    assert.ok(run.marked(), `no mark on ${target.localName}`);
    run.chrome.press("Enter", { isTrusted: false });
    assert.equal(target.clicks, 0, "a synthetic Enter granted");
    run.chrome.clock.now += DWELL_MS;
    assert.ok(run.chrome.press("Enter").prevented);
    assert.equal(target.clicks, 1, `the user's Enter did not click ${target.localName}`);
    assert.equal(run.held(), undefined);
    target.clicks = 0;
  }
  const run = start_on("about:addons", (root) => root.append(permission, private_allow, remove, enable));
  const { pick } = await labelled_session(run, 6);
  assert.equal((await pick(parts.enable))?.ok, true);
  assert.equal(enable.clicks, 1, "the enable toggle, which grants nothing, waited for Enter");
});

test("the Enter note takes no sheet and no theme from the extension: its layer holds only the mark, styled inline", async () => {
  const permission = el("moz-toggle", 20, 20);
  permission.setAttribute("permission-key", "history");
  const run = start_on("about:addons", (root) => root.append(permission));
  const { pick } = await labelled_session(run, 5);
  await pick(permission);
  const host = run.page_layers()[0]!;
  const parts = host.shadow!.descendants();
  assert.equal(parts.filter((node) => node.localName === "link").length, 0, "the mark's layer links the extension's sheet");
  const note = parts.find((node) => node.className === "desertfox-hint")!;
  assert.equal(note.textContent, "Enter");
  assert.match(String(note.style.cssText), /background: #ffd000; color: #000000;.*visibility: visible; display: block;/);
  assert.equal(String(note.style.cssText).includes("var("), false, "the note reads a theme variable");
});

test("on about:config every write waits for Enter, the search box and the filter do not, and the risk warning's button never gets a label", async () => {
  const prefs = el("table", 0, 200, { id: "prefs" });
  const toggle = el("button", 20, 220, { className: "button-toggle" });
  const reset = el("button", 100, 220, { className: "button-reset" });
  const add = el("button", 180, 220, { className: "button-add" });
  prefs.append(toggle, reset, add);
  const search = field(20, 20);
  const only_modified = el("input", 300, 20);
  only_modified.setAttribute("type", "checkbox");
  Object.assign(only_modified, { type: "checkbox" });
  const warning = el("button", 400, 20, { id: "warningButton" });
  const build = (root: Node) => root.append(search, only_modified, warning, prefs);
  const run = start_on("about:config", build);
  assert.equal(run.hint_key(), true);
  await run.collect(5);
  assert.equal(run.id_of(5, warning), undefined, "the risk warning's button got a label");
  run.send("chrome_hints.clear", { session: 5 });
  await settle();
  for (const target of [toggle, reset, add]) {
    const each = start_on("about:config", build);
    const { pick } = await labelled_session(each, 6);
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 0, `${target.className} wrote with no Enter`);
    assert.ok(each.marked());
    each.chrome.clock.now += DWELL_MS;
    each.chrome.press("Enter");
    assert.equal(target.clicks, 1, `${target.className} did not run on Enter`);
  }
  const free = start_on("about:config", build);
  const { pick } = await labelled_session(free, 7);
  assert.equal((await pick(only_modified))?.ok, true);
  assert.equal(only_modified.clicks, 1, "the filter checkbox waited for Enter");
});

test("a tab, a background tab and a copy label only links to the web, take the address from the page, and open it with a null principal", async () => {
  const { parts, build } = preferences();
  for (const action of ["tab", "background", "yank"]) {
    const run = start_on("about:preferences", build);
    const { pick } = await labelled_session(run, 5, action);
    assert.deepEqual(run.rows(5).map(([id]) => id), [run.id_of(5, parts.learn_more)], `${action} labelled a control or an about: link`);
    assert.equal((await pick(parts.learn_more))?.ok, true);
    assert.equal(parts.learn_more.clicks, 0);
    if (action === "yank") {
      assert.deepEqual(run.copied, ["https://support.mozilla.org/kb/x"]);
      assert.deepEqual(run.chrome.opened, []);
    } else {
      assert.deepEqual(plain(run.chrome.opened.map(({ address, options }) => ({ address, background: options.inBackground, principal: options.triggeringPrincipal }))), [{ address: "https://support.mozilla.org/kb/x", background: action === "background", principal: { null_principal: { userContextId: 0 } } }]);
      assert.deepEqual((run.chrome.tabs.selectedTab as { opened?: string }).opened, action === "tab" ? "https://support.mozilla.org/kb/x" : undefined);
    }
    // No address went out: the module's messages hold ids, boxes and keys only.
    assert.equal(JSON.stringify(run.from_module()).includes("support.mozilla.org"), false, "the address crossed to the extension");
  }
  const none = start_on("about:preferences", (root) => root.append(link("about:preferences#privacy", 20, 20), link("javascript:alert(1)", 20, 60)));
  none.hint_key();
  assert.equal((await none.collect(5, "yank"))?.error, "Nothing to hint here");
});

test("about:downloads rows only get chosen, as in the Library, and the page's other actions follow the downloads list's own rules", async () => {
  const list = el("richlistbox", 0, 100, { id: "downloadsListBox" });
  const row = el("richlistitem", 10, 110);
  const main_area = el("div", 10, 110, { className: "downloadMainArea" });
  row.append(main_area);
  list.append(row);
  Object.assign(list, { selectedItem: null as unknown, focus: () => undefined, ensureElementIsVisible: () => undefined });
  const run = start_on("about:downloads", (root) => root.append(list));
  run.hint_key();
  await run.collect(5);
  const id = run.id_of(5, row)!;
  assert.ok(id, "the download row got no label");
  const labels = await run.label_all(5);
  run.chrome.press(labels.get(id)!);
  assert.equal((await run.pick(5, id))?.ok, true);
  assert.equal(run.marked(), false, "a row pick waits for Enter as in the downloads panel");
  assert.equal((list as unknown as { selectedItem: unknown }).selectedItem, row);
  assert.equal(main_area.clicks, 0, "a row pick opened the file");
});
