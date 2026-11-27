// DesertFox browser module, the core. Firefox loads it with browser privileges from its drop-in folder (`chrome.d`), once per browser window. See docs/design/browser_module.md.
// It takes DesertFox keys in the browser window on pages the extension cannot reach. It reads what to take from the extension's own `storage.session` (src/shared/browser_module_protocol.ts).
// It writes only its hello and the from-module message list, and reads the extension's requests from the from-extension list.
// Feature files (`desertfox-tabs-scroll.js` and later ones) run the commands. The core decides whether a key is DesertFox's to take here, and the feature that defined the key's command runs it.
//
// The file runs in two places. In a browser window it only hands the window to the core. The first window loads this same file into a system sandbox, which builds the core once per process.
// The core lives in the sandbox so that no listener the process keeps holds a closed window alive.
//
// The surface for feature files, on `Services.desertfox_browser_module` (a feature file sorts after this one in name order, so the core exists when it loads):
//   adopt(file_url)            In a window: load the feature file into the core sandbox, once per process. Only a file beside this one is taken.
//   define_command(id, spec)   In the sandbox: run command `id` when a key row names it. spec = { args: { name: { type: "int" | "number" | "enum", values? } }, run(context) }.
//                              The core checks every arg against `args` before `run`, and a row whose args fail is not taken.
//                              context = { window, browser, tab, args, repeat }.
//   add_frame_script(fn)       In the sandbox: load `fn` as a frame script into every tab, once, when the module turns on. The script stays loaded for the session, so it checks the pref itself.
//   register_kind(kind, fn)    In the sandbox: answer the extension's requests of `kind`, a kind on the copy of EXTENSION_TO_MODULE_KINDS below.
//                              fn(args) gets checked args and returns { ok, error?, value? } or a promise of it. `value` is text, copied into the reply. A throw or a rejection replies with a fixed error.
//   send(kind, args, on_reply) In the sandbox: start a call to the extension, a kind on the copy of MODULE_TO_EXTENSION_KINDS. Returns { ok: true, id } or { ok: false, problem }.
//                              on_reply(reply), optional, hears the extension's checked reply { reply_to, ok, error?, value? } once. A reply that never comes is forgotten after MAX_AWAITED_REPLIES newer calls.
//   watch_session(keys, fn)    In the sandbox: fn(key, value) on each change of one of `keys` in DesertFox's storage.session, through the core's one storage listener. `value` is undefined once the key is removed.
//   log_once(text)             One line in the browser console per distinct text.
//   may_act(win)               In the sandbox: whether the module may act in `win` at all (the pref, DesertFox running, private access, a valid state with the switch on), short of a page.
//   on_shut_down(fn)           In the sandbox: run `fn` when the module turns off for the session, so a feature takes its own listeners down.
//   sidebar_row(win, keys)     In the sandbox: the sidebar table's row for `keys` (one or two key tokens) as { id }, { prefix: true } when they begin a longer row, else undefined. Undefined too whenever may_act(win) is false.
//   token_of(event)            In the sandbox: the key token of a key event, as a key row names it, or null for a modifier alone.
//   is_field(element)          In the sandbox: whether `element` is a text field, the rule the core's own key gate uses.
//   deep_active(doc)           In the sandbox: the element with the focus in `doc`, followed into shadow roots.
//   focused_element(win)       In the sandbox: the element with the focus in `win`, followed into shadow roots and frames of this process.
//   ime_in_field(win)          In the sandbox: whether the window's input state says a text field has the focus, which covers a field in a page of another process.
//   type_key(win, key, still_holds)  In the sandbox: type `key` (an arrow key, Home, End or Enter) into `win` once the current key event is over, if `still_holds()` is then true.
//                              Returns false and types nothing for another key, or with the focus in a text field or DevTools.
//   hold_keys(win, owner)      In the sandbox: claim every key of `win` for the feature named `owner`. A feature's key listener leaves a key alone while another owner holds its window.
//                              Listener order cannot settle this, because Firefox calls the newest window watcher first.
//   release_keys(win, owner)   In the sandbox: end `owner`'s hold on `win`. A release by another owner does nothing.
//   keys_held_by(win)          In the sandbox: the owner holding the keys of `win`, or undefined.
// A feature file either lets an error in its start throw, and the core then turns the module off for the session, or undoes its own start and stays off alone. Either way no half of a feature takes keys.
//
// It never makes a network request and never runs code it reads from storage: a key row names a command from the fixed list the feature files define, with checked args.

