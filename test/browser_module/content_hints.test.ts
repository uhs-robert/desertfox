// Hints on pages of Firefox's restricted list (browser_module/desertfox-content-hints.js, with the page session of desertfox-chrome-hints.js): the parent and the frame script wired as Firefox wires them, each message a turn later.
// It drives the security rules of the route: the hosts come from the pref and match exactly, both copies of the rule agree, the parent takes only bounded numbers and one checked address from the frame script,
// a control that can change state waits for the user's own Enter and the frame script refuses it without `confirmed: true`, and a page that goes away, swaps process or loses its tab leaves nothing behind.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import { box, button, chrome_document, chrome_window, plain, settle, started } from "./chrome_windows.ts";
import type { Firefox } from "./chrome_windows.ts";

const FILE = "desertfox-content-hints.js";
const LOCKED_FILE = "desertfox-locked-pages.js";
const PREFIX = "desertfox-browser-module:content-hints-";
const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
// The pref's default value in Firefox (greprefs.js).
const DEFAULT_HOSTS = "accounts-static.cdn.mozilla.net,accounts.firefox.com,addons.cdn.mozilla.net,addons.mozilla.org,api.accounts.firefox.com,content.cdn.mozilla.net,discovery.addons.mozilla.org,oauth.accounts.firefox.com,profile.accounts.firefox.com,support.mozilla.org,sync.services.mozilla.com";
const PAGE_LAYER = "desertfox-page-hints";
const DWELL_MS = 500;
const SEEN_MS = 300;
// The tab's content area in the window: 80 px down, under the toolbars.
const AREA = box(0, 80, 1200, 700);

type Principal = { isContentPrincipal: boolean; isSystemPrincipal: boolean; addonId: string; asciiHost: string; spec: string; schemeIs(scheme: string): boolean };
const about_principal = (spec: string): Principal => ({ isContentPrincipal: false, isSystemPrincipal: true, addonId: "", asciiHost: "", spec, schemeIs: (name: string) => name === "about" });
const web_principal = (host: string, scheme = "https", patch: Partial<Principal> = {}): Principal => ({ isContentPrincipal: true, isSystemPrincipal: false, addonId: "", asciiHost: host, spec: `${scheme}://${host}/`, schemeIs: (name: string) => name === scheme, ...patch });

type Sent = { name: string; data: Record<string, unknown> };
type Options = { host?: string; scheme?: string; remote_type?: string; principal?: Principal; content_dpr?: number; chrome_dpr?: number; child_remote_type?: string; pref?: string | undefined; about?: string; private_window?: boolean; private_access?: boolean };

// An element of the page with a box in the page's own pixels.
const el = (local_name: string, left: number, top: number, props: Partial<Node> & Record<string, unknown> = {}, attrs: Record<string, string> = {}) => {
  const node = Object.assign(new Node(local_name, { box: box(left, top) }), { focused: 0, isContentEditable: false }, props);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return Object.assign(node, { focus: () => void node.focused++ });
};
const link = (href: string, left: number, top: number, attrs: Record<string, string> = {}) => el("a", left, top, { href, pathname: new URL(href).pathname }, { href, ...attrs });

// A mock add-on listing: a link to another page, an install anchor, a rating button, a form with a submit, a search field and a role=button.
function listing() {
  const parts = {
    other: link("https://addons.mozilla.org/en-US/firefox/addon/other/", 20, 20),
    install: link("https://addons.mozilla.org/firefox/downloads/file/1/x.xpi", 200, 20),
    rating: el("button", 400, 20),
    search: el("input", 20, 100, { type: "search" }, { type: "search" }),
    submit: el("button", 300, 100, { type: "submit" }, { type: "submit" }),
    report: el("div", 500, 100, {}, { role: "button" }),
  };
  const form = new Node("form", { box: box(250, 90, 200, 50) });
  form.append(parts.submit);
  return { parts, build: (root: Node) => root.append(parts.other, parts.install, parts.rating, parts.search, form, parts.report) };
}

function restricted_window(firefox: Firefox, options: Options, build: (root: Node) => void) {
  const { host = "addons.mozilla.org", scheme = "https", about, remote_type = about ? "privilegedabout" : "privilegedmozilla", content_dpr = 1, chrome_dpr = 1 } = options;
  const principal = options.principal ?? (about ? about_principal(about) : web_principal(host, scheme));
  const address = about ?? `${scheme}://${host}/`;
  const to_child: Sent[] = [];
  const browser = Object.assign(new Node("browser", { box: AREA }), {
    isRemoteBrowser: true,
    remoteType: remote_type,
    innerWindowID: 10,
    browsingContext: { currentWindowGlobal: { documentPrincipal: principal, documentURI: { spec: address } } },
    private_browser: options.private_window === true,
    messageManager: { sendAsyncMessage: (name: string, data: Record<string, unknown>) => void to_child.push({ name, data: structuredClone(data) }) },
  });
  const opened: { address: string; options: { inBackground: boolean; triggeringPrincipal: unknown } }[] = [];
  const tabs = {
    selectedTab: { userContextId: 0 } as unknown,
    selectedBrowser: browser as unknown,
    addTab: (address: string, tab_options: (typeof opened)[number]["options"]) => (opened.push({ address, options: tab_options }), { opened: address }),
  };
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10), browser));
  Object.assign(window.win, { gBrowser: tabs, devicePixelRatio: chrome_dpr, private_window: options.private_window === true });
  const page_root = new Node("html");
  build(page_root);
  const content = { location: { href: about ?? `${scheme}://${host}/addon/one/` }, devicePixelRatio: content_dpr, innerWidth: AREA.width / (content_dpr / chrome_dpr), innerHeight: AREA.height / (content_dpr / chrome_dpr), windowGlobalChild: { innerWindowId: 10 } } as Record<string, unknown>;
  const page = chrome_document(page_root, content, address);
  Object.assign(page.document, { nodePrincipal: principal, visibilityState: "visible" });
  page.own();
  content.document = page.document;
  window.own();
  window.focus(browser);
  return { ...window, browser, tabs, opened, page_root, content, page: page.document, to_child };
}

type Chrome = ReturnType<typeof restricted_window>;

