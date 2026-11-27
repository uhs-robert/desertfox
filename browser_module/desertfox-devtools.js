// DesertFox browser module, the DevTools feature: tree keys, hints and visual mode in docked DevTools and in DevTools windows. See docs/design/browser_module.md.
// The extension pushes the key table (`devtools.keys`), a one-character key and a fixed action per row. Each tree action becomes an arrow key on the focused DevTools element, so a DevTools tree (the Inspector markup, the Debugger sources, Storage, Network rows) moves, expands and collapses as its own arrows make it.
// The `hints.start` action asks the extension for hints (`devtools_hints.ask`). The hints work as chrome hints do: this file collects targets from a fixed table and sends only ids and boxes, the extension makes the labels and names the pick, and this file draws them and runs one fixed action per target.
// The `visual.start` action starts visual mode in the focused text area. Its keys come in a second table (`devtools.visual_keys`), each a fixed op that moves the end of the selection or copies it. The copy stays in this process.
// No DesertFox page code runs in DevTools: every DevTools document has the system principal, so code there runs as the browser. This file reads no DevTools internals either, only the focused element and the elements of its fixed table.
// The core decides that the focus is in DevTools and that the module may act. This file passes a key it has no row for, a key with a modifier, a key typed in an editable field (the console input, the markup view's inline editors) and a key for a frame of another process, so DevTools keeps those.

