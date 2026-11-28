// The page keys feature (browser_module/desertfox-page-keys.js): the frame script's page logic on a small fake DOM, and the parent's two kinds, `page_headings.read` and `page_heading.go`. The keys that send the frame script its messages are in commands.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, PAGE_KEYS_FILE, source_of } from "./fake_firefox.ts";
import { El, Page } from "./page_keys_dom.ts";
import type { Box } from "./page_keys_dom.ts";

const PREFIX = "desertfox-browser-module:";
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const at = (top: number, height = 20): Box => ({ left: 0, top, width: 200, height });
const element = (local_name: string, top: number, attrs: Record<string, string> = {}, text = "", props: Partial<El> = {}) => Object.assign(new El(local_name, attrs, null, text), { box: at(top) }, props);
const heading = (level: number, top: number, text = `Heading ${level} at ${top}`) => element(`h${level}`, top, {}, text);
const paragraph = (top: number, text = "A paragraph of running text that is long enough to count as a stop.") => element("p", top, {}, text);

// The frame script as Firefox runs it in one tab, over `page`. `send` is what it sends the parent.
function frame_world(build: (page: Page) => void, { inner = 7, enabled = true } = {}) {
  const page = new Page();
  build(page);
  const firefox = create_firefox({ extra_files: { [PAGE_KEYS_FILE]: source_of(PAGE_KEYS_FILE) } });
  firefox.start_extension();
  firefox.make_window().load();
  const url = firefox.frame_scripts.find((each) => decodeURIComponent(each).includes(`${PREFIX}page-ask`));
  assert.ok(url, "the feature loads its frame script");
  const listeners = new Map<string, ((message: { data: unknown }) => void)[]>();
  const events = new Map<string, ((event: unknown) => void)[]>();
  const sent: { name: string; data: Record<string, unknown> }[] = [];
  const executed: string[] = [];
  const document = {
    get activeElement() {
      return page.active;
    },
    body: page.body,
    documentElement: page.root,
    querySelectorAll: (selector: string) => page.root.querySelectorAll(selector),
    elementFromPoint: () => null,
    execCommand: (name: string, _ui: boolean, text: string) => {
      executed.push(`${name}:${text}`);
      return page.exec_result;
    },
  };
  const content = {
    document,
    innerWidth: page.inner_width,
    innerHeight: page.inner_height,
    getComputedStyle: () => ({ position: "static", overflowY: "visible", scrollMarginTop: "0px", scrollPaddingTop: "0px", visibility: "visible" }),
    getSelection: () => ({ focusNode: page.selection_node }),
    windowGlobalChild: { innerWindowId: inner },
    InputEvent: class {},
  };
  page.view = content;
  const context = vm.createContext({
    Services: { prefs: { getBoolPref: () => enabled } },
    content,
    addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    sendAsyncMessage: (name: string, data: Record<string, unknown>) => sent.push({ name, data: plain(data) }),
  });
  vm.runInContext(decodeURIComponent(url.slice(url.indexOf(",") + 1)), context);
  const deliver = (name: string, data: unknown) => (listeners.get(`${PREFIX}${name}`) ?? []).forEach((listener) => listener({ data }));
  const key = (id: string, args: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) => deliver("page-key", { id, args, inner, ...patch });
  const fire = (type: string, target: unknown) => (events.get(type) ?? []).forEach((listener) => listener({ target }));
  let next_req = 1;
  const ask = (name: string, fields: Record<string, unknown> = {}, inner_id = inner) => {
    const req = next_req++;
    deliver("page-ask", { name, req, inner: inner_id, ...fields });
    return sent.filter((message) => message.data["req"] === req).map((message) => message.data);
  };
  return { page, key, fire, ask, deliver, sent, executed, document };
}

const control = (local_name: string, top: number, attrs: Record<string, string> = {}, props: Partial<El> = {}) => element(local_name, top, attrs, "", props);

