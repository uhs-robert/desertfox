// DesertFox browser module, the selection: it answers `selection.read { tab_id }` with the text selected on a parent-process about: page (about:preferences, about:addons, about:config and the like), where no content script runs. See docs/design/browser_module.md, "Selection on locked pages".
// The text is data. It goes into the reply as text and is never run, parsed or used as an address. The cap and the cleaning here match the extension's, which checks the reply again.
// A page in a content process (a web page, about:reader, an error page) has no window in the parent, so the module refuses it and the extension reads nothing there.
// In a window it asks the core to load it into the core sandbox, where it registers its kind once per process.

(function desertfox_browser_module_selection(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the selection feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The feature stays off instead and the extension reads no selection on these pages.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the selection feature is off for this session: ${error}`);
  }

  function start(core) {
    const MAX_CHARS = 1000;
    // Pages inside pages: about:preferences and about:addons nest their own documents.
    const MAX_FRAME_DEPTH = 4;
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

    const refuse = (error) => ({ ok: false, error });
    const is_browser_window = (win) => !!win && !win.closed && win.document?.documentElement?.getAttribute("windowtype") === "navigator:browser" && !!win.gBrowser;

    // The window that holds the tab, or nothing. Not `tab.ownerGlobal`: the window as the sandbox sees it through that path hides `gBrowser`.
    function window_of(tab_id) {
      let tab = null;
      try {
        tab = ExtensionParent.apiManager.global.tabTracker.getTab(tab_id, null);
      } catch (_) {
        tab = null;
      }
      if (!tab || tab.closing) return undefined;
      const win = [...Services.wm.getEnumerator("navigator:browser")].find((each) => is_browser_window(each) && each.gBrowser.getTabForBrowser(tab.linkedBrowser) === tab);
      return win ? { win, tab } : undefined;
    }

    // The document that holds the focus, found through the frames that hold it.
    function focused_document(doc) {
      for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
        const active = doc.activeElement;
        const inner = active && (active.localName === "iframe" || active.localName === "frame" || active.localName === "browser") ? active.contentDocument : null;
        if (!inner) break;
        doc = inner;
      }
      return doc;
    }

    // A selected range in a text field first, then the page's own selection, as `selected_text` does on a web page.
    function selected_text(doc) {
      const active = doc.activeElement;
      if (active && (active.localName === "input" || active.localName === "textarea")) {
        try {
          const { selectionStart, selectionEnd, value } = active;
          if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) return String(value).slice(selectionStart, selectionEnd);
        } catch (_) {
          // An input type with no text selection (a checkbox) throws. The page selection then stands.
        }
      }
      return String(doc.defaultView?.getSelection?.() ?? "");
    }

    const cleaned = (text) => [...text.replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, MAX_CHARS).join("");

    core.register_kind("selection.read", ({ tab_id }) => {
      const found = window_of(tab_id);
      if (!found) return refuse("The tab that asked is gone");
      const { win, tab } = found;
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      // A late request never reads a page the user switched to.
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      const browser = tab.linkedBrowser;
      if (browser.currentURI?.scheme !== "about") return refuse("Only about: pages are read here");
      const content = browser.contentWindow;
      if (!content?.document) return refuse("This page does not run in the parent process");
      return { ok: true, value: cleaned(selected_text(focused_document(content.document))) };
    });
  }
})(this);
