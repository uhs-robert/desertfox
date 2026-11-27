import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, MODULE_COMMAND_ARGS, validate_module_hello } from "../../src/shared/browser_module_protocol.ts";
import type { ScopeTree } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, scope_tree_of } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { event_to_token } from "../../src/shared/keys/token.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { COMMANDS_FILE, create_firefox, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const DEFAULT_TREE = scope_tree_of(
  compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).compiled,
  locked_page_command_ids(registry.list()),
  (id, args) => {
    const command = registry.get(id);
    const checked = command && check_args(command, args);
    return checked?.ok ? checked.args : undefined;
  },
);
const ROWS = [{ key: "J", id: "tab.next", args: {} }];
const state = (patch: Record<string, unknown> = {}) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: ROWS, tabs: {}, tree: DEFAULT_TREE, ...patch });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

type Core = { share_locked_page_rule(rule: { hint_notice(browser: unknown): string | undefined }): void; take_held_keys(win: unknown, end?: boolean): string; module_pending(win: unknown): unknown; set_hello_flag(name: unknown, on: unknown): boolean; status(): { commands: string[] } };

// One window with two tabs, the core, the tab and scroll feature and the commands feature loaded, and the state written.
function started({ written = state() as unknown, private_window = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [COMMANDS_FILE]: source_of(COMMANDS_FILE) } });
  firefox.start_extension({ private_access });
  const window = firefox.make_window({ private_window });
  window.load();
  const first = window.add_tab();
  const second = window.add_tab();
  if (written !== null) firefox.write_state(written);
  const core = firefox.Services.desertfox_browser_module as Core;
  let on = first.browser;
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window.press(key_event(key, { target: on, originalTarget: on, ...patch }));
  const type = (...keys: string[]) => keys.map((key) => press(key));
  const on_tab = (tab: typeof first) => {
    on = tab.browser;
    window.select(tab);
  };
  // The run requests the module wrote, as { keys, count }.
  const runs = () => ((firefox.read_holder("desertfox_browser_module_from_module") ?? []) as { kind?: string; args?: unknown }[]).filter((message) => message.kind === "run").map((message) => plain(message.args));
  return { firefox, window, first, second, core, press, type, on_tab, runs };
}

test("the committed bundle runs: it defines page.stop and takes keys, and the feature files define every command of the protocol", () => {
  const { core, firefox } = started();
  assert.deepEqual(plain(core.status().commands).sort(), Object.keys(MODULE_COMMAND_ARGS).sort());
  assert.deepEqual(firefox.errors, []);
});

test("a forward leaf sends its keys and the count, and every key of the sequence is stopped", () => {
  const { type, runs, window } = started();
  const events = type("x", "x");
  assert.ok(events.every((event) => event.prevented && event.stopped));
  type("5", "x", "x");
  type("g", "t");
  type("<", "<");
  assert.deepEqual(runs(), [{ keys: "x x", count: 0 }, { keys: "x x", count: 5 }, { keys: "g t", count: 0 }, { keys: "< <", count: 0 }]);
  assert.deepEqual(window.tab_moves, []);
});

test("a native leaf runs in the module: J with a count, gg, xp and a scroll count", () => {
  const { type, press, runs, window, first, firefox } = started();
  type("5", "J");
  assert.deepEqual(window.tab_moves, [1, 1, 1, 1, 1]);
  type("g", "g");
  type("x", "p");
  assert.equal(first.browser.stops, 1);
  type("3");
  press("d", { ctrlKey: true });
  assert.deepEqual(plain(firefox.sent_to_frames.map(({ data }) => data)), [
    { id: "scroll.to", args: { percent: 0, axis: "y" }, repeat: false },
    { id: "scroll.pages", args: { fraction: 0.5, count: 3 }, repeat: false },
  ]);
  assert.deepEqual(runs(), []);
});

test("a count past the cap repeats a native command 100 times", () => {
  const { type, window } = started();
  type("9", "9", "9", "J");
  assert.equal(window.tab_moves.length, 100);
});

