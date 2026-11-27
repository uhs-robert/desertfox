// The browser module's popup walk with real keys: j, k, h and l in the app menu, a context menu, a menu bar menu, the Library and Page Info, and the keys it leaves alone.
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const LIBRARY = `Services.wm.getMostRecentWindow("Places:Organizer")`;
const PAGE_INFO = `Services.wm.getMostRecentWindow("Browser:page-info")`;
const wait = (ms) => `await new Promise((resolve) => setTimeout(resolve, ${ms}));`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep } = context;
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

