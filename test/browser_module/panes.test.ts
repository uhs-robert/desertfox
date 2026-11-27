import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const PANES_FILE = "desertfox-panes.js";
const NOT_SUPPORTED = "Not supported in this Firefox version";
const NOT_SPLIT = "This tab is not in a split view";

type FakeTab = { name: string; pinned: boolean; hidden: boolean; splitview: FakeSplit | null; linkedBrowser: { focus(): void } };
type FakeSplit = { tabs: FakeTab[]; unsplitTabs?(): void; close?(): void; resetRightPanelWidth?(): void };
type AddSplit = (pair: FakeTab[], options: { insertBefore?: FakeTab }) => FakeSplit | null;
type Reply = { reply_to: string; ok: boolean; error?: string };

// One focused browser window with `names` tabs, the first one selected, and stand-ins for the split view, sidebar and DevTools internals the pane feature reads.
function pane_world({ names = ["a", "b", "c"], private_window = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [PANES_FILE]: source_of(PANES_FILE) } });
  firefox.start_extension({ private_access });
  const window = firefox.make_window({ private_window });
  window.load();
  const calls: string[] = [];
  const tabs: FakeTab[] = names.map((name) => ({ name, pinned: false, hidden: false, splitview: null, linkedBrowser: { focus: () => calls.push(`focus page ${name}`) } }));

  const panel = { width: 500, min_width: "200px", attributes: new Map<string, string>(), inline_width: "" };
  const first_panel = {
    getBoundingClientRect: () => ({ width: panel.width }),
    setAttribute: (name: string, value: string) => panel.attributes.set(name, value),
    style: { setProperty: (name: string, value: string) => name === "width" && (panel.inline_width = value) },
  };
  const tabpanels = { clientWidth: 1000, splitViewPanels: [] as string[], updateSplitterAriaAttributes: () => (calls.push("aria"), Promise.resolve()) };

  const make_split = (pair: FakeTab[]) => {
    const split: FakeSplit = {
      tabs: pair,
      unsplitTabs: () => (calls.push("unsplit"), unsplit_all(split)),
      close: () => calls.push(`close ${split.tabs.map((tab) => tab.name).join(" ")}`),
      resetRightPanelWidth: () => calls.push("reset right"),
    };
    for (const tab of pair) tab.splitview = split;
    tabpanels.splitViewPanels = ["panel-first", "panel-second"];
    gBrowser.activeSplitView = split;
    return split;
  };
  const unsplit_all = (split: FakeSplit) => {
    for (const tab of split.tabs) tab.splitview = null;
    gBrowser.activeSplitView = null;
    tabpanels.splitViewPanels = [];
  };

  const add_split: AddSplit = (pair, options) => {
    calls.push(`split ${pair.map((tab) => tab.name).join(" ")} before ${options.insertBefore?.name}`);
    return make_split(pair);
  };
  const tab_at = (index: number) => tabs[index]!;
  let selected = tab_at(0);
  const gBrowser = {
    get selectedTab() {
      return selected;
    },
    set selectedTab(tab: FakeTab) {
      calls.push(`select ${tab.name}`);
      selected = tab;
    },
    get selectedBrowser() {
      return selected.linkedBrowser;
    },
    get visibleTabs() {
      return tabs.filter((tab) => !tab.hidden);
    },
    activeSplitView: null as FakeSplit | null,
    tabpanels,
    addTabSplitView: add_split as AddSplit | undefined,
    // A real tab browser has many more fields. These stay for the core.
    getTabForBrowser: window.win.gBrowser.getTabForBrowser,
    tabContainer: window.win.gBrowser.tabContainer,
  };

  const sidebar = {
    isOpen: false,
    opens: true,
    browser: { focus: () => calls.push("focus sidebar") },
    toggle: async () => {
      calls.push("toggle sidebar");
      sidebar.isOpen = sidebar.opens;
    },
  };
  const toolbox: { hostType: string; currentToolId: string; focusTool: ((id: string) => number) | undefined; win: { focus(): number } | undefined } = {
    hostType: "bottom",
    currentToolId: "webconsole",
    focusTool: (id: string) => calls.push(`focus tool ${id}`),
    win: { focus: () => calls.push("focus toolbox window") },
  };
  const shim = { initialized: true, toolbox: toolbox as typeof toolbox | null, isInitialized: () => shim.initialized, getToolboxForTab: (tab: FakeTab) => (tab === selected ? shim.toolbox : null) };
  firefox.module_exports = { DevToolsShim: shim };

  const win = window.win as Record<string, unknown>;
  Object.assign(win, {
    gBrowser,
    SidebarController: sidebar,
    BrowserCommands: {
      // Firefox's flow: a new picker tab beside the selected tab, split with it and selected.
      addTabSplitView: () => {
        calls.push("new split");
        const picker: FakeTab = { name: "picker", pinned: false, hidden: false, splitview: null, linkedBrowser: { focus: () => calls.push("focus page picker") } };
        tabs.push(picker);
        make_split([selected, picker]);
        selected = picker;
      },
    } as Record<string, unknown>,
    getComputedStyle: () => ({ minWidth: panel.min_width }),
    closed: false,
  });
  Object.assign(window.win.document, {
    documentElement: { getAttribute: (name: string) => (name === "windowtype" ? "navigator:browser" : null) },
    getElementById: (id: string) => (id === "panel-first" ? first_panel : null),
  });
  const services = firefox.Services as Record<string, unknown>;
  services.focus = { activeWindow: win };

  let next_id = 0;
  // Sends one request, as the extension's call does, and gives back the module's reply to it.
  async function ask(kind: string, args: Record<string, unknown> = {}): Promise<Omit<Reply, "reply_to">> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind, args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as Reply[]).find((each) => each.reply_to === id);
    assert.ok(reply, `no reply to ${kind}`);
    const { reply_to: _id, v: _v, ...rest } = JSON.parse(JSON.stringify(reply)) as Reply & { v: number };
    return rest;
  }
  const split_first_two = () => make_split([tab_at(0), tab_at(1)]);
  return { firefox, win, gBrowser, tab: tab_at, calls, panel, tabpanels, sidebar, toolbox, shim, services, ask, split_first_two, select: (tab: FakeTab) => (selected = tab) };
}

