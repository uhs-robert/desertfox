import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { arrow_queued, arrow_step } from "../src/content/site_actions/arrow.ts";
import type { ArrowPage } from "../src/content/site_actions/arrow.ts";
import { site_mode } from "../src/content/site_mode.ts";
import { mode_site } from "../src/content/handlers/mode.ts";
import { deepest_focused_element } from "../src/content/editable.ts";
import { KEY_PAIR_GAP_MS } from "../src/content/lib/send_key.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { RuntimeRefusal } from "../src/shared/command.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, PageKeymap, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";

// Fakes for the page: elements record the events they get, in order.
type Fake = Record<string, unknown> & { log: string[] };
const fake = (props: Record<string, unknown>, cancels_keydown = false): Fake => {
  const log: string[] = [];
  const element = { log, dispatchEvent: (event: Event) => (log.push(event.type), !(cancels_keydown && event.type === "keydown")), focus: () => log.push("focus"), click: () => log.push("click") };
  return Object.defineProperties(element, Object.getOwnPropertyDescriptors(props)) as unknown as Fake;
};
const page_of = (active: Fake | null) => {
  const scrolls: [number, number][] = [];
  const page = { focused: () => (active && deepest_focused_element(active as never)) || null, scroll_by: (dx: number, dy: number) => void scrolls.push([dx, dy]), make_event: (type: string, init: KeyboardEventInit) => ({ type, ...init }) as unknown as Event };
  return { page: page as never, scrolls };
};
const options = (...disabled: boolean[]) => disabled.map((d) => ({ disabled: d }));

test("a select moves one option per press, skips disabled ones, stops at the ends and fires input then change", () => {
  const select = fake({ tagName: "SELECT", selectedIndex: 0, options: options(false, true, false) });
  const { page } = page_of(select);
  arrow_step(page, "down");
  assert.equal(select["selectedIndex"], 2);
  assert.deepEqual(select.log, ["input", "change"]);
  arrow_step(page, "down");
  assert.equal(select["selectedIndex"], 2);
  assert.deepEqual(select.log, ["input", "change"]);
  arrow_step(page, "up");
  assert.equal(select["selectedIndex"], 0);
  assert.deepEqual(select.log, ["input", "change", "input", "change"]);
});

test("a select skips an option whose optgroup is disabled", () => {
  const select = fake({ tagName: "SELECT", selectedIndex: 0, options: [{ disabled: false }, { disabled: false, parentElement: { disabled: true } }, { disabled: false }] });
  arrow_step(page_of(select).page, "down");
  assert.equal(select["selectedIndex"], 2);
});

test("a range steps by its own step, and fires events only when the value changed", () => {
  {
    const type = "range";
    let value = 5;
    const input = fake({ tagName: "INPUT", type, get value() { return String(value); }, stepUp: () => void (value = Math.min(value + 1, 6)), stepDown: () => void (value -= 1) });
    const { page } = page_of(input);
    arrow_step(page, "right");
    assert.deepEqual(input.log, ["input", "change"], type);
    arrow_step(page, "up");
    assert.deepEqual(input.log, ["input", "change"], `${type} at the maximum`);
    arrow_step(page, "left");
    assert.equal(value, 5, type);
    assert.deepEqual(input.log, ["input", "change", "input", "change"], type);
  }
});

test("a radio press checks and focuses the next radio of its group, wraps, and leaves other groups alone", () => {
  const radio = (name: string) => fake({ tagName: "INPUT", type: "radio", name, checked: false, disabled: false, form: null });
  const a = radio("g");
  const other = radio("h");
  const b = radio("g");
  Object.assign(b, { disabled: true });
  const c = radio("g");
  const root = { querySelectorAll: () => [a, other, b, c] };
  for (const r of [a, other, b, c]) r["getRootNode"] = () => root;
  const { page } = page_of(a);
  arrow_step(page, "down");
  assert.deepEqual(c.log, ["focus", "click"], "a click makes the browser check the radio and fire click, input and change, which a script framework reads");
  assert.deepEqual([a.log, b.log, other.log], [[], [], []]);
  const { page: from_c } = page_of(c);
  arrow_step(from_c, "right");
  assert.deepEqual(a.log, ["focus", "click"], "wraps to the first radio");
  arrow_step(from_c, "up");
  assert.deepEqual(a.log, ["focus", "click", "focus", "click"], "the previous radio of c is a, as b is disabled");
});

