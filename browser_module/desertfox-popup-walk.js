// DesertFox browser module, the popup walk feature: in an open menu or panel, the Library, Page Info and Picture-in-Picture, j, k, h and l move as the arrow keys do. See docs/design/browser_module.md.
// Firefox does all the moving. The feature takes the letter and types the matching arrow key into the same window once the letter's event is over, so each menu, panel, tree and list handles it as its own arrow key.
// It also closes the Library on Escape when the focus is in one of its trees and the search box is empty, since Firefox binds no Escape there.
// In a window it asks the core to load it into the core sandbox, where it starts once per process and attaches to every chrome window of these types and DevTools windows, open or opened later.

(function desertfox_browser_module_popup_walk(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the popup walk feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The walk stays off instead, with nothing left registered.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the popup walk is off for this session: ${error}`);
  }

  function start(core) {
    const missing = ["may_act", "on_shut_down", "type_key", "token_of", "chrome_hint_keys", "is_field", "focused_element", "ime_in_field", "keys_held_by"].find((name) => typeof core[name] !== "function");
    if (missing) throw new Error(`the core has no ${missing}`);
    // The fixed translation. The letters are the walk's own, not key rows of the extension: a menu has no DesertFox mode or keymap.
    const WALK_KEYS = { j: "ArrowDown", k: "ArrowUp", h: "ArrowLeft", l: "ArrowRight" };
    const BROWSER = "navigator:browser";
    const LIBRARY = "Places:Organizer";
    // In these windows every list, tree and radio group walks, so no open popup is needed.
    const PAGE_INFO = "Browser:page-info";
    const WALK_WINDOWS = new Set([LIBRARY, PAGE_INFO, "Toolkit:PictureInPicture"]);
    // The windows chrome hints label as a whole.
    const HINT_WINDOWS = new Set([LIBRARY, PAGE_INFO]);
    // A DevTools window opens its context menus in its own document. With no menu open the walk leaves every key there to the core's DevTools keys.
    const ATTACHED_TYPES = new Set([BROWSER, "devtools:toolbox", ...WALK_WINDOWS]);
    const DIALOG_LISTS = new Set(["tree", "richlistbox", "listbox", "radiogroup", "radio"]);

    const attached = new Map();
    const loading = new Map();
    let stopped = false;

    const window_type = (win) => win.document?.documentElement?.getAttribute("windowtype") ?? "";

    // A field of a page in another process is not in this one, so the window's input state stands in for it.
    const field_focused = (win) => core.is_field(core.focused_element(win)) || core.ime_in_field(win);
    const in_field = (win, target) => core.is_field(target) || field_focused(win);

    // ---- What is open. Each window keeps the popups it saw open, checked again against their state on each use.

    const is_open = (popup) => popup.state === "open" || popup.state === "showing";
    // The address bar's and the forms' suggestion lists are panels too, and they own their arrow keys already.
    const is_tracked = (popup) => (popup.localName === "menupopup" || popup.localName === "panel") && popup.getAttribute("type") !== "autocomplete-richlistbox";

    function open_popups(record) {
      for (const popup of record.popups) if (!is_open(popup)) record.popups.delete(popup);
      return [...record.popups];
    }

    // A panel walks when it holds a multi-view (the app menu and its subviews, the extensions panel) or is the downloads list.
    // A permission prompt (`#notification-popup`) never does: with the focus in the page, an arrow key goes to the page.
    const walking_panel = (panel) => panel.localName === "panel" && panel.id !== "notification-popup" && (panel.id === "downloadsPanel" || !!panel.querySelector("panelmultiview"));

    // Another extension's popup is that extension's page: its keys are its own.
    const in_extension_popup = (node) => node?.localName === "browser" && node.isRemoteBrowser && !!node.closest?.("panel");

    // As chrome hints' `chrome_place` reads a panel: the focus can sit in a shadow root inside it, and a subview that slid in can leave nothing focused.
    function holds(root, node) {
      for (let at = node; at; at = at.parentNode ?? at.host) if (at === root) return true;
      return false;
    }
    const nothing_focused = (win, focused) => focused === win.document.documentElement || focused === win.document.body;

    // A list, tree or radio group with the focus in a dialog that Firefox shows inside the browser window (a settings sub-dialog).
    function dialog_list(win, focused) {
      if (!DIALOG_LISTS.has(focused?.localName)) return undefined;
      const doc = focused.ownerDocument;
      if (doc === win.document) return undefined;
      const frame = doc.defaultView?.browsingContext?.embedderElement;
      return frame?.classList?.contains("dialogFrame") ? focused : undefined;
    }

    // An open menu takes every key from the window, even with the focus in a field or another extension's popup: the field gets no letter meanwhile.
    // A menu that lets keys through to its field (`ignorekeys`) is the field's.
    const takes_keys = (popup) => popup.localName === "menupopup" && !popup.hasAttribute("ignorekeys");

    // Why the walk takes this key here, or undefined to leave the key alone. `still_holds` must still be true when the arrow key goes out.
    // `menu_owns_keys` marks the open menu that takes the window's keys, a focused field's too.
    // `in_hint_place` marks a focus where chrome hints can start, as their `chrome_place` reads it: the Library, Page Info, a dialog frame or inside an open panel.
    function walk_reason(win, record, event) {
      const popups = open_popups(record);
      const menu = popups.find(takes_keys);
      if (menu) return { still_holds: () => is_open(menu), menu_owns_keys: true };
      const focused = core.focused_element(win);
      if (in_field(win, event.originalTarget) || in_extension_popup(event.target) || in_extension_popup(focused)) return undefined;
      const panel = popups.find(walking_panel);
      if (panel) return { still_holds: () => is_open(panel) && !field_focused(win), in_hint_place: nothing_focused(win, focused) || holds(panel, focused) };
      if (WALK_WINDOWS.has(record.type)) return { still_holds: () => !field_focused(win), in_hint_place: HINT_WINDOWS.has(record.type) };
      const list = dialog_list(win, focused);
      if (list) return { still_holds: () => core.focused_element(win) === list, in_hint_place: true };
      return undefined;
    }

    // The core types the arrow key once the letter's event is over. A window or popup that closed meanwhile gets none, so it never lands on whatever was under the popup.
    const walk = (win, arrow, { still_holds, menu_owns_keys = false }) => core.type_key(win, arrow, () => !stopped && attached.has(win) && still_holds(), { menu_owns_keys });

    const take = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    // What the walk does with the key, run once it is sure to take it: true when it did, so the key stops. Undefined to leave the key alone.
    function action_for(win, record, event) {
      const arrow = Object.hasOwn(WALK_KEYS, event.key) ? WALK_KEYS[event.key] : undefined;
      if (arrow) {
        const reason = walk_reason(win, record, event);
        return reason && { act: () => walk(win, arrow, reason), in_hint_place: reason.in_hint_place === true };
      }
      if (event.key !== "Escape" || event.shiftKey || record.type !== LIBRARY) return undefined;
      if (in_field(win, event.originalTarget) || !library_closes_on_escape(win, record)) return undefined;
      return { act: () => (win.setTimeout(() => win.close(), 0), true), in_hint_place: true };
    }

    // Chrome hints match the first key of a `hint.browser` binding on the window root too, and in a window opened after startup they hear it after the walk.
    const may_start_hints = (win, event) => {
      const token = core.token_of(event);
      return core.chrome_hint_keys(win).some((keys) => keys[0] === token);
    };

    function on_key(win, record, event) {
      record.waiting = undefined;
      if (!event.isTrusted || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      if (!Object.hasOwn(WALK_KEYS, event.key) && event.key !== "Escape") return;
      if (!core.may_act(win)) return;
      const action = action_for(win, record, event);
      if (!action) return;
      // A hold can end within this key: chrome hints drop a binding's first keys on a key off the binding and leave that key alone.
      const waits = core.keys_held_by(win) !== undefined || (action.in_hint_place && may_start_hints(win, event));
      if (waits) record.waiting = { event, act: action.act };
      else if (action.act()) take(event);
    }

    // A key that waits gets here after the window root's listeners, chrome hints' among them. Chrome hints stop a key they take, so it never gets here, and their first keys hold the window.
    // On a browser window the core's listener runs before this one, so the core's own row for the key comes first. A key waits only where chrome hints can start, so an open menu and a panel the page's focus sits outside of keep the key from the core.
    function on_key_after_root(win, record, event) {
      const waiting = record.waiting;
      record.waiting = undefined;
      if (waiting?.event !== event || event.defaultPrevented || core.keys_held_by(win) !== undefined) return;
      if (waiting.act()) take(event);
    }

    // Escape in the Library closes it from a tree with no search text. With a menu open, Escape closes the menu as usual.
    function library_closes_on_escape(win, record) {
      if (open_popups(record).length > 0) return false;
      if (core.focused_element(win)?.localName !== "tree") return false;
      const search = win.document.getElementById("searchFilter");
      return !search?.value;
    }

    // ---- Windows.

    function attach(win) {
      if (stopped || attached.has(win) || !ATTACHED_TYPES.has(window_type(win))) return;
      const record = { type: window_type(win), popups: new Set(), waiting: undefined };
      for (const popup of win.document.querySelectorAll("menupopup, panel")) if (is_tracked(popup) && is_open(popup)) record.popups.add(popup);
      const guarded = (handler) => (event) => {
        try {
          handler(event);
        } catch (error) {
          // A Firefox internal that changed lands here: the key goes on as if the walk were not there.
          core.log_once(`a key was left alone after an error in the popup walk: ${error}`);
        }
      };
      const keydown = guarded((event) => on_key(win, record, event));
      const keydown_after_root = guarded((event) => on_key_after_root(win, record, event));
      const shown = guarded((event) => {
        const popup = event.originalTarget;
        if (is_tracked(popup)) record.popups.add(popup);
      });
      const hidden = guarded((event) => record.popups.delete(event.originalTarget));
      const unload = () => detach(win);
      // The window root hears a key before the window's own capture listeners, so the walk goes before the core, which could take the same letter as a scroll key.
      const root = win.windowRoot;
      root.addEventListener("keydown", keydown, true);
      win.addEventListener("keydown", keydown_after_root, true);
      win.addEventListener("popupshown", shown, true);
      win.addEventListener("popuphidden", hidden, true);
      win.addEventListener("unload", unload, { once: true });
      attached.set(win, () => {
        root.removeEventListener("keydown", keydown, true);
        win.removeEventListener("keydown", keydown_after_root, true);
        win.removeEventListener("popupshown", shown, true);
        win.removeEventListener("popuphidden", hidden, true);
        win.removeEventListener("unload", unload);
        record.popups.clear();
        record.waiting = undefined;
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
          core.log_once(`the popup walk skipped a window after an error: ${error}`);
        }
      };
      win.addEventListener("load", on_load, { once: true });
      loading.set(win, () => win.removeEventListener("load", on_load));
    }

    const window_watcher = {
      observe(subject, topic) {
        // A window that closes before it loads drops out here: its first about:blank unloads on the way to the real document, so an unload listener cannot tell.
        if (topic === "domwindowclosed") {
          loading.get(subject)?.();
          loading.delete(subject);
          return;
        }
        if (topic !== "domwindowopened") return;
        try {
          attach_when_loaded(subject);
        } catch (error) {
          core.log_once(`the popup walk skipped a window after an error: ${error}`);
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
      for (const win of Services.wm.getEnumerator(null)) attach_when_loaded(win);
    } catch (error) {
      stop_all();
      throw error;
    }
  }
})(this);