test("]i and [i walk the form controls in page order through shadow roots, from the focus, and stop at the ends", () => {
  const first = control("input", 10, { type: "text" });
  const second = control("button", 60);
  const inside = control("select", 0);
  const host = element("div", 100);
  const third = control("textarea", 200);
  const world = frame_world((page) => {
    host.page = page;
    page.add(first, control("input", 30, { type: "hidden" }), second, control("input", 80, { type: "checkbox" }, { disabled: true }), host, third, control("button", 300, {}, { visible: false }));
    host.attach_shadow(inside);
  });
  world.key("page.focus_field", { direction: "next", steps: 1 });
  assert.equal(world.page.active, first, "from the top of the view it starts at the first control");
  world.key("page.focus_field", { direction: "next", steps: 1 });
  assert.equal(world.page.active, second, "a hidden input is skipped");
  world.key("page.focus_field", { direction: "next", steps: 1 });
  assert.equal(world.page.active, inside, "a control of a shadow root comes at its host's place, and a disabled one is skipped");
  world.key("page.focus_field", { direction: "next", steps: 1 });
  assert.equal(world.page.active, third);
  world.key("page.focus_field", { direction: "next", steps: 1 });
  assert.equal(world.page.active, third, "past the last control nothing moves, and the invisible button is no stop");
  world.key("page.focus_field", { direction: "prev", steps: 2 });
  assert.equal(world.page.active, second, "a count moves that many controls");
  world.key("page.focus_field", { direction: "prev", steps: 9 });
  assert.equal(world.page.active, first, "a count past the first control stops on it");
  world.key("page.focus_field", { direction: "prev", steps: 1 });
  assert.equal(world.page.active, first, "before the first control nothing moves");
});

test("]l and [l focus the next and previous link and ignore anchors with no href", () => {
  const one = element("a", 10, { href: "https://one.example/" });
  const two = element("a", 60, { href: "https://two.example/" });
  const world = frame_world((page) => page.add(one, element("a", 30, { name: "top" }), two, control("input", 90)));
  world.key("page.focus_link", { direction: "next", steps: 1 });
  world.key("page.focus_link", { direction: "next", steps: 1 });
  assert.equal(world.page.active, two);
  world.key("page.focus_link", { direction: "prev", steps: 1 });
  assert.equal(world.page.active, one);
});

test("]h and [h move between headings from the top of the view, ]H and [H go to the ends, and a count steps further", () => {
  const h1 = heading(1, 0);
  const h2 = heading(2, 800);
  const h3 = heading(3, 1600);
  const h4 = heading(2, 2400);
  const world = frame_world((page) => page.add(h1, paragraph(100), h2, element("h2", 1000, { role: "presentation" }, "Not a heading"), element("h2", 1100, {}, ""), h3, element("div", 2000, { role: "heading", "aria-level": "5" }, "Role heading"), h4));
  const at_top = () => world.page.scrolls.at(-1)?.element;
  world.key("page.heading", { direction: "next", steps: 1 });
  assert.equal(at_top(), h2, "the heading at the top is passed, the next one scrolls to the top");
  assert.equal(world.page.scrolls.at(-1)?.block, "start");
  world.key("page.heading", { direction: "next", steps: 1 });
  assert.equal(at_top(), h3, "it steps from the heading it reached while that is on screen");
  world.key("page.heading", { direction: "next", steps: 2 });
  assert.equal(at_top(), h4, "a count of 2 skips the role=heading element");
  world.key("page.heading", { direction: "next", steps: 1 });
  assert.equal(at_top(), h4, "past the last heading nothing moves");
  world.key("page.heading", { direction: "prev", steps: 1 });
  assert.equal(world.page.scrolls.at(-1)?.element.innerText, "Role heading");
  world.key("page.heading", { direction: "first", steps: 4 });
  assert.equal(at_top(), h1, "first ignores the count");
  world.key("page.heading", { direction: "last", steps: 4 });
  assert.equal(at_top(), h4);
});