// The frame script in the tab, run from the data: URL the core loads. Its messages and the parent's each arrive a turn later, in order.
function frame_child(firefox: Firefox, chrome: Chrome, { remote_type = "privilegedmozilla" } = {}) {
  const url = firefox.frame_scripts.find((each) => decodeURIComponent(each).includes(PREFIX));
  assert.ok(url, "the content hints feature loads its frame script");
  const message_listeners = new Map<string, ((message: { data: unknown }) => void)[]>();
  const events = new Map<string, Set<(event: unknown) => void>>();
  const timers = new Map<number, () => void>();
  let next_timer = 1;
  const sent: Sent[] = [];
  // A test sets this to swap what the frame script says before chrome hears it, as a compromised content process would.
  const tamper = { with: undefined as ((sent: Sent) => Sent | undefined) | undefined };
  const context = vm.createContext({
    content: chrome.content,
    Services: { prefs: firefox.Services.prefs, appinfo: { remoteType: remote_type } },
    ChromeUtils: { importESModule: () => ({ setTimeout: (run: () => void) => (timers.set(next_timer, run), next_timer++), clearTimeout: (id: number) => void timers.delete(id) }) },
    addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => message_listeners.set(name, [...(message_listeners.get(name) ?? []), listener]),
    addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, (events.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: (event: unknown) => void) => void events.get(type)?.delete(listener),
    sendAsyncMessage: (name: string, data: Record<string, unknown>) => {
      const message = { name, data: structuredClone(data) };
      sent.push(message);
      const delivered = tamper.with ? tamper.with(message) : message;
      if (delivered) setImmediate(() => firefox.emit_message(delivered.name, chrome.browser, delivered.data));
    },
  });
  vm.runInContext(decodeURIComponent(url.slice(url.indexOf(",") + 1)), context);
  // The parent's messages so far, each delivered a turn later. A message to a tab whose process went away reaches nothing.
  let delivered = 0;
  let alive = true;
  const pump = () => {
    for (; delivered < chrome.to_child.length; delivered++) {
      const message = chrome.to_child[delivered]!;
      if (alive) setImmediate(() => (message_listeners.get(message.name) ?? []).forEach((listener) => listener({ data: structuredClone(message.data) })));
    }
  };
  const fire = (type: string, event: Record<string, unknown> = {}) => [...(events.get(type) ?? [])].forEach((listener) => listener({ type, isTrusted: true, target: chrome.page, ...event }));
  const listening = () => [...events.values()].reduce((sum, set) => sum + set.size, 0);
  // The parent asks the frame script directly, as a parent that skipped its own checks would.
  const ask = (name: string, data: Record<string, unknown>) => (message_listeners.get(PREFIX + name) ?? []).forEach((listener) => listener({ data }));
  return { sent, tamper, fire, listening, ask, pump, timers, kill: () => void (alive = false), received: () => chrome.to_child };
}

function start_on(options: Options = {}, build = listing().build, { state_hints = true, files = [] as string[] } = {}) {
  let chrome!: Chrome;
  const run = started(
    (firefox) => {
      firefox.set_named_pref(RESTRICTED_PREF, options.pref === undefined && !("pref" in options) ? DEFAULT_HOSTS : options.pref);
      chrome = restricted_window(firefox, options, build);
      return chrome;
    },
    { state: { v: 1, enabled: true, keys: [], tabs: {}, ...(state_hints && { page_hints: true }) }, files: [FILE, ...files] },
  );
  run.firefox.extension!.privateBrowsingAllowed = options.private_access === true;
  const copied: string[] = [];
  run.firefox.Components.classes["@mozilla.org/widget/clipboardhelper;1"] = { getService: () => ({ copyString: (text: string) => copied.push(text) }) };
  Object.assign(run.firefox.Components.interfaces, { nsIClipboardHelper: {} });
  Object.assign(run.firefox.Services.scriptSecurityManager as object, { createNullPrincipal: (attrs: unknown) => ({ null_principal: attrs }) });
  Object.assign(run.firefox.Services, {
    io: {
      newURI(text: string) {
        const parsed = new URL(text);
        return { spec: parsed.href, schemeIs: (scheme: string) => parsed.protocol === `${scheme}:` };
      },
    },
  });
  const child = frame_child(run.firefox, chrome, { remote_type: options.child_remote_type ?? options.remote_type ?? (options.about ? "privilegedabout" : "privilegedmozilla") });
  const core = run.firefox.Services.desertfox_browser_module as {
    page_hints(): { handles(browser: unknown): boolean; start(args: unknown): boolean };
    content_pages(): { labels(browser: unknown): string | undefined; refuses(browser: unknown): boolean };
    locked_page_rule(): { hint_notice(browser: unknown, win: unknown): unknown };
  };
  // Lets every message in flight land, both ways.
  const flush = async () => {
    for (let turn = 0; turn < 8; turn++) {
      child.pump();
      await settle();
    }
  };
  const hint_key = (keys = "f", event: FakeEvent = key_event("f")) => core.page_hints().start({ window: chrome.win, browser: chrome.browser, event, keys, count: 0 });
  const wants = () => run.pushes("page_hints.want");
  const collect = async (session: number, action = "follow", start = wants().at(-1)?.start as number) => {
    const id = run.send("page_hints.collect", { session, start, action, colors: "" });
    await flush();
    return run.reply(id);
  };
  const rows = (session: number) => run.pushes("chrome_hints.targets").filter((args) => args.session === session).flatMap((args) => JSON.parse(args.targets as string) as number[][]);
  // The id of the label at the element's place in the window, at a content scale of 1.
  const id_of = (session: number, element: Node) => rows(session).find(([, left, top]) => left === Math.round(element.box.left) && top === Math.round(element.box.top) + AREA.top)?.[0];
  const label_all = async (session: number) => {
    const labelled = rows(session).map(([id], index) => [id!, String.fromCharCode(97 + index)] as [number, string]);
    await run.draw(session, labelled);
    chrome.clock.now += SEEN_MS;
    return new Map(labelled);
  };
  const pick = async (session: number, id: number) => {
    const request = run.send("chrome_hints.pick", { session, id });
    await flush();
    return run.reply(request);
  };
  const page_layers = () => chrome.root.children.filter((child_node) => child_node.className === PAGE_LAYER);
  const marked = () => page_layers().some((host) => host.shadow!.descendants().some((node) => node.className === "desertfox-confirm"));
  const label_nodes = () => page_layers().flatMap((host) => host.shadow!.descendants().filter((node) => node.className === "desertfox-hint"));
  const child_picks = () => child.received().filter((message) => message.name === `${PREFIX}pick`).map((message) => message.data);
  return { ...run, chrome, child, core, copied, flush, hint_key, wants, collect, rows, id_of, label_all, pick, page_layers, marked, label_nodes, child_picks };
}

