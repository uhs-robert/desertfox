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

test("keys the tree leaves out reach the page: f, / and v", () => {
  const { press, runs } = started();
  for (const key of ["f", "/", "v"]) assert.equal(press(key).prevented, false, key);
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

test("a hint key whose send failed leaves the document unmarked, so the next one tries again and stays claimed", () => {
  const { press, runs, first, notices, core } = with_notices();
  notices.set(first.browser, "not_here");
  const send = (core as unknown as { send: (...args: unknown[]) => unknown }).send;
  (core as unknown as { send: unknown }).send = () => ({ ok: false, problem: "the module or DesertFox is off" });
  assert.ok(press("f").prevented, "a failed send still claims the key");
  (core as unknown as { send: unknown }).send = send;
  press("f");
  press("f");
  assert.deepEqual(runs(), [{ keys: "f", count: 0 }]);
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

test("on a page chrome hints label, every hint key starts them with its keys and count, stays claimed, and sends no notice", () => {
  const { press, type, runs, first, second, on_tab, notices, core, window } = with_notices();
  const starts: { window: unknown; browser: unknown; keys: string; count: number; trusted: boolean }[] = [];
  (core as unknown as { share_page_hints(entry: unknown): void }).share_page_hints({
    handles: () => true,
    start: ({ window: win, browser, event, keys, count }: { window: unknown; browser: unknown; event: { isTrusted: boolean }; keys: string; count: number }) => (starts.push({ window: win, browser, keys, count, trusted: event.isTrusted }), true),
  });
  notices.set(first.browser, "page_hints");
  assert.ok(press("f").prevented);
  assert.ok(press("f").prevented, "a second press did not start again");
  assert.ok(type("3", "F").every((event) => event.prevented));
  assert.ok(type(";", "y", "l").every((event) => event.prevented));
  assert.deepEqual(starts.map(({ keys, count }) => ({ keys, count })), [{ keys: "f", count: 0 }, { keys: "f", count: 0 }, { keys: "F", count: 3 }, { keys: "; y l", count: 0 }]);
  // The window comes through the vm context as its global, so its tab browser names it.
  assert.ok(starts.every((start) => (start.window as { gBrowser: unknown }).gBrowser === window.win.gBrowser && start.browser === first.browser && start.trusted));
  assert.deepEqual(runs(), [], "a page hint key sent a notice");
  on_tab(second);
  assert.equal(press("f").prevented, false, "a tab with no notice lost its f");
  assert.equal(starts.length, 4);
});

test("with the page rule saying page_hints but no start lent, a hint key is still claimed and goes nowhere", () => {
  const { press, runs, first, notices } = with_notices();
  notices.set(first.browser, "page_hints");
  assert.ok(press("f").prevented);
  assert.deepEqual(runs(), []);
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
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, devtools_search: true, devtools_tools: true, mode_keys: true, bar: true });
  const checked = validate_module_hello(firefox.hello());
  assert.ok(checked.ok && checked.value.bar === true);
  for (const [name, on] of [["keys", true], ["bar", "yes"], ["bar", 1]] as const) assert.equal(core.set_hello_flag(name, on), false, `${name} ${on}`);
  assert.equal(firefox.errors.filter((line) => line.includes("refused the hello flag")).length, 2);
  core.set_hello_flag("bar", false);
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, devtools_search: true, devtools_tools: true, mode_keys: true });
});

test("a flag set while the pref is off goes in the hello when it comes on", () => {
  const { firefox, core } = started();
  firefox.set_pref(false);
  core.set_hello_flag("bar", true);
  assert.equal(firefox.hello(), undefined);
  firefox.set_pref(true);
  assert.deepEqual(plain(firefox.hello()), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, devtools_search: true, devtools_tools: true, mode_keys: true, bar: true });
});

// A page in this process (about:preferences) whose search box holds the focus, and the key target that reaches it.
function in_process_field(browser: unknown) {
  const page_document: Record<string, unknown> = { designMode: "off", activeElement: undefined, defaultView: { browsingContext: { isContent: true, parent: null, top: { embedderElement: browser } } } };
  const field = { localName: "input", type: "search", blurs: 0, ownerDocument: page_document, blur() { this.blurs++; page_document.activeElement = undefined; } };
  page_document.activeElement = field;
  return { field, page_document, target: { target: field, originalTarget: field } };
}

