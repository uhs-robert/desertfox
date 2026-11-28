// DesertFox browser module, the commands feature: normal-mode key sequences and counts on locked pages, matched against the state's pruned tree. See docs/design/browser_module.md, "Keys on locked pages".
// tools/build_browser_module.ts bundles this file with the extension's own matcher, token and tree check into browser_module/desertfox-commands.js, so a key event and the keymap meet in one form on both sides.
// A forward leaf goes to the extension as a `run` request with the matched keys and the count. A native leaf runs here, through the command a feature file defined.
// It also holds the per-tab ignore, insert and pass-next states, defines page.stop and the mode commands, and answers address_bar.open, the command line's stand-in on a page with no DesertFox page code.
// With the focus in a text field the core calls `field_key`, not `key`. It is the one place that decides which keys a field does not give the page, and by default none.
// After a forward leaf that opens the command line (the tree's `line_keys`) it holds the window's keys until the line has the focus, so a key typed meanwhile never runs on the page.
// Where hints cannot run now (the locked pages feature's rule), it claims the tree's `hint_keys` too, and sends the first one per document as a `run`, which the extension refuses with the reason.
// On a page chrome hints label themselves (the rule says "page_hints"), each hint key starts those hints instead, through the core's `page_hints`.

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
  // The line takes the focus in a few hundred milliseconds. A hold that outlives this gives the keys back to the page.
  const LINE_HOLD_MS = 1500;
  // Keys typed while the line opens: a reply to the extension carries them, so they stay well inside its cap.
  const MAX_HELD_CHARS = 32;

  // The matcher of each window and what it was fed on. A key on another tab or document, or a new tree, starts a fresh one, so a half-typed sequence never finishes elsewhere.
  let walks = new WeakMap();
  // The text of each tree the core handed over, so a state rewrite with the same tree keeps the sequence under way.
  const tree_texts = new WeakMap();
  // Per tab browser, the document each mode flag was set in. A load makes a new document, which ends it.
  // Ignore and insert pass every key to the page (insert still takes its leave keys), and pass-next passes the one next key.
  const ignored = new WeakMap();
  const inserted = new WeakMap();
  const pass_armed = new WeakMap();
  // The status bar reads the mode off the tab's <browser> element, so the module needs no message to it. The document id ends the display on a load, when no key has run yet to clear it.
  const MODE_ATTRIBUTE = "desertfox-module-mode";
  const MODE_DOCUMENT_ATTRIBUTE = "desertfox-module-document";

  // Per window, the hold after a key that opens the command line: the tab browser it was typed on and the printable text typed since.
  const holds = new Map();

  const is_set = (flags, browser) => flags.get(browser) === browser.innerWindowID;
  const is_ignored = (browser) => is_set(ignored, browser);
  const is_inserted = (browser) => is_set(inserted, browser);
  const is_pass_armed = (browser) => is_set(pass_armed, browser);

  // The browsers that carry the mode attributes now, so a shut down can clear them: a new module instance starts with empty flags and must not leave a badge behind.
  const marked_browsers = new Set();

  function show_mode(browser) {
    const shown = is_inserted(browser) ? "insert" : is_ignored(browser) ? "ignore" : is_pass_armed(browser) ? "pass" : undefined;
    if (shown === undefined) {
      browser.removeAttribute(MODE_ATTRIBUTE);
      browser.removeAttribute(MODE_DOCUMENT_ATTRIBUTE);
      marked_browsers.delete(browser);
    } else {
      // A closed tab never leaves its mode, so its browser would stay in the set: drop those as a mode starts.
      for (const each of marked_browsers) if (each.isConnected === false) marked_browsers.delete(each);
      marked_browsers.add(browser);
      browser.setAttribute(MODE_ATTRIBUTE, shown);
      browser.setAttribute(MODE_DOCUMENT_ATTRIBUTE, String(browser.innerWindowID));
    }
  }

  core.on_shut_down(() => {
    for (const browser of marked_browsers) {
      browser.removeAttribute(MODE_ATTRIBUTE);
      browser.removeAttribute(MODE_DOCUMENT_ATTRIBUTE);
    }
    marked_browsers.clear();
  });

  function set_flag(flags, browser, on) {
    if (on) flags.set(browser, browser.innerWindowID);
    else flags.delete(browser);
    show_mode(browser);
  }

  // The modes exclude each other: only one tab state shows at a time.
  function enter_mode(win, browser, flags) {
    // A leaf that changes the mode ends the sequence and any hold, as on a web page.
    reset_walk(win);
    for (const each of [ignored, inserted, pass_armed]) each.delete(browser);
    set_flag(flags, browser, true);
  }

  // A hint key leaf, which only says why hints do not run here. Per tab browser, the document whose first hint key was sent, so the reason shows once per document.
  const NOTICE_LEAF = "notice";
  const noticed = new WeakMap();
  const hint_notice_of = (browser, win) => core.locked_page_rule?.()?.hint_notice(browser, win);
  // A hint key leaf on a page chrome hints label: every press starts them.
  const PAGE_HINT_LEAF = "page_hint";
  const PAGE_HINTS = "page_hints";

  // Each hint key path becomes a notice leaf, or a page hint leaf where the rule says so, unless the tree binds a key on its way, so a tree binding always wins.
  function with_hint_leaves(tree, leaf) {
    for (const path of Array.isArray(tree.hint_keys) ? tree.hint_keys : []) {
      const tokens = path.split(" ");
      let node = tree;
      for (const [index, token] of tokens.entries()) {
        const child = Object.hasOwn(node.children, token) ? node.children[token] : undefined;
        const last = index === tokens.length - 1;
        if (child === undefined) {
          const added = last ? leaf : { children: {} };
          // Defined, not assigned, so a `__proto__` token stays a key and sets no prototype.
          Object.defineProperty(node.children, token, { value: added, enumerable: true, writable: true, configurable: true });
          node = added;
        } else if (!last && typeof child === "object" && "children" in child) node = child;
        else break;
      }
    }
    return tree;
  }

  function end_hold(win) {
    holds.get(win)?.stop();
    holds.delete(win);
  }

  // It ends when the line takes the text (`take_held`), when the user leaves the tab or the window, on Escape, and after LINE_HOLD_MS.
  function start_hold(win, browser) {
    end_hold(win);
    const end = () => end_hold(win);
    const timer = win.setTimeout(end, LINE_HOLD_MS);
    win.gBrowser.tabContainer.addEventListener("TabSelect", end);
    win.addEventListener("deactivate", end);
    holds.set(win, {
      browser,
      typed: "",
      collecting: true,
      stop: () => {
        win.clearTimeout(timer);
        win.gBrowser.tabContainer.removeEventListener("TabSelect", end);
        win.removeEventListener("deactivate", end);
      },
    });
  }

  // Every key goes nowhere. Printable text is kept for the line until it is taken.
  function hold_key(hold, event) {
    if (!hold.collecting || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Backspace") hold.typed = [...hold.typed].slice(0, -1).join("");
    else if ([...event.key].length === 1 && [...hold.typed].length < MAX_HELD_CHARS) hold.typed += event.key.replace(/[\p{Cc}\p{Cf}]/gu, "");
  }

  // The text typed since the hold began, once: later keys are still held but not kept. With `end` the hold ends too.
  function take_held(win, end) {
    const hold = holds.get(win);
    if (!hold) return "";
    const typed = hold.collecting ? hold.typed : "";
    hold.collecting = false;
    if (end) end_hold(win);
    return typed;
  }

  function tree_text(tree) {
    let text = tree_texts.get(tree);
    if (text === undefined) {
      const checked = validate_scope_tree(tree);
      text = checked.ok ? JSON.stringify(checked.value) : "";
      if (!checked.ok) core.log_once(`the key tree was refused: ${checked.problem}`);
      tree_texts.set(tree, text);
    }
    return text;
  }

  // A change of the notice, such as browser_module_pages turning on, starts a fresh walk, so the hint keys go to the page at once.
  function walk_for(win, browser, text, notice) {
    const walk = walks.get(win);
    if (walk?.text === text && walk.notice === notice && walk.browser === browser && walk.inner === browser.innerWindowID) return walk;
    const parsed = JSON.parse(text);
    const tree = notice === undefined ? parsed : with_hint_leaves(parsed, notice === PAGE_HINTS ? PAGE_HINT_LEAF : NOTICE_LEAF);
    const line_keys = new Set(Array.isArray(tree.line_keys) ? tree.line_keys : []);
    const fresh = { text, notice, browser, inner: browser.innerWindowID, matcher: create_matcher(matcher_keymap_of(tree)), line_keys, sends_register: tree.register_keys === true, pending: undefined, typed: [], held: false };
    walks.set(win, fresh);
    return fresh;
  }

  // The walk keeps the typed keys of the binding itself (`walk.typed`, the group's keys while a hold is on), because on a match inside a hold the matcher's `keys` leave out the leaf. The count and the register go in the request apart from them.
  const REGISTER_PREFIX = '"';

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

  // The register tokens go first in `keys`: the extension matches the whole text again and fills the register into the steps that take one.
  function forward(result, path, walk, win) {
    const keys = path.join(" ");
    const register_tokens = result.register_keys_ === undefined ? [] : [REGISTER_PREFIX, ...result.register_keys_.slice(REGISTER_PREFIX.length)];
    const sent = core.send("run", { keys: [...register_tokens, ...path].join(" "), count: result.count ?? 0 });
    if (!sent.ok) core.log_once(`a key was not sent to DesertFox: ${sent.problem}`);
    else if (walk.line_keys.has(keys)) start_hold(win, walk.browser);
    return sent.ok;
  }

  // The key stays claimed whatever the start says, so a hint key never reaches the page there.
  function start_page_hints(result, path, context) {
    core.page_hints?.()?.start({ window: context.window, browser: context.browser, event: context.event, keys: path.join(" "), count: result.count ?? 0 });
    return true;
  }

  // The key stays claimed after the first, so a hint key never reaches the page while hints cannot run. A send that failed leaves the document unmarked, so the next hint key tries again.
  function notice_once(path, browser) {
    if (noticed.get(browser) === browser.innerWindowID) return true;
    const sent = core.send("run", { keys: path.join(" "), count: 0 });
    if (sent.ok) noticed.set(browser, browser.innerWindowID);
    else core.log_once(`a hint key was not sent to DesertFox: ${sent.problem}`);
    return true;
  }

  // The leave and send keys of insert mode, from the state's table. Without a table (an older extension) only the plain Escape leaves, as it always did.
  const insert_row_of = (context, token) => (context.insert_keys === undefined ? (token === "<Escape>" ? "mode.escape" : undefined) : context.insert_keys.get(token));

  function reset_walk(win) {
    walks.delete(win);
    end_hold(win);
  }

  // A key in insert mode, with or without a field. A leave key ends the mode and drops the focus from a field, and the key is consumed, as in a web page. Every other key goes to the page.
  function insert_key(context, token) {
    const row = insert_row_of(context, token);
    if (row === "mode.escape") {
      set_flag(inserted, context.browser, false);
      if (context.in_field) core.blur_field(context);
      reset_walk(context.window);
      return true;
    }
    // As on a web page, an Escape no row binds still leaves insert mode, and the page gets the key.
    if (row === undefined && token === "<Escape>") {
      set_flag(inserted, context.browser, false);
      return false;
    }
    return row === "page.send_key" && core.send_escape(context);
  }

  function take_key(context) {
    const { window: win, browser, event, tree } = context;
    const token = event_to_token(event);
    if (token === null) return undefined;
    const hold = holds.get(win);
    if (hold?.browser === browser && event.key !== "Escape") {
      hold_key(hold, event);
      return true;
    }
    if (hold) {
      end_hold(win);
      if (event.key === "Escape") return true;
    }
    if (is_inserted(browser)) return insert_key(context, token);
    if (is_ignored(browser)) {
      if (token !== IGNORE_TOGGLE_KEY) return false;
      set_flag(ignored, browser, false);
      return true;
    }
    // <C-v>: the next key goes to the page, and a count or half-typed sequence before it is dropped.
    if (is_pass_armed(browser)) {
      set_flag(pass_armed, browser, false);
      walks.delete(win);
      return false;
    }
    const text = tree === undefined ? "" : tree_text(tree);
    const walk = text === "" ? undefined : walk_for(win, browser, text, hint_notice_of(browser, win));
    // With no tree the single-key rows decide, and a row wins over the module's own keys as a tree binding does.
    if (!walk && context.row_runs) return undefined;
    const idle = walk === undefined || walk.pending === undefined;
    // The tree wins over the module's own keys, so a user who binds them gets the binding.
    if (idle && token === IGNORE_TOGGLE_KEY && !walk?.matcher.binds_after_("normal", [], token)) {
      set_flag(ignored, browser, true);
      return true;
    }
    if (idle && token === ADDRESS_BAR_KEY && !walk?.matcher.binds_after_("normal", [], token)) return open_address_bar(win, OMNIBOX_PREFIX).ok;
    if (!walk) return undefined;

    // The key that opened a hold repeats while it is down, and the matcher would take the repeat as the Space that ends the hold.
    if (event.repeat && walk.held && token === "<Space>") return true;
    const result = walk.matcher.feed("normal", token);
    // Inside a hold the matcher's `keys` drop the leaf, so the walk's typed group is used. Elsewhere the keys of the binding alone come from the matcher, which drops a broken prefix when it retries the key as a first key.
    const path = result.kind_ !== "match" ? [] : result.held_ !== undefined ? [...walk.typed, token] : result.keys.slice(String(result.count ?? "").length + (result.register_keys_?.length ?? 0));
    walk.pending = undefined;
    walk.held = result.held_ !== undefined;
    walk.typed = (result.kind_ === "pending" ? result.typed_ : result.held_) ?? [];
    if (result.kind_ === "pending" || (result.kind_ === "match" && walk.held)) {
      // In a hold the group stays after each leaf, so its panel stays up.
      walk.pending = { keys: [...walk.typed], ...(result.count !== undefined && { count: result.count }), ...(walk.held && { held: true }) };
      if (result.kind_ === "pending") return true;
    }
    // The Space that ends a hold is spent, so it does not scroll the page.
    if (result.kind_ === "no_match") return result.ended_ === true;
    if (result.kind_ !== "match") return false;
    const leaf = result.leaf.scope;
    if (leaf === "forward") {
      // Without the tree's flag the extension takes no register, so the keys do nothing as before.
      if (result.register_keys_ !== undefined && !walk.sends_register) return true;
      return forward(result, path, walk, win);
    }
    // A hint key with a register does nothing, as before: a hint yank takes no register on a locked page.
    if (result.register_keys_ !== undefined && (leaf === NOTICE_LEAF || leaf === PAGE_HINT_LEAF)) return true;
    if (leaf === NOTICE_LEAF) return notice_once(path, browser);
    if (leaf === PAGE_HINT_LEAF) return start_page_hints(result, path, context);
    return run_native(leaf, result, context);
  }

  // Keys in a field. The core calls this, not `key`, while a text field has the focus, because the page types there. It returns true for a key it took, and false to leave the key to the page, which is the default for every key.
  // Only the insert table's rows are taken here: the leave key blurs the field and a send key sends the page a plain Escape. The walk resets, as a key the guards refuse resets it, so a half-typed sequence never ends in a field.
  // A later feature that takes keys in a field (a one-shot normal command) adds its arm check at the top of this function and hands the key to `take_key`.
  function field_key(context) {
    const { window: win, browser } = context;
    const token = event_to_token(context.event);
    if (token === null) return undefined;
    reset_walk(win);
    // Another feature holds every key of the window, Escape included.
    if (core.keys_held_by(win) !== undefined) return false;
    // The key that ends pass-next goes to the page, as every key does here.
    if (is_pass_armed(browser)) {
      set_flag(pass_armed, browser, false);
      return false;
    }
    if (is_ignored(browser)) {
      // As on a web page, the ignore leave key ends the mode in a field too.
      if (token !== IGNORE_TOGGLE_KEY) return false;
      set_flag(ignored, browser, false);
      return true;
    }
    if (is_inserted(browser)) return insert_key(context, token);
    const row = insert_row_of(context, token);
    if (row === "mode.escape") return core.blur_field(context);
    return row === "page.send_key" && core.send_escape(context);
  }

  function pending_in(win) {
    const walk = walks.get(win);
    const browser = win?.gBrowser?.selectedBrowser;
    if (!walk?.pending || walk.browser !== browser || walk.inner !== browser.innerWindowID) return undefined;
    return { keys: [...walk.pending.keys], ...(walk.pending.count !== undefined && { count: walk.pending.count }), ...(walk.pending.held && { held: true }) };
  }

  // The text goes into the field and nothing else happens: the user reads it, edits it and presses Enter. It is never submitted here.
  // It can hold the selection or clipboard text a prompt takes, so it starts no query. Setting `value` only sets the field (UrlbarInputBase setValue fires no input event).
  // `search(text)` would fire one, and the query it starts reaches the remote search suggestions (UrlbarProviderSearchSuggestions does not skip an omnibox keyword).
  function open_address_bar(win, text) {
    const bar = win?.gURLBar;
    if (!bar || typeof bar.focus !== "function") return { ok: false, error: "This Firefox has no address bar to open" };
    bar.focus();
    bar.value = (text + take_held(win, true)).replace(/[\p{Cc}\p{Cf}]/gu, "");
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
  core.define_command("mode.insert", { args: {}, run: ({ window, browser }) => enter_mode(window, browser, inserted) });
  core.define_command("mode.pass_next", { args: {}, run: ({ window, browser }) => enter_mode(window, browser, pass_armed) });
  core.define_command("mode.set", { args: { mode: { type: "enum", values: ["ignore", "insert"] } }, run: ({ window, browser, args }) => enter_mode(window, browser, args.mode === "insert" ? inserted : ignored) });
  core.set_hello_flag("mode_keys", true);
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
      for (const held_win of win ? [win] : [...holds.keys()]) end_hold(held_win);
    },
    pending: pending_in,
    take_held,
    ignores: is_ignored,
    field_key,
  });
}
