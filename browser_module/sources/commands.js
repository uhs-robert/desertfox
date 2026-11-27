// DesertFox browser module, the commands feature: normal-mode key sequences and counts on locked pages, matched against the state's pruned tree. See docs/design/browser_module.md, "Keys on locked pages".
// tools/build_browser_module.ts bundles this file with the extension's own matcher, token and tree check into browser_module/desertfox-commands.js, so a key event and the keymap meet in one form on both sides.
// A forward leaf goes to the extension as a `run` request with the matched keys and the count. A native leaf runs here, through the command a feature file defined.
// It also holds the per-tab ignore toggle, defines page.stop, and answers address_bar.open, the command line's stand-in on a page with no DesertFox page code.

import { validate_scope_tree } from "../../src/shared/browser_module_protocol.ts";
import { matcher_keymap_of } from "../../src/shared/browser_module_scope.ts";
import { create_matcher } from "../../src/shared/keys/matcher.ts";
import { event_to_token } from "../../src/shared/keys/token.ts";

const scope = globalThis;
const core = Services.desertfox_browser_module;
if (typeof core === "object" && core !== null) {
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the commands feature failed to load: ${error}`);
    }
  } else if (typeof core.take_keys !== "function" || typeof core.run_command !== "function" || typeof core.may_act !== "function") {
    core.log_once("the core cannot hand keys to a feature, so the commands feature stays off");
  } else {
    // In the sandbox an error goes on to the core's `adopt`, which turns the module off for the session.
    define(core);
  }
}

function define(core) {
  // The module's own keys. The tree has no mode or command line leaves, because those need DesertFox's page code, so these two are fixed: DesertFox's default for ignore mode both ways, and the command line key.
  const IGNORE_TOGGLE_KEY = "<S-Escape>";
  const ADDRESS_BAR_KEY = ":";
  // The text the omnibox keyword of src/background/omnibox.ts starts with.
  const OMNIBOX_PREFIX = "df ";
  // A count repeats a native command at most this often, so a typed 999999 cannot hold the window.
  const MAX_NATIVE_REPEAT = 100;

  // The matcher of each window and what it was fed on. A key on another tab or document, or a new tree, starts a fresh one, so a half-typed sequence never finishes elsewhere.
  let walks = new WeakMap();
  // The text of each tree the core handed over, so a state rewrite with the same tree keeps the sequence under way.
  const tree_texts = new WeakMap();
  // Per tab browser, the document the ignore toggle was turned on in. A load makes a new document, which ends it.
  const ignored = new WeakMap();

  const is_ignored = (browser) => ignored.get(browser) === browser.innerWindowID;

  function tree_text(tree) {
    let text = tree_texts.get(tree);
    if (text === undefined) {
      const checked = validate_scope_tree(tree);
      text = checked.ok ? JSON.stringify(tree) : "";
      if (!checked.ok) core.log_once(`the key tree was refused: ${checked.problem}`);
      tree_texts.set(tree, text);
    }
    return text;
  }

  function walk_for(win, browser, text) {
    const walk = walks.get(win);
    if (walk?.text === text && walk.browser === browser && walk.inner === browser.innerWindowID) return walk;
    const fresh = { text, browser, inner: browser.innerWindowID, matcher: create_matcher(matcher_keymap_of(JSON.parse(text))), pending: undefined };
    walks.set(win, fresh);
    return fresh;
  }

  // The keys of the binding alone. The count digits and the register name come before them (matcher.ts), and the count goes in the request on its own.
  const path_of = (result) => result.keys.slice(String(result.count ?? "").length + (result.register_keys_?.length ?? 0));

  function run_native(leaf, result, context) {
    const { native, args, count_rule } = leaf;
    const count = result.count;
    const counted = count !== undefined && typeof count_rule === "object" ? { ...args, [count_rule.param]: count } : args;
    const times = count !== undefined && count_rule === "repeat" ? Math.min(count, MAX_NATIVE_REPEAT) : 1;
    for (let time = 0; time < times; time++) {
      if (!core.run_command(native, counted, { window: context.window, browser: context.browser, tab: context.tab, repeat: context.event.repeat })) return false;
    }
    return true;
  }

  function forward(result) {
    const sent = core.send("run", { keys: path_of(result).join(" "), count: result.count ?? 0 });
    if (!sent.ok) core.log_once(`a key was not sent to DesertFox: ${sent.problem}`);
    return sent.ok;
  }

  function take_key(context) {
    const { window: win, browser, event, tree } = context;
    const token = event_to_token(event);
    if (token === null) return undefined;
    if (is_ignored(browser)) {
      if (token !== IGNORE_TOGGLE_KEY) return false;
      ignored.delete(browser);
      return true;
    }
    const text = tree === undefined ? "" : tree_text(tree);
    const walk = text === "" ? undefined : walk_for(win, browser, text);
    // With no tree the single-key rows decide, and a row wins over the module's own keys as a tree binding does.
    if (!walk && context.row_runs) return undefined;
    const idle = walk === undefined || walk.pending === undefined;
    // The tree wins over the module's own keys, so a user who binds them gets the binding.
    if (idle && token === IGNORE_TOGGLE_KEY && !walk?.matcher.binds_after_("normal", [], token)) {
      ignored.set(browser, browser.innerWindowID);
      return true;
    }
    if (idle && token === ADDRESS_BAR_KEY && !walk?.matcher.binds_after_("normal", [], token)) return open_address_bar(win, OMNIBOX_PREFIX).ok;
    if (!walk) return undefined;

    const result = walk.matcher.feed("normal", token);
    walk.pending = undefined;
    // A hold needs the which-key panel, which a locked page has none of, so its Space goes to the page.
    if (result.held_ !== undefined) {
      walk.matcher.reset();
      return false;
    }
    if (result.kind_ === "pending") {
      walk.pending = { keys: path_of(result), ...(result.count !== undefined && { count: result.count }) };
      return true;
    }
    if (result.kind_ !== "match") return false;
    const leaf = result.leaf.scope;
    // A register means nothing to the commands a locked page runs, so the keys do nothing.
    if (result.register_keys_ !== undefined) return true;
    if (leaf === "forward") return forward(result);
    return run_native(leaf, result, context);
  }

  function pending_in(win) {
    const walk = walks.get(win);
    const browser = win?.gBrowser?.selectedBrowser;
    if (!walk?.pending || walk.browser !== browser || walk.inner !== browser.innerWindowID) return undefined;
    return { keys: [...walk.pending.keys], ...(walk.pending.count !== undefined && { count: walk.pending.count }) };
  }

  // The text goes into the field and nothing else happens: the user reads it, edits it and presses Enter. It is never submitted here.
  // It can hold the selection or clipboard text a prompt takes, so it starts no query. Setting `value` only sets the field (UrlbarInputBase setValue fires no input event).
  // `search(text)` would fire one, and the query it starts reaches the remote search suggestions (UrlbarProviderSearchSuggestions does not skip an omnibox keyword).
  function open_address_bar(win, text) {
    const bar = win?.gURLBar;
    if (!bar || typeof bar.focus !== "function") return { ok: false, error: "This Firefox has no address bar to open" };
    bar.focus();
    bar.value = text.replace(/[\p{Cc}\p{Cf}]/gu, "");
    return { ok: true };
  }

  // The window with the focus: the key that asked came from it. `may_act` holds the pref, the toolbar switch and private window access.
  function focused_window() {
    const win = Services.focus?.activeWindow;
    if (!win || win.closed || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser" || !core.may_act(win)) return undefined;
    return win;
  }

  const selected_tab_id = (win) => ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.apiManager.global.tabTracker.getId(win.gBrowser.selectedTab);

  core.define_command("page.stop", { args: {}, run: ({ browser }) => browser.stop() });
  core.register_kind("address_bar.open", ({ text, tab_id }) => {
    const win = focused_window();
    if (!win) return { ok: false, error: "No Firefox window has the focus" };
    // The user switched windows or tabs after the key: the text belongs to the tab that asked.
    if (tab_id !== undefined && selected_tab_id(win) !== tab_id) return { ok: false, error: "The tab that asked is no longer selected" };
    return open_address_bar(win, OMNIBOX_PREFIX + text);
  });
  core.take_keys({
    key: take_key,
    reset: (win) => {
      if (win) walks.delete(win);
      else walks = new WeakMap();
    },
    pending: pending_in,
  });
}