type Run = ReturnType<typeof start_on>;

// A session of `action`, labelled, and a pick that types the label of `element` first.
async function labelled(run: Run, session: number, action = "follow") {
  assert.equal(run.hint_key(), true);
  assert.equal((await run.collect(session, action))?.ok, true);
  const labels = await run.label_all(session);
  const pick = async (element: Node, typed = true) => {
    const id = run.id_of(session, element);
    assert.ok(id, `no label on ${element.localName}`);
    if (typed) run.chrome.press(labels.get(id)!);
    return run.pick(session, id);
  };
  return { labels, pick };
}

test("the hosts come from the pref and match exactly, http and https, in a web process; the account and Sync hosts are refused, and a pref change counts at once", () => {
  const kind = (options: Options) => {
    const run = start_on(options);
    return { labels: run.core.content_pages().labels(run.chrome.browser), refuses: run.core.content_pages().refuses(run.chrome.browser), handles: run.core.page_hints().handles(run.chrome.browser) };
  };
  for (const host of ["addons.mozilla.org", "support.mozilla.org", "discovery.addons.mozilla.org", "addons.cdn.mozilla.net"]) {
    for (const scheme of ["https", "http"]) assert.deepEqual(kind({ host, scheme }), { labels: "restricted", refuses: false, handles: true }, `${scheme}://${host}`);
  }
  assert.equal(kind({ host: "ADDONS.mozilla.org" }).labels, "restricted", "the host is not matched without case");
  assert.equal(kind({ pref: " Addons.Mozilla.Org , ,support.mozilla.org" }).labels, "restricted", "spaces and case in the pref broke the match");
  for (const host of ["evil-addons.mozilla.org", "addons.mozilla.org.evil.com", "addons.mozilla.org.", "mozilla.org", "a.addons.mozilla.org", "example.com"]) assert.deepEqual(kind({ host }), { labels: undefined, refuses: false, handles: false }, host);
  for (const host of ["accounts.firefox.com", "api.accounts.firefox.com", "oauth.accounts.firefox.com", "profile.accounts.firefox.com", "sync.services.mozilla.com"]) assert.deepEqual(kind({ host }), { labels: undefined, refuses: true, handles: false }, host);
  // A subdomain of an excluded domain that policy added stays out too.
  assert.equal(kind({ host: "new.accounts.firefox.com", pref: "new.accounts.firefox.com" }).refuses, true);
  for (const options of [{ pref: "" }, { pref: undefined }, { scheme: "ftp" }, { scheme: "moz-extension" }, { remote_type: "privilegedabout" }, { remote_type: "extension" }, { remote_type: "file" }, { principal: web_principal("addons.mozilla.org", "https", { isContentPrincipal: false, isSystemPrincipal: true }) }, { principal: web_principal("addons.mozilla.org", "https", { addonId: "x@y" }) }] as Options[]) {
    assert.equal(kind(options).labels, undefined, JSON.stringify(options));
  }
  for (const remote_type of ["web", "webIsolated=https://mozilla.org", "webCOOP+COEP=https://mozilla.org"]) assert.equal(kind({ remote_type }).labels, "restricted", remote_type);
  const run = start_on();
  run.firefox.set_named_pref(RESTRICTED_PREF, "support.mozilla.org");
  assert.equal(run.core.content_pages().labels(run.chrome.browser), undefined, "a pref change did not count");
  run.chrome.browser.isRemoteBrowser = false;
  run.firefox.set_named_pref(RESTRICTED_PREF, DEFAULT_HOSTS);
  assert.equal(run.core.content_pages().labels(run.chrome.browser), undefined, "a page in the parent process took the content route");
});

test("the frame script's copy of the rule agrees with the parent's on every case", async () => {
  const cases: Options[] = [
    {},
    { scheme: "http" },
    { host: "ADDONS.mozilla.org" },
    { host: "evil-addons.mozilla.org" },
    { host: "addons.mozilla.org." },
    { host: "accounts.firefox.com" },
    { host: "sync.services.mozilla.com" },
    { host: "new.accounts.firefox.com", pref: "new.accounts.firefox.com" },
    { pref: "" },
    { pref: " Addons.Mozilla.Org " },
    { scheme: "ftp" },
    { remote_type: "privilegedabout" },
    { remote_type: "web" },
    { principal: web_principal("addons.mozilla.org", "https", { addonId: "x@y" }) },
  ];
  for (const options of cases) {
    const run = start_on(options);
    const parent = run.core.content_pages().labels(run.chrome.browser) !== undefined;
    run.child.ask("collect", { req: 1, inner: 10, kind: "restricted", action: "follow" });
    const answer = run.child.sent.find((message) => message.name === `${PREFIX}targets`)!.data;
    assert.equal(answer.error !== "not_here", parent, `the copies disagree on ${JSON.stringify(options)}: ${JSON.stringify(answer)}`);
  }
});

