// The one-shot normal prefix <A-o> with the focus in Firefox's sidebar: the browser module holds the window's next sequence and runs it from the locked-page tree.
// A native leaf (j, 3j) scrolls the selected page and a forward leaf (gt) goes to the extension, the focus stays in the panel, and Escape, a key the tree lacks and the idle time end the hold.
import { ALT } from "./harness.mjs";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "tabs"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const HELLO_KEY = "desertfox_browser_module_hello";
const HELPERS = `
  const w = ${W};
  const name = (n) => n ? n.localName + (n.id ? "#" + n.id : "") + (n.dataset?.guid ? "@" + n.dataset.guid : "") + (n.getAttribute?.("aria-label") ? "[" + n.getAttribute("aria-label") + "]" : "") : null;
  const deep = (doc) => { let a = doc?.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
`;
// The idle time of the hold in desertfox-sidebar.js, and some room.
const ONCE_IDLE_MS = 3000;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, open_page, on_teardown, events, wait_event, scroll_of } = context;
  const steps = module_steps(context);
  const { chrome, session_value, module_status } = steps;

  const focus = () =>
    chrome(`(async () => { ${HELPERS}
      const doc = w.SidebarController.browser.contentDocument;
      const panel_focus = deep(doc);
      const input = panel_focus?.localName === "input" ? panel_focus : null;
      return { panel: name(panel_focus), value: input?.value ?? null, page: w.document.activeElement === w.gBrowser.selectedBrowser, in_panel: w.document.activeElement === w.SidebarController.browser };
    })()`);
  const held = () => chrome(`(async () => Services.desertfox_browser_module.keys_held_by(${W}) ?? null)()`);
  const selected_index = () => chrome(`(async () => { const w = ${W}; return w.gBrowser.tabs.indexOf(w.gBrowser.selectedTab); })()`);
  const debug = async () => JSON.stringify({ focus: await focus(), held: await held(), status: await module_status() });
  const explain = async (wait) => {
    try {
      return await wait;
    } catch (error) {
      throw new Error(`${error.message}: ${await debug()}`);
    }
  };
  const show_history = async () => {
    await chrome(`(async () => { const w = ${W}; w.focus(); await w.SidebarController.show("viewHistorySidebar"); })()`);
    await explain(poll_until("the history search box to take the focus", async () => (await focus()).value !== null, { timeout_ms: 5000 }));
  };
  const hide_panel = () => chrome(`(async () => { const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); w.gBrowser.selectedBrowser.focus(); })()`);
  const into_list = async () => {
    await press_keys("-k", "Escape");
    await explain(poll_until("Escape to move the focus from the search box to the list", async () => {
      const now = await focus();
      return now.value === null && now.panel !== null;
    }));
  };
  const arm = async () => {
    await press_keys(...ALT("o"));
    await explain(poll_until("Alt+O to hold the window's keys", async () => (await held()) === "sidebar_once", { timeout_ms: 3000 }));
  };
  const select_first_tab = () => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);

  await setup("turn the module on, open two pages and wait for the hello's sidebar_once", async () => {
    await steps.turn_on_module();
    await open_page("page", "p57s_a", { new_tab: false });
    await open_page("page", "p57s_b", { new_tab: true });
    on_teardown(hide_panel);
    await poll_until("the hello to say sidebar_once and the state to carry the tree", async () => (await session_value(HELLO_KEY))?.sidebar_once === true && (await session_value(STATE_KEY))?.tree !== undefined, { timeout_ms: 5000 });
  });

  await run_case("in the history list, Alt+O then j and 3j scroll the page, the focus stays on the row, and the next j moves the list", async () => {
    await select_first_tab();
    await show_history();
    await into_list();
    const row = (await focus()).panel;
    let mark = events.length;
    await arm();
    await press_keys("j");
    await explain(wait_event(mark, scroll_of("p57s_a"), "j after Alt+O to scroll the page"));
    await explain(poll_until("the hold to end after the leaf", async () => (await held()) === null));
    mark = events.length;
    await arm();
    await press_keys("3", "j");
    await explain(wait_event(mark, scroll_of("p57s_a"), "3j after Alt+O to scroll the page"));
    const now = await focus();
    expect(now.panel === row && now.in_panel, `the focus left the row ${row}: ${JSON.stringify(now)}`);
    await press_keys("j");
    await explain(poll_until("a plain j to move the list again", async () => (await focus()).panel !== row));
    await hide_panel();
  });

  await run_case("in the history search box, Alt+O then gt goes to the next tab, types nothing and keeps the focus in the box", async () => {
    await select_first_tab();
    await show_history();
    await arm();
    await press_keys("g", "t");
    await explain(poll_until("gt after Alt+O to select the second tab", async () => (await selected_index()) === 1, { timeout_ms: 5000 }));
    await sleep(300);
    const now = await focus();
    expect(now.value === "" && now.in_panel, `gt typed into the box or moved the focus: ${JSON.stringify(now)}`);
    expect((await held()) === null, "the hold outlived the forward leaf");
    await hide_panel();
  });

  await run_case("Escape, a key the tree lacks and the idle time end the hold, and run nothing", async () => {
    await select_first_tab();
    await show_history();
    await into_list();
    const row = (await focus()).panel;
    await arm();
    await press_keys("-k", "Escape");
    await explain(poll_until("Escape to end the hold", async () => (await held()) === null));
    expect((await focus()).panel === row, "Escape after Alt+O left the list");
    await arm();
    // f starts hints, which need page code, so the tree has no f.
    await press_keys("f");
    await explain(poll_until("f to end the hold", async () => (await held()) === null));
    expect((await focus()).panel === row, "f after Alt+O moved the focus");
    await arm();
    await sleep(ONCE_IDLE_MS + 500);
    expect((await held()) === null, "the hold outlived its idle time");
    await press_keys("j");
    await explain(poll_until("j after the idle end to move the list", async () => (await focus()).panel !== row));
    await hide_panel();
  });
}