test("keys the tree leaves out reach the page: f, / and i", () => {
  const { press, runs } = started();
  for (const key of ["f", "/", "i"]) assert.equal(press(key).prevented, false, key);
  assert.deepEqual(runs(), []);
});

// The commands feature with a stand-in for the locked pages feature's rule: the notice each tab browser gets, as the test sets it.
function with_notices() {
  const setup = started();
  const notices = new Map<unknown, string | undefined>();
  setup.core.share_locked_page_rule({ hint_notice: (browser) => notices.get(browser) });
  return { ...setup, notices };
}

test("where hints cannot run, the hint keys are claimed and the first one per document is sent, so the extension says why", () => {
  const { press, type, runs, first, notices } = with_notices();
  notices.set(first.browser, "pages_off");
  assert.ok(press("f").prevented, "f is claimed");
  assert.ok(press("f").prevented, "f stays claimed after the notice");
  assert.ok(type(";", "l").every((event) => event.prevented), "a hint sequence is claimed");
  assert.deepEqual(runs(), [{ keys: "f", count: 0 }], "one notice per document");
  first.browser.innerWindowID = 11;
  type("3", "F");
  assert.deepEqual(runs(), [{ keys: "f", count: 0 }, { keys: "F", count: 0 }], "a new document says it again, without the count");
  type("x", "x");
  assert.deepEqual(runs().at(-1), { keys: "x x", count: 0 }, "the tree's own keys still run");
});

test("an about: page claims the hint keys too, and a page with no notice, a web page among them, leaves them to the page", () => {
  const { press, runs, first, second, on_tab, notices } = with_notices();
  notices.set(first.browser, "not_here");
  assert.ok(press("f").prevented);
  on_tab(second);
  for (const key of ["f", ";", "F"]) assert.equal(press(key).prevented, false, key);
  assert.deepEqual(runs(), [{ keys: "f", count: 0 }]);
});

test("the hint keys go to the page at once when the notice ends, as when browser_module_pages turns on", () => {
  const { press, runs, first, notices, core, window } = with_notices();
  notices.set(first.browser, "pages_off");
  assert.ok(press(";").prevented, "a hint prefix is claimed");
  notices.set(first.browser, undefined);
  assert.equal(press("f").prevented, false, "the half-typed ; ends with the notice, and f goes to the page");
  assert.equal(core.module_pending(window.win), undefined);
  assert.equal(press(";").prevented, false);
  assert.deepEqual(runs(), []);
});

test("no hint key is claimed with the focus in a field, where DesertFox is live, or from a tree with no hint keys", () => {
  const field = with_notices();
  field.notices.set(field.first.browser, "not_here");
  field.window.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.equal(field.press("f").prevented, false);
  const live = with_notices();
  live.notices.set(live.first.browser, "pages_off");
  live.firefox.report(live.first.browser, { inner: 10, listeners: 1, field: false });
  assert.equal(live.press("f").prevented, false);
  const older = with_notices();
  older.notices.set(older.first.browser, "pages_off");
  const { hint_keys: _hint_keys, ...tree } = DEFAULT_TREE;
  older.firefox.write_state(state({ tree }));
  assert.equal(older.press("f").prevented, false);
  for (const each of [field, live, older]) assert.deepEqual(each.runs(), []);
});

test("a tree binding wins over a hint key on its way", () => {
  const { press, runs, first, notices, firefox } = with_notices();
  notices.set(first.browser, "pages_off");
  firefox.write_state(state({ tree: { children: { f: "forward" }, hint_keys: ["f", "f g"] } }));
  press("f");
  assert.deepEqual(runs(), [{ keys: "f", count: 0 }]);
  press("f");
  assert.deepEqual(runs().length, 2, "f runs its binding each time, never the notice");
});