(function desertfox_browser_module_core(scope) {
  "use strict";
  // Where every window and feature file finds the core. `Services` is one object for the whole parent process.
  const HOLDER = "desertfox_browser_module";
  const OFF = "off";
  const LOG_PREFIX = "DesertFox browser module: ";

  // Startup safety: nothing here may throw into the loader, and one failure turns the module off for the session.
  const turn_off = (error) => {
    try {
      const core = Services[HOLDER];
      Services[HOLDER] = OFF;
      if (typeof core === "object" && core !== null) core.shut_down();
      Components.utils.reportError(`${LOG_PREFIX}turned off for this session: ${error}`);
    } catch (_) {
      // Nothing is left to report with.
    }
  };

  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      if (Services[HOLDER] === undefined) {
        const sandbox = Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { sandboxName: "DesertFox browser module", wantGlobalProperties: ["ChromeUtils", "TextEncoder"] });
        Services.scriptloader.loadSubScriptWithOptions(own_file_url(), { target: sandbox, ignoreCache: true, allowUnsafeURL: true });
      }
      const core = Services[HOLDER];
      if (typeof core === "object" && core !== null) core.attach(scope);
    } catch (error) {
      turn_off(error);
    }
    return;
  }

  try {
    Services[HOLDER] = build_core(scope);
  } catch (error) {
    turn_off(error);
  }

  // A loader can name a file `a -> b` when it chains loads. The last part is this file.
  function own_file_url() {
    return Components.stack.filename.split(" -> ").pop();
  }

  function build_core(sandbox) {
    // A copy of the names, the version, the limits and the kind lists in src/shared/browser_module_protocol.ts. test/browser_module/core.test.ts keeps them equal.
    const EXTENSION_ID = "desertfox@uhs-robert";
    const PROTOCOL_VERSION = 1;
    const STATE_STORAGE_KEY = "desertfox_browser_module_state";
    const HELLO_STORAGE_KEY = "desertfox_browser_module_hello";
    const FROM_EXTENSION_STORAGE_KEY = "desertfox_browser_module_from_extension";
    const FROM_MODULE_STORAGE_KEY = "desertfox_browser_module_from_module";
    const MAX_KEY_ROWS = 32;
    const MAX_SIDEBAR_KEY_TOKENS = 2;
    const MAX_STATE_TABS = 1024;
    const MAX_MESSAGES = 16;
    const MAX_MESSAGE_LIST_BYTES = 4096;
    const MAX_ERROR_CHARS = 120;
    const DEFAULT_MAX_AGE_MS = 2000;
    const MAX_KIND_BYTES = 65536;
    const MESSAGE_ENVELOPE_BYTES = 512;
    const MAX_RESIZE_STEPS = 20;
    const PANE_REGIONS = ["sidebar", "page", "split", "devtools"];
    const EXTENSION_TO_MODULE_KINDS = {
      page_push: { args: { tab_id: "int", document_id: "int", message: "text" }, reply: true, max_bytes: 65536, max_age_ms: 10000 },
      "pane.split_new_tab": { args: {}, reply: true, max_bytes: 256 },
      "pane.split_next_tab": { args: {}, reply: true, max_bytes: 256 },
      "pane.unsplit": { args: {}, reply: true, max_bytes: 256 },
      "pane.close_both": { args: {}, reply: true, max_bytes: 256 },
      "pane.resize": { args: { steps: "step" }, reply: true, max_bytes: 256 },
      "pane.focus_region": { args: { region: "region" }, reply: true, max_bytes: 256 },
      "pane.focus_direction": { args: { direction: "direction" }, reply: true, max_bytes: 256 },
      "pane.equalize": { args: {}, reply: true, max_bytes: 256 },
      "address_bar.open": { args: { text: "text" }, reply: true, max_bytes: 4096 },
      "chrome_hints.collect": { args: { session: "int", window_id: "int", colors: "text" }, reply: true, max_bytes: 1024 },
      "chrome_hints.draw": { args: { session: "int", gen: "int", part: "int", parts: "int", typed: "text", labels: "text" }, reply: false, max_bytes: 4096 },
      "chrome_hints.pick": { args: { session: "int", id: "int" }, reply: true, max_bytes: 256 },
      "chrome_hints.clear": { args: { session: "int" }, reply: false, max_bytes: 256 },
    };
    const MODULE_TO_EXTENSION_KINDS = {
      page_call: { args: { tab_id: "int", document_id: "int", message: "text" }, reply: true, max_bytes: 65536, max_age_ms: 10000 },
      page_gone: { args: { tab_id: "int", document_id: "int" }, reply: false, max_bytes: 256, max_age_ms: 60000 },
      run: { args: { keys: "text", count: "int" }, reply: true, max_bytes: 512 },
      "chrome_hints.targets": { args: { session: "int", part: "int", parts: "int", targets: "text" }, reply: false, max_bytes: 4096 },
      "chrome_hints.key": { args: { session: "int", seq: "int", key: "text" }, reply: false, max_bytes: 256 },
      "chrome_hints.end": { args: { session: "int" }, reply: false, max_bytes: 256 },
    };
    const MODULE_VERSION = "1.0.0";
    // The kill switch. The module takes keys only while it is true, so a broken extension or module can be turned off from about:config.
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const REPORT_MESSAGE = "desertfox-browser-module:report";
    const REPORT_NOW_MESSAGE = "desertfox-browser-module:report-now";
    const BLUR_MESSAGE = "desertfox-browser-module:blur";

    const Ci = Components.interfaces;
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { ExtensionStorage, extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
    const { Management } = ChromeUtils.importESModule("resource://gre/modules/Extension.sys.mjs");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");

    const own_dir_url = own_file_url().replace(/[^/]*$/, "");
    const windows = new Map();
    const commands = new Map();
    const frame_scripts = [];
    const adopted = new Set();
    const logged = new Set();
    // The newest report of each tab's frame script, by its <browser>. A WeakMap, so a closed tab's report goes with it.
    // Emptied when the pref goes off: the frame scripts stop reporting then, so a report from before is stale when it comes back on.
    let reports = new WeakMap();
    let active = false;
    let shut = false;
    let cached = { extension: undefined, holder: undefined, state: undefined };
    let hello_for = new WeakSet();

    const log_once = (text) => {
      if (logged.has(text)) return;
      logged.add(text);
      Components.utils.reportError(LOG_PREFIX + text);
    };

    const enabled_by_pref = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (error) {
        log_once(`${ENABLED_PREF} is not true or false, so the module stays idle`);
        return false;
      }
    };

    const desertfox = () => ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);

    // ---- The channel: the state the extension writes, the hello the module writes.

    const KEY_TOKEN = /^[^\s\p{Cc}]{1,24}$/u;
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

    // The extension fills and checks every arg through its command schema, so the module checks the shape only. A row it cannot run (a command no feature defined, an arg of the wrong shape) is skipped, not fatal: a newer extension can send rows an older module does not know.
    function checked_args(spec, args) {
      if (!is_record(args)) return undefined;
      const out = {};
      for (const [name, rule] of Object.entries(spec.args ?? {})) {
        const value = Object.hasOwn(args, name) ? args[name] : undefined;
        const fits =
          rule.type === "enum" ? rule.values.includes(value) : typeof value === "number" && Number.isFinite(value) && (rule.type !== "int" || Number.isInteger(value));
        if (!fits) return undefined;
        out[name] = value;
      }
      return out;
    }

    // Accepts unknown fields. Claims nothing (undefined) when `v` differs, a limit is passed or a field it reads has the wrong shape, as validate_module_state does.
    // A row is the exception: one it cannot run is skipped, so a newer extension can send rows an older module does not know.
    function read_state_value(value) {
      if (!is_record(value) || value.v !== PROTOCOL_VERSION || typeof value.enabled !== "boolean") return undefined;
      if (!Array.isArray(value.keys) || value.keys.length > MAX_KEY_ROWS) return undefined;
      if (value.blur_on_load !== undefined && typeof value.blur_on_load !== "boolean") return undefined;
      if (value.tabs !== undefined && !is_record(value.tabs)) return undefined;
      const keys = new Map();
      for (const row of value.keys) {
        if (!is_record(row) || typeof row.key !== "string" || !KEY_TOKEN.test(row.key) || typeof row.id !== "string" || keys.has(row.key)) continue;
        keys.set(row.key, { id: row.id, args: row.args });
      }
      const given_tabs = value.tabs ?? {};
      const tab_ids = Object.keys(given_tabs);
      if (tab_ids.length > MAX_STATE_TABS) return undefined;
      const tabs = new Map();
      for (const id of tab_ids) {
        const tab = given_tabs[id];
        if (!/^\d{1,10}$/.test(id) || !is_record(tab) || typeof tab.mode !== "string" || typeof tab.live !== "boolean") return undefined;
        tabs.set(id, { mode: tab.mode, live: tab.live });
      }
      return { enabled: value.enabled, keys, tabs, blur_on_load: value.blur_on_load === true, sidebar_keys: read_sidebar_keys(value.sidebar_keys) };
    }

    // sidebar_keys_of: a bad table leaves the sidebar without keys and the rest of the state alone. Each row's key prefix maps to { prefix: true }.
    function read_sidebar_keys(value) {
      const rows = new Map();
      if (!Array.isArray(value) || value.length > MAX_KEY_ROWS) return rows;
      for (const row of value) {
        const keys = is_record(row) && Array.isArray(row.keys) ? row.keys : [];
        if (typeof row?.id !== "string" || keys.length === 0 || keys.length > MAX_SIDEBAR_KEY_TOKENS || !keys.every((key) => typeof key === "string" && KEY_TOKEN.test(key))) return new Map();
        const joined = keys.join(" ");
        if (rows.has(joined) || (keys.length > 1 && rows.get(keys[0])?.id)) return new Map();
        if (keys.length > 1) rows.set(keys[0], { prefix: true });
        rows.set(joined, { id: row.id });
      }
      return rows;
    }

    // The read is synchronous. The bucket keeps the holder the extension wrote until the next write, so the same holder means the same state.
    // An extension reload makes a new extension object with an empty bucket, so the module claims nothing until the extension writes the state again.
    function current_state(extension) {
      const holder = extensionStorageSession.get(extension, [STATE_STORAGE_KEY])[STATE_STORAGE_KEY];
      if (holder === undefined) return undefined;
      if (cached.extension === extension && cached.holder === holder) return cached.state;
      cached = { extension, holder, state: read_state_value(deserialized(holder)) };
      return cached.state;
    }

    const deserialized = (holder) => (typeof holder?.deserialize === "function" ? holder.deserialize(sandbox, true) : holder);
    const write_session = (extension, key, value) => extensionStorageSession.set(extension, { [key]: ExtensionStorage.serialize(key, key, value) });

    // The hello goes once to each extension object, only while the module is on. The extension reads it as foreign input.
    function say_hello(extension) {
      if (!active || !extension || hello_for.has(extension) || !enabled_by_pref()) return;
      hello_for.add(extension);
      write_session(extension, HELLO_STORAGE_KEY, { v: PROTOCOL_VERSION, module_version: MODULE_VERSION });
    }

    function take_back_hello() {
      const extension = desertfox();
      hello_for = new WeakSet();
      if (extension) extensionStorageSession.remove(extension, [HELLO_STORAGE_KEY]);
    }

    // ---- Where the key is and whether DesertFox is live there.

    const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);
    const is_letter = (char) => char.toLowerCase() !== char.toUpperCase();

    // A copy of event_to_token in src/shared/keys/token.ts, so a key row and a key event meet in one form. test/browser_module/core.test.ts compares the two.
    function token_of(event) {
      let key = event.key;
      if (MODIFIER_KEYS.has(key)) return null;
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
      return mods === "" && key.length > 1 ? `<${key}>` : mods === "" ? key : `<${mods}-${key}>`;
    }

    // The tab browser that gets the key, or null when the key is not for a page: the browser UI, DevTools (docked or its panels), a sidebar or a popup.
    // A remote page's key targets its <browser>. A page in this process (about:preferences) has its own document, and its top browsing context names the browser that holds it.
    function page_of(win, target) {
      const gBrowser = win.gBrowser;
      if (target?.localName === "browser" && gBrowser.getTabForBrowser(target)) return { browser: target, document: null };
      const doc = target?.ownerDocument;
      if (!doc || doc === win.document) return null;
      const context = doc.defaultView?.browsingContext;
      if (!context?.isContent) return null;
      const browser = context.top.embedderElement;
      return browser && gBrowser.getTabForBrowser(browser) ? { browser, document: doc } : null;
    }

    const TEXT_INPUT = /^(?!button$|checkbox$|radio$|submit$|reset$|image$|file$|range$|color$|hidden$)/;
    const is_field = (node) =>
      !!node?.localName &&
      (node.isContentEditable || node.localName === "textarea" || node.localName === "select" || (node.localName === "input" && TEXT_INPUT.test(node.type || "text")));

    function deep_active(doc) {
      let active_element = doc?.activeElement;
      while (active_element?.shadowRoot?.activeElement) active_element = active_element.shadowRoot.activeElement;
      return active_element;
    }

    // A page in this process is read directly. A remote page is read from its frame script's report, and the widget's input state covers a key that comes before the report: Firefox sets it when a text field takes the focus.
    function in_field(win, page, event) {
      if (page.document) return is_field(event.originalTarget) || is_field(deep_active(page.document)) || page.document.designMode === "on";
      const report = reports.get(page.browser);
      if (report?.inner === page.browser.innerWindowID && report.field) return true;
      return ime_in_field(win);
    }

    function ime_in_field(win) {
      const ime = win.windowUtils.IMEStatus;
      return ime === Ci.nsIDOMWindowUtils.IME_STATUS_ENABLED || ime === Ci.nsIDOMWindowUtils.IME_STATUS_PASSWORD;
    }

    // DesertFox handles the key itself where its content script is live: a listener in the shown document (the report for the current inner window), or the live mark the extension sets for the tab, which covers the time before a report.
    function desertfox_live(browser, tab_state) {
      const report = reports.get(browser);
      if (report?.inner === browser.innerWindowID && report.listeners > 0) return true;
      return tab_state?.live === true;
    }

    function tab_id_of(tab) {
      return ExtensionParent.apiManager.global.tabTracker.getId(tab);
    }

    // ---- The key.

    // The state when the module may act in this window at all: the pref, DesertFox running, private window access and the toolbar switch.
    function state_for(win) {
      if (!enabled_by_pref()) return undefined;
      const extension = desertfox();
      if (!extension) return undefined;
      if (PrivateBrowsingUtils.isWindowPrivate(win) && !extension.privateBrowsingAllowed) return undefined;
      const state = current_state(extension);
      return state?.enabled ? state : undefined;
    }

    // A tab with no record is in normal mode and DesertFox is not live there: a page it cannot reach never reports.
    function left_to_module(state, browser, tab) {
      const tab_state = state.tabs.get(String(tab_id_of(tab)));
      return (tab_state === undefined || tab_state.mode === "normal") && !desertfox_live(browser, tab_state);
    }

    function on_key(win, event) {
      if (!event.isTrusted || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (MODIFIER_KEYS.has(event.key)) return;
      const page = page_of(win, event.target);
      if (!page) return;
      const state = state_for(win);
      if (!state) return;
      const row = state.keys.get(token_of(event));
      const command = row && commands.get(row.id);
      if (!command) return;
      const args = checked_args(command, row.args);
      if (!args || in_field(win, page, event)) return;
      const tab = win.gBrowser.getTabForBrowser(page.browser);
      if (!left_to_module(state, page.browser, tab)) return;
      // The command runs first, so one that throws leaves the key to the page.
      command.run({ window: win, browser: page.browser, tab, args, repeat: event.repeat });
      event.preventDefault();
      event.stopPropagation();
    }

    // `blur_on_load`, as DesertFox does on web pages: a field the page focused as it loaded, before any key or click, loses the focus, so the keys work at once.
    // The frame script marks such a report, and the blur goes back to it only when the module would take a key on that page.
    function blur_load_focus(browser, inner) {
      // The windows the core attached, not `browser.ownerGlobal`: the window as the sandbox sees it through that path hides `gBrowser`.
      const win = [...windows.keys()].find((each) => each.gBrowser.getTabForBrowser(browser));
      if (!win) return;
      const tab = win.gBrowser.getTabForBrowser(browser);
      const state = state_for(win);
      if (state?.blur_on_load && left_to_module(state, browser, tab)) browser.messageManager.sendAsyncMessage(BLUR_MESSAGE, { inner });
    }

    // ---- Keys the module types into the browser window's own parts.

    const TYPED_KEY_CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Enter: 13 };

    // The element with the focus, followed into frames of this process (the sidebar panel, a docked DevTools toolbox).
    function focused_element(win) {
      let element = win.document.commandDispatcher?.focusedElement ?? deep_active(win.document);
      while ((element?.localName === "browser" || element?.localName === "iframe") && !element.isRemoteBrowser && element.contentDocument) {
        const inner = deep_active(element.contentDocument);
        if (!inner) break;
        element = inner;
      }
      return element;
    }

    // DevTools documents are chrome:// or about:devtools pages. A frame inside one (a panel of the toolbox) counts through its embedders.
    function in_devtools(element) {
      for (let doc = element?.ownerDocument; doc; doc = doc.defaultView?.browsingContext?.embedderElement?.ownerDocument) {
        const url = String(doc.documentURI ?? "");
        if (url.startsWith("chrome://devtools/") || url.startsWith("about:devtools")) return true;
      }
      return false;
    }

    // A text input processor refuses to start inside a key's dispatch, so the key goes out after the current event. The focus can move before then, so the guards run again.
    function type_key(win, key, still_holds) {
      if (!Object.hasOwn(TYPED_KEY_CODES, key)) return false;
      const refused = () => {
        const focused = focused_element(win);
        return is_field(focused) || ime_in_field(win) || in_devtools(focused);
      };
      if (refused()) return false;
      win.setTimeout(() => {
        try {
          if (shut || win.closed || refused() || !still_holds()) return;
          const processor = Components.classes["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
          if (!processor.beginInputTransaction(win, () => true)) {
            log_once(`Firefox refused to type ${key}`);
            return;
          }
          const event = new win.KeyboardEvent("", { key, code: key, keyCode: TYPED_KEY_CODES[key] });
          processor.keydown(event);
          processor.keyup(event);
        } catch (error) {
          log_once(`a typed ${key} was dropped after an error: ${error}`);
        }
      }, 0);
      return true;
    }

    // ---- The frame script: per document, whether DesertFox's content script listens and whether the focus is in a field.

    function report_frame_script() {
      const ADDON_ID = "desertfox@uhs-robert";
      const MESSAGE = "desertfox-browser-module:report";
      const ENABLED_PREF = "desertfox.browser_module.enabled";
      // LOAD_BLUR_MS: the window of `blur_on_load` in src/content/main.ts.
      const LOAD_BLUR_MS = 1000;
      const listener_service = Components.classes["@mozilla.org/eventlistenerservice;1"].getService(Components.interfaces.nsIEventListenerService);
      const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
      // A content script's listener lives in its sandbox, whose metadata names the add-on. DesertFox needs no change for this.
      function desertfox_listeners(win) {
        let count = 0;
        for (const target of [win, win.document, win.document?.documentElement]) {
          if (!target) continue;
          let infos = [];
          try {
            infos = listener_service.getListenerInfoFor(target);
          } catch (_) {
            continue;
          }
          for (const info of infos) {
            if (info.type !== "keydown") continue;
            try {
              const metadata = Components.utils.getSandboxMetadata(Components.utils.getGlobalForObject(info.listenerObject));
              if (metadata?.addonId === ADDON_ID) count++;
            } catch (_) {
              // A listener of the page itself has no sandbox metadata.
            }
          }
        }
        return count;
      }
      const TEXT_INPUT = /^(?!button$|checkbox$|radio$|submit$|reset$|image$|file$|range$|color$|hidden$)/;
      const is_field = (node) =>
        !!node?.localName &&
        (node.isContentEditable || node.localName === "textarea" || node.localName === "select" || (node.localName === "input" && TEXT_INPUT.test(node.type || "text")));
      function deep_active(doc) {
        let active_element = doc?.activeElement;
        while (active_element?.shadowRoot?.activeElement) active_element = active_element.shadowRoot.activeElement;
        return active_element;
      }
      // Loaded once for the session, so it does nothing while the pref is off.
      const module_on = () => {
        try {
          return Services.prefs.getBoolPref(ENABLED_PREF, false);
        } catch (_) {
          return false;
        }
      };
      let load_blur_ends = 0;
      const open_load_blur = () => {
        load_blur_ends = Date.now() + LOAD_BLUR_MS;
      };
      // Whether the focus is still the page's own: no key or click reached the document yet, and the load window is open.
      const page_focus = (win) => Date.now() < load_blur_ends && !win.navigator.userActivation?.hasBeenActive;
      function report() {
        try {
          const win = content;
          if (!module_on() || !win?.document || !win.windowGlobalChild) return;
          const field = is_field(deep_active(win.document)) || win.document.designMode === "on";
          sendAsyncMessage(MESSAGE, { inner: win.windowGlobalChild.innerWindowId, listeners: desertfox_listeners(win), field, load_focus: field && page_focus(win) });
        } catch (_) {
          // A document going away mid-report sends nothing. The next report covers it.
        }
      }
      const for_top = (handler) => (event) => {
        if (event.target === content?.document) handler();
      };
      addEventListener("DOMContentLoaded", for_top(() => (open_load_blur(), report())), true);
      addEventListener("pageshow", for_top(report), true);
      // A content script that came after DOMContentLoaded shows on this later look.
      addEventListener("load", for_top(() => (open_load_blur(), setTimeout(report, 500))), true);
      addEventListener("focusin", report, true);
      addEventListener("focusout", () => setTimeout(report, 0), true);
      addMessageListener("desertfox-browser-module:report-now", report);
      addMessageListener("desertfox-browser-module:blur", ({ data }) => {
        try {
          const win = content;
          if (!module_on() || win?.windowGlobalChild?.innerWindowId !== data?.inner || !page_focus(win)) return;
          const focused = deep_active(win.document);
          if (is_field(focused)) focused.blur();
        } catch (_) {
          // A document going away keeps its focus.
        }
      });
      report();
    }

    const frame_script_url = (fn) => "data:application/javascript;charset=utf-8," + encodeURIComponent(`(${fn})();`);

    function activate() {
      if (active || shut) return;
      active = true;
      for (const fn of frame_scripts) Services.mm.loadFrameScript(frame_script_url(fn), true);
      say_hello(desertfox());
    }

    function on_pref_change() {
      try {
        // The frame scripts load once and stay, but a pref turned off took the hello back, so turning it on says it again and asks each tab for a fresh report.
        if (enabled_by_pref()) {
          const was_active = active;
          activate();
          say_hello(desertfox());
          if (was_active) Services.mm.broadcastAsyncMessage(REPORT_NOW_MESSAGE);
        } else if (active) {
          take_back_hello();
          reports = new WeakMap();
          fail_awaited("the module turned off");
        }
      } catch (error) {
        log_once(`the switch change failed: ${error}`);
      }
    }

    // ---- The messages. The extension's requests come on its from-extension list, and the module's own requests and replies go on the from-module list.
    // src/background/browser_module.ts is the other end. The checks copy validate_message_list in src/shared/browser_module_protocol.ts.

    const MESSAGE_ID = /^[A-Za-z0-9_-]{1,32}$/;
    const HANDLER_FAILED = "the request failed";
    const kind_handlers = new Map();
    // The one storage listener: DesertFox's bucket and its listeners belong to one extension object, so a reloaded DesertFox needs it again.
    let listening = { extension: undefined, stop: () => undefined };
    // Per extension object: the ids already handled, and the module's own list as last written. An extension reload empties both lists.
    const handled_ids = new WeakMap();
    const own_lists = new WeakMap();
    let sent = 0;
    // The on_reply of each call the module started, by request id, oldest first.
    const MAX_AWAITED_REPLIES = 256;
    const awaited_replies = new Map();
    const session_watchers = new Map();

    // As the extension's reader does, an error loses control and bidi characters before anyone shows it.
    const printable = (text) => text.replace(/[\p{Cc}\p{Cf}]/gu, "");
    const arg_fits = (kind, value) => {
      if (kind === "axis") return value === "x" || value === "y";
      if (kind === "text") return typeof value === "string";
      if (kind === "region") return PANE_REGIONS.includes(value);
      if (kind === "direction") return value === "left" || value === "right";
      if (kind === "step") return Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_RESIZE_STEPS;
      return typeof value === "number" && Number.isFinite(value) && (kind !== "int" || Number.isInteger(value));
    };
    // json_bytes: undefined for a value that is not plain data.
    const byte_size = (value) => {
      try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : new TextEncoder().encode(text).length;
      } catch (_) {
        return undefined;
      }
    };
    const fits_bytes = (value, limit) => (byte_size(value) ?? Number.POSITIVE_INFINITY) <= limit;
    // kind_bytes and message_list_bytes: a list has room for two of its largest messages and the envelopes beside them.
    const kind_bytes = (row) => Math.min(row.max_bytes ?? MAX_MESSAGE_LIST_BYTES, MAX_KIND_BYTES);
    const list_bytes = (kinds) => Math.max(MAX_MESSAGE_LIST_BYTES, ...Object.values(kinds).map((row) => 2 * kind_bytes(row))) + MESSAGE_ENVELOPE_BYTES;

    // validate_message: { message } or { problem }.
    function checked_message(value, kinds) {
      if (!is_record(value)) return { problem: "a message must be a table" };
      if (value.v !== PROTOCOL_VERSION) return { problem: "a message has another protocol version" };
      if (value.reply_to !== undefined) {
        if (typeof value.reply_to !== "string" || !MESSAGE_ID.test(value.reply_to)) return { problem: "reply_to must be a message id" };
        if (typeof value.ok !== "boolean") return { problem: "ok must be true or false" };
        if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > MAX_ERROR_CHARS)) return { problem: "error must be short text" };
        if (value.value !== undefined && (typeof value.value !== "string" || !fits_bytes(value, MAX_KIND_BYTES))) return { problem: "value must be text within the size limit" };
        return { message: { reply_to: value.reply_to, ok: value.ok, ...(value.error === undefined ? {} : { error: printable(value.error) }), ...(value.value === undefined ? {} : { value: value.value }) } };
      }
      if (typeof value.id !== "string" || !MESSAGE_ID.test(value.id)) return { problem: "a request needs an id of 1 to 32 letters, digits, - or _" };
      if (typeof value.kind !== "string" || !Object.hasOwn(kinds, value.kind)) return { problem: "the kind is not on the allow list" };
      if (!fits_bytes(value, kind_bytes(kinds[value.kind]))) return { problem: `a ${value.kind} message is over its size limit` };
      if (value.sent_at !== undefined && (typeof value.sent_at !== "number" || !Number.isSafeInteger(value.sent_at) || value.sent_at < 0)) return { problem: "sent_at must be whole ms since the epoch" };
      const given = value.args ?? {};
      if (!is_record(given)) return { problem: "args must be a table" };
      const args = {};
      for (const [name, kind] of Object.entries(kinds[value.kind].args)) {
        if (!arg_fits(kind, given[name])) return { problem: `${value.kind} ${name} has the wrong shape` };
        args[name] = given[name];
      }
      return { message: { v: PROTOCOL_VERSION, id: value.id, kind: value.kind, args, ...(value.sent_at === undefined ? {} : { sent_at: value.sent_at }) } };
    }

    // validate_message_list with `now`: undefined for a list that is not a list or is too big, else the messages and the refused requests with a usable id.
    function checked_list(value, kinds, now) {
      if (!Array.isArray(value) || value.length > MAX_MESSAGES || !fits_bytes(value, list_bytes(kinds))) return undefined;
      const list = { messages: [], refused: [] };
      for (const item of value) {
        const { message, problem } = checked_message(item, kinds);
        if (message?.id !== undefined && message.sent_at !== undefined && now - message.sent_at > (kinds[message.kind].max_age_ms ?? DEFAULT_MAX_AGE_MS)) {
          if (kinds[message.kind].reply) list.refused.push({ id: message.id, error: "the request is too old" });
        } else if (message) list.messages.push(message);
        else if (is_record(item) && item.v === PROTOCOL_VERSION && item.reply_to === undefined && typeof item.id === "string" && MESSAGE_ID.test(item.id) && (typeof item.kind !== "string" || !Object.hasOwn(kinds, item.kind) || kinds[item.kind].reply)) {
          list.refused.push({ id: item.id, error: problem.slice(0, MAX_ERROR_CHARS) });
        }
      }
      return list;
    }

    // A bounded memory: the oldest ids go first.
    function first_time(extension, id) {
      let ids = handled_ids.get(extension);
      if (!ids) handled_ids.set(extension, (ids = new Set()));
      if (ids.has(id)) return false;
      ids.add(id);
      for (const old of ids) if (ids.size > 4 * MAX_MESSAGES) ids.delete(old);
      return true;
    }

    // The newest messages that fit both caps, as the extension's writer keeps them. Nothing is written once the pref is off or DesertFox was reloaded, so a late reply goes nowhere.
    function append_own(extension, messages) {
      if (!enabled_by_pref() || shut || desertfox() !== extension) return false;
      let kept = [...(own_lists.get(extension) ?? []), ...messages].slice(-MAX_MESSAGES);
      while (kept.length > 0 && !fits_bytes(kept, list_bytes(MODULE_TO_EXTENSION_KINDS))) kept = kept.slice(1);
      own_lists.set(extension, kept);
      write_session(extension, FROM_MODULE_STORAGE_KEY, kept);
      return true;
    }

    const reply_to = (id, ok, error, value) => ({ v: PROTOCOL_VERSION, reply_to: id, ok, ...(error === undefined ? {} : { error }), ...(value === undefined ? {} : { value }) });

    // A handler's result as a reply: `ok` only when it says so, its own error text cut to the cap, and a text `value` within the kind's limit (reply_fits).
    function reply_of(request, result) {
      if (!is_record(result)) return reply_to(request.id, false, HANDLER_FAILED);
      const reply = reply_to(request.id, result.ok === true, typeof result.error === "string" ? printable(result.error).slice(0, MAX_ERROR_CHARS) : undefined, typeof result.value === "string" ? result.value : undefined);
      return fits_bytes(reply, kind_bytes(EXTENSION_TO_MODULE_KINDS[request.kind])) ? reply : reply_to(request.id, false, "the answer is too large");
    }

    function run_request(extension, request) {
      const wants_reply = EXTENSION_TO_MODULE_KINDS[request.kind].reply;
      const handler = kind_handlers.get(request.kind);
      if (!handler) {
        if (wants_reply) append_own(extension, [reply_to(request.id, false, "no handler for this kind")]);
        return;
      }
      // In a microtask, so the storage listener returns before any handler runs, and a handler that throws at once becomes a reply like one that rejects.
      Promise.resolve()
        .then(() => handler(request.args))
        .then(
          (result) => reply_of(request, result),
          (error) => {
            log_once(`the handler of ${request.kind} failed: ${error}`);
            return reply_to(request.id, false, HANDLER_FAILED);
          },
        )
        .then((reply) => {
          if (wants_reply) append_own(extension, [reply]);
        })
        .catch((error) => log_once(`a reply was not written: ${error}`));
    }

    // Each change carries the whole list, so the reader takes `newValue` and never reads the list again.
    function on_storage_change(extension, changes) {
      try {
        if (!enabled_by_pref() || shut || desertfox() !== extension) return;
        for (const [key, watcher] of session_watchers) if (Object.hasOwn(changes, key)) tell_watcher(watcher, key, changes[key].newValue);
        if (!Object.hasOwn(changes, FROM_EXTENSION_STORAGE_KEY)) return;
        const holder = changes[FROM_EXTENSION_STORAGE_KEY].newValue;
        if (holder === undefined) return;
        const list = checked_list(deserialized(holder), EXTENSION_TO_MODULE_KINDS, Date.now());
        if (!list) return;
        const refusals = list.refused.filter(({ id }) => first_time(extension, id)).map(({ id, error }) => reply_to(id, false, error));
        if (refusals.length > 0) append_own(extension, refusals);
        for (const message of list.messages) {
          if (message.reply_to !== undefined) {
            if (first_time(extension, `reply:${message.reply_to}`)) hand_reply(message);
          } else if (first_time(extension, message.id)) run_request(extension, message);
        }
      } catch (error) {
        log_once(`a message list from DesertFox was dropped after an error: ${error}`);
      }
    }

    function tell_watcher(watcher, key, holder) {
      try {
        watcher(key, holder === undefined ? undefined : deserialized(holder));
      } catch (error) {
        log_once(`the watcher of ${key} failed: ${error}`);
      }
    }

    // Every call still waiting for its reply gets a failure, as no reply can come once the module stops reading.
    function fail_awaited(why) {
      for (const id of [...awaited_replies.keys()]) hand_reply(reply_to(id, false, why));
    }

    function hand_reply(reply) {
      const on_reply = awaited_replies.get(reply.reply_to);
      if (!on_reply) return;
      awaited_replies.delete(reply.reply_to);
      try {
        on_reply(reply);
      } catch (error) {
        log_once(`the reply handler of a call failed: ${error}`);
      }
    }

    function listen(extension) {
      if (!extension || listening.extension === extension) return;
      listening.stop();
      const stop = extensionStorageSession.registerListener(extension, (changes) => on_storage_change(extension, changes));
      listening = { extension, stop };
    }

    // ---- Once per process.

    function on_report(message) {
      try {
        const data = message.data;
        if (!is_record(data) || typeof data.inner !== "number" || typeof data.listeners !== "number" || typeof data.field !== "boolean") return;
        reports.set(message.target, { inner: data.inner, listeners: data.listeners, field: data.field });
        if (data.load_focus === true && data.field) blur_load_focus(message.target, data.inner);
      } catch (error) {
        log_once(`a report was dropped after an error: ${error}`);
      }
    }

    function on_ready(_name, extension) {
      try {
        if (extension?.id !== EXTENSION_ID) return;
        listen(extension);
        say_hello(extension);
      } catch (error) {
        log_once(`the hello failed: ${error}`);
      }
    }

    // ---- Once per process. Each registration is undone at shut down, and a start that fails halfway undoes what it did.

    const undo = [];
    try {
      frame_scripts.push(report_frame_script);
      Services.mm.addMessageListener(REPORT_MESSAGE, on_report);
      undo.push(() => Services.mm.removeMessageListener(REPORT_MESSAGE, on_report));
      Services.prefs.addObserver(ENABLED_PREF, on_pref_change);
      undo.push(() => Services.prefs.removeObserver(ENABLED_PREF, on_pref_change));
      Management.on("ready", on_ready);
      undo.push(() => Management.off("ready", on_ready));
      undo.push(() => listening.stop());
      listen(desertfox());
      if (enabled_by_pref()) activate();
    } catch (error) {
      shut = true;
      for (const step of undo) step();
      throw error;
    }

    // Turning off for the session also takes every window's listener away, and every feature's.
    const shut_down_steps = [];
    const key_holders = new WeakMap();
    const core = {
      attach(win) {
        if (shut || windows.has(win)) return;
        const keydown = (event) => {
          try {
            on_key(win, event);
          } catch (error) {
            // A Firefox internal that changed lands here: the key goes on to the page as if the module were not there.
            log_once(`a key was left to the page after an error: ${error}`);
          }
        };
        const unload = () => detach(win);
        win.addEventListener("keydown", keydown, true);
        win.addEventListener("unload", unload, { once: true });
        windows.set(win, () => {
          win.removeEventListener("keydown", keydown, true);
          win.removeEventListener("unload", unload);
        });
      },
      adopt(file_url) {
        if (adopted.has(file_url)) return;
        if (!file_url.startsWith(own_dir_url) || !/^[^/]+\.js$/.test(file_url.slice(own_dir_url.length))) {
          log_once(`refused a feature file outside its own folder: ${file_url}`);
          return;
        }
        adopted.add(file_url);
        try {
          Services.scriptloader.loadSubScriptWithOptions(file_url, { target: sandbox, ignoreCache: true, allowUnsafeURL: true });
        } catch (error) {
          turn_off(`the feature file ${file_url.slice(own_dir_url.length)} failed to start: ${error}`);
        }
      },
      define_command(id, spec) {
        if (commands.has(id)) log_once(`two feature files define ${id}, the first one runs it`);
        else commands.set(id, spec);
      },
      add_frame_script(fn) {
        frame_scripts.push(fn);
        if (active) Services.mm.loadFrameScript(frame_script_url(fn), true);
      },
      register_kind(kind, handler) {
        if (!Object.hasOwn(EXTENSION_TO_MODULE_KINDS, kind)) log_once(`${kind} is not a kind the extension sends, so nothing answers it`);
        else if (kind_handlers.has(kind)) log_once(`two feature files answer ${kind}, the first one does`);
        else kind_handlers.set(kind, handler);
      },
      send(kind, args = {}, on_reply = undefined) {
        const now = Date.now();
        const { message, problem } = checked_message({ v: PROTOCOL_VERSION, id: `m${now.toString(36)}-${sent++}`, kind, args, sent_at: now }, MODULE_TO_EXTENSION_KINDS);
        if (!message) return { ok: false, problem };
        const extension = desertfox();
        // Set before the write, so a reply the extension writes at once finds it.
        if (typeof on_reply === "function") awaited_replies.set(message.id, on_reply);
        let written = false;
        try {
          written = !!extension && append_own(extension, [message]);
        } catch (error) {
          log_once(`a call was not written: ${error}`);
        }
        if (!written) {
          awaited_replies.delete(message.id);
          return { ok: false, problem: "the module or DesertFox is off" };
        }
        // The oldest waits past the cap end with a failure, so no caller waits forever.
        for (const id of awaited_replies.keys()) if (awaited_replies.size > MAX_AWAITED_REPLIES) hand_reply(reply_to(id, false, "too many calls wait for a reply"));
        return { ok: true, id: message.id };
      },
      watch_session(keys, watcher) {
        for (const key of keys) {
          if (session_watchers.has(key)) log_once(`two feature files watch ${key}, the first one hears it`);
          else session_watchers.set(key, watcher);
        }
      },
      log_once,
      may_act: (win) => state_for(win) !== undefined,
      sidebar_row: (win, keys) => state_for(win)?.sidebar_keys.get(keys.join(" ")),
      token_of,
      is_field,
      deep_active,
      focused_element,
      ime_in_field,
      type_key,
      on_shut_down(fn) {
        shut_down_steps.push(fn);
      },
      hold_keys(win, owner) {
        key_holders.set(win, owner);
      },
      release_keys(win, owner) {
        if (key_holders.get(win) === owner) key_holders.delete(win);
      },
      keys_held_by: (win) => key_holders.get(win),
      shut_down() {
        fail_awaited("the module shut down");
        try {
          take_back_hello();
        } catch (error) {
          log_once(`the hello was not taken back: ${error}`);
        }
        for (const step of shut_down_steps.splice(0)) {
          try {
            step();
          } catch (error) {
            log_once(`a feature failed to shut down: ${error}`);
          }
        }
        for (const win of [...windows.keys()]) detach(win);
        for (const step of undo) step();
        active = false;
        shut = true;
      },
      // For the key test and the browser console: what the module did, never page data.
      status: () => ({ active, windows: windows.size, commands: [...commands.keys()], features: [...adopted].map((url) => url.slice(own_dir_url.length)), errors: [...logged] }),
    };

    function detach(win) {
      windows.get(win)?.();
      windows.delete(win);
    }

    return core;
  }
})(this);