test("a radio outside its form that names the form with form= is in the group of the radios inside it", () => {
  const form = { querySelectorAll: () => [inside] };
  const inside = fake({ tagName: "INPUT", type: "radio", name: "g", disabled: false, form });
  const outside = fake({ tagName: "INPUT", type: "radio", name: "g", disabled: false, form });
  const root = { querySelectorAll: () => [inside, outside] };
  for (const r of [inside, outside]) r["getRootNode"] = () => root;
  arrow_step(page_of(inside).page, "down");
  assert.deepEqual(outside.log, ["focus", "click"]);
});

test("with nothing focused, or the body, a press scrolls like the normal keys and sends no key", () => {
  for (const active of [null, fake({ tagName: "BODY" })]) {
    const { page, scrolls } = page_of(active);
    for (const direction of ["left", "down", "up", "right"] as const) arrow_step(page, direction);
    assert.deepEqual(scrolls, [[-50, 0], [0, 50], [0, -50], [50, 0]]);
    if (active) assert.deepEqual(active.log, []);
  }
});

test("any other focused element gets a synthetic arrow keydown and keyup, and the page scrolls only when the page did not cancel the keydown", () => {
  const widget = fake({ tagName: "DIV" }, true);
  const widget_page = page_of(widget);
  let init: KeyboardEventInit | undefined;
  arrow_step({ ...(widget_page.page as ArrowPage), make_event: (type: string, event_init: KeyboardEventInit) => ((init = event_init), { type }) as unknown as Event }, "up");
  assert.deepEqual(widget.log, ["keydown", "keyup"]);
  assert.equal(init?.composed, true, "a real key crosses shadow roots, so a widget's listener on its host sees the arrow");
  assert.deepEqual(widget_page.scrolls, []);
  const link = fake({ tagName: "A" });
  const link_page = page_of(link);
  arrow_step(link_page.page, "down");
  assert.deepEqual(link.log, ["keydown", "keyup"]);
  assert.deepEqual(link_page.scrolls, [[0, 50]]);
});

test("a control inside a shadow root gets the step, not its host", () => {
  const select = fake({ tagName: "SELECT", selectedIndex: 0, options: options(false, false) });
  const host = fake({ tagName: "X-MENU", shadowRoot: { activeElement: select } });
  const { page, scrolls } = page_of(host);
  arrow_step(page, "down");
  assert.equal(select["selectedIndex"], 1);
  assert.deepEqual([host.log, scrolls], [[], []]);
});

test("a range with step any steps by one percent of its span, through the prototype setter", () => {
  let stored = 20;
  const proto = { get value() { return String(stored); }, set value(next: string) { stored = Number(next); } };
  const input = Object.assign(Object.create(proto), fake({ tagName: "INPUT", type: "range", min: "0", max: "50", stepUp: () => { throw new Error("InvalidStateError"); }, stepDown: () => { throw new Error("InvalidStateError"); } }));
  const { page } = page_of(input);
  arrow_step(page, "right");
  assert.equal(stored, 20.5);
  assert.deepEqual(input.log, ["input", "change"]);
  arrow_step(page, "left");
  assert.equal(stored, 20);
});

test("a range with step any and a maximum of 0 steps by one percent of its span", () => {
  let stored = -50;
  const proto = { get value() { return String(stored); }, set value(next: string) { stored = Number(next); } };
  const input = Object.assign(Object.create(proto), fake({ tagName: "INPUT", type: "range", min: "-100", max: "0", stepUp: () => { throw new Error("InvalidStateError"); }, stepDown: () => { throw new Error("InvalidStateError"); } }));
  arrow_step(page_of(input).page, "right");
  assert.equal(stored, -49);
});

test("the steps of a count are one gap apart", async () => {
  const stamps: number[] = [];
  const item = fake({ tagName: "DIV" }, true);
  item.dispatchEvent = (event: Event) => (event.type === "keydown" && stamps.push(Date.now()), false);
  await arrow_queued(page_of(item).page, { direction: "down", times: 3 });
  assert.equal(stamps.length, 3);
  assert.ok(stamps[1]! - stamps[0]! >= KEY_PAIR_GAP_MS - 2 && stamps[2]! - stamps[1]! >= KEY_PAIR_GAP_MS - 2, `gaps ${stamps}`);
});

