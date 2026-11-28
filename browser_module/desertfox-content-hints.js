// DesertFox browser module, the content hints route: hints on pages in a content process that no content script reaches, the hosts of Firefox's restricted list (extensions.webextensions.restrictedDomains) for now.
// Chrome hints (desertfox-chrome-hints.js) run the session there as on its own pages: the start token, the spelled label, the window layer, the Enter of a grant and the key hold. This file lends them the page rule and the transport through the core's `share_content_pages`.
//
// The trust rule: the frame script below collects the page's targets and keeps them in its own map. It sends chrome only an id, a box and a flag mask per target, and for a link action one link address.
// Chrome draws the labels in its own layer, clipped to the tab's content area, and never clicks. Every click and focus runs in the frame script on an element it collected, after it checks the element again.
// A target that waits for Enter runs only with `confirmed: true`, which chrome hints send only from the user's own Enter.
//
// The page list (CONTENT_PAGES, and its copy in the frame script) holds one row per kind of page. A row names how chrome knows the page and, in the frame script, what acts on a pick at once.

(function desertfox_browser_module_content_hints(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the content hints feature failed to load: ${error}`);
    }
    return;
  }
  if (typeof core.share_content_pages !== "function") return core.log_once("the core cannot lend a content page route, so the content hints feature stays off");
  define(core);

  function define(core) {
    const MESSAGE_PREFIX = "desertfox-browser-module:content-hints-";
    // Read at each check, never copied: policy can add hosts, and no code here writes it.
    const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
    // MAX_TARGETS of chrome hints.
    const MAX_TARGETS = 400;
    const MIN_SIDE_PX = 4;
    const REPLY_MS = 1500;
    const MAX_REPLY_BYTES = 65536;
    const MAX_ADDRESS_CHARS = 4096;
    const MAX_PIXEL_RATIO = 16;
    // The flag mask of a target row. The frame script sets the same bits.
    const GRANTS_BIT = 1;
    const ALL_BITS = 7;
    // A frame script error names one of these. The text the user reads is chrome's own.
    const COLLECT_ERRORS = { not_here: "Hints do not run on this page", login_form: "Hints do not run on this page", changed: "The page changed", nothing: "Nothing to hint here" };
    const PICK_ERRORS = { gone: "The hint's target is gone", moved: "The hint's target moved", changed: "The hint's target changed", needs_enter: "Type the hint key to pick this", no_link: "The link has no web address" };
    const PAGE_CHANGED = "The page changed";

    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const json_bytes = (value) => {
      try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
      } catch (_) {
        return Infinity;
      }
    };
    const own = (table, key) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

    // ---- The page rule.

    function listed_hosts() {
      let text = "";
      try {
        text = Services.prefs.getStringPref(RESTRICTED_PREF, "");
      } catch (_) {
        return new Set();
      }
      return new Set(text.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    }
    // Account and Sync pages: sign-in, passwords, recovery keys, and a WebChannel through which a click can change the browser's own state. They match by suffix, so a new account host stays out too.
    const EXCLUDED_DOMAINS = ["accounts.firefox.com", "services.mozilla.com"];
    const excluded_host = (host) => EXCLUDED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    // Web content processes: Firefox puts addons.mozilla.org and accounts.firefox.com in "privilegedmozilla". Never privilegedabout, an extension's process or file.
    const web_process = (type) => typeof type === "string" && (type === "web" || type === "privilegedmozilla" || /^web[A-Za-z+]*=/.test(type));

    // The host of the tab's shown page, when it is a web page in a web content process, else undefined.
    function web_host(browser) {
      if (browser?.isRemoteBrowser !== true || !web_process(browser.remoteType)) return undefined;
      const principal = browser.browsingContext?.currentWindowGlobal?.documentPrincipal;
      if (principal?.isContentPrincipal !== true || principal.addonId || !(principal.schemeIs("http") || principal.schemeIs("https"))) return undefined;
      return String(principal.asciiHost).toLowerCase();
    }

    // `kind_of(browser)`: the row's kind for a page it labels, EXCLUDED for a page of it the route never labels, else undefined.
    const EXCLUDED = "excluded";
    const CONTENT_PAGES = [
      {
        // Firefox matches its restricted hosts whatever the scheme, so http counts too.
        kind: "restricted",
        kind_of(browser) {
          const host = web_host(browser);
          if (host === undefined || !listed_hosts().has(host)) return undefined;
          return excluded_host(host) ? EXCLUDED : "restricted";
        },
      },
    ];
    function page_kind(browser) {
      for (const row of CONTENT_PAGES) {
        const kind = row.kind_of(browser);
        if (kind !== undefined) return kind;
      }
      return undefined;
    }
    const labels = (browser) => {
      const kind = page_kind(browser);
      return kind === EXCLUDED ? undefined : kind;
    };
    const refuses = (browser) => page_kind(browser) === EXCLUDED;

    // ---- The transport.

    let next_request = 1;
    // Per request id: the browser and document it went to, the reply name it waits for, and its end.
    const awaiting = new Map();
    // Per collect request id, while its session is open in the frame script: what hears the frame script say the page went.
    const open_sessions = new Map();

    function ask(browser, inner, name, fields, expects) {
      const req = next_request++;
      const reply = new Promise((resolve) => {
        const timer = setTimeout(() => settle(undefined), REPLY_MS);
        const settle = (data) => {
          if (!awaiting.delete(req)) return;
          clearTimeout(timer);
          resolve(data);
        };
        awaiting.set(req, { browser, inner, expects, settle });
        if (!send_to(browser, name, { req, inner, ...fields })) settle(undefined);
      });
      return { req, reply };
    }

    function send_to(browser, name, data) {
      try {
        browser.messageManager.sendAsyncMessage(MESSAGE_PREFIX + name, data);
        return true;
      } catch (_) {
        return false;
      }
    }

    const listeners = [];
    function on(name, handler) {
      const listener = (message) => {
        try {
          if (is_record(message.data)) handler(message.target, message.data);
        } catch (error) {
          core.log_once(`a content hints message was dropped after an error: ${error}`);
        }
      };
      Services.mm.addMessageListener(MESSAGE_PREFIX + name, listener);
      listeners.push([MESSAGE_PREFIX + name, listener]);
    }

    // A reply counts only from the browser asked, for the document asked about, still shown there. A reply too big settles as no reply.
    for (const expects of ["targets", "picked"]) {
      on(expects, (browser, data) => {
        const asked = awaiting.get(data.req);
        if (!asked || asked.expects !== expects || asked.browser !== browser || data.inner !== asked.inner || browser.innerWindowID !== asked.inner) return;
        asked.settle(json_bytes(data) > MAX_REPLY_BYTES ? undefined : data);
      });
    }

    on("gone", (browser, { session, inner }) => {
      const open = open_sessions.get(session);
      if (!open || open.browser !== browser || open.inner !== inner) return;
      for (const heard of [...open.gone]) heard();
    });

    // The frame script's rows as targets in the window's own pixels, each clipped to the tab's content area. One bad row drops the whole reply. A row whose center falls outside the area is left out.
    function mapped_targets(win, browser, { dpr, rows }) {
      if (!Array.isArray(rows) || rows.length > MAX_TARGETS || typeof dpr !== "number" || !(dpr > 0 && dpr <= MAX_PIXEL_RATIO)) return undefined;
      const area = browser.getBoundingClientRect();
      const scale = dpr / (win.devicePixelRatio || 1);
      // A box the frame script clipped to its viewport is at most the viewport, with a pixel for rounding.
      const max_width = area.width / scale + 1;
      const max_height = area.height / scale + 1;
      const seen = new Set();
      const targets = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 6 || !row.every(Number.isFinite)) return undefined;
        const [id, left, top, width, height, flags] = row;
        if (!Number.isSafeInteger(id) || seen.has(id) || !Number.isInteger(flags) || flags < 0 || flags > ALL_BITS) return undefined;
        if (width < MIN_SIDE_PX || height < MIN_SIDE_PX || width > max_width || height > max_height) return undefined;
        seen.add(id);
        const box = { left: area.left + left * scale, top: area.top + top * scale, width: width * scale, height: height * scale };
        const center_x = box.left + box.width / 2;
        const center_y = box.top + box.height / 2;
        if (center_x < area.left || center_x > area.left + area.width || center_y < area.top || center_y > area.top + area.height) continue;
        const clipped_left = Math.max(box.left, area.left);
        const clipped_top = Math.max(box.top, area.top);
        const clipped = { left: clipped_left, top: clipped_top, width: Math.min(box.left + box.width, area.left + area.width) - clipped_left, height: Math.min(box.top + box.height, area.top + area.height) - clipped_top };
        targets.push({ remote_id: id, box: clipped, grants: (flags & GRANTS_BIT) !== 0, place: "window" });
      }
      return targets;
    }

    // The one string a frame script sends: a link's address, which a new tab opens or a copy takes. Only http and https, of a bounded length, with no blank or control character.
    function web_address(text) {
      if (typeof text !== "string" || text.length > MAX_ADDRESS_CHARS || !/^https?:\/\/[^\s\p{Cc}\p{Cf}]+$/iu.test(text)) return undefined;
      try {
        const uri = Services.io.newURI(text);
        return uri.schemeIs("http") || uri.schemeIs("https") ? uri.spec : undefined;
      } catch (_) {
        return undefined;
      }
    }

    function checked_pick(data) {
      if (!data) return { ok: false, error: PAGE_CHANGED };
      if (data.ok !== true) return { ok: false, error: own(PICK_ERRORS, data.error) ?? "The pick failed" };
      if (data.href === undefined) return { ok: true };
      const href = web_address(data.href);
      return href ? { ok: true, href } : { ok: false, error: PICK_ERRORS.no_link };
    }

    // The chrome end of one session in the frame script. `confirmed` goes as true only when the caller passes true itself: chrome hints do so only from the user's Enter.
    function remote_session(browser, inner, session) {
      const open = { browser, inner, gone: new Set() };
      open_sessions.set(session, open);
      let cleared = false;
      return {
        pick(id, confirmed) {
          if (cleared || browser.innerWindowID !== inner) return Promise.resolve({ ok: false, error: PAGE_CHANGED });
          return ask(browser, inner, "pick", { session, id, confirmed: confirmed === true }, "picked").reply.then(checked_pick);
        },
        // Sent after a pick, which the frame script then has already run, as messages to one tab keep their order.
        clear() {
          if (cleared) return;
          cleared = true;
          open_sessions.delete(session);
          send_to(browser, "clear", { inner, session });
        },
        on_gone(heard) {
          open.gone.add(heard);
          return () => open.gone.delete(heard);
        },
      };
    }

    // The targets of the tab's page for `action`, and the session they belong to, or an error the user reads.
    async function collect(win, browser, action) {
      const kind = labels(browser);
      if (kind === undefined) return { error: COLLECT_ERRORS.not_here };
      const inner = browser.innerWindowID;
      const { req, reply } = ask(browser, inner, "collect", { kind, action }, "targets");
      const data = await reply;
      const drop = (error) => {
        send_to(browser, "clear", { inner, session: req });
        return { error };
      };
      if (!data) return drop(PAGE_CHANGED);
      if (data.error !== undefined) return drop(own(COLLECT_ERRORS, data.error) ?? PAGE_CHANGED);
      if (browser.innerWindowID !== inner) return drop(PAGE_CHANGED);
      const targets = mapped_targets(win, browser, data);
      if (!targets) return drop(PAGE_CHANGED);
      if (targets.length === 0) return drop(COLLECT_ERRORS.nothing);
      return { targets, remote: remote_session(browser, inner, req) };
    }

    core.on_shut_down(() => {
      for (const [name, listener] of listeners.splice(0)) Services.mm.removeMessageListener(name, listener);
      for (const asked of [...awaiting.values()]) asked.settle(undefined);
      for (const [session, open] of [...open_sessions]) send_to(open.browser, "clear", { inner: open.inner, session });
      open_sessions.clear();
    });

    core.share_content_pages({ labels, refuses, collect });
    core.add_frame_script(content_hints_frame_script);
  }

  // Runs in each tab, in the tab's process. It does nothing until chrome asks, and checks its own document at every request.
  function content_hints_frame_script() {
    const MESSAGE_PREFIX = "desertfox-browser-module:content-hints-";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
    const MAX_TARGETS = 400;
    const MIN_SIDE_PX = 4;
    // A target that moved further than this since it was collected is not picked: the label no longer marks it.
    const MOVED_PX = 2;
    // A session nobody picks from or clears ends after this, so no element stays held. Chrome hears of it as of a page that went.
    const IDLE_MS = 30000;
    const GRANTS_BIT = 1;
    const FIELD_BIT = 2;
    const LINK_BIT = 4;
    const CANDIDATES = "a, area, button, input, select, textarea, summary, [role], [contenteditable]";
    const ROLES = new Set(["button", "link", "checkbox", "switch", "menuitem", "menuitemcheckbox", "menuitemradio", "radio", "tab", "option", "combobox", "textbox"]);
    const TEXT_INPUT = /^(?:text|search|email|url|tel|number|date|datetime-local|month|week|time)$/;
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

    const module_on = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };

    // The chrome rule again, on this process's own view of the document. The two copies must agree: test/browser_module/content_hints.test.ts runs both on one table.
    function listed_hosts() {
      let text = "";
      try {
        text = Services.prefs.getStringPref(RESTRICTED_PREF, "");
      } catch (_) {
        return new Set();
      }
      return new Set(text.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    }
    const EXCLUDED_DOMAINS = ["accounts.firefox.com", "services.mozilla.com"];
    const excluded_host = (host) => EXCLUDED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    const web_process = (type) => typeof type === "string" && (type === "web" || type === "privilegedmozilla" || /^web[A-Za-z+]*=/.test(type));
    function restricted_page(doc) {
      const principal = doc?.nodePrincipal;
      if (principal?.isContentPrincipal !== true || principal.addonId || !(principal.schemeIs("http") || principal.schemeIs("https")) || !web_process(Services.appinfo.remoteType)) return false;
      const host = String(principal.asciiHost).toLowerCase();
      return listed_hosts().has(host) && !excluded_host(host);
    }

    const shadow_of = (element) => element?.openOrClosedShadowRoot ?? element?.shadowRoot ?? null;
    function deep_all(root, selector) {
      const found = [...root.querySelectorAll(selector)];
      for (const element of root.querySelectorAll("*")) {
        const shadow = shadow_of(element);
        if (shadow) found.push(...deep_all(shadow, selector));
      }
      return found;
    }

    // A select counts as core.is_field counts it: a pick focuses it, and the user chooses with the keys.
    const text_field = (element) => element.isContentEditable === true || element.localName === "textarea" || element.localName === "select" || (element.localName === "input" && TEXT_INPUT.test(element.type || "text"));
    const web_href = (element) => ((element.localName === "a" || element.localName === "area") && typeof element.href === "string" && /^https?:\/\/\S+$/i.test(element.href) ? element.href : undefined);
    // A link that only goes to another page: no download, no add-on file, no button dressed as a link and nothing a form sends.
    function plain_link(element) {
      if (web_href(element) === undefined || element.hasAttribute("download") || (element.getAttribute("role") ?? "link") !== "link" || element.closest("form")) return false;
      const path = String(element.pathname ?? "");
      return !/\.xpi$/i.test(path) && !/\/downloads\//i.test(path);
    }

    // Per kind of page: what a pick runs at once. Everything else waits for the user's Enter, so a control a later redesign adds waits too.
    const CONTENT_PAGES = {
      restricted: { matches: restricted_page, acts_at_once: (element) => plain_link(element) || text_field(element) },
    };

    const flags_of = (element, page) => (page.acts_at_once(element) ? 0 : GRANTS_BIT) | (text_field(element) ? FIELD_BIT : 0) | (plain_link(element) ? LINK_BIT : 0);
    // What a target must still be at its pick.
    const identity_of = (element, page) => JSON.stringify([element.localName, element.id, element.className, element.getAttribute("href"), element.getAttribute("role"), element.getAttribute("type"), String(element.textContent ?? "").length, flags_of(element, page)]);

    function box_of(element) {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    // A target under another element is not what the user sees at its box.
    function shows_at(doc, element, x, y) {
      let hit = doc.elementFromPoint(x, y);
      while (shadow_of(hit)) {
        const deeper = shadow_of(hit).elementFromPoint(x, y);
        if (!deeper || deeper === hit) break;
        hit = deeper;
      }
      for (let node = hit; node; node = node.assignedSlot ?? node.parentNode ?? node.host) if (node === element) return true;
      return false;
    }

    function usable(element) {
      if (element.disabled === true || !element.checkVisibility()) return false;
      if (element.localName === "input" && element.type === "hidden") return false;
      const role = element.getAttribute("role");
      if (["a", "area", "button", "input", "select", "textarea", "summary"].includes(element.localName)) return element.localName !== "a" || element.hasAttribute("href");
      return (role !== null && ROLES.has(role)) || element.isContentEditable === true;
    }

    // The targets the user sees in the viewport, each with its box clipped to the viewport for chrome and kept whole for the pick's check.
    function collect_targets(win, doc, action, page) {
      const view_width = win.innerWidth;
      const view_height = win.innerHeight;
      const found = [];
      const seen = new Set();
      for (const element of deep_all(doc, CANDIDATES)) {
        if (found.length >= MAX_TARGETS) break;
        if (seen.has(element) || !usable(element)) continue;
        seen.add(element);
        const flags = flags_of(element, page);
        if (action !== "follow" && (flags & LINK_BIT) === 0) continue;
        const box = box_of(element);
        const center_x = box.left + box.width / 2;
        const center_y = box.top + box.height / 2;
        if (box.width < MIN_SIDE_PX || box.height < MIN_SIDE_PX || center_x < 0 || center_y < 0 || center_x > view_width || center_y > view_height) continue;
        if (!shows_at(doc, element, center_x, center_y)) continue;
        const left = Math.max(0, box.left);
        const top = Math.max(0, box.top);
        const shown = { left, top, width: Math.min(box.left + box.width, view_width) - left, height: Math.min(box.top + box.height, view_height) - top };
        if (shown.width < MIN_SIDE_PX || shown.height < MIN_SIDE_PX) continue;
        found.push({ element, box, shown, flags, identity: identity_of(element, page) });
      }
      return found;
    }

    const inner_of = (win) => win?.windowGlobalChild?.innerWindowId;

    // The one open session: the collect request it answered, its document, its action and kind, and its targets by id.
    let session = null;
    let next_id = 1;
    const GONE_EVENTS = ["mousedown", "scroll", "resize", "pagehide", "visibilitychange"];

    function end_session() {
      const ended = session;
      if (!ended) return;
      session = null;
      clearTimeout(ended.timer);
      for (const type of GONE_EVENTS) removeEventListener(type, on_gone_event, true);
    }

    // The page changed under the labels, or the session sat idle: chrome ends the session or the Enter mark.
    function on_gone_event(event) {
      const owner = session;
      if (!owner) return;
      if (event.type === "mousedown" && !event.isTrusted) return;
      // A frame's own document going away leaves the labels of the page in place.
      if (event.type === "pagehide" && event.target !== content?.document) return;
      if (event.type === "visibilitychange" && content?.document?.visibilityState === "visible") return;
      end_session();
      sendAsyncMessage(MESSAGE_PREFIX + "gone", { session: owner.req, inner: owner.inner });
    }

    function begin_session(req, inner, action, page, found) {
      end_session();
      const targets = new Map();
      const rows = [];
      for (const target of found) {
        const id = next_id++;
        targets.set(id, target);
        const { shown } = target;
        rows.push([id, shown.left, shown.top, shown.width, shown.height, target.flags]);
      }
      session = { req, inner, action, page, targets, url: content.location.href, timer: setTimeout(() => on_gone_event({ type: "idle" }), IDLE_MS) };
      for (const type of GONE_EVENTS) addEventListener(type, on_gone_event, true);
      return rows;
    }

    addMessageListener(MESSAGE_PREFIX + "collect", ({ data }) => {
      const { req, inner, kind, action } = data ?? {};
      if (!Number.isSafeInteger(req)) return;
      const reply = (fields) => sendAsyncMessage(MESSAGE_PREFIX + "targets", { req, inner, ...fields });
      try {
        end_session();
        const win = content;
        const doc = win?.document;
        if (!module_on() || inner_of(win) !== inner) return reply({ error: "changed" });
        const page = typeof kind === "string" && Object.hasOwn(CONTENT_PAGES, kind) ? CONTENT_PAGES[kind] : undefined;
        if (!page || !page.matches(doc)) return reply({ error: "not_here" });
        if (doc.visibilityState !== "visible") return reply({ error: "changed" });
        // A login form of a host that policy added, or of a listed one: hints never run where a password is typed.
        if (deep_all(doc, "input").some((element) => element.type === "password")) return reply({ error: "login_form" });
        const found = collect_targets(win, doc, typeof action === "string" ? action : "follow", page);
        if (found.length === 0) return reply({ error: "nothing" });
        reply({ dpr: win.devicePixelRatio, rows: begin_session(req, inner, action, page, found) });
      } catch (_) {
        end_session();
        reply({ error: "changed" });
      }
    });

    // One pick per session. A target that waits for Enter runs only with `confirmed: true`.
    addMessageListener(MESSAGE_PREFIX + "pick", ({ data }) => {
      const { req, inner, session: tag, id, confirmed } = data ?? {};
      if (!Number.isSafeInteger(req)) return;
      const reply = (fields) => sendAsyncMessage(MESSAGE_PREFIX + "picked", { req, inner, ...fields });
      const owner = session;
      try {
        // A page that changed its route in place keeps its document, and a control alike can sit where the picked one was.
        if (!owner || owner.req !== tag || owner.inner !== inner || inner_of(content) !== inner || content.location.href !== owner.url || !module_on()) return reply({ ok: false, error: "gone" });
        end_session();
        const target = owner.targets.get(id);
        if (!target) return reply({ ok: false, error: "gone" });
        const { element } = target;
        if (!element.isConnected || !element.checkVisibility()) return reply({ ok: false, error: "gone" });
        const now = box_of(element);
        if (Math.abs(now.left - target.box.left) > MOVED_PX || Math.abs(now.top - target.box.top) > MOVED_PX) return reply({ ok: false, error: "moved" });
        if (identity_of(element, owner.page) !== target.identity) return reply({ ok: false, error: "changed" });
        if (owner.action !== "follow") {
          const href = (target.flags & LINK_BIT) !== 0 ? web_href(element) : undefined;
          return reply(href ? { ok: true, href } : { ok: false, error: "no_link" });
        }
        if ((target.flags & GRANTS_BIT) !== 0 && confirmed !== true) return reply({ ok: false, error: "needs_enter" });
        if ((target.flags & FIELD_BIT) !== 0) element.focus();
        else element.click();
        reply({ ok: true });
      } catch (_) {
        reply({ ok: false, error: "gone" });
      }
    });

    addMessageListener(MESSAGE_PREFIX + "clear", ({ data }) => {
      if (session && session.req === data?.session) end_session();
    });
  }
})(this);