test("} and { move between headings and paragraphs of running text and skip navigation, forms and short captions", () => {
  const intro = paragraph(500);
  const next_heading = heading(2, 1000);
  const body = paragraph(1500);
  const world = frame_world((page) => {
    const nav = element("nav", 100);
    nav.append(Object.assign(paragraph(120), { page }));
    page.add(heading(1, 0), nav, element("p", 300, {}, "Skip to content"), intro, next_heading, element("footer", 1200), body);
    const footer = page.body.children.find((child) => child.localName === "footer")!;
    footer.append(paragraph(1250));
  });
  const reached = () => world.page.scrolls.at(-1)?.element;
  world.key("page.heading", { direction: "next_block", steps: 1 });
  assert.equal(reached(), intro, "a short caption and a paragraph in the navigation are no stops");
  world.key("page.heading", { direction: "next_block", steps: 1 });
  assert.equal(reached(), next_heading, "a heading is a stop of the block walk");
  world.key("page.heading", { direction: "next_block", steps: 1 });
  assert.equal(reached(), body, "a paragraph in the footer is skipped");
  world.key("page.heading", { direction: "prev_block", steps: 1 });
  assert.equal(reached(), next_heading);
});

test("zt, zz and zb align the heading a jump reached, then the focused element, and nothing when neither is there", () => {
  const h = heading(2, 800);
  const field = control("input", 300);
  const world = frame_world((page) => page.add(heading(1, 0), h, field));
  world.key("scroll.align", { position: "center" });
  assert.deepEqual(world.page.scrolls, [], "with nothing to align the key does nothing");
  world.key("page.heading", { direction: "next", steps: 1 });
  world.key("scroll.align", { position: "bottom" });
  assert.deepEqual(world.page.scrolls.at(-1), { element: h, block: "end" });
  world.key("scroll.align", { position: "center" });
  assert.deepEqual(world.page.scrolls.at(-1), { element: h, block: "center" });
  field.focus();
  world.fire("focusin", field);
  world.key("scroll.align", { position: "top" });
  assert.deepEqual(world.page.scrolls.at(-1), { element: field, block: "start" }, "a focus change after the jump takes over from the heading");
});

test("gi focuses the first visible text field, the one in view first, and ,b drops the focus and remembers the element", () => {
  const above = control("input", -400, { type: "text" });
  const in_view = control("textarea", 100);
  const no_box = control("input", 20, { type: "text" }, { box: { left: 0, top: 20, width: 0, height: 0 } });
  const world = frame_world((page) => page.add(control("input", 0, { type: "checkbox" }), above, no_box, in_view));
  world.key("page.focus_input");
  assert.equal(world.page.active, in_view);
  world.key("page.blur");
  assert.deepEqual([world.page.active, in_view.blurred], [null, 1]);
  world.key("page.blur");
  assert.equal(in_view.blurred, 1, "with nothing focused the key does nothing");
  world.key("page.focus_field", { direction: "prev", steps: 1 });
  assert.equal(world.page.active, above, "the walk goes on from the element the key dropped the focus from");
});

test("the frame script does nothing with the pref off, for another document, or for a message it does not own", () => {
  const off = frame_world((page) => page.add(control("input", 10)), { enabled: false });
  off.key("page.focus_input");
  assert.equal(off.page.active, null);
  const field = control("input", 10);
  const world = frame_world((page) => page.add(field));
  world.key("page.focus_input", {}, { inner: 99 });
  world.key("page.heading", { direction: "sideways", steps: 1 });
  world.key("page.focus_field", { direction: "next", steps: -3 });
  world.key("no.such.key", {});
  world.deliver("page-key", "junk");
  assert.equal(world.page.active, field, "a bad steps count is a count of 1 and the rest did nothing");
});

