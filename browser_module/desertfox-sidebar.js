// DesertFox browser module, the sidebar feature: keys in Firefox's own sidebar, the vertical tab strip and the history, bookmarks and open tabs panels. See docs/design/browser_module.md.
// The keys come from the sidebar table in the extension's state (the core's sidebar_row). They act only with the focus in one of those places, never in an add-on's sidebar and never in a text field, except the key that leaves.
// In a panel the moves type arrow keys, so Firefox keeps its own selection and scrolling. In the strip they move the strip's own keyboard focus.
// `<A-o>` (`mode.normal_once`) there holds the window's keys for one key sequence of the locked-page tree, which runs as on a locked page. The extension asks for it with `sidebar.normal_once`.
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
    const missing = ["may_act", "on_shut_down", "sidebar_row", "type_key", "token_of", "is_field", "deep_active", "focused_element", "keys_held_by"].find((name) => typeof core[name] !== "function");
    if (missing) {
      core.log_once(`the core has no ${missing}, so the sidebar keys stay off`);
      return;
    }

    // An older core lacks the calls of the one-shot prefix: the sidebar keys stay, and the prefix stays off.
    const once_missing = ["register_kind", "set_hello_flag", "on_hello", "hold_keys", "release_keys", "scope_tree", "send", "run_command", "ime_in_field"].find((name) => typeof core[name] !== "function");
    if (once_missing) core.log_once(`the core has no ${once_missing}, so <A-o> stays off in the sidebar`);

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
    // A docked toolbox stays connected while its tab is in the background. It sits in its tab's browser container, so it counts while that tab is shown.
    function still_shown(win, element) {
      if (!element?.isConnected) return false;
      const selected = win.gBrowser.selectedTab;
      if (element.localName === "browser") {
        const tab = win.gBrowser.getTabForBrowser(element);
        return !!tab && (tab === selected || (!!tab.splitview && tab.splitview === selected?.splitview));
      }
      const frame = frame_in_window(win, element);
      const shown_tabs = Array.isArray(selected?.splitview?.tabs) ? selected.splitview.tabs : [selected];
      return shown_tabs.some((tab) => win.gBrowser.getBrowserContainer?.(tab?.linkedBrowser)?.contains?.(frame) === true);
    }

    // The frame in the window's own document that holds `element`, through the frames of a toolbox and its tools.
    function frame_in_window(win, element) {
      let node = element;
      while (node && node.ownerDocument !== win.document) node = node.ownerDocument?.defaultView?.browsingContext?.embedderElement;
      return node;
    }

    function leave_to_page(win) {
      const remembered = last_page_focus.get(win)?.deref();
      const target = still_shown(win, remembered) ? remembered : win.gBrowser.selectedBrowser;
      if (!has_function(target, "focus")) return false;
      target.focus();
      return true;
    }

    // ---- The one-shot normal prefix. The tree is the extension's, read here as data: a child counts only as an own key, a leaf only as "forward" or a native command, which the core checks again.

    const ONCE_OWNER = "sidebar_once";
    const ONCE_KEY = "<A-o>";
    // The hold eats every key of the window, so it must end on its own: this long after the prefix and after each key of the sequence.
    const ONCE_IDLE_MS = 3000;
    // MAX_SEQUENCE_KEYS of the protocol, and the count digits of the extension's matcher, which keep a count within MAX_COUNT.
    const MAX_ONCE_KEYS = 8;
    const MAX_COUNT_DIGITS = 6;
    // A count repeats a native command at most this often, as on a locked page.
    const MAX_NATIVE_REPEAT = 100;
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const child_of = (node, token) => (is_record(node?.children) && Object.hasOwn(node.children, token) ? node.children[token] : undefined);
    const is_native = (leaf) => is_record(leaf) && typeof leaf.native === "string" && is_record(leaf.args);

    // Per window: { tree, node, keys, digits, element, timer }, the walk of the one sequence and the element that had the focus.
    const onces = new Map();
    // The panel document, or "strip", or null outside the sidebar.
    const place_key = (win, element) => {
      const place = place_of(win, element);
      return place ? (place.doc ?? place.kind) : null;
    };

    // A digit starts a count only before the first key, and 0 only after another digit, unless the tree binds it, as in the extension's matcher.
    // { pending } for a key that goes on, else { leaf, keys, count } or {} for a key that binds nothing.
    function once_step(once, token) {
      if (once.keys.length === 0 && /^[0-9]$/.test(token) && once.digits.length < MAX_COUNT_DIGITS && (once.digits !== "" || (token !== "0" && child_of(once.tree, token) === undefined))) {
        once.digits += token;
        return { pending: true };
      }
      const next = child_of(once.node, token);
      once.keys.push(token);
      if (is_record(next) && "children" in next && once.keys.length < MAX_ONCE_KEYS) {
        once.node = next;
        return { pending: true };
      }
      if (next === "forward" || is_native(next)) return { leaf: next, keys: once.keys, count: once.digits === "" ? undefined : Number(once.digits) };
      return {};
    }

    const once_timer = (win, once) => {
      win.clearTimeout?.(once.timer);
      once.timer = win.setTimeout(() => onces.get(win) === once && end_once(win), ONCE_IDLE_MS);
    };

    function end_once(win) {
      const once = onces.get(win);
      if (!once) return;
      onces.delete(win);
      win.clearTimeout?.(once.timer);
      core.release_keys(win, ONCE_OWNER);
    }

    function arm_once() {
      const win = Services.focus?.activeWindow;
      if (!win || win.closed || !attached.has(win) || !core.may_act(win)) return { ok: false, error: "No Firefox window has the focus" };
      const element = core.focused_element(win);
      if (!place_of(win, element)) return { ok: false, error: "The focus is not in the sidebar" };
      const tree = core.scope_tree(win);
      if (!is_record(tree) || !is_record(tree.children)) return { ok: false, error: "DesertFox sent no keys for here" };
      if (popup_owns_keys(win) || !core.hold_keys(win, ONCE_OWNER)) return { ok: false, error: "Another feature holds the keys" };
      const once = { tree, node: tree, keys: [], digits: "", element };
      onces.set(win, once);
      once_timer(win, once);
      return { ok: true };
    }

    // Every key goes nowhere but the sequence. A key that binds nothing ends it, as in a page, so it never types into a search box.
    function once_key(win, once, event) {
      // A guard the arm passed can fail later: the module or the toolbar switch went off, DesertFox went away, a menu opened. The key then goes on.
      if (!core.may_act(win) || core.keys_held_by(win) !== ONCE_OWNER || popup_owns_keys(win)) return end_once(win);
      const token = core.token_of(event);
      if (!token) return;
      event.preventDefault();
      event.stopPropagation();
      if (token === ESCAPE || token === ONCE_KEY) return end_once(win);
      const step = once_step(once, token);
      if (step.pending) return once_timer(win, once);
      end_once(win);
      if (step.leaf) run_once(win, once, step, event.repeat === true);
    }

    function run_once(win, once, { leaf, keys, count }, repeat) {
      const path = keys.join(" ");
      if (leaf === "forward") {
        const opens_line = Array.isArray(once.tree.line_keys) && once.tree.line_keys.includes(path);
        const sent = core.send("run", { keys: path, count: count ?? 0 }, () => opens_line || win.setTimeout(() => focus_back(win, once.element), 0));
        if (!sent.ok) core.log_once(`a key was not sent to DesertFox: ${sent.problem}`);
        return;
      }
      const { native, args, count_rule } = leaf;
      const counted = count !== undefined && is_record(count_rule) && typeof count_rule.param === "string" ? { ...args, [count_rule.param]: count } : args;
      const times = count !== undefined && count_rule === "repeat" ? Math.min(count, MAX_NATIVE_REPEAT) : 1;
      const context = { window: win, browser: win.gBrowser.selectedBrowser, tab: win.gBrowser.selectedTab, repeat };
      for (let time = 0; time < times && core.run_command(native, counted, context); time++);
      win.setTimeout(() => focus_back(win, once.element), 0);
    }

    // After the command the focus goes back to the sidebar element that had it, unless the command put it in a text field (the command line, the address bar) or the user left the window.
    function focus_back(win, element) {
      if (!element?.isConnected || win.closed || Services.focus?.activeWindow !== win || !core.may_act(win)) return;
      const now = core.focused_element(win);
      if (now === element || core.is_field(now) || core.ime_in_field(win) || !has_function(element, "focus")) return;
      element.focus();
    }

    // ---- Windows.

    const attached = new Map();
    const loading = new Map();
    let stopped = false;

    function on_key(win, record, event) {
      if (typing || !event.isTrusted || event.defaultPrevented || event.isComposing) return;
      const once = onces.get(win);
      if (once) return once_key(win, once, event);
      const place = place_of(win, event.originalTarget ?? event.target);
      if (!place) {
        record.pending = undefined;
        return;
      }
      // Another feature holds the window's keys (a hint session on the chrome): the sidebar claims nothing until it lets go.
      if (core.keys_held_by(win) !== undefined || popup_owns_keys(win) || !core.may_act(win)) return;
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
        // The focus left the place the prefix was typed in: the sequence ends there.
        const once = onces.get(win);
        const here = once && place_key(win, core.focused_element(win));
        if (once && (here === null || here !== place_key(win, once.element))) end_once(win);
        const region = page_region_of(win, event.originalTarget ?? event.target);
        if (region) last_page_focus.set(win, new WeakRef(region));
      });
      const blur = () => {
        record.pending = undefined;
        end_once(win);
      };
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
      end_once(win);
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
      if (!once_missing) {
        core.register_kind("sidebar.normal_once", arm_once);
        // A new DesertFox knows nothing of a sequence typed for the one before.
        core.on_hello(() => [...onces.keys()].forEach(end_once));
        core.set_hello_flag("sidebar_once", true);
      }
      Services.ww.registerNotification(window_watcher);
      for (const win of Services.wm.getEnumerator(BROWSER)) attach_when_loaded(win);
    } catch (error) {
      stop_all();
      throw error;
    }
  }
})(this);
