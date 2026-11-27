// The status bar in a fake window: the hello it rewrites, what it draws from the state, how it treats a hostile state, how it drops widgets in a narrow bar, and that it leaves nothing behind at unload.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BAR_COLORS, BAR_CONFIG, create_bar_fixture } from "./statusbar_window.ts";

const state_with = (tab: Record<string, unknown>, bar: Record<string, unknown> = BAR_CONFIG, extra: Record<string, unknown> = {}) => ({
  v: 1,
  enabled: true,
  keys: [],
  tabs: { "1": { mode: "normal", live: true, ...tab } },
  bar,
  ...extra,
});

function started(options = {}) {
  const fixture = create_bar_fixture(options);
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  return fixture;
}

test("the bar rewrites the core's hello with bar true, and a hello that comes later too", () => {
  const early = started();
  assert.deepEqual(early.firefox.hello(), { v: 1, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, bar: true });

  const late = create_bar_fixture();
  late.load();
  assert.equal(late.firefox.hello(), undefined);
  late.firefox.start_extension({ private_access: true });
  assert.deepEqual(late.firefox.hello(), { v: 1, module_version: "1.0.0", devtools_hints: true, devtools_visual: true, bar: true });
});

test("the bar writes no hello of its own while the module is off", () => {
  const fixture = create_bar_fixture();
  fixture.firefox.set_pref(false);
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  assert.equal(fixture.firefox.hello(), undefined);
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
});

test("the kill pref of the bar takes bar true back out of the hello and hides the bar", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), true);
  fixture.firefox.set_named_pref("desertfox.browser_module.statusbar", false);
  fixture.run_frames();
  assert.deepEqual(fixture.firefox.hello(), { v: 1, module_version: "1.0.0", devtools_hints: true, devtools_visual: true });
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
  fixture.firefox.set_named_pref("desertfox.browser_module.statusbar", undefined);
  fixture.run_frames();
  assert.equal((fixture.firefox.hello() as { bar?: boolean }).bar, true);
});

test("a state without bar settings draws nothing, and one with them draws the mode, keys and tab place", () => {
  const fixture = started({ tab_count: 3 });
  fixture.firefox.write_state({ v: 1, enabled: true, keys: [], tabs: {} });
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
  assert.equal(fixture.root.style_values.get("--desertfox-statusbar-height"), "0px");

  fixture.firefox.write_state(state_with({ mode: "insert", pending: ["g"], count: 3, recording: "q" }));
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), true);
  assert.deepEqual(fixture.widgets("left"), ["INSERT", "3g", "recording @q"]);
  assert.deepEqual(fixture.widgets("right"), ["[1/3]"]);
});

test("pass-next and a site label replace the mode name, and a switched-off DesertFox hides the mode", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({ mode: "normal", pass: true }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("left"), ["PASS"]);
  fixture.firefox.write_state(state_with({ mode: "normal", site: "SHEETS" }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("left"), ["SHEETS"]);
  fixture.firefox.write_state({ ...state_with({}), enabled: false });
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("left"), []);
});

test("a tab with no record is in normal mode", () => {
  const fixture = started();
  fixture.firefox.write_state({ ...state_with({}), tabs: {} });
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("left"), ["NORMAL"]);
});

test("many writes in one frame draw once", () => {
  const fixture = started();
  fixture.run_frames();
  const before = fixture.frame_requests();
  for (let key = 0; key < 20; key++) fixture.firefox.write_state(state_with({ pending: ["g"], count: key + 1 }));
  assert.equal(fixture.frame_requests() - before, 1);
  assert.equal(fixture.run_frames(), 1);
  assert.deepEqual(fixture.widgets("left"), ["NORMAL", "20g"]);
});

test("every field of the state is text: a hostile state adds no element and no style", () => {
  const fixture = started();
  const markup = '<img src=x onerror="alert(1)">';
  fixture.firefox.write_state(
    state_with(
      { mode: markup, pending: [markup, "x".repeat(500), 5, null], count: "3; background:url(x)", site: markup.repeat(10), recording: markup },
      { ...BAR_CONFIG, left: ["mode", "pending", "evil", "site", "mode"], right: [markup, "tabs"] },
      { bar_theme: { dark: { ...BAR_COLORS, mode_normal: "red; background:url(https://example.com)", bg_core: "expression(1)" }, light: BAR_COLORS } },
    ),
  );
  fixture.run_frames();
  assert.deepEqual([...new Set(fixture.bar()!.all().map((node) => node.tag))].sort(), ["div", "span"]);
  const left = fixture.widgets("left");
  assert.equal(left[0], markup.slice(0, 24));
  assert.ok(left.every((text) => text.length <= 8 * 16 + 1));
  assert.equal(fixture.bar()!.style_values.has("--desertfox-mode-normal"), false);
  assert.equal(fixture.bar()!.style_values.has("--desertfox-bg-core"), false);
  assert.equal(fixture.bar()!.style_values.get("--desertfox-mode-insert"), BAR_COLORS.mode_insert);
});

