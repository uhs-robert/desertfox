// DesertFox browser module, the selection: it answers `selection.read { tab_id }` with the text selected on a parent-process about: page (about:preferences, about:addons, about:config and the like), where no content script runs. See docs/design/browser_module.md, "Selection on locked pages".
// The text is data. It goes into the reply as text and is never run, parsed or used as an address. The cap and the cleaning here match the extension's, which checks the reply again.
// A page in a content process (the PDF viewer, Reader View, addons.mozilla.org, an error page) has no window in the parent. For it the module asks its own small frame script, which only reads the selection and replies with text. The reply is foreign input: the module checks its sender, its size and its type, cleans it again and drops it when it is late.
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
    const MESSAGE_PREFIX = "desertfox-browser-module:selection-";
    // The frame script cuts at MAX_CHARS characters, at most 4 bytes each. A reply over this is not from the frame script.
    const MAX_REPLY_BYTES = 4096;
    const REPLY_MS = 1000;
    const NO_SELECTION = "No selection could be read from this page";
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
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

    // The focused element and its document, followed through shadow roots (the core's `deep_active`) and the frames that hold the focus. The core's `focused_element` starts from a chrome window, so it cannot take the tab's content document.
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

    // A selected range in a text field first, then the page's own selection, as `selected_text` does on a web page.
    function selected_text({ doc, element }) {
      if (element && (element.localName === "input" || element.localName === "textarea")) {
        try {
          const { selectionStart, selectionEnd, value } = element;
          if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) return String(value).slice(selectionStart, selectionEnd);
        } catch (_) {
          // An input type with no text selection (a checkbox) throws. The page selection then stands.
        }
      }
      return String(doc.defaultView?.getSelection?.() ?? "");
    }

    // Line breaks (U+2028 and U+2029 too) and tabs become a space, so two selected lines stay two words. The extension keeps its own copy of this rule (`cleaned_line` in selection_ask.ts).
    const cleaned = (text) => [...text.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, MAX_CHARS).join("");

    // The frame script's replies, each waiting for one browser and one document of it.
    const awaiting = new Map();
    let next_request = 1;
    const utf8_bytes = (text) => new TextEncoder().encode(text).length;
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

    function ask_frame_script(browser) {
      const inner = browser.innerWindowID;
      const req = next_request++;
      return new Promise((resolve) => {
        const settle = (text) => {
          if (!awaiting.delete(req)) return;
          clearTimeout(timer);
          resolve(text);
        };
        const timer = setTimeout(() => settle(undefined), REPLY_MS);
        awaiting.set(req, { browser, inner, settle });
        try {
          browser.messageManager.sendAsyncMessage(MESSAGE_PREFIX + "read", { req });
        } catch (_) {
          settle(undefined);
        }
      });
    }

    const reply_listener = (message) => {
      try {
        const { target, data } = message;
        if (!is_record(data)) return;
        const asked = awaiting.get(data.req);
        // Only the browser asked, for the document asked about and still shown there. A reply of any other sender or document is dropped and the wait runs on until its timer.
        if (!asked || asked.browser !== target || data.inner !== asked.inner || target.innerWindowID !== asked.inner) return;
        // A UTF-16 length never exceeds the UTF-8 byte count, so the cheap check goes first and a huge string is never encoded.
        if (typeof data.text !== "string" || data.text.length > MAX_REPLY_BYTES || utf8_bytes(data.text) > MAX_REPLY_BYTES) return asked.settle(undefined);
        asked.settle(data.text);
      } catch (error) {
        core.log_once(`a selection reply was dropped after an error: ${error}`);
      }
    };
    Services.mm.addMessageListener(MESSAGE_PREFIX + "text", reply_listener);
    core.on_shut_down(() => {
      Services.mm.removeMessageListener(MESSAGE_PREFIX + "text", reply_listener);
      for (const asked of [...awaiting.values()]) asked.settle(undefined);
    });
    core.add_frame_script(selection_frame_script);

    core.register_kind("selection.read", async ({ tab_id }) => {
      const found = window_of(tab_id);
      if (!found) return refuse("The tab that asked is gone");
      const { win, tab } = found;
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      // A late request never reads a page the user switched to.
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      const browser = tab.linkedBrowser;
      const content = browser.currentURI?.scheme === "about" ? browser.contentWindow : null;
      if (content?.document) return { ok: true, value: cleaned(selected_text(focus_of(content.document))) };
      if (browser.isRemoteBrowser !== true) return refuse(browser.currentURI?.scheme === "about" ? "This page does not run in the parent process" : "Only about: pages are read here");
      const text = await ask_frame_script(browser);
      if (text === undefined) return refuse(NO_SELECTION);
      // The user may have turned the module off or switched tabs while the frame script answered.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      return { ok: true, value: cleaned(text) };
    });
  }
  // Runs in each tab, in the tab's process. It answers one message, reads the selection and replies with text. It runs no page code and sends no address.
  function selection_frame_script() {
    const MESSAGE_PREFIX = "desertfox-browser-module:selection-";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    // MAX_CHARS and MAX_FRAME_DEPTH of the parent side. The parent cleans again.
    const MAX_CHARS = 1000;
    const MAX_FRAME_DEPTH = 4;
    const cleaned = (text) => [...text.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, MAX_CHARS).join("");
    function deep_active(doc) {
      let element = doc?.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element;
    }
    // The text of a selected range in the focused field, else the page selection, through the frames that hold the focus.
    function selected_text(doc) {
      let element = deep_active(doc);
      for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
        const inner = element && (element.localName === "iframe" || element.localName === "frame") ? element.contentDocument : null;
        if (!inner) break;
        doc = inner;
        element = deep_active(inner);
      }
      if (element && (element.localName === "input" || element.localName === "textarea")) {
        try {
          const { selectionStart, selectionEnd, value } = element;
          if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) return String(value).slice(selectionStart, selectionEnd);
        } catch (_) {
          // An input type with no text selection throws. The page selection then stands.
        }
      }
      return String(doc.defaultView?.getSelection?.() ?? "");
    }
    addMessageListener(MESSAGE_PREFIX + "read", (message) => {
      try {
        if (!Services.prefs.getBoolPref(ENABLED_PREF, false)) return;
        const req = message?.data?.req;
        if (!Number.isInteger(req) || !content?.document) return;
        sendAsyncMessage(MESSAGE_PREFIX + "text", { req, inner: content.windowGlobalChild.innerWindowId, text: cleaned(selected_text(content.document)) });
      } catch (_) {
        // No reply: the parent times out and reads no selection.
      }
    });
  }
})(this);