// Values made inside a vm context have that context's prototypes, which a strict deep equal tells apart.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const refused = (error: string) => ({ ok: false, error });
const OK = { ok: true };

test("the pane feature loads with the module on, registers every pane kind and reaches no Firefox internal at start", () => {
  const firefox = create_firefox({ extra_files: { [PANES_FILE]: source_of(PANES_FILE) } });
  firefox.start_extension();
  // A window with nothing but the tab browser the loader needs: no split view, sidebar or DevTools internals.
  firefox.make_window().load();
  const core = (firefox.Services as Record<string, unknown>).desertfox_browser_module as { status(): { active: boolean; features: string[]; errors: string[] } };
  const status = plain(core.status());
  assert.equal(status.active, true);
  assert.ok(status.features.includes(PANES_FILE));
  assert.deepEqual(status.errors, []);
});

test("an older core with no register_kind leaves the module on and logs one line", () => {
  const firefox = create_firefox({
    extra_files: { [PANES_FILE]: source_of(PANES_FILE) },
    patch_source: (name, source) => (name === "desertfox-browser.js" ? source.replace("register_kind(kind, handler) {", "register_kind_gone(kind, handler) {") : source),
  });
  firefox.start_extension();
  firefox.make_window().load();
  const core = (firefox.Services as Record<string, unknown>).desertfox_browser_module as { status(): { active: boolean; errors: string[] } };
  assert.equal(core.status().active, true);
  assert.deepEqual(plain(core.status().errors), ["the core has no register_kind, so the pane feature stays off"]);
});

test("pane.split_new_tab runs Firefox's own flow: a picker tab split beside the tab and selected", async () => {
  const world = pane_world();
  assert.deepEqual(await world.ask("pane.split_new_tab"), OK);
  assert.deepEqual(world.calls, ["new split"]);
  assert.equal(world.gBrowser.selectedTab.name, "picker");
});

test("pane.split_new_tab and pane.split_next_tab refuse a tab that is already split, pinned or hidden", async () => {
  for (const kind of ["pane.split_new_tab", "pane.split_next_tab"]) {
    const world = pane_world();
    world.split_first_two();
    assert.deepEqual(await world.ask(kind), refused("This tab is already in a split view"));
    world.tab(2).pinned = true;
    world.select(world.tab(2));
    assert.deepEqual(await world.ask(kind), refused("A pinned tab cannot be in a split view"));
    world.tab(2).pinned = false;
    world.tab(2).hidden = true;
    assert.deepEqual(await world.ask(kind), refused("A hidden tab cannot be in a split view"));
    assert.ok(!world.calls.some((call) => call.includes("split")), `${kind} split anyway: ${world.calls.join(", ")}`);
  }
});

test("pane.split_new_tab refuses when Firefox lacks the flow or the flow made no split", async () => {
  const world = pane_world();
  const commands = world.win.BrowserCommands as Record<string, unknown>;
  commands.addTabSplitView = () => undefined;
  assert.deepEqual(await world.ask("pane.split_new_tab"), refused("Firefox did not make the split view"));
  delete commands.addTabSplitView;
  assert.deepEqual(await world.ask("pane.split_new_tab"), refused(NOT_SUPPORTED));
});

test("pane.split_next_tab splits the tab with the next visible tab, placed where the tab was", async () => {
  const world = pane_world();
  world.tab(1).hidden = true;
  assert.deepEqual(await world.ask("pane.split_next_tab"), OK);
  assert.deepEqual(world.calls, ["split a c before a"]);
});