test("no code of the module writes the restricted pref", () => {
  for (const name of [FILE, "desertfox-chrome-hints.js", LOCKED_FILE, "desertfox-browser.js"]) {
    const source = source_of(name);
    assert.doesNotMatch(source, /\b(?:set|clear)\w*Pref\(\s*RESTRICTED_PREF|restrictedDomains["'`]\s*,\s*["'`]|(?:set|clear|lock)\w*Pref\([^)]*restrictedDomains/, name);
  }
  assert.doesNotMatch(source_of(FILE), /\.(?:set|clear|lock)\w*Pref\(/, "the content hints file calls a pref setter");
});

test("f labels the page in the window's own layer, at the boxes the frame script sent scaled by the page's zoom and placed in the tab's content area", async () => {
  const { parts, build } = listing();
  const run = start_on({ content_dpr: 1.5, chrome_dpr: 1.25 }, build);
  assert.equal(run.hint_key(), true);
  assert.equal(run.held(), "chrome_hints");
  assert.deepEqual(await run.collect(5), { v: 1, reply_to: "r0", ok: true });
  const scale = 1.5 / 1.25;
  const expected = Object.values(parts).map((part) => [Math.round(part.box.left * scale), Math.round(AREA.top + part.box.top * scale)]);
  assert.deepEqual(run.rows(5).map(([, left, top]) => [left, top]).sort(), expected.sort());
  assert.equal(run.label_nodes().length, 0, "labels showed before the draw");
  await run.label_all(5);
  assert.equal(run.label_nodes().length, Object.keys(parts).length);
  assert.equal(run.page_layers().length, 1);
  assert.equal(run.chrome.page_root.descendants().some((node) => node.className.includes("desertfox")), false, "a label went into the page's DOM");
  const collect = run.child.received().find((message) => message.name === `${PREFIX}collect`)!.data;
  assert.deepEqual(Object.keys(collect).sort(), ["action", "inner", "kind", "req"]);
  // The extension sees ids and boxes, no text and no address.
  for (const args of run.pushes("chrome_hints.targets")) assert.doesNotMatch(String(args.targets), /http|mozilla|[a-z]{3}/);
});

test("a plain link and a field act at once on the user's spelled label; a message alone or another label's keys click nothing", async () => {
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 5);
  assert.equal((await pick(parts.other, false))?.error, "The keys typed do not name this hint");
  assert.equal(parts.other.clicks, 0);
  assert.equal(run.child_picks().length, 0, "an unspelled pick reached the frame script");

  const again = start_on({}, listing().build);
  const second = await labelled(again, 6);
  const other = again.chrome.page_root.children[0]!;
  assert.equal((await second.pick(other))?.ok, true);
  assert.equal(other.clicks, 1);
  assert.deepEqual(again.child_picks().map(({ confirmed }) => confirmed), [false]);
  assert.equal(again.held(), undefined);
  assert.equal(again.page_layers().length, 0);

  const field_run = start_on({}, listing().build);
  const third = await labelled(field_run, 7);
  const search = field_run.chrome.page_root.children[3]! as Node & { focused: number };
  assert.equal((await third.pick(search))?.ok, true);
  assert.equal(search.focused, 1);
  assert.equal(search.clicks, 0);
});

test("an install link, a button, a form's submit and a role=button only mark; a key a script made, an early Enter, Shift+Enter and a repeat do nothing; the user's Enter clicks once", async () => {
  for (const index of [1, 2, 4, 5]) {
    const run = start_on({}, listing().build);
    const { pick } = await labelled(run, 5);
    const target = [...run.chrome.page_root.descendants()].filter((node) => node.localName !== "form")[index]!;
    assert.equal((await pick(target))?.ok, true);
    assert.equal(target.clicks, 0, `${target.localName} acted with no Enter`);
    assert.ok(run.marked(), `no mark on ${target.localName}`);
    assert.equal(run.child_picks().length, 0, "the mark asked the frame script before Enter");
    assert.equal(run.held(), "chrome_hints");
    run.chrome.press("Enter", { isTrusted: false });
    run.chrome.press("Enter");
    await run.flush();
    assert.equal(target.clicks, 0, "an Enter inside the dwell clicked");
    assert.equal(run.marked(), false, "an early Enter left the mark");
    // Each refusal below needs a fresh mark.
    for (const patch of [{ shiftKey: true }, { repeat: true }, {}] as Partial<FakeEvent>[]) {
      const each = start_on({}, listing().build);
      const marking = await labelled(each, 6);
      const each_target = [...each.chrome.page_root.descendants()].filter((node) => node.localName !== "form")[index]!;
      await marking.pick(each_target);
      each.chrome.clock.now += DWELL_MS;
      const event = each.chrome.press("Enter", patch);
      assert.ok(event.prevented, "the page saw the Enter");
      await each.flush();
      const confirmed = Object.keys(patch).length === 0;
      assert.equal(each_target.clicks, confirmed ? 1 : 0, `Enter ${JSON.stringify(patch)}`);
      assert.deepEqual(each.child_picks().map(({ confirmed: sent }) => sent), confirmed ? [true] : []);
      // A held key's repeat leaves the mark waiting for a fresh Enter.
      assert.equal(each.held(), patch.repeat ? "chrome_hints" : undefined);
    }
  }
});

test("chrome_hints.pick from the extension never confirms: a second pick of a marked grant finds nothing, and the frame script refuses a grant sent without confirmed", async () => {
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 5);
  await pick(parts.install);
  assert.ok(run.marked());
  assert.equal((await run.pick(5, run.id_of(5, parts.install)!))?.error, "The hints have ended");
  assert.equal(parts.install.clicks, 0);
  assert.equal(run.child_picks().length, 0);

  // A parent that skipped its gate: the frame script itself refuses.
  const direct = start_on({}, listing().build);
  direct.child.ask("collect", { req: 3, inner: 10, kind: "restricted", action: "follow" });
  const rows = (direct.child.sent.at(-1)!.data.rows as number[][]);
  const install_row = rows.find((row) => row[1] === 200 && row[2] === 20)!;
  assert.equal(install_row[5]! & 1, 1, "the install link does not wait for Enter");
  direct.child.ask("pick", { req: 4, inner: 10, session: 3, id: install_row[0], confirmed: false });
  assert.deepEqual(direct.child.sent.at(-1)!.data, { req: 4, inner: 10, ok: false, error: "needs_enter" });
  assert.equal(direct.chrome.page_root.children[1]!.clicks, 0);
});

test("a login form refuses the session with the notice text, and the frame script answers nothing it was not asked", async () => {
  const run = start_on({}, (root) => root.append(link("https://addons.mozilla.org/a", 20, 20), el("input", 20, 100, { type: "password" }, { type: "password" })));
  assert.equal(run.child.sent.length, 0, "the frame script spoke before it was asked");
  assert.equal(run.child.listening(), 0, "the frame script listens to the page before a session");
  run.hint_key();
  assert.equal((await run.collect(5))?.error, "Hints do not run on this page");
  assert.equal(run.held(), undefined);
  assert.equal(run.page_layers().length, 0);
});

test("the frame script in a page that is not on the list answers not_here and keeps nothing, even when the parent asks", async () => {
  const run = start_on({ host: "example.com" });
  assert.equal(run.hint_key(), false, "a page off the list started hints");
  run.child.ask("collect", { req: 1, inner: 10, kind: "restricted", action: "follow" });
  assert.equal(run.child.sent.at(-1)!.data.error, "not_here");
  assert.equal(run.child.listening(), 0);
  run.child.ask("collect", { req: 2, inner: 10, kind: "start", action: "follow" });
  assert.equal(run.child.sent.at(-1)!.data.error, "not_here", "a kind the frame script has no row for opened a session");
  run.child.ask("pick", { req: 3, inner: 10, session: 1, id: 1, confirmed: true });
  assert.equal(run.child.sent.at(-1)!.data.error, "gone");
});

// A reply the parent hears in place of the frame script's own.
async function tampered(change: (data: Record<string, unknown>) => Record<string, unknown> | undefined, options: Options = {}) {
  const run = start_on(options);
  run.child.tamper.with = (message) => {
    if (message.name !== `${PREFIX}targets`) return message;
    const data = change(message.data);
    return data && { name: message.name, data };
  };
  run.hint_key();
  const promise = run.collect(5);
  const result = await promise;
  return { run, result };
}

test("the parent drops a reply from another browser, for another document or request, too big, or with any bad row, and a reply that never comes ends the start", async () => {
  const bad_rows: [string, (rows: number[][]) => unknown][] = [
    ["over 400 rows", (rows) => Array.from({ length: 401 }, (_, index) => [index + 1, 10, 10, 20, 20, 0]).concat(rows)],
    ["NaN", (rows) => [[...rows[0]!.slice(0, 1), NaN, ...rows[0]!.slice(2)]]],
    ["a negative side", (rows) => [[rows[0]![0]!, 10, 10, -20, 20, 0]]],
    ["a tiny side", (rows) => [[rows[0]![0]!, 10, 10, 2, 20, 0]]],
    ["a side over the viewport", (rows) => [[rows[0]![0]!, 0, 0, 5000, 20, 0]]],
    ["a flag of 8", (rows) => [[rows[0]![0]!, 10, 10, 20, 20, 8]]],
    ["a repeated id", (rows) => [rows[0]!, [rows[0]![0]!, 50, 50, 20, 20, 0]]],
    ["a short row", (rows) => [[rows[0]![0]!, 10, 10, 20, 20]]],
    ["a text in a row", (rows) => [[rows[0]![0]!, "10", 10, 20, 20, 0]]],
  ];
  for (const [what, change] of bad_rows) {
    const { run, result } = await tampered((data) => ({ ...data, rows: change(data.rows as number[][]) }));
    assert.equal(result?.error, "The page changed", what);
    assert.equal(run.page_layers().length, 0, what);
    assert.equal(run.held(), undefined, what);
  }
  for (const dpr of [0, -1, 1e9, NaN, "2"]) {
    const { result } = await tampered((data) => ({ ...data, dpr }));
    assert.equal(result?.error, "The page changed", `dpr ${dpr}`);
  }
  const big = await tampered((data) => ({ ...data, padding: "x".repeat(70000) }));
  assert.equal(big.result?.error, "The page changed", "an oversized reply counted");
  const child_error = await tampered((data) => ({ req: data.req, inner: data.inner, error: "<b>the page says</b>" }));
  assert.equal(child_error.result?.error, "The page changed", "an error text of the page's own reached the user");
  for (const [what, change] of [
    ["another request", (data: Record<string, unknown>) => ({ ...data, req: (data.req as number) + 1 })],
    ["another document", (data: Record<string, unknown>) => ({ ...data, inner: 11 })],
  ] as const) {
    const run = start_on();
    run.child.tamper.with = (message) => (message.name === `${PREFIX}targets` ? { name: message.name, data: change(message.data) } : message);
    run.hint_key();
    const id = run.send("page_hints.collect", { session: 5, start: run.wants().at(-1)!.start, action: "follow", colors: "" });
    await run.flush();
    assert.equal(run.reply(id), undefined, `${what} answered the collect`);
    run.firefox.run_timers();
    await run.flush();
    assert.equal(run.reply(id)?.error, "The page changed", what);
    assert.equal(run.held(), undefined, `${what} left the keys held`);
  }
  // Another tab's frame script answers for this one.
  const run = start_on();
  run.child.tamper.with = (message) => {
    if (message.name === `${PREFIX}targets`) setImmediate(() => run.firefox.emit_message(message.name, { innerWindowID: 10 }, message.data));
    return message.name === `${PREFIX}targets` ? undefined : message;
  };
  run.hint_key();
  const id = run.send("page_hints.collect", { session: 5, start: run.wants().at(-1)!.start, action: "follow", colors: "" });
  await run.flush();
  assert.equal(run.reply(id), undefined, "another browser's reply counted");
});

test("every box is clipped to the tab's content area, and a box whose center falls outside it is left out", async () => {
  const { run, result } = await tampered((data) => ({ ...data, rows: [[1, -30, -10, 60, 30, 0], [2, 1160, 690, 60, 20, 0], [3, 10, -40, 20, 30, 0], [4, 100, 100, 40, 20, 0]] }));
  assert.equal(result?.ok, true);
  const rows = run.rows(5).map(([, left, top, width, height]) => [left, top, width, height]);
  assert.deepEqual(rows, [[0, 80, 30, 20], [1160, 770, 40, 10], [100, 180, 40, 20]]);
  await run.label_all(5);
  for (const node of run.label_nodes()) {
    assert.ok(Number.parseInt(node.style.top!) >= AREA.top, `a label sits over the toolbars: ${node.style.top}`);
  }
});

test("a link action takes only a checked web address from the frame script, and opens it with a null principal", async () => {
  const addresses: [string, string | undefined][] = [
    ["https://addons.mozilla.org/x", "https://addons.mozilla.org/x"],
    ["javascript:alert(1)", undefined],
    ["data:text/html,x", undefined],
    ["about:config", undefined],
    ["chrome://browser/content/browser.xhtml", undefined],
    ["file:///etc/passwd", undefined],
    [`https://a.test/${"x".repeat(5000)}`, undefined],
    ["https://a.test/\u0001x", undefined],
    ["https://a.test/ x", undefined],
  ];
  for (const [href, opened] of addresses) {
    const { parts, build } = listing();
    const run = start_on({}, build);
    run.child.tamper.with = (message) => (message.name === `${PREFIX}picked` && message.data.ok === true ? { name: message.name, data: { ...message.data, href } } : message);
    const { pick } = await labelled(run, 5, "tab");
    const result = await pick(parts.other);
    assert.equal(parts.other.clicks, 0, "a link action clicked");
    assert.deepEqual(run.chrome.opened.map((each) => each.address), opened === undefined ? [] : [opened], href.slice(0, 40));
    if (opened === undefined) assert.equal(result?.error, "The link has no web address", href.slice(0, 40));
    else assert.deepEqual(plain(run.chrome.opened[0]!.options.triggeringPrincipal), { null_principal: { userContextId: 0 } });
  }
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 6, "yank");
  assert.equal(run.id_of(6, parts.install), undefined, "a link action labelled an install link");
  assert.equal(run.id_of(6, parts.rating), undefined, "a link action labelled a button");
  assert.equal((await pick(parts.other))?.ok, true);
  assert.deepEqual(run.copied, ["https://addons.mozilla.org/en-US/firefox/addon/other/"]);
});

test("the frame script checks the target again at its pick: one that moved, changed or went refuses", async () => {
  const changes: [string, (node: Node) => void, string][] = [
    ["moved", (node) => (node.box = box(node.box.left + 10, node.box.top)), "The hint's target moved"],
    ["changed", (node) => node.setAttribute("href", "https://addons.mozilla.org/firefox/downloads/file/2/y.xpi"), "The hint's target changed"],
    ["became a form's", (node) => {
      const form = new Node("form");
      node.parentNode!.append(form);
      form.append(node);
    }, "The hint's target changed"],
    ["gone", (node) => node.remove(), "The hint's target is gone"],
    ["hidden", (node) => (node.visible = false), "The hint's target is gone"],
  ];
  for (const [what, change, error] of changes) {
    const { parts, build } = listing();
    const run = start_on({}, build);
    const { labels } = await labelled(run, 5);
    const id = run.id_of(5, parts.other)!;
    change(parts.other);
    run.chrome.press(labels.get(id)!);
    assert.equal((await run.pick(5, id))?.error, error, what);
    assert.equal(parts.other.clicks, 0, what);
  }
});

test("a click, a scroll, a resize or the page going away in the tab ends the session and the mark, and a later Enter clicks nothing", async () => {
  for (const [type, event] of [["mousedown", {}], ["scroll", {}], ["resize", {}], ["pagehide", {}], ["visibilitychange", {}]] as [string, Record<string, unknown>][]) {
    const run = start_on();
    await labelled(run, 5);
    if (type === "visibilitychange") (run.chrome.page as unknown as { visibilityState: string }).visibilityState = "hidden";
    run.child.fire(type, event);
    await run.flush();
    assert.equal(run.page_layers().length, 0, `${type} left the labels`);
    assert.equal(run.held(), undefined, `${type} left the keys held`);
    assert.deepEqual(run.pushes("chrome_hints.end").map((args) => args.session), [5], type);
    assert.equal(run.child.listening(), 0, `${type} left the frame script listening`);
  }
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 6);
  await pick(parts.install);
  assert.ok(run.marked());
  // A script's mousedown is not the user's click, and a frame's own pagehide leaves the page as it is.
  run.child.fire("mousedown", { isTrusted: false });
  run.child.fire("pagehide", { target: {} });
  await run.flush();
  assert.ok(run.marked(), "a page's own event ended the mark");
  run.child.fire("mousedown");
  await run.flush();
  assert.equal(run.marked(), false);
  run.chrome.clock.now += DWELL_MS;
  run.chrome.press("Enter");
  await run.flush();
  assert.equal(parts.install.clicks, 0);
  assert.equal(run.child_picks().length, 0);
});

