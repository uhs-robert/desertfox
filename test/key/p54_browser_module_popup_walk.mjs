// The browser module's popup walk with real keys: j, k, h and l in the app menu, a context menu, a menu bar menu, a select popup, the Library and Page Info, and the keys it leaves alone.
// Also j and k in the address bar's results once Tab or Down moved into them.
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const LIBRARY = `Services.wm.getMostRecentWindow("Places:Organizer")`;
const PAGE_INFO = `Services.wm.getMostRecentWindow("Browser:page-info")`;
const wait = (ms) => `await new Promise((resolve) => setTimeout(resolve, ${ms}));`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, open_page, on_teardown, run_line } = context;
  const steps = module_steps(context);
  const { chrome, set_pref, open_tab, focus_page, close_selected_tab, home, page_scroll } = steps;

  // The open menu or panel item that has the keyboard's attention, as a short name.
  const app_menu_focus = () =>
    chrome(`(async () => {
      const w = ${W};
      const view = [...w.document.querySelectorAll("panelview")].find((each) => each.hasAttribute("current") || each.getAttribute("visible") === "true");
      const focused = w.document.commandDispatcher.focusedElement;
      return { state: w.PanelUI.panel.state, view: view?.id ?? null, focused: focused?.id || focused?.localName || null };
    })()`);
  const menu_item = (selector) =>
    chrome(`(async () => {
      const popup = ${W}.document.querySelector(${JSON.stringify(selector)});
      const active = popup && [...popup.querySelectorAll("[_moz-menuactive]")].find((item) => item.closest("menupopup") === popup);
      return { state: popup?.state ?? null, active: active?.id || active?.getAttribute("label") || null };
    })()`);
  const close_popups = () => chrome(`(async () => { const w = ${W}; for (const popup of w.document.querySelectorAll("menupopup, panel")) if (popup.state === "open") popup.hidePopup?.(); })()`);
  const close_windows = () => chrome(`(async () => { for (const type of ["Places:Organizer", "Browser:page-info"]) for (const w of [...Services.wm.getEnumerator(type)]) w.close(); })()`);
  // Every keydown in the chrome windows a case hooks, for a failure message and to count the arrow keys the walk types.
  const record_keys = () => chrome(`(async () => {
    Services.walk_debug_stop?.();
    const log = []; const stops = [];
    const name = (n) => n ? (n.localName + (n.id ? "#" + n.id : "")) : "-";
    const hook = (w) => { const t = w.document.documentElement.getAttribute("windowtype");
      const cap = (e) => log.push(["cap", t, e.key, e.isTrusted, name(e.originalTarget), e.defaultPrevented]);
      const sys = (e) => log.push(["sys", t, e.key, e.isTrusted, name(e.originalTarget), e.defaultPrevented]);
      w.windowRoot.addEventListener("keydown", cap, true); w.addEventListener("keydown", sys, { mozSystemGroup: true });
      stops.push(() => { if (w.closed) return; w.windowRoot.removeEventListener("keydown", cap, true); w.removeEventListener("keydown", sys, { mozSystemGroup: true }); }); };
    for (const w of Services.wm.getEnumerator(null)) hook(w);
    Services.walk_debug = log; Services.walk_debug_hook = hook; Services.walk_debug_stop = () => stops.forEach((f) => f());
  })()`);
  const key_log = () => chrome(`(async () => JSON.stringify(Services.walk_debug ?? []).slice(-3000))()`);
  // Each case leaves no menu or window open behind it, pass or fail, so the next one starts from the page.
  const walk_case = (name, body) =>
    run_case(name, async () => {
      try {
        await record_keys();
        await body();
      } catch (error) {
        throw new Error(`${error.message} KEYS ${await key_log()}`);
      } finally {
        await close_popups();
        await close_windows();
      }
    });

  const scratch_page = `data:text/html,${encodeURIComponent("<!doctype html><title>walk</title><p>walk</p><div style='height:4000px'></div>")}`;

  await setup("turn the module on", () => steps.turn_on_module());

  await walk_case("in the app menu j and k move, l opens a subview and h goes back", async () => {
    await home("pw_app_menu");
    await focus_page();
    await chrome(`(async () => { ${W}.PanelUI.show(); })()`);
    await poll_until("the app menu to open", async () => (await app_menu_focus()).state === "open");
    await sleep(300);
    const seen = [];
    for (let step = 0; step < 3; step++) {
      await press_keys("j");
      await sleep(150);
      seen.push((await app_menu_focus()).focused);
    }
    expect(new Set(seen).size === 3, `j did not move through the app menu: ${seen.join(", ")}`);
    await press_keys("k");
    await sleep(150);
    expect((await app_menu_focus()).focused === seen[1], `k did not move back to ${seen[1]}`);
    // The History item opens a subview.
    for (let step = 0; step < 15 && (await app_menu_focus()).focused !== "appMenu-history-button"; step++) {
      await press_keys("j");
      await sleep(100);
    }
    await press_keys("l");
    await poll_until("l to open the History subview", async () => (await app_menu_focus()).view === "PanelUI-history");
    await sleep(300);
    await press_keys("h");
    await poll_until("h to go back to the main view", async () => (await app_menu_focus()).view === "appMenu-mainView");
    await sleep(300);
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the app menu", async () => (await app_menu_focus()).state === "closed").catch(async (error) => {
      throw new Error(`${error.message}: ${JSON.stringify(await app_menu_focus())} ${JSON.stringify(await steps.module_status())}`);
    });
  });

  await walk_case("in a context menu on a page the module scrolls, j moves the menu and the page stays", async () => {
    await home("pw_context");
    // about:support runs no content script, so the core would take j as a scroll key there.
    await open_tab("about:support");
    await focus_page();
    const before = await page_scroll();
    await press_keys("-M", "shift", "-k", "F10", "-m", "shift");
    await poll_until("the context menu to open", async () => (await menu_item("#contentAreaContextMenu")).state === "open");
    await sleep(300);
    const seen = [];
    for (let step = 0; step < 2; step++) {
      await press_keys("j");
      await sleep(150);
      seen.push((await menu_item("#contentAreaContextMenu")).active);
    }
    expect(seen[0] !== null && seen[0] !== seen[1], `j did not move through the context menu: ${seen.join(", ")}`);
    expect((await page_scroll()) === before, "j scrolled the page under the context menu");
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the context menu", async () => (await menu_item("#contentAreaContextMenu")).state === "closed");
    await close_selected_tab();
  });

  // Every injected field and frame sits fixed at the page's top left, so one point reaches it.
  const INJECTED_POINT = [50, 35];
  const at_point = (point, body) =>
    chrome(`(async () => {
      const w = ${W};
      const browser = w.gBrowser.selectedBrowser;
      const box = browser.getBoundingClientRect();
      const [x, y] = [${point[0]}, ${point[1]}];
      ${body}
    })()`);
  // A real press: the page gets trusted events and the field takes the focus as for a user.
  const click_at = (point) =>
    at_point(point, `for (const message of [w.windowUtils.NATIVE_MOUSE_MESSAGE_MOVE, w.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, w.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_UP]) {
      w.windowUtils.sendNativeMouseEvent((w.mozInnerScreenX + box.left + x) * w.devicePixelRatio, (w.mozInnerScreenY + box.top + y) * w.devicePixelRatio, message, 0, 0, browser, null);
      await new Promise((resolve) => w.setTimeout(resolve, 20));
    }`);
  // The native widget has no right button, so the menu comes from a synthesized one: a press and the contextmenu event.
  const right_click_at = (point) =>
    at_point(point, `for (const type of ["mousedown", "contextmenu"]) w.synthesizeMouseEvent(type, box.left + x, box.top + y, { button: 2, buttons: type === "mousedown" ? 2 : 0, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: false, isWidgetEventSynthesized: false });`);
  const FIELD_BOX = "position:fixed;left:20px;top:20px;width:200px;height:30px;margin:0;box-sizing:border-box;";
  const FIELD_MARKUP = {
    input: `<input id="field" type="text" value="helo wrld" style="${FIELD_BOX}">`,
    textarea: `<textarea id="field" style="${FIELD_BOX}">helo wrld</textarea>`,
    password: `<input id="field" type="password" value="helowrld" style="${FIELD_BOX}">`,
    contenteditable: `<div id="field" contenteditable="true" style="${FIELD_BOX}border:1px solid #888">helo wrld</div>`
  };
  const FRAME_STYLE = `${FIELD_BOX}border:0;width:300px;height:100px;`;
  const FRAME_INPUT = `<body style="margin:0"><input id="field" type="text" value="helo wrld" style="width:200px;height:30px;box-sizing:border-box">`;

  // What the field holds, read in the page process. There is no cross-origin frame variant: the synthesized right-click does not reach a frame of another process.
  const field_value = (frame) =>
    steps.in_selected_page(`(win) => { const doc = ${frame === "same" ? `win.document.getElementById("frame").contentDocument` : "win.document"}; const field = doc.getElementById("field"); return field ? (field.value ?? field.textContent) : null; }`);
  // With the module on, the browser bar shows the mode and the page has no corner badge.
  const bar_mode = () => chrome(`(async () => { const bar = ${W}.document.getElementById("desertfox-statusbar"); return bar?.hasAttribute("data-on") ? bar.querySelector(".dfx-left").children[0]?.textContent ?? null : null; })()`);
  const context_active = async () => (await menu_item("#contentAreaContextMenu")).active;

  // j moves the menu on, and k moves it back one.
  async function walk_context_menu(what) {
    const seen = [await context_active()];
    for (let step = 0; step < 3; step++) {
      await press_keys("j");
      const last = seen.at(-1);
      await poll_until(`j to move the menu over ${what}`, async () => (await context_active()) !== last);
      seen.push(await context_active());
    }
    await press_keys("k");
    await poll_until(`k to move the menu back over ${what}`, async () => (await context_active()) === seen[2]);
  }

  // Right-clicks at `point`, checks that the menu shows `item` (so it is the menu the case means), walks it with j and k and closes it with Escape.
  async function walk_menu_over(name, point, item) {
    await right_click_at(point);
    await poll_until("the context menu to open", async () => (await menu_item("#contentAreaContextMenu")).state === "open");
    expect(await chrome(`(async () => !!${W}.document.querySelector(${JSON.stringify(`#contentAreaContextMenu ${item}:not([hidden])`)}))()`), `the menu over ${name} lacks ${item}`);
    await walk_context_menu(name);
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the context menu", async () => (await menu_item("#contentAreaContextMenu")).state === "closed");
  }

  // Opens the field's context menu as a user would, walks it with j and k, and checks that the field takes no letter.
  // `focus` is "click" (a real click first), "none" (the right-click reaches the field itself) or "insert" (the served /field page, clicked until the bar shows INSERT).
  const field_menu_case = (name, { kind = "input", frame = "none", focus = "click", page_handler = false }) =>
    walk_case(`a context menu over ${name} is walked by j and k and the field gets no letter`, async () => {
      let point = INJECTED_POINT;
      try {
        if (focus === "insert") {
          await home("pw_insert_bar");
          // The bar is set before a field has the focus, since the command line does not open from a field.
          on_teardown(() => run_line(":unset browser_bar"));
          await run_line(":set browser_bar true");
          await poll_until("the bar to show NORMAL", async () => (await bar_mode()) === "NORMAL");
          await open_page("field", "pw_insert_static", { new_tab: false });
          // The page focuses its field at load, so the field is blurred to let the click be the first focus.
          point = await steps.in_selected_page(`(win) => { const field = win.document.getElementById("field"); field.blur(); const box = field.getBoundingClientRect(); return [box.left + 10, box.top + box.height / 2]; }`);
        } else {
          await home(`pw_field_${kind}_${frame}_${focus}`);
          await focus_page();
          const markup =
            frame === "none" ? FIELD_MARKUP[kind]
            : `<iframe id="frame" style="${FRAME_STYLE}"></iframe>`;
          await steps.in_selected_page(`(win) => {
            const holder = win.document.createElement("div");
            holder.innerHTML = ${JSON.stringify(markup)};
            win.document.body.prepend(holder);
            if (${frame === "same"}) win.document.getElementById("frame").contentDocument.body.outerHTML = ${JSON.stringify(FRAME_INPUT)};
            ${page_handler ? `win.addEventListener("keydown", (event) => { if (event.key === "j" || event.key === "k") { event.preventDefault(); event.stopPropagation(); } }, true);` : ""}
            return true;
          }`);
          await poll_until("the field to be laid out", () => steps.in_selected_page(`(win) => !!win.document.getElementById(${JSON.stringify(frame === "none" ? "field" : "frame")})?.getBoundingClientRect().width`));
        }
        const before = await field_value(frame);
        if (focus !== "none") {
          // A click right after the page loads can land before the window takes it, so the click repeats until the field holds the focus.
          const field_focused = () => chrome(`(async () => ${W}.windowUtils.IMEStatus !== Components.interfaces.nsIDOMWindowUtils.IME_STATUS_DISABLED)()`);
          const focus_reached = focus === "insert" ? async () => (await bar_mode()) === "INSERT" : field_focused;
          await poll_until("the click to focus the field", async () => {
            await click_at(point);
            return poll_until("the focus to show", focus_reached, { timeout_ms: 600, expected_timeout: true }).then(() => true, () => false);
          }, { timeout_ms: 10000 });
        }
        await walk_menu_over(name, point, "#context-paste");
        expect((await field_value(frame)) === before, `the field changed from ${JSON.stringify(before)} to ${JSON.stringify(await field_value(frame))} while the menu was open`);
      } finally {
        // A field with the focus keeps the command line from opening, so the bar is unset after the focus leaves.
        if (focus === "insert") {
          await focus_page();
          await run_line(":unset browser_bar");
        }
      }
    });

  await field_menu_case("an input clicked first", {});
  await field_menu_case("an input that the right-click itself reaches", { focus: "none" });
  await field_menu_case("a textarea", { kind: "textarea" });
  await field_menu_case("a contenteditable div", { kind: "contenteditable" });
  await field_menu_case("a password input", { kind: "password" });
  await field_menu_case("an input in a same-origin frame", { frame: "same" });
  await field_menu_case("an input of a page whose own handler stops j and k", { page_handler: true });
  await field_menu_case("an input in INSERT mode", { focus: "insert" });

  // The page's own context menu in NORMAL mode, with no field focused: Back and Reload, a link, an image, selected text.
  const PAGE_TARGETS = {
    "a plain page": { markup: `<div id="target" style="${FIELD_BOX}">plain</div>`, item: "#context-back" },
    "a link": { markup: `<a id="target" href="#linked" style="${FIELD_BOX}display:block">a link</a>`, item: "#context-openlinkintab" },
    "an image": { markup: `<img id="target" alt="" src="data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='30'><rect width='200' height='30' fill='red'/></svg>")}" style="${FIELD_BOX}">`, item: "#context-viewimage" },
    "selected text": { markup: `<p id="target" style="${FIELD_BOX}">selected words</p>`, item: "#context-copy", select: true }
  };
  for (const [name, { markup, item, select }] of Object.entries(PAGE_TARGETS)) {
    await walk_case(`the context menu over ${name} is walked by j and k in NORMAL mode`, async () => {
      await home(`pw_page_menu_${item.slice(9)}`);
      await focus_page();
      await steps.in_selected_page(`(win) => {
        const holder = win.document.createElement("div");
        holder.innerHTML = ${JSON.stringify(markup)};
        win.document.body.prepend(holder);
        if (${select === true}) win.getSelection().selectAllChildren(win.document.getElementById("target"));
        return true;
      }`);
      await poll_until("the target to be laid out", () => steps.in_selected_page(`(win) => !!win.document.getElementById("target").getBoundingClientRect().width`));
      await walk_menu_over(name, INJECTED_POINT, item);
    });
  }

  // Puts `markup` at the page's top left and clicks it until the window's input state says a field has the focus, or until `focused` says so.
  async function click_into(markup, focused = () => chrome(`(async () => ${W}.windowUtils.IMEStatus !== Components.interfaces.nsIDOMWindowUtils.IME_STATUS_DISABLED)()`)) {
    await steps.in_selected_page(`(win) => {
      const holder = win.document.createElement("div");
      holder.innerHTML = ${JSON.stringify(markup)};
      win.document.body.prepend(holder);
      return true;
    }`);
    await poll_until("the field to be laid out", () => steps.in_selected_page(`(win) => !!win.document.getElementById("field")?.getBoundingClientRect().width`));
    await poll_until("the click to focus the field", async () => {
      await click_at(INJECTED_POINT);
      return poll_until("the focus to show", focused, { timeout_ms: 600, expected_timeout: true }).then(() => true, () => false);
    }, { timeout_ms: 10000 });
  }

  const SELECT_POPUP = "#ContentSelectDropdownPopup";
  const SELECT_MARKUP = `<select id="field" style="${FIELD_BOX}"><option>alpha</option><option>bravo</option><option>charlie</option><option>jay</option><option>kay</option></select>`;
  // `ignorekeys` is what Firefox leaves on its select popup once the popup's search box (dom.forms.selectSearch, over 40 options) loses the focus: "false" on Linux.
  for (const ignorekeys of [null, "false"]) {
    await walk_case(`a select popup${ignorekeys === null ? "" : ` with ignorekeys="${ignorekeys}"`} is walked by j and k, not searched by them`, async () => {
      await home(`pw_select_${ignorekeys ?? "plain"}`);
      await focus_page();
      try {
        await click_into(SELECT_MARKUP, async () => (await menu_item(SELECT_POPUP)).state === "open");
        await sleep(300);
        if (ignorekeys !== null) await chrome(`(async () => { ${W}.document.querySelector(${JSON.stringify(SELECT_POPUP)}).setAttribute("ignorekeys", ${JSON.stringify(ignorekeys)}); })()`);
        expect((await menu_item(SELECT_POPUP)).active === "alpha", `the select popup opened on ${(await menu_item(SELECT_POPUP)).active}`);
        for (const [key, row] of [["j", "bravo"], ["j", "charlie"], ["k", "bravo"]]) {
          await press_keys(key);
          await poll_until(`${key} to move the select popup to ${row}`, async () => (await menu_item(SELECT_POPUP)).active === row);
        }
        await press_keys("-k", "Escape");
        await poll_until("Escape to close the select popup", async () => (await menu_item(SELECT_POPUP)).state === "closed");
      } finally {
        await chrome(`(async () => { ${W}.document.querySelector(${JSON.stringify(SELECT_POPUP)})?.removeAttribute("ignorekeys"); })()`);
      }
    });
  }

  // Three bookmarks give the results rows to walk, with no network. Their titles go on with the "xj" the case types, so the rows stay.
  const RESULT_WORD = "jkwalk";
  const results = () => chrome(`(async () => { const bar = ${W}.gURLBar; return { open: bar.view.isOpen, row: bar.view.selectedRowIndex, rows: bar.view.visibleRowCount, value: bar.value, behavior: bar.controller.userSelectionBehavior }; })()`);

  await walk_case("in the address bar j and k type until Tab or Down moves into the results, then walk them", async () => {
    await home("pw_results");
    await chrome(`(async () => { const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs"); for (const n of [1, 2, 3]) await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.unfiledGuid, url: "https://example.com/${RESULT_WORD}-" + n, title: "${RESULT_WORD}xj " + n }); })()`);
    try {
      await chrome(`(async () => { const w = ${W}; w.gURLBar.focus(); w.gURLBar.value = ""; })()`);
      await sleep(300);
      await press_keys(RESULT_WORD);
      await poll_until("the results to show the bookmarks", async () => {
        const now = await results();
        return now.open && now.rows >= 4 && now.value === RESULT_WORD;
      }).catch(async (error) => {
        throw new Error(`${error.message}: ${JSON.stringify(await results())}`);
      });
      const step = async (keys, what, check) => {
        await press_keys(...keys);
        await poll_until(what, async () => check(await results())).catch(async (error) => {
          throw new Error(`${error.message}: ${JSON.stringify(await results())}`);
        });
      };
      await step(["-k", "Tab"], "Tab to move into the results", (now) => now.row === 1);
      await step(["j"], "j to walk down the results", (now) => now.row === 2);
      await step(["k"], "k to walk back up", (now) => now.row === 1);
      // Back on the first row the address shows the typed word again, so the edit below still matches the bookmarks.
      await step(["-k", "Up"], "Up to move back to the first row", (now) => now.row === 0 && now.value === RESULT_WORD);
      await step(["x"], "x to edit the address", (now) => now.open && now.value.endsWith("x") && now.behavior === "none");
      await step(["j"], "j to type after an edit", (now) => now.value.endsWith("xj"));
      const typed_row = (await results()).row;
      await step(["-k", "Down"], "Down to move into the results from typing", (now) => now.row === typed_row + 1);
      await step(["j"], "j to walk on after Down", (now) => now.row === typed_row + 2);
      await step(["-k", "Escape"], "Escape to close the results", (now) => !now.open);
    } finally {
      await chrome(`(async () => {
        const w = ${W};
        const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
        w.gURLBar.value = ""; w.gURLBar.handleRevert?.(); w.gBrowser.selectedBrowser.focus();
        for (const n of [1, 2, 3]) await PlacesUtils.bookmarks.remove(await PlacesUtils.bookmarks.fetch({ url: "https://example.com/${RESULT_WORD}-" + n }));
      })()`);
    }
  });

  await walk_case("in a menu bar menu j moves and l opens a submenu that h closes", async () => {
    await home("pw_menubar");
    await focus_page();
    await chrome(`(async () => { ${W}.document.getElementById("bookmarksMenu").open = true; })()`);
    await poll_until("the Bookmarks menu to open", async () => (await menu_item("#bookmarksMenuPopup")).state === "open");
    await sleep(300);
    const seen = [];
    for (let step = 0; step < 20 && (await menu_item("#bookmarksMenuPopup")).active !== "bookmarksToolbarFolderMenu"; step++) {
      await press_keys("j");
      await sleep(100);
      seen.push((await menu_item("#bookmarksMenuPopup")).active);
    }
    expect((await menu_item("#bookmarksMenuPopup")).active === "bookmarksToolbarFolderMenu", `j did not reach the Bookmarks Toolbar folder: ${seen.join(", ")}`);
    await press_keys("l");
    await poll_until("l to open the folder", async () => (await menu_item("#bookmarksToolbarFolderPopup")).state === "open");
    await sleep(300);
    await press_keys("h");
    await poll_until("h to close the folder", async () => (await menu_item("#bookmarksToolbarFolderPopup")).state === "closed");
    expect((await menu_item("#bookmarksMenuPopup")).state === "open", "h closed the Bookmarks menu too");
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the Bookmarks menu", async () => (await menu_item("#bookmarksMenuPopup")).state === "closed");
  });

  await walk_case("with a menu open over the focused address bar j walks the menu and types nothing", async () => {
    await home("pw_urlbar");
    await chrome(`(async () => { const w = ${W}; w.gURLBar.focus(); w.gURLBar.value = ""; })()`);
    await sleep(300);
    await chrome(`(async () => { ${W}.document.getElementById("bookmarksMenu").open = true; })()`);
    await poll_until("the Bookmarks menu to open", async () => (await menu_item("#bookmarksMenuPopup")).state === "open");
    await sleep(300);
    await press_keys("j");
    await poll_until("j to move into the menu", async () => (await menu_item("#bookmarksMenuPopup")).active !== null);
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the menu", async () => (await menu_item("#bookmarksMenuPopup")).state === "closed");
    await press_keys("x");
    await poll_until("the address bar to take a letter once the menu closed", () => chrome(`(async () => ${W}.gURLBar.value === "x")()`));
    await chrome(`(async () => { const w = ${W}; w.gURLBar.value = ""; w.gURLBar.handleRevert?.(); w.gBrowser.selectedBrowser.focus(); })()`);
  });

  await walk_case("a second browser window walks its menus with one arrow key per letter", async () => {
    await home("pw_second");
    await chrome(`(async () => {
      const opener = ${W};
      const w = opener.OpenBrowserWindow();
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
      Services.walk_debug_hook(w);
    })()`);
    try {
      await poll_until("the second window to have the focus", () => chrome(`(async () => Services.focus.activeWindow === ${W} && [...Services.wm.getEnumerator("navigator:browser")].length === 2)()`), { timeout_ms: 8000 });
      await chrome(`(async () => { ${W}.document.getElementById("bookmarksMenu").open = true; })()`);
      await poll_until("the Bookmarks menu to open", async () => (await menu_item("#bookmarksMenuPopup")).state === "open");
      await sleep(300);
      await press_keys("jjj");
      await sleep(400);
      const arrows = await chrome(`(async () => Services.walk_debug.filter(([phase, , key]) => phase === "cap" && key === "ArrowDown").length)()`);
      expect(arrows === 3, `three j made ${arrows} arrow keys`);
    } finally {
      await chrome(`(async () => { const windows = [...Services.wm.getEnumerator("navigator:browser")]; for (const w of windows.slice(1)) w.close(); })()`);
    }
  });

  // The Library's left tree, its selected row as an index, and where the focus is.
  const library_state = () =>
    chrome(`(async () => {
      const w = ${LIBRARY};
      if (!w) return null;
      const tree = w.document.getElementById("placesList");
      const focused = w.document.commandDispatcher.focusedElement;
      return { row: tree.currentIndex, open: tree.view.isContainerOpen(Math.max(tree.currentIndex, 0)), focused: focused?.id || focused?.localName || null, search: w.document.getElementById("searchFilter").value, active: Services.focus.activeWindow === w };
    })()`);
  const open_library = async () => {
    await chrome(`(async () => { ${W}.PlacesCommandHook.showPlacesOrganizer("AllBookmarks"); })()`);
    await poll_until("the Library to load", () => chrome(`(async () => !!${LIBRARY}?.document.getElementById("placesList")?.view)()`), { timeout_ms: 8000 });
    await chrome(`(async () => Services.walk_debug_hook(${LIBRARY}))()`);
    await poll_until("the Library to have the focus", async () => (await library_state())?.active === true, { timeout_ms: 8000 });
    await chrome(`(async () => { const w = ${LIBRARY}; const tree = w.document.getElementById("placesList"); tree.focus(); tree.view.selection.select(0); })()`);
    await sleep(300);
  };

  await walk_case("in the Library j and k move the tree, the search box types them and Escape closes only from a tree with no search", async () => {
    await home("pw_library");
    await open_library();
    await press_keys("j");
    await poll_until("j to move down the tree", async () => (await library_state()).row === 1);
    await press_keys("k");
    await poll_until("k to move back up", async () => (await library_state()).row === 0);
    await chrome(`(async () => { ${LIBRARY}.document.getElementById("searchFilter").focus(); })()`);
    await press_keys("jk");
    await poll_until("the search box to hold jk", async () => (await library_state()).search === "jk");
    await chrome(`(async () => { ${LIBRARY}.document.getElementById("placesList").focus(); })()`);
    await sleep(200);
    await press_keys("-k", "Escape");
    await sleep(500);
    expect((await library_state()) !== null, "Escape closed the Library while the search box held text");
    await chrome(`(async () => { const box = ${LIBRARY}.document.getElementById("searchFilter"); box.value = ""; box.doCommand?.(); ${LIBRARY}.document.getElementById("placesList").focus(); })()`);
    await sleep(300);
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the Library", async () => (await library_state()) === null);
  });

  await walk_case("in Page Info j moves to the next section and k back, and Escape closes it", async () => {
    await home("pw_page_info");
    await chrome(`(async () => { ${W}.BrowserCommands.pageInfo(); })()`);
    const section = () => chrome(`(async () => { const w = ${PAGE_INFO}; return w ? { id: w.document.getElementById("viewGroup").selectedItem?.id ?? null, active: Services.focus.activeWindow === w } : null; })()`);
    await poll_until("Page Info to load", () => chrome(`(async () => !!${PAGE_INFO}?.document.getElementById("viewGroup")?.selectedItem)()`), { timeout_ms: 8000 });
    await chrome(`(async () => Services.walk_debug_hook(${PAGE_INFO}))()`);
    await poll_until("Page Info to have the focus", async () => (await section())?.active === true, { timeout_ms: 8000 });
    await chrome(`(async () => { ${PAGE_INFO}.document.getElementById("viewGroup").focus(); })()`);
    await sleep(300);
    const first = (await section()).id;
    await press_keys("j");
    await poll_until("j to move to the next section", async () => (await section()).id !== first);
    await press_keys("k");
    await poll_until("k to move back", async () => (await section()).id === first);
    await press_keys("-k", "Escape");
    await poll_until("Escape to close Page Info", async () => (await section()) === null);
  });

  await walk_case("in a settings sub-dialog j and k move its list and the page under it does not scroll", async () => {
    await home("pw_subdialog");
    await open_tab("about:preferences");
    await poll_until("about:preferences to load", () => steps.in_selected_page(`(win) => win.document.readyState === "complete" && !!win.gSubDialog`));
    await steps.in_selected_page(`(win) => { win.gSubDialog.open("chrome://browser/content/preferences/dialogs/languages.xhtml"); return true; }`);
    const list = (code) => steps.in_selected_page(`(win) => { const frame = win.gSubDialog._topDialog?._frame; const list = frame?.contentDocument?.getElementById("activeLanguages"); return list ? (${code}) : null; }`);
    await poll_until("the languages list to show two rows", async () => (await list("list.itemCount")) >= 2, { timeout_ms: 8000 });
    await list("(list.focus(), list.selectedIndex = 0, true)");
    await sleep(300);
    const before = await page_scroll();
    await press_keys("j");
    await poll_until("j to select the next language", async () => (await list("list.selectedIndex")) === 1);
    await press_keys("k");
    await poll_until("k to select the first language again", async () => (await list("list.selectedIndex")) === 0);
    expect((await page_scroll()) === before, "j or k scrolled about:preferences under the dialog");
    await press_keys("-k", "Escape");
    await poll_until("Escape to close the dialog", async () => (await list("true")) === null);
    await close_selected_tab();
  });

  await walk_case("with no menu open j scrolls the locked page, and with the pref off j in the app menu does not walk", async () => {
    await home("pw_none");
    await open_tab(scratch_page);
    await focus_page();
    await steps.scrolls("j", "a page with no menu open");
    await chrome(`(async () => { ${W}.PanelUI.show(); })()`);
    await poll_until("the app menu to open", async () => (await app_menu_focus()).state === "open");
    await sleep(300);
    await set_pref(false);
    const before = (await app_menu_focus()).focused;
    await press_keys("j");
    await sleep(NO_EFFECT_MS);
    expect((await app_menu_focus()).focused === before, "j walked the app menu with the pref off");
    await set_pref(true);
    await close_popups();
    await close_selected_tab();
  });

  await walk_case("a permission prompt with the focus in the page leaves j to the page", async () => {
    await home("pw_doorhanger");
    await open_tab(scratch_page);
    await focus_page();
    await chrome(`(async () => {
      const w = ${W};
      w.PopupNotifications.show(w.gBrowser.selectedBrowser, "desertfox-walk-test", "walk test", null, { label: "Allow", accessKey: "A", callback() {} }, [{ label: "Block", accessKey: "B", callback() {} }]);
    })()`);
    await poll_until("the prompt to open", () => chrome(`(async () => ${W}.document.getElementById("notification-popup").state === "open")()`));
    await focus_page();
    await steps.scrolls("j", "a page under a permission prompt");
    await close_selected_tab();
  });
}