test("the token of a key event is event_to_token's, for every key shape", () => {
  const shapes = [
    key_event("J"),
    key_event("$", { shiftKey: true }),
    key_event(" "),
    key_event("Escape", { shiftKey: true }),
    key_event("D", { ctrlKey: true, shiftKey: true }),
    key_event("в", { ctrlKey: true, code: "KeyD" }),
    key_event("в", { code: "KeyD" }),
    key_event("F5"),
    key_event("ArrowDown", { shiftKey: true }),
    key_event("k", { altKey: true, metaKey: true }),
  ];
  for (const event of shapes) {
    const token = event_to_token(event)!;
    const tree: ScopeTree = { children: { [token]: "forward" } };
    const { press, runs } = started({ written: state({ tree }) });
    const { target: _target, originalTarget: _original, ...shape } = event;
    press(event.key, shape);
    assert.deepEqual(runs(), [{ keys: token, count: 0 }], `the module did not read ${JSON.stringify(event.key)} as ${token}`);
  }
});

test("a remap starts the sequence again, and a rewrite of the same tree keeps it", () => {
  const before: ScopeTree = { children: { g: { children: { t: "forward" } } } };
  const after: ScopeTree = { children: { g: { children: { u: "forward" } }, t: "forward" } };
  const { firefox, type, runs } = started({ written: state({ tree: before }) });
  type("g");
  firefox.write_state(state({ tree: structuredClone(before), tabs: { "9": { mode: "normal", live: false } } }));
  type("t");
  type("g");
  firefox.write_state(state({ tree: after }));
  type("t");
  assert.deepEqual(runs(), [{ keys: "g t", count: 0 }, { keys: "t", count: 0 }]);
});

test("module_pending drops the half-typed keys when the tree changes or goes, and keeps them through a rewrite of the same tree", () => {
  const tree: ScopeTree = { children: { g: { children: { t: "forward" } } } };
  const { firefox, type, core, window: fake } = started({ written: state({ tree }) });
  const win = vm.runInContext("globalThis", fake.win.context!);
  type("g");
  firefox.write_state(state({ tree: structuredClone(tree), tabs: { "9": { mode: "normal", live: false } } }));
  assert.deepEqual(plain(core.module_pending(win)), { keys: ["g"] });
  firefox.write_state(state({ tree: { children: { g: { children: { u: "forward" } } } } }));
  assert.equal(core.module_pending(win), undefined);
  type("g");
  firefox.write_state(state({ tree: undefined }));
  assert.equal(core.module_pending(win), undefined);
});

test("a half-typed sequence ends when the tab switches or the page loads another document", () => {
  const { type, press, runs, on_tab, first, second } = started();
  type("g");
  on_tab(second);
  type("t");
  assert.deepEqual(runs(), []);
  on_tab(first);
  type("x");
  first.browser.innerWindowID = 11;
  assert.equal(press("x").prevented, true);
  assert.deepEqual(runs(), []);
});

test("module_pending gives the selected tab's half-typed keys and count, and nothing for another tab", () => {
  const { type, core, window: fake, on_tab, second } = started();
  // The status bar asks with its own global, which is how the core saw the window.
  const window = { win: vm.runInContext("globalThis", fake.win.context!), select: fake.select };
  assert.equal(core.module_pending(window.win), undefined);
  type("5");
  assert.deepEqual(plain(core.module_pending(window.win)), { keys: [], count: 5 });
  type("g");
  assert.deepEqual(plain(core.module_pending(window.win)), { keys: ["g"], count: 5 });
  window.select(second);
  assert.equal(core.module_pending(window.win), undefined);
  on_tab(second);
  type("x");
  assert.deepEqual(plain(core.module_pending(window.win)), { keys: ["x"] });
});

