// Hints over Firefox's own UI (browser_module/desertfox-chrome-hints.js, src/background/chrome_hints.ts): gB labels the toolbar buttons, the tabs, the bookmarks toolbar and the menu bar, a label picks, and an open app menu gets labels inside it.
// Also the lifecycle: Escape, a window switch, the pref off and a newer session each take the layer and the key listener away, a target that moved is not picked, and an id of an older session picks nothing. It reports the round trip of one typed key.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "toolbar"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const FROM_EXTENSION_KEY = "desertfox_browser_module_from_extension";
const SESSION_KEY = "desertfox_chrome_hints";

// Chrome code: every label of every layer in the window, with the element its top left corner sits on.
const LABELS = `(async () => {
  const w = ${W};
  const doc = w.document;
  const candidates = [...doc.querySelectorAll("toolbarbutton, tab.tabbrowser-tab, menubar > menu, richlistitem, button, moz-button, .tab-group-label")];
  for (const host of doc.querySelectorAll("sidebar-main")) if (host.shadowRoot) candidates.push(...host.shadowRoot.querySelectorAll("moz-button, button"));
  const describe = (el) => el.id || (el.classList.contains("tab-group-label") ? "group-label" : "") || (el.localName === "tab" ? "tab:" + [...w.gBrowser.tabs].indexOf(el) : el.localName + ":" + (el.getAttribute("label") ?? el.textContent.trim().slice(0, 20)));
  const out = [];
  for (const host of doc.querySelectorAll(".desertfox-chrome-hints")) {
    const root = host.openOrClosedShadowRoot;
    for (const node of root.querySelectorAll(".desertfox-hint")) {
      const box = node.getBoundingClientRect();
      let best, best_distance = Infinity;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const distance = Math.abs(r.left - box.left) + Math.abs(r.top - box.top);
        if (distance < best_distance) [best, best_distance] = [el, distance];
      }
      out.push({ text: node.textContent, typed: node.querySelector("b")?.textContent ?? "", left: box.left, top: box.top, target: best ? describe(best) : "", off: best_distance, panel: !!host.closest("panel"), styled: w.getComputedStyle(node).borderRadius === "3px" });
    }
  }
  return out;
})()`;
const LAYER_COUNT = `(async () => ${W}.document.querySelectorAll(".desertfox-chrome-hints").length)()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown, take_shot } = context;
  const steps = module_steps(context);
  const { chrome, session_value, set_session_value, module_status, set_pref, focus_page, home } = steps;
  const labels_now = () => chrome(LABELS);
  const layers = () => chrome(LAYER_COUNT);
  // The page's blocked pop-up count goes to Firefox's own handler as the content process would send it, so Firefox builds the popup-blocked bar and its Options menu itself. A real window.open from the test page is not blocked here: the debugger's script counts as allowed.
  const in_selected_page_open_popups = () =>
    chrome(`(async () => {
      const w = ${W};
      const browser = w.gBrowser.selectedBrowser;
      const blocker = browser.popupAndRedirectBlocker;
      blocker.getBlockedPopupCount = () => 2;
      blocker.isRedirectBlocked = () => false;
      // Firefox reads both before it awaits anything, and a later navigation of this browser must not bring the bar back.
      try {
        browser.dispatchEvent(new w.CustomEvent("DOMUpdateBlockedPopups", { bubbles: true }));
      } finally {
        delete blocker.getBlockedPopupCount;
        delete blocker.isRedirectBlocked;
      }
    })()`);
  const label_of = (labels, target) => labels.find((label) => label.target === target)?.text;

  // A group around the last tab, which a test folds through its label. Any earlier group is dissolved first, and the teardown dissolves this one.
  async function make_group() {
    const ungroup_all = () => chrome(`(async () => { for (const group of [...${W}.gBrowser.tabGroups]) group.ungroupTabs(); })()`);
    on_teardown(ungroup_all);
    await ungroup_all();
    await chrome(`(async () => { const w = ${W}; w.gBrowser.addTabGroup([w.gBrowser.tabs.at(-1)], { label: "desertfox group" }); })()`);
    await poll_until("the group label to show", () => chrome(`(async () => [...${W}.document.querySelectorAll(".tab-group-label")].some((e) => e.checkVisibility()))()`), { timeout_ms: 5000 });
  }
  const group_collapsed = () => chrome(`(async () => ${W}.gBrowser.tabGroups[0]?.collapsed === true)()`);

  async function start_hints(what) {
    // A case that fails with labels up would leave the keys with the session.
    on_teardown(async () => {
      if ((await layers()) > 0) await press_keys("-k", "Escape");
    });
    // A loading page shows the stop button in place of reload.
    await steps.wait_loaded();
    await focus_page();
    await press_keys("g", "B");
    await poll_until(`${what}: the labels to show`, async () => (await labels_now()).length > 0, { timeout_ms: 4000 });
    return labels_now();
  }
  async function expect_no_layer(what) {
    await poll_until(`${what}: the layer to go`, async () => (await layers()) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
  }
  // A key the session no longer holds reaches the page again: j scrolls the test page.
  async function keys_reach_page(what) {
    const before = await steps.page_scroll();
    await press_keys("j");
    await poll_until(`${what}: j to scroll the page`, async () => (await steps.page_scroll()) > before, { timeout_ms: 3000 });
  }

  await setup("turn the module on and show the bookmarks toolbar and the menu bar", async () => {
    await steps.turn_on_module();
    on_teardown(() =>
      chrome(`(async () => {
        const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
        for (const guid of Services.desertfox_key_test_bookmarks ?? []) await PlacesUtils.bookmarks.remove(guid).catch(() => {});
        delete Services.desertfox_key_test_bookmarks;
        Services.prefs.clearUserPref("browser.toolbars.bookmarks.visibility");
        const w = ${W};
        w.setToolbarVisibility(w.document.getElementById("toolbar-menubar"), false);
        w.setToolbarVisibility(w.document.getElementById("PersonalToolbar"), false);
      })()`),
    );
    await chrome(`(async () => {
      const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
      const mark = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, url: "about:robots", title: "robots mark" });
      const folder = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, type: PlacesUtils.bookmarks.TYPE_FOLDER, title: "folder mark" });
      await PlacesUtils.bookmarks.insert({ parentGuid: folder.guid, url: "about:mozilla", title: "inner mark" });
      Services.desertfox_key_test_bookmarks = [mark.guid, folder.guid];
      Services.prefs.setStringPref("browser.toolbars.bookmarks.visibility", "always");
      const w = ${W};
      w.setToolbarVisibility(w.document.getElementById("toolbar-menubar"), true);
      w.setToolbarVisibility(w.document.getElementById("PersonalToolbar"), true);
    })()`);
    await poll_until("the bookmarks toolbar and the menu bar to show", () =>
      chrome(`(async () => { const d = ${W}.document; return [...d.querySelectorAll("#PersonalToolbar toolbarbutton.bookmark-item")].some((e) => e.checkVisibility() && e.label === "folder mark") && d.querySelector("#main-menubar > menu").checkVisibility(); })()`),
      { timeout_ms: 10000 },
    );
  });

  await run_case("gB labels the nav bar, the tabs, the bookmarks toolbar and the menu bar with the hint style, and Escape takes the layer away", async () => {
    await home("ch_labels");
    const labels = await start_hints("gB");
    const targets = labels.map((label) => label.target);
    for (const id of ["back-button", "reload-button", "unified-extensions-button", "PanelUI-menu-button", "tab:0"]) expect(targets.includes(id), `no label on ${id}: ${targets.join(", ")}`);
    expect(targets.some((target) => target.endsWith(":folder mark")) && targets.some((target) => target.endsWith(":robots mark")), `no label on the bookmarks: ${targets.join(", ")}`);
    expect(targets.includes("file-menu"), `no label on the File menu: ${targets.join(", ")}`);
    expect(labels.every((label) => label.off <= 2), `a label sits away from its target: ${JSON.stringify(labels.filter((label) => label.off > 2))}`);
    expect(labels.every((label) => label.styled), "a label lacks the hint sheet's style");
    expect(new Set(labels.map((label) => label.text)).size === labels.length, "two labels share a text");
    await take_shot("/tmp/desertfox-chrome-hints-toolbar.png");
    await press_keys("-k", "Escape");
    await expect_no_layer("Escape");
    await keys_reach_page("after Escape");
  });

  await run_case("a label picks: reload, a tab, a bookmarks folder and a menu bar menu", async () => {
    await home("ch_pick");
    const reloads = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.innerWindowID)()`);
    const before = await reloads();
    let labels = await start_hints("reload");
    await press_keys(...label_of(labels, "reload-button").split(""));
    await poll_until("the reload pick to reload the page", async () => (await reloads()) !== before, { timeout_ms: 5000 });
    await expect_no_layer("a pick");

    await context.open_page("page", "ch_pick_two", { new_tab: true });
    labels = await start_hints("a tab");
    await press_keys(...label_of(labels, "tab:0").split(""));
    await poll_until("the tab pick to select the first tab", () => chrome(`(async () => ${W}.gBrowser.tabContainer.selectedIndex === 0)()`));

    labels = await start_hints("a folder");
    await press_keys(...labels.find((label) => label.target.endsWith(":folder mark")).text.split(""));
    await poll_until("the folder pick to open its menu", () => chrome(`(async () => [...${W}.document.querySelectorAll("#PersonalToolbar toolbarbutton[type=menu]")].some((e) => e.label === "folder mark" && e.open))()`));
    await press_keys("-k", "Escape");

    labels = await start_hints("the File menu");
    await press_keys(...label_of(labels, "file-menu").split(""));
    await poll_until("the File pick to open the menu", () => chrome(`(async () => ${W}.document.getElementById("file-menu").open)()`));
    await press_keys("-k", "Escape");
    await press_keys("-k", "Escape");
    await poll_until("the File menu to close", async () => !(await chrome(`(async () => ${W}.document.getElementById("file-menu").open)()`)));
  });

  await run_case("gB labels a tab group's label in the horizontal strip, and a pick folds the group", async () => {
    await home("ch_group_h");
    await make_group();
    const labels = await start_hints("a tab group label");
    await press_keys(...label_of(labels, "group-label").split(""));
    await poll_until("the group label pick to fold the group", group_collapsed, { timeout_ms: 5000 });
    await expect_no_layer("a group label pick");
  });

  await run_case("with vertical tabs gB labels each tab and the tab group's label, a tab label selects the tab and the group label folds the group", async () => {
    await home("ch_vertical");
    await chrome(`(async () => { Services.prefs.setBoolPref("sidebar.verticalTabs", true); })()`);
    // Cleared here and not in a teardown, which runs at the end of the piece, so a failing case does not leave the strip vertical for the cases after it.
    try {
      await poll_until("the strip to turn vertical", () => chrome(`(async () => ${W}.gBrowser.tabContainer.verticalMode === true)()`));
      await context.open_page("page", "ch_vertical_two", { new_tab: true });
      await make_group();
      let labels = await start_hints("vertical tabs");
      const tab_count = await chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
      for (let index = 0; index < tab_count; index++) expect(labels.some((label) => label.target === "tab:" + index), `no label on tab ${index}: ${labels.map((label) => label.target).join(", ")}`);
      expect(labels.some((label) => label.target === "group-label"), "no label on the tab group label");
      expect(labels.every((label) => label.styled), "a label lacks the hint sheet's style");
      await take_shot("/tmp/desertfox-chrome-hints-vertical.png");
      await press_keys(...label_of(labels, "group-label").split(""));
      await poll_until("the group label pick to fold the group", group_collapsed, { timeout_ms: 5000 });
      await expect_no_layer("the group label pick");
      // The folded group keeps only the selected tab showing, so the last tab is selected and the first one is picked.
      await chrome(`(async () => { ${W}.gBrowser.selectedTab = ${W}.gBrowser.tabs.at(-1); })()`);
      labels = await start_hints("vertical tabs, second start");
      await press_keys(...label_of(labels, "tab:0").split(""));
      await poll_until("the tab pick to select the first tab", () => chrome(`(async () => ${W}.gBrowser.tabContainer.selectedIndex === 0)()`));
    } finally {
      await chrome(`(async () => Services.prefs.clearUserPref("sidebar.verticalTabs"))()`);
      await poll_until("the strip to turn horizontal", () => chrome(`(async () => ${W}.gBrowser.tabContainer.verticalMode === false)()`));
    }
  });

  await run_case("with the app menu open, gB labels its rows inside the panel, and a pick runs the row", async () => {
    await home("ch_appmenu");
    let labels = await start_hints("the app menu button");
    await press_keys(...label_of(labels, "PanelUI-menu-button").split(""));
    await poll_until("the app menu to open", () => chrome(`(async () => ${W}.PanelUI.panel.state === "open")()`));
    on_teardown(() => chrome(`(async () => ${W}.PanelUI.hide())()`));
    await sleep(300);
    const focus = await chrome(`(async () => { const f = Services.focus.focusedElement; return f ? f.localName + "#" + f.id : "none"; })()`);
    labels = await start_hints(`gB in the app menu (focus ${focus})`);
    console.log(`app menu labels: ${labels.map((label) => label.text + "=" + label.target).join(", ")}`);
    expect(labels.length > 3 && labels.every((label) => label.panel), `the labels are not in the panel: ${JSON.stringify(labels.slice(0, 4))}`);
    expect(labels.every((label) => label.off <= 2), `a panel label sits away from its row: ${JSON.stringify(labels.filter((label) => label.off > 2))}`);
    await take_shot("/tmp/desertfox-chrome-hints-appmenu.png");
    const new_window_row = label_of(labels, "appMenu-new-window-button2");
    expect(new_window_row !== undefined, `no label on New window: ${labels.map((label) => label.target).join(", ")}`);
    const windows = () => chrome(`(async () => [...Services.wm.getEnumerator("navigator:browser")].length)()`);
    const before = await windows();
    on_teardown(() => chrome(`(async () => { const all = [...Services.wm.getEnumerator("navigator:browser")]; for (const w of all.slice(${before})) w.close(); })()`));
    await press_keys(...new_window_row.split(""));
    await poll_until("the New window row to open a window", async () => (await windows()) > before, { timeout_ms: 5000 });
    await chrome(`(async () => { const all = [...Services.wm.getEnumerator("navigator:browser")]; for (const w of all.slice(${before})) w.close(); all[0].focus(); })()`);
    await expect_no_layer("a panel pick");
  });

  await run_case("a target that moved after its label was drawn is not picked, and the session ends", async () => {
    await home("ch_moved");
    await context.open_page("page", "ch_moved_two", { new_tab: true });
    const labels = await start_hints("moved");
    // The first tab is not the selected one, so a pick would show. Each draw places the labels again, so the tab moves after the last draw before its last letter.
    const label = label_of(labels, "tab:0");
    if (label.length > 1) {
      await press_keys(...label.slice(0, -1).split(""));
      await poll_until("the labels to narrow", async () => (await labels_now()).every((shown) => shown.typed === label.slice(0, -1)));
    }
    // A margin moves the tab's box as a tab opening before it would, with no other change to the strip.
    await chrome(`(async () => { ${W}.gBrowser.tabs[0].style.marginInlineStart = "60px"; })()`);
    on_teardown(() => chrome(`(async () => { ${W}.gBrowser.tabs[0].style.marginInlineStart = ""; })()`));
    await sleep(400);
    const selected = await chrome(`(async () => ${W}.gBrowser.selectedTab.linkedBrowser.currentURI.spec)()`);
    await press_keys(label.at(-1));
    await expect_no_layer("a moved pick");
    const now = await chrome(`(async () => ${W}.gBrowser.selectedTab.linkedBrowser.currentURI.spec)()`);
    expect(now === selected, `the moved tab was picked: ${selected} became ${now}; module messages ${JSON.stringify((await session_value("desertfox_browser_module_from_module")) ?? []).slice(0, 1500)}`);
  });

  await run_case("an older session's ids pick nothing once a newer session collected, and the older layer is gone", async () => {
    await home("ch_race");
    await start_hints("first");
    const first = await session_value(SESSION_KEY);
    const window_id = await context.in_background(`browser.windows.getLastFocused().then((w) => w.id)`);
    const old_ids = (first.labels ?? []).map(([id]) => id);
    // A second collect written as the extension writes one, as a second hint key or a second window's key would.
    const list = (await session_value(FROM_EXTENSION_KEY)) ?? [];
    const now = await chrome(`(async () => Date.now())()`);
    await set_session_value(FROM_EXTENSION_KEY, [...list.slice(-12), { v: 1, id: "race-collect", kind: "chrome_hints.collect", args: { session: 7, window_id, colors: "" }, sent_at: now }]);
    await poll_until("the first session's labels to go", async () => (await labels_now()).length === 0, { timeout_ms: 3000 });
    expect((await layers()) === 1, "the newer session has no layer, or the older one is left");
    const after = (await session_value(FROM_EXTENSION_KEY)) ?? [];
    await set_session_value(FROM_EXTENSION_KEY, [...after.slice(-12), { v: 1, id: "race-old-pick", kind: "chrome_hints.pick", args: { session: first.session, id: old_ids[0] }, sent_at: now }, { v: 1, id: "race-new-pick", kind: "chrome_hints.pick", args: { session: 7, id: old_ids[0] }, sent_at: now }]);
    const replies = async () => ((await session_value("desertfox_browser_module_from_module")) ?? []).filter((message) => message.reply_to?.startsWith("race-"));
    await poll_until("both picks to be refused", async () => (await replies()).length >= 2, { timeout_ms: 3000 });
    const answers = Object.fromEntries((await replies()).map((reply) => [reply.reply_to, reply]));
    expect(answers["race-old-pick"]?.ok === false && answers["race-new-pick"]?.ok === false, `a stale id picked: ${JSON.stringify(answers)}`);
    await press_keys("-k", "Escape");
    await poll_until("Escape to end the newer session", async () => (await layers()) === 0);
  });

  await run_case("a window switch, the pref off and a closed window each end the session with no layer or key listener left", async () => {
    await home("ch_life");
    await start_hints("switch");
    const first_layers = `(async () => Services.desertfox_key_test_first.document.querySelectorAll(".desertfox-chrome-hints").length)()`;
    await chrome(`(async () => {
      Services.desertfox_key_test_first = ${W};
      const w = Services.desertfox_key_test_first.OpenBrowserWindow();
      Services.desertfox_key_test_window = w;
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
    })()`);
    const close_second = `(async () => { const w = Services.desertfox_key_test_window; delete Services.desertfox_key_test_window; if (w && !w.closed) w.close(); Services.desertfox_key_test_first?.focus(); })()`;
    on_teardown(async () => {
      await chrome(close_second);
      await chrome(`(async () => { delete Services.desertfox_key_test_first; })()`);
    });
    await poll_until("the first window's layer to go when the second takes the front", async () => (await chrome(first_layers)) === 0);
    // The second window gets a test page, so DesertFox hears gB there. Its labels sit on its own buttons, then closing it ends that session.
    await context.open_page("page", "ch_life_two", { new_tab: true });
    const labels = await start_hints("in the second window");
    expect(labels.some((label) => label.target === "PanelUI-menu-button") && labels.every((label) => label.off <= 2), "the second window's labels miss its buttons");
    await chrome(close_second);
    await poll_until("the extension to drop the closed window's session", async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
    await sleep(500);

    await home("ch_life_pref");
    await start_hints("pref off");
    await set_pref(false);
    await poll_until("the pref off to take the layer away", async () => (await layers()) === 0);
    await keys_reach_page("with the pref off");
    await set_pref(true);
    const status = await module_status();
    expect(status.errors.length === 0, `the module logged: ${status.errors.join("; ")}`);
  });

  await run_case("labels sit on their targets at twice the pixel density", async () => {
    await home("ch_hidpi");
    on_teardown(() => chrome(`(async () => Services.prefs.clearUserPref("layout.css.devPixelsPerPx"))()`));
    await chrome(`(async () => Services.prefs.setCharPref("layout.css.devPixelsPerPx", "2"))()`);
    await sleep(800);
    const labels = await start_hints("HiDPI");
    expect(labels.length > 3 && labels.every((label) => label.off <= 2), `a label sits away from its target at 2x: ${JSON.stringify(labels.filter((label) => label.off > 2).slice(0, 3))}`);
    await press_keys("-k", "Escape");
    await expect_no_layer("Escape at 2x");
  });

  await run_case("the round trip of one typed key, from the keydown in chrome to the narrowed labels", async () => {
    await home("ch_latency");
    // More targets than letters, so labels of two letters exist and one letter narrows.
    await chrome(`(async () => { const w = ${W}; for (let i = 0; i < 10; i++) w.gBrowser.addTrustedTab("about:blank", { inBackground: true }); })()`);
    on_teardown(() => chrome(`(async () => { const w = ${W}; for (const tab of [...w.gBrowser.tabs]) if (tab.linkedBrowser.currentURI.spec === "about:blank" && !tab.selected) w.gBrowser.removeTab(tab); })()`));
    // The module stamps each key push with the time it took the keydown. Each change of the labels marks a draw.
    await chrome(`(async () => { Services.desertfox_key_test_marks = { draws: [] }; })()`);
    on_teardown(() => chrome(`(async () => { Services.desertfox_key_test_unmark?.(); delete Services.desertfox_key_test_unmark; delete Services.desertfox_key_test_marks; })()`));
    const labels = await start_hints("latency");
    const long_label = labels.find((label) => label.text.length >= 2);
    expect(long_label !== undefined, "no label of two letters to narrow");
    await chrome(`(async () => {
      const w = ${W};
      const host = w.document.querySelector(".desertfox-chrome-hints");
      const box = host.openOrClosedShadowRoot.querySelector(".desertfox-hints");
      const observer = new w.MutationObserver(() => Services.desertfox_key_test_marks.draws.push(Date.now()));
      observer.observe(box, { childList: true });
      Services.desertfox_key_test_unmark = () => observer.disconnect();
    })()`);
    const first = long_label.text[0];
    for (let round = 0; round < 10; round++) {
      const draws = (await chrome(`(async () => Services.desertfox_key_test_marks.draws.length)()`)) + 1;
      await press_keys(...(round % 2 === 0 ? [first] : ["-k", "BackSpace"]));
      await poll_until(`draw ${draws}`, async () => (await chrome(`(async () => Services.desertfox_key_test_marks.draws.length)()`)) >= draws, { timeout_ms: 3000 });
      await sleep(150);
    }
    const draws = (await chrome(`(async () => Services.desertfox_key_test_marks)()`)).draws;
    const session = (await session_value(SESSION_KEY)).session;
    const keys = ((await session_value("desertfox_browser_module_from_module")) ?? []).filter((message) => message.kind === "chrome_hints.key" && message.args.session === session).map((message) => message.sent_at);
    const trips = keys.slice(-10).map((at, index) => draws.slice(-keys.slice(-10).length)[index] - at);
    const sorted = [...trips].sort((a, b) => a - b);
    console.log(`chrome hints key round trip ms: ${trips.join(", ")} (median ${sorted[5]}, max ${sorted.at(-1)})`);
    expect(sorted[5] < 200, `the median round trip is ${sorted[5]} ms`);
    await press_keys("-k", "Escape");
    await expect_no_layer("Escape after the timing");
  });

  // ---- Notification bars.

  const BAR_BUTTON = `const bar = [...${W}.document.querySelectorAll("notification-message")].find((one) => one.getAttribute("value") === VALUE); const button = bar?.querySelector("button.notification-button");`;
  const rect_of = (expression) => `(async () => { const r = (${expression})?.getBoundingClientRect(); return r ? { left: r.left, top: r.top } : null; })()`;
  const remove_bars = () => chrome(`(async () => { const box = ${W}.gBrowser.getNotificationBox(); for (const bar of [...box.allNotifications]) box.removeNotification(bar, true); ${W}.document.getElementById("blockedPopupOptions")?.hidePopup(); })()`);
  // Firefox keeps a new bar's buttons disabled for a moment.
  const wait_bar_ready = (value) =>
    poll_until(`the ${value} bar's button to be enabled`, () => chrome(`(async () => { const VALUE = ${JSON.stringify(value)}; ${BAR_BUTTON} return !!button && !button.disabled && button.checkVisibility() && button.getBoundingClientRect().width > 0; })()`), { timeout_ms: 8000 });
  const label_on = (labels, spot) => labels.find((label) => Math.abs(label.left - spot.left) + Math.abs(label.top - spot.top) <= 2)?.text;

  await run_case("gB labels the popup-blocked bar's Options button and its close button, and a pick of Options waits for Enter, which then opens the menu", async () => {
    await home("ch_bar_popup");
    on_teardown(remove_bars);
    await in_selected_page_open_popups();
    await poll_until("the popup-blocked bar to show", () => chrome(`(async () => { const VALUE = "popup-blocked"; ${BAR_BUTTON} return !!button; })()`), { timeout_ms: 8000 });
    await wait_bar_ready("popup-blocked");
    const labels = await start_hints("the popup-blocked bar");
    const options = await chrome(rect_of(`(() => { const VALUE = "popup-blocked"; ${BAR_BUTTON} return button; })()`));
    const close = await chrome(rect_of(`(() => { const VALUE = "popup-blocked"; ${BAR_BUTTON} return bar.openOrClosedShadowRoot.querySelector(".close"); })()`));
    const options_label = label_on(labels, options);
    expect(options_label !== undefined, `no label on the Options button: ${JSON.stringify({ options, labels })}`);
    expect(label_on(labels, close) !== undefined, `no label on the bar's close button: ${JSON.stringify({ close, labels })}`);
    const menu_open = () => chrome(`(async () => ${W}.document.getElementById("blockedPopupOptions").state === "open")()`);
    await press_keys(...options_label.split(""));
    await poll_until("the mark to show on Options", () => chrome(`(async () => [...${W}.document.querySelectorAll(".desertfox-chrome-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`), { timeout_ms: 4000 });
    expect(!(await menu_open()), "the Options pick opened the menu with no Enter");
    await sleep(700);
    await press_keys("-k", "Return");
    await poll_until("Enter to open the blocked popup menu", menu_open, { timeout_ms: 5000 });
    await remove_bars();
    await expect_no_layer("the Options pick");
  });

  await run_case("a pick of the button of another bar marks it and runs nothing until Enter", async () => {
    await home("ch_bar_other");
    on_teardown(remove_bars);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_bar_ran; })()`));
    await chrome(`(async () => {
      const box = ${W}.gBrowser.getNotificationBox();
      await box.appendNotification("desertfox-test-bar", { label: "A test bar", priority: box.PRIORITY_INFO_MEDIUM }, [{ label: "Do it", callback: () => { Services.desertfox_key_test_bar_ran = true; return true; } }]);
    })()`);
    await wait_bar_ready("desertfox-test-bar");
    const labels = await start_hints("another bar");
    const spot = await chrome(rect_of(`(() => { const VALUE = "desertfox-test-bar"; ${BAR_BUTTON} return button; })()`));
    const text = label_on(labels, spot);
    expect(text !== undefined, `no label on the bar's button: ${JSON.stringify({ spot, labels })}`);
    await press_keys(...text.split(""));
    await poll_until("the mark to show on the bar's button", () => chrome(`(async () => [...${W}.document.querySelectorAll(".desertfox-chrome-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`), { timeout_ms: 4000 });
    expect(!(await chrome(`(async () => !!Services.desertfox_key_test_bar_ran)()`)), "the pick ran the bar's button");
    await sleep(700);
    await press_keys("-k", "Return");
    await poll_until("Enter to run the bar's button", () => chrome(`(async () => !!Services.desertfox_key_test_bar_ran)()`), { timeout_ms: 4000 });
    await expect_no_layer("the confirmed pick");
  });

  // ---- Toolbar panels.

  const hide_panel = (id) => chrome(`(async () => { ${W}.document.getElementById(${JSON.stringify(id)})?.hidePopup(); })()`);
  const panel_open = (id) => chrome(`(async () => ${W}.document.getElementById(${JSON.stringify(id)})?.state === "open")()`);
  // A case that failed with a panel open must not leave it holding the focus for the next.
  const panels_home = async (id) => {
    for (const panel of ["unified-extensions-panel", "customizationui-widget-panel", "trustpanel-popup", "permission-popup", "editBookmarkPanel"]) await hide_panel(panel);
    await chrome(`(async () => { ${W}.gBrowser.tabGroupMenu?.panel?.hidePopup?.(); })()`);
    await home(id);
  };
  const open_panel = async (id, opener) => {
    on_teardown(() => hide_panel(id));
    await chrome(`(async () => { const w = ${W}; ${opener} })()`);
    await poll_until(`the ${id} panel to open`, () => panel_open(id), { timeout_ms: 8000 });
    // The panel's own views finish sliding in before their rows have a box.
    await sleep(400);
  };
  // The label on the element that `expression` names, read from chrome.
  const label_of_element = async (labels, expression) => label_on(labels, await chrome(rect_of(expression)));
  const confirm_mark_shows = (what) => poll_until(`the mark to show on ${what}`, () => chrome(`(async () => [...${W}.document.querySelectorAll(".desertfox-chrome-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`), { timeout_ms: 4000 });
  // The gB the user types with the focus inside an open panel: no page focus first, which would close it.
  async function hints_in_panel(what) {
    on_teardown(async () => {
      if ((await layers()) > 0) await press_keys("-k", "Escape");
    });
    await press_keys("g", "B");
    await poll_until(`${what}: the labels to show`, async () => (await labels_now()).length > 0, { timeout_ms: 4000 });
    return labels_now();
  }
  const permission_state = (permission) => chrome(`(async () => Services.perms.testPermissionFromPrincipal(${W}.gBrowser.contentPrincipal, ${JSON.stringify(permission)}))()`);

  await run_case("with the extensions panel open, gB labels its buttons inside the panel, and a pick of Manage extensions opens the add-ons page at once", async () => {
    await panels_home("ch_ext_panel");
    on_teardown(() => chrome(`(async () => { const w = ${W}; for (const tab of [...w.gBrowser.tabs]) if (tab.linkedBrowser.currentURI.spec.startsWith("about:addons") && w.gBrowser.tabs.length > 1) w.gBrowser.removeTab(tab); })()`));
    await open_panel("unified-extensions-panel", `await w.gUnifiedExtensions.togglePanel();`);
    const labels = await start_hints("the extensions panel");
    expect(labels.length > 0 && labels.every((label) => label.panel), `a label is outside the panel: ${JSON.stringify(labels.slice(0, 4))}`);
    const manage = await label_of_element(labels, `${W}.document.getElementById("unified-extensions-manage-extensions")`);
    expect(manage !== undefined, `no label on Manage extensions: ${JSON.stringify(labels)}`);
    await press_keys(...manage.split(""));
    await poll_until("Manage extensions to open the add-ons page", () => chrome(`(async () => ${W}.gBrowser.currentURI.spec.startsWith("about:addons"))()`), { timeout_ms: 8000 });
    await expect_no_layer("the Manage extensions pick");
  });

  await run_case("with the all-tabs panel open, gB labels its rows inside the panel, and a pick of a tab's row selects the tab", async () => {
    await panels_home("ch_alltabs");
    await context.open_page("page", "ch_alltabs_two", { new_tab: true });
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);
    await open_panel("customizationui-widget-panel", `w.gTabsPanel.showAllTabsPanel();`);
    const labels = await start_hints("the all-tabs panel");
    expect(labels.length > 2 && labels.every((label) => label.panel), `a label is outside the panel: ${JSON.stringify(labels.slice(0, 4))}`);
    const row = await label_of_element(labels, `[...${W}.document.querySelectorAll("#allTabsMenu-allTabsView-tabs .all-tabs-button")][1]`);
    expect(row !== undefined, `no label on the second tab's row: ${JSON.stringify(labels)}`);
    await press_keys(...row.split(""));
    await poll_until("the row's pick to select the second tab", () => chrome(`(async () => ${W}.gBrowser.selectedTab === ${W}.gBrowser.tabs[1])()`), { timeout_ms: 5000 });
    await expect_no_layer("the all-tabs row pick");
  });

  await run_case("with the site panel open, gB labels it, a pick of the tracking protection toggle marks it and Enter turns protection off for the site, and nothing changes before Enter", async () => {
    await panels_home("ch_site_panel");
    on_teardown(() => chrome(`(async () => Services.perms.removeFromPrincipal(${W}.gBrowser.contentPrincipal, "trackingprotection"))()`));
    try {
      await open_panel("trustpanel-popup", `await w.gTrustPanelHandler.showPopup();`);
      const toggle = `${W}.document.getElementById("trustpanel-toggle")`;
      let labels = await start_hints("the site panel");
      expect(labels.every((label) => label.panel), `a label is outside the panel: ${JSON.stringify(labels.slice(0, 4))}`);
      let text = await label_of_element(labels, toggle);
      expect(text !== undefined, `no label on the tracking protection toggle: ${JSON.stringify(labels)}`);
      await press_keys(...text.split(""));
      await confirm_mark_shows("the toggle");
      expect((await permission_state("trackingprotection")) === 0, "the pick turned protection off with no Enter");
      // A key that is not Enter cancels the wait, and the panel stays.
      await press_keys("x");
      await poll_until("the mark to go", () => chrome(`(async () => ![...${W}.document.querySelectorAll(".desertfox-chrome-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`), { timeout_ms: 4000 });
      expect((await permission_state("trackingprotection")) === 0, "a key other than Enter turned protection off");
      await expect_no_layer("the cancelled wait");
      labels = await start_hints("the site panel, second start");
      text = await label_of_element(labels, toggle);
      await press_keys(...text.split(""));
      await confirm_mark_shows("the toggle, second pick");
      await sleep(700);
      await press_keys("-k", "Return");
      await poll_until("Enter to turn protection off for the site", async () => (await permission_state("trackingprotection")) !== 0, { timeout_ms: 5000 });
    } finally {
      await chrome(`(async () => Services.perms.removeFromPrincipal(${W}.gBrowser.contentPrincipal, "trackingprotection"))()`);
    }
  });

  await run_case("with the permission panel open, a pick of a permission's remove button marks it, and only Enter clears the permission", async () => {
    await panels_home("ch_perm_panel");
    const principal = `${W}.gBrowser.contentPrincipal`;
    try {
      await chrome(`(async () => { const { SitePermissions } = ChromeUtils.importESModule("resource:///modules/SitePermissions.sys.mjs"); SitePermissions.setForPrincipal(${principal}, "camera", SitePermissions.ALLOW); })()`);
      await open_panel("permission-popup", `w.gPermissionPanel.openPopup();`);
      const remove = `${W}.document.querySelector("#permission-popup .permission-popup-permission-remove-button")`;
      await poll_until("the permission row to show", async () => (await chrome(rect_of(remove))) !== null, { timeout_ms: 5000 });
      const labels = await start_hints("the permission panel");
      const text = await label_of_element(labels, remove);
      expect(text !== undefined, `no label on the remove button: ${JSON.stringify(labels)}`);
      await press_keys(...text.split(""));
      await confirm_mark_shows("the remove button");
      expect((await permission_state("camera")) !== 0, "the pick cleared the permission with no Enter");
      await sleep(700);
      await press_keys("-k", "Return");
      await poll_until("Enter to clear the permission", async () => (await permission_state("camera")) === 0, { timeout_ms: 5000 });
    } finally {
      await chrome(`(async () => { const { SitePermissions } = ChromeUtils.importESModule("resource:///modules/SitePermissions.sys.mjs"); SitePermissions.removeFromPrincipal(${principal}, "camera"); })()`);
    }
  });

  await run_case("the bookmark panel gets labels only after the user leaves its name field, and its Remove bookmark button waits for Enter", async () => {
    await panels_home("ch_bookmark_panel");
    const url = await chrome(`(async () => ${W}.gBrowser.currentURI.spec)()`);
    on_teardown(() => chrome(`(async () => { const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs"); const found = await PlacesUtils.bookmarks.fetch({ url: ${JSON.stringify(url)} }); if (found) await PlacesUtils.bookmarks.remove(found); })()`));
    const bookmarked = () => chrome(`(async () => { const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs"); return !!(await PlacesUtils.bookmarks.fetch({ url: ${JSON.stringify(url)} })); })()`);
    await open_panel("editBookmarkPanel", `await w.PlacesCommandHook.bookmarkPage();`);
    expect(await bookmarked(), "the bookmark panel opened with no bookmark made");
    await poll_until("the name field to have the focus", () => chrome(`(async () => Services.focus.focusedElement?.id === "editBMPanel_namePicker")()`), { timeout_ms: 5000 });
    await press_keys("g", "B");
    await sleep(500);
    expect((await layers()) === 0, "gB typed in the name field started a session");
    await chrome(`(async () => { ${W}.document.getElementById("editBookmarkPanelDoneButton").focus(); })()`);
    const labels = await hints_in_panel("the bookmark panel");
    expect(labels.every((label) => label.panel), `a label is outside the panel: ${JSON.stringify(labels.slice(0, 4))}`);
    const text = await label_of_element(labels, `${W}.document.getElementById("editBookmarkPanelRemoveButton")`);
    expect(text !== undefined, `no label on Remove bookmark: ${JSON.stringify(labels)}`);
    await press_keys(...text.split(""));
    await confirm_mark_shows("Remove bookmark");
    expect(await bookmarked(), "the pick removed the bookmark with no Enter");
    await sleep(700);
    await press_keys("-k", "Return");
    await poll_until("Enter to remove the bookmark", async () => !(await bookmarked()), { timeout_ms: 5000 });
  });

  await run_case("the tab group editor is labelled once the user leaves its name field, a swatch picks at once and Delete group waits for Enter", async () => {
    await panels_home("ch_group_editor");
    await make_group();
    on_teardown(() => chrome(`(async () => { ${W}.gBrowser.tabGroupMenu?.panel?.hidePopup?.(); })()`));
    await chrome(`(async () => { const w = ${W}; w.gBrowser.tabGroupMenu.openEditModal(w.gBrowser.tabGroups[0]); })()`);
    const editor = `${W}.document.querySelector("#tab-group-editor > panel.tab-group-editor-panel")`;
    await poll_until("the tab group editor to open", () => chrome(`(async () => ${editor}?.state === "open")()`), { timeout_ms: 8000 });
    await sleep(400);
    await chrome(`(async () => { ${W}.document.getElementById("tabGroupEditor_addNewTabInGroup").focus(); })()`);
    const labels = await hints_in_panel("the tab group editor");
    expect(labels.every((label) => label.panel), `a label is outside the panel: ${JSON.stringify(labels.slice(0, 4))}`);
    const swatch = await label_of_element(labels, `${W}.document.getElementById("tab-group-editor-swatch-red")`);
    const delete_row = await label_of_element(labels, `${W}.document.getElementById("tabGroupEditor_deleteGroup")`);
    expect(swatch !== undefined && delete_row !== undefined, `no label on the red swatch or Delete group: ${JSON.stringify(labels)}`);
    await press_keys(...delete_row.split(""));
    await confirm_mark_shows("Delete group");
    expect(await chrome(`(async () => ${W}.gBrowser.tabGroups.length === 1)()`), "the pick deleted the group with no Enter");
    await press_keys("x");
    await expect_no_layer("the cancelled Delete group wait");
    await chrome(`(async () => { ${W}.document.getElementById("tabGroupEditor_addNewTabInGroup").focus(); })()`);
    const again = await hints_in_panel("the tab group editor, second start");
    const red = await label_of_element(again, `${W}.document.getElementById("tab-group-editor-swatch-red")`);
    await press_keys(...red.split(""));
    await poll_until("the swatch pick to color the group red", () => chrome(`(async () => ${W}.gBrowser.tabGroups[0]?.color === "red")()`), { timeout_ms: 5000 });
  });
}
