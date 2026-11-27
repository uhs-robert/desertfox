// DesertFox browser module, the DevTools feature: tree keys and hints in docked DevTools and in DevTools windows. See docs/design/browser_module.md.
// The extension pushes the key table (`devtools.keys`), a one-character key and a fixed action per row. Each tree action becomes an arrow key on the focused DevTools element, so a DevTools tree (the Inspector markup, the Debugger sources, Storage, Network rows) moves, expands and collapses as its own arrows make it.
// The `hints.start` action asks the extension for hints (`devtools_hints.ask`). The hints work as chrome hints do: this file collects targets from a fixed table and sends only ids and boxes, the extension makes the labels and names the pick, and this file draws them and runs one fixed action per target.
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
  // In the sandbox an error goes on to the core's `adopt`, which turns the module off for the session.
  define(core);

  function define(core) {
    const ARROWS = {
      "tree.down": { key: "ArrowDown", keyCode: 40 },
      "tree.up": { key: "ArrowUp", keyCode: 38 },
      "tree.collapse": { key: "ArrowLeft", keyCode: 37 },
      "tree.expand": { key: "ArrowRight", keyCode: 39 },
    };
    const HINTS_START = "hints.start";
    // Empty until the extension pushes a table, so a module with an older extension takes no key in DevTools.
    let actions = new Map();
    const hints = define_hints(core);
    // A reloaded or older DesertFox gets a new hello. The table and the hints of the one before go, so only a DesertFox that pushes its own table gets these keys.
    core.on_hello(() => {
      actions = new Map();
      hints.end();
    });

    // The core checked the rows against the protocol. A push may come twice, and the newest table wins.
    core.register_kind("devtools.keys", ({ keys }) => {
      actions = new Map(keys.filter(({ action }) => Object.hasOwn(ARROWS, action) || action === HINTS_START).map(({ key, action }) => [key, action]));
      return { ok: true };
    });

    const in_editable = (node) =>
      !!node?.localName && (node.isContentEditable || node.localName === "input" || node.localName === "textarea" || node.localName === "select" || !!node.closest?.(".CodeMirror, .cm-editor"));
    // A key in a frame of another process, such as an extension's DevTools panel, targets the frame element, so the field it types into is out of sight.
    const is_frame = (node) => node?.localName === "iframe" || node?.localName === "browser";

    core.claim_devtools_keys(({ window: win, event, token }) => {
      const taken_by_hints = hints.answer_key(win, event);
      if (taken_by_hints !== undefined) return taken_by_hints;
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      const action = actions.get(token);
      if (!action) return false;
      const target = event.originalTarget ?? event.target;
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
    const ENABLED_PREF = "desertfox.browser_module.enabled";
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
    const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);
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

    const enabled_by_pref = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };
    const send = (kind, args) => {
      const sent = core.send(kind, args);
      if (!sent.ok) core.log_once(`${kind} was not sent: ${sent.problem}`);
      return sent.ok;
    };
    const undo_all = (owner) => {
      for (const stop of owner.undo.splice(0)) {
        try {
          stop();
        } catch (error) {
          core.log_once(`a DevTools hints cleanup step failed: ${error}`);
        }
      }
    };
    const listen = (owner, target, type, handler) => {
      target.addEventListener(type, handler, true);
      owner.undo.push(() => target.removeEventListener(type, handler, true));
    };
    // The popup walk and the sidebar leave a held window's keys alone, so a DevTools context menu cannot take the session's letters. False while another feature holds the window.
    const hold = (owner, win) => {
      if (!core.hold_keys(win, KEY_OWNER)) return false;
      owner.undo.push(() => core.release_keys(win, KEY_OWNER));
      return true;
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
      if (!hold(asking, win)) {
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
      if (!hold(session, win)) {
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
      for (const layer of session.layers.values()) layer.box.replaceChildren(...(by_layer.get(layer) ?? []));    }

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
      element.ownerDocument.defaultView.focus();
      (element.matches(FOCUSABLE) ? element : (element.querySelector(FOCUSABLE) ?? element)).focus();
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
})(this);
