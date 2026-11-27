// DesertFox browser module, the status bar. It draws one bar under the page area of each browser window: the mode, the half-typed keys, the macro register, the container, the scroll place and the tab place. See docs/design/browser_module.md.
// It runs in the window itself and never adopts into the core's sandbox, so a fault here cannot reach the key path. It reads the extension's state (src/shared/browser_module_protocol.ts) as foreign input, and the core only for "is the module on".
// It builds DOM with createElement and textContent. No text of the state reaches markup or a style rule except as a checked color.

(function desertfox_browser_module_statusbar(scope) {
  "use strict";
  if (typeof scope.gBrowser !== "object" || scope.gBrowser === null || typeof Services.desertfox_browser_module !== "object" || Services.desertfox_browser_module === null) return;
  const LOG_PREFIX = "DesertFox status bar: ";
  const undo = [];
  try {
    start(scope, undo);
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        step();
      } catch (_) {
        // Nothing is left to undo with.
      }
    }
    Components.utils.reportError(`${LOG_PREFIX}did not start: ${error}`);
  }

  function start(win, undo) {
    const doc = win.document;
    const EXTENSION_ID = "desertfox@uhs-robert";
    const STATE_KEY = "desertfox_browser_module_state";
    const HELLO_KEY = "desertfox_browser_module_hello";
    const PROTOCOL_VERSION = 1;
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    // The kill switch of the bar alone, so a bar fault is turned off with the keys left alone. It is true unless set.
    const BAR_PREF = "desertfox.browser_module.statusbar";
    const SCROLL_MESSAGE = "desertfox-statusbar:scroll";
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const BAR_ID = "desertfox-statusbar";
    const HEIGHT_TOKEN = "--desertfox-statusbar-height";
    const MAX_HELLO_VERSION_CHARS = 32;

    // Copies of the lists in src/shared/browser_module_protocol.ts and src/shared/settings_table.ts. A name that is not here is not drawn.
    const WIDGETS = ["mode", "pending", "recording", "container", "scroll", "tabs", "url"];
    const BORDERS = ["auto", "square", "round", "chamfer"];
    const BAR_ROLES = ["bg_core", "mode_normal", "mode_insert", "mode_ignore", "mode_caret", "mode_visual", "mode_item", "mode_media"];
    // The label of each mode, as src/shared/ui/mode_label.ts has it. Hint and command line mode get a label here because the bar overlaps nothing.
    const MODE_LABELS = { normal: "NORMAL", insert: "INSERT", ignore: "IGNORE", caret: "CARET", visual: "VISUAL", visual_line: "V-LINE", media: "MEDIA", grab: "GRAB", item: "ITEM", item_visual: "VISUAL", hint: "HINT", cmdline: "COMMAND" };
    const MODE_ROLES = { normal: "normal", insert: "insert", ignore: "ignore", caret: "caret", visual: "visual", visual_line: "visual", media: "media", grab: "normal", item: "item", item_visual: "item", hint: "normal", cmdline: "normal", pass: "ignore", site: "visual" };
    const IDENTITY_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple", "toolbar"];
    // What a narrow bar drops first. The mode label is never dropped.
    const DROP_ORDER = ["url", "container", "scroll", "tabs", "recording", "pending"];
    const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const MAX_URL_LABEL = 30;
    // Columns between two widgets of a side, and between the sides, counted in characters of the probe.
    const GAP_CHARS = 3;

    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { ExtensionStorage, extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
    const { Management } = ChromeUtils.importESModule("resource://gre/modules/Extension.sys.mjs");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    let identities;
    try {
      identities = ChromeUtils.importESModule("resource://gre/modules/ContextualIdentityService.sys.mjs").ContextualIdentityService;
    } catch (_) {
      // No containers in this build: the container widget stays empty.
    }

    const logged = new Set();
    const log_once = (text) => {
      if (logged.has(text)) return;
      logged.add(text);
      Components.utils.reportError(LOG_PREFIX + text);
    };

    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const clean = (text, max) => (typeof text === "string" ? text.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, max) : "");
    const deserialized = (holder) => (typeof holder?.deserialize === "function" ? holder.deserialize(win, true) : holder);

    // ---- The text of the widgets. Copies of src/cmdline/status.ts, which test/browser_module/statusbar_labels.test.ts keeps equal.

    function parse_address(address) {
      try {
        return new win.URL(address);
      } catch (_) {
        return undefined;
      }
    }
    function security_state(address) {
      const protocol = parse_address(address)?.protocol;
      if (protocol === "https:") return "ok";
      return protocol === "http:" ? "warn" : "neutral";
    }
    function url_label(address) {
      const parsed = parse_address(address);
      const shown = parsed === undefined || parsed.host === "" ? address : parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
      return shown.length <= MAX_URL_LABEL ? shown : `${shown.slice(0, MAX_URL_LABEL - 1)}…`;
    }
    function scroll_label(top, max) {
      if (!(max >= 1)) return "All";
      if (!(top > 0)) return "Top";
      if (top >= max - 1) return "Bot";
      return `${Math.min(99, Math.max(1, Math.round((top / max) * 100)))}%`;
    }
    const tabs_label = (index, count) => `[${index + 1}/${count}]`;
    // Reader View shows the page it holds, as the address bar does for a page in it.
    function shown_address(spec) {
      const parsed = parse_address(spec);
      if (parsed?.protocol === "about:" && parsed.pathname === "reader") {
        const original = parsed.searchParams.get("url");
        if (original) return original;
      }
      return spec;
    }

    // ---- The state the extension writes, read as foreign input.

    const state_holder = (extension) => extensionStorageSession.get(extension, [STATE_KEY])[STATE_KEY];

    // A view of the state with only what the bar reads, or undefined for a state it must not draw from: another version, no bar settings, the module's switch off.
    function read_state(raw) {
      if (!is_record(raw) || raw.v !== PROTOCOL_VERSION || !is_record(raw.bar)) return undefined;
      const list = (value) => (Array.isArray(value) && value.length <= WIDGETS.length ? [...new Set(value.filter((name) => WIDGETS.includes(name)))] : []);
      return {
        enabled: raw.enabled === true,
        left: list(raw.bar.left),
        right: list(raw.bar.right),
        border: BORDERS.includes(raw.bar.border) ? raw.bar.border : "auto",
        tabs: is_record(raw.tabs) ? raw.tabs : {},
        theme: is_record(raw.bar_theme) ? raw.bar_theme : undefined,
      };
    }

    // What one tab reported, with every field checked again here.
    function tab_view(record) {
      const view = { mode: "normal", pending: [], count: undefined, pass: false, site: "", recording: "" };
      if (!is_record(record)) return view;
      if (typeof record.mode === "string" && Object.hasOwn(MODE_LABELS, record.mode)) view.mode = record.mode;
      if (Array.isArray(record.pending)) view.pending = record.pending.filter((key) => typeof key === "string").slice(-8).map((key) => clean(key, 16));
      if (Number.isInteger(record.count) && record.count > 0 && record.count <= 999999) view.count = record.count;
      view.pass = record.pass === true;
      view.site = clean(record.site, 24);
      view.recording = typeof record.recording === "string" && /^[\p{L}\p{N}"]$/u.test(record.recording) ? record.recording : "";
      return view;
    }

    // ---- What the window says.

    const is_private = () => PrivateBrowsingUtils.isWindowPrivate(win);
    const extension_now = () => ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
    const pref_on = (name, fallback) => {
      try {
        return Services.prefs.getBoolPref(name, fallback);
      } catch (_) {
        log_once(`${name} is not true or false, so the bar stays off`);
        return false;
      }
    };
    const core_on = () => typeof Services.desertfox_browser_module === "object" && Services.desertfox_browser_module !== null;
    // One bar that fails to draw ends every bar of the process for the session, so the hello and the windows agree and the page's corner badge comes back.
    const BROKEN_FLAG = "desertfox_statusbar_broken";
    const broken = () => Services[BROKEN_FLAG] === true;
    const can_run = () => core_on() && pref_on(ENABLED_PREF, false) && pref_on(BAR_PREF, true);

    function tab_id_of(tab) {
      try {
        return String(ExtensionParent.apiManager.global.tabTracker.getId(tab));
      } catch (_) {
        return undefined;
      }
    }

    // ---- The scroll place of a page the extension cannot reach, from a frame script. Each window listens for its own tabs, so no listener the process keeps holds a closed window.

    const FRAME_FLAG = "desertfox_statusbar_frame";
    // The newest report of each of this window's tabs, by <browser>.
    const scrolls = new WeakMap();

    // Runs in each tab. It reports only where DesertFox's page code is absent (about: pages, add-on pages, the PDF viewer, Reader View), so a web page costs no message.
    function scroll_frame_script() {
      const MESSAGE = "desertfox-statusbar:scroll";
      const PREFS = ["desertfox.browser_module.enabled", "desertfox.browser_module.statusbar"];
      const LOCKED_SCHEMES = ["about:", "chrome:", "resource:", "moz-extension:", "view-source:"];
      const THROTTLE_MS = 100;
      const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
      let timer = 0;
      const prefs_on = () => {
        try {
          return PREFS.every((name) => Services.prefs.getBoolPref(name, name.endsWith("statusbar")));
        } catch (_) {
          return false;
        }
      };
      function report() {
        timer = 0;
        try {
          const win = content;
          const doc = win?.document;
          if (!doc || !win.windowGlobalChild || !prefs_on()) return;
          const is_pdf = doc.contentType === "application/pdf";
          if (!is_pdf && !LOCKED_SCHEMES.includes(win.location.protocol)) return;
          const box = is_pdf ? doc.getElementById("viewerContainer") : doc.scrollingElement;
          if (!box) return;
          sendAsyncMessage(MESSAGE, { inner: win.windowGlobalChild.innerWindowId, top: box.scrollTop, max: box.scrollHeight - box.clientHeight });
        } catch (_) {
          // A document going away mid-report sends nothing. The next scroll covers it.
        }
      }
      const soon = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(report, THROTTLE_MS);
      };
      addEventListener("scroll", (event) => (event.target === content?.document || event.target?.id === "viewerContainer") && soon(), true);
      for (const type of ["pageshow", "load"]) addEventListener(type, (event) => event.target === content?.document && soon(), true);
      addMessageListener("desertfox-statusbar:report-now", soon);
      soon();
    }

    function on_scroll_message(message) {
      try {
        const data = message.data;
        if (!win.gBrowser.getTabForBrowser(message.target) || !is_record(data) || typeof data.inner !== "number" || typeof data.top !== "number" || typeof data.max !== "number") return;
        scrolls.set(message.target, { inner: data.inner, top: data.top, max: data.max });
        schedule();
      } catch (error) {
        log_once(`a scroll report was dropped after an error: ${error}`);
      }
    }

    // The frame script stays loaded for the session, as the core's do. It checks the prefs itself.
    function load_frame_script() {
      if (Services[FRAME_FLAG]) return;
      Services[FRAME_FLAG] = true;
      Services.mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`(${scroll_frame_script})();`), true);
    }

    // ---- The model: what each widget says now. No DOM and no layout read.

    function container_of(tab) {
      const id = tab.userContextId;
      if (!identities || !Number.isInteger(id) || id <= 0 || is_private()) return undefined;
      const identity = identities.getPublicIdentityFromId(id);
      if (!identity) return undefined;
      return { text: clean(identities.getUserContextLabel(id), 40), color: IDENTITY_COLORS.includes(identity.color) ? identity.color : "toolbar" };
    }

    function tab_place(tab) {
      const tabs = win.gBrowser.visibleTabs;
      const index = tabs.indexOf(tab);
      return index < 0 ? undefined : tabs_label(index, tabs.length);
    }

    // `facts` is everything the widgets need from the window, so the model is a plain function of them.
    function widget_of(name, facts) {
      const view = facts.view;
      if (name === "mode") {
        if (!facts.enabled) return undefined;
        const label = view.pass ? "PASS" : view.site || MODE_LABELS[view.mode];
        return { name, text: label, role: view.pass ? MODE_ROLES.pass : view.site ? MODE_ROLES.site : MODE_ROLES[view.mode] };
      }
      if (name === "pending") {
        const text = (view.count ?? "") + view.pending.join("");
        return text === "" ? undefined : { name, text };
      }
      if (name === "recording") return view.recording === "" ? undefined : { name, text: `recording @${view.recording}` };
      if (name === "container") return facts.container && facts.container.text !== "" ? { name, text: facts.container.text, color: facts.container.color } : undefined;
      if (name === "scroll") return facts.scroll ? { name, text: scroll_label(facts.scroll.top, facts.scroll.max) } : undefined;
      if (name === "tabs") return facts.place === undefined ? undefined : { name, text: facts.place };
      if (name === "url") {
        if (facts.private || facts.spec === undefined) return undefined;
        const address = shown_address(facts.spec);
        return { name, text: url_label(address), title: clean(address, 200), security: security_state(address) };
      }
      return undefined;
    }

    function widgets_for(names, facts) {
      const out = [];
      for (const name of names) {
        try {
          const widget = widget_of(name, facts);
          if (widget) out.push(widget);
        } catch (error) {
          // One failing widget blanks itself and not the bar.
          log_once(`the ${name} widget failed: ${error}`);
        }
      }
      return out;
    }

    const widget_chars = (widget) => [...widget.text].length + (widget.name === "container" ? 2 : widget.name === "mode" ? 2 : 0);

    // Drops the widgets of the lowest priority until the two sides fit `columns` characters. `columns` is undefined before the bar has a width.
    function fit(left, right, columns) {
      if (columns === undefined) return [left, right];
      const chars = (side) => side.reduce((sum, widget) => sum + widget_chars(widget) + GAP_CHARS, 0);
      let kept = [left, right];
      for (const name of DROP_ORDER) {
        if (chars(kept[0]) + chars(kept[1]) <= columns) break;
        kept = kept.map((side) => side.filter((widget) => widget.name !== name));
      }
      return kept;
    }

    // ---- The look.

    const CSS = `
#${BAR_ID} {
  --dfx-gap: 8px;
  --dfx-radius: 0px; --dfx-cut: 12px; --dfx-bw: 1px; --dfx-outside: var(--tf-bg, var(--toolbar-bgcolor, -moz-dialog));
  display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px;
  box-sizing: border-box; position: relative; z-index: 5; overflow: hidden; white-space: pre;
  min-height: 24px; padding: 2px 8px;
  background: var(--toolbar-bgcolor, -moz-dialog); color: var(--toolbar-color, -moz-dialogtext);
  border-top: 1px solid var(--panel-border-color, color-mix(in srgb, currentColor 25%, transparent));
  font-family: var(--tf-font-family, system-ui); font-size: var(--tf-font-size, 13px);
  --desertfox-bg-core: #0c0e13; --desertfox-mode-normal: #7fa3c9; --desertfox-mode-insert: #ffa0a0; --desertfox-mode-ignore: #717a84;
  --desertfox-mode-caret: #f0e68c; --desertfox-mode-visual: #ffba75; --desertfox-mode-item: #c695ff; --desertfox-mode-media: #a3e39a;
}
#${BAR_ID}[data-textfox] {
  margin: 0 var(--dfx-gap) var(--dfx-gap); padding: 4px 8px; background: var(--tf-bg, -moz-dialog);
  --dfx-bw: var(--tf-border-width, 2px);
  border: var(--dfx-bw) solid var(--tf-border, var(--panel-border-color));
  border-radius: var(--dfx-radius); transition: border-color var(--tf-border-transition, 0.2s ease);
  --tf-bevel-line: var(--tf-border);
}
#${BAR_ID}[data-textfox]:hover { border-color: var(--tf-accent, currentColor); --tf-bevel-line: var(--tf-accent); }
#${BAR_ID}[data-corner="round"] { --dfx-radius: var(--dfx-round, 6px); }
/* The polygon cuts the bar itself, so the square border corner is gone. overflow is visible here because hidden would clip the ::after to the padding box, and the polygon already clips everything to the border box. */
#${BAR_ID}[data-corner="chamfer"] {
  overflow: visible;
  clip-path: polygon(var(--dfx-cut) 0, calc(100% - var(--dfx-cut)) 0, 100% var(--dfx-cut), 100% calc(100% - var(--dfx-cut)), calc(100% - var(--dfx-cut)) 100%, var(--dfx-cut) 100%, 0 calc(100% - var(--dfx-cut)), 0 var(--dfx-cut));
}
#${BAR_ID}[data-corner="chamfer"]::after {
  content: ""; position: absolute; inset: calc(-1 * var(--dfx-bw)); pointer-events: none;
  background:
    linear-gradient(135deg, var(--dfx-outside) 50%, var(--tf-bevel-line, currentColor) 50%, var(--tf-bevel-line, currentColor) calc(50% + var(--dfx-bw)), transparent calc(50% + var(--dfx-bw))) left top / var(--dfx-cut) var(--dfx-cut) no-repeat,
    linear-gradient(225deg, var(--dfx-outside) 50%, var(--tf-bevel-line, currentColor) 50%, var(--tf-bevel-line, currentColor) calc(50% + var(--dfx-bw)), transparent calc(50% + var(--dfx-bw))) right top / var(--dfx-cut) var(--dfx-cut) no-repeat,
    linear-gradient(315deg, var(--dfx-outside) 50%, var(--tf-bevel-line, currentColor) 50%, var(--tf-bevel-line, currentColor) calc(50% + var(--dfx-bw)), transparent calc(50% + var(--dfx-bw))) right bottom / var(--dfx-cut) var(--dfx-cut) no-repeat,
    linear-gradient(45deg, var(--dfx-outside) 50%, var(--tf-bevel-line, currentColor) 50%, var(--tf-bevel-line, currentColor) calc(50% + var(--dfx-bw)), transparent calc(50% + var(--dfx-bw))) left bottom / var(--dfx-cut) var(--dfx-cut) no-repeat;
  transition: --tf-bevel-line var(--tf-border-transition, 0.2s ease);
}
/* Without TextFox only the top border exists, so the padding box already meets the border box on the other three sides. */
#${BAR_ID}:not([data-textfox])[data-corner="chamfer"]::after { inset: calc(-1 * var(--dfx-bw)) 0 0; }
#${BAR_ID}:not([data-on]),
:root[inFullscreen] #${BAR_ID},
:root[customizing] #${BAR_ID} { display: none; }
#${BAR_ID} .dfx-side { display: flex; align-items: center; gap: 12px; min-width: 0; }
#${BAR_ID} .dfx-right { margin-inline-start: auto; }
#${BAR_ID} .dfx-widget { display: inline-flex; align-items: center; gap: 6px; }
#${BAR_ID} .dfx-mode { padding: 0 8px; border-radius: calc(var(--dfx-radius) / 2); color: var(--desertfox-bg-core); font-weight: bold; }
#${BAR_ID} .dfx-mode[data-role="normal"] { background: var(--desertfox-mode-normal); }
#${BAR_ID} .dfx-mode[data-role="insert"] { background: var(--desertfox-mode-insert); }
#${BAR_ID} .dfx-mode[data-role="ignore"] { background: var(--desertfox-mode-ignore); }
#${BAR_ID} .dfx-mode[data-role="caret"] { background: var(--desertfox-mode-caret); }
#${BAR_ID} .dfx-mode[data-role="visual"] { background: var(--desertfox-mode-visual); }
#${BAR_ID} .dfx-mode[data-role="item"] { background: var(--desertfox-mode-item); }
#${BAR_ID} .dfx-mode[data-role="media"] { background: var(--desertfox-mode-media); }
#${BAR_ID} .dfx-recording { color: var(--desertfox-mode-insert); }
#${BAR_ID} .dfx-url[data-security="ok"] { color: var(--desertfox-mode-media); }
#${BAR_ID} .dfx-url[data-security="warn"] { color: var(--desertfox-mode-visual); }
#${BAR_ID} .dfx-dot { width: 0.7em; height: 0.7em; border-radius: 50%; background: currentColor; }
#${BAR_ID} .dfx-dot[data-color="blue"] { background: var(--identity-icon-color-blue, #37adff); }
#${BAR_ID} .dfx-dot[data-color="turquoise"] { background: var(--identity-icon-color-turquoise, #00c79a); }
#${BAR_ID} .dfx-dot[data-color="green"] { background: var(--identity-icon-color-green, #51cd00); }
#${BAR_ID} .dfx-dot[data-color="yellow"] { background: var(--identity-icon-color-yellow, #ffcb00); }
#${BAR_ID} .dfx-dot[data-color="orange"] { background: var(--identity-icon-color-orange, #ff9f00); }
#${BAR_ID} .dfx-dot[data-color="red"] { background: var(--identity-icon-color-red, #ff613d); }
#${BAR_ID} .dfx-dot[data-color="pink"] { background: var(--identity-icon-color-pink, #ff4bda); }
#${BAR_ID} .dfx-dot[data-color="purple"] { background: var(--identity-icon-color-purple, #af51f5); }
#${BAR_ID} .dfx-probe { position: absolute; visibility: hidden; pointer-events: none; }
#${BAR_ID} .dfx-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; pointer-events: none; }
`;

    // ---- The DOM.

    const browser_box = doc.getElementById("browser");
    if (!browser_box) {
      log_once("the browser area was not found, so no bar is drawn");
      return;
    }
    if (doc.getElementById(BAR_ID)) return;
    const el = (tag, class_name) => {
      const node = doc.createElementNS(HTML_NS, tag);
      if (class_name) node.className = class_name;
      return node;
    };
    const bar = el("div");
    bar.id = BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "off");
    const left_side = el("div", "dfx-side dfx-left");
    const right_side = el("div", "dfx-side dfx-right");
    const live = el("div", "dfx-live");
    live.setAttribute("aria-live", "polite");
    const probe = el("span", "dfx-probe");
    probe.textContent = "MMMMMMMMMM";
    bar.append(left_side, right_side, live, probe);
    const sheet_uri = "data:text/css;charset=utf-8," + encodeURIComponent(CSS);
    const sheet_type = win.windowUtils.AUTHOR_SHEET;
    win.windowUtils.loadSheetUsingURIString(sheet_uri, sheet_type);
    undo.push(() => win.windowUtils.removeSheetUsingURIString(sheet_uri, sheet_type));
    browser_box.after(bar);
    undo.push(() => bar.remove());
    const root = doc.documentElement;
    undo.push(() => root.style.removeProperty(HEIGHT_TOKEN));
    root.style.setProperty(HEIGHT_TOKEN, "0px");

    // ---- Drawing. Everything marks dirty and one frame draws.

    let extension_for_listening;
    let stop_listening = () => undefined;
    let state;
    let columns;
    let char_px = 0;
    let last_model = "";
    let last_theme = "";
    let last_look = "";
    let announced = "";
    let frame_pending = false;
    let closed = false;
    let was_running = false;
    const color_scheme = win.matchMedia("(prefers-color-scheme: dark)");

    function current_state() {
      const extension = extension_now();
      if (!extension || !can_run() || broken() || (is_private() && !extension.privateBrowsingAllowed)) return undefined;
      const holder = state_holder(extension);
      return holder === undefined ? undefined : read_state(deserialized(holder));
    }

    function facts_of(view_state) {
      const tab = win.gBrowser.selectedTab;
      const browser = win.gBrowser.selectedBrowser;
      const id = tab_id_of(tab);
      const record = id !== undefined && Object.hasOwn(view_state.tabs, id) ? view_state.tabs[id] : undefined;
      const scroll = scrolls.get(browser);
      return {
        enabled: view_state.enabled,
        view: tab_view(record),
        container: container_of(tab),
        scroll: scroll && scroll.inner === browser.innerWindowID ? scroll : undefined,
        place: tab_place(tab),
        spec: browser.currentURI?.spec,
        private: is_private(),
      };
    }

    function apply_theme(theme) {
      const scheme = color_scheme.matches ? "dark" : "light";
      const colors = is_record(theme) && is_record(theme[scheme]) ? theme[scheme] : {};
      const text = JSON.stringify(BAR_ROLES.map((role) => (typeof colors[role] === "string" && COLOR.test(colors[role]) ? colors[role] : "")));
      if (text === last_theme) return;
      last_theme = text;
      for (const role of BAR_ROLES) {
        const property = `--desertfox-${role.replaceAll("_", "-")}`;
        if (typeof colors[role] === "string" && COLOR.test(colors[role])) bar.style.setProperty(property, colors[role]);
        else bar.style.removeProperty(property);
      }
    }

    // Reads the owner's chrome style once per change of the look: whether TextFox variables are present and which corner the panes have. Not a per-render read.
    function apply_look(border) {
      const root_style = win.getComputedStyle(root);
      const textfox = root_style.getPropertyValue("--tf-bg").trim() !== "";
      let corner = border;
      let cut = "12px";
      let radius = "6px";
      if (border === "auto") {
        const rounding = parseFloat(root_style.getPropertyValue("--tf-rounding"));
        const nav = doc.getElementById("nav-bar");
        const after = nav ? win.getComputedStyle(nav, "::after") : undefined;
        if (rounding > 0) {
          corner = "round";
          radius = `${Math.min(rounding, 24)}px`;
        } else if (textfox && after && after.content === '""') {
          corner = "chamfer";
          const size = parseFloat(after.backgroundSize);
          if (size >= 4 && size <= 24) cut = `${size}px`;
        } else corner = "square";
      }
      const text = [textfox, corner, cut, radius].join("|");
      if (text === last_look) return;
      last_look = text;
      if (textfox) bar.setAttribute("data-textfox", "");
      else bar.removeAttribute("data-textfox");
      bar.setAttribute("data-corner", corner);
      bar.style.setProperty("--dfx-cut", cut);
      bar.style.setProperty("--dfx-round", radius);
    }

    function draw_widget(widget) {
      const node = el("span", `dfx-widget dfx-${widget.name}`);
      if (widget.role) node.setAttribute("data-role", widget.role);
      if (widget.security) node.setAttribute("data-security", widget.security);
      if (widget.title) node.setAttribute("title", widget.title);
      if (widget.name === "container") {
        const dot = el("span", "dfx-dot");
        dot.setAttribute("data-color", widget.color);
        const label = el("span");
        label.textContent = widget.text;
        node.append(dot, label);
      } else node.textContent = widget.text;
      return node;
    }

    function render() {
      frame_pending = false;
      if (closed) return;
      try {
        state = current_state();
        if (!state) {
          bar.removeAttribute("data-on");
          root.style.setProperty(HEIGHT_TOKEN, "0px");
          last_model = "";
          return;
        }
        apply_theme(state.theme);
        apply_look(state.border);
        const facts = facts_of(state);
        const [left, right] = fit(widgets_for(state.left, facts), widgets_for(state.right, facts), columns);
        const model = JSON.stringify([left, right]);
        bar.setAttribute("data-on", "");
        if (model !== last_model) {
          last_model = model;
          left_side.replaceChildren(...left.map(draw_widget));
          right_side.replaceChildren(...right.map(draw_widget));
        }
        // The live region speaks a change of the mode and of the macro register only, not every key.
        const spoken = [left, right].flat().filter((widget) => widget.name === "mode" || widget.name === "recording").map((widget) => widget.text).join(" ");
        if (spoken !== announced) {
          announced = spoken;
          live.textContent = spoken;
        }
      } catch (error) {
        log_once(`a draw failed, so the bar is off for this session: ${error}`);
        Services[BROKEN_FLAG] = true;
        bar.removeAttribute("data-on");
        root.style.setProperty(HEIGHT_TOKEN, "0px");
        try {
          if (extension_for_listening) say_bar_in_hello(extension_for_listening);
        } catch (_) {
          // The hello is retracted by the next window that sees the flag.
        }
      }
    }

    function schedule() {
      if (frame_pending || closed) return;
      frame_pending = true;
      win.requestAnimationFrame(render);
    }

    // The width in characters and the height token. A resize is the one place that reads layout.
    const resizes = new win.ResizeObserver((entries) => {
      try {
        const entry = entries.at(-1);
        const box = entry?.borderBoxSize?.[0];
        const shown = bar.hasAttribute("data-on") && box && box.blockSize > 0;
        if (shown) {
          const style = win.getComputedStyle(bar);
          root.style.setProperty(HEIGHT_TOKEN, `${box.blockSize + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)}px`);
        } else root.style.setProperty(HEIGHT_TOKEN, "0px");
        const probe_width = probe.getBoundingClientRect().width;
        char_px = probe_width > 0 ? probe_width / 10 : char_px;
        const style = win.getComputedStyle(bar);
        const inner = (entry?.contentRect?.width ?? 0) - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
        const next = char_px > 0 && inner > 0 ? Math.floor(inner / char_px) : undefined;
        if (next !== columns) {
          columns = next;
          schedule();
        }
      } catch (error) {
        log_once(`a resize was not read: ${error}`);
      }
    });
    resizes.observe(bar);
    undo.push(() => resizes.disconnect());

    // ---- The hello: the bar says it is built, so DesertFox hides its corner badge. It rewrites the core's hello and never writes one of its own.

    function say_bar_in_hello(extension) {
      const capable = core_on() && pref_on(BAR_PREF, true) && !broken() && !closed;
      const holder = extensionStorageSession.get(extension, [HELLO_KEY])[HELLO_KEY];
      if (holder === undefined) return;
      const hello = deserialized(holder);
      if (!is_record(hello) || hello.v !== PROTOCOL_VERSION || typeof hello.module_version !== "string" || hello.module_version.length > MAX_HELLO_VERSION_CHARS) return;
      if ((hello.bar === true) === capable) return;
      const next = { ...hello };
      if (capable) next.bar = true;
      else delete next.bar;
      extensionStorageSession.set(extension, { [HELLO_KEY]: ExtensionStorage.serialize(HELLO_KEY, HELLO_KEY, next) });
    }

    function on_storage(changes) {
      try {
        if (Object.hasOwn(changes, HELLO_KEY)) (say_bar_in_hello(extension_for_listening), schedule());
        if (Object.hasOwn(changes, STATE_KEY)) schedule();
      } catch (error) {
        log_once(`a storage change was dropped after an error: ${error}`);
      }
    }

    function listen_to_extension() {
      const extension = extension_now();
      if (extension === extension_for_listening) return;
      stop_listening();
      extension_for_listening = extension;
      stop_listening = extension ? extensionStorageSession.registerListener(extension, on_storage) : () => undefined;
      if (extension) say_bar_in_hello(extension);
    }

    // Everything that can change what the bar is: a switch, the extension coming or going, the module being turned off.
    function refresh() {
      try {
        if (closed) return;
        listen_to_extension();
        if (extension_for_listening) say_bar_in_hello(extension_for_listening);
        const running = can_run();
        if (running) load_frame_script();
        // A page that scrolled while the bar was off has no report of its own to send, so the tabs are asked again.
        if (running && !was_running) Services.mm.broadcastAsyncMessage("desertfox-statusbar:report-now");
        was_running = running;
        schedule();
      } catch (error) {
        log_once(`the switch change failed: ${error}`);
      }
    }

    // ---- Wiring. Each registration is undone at unload, and a start that fails halfway undoes what it did.

    undo.push(() => stop_listening());
    Services.mm.addMessageListener(SCROLL_MESSAGE, on_scroll_message);
    undo.push(() => Services.mm.removeMessageListener(SCROLL_MESSAGE, on_scroll_message));
    const tab_events = ["TabSelect", "TabOpen", "TabClose", "TabMove", "TabAttrModified", "TabShow", "TabHide", "SSTabRestoring"];
    for (const type of tab_events) {
      win.gBrowser.tabContainer.addEventListener(type, schedule);
      undo.push(() => win.gBrowser.tabContainer.removeEventListener(type, schedule));
    }
    const progress = {
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange: schedule,
      onSecurityChange: schedule,
    };
    win.gBrowser.addProgressListener(progress, Components.interfaces.nsIWebProgress.NOTIFY_LOCATION | Components.interfaces.nsIWebProgress.NOTIFY_SECURITY);
    undo.push(() => win.gBrowser.removeProgressListener(progress));
    for (const name of [ENABLED_PREF, BAR_PREF]) {
      Services.prefs.addObserver(name, refresh);
      undo.push(() => Services.prefs.removeObserver(name, refresh));
    }
    const on_extension = (_name, extension) => extension?.id === EXTENSION_ID && refresh();
    Management.on("ready", on_extension);
    undo.push(() => Management.off("ready", on_extension));
    Management.on("shutdown", on_extension);
    undo.push(() => Management.off("shutdown", on_extension));
    // A Firefox theme change moves the colors the bar reads, so the look is read again.
    const on_theme = () => {
      last_look = "";
      schedule();
    };
    color_scheme.addEventListener("change", on_theme);
    undo.push(() => color_scheme.removeEventListener("change", on_theme));
    try {
      Services.obs.addObserver(on_theme, "lightweight-theme-styling-update");
      undo.push(() => Services.obs.removeObserver(on_theme, "lightweight-theme-styling-update"));
    } catch (_) {
      // Without the topic the look is read at start and on a scheme change.
    }

    const unload = () => {
      closed = true;
      stop_listening();
      for (const step of undo.splice(0).reverse()) {
        try {
          step();
        } catch (_) {
          // The window is going away.
        }
      }
    };
    win.addEventListener("unload", unload, { once: true });
    undo.push(() => win.removeEventListener("unload", unload));

    refresh();
  }
})(this);
