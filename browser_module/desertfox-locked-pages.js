// DesertFox browser module, the locked pages feature: DesertFox's own page code (`content.js` and the bundles) in the PDF viewer and Reader View, where no content script runs. See docs/design/browser_module.md.
// Chrome only carries the page code's messages. It hands the JSON text of each one on as it came and never parses it, so no message can pick an action, an address or a selector for chrome code.
// The code runs in a sandbox under the expanded principal [page, extension], as Firefox runs a content script, never under the system principal. Every other page, about:addons and about:preferences included, gets nothing. Chrome hints label a few of those themselves.
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
      ask: "desertfox-browser-module:locked-ask",
    };
    const WENT_AWAY = "the page went away";
    // A leak backstop for a page call whose reply was lost, not a timeout: a call can wait on the user (a prompt, a hint pick, a macro replay), so the bound is long. A push has none, because every teardown path settles it.
    const ANSWER_DEADLINE_MS = 30 * 60 * 1000;
    const NO_ANSWER = "no answer came";

    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
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

    // Each attach of page code to a document, by its tab's `browserId`. A tab moved to another window keeps that id under a new <browser>, and no element of a closed window stays held. The id is the page call's `document_id`: one per attach, never reused in the session, so a call from a document a load left is refused and a page Back restores from the cache attaches again.
    const attached = new Map();
    let last_attach_id = 0;
    // The pushes on their way to a page, by push id: the core's reply waits on `resolve`.
    const pushes = new Map();
    let last_push_id = 0;
    // One mark per extension object in this session. A page in the back-forward cache comes back only under the mark it started with, so Back never revives the code of a DesertFox that reloaded or updated since.
    const marks = new WeakMap();
    let last_mark = 0;
    const mark_of = (extension) => marks.get(extension) ?? (marks.set(extension, ++last_mark), last_mark);
    // The core shut down for the session: nothing attaches again.
    let stopped = false;

    const session_value = (extension, key) => {
      const holder = extensionStorageSession.get(extension, [key])[key];
      return typeof holder?.deserialize === "function" ? holder.deserialize(sandbox, true) : holder;
    };
    const snapshots_of = (extension) => Object.fromEntries(Object.entries(SNAPSHOT_KEYS).map(([part, key]) => [part, session_value(extension, key)]));

    // The `browser_module_pages` setting, as the extension's config snapshot says. The extension writes the snapshots only while it is on, and removes them when it goes off. A snapshot of another protocol version counts as off, so a mismatched extension gets no page code.
    function pages_on(extension, config = session_value(extension, SNAPSHOT_KEYS.config)) {
      if (stopped || !module_on() || !extension) return false;
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

    // The JSON viewer's own principal. A page of any address can show it, so the address is no test for it.
    const JSON_VIEWER_PRINCIPAL = "resource://devtools/client/jsonview/";

    // Why a hint key cannot run on the tab's shown page now, for desertfox-commands.js, which claims the key and has the extension say so: "pages_off" on the PDF viewer and Reader View while page code is off, "not_here" on an about: page, on view-source:, the JSON viewer, data: and blob: pages and on another extension's page, where page code never runs. Undefined everywhere else, so the key goes on.
    // "page_hints" instead on an about: page that chrome hints label themselves (their own fixed list), once the extension's state says it answers their start. The key taker then starts those hints.
    // An initial about:blank and a srcdoc frame are no page the user sees as Firefox's own. A DevTools toolbox in a tab is DevTools, whose keys stay its own. Firefox matches about: names in any case, so the test does too.
    // `win` is the browser window that shows `browser`.
    function hint_notice_of(browser, win) {
      const global = browser?.browsingContext?.currentWindowGlobal;
      const principal = global?.documentPrincipal;
      if (!principal) return undefined;
      if (principal.addonId) return principal.addonId === EXTENSION_ID ? undefined : "not_here";
      // A page of Firefox's restricted list, which no content script reaches: hints run there through the content hints route, except on the account and Sync hosts.
      const content_pages = core.content_pages?.();
      if (content_pages?.refuses(browser)) return "not_here";
      if (content_pages?.labels(browser)) return core.page_hints?.()?.handles(browser) && core.page_hints_wanted?.(win) ? "page_hints" : "not_here";
      if (page_kind_of(browser, global.innerWindowId)) return pages_on(desertfox()) ? undefined : "pages_off";
      const address = global.documentURI?.spec ?? "";
      if (JSON_VIEWER_PRINCIPAL === principal.spec || /^(?:view-source|data|blob):/i.test(address)) return "not_here";
      if (!/^about:(?!(?:blank|srcdoc|reader)\b|devtools)/i.test(address)) return undefined;
      return core.page_hints?.()?.handles(browser) && core.page_hints_wanted?.(win) ? "page_hints" : "not_here";
    }

    const tab_id_of = (browser) => tab_tracker().getBrowserData(browser).tabId;

    function browser_of_tab(tab_id) {
      try {
        return tab_tracker().getTab(tab_id, null)?.linkedBrowser ?? undefined;
      } catch (_) {
        return undefined;
      }
    }

    // False when the message could not go: a tab that closed has no frame to tell.
    const send_to = (browser, name, data) => {
      try {
        if (!browser?.messageManager) return false;
        browser.messageManager.sendAsyncMessage(name, data);
        return true;
      } catch (_) {
        return false;
      }
    };

    // `settle` runs once with the answer, or with an error once the deadline passes.
    function once_within_deadline(settle) {
      let timer = 0;
      const once = (result) => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        settle(result);
      };
      timer = setTimeout(() => once({ ok: false, error: NO_ANSWER }), ANSWER_DEADLINE_MS);
      return once;
    }

    // The <browser> that shows the attach's tab now, or undefined once the tab closed.
    function element_of(browser_id) {
      const attach = attached.get(browser_id);
      const browser = attach && browser_of_tab(attach.tab_id);
      return browser?.browserId === browser_id ? browser : undefined;
    }

    function end_push(push_id, result) {
      const push = pushes.get(push_id);
      pushes.delete(push_id);
      push?.resolve(result);
    }

    function end_pushes(browser_id) {
      for (const [id, push] of [...pushes]) if (browser_id === undefined || push.browser_id === browser_id) end_push(id, { ok: false, error: WENT_AWAY });
    }

    function forget(browser_id) {
      attached.delete(browser_id);
      end_pushes(browser_id);
    }

    // The extension ends the tab's lock only on this word, because a tab's load events also fire for a document that stays (a PDF reports two).
    function end_attach(browser_id) {
      const attach = attached.get(browser_id);
      if (!attach) return;
      forget(browser_id);
      if (attach.extension === desertfox()) core.send("page_gone", { tab_id: attach.tab_id, document_id: attach.attach_id });
    }

    // The setting or the pref went off, or DesertFox changed: every page drops its code, and so does every page in the back-forward cache, which no attach names.
    // Each attach ends through `end_attach` first, so the extension hears page_gone while the module can still write it.
    function detach_all() {
      for (const browser_id of [...attached.keys()]) end_attach(browser_id);
      Services.mm.broadcastAsyncMessage(MESSAGE.detach, {});
      end_pushes(undefined);
    }

    // Each tab asks again for its shown page, so a PDF or Reader View that was open while page code was off gets it with no reload.
    function ask_all(extension) {
      if (pages_on(extension)) Services.mm.broadcastAsyncMessage(MESSAGE.ask, { mark: mark_of(extension) });
    }

    const listeners = [];
    const on = (name, handler) => {
      const listener = (message) => {
        try {
          if (is_record(message.data)) handler(message.target, message.data);
        } catch (error) {
          core.log_once(`a locked page message was dropped after an error: ${error}`);
        }
      };
      Services.mm.addMessageListener(name, listener);
      listeners.push([name, listener]);
    };

    // A refused page drops whatever page code its tab still holds, a cached page included.
    on(MESSAGE.attach, (browser, { inner }) => {
      const extension = desertfox();
      for (const each of [...attached.keys()]) if (!element_of(each)) forget(each);
      const refuse = () => send_to(browser, MESSAGE.detach, {});
      if (!Number.isSafeInteger(inner) || !pages_on(extension) || !page_kind_of(browser, inner)) return refuse();
      const tab_id = tab_id_of(browser);
      if (!Number.isSafeInteger(tab_id) || tab_id < 0) return refuse();
      if (PrivateBrowsingUtils.isBrowserPrivate(browser) && !extension.privateBrowsingAllowed) return refuse();
      const browser_id = browser.browserId;
      const current = attached.get(browser_id);
      // A second ask for the same document, as `ask_all` and the page's own load can both send.
      if (current?.inner === inner && current.extension === extension) return;
      end_attach(browser_id);
      const attach_id = ++last_attach_id;
      attached.set(browser_id, { attach_id, inner, extension, tab_id });
      send_to(browser, MESSAGE.attached, { inner, attach_id, mark: mark_of(extension), base_url: extension.baseURI.spec, snapshots: snapshots_of(extension) });
    });

    on(MESSAGE.gone, (browser, { attach_id }) => {
      if (attached.get(browser.browserId)?.attach_id === attach_id) end_attach(browser.browserId);
    });

    // A page call: its text goes out as it came, with the tab and the attach that chrome knows.
    on(MESSAGE.call, (browser, { attach_id, call_id, message }) => {
      if (!Number.isSafeInteger(call_id)) return;
      const browser_id = browser.browserId;
      const answer = (to, fields) => send_to(to, MESSAGE.answer, { attach_id, call_id, ...fields });
      const attach = attached.get(browser_id);
      if (attach?.attach_id !== attach_id || attach.extension !== desertfox() || typeof message !== "string") return answer(browser, { ok: false, error: WENT_AWAY });
      // The frame takes an answer only for an attach it still runs, so the answer goes even after a detach.
      const settle = once_within_deadline((fields) => {
        const now = browser_of_tab(attach.tab_id);
        answer(now?.browserId === browser_id ? now : browser, fields);
      });
      const sent = core.send("page_call", { tab_id: attach.tab_id, document_id: attach_id, message }, (reply) =>
        settle(reply.ok && typeof reply.value === "string" ? { ok: true, value: reply.value } : { ok: false, error: reply.error ?? "the call failed" }),
      );
      if (!sent.ok) settle({ ok: false, error: sent.problem });
    });

    // A push: the page's answer text becomes the reply's value, as it came. It goes only to the document the extension named, never to the one that replaced it in the tab.
    core.register_kind("page_push", ({ tab_id, document_id, message }) => {
      const browser = browser_of_tab(tab_id);
      const browser_id = browser?.browserId;
      const attach = browser && attached.get(browser_id);
      // An older extension names no document: the push goes to the tab's page as it is now.
      if (!attach || (document_id !== undefined && attach.attach_id !== document_id) || attach.extension !== desertfox() || !pages_on(attach.extension)) return { ok: false, error: WENT_AWAY };
      const push_id = ++last_push_id;
      return new Promise((resolve) => {
        pushes.set(push_id, { browser_id, resolve });
        if (!send_to(browser, MESSAGE.push, { attach_id: attach.attach_id, push_id, message })) end_push(push_id, { ok: false, error: WENT_AWAY });
      });
    });

    on(MESSAGE.push_answer, (browser, { push_id, ok, text, error }) => {
      const push = pushes.get(push_id);
      if (push?.browser_id !== browser.browserId) return;
      end_push(push_id, ok === true && typeof text === "string" ? { ok: true, value: text } : { ok: false, error: typeof error === "string" ? error : "the page refused the message" });
    });

    // A snapshot changed: each page of this DesertFox gets the new copy, every page drops the code of an older DesertFox, and the open pages ask again.
    core.watch_session(Object.values(SNAPSHOT_KEYS), (key, value) => {
      const extension = desertfox();
      // Without either snapshot the page code cannot run, so it goes, and the next good snapshot attaches it again.
      if (!pages_on(extension, key === SNAPSHOT_KEYS.config ? value : undefined)) return detach_all();
      if ([...attached.values()].some((attach) => attach.extension !== extension)) detach_all();
      const part = Object.keys(SNAPSHOT_KEYS).find((name) => SNAPSHOT_KEYS[name] === key);
      for (const [browser_id, attach] of [...attached]) send_to(element_of(browser_id), MESSAGE.snapshot, { attach_id: attach.attach_id, part, snapshot: value });
      ask_all(extension);
    });

    const on_pref_change = () => (module_on() ? ask_all(desertfox()) : detach_all());
    Services.prefs.addObserver(ENABLED_PREF, on_pref_change);

    // The core turned off for the session after a failure: every page drops its code, and no message, pref change or tab attaches again.
    core.on_shut_down(() => {
      stopped = true;
      for (const [name, listener] of listeners.splice(0)) Services.mm.removeMessageListener(name, listener);
      Services.prefs.removeObserver(ENABLED_PREF, on_pref_change);
      detach_all();
    });

    if (typeof core.share_locked_page_rule === "function") core.share_locked_page_rule({ hint_notice: hint_notice_of });
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
      ask: "desertfox-browser-module:locked-ask",
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

    // With the pref off, a page Back restores drops the code it held instead of asking.
    function ask_to_attach() {
      if (!is_locked_page(content.document)) return;
      if (!module_on()) return drop(pages.get(inner_of(content)));
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

    function start(win, { attach_id, mark, base_url, snapshots }) {
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
      const current = { attach_id, mark, inner: inner_of(win), base_url, sandbox, snapshots: is_snapshots(snapshots) ? snapshots : {}, calls: new Map(), pushes: new Set(), loaded: new Set(), suspended: false, on_push: null, on_snapshot: null };
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
        if (cached?.suspended && cached.mark === data.mark) {
          // Back brought the document out of the cache: the same sandbox goes on under the new attach, with fresh snapshots. Code of a DesertFox that reloaded since has another mark and starts again.
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

    addMessageListener(MESSAGE.ask, ({ data }) => {
      const current = content && pages.get(inner_of(content));
      if (current && !current.suspended && current.mark === data.mark) return;
      if (content?.document) ask_to_attach();
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
    // A script that loads into a tab whose page already loaded heard no DOMContentLoaded. A second ask for the same page changes nothing.
    if (content?.document) ask_to_attach();
  }
})(this);
