// The browser module's DevTools tree keys: j, k, h and l in the Inspector markup, the Debugger sources, Storage and Network, docked, in a DevTools window and in a toolbox tab.
// Also what it leaves to DevTools: every other key, Escape (the split console), the console input, and every key with the setting browser_module off.
// And hints in DevTools: f labels the tool tabs and the markup lines, a label picks, Escape ends them, docked and in a DevTools window, with a module that does not say devtools_hints and with a lost ask.
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const DT = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;
const TOOLBOX = `${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab);`;
// A trusted mouse press on an element's middle, as a user's click, so the focus moves through every frame on the way. A focus() call from chrome left the focus nowhere (measured).
const CLICK = `const click = (element) => { const box = element.getBoundingClientRect(); const view = element.ownerDocument.defaultView; for (const [type, buttons] of [["mousedown", 1], ["mouseup", 0]]) view.synthesizeMouseEvent(type, box.left + Math.min(box.width / 2, 40), box.top + box.height / 2, { button: 0, buttons, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false }); };`;
const HINT_HOST = "desertfox-devtools-hints";
// Chrome code: every label of every DevTools hints layer under the toolbox, with the element it marks in its own document: the one in its row whose left edge (or an icon button's middle) is nearest the label's left edge, right edge or middle.
const LABELS = `(async () => {
  ${TOOLBOX}
  const docs = [];
  const walk = (doc) => { docs.push(doc); for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument) walk(frame.contentDocument); };
  walk(tb.doc);
  const out = [];
  for (const doc of docs) {
    const candidates = [...doc.querySelectorAll(".devtools-tab, .tag-line, button, [role=tab]")];
    for (const host of doc.querySelectorAll(".${HINT_HOST}")) {
      for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = node.getBoundingClientRect();
        let best, best_distance = Infinity;
        for (const el of candidates) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          const across = Math.min(Math.abs(r.left - box.left), Math.abs(r.left - box.right), r.width < 40 ? Math.abs(r.left + r.width / 2 - (box.left + box.width / 2)) : Infinity);
          const distance = across + Math.abs(r.top + r.height / 2 - (box.top + box.height / 2));
          if (distance < best_distance) [best, best_distance] = [el, distance];
        }
        const line = best?.classList.contains("tag-line");
        out.push({
          text: node.textContent,
          target: best ? (!line && best.id) || best.textContent.trim().replace(/\\s+/g, " ").slice(0, 40) : "",
          off: best_distance,
          styled: doc.defaultView.getComputedStyle(node).borderRadius === "3px",
          doc: docs.indexOf(doc),
          box: [box.left, box.top, box.right, box.bottom].map(Math.round),
          // A label over the first 40 px of its line hides the tag name there.
          covers_tag: !!line && box.right > best.getBoundingClientRect().left + 1 && box.left < best.getBoundingClientRect().left + 40,
        });
      }
    }
  }
  return out;
})()`;
const LAYER_COUNT = `(async () => { ${TOOLBOX} if (!tb) return 0; let count = 0; const walk = (doc) => { count += doc.querySelectorAll(".${HINT_HOST}").length; for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument) walk(frame.contentDocument); }; walk(tb.doc); return count; })()`;
const TREE_PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>tree</title><main><section><p>one</p><p>two</p></section><p>three</p></main><div style='height:4000px'></div>")}`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, run_line, sleep, take_shot, in_background, clear_notices } = context;
  const steps = module_steps(context);
  const { chrome, session_value, set_session_value, module_status, home, open_tab, in_selected_page, page_scroll, switches_one, focus_page } = steps;

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
    await press_keys(...[key].flat());
    await poll_until(`${what}: ${[key].flat().join(" ")} to give ${JSON.stringify(want)}`, async () => JSON.stringify(await read()) === JSON.stringify(want), { timeout_ms: 3000 }).catch(async (error) => {
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
    // J and K switch browser tabs from DevTools, as on the page. A failure says which step broke: whether the keydown arrived and with what, and whether the command itself switches from here.
    await sleep(300);
    await chrome(`(async () => { const w = ${W}; const seen = []; const on_key = (event) => seen.push({ key: event.key, shift: event.shiftKey, prevented: event.defaultPrevented, trusted: event.isTrusted }); w.addEventListener("keydown", on_key, true); Services.desertfox_key_test_keys = seen; Services.desertfox_key_test_keys_off = () => w.removeEventListener("keydown", on_key, true); })()`);
    on_teardown(() => chrome(`(async () => { Services.desertfox_key_test_keys_off?.(); delete Services.desertfox_key_test_keys; delete Services.desertfox_key_test_keys_off; })()`));
    await switches_one("J in the Inspector tree").catch(async (error) => {
      const keys = await chrome(`(async () => JSON.stringify(Services.desertfox_key_test_keys))()`);
      await steps.watch_switches();
      const ran = await chrome(`(async () => Services.desertfox_browser_module.run_command("tab.next", {}, { window: ${W} }))()`);
      await sleep(500);
      const by_command = await steps.switch_count();
      throw new Error(`${error.message} (keydowns seen by the window: ${keys}; run_command returned ${ran} and made ${by_command} switches; module ${JSON.stringify((await module_status())?.errors)})`);
    });
    await switches_one("K in the Inspector tree", ["K"]);
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
    await press_keys("j", "k", "h", "l", "f");
    await poll_until("jkhlf to type into the console input", async () => (await console_text())?.includes("jkhlf"), { timeout_ms: 3000 });
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

  await run_case("a DevTools window gets the same keys once it opens, j moves a context menu open there as its arrow does, and the window loses the listener when it closes", async () => {
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
    // DevTools opens its context menus in the DevTools window's own document. The DevTools feature types the arrow key there, and the open menu takes it ahead of the tree.
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

  await run_case("a toolbox opened as a tab (about:debugging Inspect) keeps its keys: J switches one tab, x x closes nothing, and j and k move the Inspector tree", async () => {
    await home("bm_dt_tab_toolbox");
    await open_tab(TREE_PAGE);
    const target_id = await chrome(`(async () => ${W}.gBrowser.selectedBrowser.browserId)()`);
    on_teardown(() => chrome(`(async () => { ${DT} const w = ${W}; for (const tb of gDevTools.getToolboxes()) await tb.destroy(); w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); w.focus(); w.gBrowser.selectedBrowser.focus(); })()`));
    await open_tab(`about:devtools-toolbox?type=tab&id=${target_id}`, { wait_load: false });
    // The toolbox of a tab host is not the toolbox of a page tab, so it is found by its host.
    const TAB_TOOLBOX = `${DT} const tb = gDevTools.getToolboxes().find((one) => one.hostType === "page");`;
    await poll_until("the toolbox in its own tab to show the Inspector", () => chrome(`(async () => { ${TAB_TOOLBOX} if (!tb?.isReady) return false; if (tb.currentToolId !== "inspector") { tb.selectTool("inspector"); return false; } return !!tb.getPanel("inspector")?.markup; })()`), { timeout_ms: 20000 });
    const tabs_before = await chrome(`(async () => { const w = ${W}; return [w.gBrowser.tabs.length, w.gBrowser.tabs.indexOf(w.gBrowser.selectedTab)]; })()`);
    const tab_state = () => chrome(`(async () => { const w = ${W}; return [w.gBrowser.tabs.length, w.gBrowser.tabs.indexOf(w.gBrowser.selectedTab)]; })()`);
    const tree_state = () => chrome(`(async () => { ${TAB_TOOLBOX} const inspector = tb.getPanel("inspector"); const node = inspector.selection.nodeFront; return [node?.displayName ?? null, inspector.markup.getContainer(node)?.expanded ?? null]; })()`);
    await poll_until("the section to have a markup container", () =>
      chrome(`(async () => {
        ${TAB_TOOLBOX}
        const inspector = tb.getPanel("inspector");
        const node = await inspector.walker.querySelector(inspector.walker.rootNode, "section");
        await inspector.selection.setNodeFront(node, { reason: "test" });
        if (!inspector.markup.getContainer(node)) return false;
        await inspector.markup.collapseNode(node);
        ${W}.focus();
        inspector.markup.doc.defaultView.focus();
        inspector.markup.getContainer(node).focus();
        return true;
      })()`),
    { timeout_ms: 10000 });
    await focus_in_devtools();
    await moves("j", tree_state, ["p", false], "in a toolbox tab: j moves down past the collapsed section");
    await moves("k", tree_state, ["section", false], "in a toolbox tab: k moves back up");
    await press_keys("x", "x");
    await sleep(NO_EFFECT_MS);
    expect(JSON.stringify(await tab_state()) === JSON.stringify(tabs_before), `x x changed the tabs: ${JSON.stringify(tabs_before)} to ${JSON.stringify(await tab_state())}`);
    // J is the DevTools row that switches the browser tab, as in a docked toolbox, so it switches one tab here too.
    await switches_one("J in a toolbox tab");
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

  // ---- Hints.

  const labels_now = () => chrome(LABELS);
  const layers = () => chrome(LAYER_COUNT);
  const tool_now = () => chrome(`(async () => { ${TOOLBOX} return tb.currentToolId; })()`);
  async function start_hints(what) {
    on_teardown(async () => {
      if ((await layers()) > 0) await press_keys("-k", "Escape");
    });
    await press_keys("f");
    await poll_until(`${what}: the labels to show`, async () => (await labels_now()).length > 0, { timeout_ms: 4000 });
    return labels_now();
  }
  const label_of = (labels, test, what) => {
    const label = labels.find((each) => test(each.target));
    expect(label, `${what}: no label marks it among ${JSON.stringify(labels.map(({ text, target }) => [text, target]))}`);
    return label.text;
  };
  async function expect_no_layer(what) {
    await poll_until(`${what}: the layers to go`, async () => (await layers()) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value("desertfox_chrome_hints")) === null, { timeout_ms: 3000 });
  }

  await run_case("docked hints: f labels the tool tabs and each markup line, a tab's label opens its tool, and Escape ends the labels without the split console", async () => {
    await home("bm_dt_hints");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    const labels = await start_hints("docked");
    expect(labels.every(({ styled }) => styled), "a label lacks the label sheet");
    expect(labels.filter(({ target }) => target.startsWith("<p>") || target.startsWith("p")).length >= 1, `no markup line has a label: ${JSON.stringify(labels)}`);
    const covering = labels.filter(({ covers_tag }) => covers_tag);
    expect(covering.length === 0, `a markup label covers its tag name: ${JSON.stringify(covering)}`);
    // Labels in one row of a document keep at least 2 px apart, so a row of icon buttons reads as separate labels.
    const crowded = labels.filter((a, i) => labels.some((b, j) => j !== i && a.doc === b.doc && a.box[1] < b.box[3] && b.box[1] < a.box[3] && a.box[0] < b.box[2] + 2 && b.box[0] < a.box[2] + 2));
    expect(crowded.length === 0, `labels crowd each other: ${JSON.stringify(crowded.map(({ text, target, box }) => [text, target, box]))}`);
    // The docked toolbox paints the labels a moment after they are in its documents (measured: none in a shot taken at once).
    await sleep(700);
    await take_shot("/tmp/desertfox-devtools-hints-docked.png");
    const console_tab = label_of(labels, (target) => target === "toolbox-tab-webconsole", "the Console tab");
    await press_keys(console_tab);
    await poll_until("the Console tab's label to open the Console", async () => (await tool_now()) === "webconsole", { timeout_ms: 4000 });
    await expect_no_layer("after the pick");
    // Escape during the labels ends them, and DevTools never sees it.
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    await start_hints("Escape");
    await press_keys("-k", "Escape");
    await expect_no_layer("Escape");
    await sleep(NO_EFFECT_MS);
    expect(!(await chrome(`(async () => { ${TOOLBOX} return tb.splitConsole; })()`)), "Escape opened the split console");
  });

  await run_case("docked hints: a markup line's label selects its node, and j then moves on from it", async () => {
    await home("bm_dt_hints_markup");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    const labels = await start_hints("markup");
    const three = label_of(labels, (target) => target.includes("three"), "the <p>three</p> line");
    await press_keys(three);
    await poll_until("the label to select the <p> after the section", async () => (await markup_state())[0] === "p", { timeout_ms: 4000 });
    await expect_no_layer("after the markup pick");
    await press_keys("j");
    await poll_until("j to move the selection on from the picked node", async () => (await markup_state())[0] !== "p", { timeout_ms: 3000 });
  });

  await run_case("hints in a DevTools window of its own: f labels the tool tabs and a label opens its tool", async () => {
    await home("bm_dt_hints_window");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    const windows_before = (await module_status()).windows;
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_host = tb.switchHost("window").then(() => "window", (error) => String(error)); })()`);
    on_teardown(() => chrome(`(async () => { ${TOOLBOX} delete Services.desertfox_key_test_host; if (tb?.hostType === "window") await tb.switchHost("bottom"); })()`));
    await poll_until("the DevTools window to get the module", async () => (await module_status()).windows === windows_before + 1, { timeout_ms: 10000 });
    await poll_until("the Inspector in the DevTools window", () => chrome(`(async () => { ${TOOLBOX} return tb.hostType === "window" && !!tb.getPanel("inspector")?.markup; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} tb.win.top.focus(); })()`);
    await markup_on_section();
    await focus_in_devtools();
    const labels = await start_hints("DevTools window");
    await take_shot("/tmp/desertfox-devtools-hints-window.png");
    await press_keys(label_of(labels, (target) => target === "toolbox-tab-netmonitor", "the Network tab"));
    await poll_until("the Network tab's label to open Network", async () => (await tool_now()) === "netmonitor", { timeout_ms: 4000 });
    await expect_no_layer("after the pick in the window");
  });

  await run_case("a module whose hello does not say devtools_hints gets no hint key, so f stays DevTools' and the tree keys stay", async () => {
    await home("bm_dt_hints_flag");
    const HELLO_KEY = "desertfox_browser_module_hello";
    const own_hello = await session_value(HELLO_KEY);
    expect(own_hello?.devtools_hints === true, `the module's hello lacks devtools_hints: ${JSON.stringify(own_hello)}`);
    const last_table = async () => ((await session_value("desertfox_browser_module_from_extension")) ?? []).filter((message) => message.kind === "devtools.keys").at(-1)?.args.keys.map(({ key }) => key).join("");
    // Teardowns run at the piece's end, and the cases after this one need the hint key back.
    try {
      await set_session_value(HELLO_KEY, Object.fromEntries(Object.entries(own_hello).filter(([name]) => name !== "devtools_hints")));
      await poll_until("the extension to push the table without the hint key", async () => (await last_table()) === "jkhlv/nNgJK", { timeout_ms: 5000 });
      await open_tab(TREE_PAGE);
      await show_tool("inspector");
      await markup_on_section();
      await poll_until("the section to be selected and collapsed", async () => JSON.stringify(await markup_state()) === JSON.stringify(["section", false]));
      await focus_in_devtools();
      await press_keys("f");
      await sleep(NO_EFFECT_MS);
      expect((await layers()) === 0, "f showed labels with no hint key in the table");
      await moves("l", markup_state, ["section", true], "the tree keys stay: l expands");
    } finally {
      await set_session_value(HELLO_KEY, own_hello);
      await poll_until("the hint key to come back with the module's own hello", async () => (await last_table()) === "jkhlfv/nNgJK", { timeout_ms: 5000 });
    }
  });

  await run_case("a lost ask, which a busy or restarted background never answers, drops the letters for its time and then gives them back", async () => {
    await home("bm_dt_hints_unanswered");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await poll_until("the section to be selected and collapsed", async () => JSON.stringify(await markup_state()) === JSON.stringify(["section", false]));
    await focus_in_devtools();
    // The ask goes nowhere, as when the background is busy or restarts before it reads it.
    await chrome(`(async () => { const core = Services.desertfox_browser_module; const send = core.send; Services.desertfox_key_test_send = send; core.send = (kind, ...rest) => (kind === "devtools_hints.ask" ? { ok: true, id: "dropped" } : send(kind, ...rest)); })()`);
    try {
      await press_keys("f");
      await stays(["l"], markup_state, "l right after f is dropped");
      await sleep(2000);
      expect((await layers()) === 0, "labels showed with no answer");
      await moves("l", markup_state, ["section", true], "after the ask's time l expands again");
    } finally {
      await chrome(`(async () => { Services.desertfox_browser_module.send = Services.desertfox_key_test_send; delete Services.desertfox_key_test_send; })()`);
    }
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

  // ---- Tool keys.

  const tools_now = () => chrome(`(async () => { ${TOOLBOX} return [tb.currentToolId, tb.component.panelDefinitions.map((tool) => tool.id)]; })()`);
  // The chord the module sends for gt and gT, sent here from chrome code on the focused element, so the case measures that DevTools takes it from where the focus is.
  const SEND_CHORD = (key, code, key_code) => `(async () => { ${TOOLBOX} const el = tb.getPanel("inspector").markup.doc.querySelector(".tag-line"); const view = el.ownerDocument.defaultView; el.dispatchEvent(new view.KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, keyCode: ${key_code}, ctrlKey: true, bubbles: true, cancelable: true, composed: true })); return el.localName + " in " + el.ownerDocument.documentURI; })()`;
  // Moves the toolbox to a window of its own for `body`, and docks it again after, also when `body` fails, so no later case opens as a window. A toolbox that is a window already is docked first, since switchHost gives null for the host it has.
  async function in_devtools_window(body) {
    await chrome(`(async () => { ${TOOLBOX} if (tb.hostType !== "bottom") await tb.switchHost("bottom"); })()`);
    await show_tool("inspector");
    await markup_on_section();
    const windows_before = (await module_status()).windows;
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_host = tb.switchHost("window").then(() => "window", (error) => String(error)); })()`);
    try {
      await poll_until("the DevTools window to get the module", async () => (await module_status()).windows === windows_before + 1, { timeout_ms: 10000 });
      await poll_until("the Inspector in the DevTools window", () => chrome(`(async () => { ${TOOLBOX} return tb.hostType === "window" && !!tb.getPanel("inspector")?.markup; })()`), { timeout_ms: 10000 });
      await chrome(`(async () => { ${TOOLBOX} tb.win.top.focus(); })()`);
      await markup_on_section();
      await focus_in_devtools();
      await body();
    } finally {
      await chrome(`(async () => { ${TOOLBOX} delete Services.desertfox_key_test_host; if (tb?.hostType === "window") await tb.switchHost("bottom"); })()`);
    }
  }
  async function chord_switches(where, tool) {
    const [before, ids] = await tools_now();
    expect(before === tool, `${where}: the tool is ${before}, not ${tool}`);
    const next = ids[(ids.indexOf(before) + 1) % ids.length];
    const at = await chrome(SEND_CHORD("]", "BracketRight", 221));
    await poll_until(`${where}: Ctrl+] from ${at} to select ${next}`, async () => (await tools_now())[0] === next, { timeout_ms: 3000 });
    await chrome(SEND_CHORD("[", "BracketLeft", 219));
    await poll_until(`${where}: Ctrl+[ to select ${before} again`, async () => (await tools_now())[0] === before, { timeout_ms: 3000 });
  }

  await run_case("a synthetic Ctrl+] and Ctrl+[ from the focused element switch the tool, from the markup frame, two frames down, and from a DevTools window", async () => {
    await home("bm_dt_chord");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    await chord_switches("the markup frame", "inspector");
    await in_devtools_window(() => chord_switches("the markup frame of a DevTools window", "inspector"));
  });

  await run_case("gt and gT switch to the next and previous tool and wrap, a hold that ends or a key between sends nothing, and g types in the console input", async () => {
    await home("bm_dt_tool_keys");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    const [, ids] = await tools_now();
    const tool_at = async (offset) => ids[(ids.indexOf((await tools_now())[0]) + offset + ids.length) % ids.length];
    const next = await tool_at(1);
    await moves(["g", "t"], async () => (await tools_now())[0], next, "gt selects the next tool");
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    const previous = await tool_at(-1);
    await moves(["g", "T"], async () => (await tools_now())[0], previous, "gT selects the previous tool, wrapping from the first");
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    await stays(["t", "T"], async () => (await tools_now())[0], "t and T with no g before them");
    await stays(["g", "x", "t"], async () => (await tools_now())[0], "g x t: a key between ends the hold");
    // Ctrl+t is Firefox's new tab, so the case keeps the tab it has and closes the new one.
    await chrome(`(async () => { Services.desertfox_key_test_tab = ${W}.gBrowser.selectedTab; })()`);
    await press_keys("g", "-M", "ctrl", "t", "-m", "ctrl");
    await sleep(NO_EFFECT_MS);
    await chrome(`(async () => { const w = ${W}; const own = Services.desertfox_key_test_tab; delete Services.desertfox_key_test_tab; if (w.gBrowser.selectedTab !== own) { w.gBrowser.removeTab(w.gBrowser.selectedTab); w.gBrowser.selectedTab = own; } })()`);
    expect((await tools_now())[0] === "inspector", "g then Ctrl+t switched the tool");
    await markup_on_section();
    await focus_in_devtools();
    // The console input is a field: g and t type there.
    await press_keys("-k", "Escape");
    await poll_until("Escape to open the split console", () => chrome(`(async () => { ${TOOLBOX} return tb.splitConsole === true && !!tb.getPanel("webconsole")?.hud; })()`), { timeout_ms: 5000 });
    const console_text = () => chrome(`(async () => { ${TOOLBOX} return tb.getPanel("webconsole").hud.ui.outputNode.ownerDocument.querySelector(".jsterm-input-container")?.textContent ?? null; })()`);
    await chrome(`(async () => { ${TOOLBOX} const hud = tb.getPanel("webconsole").hud; hud.ui.outputNode.ownerDocument.defaultView.focus(); hud.ui.jsterm.focus(); })()`);
    await press_keys("g", "t");
    await poll_until("gt to type into the console input", async () => (await console_text())?.includes("gt"), { timeout_ms: 3000 });
    expect((await tools_now())[0] === "inspector", "gt in the console input switched the tool");
    await chrome(`(async () => { ${TOOLBOX} await tb.closeSplitConsole(); })()`);
  });

  await run_case("gt, gT, J and K work in a DevTools window too", async () => {
    await home("bm_dt_tool_keys_window");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await in_devtools_window(async () => {
      const [, ids] = await tools_now();
      await moves(["g", "t"], async () => (await tools_now())[0], ids[1 % ids.length], "gt in a DevTools window");
      await moves(["g", "T"], async () => (await tools_now())[0], ids[0], "gT in a DevTools window");
      // The window has no tab browser, so J acts on the newest browser window, which then selects another tab. K comes back before the next step reads the toolbox through the selected tab.
      await switches_one("J in a DevTools window");
      await switches_one("K in a DevTools window", ["K"]);
    });
  });
  // ---- The command line key.

  // The command line panel of whichever window holds it, with the window's type.
  const panel_now = () =>
    chrome(`(async () => {
      for (const w of Services.wm.getEnumerator(null)) {
        const panel = w.document.getElementById("desertfox-cmdline-panel");
        if (!panel) continue;
        const rect = panel.getOuterScreenRect();
        const own = w.document.documentElement.getAttribute("windowtype");
        return { state: panel.state, window: own, url: panel.querySelector("browser")?.currentURI?.spec ?? null, bottom: rect.y + rect.height, scale: w.devicePixelRatio, window_bottom: (w.mozInnerScreenY + w.innerHeight) * w.devicePixelRatio, page_bottom: (w.mozInnerScreenY + w.gBrowser.selectedBrowser.getBoundingClientRect().bottom) * w.devicePixelRatio, focused: Services.focus.focusedElement === panel.querySelector("browser") };
      }
      return null;
    })()`);
  const panel_closed = (what) => poll_until(`${what} to close the command line panel`, async () => (await panel_now()) === null, { timeout_ms: 5000 });
  const marked_markup_element = () => chrome(`(async () => { ${TOOLBOX} const doc = tb.getPanel("inspector").markup.doc; Services.desertfox_key_test_focus = doc.activeElement; return !!doc.activeElement; })()`);
  const markup_element_has_focus = () => chrome(`(async () => { ${TOOLBOX} const doc = tb.getPanel("inspector").markup.doc; return !!Services.desertfox_key_test_focus && doc.activeElement === Services.desertfox_key_test_focus && Services.focus.focusedWindow === doc.defaultView; })()`);
  // The module does not say the `c` feature yet (the packed hello field comes with #1073), so the case writes the hello it will say, and the extension pushes the row.
  async function with_cmdline_hello(body) {
    const HELLO_KEY = "desertfox_browser_module_hello";
    const own_hello = await session_value(HELLO_KEY);
    try {
      await set_session_value(HELLO_KEY, { ...own_hello, f: "c" });
      await poll_until("the extension to push the : row", async () => (((await session_value("desertfox_browser_module_from_extension")) ?? []).filter((message) => message.kind === "devtools.keys").at(-1)?.args.keys ?? []).some(({ key }) => key === ":"), { timeout_ms: 5000 });
      await body();
    } finally {
      await set_session_value(HELLO_KEY, own_hello);
    }
  }
  async function colon_opens_line(where, window_type) {
    expect(await marked_markup_element(), `${where}: no markup element holds the focus`);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_focus; for (const w of Services.wm.getEnumerator(null)) w.document.getElementById("desertfox-cmdline-panel")?.hidePopup?.(); })()`));
    await press_keys(":");
    await poll_until(`${where}: : to open the command line panel`, async () => {
      const shown = await panel_now();
      return shown?.state === "open" && /\/cmdline\.html\?panel=[0-9a-f-]{36}$/.test(shown.url ?? "") && shown.focused;
    }, { timeout_ms: 8000 }).catch(async (error) => {
      const asked = ((await session_value("desertfox_browser_module_from_module")) ?? []).filter((message) => /devtools_cmdline|cmdline_panel/.test(message.kind ?? "") || "reply_to" in message).slice(-4);
            throw new Error(`${error.message} (panel ${JSON.stringify(await panel_now())}, messages ${JSON.stringify(asked)}, module ${JSON.stringify((await module_status())?.errors)})`);
    });
    const shown = await panel_now();
    expect(shown.window === window_type, `${where}: the panel is in a window of type ${shown.window}, not ${window_type}`);
    // The panel sits below the page area, over the docked toolbox, and near the window's bottom (the module's status bar takes a strip there).
    expect(shown.bottom > shown.page_bottom + 20 * shown.scale && shown.window_bottom - shown.bottom <= 40 * shown.scale, `${where}: the panel ends at ${shown.bottom}, the page at ${shown.page_bottom}, the window at ${shown.window_bottom}`);
    await press_keys("-k", "Escape");
    await panel_closed(`${where}: Escape`);
    await poll_until(`${where}: the focus to return to the element that had it`, markup_element_has_focus, { timeout_ms: 3000 });
  }

  await run_case(": opens the command line over the inspected tab in a docked toolbox, Escape returns the focus to the markup, and : types in the console input", async () => {
    await home("bm_dt_cmdline");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await markup_on_section();
    await focus_in_devtools();
    await with_cmdline_hello(async () => {
    await colon_opens_line("docked", "navigator:browser");
    await press_keys("-k", "Escape");
    await poll_until("Escape to open the split console", () => chrome(`(async () => { ${TOOLBOX} return tb.splitConsole === true && !!tb.getPanel("webconsole")?.hud; })()`), { timeout_ms: 5000 });
    const console_text = () => chrome(`(async () => { ${TOOLBOX} return tb.getPanel("webconsole").hud.ui.outputNode.ownerDocument.querySelector(".jsterm-input-container")?.textContent ?? null; })()`);
    await chrome(`(async () => { ${TOOLBOX} const hud = tb.getPanel("webconsole").hud; hud.ui.outputNode.ownerDocument.defaultView.focus(); hud.ui.jsterm.focus(); })()`);
    await press_keys(":");
    await poll_until(": to type into the console input", async () => (await console_text())?.includes(":"), { timeout_ms: 3000 });
    await sleep(NO_EFFECT_MS);
    expect((await panel_now()) === null, ": in the console input opened the command line");
    await chrome(`(async () => { ${TOOLBOX} await tb.closeSplitConsole(); })()`);
    });
  });

  await run_case(": in a DevTools window of its own opens no line and asks the extension for a notice, since nothing there names the inspected tab", async () => {
    await home("bm_dt_cmdline_window");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
    await with_cmdline_hello(() => in_devtools_window(async () => {
      const NOTICE = "The command line cannot tell which tab this DevTools inspects, so it does not open here";
      const notices = async () => Object.values((await in_background(`browser.notifications.getAll()`)) ?? {}).map((notice) => notice.message);
      await clear_notices();
      on_teardown(clear_notices);
      const asks_before = (((await session_value("desertfox_browser_module_from_module")) ?? []).filter((message) => message.kind === "devtools_cmdline.ask")).length;
      await press_keys(":");
      await poll_until("the ask without a tab to reach the extension", async () => {
        const asks = ((await session_value("desertfox_browser_module_from_module")) ?? []).filter((message) => message.kind === "devtools_cmdline.ask");
        return asks.length === asks_before + 1 && asks.at(-1).args.tab_id === undefined;
      }, { timeout_ms: 5000 });
      // A desktop notice, since the tab in front sits behind the DevTools window.
      await poll_until("the notice that the line does not open from this DevTools window", async () => (await notices()).includes(NOTICE), { timeout_ms: 5000 });
      expect((await panel_now()) === null, ": in a DevTools window opened the command line");
    }));
  });
  await run_case(": in a toolbox opened as a tab opens the command line in that window, for the tab the toolbox inspects", async () => {
    await home("bm_dt_cmdline_tab_toolbox");
    await open_tab(TREE_PAGE);
    const target_id = await chrome(`(async () => ${W}.gBrowser.selectedBrowser.browserId)()`);
    on_teardown(() => chrome(`(async () => { ${DT} const w = ${W}; for (const tb of gDevTools.getToolboxes()) await tb.destroy(); w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); w.focus(); w.gBrowser.selectedBrowser.focus(); for (const win of Services.wm.getEnumerator(null)) win.document.getElementById("desertfox-cmdline-panel")?.hidePopup?.(); })()`));
    await open_tab(`about:devtools-toolbox?type=tab&id=${target_id}`, { wait_load: false });
    const TAB_TOOLBOX = `${DT} const tb = gDevTools.getToolboxes().find((one) => one.hostType === "page");`;
    await poll_until("the toolbox in its own tab to show the Inspector", () => chrome(`(async () => { ${TAB_TOOLBOX} if (!tb?.isReady) return false; if (tb.currentToolId !== "inspector") { tb.selectTool("inspector"); return false; } return !!tb.getPanel("inspector")?.markup; })()`), { timeout_ms: 20000 });
    await poll_until("the section to have a markup container", () =>
      chrome(`(async () => {
        ${TAB_TOOLBOX}
        const inspector = tb.getPanel("inspector");
        const node = await inspector.walker.querySelector(inspector.walker.rootNode, "section");
        await inspector.selection.setNodeFront(node, { reason: "test" });
        if (!inspector.markup.getContainer(node)) return false;
        await inspector.markup.collapseNode(node);
        ${W}.focus();
        inspector.markup.doc.defaultView.focus();
        inspector.markup.getContainer(node).focus();
        return true;
      })()`),
    { timeout_ms: 10000 });
    await poll_until("the focus to be in the toolbox tab", async () => /^(about:devtools-toolbox|chrome:\/\/devtools\/)/.test(await chrome(`(async () => String(Services.focus.focusedWindow?.location?.href ?? ""))()`)), { timeout_ms: 5000 });
    await with_cmdline_hello(async () => {
      await press_keys(":");
      await poll_until(": in the toolbox tab to open the command line panel", async () => {
        const shown = await panel_now();
        return shown?.state === "open" && /\/cmdline\.html\?panel=[0-9a-f-]{36}$/.test(shown.url ?? "") && shown.focused;
      }, { timeout_ms: 8000 });
      expect((await panel_now()).window === "navigator:browser", "the panel is not in the browser window");
      await press_keys("-k", "Escape");
      await panel_closed("Escape");
    });
  });
}
