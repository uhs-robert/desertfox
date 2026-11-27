// Hints where no content script hears a key (browser_module/desertfox-chrome-hints.js): gB typed in the Library, in Page Info, in a tab's confirm prompt and in a settings sub-dialog labels the controls there, and a label picks.
// Also: the module recognises gB from the binding the extension lists, the labels' letters never reach the popup walk, the prompt's field keeps its letters, and a dialog that closes mid-session takes the labels and the hold away.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "toolbar"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const LIBRARY = `Services.wm.getMostRecentWindow("Places:Organizer")`;
const PAGE_INFO = `Services.wm.getMostRecentWindow("Browser:page-info")`;
const SESSION_KEY = "desertfox_chrome_hints";

// Chrome code: every label in the window's layer, with the control (in the window or in a dialog frame of this process) whose box its top left corner sits on.
const labels_in = (win) => `(async () => {
  const w = ${win};
  const SELECTOR = "button, toolbarbutton, radio, menu, menulist, checkbox";
  const deep = (root) => { const out = [...root.querySelectorAll(SELECTOR)]; for (const el of root.querySelectorAll("*")) if (el.openOrClosedShadowRoot) out.push(...deep(el.openOrClosedShadowRoot)); return out; };
  const offset = (doc) => { let x = 0, y = 0; while (doc && doc !== w.document) { const f = doc.defaultView?.browsingContext?.embedderElement; if (!f) break; const r = f.getBoundingClientRect(); x += r.left + f.clientLeft; y += r.top + f.clientTop; doc = f.ownerDocument; } return [x, y]; };
  const docs = [];
  const add = (doc) => { docs.push(doc); for (const f of doc.querySelectorAll("browser, iframe")) if (!f.isRemoteBrowser && f.contentDocument && f.checkVisibility()) add(f.contentDocument); };
  add(w.document);
  const candidates = docs.flatMap((doc) => { const [x, y] = offset(doc); return deep(doc).map((el) => { const r = el.getBoundingClientRect(); return { el, left: r.left + x, top: r.top + y, width: r.width }; }); }).filter((c) => c.width > 0);
  const describe = (el) => el.id || el.getAttribute("dlgtype") || el.localName + ":" + (el.getAttribute("label") ?? el.textContent.trim().slice(0, 20));
  const out = [];
  for (const host of w.document.querySelectorAll(".desertfox-chrome-hints")) {
    for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
      const box = node.getBoundingClientRect();
      let best, best_distance = Infinity;
      for (const c of candidates) {
        const distance = Math.abs(c.left - box.left) + Math.abs(c.top - box.top);
        if (distance < best_distance) [best, best_distance] = [c.el, distance];
      }
      out.push({ text: node.textContent, target: best ? describe(best) : "", off: best_distance, styled: w.getComputedStyle(node).borderRadius === "3px" });
    }
  }
  return out;
})()`;
const layer_count = (win) => `(async () => ${win}?.document.querySelectorAll(".desertfox-chrome-hints").length ?? 0)()`;
const held_by = (win) => `(async () => Services.desertfox_browser_module.keys_held_by(${win}) ?? null)()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, take_shot } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, close_selected_tab, home, in_selected_page } = steps;
  const label_of = (labels, test) => labels.find((label) => test(label.target))?.text;
  const close_windows = () => chrome(`(async () => { for (const type of ["Places:Organizer", "Browser:page-info"]) for (const w of [...Services.wm.getEnumerator(type)]) w.close(); ${W}.focus(); })()`);
  // A case closes the window or the tab it opened whether it passes or not, so the next case types into the browser window's own page.
  const case_closing = (close) => (name, body) =>
    run_case(name, async () => {
      try {
        await body();
      } finally {
        await close();
      }
    });
  const window_case = case_closing(close_windows);
  const tab_case = case_closing(close_selected_tab);

  async function start_hints(win, what) {
    await press_keys("g", "B");
    await poll_until(`${what}: the labels to show`, async () => (await chrome(labels_in(win))).length > 0, { timeout_ms: 5000 });
    return chrome(labels_in(win));
  }
  async function expect_ended(win, what) {
    await poll_until(`${what}: the layer to go`, async () => (await chrome(layer_count(win))) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the hold to go`, async () => (await chrome(held_by(win))) === null, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
  }
  const sits_right = (labels, what) => {
    expect(labels.every((label) => label.off <= 2), `${what}: a label sits away from its control: ${JSON.stringify(labels.filter((label) => label.off > 2))}`);
    expect(labels.every((label) => label.styled), `${what}: a label lacks the hint sheet's style`);
  };

  await setup("turn the module on", async () => {
    await steps.turn_on_module();
    await poll_until("the state to list the gB binding", async () => JSON.stringify((await session_value("desertfox_browser_module_state"))?.chrome_hint_keys) === JSON.stringify([["g", "B"]]), { timeout_ms: 5000 });
  });

  await window_case("in the Library gB labels its buttons and menus but no download row, j goes to the labels and not to the tree, and a pick opens Organize", async () => {
    await home("dh_library");
    await chrome(`(async () => { ${W}.PlacesCommandHook.showPlacesOrganizer("AllBookmarks"); })()`);
    await poll_until("the Library to load and take the focus", () => chrome(`(async () => { const w = ${LIBRARY}; return !!w?.document.getElementById("placesList")?.view && Services.focus.activeWindow === w; })()`), { timeout_ms: 8000 });
    await chrome(`(async () => { const tree = ${LIBRARY}.document.getElementById("placesList"); tree.focus(); tree.view.selection.select(0); })()`);
    await sleep(300);
    const labels = await start_hints(LIBRARY, "the Library");
    console.log(`library labels: ${labels.map((label) => label.text + "=" + label.target).join(", ")}`);
    sits_right(labels, "the Library");
    const organize = label_of(labels, (target) => target === "organizeButton");
    expect(organize !== undefined, `no label on Organize: ${labels.map((label) => label.target).join(", ")}`);
    await take_shot("/tmp/desertfox-dialog-hints-library.png");
    const row = () => chrome(`(async () => ${LIBRARY}.document.getElementById("placesList").currentIndex)()`);
    const before = await row();
    if (!labels.some((label) => label.text.startsWith("j"))) {
      await press_keys("j");
      await sleep(300);
      expect((await row()) === before, "j walked the tree while the labels held the keys");
    }
    await press_keys(...organize.split(""));
    await poll_until("the Organize pick to open its menu", () => chrome(`(async () => [...${LIBRARY}.document.querySelectorAll("menu")].some((menu) => menu.open))()`));
    await expect_ended(LIBRARY, "a pick in the Library");
    await press_keys("-k", "Escape");
  });

  await window_case("in Page Info gB labels the section tabs, and a pick shows the Security section", async () => {
    await home("dh_page_info");
    await chrome(`(async () => { ${W}.BrowserCommands.pageInfo(); })()`);
    const section = () => chrome(`(async () => ${PAGE_INFO}?.document.getElementById("viewGroup").selectedItem?.id ?? null)()`);
    await poll_until("Page Info to load and take the focus", () => chrome(`(async () => { const w = ${PAGE_INFO}; return !!w?.document.getElementById("viewGroup")?.selectedItem && Services.focus.activeWindow === w; })()`), { timeout_ms: 8000 });
    await chrome(`(async () => { ${PAGE_INFO}.document.getElementById("viewGroup").focus(); })()`);
    await sleep(300);
    const labels = await start_hints(PAGE_INFO, "Page Info");
    sits_right(labels, "Page Info");
    const security = label_of(labels, (target) => target === "securityTab");
    expect(security !== undefined && label_of(labels, (target) => target === "generalTab") !== undefined, `no label on the sections: ${labels.map((label) => label.target).join(", ")}`);
    await take_shot("/tmp/desertfox-dialog-hints-pageinfo.png");
    await press_keys(...security.split(""));
    await poll_until("the Security section to show", async () => (await section()) === "securityTab");
    await expect_ended(PAGE_INFO, "a pick in Page Info");
  });

  const confirm_page = (kind) => `data:text/html,${encodeURIComponent(`<!doctype html><title>waiting</title><p>dialog</p><script>setTimeout(() => { document.title = String(${kind}("DesertFox asks")); }, 300);</script>`)}`;
  const page_title = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.contentTitle)()`);
  const prompt_open = () => chrome(`(async () => { const w = ${W}; const box = w.gBrowser.getTabDialogBox(w.gBrowser.selectedBrowser); return box.getContentDialogManager()._dialogs.length > 0; })()`);

  await tab_case("in a tab's confirm prompt gB labels OK and Cancel at their place, and a pick of Cancel answers false", async () => {
    await home("dh_confirm");
    await open_tab(confirm_page("confirm"));
    await poll_until("the confirm prompt to open", prompt_open, { timeout_ms: 5000 });
    await sleep(400);
    const labels = await start_hints(W, "the confirm prompt");
    console.log(`confirm labels: ${labels.map((label) => label.text + "=" + label.target).join(", ")}`);
    sits_right(labels, "the confirm prompt");
    const cancel = label_of(labels, (target) => target === "cancel");
    expect(cancel !== undefined && label_of(labels, (target) => target === "accept") !== undefined, `no label on OK or Cancel: ${labels.map((label) => label.target).join(", ")}`);
    await take_shot("/tmp/desertfox-dialog-hints-confirm.png");
    await press_keys(...cancel.split(""));
    await poll_until("the page to read false", async () => (await page_title()) === "false", { timeout_ms: 5000 });
    await expect_ended(W, "a pick in the prompt");
  });

  await tab_case("gB typed in a prompt's field types there and starts nothing", async () => {
    await home("dh_prompt");
    await open_tab(confirm_page("prompt"));
    await poll_until("the prompt to open", prompt_open, { timeout_ms: 5000 });
    await sleep(400);
    await press_keys("g", "B");
    await sleep(600);
    expect((await chrome(layer_count(W))) === 0, "gB in the prompt's field showed labels");
    await press_keys("-k", "Return");
    await poll_until("the page to read the typed text", async () => (await page_title()) === "gB", { timeout_ms: 5000 });
  });

  await tab_case("in a settings sub-dialog gB labels its buttons, closing the dialog mid-session ends it, and a pick of Cancel closes the dialog", async () => {
    await home("dh_subdialog");
    await open_tab("about:preferences");
    await poll_until("about:preferences to load", () => in_selected_page(`(win) => win.document.readyState === "complete" && !!win.gSubDialog`));
    const open_dialog = async () => {
      await in_selected_page(`(win) => { win.gSubDialog.open("chrome://browser/content/preferences/dialogs/languages.xhtml"); return true; }`);
      const list = (code) => in_selected_page(`(win) => { const frame = win.gSubDialog._topDialog?._frame; const list = frame?.contentDocument?.getElementById("activeLanguages"); return list ? (${code}) : null; }`);
      await poll_until("the languages list to show", async () => (await list("list.itemCount")) >= 1, { timeout_ms: 8000 });
      await list("(list.focus(), true)");
      await sleep(300);
    };
    const dialog_open = () => in_selected_page(`(win) => !!win.gSubDialog._topDialog`);
    await open_dialog();
    let labels = await start_hints(W, "the sub-dialog");
    console.log(`sub-dialog labels: ${labels.map((label) => label.text + "=" + label.target).join(", ")}`);
    sits_right(labels, "the sub-dialog");
    await take_shot("/tmp/desertfox-dialog-hints-subdialog.png");
    await in_selected_page(`(win) => { win.gSubDialog._topDialog.close(); return true; }`);
    await expect_ended(W, "the dialog closed mid-session");

    await open_dialog();
    labels = await start_hints(W, "the sub-dialog again");
    const cancel = label_of(labels, (target) => target === "cancel");
    expect(cancel !== undefined, `no label on Cancel: ${labels.map((label) => label.target).join(", ")}`);
    await press_keys(...cancel.split(""));
    await poll_until("the Cancel pick to close the dialog", async () => !(await dialog_open()), { timeout_ms: 5000 });
    await expect_ended(W, "a pick in the sub-dialog");
  });
}