test("a count repeats the step, and one call is one queue entry", async () => {
  const select = fake({ tagName: "SELECT", selectedIndex: 0, options: options(false, false, false, false) });
  const { page } = page_of(select);
  await arrow_queued(page, { direction: "down", times: 3 });
  assert.equal(select["selectedIndex"], 3);
});

test("a count over the limit refuses before it takes the queue", async () => {
  const select = fake({ tagName: "SELECT", selectedIndex: 0, options: options(false, false) });
  await assert.rejects(arrow_queued(page_of(select).page, { direction: "down", times: 100 }), RuntimeRefusal);
  assert.equal(select["selectedIndex"], 0);
});

test("a count with nothing focused is one scroll of the whole distance, so a scroll that waits for the layout keeps it", async () => {
  const { page, scrolls } = page_of(null);
  await arrow_queued(page, { direction: "down", times: 3 });
  assert.deepEqual(scrolls, [[0, 150]]);
});

test("page.arrow takes a direction and a count, and refuses anything else", () => {
  const command = registry.get("page.arrow")!;
  assert.equal(command.runs_in, "content");
  assert.equal(command.bundle, "site_actions");
  assert.equal(check_args(command, { direction: "down" }, {}).ok, true);
  assert.equal(check_args(command, { direction: "down", times: 3 }, {}).ok, true);
  assert.equal(check_args(command, { direction: "sideways" }, {}).ok, false);
});

const compiled = (rows = DEFAULT_SITE_ROWS, settings: Record<string, unknown> = {}) =>
  compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: rows, get_command: (id) => registry.get(id), enum_sources: {} });
const ask = async (keymap: CompiledKeymap, url: string) => (await page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never, [url]))!;
const ids = (node: unknown) => (node as TreeLeaf).steps.map((step) => step.invocation.id);

test("every page gets a sticky arrow mode labelled ARROW, and Alt+l toggles it from the browser block", async () => {
  const result = compiled();
  assert.deepEqual(result.warnings, []);
  for (const url of ["https://a.test/", "http://b.test/x?y=1", "https://docs.google.com/spreadsheets/d/1"]) {
    const reply = await ask(result.compiled, url);
    const mode = reply.site_modes!["arrow"]!;
    assert.equal(mode.label, "ARROW", url);
    assert.equal(mode.sticky, true, url);
    assert.equal(mode.tree["g"], undefined, "no start key lives in the row");
    const toggle = reply.keymap.modes.browser!.children["<A-l>"] as TreeLeaf;
    assert.deepEqual([ids(toggle), toggle.steps[0]!.invocation.args], [["mode.site"], { name: "arrow", toggle: true }], url);
    for (const key of ["h", "j", "k", "l"]) assert.deepEqual(ids(mode.tree[key]), ["page.arrow"], `${url} ${key}`);
  }
});

test("default_site_rows_off turns the arrow mode off", async () => {
  const reply = await ask(compiled(DEFAULT_SITE_ROWS, { default_site_rows_off: ["arrow"] }).compiled, "https://a.test/");
  assert.equal(reply.site_modes, undefined);
});

test("a user row that names its own arrow mode wins", async () => {
  const user = { site: "https://a.test/*", modes: { arrow: { label: "MINE", bind: { j: { id: "tab.next" } } } } };
  const reply = await ask(compiled(DEFAULT_SITE_ROWS, { site_rules: [user] }).compiled, "https://a.test/");
  assert.equal(reply.site_modes!["arrow"]!.label, "MINE");
});

test("in the mode Escape ends the mode first and then sends Escape to the page once, so a failed send cannot leave the mode on", async () => {
  const reply = await ask(compiled().compiled, "https://a.test/");
  const escape = reply.site_modes!["arrow"]!.tree["<Escape>"] as TreeLeaf;
  assert.deepEqual(escape.steps.map((step) => [step.invocation.id, step.invocation.args?.key ?? step.invocation.args?.name]), [["mode.site", "off"], ["page.send_key", "Escape"]]);
});

// What main.ts does: normal mode with the running mode's children laid over it.
function overlay(reply: PageKeymap, name: string | undefined): CompiledKeymap {
  const normal = reply.keymap.modes.normal as TreeBranch;
  const mode = name === undefined ? undefined : reply.site_modes![name];
  return { ...reply.keymap, modes: { ...reply.keymap.modes, normal: mode ? { ...normal, children: { ...normal.children, ...mode.tree } } : normal } } as CompiledKeymap;
}

