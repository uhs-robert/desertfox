// DesertFox browser module, the which-key feature: the panel of the keys that can follow a half-typed sequence, on pages where no DesertFox page code runs. See docs/design/browser_module.md, "Which-key on locked pages".
// tools/build_browser_module.ts bundles this file with the page panel's own sheet, layout, element tree and timer into browser_module/desertfox-whichkey.js, so both panels look and time alike.
// It runs in each browser window and never adopts into the core's sandbox, so a fault here cannot reach the key path. The core tells it when the half-typed keys change (`watch_pending`), and it reads them with `module_pending`.
// The rows come from the state's `which_key` table (src/shared/browser_module_protocol.ts), read as foreign input. It builds DOM with createElement and textContent only, and no text of the state reaches markup or a style rule except as a checked color.
// It sends nothing and writes nothing: the half-typed keys never leave the module.

import { STYLE } from "../../src/content/whichkey/style.ts";
import { fit_chip, render_panel } from "../../src/content/whichkey/render.ts";
import { create_which_key_timer } from "../../src/content/whichkey/timer.ts";

const scope = globalThis;
const core = Services.desertfox_browser_module;
if (typeof scope.gBrowser === "object" && scope.gBrowser !== null && typeof core === "object" && core !== null) {
  if (typeof core.watch_pending !== "function" || typeof core.module_pending !== "function" || typeof core.may_act !== "function") {
    core.log_once?.("the core cannot tell a feature the half-typed keys, so the which-key panel stays off");
  } else {
    // A failed start must not reach the loader or the other features. The panel stays off in this window, with nothing left registered.
    const undo = [];
    try {
      start(scope, core, undo);
    } catch (error) {
      for (const step of undo.reverse()) {
        try {
          step();
        } catch (_) {
          // Nothing is left to undo with.
        }
      }
      core.log_once(`the which-key panel is off in a window: ${error}`);
    }
  }
}