test("Escape in a field on a page in this process blurs it, stops the page's own Escape and leaves keys working", () => {
  const { press, first, window, runs } = started();
  const { field, target } = in_process_field(first.browser);
  const escape = press("Escape", target);
  assert.deepEqual([field.blurs, escape.prevented, escape.stopped], [1, true, true]);
  press("J", { target: first.browser, originalTarget: first.browser });
  assert.deepEqual(window.tab_moves, [1]);
  assert.deepEqual(runs(), []);
});

test("Escape in a field on a page in another process asks its frame script for a blur marked escape", () => {
  const { press, first, firefox } = started();
  firefox.report(first.browser, { inner: 10, listeners: 0, field: true, text_field: true });
  const escape = press("Escape");
  assert.equal(escape.prevented, true);
  assert.deepEqual(firefox.sent_to_frames.filter(({ name }) => name.endsWith(":blur")).map(({ data }) => plain(data)), [{ inner: 10, escape: true }]);
});

test("Escape leaves the field alone with a modifier, with no field, in a tab DesertFox runs in, in an ignored tab, while a feature holds the keys and with the module off", () => {
  const cases: [string, (world: ReturnType<typeof started>, page: ReturnType<typeof in_process_field>) => Partial<FakeEvent>][] = [
    ["Shift", () => ({ shiftKey: true })],
    ["Ctrl", () => ({ ctrlKey: true })],
    ["no field", (_world, page) => ((page.page_document.activeElement = undefined), {})],
    ["a live tab", (world) => (world.firefox.report(world.first.browser, { inner: 10, listeners: 1, field: true }), {})],
    ["a feature holding the keys", (world) => (vm.runInContext(`Services.desertfox_browser_module.hold_keys(this, "feature")`, (world.window.win as { context: vm.Context }).context), {})],
    ["the toolbar switch off", (world) => (world.firefox.write_state(state({ enabled: false })), {})],
  ];
  for (const [what, prepare] of cases) {
    const world = started();
    const page = in_process_field(world.first.browser);
    const patch = prepare(world, page);
    const escape = world.press("Escape", { ...page.target, ...patch });
    assert.equal(page.field.blurs, 0, what);
    assert.equal(escape.stopped && what !== "Shift", false, what);
  }
  const ignored = started();
  const page = in_process_field(ignored.first.browser);
  ignored.press("Escape", { shiftKey: true });
  const escape = ignored.press("Escape", page.target);
  assert.deepEqual([page.field.blurs, escape.prevented], [0, false], "an ignored tab");
});

test("Escape leaves a field in a subdialog, a field in an iframe of a remote page, and a design mode page", () => {
  const dialog = started();
  const page = in_process_field(dialog.first.browser);
  (page.page_document.defaultView as { browsingContext: { parent: unknown } }).browsingContext.parent = {};
  const kept = dialog.press("Escape", page.target);
  assert.deepEqual([page.field.blurs, kept.prevented], [0, false], "a subdialog");

  const frame = started();
  frame.firefox.report(frame.first.browser, { inner: 10, listeners: 0, field: false });
  frame.window.win.windowUtils.IMEStatus = IME_ENABLED;
  const passed = frame.press("Escape");
  assert.deepEqual([passed.prevented, frame.firefox.sent_to_frames.filter(({ name }) => name.endsWith(":blur")).length], [false, 0], "a field in an iframe");

  const editable = started();
  const design = in_process_field(editable.first.browser);
  design.page_document.designMode = "on";
  const body = { localName: "body", ownerDocument: design.page_document, blur: () => assert.fail("body was blurred") };
  design.page_document.activeElement = body;
  const ended = editable.press("Escape", { target: body, originalTarget: body });
  assert.equal(ended.prevented, false, "design mode keeps Escape for the page");
});