test("a navigation while the page answers drops the reply, and the old document's late word ends nothing new", async () => {
  const run = start_on();
  run.hint_key();
  const id = run.send("page_hints.collect", { session: 5, start: run.wants().at(-1)!.start, action: "follow", colors: "" });
  // The parent reads the request and sends it, then the tab shows a new document.
  await settle();
  await settle();
  run.chrome.browser.innerWindowID = 11;
  (run.chrome.content.windowGlobalChild as { innerWindowId: number }).innerWindowId = 11;
  await run.flush();
  run.firefox.run_timers();
  await run.flush();
  assert.equal(run.reply(id)?.error, "The page changed");
  assert.equal(run.page_layers().length, 0);
  assert.equal(run.held(), undefined);
  assert.equal(run.child.listening(), 0, "the frame script kept a session for a document it no longer shows");
});

test("a process swap mid-collect times out with no labels and no hold, and the spent token opens nothing after", async () => {
  // The old process dies with the request in flight, so no answer ever comes.
  const run = start_on();
  run.hint_key();
  const start = run.wants().at(-1)!.start as number;
  run.child.kill();
  const id = run.send("page_hints.collect", { session: 5, start, action: "follow", colors: "" });
  await run.flush();
  assert.equal(run.reply(id), undefined);
  assert.equal(run.held(), "chrome_hints", "the start gave the keys back while the page answered");
  run.chrome.browser.innerWindowID = 12;
  run.firefox.run_timers();
  await run.flush();
  assert.equal(run.reply(id)?.error, "The page changed", "a swap kept the start open");
  assert.equal(run.held(), undefined);
  assert.equal(run.page_layers().length, 0);
  assert.equal((await run.collect(6, "follow", start))?.error, "The hint key is stale");

  // The swap lands while the labels show and the old process says nothing: a pick then reaches no frame script and clicks nothing.
  const { parts, build } = listing();
  const shown = start_on({}, build);
  const { pick } = await labelled(shown, 7);
  shown.child.kill();
  shown.chrome.browser.innerWindowID = 13;
  assert.equal((await pick(parts.other))?.error, "The page changed");
  assert.equal(parts.other.clicks, 0);
  assert.equal(shown.child_picks().length, 0);
  assert.equal(shown.held(), undefined);
});