test("a checked theme color reaches the bar, the one for the window's scheme", () => {
  const fixture = started({ scheme_dark: false });
  fixture.firefox.write_state(state_with({}, BAR_CONFIG, { bar_theme: { dark: BAR_COLORS, light: { ...BAR_COLORS, mode_normal: "#112233" } } }));
  fixture.run_frames();
  assert.equal(fixture.bar()!.style_values.get("--desertfox-mode-normal"), "#112233");
  fixture.scheme.matches = true;
  fixture.scheme.listeners.forEach((listener) => listener());
  fixture.run_frames();
  assert.equal(fixture.bar()!.style_values.get("--desertfox-mode-normal"), BAR_COLORS.mode_normal);
});

test("a state of another version, or one that is not a table, draws nothing", () => {
  const fixture = started();
  fixture.firefox.write_state({ ...state_with({}), v: 2 });
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
  fixture.firefox.write_state("junk");
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
  assert.deepEqual(fixture.firefox.errors, []);
});

test("a narrow bar drops the widgets of the lowest priority first and never the mode", () => {
  const fixture = started({ tab_count: 2 });
  fixture.firefox.write_state(state_with({ pending: ["g"], recording: "q" }, { ...BAR_CONFIG, right: ["scroll", "tabs", "url"] }));
  fixture.firefox.emit_message("desertfox-statusbar:scroll", fixture.tabs[0]!.browser, { inner: 10, top: 50, max: 100 });
  fixture.navigate(0, "https://example.com/a");
  fixture.run_frames();
  fixture.resize(2000);
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), ["50%", "[1/2]", "example.com/a"]);
  // NORMAL, g, recording @q and the tab place need about 60 columns of 8 px.
  fixture.resize(8 * 40 + 16);
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), ["[1/2]"]);
  assert.equal(fixture.widgets("left")[0], "NORMAL");
  fixture.resize(8 * 8);
  fixture.run_frames();
  assert.deepEqual([fixture.widgets("left"), fixture.widgets("right")], [["NORMAL"], []]);
});

test("the scroll widget shows only for the document the report names", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({}, { ...BAR_CONFIG, right: ["scroll"] }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), []);
  fixture.firefox.emit_message("desertfox-statusbar:scroll", fixture.tabs[0]!.browser, { inner: 99, top: 0, max: 100 });
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), []);
  fixture.firefox.emit_message("desertfox-statusbar:scroll", fixture.tabs[0]!.browser, { inner: 10, top: 0, max: 100 });
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), ["Top"]);
  fixture.firefox.emit_message("desertfox-statusbar:scroll", fixture.tabs[0]!.browser, { inner: "10", top: 0, max: 0 });
  fixture.firefox.emit_message("desertfox-statusbar:scroll", fixture.tabs[0]!.browser, "junk");
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), ["Top"]);
  assert.deepEqual(fixture.firefox.errors, []);
});