test("typed keys run the mode binds while the mode is on, and the normal binds once it is off", async () => {
  const reply = await ask(compiled().compiled, "https://a.test/");
  const state = create_mode_state();
  const ran: string[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false, user_input_seen_: () => false, blur_window_open_: () => false, escape_to_page_: () => false, get_mode_: state.get_mode_, take_pass_next_: state.take_pass_next_,
    run_leaf_: (leaf) => void ran.push(leaf.steps.map((step) => `${step.invocation.id}:${step.invocation.args?.direction ?? step.invocation.args?.name ?? step.invocation.args?.key ?? ""}`).join("+")),
    leave_insert_: () => {}, is_loading_: () => false, loading_sink_bundles_: () => [], sink_of_: () => undefined, on_prefix_: () => {},
  });
  flow.set_matcher_(create_matcher(overlay(reply, "arrow")));
  for (const token of ["j", "l", "<Escape>"]) assert.equal(flow.handle_token_(token), "cancel");
  assert.deepEqual(ran, ["page.arrow:down", "page.arrow:right", "mode.site:off+page.send_key:Escape"]);
  flow.set_matcher_(create_matcher(overlay(reply, undefined)));
  flow.handle_token_("j");
  assert.equal(ran.at(-1)!.startsWith("scroll.lines"), true);
});

test("a mode with the sticky flag keeps running through a mouse press or an uncancelled key, and a mode change ends it", () => {
  site_mode.modes_ = { arrow: { label: "ARROW", tree: {}, sticky: true }, visual: { label: "VISUAL", tree: {} } };
  let changes = 0;
  site_mode.on_change_ = () => void changes++;
  site_mode.set_("arrow");
  site_mode.end_on_input_();
  assert.equal(site_mode.name_, "arrow");
  assert.equal(changes, 1);
  site_mode.set_();
  assert.equal(site_mode.name_, undefined);
  site_mode.set_("visual");
  site_mode.end_on_input_();
  assert.equal(site_mode.name_, undefined, "another mode keeps the ordinary exit rules");
  site_mode.set_("arrow");
  site_mode.set_();
  assert.equal(site_mode.name_, undefined, "a mode change, a keymap update and Escape end it through set_");
  site_mode.modes_ = undefined;
  site_mode.on_change_ = () => {};
});

test("mode.site with toggle leaves the focused field alone when the page has no such mode", async () => {
  class FakeField {
    tagName = "TEXTAREA";
    isContentEditable = false;
    blurred = false;
    blur() {
      this.blurred = true;
    }
  }
  const field = new FakeField();
  Object.assign(globalThis, { document: { activeElement: field, body: {} }, HTMLElement: FakeField, HTMLInputElement: class {}, window: { frameElement: null } });
  site_mode.modes_ = {};
  await mode_site.run({ name: "arrow", toggle: true }, false);
  assert.equal(field.blurred, false);
  site_mode.modes_ = { arrow: { label: "ARROW", tree: {}, sticky: true } };
  site_mode.on_change_ = () => {};
  await mode_site.run({ name: "arrow", toggle: true }, false);
  assert.equal(field.blurred, true, "with the mode there, the start blurs the field");
  site_mode.set_();
  site_mode.modes_ = undefined;
});

test("mode.site with toggle starts the mode the first time and ends it the second", async () => {
  // The start reads the focus, which a top frame with nothing focused answers with no element.
  Object.assign(globalThis, { document: { activeElement: null }, HTMLElement: class {}, window: { frameElement: null } });
  site_mode.modes_ = { arrow: { label: "ARROW", tree: {}, sticky: true } };
  site_mode.on_change_ = () => {};
  await mode_site.run({ name: "arrow", toggle: true }, false);
  assert.equal(site_mode.name_, "arrow");
  await mode_site.run({ name: "arrow", toggle: true }, false);
  assert.equal(site_mode.name_, undefined);
  await mode_site.run({ name: "arrow" }, false);
  await mode_site.run({ name: "arrow" }, false);
  assert.equal(site_mode.name_, "arrow", "without toggle a second start changes nothing");
  site_mode.set_();
  site_mode.modes_ = undefined;
});
