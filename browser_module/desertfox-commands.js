// Generated from browser_module/sources/commands.js by tools/build_browser_module.ts (just browser-module). Do not edit: change the source and build again.
"use strict";
(() => {
  // src/shared/config/storage_keys.ts
  var BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY = "desertfox_browser_module_snapshot_keymap";
  var BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY = "desertfox_browser_module_snapshot_config";
  var BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY = "desertfox_browser_module_snapshot_theme";
  var BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY = "desertfox_browser_module_snapshot_which_key";

  // src/shared/browser_module_protocol.ts
  var MAX_KEY_CHARS = 24;
  var PANE_REGIONS = ["sidebar", "page", "split", "devtools"];
  var MAX_RESIZE_STEPS = 20;
  var PANE_DIRECTIONS = ["left", "right"];
  var DEVTOOLS_ACTIONS = ["tree.down", "tree.up", "tree.collapse", "tree.expand", "hints.start", "visual.start"];
  var MAX_DEVTOOLS_KEY_ROWS = 8;
  var DEVTOOLS_VISUAL_OPS = ["char.back", "char.forward", "line.down", "line.up", "word.forward", "word.back", "line.start", "line.end", "copy"];
  var MAX_DEVTOOLS_VISUAL_ROWS = 16;
  var is_devtools_key = (key) => typeof key === "string" && [...key].length === 1 && !/[\s\p{Cc}\p{Cf}]/u.test(key);
  function devtools_keys_problem(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEVTOOLS_KEY_ROWS) return `must be a list of 1 to ${MAX_DEVTOOLS_KEY_ROWS} rows`;
    const seen = /* @__PURE__ */ new Set();
    for (const row of value) {
      if (!is_record(row) || !is_devtools_key(row.key) || !DEVTOOLS_ACTIONS.includes(row.action) || seen.has(row.key)) return "rows need one-character keys, each once, and an action from the list";
      seen.add(row.key);
    }
    return void 0;
  }
  function devtools_visual_keys_problem(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEVTOOLS_VISUAL_ROWS) return `must be a list of 1 to ${MAX_DEVTOOLS_VISUAL_ROWS} rows`;
    const seen = /* @__PURE__ */ new Set();
    for (const row of value) {
      if (!is_record(row) || !is_devtools_key(row.key) || !DEVTOOLS_VISUAL_OPS.includes(row.op) || seen.has(row.key)) return "rows need one-character keys, each once, and an op from the list";
      seen.add(row.key);
    }
    return void 0;
  }
  var MODULE_COMMAND_ARGS = {
    "tab.next": {},
    "tab.prev": {},
    "scroll.lines": { count: "int" },
    "scroll.pixels": { dx: "int", dy: "int" },
    "scroll.pages": { fraction: "number", count: "int" },
    "scroll.to": { percent: "number", axis: "axis" },
    "page.stop": {}
  };
  var MODULE_COMMAND_IDS = Object.keys(MODULE_COMMAND_ARGS);
  var MAX_SEQUENCE_KEYS = 8;
  var MAX_TREE_BYTES = 32 * 1024;
  var bad = (problem) => ({ ok: false, problem });
  var is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var is_module_command_id = (id) => typeof id === "string" && Object.hasOwn(MODULE_COMMAND_ARGS, id);
  var is_key_token = (key) => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_CHARS && !/[\s\p{Cc}\p{Cf}]/u.test(key);
  function arg_problem(kind, value) {
    if (kind === "devtools_keys") return devtools_keys_problem(value);
    if (kind === "devtools_visual_keys") return devtools_visual_keys_problem(value);
    if (kind === "text") return typeof value === "string" ? void 0 : "must be text";
    if (kind === "axis") return value === "x" || value === "y" ? void 0 : "must be x or y";
    if (kind === "region") return PANE_REGIONS.some((region) => region === value) ? void 0 : `must be one of ${PANE_REGIONS.join(", ")}`;
    if (kind === "direction") return PANE_DIRECTIONS.some((direction) => direction === value) ? void 0 : `must be one of ${PANE_DIRECTIONS.join(", ")}`;
    if (kind === "optional_int" && value === void 0) return void 0;
    if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
    if (kind === "step") return Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_RESIZE_STEPS ? void 0 : `must be a whole number of 1 to ${MAX_RESIZE_STEPS} steps, either way`;
    return (kind === "int" || kind === "optional_int") && !Number.isInteger(value) ? "must be a whole number" : void 0;
  }
  function check_module_args(id, args) {
    const kinds = MODULE_COMMAND_ARGS[id];
    if (!is_record(args)) return bad("args must be a table");
    const picked = {};
    for (const [name, kind] of Object.entries(kinds)) {
      const problem = arg_problem(kind, args[name]);
      if (problem !== void 0) return bad(`${id} ${name} ${problem}`);
      picked[name] = args[name];
    }
    return { ok: true, value: picked };
  }
  function tree_problem(node, depth) {
    if (!is_record(node) || !is_record(node.children)) return "a tree branch needs its children";
    if (depth >= MAX_SEQUENCE_KEYS) return "the tree is too deep";
    for (const [token, child] of Object.entries(node.children)) {
      if (token !== "" && !is_key_token(token)) return "a tree key is not a key token";
      if (child === "forward") continue;
      if (is_record(child) && "native" in child) {
        if (!is_module_command_id(child.native) || !check_module_args(child.native, child.args).ok) return "a native leaf names a command the module does not run";
        const rule = child.count_rule;
        if (rule !== void 0 && rule !== "repeat" && !(is_record(rule) && typeof rule.param === "string" && Object.hasOwn(MODULE_COMMAND_ARGS[child.native], rule.param))) return "a native leaf has a bad count rule";
        continue;
      }
      const problem = tree_problem(child, depth + 1);
      if (problem !== void 0) return problem;
    }
    return void 0;
  }
  function key_paths_problem(paths, name) {
    if (paths === void 0) return void 0;
    const fits = (path) => typeof path === "string" && path.split(" ").length <= MAX_SEQUENCE_KEYS && path.split(" ").every(is_key_token);
    return Array.isArray(paths) && paths.every(fits) ? void 0 : `the ${name} keys are not key paths`;
  }
  function validate_scope_tree(value) {
    const size = json_bytes(value);
    if (size === void 0) return bad("the tree is not plain data");
    if (size > MAX_TREE_BYTES) return bad("the tree is too large");
    const root = value;
    const problem = tree_problem(value, 0) ?? key_paths_problem(root.line_keys, "line") ?? key_paths_problem(root.hint_keys, "hint");
    return problem === void 0 ? { ok: true, value } : bad(problem);
  }
  var MAX_KIND_BYTES = 64 * 1024;
  function json_bytes(value) {
    try {
      const text = JSON.stringify(value);
      return text === void 0 ? void 0 : new TextEncoder().encode(text).length;
    } catch {
      return void 0;
    }
  }
  var MAX_SNAPSHOT_BYTES = 512 * 1024;
  var SNAPSHOT_PARTS = {
    // The stored compiled keymap with its site rules, as an object, so storage holds it with no escaping. Only the outline is checked here: the shim runs `current_keymap` on it before use.
    keymap: { key: BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, max_bytes: MAX_SNAPSHOT_BYTES, value_ok: (value) => is_record(value) && typeof value.format_version === "number" && is_record(value.modes) && (value.site_rules === void 0 || Array.isArray(value.site_rules)) },
    // The stored config status (CONFIG_STATUS_STORAGE_KEY).
    config: { key: BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, max_bytes: 64 * 1024, value_ok: is_record },
    // The stored theme (THEME_STORAGE_KEY).
    theme: { key: BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, max_bytes: 16 * 1024, value_ok: (value) => is_record(value) && is_record(value.dark) && is_record(value.light) },
    // The which-key panel of normal mode with no prefix.
    which_key: { key: BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY, max_bytes: 128 * 1024, value_ok: (value) => is_record(value) && Array.isArray(value.title) && Array.isArray(value.rows) }
  };
  var SNAPSHOT_PART_NAMES = Object.keys(SNAPSHOT_PARTS);

  // src/shared/prefix_tree.ts
  var COMPILED_KEYMAP_VERSION = 18;
  var ANY_KEY = "";

  // src/shared/register_names.ts
  var REGISTER_KEY = /^[A-Za-z"+_/]$/;

  // src/shared/keys/matcher.ts
  var MAX_COUNT_DIGITS = 6;
  var COUNT_MODES = ["normal", "caret", "visual", "visual_line", "media", "item", "item_visual"];
  function create_matcher(keymap, frees) {
    let walk_mode = "";
    let node;
    let typed = [];
    let count_digits = "";
    let register_keys_ = "";
    let keys = [];
    let held;
    const reset = () => {
      node = held = void 0;
      keys = typed = [];
      count_digits = register_keys_ = "";
    };
    const passes_ = (mode, token) => mode === "normal" && typed.length === 0 && count_digits + register_keys_ === "" && frees?.(token) === true;
    const walk = (mode, token) => {
      if (mode !== walk_mode) {
        reset();
        walk_mode = mode;
      }
      const root = keymap.modes[mode];
      if (!root) return { kind_: "no_match" };
      node ??= root;
      if (passes_(mode, token)) return reset(), { kind_: "no_match" };
      keys = [...keys, token];
      const progress = () => ({ ...count_digits && { count: Number(count_digits) }, ...register_keys_ && { register_keys_ }, keys });
      const awaiting_name = register_keys_ === '"';
      if (awaiting_name || token === '"' && !register_keys_ && mode !== "media" && mode !== "item" && mode !== "item_visual" && COUNT_MODES.includes(mode) && typed.length === 0 && !root.children[token]) {
        if (awaiting_name && !REGISTER_KEY.test(token)) return reset(), { kind_: "no_match" };
        register_keys_ += token;
        return { kind_: "pending", node: root, typed_: typed, ...progress() };
      }
      const is_digit = /^[0-9]$/.test(token);
      const key_is_count_digit = COUNT_MODES.includes(mode) && typed.length === 0 && is_digit && count_digits.length < MAX_COUNT_DIGITS && (count_digits !== "" || token !== "0" && !root.children[token]);
      if (key_is_count_digit) {
        count_digits += token;
        return { kind_: "pending", node: root, typed_: typed, ...progress() };
      }
      const typed_char = token === "<Space>" ? " " : token;
      if (token === "<Space>" && typed.length > 0 && !count_digits && !register_keys_ && !node.children[token] && !node.children[ANY_KEY]) {
        if (held) return reset(), { kind_: "no_match", ended_: true };
        held = { node, typed, keys: keys = keys.slice(0, -1) };
        return { kind_: "pending", node, typed_: typed, keys, held_: typed };
      }
      const next = node.children[token] ?? ([...typed_char].length === 1 ? node.children[ANY_KEY] : void 0);
      const info = progress();
      if (!next) {
        reset();
        return { kind_: "no_match" };
      }
      if (next.kind === "leaf") {
        const kept = held;
        reset();
        const register = info.register_keys_?.[1];
        const fill = (step) => step.capture || register && step.register ? { ...step, invocation: { ...step.invocation, args: { ...step.invocation.args, ...step.capture && { [step.capture]: typed_char }, ...register && step.register && { register } } } } : step;
        if (kept) ({ node, typed, keys } = held = kept);
        return { kind_: "match", leaf: { ...next, steps: next.steps.map(fill) }, ...info, ...kept && { held_: kept.typed, keys: kept.keys } };
      }
      node = next;
      typed = [...typed, token];
      return { kind_: "pending", node: next, typed_: typed, ...info, ...held && { held_: held.typed } };
    };
    const feed = (mode, token) => {
      const in_progress = typed.length > 0 || count_digits + register_keys_ !== "";
      const result = walk(mode, token);
      return result.kind_ === "no_match" && in_progress && !result.ended_ ? walk(mode, token) : result;
    };
    const binds_after_ = (mode, ahead, token) => {
      const saved = [walk_mode, node, typed, count_digits, register_keys_, keys, held];
      let result = { kind_: "no_match" };
      for (const key of [...ahead, token]) {
        if (result.kind_ === "match") break;
        result = feed(mode, key);
      }
      [walk_mode, node, typed, count_digits, register_keys_, keys, held] = saved;
      return result.kind_ !== "no_match" || !!result.ended_;
    };
    return { feed, reset, binds_after_, passes_ };
  }

  // src/shared/browser_module_scope.ts
  function matcher_keymap_of(tree) {
    const branch = (node) => ({ kind: "branch", children: Object.fromEntries(Object.entries(node.children).map(([token, child]) => [token, typeof child === "string" || "native" in child ? { kind: "leaf", steps: [], scope: child } : branch(child)])) });
    return { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch(tree) }, mode_indicator: "off", which_key_delay_ms: 0, toast_ms: 0, toast_error_ms: 0 };
  }

  // src/shared/keys/token.ts
  var MODIFIER_KEY_NAMES = /* @__PURE__ */ new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);
  var is_letter = (char) => char.toLowerCase() !== char.toUpperCase();
  function format_token(mods, name) {
    return mods === "" && name.length > 1 ? `<${name}>` : mods === "" ? name : `<${mods}-${name}>`;
  }
  function event_to_token(event) {
    let key = event.key;
    if (MODIFIER_KEY_NAMES.has(key)) return null;
    if (key === " ") key = "Space";
    const is_single_char = [...key].length === 1;
    const has_command_modifier = event.ctrlKey || event.altKey || event.metaKey;
    let shift = event.shiftKey;
    if (is_single_char) {
      if (has_command_modifier && is_letter(key) && !/^[a-z]$/i.test(key)) {
        const code_letter = /^Key([A-Z])$/.exec(event.code);
        if (code_letter) key = code_letter[1];
      }
      if (is_letter(key)) {
        if (has_command_modifier) key = key.toLowerCase();
        else shift = false;
      } else {
        shift = false;
      }
    }
    const mods = (event.altKey ? "A" : "") + (event.ctrlKey ? "C" : "") + (event.metaKey ? "M" : "") + (shift ? "S" : "");
    return format_token(mods, key);
  }

  // browser_module/sources/commands.js
  var scope = globalThis;
  var core = Services.desertfox_browser_module;
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
      define(core);
    }
  }
  function define(core2) {
    const IGNORE_TOGGLE_KEY = "<S-Escape>";
    const ADDRESS_BAR_KEY = ":";
    const OMNIBOX_PREFIX = "df ";
    const MAX_NATIVE_REPEAT = 100;
    const LINE_HOLD_MS = 1500;
    const MAX_HELD_CHARS = 32;
    let walks = /* @__PURE__ */ new WeakMap();
    const tree_texts = /* @__PURE__ */ new WeakMap();
    const ignored = /* @__PURE__ */ new WeakMap();
    const holds = /* @__PURE__ */ new Map();
    const is_ignored = (browser2) => ignored.get(browser2) === browser2.innerWindowID;
    const NOTICE_LEAF = "notice";
    const noticed = /* @__PURE__ */ new WeakMap();
    const hint_notice_of = (browser2) => core2.locked_page_rule?.()?.hint_notice(browser2);
    function with_notice_leaves(tree) {
      for (const path of Array.isArray(tree.hint_keys) ? tree.hint_keys : []) {
        const tokens = path.split(" ");
        let node = tree;
        for (const [index, token] of tokens.entries()) {
          const child = Object.hasOwn(node.children, token) ? node.children[token] : void 0;
          const last = index === tokens.length - 1;
          if (child === void 0) {
            const added = last ? NOTICE_LEAF : { children: {} };
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
    function start_hold(win, browser2) {
      end_hold(win);
      const end = () => end_hold(win);
      const timer = win.setTimeout(end, LINE_HOLD_MS);
      win.gBrowser.tabContainer.addEventListener("TabSelect", end);
      win.addEventListener("deactivate", end);
      holds.set(win, {
        browser: browser2,
        typed: "",
        collecting: true,
        stop: () => {
          win.clearTimeout(timer);
          win.gBrowser.tabContainer.removeEventListener("TabSelect", end);
          win.removeEventListener("deactivate", end);
        }
      });
    }
    function hold_key(hold, event) {
      if (!hold.collecting || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Backspace") hold.typed = [...hold.typed].slice(0, -1).join("");
      else if ([...event.key].length === 1 && [...hold.typed].length < MAX_HELD_CHARS) hold.typed += event.key.replace(/[\p{Cc}\p{Cf}]/gu, "");
    }
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
      if (text === void 0) {
        const checked = validate_scope_tree(tree);
        text = checked.ok ? JSON.stringify(tree) : "";
        if (!checked.ok) core2.log_once(`the key tree was refused: ${checked.problem}`);
        tree_texts.set(tree, text);
      }
      return text;
    }
    function walk_for(win, browser2, text, notice) {
      const walk = walks.get(win);
      if (walk?.text === text && walk.notice === notice && walk.browser === browser2 && walk.inner === browser2.innerWindowID) return walk;
      const parsed = JSON.parse(text);
      const tree = notice === void 0 ? parsed : with_notice_leaves(parsed);
      const line_keys = new Set(Array.isArray(tree.line_keys) ? tree.line_keys : []);
      const fresh = { text, notice, browser: browser2, inner: browser2.innerWindowID, matcher: create_matcher(matcher_keymap_of(tree)), line_keys, pending: void 0 };
      walks.set(win, fresh);
      return fresh;
    }
    const path_of = (result) => result.keys.slice(String(result.count ?? "").length + (result.register_keys_?.length ?? 0));
    function run_native(leaf, result, context) {
      const { native, args, count_rule } = leaf;
      const count = result.count;
      const counted = count !== void 0 && typeof count_rule === "object" ? { ...args, [count_rule.param]: count } : args;
      const times = count !== void 0 && count_rule === "repeat" ? Math.min(count, MAX_NATIVE_REPEAT) : 1;
      for (let time = 0; time < times; time++) {
        if (!core2.run_command(native, counted, { window: context.window, browser: context.browser, tab: context.tab, repeat: context.event.repeat })) return false;
      }
      return true;
    }
    function forward(result, walk, win) {
      const keys = path_of(result).join(" ");
      const sent = core2.send("run", { keys, count: result.count ?? 0 });
      if (!sent.ok) core2.log_once(`a key was not sent to DesertFox: ${sent.problem}`);
      else if (walk.line_keys.has(keys)) start_hold(win, walk.browser);
      return sent.ok;
    }
    function notice_once(result, browser2) {
      if (noticed.get(browser2) === browser2.innerWindowID) return true;
      noticed.set(browser2, browser2.innerWindowID);
      const sent = core2.send("run", { keys: path_of(result).join(" "), count: 0 });
      if (!sent.ok) core2.log_once(`a hint key was not sent to DesertFox: ${sent.problem}`);
      return true;
    }
    function take_key(context) {
      const { window: win, browser: browser2, event, tree } = context;
      const token = event_to_token(event);
      if (token === null) return void 0;
      const hold = holds.get(win);
      if (hold?.browser === browser2 && event.key !== "Escape") {
        hold_key(hold, event);
        return true;
      }
      if (hold) {
        end_hold(win);
        if (event.key === "Escape") return true;
      }
      if (is_ignored(browser2)) {
        if (token !== IGNORE_TOGGLE_KEY) return false;
        ignored.delete(browser2);
        return true;
      }
      const text = tree === void 0 ? "" : tree_text(tree);
      const walk = text === "" ? void 0 : walk_for(win, browser2, text, hint_notice_of(browser2));
      if (!walk && context.row_runs) return void 0;
      const idle = walk === void 0 || walk.pending === void 0;
      if (idle && token === IGNORE_TOGGLE_KEY && !walk?.matcher.binds_after_("normal", [], token)) {
        ignored.set(browser2, browser2.innerWindowID);
        return true;
      }
      if (idle && token === ADDRESS_BAR_KEY && !walk?.matcher.binds_after_("normal", [], token)) return open_address_bar(win, OMNIBOX_PREFIX).ok;
      if (!walk) return void 0;
      const result = walk.matcher.feed("normal", token);
      walk.pending = void 0;
      if (result.held_ !== void 0) {
        walk.matcher.reset();
        return false;
      }
      if (result.kind_ === "pending") {
        walk.pending = { keys: path_of(result), ...result.count !== void 0 && { count: result.count } };
        return true;
      }
      if (result.kind_ !== "match") return false;
      const leaf = result.leaf.scope;
      if (result.register_keys_ !== void 0) return true;
      if (leaf === "forward") return forward(result, walk, win);
      if (leaf === NOTICE_LEAF) return notice_once(result, browser2);
      return run_native(leaf, result, context);
    }
    function pending_in(win) {
      const walk = walks.get(win);
      const browser2 = win?.gBrowser?.selectedBrowser;
      if (!walk?.pending || walk.browser !== browser2 || walk.inner !== browser2.innerWindowID) return void 0;
      return { keys: [...walk.pending.keys], ...walk.pending.count !== void 0 && { count: walk.pending.count } };
    }
    function open_address_bar(win, text) {
      const bar = win?.gURLBar;
      if (!bar || typeof bar.focus !== "function") return { ok: false, error: "This Firefox has no address bar to open" };
      bar.focus();
      bar.value = (text + take_held(win, true)).replace(/[\p{Cc}\p{Cf}]/gu, "");
      return { ok: true };
    }
    function focused_window() {
      const win = Services.focus?.activeWindow;
      if (!win || win.closed || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser" || !core2.may_act(win)) return void 0;
      return win;
    }
    const selected_tab_id = (win) => ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.apiManager.global.tabTracker.getId(win.gBrowser.selectedTab);
    core2.define_command("page.stop", { args: {}, run: ({ browser: browser2 }) => browser2.stop() });
    core2.register_kind("address_bar.open", ({ text, tab_id }) => {
      const win = focused_window();
      if (!win) return { ok: false, error: "No Firefox window has the focus" };
      if (tab_id !== void 0 && selected_tab_id(win) !== tab_id) return { ok: false, error: "The tab that asked is no longer selected" };
      return open_address_bar(win, OMNIBOX_PREFIX + text);
    });
    core2.take_keys({
      key: take_key,
      reset: (win) => {
        if (win) walks.delete(win);
        else walks = /* @__PURE__ */ new WeakMap();
        for (const held_win of win ? [win] : [...holds.keys()]) end_hold(held_win);
      },
      pending: pending_in,
      take_held
    });
  }
})();
