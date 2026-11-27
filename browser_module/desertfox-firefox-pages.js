// DesertFox browser module, the Firefox pages: it answers `firefox_page.open { page, where?, tab_id? }` with one of Firefox's own pages from a fixed list. See docs/design/browser_module.md, "Firefox pages".
// The extension names the page. The address comes from the frozen table here, so nothing of the request but the name reaches the load.
// It opens through the entry points Firefox's own menus use, in the window of the tab that asked, and switches to a tab that already shows the page.
// In a window it asks the core to load it into the core sandbox, where it registers its kind once per process.

(function desertfox_browser_module_firefox_pages(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the Firefox pages feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The feature stays off instead, the hello never says `firefox_pages`, and the extension uses the native host.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the Firefox pages feature is off for this session: ${error}`);
  }

  function start(core) {
    // A copy of FIREFOX_PAGE_ADDRESSES in src/shared/firefox_pages.ts without about:logins, which stays off this route, and with the views that have no address. test/browser_module/firefox_pages.test.ts keeps it equal.
    const PAGES = Object.freeze({
      settings: { address: "about:preferences" },
      "settings-general": { address: "about:preferences#general" },
      "settings-home": { address: "about:preferences#home" },
      "settings-search": { address: "about:preferences#search" },
      "settings-privacy": { address: "about:preferences#privacy" },
      "settings-sync": { address: "about:preferences#sync" },
      addons: { address: "about:addons" },
      downloads: { address: "about:downloads" },
      config: { address: "about:config" },
      profiles: { address: "about:profiles" },
      support: { address: "about:support" },
      debugging: { address: "about:debugging#/runtime/this-firefox" },
      processes: { address: "about:processes" },
      memory: { address: "about:memory" },
      policies: { address: "about:policies" },
      crashes: { address: "about:crashes" },
      protections: { address: "about:protections" },
      "addons-shortcuts": { addons_view: "addons://shortcuts/shortcuts" },
    });
    for (const entry of Object.values(PAGES)) Object.freeze(entry);
    const SETTINGS_ADDRESS = "about:preferences";
    // Firefox's own alias of the settings page. An open tab may show either.
    const SETTINGS_ALIAS = "about:settings";
    const ADDONS_ADDRESS = "about:addons";
    // A second press of the same key, or one request read twice, opens nothing more.
    const SAME_OPEN_MS = 1000;
    const RATE_WINDOW_MS = 10000;
    const MAX_OPENS_PER_WINDOW = 5;
    // How long a load of about:addons in the current tab waits for the add-on manager to say it loaded, so it can show a view.
    const VIEW_WAIT_MS = 10000;
    // Pages of the parent process never belong to a container, so a request from a container tab still opens with none.
    const NO_CONTAINER = 0;

    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

    const refuse = (error) => ({ ok: false, error });
    const CANNOT_OPEN = "This Firefox cannot open that page";
    const is_browser_window = (win) => !!win && !win.closed && win.document?.documentElement?.getAttribute("windowtype") === "navigator:browser" && !!win.gBrowser;
    const system_principal = () => Services.scriptSecurityManager.getSystemPrincipal();

    // The times of recent opens in this process, oldest first, and the last open of each page per window.
    let recent_opens = [];
    let last_open = new WeakMap();
    // The stop of each add-on manager load still waiting to show its view.
    const view_waits = new Set();

    // The window to open in and the tab that asked, or a refusal. A request with no tab (a command run with no sender tab) opens in the focused browser window.
    function place_of(tab_id) {
      if (tab_id === undefined) {
        const win = Services.focus?.activeWindow;
        return is_browser_window(win) ? { win, tab: win.gBrowser.selectedTab } : { error: "No Firefox window has the focus" };
      }
      let tab = null;
      try {
        tab = ExtensionParent.apiManager.global.tabTracker.getTab(tab_id, null);
      } catch (_) {
        tab = null;
      }
      // Not `tab.ownerGlobal`: the window as the sandbox sees it through that path hides `gBrowser`.
      const win = tab && !tab.closing ? [...Services.wm.getEnumerator("navigator:browser")].find((each) => is_browser_window(each) && each.gBrowser.getTabForBrowser(tab.linkedBrowser) === tab) : undefined;
      if (!win) return { error: "The tab that asked is gone" };
      return { win, tab };
    }

    // The rules openPreferences follows, applied to this window rather than the most recent one: an open settings tab under either name wins, and a pane in the request moves it to that pane.
    function open_in_tab(win, address) {
      const ignoreFragment = address.includes("#") ? "whenComparingAndReplace" : "whenComparing";
      // switchToTabHavingURI deletes the fields it reads, so each call gets its own params.
      const params = () => ({ ignoreFragment, triggeringPrincipal: system_principal(), relatedToCurrent: true });
      if (address.startsWith(SETTINGS_ADDRESS) && win.switchToTabHavingURI(SETTINGS_ALIAS + address.slice(SETTINGS_ADDRESS.length), false, params(), NO_CONTAINER)) return;
      win.switchToTabHavingURI(address, true, params(), NO_CONTAINER);
    }

    // In a container tab Firefox opens a page that asks for no container in a new tab instead, which is what a system page needs.
    const open_here = (win, address) => win.openTrustedLinkIn(address, "current", { userContextId: NO_CONTAINER });

    // The add-on manager shows a view only after it loads. In a tab, Firefox's own opener waits for that. Here, the wait is this one: the first manager that loads in this window takes the view.
    function open_view_here(win, view) {
      let timer;
      const stop = () => {
        view_waits.delete(stop);
        Services.obs.removeObserver(on_loaded, "EM-loaded");
        clearTimeout(timer);
      };
      const on_loaded = (manager) => {
        if (manager?.browsingContext?.topChromeWindow !== win) return;
        stop();
        manager.loadView(view);
      };
      Services.obs.addObserver(on_loaded, "EM-loaded");
      view_waits.add(stop);
      timer = setTimeout(stop, VIEW_WAIT_MS);
      open_here(win, ADDONS_ADDRESS);
    }

    function open_page(win, entry, where) {
      if (entry.addons_view !== undefined) {
        if (where === "here") return typeof win.openTrustedLinkIn === "function" ? (open_view_here(win, entry.addons_view), true) : false;
        if (typeof win.BrowserAddonUI?.openAddonsMgr !== "function") return false;
        win.BrowserAddonUI.openAddonsMgr(entry.addons_view).then(undefined, (error) => core.log_once(`the add-on manager did not open: ${error}`));
        return true;
      }
      if (where === "here") {
        if (typeof win.openTrustedLinkIn !== "function") return false;
        open_here(win, entry.address);
        return true;
      }
      if (typeof win.switchToTabHavingURI !== "function") return false;
      open_in_tab(win, entry.address);
      return true;
    }

    // True when this open repeats the last one of the same page in the same window within SAME_OPEN_MS.
    function repeats(win, page, now) {
      const last = last_open.get(win);
      return last?.page === page && now - last.at < SAME_OPEN_MS;
    }

    core.register_kind("firefox_page.open", ({ page, where = "tab", tab_id }) => {
      const entry = Object.hasOwn(PAGES, page) ? PAGES[page] : undefined;
      if (!entry) return refuse(CANNOT_OPEN);
      if (where === "here" && tab_id === undefined) return refuse("Opening a page here needs the tab that asked");
      const place = place_of(tab_id);
      if (place.error) return refuse(place.error);
      const { win, tab } = place;
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      // A late request never replaces a tab the user switched away from.
      if (where === "here" && win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      const now = ChromeUtils.now();
      if (repeats(win, page, now)) return { ok: true };
      recent_opens = recent_opens.filter((at) => now - at < RATE_WINDOW_MS);
      if (recent_opens.length >= MAX_OPENS_PER_WINDOW) return refuse("Too many Firefox pages opened at once");
      if (!open_page(win, entry, where)) return refuse(CANNOT_OPEN);
      recent_opens.push(now);
      last_open.set(win, { page, at: now });
      return { ok: true };
    });
    core.on_shut_down(() => {
      for (const stop of [...view_waits]) stop();
      recent_opens = [];
      last_open = new WeakMap();
    });
    core.set_hello_flag("firefox_pages", true);
  }
})(this);