test("Escape on a remote design mode page, or after an older frame script's report, passes to the page", () => {
  for (const [what, report] of [
    ["design mode", { inner: 10, listeners: 0, field: true, text_field: false }],
    ["an older report", { inner: 10, listeners: 0, field: true }],
  ] as const) {
    const { press, first, firefox } = started();
    firefox.report(first.browser, report);
    const escape = press("Escape");
    assert.equal(escape.prevented, false, what);
    assert.deepEqual(firefox.sent_to_frames.filter(({ name }) => name.endsWith(":blur")), [], what);
  }
});

const at_address = (tab: { browser: unknown }, spec: string) => void ((tab.browser as { currentURI?: { spec: string } }).currentURI = { spec });
const PAGE_TREE: ScopeTree = { children: { Q: "forward" } };
const address_state = (entries: unknown[]) => state({ address_trees: entries });

test("on an about: page the module walks the tree of its address and not the global one", () => {
  const { first, type, runs } = started({ written: address_state([{ sites: ["about:config"], tree: PAGE_TREE }]) });
  at_address(first, "about:config#x");
  const [q, x] = [type("Q")[0]!, type("x")[0]!];
  assert.ok(q.prevented && q.stopped);
  assert.equal(x.prevented, false, "a key the rule freed or never bound is left to the page");
  assert.deepEqual(runs(), [{ keys: "Q", count: 0 }]);
  at_address(first, "about:support");
  type("x", "x");
  assert.deepEqual(runs().at(-1), { keys: "x x", count: 0 });
});

test("the longest pattern that covers the address wins, and a prefix covers the longer address", () => {
  const short: ScopeTree = { children: { a: "forward" } };
  const long: ScopeTree = { children: { b: "forward" } };
  const { first, type, runs } = started({ written: address_state([{ sites: ["about:conf*"], tree: short }, { sites: ["about:config*"], tree: long }]) });
  at_address(first, "about:config?x");
  type("a", "b");
  at_address(first, "about:conf");
  type("a", "b");
  assert.deepEqual(runs(), [{ keys: "b", count: 0 }, { keys: "a", count: 0 }]);
});

test("an off entry leaves every key to the page, the single-key rows too", () => {
  const { first, type, press, runs, window } = started({ written: address_state([{ sites: ["about:config"], tree: { children: {} }, off: true }]) });
  at_address(first, "about:config");
  const events = [...type("J", "x", "x", "i", "v"), press("v", { ctrlKey: true }), press("Escape", { shiftKey: true })];
  assert.equal(events.length, 7);
  assert.ok(events.every((event) => !event.prevented), "i, <C-v> and <S-Escape> go to the page too");
  assert.deepEqual(window.tab_moves, []);
  assert.deepEqual(runs(), []);
});

test("a private window keeps the global tree and an older state with no entries is unchanged", () => {
  const entry = { sites: ["about:config"], tree: { children: {} }, off: true };
  const { first, type, runs } = started({ written: address_state([entry]), private_window: true, private_access: true });
  at_address(first, "about:config");
  type("x", "x");
  assert.deepEqual(runs(), [{ keys: "x x", count: 0 }]);
  const plain_state = started();
  at_address(plain_state.first, "about:config");
  plain_state.type("x", "x");
  assert.deepEqual(plain_state.runs(), [{ keys: "x x", count: 0 }]);
});

test("a bad entry is left out and the others stay, and a half-typed sequence ends when the entries change", () => {
  const bad = [{ sites: ["about:*"], tree: PAGE_TREE }, { sites: ["about:config"] }, "junk", { sites: ["https://a.test/*"], tree: PAGE_TREE }];
  const { first, firefox, type, runs } = started({ written: address_state(bad) });
  at_address(first, "about:config");
  type("Q", "x", "x");
  assert.deepEqual(runs(), [{ keys: "x x", count: 0 }]);
  const gt: ScopeTree = { children: { g: { children: { t: "forward" } } } };
  firefox.write_state(address_state([{ sites: ["about:config"], tree: gt }]));
  type("g");
  firefox.write_state(address_state([{ sites: ["about:config"], tree: { children: { g: { children: { u: "forward" } } } } }]));
  type("t");
  assert.equal(runs().length, 1);
});

