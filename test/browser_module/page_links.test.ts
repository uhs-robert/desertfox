// The page links feature (browser_module/desertfox-page-links.js) on a parent-process about: page: the DOM walk, the scopes, the caps and the refusals. The content-process route is in content_hints.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_page_links } from "../../src/shared/browser_module_page_links.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { Node } from "./chrome_dom.ts";
import { box as plain_box } from "./chrome_windows.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const FILE = "desertfox-page-links.js";
const NO_LINKS_HERE = "Links cannot be read on this page";
type Reply = { ok: boolean; error?: string; value?: string };
type FakeBrowser = { currentURI?: { scheme: string }; contentWindow?: unknown };

// A DOMRect also gives right and bottom.
const box = (left: number, top: number, width = 60, height = 24) => ({ ...plain_box(left, top, width, height), right: left + width, bottom: top + height });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

// A link with a box in the page's pixels. Text is `innerText`, as the browser gives the shown text.
const link = (href: string, text = "", at = box(10, 10, 50, 20), props: Partial<Node> & Record<string, unknown> = {}) => {
  const node = Object.assign(new Node("a", { box: at }), { href, innerText: text }, props);
  node.setAttribute("href", href);
  return node;
};
const page_of = (...children: Node[]) => {
  const root = Object.assign(new Node("#document"), { URL: "about:preferences" });
  root.append(...children);
  return root;
};
const content_of = (document: Node, size = { innerWidth: 800, innerHeight: 600 }) => ({ document, ...size });

function world({ private_window = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [FILE]: source_of(FILE) } });
  firefox.start_extension({ private_access });
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {} });
  const window = firefox.make_window({ private_window });
  const a = window.add_tab();
  const b = window.add_tab();
  window.load();
  for (const tab of [a.tab, b.tab]) Object.assign(tab, { closing: false, ownerGlobal: { closed: false } });
  const services = firefox.Services as Record<string, unknown>;
  const wm = services.wm as { getEnumerator(type: string | null): unknown[] };
  services.wm = { getEnumerator: (type: string | null) => (type === "navigator:browser" ? [window.win] : wm.getEnumerator(type)) };
  window.select(a.tab);
  const tracker = (window.win as unknown as { ChromeUtils: { importESModule(url: string): { ExtensionParent: { apiManager: { global: { tabTracker: { getId(tab: unknown): number } } } } } } }).ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.apiManager.global.tabTracker;
  const ids = { a: tracker.getId(a.tab), b: tracker.getId(b.tab) };
  const show = (tab: { browser: unknown }, scheme: string, content?: unknown) => {
    const browser = tab.browser as FakeBrowser;
    browser.currentURI = { scheme };
    browser.contentWindow = content ?? null;
  };
  let next_id = 0;
  async function ask(args: Record<string, unknown>): Promise<Reply> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind: "page_links.read", args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as (Reply & { reply_to: string })[]).find((each) => each.reply_to === id);
    assert.ok(reply, "no reply");
    const { ok, error, value } = plain(reply) as Reply;
    return { ok, ...(error === undefined ? {} : { error }), ...(value === undefined ? {} : { value }) };
  }
  const pairs = async (scope: "page" | "viewport", tab_id = ids.a) => {
    const reply = await ask({ tab_id, scope });
    assert.equal(reply.ok, true, reply.error ?? "");
    return JSON.parse(reply.value!) as [string, string][];
  };
  return { firefox, a, b, ids, ask, show, pairs };
}

test("the page scope lists the visible web links in page order, through shadow roots and frames", async () => {
  const { a, pairs, show } = world();
  const host = new Node("div");
  host.openOrClosedShadowRoot = new Node("#shadow");
  host.openOrClosedShadowRoot.append(link("https://shadow.example/", "In shadow"));
  const inner = page_of(link("https://frame.example/", "In frame"));
  const frame = Object.assign(new Node("iframe", { box: box(0, 200, 400, 300) }), { contentDocument: inner });
  show(a, "about", content_of(page_of(link("https://one.example/", "One"), host, frame, link("https://two.example/", "Two"))));
  assert.deepEqual(await pairs("page"), [["https://one.example/", "One"], ["https://shadow.example/", "In shadow"], ["https://frame.example/", "In frame"], ["https://two.example/", "Two"]]);
});

test("a link that is hidden, not a web address, a fragment of the page itself or a repeat is left out", async () => {
  const { a, pairs, show } = world();
  show(a, "about", content_of(page_of(
    link("https://one.example/", "One"),
    link("https://hidden.example/", "Hidden", box(10, 10), { visible: false }),
    link("mailto:a@b.c", "Mail"),
    link("javascript:alert(1)", "Script"),
    link("about:config", "About"),
    link("moz-extension://x/page.html", "Extension"),
    link("data:text/html,x", "Data"),
    link("about:preferences#privacy", "Section"),
    link("https://other.example/#part", "Other page section"),
    link("https://one.example/", "Again"),
    link("ftp://files.example/x", "Ftp"),
    link("file:///tmp/x", "File"),
  )));
  assert.deepEqual(await pairs("page"), [["https://one.example/", "One"], ["https://other.example/#part", "Other page section"], ["ftp://files.example/x", "Ftp"], ["file:///tmp/x", "File"]]);
});

