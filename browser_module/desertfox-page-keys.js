// DesertFox browser module, the page keys: page.focus_field (]i [i), page.focus_link (]l [l), page.heading (]h [h } { ]H [H), scroll.align (zt zz zb), page.focus_input (gi ;fe) and page.blur (,b), the heading list and jump of `sh`, and the register text of `<C-r>`.
// See docs/design/browser_module.md, "Page keys on locked pages".
// One frame script serves every page kind the module takes keys on: a parent-process about: page, a page in a content process, a restricted host. A page with DesertFox's own page code (pages on) is not served here, because the module takes no key there.
// The commands send the frame script a typed message. The frame script holds the page logic, which mirrors the page code's (src/content/hints/focus_fields.ts, src/content/lib/headings.ts, src/content/page/align.ts, src/content/page/focus_input.ts) in plain JS, because a frame script is one stringified function.
// A notice for an end of list or a page with nothing to focus stays silent: the module has no notice path of its own.
// In a window it asks the core to load it into the core sandbox, where it defines the commands and answers its kinds once per process.

(function desertfox_browser_module_page_keys(scope) {
  "use strict";
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
    try {
      core.adopt(Components.stack.filename.split(" -> ").pop());
    } catch (error) {
      Components.utils.reportError(`DesertFox browser module: the page keys feature failed to load: ${error}`);
    }
    return;
  }
  // A failed start must not reach the core's `adopt`, which would turn the whole module off. The page keys stay off instead.
  try {
    define(core);
  } catch (error) {
    core.log_once(`the page keys feature is off for this session: ${error}`);
  }

  function define(core) {
    const KEY_MESSAGE = "desertfox-browser-module:page-key";
    const ASK_MESSAGE = "desertfox-browser-module:page-ask";
    const REPLY_MESSAGE = "desertfox-browser-module:page-reply";
    const REPLY_MS = 3000;
    // The caps of src/shared/browser_module_protocol.ts (MAX_HEADINGS, MAX_HEADING_CHARS) and the reply value's byte budget under the kind's cap.
    const MAX_HEADINGS = 300;
    const MAX_HEADING_CHARS = 120;
    const MAX_VALUE_BYTES = 40000;
    const FIELD_DIRECTIONS = ["next", "prev"];
    const HEADING_DIRECTIONS = ["next", "prev", "first", "last", "next_block", "prev_block"];
    const ALIGN_POSITIONS = ["top", "center", "bottom"];
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    // The arg shapes of MODULE_COMMAND_ARGS in src/shared/browser_module_protocol.ts. The extension fills every arg, so a row always holds them all.
    const int = { type: "int" };
    const enum_of = (values) => ({ type: "enum", values });

    const send_key = (id) => ({ browser, args }) => browser.messageManager.sendAsyncMessage(KEY_MESSAGE, { id, args, inner: browser.innerWindowID });
    const key_command = (id, args) => core.define_command(id, { args, run: send_key(id) });
    key_command("page.focus_field", { direction: enum_of(FIELD_DIRECTIONS), steps: int });
    key_command("page.focus_link", { direction: enum_of(FIELD_DIRECTIONS), steps: int });
    key_command("page.heading", { direction: enum_of(HEADING_DIRECTIONS), steps: int });
    key_command("scroll.align", { position: enum_of(ALIGN_POSITIONS) });
    key_command("page.focus_input", {});
    key_command("page.blur", {});
    core.add_frame_script(page_keys_frame_script);

    // The chrome end of the frame script's answers: one request at a time per number, answered by the browser asked and the document asked about.
    const awaiting = new Map();
    let next_request = 1;
    function ask(browser, name, fields) {
      const req = next_request++;
      const inner = browser.innerWindowID;
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(undefined), REPLY_MS);
        const settle = (data) => {
          if (!awaiting.delete(req)) return;
          clearTimeout(timer);
          resolve(data);
        };
        awaiting.set(req, { browser, inner, settle });
        try {
          browser.messageManager.sendAsyncMessage(ASK_MESSAGE, { name, req, inner, ...fields });
        } catch (_) {
          settle(undefined);
        }
      });
    }
    const on_reply = (message) => {
      const { data } = message;
      const asked = typeof data === "object" && data !== null ? awaiting.get(data.req) : undefined;
      if (asked && asked.browser === message.target && data.inner === asked.inner && asked.browser.innerWindowID === asked.inner) asked.settle(data);
    };
    Services.mm.addMessageListener(REPLY_MESSAGE, on_reply);
    core.on_shut_down(() => {
      Services.mm.removeMessageListener(REPLY_MESSAGE, on_reply);
      for (const asked of [...awaiting.values()]) asked.settle(undefined);
    });

    const refuse = (error) => ({ ok: false, error });
    const is_browser_window = (win) => !!win && !win.closed && win.document?.documentElement?.getAttribute("windowtype") === "navigator:browser" && !!win.gBrowser;
    // The window that holds the tab, or nothing. Not `tab.ownerGlobal`: the window as the sandbox sees it through that path hides `gBrowser`.
    function window_of(tab_id) {
      let tab = null;
      try {
        tab = ExtensionParent.apiManager.global.tabTracker.getTab(tab_id, null);
      } catch (_) {
        tab = null;
      }
      if (!tab || tab.closing) return undefined;
      const win = [...Services.wm.getEnumerator("navigator:browser")].find((each) => is_browser_window(each) && each.gBrowser.getTabForBrowser(tab.linkedBrowser) === tab);
      return win ? { win, tab } : undefined;
    }

    // The selected tab of a window the module may act in. A late request never reads a page the user switched to.
    function shown_browser(tab_id) {
      const found = window_of(tab_id);
      if (!found) return refuse("The tab that asked is gone");
      if (!core.may_act(found.win)) return refuse("The browser module may not act in this window");
      if (found.win.gBrowser.selectedTab !== found.tab) return refuse("The tab that asked is no longer selected");
      return { ok: true, browser: found.tab.linkedBrowser };
    }

    // Control and format characters go, whitespace runs become one space, then the cap. The extension keeps its own copy of this rule (`heading_rows_of` in src/shared/browser_module_headings.ts).
    const cleaned_text = (text) => [...String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_HEADING_CHARS).join("");

    core.register_kind("page_headings.read", async ({ tab_id }) => {
      const shown = shown_browser(tab_id);
      if (!shown.ok) return shown;
      // The pages the content hints route never reads (the Firefox account pages) give no list either.
      if (core.content_pages?.()?.refuses(shown.browser)) return refuse("Headings cannot be read on this page");
      const data = await ask(shown.browser, "headings", {});
      if (!data || !Array.isArray(data.rows)) return refuse("The page changed");
      if (shown.browser.innerWindowID !== data.inner) return refuse("The page changed");
      const rows = [];
      let used = 2;
      for (const row of data.rows) {
        if (!Array.isArray(row) || !Number.isInteger(row[0]) || row[0] < 1 || row[0] > 6 || typeof row[1] !== "string") continue;
        const entry = [row[0], cleaned_text(row[1])];
        const size = new TextEncoder().encode(JSON.stringify(entry)).length + 1;
        if (rows.length >= MAX_HEADINGS || used + size > MAX_VALUE_BYTES) break;
        used += size;
        rows.push(entry);
      }
      return { ok: true, value: JSON.stringify(rows) };
    });

    core.register_kind("page_heading.go", async ({ tab_id, index }) => {
      const shown = shown_browser(tab_id);
      if (!shown.ok) return shown;
      if (index < 0 || index >= MAX_HEADINGS) return refuse("No such heading");
      const data = await ask(shown.browser, "heading_go", { index });
      if (!data || shown.browser.innerWindowID !== data.inner) return refuse("The page changed");
      return data.ok === true ? { ok: true } : refuse(data.error === "gone" ? "That heading is gone" : "No such heading");
    });
  }

  // Runs in each tab. It holds the page logic of the keys above and the page's answers to the chrome side.
  function page_keys_frame_script() {
    const KEY_MESSAGE = "desertfox-browser-module:page-key";
    const ASK_MESSAGE = "desertfox-browser-module:page-ask";
    const REPLY_MESSAGE = "desertfox-browser-module:page-reply";
    const PASTE_MESSAGE = "desertfox-browser-module:paste";
    const ENABLED_PREF = "desertfox.browser_module.enabled";
    // A count rides in `steps`, and the page has no use for more than this.
    const MAX_STEPS = 1000;
    const MAX_FRAME_DEPTH = 4;
    const MAX_PASTE_CHARS = 2000;
    // FORM_CONTROLS and LINKS of src/content/hints/focus_fields.ts, HEADINGS of src/content/lib/heading_match.ts.
    const FORM_CONTROLS = 'input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [contenteditable=""], [contenteditable="true"]';
    const LINKS = "a[href]";
    const HEADINGS = "h1, h2, h3, h4, h5, h6, [role=heading]";
    const BLOCKS = `${HEADINGS}, p, pre, blockquote`;
    const TEXT_BLOCKS = ["p", "pre", "blockquote"];
    const MIN_BLOCK_CHARS = 40;
    // The page frame around the text, as in src/content/lib/headings.ts.
    const CHROME = "nav, footer, aside, form, dialog, header:not(:is(article, aside, main, nav, section) header), [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search]";
    const NON_TEXT_INPUT_TYPES = ["button", "checkbox", "radio", "submit", "reset", "image", "file", "color", "range", "hidden"];
    const FIELD_DIRECTIONS = ["next", "prev"];
    const HEADING_DIRECTIONS = ["next", "prev", "first", "last", "next_block", "prev_block"];
    const SCROLL_BLOCK = { top: "start", center: "center", bottom: "end" };
    const MIN_BOX_SIDE = 2;
    const AT_TOP_SLACK = 1;
    const MAX_INSET_SHARE = 1 / 3;
    const DEFAULT_HEADING_LEVEL = 2;

    // The element the user left last, and the heading the last jump reached (until a focus or selection change takes over).
    let last_blurred;
    let heading_jump;
    let last_heading;
    let snapshot;

    const module_on = () => {
      try {
        return Services.prefs.getBoolPref(ENABLED_PREF, false);
      } catch (_) {
        return false;
      }
    };
    const inner_of = (win) => win?.windowGlobalChild?.innerWindowId;
    const is_record = (value) => typeof value === "object" && value !== null;
    const parent_of = (element) => element.parentElement ?? element.getRootNode().host ?? null;
    const window_of = (element) => element.ownerDocument.defaultView ?? content;

    function deep_active(doc) {
      let active_element = doc.activeElement;
      while (active_element?.shadowRoot?.activeElement) active_element = active_element.shadowRoot.activeElement;
      return active_element;
    }

    const takes_typing = (element) => element.isContentEditable || element.localName === "textarea" || (element.localName === "input" && !NON_TEXT_INPUT_TYPES.includes((element.type || "text").toLowerCase()));

    // The elements `selector` finds, in page order, through shadow roots and the frames of the page. `frames` lists the frame elements above an element, outermost first.
    function collect(root, selector, test, frames = [], found = [], depth = 0) {
      for (const element of root.querySelectorAll("*")) {
        if (element.matches(selector) && (!test || test(element))) found.push({ element, frames });
        const shadow = element.openOrClosedShadowRoot;
        if (shadow) collect(shadow, selector, test, frames, found, depth);
        if ((element.localName === "iframe" || element.localName === "frame") && depth < MAX_FRAME_DEPTH) {
          let inner = null;
          try {
            inner = element.contentDocument;
          } catch (_) {
            inner = null;
          }
          if (inner) collect(inner, selector, test, [...frames, element], found, depth + 1);
        }
      }
      return found;
    }

    // A box of real size that no hidden ancestor cuts off. The page may still hide it with a clip of a scroll box, which this does not follow.
    const is_present = (element) =>
      element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && Array.from(element.getClientRects()).some((rect) => rect.width >= MIN_BOX_SIDE && rect.height >= MIN_BOX_SIDE);
    const present = (found) => found.filter(({ element, frames }) => is_present(element) && frames.every(is_present));

    // How far below the window top the nearest scroll box of the element starts, or 0.
    function scrollport_top_of(element) {
      const win = window_of(element);
      let top = 0;
      for (let up = parent_of(element); up !== null; up = parent_of(up)) {
        if (up.scrollHeight > up.clientHeight && /^(auto|scroll|hidden)$/.test(win.getComputedStyle(up).overflowY) && !/^(body|html)$/.test(up.localName)) top = Math.max(top, up.getBoundingClientRect().top + up.clientTop);
      }
      return top;
    }

    // The bottom edge of the fixed or sticky element at the top of the view, or 0.
    function top_inset() {
      const doc = content.document;
      for (let element = doc.elementFromPoint(content.innerWidth / 2, 1); element; element = element.parentElement) {
        const position = content.getComputedStyle(element).position;
        if (position !== "fixed" && position !== "sticky") continue;
        const bottom = element.getBoundingClientRect().bottom;
        return bottom > 0 && bottom <= content.innerHeight * MAX_INSET_SHARE ? Math.ceil(bottom) : 0;
      }
      return 0;
    }

    function is_fully_in_view(element) {
      const box = element.getBoundingClientRect();
      const win = window_of(element);
      return box.top >= 0 && box.left >= 0 && box.bottom <= win.innerHeight && box.right <= win.innerWidth;
    }

    // Each window scrolls only its own document, so the frames that hold the element are scrolled in turn, innermost first.
    function reveal({ element, frames }) {
      for (const target of [element, ...[...frames].reverse()]) if (!is_fully_in_view(target)) target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }

    // `pick_field` and `place_of` of src/content/hints/focus_fields.ts.
    function move_focus(selector, direction, steps) {
      const doc = content.document;
      const found = present(collect(doc, selector)).filter(({ element }) => !element.closest("[inert]"));
      if (found.length === 0) return;
      const fields = found.map((item) => item.element);
      const anchor = [deep_active(doc), last_blurred?.deref()].map((each) => (each ? fields.indexOf(each) : -1)).find((index) => index !== -1);
      const is_above_view = (element) => element.getBoundingClientRect().bottom <= scrollport_top_of(element);
      const on_field = anchor !== undefined;
      const first_in_view = fields.findIndex((field) => !is_above_view(field));
      const index = on_field ? anchor : first_in_view === -1 ? fields.length : first_in_view;
      const first = direction === "next" ? (on_field ? index + 1 : index) : index - 1;
      if (first < 0 || first >= found.length) return;
      const picked = direction === "next" ? first + steps - 1 : first - steps + 1;
      const target = found[Math.min(Math.max(picked, 0), found.length - 1)];
      // The control is focused first with `preventScroll`, because the default scroll puts it at the edge of the view.
      target.element.focus({ preventScroll: true });
      reveal(target);
    }

    const rendered_text = (element) => (element.innerText ?? element.textContent ?? "").trim();
    // The role wins over the tag, so <h2 role=presentation> is no heading. An empty heading is no jump target.
    function is_heading(element) {
      const role = element.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase();
      return (role === undefined || role === "" || role === "heading") && rendered_text(element) !== "";
    }
    function heading_level(element) {
      const level = Number(element.getAttribute("aria-level"));
      if (Number.isInteger(level) && level >= 1 && level <= 6) return level;
      return /^h[1-6]$/.test(element.localName) ? Number(element.localName[1]) : DEFAULT_HEADING_LEVEL;
    }
    // A blockquote that holds paragraphs counts once, and a text block inside another one is no stop of its own.
    function is_block(element) {
      if (element.closest(CHROME)) return false;
      if (!TEXT_BLOCKS.includes(element.localName)) return is_heading(element);
      if (element.parentElement?.closest("blockquote")) return false;
      return rendered_text(element).replace(/\s+/g, " ").length >= MIN_BLOCK_CHARS;
    }

    // `pick_heading_step` of src/content/lib/headings.ts. `tops` are the heading tops relative to the view top, `from` the remembered heading.
    function pick_heading_step(tops, direction, steps, from) {
      if (direction === "first" || direction === "last") return tops.length === 0 ? undefined : direction === "first" ? 0 : tops.length - 1;
      const first =
        from !== undefined
          ? direction === "next" ? from + 1 : from - 1
          : direction === "next" ? tops.findIndex((top) => top > AT_TOP_SLACK) : tops.findLastIndex((top) => top < -AT_TOP_SLACK);
      if (first < 0 || first >= tops.length) return undefined;
      const index = direction === "next" ? first + steps - 1 : first - steps + 1;
      return Math.min(Math.max(index, 0), tops.length - 1);
    }

    // The jump leaves the element just below a covering bar. The scroll margin makes `scrollIntoView` leave the room in any scroller.
    function scroll_to_top(element, frames, inset) {
      const jump = (bar) => {
        const page_margin = parseFloat(window_of(element).getComputedStyle(element).scrollMarginTop) || 0;
        let padding = 0;
        for (let up = parent_of(element); up; up = parent_of(up)) {
          padding = parseFloat(window_of(up).getComputedStyle(up).scrollPaddingTop);
          if (padding > 0) break;
          padding = 0;
        }
        const room = Math.max(bar - padding, page_margin);
        const kept = element.style.scrollMarginTop;
        if (room !== page_margin) element.style.scrollMarginTop = `${room}px`;
        for (const target of [element, ...[...frames].reverse()]) target.scrollIntoView({ block: "start", behavior: "instant" });
        element.style.scrollMarginTop = kept;
      };
      jump(inset);
      const covering = top_inset();
      if (covering > inset) jump(covering);
    }

    // The heading the align keys use until a focus or selection change takes over.
    function keep_for_align(element, frames) {
      heading_jump = { element: new WeakRef(element), frames: frames.map((frame) => new WeakRef(frame)) };
      last_heading = new WeakRef(element);
    }
    const top_in_view = ({ element, frames }) => [element, ...frames].reduce((sum, target) => sum + target.getBoundingClientRect().top - scrollport_top_of(target), 0);

    function step_heading(direction, steps) {
      const by_block = direction === "next_block" || direction === "prev_block";
      const found = present(collect(content.document, by_block ? BLOCKS : HEADINGS, by_block ? is_block : is_heading));
      if (found.length === 0) return;
      const inset = top_inset();
      const tops = found.map((item) => top_in_view(item) - inset);
      const remembered = last_heading?.deref();
      const at = remembered === undefined ? -1 : found.findIndex(({ element }) => element === remembered);
      const on_screen = at !== -1 && tops[at] >= -AT_TOP_SLACK && tops[at] < content.innerHeight;
      const step = direction === "next_block" ? "next" : direction === "prev_block" ? "prev" : direction;
      const index = pick_heading_step(tops, step, steps, on_screen ? at : undefined);
      if (index === undefined) return;
      const { element, frames } = found[index];
      scroll_to_top(element, frames, inset);
      keep_for_align(element, frames);
    }

    // The order of src/content/align_target.ts: the heading jump, the focused element unless it is the page itself, the selection's field, the element around the selection.
    function align(position) {
      const doc = content.document;
      const live = (node) => node?.isConnected && node.ownerDocument.defaultView !== null;
      const element = heading_jump?.element.deref();
      const frames = heading_jump?.frames.map((frame) => frame.deref());
      let target;
      let chain;
      if (live(element) && frames.every(live)) {
        target = element;
        chain = [element, ...[...frames].reverse()];
      } else {
        const focused = deep_active(doc);
        const node = content.getSelection()?.focusNode;
        const parent = node?.nodeType === 1 ? node : node?.parentElement;
        const around = parent && parent !== doc.body && parent !== doc.documentElement ? parent : undefined;
        const blurred = last_blurred?.deref();
        target = focused && focused !== doc.body && focused !== doc.documentElement ? focused : around?.isContentEditable ? around.closest("[contenteditable]") : around?.contains(blurred) ? blurred : around ?? blurred;
        chain = [target];
      }
      if (!live(target)) return;
      for (const each of chain) each.scrollIntoView({ block: SCROLL_BLOCK[position], behavior: "instant" });
    }

    // The first visible text field, the one in view first, as src/content/page/focus_input.ts takes it.
    function focus_input() {
      const is_visible = (element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && content.getComputedStyle(element).visibility !== "hidden";
      };
      const is_in_viewport = (element) => {
        const box = element.getBoundingClientRect();
        return box.bottom > 0 && box.top < content.innerHeight && box.right > 0 && box.left < content.innerWidth;
      };
      const inputs = collect(content.document, "input, textarea, [contenteditable]", (element) => takes_typing(element) && !element.disabled && is_visible(element)).map((item) => item.element);
      (inputs.find(is_in_viewport) ?? inputs[0])?.focus();
    }

    function blur() {
      const focused = deep_active(content.document);
      if (!focused || focused === content.document.body || focused === content.document.documentElement) return;
      last_blurred = new WeakRef(focused);
      focused.blur();
    }

    const whole = (value) => (Number.isInteger(value) ? Math.min(Math.max(value, 1), MAX_STEPS) : 1);
    function run_key(id, args) {
      if (!is_record(args)) return;
      if (id === "page.focus_field" && FIELD_DIRECTIONS.includes(args.direction)) move_focus(FORM_CONTROLS, args.direction, whole(args.steps));
      else if (id === "page.focus_link" && FIELD_DIRECTIONS.includes(args.direction)) move_focus(LINKS, args.direction, whole(args.steps));
      else if (id === "page.heading" && HEADING_DIRECTIONS.includes(args.direction)) step_heading(args.direction, whole(args.steps));
      else if (id === "scroll.align" && Object.hasOwn(SCROLL_BLOCK, args.position)) align(args.position);
      else if (id === "page.focus_input") focus_input();
      else if (id === "page.blur") blur();
    }

    // A focus or selection change after a jump hands the align keys back to the focus.
    const clear_jump = () => {
      heading_jump = undefined;
    };
    addEventListener("focusin", clear_jump, true);
    addEventListener("selectionchange", clear_jump, true);
    addEventListener("focusout", (event) => {
      if (event.target?.nodeType === 1) last_blurred = new WeakRef(event.target);
    }, true);
    addEventListener("pagehide", () => {
      snapshot = undefined;
      heading_jump = undefined;
      last_heading = undefined;
    }, true);

    addMessageListener(KEY_MESSAGE, ({ data }) => {
      try {
        if (!module_on() || !is_record(data) || typeof data.id !== "string" || !content?.document || (inner_of(content) !== undefined && data.inner !== inner_of(content))) return;
        run_key(data.id, data.args);
      } catch (_) {
        // A document going away mid-key does nothing.
      }
    });

    // The heading list of `sh`: the rows go to chrome, and the elements stay here for `heading_go`.
    function read_headings() {
      const found = present(collect(content.document, HEADINGS, is_heading));
      snapshot = { found, inner: inner_of(content) };
      return found.map(({ element }) => [heading_level(element), rendered_text(element).replace(/\s+/g, " ")]);
    }

    function heading_go(index) {
      const chosen = Number.isInteger(index) ? snapshot?.found[index] : undefined;
      if (!chosen) return "none";
      const frames_connected = chosen.frames.every((frame) => frame.isConnected);
      if (!chosen.element.isConnected || !frames_connected) return "gone";
      scroll_to_top(chosen.element, chosen.frames, top_inset());
      keep_for_align(chosen.element, chosen.frames);
      return undefined;
    }

    addMessageListener(ASK_MESSAGE, ({ data }) => {
      if (!is_record(data) || !Number.isSafeInteger(data.req)) return;
      const reply = (fields) => sendAsyncMessage(REPLY_MESSAGE, { req: data.req, inner: data.inner, ...fields });
      try {
        if (!module_on() || !content?.document || (inner_of(content) !== undefined && data.inner !== inner_of(content))) return reply({ error: "changed" });
        if (data.name === "headings") reply({ rows: read_headings() });
        else if (data.name === "heading_go") {
          const error = heading_go(data.index);
          reply(error === undefined ? { ok: true } : { ok: false, error });
        }
      } catch (_) {
        reply({ error: "changed" });
      }
    });

    // `<C-r>`: the text goes into the field that has the focus and nowhere else. A field that lost the focus meanwhile gets nothing.
    addMessageListener(PASTE_MESSAGE, ({ data }) => {
      try {
        if (!module_on() || !is_record(data) || typeof data.text !== "string" || !content?.document || (inner_of(content) !== undefined && data.inner !== inner_of(content))) return;
        const doc = content.document;
        const field = deep_active(doc);
        if (!field || !takes_typing(field) || field.readOnly || field.disabled) return;
        const text = [...data.text.replace(/[\p{Cc}\p{Cf}]/gu, (each) => (each === "\n" || each === "\t" ? each : ""))].slice(0, MAX_PASTE_CHARS).join("");
        if (text === "" || doc.execCommand("insertText", false, text)) return;
        field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
        field.dispatchEvent(new content.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch (_) {
        // A field that takes no selection (a number input) is left as it was.
      }
    });
  }
})(this);