test("on an off about: page Escape in a field goes to the page, and stays the module's elsewhere", () => {
  const escape_in_field = (entries: unknown[]) => {
    const { first, firefox, press } = started({ written: address_state(entries) });
    at_address(first, "about:config");
    firefox.report(first.browser, { inner: 10, listeners: 0, field: true, text_field: true });
    return press("Escape").prevented;
  };
  assert.equal(escape_in_field([]), true);
  assert.equal(escape_in_field([{ sites: ["about:config"], tree: { children: {} }, off: true }]), false);
});

test("an exact pattern wins a tie with a prefix pattern of the same base", () => {
  const exact: ScopeTree = { children: { a: "forward" } };
  const prefix: ScopeTree = { children: { b: "forward" } };
  const { first, type, runs } = started({ written: address_state([{ sites: ["about:config*"], tree: prefix }, { sites: ["about:config"], tree: exact }]) });
  at_address(first, "about:config");
  type("a", "b");
  at_address(first, "about:config?x");
  type("a", "b");
  assert.deepEqual(runs(), [{ keys: "a", count: 0 }, { keys: "b", count: 0 }]);
});

// ---- The module's own modes: insert, ignore, pass-next, and the keys a field takes.

const MODE_ATTRIBUTE = "desertfox-module-mode";
const DOCUMENT_ATTRIBUTE = "desertfox-module-document";
const CTRL_BRACKET: Partial<FakeEvent> = { ctrlKey: true };
const mode_of = (browser: unknown) => (browser as { getAttribute(name: string): string | null }).getAttribute(MODE_ATTRIBUTE);

// A page in this process whose field holds the focus and records every event dispatched to it, for the Escape the module sends.
// `system_page` models a page of the parent process: its events are trusted, and they reach the window's key listener again, as Gecko delivers them.
function page_with_field(browser: unknown, system_page?: { deliver(event: FakeEvent): void }) {
  const { field, page_document, target } = in_process_field(browser);
  const sent: { type: string; key: string; keyCode: number; trusted: boolean }[] = [];
  class KeyboardEvent {
    isTrusted = system_page !== undefined;
    type = "";
    key = "";
    keyCode = 0;
    constructor(type: string, init: { key: string; keyCode: number }) {
      Object.assign(this, { type, key: init.key, keyCode: init.keyCode });
    }
  }
  (page_document.defaultView as Record<string, unknown>)["KeyboardEvent"] = KeyboardEvent;
  Object.assign(field, {
    dispatchEvent: (event: KeyboardEvent) => {
      sent.push({ type: event.type, key: event.key, keyCode: event.keyCode, trusted: event.isTrusted });
      if (event.type === "keydown") system_page?.deliver(key_event(event.key, { isTrusted: true, keyCode: event.keyCode, target: field, originalTarget: field }));
    },
  });
  return { field, page_document, target, sent };
}

test("i starts insert mode: every key reaches the page, the attribute says insert, and a load ends it", () => {
  const { press, type, window, first, runs } = started();
  assert.equal(press("i").prevented, true);
  assert.equal(mode_of(first.browser), "insert");
  assert.equal(first.browser.getAttribute(DOCUMENT_ATTRIBUTE), "10");
  assert.ok(["J", "j", "x", "i", ":", "<"].every((key) => !press(key).prevented), "no key is taken");
  assert.ok(type("x", "x").every((event) => !event.prevented));
  assert.deepEqual([window.tab_moves, runs()], [[], []]);
  first.browser.innerWindowID = 12;
  press("J");
  assert.deepEqual(window.tab_moves, [1], "the new document is in normal mode");
});

test("Escape leaves insert mode and is consumed, as on a web page, and the keys work again", () => {
  const { press, window, first, runs } = started();
  press("i");
  const escape = press("Escape");
  assert.deepEqual([escape.prevented, escape.stopped, mode_of(first.browser)], [true, true, null]);
  assert.equal(first.browser.getAttribute(DOCUMENT_ATTRIBUTE), null);
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
  assert.equal(press("Escape").prevented, false, "in normal mode with no field the page gets Escape");
  assert.deepEqual(runs(), []);
});