test("the container widget names a container, hides the default one and ignores a color it does not know", () => {
  const fixture = create_bar_fixture();
  fixture.firefox.identity_service = {
    getPublicIdentityFromId: (id: number) => (id === 2 ? { color: "red; x" } : id === 1 ? { color: "blue" } : null),
    getUserContextLabel: (id: number) => (id === 1 ? "Work" : "Bank"),
  };
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  fixture.firefox.write_state(state_with({}, { ...BAR_CONFIG, right: ["container"] }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), []);
  (fixture.tabs[0]!.tab as { userContextId?: number }).userContextId = 1;
  fixture.firefox.write_state(state_with({}, { ...BAR_CONFIG, right: ["container"] }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("right"), ["Work"]);
  assert.equal(fixture.bar()!.find((node) => node.className === "dfx-dot")!.getAttribute("data-color"), "blue");
  (fixture.tabs[0]!.tab as { userContextId?: number }).userContextId = 2;
  fixture.firefox.write_state(state_with({}, { ...BAR_CONFIG, right: ["container"] }));
  fixture.run_frames();
  assert.equal(fixture.bar()!.find((node) => node.className === "dfx-dot")!.getAttribute("data-color"), "toolbar");
});

test("the bar's height reaches the window root, and is zero while the bar is hidden", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  fixture.resize(1000, 30);
  assert.equal(fixture.root.style_values.get("--desertfox-statusbar-height"), "30px");
  fixture.resize(1000, 0);
  assert.equal(fixture.root.style_values.get("--desertfox-statusbar-height"), "0px");
  fixture.firefox.write_state({ v: 1, enabled: true, keys: [], tabs: {} });
  fixture.run_frames();
  assert.equal(fixture.root.style_values.get("--desertfox-statusbar-height"), "0px");
});

test("the corner follows the setting, and auto follows the panes of the owner's Firefox", () => {
  const square = started();
  square.firefox.write_state(state_with({}, { ...BAR_CONFIG, border: "chamfer" }));
  square.run_frames();
  assert.equal(square.bar()!.getAttribute("data-corner"), "chamfer");

  const plain = started();
  plain.firefox.write_state(state_with({}, { ...BAR_CONFIG, border: "auto" }));
  plain.run_frames();
  assert.equal(plain.bar()!.getAttribute("data-corner"), "square");
  assert.equal(plain.bar()!.hasAttribute("data-textfox"), false);

  const rounded = started({ root_style: { "--tf-bg": "#222", "--tf-rounding": "10px" } });
  rounded.firefox.write_state(state_with({}, { ...BAR_CONFIG, border: "auto" }));
  rounded.run_frames();
  assert.equal(rounded.bar()!.getAttribute("data-corner"), "round");
  assert.equal(rounded.bar()!.style_values.get("--dfx-round"), "10px");
  assert.equal(rounded.bar()!.hasAttribute("data-textfox"), true);

  const bevel = started({ root_style: { "--tf-bg": "#222", "--tf-rounding": "0px", "nav-after": '""' } });
  bevel.firefox.write_state(state_with({}, { ...BAR_CONFIG, border: "auto" }));
  bevel.run_frames();
  assert.equal(bevel.bar()!.getAttribute("data-corner"), "chamfer");
});

test("a private window without private access draws nothing", () => {
  const fixture = create_bar_fixture({ private_window: true });
  fixture.firefox.start_extension({ private_access: false });
  fixture.load();
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
});

test("a start that throws leaves no bar, reports once and keeps the module on", () => {
  const fixture = create_bar_fixture();
  (fixture.window.win.gBrowser as unknown as { addProgressListener: () => void }).addProgressListener = () => {
    throw new Error("progress listeners changed");
  };
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  assert.equal(fixture.bar(), null);
  assert.equal(fixture.sheets.size, 0);
  assert.equal(fixture.root.style_values.has("--desertfox-statusbar-height"), false);
  assert.equal(fixture.firefox.errors.filter((text) => text.includes("status bar: did not start")).length, 1);
  assert.equal(typeof fixture.firefox.Services.desertfox_browser_module, "object");
  assert.equal(fixture.firefox.errors.filter((text) => text.includes("turned off")).length, 0);
});

test("a missing browser area builds no bar and says nothing in the hello", () => {
  const fixture = create_bar_fixture();
  fixture.root.children = [];
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  assert.equal(fixture.bar(), null);
  assert.deepEqual(fixture.firefox.hello(), { v: 1, module_version: "1.0.0", devtools_hints: true, devtools_visual: true });
});

test("unload takes every listener, observer, sheet and the bar away", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  assert.equal(fixture.sheets.size, 1);
  assert.ok(fixture.window.listener_count("unload") > 0);
  const ready_before = fixture.firefox.ready_listener_count();
  const pref_observers_before = fixture.firefox.pref_observer_count();
  const messages_before = fixture.firefox.message_listener_count();
  fixture.window.close();
  assert.equal(fixture.bar(), null);
  assert.equal(fixture.sheets.size, 0);
  assert.equal(fixture.root.style_values.has("--desertfox-statusbar-height"), false);
  assert.ok([...fixture.listener_counts.values()].every((count) => count === 0), "tab listeners");
  assert.equal(fixture.progress_listeners.size, 0);
  assert.equal(fixture.firefox.ready_listener_count(), ready_before - 1, "ready");
  assert.equal(fixture.firefox.pref_observer_count(), pref_observers_before - 1, "prefs (the fake keeps one observer for both names)");
  assert.equal(fixture.firefox.message_listener_count(), messages_before - 1, "scroll message");
  assert.ok(fixture.resize_observers.every((observer) => observer.disconnected));
  assert.equal(fixture.firefox.extension!.listeners.size, 1, "only the core's storage listener is left");
  fixture.firefox.write_state(state_with({ mode: "insert" }));
  assert.equal(fixture.run_frames(), 0);
});