function start(win, core, undo) {
  const doc = win.document;
  // Copies of the names and limits in src/shared/browser_module_protocol.ts. test/browser_module/whichkey.test.ts keeps them equal.
  const EXTENSION_ID = "desertfox@uhs-robert";
  const STATE_STORAGE_KEY = "desertfox_browser_module_state";
  const PROTOCOL_VERSION = 1;
  const MAX_WHICH_KEY_BYTES = 49152;
  const MAX_WHICH_KEY_PANELS = 64;
  const MAX_WHICH_KEY_ROWS = 80;
  const MAX_WHICH_KEY_TITLE_PARTS = 8;
  const MAX_WHICH_KEY_LABEL_CHARS = 60;
  const MAX_WHICH_KEY_SKIP = 64;
  const MAX_WHICH_KEY_DELAY_MS = 60000;
  const MAX_KEY_CHARS = 24;
  const MAX_SEQUENCE_KEYS = 8;
  const WHICH_KEY_BORDERS = ["square", "round", "chamfer"];
  const THEME_ROLES = ["bg_core", "fg_core", "primary", "secondary"];
  const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const HOST_CLASS = "desertfox-whichkey-host";
  // The module walk has no Backspace and no hold, so Escape is the one way out it shows.
  const FOOTER = [["ESC", "close"]];
  // Below the chrome hints' layer, so a hint label started from the panel's keys stays on top.
  const Z_INDEX = 2147483646;
  // Chrome's own font, as the status bar has it, and the corner above the status bar.
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
      return text === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(text).length;
    } catch (_) {
      return Number.POSITIVE_INFINITY;
    }
  };

  // which_key_panel_of: rows of known fields only, or undefined.
  function read_panel(value) {
    if (!is_record(value) || !Array.isArray(value.title) || !Array.isArray(value.rows)) return undefined;
    if (value.title.length > MAX_WHICH_KEY_TITLE_PARTS || !value.title.every((part) => is_shown_text(part, MAX_WHICH_KEY_LABEL_CHARS))) return undefined;
    if (value.rows.length === 0 || value.rows.length > MAX_WHICH_KEY_ROWS) return undefined;
    const rows = [];
    for (const row of value.rows) {
      if (!is_record(row) || !is_shown_text(row.keys, MAX_KEY_CHARS) || row.keys === "" || !is_shown_text(row.command, MAX_WHICH_KEY_LABEL_CHARS) || (row.more !== undefined && row.more !== true)) return undefined;
      rows.push({ keys: row.keys, command: row.command, description: "", more: row.more === true });
    }
    return { title: [...value.title], rows };
  }

  // which_key_table_of: the whole table, or undefined when any part of it is bad. The panels go in a Map, so no path can reach a prototype.
  function read_table(value) {
    if (!is_record(value) || !is_record(value.panels) || byte_size(value) > MAX_WHICH_KEY_BYTES) return undefined;
    const { delay_ms, skip, border } = value;
    if (!Number.isInteger(delay_ms) || delay_ms <= 0 || delay_ms > MAX_WHICH_KEY_DELAY_MS || !WHICH_KEY_BORDERS.includes(border)) return undefined;
    if (skip !== undefined && !(Array.isArray(skip) && skip.length <= MAX_WHICH_KEY_SKIP && skip.every((typed) => is_shown_text(typed, MAX_KEY_CHARS * MAX_SEQUENCE_KEYS)))) return undefined;
    const paths = Object.keys(value.panels);
    if (paths.length > MAX_WHICH_KEY_PANELS) return undefined;
    const panels = new Map();
    for (const path of paths) {
      const tokens = path.split(" ");
      const panel = tokens.length <= MAX_SEQUENCE_KEYS && tokens.every(is_key_token) ? read_panel(value.panels[path]) : undefined;
      if (!panel) return undefined;
      panels.set(path, panel);
    }
    return { delay_ms, skip: skip === undefined ? [] : [...skip], border, panels };
  }

  // The state is read when a sequence starts, not watched. The extension's bucket keeps the holder it wrote until the next write, so the same holder means the same table.
  let cached = { holder: undefined, table: undefined, theme: undefined };
  function table_and_theme() {
    if (!core.may_act(win)) return undefined;
    const extension = ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
    const holder = extension && extensionStorageSession.get(extension, [STATE_STORAGE_KEY])[STATE_STORAGE_KEY];
    if (holder === undefined) return undefined;
    if (cached.holder !== holder) {
      const raw = typeof holder?.deserialize === "function" ? holder.deserialize(win, true) : holder;
      const fits = is_record(raw) && raw.v === PROTOCOL_VERSION;
      cached = { holder, table: fits ? read_table(raw.which_key) : undefined, theme: fits && is_record(raw.bar_theme) ? raw.bar_theme : undefined };
    }
    return cached;
  }

  // ---- The panel: one host on the window's root, a closed shadow root, no pointer.

  let surface;
  const color_scheme = win.matchMedia("(prefers-color-scheme: dark)");

  function make_surface() {
    const host = doc.createElementNS(HTML_NS, "div");
    host.className = HOST_CLASS;
    host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${Z_INDEX};`;
    const root = host.attachShadow({ mode: "closed" });
    // A constructed sheet: no inline style or style element that a chrome document's policy could refuse.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(STYLE + MODULE_CSS);
    root.adoptedStyleSheets = [sheet];
    const text = doc.createElementNS(HTML_NS, "div");
    text.className = "desertfox-whichkey";
    root.append(text);
    return { host, text };
  }

  function apply_theme(host, theme) {
    const scheme = is_record(theme) ? theme[color_scheme.matches ? "dark" : "light"] : undefined;
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

  // ---- When it shows: the page's own timer, fed with the module walk's keys.

  // The table and theme of the sequence under way, read once when its first key comes.
  let sequence_table;
  const same_keys = (left, right) => left.length === right.length && left.every((key, index) => key === right[index]);
  const follow_prefix = create_which_key_timer(
    () => sequence_table?.table.delay_ms,
    (prefix, is_current, drawn) => {
      if (!prefix) return hide();
      const panel = sequence_table?.table.panels.get(prefix.typed_.join(" "));
      // The keys may have changed with no key the core saw: a tab switch, a load.
      const pending = core.module_pending(win);
      if (!panel || !is_current() || !pending || !same_keys(pending.keys, prefix.typed_)) return;
      draw(panel, sequence_table.table, sequence_table.theme);
      drawn();
    },
    () => sequence_table?.table.skip,
  );
  const follow_keys = () => {
    const pending = core.module_pending(win);
    if (!pending || pending.keys.length === 0) {
      sequence_table = undefined;
      return follow_prefix(undefined);
    }
    sequence_table ??= table_and_theme();
    if (!sequence_table?.table) {
      sequence_table = undefined;
      return follow_prefix(undefined);
    }
    follow_prefix({ mode: "normal", typed_: [...pending.keys] });
  };
  const end_sequence = () => {
    sequence_table = undefined;
    follow_prefix(undefined);
  };

  const stop_watching = core.watch_pending((changed) => {
    if (changed === undefined || changed === win) follow_keys();
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
  // A load in the selected tab is another document, whose walk starts fresh. A move within the page (a fragment, pushState) keeps it.
  const progress = {
    onLocationChange(web_progress, _request, _location, flags) {
      if (web_progress?.isTopLevel !== false && !(flags & Components.interfaces.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) end_sequence();
    },
    QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
  };
  win.gBrowser.addProgressListener(progress, Components.interfaces.nsIWebProgress.NOTIFY_LOCATION);
  undo.push(() => win.gBrowser.removeProgressListener(progress));
  // The core keeps the watcher, so a closed window lets go of it here.
  win.addEventListener("unload", () => {
    for (const step of undo.splice(0).reverse()) {
      try {
        step();
      } catch (_) {
        // The window is going away.
      }
    }
  }, { once: true });
}