(function desertfox_browser_module_devtools(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the DevTools feature failed to load: ${error}`);
    }
    return;
  }
  if (typeof core.register_kind !== "function" || typeof core.claim_devtools_keys !== "function" || typeof core.on_hello !== "function") {
    core.log_once("the core cannot hand DevTools keys to a feature, so the DevTools feature stays off");
    return;
  }
  const ENABLED_PREF = "desertfox.browser_module.enabled";
  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);
  // In the sandbox an error goes on to the core's `adopt`, which turns the module off for the session.
  define(core);

  function enabled_by_pref() {
    try {
      return Services.prefs.getBoolPref(ENABLED_PREF, false);
    } catch (_) {
      return false;
    }
  }
  function undo_all(owner) {
    for (const stop of owner.undo.splice(0)) {
      try {
        stop();
      } catch (error) {
        core.log_once(`a DevTools cleanup step failed: ${error}`);
      }
    }
  }
  function listen(owner, target, type, handler) {
    target.addEventListener(type, handler, true);
    owner.undo.push(() => target.removeEventListener(type, handler, true));
  }
  // The popup walk and the sidebar leave a held window's keys alone, so a DevTools context menu cannot take the hints' or the mode's letters. False while another feature holds the window.
  function hold(owner, win, key_owner) {
    if (!core.hold_keys(win, key_owner)) return false;
    owner.undo.push(() => core.release_keys(win, key_owner));
    return true;
  }

  function define(core) {
    const ARROWS = {
      "tree.down": { key: "ArrowDown", keyCode: 40 },
      "tree.up": { key: "ArrowUp", keyCode: 38 },
      "tree.collapse": { key: "ArrowLeft", keyCode: 37 },
      "tree.expand": { key: "ArrowRight", keyCode: 39 },
    };
    const HINTS_START = "hints.start";
    const VISUAL_START = "visual.start";
    const MODULE_STATE_KEY = "desertfox_browser_module_state";
    // Empty until the extension pushes a table, so a module with an older extension takes no key in DevTools.
    let actions = new Map();
    const in_editable = (node) =>
      !!node?.localName && (node.isContentEditable || node.localName === "input" || node.localName === "textarea" || node.localName === "select" || !!node.closest?.(".CodeMirror, .cm-editor"));
    // A key in a frame of another process, such as an extension's DevTools panel, targets the frame element, so the field it types into is out of sight.
    const is_frame = (node) => node?.localName === "iframe" || node?.localName === "browser";
    const hints = define_hints(core);
    const visual = define_visual(core, in_editable);
    // A reloaded or older DesertFox gets a new hello. The tables, the hints and the mode of the one before go, so only a DesertFox that pushes its own table gets these keys.
    core.on_hello(() => {
      actions = new Map();
      hints.end();
      visual.forget();
    });
    // The pref has its own observer in each feature. The consent setting and the toolbar switch reach the module only through the state, and then no key comes to end the hints or the mode.
    core.watch_session([MODULE_STATE_KEY], (_key, state) => {
      if (state?.enabled === true) return;
      hints.end();
      visual.end();
    });

    // The core checked the rows against the protocol. A push may come twice, and the newest table wins.
    core.register_kind("devtools.keys", ({ keys }) => {
      actions = new Map(keys.filter(({ action }) => Object.hasOwn(ARROWS, action) || action === HINTS_START || action === VISUAL_START).map(({ key, action }) => [key, action]));
      return { ok: true };
    });

    core.claim_devtools_keys(({ window: win, event, token }) => {
      const taken_by_hints = hints.answer_key(win, event);
      if (taken_by_hints !== undefined) return taken_by_hints;
      const taken_by_visual = visual.answer_key(win, event, token);
      if (taken_by_visual !== undefined) return taken_by_visual;
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      const action = actions.get(token);
      if (!action) return false;
      const target = event.originalTarget ?? event.target;
      // Before the field check: a code area of the mode's own table is an editor that DevTools keeps read-only. The mode refuses every other field.
      if (action === VISUAL_START) return visual.start(win, target);
      if (in_editable(target) || is_frame(target)) return false;
      if (action === HINTS_START) return hints.ask(win);
      // Chrome code makes this arrow, so Gecko marks it trusted, and it reaches the core's listener again. No row takes an arrow there, so it moves the tree once.
      const { key, keyCode } = ARROWS[action];
      const view = target.ownerDocument.defaultView;
      target.dispatchEvent(new view.KeyboardEvent("keydown", { key, code: key, keyCode, bubbles: true, cancelable: true, composed: true, repeat: event.repeat }));
      return true;
    });
  }

  // ---- Hints over DevTools.
  // The key flow: the hint key sends an ask with a fresh token, the extension answers with a collect that hands the token back, and this file starts a session.
  // From the hint key until the first labels show, every letter in that window is dropped, so a fast `fh` never hides a node in the markup view.
  // The label checks, the assembly of a draw and the layer are chrome hints' own (`core.hint_drawing`). This file holds its own session, targets and picks.
  function define_hints(core) {
    const HOST_CLASS = "desertfox-devtools-hints";
    const KEY_OWNER = "devtools_hints";
    const STALE_ASK = "The hint key is stale";
    // An ask and a session's first labels each have this long, or the window's letters go back to DevTools.
    const ASK_MS = 2000;
    const FIRST_DRAW_MS = 2000;
    const MIN_SIDE_PX = 4;
    // A target narrower than this is an icon button: its label sits at its middle, so the labels of a row of them keep apart.
    const ICON_PX = 40;
    const MAX_FRAME_DEPTH = 3;
    const NAMED_KEYS = new Set(["Backspace", "Enter", "Tab"]);
    // DevTools rows are dense, so the labels drop most of their padding. A fixed rule of this file, never from a message.
    const COMPACT_LABELS = ".desertfox-hint { padding: 0 2px; }";
    const TOOLBOX_URL = "about:devtools-toolbox";
    const DEVTOOLS_URL = "chrome://devtools/";
    // What gets a label in each DevTools document, by its address, and the fixed action of each row: `click`, `focus` (a field or an area), or `press` (a mouse press, for the markup view, which selects on mousedown).
    // An `area` row labels a whole pane at its middle, to move the focus there. A `before` row's label sits left of the target, in the markup view's indent, so it hides no tag name.
    // Class names change between Firefox releases, and a row that finds nothing is skipped.
    const FIELDS = { take: "input:not([type=checkbox]):not([type=radio]), select, textarea", pick: "focus" };
    const DOCUMENT_TARGETS = [
      // A tool tab selects on mousedown.
      { url: TOOLBOX_URL, rows: [{ take: ".devtools-tab", pick: "press" }, { take: "#toolbox-buttons-start button, #toolbox-buttons-end button, #tools-chevron-menu-button", pick: "click" }] },
      {
        url: "chrome://devtools/content/inspector/index.xhtml",
        rows: [{ take: "[role=tab]", pick: "click" }, { take: ".devtools-button", pick: "click" }, { take: "#inspector-searchbox", pick: "focus" }, { take: "#ruleview-container", pick: "focus", area: true }],
      },
      { url: "chrome://devtools/content/inspector/markup/markup.html", rows: [{ take: ".tag-line", pick: "press", before: true }, { take: "#root", pick: "focus", area: true }] },
      {
        url: "chrome://devtools/content/webconsole/index.html",
        rows: [{ take: ".devtools-togglebutton, .devtools-button", pick: "click" }, { take: ".jsterm-input-container", pick: "focus" }, { take: ".webconsole-output", pick: "focus", area: true }],
      },
      {
        url: "chrome://devtools/content/debugger/index.html",
        rows: [{ take: ".tree-node, .source-tab, .command-bar button, .accordion ._header", pick: "click" }, { take: ".editor-mount", pick: "focus", area: true }],
      },
      { url: "chrome://devtools/content/netmonitor/index.html", rows: [{ take: ".request-list-item, .devtools-button, [role=tab]", pick: "click" }, FIELDS] },
      { url: "chrome://devtools/content/storage/index.xhtml", rows: [{ take: ".tree-widget-item, .table-widget-column:first-child .table-widget-cell, .devtools-button", pick: "click" }, FIELDS] },
    ];
    const OTHER_PANEL_ROWS = [{ take: "button, [role=button], [role=tab], [role=treeitem]", pick: "click" }, FIELDS];
    // Where `focus` lands inside an area or a field's wrapper that takes no focus itself.
    const FOCUSABLE = "[tabindex], [contenteditable=true], input, textarea, select, button";

    const send = (kind, args) => {
      const sent = core.send(kind, args);
      if (!sent.ok) core.log_once(`${kind} was not sent: ${sent.problem}`);
      return sent.ok;
    };
    const fresh_token = () => 1 + Math.floor(Math.random() * 0x7ffffffe);

    // Target ids count up for the life of the process, so an id from an older session never names a target of a newer one.
    let next_target_id = 1;
    let asking = null;
    let session = null;

    // ---- The ask.

    function end_ask() {
      const ended = asking;
      if (!ended) return;
      asking = null;
      undo_all(ended);
    }

    function ask(win) {
      end_ask();
      end_session(true);
      asking = { win, ask: fresh_token(), made_at: Date.now(), undo: [] };
      if (!hold(asking, win, KEY_OWNER)) {
        asking = null;
        return false;
      }
      for (const type of ["mousedown", "deactivate", "unload"]) listen(asking, win, type, end_ask);
      const timer = win.setTimeout(end_ask, ASK_MS);
      asking.undo.push(() => win.clearTimeout(timer));
      if (!send("devtools_hints.ask", { ask: asking.ask })) end_ask();
      return true;
    }

    // A key in the window of an ask or a session: true to take it, false to leave it to DevTools, undefined when no hints hold the window.
    // A letter or a hint key is the session's once labels show, and dropped before. Escape ends the hints there. Any other key (a modifier chord, an arrow, F6, the context menu key) ends them and goes on,
    // because it can move the focus out of DevTools, where no key would reach this file to end them.
    function answer_key(win, event) {
      const holder = session?.win === win ? session : asking?.win === win ? asking : undefined;
      if (!holder || MODIFIER_KEYS.has(event.key)) return undefined;
      const end = () => (holder === session ? end_session(true) : end_ask());
      if (event.key === "Escape" && !(event.ctrlKey || event.altKey || event.metaKey)) {
        end();
        return true;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || ([...event.key].length !== 1 && !NAMED_KEYS.has(event.key))) {
        end();
        return false;
      }
      if (holder === session && session.drawn_gen > 0) {
        session.seq++;
        send("chrome_hints.key", { session: session.tag, seq: session.seq, key: event.key });
      }
      return true;
    }

    // ---- Collect.

    const frame_of = (doc) => doc?.defaultView?.frameElement ?? doc?.defaultView?.browsingContext?.embedderElement ?? null;
    const box_of = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const big_enough = (box) => box.width >= MIN_SIDE_PX && box.height >= MIN_SIDE_PX;
    const usable = (element) => !element.hidden && !element.disabled && element.getAttribute?.("aria-disabled") !== "true" && element.checkVisibility();
    const point_of = (box, area) => (area ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: box.left + Math.min(box.width / 2, 8), y: box.top + box.height / 2 });

    // The toolbox document above the element, for the focus in the toolbox or in one of its panels.
    function toolbox_of(element) {
      let doc = element?.ownerDocument;
      for (let depth = 0; doc && depth < 8; depth++) {
        if (String(doc.documentURI).startsWith(TOOLBOX_URL)) return doc;
        doc = frame_of(doc)?.ownerDocument;
      }
      return null;
    }

    // A label marks what shows at its point: an element under a popup, scrolled out or covered by another pane gets none.
    function shows_at(doc, element, point) {
      const view = doc.defaultView;
      if (point.x < 0 || point.y < 0 || point.x > view.innerWidth || point.y > view.innerHeight) return false;
      for (let node = doc.elementFromPoint(point.x, point.y); node; node = node.parentNode ?? node.host) if (node === element) return true;
      return false;
    }

    // The DevTools documents that show: the toolbox, then each panel frame of this process that is visible (the selected tool, the split console, the markup view inside the Inspector).
    // A frame of another process, such as an extension's panel, has no document here and is skipped.
    function shown_documents(toolbox) {
      const docs = [toolbox];
      const walk = (doc, depth) => {
        if (depth >= MAX_FRAME_DEPTH) return;
        for (const frame of doc.querySelectorAll("iframe")) {
          const inner = frame.contentDocument;
          if (!inner || !String(inner.documentURI).startsWith(DEVTOOLS_URL) || !frame.checkVisibility() || !big_enough(box_of(frame))) continue;
          docs.push(inner);
          walk(inner, depth + 1);
        }
      };
      walk(toolbox, 0);
      return docs;
    }

    // `box` is in the top window's pixels, which the extension gets only to sort the labels in reading order.
    function document_targets(doc) {
      const url = String(doc.documentURI);
      const rows = DOCUMENT_TARGETS.find((entry) => url.startsWith(entry.url))?.rows ?? OTHER_PANEL_ROWS;
      const found = [];
      const taken = [];
      for (const row of rows) {
        for (const element of doc.querySelectorAll(row.take)) {
          // One label per row: a button inside a tree row or a markup line has its row's label.
          if (taken.some((other) => other === element || other.contains(element)) || !usable(element)) continue;
          const box = box_of(element);
          if (!big_enough(box) || !shows_at(doc, element, point_of(box, row.area))) continue;
          found.push({ element, box: top_box(element, box), pick: row.pick, area: row.area === true, before: row.before === true });
          if (!row.area) taken.push(element);
        }
      }
      return found;
    }

    // A box in the CSS pixels of the top window, by the place of each frame above it. DevTools zoom is left out, which keeps the reading order.
    function top_box(element, box) {
      const out = { ...box };
      for (let frame = frame_of(element.ownerDocument); frame; frame = frame_of(frame.ownerDocument)) {
        const outer = frame.getBoundingClientRect();
        out.left += outer.left + (frame.clientLeft ?? 0);
        out.top += outer.top + (frame.clientTop ?? 0);
      }
      return out;
    }

    // A collect for an ask this file made. The token is spent here whatever the answer, so a second collect with it finds nothing.
    function collect({ session: tag, ask: token, colors }) {
      const asked = asking;
      if (!asked || asked.ask !== token) return { ok: false, error: STALE_ASK };
      end_ask();
      if (!enabled_by_pref()) return { ok: false, error: "The browser module is off" };
      if (Date.now() - asked.made_at > ASK_MS) return { ok: false, error: STALE_ASK };
      const win = asked.win;
      if (win.closed) return { ok: false, error: "The window is gone" };
      if (Services.focus.activeWindow !== win) return { ok: false, error: "The window is not in front" };
      if (!core.may_act(win)) return { ok: false, error: "DesertFox cannot run in this window" };
      const drawing = core.hint_drawing();
      if (!drawing) return { ok: false, error: "Chrome hints are not loaded" };
      const toolbox = toolbox_of(core.focused_element(win));
      if (!toolbox) return { ok: false, error: "The focus left DevTools" };
      const found = shown_documents(toolbox).flatMap(document_targets).slice(0, drawing.MAX_TARGETS);
      if (found.length === 0) return { ok: false, error: "Nothing to hint here" };
      if (!start_session(tag, win, found, colors, drawing)) return { ok: false, error: "Another feature holds the window's keys" };
      const parts = drawing.target_parts(session.targets);
      parts.forEach((rows, part) => send("chrome_hints.targets", { session: tag, part, parts: parts.length, targets: JSON.stringify(rows) }));
      return { ok: true };
    }

    // ---- The session.

    function end_session(tell) {
      const ended = session;
      if (!ended) return;
      session = null;
      undo_all(ended);
      if (tell) send("chrome_hints.end", { session: ended.tag });
    }

    function start_session(tag, win, found, colors, drawing) {
      end_session(true);
      session = { tag, win, drawing, targets: new Map(), layers: new Map(), theme: drawing.theme_text(colors) + COMPACT_LABELS, undo: [], seq: 0, drawn_gen: 0, pending: undefined };
      if (!hold(session, win, KEY_OWNER)) {
        session = null;
        return false;
      }
      for (const target of found) session.targets.set(next_target_id++, target);
      const end_told = () => end_session(true);
      for (const type of ["mousedown", "deactivate", "resize", "unload"]) listen(session, win, type, end_told);
      // A panel that reloads or closes takes its targets with it.
      for (const doc of new Set(found.map(({ element }) => element.ownerDocument))) listen(session, doc.defaultView, "pagehide", end_told);
      const timer = win.setTimeout(() => session?.drawn_gen === 0 && end_session(true), FIRST_DRAW_MS);
      session.undo.push(() => win.clearTimeout(timer));
      const { layers } = session;
      session.undo.push(() => layers.forEach((layer) => layer.host.remove()));
      return true;
    }

    // ---- Draw.

    function draw(args) {
      if (!session || session.tag !== args.session) return { ok: true };
      const rows_drawn = session.drawing.whole_draw(session, args);
      if (!rows_drawn) return { ok: true };
      if (rows_drawn.length === 0) {
        end_session(true);
        return { ok: true };
      }
      session.drawn_gen = args.gen;
      show_labels(rows_drawn, [...args.typed].length);
      return { ok: true };
    }

    // Each label goes in the layer of its target's own document, since DevTools has its own zoom. Each box is read now, and a pick checks against it.
    function show_labels(rows, typed_length) {
      const by_layer = new Map();
      for (const [id, text] of rows) {
        const target = session.targets.get(id);
        const doc = target.element.ownerDocument;
        const layer = layer_for(doc);
        target.drawn = box_of(target.element);
        const node = session.drawing.label_node(doc, text, typed_length);
        place_label(node, target);
        if (!by_layer.has(layer)) by_layer.set(layer, []);
        by_layer.get(layer).push(node);
      }
      for (const layer of session.layers.values()) layer.box.replaceChildren(...(by_layer.get(layer) ?? []));
    }

    // An area's label at its middle, a markup line's left of it, an icon button's over its middle, and any other at its top left corner.
    function place_label(node, { drawn, area, before }) {
      const middle = point_of(drawn, true);
      if (area) {
        node.style.left = `${Math.round(middle.x)}px`;
        node.style.top = `${Math.round(middle.y)}px`;
      } else if (before) {
        node.style.left = `${Math.round(drawn.left)}px`;
        node.style.top = `${Math.round(drawn.top)}px`;
        node.style.transform = "translateX(-100%)";
      } else if (drawn.width < ICON_PX) {
        node.style.left = `${Math.round(middle.x)}px`;
        node.style.top = `${Math.round(middle.y)}px`;
        node.style.transform = "translate(-50%, -50%)";
      } else {
        node.style.left = `${Math.max(0, Math.round(drawn.left))}px`;
        node.style.top = `${Math.max(0, Math.round(drawn.top))}px`;
      }
    }

    function layer_for(doc) {
      const known = session.layers.get(doc);
      if (known) return known;
      const layer = session.drawing.make_layer(doc, session.drawing.label_style_url(), session.theme, true, HOST_CLASS);
      doc.documentElement.append(layer.host);
      session.layers.set(doc, layer);
      return layer;
    }

    // ---- Pick.

    function press(element) {
      const view = element.ownerDocument.defaultView;
      const { x, y } = point_of(box_of(element), false);
      for (const type of ["mousedown", "mouseup", "click"]) {
        element.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view, button: 0, buttons: type === "mousedown" ? 1 : 0, detail: 1, clientX: x, clientY: y }));
      }
    }

    function focus(element) {
      const doc = element.ownerDocument;
      doc.defaultView.focus();
      const focusable = element.matches(FOCUSABLE) ? element : element.querySelector(FOCUSABLE);
      // An area that takes no focus, such as the console output: the field that had it lets it go, so the next keys reach the area's document and not that field.
      if (focusable) focusable.focus();
      else doc.activeElement?.blur();
    }

    function pick({ session: tag, id }) {
      if (!session) return { ok: false, error: "The hints have ended" };
      const { target, error } = session.drawing.drawn_target(session, tag, id);
      if (error) return { ok: false, error };
      const { element, pick: action, drawn } = target;
      const { drawing } = session;
      end_session(false);
      if (!element.isConnected || !usable(element)) return { ok: false, error: "The hint's target is gone" };
      if (drawing.box_moved(drawn, box_of(element))) return { ok: false, error: "The hint's target moved" };
      if (action === "press") press(element);
      else if (action === "focus") focus(element);
      else element.click();
      return { ok: true };
    }

    function clear({ session: tag }) {
      if (session?.tag === tag) end_session(false);
      return { ok: true };
    }

    const end = () => {
      end_ask();
      end_session(false);
    };
    // The pref off ends the hints at once, so no layer or listener outlives the module.
    const on_pref = () => enabled_by_pref() || end();
    Services.prefs.addObserver(ENABLED_PREF, on_pref);
    core.on_shut_down(() => {
      end();
      Services.prefs.removeObserver(ENABLED_PREF, on_pref);
    });
    core.register_kind("devtools_hints.collect", collect);
    core.register_kind("devtools_hints.draw", draw);
    core.register_kind("devtools_hints.pick", pick);
    core.register_kind("devtools_hints.clear", clear);
    // Said last, so the extension sends the hint key only to a module that can answer it.
    core.set_hello_flag("devtools_hints", true);

    return { ask, answer_key, end };
  }

  // ---- Visual mode in DevTools text areas.
  // `v` selects the character at the area's start point, and each key of the mode's table moves the end of the selection. The copy key copies the selection and ends the mode, Escape ends it, and any other one-character key does nothing.
  // A plain DOM area moves the selection with Selection.modify and keeps its end inside the area. A CodeMirror area gets Shift+arrow keys on its editor, since CodeMirror draws only the lines near the view and keeps the selection of the rest in its own state.
  function define_visual(core, in_editable) {
    const KEY_OWNER = "devtools_visual";
    // A larger copy is refused, so a held key cannot fill the clipboard with megabytes.
    const MAX_COPY_CHARS = 1_000_000;
    const OVER_COPY_CAP = `visual mode in DevTools copied nothing: the selection is over ${MAX_COPY_CHARS} characters`;
    const SHOW_ELEMENT = 1;
    const SHOW_TEXT = 4;
    const FILTER_ACCEPT = 1;
    const FILTER_REJECT = 2;
    const FILTER_SKIP = 3;
    const TEXT_NODE = 3;
    const MAX_START_NODES = 5000;
    // The areas the mode starts in, by the address of their document. The root holds the selection. Class names change between Firefox releases, and a root that finds nothing starts no mode.
    // `lines: false` where a line move goes wrong: the console draws only the messages near the view, so a line move skips the rest (measured).
    // The computed view is out: its text is user-select none, so nothing selects. The markup view is out: Selection.modify stops at the edge of each span of a tag line, so the selection never grows past the `<`.
    const TEXT_AREAS = [
      { url: "chrome://devtools/content/webconsole/index.html", root: ".webconsole-output", lines: false },
      { url: "chrome://devtools/content/inspector/index.xhtml", root: "#ruleview-container", lines: true },
      { url: "chrome://devtools/content/netmonitor/index.html", root: "#headers-panel", lines: true },
    ];
    // CodeMirror editors that DevTools shows read-only: the Debugger source and the Network response. The console input is a CodeMirror editor too, and stays out by having no row.
    const CODE_AREAS = [
      { url: "chrome://devtools/content/debugger/index.html", root: ".editor-mount" },
      { url: "chrome://devtools/content/netmonitor/index.html", root: "#response-panel" },
    ];
    const DOM_MOVES = {
      "char.back": ["backward", "character"],
      "char.forward": ["forward", "character"],
      "line.down": ["forward", "line"],
      "line.up": ["backward", "line"],
      "word.forward": ["forward", "word"],
      "word.back": ["backward", "word"],
      "line.start": ["backward", "lineboundary"],
      "line.end": ["forward", "lineboundary"],
    };
    const CODE_KEYS = {
      "char.back": { key: "ArrowLeft", keyCode: 37 },
      "char.forward": { key: "ArrowRight", keyCode: 39 },
      "line.down": { key: "ArrowDown", keyCode: 40 },
      "line.up": { key: "ArrowUp", keyCode: 38 },
      "word.forward": { key: "ArrowRight", keyCode: 39, ctrlKey: true },
      "word.back": { key: "ArrowLeft", keyCode: 37, ctrlKey: true },
      "line.start": { key: "Home", keyCode: 36 },
      "line.end": { key: "End", keyCode: 35 },
    };
    const COPY = "copy";
    const LINE_OPS = new Set(["line.down", "line.up"]);

    // Empty until the extension pushes the mode's table, so `v` starts nothing that no key could end but Escape.
    let ops = new Map();
    let mode = null;
    // True while this file dispatches a key into a CodeMirror editor. Chrome makes it, so it comes back to the core's listener as a trusted key, and the mode lets it through.
    let dispatching = false;

    const root_of_focused_document = (doc, target, selector) => (target === doc.body || target === doc.documentElement ? doc.querySelector(selector) : null);

    // The area that holds `target`: the row of its document whose root holds it, or, when the document itself has the focus, the row's root in it.
    function area_of(target) {
      const doc = target?.ownerDocument;
      if (!doc || typeof target.closest !== "function") return null;
      const url = String(doc.documentURI);
      for (const row of CODE_AREAS) {
        if (!url.startsWith(row.url)) continue;
        const root = target.closest(row.root) ?? root_of_focused_document(doc, target, row.root);
        const content = root?.querySelector(".cm-content");
        // The root also holds fields: the Debugger's breakpoint condition is an editor inside the source with a checkbox beside it, and the response has a filter box.
        if (in_editable(target) && (target.closest(".cm-content") !== content || target.matches("input, textarea, select"))) continue;
        if (content) return { doc, root, content, code: true };
      }
      if (in_editable(target)) return null;
      for (const row of TEXT_AREAS) {
        if (!url.startsWith(row.url)) continue;
        const root = target.closest(row.root) ?? root_of_focused_document(doc, target, row.root);
        if (root?.checkVisibility()) return { doc, root, lines: row.lines, code: false };
      }
      return null;
    }

    // The first text that shows in the area: under the focused element when it sits inside the area, else anywhere in it. Blank text is skipped.
    function start_point({ root }, focused) {
      const target = root.contains(focused) ? focused : root;
      const shown = root.getBoundingClientRect();
      let seen = 0;
      for (const scope of target !== root && root.contains(target) ? [target, root] : [root]) {
        // The area pass leaves out the focused subtree it already searched, so those nodes count once against the limit.
        const searched = scope === root ? target : null;
        const walker = root.ownerDocument.createTreeWalker(scope, SHOW_ELEMENT | SHOW_TEXT, {
          acceptNode: (node) => (node === searched ? FILTER_REJECT : node.nodeType === TEXT_NODE ? FILTER_ACCEPT : FILTER_SKIP),
        });
        for (let node = walker.nextNode(); node && seen < MAX_START_NODES; node = walker.nextNode(), seen++) {
          const offset = node.data.search(/\S/);
          const parent = node.parentElement;
          if (offset < 0 || !parent?.checkVisibility()) continue;
          const box = parent.getBoundingClientRect();
          if (box.bottom > shown.top && box.top < shown.bottom) return { node, offset };
        }
      }
      return null;
    }

    function press_in_editor(content, { key, keyCode, ctrlKey = false }, shiftKey = true) {
      const view = content.ownerDocument.defaultView;
      dispatching = true;
      try {
        content.dispatchEvent(new view.KeyboardEvent("keydown", { key, code: key, keyCode, shiftKey, ctrlKey, bubbles: true, cancelable: true, composed: true }));
      } finally {
        dispatching = false;
      }
    }

    function start(win, target) {
      end(false);
      if (ops.size === 0) return false;
      const area = area_of(target);
      if (!area) return false;
      const point = area.code ? null : start_point(area, target);
      if (!area.code && !point) return false;
      const started = { win, ...area, undo: [] };
      if (!hold(started, win, KEY_OWNER)) return false;
      mode = started;
      const end_kept = () => end(false);
      // A click sets a selection of its own, and a window in the back gets no keys to end the mode.
      for (const type of ["mousedown", "deactivate", "unload"]) listen(mode, win, type, end_kept);
      listen(mode, area.doc.defaultView, "pagehide", end_kept);
      if (area.code) {
        // Plain arrows first collapse the selection the last copy left, which a Shift+arrow would extend. A plain arrow ends a selection at its edge, and the pair moves an empty one there and back.
        press_in_editor(area.content, CODE_KEYS["char.forward"], false);
        press_in_editor(area.content, CODE_KEYS["char.back"], false);
        press_in_editor(area.content, CODE_KEYS["char.forward"]);
      } else {
        const selection = area.doc.defaultView.getSelection();
        selection.collapse(point.node, point.offset);
        selection.modify("extend", "forward", "character");
      }
      return true;
    }

    // The end of the selection moves, and a move that leaves the area goes back, so the selection never takes in the panel's toolbar or the next pane.
    function move(op) {
      if (mode.code) return press_in_editor(mode.content, CODE_KEYS[op]);
      if (!mode.lines && LINE_OPS.has(op)) return;
      const selection = mode.doc.defaultView.getSelection();
      if (selection.rangeCount === 0) return end(false);
      const { focusNode, focusOffset } = selection;
      selection.modify("extend", ...DOM_MOVES[op]);
      if (!mode.root.contains(selection.focusNode)) selection.extend(focusNode, focusOffset);
    }

    function copy() {
      if (mode.code) return copy_code(mode.doc);
      const text = mode.doc.defaultView.getSelection().toString();
      if (text.length === 0) return;
      if (text.length > MAX_COPY_CHARS) return core.log_once(OVER_COPY_CAP);
      Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper).copyString(text);
    }

    // CodeMirror fills the clipboard from its own selection on the copy command. The listener runs after CodeMirror's own, on the way up, and empties a copy over the cap.
    // With its selection empty, CodeMirror copies the whole line, which the user never selected.
    function copy_code(doc) {
      const view = doc.defaultView;
      if (view.getSelection().isCollapsed) return;
      const cap = (event) => {
        const data = event.clipboardData;
        if (!data || data.getData("text/plain").length <= MAX_COPY_CHARS) return;
        data.clearData();
        core.log_once(OVER_COPY_CAP);
      };
      view.addEventListener("copy", cap);
      try {
        view.docShell.doCommand("cmd_copy");
      } finally {
        view.removeEventListener("copy", cap);
      }
    }

    // Escape drops the selection as well. The copy key and every other end keep it, so the user sees what was copied.
    function end(drop_selection) {
      const ended = mode;
      if (!ended) return;
      mode = null;
      undo_all(ended);
      if (!drop_selection) return;
      try {
        if (ended.code) press_in_editor(ended.content, CODE_KEYS["char.forward"], false);
        else {
          const selection = ended.doc.defaultView.getSelection();
          if (selection.rangeCount > 0) selection.collapse(selection.focusNode, selection.focusOffset);
        }
      } catch (error) {
        core.log_once(`visual mode in DevTools could not drop its selection: ${error}`);
      }
    }

    // A key in the window of the mode: true to take it, false to leave it to DevTools, undefined when no mode holds the window.
    // A modifier chord or a named key (an arrow, Tab, F6) ends the mode and goes on, since it can move the focus out of the area. Escape ends it and stays here, so it opens no split console.
    function answer_key(win, event, token) {
      if (!mode || mode.win !== win || MODIFIER_KEYS.has(event.key)) return undefined;
      if (dispatching) return false;
      // DevTools can move the focus into a field by itself. A key there ends the mode and types, Escape too.
      const target = event.originalTarget ?? event.target;
      if (in_editable(target) && !mode.content?.contains(target)) {
        end(false);
        return false;
      }
      const chord = event.ctrlKey || event.altKey || event.metaKey;
      if (event.key === "Escape" && !chord) {
        end(true);
        return true;
      }
      if (chord || [...event.key].length !== 1) {
        end(false);
        return false;
      }
      const op = ops.get(token);
      if (op === COPY) {
        try {
          copy();
        } finally {
          end(false);
        }
      } else if (op) move(op);
      return true;
    }

    const forget = () => {
      ops = new Map();
      end(false);
    };
    // The core checked the rows against the protocol. A push may come twice, and the newest table wins.
    core.register_kind("devtools.visual_keys", ({ keys }) => {
      ops = new Map(keys.filter(({ op }) => op === COPY || Object.hasOwn(DOM_MOVES, op)).map(({ key, op }) => [key, op]));
      return { ok: true };
    });
    const on_pref = () => enabled_by_pref() || end(false);
    Services.prefs.addObserver(ENABLED_PREF, on_pref);
    core.on_shut_down(() => {
      end(false);
      Services.prefs.removeObserver(ENABLED_PREF, on_pref);
    });
    // Said last, so the extension sends the `v` row only to a module that runs the mode.
    core.set_hello_flag("devtools_visual", true);

    return { start, answer_key, end: () => end(false), forget };
  }
})(this);