test("each window listens on its own, and the frame script loads once", () => {
  const first = started();
  const messages = first.firefox.message_listener_count();
  first.firefox.set_named_pref("desertfox.browser_module.statusbar", undefined);
  const scripts = () => first.firefox.frame_scripts.filter((url) => decodeURIComponent(url).includes("desertfox-statusbar:scroll")).length;
  assert.equal(scripts(), 1);
  first.window.close();
  assert.equal(first.firefox.message_listener_count(), messages - 1);
  assert.equal(scripts(), 1);
});

test("the hello keeps a field the core adds, and the bar adds only bar", () => {
  const fixture = started();
  fixture.firefox.extension_writes("desertfox_browser_module_hello", { v: 1, module_version: "1.0.0", later_field: "x" });
  assert.deepEqual(fixture.firefox.hello(), { v: 1, module_version: "1.0.0", later_field: "x", bar: true });
  fixture.firefox.set_named_pref("desertfox.browser_module.statusbar", false);
  assert.deepEqual(fixture.firefox.hello(), { v: 1, module_version: "1.0.0", later_field: "x" });
});

test("a draw that fails retracts bar true and hides the bar, so the corner badge returns", () => {
  const fixture = started();
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  assert.equal((fixture.firefox.hello() as { bar?: boolean }).bar, true);
  Object.defineProperty(fixture.window.win.gBrowser, "visibleTabs", {
    get: () => {
      throw new Error("visibleTabs changed");
    },
  });
  fixture.firefox.write_state(state_with({ mode: "insert" }));
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false);
  assert.equal(fixture.root.style_values.get("--desertfox-statusbar-height"), "0px");
  assert.deepEqual(fixture.firefox.hello(), { v: 1, module_version: "1.0.0", devtools_hints: true, devtools_visual: true });
  fixture.firefox.write_state(state_with({}));
  fixture.run_frames();
  assert.equal(fixture.bar()!.hasAttribute("data-on"), false, "the bar stays off for the session");
});

test("turning the bar back on asks every tab for its scroll place again", () => {
  const fixture = started();
  const asked = () => fixture.firefox.broadcasts.filter((name) => name === "desertfox-statusbar:report-now").length;
  const before = asked();
  fixture.firefox.set_named_pref("desertfox.browser_module.statusbar", false);
  assert.equal(asked(), before);
  fixture.firefox.set_named_pref("desertfox.browser_module.statusbar", undefined);
  assert.equal(asked(), before + 1);
});

test("a private window with private access shows no address and no container", () => {
  const fixture = create_bar_fixture({ private_window: true });
  fixture.firefox.identity_service = { getPublicIdentityFromId: () => ({ color: "blue" }), getUserContextLabel: () => "Work" };
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  (fixture.tabs[0]!.tab as { userContextId?: number }).userContextId = 1;
  fixture.navigate(0, "https://example.com/secret");
  fixture.firefox.write_state(state_with({}, { ...BAR_CONFIG, right: ["url", "container", "tabs"] }));
  fixture.run_frames();
  assert.deepEqual(fixture.widgets("left"), ["NORMAL"]);
  assert.deepEqual(fixture.widgets("right"), ["[1/1]"]);
});

test("the live region is clipped, not hidden, so a screen reader hears it", () => {
  const fixture = started();
  const sheet = decodeURIComponent([...fixture.sheets][0]!);
  const rule = (name: string) => sheet.split("\n").find((line) => line.includes(`.${name} {`))!;
  assert.match(rule("dfx-live"), /clip-path: inset\(50%\)/);
  assert.doesNotMatch(rule("dfx-live"), /visibility/);
  assert.match(rule("dfx-probe"), /visibility: hidden/);
});