test("pane.split_next_tab refuses with no next tab, a next tab already split, a missing call or a split Firefox did not make", async () => {
  const world = pane_world();
  world.select(world.tab(2));
  assert.deepEqual(await world.ask("pane.split_next_tab"), refused("There is no next tab to split with"));
  world.select(world.tab(0));
  world.tab(1).splitview = { tabs: [world.tab(1), world.tab(2)] };
  assert.deepEqual(await world.ask("pane.split_next_tab"), refused("The next tab is already in a split view"));
  world.tab(1).splitview = null;
  world.gBrowser.addTabSplitView = () => null;
  assert.deepEqual(await world.ask("pane.split_next_tab"), refused("Firefox did not make the split view"));
  world.gBrowser.addTabSplitView = undefined;
  assert.deepEqual(await world.ask("pane.split_next_tab"), refused(NOT_SUPPORTED));
});

test("pane.unsplit and pane.close_both act on the selected tab's split view", async () => {
  const world = pane_world();
  world.split_first_two();
  assert.deepEqual(await world.ask("pane.close_both"), OK);
  assert.deepEqual(await world.ask("pane.unsplit"), OK);
  assert.deepEqual(world.calls, ["close a b", "unsplit"]);
  assert.equal(world.tab(0).splitview, null);
});

test("every op that needs a split view refuses a tab outside one", async () => {
  const world = pane_world();
  for (const [kind, args] of [
    ["pane.unsplit", {}],
    ["pane.close_both", {}],
    ["pane.resize", { steps: 1 }],
    ["pane.focus_region", { region: "split" }],
  ] as const) {
    assert.deepEqual(await world.ask(kind, args), refused(NOT_SPLIT), kind);
  }
  assert.deepEqual(world.calls, []);
});

test("unsplit and close both refuse a split view without the call, and a tab without the splitview field is not supported", async () => {
  const world = pane_world();
  const split = world.split_first_two();
  delete split.unsplitTabs;
  delete split.close;
  assert.deepEqual(await world.ask("pane.unsplit"), refused(NOT_SUPPORTED));
  assert.deepEqual(await world.ask("pane.close_both"), refused(NOT_SUPPORTED));
  delete (world.tab(0) as Partial<FakeTab>).splitview;
  assert.deepEqual(await world.ask("pane.unsplit"), refused(NOT_SUPPORTED));
  assert.deepEqual(await world.ask("pane.split_next_tab"), refused(NOT_SUPPORTED));
});

test("pane.resize moves the first panel 5 percent of the panel area per step, as the splitter writes it", async () => {
  const world = pane_world();
  world.split_first_two();
  assert.deepEqual(await world.ask("pane.resize", { steps: 1 }), OK);
  assert.equal(world.panel.attributes.get("width"), "550");
  assert.equal(world.panel.inline_width, "550px");
  assert.deepEqual(world.calls, ["reset right", "aria"]);
  world.panel.width = 550;
  assert.deepEqual(await world.ask("pane.resize", { steps: -3 }), OK);
  assert.equal(world.panel.attributes.get("width"), "400");
});

test("pane.resize stops at the panel's min-width on either side", async () => {
  const world = pane_world();
  world.split_first_two();
  assert.deepEqual(await world.ask("pane.resize", { steps: 20 }), OK);
  assert.equal(world.panel.attributes.get("width"), "800");
  assert.deepEqual(await world.ask("pane.resize", { steps: -20 }), OK);
  assert.equal(world.panel.attributes.get("width"), "200");
  // A panel area narrower than two minimum panels keeps the first panel at its minimum.
  world.tabpanels.clientWidth = 300;
  assert.deepEqual(await world.ask("pane.resize", { steps: 5 }), OK);
  assert.equal(world.panel.attributes.get("width"), "200");
});

test("pane.resize refuses when the panel list, the active split or the first panel is missing, and works without the optional calls", async () => {
  const world = pane_world();
  const split = world.split_first_two();
  world.gBrowser.activeSplitView = null;
  assert.deepEqual(await world.ask("pane.resize", { steps: 1 }), refused(NOT_SUPPORTED));
  world.gBrowser.activeSplitView = split;
  world.tabpanels.splitViewPanels = ["gone", "panel-second"];
  assert.deepEqual(await world.ask("pane.resize", { steps: 1 }), refused(NOT_SUPPORTED));
  (world.tabpanels as Record<string, unknown>).splitViewPanels = undefined;
  assert.deepEqual(await world.ask("pane.resize", { steps: 1 }), refused(NOT_SUPPORTED));
  world.tabpanels.splitViewPanels = ["panel-first", "panel-second"];
  delete split.resetRightPanelWidth;
  delete (world.tabpanels as Partial<typeof world.tabpanels>).updateSplitterAriaAttributes;
  assert.deepEqual(await world.ask("pane.resize", { steps: 1 }), OK);
  assert.equal(world.panel.attributes.get("width"), "550");
  assert.deepEqual(world.calls, []);
});