test("Shift+Escape gives every key to the page in that tab until it is pressed again or the page loads", () => {
  const { press, type, runs, window, first, on_tab, second } = started();
  assert.equal(press("Escape", { shiftKey: true }).prevented, true);
  assert.equal(press("J").prevented, false);
  assert.ok(type("x", "x").every((event) => !event.prevented));
  on_tab(second);
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
  on_tab(first);
  assert.equal(press("j").prevented, false);
  press("Escape", { shiftKey: true });
  press("J");
  assert.deepEqual(window.tab_moves, [1, 1]);
  press("Escape", { shiftKey: true });
  first.browser.innerWindowID = 12;
  press("J");
  assert.deepEqual(window.tab_moves, [1, 1, 1]);
  assert.deepEqual(runs(), []);
});

test("nothing is taken where DesertFox is live, in a field, or in another mode", () => {
  const live = started();
  live.firefox.report(live.first.browser, { inner: 10, listeners: 1, field: false });
  assert.equal(live.press("x").prevented, false);
  assert.equal(live.press(":", { shiftKey: true }).prevented, false);

  const field = started();
  field.window.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.ok(field.type("x", "x", "J").every((event) => !event.prevented));
  assert.equal(field.press("Escape", { shiftKey: true }).prevented, false);

  const insert = started({ written: state({ tabs: { "1": { mode: "insert", live: false } } }) });
  assert.equal(insert.press("x").prevented, false);
  for (const each of [live, field, insert]) assert.deepEqual(each.runs(), []);
});

test("a key a guard refuses ends the half-typed sequence: x, a field, then x closes nothing", () => {
  const { press, type, runs, window } = started();
  type("x");
  window.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.equal(press("a").prevented, false);
  window.win.windowUtils.IMEStatus = 0;
  type("x");
  assert.deepEqual(runs(), []);
  const live = started();
  live.type("g");
  live.firefox.report(live.first.browser, { inner: 10, listeners: 1, field: false });
  live.press("q");
  live.firefox.report(live.first.browser, { inner: 10, listeners: 0, field: false });
  live.type("t");
  assert.deepEqual(live.runs(), []);
  // A key outside a page (the browser UI or DevTools) ends it too.
  const outside = started();
  outside.type("g");
  outside.window.press(key_event("a", { target: { localName: "input", ownerDocument: outside.window.win.document } }));
  outside.type("t");
  assert.deepEqual(outside.runs(), []);
});

test("a sequence typed before the module or the toolbar switch went off does not finish after it comes back", () => {
  const tree: ScopeTree = { children: { g: { children: { t: "forward" } } } };
  const { firefox, type, runs } = started({ written: state({ tree }) });
  type("g");
  firefox.set_pref(false);
  firefox.set_pref(true);
  type("t");
  type("g");
  firefox.write_state(state({ enabled: false, tree: undefined }));
  firefox.write_state(state({ tree }));
  type("t");
  type("g", "t");
  assert.deepEqual(runs(), [{ keys: "g t", count: 0 }]);
});

test("with no tree a single-key row wins over the module's own : and Shift+Escape", () => {
  const keys = [...ROWS, { key: ":", id: "tab.prev", args: {} }, { key: "<S-Escape>", id: "tab.prev", args: {} }];
  const { press, window } = started({ written: state({ tree: undefined, keys }) });
  press(":", { shiftKey: true });
  press("Escape", { shiftKey: true });
  assert.deepEqual(window.tab_moves, [-1, -1]);
  assert.deepEqual(window.address_bar, []);
  press("J");
  assert.deepEqual(window.tab_moves, [-1, -1, 1]);
});

test("with no tree or a bad one, the single-key rows decide", () => {
  for (const tree of [undefined, { children: { x: "run anything" } }]) {
    const { press, type, runs, window, firefox } = started({ written: state({ tree }) });
    assert.ok(type("x", "x").every((event) => !event.prevented));
    press("J");
    assert.deepEqual(window.tab_moves, [1]);
    assert.deepEqual(runs(), []);
    assert.equal(firefox.errors.some((line) => line.includes("the key tree was refused")), tree !== undefined);
  }
});