test("a link's text is its shown text, else its aria-label, else its title, else empty, with blanks collapsed", async () => {
  const { a, pairs, show } = world();
  const labelled = link("https://b.example/", "");
  labelled.setAttribute("aria-label", "  Named  by\n aria ");
  const titled = link("https://c.example/", "");
  titled.setAttribute("title", "Titled");
  show(a, "about", content_of(page_of(link("https://a.example/", " Shown \n\t text\u0000 "), labelled, titled, link("https://d.example/", "x".repeat(900)))));
  const got = await pairs("page");
  assert.deepEqual(got.slice(0, 3), [["https://a.example/", "Shown text"], ["https://b.example/", "Named by aria"], ["https://c.example/", "Titled"]]);
  assert.equal(got[3]![1].length, 512);
});

test("the viewport scope keeps links that touch the view, and a frame clips its links to the part of it in view", async () => {
  const { a, pairs, show } = world();
  const inside = link("https://in.example/", "In", box(10, 10, 50, 20));
  const partly = link("https://edge.example/", "Edge", box(780, 580, 100, 100));
  const below = link("https://below.example/", "Below", box(10, 700, 50, 20));
  const right = link("https://right.example/", "Right", box(900, 10, 50, 20));
  const empty = link("https://empty.example/", "Empty", box(10, 10, 0, 0));
  const inner = page_of(link("https://frame-top.example/", "Top of frame", box(5, 5, 50, 20)), link("https://frame-hidden.example/", "Cut off", box(5, 250, 50, 20)));
  // The frame starts at 400 down and 300 deep, and only its top 200 pixels are in the 600 pixel view.
  const frame = Object.assign(new Node("iframe", { box: box(0, 400, 400, 300) }), { contentDocument: inner });
  show(a, "about", content_of(page_of(inside, partly, below, right, empty, frame)));
  assert.deepEqual((await pairs("viewport")).map(([address]) => address), ["https://in.example/", "https://edge.example/", "https://frame-top.example/"]);
  assert.equal((await pairs("page")).length, 7, "the page scope takes them all");
});

test("a list stops at 500 links, a repeated address counts once, and an address over 2048 characters is dropped, not cut", async () => {
  const { a, pairs, show } = world();
  const many = Array.from({ length: 600 }, (_, index) => link(`https://a.example/${index % 550}`, "t"));
  show(a, "about", content_of(page_of(link(`https://long.example/${"x".repeat(2100)}`, "Long"), ...many)));
  const got = await pairs("page");
  assert.equal(got.length, 500);
  assert.equal(new Set(got.map(([address]) => address)).size, 500);
  assert.equal(got.some(([address]) => address.startsWith("https://long.example/")), false);
});

test("the list stops before the byte cap, so the whole reply fits the kind and the extension reads it", async () => {
  const { a, ids, ask, show } = world();
  // 400 links of 200 characters of text each is more than 60 KB of JSON, and the quotes in the text double when the reply escapes the value.
  const heavy = Array.from({ length: 400 }, (_, index) => link(`https://a.example/${index}`, `"${"q".repeat(198)}`));
  show(a, "about", content_of(page_of(...heavy)));
  const answer = await ask({ tab_id: ids.a, scope: "page" });
  assert.equal(answer.ok, true, answer.error ?? "");
  const parsed = parse_page_links(answer.value);
  assert.ok(parsed, "the extension refused the module's own reply");
  assert.ok(parsed.length > 100 && parsed.length < 400, `${parsed.length} links`);
  assert.ok(new TextEncoder().encode(JSON.stringify(answer)).length <= 65536);
});

test("a reply holds only the two web-link fields, whatever the page puts in a link", async () => {
  const { a, pairs, show } = world();
  const odd = link("https://odd.example/a b", "Spaces in the address");
  const control = link("https://odd.example/\u0007", "Bell");
  show(a, "about", content_of(page_of(odd, control, link("https://fine.example/", "Fine"))));
  assert.deepEqual(await pairs("page"), [["https://fine.example/", "Fine"]]);
});

test("a scope that is not page or viewport, a tab that is gone or not selected, and a private window the module may not act in are refused", async () => {
  const { a, b, ids, ask, show } = world();
  show(a, "about", content_of(page_of(link("https://one.example/", "One"))));
  show(b, "about", content_of(page_of(link("https://two.example/", "Two"))));
  assert.deepEqual(await ask({ tab_id: ids.a, scope: "all" }), { ok: false, error: "The scope is page or viewport" });
  assert.deepEqual(await ask({ tab_id: ids.b, scope: "page" }), { ok: false, error: "The tab that asked is no longer selected" });
  assert.deepEqual(await ask({ tab_id: 99999, scope: "page" }), { ok: false, error: "The tab that asked is gone" });
  const private_world = world({ private_window: true });
  show(private_world.a, "about", content_of(page_of(link("https://one.example/", "One"))));
  assert.deepEqual(await private_world.ask({ tab_id: private_world.ids.a, scope: "page" }), { ok: false, error: "The browser module may not act in this window" });
  const allowed = world({ private_window: true, private_access: true });
  show(allowed.a, "about", content_of(page_of(link("https://one.example/", "One"))));
  assert.deepEqual(await allowed.pairs("page", allowed.ids.a), [["https://one.example/", "One"]]);
});

test("a page with no collector is refused with the notice and no links", async () => {
  const { a, ids, ask, show } = world();
  // A web page, or an about: page in a content process (about:logins, no window in the parent), has no collector here.
  show(a, "https", content_of(page_of(link("https://secret.example/", "Secret"))));
  assert.deepEqual(await ask({ tab_id: ids.a, scope: "page" }), { ok: false, error: NO_LINKS_HERE });
  show(a, "about");
  assert.deepEqual(await ask({ tab_id: ids.a, scope: "page" }), { ok: false, error: NO_LINKS_HERE });
});