test("Escape in insert mode with a field blurs it too, on a page in this process and in another one", () => {
  const local = started();
  const page = page_with_field(local.first.browser);
  local.press("i", { target: local.first.browser, originalTarget: local.first.browser });
  assert.equal(page.field.blurs, 0);
  const escape = local.press("Escape", page.target);
  assert.deepEqual([page.field.blurs, escape.prevented, mode_of(local.first.browser)], [1, true, null]);

  const remote = started();
  remote.firefox.report(remote.first.browser, { inner: 10, listeners: 0, field: true, text_field: true });
  remote.press("i");
  const left = remote.press("Escape");
  assert.deepEqual([left.prevented, mode_of(remote.first.browser)], [true, null]);
  assert.deepEqual(remote.firefox.sent_to_frames.filter(({ name }) => name.endsWith(":blur")).map(({ data }) => plain(data)), [{ inner: 10, escape: true }]);
});

test("a key typed in a field in insert mode goes to the page and the mode stays", () => {
  const { press, first } = started();
  const page = page_with_field(first.browser);
  press("i");
  const typed = press("a", page.target);
  assert.deepEqual([typed.prevented, mode_of(first.browser), page.field.blurs], [false, "insert", 0]);
});

test("insert mode belongs to its tab, and a state of the extension with a tab record in another mode still wins over it", () => {
  const { press, type, window, first, second, on_tab } = started();
  press("i");
  on_tab(second);
  press("J");
  assert.deepEqual(window.tab_moves, [1], "the other tab is in normal mode");
  on_tab(first);
  assert.equal(press("J").prevented, false);
  assert.equal(mode_of(second.browser), null);
  assert.ok(type("x", "x").every((event) => !event.prevented));
});

test("the insert table decides the leave keys: with only <C-[> in it, Escape goes to the page and <C-[> leaves", () => {
  const written = state({ insert_keys: [{ key: "<C-[>", id: "mode.escape" }] });
  const world = started({ written });
  world.press("i");
  assert.deepEqual([world.press("Escape").prevented, mode_of(world.first.browser)], [false, null], "an unbound Escape passes and leaves insert, as on a web page");
  world.press("i");
  const left = world.press("[", CTRL_BRACKET);
  assert.deepEqual([left.prevented, mode_of(world.first.browser)], [true, null]);

  const field = started({ written });
  const page = page_with_field(field.first.browser);
  assert.deepEqual([field.press("Escape", page.target).prevented, page.field.blurs], [false, 0], "plain Escape leaves a field alone");
  const blurred = field.press("[", { ...page.target, ...CTRL_BRACKET });
  assert.deepEqual([blurred.prevented, page.field.blurs], [true, 1], "<C-[> blurs it");
});

test("an empty insert table blurs no field, and its unbound Escape ends insert mode and passes", () => {
  const world = started({ written: state({ insert_keys: [] }) });
  const page = page_with_field(world.first.browser);
  assert.deepEqual([world.press("Escape", page.target).prevented, page.field.blurs], [false, 0]);
  world.press("i", { target: world.first.browser, originalTarget: world.first.browser });
  assert.deepEqual([world.press("Escape").prevented, mode_of(world.first.browser)], [false, null], "an unbound Escape still ends insert mode and goes to the page");
});

test("with no insert table (an older extension) the plain Escape leaves insert and blurs, as it always did, and <C-[> does not", () => {
  const world = started();
  const page = page_with_field(world.first.browser);
  assert.deepEqual([world.press("[", { ...page.target, ...CTRL_BRACKET }).prevented, page.field.blurs], [false, 0]);
  assert.deepEqual([world.press("Escape", page.target).prevented, page.field.blurs], [true, 1]);
});

test("<A-Escape> in a field sends the page an untrusted Escape, takes the key and does not blur", () => {
  const world = started({ written: state({ insert_keys: [{ key: "<A-Escape>", id: "page.send_key" }, { key: "<Escape>", id: "mode.escape" }] }) });
  const page = page_with_field(world.first.browser);
  const sent = world.press("Escape", { ...page.target, altKey: true });
  assert.deepEqual([sent.prevented, sent.stopped, page.field.blurs], [true, true, 0]);
  assert.deepEqual(plain(page.sent), [
    { type: "keydown", key: "Escape", keyCode: 27, trusted: false },
    { type: "keyup", key: "Escape", keyCode: 27, trusted: false },
  ]);
});

