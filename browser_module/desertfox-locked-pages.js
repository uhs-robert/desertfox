// DesertFox browser module, the locked pages feature: DesertFox's own page code (`content.js` and the bundles) in the PDF viewer and Reader View, where no content script runs. See docs/design/browser_module.md.
// Chrome only carries the page code's messages. It hands the JSON text of each one on as it came and never parses it, so no message can pick an action, an address or a selector for chrome code.
// The code runs in a sandbox under the expanded principal [page, extension], as Firefox runs a content script, never under the system principal. Every other page, about:addons and about:preferences included, gets nothing.
//
// Two halves. In the core sandbox (one per parent process): the attach rule, the page calls through the core's `send`, the pushes through `register_kind`, and the snapshots through `watch_session`.
// In each tab (the frame script below): the sandbox, the files it loads from the extension, and the transport the shim (src/content/locked_shim.ts) takes as `desertfox_locked_transport`.

(function desertfox_browser_module_locked_pages(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the locked pages feature failed to load: ${error}`);
    }
    return;
  }
  // In the sandbox an error goes on to the core's `adopt`, which turns the module off for the session.
  define(core, scope);

  function define(core, sandbox) {
    // Copies of src/shared: the snapshot keys (config/storage_keys.ts) and the version (browser_module_protocol.ts). test/browser_module/locked_pages.test.ts keeps them equal.
    const EXTENSION_ID = "desertfox@uhs-robert";
    const PROTOCOL_VERSION = 1;
    const SNAPSHOT_KEYS = {
      keymap: "desertfox_browser_module_snapshot_keymap",
      config: "desertfox_browser_module_snapshot_config",
      theme: "desertfox_browser_module_snapshot_theme",
      which_key: "desertfox_browser_module_snapshot_which_key",
    };
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const MESSAGE = {
      attach: "desertfox-browser-module:locked-attach",
      attached: "desertfox-browser-module:locked-attached",
      detach: "desertfox-browser-module:locked-detach",
      gone: "desertfox-browser-module:locked-gone",
      call: "desertfox-browser-module:locked-call",
      answer: "desertfox-browser-module:locked-answer",
      push: "desertfox-browser-module:locked-push",
      push_answer: "desertfox-browser-module:locked-push-answer",
      snapshot: "desertfox-browser-module:locked-snapshot",
    };
    const WENT_AWAY = "the page went away";

    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");

    const desertfox = () => ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
    const tab_tracker = () => ExtensionParent.apiManager.global.tabTracker;
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const module_on = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };

    // Each attach of page code to a document, by its <browser>. The id is the page call's `document_id`: one per attach, never reused in the session, so a call from a document a load left is refused and a page Back restores from the cache attaches again.
    const attached = new Map();
    let last_attach_id = 0;
    // The pushes on their way to a page, by push id: the core's reply waits on `resolve`.
    const pushes = new Map();
    let last_push_id = 0;

    const session_value = (extension, key) => {
      const holder = extensionStorageSession.get(extension, [key])[key];
      return typeof holder?.deserialize === "function" ? holder.deserialize(sandbox, true) : holder;
    };
    const snapshots_of = (extension) => Object.fromEntries(Object.entries(SNAPSHOT_KEYS).map(([part, key]) => [part, session_value(extension, key)]));

    // The `browser_module_pages` setting, as the extension's config snapshot says. The extension writes the snapshots only while it is on, and removes them when it goes off. A snapshot of another protocol version counts as off, so a mismatched extension gets no page code.
    function pages_on(extension, config = session_value(extension, SNAPSHOT_KEYS.config)) {
      if (!module_on() || !extension) return false;
      const settings = is_record(config) && config.v === PROTOCOL_VERSION && is_record(config.value) ? config.value.settings : undefined;
      return is_record(settings) && settings.browser_module === true && settings.browser_module_pages === true && session_value(extension, SNAPSHOT_KEYS.keymap)?.v === PROTOCOL_VERSION;
    }

    // The page kinds that get page code, read from the document chrome sees, never from the frame's word. A principal that is the system's or an extension's is never one of them.
    function page_kind_of(browser, inner) {
      const global = browser.browsingContext?.currentWindowGlobal;
      const principal = global?.documentPrincipal;
      if (!principal || global.innerWindowId !== inner || principal.isSystemPrincipal || principal.addonId) return undefined;
      if (principal.spec.startsWith("resource://pdf.js/")) return "pdf";
      if (principal.spec.startsWith("about:reader?") && global.documentURI?.spec.startsWith("about:reader?")) return "reader";
      return undefined;
    }

    const tab_id_of = (browser) => tab_tracker().getBrowserData(browser).tabId;

    function browser_of_tab(tab_id) {
      try {
        return tab_tracker().getTab(tab_id, null)?.linkedBrowser ?? undefined;
      } catch (_) {
        return undefined;
      }
    }

    const send_to = (browser, name, data) => {
      try {
        browser.messageManager?.sendAsyncMessage(name, data);
      } catch (_) {
        // A tab that closed has no frame to tell.
      }
    };

    function end_pushes(browser) {
      for (const [id, push] of pushes) {
        if (browser !== undefined && push.browser !== browser) continue;
        pushes.delete(id);
        push.resolve({ ok: false, error: WENT_AWAY });
      }
    }

    function forget(browser) {
      attached.delete(browser);
      end_pushes(browser);
    }

    // The extension ends the tab's lock only on this word, because a tab's load events also fire for a document that stays (a PDF reports two).
    function end_attach(browser) {
      const attach = attached.get(browser);
      if (!attach) return;
      forget(browser);
      const tab_id = tab_id_of(browser);
      if (attach.extension === desertfox() && Number.isSafeInteger(tab_id) && tab_id >= 0) core.send("page_gone", { tab_id, document_id: attach.attach_id });
    }

    // The setting or the pref went off, or DesertFox changed: every page drops its code.
    function detach_all() {
      for (const browser of [...attached.keys()]) {
        send_to(browser, MESSAGE.detach, {});
        forget(browser);
      }
      end_pushes(undefined);
    }

    const on = (name, handler) =>
      Services.mm.addMessageListener(name, (message) => {
        try {
          if (is_record(message.data)) handler(message.target, message.data);
        } catch (error) {
          core.log_once(`a locked page message was dropped after an error: ${error}`);
        }
      });

    on(MESSAGE.attach, (browser, { inner }) => {
      const extension = desertfox();
      for (const each of [...attached.keys()]) if (!each.isConnected) forget(each);
      if (!Number.isSafeInteger(inner) || !pages_on(extension) || !page_kind_of(browser, inner)) return;
      const tab_id = tab_id_of(browser);
      if (!Number.isSafeInteger(tab_id) || tab_id < 0) return;
      if (PrivateBrowsingUtils.isBrowserPrivate(browser) && !extension.privateBrowsingAllowed) return;
      end_attach(browser);
      const attach_id = ++last_attach_id;
      attached.set(browser, { attach_id, inner, extension });
      send_to(browser, MESSAGE.attached, { inner, attach_id, base_url: extension.baseURI.spec, snapshots: snapshots_of(extension) });
    });

    on(MESSAGE.gone, (browser, { attach_id }) => {
      if (attached.get(browser)?.attach_id === attach_id) end_attach(browser);
    });

    // A page call: its text goes out as it came, with the tab and the attach that chrome knows.
    on(MESSAGE.call, (browser, { attach_id, call_id, message }) => {
      if (!Number.isSafeInteger(call_id)) return;
      const answer = (fields) => send_to(browser, MESSAGE.answer, { attach_id, call_id, ...fields });
      const attach = attached.get(browser);
      if (attach?.attach_id !== attach_id || attach.extension !== desertfox() || typeof message !== "string") return answer({ ok: false, error: WENT_AWAY });
      const sent = core.send("page_call", { tab_id: tab_id_of(browser), document_id: attach_id, message }, (reply) => {
        if (attached.get(browser) !== attach) return;
        answer(reply.ok && typeof reply.value === "string" ? { ok: true, value: reply.value } : { ok: false, error: reply.error ?? "the call failed" });
      });
      if (!sent.ok) answer({ ok: false, error: sent.problem });
    });

    // A push: the page's answer text becomes the reply's value, as it came.
    core.register_kind("page_push", ({ tab_id, message }) => {
      const browser = browser_of_tab(tab_id);
      const attach = browser && attached.get(browser);
      if (!attach || attach.extension !== desertfox() || !pages_on(attach.extension)) return { ok: false, error: WENT_AWAY };
      const push_id = ++last_push_id;
      return new Promise((resolve) => {
        pushes.set(push_id, { browser, resolve });
        send_to(browser, MESSAGE.push, { attach_id: attach.attach_id, push_id, message });
      });
    });

    on(MESSAGE.push_answer, (browser, { push_id, ok, text, error }) => {
      const push = pushes.get(push_id);
      if (push?.browser !== browser) return;
      pushes.delete(push_id);
      push.resolve(ok === true && typeof text === "string" ? { ok: true, value: text } : { ok: false, error: typeof error === "string" ? error : "the page refused the message" });
    });

    // A snapshot changed: each page of this DesertFox gets the new copy, and a page of an older DesertFox drops its code.
    core.watch_session(Object.values(SNAPSHOT_KEYS), (key, value) => {
      const extension = desertfox();
      if (key === SNAPSHOT_KEYS.config && !pages_on(extension, value)) return detach_all();
      const part = Object.keys(SNAPSHOT_KEYS).find((name) => SNAPSHOT_KEYS[name] === key);
      for (const [browser, attach] of [...attached]) {
        if (attach.extension !== extension) {
          send_to(browser, MESSAGE.detach, {});
          forget(browser);
        } else send_to(browser, MESSAGE.snapshot, { attach_id: attach.attach_id, part, snapshot: value });
      }
    });

    Services.prefs.addObserver(ENABLED_PREF, () => {
      if (!module_on()) detach_all();
    });

    core.add_frame_script(locked_pages_frame_script);
  }

  // Runs in each tab, in the tab's process. It asks chrome whether the shown document may get page code, and on yes builds the sandbox and loads the fixed files into it.
  function locked_pages_frame_script() {
    const Cu = Components.utils;
    const EXTENSION_ID = "desertfox@uhs-robert";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const MESSAGE = {
      attach: "desertfox-browser-module:locked-attach",
      attached: "desertfox-browser-module:locked-attached",
      detach: "desertfox-browser-module:locked-detach",
      gone: "desertfox-browser-module:locked-gone",
      call: "desertfox-browser-module:locked-call",
      answer: "desertfox-browser-module:locked-answer",
      push: "desertfox-browser-module:locked-push",
      push_answer: "desertfox-browser-module:locked-push-answer",
      snapshot: "desertfox-browser-module:locked-snapshot",
    };
    // The only files the sandbox runs, from the extension's own base address: the shim, then content.js, then a bundle when the page code asks for it by name.
    // BUNDLE_NAMES copies src/shared/bundles.ts, and test/browser_module/locked_pages.test.ts keeps it equal.
    const SHIM_FILE = "locked_shim.js";
    const CONTENT_FILE = "content.js";
    const BUNDLE_NAMES = ["hints", "caret", "whichkey", "cmdline", "ui", "page", "text", "editor", "site_actions", "grab", "item", "item_act", "tree", "next_page"];
    const SNAPSHOT_PARTS = ["keymap", "config", "theme", "which_key"];
    const BASE_URL = /^moz-extension:\/\/[0-9a-f-]{36}\/$/;
    const WENT_AWAY = "the page went away";

    // The page code of each document of this tab, by inner window id: the shown one, and any in the back-forward cache (`suspended`), which Back brings back under a new attach.
    const pages = new Map();
    const page_of_attach = (attach_id) => [...pages.values()].find((each) => each.attach_id === attach_id);
    const is_live = (current) => pages.get(current.inner) === current;
    let last_call_id = 0;

    const module_on = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };
    // The same rule chrome checks again: the PDF viewer and Reader View only, never a page under the system principal or an extension's.
    function is_locked_page(doc) {
      const principal = doc?.nodePrincipal;
      if (!principal || principal.isSystemPrincipal || principal.addonId) return false;
      return principal.spec.startsWith("resource://pdf.js/") || (principal.spec.startsWith("about:reader?") && doc.documentURI.startsWith("about:reader?"));
    }
    const inner_of = (win) => win?.windowGlobalChild?.innerWindowId;
    const is_top_document = (event) => !!content && event.target === content.document;

    function ask_to_attach() {
      if (!module_on() || !is_locked_page(content.document)) return;
      sendAsyncMessage(MESSAGE.attach, { inner: inner_of(content) });
    }

    const sandbox_error = (sandbox, text) => Cu.cloneInto(new Error(text), sandbox);
    const sandbox_promise = (sandbox, run) => new sandbox.Promise(Cu.exportFunction((resolve, reject) => run(resolve, reject), sandbox));

    // ChromeUtils.compileScript is how Firefox loads a content script's files: the address names the file in errors, and nothing is read as text here.
    async function run_file(current, file) {
      const script = await ChromeUtils.compileScript(current.base_url + file);
      if (!is_live(current)) throw new Error(WENT_AWAY);
      script.executeInGlobal(current.sandbox);
    }

    function transport_for(current) {
      const { sandbox } = current;
      const usable = () => is_live(current) && !current.suspended && module_on();
      return Cu.cloneInto(
        {
          extension_id: EXTENSION_ID,
          base_url: current.base_url,
          alive: () => usable(),
          // The text goes to chrome as it is. The shim made it and checked its size.
          call: (text) =>
            sandbox_promise(sandbox, (resolve, reject) => {
              if (!usable() || typeof text !== "string") return reject(sandbox_error(sandbox, WENT_AWAY));
              const call_id = ++last_call_id;
              current.calls.set(call_id, { resolve, reject });
              sendAsyncMessage(MESSAGE.call, { attach_id: current.attach_id, call_id, message: text });
            }),
          load_bundle: (name) =>
            sandbox_promise(sandbox, (resolve) => {
              const answer = (ok, message) => resolve(Cu.cloneInto(ok ? { ok: true } : { ok: false, refusal: { id: "load_bundle", message } }, sandbox));
              if (!usable() || !BUNDLE_NAMES.includes(name)) return answer(false, "not a bundle of DesertFox");
              if (current.loaded.has(name)) return answer(true);
              run_file(current, `${name}.js`).then(
                () => (current.loaded.add(name), answer(true)),
                (error) => answer(false, `the bundle did not load: ${error}`.slice(0, 120)),
              );
            }),
          snapshot: (part) => (SNAPSHOT_PARTS.includes(part) && current.snapshots[part] !== undefined ? Cu.cloneInto(current.snapshots[part], sandbox) : undefined),
          on_snapshot: (listener) => void (current.on_snapshot = listener),
          on_push: (listener) => void (current.on_push = listener),
        },
        sandbox,
        { cloneFunctions: true },
      );
    }

    function start(win, { attach_id, base_url, snapshots }) {
      const page_principal = win.document.nodePrincipal;
      // An expanded principal refuses the system principal, so this sandbox never gets more than the page and the extension's own files.
      const extension_principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(base_url), page_principal.originAttributes);
      const sandbox = Cu.Sandbox([page_principal, extension_principal], {
        sandboxName: "DesertFox page code",
        sandboxPrototype: win,
        sameZoneAs: win,
        wantXrays: true,
        isWebExtensionContentScript: true,
        wantExportHelpers: true,
        wantGlobalProperties: ["structuredClone"],
        originAttributes: page_principal.originAttributes,
        // The core's report counts a keydown listener of this sandbox as DesertFox's, so the module leaves the keys to the page code.
        metadata: { addonId: EXTENSION_ID, "inner-window-id": inner_of(win) },
      });
      const current = { attach_id, inner: inner_of(win), base_url, sandbox, snapshots: is_snapshots(snapshots) ? snapshots : {}, calls: new Map(), pushes: new Set(), loaded: new Set(), suspended: false, on_push: null, on_snapshot: null };
      if (pages.size === 0) Services.obs.addObserver(on_window_destroyed, "inner-window-destroyed");
      pages.set(current.inner, current);
      // Waived, so the property lands on the sandbox's own global and not on this script's view of it. The page's window is only the sandbox's prototype and never sees it.
      Cu.waiveXrays(sandbox).desertfox_locked_transport = transport_for(current);
      run_file(current, SHIM_FILE)
        .then(() => run_file(current, CONTENT_FILE))
        .catch((error) => {
          if (is_live(current)) drop(current, `the page code did not load: ${error}`);
        });
    }

    const is_snapshots = (value) => typeof value === "object" && value !== null;

    // Every push and call still open gets its error, so nothing waits on a page that is gone.
    function settle_open(current, why) {
      for (const push_id of current.pushes) sendAsyncMessage(MESSAGE.push_answer, { push_id, ok: false, error: why });
      current.pushes.clear();
      for (const { reject } of current.calls.values()) {
        try {
          reject(sandbox_error(current.sandbox, why));
        } catch (_) {
          // A sandbox already cut off takes no answer.
        }
      }
      current.calls.clear();
    }

    // The page left for good: its sandbox is cut off, so nothing of it runs on (a sandbox left on a dead document ran a content process to full CPU).
    function drop(current, why = WENT_AWAY) {
      if (!current || !is_live(current)) return;
      pages.delete(current.inner);
      settle_open(current, why);
      if (pages.size === 0) Services.obs.removeObserver(on_window_destroyed, "inner-window-destroyed");
      try {
        Cu.nukeSandbox(current.sandbox);
      } catch (_) {
        // A sandbox that is gone already needs nothing.
      }
      sendAsyncMessage(MESSAGE.gone, { attach_id: current.attach_id });
    }

    function on_window_destroyed(subject) {
      try {
        drop(pages.get(subject.QueryInterface(Components.interfaces.nsISupportsPRUint64).data));
      } catch (_) {
        // Another window's end.
      }
    }

    addMessageListener(MESSAGE.attached, ({ data }) => {
      try {
        if (!module_on() || inner_of(content) !== data.inner || !BASE_URL.test(data.base_url) || !is_locked_page(content.document)) return;
        const cached = pages.get(data.inner);
        if (cached?.suspended) {
          // Back brought the document out of the cache: the same sandbox goes on under the new attach, with fresh snapshots.
          Object.assign(cached, { attach_id: data.attach_id, suspended: false, snapshots: is_snapshots(data.snapshots) ? data.snapshots : {} });
          for (const part of SNAPSHOT_PARTS) cached.on_snapshot?.(part);
          return;
        }
        drop(cached);
        start(content, data);
      } catch (error) {
        Cu.reportError(`DesertFox browser module: page code did not start: ${error}`);
      }
    });

    addMessageListener(MESSAGE.detach, () => {
      for (const current of [...pages.values()]) drop(current, "the browser_module_pages setting is off");
    });

    addMessageListener(MESSAGE.answer, ({ data }) => {
      const current = page_of_attach(data.attach_id);
      const call = current?.calls.get(data.call_id);
      if (!call) return;
      current.calls.delete(data.call_id);
      if (data.ok && typeof data.value === "string") call.resolve(data.value);
      else call.reject(sandbox_error(current.sandbox, typeof data.error === "string" ? data.error : "the call failed"));
    });

    addMessageListener(MESSAGE.push, ({ data }) => {
      const current = page_of_attach(data.attach_id);
      const refuse = (error) => sendAsyncMessage(MESSAGE.push_answer, { push_id: data.push_id, ok: false, error });
      if (!current || current.suspended || !current.on_push) return refuse(WENT_AWAY);
      if (typeof data.message !== "string") return refuse("a push is text");
      current.pushes.add(data.push_id);
      const answer = (fields) => {
        if (!current.pushes.delete(data.push_id)) return;
        sendAsyncMessage(MESSAGE.push_answer, { push_id: data.push_id, ...fields });
      };
      try {
        current.on_push(data.message).then(
          (text) => answer({ ok: true, text: String(text) }),
          (error) => answer({ ok: false, error: String(error?.message ?? error).slice(0, 120) }),
        );
      } catch (error) {
        answer({ ok: false, error: String(error?.message ?? error).slice(0, 120) });
      }
    });

    addMessageListener(MESSAGE.snapshot, ({ data }) => {
      const current = page_of_attach(data.attach_id);
      if (!current || !SNAPSHOT_PARTS.includes(data.part)) return;
      if (data.snapshot === undefined) delete current.snapshots[data.part];
      else current.snapshots[data.part] = data.snapshot;
      try {
        current.on_snapshot?.(data.part);
      } catch (_) {
        // The page code's own error stays in the page code.
      }
    });

    addEventListener(
      "DOMContentLoaded",
      (event) => {
        if (is_top_document(event)) ask_to_attach();
      },
      true,
    );
    addEventListener(
      "pageshow",
      (event) => {
        if (event.persisted && is_top_document(event)) ask_to_attach();
      },
      true,
    );
    // A page into the cache keeps its sandbox, frozen with it, but answers nothing until Back attaches it again. Any other pagehide ends it.
    addEventListener(
      "pagehide",
      (event) => {
        const current = is_top_document(event) ? pages.get(inner_of(content)) : undefined;
        if (!current) return;
        if (!event.persisted) return drop(current);
        current.suspended = true;
        settle_open(current, WENT_AWAY);
        sendAsyncMessage(MESSAGE.gone, { attach_id: current.attach_id });
      },
      true,
    );
  }
})(this);