test("closing the tab mid-confirm ends the mark, so no Enter clicks and nothing stays held", async () => {
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 5);
  await pick(parts.install);
  assert.ok(run.marked());
  run.chrome.win.fire("TabSelect");
  run.child.kill();
  run.chrome.tabs.selectedBrowser = new Node("browser");
  assert.equal(run.marked(), false);
  assert.equal(run.held(), undefined);
  run.chrome.clock.now += DWELL_MS;
  run.chrome.press("Enter");
  await run.flush();
  assert.equal(parts.install.clicks, 0);
  assert.equal(run.child_picks().length, 0);
});

test("a confirm whose tab now shows another document sends nothing on Enter", async () => {
  const { parts, build } = listing();
  const run = start_on({}, build);
  const { pick } = await labelled(run, 5);
  await pick(parts.install);
  run.chrome.browser.innerWindowID = 11;
  run.chrome.clock.now += DWELL_MS;
  run.chrome.press("Enter");
  await run.flush();
  assert.equal(run.child_picks().length, 0);
  assert.equal(parts.install.clicks, 0);
  assert.equal(run.held(), undefined);
});

test("the hint key gets the notice on the account and Sync hosts, and on a listed host while the extension does not answer page hints", () => {
  const notice = (options: Options, state_hints = true) => {
    const run = start_on(options, listing().build, { state_hints, files: [LOCKED_FILE] });
    return run.core.locked_page_rule().hint_notice(run.chrome.browser, run.chrome.win);
  };
  assert.equal(notice({}), "page_hints");
  assert.equal(notice({}, false), "not_here");
  assert.equal(notice({ host: "accounts.firefox.com" }), "not_here");
  assert.equal(notice({ host: "sync.services.mozilla.com" }), "not_here");
  assert.equal(notice({ host: "example.com" }), undefined, "a web page off the list got a notice");
});

