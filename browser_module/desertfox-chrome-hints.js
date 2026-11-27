// DesertFox browser module, hints over Firefox's own UI: the nav bar, the tab strip, the bookmarks toolbar, the sidebar buttons, the menu bar, and the rows of an open app menu.
// The module collects the targets and sends only ids and boxes. The extension makes the labels, narrows them as the user types and names the target to pick. The module draws what it is told and runs one fixed action per target kind.
// Requests: chrome_hints.collect starts a session, chrome_hints.draw shows labels, chrome_hints.pick runs a target, chrome_hints.clear ends it. Pushes back: chrome_hints.targets, chrome_hints.key and chrome_hints.end.

(function desertfox_browser_module_chrome_hints(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the chrome hints feature failed to load: ${error}`);
    }
    return;
  }
  define(core);

  function define(core) {
    const EXTENSION_ID = "desertfox@uhs-robert";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    const HTML = "http://www.w3.org/1999/xhtml";
    // The one sheet the labels take, built from the hint view's own style (tools/build.mjs). Never a path or a sheet from a message.
    const STYLE_FILE = "chrome_hints.css";
    const HOST_CLASS = "desertfox-chrome-hints";
    // Bounds so that a session's targets fit a few messages of the from-module list, which keeps only its newest 16.
    const MAX_TARGETS = 400;
    const PART_BYTES = 3000;
    // CHROME_HINT_MAX_PARTS of the protocol.
    const MAX_PARTS = 32;
    // Two letters, the smallest alphabet hint_letters allows, give make_labels its longest labels: one letter per halving of the targets.
    const MAX_LABEL_CHARS = Math.ceil(Math.log2(MAX_TARGETS));
    const MAX_EARLY_KEYS = 16;
    // The extension answers a collect with its first labels within this, or the session ends: a dead extension must not keep the keys.
    const FIRST_DRAW_MS = 2000;
    // A target that moved further than this since its label was drawn is not picked: the label no longer marks it.
    const MOVED_PX = 2;
    const MIN_SIDE_PX = 4;
    const NAMED_KEYS = new Set(["Backspace", "Enter", "Tab"]);
    const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);
    const COLOR = /^#[0-9a-fA-F]{3,8}$/;
    const COLOR_ROLES = ["primary", "bg_core", "fg_core"];
    // The alphabet the hint_letters setting allows: any key but a blank and "/".
    const LABEL = /^[^\s/]+$/u;
    const KEY_OWNER = "chrome_hints";

    // Where the targets of the window sit. Each row is a root and what to take under it. A root missing in this Firefox is skipped.
    const WINDOW_GROUPS = [
      { root: "#nav-bar", take: "toolbarbutton" },
      { root: "#TabsToolbar", take: "tab.tabbrowser-tab, toolbarbutton" },
      { root: "#PersonalToolbar", take: "toolbarbutton" },
      { root: "#toolbar-menubar", take: "menubar > menu" },
      { root: "#sidebar-button", take: "" },
      { root: "sidebar-main", take: "moz-button, button", shadow: true },
    ];
    // The panels whose rows get labels. Labels go inside the panel's own DOM, because a popup is a surface of its own that a layer of the window does not cover.
    // The downloads panel is left out: a click on its row does nothing, and its blocked-download buttons need a confirm key first.
    const PANELS = [
      { id: "appMenu-popup", take: "toolbarbutton, button" },
    ];

    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

    const is_record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const enabled_by_pref = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };
    const json_bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
    const parse_json = (text) => {
      try {
        return JSON.parse(text);
      } catch (_) {
        return undefined;
      }
    };

    // Target ids count up for the life of the process, so an id from an older session never names a target of a newer one.
    let next_target_id = 1;
    let session = null;

    // ---- Collect.

    const box_of = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const big_enough = (box) => box.width >= MIN_SIDE_PX && box.height >= MIN_SIDE_PX;
    const within = (box, area) => box.left + box.width / 2 >= area.left && box.left + box.width / 2 <= area.left + area.width && box.top + box.height / 2 >= area.top && box.top + box.height / 2 <= area.top + area.height;

    // A tab scrolled out of the strip, or a button under another, is not what the user sees at its box. The hit test goes down through each shadow root and back up through each host.
    function shows_at_its_box(doc, element, box) {
      let hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      while (hit?.shadowRoot) {
        const deeper = hit.shadowRoot.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!deeper || deeper === hit) break;
        hit = deeper;
      }
      for (let node = hit; node; node = node.parentNode ?? node.host) if (node === element) return true;
      return false;
    }

    // The fixed action of each target: a tab is selected, a menu or a bookmarks folder opens, a button runs its command or is clicked.
    function kind_of(element) {
      if (element.localName === "tab") return "tab";
      if (element.localName === "menu" || (element.localName === "toolbarbutton" && element.getAttribute("type") === "menu")) return "menu";
      return "button";
    }

    // A XUL button that runs a <command> is as enabled as that command. Its own `disabled` can be stale: the reload button keeps one while Reload works.
    const command_of = (element) => (element.namespaceURI !== HTML && element.hasAttribute("command") ? element.ownerDocument.getElementById(element.getAttribute("command")) : null);
    function usable(element) {
      const command = command_of(element);
      const disabled = command ? command.hasAttribute("disabled") && command.getAttribute("disabled") !== "false" : element.disabled || element.getAttribute("disabled") === "true";
      return !element.hidden && !disabled && element.checkVisibility();
    }

    function window_targets(win) {
      const doc = win.document;
      const view = { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
      const found = [];
      const seen = new Set();
      for (const group of WINDOW_GROUPS) {
        for (const root of doc.querySelectorAll(group.root)) {
          const scope_root = group.shadow ? root.shadowRoot : root;
          if (!scope_root) continue;
          const elements = group.take === "" ? [root] : [...scope_root.querySelectorAll(group.take)];
          for (const element of elements) {
            if (seen.has(element) || !usable(element)) continue;
            seen.add(element);
            const box = box_of(element);
            if (!big_enough(box) || !within(box, view) || !shows_at_its_box(doc, element, box)) continue;
            found.push({ element, box, place: "window" });
          }
        }
      }
      return found;
    }

    // The view a multi-view panel shows: PanelMultiView marks it `visible`, and its other views still pass checkVisibility. Two can show for a moment while it slides, and the newest is last.
    function shown_view(panel) {
      const views = [...panel.querySelectorAll("panelview")].filter((view) => view.hasAttribute("visible") && view.checkVisibility() && big_enough(box_of(view)));
      return views.at(-1) ?? panel;
    }

    function open_panel(doc) {
      for (const row of PANELS) {
        const panel = doc.getElementById(row.id);
        if (panel?.state === "open") return { panel, row };
      }
      return undefined;
    }

    function panel_targets(panel, row) {
      const view = shown_view(panel);
      const area = box_of(view);
      const found = [];
      for (const element of view.querySelectorAll(row.take)) {
        if (!usable(element)) continue;
        const box = box_of(element);
        if (big_enough(box) && within(box, area)) found.push({ element, box, place: "panel" });
      }
      return { view, found };
    }

    // A XUL menu holds the keys while it is open, so a session would fight it. Tooltips and the address bar's results are popups too, but hold no keys.
    function menu_open(doc) {
      for (const popup of doc.querySelectorAll("menupopup")) if (popup.state === "open" || popup.state === "showing") return true;
      return false;
    }

    // A field where a session would read what the user types: the address bar, the find bar, a tab-modal prompt, or a page no content script reaches.
    // `focused_element` stops at a page in another process, so the window's input state covers a field there.
    const field_focused = (win) => core.is_field(core.focused_element(win)) || core.ime_in_field(win);

    // The window the request names, only when it is a browser window in front. A window that lost the focus between the key and the request gets no session.
    function window_for(window_id) {
      let win;
      try {
        win = ExtensionParent.apiManager.global.windowTracker.getWindow(window_id, null, false);
      } catch (_) {
        return { problem: "The window is gone" };
      }
      if (!win || win.closed || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser") return { problem: "The window is gone" };
      if (Services.focus.activeWindow !== win) return { problem: "The window is not in front" };
      if (!core.may_act(win)) return { problem: "DesertFox cannot run in this window" };
      return { win };
    }

    // The theme colors as data: each a hex color or left out, so the sheet's own fallbacks show.
    function theme_text(colors_json) {
      const colors = colors_json === "" ? undefined : parse_json(colors_json);
      if (!is_record(colors)) return "";
      const block = (scheme) => (is_record(scheme) ? COLOR_ROLES.filter((role) => COLOR.test(scheme[role] ?? "")).map((role) => `--desertfox-${role.replace("_", "-")}: ${scheme[role]};`).join(" ") : "");
      return `:host { ${block(colors.dark)} }\n@media (prefers-color-scheme: light) { :host { ${block(colors.light)} } }`;
    }

    // ---- The layer: a host in the window document for the toolbars, and one inside the panel for its rows.

    function make_layer(doc, style_url, theme, fixed) {
      const host = doc.createElementNS(HTML, "div");
      host.className = HOST_CLASS;
      host.style.cssText = fixed ? "position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;" : "position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 2147483647;";
      const root = host.attachShadow({ mode: "closed" });
      const sheet = doc.createElementNS(HTML, "link");
      sheet.setAttribute("rel", "stylesheet");
      sheet.setAttribute("href", style_url);
      const colors = doc.createElementNS(HTML, "style");
      colors.textContent = theme;
      const box = doc.createElementNS(HTML, "div");
      box.className = "desertfox-hints";
      root.append(sheet, colors, box);
      return { host, box };
    }

    // ---- The session.

    const send = (kind, args) => {
      const sent = core.send(kind, args);
      if (!sent.ok) core.log_once(`${kind} was not sent: ${sent.problem}`);
      return sent.ok;
    };

    // Ends the session and takes away everything it added: the layers, the listeners and the timer. `tell` pushes the end to the extension, for an end the extension did not ask for.
    function end_session(tell) {
      const ended = session;
      if (!ended) return;
      session = null;
      for (const stop of ended.undo.splice(0)) {
        try {
          stop();
        } catch (error) {
          core.log_once(`a chrome hints cleanup step failed: ${error}`);
        }
      }
      if (tell) send("chrome_hints.end", { session: ended.tag });
    }

    function push_key(key) {
      session.seq++;
      send("chrome_hints.key", { session: session.tag, seq: session.seq, key });
    }

    // While a session runs, each letter and hint key in its window is the session's. Escape ends it here, so it works with no answer from the extension.
    function on_key(event) {
      if (!session || !event.isTrusted || event.isComposing || MODIFIER_KEYS.has(event.key)) return;
      if (!core.may_act(session.win)) return end_session(false);
      if (event.ctrlKey || event.altKey || event.metaKey) return end_session(true);
      // A key that is no letter and no hint key (an arrow, F5) goes on to the page as if no labels showed.
      const key = [...event.key].length === 1 || NAMED_KEYS.has(event.key) ? event.key : undefined;
      if (key === undefined && event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") return end_session(true);
      if (session.drawn_gen === 0) {
        if (session.early_keys.length < MAX_EARLY_KEYS) session.early_keys.push(key);
      } else push_key(key);
    }

    function listen(target, type, handler, capture = true) {
      target.addEventListener(type, handler, capture);
      session.undo.push(() => target.removeEventListener(type, handler, capture));
    }

    function start_session(tag, win, found, style_url, theme, panel) {
      end_session(true);
      session = { tag, win, targets: new Map(), layers: {}, undo: [], seq: 0, drawn_gen: 0, pending: undefined, early_keys: [] };
      core.hold_keys(win, KEY_OWNER);
      session.undo.push(() => core.release_keys(win, KEY_OWNER));
      try {
        add_session_parts(win, found, style_url, theme, panel);
      } catch (error) {
        // A half-built session has no timer or listeners to end it, so it would swallow the window's letters until Escape.
        end_session(false);
        throw error;
      }
    }

    function add_session_parts(win, found, style_url, theme, panel) {
      const doc = win.document;
      for (const target of found) session.targets.set(next_target_id++, { ...target, kind: kind_of(target.element) });
      const window_layer = make_layer(doc, style_url, theme, true);
      doc.documentElement.append(window_layer.host);
      session.layers.window = window_layer;
      session.undo.push(() => window_layer.host.remove());
      if (panel) {
        const panel_layer = make_layer(doc, style_url, theme, false);
        panel.view.prepend(panel_layer.host);
        session.layers.panel = panel_layer;
        session.undo.push(() => panel_layer.host.remove());
        listen(panel.panel, "popuphidden", (event) => event.target === panel.panel && end_session(true), false);
      }
      const end_told = () => end_session(true);
      listen(win, "mousedown", end_told);
      listen(win, "deactivate", end_told);
      listen(win, "resize", end_told);
      listen(win, "unload", end_told);
      const timer = win.setTimeout(() => session?.drawn_gen === 0 && end_session(true), FIRST_DRAW_MS);
      session.undo.push(() => win.clearTimeout(timer));
    }

    // Parts of at most PART_BYTES, each a list of [id, left, top, width, height] in CSS pixels of the window.
    function target_parts() {
      const parts = [[]];
      for (const [id, target] of session.targets) {
        const row = [id, Math.round(target.box.left), Math.round(target.box.top), Math.round(target.box.width), Math.round(target.box.height)];
        const last = parts.at(-1);
        if (last.length > 0 && json_bytes([...last, row]) > PART_BYTES) parts.push([row]);
        else last.push(row);
      }
      return parts;
    }

    function collect({ session: tag, window_id, colors }) {
      if (!enabled_by_pref()) return { ok: false, error: "The browser module is off" };
      const { win, problem } = window_for(window_id);
      if (!win) return { ok: false, error: problem };
      const doc = win.document;
      if (menu_open(doc)) return { ok: false, error: "Close the menu first" };
      if (field_focused(win)) return { ok: false, error: "Leave the field first" };
      const extension = ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
      const opened = open_panel(doc);
      const panel = opened && panel_targets(opened.panel, opened.row);
      const found = (panel ? panel.found : window_targets(win)).slice(0, MAX_TARGETS);
      if (found.length === 0) return { ok: false, error: "Nothing to hint here" };
      start_session(tag, win, found, extension.baseURI.resolve(STYLE_FILE), theme_text(colors), panel && { panel: opened.panel, view: panel.view });
      const parts = target_parts();
      parts.forEach((rows, part) => send("chrome_hints.targets", { session: tag, part, parts: parts.length, targets: JSON.stringify(rows) }));
      return { ok: true };
    }

    // ---- Draw.

    // A label row from the extension: an id of this session and a short label of hint letters. Anything else drops the whole part.
    function label_rows(text) {
      const rows = parse_json(text);
      if (!Array.isArray(rows) || rows.length > session.targets.size) return undefined;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2 || !session.targets.has(row[0]) || typeof row[1] !== "string" || [...row[1]].length > MAX_LABEL_CHARS || !LABEL.test(row[1])) return undefined;
      }
      return rows;
    }

    function label_node(doc, text, typed_length) {
      const node = doc.createElementNS(HTML, "div");
      node.className = "desertfox-hint";
      const typed = doc.createElementNS(HTML, "b");
      typed.textContent = text.slice(0, typed_length);
      const rest = doc.createElementNS(HTML, "span");
      rest.textContent = text.slice(typed_length);
      node.append(typed, rest);
      return node;
    }

    // Replaces every label with the rows of one complete draw. Each box is read now, so a label sits where its target is at this draw, and a pick checks against that.
    function apply_draw(rows, typed_length) {
      const doc = session.win.document;
      const by_place = { window: [], panel: [] };
      const origin = session.layers.panel?.host.getBoundingClientRect();
      for (const [id, text] of rows) {
        const target = session.targets.get(id);
        target.drawn = box_of(target.element);
        const node = label_node(doc, text, typed_length);
        if (target.place === "panel") {
          node.style.position = "absolute";
          node.style.left = `${Math.round(target.drawn.left - origin.left)}px`;
          node.style.top = `${Math.round(target.drawn.top - origin.top)}px`;
        } else {
          node.style.left = `${Math.max(0, Math.round(target.drawn.left))}px`;
          node.style.top = `${Math.max(0, Math.round(target.drawn.top))}px`;
        }
        by_place[target.place].push(node);
      }
      session.layers.window.box.replaceChildren(...by_place.window);
      session.layers.panel?.box.replaceChildren(...by_place.panel);
    }

    // A draw comes in parts, and only a whole draw shows: a part that never comes leaves the labels before it, and the next draw replaces them. A part of an older draw is dropped.
    function draw({ session: tag, gen, part, parts, typed, labels }) {
      if (!session || session.tag !== tag) return { ok: true };
      if (!Number.isInteger(gen) || gen <= session.drawn_gen || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS || !Number.isInteger(part) || part < 0 || part >= parts) return { ok: true };
      if (typeof typed !== "string" || [...typed].length > MAX_LABEL_CHARS) return { ok: true };
      const rows = label_rows(labels);
      if (!rows) return { ok: true };
      if (session.pending?.gen !== gen) {
        if (session.pending && session.pending.gen > gen) return { ok: true };
        session.pending = { gen, parts, typed, got: new Map() };
      }
      const pending = session.pending;
      if (pending.parts !== parts || pending.typed !== typed) return { ok: true };
      pending.got.set(part, rows);
      if (pending.got.size < parts) return { ok: true };
      session.pending = undefined;
      const rows_drawn = [...pending.got.keys()].sort((a, b) => a - b).flatMap((index) => pending.got.get(index));
      // The extension never narrows to nothing, so a draw with no labels would only hold the keys with nothing shown.
      if (rows_drawn.length === 0) {
        end_session(true);
        return { ok: true };
      }
      const first = session.drawn_gen === 0;
      session.drawn_gen = gen;
      apply_draw(rows_drawn, [...typed].length);
      if (first) for (const key of session.early_keys.splice(0)) push_key(key);
      return { ok: true };
    }

    // ---- Pick.

    function pick({ session: tag, id }) {
      if (!session || session.tag !== tag) return { ok: false, error: "The hints have ended" };
      const target = session.targets.get(id);
      if (!target?.drawn) return { ok: false, error: "No such hint" };
      const { element, kind, drawn } = target;
      const win = session.win;
      end_session(false);
      if (win.closed || !element.isConnected || !usable(element)) return { ok: false, error: "The hint's target is gone" };
      const now = box_of(element);
      if (Math.abs(now.left - drawn.left) > MOVED_PX || Math.abs(now.top - drawn.top) > MOVED_PX) return { ok: false, error: "The hint's target moved" };
      const tabs = win.gBrowser ?? win.wrappedJSObject?.gBrowser;
      if (kind === "tab" && tabs) tabs.selectedTab = element;
      else if (kind === "menu") element.open = true;
      // A click on a button with a stale `disabled` does nothing, so a button that runs a <command> runs it.
      else if (command_of(element)) element.doCommand();
      else element.click();
      return { ok: true };
    }

    function clear({ session: tag }) {
      if (session?.tag === tag) end_session(false);
      return { ok: true };
    }

    // ---- The key listener of each browser window.
    // It sits on the window root, which hears a key before the window does, so the core's keys never see a session's letters.
    // The popup walk listens on the window root too, sometimes first. A session holds the window's keys in the core, so the walk's j and k leave them alone in an open app menu. With no session in the window it does nothing.
    const watched = new Map();
    const loading = new Map();

    function watch(win) {
      if (watched.has(win) || win.document?.documentElement?.getAttribute("windowtype") !== "navigator:browser") return;
      const root = win.windowRoot;
      const keydown = (event) => {
        try {
          if (session?.win === win) on_key(event);
        } catch (error) {
          core.log_once(`a key was left alone after an error in chrome hints: ${error}`);
        }
      };
      const unload = () => unwatch(win);
      root.addEventListener("keydown", keydown, true);
      win.addEventListener("unload", unload, { once: true });
      watched.set(win, () => {
        root.removeEventListener("keydown", keydown, true);
        win.removeEventListener("unload", unload);
      });
    }

    function unwatch(win) {
      watched.get(win)?.();
      watched.delete(win);
    }

    // A window's type is known only once its document has loaded. A window just opened shows a finished about:blank first.
    function watch_when_loaded(win) {
      if (watched.has(win) || loading.has(win)) return;
      if (win.document?.readyState === "complete" && win.location?.href !== "about:blank") return watch(win);
      const on_load = () => {
        loading.delete(win);
        watch(win);
      };
      win.addEventListener("load", on_load, { once: true });
      loading.set(win, () => win.removeEventListener("load", on_load));
    }

    const window_watcher = {
      observe(subject, topic) {
        try {
          if (topic === "domwindowopened") watch_when_loaded(subject);
          else if (topic === "domwindowclosed") {
            loading.get(subject)?.();
            loading.delete(subject);
          }
        } catch (error) {
          core.log_once(`chrome hints skipped a window after an error: ${error}`);
        }
      },
    };

    // The pref off ends a session at once, so no layer or listener outlives the module.
    const on_pref = () => {
      if (!enabled_by_pref()) end_session(false);
    };

    function stop_all() {
      end_session(false);
      Services.prefs.removeObserver(ENABLED_PREF, on_pref);
      try {
        Services.ww.unregisterNotification(window_watcher);
      } catch (_) {
        // It was never registered: the start failed before it.
      }
      for (const win of [...watched.keys()]) unwatch(win);
      for (const undo_load of loading.values()) undo_load();
      loading.clear();
    }

    try {
      core.on_shut_down(stop_all);
      Services.prefs.addObserver(ENABLED_PREF, on_pref);
      Services.ww.registerNotification(window_watcher);
      for (const win of Services.wm.getEnumerator("navigator:browser")) watch_when_loaded(win);
    } catch (error) {
      stop_all();
      throw error;
    }

    core.register_kind("chrome_hints.collect", collect);
    core.register_kind("chrome_hints.draw", draw);
    core.register_kind("chrome_hints.pick", pick);
    core.register_kind("chrome_hints.clear", clear);
  }
})(this);
