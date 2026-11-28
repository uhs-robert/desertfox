// Hints on Firefox's own pages in the parent process (browser_module/desertfox-chrome-hints.js, the page place): about:preferences, about:addons, about:config and the rest of its allowlist.
// It drives the security rules of that place: a session starts only from the user's own hint key (a token used once), a pick runs only when the user's keys spelled its label, a grant and every about:config write wait for the user's Enter,
// the Enter note carries its own look, and a new tab or a copy takes only a web address, which never leaves the module.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { key_event } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import { box, browser_with_dialog, button, chrome_document, chrome_window, plain, settle, started } from "./chrome_windows.ts";
import type { Firefox } from "./chrome_windows.ts";

const PAGE_LAYER = "desertfox-page-hints";
// How long a grant's mark shows before an Enter counts: Firefox's `security.notification_enable_delay` when unset.
const DWELL_MS = 500;
// How long after the first labels show a key starts to count toward one.
const SEEN_MS = 300;

type Opened = { address: string; options: { inBackground: boolean; triggeringPrincipal: unknown } };

// A browser window whose selected tab shows `url` in this process, under the system principal. `build` fills the page. The page sits 80 px down, under the toolbars.
function about_page(firefox: Firefox, url: string, build: (root: Node) => void, { remote = false, principal = { isSystemPrincipal: true } as unknown, zoom = 1, browser_box = box(0, 80, 1200, 700) } = {}) {
  const browser = Object.assign(new Node("browser", { box: browser_box }), { isRemoteBrowser: remote, innerWindowID: 10, contentDocument: undefined as unknown });
  const opened: Opened[] = [];
  const tabs = {
    selectedTab: { userContextId: 0 } as unknown,
    selectedBrowser: browser as unknown,
    addTab: (address: string, options: Opened["options"]) => (opened.push({ address, options }), { opened: address }),
  };
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10), browser));
  Object.assign(window.win, { gBrowser: tabs });
  const page_view = Object.assign(new Node("#pagewindow"), { browsingContext: { embedderElement: browser, fullZoom: zoom } });
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

function start_on(url: string, build: (root: Node) => void, options: Parameters<typeof about_page>[3] = {}, more_state: Record<string, unknown> = {}) {
  const run = started((firefox) => about_page(firefox, url, build, options), { state: { v: 1, enabled: true, keys: [], tabs: {}, page_hints: true, ...more_state } });
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
    chrome.clock.now += SEEN_MS;
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
  for (const [url, options] of [["about:support", {}], ["about:logins", {}], ["about:memory", {}], ["about:crashes", {}], ["about:profiling", {}], ["about:preferences", { remote: true }], ["about:preferences", { principal: { isSystemPrincipal: false } }]] as const) {
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
  run.chrome.clock.now += SEEN_MS;
  for (const key of ["a", "z", "Backspace", "b", "a"]) run.chrome.press(key);
  // Typed now: "ba", the third label. The extension's draw that gives the first target "ba" is dropped.
  await run.draw(5, [[first, "ba"], [second, "aa"]], 2);
  assert.equal((await run.pick(5, first))?.error, "The keys typed do not name this hint");
  const again = start_on("about:preferences", preferences().build);
  again.hint_key();
  await again.collect(6);
  const target = again.rows(6)[2]![0]!;
  await again.draw(6, again.rows(6).map(([id], index) => [id!, ["aa", "ab", "ba", "bb"][index]!]));
  again.chrome.clock.now += SEEN_MS;
  for (const key of ["a", "Backspace", "b", "a"]) again.chrome.press(key);
  assert.equal((await again.pick(6, target))?.ok, true);
});