test("the idle frame script drops a session nobody picks from, and a clear from chrome drops it at once", async () => {
  const run = start_on();
  await labelled(run, 5);
  assert.ok(run.child.listening() > 0);
  run.send("chrome_hints.clear", { session: 5 });
  await run.flush();
  assert.equal(run.child.listening(), 0, "a clear left the frame script's session");
  const idle = start_on();
  idle.child.ask("collect", { req: 1, inner: 10, kind: "restricted", action: "follow" });
  assert.ok(idle.child.listening() > 0);
  for (const timer of [...idle.child.timers.values()]) timer();
  assert.equal(idle.child.listening(), 0);
});

// The flag masks the frame script gives each element of `build`, in document order.
function masks_of(build: (root: Node) => void) {
  const run = start_on({}, build);
  run.child.ask("collect", { req: 1, inner: 10, kind: "restricted", action: "follow" });
  const rows = run.child.sent.at(-1)!.data.rows as number[][];
  return { run, masks: rows.map((row) => row[5]) };
}

test("a select is a field: it gets no Enter mark, and a pick focuses it at once", async () => {
  const select = el("select", 20, 20);
  const { masks } = masks_of((root) => root.append(select));
  assert.deepEqual(masks, [2], "a select waits for Enter or is no field");
  const choose = el("select", 20, 20);
  const run = start_on({}, (root) => root.append(choose));
  const { pick } = await labelled(run, 5);
  assert.equal((await pick(choose))?.ok, true);
  assert.equal(run.marked(), false);
  assert.equal((choose as Node & { focused: number }).focused, 1);
  assert.equal(choose.clicks, 0);
});

test("a link with a control's role waits for Enter, and only role=link stays a plain link", () => {
  const roles = ["switch", "menuitem", "tab", "checkbox", "link"];
  const { masks } = masks_of((root) => root.append(...roles.map((role, index) => link(`https://addons.mozilla.org/p${index}`, 20, 20 + 40 * index, { role }))));
  assert.deepEqual(masks, [1, 1, 1, 1, 4], roles.join(" "));
});

test("the frame script's idle end tells chrome, so the labels go and a later Enter clicks nothing", async () => {
  const run = start_on();
  await labelled(run, 5);
  for (const timer of [...run.child.timers.values()]) timer();
  await run.flush();
  assert.equal(run.page_layers().length, 0, "the labels outlived the frame script's session");
  assert.equal(run.held(), undefined);
  assert.deepEqual(run.pushes("chrome_hints.end").map((args) => args.session), [5]);
});

test("a route change of the page during the mark refuses the confirmed pick, even when an element alike sits at the same place", async () => {
  const remove = el("button", 20, 20, { id: "remove" });
  const run = start_on({}, (root) => root.append(remove));
  const { pick } = await labelled(run, 5);
  await pick(remove);
  assert.ok(run.marked());
  (run.chrome.content.location as { href: string }).href = "https://addons.mozilla.org/addon/two/";
  run.chrome.clock.now += DWELL_MS;
  run.chrome.press("Enter");
  await run.flush();
  assert.deepEqual(run.child_picks().map(({ confirmed }) => confirmed), [true]);
  assert.equal(remove.clicks, 0, "a button on another route was clicked");
});

// A start page as Firefox shows it: top sites and a learn more link, the search box's handoff button, a field, and the buttons that pin, dismiss, remove and toggle.
function start_page() {
  const parts = {
    top_site: link("https://example.com/", 20, 20, { class: "top-site-button" }),
    learn_more: link("https://support.mozilla.org/kb/private-browsing", 200, 20),
    handoff: el("button", 20, 100, {}, { class: "search-handoff-button" }),
    pin: el("button", 400, 20, {}, { class: "context-menu-item" }),
    dismiss: el("button", 500, 20),
    toggle: el("button", 400, 100, {}, { role: "switch" }),
    settings: el("div", 500, 100, {}, { role: "button" }),
    internal: link("about:preferences", 600, 20),
  };
  return { parts, build: (root: Node) => root.append(...Object.values(parts)) };
}
const START_NAMES = ["about:privatebrowsing", "about:home", "about:newtab"];
const START_KINDS = ["privatebrowsing", "home", "newtab"];

test("each start page is labelled in the privilegedabout process only, by its own about: address, and the new tab override stays with the content script", () => {
  const kind = (options: Options) => {
    const run = start_on(options, start_page().build);
    return { labels: run.core.content_pages().labels(run.chrome.browser), refuses: run.core.content_pages().refuses(run.chrome.browser), handles: run.core.page_hints().handles(run.chrome.browser) };
  };
  START_NAMES.forEach((about, index) => {
    assert.deepEqual(kind({ about }), { labels: START_KINDS[index], refuses: false, handles: true }, about);
    assert.equal(kind({ about: `${about}?x=1` }).labels, START_KINDS[index], `${about} with a query`);
    assert.equal(kind({ about: about.toUpperCase() }).labels, START_KINDS[index], `${about} in capitals`);
  });
  // The override page of a normal window: the address bar says about:newtab, the page is DesertFox's, in the extension's process.
  const override = kind({ about: "moz-extension://0123abcd-0000-4000-8000-00000000cafe/newtab.html", remote_type: "extension" });
  assert.equal(override.labels, undefined, "the override page took the module route");
  for (const options of [
    { about: "about:newtab", remote_type: "extension" },
    { about: "about:newtab", remote_type: "web" },
    { about: "about:home", remote_type: "privilegedmozilla" },
    { about: "about:home", remote_type: "file" },
    { about: "about:logins" },
    { about: "about:protections" },
    { about: "about:privatebrowsingx" },
    { about: "about:blank" },
    { about: "about:home", principal: about_principal("about:home") && { ...about_principal("about:home"), addonId: "x@y" } },
  ] as Options[]) {
    assert.equal(kind(options).labels, undefined, JSON.stringify(options));
  }
  const run = start_on({ about: "about:home" }, start_page().build);
  run.chrome.browser.isRemoteBrowser = false;
  assert.equal(run.core.content_pages().labels(run.chrome.browser), undefined, "a page in the parent process took the content route");
});

