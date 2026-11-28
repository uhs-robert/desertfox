// DesertFox browser module, the pane feature: it answers the extension's pane.* requests (split, unsplit, close both, resize, equal widths, focus a region or a side, move what has the focus) in the focused browser window. See docs/design/interfaces_tabs.md, "Split view".
// The core (desertfox-browser.js, which sorts first) reads and checks the requests. In a window this file asks the core to load it into the core sandbox, where it registers its kinds once per process.
// Each handler reaches Firefox internals only when it runs and feature-detects each one, so a Firefox that changed them gets a refusal, never a module turned off at start.

(function desertfox_browser_module_panes(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the pane feature failed to load: ${error}`);
    }
    return;
  }
  if (typeof core.register_kind !== "function") {
    core.log_once("the core has no register_kind, so the pane feature stays off");
    return;
  }
  // In the sandbox an error goes on to the core's `adopt`, which turns the module off for the session.
  register(core);

  function register(core) {
    const EXTENSION_ID = "desertfox@uhs-robert";
    // A resize step, as a share of the panel area. pane.resize in src/commands/tab_split.ts says the same.
    const STEP_SHARE = 0.05;
    const DOCKED_HOSTS = ["bottom", "left", "right"];
    // DevTools' switchHost settles on its own "host-changed" event, which never comes when the move fails inside DevTools. The extension stops waiting at 2 s.
    const SWITCH_HOST_WAIT_MS = 1500;

    const NOT_SUPPORTED = "Not supported in this Firefox version";
    const refuse = (error) => ({ ok: false, error });
    const done = () => ({ ok: true });
    const has_function = (object, name) => typeof object?.[name] === "function";
    // undefined when the module or the export is gone.
    const export_of = (url, name) => {
      try {
        return ChromeUtils.importESModule(url)[name];
      } catch (_) {
        return undefined;
      }
    };

    // Only the window with the focus: a request never acts on a window in the background.
    // A private window counts only when DesertFox may run there, as in the core's key guard.
    function focused_window() {
      const win = Services.focus?.activeWindow;
      if (!win || win.closed || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser") return { problem: "No Firefox window has the focus" };
      const private_utils = export_of("resource://gre/modules/PrivateBrowsingUtils.sys.mjs", "PrivateBrowsingUtils");
      if (typeof win.gBrowser !== "object" || win.gBrowser === null || !has_function(private_utils, "isWindowPrivate")) return { problem: NOT_SUPPORTED };
      if (private_utils.isWindowPrivate(win)) {
        const extension = export_of("resource://gre/modules/ExtensionParent.sys.mjs", "ExtensionParent")?.GlobalManager?.getExtension?.(EXTENSION_ID);
        if (!extension?.privateBrowsingAllowed) return { problem: "DesertFox may not run in this private window" };
      }
      return { win, gBrowser: win.gBrowser, tab: win.gBrowser.selectedTab };
    }

    // `tab.splitview` is the <tab-split-view-wrapper> of a tab in a split view, else null.
    const split_supported = (tab) => tab !== null && typeof tab === "object" && "splitview" in tab;

    // The selected tab's split view, or a refusal: ops that change a split need the selected tab to be in one.
    function selected_split() {
      const where = focused_window();
      if (where.problem) return where;
      if (!split_supported(where.tab)) return { problem: NOT_SUPPORTED };
      const split = where.tab.splitview;
      if (!split) return { problem: "This tab is not in a split view" };
      return { ...where, split };
    }

    // What Firefox's own addTabSplitView flows check first: they return silently on these.
    function can_start_split(tab) {
      if (!split_supported(tab)) return NOT_SUPPORTED;
      if (tab.splitview) return "This tab is already in a split view";
      if (tab.pinned) return "A pinned tab cannot be in a split view";
      if (tab.hidden) return "A hidden tab cannot be in a split view";
      return undefined;
    }

    // The Firefox flow: a new tab with the open tabs picker beside this one, selected.
    function split_new_tab() {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const problem = can_start_split(where.tab);
      if (problem) return refuse(problem);
      if (!has_function(where.win.BrowserCommands, "addTabSplitView")) return refuse(NOT_SUPPORTED);
      where.win.BrowserCommands.addTabSplitView();
      return where.gBrowser.selectedTab?.splitview ? done() : refuse("Firefox did not make the split view");
    }

    function split_next_tab() {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const problem = can_start_split(where.tab);
      if (problem) return refuse(problem);
      const { gBrowser, tab } = where;
      if (!has_function(gBrowser, "addTabSplitView") || !Array.isArray(gBrowser.visibleTabs)) return refuse(NOT_SUPPORTED);
      const tabs = gBrowser.visibleTabs;
      const next = tabs[tabs.indexOf(tab) + 1];
      if (!next) return refuse("There is no next tab to split with");
      if (next.splitview) return refuse("The next tab is already in a split view");
      return gBrowser.addTabSplitView([tab, next], { insertBefore: tab }) ? done() : refuse("Firefox did not make the split view");
    }

    function unsplit() {
      const where = selected_split();
      if (where.problem) return refuse(where.problem);
      if (!has_function(where.split, "unsplitTabs")) return refuse(NOT_SUPPORTED);
      where.split.unsplitTabs();
      return done();
    }

    function close_both() {
      const where = selected_split();
      if (where.problem) return refuse(where.problem);
      if (!has_function(where.split, "close")) return refuse(NOT_SUPPORTED);
      where.split.close();
      return done();
    }

    // The splitter between the panes sizes the first panel only, by its `width` attribute and inline width, and the second panel flexes. A key resize writes both as a drag does.
    // The limits are the ones Firefox's splitter keeps: the panel's min-width on either side.
    function resize({ steps }) {
      const where = selected_split();
      if (where.problem) return refuse(where.problem);
      const { win, gBrowser, split } = where;
      const tabpanels = gBrowser.tabpanels;
      const panel_ids = tabpanels?.splitViewPanels;
      if (!Array.isArray(panel_ids) || gBrowser.activeSplitView !== split) return refuse(NOT_SUPPORTED);
      const first = panel_ids.length === 2 ? win.document.getElementById(panel_ids[0]) : null;
      if (!first) return refuse(NOT_SUPPORTED);
      const area = tabpanels.clientWidth;
      const min = parseFloat(win.getComputedStyle(first).minWidth) || 0;
      const current = first.getBoundingClientRect().width;
      set_first_width(where, first, Math.min(Math.max(current + steps * STEP_SHARE * area, min), Math.max(min, area - min)));
      return done();
    }

    // Equal widths are half of the two panels together, which leaves the splitter out. The width goes in as a resize writes it, so Firefox keeps it across a tab switch.
    function equalize() {
      const where = selected_split();
      if (where.problem) return refuse(where.problem);
      const { win, gBrowser, split } = where;
      const panel_ids = gBrowser.tabpanels?.splitViewPanels;
      if (!Array.isArray(panel_ids) || panel_ids.length !== 2 || gBrowser.activeSplitView !== split) return refuse(NOT_SUPPORTED);
      const [first, second] = panel_ids.map((id) => win.document.getElementById(id));
      if (!first || !second) return refuse(NOT_SUPPORTED);
      set_first_width(where, first, (first.getBoundingClientRect().width + second.getBoundingClientRect().width) / 2);
      return done();
    }

    function set_first_width({ gBrowser, split }, first, width) {
      const rounded = Math.round(width);
      first.setAttribute("width", String(rounded));
      first.style.setProperty("width", `${rounded}px`);
      if (has_function(split, "resetRightPanelWidth")) split.resetRightPanelWidth();
      const tabpanels = gBrowser.tabpanels;
      if (has_function(tabpanels, "updateSplitterAriaAttributes")) {
        Promise.resolve(tabpanels.updateSplitterAriaAttributes()).catch((error) => core.log_once(`the splitter's aria values were not updated: ${error}`));
      }
    }

    function focus_page() {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const browser = where.gBrowser.selectedBrowser;
      if (!has_function(browser, "focus")) return refuse(NOT_SUPPORTED);
      browser.focus();
      return done();
    }

    // Selecting the partner tab keeps the split and moves the focus to its page.
    function focus_split() {
      const where = selected_split();
      if (where.problem) return refuse(where.problem);
      const { gBrowser, split, tab } = where;
      const other = Array.isArray(split.tabs) ? split.tabs.find((each) => each !== tab) : undefined;
      if (!other || !has_function(other.linkedBrowser, "focus")) return refuse(NOT_SUPPORTED);
      gBrowser.selectedTab = other;
      other.linkedBrowser.focus();
      return done();
    }

    // Focus whatever the sidebar shows, in this order: the open panel, the vertical tab strip, the launcher buttons. Only a sidebar that shows nothing opens, on the panel it showed last, and a directional move (`may_open` false) never opens it.
    async function focus_sidebar({ may_open = true } = {}) {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const { win } = where;
      const sidebar = win.SidebarController;
      if (typeof sidebar?.isOpen !== "boolean" || !has_function(sidebar, "toggle")) return refuse(NOT_SUPPORTED);
      if (sidebar.isOpen) return focus_panel(sidebar);
      if (sidebar.launcherVisible === true) {
        if (win.gBrowser.tabContainer?.verticalMode === true) return focus_strip(win);
        // A false answer means the buttons did not take the focus, so a panel opens instead.
        if (has_function(sidebar.sidebarMain, "focusButtonGroup") && sidebar.sidebarMain.focusButtonGroup() === true) return done();
      }
      return may_open ? open_last_panel(win, sidebar) : refuse("The sidebar is closed");
    }

    function focus_panel(sidebar) {
      if (!has_function(sidebar.browser, "focus")) return refuse(NOT_SUPPORTED);
      sidebar.browser.focus();
      return done();
    }

    // The strip's own focused item is the selected tab, and the tab holds the DOM focus, which is where the sidebar key mode looks for the strip.
    // The tab gets the focus call itself, so this does not depend on the item setter moving the DOM focus.
    function focus_strip(win) {
      const strip = win.gBrowser.tabContainer;
      const tab = win.gBrowser.selectedTab;
      if (!("ariaFocusedItem" in strip) || !has_function(tab, "focus")) return refuse(NOT_SUPPORTED);
      strip.ariaFocusedItem = tab;
      tab.focus();
      return done();
    }

    // Firefox's own default for a sidebar never opened is the first panel in its table, History. Bookmarks is the plain choice.
    async function open_last_panel(win, sidebar) {
      await sidebar.toggle(typeof sidebar.lastOpenedId === "string" ? sidebar.lastOpenedId : "viewBookmarksSidebar");
      // The panel loads before the toggle settles, and the user can switch windows meanwhile. The focus stays where they put it.
      if (Services.focus?.activeWindow !== win) return refuse("The window lost the focus before the sidebar opened");
      if (!sidebar.isOpen) return refuse("The sidebar did not open");
      return focus_panel(sidebar);
    }

    // DevTools loads on first use. The shim says whether it has, so a call here never loads it: with DevTools never opened there is no toolbox to focus.
    function focus_devtools() {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const { toolbox, problem } = docked_toolbox(where.tab);
      return problem ? refuse(problem) : focus_toolbox(toolbox);
    }

    function docked_toolbox(tab) {
      const shim = export_of("chrome://devtools-startup/content/DevToolsShim.sys.mjs", "DevToolsShim");
      if (!has_function(shim, "isInitialized") || !has_function(shim, "getToolboxForTab")) return { problem: NOT_SUPPORTED };
      const toolbox = shim.isInitialized() ? shim.getToolboxForTab(tab) : null;
      if (!toolbox) return { problem: "DevTools is not open for this tab" };
      if (toolbox.hostType === "window") return { problem: "DevTools is in its own window, so it is not docked here" };
      if (!DOCKED_HOSTS.includes(toolbox.hostType)) return { problem: "DevTools is not docked in this window" };
      return { toolbox };
    }

    function focus_toolbox(toolbox) {
      // focusTool throws while the toolbox closes (its document is gone) or before the tool's frame exists.
      try {
        if (has_function(toolbox, "focusTool") && typeof toolbox.currentToolId === "string") toolbox.focusTool(toolbox.currentToolId);
        else if (has_function(toolbox.win, "focus")) toolbox.win.focus();
        else return refuse(NOT_SUPPORTED);
      } catch (_) {
        return refuse("DevTools is not ready to take the focus");
      }
      return done();
    }

    // The page's neighbours on one side, nearest first: the other split pane, then DevTools docked on that side, then the sidebar on that side.
    // From the right pane the sidebar on the left is two moves away, through the left pane.
    async function focus_direction({ direction }) {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const { win, gBrowser, tab } = where;
      if (!split_supported(tab)) return refuse(NOT_SUPPORTED);
      if (tab.splitview) {
        const pane = pane_toward(win, tab, direction);
        if (pane.problem) return refuse(pane.problem);
        if (pane.tab) {
          gBrowser.selectedTab = pane.tab;
          pane.tab.linkedBrowser.focus();
          return done();
        }
      }
      const { toolbox, problem } = docked_toolbox(tab);
      if (problem === NOT_SUPPORTED) return refuse(NOT_SUPPORTED);
      if (toolbox?.hostType === direction) return focus_toolbox(toolbox);
      const sidebar_side = sidebar_side_of(win);
      if (sidebar_side === undefined) return refuse(NOT_SUPPORTED);
      if (sidebar_side !== direction) return refuse(`Nothing to focus on the ${direction}`);
      // A move never opens the sidebar, ES does.
      return focus_sidebar({ may_open: false });
    }

    // The panes by where they show, so a right-to-left window needs no special case.
    function pane_toward(win, tab, direction) {
      const other = Array.isArray(tab.splitview.tabs) ? tab.splitview.tabs.find((each) => each !== tab) : undefined;
      const left_edge = (each) => win.document.getElementById(each?.linkedPanel)?.getBoundingClientRect?.().left;
      const [own_left, other_left] = [left_edge(tab), left_edge(other)];
      if (typeof own_left !== "number" || typeof other_left !== "number" || !has_function(other.linkedBrowser, "focus")) return { problem: NOT_SUPPORTED };
      const other_is_left = other_left < own_left;
      return (direction === "left") === other_is_left ? { tab: other } : {};
    }

    // Firefox's sidebar sits at the start of the window unless moved to the end, and the start is the right side in a right-to-left window.
    function sidebar_side_of(win) {
      if (typeof win.RTL_UI !== "boolean") return undefined;
      let at_start;
      try {
        at_start = Services.prefs.getBoolPref("sidebar.position_start", true);
      } catch (_) {
        return undefined;
      }
      return at_start !== win.RTL_UI ? "left" : "right";
    }

    // ---- Moves. Where the focus is comes from the window when the move runs, never from the request: the focus can change between the key and the move.

    const SIDE_WORDS = { left: "on the left", right: "on the right", down: "at the bottom" };

    async function move({ direction }) {
      const where = focused_window();
      if (where.problem) return refuse(where.problem);
      const place = focus_place(where);
      if (place.problem) return refuse(place.problem);
      if (place.toolbox) return redock(where.win, place.toolbox, direction);
      if (place.sidebar) return move_sidebar(where.win, direction);
      if (direction === "down") return refuse("Focus DevTools first");
      return swap_pane(where, direction);
    }

    // { toolbox } with the focus in docked DevTools, { sidebar: true } in the sidebar, {} anywhere else, which moves the selected tab's pane.
    function focus_place({ win, tab }) {
      if (!has_function(core, "focused_element")) return { problem: NOT_SUPPORTED };
      const element = core.focused_element(win);
      if (in_toolbox_frame(win, element)) return docked_toolbox(tab);
      return in_sidebar(win, element) ? { sidebar: true } : {};
    }

    // The core's DevTools key guard reads it the same way: a document under the frame that DevTools docks in a tab.
    function in_toolbox_frame(win, element) {
      let doc = element?.ownerDocument;
      for (let depth = 0; doc && doc !== win.document && depth < 8; depth++) {
        // frameElement is null across the <browser> that holds a docked toolbox, so its embedder names that frame.
        const frame = doc.defaultView?.frameElement ?? doc.defaultView?.browsingContext?.embedderElement;
        if (!frame) return false;
        if (frame.classList?.contains("devtools-toolbox-iframe")) return true;
        doc = frame.ownerDocument;
      }
      return false;
    }

    // The sidebar panel's document, the launcher (its buttons sit in a shadow root) or the vertical tab strip.
    function in_sidebar(win, element) {
      if (!element) return false;
      if (element.ownerDocument === win.SidebarController?.browser?.contentDocument) return true;
      if (element.ownerDocument !== win.document) return false;
      const selector = win.gBrowser.tabContainer?.verticalMode === true ? "#sidebar-box, sidebar-main, #tabbrowser-tabs" : "#sidebar-box, sidebar-main";
      for (let node = element, depth = 0; node && depth < 8; node = node.getRootNode?.()?.host, depth++) {
        if (node.closest?.(selector)) return true;
      }
      return false;
    }

    // DevTools gives the focus back to its tool once the host changed.
    async function redock(win, toolbox, direction) {
      const host = direction === "down" ? "bottom" : direction;
      if (toolbox.hostType === host) return refuse(`DevTools is already docked ${SIDE_WORDS[direction]}`);
      if (!has_function(toolbox, "switchHost") || !has_function(win, "setTimeout")) return refuse(NOT_SUPPORTED);
      let timer;
      try {
        const gave_up = new Promise((resolve) => (timer = win.setTimeout(() => resolve("gave up"), SWITCH_HOST_WAIT_MS)));
        if ((await Promise.race([toolbox.switchHost(host), gave_up])) === "gave up") return refuse("DevTools did not finish moving");
      } catch (error) {
        core.log_once(`DevTools refused to dock ${host}: ${error}`);
        return refuse(`DevTools could not dock ${SIDE_WORDS[direction]}`);
      } finally {
        win.clearTimeout?.(timer);
      }
      return toolbox.hostType === host ? done() : refuse(`DevTools could not dock ${SIDE_WORDS[direction]}`);
    }

    // reversePosition flips the global pref `sidebar.position_start`, so every window's sidebar moves. Only a focus in the sidebar reaches it.
    function move_sidebar(win, direction) {
      if (direction === "down") return refuse("The sidebar moves only left or right");
      const sidebar = win.SidebarController;
      const side = sidebar_side_of(win);
      if (side === undefined || !has_function(sidebar, "reversePosition")) return refuse(NOT_SUPPORTED);
      if (side === direction) return refuse(`The sidebar is already ${SIDE_WORDS[direction]}`);
      sidebar.reversePosition();
      return sidebar_side_of(win) === direction ? done() : refuse("The sidebar did not move");
    }

    // Firefox's own swap reorders the two tabs and shows the panels again. The selected tab stays selected, and its page gets the focus back.
    function swap_pane({ win, tab }, direction) {
      if (!split_supported(tab)) return refuse(NOT_SUPPORTED);
      const split = tab.splitview;
      if (!split) return refuse("This tab is not in a split view");
      const pane = pane_toward(win, tab, direction);
      if (pane.problem) return refuse(pane.problem);
      if (!pane.tab) return refuse(`This pane is already ${SIDE_WORDS[direction]}`);
      if (!has_function(split, "reverseTabs") || !has_function(tab.linkedBrowser, "focus")) return refuse(NOT_SUPPORTED);
      split.reverseTabs();
      tab.linkedBrowser.focus();
      return pane_toward(win, tab, direction).tab ? refuse("The panes did not swap") : done();
    }

    const focus_by_region = { page: focus_page, split: focus_split, sidebar: focus_sidebar, devtools: focus_devtools };

    core.register_kind("pane.split_new_tab", split_new_tab);
    core.register_kind("pane.split_next_tab", split_next_tab);
    core.register_kind("pane.unsplit", unsplit);
    core.register_kind("pane.close_both", close_both);
    core.register_kind("pane.resize", resize);
    core.register_kind("pane.equalize", equalize);
    core.register_kind("pane.focus_direction", focus_direction);
    core.register_kind("pane.move", move);
    core.register_kind("pane.focus_region", ({ region }) => (Object.hasOwn(focus_by_region, region) ? focus_by_region[region]() : refuse(NOT_SUPPORTED)));
    // An older core has no flag for it, and the extension then refuses the move itself.
    if (has_function(core, "set_hello_flag")) core.set_hello_flag("pane_moves", true);
  }
})(this);
