// DesertFox browser module, the popup walk feature: in an open menu or panel, the Library, Page Info and Picture-in-Picture, j, k, h and l move as the arrow keys do. See docs/design/browser_module.md.
// Firefox does all the moving. The feature takes the letter and types the matching arrow key into the same window once the letter's event is over, so each menu, panel, tree and list handles it as its own arrow key.
// It also closes the Library on Escape when the focus is in one of its trees and the search box is empty, since Firefox binds no Escape there.
// In a window it asks the core to load it into the core sandbox, where it starts once per process and attaches to every chrome window of the four types, open or opened later.

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
    // The fixed translation. The letters are the walk's own, not key rows of the extension: a menu has no DesertFox mode or keymap.
    const WALK_KEYS = { j: "ArrowDown", k: "ArrowUp", h: "ArrowLeft", l: "ArrowRight" };
    const KEY_CODES = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
    const BROWSER = "navigator:browser";
    const LIBRARY = "Places:Organizer";
    // In these windows every list, tree and radio group walks, so no open popup is needed.
    const WALK_WINDOWS = new Set([LIBRARY, "Browser:page-info", "Toolkit:PictureInPicture"]);
    const ATTACHED_TYPES = new Set([BROWSER, ...WALK_WINDOWS]);
    const DIALOG_LISTS = new Set(["tree", "richlistbox", "listbox", "radiogroup", "radio"]);

    const Ci = Components.interfaces;
    const Cc = Components.classes;

    const attached = new Map();
    const loading = new Map();
    let stopped = false;

    const window_type = (win) => win.document?.documentElement?.getAttribute("windowtype") ?? "";

    const TEXT_INPUT = /^(?!button$|checkbox$|radio$|submit$|reset$|image$|file$|range$|color$|hidden$)/;
    const is_field = (node) =>
      !!node?.localName &&
      (node.isContentEditable || node.localName === "textarea" || node.localName === "select" || (node.localName === "input" && TEXT_INPUT.test(node.type || "text")));

    function deep_active(doc) {
      let active_element = doc?.activeElement;
      while (active_element?.shadowRoot?.activeElement) active_element = active_element.shadowRoot.activeElement;
      return active_element;
    }

    // The element with the focus in this window's own process, through frames of this process (a settings sub-dialog, a tab-modal prompt).
    function focused_element(win) {
      let element = win.document.commandDispatcher?.focusedElement ?? deep_active(win.document);
      while (element?.localName === "browser" && !element.isRemoteBrowser && element.contentDocument) {
        const inner = deep_active(element.contentDocument);
        if (!inner) break;
        element = inner;
      }
      return element;
    }

    // A field of a page in another process is not in this one, so the window's input state stands in for it, as in the core.
    const field_focused = (win) => {
      const ime = win.windowUtils?.IMEStatus;
      return is_field(focused_element(win)) || ime === Ci.nsIDOMWindowUtils.IME_STATUS_ENABLED || ime === Ci.nsIDOMWindowUtils.IME_STATUS_PASSWORD;
    };
    const in_field = (win, target) => is_field(target) || field_focused(win);

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

    // Why the walk takes this key here, as a check that must still hold when the arrow key goes out, or undefined to leave the key alone.
    function walk_reason(win, record, event) {
      const popups = open_popups(record);
      const menu = popups.find(takes_keys);
      if (menu) return () => is_open(menu);
      const focused = focused_element(win);
      if (in_field(win, event.originalTarget) || in_extension_popup(event.target) || in_extension_popup(focused)) return undefined;
      const panel = popups.find(walking_panel);
      if (panel) return () => is_open(panel) && !field_focused(win);
      if (WALK_WINDOWS.has(record.type)) return () => !field_focused(win);
      const list = dialog_list(win, focused);
      if (list) return () => focused_element(win) === list;
      return undefined;
    }

    // The arrow key goes out after the letter's event is over: a text input processor refuses to start inside a key's dispatch.
    // The window may close and the popup may shut before then. The key is then dropped, so it never lands on whatever is under the popup.
    function replay(win, key, still_holds) {
      win.setTimeout(() => {
        try {
          if (stopped || win.closed || !attached.has(win) || !still_holds()) return;
          const processor = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
          if (!processor.beginInputTransaction(win, () => true)) {
            core.log_once("Firefox refused to type the walk's arrow key");
            return;
          }
          const arrow = new win.KeyboardEvent("", { key, code: key, keyCode: KEY_CODES[key] });
          processor.keydown(arrow);
          processor.keyup(arrow);
        } catch (error) {
          core.log_once(`a walk key was dropped after an error: ${error}`);
        }
      }, 0);
    }

    const take = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    function on_key(win, record, event) {
      if (core.keys_held_by(win) !== undefined) return;
      if (!event.isTrusted || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      const arrow = Object.hasOwn(WALK_KEYS, event.key) ? WALK_KEYS[event.key] : undefined;
      const escape = event.key === "Escape" && !event.shiftKey && record.type === LIBRARY;
      if (!arrow && !escape) return;
      if (!core.may_act(win)) return;
      if (escape) {
        if (!in_field(win, event.originalTarget) && library_closes_on_escape(win, record)) {
          take(event);
          win.setTimeout(() => win.close(), 0);
        }
        return;
      }
      const still_holds = walk_reason(win, record, event);
      if (!still_holds) return;
      take(event);
      replay(win, arrow, still_holds);
    }

    // Escape in the Library closes it from a tree with no search text. With a menu open, Escape closes the menu as usual.
    function library_closes_on_escape(win, record) {
      if (open_popups(record).length > 0) return false;
      if (focused_element(win)?.localName !== "tree") return false;
      const search = win.document.getElementById("searchFilter");
      return !search?.value;
    }

    // ---- Windows.

    function attach(win) {
      if (stopped || attached.has(win) || !ATTACHED_TYPES.has(window_type(win))) return;
      const record = { type: window_type(win), popups: new Set() };
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
      const shown = guarded((event) => {
        const popup = event.originalTarget;
        if (is_tracked(popup)) record.popups.add(popup);
      });
      const hidden = guarded((event) => record.popups.delete(event.originalTarget));
      const unload = () => detach(win);
      // The window root hears a key before the window's own capture listeners, so the walk goes before the core, which could take the same letter as a scroll key.
      const root = win.windowRoot;
      root.addEventListener("keydown", keydown, true);
      win.addEventListener("popupshown", shown, true);
      win.addEventListener("popuphidden", hidden, true);
      win.addEventListener("unload", unload, { once: true });
      attached.set(win, () => {
        root.removeEventListener("keydown", keydown, true);
        win.removeEventListener("popupshown", shown, true);
        win.removeEventListener("popuphidden", hidden, true);
        win.removeEventListener("unload", unload);
        record.popups.clear();
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