test("the heading list is the page's rows in order, and a pick scrolls to the snapshot's heading, which the page may have dropped", () => {
  const first = heading(1, 0, "Intro");
  const second = heading(2, 800, "Install   steps");
  const world = frame_world((page) => page.add(first, paragraph(100), second, element("h3", 900, {}, "")));
  const [listed] = world.ask("headings");
  assert.deepEqual(listed, { req: 1, inner: 7, rows: [[1, "Intro"], [2, "Install steps"]] });
  const [went] = world.ask("heading_go", { index: 1 });
  assert.deepEqual([went!["ok"], world.page.scrolls.at(-1)?.element], [true, second]);
  assert.deepEqual(world.ask("heading_go", { index: 5 })[0], { req: 3, inner: 7, ok: false, error: "none" });
  world.page.body.children.splice(2, 1);
  second.parent = null;
  assert.deepEqual(world.ask("heading_go", { index: 1 })[0], { req: 4, inner: 7, ok: false, error: "gone" });
  assert.deepEqual(world.ask("headings", {}, 99)[0], { req: 5, inner: 99, error: "changed" }, "a request for another document is answered as changed");
});

test("a pasted text goes into the focused field through the editing command, else the field's own range, and never into a non-field", () => {
  const field = control("input", 10, { type: "text" }, { selectionStart: 0, selectionEnd: 0, setRangeText: (text: string) => void (field.value += text) } as Partial<El>);
  const world = frame_world((page) => page.add(field, element("div", 50)));
  world.deliver("paste", { inner: 7, text: "hello\u0000​ world\nnext" });
  assert.deepEqual(world.executed, [], "no field has the focus");
  field.focus();
  world.deliver("paste", { inner: 7, text: "hello\u0000​ world\nnext" });
  assert.deepEqual(world.executed, ["insertText:hello world\nnext"], "control and format characters are stripped, a newline stays");
  world.page.exec_result = false;
  world.deliver("paste", { inner: 7, text: "more" });
  assert.equal(field.value, "more", "without the editing command the field takes the text as a range");
  world.deliver("paste", { inner: 8, text: "stale" });
  field.readOnly = true;
  world.deliver("paste", { inner: 7, text: "read only" });
  assert.deepEqual(world.executed.length, 2, "another document and a read-only field get nothing");
  world.page.active = world.page.body.children[1]!;
  world.deliver("paste", { inner: 7, text: "div" });
  assert.equal(world.executed.length, 2);
});

// The parent's two kinds over a tab the module may act in.
function parent_world({ private_window = false } = {}) {
  const firefox = create_firefox({ extra_files: { [PAGE_KEYS_FILE]: source_of(PAGE_KEYS_FILE) } });
  firefox.start_extension();
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
  let next_id = 0;
  const flush = async () => {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
  };
  const replies = () => (firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as { reply_to: string; ok: boolean; error?: string; value?: string }[];
  // Sends the kind, lets the frame script's answer come from `answer` (given the request the module sent the tab), and returns the module's reply.
  async function call(kind: string, args: Record<string, unknown>, answer?: (request: Record<string, unknown>, tab: typeof a) => void, tab = a) {
    const id = `r${next_id++}`;
    const before = firefox.sent_to_frames.length;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind, args, sent_at: Date.now() }]);
    await flush();
    const asked = firefox.sent_to_frames.slice(before).filter((each) => each.name === `${PREFIX}page-ask`);
    if (answer && asked[0]) answer(asked[0].data as Record<string, unknown>, tab);
    await flush();
    const reply = replies().find((each) => each.reply_to === id);
    return { reply: reply && plain(reply), asked: asked.map((each) => plain(each.data)) };
  }
  const frame_answers = (tab: typeof a, data: Record<string, unknown>) => firefox.emit_message(`${PREFIX}page-reply`, tab.browser, data);
  return { firefox, window, a, b, ids, call, frame_answers };
}

