// The browser module's visual mode in DevTools: v selects in a text area, the mode's keys extend the selection, y copies it, Escape ends the mode.
// Text areas: the console output, the rule view, the Network headers and the markup view. Code areas: the Debugger source and the Network response. Docked and in a DevTools window.
// Also what it leaves alone: v in the console input types there, a module whose hello does not say devtools_visual gets no v, and the tree keys work after the mode.
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const DT = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;
const TOOLBOX = `${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab);`;
// A trusted mouse press on an element, as a user's click, so the focus moves through every frame on the way.
const CLICK = `const click = (element, dx = 8) => { const box = element.getBoundingClientRect(); const view = element.ownerDocument.defaultView; for (const [type, buttons] of [["mousedown", 1], ["mouseup", 0]]) view.synthesizeMouseEvent(type, box.left + Math.min(box.width / 2, dx), box.top + box.height / 2, { button: 0, buttons, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false }); };`;
const SENTINEL = "desertfox visual sentinel";
const CLIPBOARD = `const read_clipboard = () => { const transfer = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable); transfer.init(null); transfer.addDataFlavor("text/plain"); Services.clipboard.getData(transfer, Services.clipboard.kGlobalClipboard, null); const data = {}; try { transfer.getTransferData("text/plain", data); } catch (_) { return ""; } return data.value.QueryInterface(Ci.nsISupportsString).data; };`;
const LOG_PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>log</title><p>log</p><script>console.log('alpha beta gamma')</script>")}`;
const RULE_PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>rules</title><style>#target { color: red; margin: 0px; padding: 1px; }</style><main><p id='target'>styled</p></main>")}`;
const TREE_PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>tree</title><main><section><p>one</p><p>two</p></section><p>three</p></main>")}`;
// The focus a hint label of an area gives (`focus` in desertfox-devtools.js): the area itself when it takes the focus, else the first element in it that does, else none, so the field that had it lets it go.
const AREA_FOCUS = `const focus_area = (element) => { const doc = element.ownerDocument; doc.defaultView.focus(); const focusable = "[tabindex], [contenteditable=true], input, textarea, select, button"; const target = element.matches(focusable) ? element : element.querySelector(focusable); if (target) target.focus(); else doc.activeElement?.blur(); };`;
const FOCUS = `(async () => { const el = Services.focus.focusedElement; return String(Services.focus.focusedWindow?.location?.href) + " " + (el ? el.localName + "." + el.className : "no element"); })()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, sleep } = context;
  const steps = module_steps(context);
  const { chrome, session_value, set_session_value, module_status, home, open_tab, in_selected_page } = steps;

  await setup("turn the module on", () => steps.turn_on_module());

  async function show_tool(tool) {
    on_teardown(() => chrome(`(async () => { ${DT} const w = ${W}; for (const tab of w.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); delete Services.desertfox_key_test_toolbox; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); w.focus(); w.gBrowser.selectedBrowser.focus(); })()`));
    await chrome(`(async () => { ${DT} Services.desertfox_key_test_toolbox = gDevTools.showToolboxForTab(${W}.gBrowser.selectedTab, { toolId: ${JSON.stringify(tool)} }).then(() => "open", (error) => String(error)); })()`);
    await poll_until(`the ${tool} panel to open`, () => chrome(`(async () => { ${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab); return tb?.currentToolId === ${JSON.stringify(tool)} && !!tb.getPanel(${JSON.stringify(tool)}); })()`), { timeout_ms: 15000 });
  }
  const focus_in_devtools = async () => {
    const href = await chrome(`(async () => String(Services.focus.focusedWindow?.location?.href ?? ""))()`);
    expect(/^(about:devtools-toolbox|chrome:\/\/devtools\/)/.test(href), `the focus is not in DevTools: ${href}`);
  };
  const set_clipboard = () => chrome(`(async () => { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(${JSON.stringify(SENTINEL)}); })()`);
  const clipboard = () => chrome(`(async () => { ${CLIPBOARD} return read_clipboard(); })()`);
  // Waits for y to put something new on the clipboard and gives it.
  async function copied(what) {
    await poll_until(`${what}: y to copy`, async () => (await clipboard()) !== SENTINEL, { timeout_ms: 3000 }).catch(async (error) => {
      throw new Error(`${error.message} (focus ${await chrome(FOCUS)}, module ${JSON.stringify((await module_status())?.errors)})`);
    });
    return clipboard();
  }
  // The selection of the panel document that holds `area` (chrome code that sets `doc`), as text, with whether its focus sits inside the area.
  const selection_of = (panel, area) => chrome(`(async () => { ${TOOLBOX} ${panel} const selection = doc.defaultView.getSelection(); const root = doc.querySelector(${JSON.stringify(area)}); return { text: selection.toString(), collapsed: selection.isCollapsed, inside: !!root?.contains(selection.focusNode) }; })()`);
  // Presses `keys` and waits until the panel selection reads non-empty.
  async function selects(keys, panel, area, what) {
    await press_keys(...keys);
    await poll_until(`${what}: ${keys.join(" ")} to select`, async () => (await selection_of(panel, area)).text.length > 0, { timeout_ms: 3000 }).catch(async (error) => {
      throw new Error(`${error.message} (focus ${await chrome(FOCUS)}, module ${JSON.stringify((await module_status())?.errors)})`);
    });
  }

  const CONSOLE = `const doc = tb.getPanel("webconsole").hud.ui.outputNode.ownerDocument;`;
  async function console_output(what) {
    await poll_until(`${what}: the console to show the log line`, () => chrome(`(async () => { ${TOOLBOX} ${CONSOLE} return [...doc.querySelectorAll(".webconsole-output .message-body")].some((body) => body.textContent.includes("alpha beta gamma")); })()`), { timeout_ms: 10000 });
    // A click in the output moves the focus to the console input, so the user reaches the output with its hint label. The output takes no focus, so the console's document keeps it.
    // The console focuses its input a moment after it opens, so the label's focus is given until it stays.
    await poll_until(`${what}: the focus to leave the console input`, async () => {
      await chrome(`(async () => { ${TOOLBOX} ${CONSOLE} ${AREA_FOCUS} focus_area(doc.querySelector(".webconsole-output")); })()`);
      await sleep(200);
      return chrome(`(async () => { ${TOOLBOX} ${CONSOLE} return doc.activeElement === doc.body || !!doc.querySelector(".webconsole-output")?.contains(doc.activeElement); })()`);
    }, { timeout_ms: 5000 });
    await focus_in_devtools();
  }

  await run_case("docked console output: v selects, w extends a word, y copies it and ends the mode", async () => {
    await home("bm_dv_console");
    await open_tab(LOG_PAGE);
    await show_tool("webconsole");
    await console_output("docked");
    await set_clipboard();
    await selects(["v", "w"], CONSOLE, ".webconsole-output", "the console output");
    await press_keys("y");
    const text = await copied("the console output");
    expect(text === "alpha", `the copy is ${JSON.stringify(text)}, not the first word`);
    // The mode ended, so w no longer extends.
    const before = await selection_of(CONSOLE, ".webconsole-output");
    await press_keys("w");
    await sleep(NO_EFFECT_MS);
    expect(JSON.stringify(await selection_of(CONSOLE, ".webconsole-output")) === JSON.stringify(before), "w still extended after y");
  });

  await run_case("v in the console input types there and starts no mode", async () => {
    await home("bm_dv_input");
    await open_tab(LOG_PAGE);
    await show_tool("webconsole");
    await chrome(`(async () => { ${TOOLBOX} const hud = tb.getPanel("webconsole").hud; hud.ui.outputNode.ownerDocument.defaultView.focus(); hud.ui.jsterm.focus(); })()`);
    await press_keys("v", "w", "y");
    await poll_until("vwy to type into the console input", () => chrome(`(async () => { ${TOOLBOX} ${CONSOLE} return doc.querySelector(".jsterm-input-container")?.textContent.includes("vwy"); })()`), { timeout_ms: 3000 });
  });

  const INSPECTOR = `const doc = tb.getPanel("inspector").panelDoc;`;
  async function rule_view(what) {
    await poll_until(`${what}: the rule view to show #target's rule`, () =>
      chrome(`(async () => {
        ${TOOLBOX}
        const inspector = tb.getPanel("inspector");
        const node = await inspector.walker.querySelector(inspector.walker.rootNode, "#target");
        await inspector.selection.setNodeFront(node, { reason: "test" });
        return [...inspector.panelDoc.querySelectorAll("#ruleview-container .ruleview-rule")].some((rule) => rule.textContent.includes("padding"));
      })()`), { timeout_ms: 10000 });
    // A click on a rule opens an editor, so the user reaches the rule view with its hint label.
    await chrome(`(async () => { ${TOOLBOX} ${INSPECTOR} ${AREA_FOCUS} focus_area(doc.querySelector("#ruleview-container")); })()`);
    await focus_in_devtools();
  }

  await run_case("docked rule view: v and j select whole lines, j past the end stays inside the rule view, y copies, and Escape then ends a new mode without the split console", async () => {
    await home("bm_dv_rules");
    await open_tab(RULE_PAGE);
    await show_tool("inspector");
    await rule_view("docked");
    await set_clipboard();
    await selects(["v", "j"], INSPECTOR, "#ruleview-container", "the rule view");
    await press_keys(..."jjjjjjjjjjjjjjjjjjjj".split(""));
    await sleep(300);
    const held = await selection_of(INSPECTOR, "#ruleview-container");
    expect(held.inside, `the selection left the rule view: ${JSON.stringify(held)}`);
    await press_keys("y");
    const text = await copied("the rule view");
    expect(text.includes("color") && text.includes("padding"), `the copy misses the rule: ${JSON.stringify(text)}`);
    // Escape ends the mode and drops the selection, and DevTools never sees it.
    await selects(["v", "w"], INSPECTOR, "#ruleview-container", "the rule view again");
    await press_keys("-k", "Escape");
    await poll_until("Escape to drop the selection", async () => (await selection_of(INSPECTOR, "#ruleview-container")).collapsed, { timeout_ms: 3000 });
    await sleep(NO_EFFECT_MS);
    expect(!(await chrome(`(async () => { ${TOOLBOX} return tb.splitConsole; })()`)), "Escape opened the split console");
  });

  const MARKUP = `const doc = tb.getPanel("inspector").markup.doc;`;
  const markup_state = () =>
    chrome(`(async () => { ${TOOLBOX} const inspector = tb.getPanel("inspector"); const node = inspector.selection.nodeFront; return [node?.displayName ?? null, inspector.markup.getContainer(node)?.expanded ?? null]; })()`);

  await run_case("docked markup view: v and w select a word of a tag, y copies it, and after the mode j moves the tree again", async () => {
    await home("bm_dv_markup");
    await open_tab(TREE_PAGE);
    await show_tool("inspector");
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
    await focus_in_devtools();
    await set_clipboard();
    await selects(["v", "w"], MARKUP, "#root", "the markup view");
    await press_keys("y");
    const text = await copied("the markup view");
    expect(text.length > 0 && text.length < 20 && "<section>".includes(text.trim()), `the copy is not a word of the section tag: ${JSON.stringify(text)}`);
    expect(JSON.stringify(await markup_state()) === JSON.stringify(["section", false]), `the mode's keys moved the tree: ${JSON.stringify(await markup_state())}`);
    await press_keys("j");
    await poll_until("j after the mode to move the tree", async () => (await markup_state())[0] === "p", { timeout_ms: 3000 });
  });

  await run_case("docked Network headers: v, w and y copy from the headers panel", async () => {
    await home("bm_dv_network");
    await open_tab(RULE_PAGE);
    await show_tool("netmonitor");
    await in_selected_page(`(win) => { win.fetch(${JSON.stringify(context.url_of("missing", "bm_dv_network"))}).catch(() => undefined); return true; }`);
    const NETWORK = `const doc = tb.getPanel("netmonitor").panelWin.document;`;
    await poll_until("a request row", () => chrome(`(async () => { ${TOOLBOX} ${NETWORK} return doc.querySelectorAll(".request-list-item").length >= 1; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} ${NETWORK} [...doc.querySelectorAll(".request-list-item")].at(-1).click(); })()`);
    await poll_until("the headers panel", () => chrome(`(async () => { ${TOOLBOX} ${NETWORK} return !!doc.querySelector("#headers-panel .treeTable, #headers-panel [role=tree], #headers-panel .tree-container"); })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} ${NETWORK} ${CLICK} const row = doc.querySelector("#headers-panel .treeRow, #headers-panel [role=treeitem]"); click(row, 40); })()`);
    await focus_in_devtools();
    await set_clipboard();
    await selects(["v", "w", "w"], NETWORK, "#headers-panel", "the headers panel");
    await press_keys("y");
    const text = await copied("the headers panel");
    const shown = (await selection_of(NETWORK, "#headers-panel")).text;
    expect(text.length > 0 && text === shown, `the copy ${JSON.stringify(text)} is not the selection ${JSON.stringify(shown)}`);
  });

  await run_case("docked Network response: v and l select through CodeMirror's own selection, and y copies it", async () => {
    await home("bm_dv_response");
    await open_tab(RULE_PAGE);
    await show_tool("netmonitor");
    const text_url = new URL("/captions.vtt", context.url_of("page", "bm_dv_response")).href;
    await in_selected_page(`(win) => { win.fetch(${JSON.stringify(text_url)}).catch(() => undefined); return true; }`);
    const NETWORK = `const doc = tb.getPanel("netmonitor").panelWin.document;`;
    await poll_until("the text request row", () => chrome(`(async () => { ${TOOLBOX} ${NETWORK} return [...doc.querySelectorAll(".request-list-item")].some((row) => row.textContent.includes("captions.vtt")); })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} ${NETWORK} [...doc.querySelectorAll(".request-list-item")].find((row) => row.textContent.includes("captions.vtt")).click(); })()`);
    await poll_until("the Response tab", () => chrome(`(async () => { ${TOOLBOX} ${NETWORK} const tab = doc.querySelector("#response-tab"); tab?.click(); return !!tab; })()`), { timeout_ms: 10000 });
    await poll_until("the response in the editor", () => chrome(`(async () => { ${TOOLBOX} ${NETWORK} return doc.querySelector("#response-panel .cm-content")?.textContent.includes("WEBVTT") ?? false; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} ${NETWORK} doc.defaultView.focus(); doc.querySelector("#response-panel .cm-content").focus(); })()`);
    await focus_in_devtools();
    await set_clipboard();
    await press_keys("v", "l", "l", "y");
    const text = await copied("the Network response");
    expect(text === "WEB", `the copy is ${JSON.stringify(text)}, not the first three characters`);
  });

  await run_case("a DevTools window of its own: v, w and y copy from the console output there", async () => {
    await home("bm_dv_window");
    await open_tab(LOG_PAGE);
    await show_tool("webconsole");
    const windows_before = (await module_status()).windows;
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_host = tb.switchHost("window").then(() => "window", (error) => String(error)); })()`);
    on_teardown(() => chrome(`(async () => { ${TOOLBOX} delete Services.desertfox_key_test_host; if (tb?.hostType === "window") await tb.switchHost("bottom"); })()`));
    await poll_until("the DevTools window to get the module", async () => (await module_status()).windows === windows_before + 1, { timeout_ms: 10000 });
    await poll_until("the console in the DevTools window", () => chrome(`(async () => { ${TOOLBOX} return tb.hostType === "window" && !!tb.getPanel("webconsole")?.hud; })()`), { timeout_ms: 10000 });
    await chrome(`(async () => { ${TOOLBOX} tb.win.top.focus(); })()`);
    await console_output("DevTools window");
    await set_clipboard();
    await selects(["v", "w"], CONSOLE, ".webconsole-output", "the console output in a window");
    await press_keys("y");
    const text = await copied("the console output in a window");
    expect(text === "alpha", `the copy is ${JSON.stringify(text)}, not the first word`);
  });

  await run_case("a module whose hello does not say devtools_visual gets no v row, so v stays DevTools' and the tree keys stay", async () => {
    await home("bm_dv_flag");
    const HELLO_KEY = "desertfox_browser_module_hello";
    const own_hello = await session_value(HELLO_KEY);
    expect(own_hello?.devtools_visual === true, `the module's hello lacks devtools_visual: ${JSON.stringify(own_hello)}`);
    const last_table = async () => ((await session_value("desertfox_browser_module_from_extension")) ?? []).filter((message) => message.kind === "devtools.keys").at(-1)?.args.keys.map(({ key }) => key).join("");
    try {
      await set_session_value(HELLO_KEY, Object.fromEntries(Object.entries(own_hello).filter(([name]) => name !== "devtools_visual")));
      await poll_until("the extension to push the table without v", async () => (await last_table()) === "jkhlf", { timeout_ms: 5000 });
      await open_tab(RULE_PAGE);
      await show_tool("inspector");
      await rule_view("flag off");
      // DevTools gets v: the module took no key, so the rule view's own document sees it.
      await chrome(`(async () => { ${TOOLBOX} ${INSPECTOR} const seen = (Services.desertfox_key_test_keys = []); const listener = (event) => seen.push(event.key); doc.addEventListener("keydown", listener); Services.desertfox_key_test_keys_off = () => doc.removeEventListener("keydown", listener); })()`);
      on_teardown(() => chrome(`(async () => { Services.desertfox_key_test_keys_off?.(); delete Services.desertfox_key_test_keys_off; delete Services.desertfox_key_test_keys; })()`));
      await press_keys("v", "w", "w");
      await poll_until("v to reach the rule view", () => chrome(`(async () => Services.desertfox_key_test_keys.includes("v"))()`), { timeout_ms: 3000 });
      await sleep(NO_EFFECT_MS);
      const selection = await selection_of(INSPECTOR, "#ruleview-container");
      expect(selection.text === "", `v started the mode with no v row: ${JSON.stringify(selection)}`);
    } finally {
      await set_session_value(HELLO_KEY, own_hello);
      await poll_until("v to come back with the module's own hello", async () => (await last_table()) === "jkhlfv", { timeout_ms: 5000 });
    }
  });

  // Last: after the Debugger, no test page of the next case took the focus (measured).
  await run_case("docked Debugger source: v and j three times copy four lines through CodeMirror's own selection", async () => {
    await home("bm_dv_debugger");
    // The Debugger lists no data: source under a host, so this page comes from the test server under another site name.
    const url = context.url_of("page", "bm_dv_debugger_source").replace("127.0.0.1", "localhost");
    await open_tab(url);
    await show_tool("jsdebugger");
    const SOURCE = `const doc = tb.getPanel("jsdebugger").panelWin.document;`;
    await chrome(`(async () => { ${TOOLBOX} Services.desertfox_key_test_source = tb.viewSourceInDebugger(${JSON.stringify(url)}, 1, 0).then(() => "shown", (error) => String(error)); })()`);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_source; })()`));
    await poll_until("the page's source in the editor", () => chrome(`(async () => { ${TOOLBOX} ${SOURCE} return doc.querySelector(".editor-mount .cm-content")?.textContent.includes("doctype") ?? false; })()`), { timeout_ms: 15000 });
    await chrome(`(async () => { ${TOOLBOX} ${SOURCE} doc.defaultView.focus(); doc.querySelector(".editor-mount .cm-content").focus(); })()`);
    await focus_in_devtools();
    await set_clipboard();
    await press_keys("v", "j", "j", "j", "y");
    const text = await copied("the Debugger source");
    expect(text.includes("doctype html>") && text.split("\n").length === 4, `the copy is not the first four lines: ${JSON.stringify(text.slice(0, 300))}`);
    // The copy keeps its selection in view, and the next v starts again from one character instead of extending it.
    await set_clipboard();
    await press_keys("v", "y");
    const again = await copied("the Debugger source again");
    expect(again.length === 1, `the next v did not start with one character: ${JSON.stringify(again.slice(0, 300))}`);
    // h takes the selection back to empty, and y then copies nothing: CodeMirror would copy the whole line. The v and y after it prove the keys arrived.
    await set_clipboard();
    await press_keys("v", "h", "y");
    await sleep(NO_EFFECT_MS);
    const kept = await clipboard();
    expect(kept === SENTINEL, `y with an empty selection copied ${JSON.stringify(kept.slice(0, 300))}`);
    await press_keys("v", "y");
    const after = await copied("the Debugger source after the empty copy");
    expect(after.length === 1, `v after the empty copy did not select one character: ${JSON.stringify(after.slice(0, 300))}`);
  });
}