test("a first draw with two targets under one label, or one label the start of another, shows nothing and picks nothing", async () => {
  for (const labels of [["a", "a", "b", "c"], ["a", "ab", "b", "c"]]) {
    const run = start_on("about:preferences", preferences().build);
    run.hint_key();
    await run.collect(5);
    const rows = run.rows(5);
    await run.draw(5, rows.map(([id], index) => [id!, labels[index]!]));
    const shown = run.page_layers()[0]!.shadow!.children.find((child) => child.className === "desertfox-hints")!.children;
    assert.equal(shown.length, 0, `labels ${labels.join(" ")} were drawn`);
    run.chrome.clock.now += SEEN_MS;
    run.chrome.press("a");
    // The user types "a" on the way to "ab", and the extension names the target of "a".
    assert.equal((await run.pick(5, rows[0]![0]!))?.ok, false, `labels ${labels.join(" ")}`);
    assert.equal(run.chrome.page_root.children[0]!.clicks, 0, `labels ${labels.join(" ")}: the pick clicked`);
  }
});

test("keys typed before the labels showed, or at once after, spell no label", async () => {
  for (const before_draw of [true, false]) {
    const run = start_on("about:preferences", preferences().build);
    run.hint_key();
    await run.collect(5);
    const rows = run.rows(5);
    const labelled = rows.map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]);
    if (before_draw) run.chrome.press("a");
    await run.draw(5, labelled);
    if (!before_draw) run.chrome.press("a");
    assert.equal((await run.pick(5, rows[0]![0]!))?.error, "The keys typed do not name this hint", before_draw ? "a key typed before the first draw counted" : "a key typed as the labels drew counted");
    assert.equal(run.chrome.page_root.children[0]!.clicks, 0);
  }
});

test("a held key or steady taps past the labels' first moments spell nothing; a key after a pause with the labels shown does", async () => {
  for (const kind of ["held", "tapped", "paused"]) {
    const run = start_on("about:preferences", preferences().build);
    run.hint_key();
    await run.collect(5);
    const rows = run.rows(5);
    await run.draw(5, rows.map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]));
    if (kind === "paused") run.chrome.clock.now += SEEN_MS;
    else {
      // A key every 100 ms runs past the first 300 ms after the draw.
      for (let at = 0; at < 4; at++) {
        run.chrome.press("j", { repeat: kind === "held" && at > 0 });
        run.chrome.clock.now += 100;
      }
    }
    run.chrome.press("a", { repeat: kind === "held" });
    const result = await run.pick(5, rows[0]![0]!);
    if (kind === "paused") assert.equal(result?.ok, true, "a key after a pause did not spell");
    else assert.equal(result?.error, "The keys typed do not name this hint", `a ${kind} key spelled a label`);
  }
});

test("a page's labels take no sheet and no theme from the extension: each is styled inline in a layer with no link", async () => {
  const run = start_on("about:preferences", preferences().build);
  run.hint_key();
  run.send("page_hints.collect", { session: 5, start: run.wants()[0]!.start, action: "follow", colors: JSON.stringify({ dark: { primary: "#ff0000" } }) });
  await settle();
  await run.label_all(5);
  const host = run.page_layers()[0]!;
  const parts = host.shadow!.descendants();
  assert.equal(parts.filter((node) => node.localName === "link").length, 0, "the page layer links the extension's sheet");
  assert.equal((host.shadow as unknown as { adoptedStyleSheets?: unknown[] }).adoptedStyleSheets, undefined, "the page layer took the theme");
  const label = parts.find((node) => node.className === "desertfox-hint")!;
  assert.match(String(label.style.cssText), /position: fixed;.*background: #7fa3c9;/);
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
  const plain_toggle = el("moz-toggle", 20, 140);
  // Enabling an add-on again, undoing its removal and always activating a plugin.
  const [enable, undo, activate] = ["toggle-disabled", "undo", "always-activate"].map((action, index) => {
    const control = el("moz-button", 300, 20 + 40 * index);
    control.setAttribute("action", action);
    return control;
  });
  const parts = { permission, private_allow, remove_button, plain_toggle };
  const build = (root: Node) => root.append(permission, private_allow, remove, plain_toggle, enable!, undo!, activate!);
  for (const target of [permission, private_allow, remove_button, enable!, undo!, activate!]) {
    const run = start_on("about:addons", build);
    const { pick } = await labelled_session(run, 5);
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 0, `a pick of ${target.localName} ${target.getAttribute("action") ?? ""} granted with no Enter`);
    assert.ok(run.marked(), `no mark on ${target.localName}`);
    run.chrome.press("Enter", { isTrusted: false });
    assert.equal(target.clicks, 0, "a synthetic Enter granted");
    run.chrome.clock.now += DWELL_MS;
    assert.ok(run.chrome.press("Enter").prevented);
    assert.equal(target.clicks, 1, `the user's Enter did not click ${target.localName}`);
    assert.equal(run.held(), undefined);
    target.clicks = 0;
  }
  const run = start_on("about:addons", build);
  const { pick } = await labelled_session(run, 6);
  assert.equal((await pick(parts.plain_toggle))?.ok, true);
  assert.equal(plain_toggle.clicks, 1, "a toggle that grants nothing waited for Enter");
});

