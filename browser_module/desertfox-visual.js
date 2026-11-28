// DesertFox browser module, the visual feature: caret and visual mode on a parent-process about: page (about:preferences, about:support, about:addons). See docs/design/browser_module.md, "Caret and visual mode on about: pages".
// It uses Firefox's own caret browsing and selection, and the status bar shows CARET, VISUAL or V-LINE. It runs the native commands `mode.caret` and `mode.visual {line?}` that a key leaf of the tree names, and that a later hint pick can call with a `target` element in the run context.
// Moves inside a mode stay Firefox's own (the arrow keys, and Shift with them to extend). Escape ends the mode. The motion engine is a later piece.
// The caret-browsing pref is the user's. It is saved before the first mode takes it and given back on every way out: Escape, a tab switch, a page that goes away, a closing window, the module or the setting turning off, and an error here. The saved value also sits in a private pref, so the next start gives it back after a crash.
// In a window it asks the core to load it into the core sandbox, where it defines the commands once per process.

(function desertfox_browser_module_visual(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the visual feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The feature stays off instead, so the extension sends it no leaf.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the visual feature is off for this session: ${error}`);
  }

  function start(core) {
    const missing = ["may_act", "on_shut_down", "on_hello", "watch_session", "send", "deep_active", "is_field", "set_hello_flag", "define_command"].find((name) => typeof core[name] !== "function");
    if (missing) throw new Error(`the core has no ${missing}`);
    const CARET_PREF = "accessibility.browsewithcaret";
    // "unset", "true" or "false": what the pref was before a mode took it. Empty when no mode holds it.
    const SAVED_PREF = "desertfox.browser_module.caret_saved";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const STATE_KEY = "desertfox_browser_module_state";
    const MAX_FRAME_DEPTH = 4;
    const ELEMENT_NODE = 1;
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

    // ---- The caret-browsing pref. Windows hold it together: the first takes and saves it, the last gives it back.

    const holders = new Set();
    // True while this file writes the prefs, so its own change does not look like the user's.
    let writing = false;
    const writes = (write) => {
      writing = true;
      try {
        write();
      } finally {
        writing = false;
      }
    };

    function restore_saved_pref() {
      const saved = Services.prefs.getStringPref(SAVED_PREF, "");
      if (saved === "") return;
      writes(() => {
        try {
          if (saved === "unset") Services.prefs.clearUserPref(CARET_PREF);
          else Services.prefs.setBoolPref(CARET_PREF, saved === "true");
        } finally {
          Services.prefs.clearUserPref(SAVED_PREF);
        }
      });
    }

    function take_caret_pref(win) {
      if (holders.size === 0) {
        const was_set = Services.prefs.prefHasUserValue(CARET_PREF);
        // Saved first: a crash after the next line still leaves the way back.
        writes(() => {
          Services.prefs.setStringPref(SAVED_PREF, was_set ? String(Services.prefs.getBoolPref(CARET_PREF, false)) : "unset");
          Services.prefs.setBoolPref(CARET_PREF, true);
        });
      }
      holders.add(win);
    }

    function give_back_caret_pref(win) {
      if (holders.delete(win) && holders.size === 0) restore_saved_pref();
    }

    // A start after a crash in an earlier session gives back what that session took.
    restore_saved_pref();

    // ---- The page of a mode.

    const modes = new Map();

    const tab_id_of = (tab) => {
      try {
        return ExtensionParent.apiManager.global.tabTracker.getId(tab);
      } catch (_) {
        return undefined;
      }
    };

    // The page document of a tab, only for a parent-process about: page. A page in a content process has no window here.
    function page_document(browser) {
      if (browser.currentURI?.scheme !== "about") return undefined;
      return browser.contentWindow?.document ?? undefined;
    }

    // The focused element and its document, followed through the frames that hold the focus.
    function focus_of(doc) {
      let element = core.deep_active(doc);
      for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
        const inner = element && (element.localName === "iframe" || element.localName === "frame" || element.localName === "browser") ? element.contentDocument : null;
        if (!inner) break;
        doc = inner;
        element = core.deep_active(inner);
      }
      return { doc, element };
    }

    const is_target = (target) => typeof target === "object" && target !== null && target.nodeType === ELEMENT_NODE && !!target.ownerDocument?.defaultView;

    // Fractions of the view, tried in turn for text to start visual mode on.
    const START_POINTS = [[0.25, 0.25], [0.5, 0.3], [0.3, 0.5], [0.5, 0.5], [0.2, 0.15], [0.6, 0.2], [0.4, 0.7], [0.15, 0.4]];

    // Puts Firefox's own selection where visual mode starts: the target's contents, the selection that exists, or the text at a point of the view. Gives false when there is none, so no mode starts.
    function select_for_visual(doc, target, line) {
      const selection = doc.defaultView.getSelection();
      if (target) {
        selection.selectAllChildren(target);
        return !selection.isCollapsed;
      }
      if (selection.rangeCount > 0) return extend_here(selection, line);
      // Nothing is selected: try a few points of the view until one has text to extend over.
      const view = doc.defaultView;
      for (const [x, y] of START_POINTS) {
        const place = doc.caretPositionFromPoint?.(view.innerWidth * x, view.innerHeight * y);
        if (!place) continue;
        selection.collapse(place.offsetNode, place.offset);
        if (extend_here(selection, line)) return true;
      }
      return false;
    }

    // Takes the line, or one character, from the caret. A collapsed selection stays collapsed where there is no text.
    function extend_here(selection, line) {
      if (line) {
        selection.modify("move", "backward", "lineboundary");
        selection.modify("extend", "forward", "lineboundary");
      } else if (selection.isCollapsed) selection.modify("extend", "forward", "character");
      return !selection.isCollapsed;
    }

    // ---- Entering and leaving.

    function report(record, mode) {
      const tab_id = tab_id_of(record.tab);
      if (tab_id === undefined) return core.log_once("the visual mode was not reported: the tab has no id");
      const sent = core.send("visual.report", { tab_id, mode });
      if (!sent.ok) core.log_once(`the visual mode was not reported: ${sent.problem}`);
    }

    // `quiet` leaves the report to the mode that replaces this one. Every step runs, so the pref goes back even when a step throws.
    function leave(win, { drop_selection = false, quiet = false } = {}) {
      const record = modes.get(win);
      if (!record) return;
      modes.delete(win);
      try {
        for (const undo of record.undo.splice(0)) {
          try {
            undo();
          } catch (error) {
            core.log_once(`a visual mode listener was not removed: ${error}`);
          }
        }
        if (drop_selection && record.mode !== "caret") {
          try {
            const selection = record.doc.defaultView.getSelection();
            if (selection.rangeCount > 0) selection.collapse(selection.focusNode, selection.focusOffset);
          } catch (error) {
            core.log_once(`visual mode could not drop its selection: ${error}`);
          }
        }
      } finally {
        try {
          give_back_caret_pref(win);
        } finally {
          if (!quiet) {
            try {
              report(record, "normal");
            } catch (error) {
              core.log_once(`the end of the visual mode was not reported: ${error}`);
            }
          }
        }
      }
    }

    const leave_all = () => {
      for (const win of [...modes.keys()]) leave(win);
      // A holder whose record is gone would keep the pref taken.
      for (const win of [...holders]) give_back_caret_pref(win);
    };

    function listen(record, target, type, listener, capture = false) {
      target.addEventListener(type, listener, capture);
      record.undo.push(() => target.removeEventListener(type, listener, capture));
    }

    // Escape ends the mode and goes no further. A key the core or the page already used, such as an Escape that left a field, leaves the mode as it is.
    // The key came from the mode's own page: its document, or the tab's <browser> when no document has the focus. The address bar, the find bar, DevTools, a subdialog and a menu keep their own Escape.
    const from_page = (record, event) => {
      const target = event.originalTarget ?? event.target;
      return target === record.browser || target?.ownerDocument === record.doc || target?.ownerDocument === record.top_doc;
    };

    function on_key(win, event) {
      const record = modes.get(win);
      if (!record || !from_page(record, event) || event.key !== "Escape" || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      leave(win, { drop_selection: true });
    }

    function enter(context, mode) {
      const { window: win, browser, tab, target } = context;
      if (!win || !browser || !tab || !core.may_act(win) || win.gBrowser?.selectedTab !== tab) return;
      const top_doc = page_document(browser);
      if (!top_doc) return;
      const held = modes.get(win);
      if (held && held.mode === mode && held.browser === browser && !target) return;
      const given = is_target(target) ? target : undefined;
      if (target !== undefined && !given) return;
      const { doc, element } = given ? { doc: given.ownerDocument, element: undefined } : focus_of(top_doc);
      // A key typed into a field is the field's.
      if (!given && core.is_field(element)) return;
      leave(win, { quiet: true });
      const record = { win, browser, tab, mode, doc, top_doc, undo: [] };
      modes.set(win, record);
      try {
        take_caret_pref(win);
        const end = () => leave(win);
        listen(record, win, "keydown", (event) => {
          try {
            on_key(win, event);
          } catch (error) {
            core.log_once(`visual mode ended after an error: ${error}`);
            leave(win);
          }
        }, true);
        listen(record, win, "unload", end);
        // The pref is global, so a mode left on in a window in the back would turn caret browsing on in every other window.
        listen(record, win, "deactivate", end);
        listen(record, win.gBrowser.tabContainer, "TabSelect", end);
        listen(record, top_doc.defaultView, "pagehide", end);
        if (doc !== top_doc) listen(record, doc.defaultView, "pagehide", end);
        if (mode !== "caret" && !select_for_visual(doc, given, mode === "visual_line")) return void leave(win);
        report(record, mode);
      } catch (error) {
        core.log_once(`visual mode ended after an error: ${error}`);
        leave(win);
      }
    }

    // An error in the mode's own code ends every mode, so the pref goes back.
    const run_mode = (context, mode) => {
      try {
        enter(context, mode);
      } catch (error) {
        core.log_once(`visual mode ended after an error: ${error}`);
        leave_all();
      }
    };

    core.define_command("mode.caret", { args: {}, run: (context) => run_mode(context, "caret") });
    core.define_command("mode.visual", { args: { line: { type: "optional_int" } }, run: (context) => run_mode(context, context.args.line === 1 ? "visual_line" : "visual") });

    // A new DesertFox, the setting off, the consent setting or the toolbar switch off, and the module shutting down end the modes. None of them sends a key.
    core.on_hello(leave_all);
    core.watch_session([STATE_KEY], (_key, state) => {
      if (state?.enabled !== true) leave_all();
    });
    const on_pref = () => {
      if (!Services.prefs.getBoolPref(ENABLED_PREF, false)) leave_all();
    };
    Services.prefs.addObserver(ENABLED_PREF, on_pref);
    // The user (about:config, F7) turned caret browsing off while a mode held it. The mode ends, and their value stays as it is.
    const on_caret_pref = () => {
      if (writing || holders.size === 0 || Services.prefs.getBoolPref(CARET_PREF, false) === true) return;
      holders.clear();
      writes(() => Services.prefs.clearUserPref(SAVED_PREF));
      leave_all();
    };
    Services.prefs.addObserver(CARET_PREF, on_caret_pref);
    core.on_shut_down(() => {
      leave_all();
      Services.prefs.removeObserver(ENABLED_PREF, on_pref);
      Services.prefs.removeObserver(CARET_PREF, on_caret_pref);
    });
    // Said last, so the extension sends the mode leaves only to a module that runs them.
    core.set_hello_flag("visual_mode", true);
  }
})(this);