test("pane.focus_region page focuses the selected tab's page, and split selects and focuses the other pane", async () => {
  const world = pane_world();
  assert.deepEqual(await world.ask("pane.focus_region", { region: "page" }), OK);
  world.split_first_two();
  assert.deepEqual(await world.ask("pane.focus_region", { region: "split" }), OK);
  assert.deepEqual(world.calls, ["focus page a", "select b", "focus page b"]);
});

test("pane.focus_region sidebar opens a closed sidebar, then focuses it, and focuses an open one at once", async () => {
  const world = pane_world();
  assert.deepEqual(await world.ask("pane.focus_region", { region: "sidebar" }), OK);
  assert.deepEqual(await world.ask("pane.focus_region", { region: "sidebar" }), OK);
  assert.deepEqual(world.calls, ["toggle sidebar", "focus sidebar", "focus sidebar"]);
});

test("pane.focus_region sidebar refuses a sidebar that does not open, or no sidebar controller", async () => {
  const world = pane_world();
  world.sidebar.opens = false;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "sidebar" }), refused("The sidebar did not open"));
  world.win.SidebarController = undefined;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "sidebar" }), refused(NOT_SUPPORTED));
  assert.deepEqual(world.calls, ["toggle sidebar"]);
});

test("pane.focus_region devtools focuses the current tool of a docked toolbox, else its window", async () => {
  const world = pane_world();
  for (const host of ["bottom", "left", "right"]) {
    world.toolbox.hostType = host;
    assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), OK, host);
  }
  world.toolbox.focusTool = undefined;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), OK);
  assert.deepEqual(world.calls, ["focus tool webconsole", "focus tool webconsole", "focus tool webconsole", "focus toolbox window"]);
});

test("pane.focus_region devtools refuses DevTools never loaded, no toolbox for the tab, a detached or undocked toolbox, and a missing shim", async () => {
  const world = pane_world();
  world.shim.initialized = false;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused("DevTools is not open for this tab"));
  world.shim.initialized = true;
  world.shim.toolbox = null;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused("DevTools is not open for this tab"));
  world.shim.toolbox = world.toolbox;
  world.toolbox.hostType = "window";
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused("DevTools is in its own window, so it is not docked here"));
  world.toolbox.hostType = "page";
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused("DevTools is not docked in this window"));
  world.toolbox.hostType = "bottom";
  world.toolbox.focusTool = undefined;
  world.toolbox.win = undefined;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused(NOT_SUPPORTED));
  world.firefox.module_exports = {};
  assert.deepEqual(await world.ask("pane.focus_region", { region: "devtools" }), refused(NOT_SUPPORTED));
  assert.deepEqual(world.calls, []);
});

test("every pane op refuses with no focused browser window, and never reaches another window", async () => {
  const world = pane_world();
  const requests = [
    ["pane.split_new_tab", {}],
    ["pane.split_next_tab", {}],
    ["pane.unsplit", {}],
    ["pane.close_both", {}],
    ["pane.resize", { steps: 1 }],
    ["pane.focus_region", { region: "page" }],
    ["pane.focus_region", { region: "split" }],
    ["pane.focus_region", { region: "sidebar" }],
    ["pane.focus_region", { region: "devtools" }],
  ] as const;
  world.split_first_two();
  for (const active of [null, { ...world.win, closed: true }, { ...world.win, document: { documentElement: { getAttribute: () => "devtools:toolbox" } } }]) {
    world.services.focus = { activeWindow: active };
    for (const [kind, args] of requests) assert.deepEqual(await world.ask(kind, args), refused("No Firefox window has the focus"), kind);
  }
  assert.deepEqual(world.calls, []);
});

test("a focused window with no tab browser or a Firefox without its private window check is not supported", async () => {
  const world = pane_world();
  world.firefox.fail_import = true;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "page" }), refused(NOT_SUPPORTED));
  world.firefox.fail_import = false;
  world.win.gBrowser = null;
  assert.deepEqual(await world.ask("pane.focus_region", { region: "page" }), refused(NOT_SUPPORTED));
});

test("a private window takes pane ops only when DesertFox may run in private windows", async () => {
  const shut_out = pane_world({ private_window: true });
  assert.deepEqual(await shut_out.ask("pane.focus_region", { region: "page" }), refused("DesertFox may not run in this private window"));
  assert.deepEqual(shut_out.calls, []);
  const allowed = pane_world({ private_window: true, private_access: true });
  assert.deepEqual(await allowed.ask("pane.focus_region", { region: "page" }), OK);
});
