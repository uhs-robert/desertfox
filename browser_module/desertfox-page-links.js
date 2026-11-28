// DesertFox browser module, the page links: it answers `page_links.read { tab_id, scope }` with the web links of a page where DesertFox's own page code does not run, for `copy.page_links` (yL and yl). See docs/design/browser_module.md, "Links on locked pages".
// The reply value is JSON text of [address, text] pairs. It is data: the extension only formats and copies it, and nothing here or there opens an address. The request names no address, selector or URL.
// Two collectors: a parent-process about: page (about:preferences, about:addons, about:config and the like), read here from the parent, and a page in a content process that the content hints route covers (a restricted host, a start page, an error page) or that is the PDF viewer or Reader View, read by that route's frame script through the core's `content_pages().links`.
// Any other page is refused. The caps below are the extension's too (src/shared/browser_module_page_links.ts, which a test holds equal), and the extension checks the reply again.
// In a window it asks the core to load it into the core sandbox, where it registers its kind once per process.

(function desertfox_browser_module_page_links(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the page links feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The feature stays off instead and the extension copies no links on these pages.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the page links feature is off for this session: ${error}`);
  }

  function start(core) {
    const MAX_LINKS = 500;
    // The reply value as JSON text, measured as it sits escaped in the reply, under the kind's 64 KB for the whole reply.
    const MAX_VALUE_BYTES = 60000;
    const MAX_ADDRESS_CHARS = 2048;
    const MAX_TEXT_CHARS = 512;
    // Pages inside pages: about:preferences and about:addons nest their own documents.
    const MAX_FRAME_DEPTH = 4;
    const SCOPES = ["page", "viewport"];
    const NO_LINKS_HERE = "Links cannot be read on this page";
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

    const refuse = (error) => ({ ok: false, error });
    const is_browser_window = (win) => !!win && !win.closed && win.document?.documentElement?.getAttribute("windowtype") === "navigator:browser" && !!win.gBrowser;
    const encoded_bytes = (text) => new TextEncoder().encode(text).length;

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

    // Control and format characters go, whitespace runs become one space, then the cap. The extension keeps its own copy of this rule (`cleaned_text` in browser_module_page_links.ts).
    const cleaned_text = (text) => [...String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_TEXT_CHARS).join("");
    // A longer address is dropped, never cut, because a cut address is a wrong one.
    const WEB_ADDRESS = /^(?:https?|ftp|file):[^\s\p{Cc}\p{Cf}]*$/iu;

    // The reply value for the pairs a collector yields, in page order: the first link to an address wins, and the list stops at MAX_LINKS or MAX_VALUE_BYTES. The pairs may come from a frame script, so each is checked again.
    function value_of(pairs) {
      const seen = new Set();
      const kept = [];
      // The brackets of the list.
      let used = 2;
      for (const pair of pairs) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
        const address = pair[0];
        if (address.length > MAX_ADDRESS_CHARS || !WEB_ADDRESS.test(address) || seen.has(address)) continue;
        seen.add(address);
        const entry = [address, typeof pair[1] === "string" ? cleaned_text(pair[1]) : ""];
        // The entry's JSON, escaped once more as part of the reply's value text, and its comma.
        const size = encoded_bytes(JSON.stringify(JSON.stringify(entry))) - 2 + 1;
        if (used + size > MAX_VALUE_BYTES) break;
        used += size;
        kept.push(entry);
        if (kept.length === MAX_LINKS) break;
      }
      return JSON.stringify(kept);
    }

    const without_fragment = (address) => String(address).split("#")[0];
    // The text a person sees, else the names assistive tools use, else nothing (the extension then labels the link with its address).
    const label_of = (element) => cleaned_text(element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "");
    const inside = (rect, clip) => rect.width > 0 && rect.height > 0 && rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom;

    // The links of a document, followed into shadow roots and the frames of the page. `clip` is the part of the document in view, in its own coordinates, or undefined for the whole page. A fragment link to the document itself is no destination.
    function* links_of(root, doc, clip, depth) {
      for (const element of root.querySelectorAll("*")) {
        const name = element.localName;
        if (name === "a" && element.hasAttribute("href")) {
          const address = String(element.href ?? "");
          if (address.includes("#") && without_fragment(address) === without_fragment(doc.URL)) continue;
          if (!element.checkVisibility()) continue;
          if (clip && !inside(element.getBoundingClientRect(), clip)) continue;
          yield [address, label_of(element)];
        }
        const shadow = element.openOrClosedShadowRoot;
        if (shadow) yield* links_of(shadow, doc, clip, depth);
        if ((name === "iframe" || name === "frame" || name === "browser") && depth < MAX_FRAME_DEPTH) {
          let inner = null;
          try {
            inner = element.contentDocument;
          } catch (_) {
            inner = null;
          }
          if (!inner || !element.checkVisibility()) continue;
          let inner_clip;
          if (clip) {
            const box = element.getBoundingClientRect();
            if (!inside(box, clip)) continue;
            inner_clip = { left: Math.max(clip.left, box.left) - box.left, top: Math.max(clip.top, box.top) - box.top, right: Math.min(clip.right, box.right) - box.left, bottom: Math.min(clip.bottom, box.bottom) - box.top };
          }
          yield* links_of(inner, inner, inner_clip, depth + 1);
        }
      }
    }

    function parent_page_value(content, link_scope) {
      const clip = link_scope === "viewport" ? { left: 0, top: 0, right: content.innerWidth, bottom: content.innerHeight } : undefined;
      return value_of(links_of(content.document, content.document, clip, 0));
    }

    core.register_kind("page_links.read", async ({ tab_id, scope: link_scope }) => {
      if (!SCOPES.includes(link_scope)) return refuse("The scope is page or viewport");
      const found = window_of(tab_id);
      if (!found) return refuse("The tab that asked is gone");
      const { win, tab } = found;
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      // A late request never reads a page the user switched to.
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      const browser = tab.linkedBrowser;
      const route = core.content_pages?.();
      if (route?.refuses(browser)) return refuse(NO_LINKS_HERE);
      const content = browser.currentURI?.scheme === "about" ? browser.contentWindow : null;
      // A page in a parent process has a window here. Every other page asks the route's frame script, which also reads the PDF viewer and Reader View and refuses what it does not know.
      if (route?.labels(browser) === undefined && content?.document) return { ok: true, value: parent_page_value(content, link_scope) };
      if (!route) return refuse(NO_LINKS_HERE);
      const read = await route.links(browser, link_scope);
      if (!read.ok) return refuse(read.error);
      // The user can switch tabs while the frame script reads.
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      return { ok: true, value: value_of(read.pairs) };
    });
  }
})(this);
