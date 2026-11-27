// The browser module's DevTools tree keys: j, k, h and l in the Inspector markup, the Debugger sources, Storage and Network, docked and in a DevTools window.
// Also what it leaves to DevTools: every other key, Escape (the split console), the console input, and every key with the setting browser_module off.
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const DT = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;
const TOOLBOX = `${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab);`;
// A trusted mouse press on an element's middle, as a user's click, so the focus moves through every frame on the way. A focus() call from chrome left the focus nowhere (measured).
const CLICK = `const click = (element) => { const box = element.getBoundingClientRect(); const view = element.ownerDocument.defaultView; for (const [type, buttons] of [["mousedown", 1], ["mouseup", 0]]) view.synthesizeMouseEvent(type, box.left + Math.min(box.width / 2, 40), box.top + box.height / 2, { button: 0, buttons, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false }); };`;
const TREE_PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>tree</title><main><section><p>one</p><p>two</p></section><p>three</p></main><div style='height:4000px'></div>")}`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, run_line, sleep } = context;
  const steps = module_steps(context);
  const { chrome, session_value, module_status, home, open_tab, in_selected_page, page_scroll, switches_none, focus_page } = steps;

  await setup("turn the module on", () => steps.turn_on_module());

  // Each case opens DevTools on a data: page in a tab of its own, which the teardown closes. With DevTools on a test page's origin, no test page took the focus again after the toolbox closed (measured).
  // The first toolbox takes longer than one debugger call may run, so the call starts it and the case waits for it. The same holds for a tool's first load.
  async function show_tool(tool) {
    on_teardown(() => chrome(`(async () => { ${DT} const w = ${W}; for (const tab of w.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); delete Services.desertfox_key_test_toolbox; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); w.focus(); w.gBrowser.selectedBrowser.focus(); })()`));
    await chrome(`(async () => { ${DT} Services.desertfox_key_test_toolbox = gDevTools.showToolboxForTab(${W}.gBrowser.selectedTab, { toolId: ${JSON.stringify(tool)} }).then(() => "open", (error) => String(error)); })()`);
    await poll_until(`the ${tool} panel to open`, () => chrome(`(async () => { ${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab); return tb?.currentToolId === ${JSON.stringify(tool)} && !!tb.getPanel(${JSON.stringify(tool)}); })()`), { timeout_ms: 15000 });
    expect(!(await chrome(`(async () => { ${TOOLBOX} return tb.splitConsole; })()`)), "the split console is open and would take the focus");
  }
  const focus_in_devtools = async () => {
    const href = await chrome(`(async () => String(Services.focus.focusedWindow?.location?.href ?? ""))()`);
    expect(/^(about:devtools-toolbox|chrome:\/\/devtools\/)/.test(href), `the focus is not in DevTools: ${href}`);
  };
  // Presses `key` and waits until `read` gives `want`, or for a key that must do nothing, checks that `read` stays put.
  async function moves(key, read, want, what) {
    await press_keys(key);
    await poll_until(`${what}: ${key} to give ${JSON.stringify(want)}`, async () => JSON.stringify(await read()) === JSON.stringify(want), { timeout_ms: 3000 }).catch(async (error) => {
      const focus = await chrome(`(async () => { const el = Services.focus.focusedElement; return String(Services.focus.focusedWindow?.location?.href) + " " + (el ? el.localName + "." + el.className : "no element"); })()`);
      throw new Error(`${error.message} (now ${JSON.stringify(await read())}, focus ${focus}, module ${JSON.stringify((await module_status())?.errors)})`);
    });
  }
  async function stays(keys, read, what) {
    const before = JSON.stringify(await read());
    await press_keys(...keys);
    await sleep(NO_EFFECT_MS);
    const after = JSON.stringify(await read());
    expect(after === before, `${what}: ${keys.join(" ")} changed ${before} to ${after}`);
  }

  // The markup view with <section> selected and collapsed, its container focused.
  async function markup_on_section() {
    // The markup view draws the node a moment after a reload, so the selection is retried until the node has its container.
    await poll_until("the section to have a markup container", () =>
      chrome(`(async () => {
        ${TOOLBOX}
        const inspector = tb.getPanel("inspector");
        const node = await inspector.walker.querySelector(inspector.walker.rootNode, "section");
        await inspector.selection.setNodeFront(node, { reason: "test" });
        if (!inspector.markup.getContainer(node)) return false;
        await inspector.markup.collapseNode(node);
        inspector.markup.doc.defaultView.focus();
        inspector.markup.getContainer(node).focus();
        return true;
      })()`),
    );
  }
  const markup_state = () =>
    chrome(`(async () => { ${TOOLBOX} const inspector = tb.getPanel("inspector"); const node = inspector.selection.nodeFront; return [node?.displayName ?? null, inspector.markup.getContainer(node)?.expanded ?? null]; })()`);

  async function markup_moves(what) {
    await markup_on_section();
    await poll_until("the section to be selected and collapsed", async () => JSON.stringify(await markup_state()) === JSON.stringify(["section", false]));
    await focus_in_devtools();
    await moves("l", markup_state, ["section", true], `${what}: l expands`);
    await moves("h", markup_state, ["section", false], `${what}: h collapses`);
    await moves("j", markup_state, ["p", false], `${what}: j moves down past the collapsed section`);
    await moves("k", markup_state, ["section", false], `${what}: k moves back up`);
  }

  await run_case("docked Inspector: l and h expand and collapse a node, j and k move the selection, and the tab and the page stay", async () => {
    await home("bm_dt_markup");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    const scroll_before = await page_scroll();
    await markup_moves("docked");
    expect((await page_scroll()) === scroll_before, "j scrolled the page under DevTools");
    // J is tab.next on the page, and DevTools has no use for it.
    await switches_none("J in the Inspector tree");
    await stays(["x", "-M", "ctrl", "j", "-m", "ctrl"], markup_state, "a key with no row, and j with Ctrl");
  });

  await run_case("Escape and the console input stay DevTools': Escape opens the split console, and j and k type there", async () => {
    await home("bm_dt_console");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    await press_keys("-k", "Escape");
    await poll_until("Escape to open the split console", () => chrome(`(async () => { ${TOOLBOX} return tb.splitConsole === true && !!tb.getPanel("webconsole")?.hud; })()`), { timeout_ms: 5000 });
    const console_text = () => chrome(`(async () => { ${TOOLBOX} return tb.getPanel("webconsole").hud.ui.outputNode.ownerDocument.querySelector(".jsterm-input-container")?.textContent ?? null; })()`);
    await chrome(`(async () => { ${TOOLBOX} const hud = tb.getPanel("webconsole").hud; hud.ui.outputNode.ownerDocument.defaultView.focus(); hud.ui.jsterm.focus(); })()`);
    await press_keys("j", "k", "h", "l");
    await poll_until("jkhl to type into the console input", async () => (await console_text())?.includes("jkhl"), { timeout_ms: 3000 });
    expect(JSON.stringify(await markup_state()) === JSON.stringify(["section", false]), `the console keys moved the markup tree: ${JSON.stringify(await markup_state())}`);
    // DevTools reopens the split console in the next toolbox, where it takes the focus a moment after the load.
    await chrome(`(async () => { ${TOOLBOX} await tb.closeSplitConsole(); })()`);
  });

  await run_case("docked Storage: j and k move through the storage tree", async () => {
    await home("bm_dt_storage");
    await open_tab(TREE_PAGE);
    await show_tool("storage");
    const STORAGE = `${TOOLBOX} const storage = tb.getPanel("storage"); const doc = storage._panelWin.document;`;
    await poll_until("the storage tree to list its types", () => chrome(`(async () => { ${STORAGE} return doc.querySelectorAll("#storage-tree .tree-widget-item").length > 1; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${STORAGE} ${CLICK} click(doc.querySelector("#storage-tree .tree-widget-item")); })()`);
    const storage_state = () => chrome(`(async () => { ${STORAGE} return JSON.stringify(storage.UI.tree.selectedItem ?? null); })()`);
    await poll_until("the first storage type to be selected", async () => (await storage_state()) !== "null");
    await focus_in_devtools();
    const first = await storage_state();
    await press_keys("j");
    const focused = () => chrome(`(async () => { const el = Services.focus.focusedElement; return el ? el.localName + "." + el.className + " in " + el.ownerDocument.documentURI : "none"; })()`);
    await poll_until("j to select the next item", async () => (await storage_state()) !== first, { timeout_ms: 3000 }).catch(async (error) => {
      throw new Error(`${error.message} (selected ${first}, focus ${await focused()})`);
    });
    await moves("k", storage_state, first, "k moves back");
  });

  await run_case("docked Network: j and k move the selected request row", async () => {
    await home("bm_dt_network");
    await open_tab(TREE_PAGE);
    await show_tool("netmonitor");
    await in_selected_page(`(win) => { for (const n of [1, 2, 3]) win.fetch(${JSON.stringify(context.url_of("missing", "bm_dt_network"))} + "&n=" + n).catch(() => undefined); return true; }`);
    const NETWORK = `${TOOLBOX} const doc = tb.getPanel("netmonitor").panelWin.document;`;
    await poll_until("three request rows", () => chrome(`(async () => { ${NETWORK} return doc.querySelectorAll(".request-list-item").length >= 3; })()`), { timeout_ms: 10000 });
    // The row selects on a React click. A trusted press missed the row once, so the case clicks it and focuses its list as the panel's own code would.
    await chrome(`(async () => { ${NETWORK} doc.querySelector(".request-list-item").click(); doc.defaultView.focus(); doc.querySelector(".requests-list-row-group").focus(); })()`);
    const selected_row = () => chrome(`(async () => { ${NETWORK} return [...doc.querySelectorAll(".request-list-item")].findIndex((row) => row.classList.contains("selected")); })()`);
    await poll_until("the first row to be selected", async () => (await selected_row()) === 0);
    await focus_in_devtools();
    await moves("j", selected_row, 1, "j selects the next row");
    await moves("j", selected_row, 2, "j selects the row after");
    await moves("k", selected_row, 1, "k selects the row before");
  });

  await run_case("a DevTools window gets the same keys once it opens, j walks a context menu open there, and the window loses the listener when it closes", async () => {
    await home("bm_dt_window");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    const windows_before = (await module_status()).windows;
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_host = tb.switchHost("window").then(() => "window", (error) => String(error)); })()`);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_host; })()`));
    await poll_until("the DevTools window to get the module", async () => (await module_status()).windows === windows_before + 1, { timeout_ms: 10000 });
    await poll_until("the Inspector in the DevTools window", () => chrome(`(async () => { ${TOOLBOX} return tb.hostType === "window" && !!tb.getPanel("inspector")?.markup; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} tb.win.top.focus(); })()`);
    await markup_moves("in a DevTools window");
    // DevTools opens its context menus in the DevTools window's own document, so the popup walk, not the tree, takes the letter there.
    const MENU = `const popup = Services.wm.getMostRecentWindow("devtools:toolbox")?.document.querySelector('popupset menupopup[menu-api="true"]');`;
    const open_menu = async () => {
      await chrome(`(async () => { ${TOOLBOX} const markup = tb.getPanel("inspector").markup; const top = tb.win.top; markup.contextMenu.openMenu({ target: markup.getContainer(markup.inspector.selection.nodeFront).elt, screenX: top.mozInnerScreenX + 100, screenY: top.mozInnerScreenY + 100 }); })()`);
      await poll_until("the markup context menu to open", () => chrome(`(async () => { ${MENU} return popup?.state === "open"; })()`), { timeout_ms: 5000 });
    };
    const close_menu = async () => {
      await chrome(`(async () => { ${MENU} popup?.hidePopup(); })()`);
      await poll_until("the markup context menu to close", () => chrome(`(async () => { ${MENU} return !popup || popup.state === "closed"; })()`));
    };
    on_teardown(() => chrome(`(async () => { ${MENU} popup?.hidePopup(); })()`));
    const active_item = () => chrome(`(async () => { ${MENU} return [...popup.querySelectorAll("menuitem")].findIndex((item) => item.hasAttribute("_moz-menuactive")); })()`);
    // The arrow keys give the item j and k must reach, since a letter in a menu can also pick an item by its access key.
    await open_menu();
    await press_keys("-k", "Down", "-k", "Down");
    await poll_until("Down twice to activate a menu item", async () => (await active_item()) >= 0, { timeout_ms: 3000 });
    const by_arrows = await active_item();
    await close_menu();
    await open_menu();
    await press_keys("j");
    await moves("j", active_item, by_arrows, "in a menu of a DevTools window, j j moves as Down Down");
    expect(JSON.stringify(await markup_state()) === JSON.stringify(["section", false]), `j moved the markup tree under the menu: ${JSON.stringify(await markup_state())}`);
    await close_menu();
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_host = tb.switchHost("bottom").then(() => "bottom", (error) => String(error)); })()`);
    await poll_until("the DevTools window to close and lose the module", async () => (await module_status()).windows === windows_before, { timeout_ms: 10000 });
  });

  await run_case("with the setting browser_module off DevTools gets every key, and turned on again the module gets the table again", async () => {
    // The command line needs DesertFox's own page, so the setting changes in the first tab before DevTools opens in a second one.
    await home("bm_dt_consent");
    await focus_page();
    await run_line(":set browser_module false");
    await poll_until("the state to go", async () => (await session_value(STATE_KEY)) === null);
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await poll_until("the section to be selected and collapsed", async () => JSON.stringify(await markup_state()) === JSON.stringify(["section", false]));
    await focus_in_devtools();
    await stays(["j", "l"], markup_state, "the setting off");
    await chrome(`(async () => { ${DT} const w = ${W}; await gDevTools.closeToolboxForTab(w.gBrowser.selectedTab); w.gBrowser.removeTab(w.gBrowser.selectedTab); w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);
    await focus_page();
    await steps.turn_on_module();
    await poll_until("the extension to push the DevTools key table again", async () => ((await session_value("desertfox_browser_module_from_extension")) ?? []).some((message) => message.kind === "devtools.keys"));
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await poll_until("the section to be selected and collapsed again", async () => JSON.stringify(await markup_state()) === JSON.stringify(["section", false]));
    await focus_in_devtools();
    await moves("l", markup_state, ["section", true], "the setting on again: l expands");
  });

  await run_case("docked Debugger: j and k move through the sources tree, h and l collapse and expand", async () => {
    await home("bm_dt_debugger");
    // The Debugger lists no data: source under a host, so this page comes from the test server under another site name.
    await open_tab(context.url_of("page", "bm_dt_debugger_sources").replace("127.0.0.1", "localhost"));
    await show_tool("jsdebugger");
    const SOURCES = `${TOOLBOX} const doc = tb.getPanel("jsdebugger").panelWin.document;`;
    await poll_until("the sources tree to list a node", () => chrome(`(async () => { ${SOURCES} return doc.querySelectorAll(".sources-list [role=treeitem]").length > 1; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${SOURCES} const first = doc.querySelector(".sources-list [role=treeitem]"); first.click(); doc.defaultView.focus(); (first.closest("[role=tree]") ?? first).focus(); })()`);
    const sources_state = () => chrome(`(async () => { ${SOURCES} const node = doc.querySelector(".sources-list .tree-node.focused"); return node ? [node.textContent.trim(), node.getAttribute("aria-expanded")] : null; })()`);
    await poll_until("the first source node to take the focus", async () => (await sources_state()) !== null);
    await focus_in_devtools();
    const [first] = await sources_state();
    await moves("h", sources_state, [first, "false"], "h collapses the first node");
    await moves("l", sources_state, [first, "true"], "l expands it");
    await poll_until("the expanded node to show a child", () => chrome(`(async () => { ${SOURCES} return doc.querySelectorAll(".sources-list [role=treeitem]").length > 1; })()`));
    await press_keys("j");
    await poll_until("j to move to the next node", async () => (await sources_state())?.[0] !== first, { timeout_ms: 3000 });
    await moves("k", sources_state, [first, "true"], "k moves back");
  });
}
