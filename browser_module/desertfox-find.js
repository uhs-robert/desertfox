// DesertFox browser module, find: it answers `find.search { tab_id, text, backwards }` and `find.again { tab_id, reverse }` with Firefox's own Finder on the selected tab. See docs/design/browser_module.md, "Find on locked pages".
// The text is data: it goes to the Finder as a plain string and is never run, parsed as a pattern or used as an address. The Finder finds text in a parent-process page and, from the parent, in a content-process page as well.
// The reply is JSON text of whole numbers only (`result`, `current`, `total`, `limit`). The extension turns it into the toast.
// A private tab is refused here as well as in the extension, because the Finder keeps the term in Firefox's find history.
// In a window it asks the core to load it into the core sandbox, where it registers its kinds once per process.

(function desertfox_browser_module_find(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the find feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The feature stays off instead and the extension shows the refusal.
  try {
    start(core);
  } catch (error) {
    core.log_once(`the find feature is off for this session: ${error}`);
  }

  function start(core) {
    const MAX_FIND_CHARS = 256;
    // The core answers the extension within two seconds, so the count gets less than that.
    const COUNT_WAIT_MS = 700;
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    const Finding = Components.interfaces.nsITypeAheadFind;

    // The last typed search of each window and the way it went, so n and N follow the way the search started. Lost with the window, and a restart starts empty.
    const last_search = new WeakMap();

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

    // The tab's finder, or the reason there is none.
    function finder_of(tab_id) {
      const found = window_of(tab_id);
      if (!found) return refuse("The tab that asked is gone");
      const { win, tab } = found;
      // The pref, DesertFox running, private window access and the toolbar switch, as for a key.
      if (!core.may_act(win)) return refuse("The browser module may not act in this window");
      if (win.gBrowser.selectedTab !== tab) return refuse("The tab that asked is no longer selected");
      if (PrivateBrowsingUtils.isBrowserPrivate(tab.linkedBrowser)) return refuse("Find is off in private tabs");
      const finder = tab.linkedBrowser.finder;
      return finder ? { ok: true, win, finder } : refuse("This page cannot be searched");
    }

    // The Finder answers through listeners: the find result first, then the count of matches. The reply waits for both, up to COUNT_WAIT_MS for the count.
    function ask_finder(finder, begin) {
      return new Promise((resolve) => {
        let result;
        let counted;
        let timer = null;
        const finish = () => {
          clearTimeout(timer);
          finder.removeResultListener(listener);
          resolve({ result: result ?? Finding.FIND_NOTFOUND, current: counted?.current, total: counted?.total, limit: counted?.limit });
        };
        const listener = {
          onFindResult(options) {
            if (options.result === Finding.FIND_PENDING) return;
            result = options.result;
            if (result === Finding.FIND_NOTFOUND || counted) finish();
            else {
              clearTimeout(timer);
              timer = setTimeout(finish, COUNT_WAIT_MS);
            }
          },
          onMatchesCountResult(count) {
            counted = count;
            if (result !== undefined) finish();
          },
          onHighlightFinished() {},
          onCurrentSelection() {},
          onFindbarClose() {},
          onFindbarOpen() {},
          onModalHighlightChange() {},
          onHighlightAllChange() {},
        };
        finder.addResultListener(listener);
        timer = setTimeout(finish, COUNT_WAIT_MS * 2);
        begin();
      });
    }

    // A held n sends one request per key repeat. Two finds on one Finder would each take the other's answer, so each tab's finds run in turn.
    const turns = new WeakMap();
    function in_turn(finder, task) {
      const done = (turns.get(finder) ?? Promise.resolve()).then(task);
      turns.set(finder, done.then(() => undefined, () => undefined));
      return done;
    }

    const whole = (value) => (Number.isSafeInteger(value) ? value : -1);
    const reply_of = (found) => ({ ok: true, value: JSON.stringify({ result: whole(found.result), current: whole(found.current), total: whole(found.total), limit: whole(found.limit) }) });

    // The Finder's first find is always forward, so a backward search steps back from the first match: it lands on the last one, as a search backward from the top of the page does.
    async function search(finder, win, text, backwards) {
      last_search.set(win, { text, backwards });
      const first = await ask_finder(finder, () => finder.fastFind(text, false, false));
      if (!backwards || first.result === Finding.FIND_NOTFOUND) return first;
      return ask_finder(finder, () => finder.findAgain(text, true, false, false));
    }

    // Read inside the turn, so an n behind a search repeats that search.
    function repeat({ finder, win }, reverse) {
      const earlier = last_search.get(win);
      if (!earlier) return refuse("No earlier search");
      const backwards = earlier.backwards !== reverse;
      // Another tab's Finder holds another search, so the first n there searches again from the top.
      if (finder.searchString !== earlier.text) return search(finder, win, earlier.text, backwards);
      return ask_finder(finder, () => finder.findAgain(earlier.text, backwards, false, false));
    }

    core.register_kind("find.search", async ({ tab_id, text, backwards }) => {
      const checked = finder_of(tab_id);
      if (!checked.ok) return checked;
      const chars = [...String(text)];
      if (chars.length === 0 || chars.length > MAX_FIND_CHARS || /[\p{Cc}\p{Cf}]/u.test(text)) return refuse("The search text is not allowed");
      return reply_of(await in_turn(checked.finder, () => search(checked.finder, checked.win, text, backwards === 1)));
    });

    core.register_kind("find.again", async ({ tab_id, reverse }) => {
      const checked = finder_of(tab_id);
      if (!checked.ok) return checked;
      const found = await in_turn(checked.finder, () => repeat(checked, reverse === 1));
      return found.ok === false ? found : reply_of(found);
    });
  }
})(this);
