// DesertFox browser module, hints over Firefox's own UI: the nav bar, the tab strip, the bookmarks toolbar, the sidebar buttons, the menu bar, the rows of an open app menu,
// and the controls of a tab's prompt, a settings sub-dialog, the Library and Page Info.
// The module collects the targets and sends only ids and boxes. The extension makes the labels, narrows them as the user types and names the target to pick. The module draws what it is told and runs one fixed action per target kind.
// Requests: chrome_hints.collect starts a session, chrome_hints.collect_here starts one where the user typed the binding, chrome_hints.draw shows labels, chrome_hints.pick runs a target, chrome_hints.clear ends it.
// Pushes and calls back: chrome_hints.targets, chrome_hints.key, chrome_hints.end and chrome_hints.want.
//
// With the focus in chrome no content script hears a key, so this file takes the `hint.browser` bindings the extension lists in the state itself, and asks the extension to start.
// It makes a token for each such key: used once, within START_TOKEN_MS, and only in the window where the key was typed. No other start opens a session outside a browser window in front.

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
    // Holds the window's keys while the first keys of a binding wait for the rest, so the popup walk leaves the next key alone.
    const PREFIX_OWNER = "chrome_hints.prefix";
    // A start token lives this long. Its key holds the window's keys meanwhile, as a session does.
    const START_TOKEN_MS = 3000;
    const ESCAPE = "<Escape>";
    const BROWSER = "navigator:browser";
    const LIBRARY = "Places:Organizer";
    const PAGE_INFO = "Browser:page-info";
    const WATCHED_TYPES = new Set([BROWSER, LIBRARY, PAGE_INFO]);
    // The controls of a dialog, the Library and Page Info. No text field is one: a label never types into a field.
    const CONTROLS = "button, toolbarbutton, checkbox, radio, menulist:not([editable]), menu, label.text-link, moz-button, moz-checkbox, moz-toggle, moz-radio, input[type=checkbox], input[type=radio], input[type=button], input[type=submit]";
    // Left to a later confirm key, as the permission prompts are: the Library's download rows can unblock a download, and Page Info's permission rows grant a permission at once.
    const LEFT_OUT = "#downloadsListBox, #permList";
    // The dialogs in a `dialogFrame` that get labels. Others are left out until a confirm key exists: the external protocol prompt opens an application with a URL the page chose, and the client certificate prompt sends the user's certificate to the site.
    const LABELLED_DIALOG = (url) => url === "chrome://global/content/commonDialog.xhtml" || url.startsWith("chrome://browser/content/preferences/dialogs/");

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

    // A dialog's buttons sit in its closed shadow root, which chrome code may open.
    const shadow_of = (element) => element?.openOrClosedShadowRoot ?? element?.shadowRoot ?? null;
    const box_of = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const big_enough = (box) => box.width >= MIN_SIDE_PX && box.height >= MIN_SIDE_PX;
    const within = (box, area) => box.left + box.width / 2 >= area.left && box.left + box.width / 2 <= area.left + area.width && box.top + box.height / 2 >= area.top && box.top + box.height / 2 <= area.top + area.height;

    // A tab scrolled out of the strip, or a button under another, is not what the user sees at its box. The hit test goes down through each shadow root and back up through each host.
    function shows_at_its_box(doc, element, box) {
      let hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      while (shadow_of(hit)) {
        const deeper = shadow_of(hit).elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (!deeper || deeper === hit) break;
        hit = deeper;
      }
      for (let node = hit; node; node = node.parentNode ?? node.host) if (node === element) return true;
      return false;
    }

    // The fixed action of each target: a tab is selected, a menu, a drop-down or a bookmarks folder opens, a button runs its command or is clicked.
    function kind_of(element) {
      if (element.localName === "tab") return "tab";
      if (element.localName === "menu" || element.localName === "menulist" || (element.localName === "toolbarbutton" && element.getAttribute("type") === "menu")) return "menu";
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

    // The elements under `root` that match, in its shadow roots too.
    function deep_all(root, selector) {
      const found = [...root.querySelectorAll(selector)];
      for (const element of root.querySelectorAll("*")) {
        const shadow = shadow_of(element);
        // A control that matched holds its own button or input in its shadow root, which would get a second label.
        if (shadow && !element.matches(selector)) found.push(...deep_all(shadow, selector));
      }
      return found;
    }

    // An element's box in its window's own pixels. A dialog's document sits in frames of the window, so each frame's place adds up.
    function window_box(win, element) {
      const box = box_of(element);
      let doc = element.ownerDocument;
      while (doc && doc !== win.document) {
        const frame = doc.defaultView?.browsingContext?.embedderElement;
        if (!frame) break;
        const outer = frame.getBoundingClientRect();
        box.left += outer.left + (frame.clientLeft ?? 0);
        box.top += outer.top + (frame.clientTop ?? 0);
        doc = frame.ownerDocument;
      }
      return box;
    }

    // The controls of a dialog's document or of the Library or Page Info, labelled in the window's own layer.
    function control_targets(win, doc) {
      const view = { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
      const found = [];
      const seen = new Set();
      for (const element of deep_all(doc, CONTROLS)) {
        if (seen.has(element) || element.closest?.(LEFT_OUT) || !usable(element)) continue;
        seen.add(element);
        const inner = box_of(element);
        if (!big_enough(inner) || !shows_at_its_box(element.ownerDocument, element, inner)) continue;
        const box = window_box(win, element);
        if (within(box, view)) found.push({ element, box, place: "window" });
      }
      return found;
    }

    const window_type = (win) => win.document?.documentElement?.getAttribute("windowtype") ?? "";

    // Where the focus sits in chrome, when it is a place this file labels: a tab's prompt or a settings sub-dialog (both a `dialogFrame`), an open panel this file labels, or the Library or Page Info.
    // Undefined with the focus in a page, whose content script takes the keys, or anywhere else.
    function chrome_place(win) {
      const type = window_type(win);
      if (type === LIBRARY || type === PAGE_INFO) return { doc: win.document };
      if (type !== BROWSER) return undefined;
      const focused = core.focused_element(win);
      const doc = focused?.ownerDocument;
      if (!doc) return undefined;
      if (doc !== win.document && doc.defaultView?.browsingContext?.embedderElement?.classList?.contains("dialogFrame")) return LABELLED_DIALOG(String(doc.documentURI)) ? { doc, frame_win: doc.defaultView } : undefined;
      const opened = open_panel(win.document);
      if (opened?.panel.contains(focused)) return { opened };
      return undefined;
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

    const ENDS = Symbol("ends");

    // A key while labels hold the window: ENDS for Escape or a key with Ctrl, Alt or Meta, the key to hand on, or undefined to leave it alone.
    // A key that is no letter and no hint key (an arrow, F5) goes on as if no labels showed.
    function held_key(event) {
      if (event.ctrlKey || event.altKey || event.metaKey) return ENDS;
      const key = [...event.key].length === 1 || NAMED_KEYS.has(event.key) ? event.key : undefined;
      if (key === undefined && event.key !== "Escape") return undefined;
      event.preventDefault();
      event.stopImmediatePropagation();
      return event.key === "Escape" ? ENDS : key;
    }

    // While a session runs, each letter and hint key in its window is the session's. Escape ends it here, so it works with no answer from the extension.
    function on_key(event) {
      if (!session || !event.isTrusted || event.isComposing || MODIFIER_KEYS.has(event.key)) return;
      if (!core.may_act(session.win)) return end_session(false);
      const key = held_key(event);
      if (key === ENDS) return end_session(true);
      if (key === undefined) return;
      if (session.drawn_gen === 0) {
        if (session.early_keys.length < MAX_EARLY_KEYS) session.early_keys.push(key);
      } else push_key(key);
    }

    // ---- A start from chrome focus.

    // The one matcher of the `hint.browser` bindings: `bindings` are their key token lists from the state, `held` the tokens typed so far.
    // Returns whether to take the key, the tokens to hold next, and `done` once a whole binding is typed. A key that goes on no binding is tried alone, and Escape drops held keys.
    function match_binding(bindings, held, event) {
      const token = core.token_of(event);
      if (token === null) return { take: false, held };
      if (held.length > 0 && token === ESCAPE) return { take: true, held: [] };
      const step = (keys) => {
        const going = bindings.filter((binding) => keys.length <= binding.length && keys.every((key, index) => binding[index] === key));
        if (going.some((binding) => binding.length === keys.length)) return { take: true, held: [], done: true };
        return going.length > 0 ? { take: true, held: keys } : undefined;
      };
      return step([...held, token]) ?? (held.length > 0 ? step([token]) : undefined) ?? { take: false, held: [] };
    }

    // The start the user's key asked for, while the extension answers: its token, its window and the keys typed meanwhile.
    let starting = null;

    function end_start() {
      const ended = starting;
      if (!ended) return;
      starting = null;
      for (const stop of ended.undo.splice(0)) {
        try {
          stop();
        } catch (error) {
          core.log_once(`a chrome hints cleanup step failed: ${error}`);
        }
      }
    }

    // The window's keys are held from the binding's last key on, so the labels' letters never reach the popup walk or the dialog.
    // `frame_win`: the dialog the binding was typed in, whose clicks stay in its own document.
    function begin_start(win, frame_win) {
      end_start();
      starting = { win, token: 1 + Math.floor(Math.random() * 0x7ffffffe), made_at: Date.now(), early_keys: [], undo: [] };
      core.hold_keys(win, KEY_OWNER);
      starting.undo.push(() => core.release_keys(win, KEY_OWNER));
      for (const type of ["mousedown", "deactivate", "unload"]) listen(starting, win, type, end_start);
      if (frame_win) for (const type of ["mousedown", "unload"]) listen(starting, frame_win, type, end_start);
      const timer = win.setTimeout(end_start, START_TOKEN_MS);
      starting.undo.push(() => win.clearTimeout(timer));
      if (!send("chrome_hints.want", { start: starting.token })) end_start();
    }

    function on_start_key(event) {
      if (!event.isTrusted || event.isComposing || MODIFIER_KEYS.has(event.key)) return;
      if (!core.may_act(starting.win)) return end_start();
      const key = held_key(event);
      if (key === ENDS) return end_start();
      if (key !== undefined && starting.early_keys.length < MAX_EARLY_KEYS) starting.early_keys.push(key);
    }

    // A key in a window with no session or start of its own: one of a `hint.browser` binding, with the focus in a place this file labels and not in a field.
    function on_free_key(win, record, event) {
      if (!event.isTrusted || event.defaultPrevented || event.isComposing || event.keyCode === 229 || MODIFIER_KEYS.has(event.key)) return;
      const holder = core.keys_held_by(win);
      const bindings = core.chrome_hint_keys(win);
      // The menu test reads every menu of the window, so it goes last: most keys are typed in a page, which `chrome_place` turns away cheaply.
      const place = (holder === undefined || holder === PREFIX_OWNER) && bindings.length > 0 ? chrome_place(win) : undefined;
      const free = place && !field_focused(win) && !menu_open(win.document);
      const step = free ? match_binding(bindings, record.held, event) : { take: false, held: [] };
      record.held = step.held;
      if (step.held.length > 0) core.hold_keys(win, PREFIX_OWNER);
      else core.release_keys(win, PREFIX_OWNER);
      if (!step.take) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (step.done) begin_start(win, place.frame_win);
    }

    function listen(owner, target, type, handler, capture = true) {
      target.addEventListener(type, handler, capture);
      owner.undo.push(() => target.removeEventListener(type, handler, capture));
    }

    // `frame_win`: the window of the dialog the targets are in, whose close ends the session.
    function start_session(tag, win, found, style_url, theme, { panel, frame_win, early_keys = [] } = {}) {
      // A start's end releases the same hold a session takes, so it ends first.
      end_start();
      end_session(true);
      session = { tag, win, targets: new Map(), layers: {}, undo: [], seq: 0, drawn_gen: 0, pending: undefined, early_keys };
      core.hold_keys(win, KEY_OWNER);
      session.undo.push(() => core.release_keys(win, KEY_OWNER));
      try {
        add_session_parts(win, found, style_url, theme, panel, frame_win);
      } catch (error) {
        // A half-built session has no timer or listeners to end it, so it would swallow the window's letters until Escape.
        end_session(false);
        throw error;
      }
    }

    function add_session_parts(win, found, style_url, theme, panel, frame_win) {
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
        listen(session, panel.panel, "popuphidden", (event) => event.target === panel.panel && end_session(true), false);
      }
      const end_told = () => end_session(true);
      if (frame_win) {
        // A page can close its prompt at any time, and a click in the dialog lands in its own document. Another tab shows none of the dialog the labels mark.
        listen(session, frame_win, "unload", end_told);
        listen(session, frame_win, "mousedown", end_told);
        listen(session, win, "TabSelect", end_told);
      }
      listen(session, win, "mousedown", end_told);
      listen(session, win, "deactivate", end_told);
      listen(session, win, "resize", end_told);
      listen(session, win, "unload", end_told);
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

    // The checks every start makes of its window, after the window itself.
    function start_problem(win) {
      if (menu_open(win.document)) return "Close the menu first";
      if (field_focused(win)) return "Leave the field first";
      return undefined;
    }

    function open_session(tag, win, found, colors, places) {
      if (found.length === 0) return { ok: false, error: "Nothing to hint here" };
      const extension = ExtensionParent.GlobalManager.getExtension(EXTENSION_ID);
      start_session(tag, win, found.slice(0, MAX_TARGETS), extension.baseURI.resolve(STYLE_FILE), theme_text(colors), places);
      const parts = target_parts();
      parts.forEach((rows, part) => send("chrome_hints.targets", { session: tag, part, parts: parts.length, targets: JSON.stringify(rows) }));
      return { ok: true };
    }

    const panel_place = (opened) => {
      const { view, found } = panel_targets(opened.panel, opened.row);
      return { found, places: { panel: { panel: opened.panel, view } } };
    };

    function collect({ session: tag, window_id, colors }) {
      if (!enabled_by_pref()) return { ok: false, error: "The browser module is off" };
      const { win, problem } = window_for(window_id);
      if (!win) return { ok: false, error: problem };
      const refused = start_problem(win);
      if (refused) return { ok: false, error: refused };
      const opened = open_panel(win.document);
      const { found, places } = opened ? panel_place(opened) : { found: window_targets(win), places: {} };
      return open_session(tag, win, found, colors, places);
    }

    // A start the user's key asked for in chrome. The token is spent here whatever the answer, so a second request with it finds nothing.
    function collect_here({ session: tag, start, colors }) {
      const asked = starting;
      if (!asked || asked.token !== start) return { ok: false, error: "The hint key is stale" };
      end_start();
      if (!enabled_by_pref()) return { ok: false, error: "The browser module is off" };
      if (Date.now() - asked.made_at > START_TOKEN_MS) return { ok: false, error: "The hint key is stale" };
      const win = asked.win;
      if (win.closed) return { ok: false, error: "The window is gone" };
      if (Services.focus.activeWindow !== win) return { ok: false, error: "The window is not in front" };
      if (!core.may_act(win)) return { ok: false, error: "DesertFox cannot run in this window" };
      const refused = start_problem(win);
      if (refused) return { ok: false, error: refused };
      const place = chrome_place(win);
      if (!place) return { ok: false, error: "Nothing to hint here" };
      if (place.opened) {
        const { found, places } = panel_place(place.opened);
        return open_session(tag, win, found, colors, { ...places, early_keys: asked.early_keys });
      }
      return open_session(tag, win, control_targets(win, place.doc), colors, { frame_win: place.frame_win, early_keys: asked.early_keys });
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
        target.drawn = window_box(session.win, target.element);
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
      const now = window_box(win, element);
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

    // ---- The key listener of each browser window, Library and Page Info.
    // It sits on the window root, which hears a key before the window does, so the core's keys never see a session's letters.
    // The popup walk listens on the window root too, sometimes first. A session, a start and a binding's first keys hold the window's keys in the core, so the walk's j and k leave them alone.
    const watched = new Map();
    const loading = new Map();

    function watch(win) {
      if (watched.has(win) || !WATCHED_TYPES.has(window_type(win))) return;
      const root = win.windowRoot;
      const record = { held: [] };
      const keydown = (event) => {
        try {
          if (session?.win === win) on_key(event);
          else if (starting?.win === win) on_start_key(event);
          else on_free_key(win, record, event);
        } catch (error) {
          core.log_once(`a key was left alone after an error in chrome hints: ${error}`);
        }
      };
      const unload = () => unwatch(win);
      // Half a binding does not wait while the user is in another window: the walk would leave this window's keys alone meanwhile.
      const deactivate = () => {
        record.held = [];
        core.release_keys(win, PREFIX_OWNER);
      };
      root.addEventListener("keydown", keydown, true);
      win.addEventListener("deactivate", deactivate);
      win.addEventListener("unload", unload, { once: true });
      watched.set(win, () => {
        root.removeEventListener("keydown", keydown, true);
        win.removeEventListener("deactivate", deactivate);
        win.removeEventListener("unload", unload);
        deactivate();
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
      if (enabled_by_pref()) return;
      end_start();
      end_session(false);
    };

    function stop_all() {
      end_start();
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
      for (const win of Services.wm.getEnumerator(null)) watch_when_loaded(win);
    } catch (error) {
      stop_all();
      throw error;
    }

    core.register_kind("chrome_hints.collect", collect);
    core.register_kind("chrome_hints.collect_here", collect_here);
    core.register_kind("chrome_hints.draw", draw);
    core.register_kind("chrome_hints.pick", pick);
    core.register_kind("chrome_hints.clear", clear);
  }
})(this);