test("a hold Space and a register do nothing on a locked page", () => {
  const { press, type, runs } = started();
  type("g");
  assert.equal(press(" ").prevented, false);
  type("x", "x");
  type('"', "a", "x", "x");
  assert.deepEqual(runs(), [{ keys: "x x", count: 0 }]);
});

test(": opens the address bar with df, unless the tree binds it", () => {
  // An older extension's tree, from before the command line panel, has no `:`.
  const { [":"]: _colon, ...older_children } = DEFAULT_TREE.children;
  const { press, window } = started({ written: state({ tree: { children: older_children } }) });
  assert.equal(press(":", { shiftKey: true }).prevented, true);
  assert.deepEqual(window.address_bar, ["df "]);
  // A current tree binds it, so the module forwards it and the background opens the panel.
  assert.equal(DEFAULT_TREE.children[":"], "forward");
  const bound = started();
  bound.press(":", { shiftKey: true });
  assert.deepEqual(bound.window.address_bar, []);
  assert.deepEqual(bound.runs(), [{ keys: ":", count: 0 }]);
});

test("after a key that opens the line, the keys typed before the line has the focus run nothing, and the line gets their text once", () => {
  const { type, press, runs, core, window } = started();
  const win = vm.runInContext("globalThis", window.win.context!);
  press(":", { shiftKey: true });
  const held = type("u", "x", "x", "Backspace", "!");
  assert.ok(held.every((event) => event.prevented && event.stopped));
  assert.deepEqual(runs(), [{ keys: ":", count: 0 }]);
  assert.equal(core.take_held_keys(win), "ux!");
  // Still held, but no longer kept: the reply that carried the text has gone.
  assert.equal(press("u").prevented, true);
  assert.equal(core.take_held_keys(win, true), "");
  assert.equal(window.timer_count(), 0, "the hold's timer outlived it");
  type("u");
  assert.deepEqual(runs(), [{ keys: ":", count: 0 }, { keys: "u", count: 0 }]);
  // A prompt key (`o`) opens the line too. A key that runs at once does not hold.
  press("o");
  assert.equal(press("u").prevented, true);
  core.take_held_keys(win, true);
  type("x", "x", "u");
  assert.deepEqual(runs().slice(2), [{ keys: "o", count: 0 }, { keys: "x x", count: 0 }, { keys: "u", count: 0 }]);
});

test("the hold ends on Escape, a tab switch, leaving the window and its time limit", () => {
  const ends: [string, (world: ReturnType<typeof started>) => void][] = [
    ["Escape", (world) => assert.equal(world.press("Escape").prevented, true)],
    ["a tab switch", (world) => world.window.fire_tab_select()],
    ["leaving the window", (world) => world.window.fire("deactivate")],
    ["the time limit", (world) => world.window.run_timers()],
  ];
  for (const [what, end] of ends) {
    const world = started();
    world.press(":", { shiftKey: true });
    end(world);
    world.type("u");
    assert.deepEqual(world.runs(), [{ keys: ":", count: 0 }, { keys: "u", count: 0 }], what);
    assert.equal(world.core.take_held_keys(vm.runInContext("globalThis", world.window.win.context!)), "", what);
    assert.equal(world.window.timer_count(), 0, what);
  }
});

test("a tree from before the line keys holds nothing", () => {
  const { line_keys: _line_keys, ...older } = DEFAULT_TREE;
  const { press, type, runs } = started({ written: state({ tree: older }) });
  press(":", { shiftKey: true });
  type("u");
  assert.deepEqual(runs(), [{ keys: ":", count: 0 }, { keys: "u", count: 0 }]);
});

const bar_request = (text: unknown, tab_id?: number) => [{ v: BROWSER_MODULE_PROTOCOL_VERSION, id: "bar1", kind: "address_bar.open", args: { text, ...(tab_id !== undefined && { tab_id }) }, sent_at: Date.now() }];
const replies = (firefox: ReturnType<typeof create_firefox>) => plain(((firefox.read_holder("desertfox_browser_module_from_module") ?? []) as { reply_to?: string }[]).filter((message) => message.reply_to === "bar1"));

