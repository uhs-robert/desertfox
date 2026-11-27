// DesertFox browser module, the command line panel: DesertFox's own command line page in a panel over a locked page (about: pages, the PDF viewer, Reader View). See docs/design/browser_module.md, "The command line panel".
// It answers `cmdline_panel.open { tab_id }`. The panel holds a remote <browser> that loads the fixed page `cmdline.html` of DesertFox, built as Firefox builds an extension's toolbar popup (ExtensionPopups.sys.mjs),
// so the page runs in DesertFox's own process with DesertFox's principal, never the system principal. The extension names only the tab. The address is a constant here, with a random key this file makes.
// The reply carries the key and the keys typed since the line was asked for, as JSON text. The page does the rest through the extension's own messages: the background admits it by its address, key included,
// so no other copy of the page can act as the panel.
// In a window it asks the core to load it into the core sandbox, where it starts once per process.

(function desertfox_browser_module_cmdline_panel(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the command line panel failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The panel stays off instead, and the extension falls back to the address bar.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the command line panel is off for this session: ${error}`);
  }

  function start(core) {
    const EXTENSION_ID = "desertfox@uhs-robert";
    const PAGE = "cmdline.html";
    const PANEL_ID = "desertfox-cmdline-panel";
    // The line alone, until the page says how tall it is.
    const FIRST_HEIGHT_PX = 40;
    const BROWSER_CONTENT_SCRIPT = "chrome://extensions/content/ext-browser-content.js";
    const RESIZED_MESSAGE = "Extension:BrowserResized";
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

    // Each window's open panel, by its close function.
    const open_panels = new Map();
    // A page that failed to load once fails again, so later requests are refused and the extension opens the address bar instead.
    let load_failed = false;

    const tab_id_of = (tab) => ExtensionParent.apiManager.global.tabTracker.getId(tab);

    // The focused browser window, while its selected tab is still `tab_id`, as the address bar's opener checks it. A tab or window the user has left since the request gets no panel.
    function window_selecting(tab_id) {
      const win = Services.focus?.activeWindow;
      if (!win || win.closed || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser" || !win.gBrowser?.selectedTab) return undefined;
      return tab_id_of(win.gBrowser.selectedTab) === tab_id ? win : undefined;
    }

    function open(win, extension) {
      const doc = win.document;
      const popup_set = doc.getElementById("mainPopupSet");
      if (load_failed) return { ok: false, error: "The command line page did not load in this session" };
      if (!popup_set) return { ok: false, error: "This Firefox has no place for the panel" };
      if (open_panels.has(win) || doc.getElementById(PANEL_ID)) return { ok: false, error: "The command line is already open" };
      const opener = win.gBrowser.selectedBrowser;
      const opener_tab = win.gBrowser.selectedTab;
      const key = Services.uuid.generateUUID().toString().slice(1, -1);
      const panel = doc.createXULElement("panel");
      panel.id = PANEL_ID;
      panel.setAttribute("class", "panel-no-padding");
      panel.setAttribute("noautofocus", "true");
      panel.setAttribute("consumeoutsideclicks", "false");
      const browser = doc.createXULElement("browser");
      browser.setAttribute("type", "content");
      browser.setAttribute("disableglobalhistory", "true");
      browser.setAttribute("messagemanagergroup", "webext-browsers");
      browser.setAttribute("webextension-view-type", "popup");
      browser.setAttribute("initialBrowsingContextGroupId", extension.policy.browsingContextGroupId);
      if (extension.remote) {
        browser.setAttribute("remote", "true");
        browser.setAttribute("remoteType", extension.remoteType);
        browser.setAttribute("maychangeremoteness", "true");
      }
      const page_box = () => opener.getBoundingClientRect();
      let height = FIRST_HEIGHT_PX;
      browser.style.width = `${page_box().width}px`;
      browser.style.height = `${height}px`;
      popup_set.appendChild(panel);

      // The line sits at the bottom of the page, as on a web page, and grows upward with the list.
      const place = () => {
        const box = page_box();
        height = Math.min(height, box.height);
        browser.style.height = `${height}px`;
        if (panel.state === "open" || panel.state === "showing") panel.moveToAnchor(opener, "overlap", 0, box.height - height);
      };
      // Firefox's own popup content script measures the page and sends this, as for a toolbar popup. The page is DesertFox's, but the number is read as foreign input.
      const on_resized = ({ data }) => {
        const asked = data?.height;
        if (typeof asked !== "number" || !Number.isFinite(asked) || asked <= 0) return;
        height = Math.ceil(asked);
        place();
      };
      const close = () => {
        if (panel.state !== "closed") panel.hidePopup();
      };
      const on_tab_select = () => close();
      // The line belongs to the page it opened over, so a load in that tab ends it. A move within the page (a fragment, pushState) does not.
      const on_location = {
        onLocationChange(browser, progress, _request, _location, flags) {
          if (browser === opener && progress.isTopLevel && !(flags & Components.interfaces.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) close();
        },
      };
      const on_window_close = (event) => {
        // The page's `window.close()`: Enter and Escape end the line this way.
        event.preventDefault();
        close();
      };
      win.gBrowser.tabContainer.addEventListener("TabSelect", on_tab_select);
      win.gBrowser.addTabsProgressListener(on_location);
      browser.addEventListener("DOMWindowClose", on_window_close, true);
      open_panels.set(win, close);
      panel.addEventListener(
        "popuphidden",
        () => {
          open_panels.delete(win);
          win.gBrowser.tabContainer.removeEventListener("TabSelect", on_tab_select);
          win.gBrowser.removeTabsProgressListener(on_location);
          browser.removeEventListener("DOMWindowClose", on_window_close, true);
          browser.messageManager?.removeMessageListener(RESIZED_MESSAGE, on_resized);
          panel.remove();
          // The focus goes back to the page the line opened over, if it is still the one shown.
          if (win.gBrowser.selectedBrowser === opener && !opener_tab.closing) opener.focus();
        },
        { once: true },
      );
      const load = () => {
        // The steps of ExtensionPopups' createBrowser for a popup with an address.
        ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
        browser.messageManager.addMessageListener(RESIZED_MESSAGE, on_resized);
        browser.messageManager.loadFrameScript(BROWSER_CONTENT_SCRIPT, false, true);
        browser.messageManager.sendAsyncMessage("Extension:InitBrowser", { allowScriptsToClose: true, fixedWidth: true, maxWidth: 10000, maxHeight: 10000, stylesheets: [] });
        browser.fixupAndLoadURIString(`${extension.baseURI.resolve(PAGE)}?panel=${key}`, { triggeringPrincipal: extension.principal });
      };
      const load_or_close = () => {
        try {
          load();
        } catch (error) {
          core.log_once(`the command line page did not load: ${error}`);
          load_failed = true;
          close();
        }
      };
      // The frame loader exists only after this event, and its message manager one microtask later.
      if (extension.remote) browser.addEventListener("XULFrameLoaderCreated", () => void Promise.resolve().then(load_or_close), { once: true });
      panel.addEventListener(
        "popupshown",
        () => {
          // Appended only now: a remote browser appended before `openPopup` crashed the parent process.
          panel.appendChild(browser);
          if (!extension.remote) load_or_close();
          // The page's input takes the focus from the browser, which must have it first.
          browser.focus();
          // The keys now reach the panel, so the page under it needs no hold. Keys typed since the reply below are dropped.
          core.take_held_keys(win, true);
        },
        { once: true },
      );
      panel.openPopup(opener, { position: "overlap", x: 0, y: page_box().height - height });
      return { ok: true, value: JSON.stringify({ key, typed: core.take_held_keys(win, false) }) };
    }

    core.register_kind("cmdline_panel.open", ({ tab_id }) => {
      const win = window_selecting(tab_id);
      if (!win) return { ok: false, error: "The tab that asked is no longer selected" };
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return { ok: false, error: "The browser module may not act in this window" };
      const extension = ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
      if (!extension) return { ok: false, error: "DesertFox is not running" };
      return open(win, extension);
    });
    core.on_shut_down(() => {
      for (const close of [...open_panels.values()]) close();
    });
  }
})(this);