test("<A-Escape> on a system page: the trusted Escape the module sends does not reach its own key handling again", () => {
  const world = started({ written: state({ insert_keys: [{ key: "<A-Escape>", id: "page.send_key" }, { key: "<Escape>", id: "mode.escape" }] }) });
  const redelivered: FakeEvent[] = [];
  const page = page_with_field(world.first.browser, { deliver: (event) => redelivered.push(world.window.press(event)) });
  world.press("Escape", { ...page.target, altKey: true });
  assert.deepEqual(plain(page.sent).map((each: { trusted: boolean }) => each.trusted), [true, true]);
  assert.deepEqual([redelivered.length, redelivered.some((event) => event.prevented), page.field.blurs], [1, false, 0], "the page sees the Escape, and nothing blurs the field");
  assert.equal(world.press("Escape", page.target).prevented, true, "a key the user types afterwards works again");
});

test("an Escape in a field after <C-v> goes to the page, not to the blur row", () => {
  const { press, first } = started();
  const page = page_with_field(first.browser);
  press("v", { ctrlKey: true, target: first.browser, originalTarget: first.browser });
  assert.deepEqual([press("Escape", page.target).prevented, page.field.blurs, mode_of(first.browser)], [false, 0, null]);
});

test("<S-Escape> in a field ends ignore mode, and every other key there still goes to the page", () => {
  const { press, first } = started();
  const page = page_with_field(first.browser);
  press("Escape", { shiftKey: true, target: first.browser, originalTarget: first.browser });
  assert.equal(mode_of(first.browser), "ignore");
  assert.equal(press("a", page.target).prevented, false);
  assert.equal(mode_of(first.browser), "ignore");
  const left = press("Escape", { ...page.target, shiftKey: true });
  assert.deepEqual([left.prevented, mode_of(first.browser)], [true, null]);
});

test("a shut down takes the mode attributes off every tab it marked", () => {
  const { press, first, core } = started();
  press("i");
  assert.equal(mode_of(first.browser), "insert");
  (core as unknown as { shut_down(): void }).shut_down();
  assert.deepEqual([mode_of(first.browser), first.browser.getAttribute(DOCUMENT_ATTRIBUTE)], [null, null]);
});

test("<A-Escape> on a page in another process asks its frame script for the Escape, and an unlisted key sends none", () => {
  const world = started({ written: state({ insert_keys: [{ key: "<A-Escape>", id: "page.send_key" }] }) });
  world.firefox.report(world.first.browser, { inner: 10, listeners: 0, field: true, text_field: true });
  assert.equal(world.press("Escape", { altKey: true }).prevented, true);
  assert.deepEqual(world.firefox.sent_to_frames.filter(({ name }) => name.endsWith(":send-escape")).map(({ data }) => plain(data)), [{ inner: 10 }]);
  world.press("a", { altKey: true });
  assert.equal(world.firefox.sent_to_frames.filter(({ name }) => name.endsWith(":send-escape")).length, 1);
});

test("a reserved help.whichkey row takes no key yet, and a row for a command this version does not know is skipped", () => {
  const world = started({ written: state({ insert_keys: [{ key: "<A-?>", id: "help.whichkey" }, { key: "<C-r>", id: "register.paste" }] }) });
  const page = page_with_field(world.first.browser);
  assert.equal(world.press("?", { ...page.target, altKey: true }).prevented, false);
  assert.equal(world.press("r", { ...page.target, ctrlKey: true }).prevented, false);
  assert.deepEqual(world.firefox.sent_to_frames, []);
});

test("a bad insert table is left out whole, so the plain Escape stays", () => {
  for (const insert_keys of [[{ key: "<Escape>", id: "mode.escape" }, { key: "<Escape>", id: "mode.escape" }], [{ key: 5, id: "mode.escape" }], "junk", Array.from({ length: 9 }, (_, index) => ({ key: `<F${index + 1}>`, id: "mode.escape" }))]) {
    const world = started({ written: state({ insert_keys }) });
    const page = page_with_field(world.first.browser);
    assert.deepEqual([world.press("Escape", page.target).prevented, page.field.blurs], [true, 1], JSON.stringify(insert_keys).slice(0, 40));
  }
});