test("address_bar.open types df and the text into the focused window's address bar and never submits it", async () => {
  const { firefox, window } = started();
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = window.win;
  firefox.extension_writes("desertfox_browser_module_from_extension", bar_request("open.url \u0007--where=tab "));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.address_bar, ["df open.url --where=tab "]);
  assert.deepEqual(replies(firefox), [{ v: BROWSER_MODULE_PROTOCOL_VERSION, reply_to: "bar1", ok: true }]);
});

test("address_bar.open adds the keys typed while the line opened and ends their hold", async () => {
  const { firefox, window, press, type, runs } = started();
  // The window the keys came from, as the core sees it.
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = vm.runInContext("globalThis", window.win.context!);
  press(":", { shiftKey: true });
  type("t", "a", "b");
  firefox.extension_writes("desertfox_browser_module_from_extension", bar_request(""));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.address_bar, ["df tab"]);
  type("u");
  assert.deepEqual(runs(), [{ keys: ":", count: 0 }, { keys: "u", count: 0 }]);
});

test("address_bar.open fills the bar only while the tab that asked is the focused window's selected tab", async () => {
  const { firefox, window, second } = started();
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = window.win;
  // The fake numbers tabs in the order they are first asked about, so the selected first tab is 1.
  firefox.extension_writes("desertfox_browser_module_from_extension", bar_request("open.url ", 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.address_bar, ["df open.url "]);
  window.select(second);
  firefox.extension_writes("desertfox_browser_module_from_extension", [{ ...bar_request("open.url ", 1)[0]!, id: "bar2" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.address_bar, ["df open.url "]);
  const refused = plain(((firefox.read_holder("desertfox_browser_module_from_module") ?? []) as { reply_to?: string }[]).filter((message) => message.reply_to === "bar2"));
  assert.deepEqual(refused, [{ v: BROWSER_MODULE_PROTOCOL_VERSION, reply_to: "bar2", ok: false, error: "The tab that asked is no longer selected" }]);
});

test("address_bar.open refuses with no focused window, a private window DesertFox may not use, or the toolbar switch off", async () => {
  const switched_off = started({ written: state({ enabled: false }) });
  (switched_off.firefox.Services.focus as { activeWindow: unknown }).activeWindow = switched_off.window.win;
  switched_off.firefox.extension_writes("desertfox_browser_module_from_extension", bar_request("open.url "));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(switched_off.window.address_bar, []);
  assert.equal(replies(switched_off.firefox)[0]?.ok, false);
  for (const [private_window, focused] of [[false, false], [true, true]] as const) {
    const { firefox, window } = started({ private_window });
    if (focused) (firefox.Services.focus as { activeWindow: unknown }).activeWindow = window.win;
    firefox.extension_writes("desertfox_browser_module_from_extension", bar_request("open.url "));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(window.address_bar, []);
    assert.equal(replies(firefox)[0]?.ok, false);
  }
});

test("set_hello_flag puts bar in the hello, takes it out again, and refuses other names and values", () => {
  const { firefox, core } = started();
  assert.equal(core.set_hello_flag("bar", true), true);
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, bar: true });
  const checked = validate_module_hello(firefox.hello());
  assert.ok(checked.ok && checked.value.bar === true);
  for (const [name, on] of [["keys", true], ["bar", "yes"], ["bar", 1]] as const) assert.equal(core.set_hello_flag(name, on), false, `${name} ${on}`);
  assert.equal(firefox.errors.filter((line) => line.includes("refused the hello flag")).length, 2);
  core.set_hello_flag("bar", false);
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true });
});

test("a flag set while the pref is off goes in the hello when it comes on", () => {
  const { firefox, core } = started();
  firefox.set_pref(false);
  core.set_hello_flag("bar", true);
  assert.equal(firefox.hello(), undefined);
  firefox.set_pref(true);
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, bar: true });
});
