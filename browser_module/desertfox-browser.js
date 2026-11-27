// DesertFox browser module, the core. Firefox loads it with browser privileges from its drop-in folder (`chrome.d`), once per browser window. See docs/design/browser_module.md.
// It takes DesertFox keys in the browser window on pages the extension cannot reach. It reads what to take from the extension's own `storage.session` (src/shared/browser_module_protocol.ts) and sends the extension only its hello.
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
//   add_frame_script(fn)       In the sandbox: load `fn` as a frame script into every tab, once, when the module turns on.
//   log_once(text)             One line in the browser console per distinct text.
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
        const sandbox = Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { sandboxName: "DesertFox browser module", wantGlobalProperties: ["ChromeUtils"] });
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
    // A copy of the names and the version in src/shared/browser_module_protocol.ts. test/browser_module/protocol_copy.test.ts keeps them equal.
    const EXTENSION_ID = "desertfox@uhs-robert";
    const PROTOCOL_VERSION = 1;
    const STATE_STORAGE_KEY = "desertfox_browser_module_state";
    const HELLO_STORAGE_KEY = "desertfox_browser_module_hello";
    const MODULE_VERSION = "1.0.0";
    // The kill switch. The module takes keys only while it is true, so a broken extension or module can be turned off from about:config.
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const REPORT_MESSAGE = "desertfox-browser-module:report";

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
    const reports = new WeakMap();
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

    // Accepts unknown fields. Claims nothing (undefined) when `v` differs or the shape is wrong.
    function read_state_value(value) {
      if (!is_record(value) || value.v !== PROTOCOL_VERSION || typeof value.enabled !== "boolean" || !Array.isArray(value.keys)) return undefined;
      const keys = new Map();
      for (const row of value.keys) {
        if (!is_record(row) || typeof row.key !== "string" || !KEY_TOKEN.test(row.key) || typeof row.id !== "string" || keys.has(row.key)) continue;
        keys.set(row.key, { id: row.id, args: row.args });
      }
      if (value.tabs !== undefined && !is_record(value.tabs)) return undefined;
      return { enabled: value.enabled, keys, tabs: value.tabs ?? {} };
    }

    // The read is synchronous. The bucket keeps the holder the extension wrote until the next write, so the same holder means the same state.
    // An extension reload makes a new extension object with an empty bucket, so the module claims nothing until the extension writes the state again.
    function current_state(extension) {
      const holder = extensionStorageSession.get(extension, [STATE_STORAGE_KEY])[STATE_STORAGE_KEY];
      if (holder === undefined) return undefined;
      if (cached.extension === extension && cached.holder === holder) return cached.state;
      const value = typeof holder?.deserialize === "function" ? holder.deserialize(sandbox, true) : holder;
      cached = { extension, holder, state: read_state_value(value) };
      return cached.state;
    }

    // The hello goes once to each extension object, only while the module is on. The extension reads it as foreign input.
    function say_hello(extension) {
      if (!active || !extension || hello_for.has(extension)) return;
      hello_for.add(extension);
      const hello = { v: PROTOCOL_VERSION, module_version: MODULE_VERSION };
      extensionStorageSession.set(extension, { [HELLO_STORAGE_KEY]: ExtensionStorage.serialize(HELLO_STORAGE_KEY, HELLO_STORAGE_KEY, hello) });
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

    function on_key(win, event) {
      if (!event.isTrusted || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (MODIFIER_KEYS.has(event.key) || !enabled_by_pref()) return;
      const page = page_of(win, event.target);
      if (!page) return;
      const extension = desertfox();
      if (!extension) return;
      if (PrivateBrowsingUtils.isWindowPrivate(win) && !extension.privateBrowsingAllowed) return;
      const state = current_state(extension);
      if (!state?.enabled) return;
      const row = state.keys.get(token_of(event));
      const command = row && commands.get(row.id);
      if (!command) return;
      const args = checked_args(command, row.args);
      if (!args || in_field(win, page, event)) return;
      const tab = win.gBrowser.getTabForBrowser(page.browser);
      // A tab with no record is in normal mode and DesertFox is not live there: a page it cannot reach never reports.
      const tab_state = state.tabs[String(tab_id_of(tab))];
      if ((tab_state !== undefined && tab_state.mode !== "normal") || desertfox_live(page.browser, tab_state)) return;
      event.preventDefault();
      event.stopPropagation();
      command.run({ window: win, browser: page.browser, tab, args, repeat: event.repeat });
    }

    // ---- The frame script: per document, whether DesertFox's content script listens and whether the focus is in a field.

    function report_frame_script() {
      const ADDON_ID = "desertfox@uhs-robert";
      const MESSAGE = "desertfox-browser-module:report";
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
      function report() {
        try {
          const win = content;
          if (!win?.document || !win.windowGlobalChild) return;
          sendAsyncMessage(MESSAGE, { inner: win.windowGlobalChild.innerWindowId, listeners: desertfox_listeners(win), field: is_field(deep_active(win.document)) || win.document.designMode === "on" });
        } catch (_) {
          // A document going away mid-report sends nothing. The next report covers it.
        }
      }
      const for_top = (handler) => (event) => {
        if (event.target === content?.document) handler();
      };
      addEventListener("DOMContentLoaded", for_top(report), true);
      addEventListener("pageshow", for_top(report), true);
      // A content script that came after DOMContentLoaded shows on this later look.
      addEventListener("load", for_top(() => setTimeout(report, 500)), true);
      addEventListener("focusin", report, true);
      addEventListener("focusout", () => setTimeout(report, 0), true);
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
        // The frame scripts load once, but a pref turned off took the hello back, so turning it on says it again.
        if (enabled_by_pref()) {
          activate();
          say_hello(desertfox());
        } else if (active) take_back_hello();
      } catch (error) {
        log_once(`the switch change failed: ${error}`);
      }
    }

    // ---- Once per process.

    frame_scripts.push(report_frame_script);
    Services.mm.addMessageListener(REPORT_MESSAGE, (message) => {
      const data = message.data;
      if (is_record(data) && typeof data.inner === "number" && typeof data.listeners === "number" && typeof data.field === "boolean") reports.set(message.target, data);
    });
    Services.prefs.addObserver(ENABLED_PREF, on_pref_change);
    Management.on("ready", (_name, extension) => {
      try {
        if (extension?.id === EXTENSION_ID) say_hello(extension);
      } catch (error) {
        log_once(`the hello failed: ${error}`);
      }
    });
    if (enabled_by_pref()) activate();

    // Turning off for the session also takes every window's listener away.
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
          log_once(`the feature file ${file_url.slice(own_dir_url.length)} failed to load: ${error}`);
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
      log_once,
      shut_down() {
        for (const win of [...windows.keys()]) detach(win);
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
