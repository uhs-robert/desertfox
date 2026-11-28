// The browser module's Inspector search keys, with the private Firefox.
// Search: `/` focuses the Search HTML box, `n` and `N` press DevTools' own match buttons, in the box's place and after it lost the focus, and Escape in the box keeps its text and selects the node of before `/` again.
// Also each way the kept node goes: a click that focused the box, the box losing the focus, the node gone from the page, the page reloaded and the module pref turned off and on.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const DT = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;
const TOOLBOX = `${DT} const tb = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab);`;
const INSPECTOR = `${TOOLBOX} const inspector = tb.getPanel("inspector"); const box = inspector.panelDoc.getElementById("inspector-searchbox");`;
// A trusted mouse press on an element's middle, as a user's click, so the focus moves through every frame on the way.
const CLICK = `const click = (element) => { const r = element.getBoundingClientRect(); const view = element.ownerDocument.defaultView; for (const [type, buttons] of [["mousedown", 1], ["mouseup", 0]]) view.synthesizeMouseEvent(type, r.left + Math.min(r.width / 2, 40), r.top + r.height / 2, { button: 0, buttons, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false }); };`;
const PAGE = `data:text/html,${encodeURIComponent("<!doctype html><title>search</title><main><section id='sec'><p>one</p></section><p class='hit' id='h1'>a</p><p class='hit' id='h2'>b</p></main>")}`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, sleep } = context;
  const steps = module_steps(context);
  const { chrome, module_status, set_pref, home, open_tab, in_selected_page } = steps;

  await setup("turn the module on", () => steps.turn_on_module());

  async function show_tool(tool) {
    on_teardown(() => chrome(`(async () => { ${DT} const w = ${W}; for (const tab of w.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); delete Services.desertfox_key_test_toolbox; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); w.focus(); w.gBrowser.selectedBrowser.focus(); })()`));
    await chrome(`(async () => { ${DT} Services.desertfox_key_test_toolbox = gDevTools.showToolboxForTab(${W}.gBrowser.selectedTab, { toolId: ${JSON.stringify(tool)} }).then(() => "open", (error) => String(error)); })()`);
    await poll_until(`the ${tool} panel to open`, () => chrome(`(async () => { ${TOOLBOX} return tb?.currentToolId === ${JSON.stringify(tool)} && !!tb.getPanel(${JSON.stringify(tool)}); })()`), { timeout_ms: 15000 });
  }
  const focused = () =>
    chrome(`(async () => { const el = Services.focus.focusedElement; const url = String(Services.focus.focusedWindow?.document?.documentURI ?? ""); return { url: url.replace(/^.*\\//, ""), id: el?.id ?? "", in_console_input: !!el?.closest?.(".jsterm-input-container") }; })()`);
  const where = async () => JSON.stringify(await focused());
  const errors = async () => (await module_status())?.errors ?? [];
  const expect_no_errors = async (what) => {
    const found = await errors();
    expect(found.length === 0, `${what}: the module logged ${JSON.stringify(found)}`);
  };

  // ---- Inspector search.
  const selected = () => chrome(`(async () => { ${INSPECTOR} return inspector.selection.nodeFront?.getAttribute("id") ?? inspector.selection.nodeFront?.displayName ?? null; })()`);
  const box_value = () => chrome(`(async () => { ${INSPECTOR} return box.value; })()`);
  const split_open = () => chrome(`(async () => { ${TOOLBOX} return tb.splitConsole; })()`);
  async function select_in_markup(id) {
    await poll_until(`#${id} to have a markup container`, () =>
      chrome(`(async () => {
        ${INSPECTOR}
        const node = await inspector.walker.querySelector(inspector.walker.rootNode, "#${id}");
        if (!node) return false;
        await inspector.selection.setNodeFront(node, { reason: "test" });
        const container = inspector.markup.getContainer(node);
        if (!container) return false;
        inspector.markup.doc.defaultView.focus();
        container.focus();
        return true;
      })()`),
    );
    await poll_until(`#${id} selected with the focus in the markup view`, async () => (await selected()) === id && (await focused()).url === "markup.html");
  }
  async function open_inspector(id) {
    await home(`bm_dts_${id}`);
    await open_tab(PAGE);
    await show_tool("inspector");
    await select_in_markup("sec");
  }
  async function wait_for(what, read, want) {
    await poll_until(`${what}: ${JSON.stringify(want)}`, async () => JSON.stringify(await read()) === JSON.stringify(want), { timeout_ms: 4000 }).catch(async (error) => {
      throw new Error(`${error.message} (now ${JSON.stringify(await read())}, focus ${await where()}, module ${JSON.stringify(await errors())})`);
    });
  }
  const in_box = async () => (await focused()).id === "inspector-searchbox";
  const in_markup = async () => (await focused()).url === "markup.html";
  // The query goes in from chrome: typed, it opens the suggestion popup, which one case covers on its own.
  async function search_for(query) {
    await chrome(`(async () => { ${INSPECTOR} box.value = ${JSON.stringify(query)}; })()`);
    await press_keys("-k", "Return");
    await wait_for("Enter finds the first match", selected, "h1");
    expect(await in_box(), `Enter moved the focus out of the box: ${await where()}`);
  }

  await run_case("Inspector: / focuses the search box, Escape keeps the text and selects the node of before, and n and N step the matches from the markup view", async () => {
    await open_inspector("search");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    await search_for("p.hit");
    await press_keys("-k", "Escape");
    await wait_for("Escape selects the node of before /", selected, "sec");
    await wait_for("Escape focuses the markup view", in_markup, true);
    expect((await box_value()) === "p.hit", `Escape changed the box's text to ${JSON.stringify(await box_value())}`);
    expect(!(await split_open()), "Escape in the box opened the split console");
    // DevTools keeps its own place in the matches, at the match Enter found, so n goes on from there.
    await press_keys("n");
    await wait_for("n selects the next match", selected, "h2");
    await press_keys("N");
    await wait_for("N selects the match before", selected, "h1");
    expect(await in_markup(), `n or N moved the focus out of the markup view: ${await where()}`);
    await expect_no_errors("search");
  });

  await run_case("Inspector: n and N with an empty box, and / outside the Inspector, stay DevTools'", async () => {
    await open_inspector("empty");
    await press_keys("n", "N");
    await sleep(500);
    expect((await selected()) === "sec", `n or N with an empty box moved the selection to ${await selected()}`);
    expect(await in_markup(), `n or N with an empty box moved the focus: ${await where()}`);
    await show_tool("storage");
    await poll_until("the focus in Storage", async () => (await focused()).url === "index.xhtml" || (await focused()).url.startsWith("index"), { timeout_ms: 5000 }).catch(() => undefined);
    const before = await where();
    await press_keys("/");
    await sleep(500);
    expect((await where()) === before, `/ outside the Inspector moved the focus from ${before} to ${await where()}`);
  });

  await run_case("Inspector: Escape in a box a click focused restores nothing and focuses the markup view", async () => {
    await open_inspector("click");
    await chrome(`(async () => { ${INSPECTOR} ${CLICK} click(box); })()`);
    await wait_for("the click focuses the box", in_box, true);
    await search_for("p.hit");
    await press_keys("-k", "Escape");
    await wait_for("Escape focuses the markup view", in_markup, true);
    expect((await selected()) === "h1", `Escape after a click restored ${await selected()}`);
    expect((await box_value()) === "p.hit", "Escape cleared the box");
  });

  await run_case("Inspector: the kept node goes when the box loses the focus, so a later Escape restores nothing", async () => {
    await open_inspector("blur");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    await search_for("p.hit");
    await chrome(`(async () => { ${INSPECTOR} ${CLICK} click(inspector.panelDoc.getElementById("ruleview-container")); })()`);
    await poll_until("the focus to leave the box", async () => !(await in_box()));
    await chrome(`(async () => { ${INSPECTOR} ${CLICK} click(box); })()`);
    await wait_for("the click focuses the box", in_box, true);
    await press_keys("-k", "Escape");
    await wait_for("Escape focuses the markup view", in_markup, true);
    expect((await selected()) === "h1", `Escape after the box lost the focus restored ${await selected()}`);
  });

  await run_case("Inspector: with the kept node gone from the page, Escape only focuses the markup view", async () => {
    await open_inspector("gone");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    await search_for("p.hit");
    await in_selected_page(`(win) => { win.document.getElementById("sec").remove(); return true; }`);
    await poll_until("the node to leave the page", () => chrome(`(async () => { ${INSPECTOR} return !(await inspector.walker.querySelector(inspector.walker.rootNode, "#sec")); })()`));
    // The markup view drops the node's line a moment after the mutation.
    await sleep(300);
    await press_keys("-k", "Escape");
    await wait_for("Escape focuses the markup view", in_markup, true);
    expect((await selected()) === "h1", `Escape with the kept node gone selected ${await selected()}`);
    await expect_no_errors("the kept node gone");
  });

  await run_case("Inspector: after the page reloads, Escape in the box focuses the markup view and logs nothing", async () => {
    await open_inspector("reload");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    await search_for("p.hit");
    await chrome(`(async () => { ${W}.gBrowser.selectedBrowser.reload(); })()`);
    // The walker of the page before the reload refuses its calls while the new one comes up.
    await poll_until("the markup view of the reloaded page", () => chrome(`(async () => { ${INSPECTOR} try { const node = await inspector.walker.querySelector(inspector.walker.rootNode, "#sec"); return !!node && !!inspector.markup.getContainer(node); } catch { return false; } })()`), { timeout_ms: 10000 });
    if (!(await in_box())) await chrome(`(async () => { ${INSPECTOR} ${CLICK} click(box); })()`);
    await wait_for("the focus in the box", in_box, true);
    await press_keys("-k", "Escape");
    await wait_for("Escape focuses the markup view", in_markup, true);
    await expect_no_errors("the page reloaded");
  });

  await run_case("Inspector: the module pref turned off and on drops the kept node", async () => {
    await open_inspector("pref");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    await search_for("p.hit");
    await set_pref(false);
    await set_pref(true);
    // The pref on says the hello again, and the extension pushes the table again.
    await poll_until("the matched hello again", async () => (await steps.session_value("desertfox_browser_module_status"))?.result === "matched", { timeout_ms: 8000 });
    await sleep(500);
    expect(await in_box(), `the pref turn moved the focus: ${await where()}`);
    await press_keys("-k", "Escape");
    await wait_for("Escape focuses the markup view", in_markup, true);
    expect((await selected()) === "h1", `Escape after the pref turn restored ${await selected()}`);
  });

  await run_case("Inspector: Escape with the suggestion popup open only hides it, and the next Escape leaves the box", async () => {
    await open_inspector("popup");
    await press_keys("/");
    await wait_for("/ focuses the box", in_box, true);
    const popup_open = () => chrome(`(async () => { ${TOOLBOX} return !!tb.doc.querySelector(".tooltip-visible .devtools-autocomplete-popup"); })()`);
    await press_keys("s");
    await wait_for("typing s opens the suggestion popup", popup_open, true);
    await press_keys("-k", "Escape");
    await wait_for("Escape hides the popup", popup_open, false);
    expect(await in_box(), `the Escape that hid the popup moved the focus: ${await where()}`);
    expect((await box_value()) === "s", `the Escape that hid the popup changed the text to ${JSON.stringify(await box_value())}`);
    await press_keys("-k", "Escape");
    await wait_for("Escape selects the node of before /", selected, "sec");
    await wait_for("Escape focuses the markup view", in_markup, true);
  });
}
