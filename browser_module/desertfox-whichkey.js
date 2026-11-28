// Generated from browser_module/sources/whichkey.js by tools/build_browser_module.ts (just browser-module). Do not edit: change the source and build again.
"use strict";
(() => {
  // src/content/whichkey/style.ts
  var CHAMFER_PX = 8;
  var chamfer = (cut) => `polygon(${cut}px 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% calc(100% - ${cut}px), calc(100% - ${cut}px) 100%, ${cut}px 100%, 0 calc(100% - ${cut}px), 0 ${cut}px)`;
  var STYLE = `
.desertfox-whichkey {
  --bg: var(--desertfox-bg-core, #0c0e13);
  --fg: var(--desertfox-fg-core, #f5f5dc);
  --primary: var(--desertfox-primary, #7fa3c9);
  --secondary: var(--desertfox-secondary, #f0e68c);
  --border: color-mix(in srgb, var(--primary) 60%, var(--bg));
  --dim: color-mix(in srgb, var(--fg) 55%, var(--bg));
  position: fixed; right: 16px; bottom: calc(44px * var(--desertfox-font-scale, 1)); max-width: calc(100vw - 32px);
  font: var(--desertfox-font, calc(14px * var(--desertfox-font-scale, 1)) var(--desertfox-font-family, system-ui, sans-serif));
}
.frame { background: var(--border); padding: 1px; }
.body { box-sizing: border-box; background: var(--bg); color: var(--fg); padding: 14px 14px 8px; overflow: auto; max-height: calc(100vh - 98px * var(--desertfox-font-scale, 1)); }
.round, .round .body { border-radius: var(--desertfox-radius, 6px); }
.chamfer { clip-path: ${chamfer(CHAMFER_PX)}; }
.chamfer .body { clip-path: ${chamfer(CHAMFER_PX - 1)}; }
.title { position: relative; width: fit-content; height: 12px; margin: 0 12px -1px; padding: 0 4px; z-index: 1;
  background: linear-gradient(to bottom, transparent 11px, var(--bg) 11px, var(--bg) 12px, transparent 12px); }
.chip { box-sizing: border-box; max-width: calc(100vw - 64px); overflow: hidden; text-overflow: ellipsis; background: var(--primary); color: var(--bg); font-weight: bold; padding: 2px 7px; border-radius: 3px; white-space: nowrap; }
.rows { display: grid; column-gap: 24px; }
.row { display: flex; height: calc(22px * var(--desertfox-font-scale, 1)); line-height: calc(22px * var(--desertfox-font-scale, 1)); white-space: nowrap; overflow: hidden; }
.key { color: var(--secondary); min-width: 3ch; }
.arrow { color: var(--dim); padding-right: 8px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.group .label { color: var(--primary); font-weight: bold; }
.footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--fg) 15%, var(--bg)); text-align: center; color: var(--dim); font-style: italic; }
.repeat { margin-top: 4px; font-style: normal; white-space: nowrap; }
.footer span { font-style: normal; color: var(--secondary); font-size: 0.8em; margin: 0 4px 0 14px; }`;

  // src/content/whichkey/layout.ts
  var ROW_HEIGHT_PX = 22;
  var RESERVED_HEIGHT_PX = 96;
  var MAX_ROWS_PER_COLUMN = 20;
  var MAX_COLUMNS = 4;
  function choose_columns(row_count, viewport_height_px) {
    const rows_per_column = Math.max(1, Math.min(MAX_ROWS_PER_COLUMN, Math.floor((viewport_height_px - RESERVED_HEIGHT_PX) / ROW_HEIGHT_PX)));
    return Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(row_count / rows_per_column)));
  }
  var TITLE_SEPARATOR = " » ";
  function fit_title(chain, overflows) {
    const shown = (dropped) => ({ text: (dropped === 0 ? chain : ["…", ...chain.slice(dropped)]).join(TITLE_SEPARATOR), dropped });
    for (let dropped = 0; dropped < chain.length - 1; dropped++) {
      if (!overflows(shown(dropped).text)) return shown(dropped);
    }
    return shown(Math.max(0, chain.length - 1));
  }

  // src/content/whichkey/render.ts
  function render_panel(doc, { rows, border, repeat }, footer_keys, viewport_height_px) {
    const element = (tag, class_name, text = "") => Object.assign(doc.createElement(tag), { className: class_name, textContent: text });
    const columns = choose_columns(rows.length, viewport_height_px);
    const list = element("div", "rows");
    list.style.gridTemplateColumns = `repeat(${columns}, auto)`;
    list.append(
      ...rows.map((row) => {
        const line = element("div", row.more ? "row group" : "row");
        line.title = row.description;
        line.append(element("span", "key", row.keys), element("span", "arrow", "➜"), element("span", "label", row.command));
        return line;
      })
    );
    const footer = element("div", "footer");
    for (const [key, word] of footer_keys) footer.append(element("span", "", key), word);
    if (repeat !== void 0) {
      const line = element("div", "repeat");
      line.append(element("span", "", "."), repeat);
      footer.append(line);
    }
    const frame = element("div", `frame ${border}`);
    const body = element("div", "body");
    body.append(list, footer);
    frame.append(body);
    const title_bar = element("div", "title");
    const chip = element("div", "chip");
    title_bar.append(chip);
    return { parts: [title_bar, frame], chip, frame, columns };
  }
  function fit_chip(chip, title) {
    const { text, dropped } = fit_title(title, (candidate) => (chip.textContent = candidate, chip.scrollWidth > chip.clientWidth));
    chip.textContent = text;
    return dropped;
  }

  // src/content/whichkey/timer.ts
  function create_which_key_timer(get_delay_ms, ask, get_skip) {
    let timer;
    let epoch = 0;
    let shown = false;
    return (prefix, at_once) => {
      clearTimeout(timer);
      const instant = at_once || shown;
      shown = false;
      const mine = ++epoch;
      const is_current = () => mine === epoch;
      const drawn = () => void (shown = is_current());
      ask(void 0, is_current, drawn);
      const delay_ms = get_delay_ms();
      if (prefix?.typed_.length && (delay_ms || prefix.held_) && (instant || !get_skip?.()?.includes(prefix.typed_.join(""))))
        timer = setTimeout(() => ask(prefix, is_current, drawn), instant ? 0 : delay_ms);
    };
  }

  // browser_module/sources/whichkey.js
  var scope = globalThis;
  var core = Services.desertfox_browser_module;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null && typeof core === "object" && core !== null) {
    if (typeof core.watch_pending !== "function" || typeof core.module_pending !== "function" || typeof core.watch_root_list !== "function" || typeof core.may_act !== "function") {
      core.log_once?.("the core cannot tell a feature the half-typed keys, so the which-key panel stays off");
    } else {
      const undo = [];
      try {
        start(scope, core, undo);
      } catch (error) {
        for (const step of undo.reverse()) {
          try {
            step();
          } catch (_) {
          }
        }
        core.log_once(`the which-key panel is off in a window: ${error}`);
      }
    }
  }
  function start(win, core2, undo) {
    const doc = win.document;
    const EXTENSION_ID = "desertfox@uhs-robert";
    const STATE_STORAGE_KEY = "desertfox_browser_module_state";
    const PROTOCOL_VERSION = 1;
    const MAX_WHICH_KEY_BYTES = 49152;
    const MAX_WHICH_KEY_PANELS = 64;
    const MAX_WHICH_KEY_ROWS = 80;
    const MAX_WHICH_KEY_TITLE_PARTS = 8;
    const MAX_WHICH_KEY_LABEL_CHARS = 60;
    const MAX_WHICH_KEY_SKIP = 64;
    const MAX_WHICH_KEY_DELAY_MS = 6e4;
    const MAX_KEY_CHARS = 24;
    const MAX_SEQUENCE_KEYS = 8;
    const WHICH_KEY_BORDERS = ["square", "round", "chamfer"];
    const THEME_ROLES = ["bg_core", "fg_core", "primary", "secondary"];
    const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const HOST_CLASS = "desertfox-whichkey-host";
    const FOOTER = [["ESC", "close"]];
    const Z_INDEX = 2147483646;
    const MODULE_CSS = `
.desertfox-whichkey {
  --desertfox-font: var(--tf-font-size, 13px) var(--tf-font-family, system-ui, sans-serif);
  bottom: calc(16px + var(--desertfox-statusbar-height, 0px));
}`;
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const is_shown_text = (text, max_chars) => typeof text === "string" && text.length <= max_chars && !/[\p{Cc}\p{Cf}]/u.test(text);
    const is_key_token = (token) => typeof token === "string" && token.length > 0 && token.length <= MAX_KEY_CHARS && !/[\s\p{Cc}\p{Cf}]/u.test(token);
    const byte_size = (value) => {
      try {
        const text = JSON.stringify(value);
        return text === void 0 ? Number.POSITIVE_INFINITY : new TextEncoder().encode(text).length;
      } catch (_) {
        return Number.POSITIVE_INFINITY;
      }
    };
    function read_panel(value) {
      if (!is_record(value) || !Array.isArray(value.title) || !Array.isArray(value.rows)) return void 0;
      if (value.title.length > MAX_WHICH_KEY_TITLE_PARTS || !value.title.every((part) => is_shown_text(part, MAX_WHICH_KEY_LABEL_CHARS))) return void 0;
      if (value.rows.length === 0 || value.rows.length > MAX_WHICH_KEY_ROWS) return void 0;
      const rows = [];
      for (const row of value.rows) {
        if (!is_record(row) || !is_shown_text(row.keys, MAX_KEY_CHARS) || row.keys === "" || !is_shown_text(row.command, MAX_WHICH_KEY_LABEL_CHARS) || row.more !== void 0 && row.more !== true) return void 0;
        rows.push({ keys: row.keys, command: row.command, description: "", more: row.more === true });
      }
      return { title: [...value.title], rows };
    }
    function read_table(value) {
      if (!is_record(value) || !is_record(value.panels) || byte_size(value) > MAX_WHICH_KEY_BYTES) return void 0;
      const { delay_ms, skip, border } = value;
      if (!Number.isInteger(delay_ms) || delay_ms < 0 || delay_ms > MAX_WHICH_KEY_DELAY_MS || !WHICH_KEY_BORDERS.includes(border)) return void 0;
      if (skip !== void 0 && !(Array.isArray(skip) && skip.length <= MAX_WHICH_KEY_SKIP && skip.every((typed) => is_shown_text(typed, MAX_KEY_CHARS * MAX_SEQUENCE_KEYS)))) return void 0;
      const paths = Object.keys(value.panels);
      if (paths.length > MAX_WHICH_KEY_PANELS) return void 0;
      const panels = /* @__PURE__ */ new Map();
      for (const path of paths) {
        const tokens = path.split(" ");
        const panel = tokens.length <= MAX_SEQUENCE_KEYS && tokens.every(is_key_token) ? read_panel(value.panels[path]) : void 0;
        if (!panel) return void 0;
        panels.set(path, panel);
      }
      const root = value.root === void 0 ? void 0 : read_panel(value.root);
      if (value.root !== void 0 && !root) return void 0;
      return { delay_ms, skip: skip === void 0 ? [] : [...skip], border, panels, root };
    }
    let cached = { holder: void 0, table: void 0, theme: void 0 };
    function table_and_theme() {
      if (!core2.may_act(win)) return void 0;
      const extension = ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
      const holder = extension && extensionStorageSession.get(extension, [STATE_STORAGE_KEY])[STATE_STORAGE_KEY];
      if (holder === void 0) return void 0;
      if (cached.holder !== holder) {
        const raw = typeof holder?.deserialize === "function" ? holder.deserialize(win, true) : holder;
        const fits = is_record(raw) && raw.v === PROTOCOL_VERSION;
        cached = { holder, table: fits ? read_table(raw.which_key) : void 0, theme: fits && is_record(raw.bar_theme) ? raw.bar_theme : void 0 };
      }
      return cached;
    }
    let surface;
    const color_scheme = win.matchMedia("(prefers-color-scheme: dark)");
    function make_surface() {
      const host = doc.createElementNS(HTML_NS, "div");
      host.className = HOST_CLASS;
      host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${Z_INDEX};`;
      const root = host.attachShadow({ mode: "closed" });
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(STYLE + MODULE_CSS);
      root.adoptedStyleSheets = [sheet];
      const text = doc.createElementNS(HTML_NS, "div");
      text.className = "desertfox-whichkey";
      root.append(text);
      return { host, text };
    }
    function apply_theme(host, theme) {
      const scheme = is_record(theme) ? theme[color_scheme.matches ? "dark" : "light"] : void 0;
      const colors = is_record(scheme) ? scheme : {};
      for (const role of THEME_ROLES) {
        const property = `--desertfox-${role.replaceAll("_", "-")}`;
        if (typeof colors[role] === "string" && COLOR.test(colors[role])) host.style.setProperty(property, colors[role]);
        else host.style.removeProperty(property);
      }
    }
    function draw(panel, table, theme) {
      surface ??= make_surface();
      apply_theme(surface.host, theme);
      const page_height = win.gBrowser.selectedBrowser?.getBoundingClientRect?.().height || win.innerHeight;
      const { parts, chip } = render_panel(doc, { rows: panel.rows, border: table.border }, FOOTER, page_height);
      surface.text.replaceChildren(...parts);
      if (surface.host.parentNode !== doc.documentElement) doc.documentElement.append(surface.host);
      fit_chip(chip, panel.title);
    }
    const hide = () => surface?.host.remove();
    let sequence_table;
    const same_keys = (left, right) => left.length === right.length && left.every((key, index) => key === right[index]);
    const follow_prefix = create_which_key_timer(
      () => sequence_table?.table.delay_ms,
      (prefix, is_current, drawn) => {
        if (!prefix) return hide();
        const panel = sequence_table?.table.panels.get(prefix.typed_.join(" "));
        const pending = core2.module_pending(win);
        if (!panel || !is_current() || !pending || !same_keys(pending.keys, prefix.typed_)) return;
        draw(panel, sequence_table.table, sequence_table.theme);
        drawn();
      },
      () => sequence_table?.table.skip
    );
    let opening_root = false;
    const follow_keys = () => {
      if (opening_root) return;
      const pending = core2.module_pending(win);
      if (!pending || pending.keys.length === 0) {
        sequence_table = void 0;
        return follow_prefix(void 0);
      }
      sequence_table ??= table_and_theme();
      if (!sequence_table?.table) {
        sequence_table = void 0;
        return follow_prefix(void 0);
      }
      follow_prefix({ mode: "normal", typed_: [...pending.keys] });
    };
    const end_sequence = () => {
      sequence_table = void 0;
      follow_prefix(void 0);
    };
    let stop_root_close;
    const close_root = () => {
      stop_root_close?.();
      stop_root_close = void 0;
    };
    const show_root = (target, shown_now) => {
      if (target !== win) return;
      if (!shown_now) {
        close_root();
        return end_sequence();
      }
      const shown = table_and_theme();
      if (!shown?.table?.root) return;
      end_sequence();
      close_root();
      draw(shown.table.root, shown.table, shown.theme);
      opening_root = true;
      void Promise.resolve().then(() => {
        opening_root = false;
        if (!surface?.host.parentNode) return;
        const close_on_key = () => (close_root(), hide());
        win.addEventListener("keydown", close_on_key, true);
        stop_root_close = () => win.removeEventListener("keydown", close_on_key, true);
      });
    };
    undo.push(core2.watch_root_list(show_root));
    undo.push(close_root);
    core2.set_hello_flag("which_key_root", true);
    const stop_watching = core2.watch_pending((changed) => {
      if (changed === void 0 || changed === win) follow_keys();
    });
    undo.push(() => stop_watching());
    undo.push(() => end_sequence());
    undo.push(() => surface?.host.remove());
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      undo.push(() => target.removeEventListener(type, handler));
    };
    listen(win.gBrowser.tabContainer, "TabSelect", end_sequence);
    listen(win, "deactivate", end_sequence);
    const progress = {
      onLocationChange(web_progress, _request, _location, flags) {
        if (web_progress?.isTopLevel !== false && !(flags & Components.interfaces.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) end_sequence();
      },
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"])
    };
    win.gBrowser.addProgressListener(progress, Components.interfaces.nsIWebProgress.NOTIFY_LOCATION);
    undo.push(() => win.gBrowser.removeProgressListener(progress));
    win.addEventListener("unload", () => {
      for (const step of undo.splice(0).reverse()) {
        try {
          step();
        } catch (_) {
        }
      }
    }, { once: true });
  }
})();