test("page_headings.read asks the tab's frame script and replies with the rows capped and cleaned", async () => {
  const { call, frame_answers, ids } = parent_world();
  const rows = [[1, "  Title\u0000 "], [9, "bad level"], [2, "x".repeat(300)], "junk", [3, 5]];
  const { reply, asked } = await call("page_headings.read", { tab_id: ids.a }, (request, tab) => frame_answers(tab, { req: request["req"], inner: request["inner"], rows }));
  assert.deepEqual(asked.map((each) => ({ name: each.name, inner: each.inner })), [{ name: "headings", inner: 10 }]);
  assert.equal(reply?.ok, true);
  const listed = JSON.parse(reply!.value!) as [number, string][];
  assert.deepEqual(listed.map(([level, text]) => [level, text.length]), [[1, 5], [2, 120]]);
  assert.equal(listed[0]![1], "Title");
});

test("page_headings.read keeps a list of many long headings under its byte cap and its row cap", async () => {
  const { call, frame_answers, ids } = parent_world();
  const rows = Array.from({ length: 900 }, (_, index) => [2, `${index} ${"é".repeat(115)}`]);
  const { reply } = await call("page_headings.read", { tab_id: ids.a }, (request, tab) => frame_answers(tab, { req: request["req"], inner: request["inner"], rows }));
  assert.equal(reply?.ok, true);
  const listed = JSON.parse(reply!.value!) as unknown[];
  assert.ok(listed.length > 100 && listed.length <= 300, `${listed.length} rows`);
  assert.ok(new TextEncoder().encode(reply!.value!).length <= 40_000);
});

test("page_headings.read refuses a tab that is gone, not selected or not the asker's, and a reply from another tab, document or request is not heard", async () => {
  const { call, frame_answers, ids, a, b } = parent_world();
  assert.equal((await call("page_headings.read", { tab_id: 9999 })).reply?.ok, false);
  assert.equal((await call("page_headings.read", { tab_id: ids.b })).reply?.error, "The tab that asked is no longer selected");
  const wrong_tab = await call("page_headings.read", { tab_id: ids.a }, (request) => frame_answers(b, { req: request["req"], inner: request["inner"], rows: [[1, "From another tab"]] }));
  assert.equal(wrong_tab.reply?.ok, undefined, "a reply from another tab is ignored and the call waits");
  const stale = await call("page_headings.read", { tab_id: ids.a }, (request, tab) => frame_answers(tab, { req: request["req"], inner: 99, rows: [[1, "Old page"]] }));
  assert.equal(stale.reply?.ok, undefined, "a reply for another document is ignored");
  const loaded = await call("page_headings.read", { tab_id: ids.a }, (request, tab) => {
    (tab.browser as { innerWindowID: number }).innerWindowID = 11;
    frame_answers(tab, { req: request["req"], inner: request["inner"], rows: [[1, "Before the load"]] });
  });
  assert.equal(loaded.reply?.ok, undefined);
  (a.browser as { innerWindowID: number }).innerWindowID = 10;
});

test("page_heading.go sends the index and turns the frame script's answer into the reply", async () => {
  const { call, frame_answers, ids } = parent_world();
  const went = await call("page_heading.go", { tab_id: ids.a, index: 3 }, (request, tab) => frame_answers(tab, { req: request["req"], inner: request["inner"], ok: true }));
  assert.deepEqual([went.asked[0]?.name, went.asked[0]?.index, went.reply?.ok], ["heading_go", 3, true]);
  const gone = await call("page_heading.go", { tab_id: ids.a, index: 3 }, (request, tab) => frame_answers(tab, { req: request["req"], inner: request["inner"], ok: false, error: "gone" }));
  assert.deepEqual([gone.reply?.ok, gone.reply?.error], [false, "That heading is gone"]);
  const none = await call("page_heading.go", { tab_id: ids.a, index: 3 }, (request, tab) => frame_answers(tab, { req: request["req"], inner: request["inner"], ok: false, error: "none" }));
  assert.equal(none.reply?.error, "No such heading");
  const far = await call("page_heading.go", { tab_id: ids.a, index: 5000 });
  assert.deepEqual([far.asked, far.reply?.error], [[], "No such heading"], "an index past the list cap never reaches the page");
});
