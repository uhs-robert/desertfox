// DesertFox browser module, the sidebar feature: keys in Firefox's own sidebar, the vertical tab strip and the history, bookmarks and open tabs panels. See docs/design/browser_module.md.
// The keys come from the sidebar table in the extension's state (the core's sidebar_row). They act only with the focus in one of those places, never in an add-on's sidebar and never in a text field, except the key that leaves.
// In a panel the moves type arrow keys, so Firefox keeps its own selection and scrolling. In the strip they move the strip's own keyboard focus.
// In a window it asks the core to load it into the core sandbox, where it starts once per process and attaches to every browser window, open or opened later.

(function desertfox_browser_module_sidebar(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the sidebar feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The sidebar keys stay off instead, with nothing left registered.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the sidebar keys are off for this session: ${error}`);
  }

  function start(core) {
    const missing = ["may_act", "on_shut_down", "sidebar_row", "type_key", "token_of", "is_field", "deep_active", "focused_element"].find((name) => typeof core[name] !== "function");
    if (missing) {
      core.log_once(`the core has no ${missing}, so the sidebar keys stay off`);
      return;
    }

    const BROWSER = "navigator:browser";
    // The panel pages the keys act in, by the panel each belongs to. The revamped and the older pages both count. An add-on's sidebar loads webext-panels.xhtml, which is not here.
    const PANELS = new Map([
      ["chrome://browser/content/sidebar/sidebar-history.html", "history"],
      ["chrome://browser/content/places/historySidebar.xhtml", "history"],
      ["chrome://browser/content/sidebar/sidebar-bookmarks.html", "bookmarks"],
      ["chrome://browser/content/places/bookmarksSidebar.xhtml", "bookmarks"],
      ["chrome://browser/content/sidebar/sidebar-opentabs.html", "opentabs"],
    ]);
    const LEAVE = "sidebar.leave";
    const ESCAPE = "<Escape>";
    const { is_field, deep_active } = core;
    const has_function = (object, name) => typeof object?.[name] === "function";

    // ---- Where the key is.

    const sidebar_document = (win) => win.SidebarController?.browser?.contentDocument ?? null;
    const panel_of = (doc) => PANELS.get(String(doc?.documentURI ?? "").replace(/[?#].*$/, ""));
    const vertical_strip = (win) => win.gBrowser?.tabContainer?.verticalMode === true;

    // The place of `element`: a scoped panel, the vertical strip, or undefined anywhere else (the page, the toolbars, an add-on's sidebar).
    // `field` says whether the focus is in a text field there, a field inside a shadow root included.
    function place_of(win, element) {
      const doc = element?.ownerDocument;
      if (!doc) return undefined;
      if (doc === sidebar_document(win)) {
        const panel = panel_of(doc);
        if (!panel) return undefined;
        return { kind: "panel", panel, doc, field: is_field(element) || is_field(deep_active(doc)) };
      }
      if (doc === win.document && vertical_strip(win) && element.closest?.("#tabbrowser-tabs")) return { kind: "strip", field: false };
      return undefined;
    }

    // The popup walk owns the keys while a menu that takes keys or a walking panel is open.
    function popup_owns_keys(win) {
      for (const popup of win.document.querySelectorAll("menupopup, panel")) {
        if (popup.state !== "open" && popup.state !== "showing") continue;
        if (popup.localName === "menupopup" && !popup.hasAttribute("ignorekeys")) return true;
        if (popup.localName === "panel" && (popup.id === "downloadsPanel" || popup.querySelector("panelmultiview"))) return true;
      }
      return false;
    }

    // ---- What a key does. Pure: the place, the key, the key held from before and the table give the choice.

    // Which commands work where. d closes only an open tab, never a bookmark or a history entry. The strip has no search box, so / opens the all tabs panel.
    const runs_in = (id, place) => {
      if (!Object.hasOwn(ACTIONS, id)) return false;
      if (id === "sidebar.close_item") return place.kind === "strip" || place.panel === "opentabs";
      return true;
    };

    // { take, id?, pending? }: take the key, run `id` if set, and hold `pending` as the first key of a two-key row.
    // A held key and Escape end the sequence. A held key and any other key try the pair, then the second key alone.
    function decide(place, token, pending, row_of) {
      if (pending !== undefined && token === ESCAPE) return { take: true };
      const pair = pending === undefined ? undefined : row_of([pending, token]);
      const row = pair?.id ? pair : row_of([token]);
      if (!row) return { take: false };
      if (row.prefix) return place.field ? { take: false } : { take: true, pending: token };
      if (place.field && row.id !== LEAVE) return { take: false };
      return runs_in(row.id, place) ? { take: true, id: row.id } : { take: false };
    }

    // ---- The actions. Each returns false when it cannot act here, and the key then goes on to Firefox.

    const deep_query = (root, test) => {
      const roots = [root];
      while (roots.length > 0) {
        for (const element of roots.shift().querySelectorAll("*")) {
          if (test(element)) return element;
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      return null;
    };
    // An element's parent across shadow roots.
    const composed_parent = (node) => node.parentElement ?? node.getRootNode?.().host ?? null;
    const search_box_of = (doc) => deep_query(doc, (element) => element.localName === "moz-input-search" || element.localName === "search-textbox" || element.id === "search-box");
    // The list under the search box: the old places tree, or the revamped panel's tab stop, a row or a group header the tree view keeps focusable.
    const list_of = (doc) => doc.querySelector("tree") ?? deep_query(doc, (element) => element.getAttribute?.("tabindex") === "0" && (element.localName === "summary" || /row$/.test(element.localName)));

    // Typed into the panel, so its own tree view moves, opens and folds. The key goes out only while the window's focus is still in this panel. The panel document keeps its own active element after the focus leaves the sidebar, so that one does not tell.
    // The typed key comes back through this feature's own listener, and a typed Enter would run sidebar.open again. The core types right after `still_holds` says yes, so the key is marked from then to the end of the turn.
    let typing = false;
    const typed = (key) => (win, place) =>
      core.type_key(win, key, () => {
        const holds = place_of(win, core.focused_element(win))?.doc === place.doc && core.may_act(win);
        if (holds) {
          typing = true;
          win.setTimeout(() => (typing = false), 0);
        }
        return holds;
      });

    function strip_items(win) {
      const strip = win.gBrowser.tabContainer;
      const items = strip.ariaFocusableItems;
      if (!Array.isArray(items) || !("ariaFocusedItem" in strip) || items.length === 0) return undefined;
      const current = strip.ariaFocusedItem ?? win.gBrowser.selectedTab;
      return { strip, items, index: Math.max(0, items.indexOf(current)), current };
    }

    const strip_focus = (pick) => (win) => {
      const where = strip_items(win);
      if (!where) return false;
      where.strip.ariaFocusedItem = where.items[Math.min(where.items.length - 1, Math.max(0, pick(where)))];
      return true;
    };

    const is_tab = (item) => item?.localName === "tab";

    function strip_open(win) {
      const where = strip_items(win);
      if (!where) return false;
      if (is_tab(where.current)) win.gBrowser.selectedTab = where.current;
      else if (has_function(where.current, "click")) where.current.click();
      else return false;
      return true;
    }

    // Folds or unfolds the group of the item: a group label, or a tab in a group, whose label then takes the strip's focus.
    const strip_fold = (collapsed) => (win) => {
      const where = strip_items(win);
      const group = where?.current?.group;
      if (!group || typeof group !== "object" || !("collapsed" in group)) return false;
      group.collapsed = collapsed;
      const label = group.labelElement;
      if (collapsed && is_tab(where.current) && label && where.strip.ariaFocusableItems.includes(label)) where.strip.ariaFocusedItem = label;
      return true;
    };

    function strip_close(win) {
      const where = strip_items(win);
      if (!where || !is_tab(where.current) || !has_function(win.gBrowser, "removeTab")) return false;
      win.gBrowser.removeTab(where.current);
      return true;
    }

    function strip_filter(win) {
      if (!has_function(win.gTabsPanel, "showAllTabsPanel")) return false;
      win.gTabsPanel.showAllTabsPanel(null, "desertfox");
      return true;
    }

    function panel_filter(win, place) {
      const box = search_box_of(place.doc);
      if (!has_function(box, "focus")) return false;
      box.focus();
      return true;
    }

    // An open tabs row holds its tab as `tabElement`.
    function panel_close(win, place) {
      let row = deep_active(place.doc);
      while (row && !row.tabElement) row = composed_parent(row);
      const tab = row?.tabElement;
      if (!tab || !has_function(win.gBrowser, "removeTabs")) return false;
      win.gBrowser.removeTabs([tab]);
      return true;
    }

    // Escape in the search box goes to the list. Anywhere else it goes back to the page region that had the focus before the sidebar.
    // An empty list, or a row that cannot take the focus, leaves the focus in the box, and Firefox does nothing with Escape there. Then it goes to the page too.
    function leave(win, place) {
      if (place.field) {
        const list = list_of(place.doc);
        if (has_function(list, "focus")) {
          list.focus();
          if (!is_field(deep_active(place.doc))) return true;
        }
      }
      return leave_to_page(win);
    }

    const ACTIONS = {
      "sidebar.down": { panel: typed("ArrowDown"), strip: strip_focus(({ index }) => index + 1) },
      "sidebar.up": { panel: typed("ArrowUp"), strip: strip_focus(({ index }) => index - 1) },
      "sidebar.first": { panel: typed("Home"), strip: strip_focus(() => 0) },
      "sidebar.last": { panel: typed("End"), strip: strip_focus(({ items }) => items.length - 1) },
      "sidebar.open": { panel: typed("Enter"), strip: strip_open },
      "sidebar.expand": { panel: typed("ArrowRight"), strip: strip_fold(false) },
      "sidebar.collapse": { panel: typed("ArrowLeft"), strip: strip_fold(true) },
      "sidebar.close_item": { panel: panel_close, strip: strip_close },
      "sidebar.filter": { panel: panel_filter, strip: strip_filter },
      [LEAVE]: { panel: leave, strip: leave },
    };

    // ---- The way back: the page region that last had the focus in each window, the page, the split partner or a docked DevTools.

    const last_page_focus = new WeakMap();

    function page_region_of(win, element) {
      if (element?.localName === "browser" && win.gBrowser.getTabForBrowser?.(element)) return element;
      if (String(element?.ownerDocument?.documentURI ?? "").startsWith("about:devtools-toolbox")) return element;
      if (element?.localName === "iframe" && /devtools-toolbox/.test(element.className ?? "")) return element;
      return undefined;
    }

    // A remembered page counts while its tab is shown: selected, or the other half of the selected tab's split view.
    function still_shown(win, element) {
      if (!element?.isConnected) return false;
      if (element.localName !== "browser") return true;
      const tab = win.gBrowser.getTabForBrowser(element);
      const selected = win.gBrowser.selectedTab;
      return !!tab && (tab === selected || (!!tab.splitview && tab.splitview === selected?.splitview));
    }

    function leave_to_page(win) {
      const remembered = last_page_focus.get(win)?.deref();
      const target = still_shown(win, remembered) ? remembered : win.gBrowser.selectedBrowser;
      if (!has_function(target, "focus")) return false;
      target.focus();
      return true;
    }

    // ---- Windows.

    const attached = new Map();
    const loading = new Map();
    let stopped = false;

    function on_key(win, record, event) {
      if (typing || !event.isTrusted || event.defaultPrevented || event.isComposing) return;
      const place = place_of(win, event.originalTarget ?? event.target);
      if (!place) {
        record.pending = undefined;
        return;
      }
      if (popup_owns_keys(win) || !core.may_act(win)) return;
      const token = core.token_of(event);
      if (!token) return;
      const choice = decide(place, token, record.pending, (keys) => core.sidebar_row(win, keys));
      record.pending = choice.pending;
      if (!choice.take) return;
      // The action runs first, so one that refuses or throws leaves the key to Firefox.
      if (choice.id && ACTIONS[choice.id][place.kind](win, place) === false) return;
      event.preventDefault();
      event.stopPropagation();
    }

    function attach(win) {
      if (stopped || attached.has(win) || win.document?.documentElement?.getAttribute("windowtype") !== BROWSER) return;
      const record = { pending: undefined };
      const guarded = (handler) => (event) => {
        try {
          handler(event);
        } catch (error) {
          // A Firefox internal that changed lands here: the key goes on as if the feature were not there.
          core.log_once(`a key was left alone after an error in the sidebar keys: ${error}`);
        }
      };
      const keydown = guarded((event) => on_key(win, record, event));
      const focus = guarded((event) => {
        record.pending = undefined;
        const region = page_region_of(win, event.originalTarget ?? event.target);
        if (region) last_page_focus.set(win, new WeakRef(region));
      });
      const blur = () => (record.pending = undefined);
      const unload = () => detach(win);
      const root = win.windowRoot;
      root.addEventListener("keydown", keydown, true);
      win.addEventListener("focus", focus, true);
      win.addEventListener("blur", blur);
      win.addEventListener("unload", unload, { once: true });
      attached.set(win, () => {
        root.removeEventListener("keydown", keydown, true);
        win.removeEventListener("focus", focus, true);
        win.removeEventListener("blur", blur);
        win.removeEventListener("unload", unload);
      });
    }

    function detach(win) {
      attached.get(win)?.();
      attached.delete(win);
    }

    // A window's type is known only once its document has loaded. A window just opened shows a finished about:blank first.
    function attach_when_loaded(win) {
      if (stopped || attached.has(win) || loading.has(win)) return;
      if (win.document?.readyState === "complete" && win.location?.href !== "about:blank") return attach(win);
      const on_load = () => {
        loading.delete(win);
        try {
          attach(win);
        } catch (error) {
          core.log_once(`the sidebar keys skipped a window after an error: ${error}`);
        }
      };
      win.addEventListener("load", on_load, { once: true });
      loading.set(win, () => win.removeEventListener("load", on_load));
    }

    const window_watcher = {
      observe(subject, topic) {
        if (topic === "domwindowclosed") {
          loading.get(subject)?.();
          loading.delete(subject);
          return;
        }
        if (topic !== "domwindowopened") return;
        try {
          attach_when_loaded(subject);
        } catch (error) {
          core.log_once(`the sidebar keys skipped a window after an error: ${error}`);
        }
      },
    };

    function stop_all() {
      if (stopped) return;
      stopped = true;
      try {
        Services.ww.unregisterNotification(window_watcher);
      } catch (_) {
        // It was never registered: the start failed before it.
      }
      for (const win of [...attached.keys()]) detach(win);
      for (const undo_load of loading.values()) undo_load();
      loading.clear();
    }

    try {
      core.on_shut_down(stop_all);
      Services.ww.registerNotification(window_watcher);
      for (const win of Services.wm.getEnumerator(BROWSER)) attach_when_loaded(win);
    } catch (error) {
      stop_all();
      throw error;
    }
  }
})(this);