test("a click in the page or the page going away ends a grant's mark, so a later Enter grants nothing", async () => {
  for (const end of ["mousedown", "pagehide"]) {
    const permission = el("moz-toggle", 20, 20);
    permission.setAttribute("permission-key", "history");
    const run = start_on("about:addons", (root) => root.append(permission));
    const { pick } = await labelled_session(run, 5);
    await pick(permission);
    assert.ok(run.marked());
    run.chrome.page_view.fire(end);
    assert.equal(run.marked(), false, `${end} left the mark`);
    assert.equal(run.held(), undefined, `${end} left the keys held`);
    run.chrome.clock.now += DWELL_MS;
    run.chrome.press("Enter");
    assert.equal(permission.clicks, 0, `an Enter after ${end} granted`);
  }
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

test("on a zoomed page a label sits on its link in the window's pixels, and a link the zoom pushes out of the window gets none", async () => {
  const near = link("https://example.com/near", 100, 100);
  const far = link("https://example.com/far", 100, 500);
  // At 1.5 the page's 500 px is 750 px under the page's own top at 80, past the 800 px window.
  const run = start_on("about:addons", (root) => root.append(near, far), { zoom: 1.5 });
  assert.equal(run.hint_key(), true);
  assert.equal((await run.collect(5))?.ok, true);
  const [row, ...rest] = run.rows(5);
  assert.deepEqual(rest, [], "the link past the window got a label");
  assert.deepEqual([row![1], row![2]], [150, 230], "the label is not at the zoomed place of the link");
});

test("a page beside vertical tabs keeps its labels on the links", async () => {
  const link_in_page = link("https://example.com/a", 100, 100);
  const run = start_on("about:addons", (root) => root.append(link_in_page), { browser_box: box(220, 80, 980, 700) });
  assert.equal(run.hint_key(), true);
  assert.equal((await run.collect(5))?.ok, true);
  assert.deepEqual(run.rows(5).map((row) => [row[1], row[2]]), [[320, 180]]);
});

test("a settings sub-dialog in a page zoomed to 1.5 scales its boxes once, since the dialog shares the page's zoom", async () => {
  const run = started((firefox) => browser_with_dialog(firefox, { nested: true }));
  const chrome = run.chrome as unknown as { dialog_view: { browsingContext: { fullZoom?: number } }; frame: { ownerDocument: { defaultView: { browsingContext: { fullZoom?: number } } } } };
  chrome.dialog_view.browsingContext.fullZoom = 1.5;
  chrome.frame.ownerDocument.defaultView.browsingContext.fullZoom = 1.5;
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  // The accept button is at (200, 150) in the dialog, the dialog at (300, 200) in the page, the page at (0, 80) in the window.
  assert.deepEqual(run.target_rows()[0]!.slice(1, 3), [Math.round((200 + 300) * 1.5), Math.round((150 + 200) * 1.5 + 80)]);
});

test("a link whose text sits in a slot of its host's shadow root is labelled, as a nav link of about:addons is", async () => {
  const host = new Node("moz-page-nav-button", { box: box(40, 300, 200, 40) });
  const shadow = new Node("#shadow");
  const nav_link = el("a", 40, 300, { href: "about:preferences" });
  nav_link.box = box(40, 300, 200, 40);
  const slot = new Node("slot");
  nav_link.append(slot);
  shadow.append(nav_link);
  host.openOrClosedShadowRoot = shadow;
  shadow.host = host;
  const text = Object.assign(new Node("span", { box: box(40, 300, 200, 40) }), { assignedSlot: slot });
  host.append(text);
  // The page's hit test finds the slotted text, as Firefox does, not the link under it.
  nav_link.setAttribute("covered", "");
  const run = start_on("about:addons", (root) => root.append(host));
  assert.equal(run.hint_key(), true);
  assert.equal((await run.collect(5))?.ok, true);
  assert.equal(run.rows(5).length, 1, "the nav link got no label");
});

// ---- Hint mode keys: text mode (`/`), Tab, Enter, the key line and the remapped keys, with an extension whose state says it runs them.

const PICKER_STATE = { hint_mode_keys: [] as unknown[] };
const GRACE_MS = 300;

// Four controls with texts: "Dark mode", "Privacy", "Print" and "Learn more".
function texted() {
  const parts = { dark: el("moz-toggle", 20, 20, { text: "Dark mode" }), privacy: link("about:preferences#privacy", 200, 20), print: el("button", 400, 20, { text: "Print" }), learn: link("https://support.mozilla.org/kb/x", 20, 100) };
  parts.privacy.text = "Privacy";
  parts.learn.text = "Learn more";
  return { parts, build: (root: Node) => root.append(...Object.values(parts)) };
}

async function text_mode_run(more_state: Record<string, unknown> = PICKER_STATE) {
  const { parts, build } = texted();
  const run = start_on("about:preferences", build, {}, more_state);
  const { labels, pick } = await labelled_session(run, 5);
  const type = (...keys: string[]) => keys.forEach((key) => run.chrome.press(key));
  const pick_id = (element: Node) => run.pick(5, run.id_of(5, element)!);
  const layer_box = () => run.page_layers()[0]!.shadow!.children[0]!;
  // A draw of `shown`, each with its label of the first draw.
  const draw_text = async (gen: number, shown: Node[], fields: Record<string, unknown>) => {
    const rows = shown.map((element) => [run.id_of(5, element)!, labels.get(run.id_of(5, element)!)!]);
    run.send("chrome_hints.draw", { session: 5, gen, part: 0, parts: 1, typed: "", labels: JSON.stringify(rows), ...fields });
    await settle();
  };
  return { ...run, parts, labels, pick, type, pick_id, layer_box, draw_text };
}

test("with hint mode keys each target's text goes out cut and stripped, a field gives its name only, and an extension without them gets no texts", async () => {
  const save = el("button", 20, 20, { text: "  Save\u202e   changes\n" });
  const long = el("button", 200, 20, { text: "x".repeat(100) });
  const search = Object.assign(field(400, 20), { value: "my secret" });
  search.setAttribute("placeholder", "Search settings");
  const blank = el("moz-toggle", 20, 100);
  const build = (root: Node) => root.append(save, long, search, blank);
  const run = start_on("about:preferences", build, {}, PICKER_STATE);
  run.hint_key();
  await run.collect(5);
  const texts = run.pushes("chrome_hints.texts");
  assert.ok(protocol.validate_message_list(run.from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
  assert.deepEqual(texts.map(({ part, parts }) => [part, parts]), [[0, 1]]);
  const by_id = new Map(JSON.parse(texts[0]!.texts as string) as [number, string][]);
  assert.equal(by_id.get(run.id_of(5, save)!), "Save changes");
  assert.equal(by_id.get(run.id_of(5, long)!), "x".repeat(protocol.CHROME_HINT_TEXT_CHARS));
  assert.equal(by_id.get(run.id_of(5, search)!), "Search settings", "a field's typed text left the page");
  assert.equal(by_id.has(run.id_of(5, blank)!), false);
  assert.equal((run.firefox.hello() as { hint_mode_keys?: true }).hint_mode_keys, true);

  const older = start_on("about:preferences", build);
  older.hint_key();
  await older.collect(5);
  assert.deepEqual(older.pushes("chrome_hints.texts"), [], "texts went to an extension that does not run text mode");
});

test("Shift-Tab goes out as its own token beside the event's key, and Space as <Space>", async () => {
  const run = await text_mode_run();
  run.chrome.press("Tab", { shiftKey: true });
  run.chrome.press(" ");
  assert.deepEqual(run.pushes("chrome_hints.key").map(({ key, token }) => [key, token]), [["Tab", "<S-Tab>"], [" ", "<Space>"]]);
});

test("a text mode pick runs only on a target whose own text matches the typed text, after Enter or a character that left it the one match", async () => {
  const enter = await text_mode_run();
  enter.type("/", "p", "r");
  await enter.draw_text(2, [enter.parts.print, enter.parts.privacy], { query: "pr", active: enter.id_of(5, enter.parts.print)! });
  enter.type("Enter");
  assert.equal((await enter.pick_id(enter.parts.print))?.ok, true);
  assert.equal(enter.parts.print.clicks, 1, "Enter on a match did not pick it");

  const no_enter = await text_mode_run();
  no_enter.type("/", "p", "r");
  assert.equal((await no_enter.pick_id(no_enter.parts.print))?.error, "The keys typed do not name this hint", "a pick of one of two matches ran with no Enter");
  assert.equal(no_enter.parts.print.clicks, 0);

  const unique = await text_mode_run();
  unique.type("/", "p", "r", "i", "n");
  assert.equal((await unique.pick_id(unique.parts.print))?.ok, true);

  const other = await text_mode_run();
  other.type("/", "p", "r", "i", "n");
  assert.equal((await other.pick_id(other.parts.dark))?.error, "The keys typed do not name this hint", "a target the typed text does not match was clicked");
  assert.equal(other.parts.dark.clicks, 0);

  const wrong_enter = await text_mode_run();
  wrong_enter.type("/", "p", "r", "Enter");
  assert.equal((await wrong_enter.pick_id(wrong_enter.parts.learn))?.error, "The keys typed do not name this hint");

  const back = await text_mode_run();
  back.type("/", "Backspace");
  const label = back.labels.get(back.id_of(5, back.parts.print)!)!;
  back.type(label);
  assert.equal((await back.pick_id(back.parts.print))?.ok, true, "Backspace on empty text did not go back to labels");

  const no_table = await text_mode_run({});
  no_table.type("/", "p", "r", "i", "n");
  assert.equal((await no_table.pick_id(no_table.parts.print))?.error, "The keys typed do not name this hint", "an older extension's label pick after / was taken as text");
});

test("an Enter pick in text mode runs only on the match drawn active when Enter came, even after a later draw moves it", async () => {
  // `/` and Enter on empty text, with Print drawn active at Enter and Privacy after it. A pick ends the session, so each pick gets its own.
  const after_enter = async () => {
    const run = await text_mode_run();
    run.type("/");
    await run.draw_text(2, [run.parts.print, run.parts.privacy], { query: "", active: run.id_of(5, run.parts.print)! });
    run.type("Enter");
    await run.draw_text(3, [run.parts.print, run.parts.privacy], { query: "", active: run.id_of(5, run.parts.privacy)! });
    return run;
  };
  for (const name of ["privacy", "dark"] as const) {
    const run = await after_enter();
    assert.equal((await run.pick_id(run.parts[name]))?.error, "The keys typed do not name this hint", `${name}, a match the user did not see active, was picked`);
    assert.equal(run.parts[name].clicks, 0);
  }
  const run = await after_enter();
  assert.equal((await run.pick_id(run.parts.print))?.ok, true);
  assert.equal(run.parts.print.clicks, 1, "the match drawn active was refused");
});

test("a text mode pick of a control that grants still waits for the user's Enter", async () => {
  const permission = el("moz-toggle", 20, 20, { text: "History" });
  permission.setAttribute("permission-key", "history");
  const other = el("moz-toggle", 200, 20, { text: "Other" });
  const run = start_on("about:addons", (root) => root.append(permission, other), {}, PICKER_STATE);
  await labelled_session(run, 5);
  for (const key of ["/", "h", "i"]) run.chrome.press(key);
  assert.equal((await run.pick(5, run.id_of(5, permission)!))?.ok, true);
  assert.equal(permission.clicks, 0, "a unique text match granted with no Enter");
  assert.ok(run.marked());
  run.chrome.clock.now += DWELL_MS;
  run.chrome.press("Enter");
  assert.equal(permission.clicks, 1);
});

test("letters right after a character's pick are dropped for a moment, and none after an Enter pick", async () => {
  const run = await text_mode_run();
  run.type("/");
  await run.draw_text(2, [run.parts.print], { query: "" });
  run.type("p", "r", "i", "n");
  await run.pick_id(run.parts.print);
  assert.ok(run.chrome.press("t").prevented, "the rest of the word went to the page");
  assert.equal(run.chrome.press("t", { ctrlKey: true }).prevented, false, "a chord was dropped");
  run.chrome.clock.now += GRACE_MS + 1;
  assert.equal(run.chrome.press("j").prevented, false, "the grace outlived its time");

  const enter = await text_mode_run();
  enter.type("/");
  await enter.draw_text(2, [enter.parts.print], { query: "", active: enter.id_of(5, enter.parts.print)! });
  enter.type("p", "r", "Enter");
  await enter.pick_id(enter.parts.print);
  assert.equal(enter.chrome.press("j").prevented, false, "an Enter pick dropped the next key");
});

test("a text mode draw shows the typed text, swaps the active label's colors and shows the key line, all inline and as text", async () => {
  const run = await text_mode_run();
  const print = run.id_of(5, run.parts.print)!;
  await run.draw_text(2, [run.parts.print, run.parts.privacy], { query: "<b>pr", active: print, key_line: 1 });
  const nodes = run.layer_box().children;
  const query = nodes.find((node) => node.className === "desertfox-hint-text")!;
  assert.equal(query.textContent, "text: <b>pr");
  assert.equal(query.children.length, 0, "the typed text became markup");
  assert.equal(nodes.find((node) => node.className === "desertfox-hint-keys")!.textContent, "Enter: pick \u00b7 Tab: next \u00b7 Backspace: labels");
  const labels = nodes.filter((node) => node.className === "desertfox-hint");
  assert.match(String(labels[0]!.style.cssText), /background: #0c0e13; color: #7fa3c9;$/);
  assert.doesNotMatch(String(labels[1]!.style.cssText), /background: #0c0e13/);
  for (const node of nodes) assert.equal(String(node.style.cssText).includes("var("), false, "a page's text mode reads a theme variable");
  await run.draw_text(3, [run.parts.print, run.parts.privacy], { key_line: 1 });
  assert.equal(run.layer_box().children.find((node) => node.className === "desertfox-hint-keys")!.textContent, "/: type text \u00b7 Tab: turn labels");
  assert.equal(run.layer_box().children.some((node) => node.className === "desertfox-hint-text"), false);
  for (const [fields, why] of [[{ query: "a\u202eb" }, "a format character"], [{ query: "q".repeat(65) }, "a long query"], [{ active: 999999 }, "an active id of no target"], [{ key_line: 2 }, "a key line value"]] as const) {
    await run.draw_text(4, [run.parts.print], fields);
    assert.equal(run.layer_box().children.filter((node) => node.className === "desertfox-hint").length, 2, `a draw with ${why} showed`);
  }
});

test("Tab in label mode turns overlapping labels here, Shift-Tab back, and in text mode Tab only goes to the extension", async () => {
  const run = await text_mode_run();
  const labels = () => run.layer_box().children.filter((node) => node.className === "desertfox-hint");
  const [first, second, third] = labels();
  for (const node of [first!, second!]) node.box = box(10, 10, 20, 14);
  third!.box = box(300, 10, 20, 14);
  run.chrome.press("Tab");
  assert.deepEqual(labels().slice(0, 3), [second, first, third]);
  run.chrome.press("Tab", { shiftKey: true });
  assert.deepEqual(labels().slice(0, 3), [first, second, third]);
  assert.equal(run.pushes("chrome_hints.key").length, 2, "Tab did not also go to the extension");
  run.type("/");
  await run.draw_text(2, [run.parts.dark, run.parts.privacy], { query: "" });
  const order = labels();
  for (const node of order) node.box = box(10, 10, 20, 14);
  run.chrome.press("Tab");
  assert.deepEqual(labels(), order, "Tab in text mode turned labels");
});

test("a key the hint keymap binds to mode.escape ends the session, one bound to help.whichkey is taken, an unbound chord ends it and goes on, and plain Escape always ends", async () => {
  const state = { hint_mode_keys: [{ key: "<C-c>", op: "escape" }, { key: "<F1>", op: "whichkey" }] };
  const remapped = await text_mode_run(state);
  const f1 = remapped.chrome.press("F1");
  assert.ok(f1.prevented && f1.stopped, "the which-key key went on");
  assert.equal(remapped.page_layers().length, 1, "the which-key key ended the session");
  assert.deepEqual(remapped.pushes("chrome_hints.key"), [], "the which-key key went to the extension as a hint key");
  const escape = remapped.chrome.press("c", { ctrlKey: true });
  assert.ok(escape.prevented, "the remapped Escape went on");
  assert.equal(remapped.page_layers().length, 0);
  assert.deepEqual(remapped.pushes("chrome_hints.end"), [{ session: 5 }]);
  assert.equal(remapped.held(), undefined);

  const chord = await text_mode_run(state);
  assert.equal(chord.chrome.press("x", { ctrlKey: true }).prevented, false, "an unbound chord was taken");
  assert.equal(chord.page_layers().length, 0);

  const plain_escape = await text_mode_run({ hint_mode_keys: [] });
  assert.ok(plain_escape.chrome.press("Escape").prevented);
  assert.equal(plain_escape.page_layers().length, 0, "plain Escape left the session with no Escape row");
});

// A row of Firefox View: its link and its buttons sit in the open shadow root of the row, and a moz-button carries its class on the host.
function view_row(top: number, href: string) {
  const row = el("fxview-tab-row", 20, top);
  const shadow = Object.assign(new Node("#shadow"), { host: row });
  const main = link(href, 20, top);
  const options = el("moz-button", 300, top, { className: "fxview-tab-row-button options-button" });
  const dismiss = el("moz-button", 340, top, { className: "fxview-tab-row-button dismiss-button" });
  shadow.append(main, options, dismiss);
  row.openOrClosedShadowRoot = shadow;
  return { row, main, options, dismiss };
}

test("the pages of the allowlist's later rows are labelled in the parent process and only there", () => {
  for (const url of ["about:firefoxview", "about:firefoxview#history", "about:opentabs", "about:policies", "about:unloads", "about:telemetry"]) {
    const run = start_on(url, () => {});
    assert.equal(run.core.page_hints()!.handles(run.chrome.browser), true, url);
    for (const options of [{ remote: true }, { principal: { isSystemPrincipal: false } }]) {
      const other = start_on(url, () => {}, options);
      assert.equal(other.core.page_hints()!.handles(other.chrome.browser), false, `${url} ${JSON.stringify(options)}`);
    }
  }
});

test("on about:firefoxview a row's link and options button click at once, its dismiss button waits for Enter, and F and the copy take only a web link", async () => {
  const web = view_row(100, "https://a.test/x");
  const internal = view_row(160, "about:preferences");
  const build = (root: Node) => root.append(web.row, internal.row);
  // A pick that clicks ends its session, so each target gets its own.
  for (const target of [web.main, web.options]) {
    const run = start_on("about:firefoxview", build);
    const { pick } = await labelled_session(run, 5);
    assert.equal(run.rows(5).length, 6, "a row's link or buttons got no label");
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 1, `a pick of ${target.localName} waited`);
  }
  const run = start_on("about:firefoxview", build);
  const { pick } = await labelled_session(run, 5);
  assert.equal((await pick(web.dismiss))?.ok, true);
  assert.equal(web.dismiss.clicks, 0, "a dismiss button clicked with no Enter");
  assert.ok(run.marked(), "no mark on the dismiss button");
  run.chrome.clock.now += DWELL_MS;
  assert.ok(run.chrome.press("Enter").prevented);
  assert.equal(web.dismiss.clicks, 1, "the user's Enter did not dismiss");

  for (const action of ["background", "yank"]) {
    const links = start_on("about:firefoxview", build);
    links.hint_key();
    assert.equal((await links.collect(6, action))?.ok, true);
    assert.deepEqual(links.rows(6).map(([id]) => id), [links.id_of(6, web.main)], `${action} labelled a control or an about: link`);
  }
});

test("on about:unloads the Unload button waits for Enter and the rest of the allowlist's new pages click at once", async () => {
  const unload = el("button", 20, 20, { id: "button-unload" });
  const run = start_on("about:unloads", (root) => root.append(unload));
  const { pick } = await labelled_session(run, 5);
  assert.equal((await pick(unload))?.ok, true);
  assert.equal(unload.clicks, 0, "Unload ran with no Enter");
  assert.ok(run.marked());
  for (const url of ["about:opentabs", "about:policies", "about:telemetry"]) {
    const row = view_row(100, "https://a.test/");
    const target = row.main;
    const plain_run = start_on(url, (root) => root.append(row.row));
    const session = await labelled_session(plain_run, 6);
    assert.equal((await session.pick(target))?.ok, true);
    assert.equal(target.clicks, 1, `${url}: a pick waited`);
  }
});

test("on about:firefoxview the sync button, a history or chat delete item and a send to device item wait for Enter, and another menu item clicks at once", async () => {
  // A menu item holds its button in its own shadow root.
  const item = (top: number, attributes: Record<string, string>) => {
    const panel_item = el("panel-item", 20, top);
    for (const [name, value] of Object.entries(attributes)) panel_item.setAttribute(name, value);
    const inner = el("button", 20, top);
    panel_item.openOrClosedShadowRoot = Object.assign(new Node("#shadow"), { host: panel_item });
    panel_item.openOrClosedShadowRoot.append(inner);
    return { panel_item, inner };
  };
  const sync = el("moz-button", 20, 20);
  sync.setAttribute("data-action", "sync-tabs-disabled");
  const sign_in = el("moz-button", 20, 60);
  sign_in.setAttribute("data-action", "sign-in");
  const delete_item = item(100, { "data-l10n-id": "firefoxview-history-context-delete" });
  const device_item = item(140, { "device-id": "d1" });
  const chat_item = item(220, { "data-l10n-id": "firefoxview-chat-context-delete" });
  const other_item = item(180, { "data-l10n-id": "fxviewtabrow-open-in-new-window" });
  const build = (root: Node) => root.append(sync, sign_in, delete_item.panel_item, device_item.panel_item, other_item.panel_item, chat_item.panel_item);
  for (const target of [sync, delete_item.inner, device_item.inner, chat_item.inner]) {
    const run = start_on("about:firefoxview", build);
    const { pick } = await labelled_session(run, 5);
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 0, `a pick of ${target.localName} acted with no Enter`);
    assert.ok(run.marked(), `no mark on ${target.localName}`);
    run.chrome.clock.now += DWELL_MS;
    assert.ok(run.chrome.press("Enter").prevented);
    assert.equal(target.clicks, 1, `the user's Enter did not click ${target.localName}`);
  }
  for (const target of [sign_in, other_item.inner]) {
    const run = start_on("about:firefoxview", build);
    const { pick } = await labelled_session(run, 6);
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 1, `a pick of ${target.localName} waited`);
  }
});