test("<C-v> passes the next key to the page and then the keys walk again, and a sequence typed before it is dropped", () => {
  const { press, type, window, first, runs } = started();
  assert.equal(press("v", { ctrlKey: true }).prevented, true);
  assert.equal(mode_of(first.browser), "pass");
  assert.equal(press("J").prevented, false, "the next key goes to the page");
  assert.equal(mode_of(first.browser), null);
  assert.deepEqual(window.tab_moves, []);
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
  type("x");
  press("v", { ctrlKey: true });
  assert.equal(press("x").prevented, false, "a key half-way into a sequence is passed too");
  assert.deepEqual(type("x", "x").map((event) => event.prevented), [true, true]);
  assert.deepEqual(runs(), [{ keys: "x x", count: 0 }]);
});

test("<C-v> twice passes the second <C-v> to the page, and a key in a field after <C-v> spends it", () => {
  const { press, first } = started();
  press("v", { ctrlKey: true });
  assert.equal(press("v", { ctrlKey: true }).prevented, false);
  assert.equal(mode_of(first.browser), null);
  const page = page_with_field(first.browser);
  press("v", { ctrlKey: true, target: first.browser, originalTarget: first.browser });
  press("a", page.target);
  assert.equal(mode_of(first.browser), null);
});

test("the ignore keys, in every spelling the default keymap has, give every key to the page until <S-Escape>", () => {
  const spellings: [string, Partial<FakeEvent>[]][] = [
    ["<S-Insert>", [{ shiftKey: true }]],
    ["<AC-Escape>", [{ ctrlKey: true, altKey: true }]],
    ["<AC-`>", [{ ctrlKey: true, altKey: true }]],
    [",i", [{}, {}]],
  ];
  const keys: Record<string, string[]> = { "<S-Insert>": ["Insert"], "<AC-Escape>": ["Escape"], "<AC-`>": ["`"], ",i": [",", "i"] };
  for (const [name, patches] of spellings) {
    const { press, window, first } = started();
    keys[name]!.forEach((key, index) => press(key, patches[index]));
    assert.equal(mode_of(first.browser), "ignore", name);
    assert.equal(press("J").prevented, false, name);
    assert.deepEqual(window.tab_moves, [], name);
    assert.equal(press("Escape", { shiftKey: true }).prevented, true, name);
    assert.equal(mode_of(first.browser), null, name);
    press("J");
    assert.deepEqual(window.tab_moves, [1], name);
  }
});

test("the hard-coded <S-Escape> still toggles ignore mode with a state that has no tree, and shows the attribute", () => {
  const { press, first, window } = started({ written: state({ tree: undefined }) });
  press("Escape", { shiftKey: true });
  assert.equal(mode_of(first.browser), "ignore");
  press("Escape", { shiftKey: true });
  assert.equal(mode_of(first.browser), null);
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
});

test("a tree with the mode keys pruned (an extension that has not seen the hello) keeps i and <C-v> with the page", () => {
  const children = Object.fromEntries(Object.entries(DEFAULT_TREE.children).filter(([token]) => !["i", "<C-v>", "<S-Insert>"].includes(token)));
  const { press, first } = started({ written: state({ tree: { ...DEFAULT_TREE, children } }) });
  assert.equal(press("i").prevented, false);
  assert.equal(press("v", { ctrlKey: true }).prevented, false);
  assert.equal(mode_of(first.browser), null);
});

test("insert, ignore and pass-next exclude each other, and insert ends a pass-next", () => {
  const { press, first, type } = started();
  press("v", { ctrlKey: true });
  press("x");
  press("i");
  assert.equal(mode_of(first.browser), "insert");
  press("Escape");
  type(",", "i");
  assert.equal(mode_of(first.browser), "ignore");
  press("Escape", { shiftKey: true });
  assert.equal(mode_of(first.browser), null);
});

test("the commands feature says mode_keys in the hello, and the hello still validates", () => {
  const { firefox } = started();
  const checked = validate_module_hello(firefox.hello());
  assert.ok(checked.ok && checked.value.mode_keys === true);
});