test("the frame script's copy of the start page rule agrees with the parent's on every case", () => {
  const cases: [Options, string][] = [
    ...START_NAMES.flatMap((about, index) => [[{ about }, START_KINDS[index]!], [{ about: `${about}#top` }, START_KINDS[index]!]] as [Options, string][]),
    [{ about: "about:newtab", remote_type: "extension" }, "newtab"],
    [{ about: "about:newtab", remote_type: "web" }, "newtab"],
    [{ about: "about:logins" }, "home"],
    [{ about: "about:home" }, "newtab"],
    [{ about: "about:home", principal: { ...about_principal("about:home"), addonId: "x@y" } }, "home"],
    [{}, "home"],
  ];
  for (const [options, asked] of cases) {
    const run = start_on(options, start_page().build);
    const parent = run.core.content_pages().labels(run.chrome.browser) === asked;
    run.child.ask("collect", { req: 1, inner: 10, kind: asked, action: "follow" });
    const answer = run.child.sent.find((message) => message.name === `${PREFIX}targets`)!.data;
    assert.equal(answer.error !== "not_here", parent, `the copies disagree on ${JSON.stringify(options)} as ${asked}: ${JSON.stringify(answer)}`);
  }
  // A page that is not the start page named: the frame script keeps nothing.
  const run = start_on({ about: "about:privatebrowsing" }, start_page().build);
  run.child.ask("collect", { req: 1, inner: 10, kind: "home", action: "follow" });
  assert.equal(run.child.sent.at(-1)!.data.error, "not_here");
  assert.equal(run.child.listening(), 0);
});

test("on a start page a link and the search handoff act at once on the spelled label, and every other control only marks until the user's own Enter", async () => {
  for (const about of START_NAMES) {
    const { parts, build } = start_page();
    const run = start_on({ about }, build);
    const { pick } = await labelled(run, 5);
    assert.equal((await pick(parts.top_site))?.ok, true, `${about} top site`);
    assert.equal(parts.top_site.clicks, 1);
    assert.deepEqual(run.child_picks().map(({ confirmed }) => confirmed), [false]);
    for (const name of ["learn_more", "handoff"] as const) {
      const each = start_page();
      const again = start_on({ about }, each.build);
      const second = await labelled(again, 6);
      assert.equal((await second.pick(each.parts[name]))?.ok, true, `${about} ${name}`);
      assert.equal(each.parts[name].clicks, 1, `${about} ${name} did not act at once`);
    }
    for (const name of ["pin", "dismiss", "toggle", "settings", "internal"] as const) {
      const each = start_page();
      const again = start_on({ about }, each.build);
      const second = await labelled(again, 6);
      const target = each.parts[name];
      assert.equal((await second.pick(target))?.ok, true);
      assert.equal(target.clicks, 0, `${about} ${name} acted with no Enter`);
      assert.ok(again.marked(), `${about} ${name} has no mark`);
      assert.equal(again.child_picks().length, 0);
      again.chrome.press("Enter", { isTrusted: false });
      await again.flush();
      assert.equal(target.clicks, 0, `${about} ${name} took an Enter a script made`);
      again.chrome.clock.now += DWELL_MS;
      again.chrome.press("Enter");
      await again.flush();
      assert.equal(target.clicks, 1, `${about} ${name}: the user's Enter did not click`);
      assert.deepEqual(again.child_picks().map(({ confirmed }) => confirmed), [true]);
    }
  }
});

test("the frame script of a start page refuses a state-changing control sent without confirmed, and an about: link never leaves as an address", async () => {
  const { parts, build } = start_page();
  const run = start_on({ about: "about:home" }, build);
  for (const part of [parts.pin, parts.dismiss, parts.toggle, parts.settings, parts.internal]) {
    // A pick ends its session, so each control gets a fresh one.
    run.child.ask("collect", { req: 3, inner: 10, kind: "home", action: "follow" });
    const rows = run.child.sent.at(-1)!.data.rows as number[][];
    const row = rows.find((each) => each[1] === part.box.left && each[2] === part.box.top)!;
    assert.equal(row[5]! & 1, 1, "a control does not wait for Enter");
    run.child.ask("pick", { req: 4, inner: 10, session: 3, id: row[0], confirmed: false });
    assert.deepEqual(run.child.sent.at(-1)!.data, { req: 4, inner: 10, ok: false, error: "needs_enter" });
  }
  assert.ok([parts.pin, parts.dismiss, parts.toggle, parts.settings, parts.internal].every((part) => part.clicks === 0));
  // A link action labels links to the web only: the about: link has no label.
  const links = start_on({ about: "about:home" }, start_page().build);
  links.child.ask("collect", { req: 5, inner: 10, kind: "home", action: "copy" });
  const link_rows = links.child.sent.at(-1)!.data.rows as number[][];
  assert.equal(link_rows.length, 2, "the link action labelled more than the two web links");
});

test("a start page in a private window gets hints only with the extension's private window access", async () => {
  for (const about of ["about:privatebrowsing", "about:home"]) {
    const without = start_on({ about, private_window: true, private_access: false }, start_page().build, { files: [LOCKED_FILE] });
    assert.equal(without.hint_key(), false, `${about}: hints started in a private window without access`);
    assert.equal(without.core.locked_page_rule().hint_notice(without.chrome.browser, without.chrome.win), "not_here");
    assert.equal(without.page_layers().length, 0);
    assert.equal(without.child.sent.length, 0, "the frame script heard of a refused start");

    const parts = start_page();
    const granted = start_on({ about, private_window: true, private_access: true }, parts.build, { files: [LOCKED_FILE] });
    assert.equal(granted.core.locked_page_rule().hint_notice(granted.chrome.browser, granted.chrome.win), "page_hints");
    const { pick } = await labelled(granted, 5);
    assert.equal((await pick(parts.parts.top_site))?.ok, true, `${about} with access`);
    assert.equal(parts.parts.top_site.clicks, 1);
  }
  const normal = start_on({ about: "about:home" }, start_page().build, { files: [LOCKED_FILE] });
  assert.equal(normal.core.locked_page_rule().hint_notice(normal.chrome.browser, normal.chrome.win), "page_hints", "a normal window needs no access");
});
