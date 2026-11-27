// DesertFox browser module, the tab and scroll feature: tab.next, tab.prev, scroll.lines, scroll.pixels, scroll.pages and scroll.to. See docs/design/browser_module.md.
// The core (desertfox-browser.js, which sorts first) decides whether a key is taken. This file only runs the command. In a window it asks the core to load it into the core sandbox, where it defines the commands once per process.

(function desertfox_browser_module_tabs_scroll(scope) {
  "use strict";
  try {
    const core = Services.desertfox_browser_module;
    if (typeof core !== "object" || core === null) return;
    if (typeof scope.gBrowser === "object" && scope.gBrowser !== null) {
      core.adopt(Components.stack.filename.split(" -> ").pop());
      return;
    }
    define(core);
  } catch (error) {
    Components.utils.reportError(`DesertFox browser module: the tab and scroll feature failed to load: ${error}`);
  }

  function define(core) {
    const SCROLL_MESSAGE = "desertfox-browser-module:scroll";
    // The arg shapes of MODULE_COMMAND_ARGS in src/shared/browser_module_protocol.ts. The extension fills every arg, so a row always holds them all.
    const int = { type: "int" };
    const number = { type: "number" };
    core.define_command("tab.next", { args: {}, run: ({ window }) => window.gBrowser.tabContainer.advanceSelectedTab(1, true) });
    core.define_command("tab.prev", { args: {}, run: ({ window }) => window.gBrowser.tabContainer.advanceSelectedTab(-1, true) });

    const scroll = (id, args) =>
      core.define_command(id, {
        args,
        run: ({ browser, args: checked, repeat }) => browser.messageManager.sendAsyncMessage(SCROLL_MESSAGE, { id, args: checked, repeat }),
      });
    scroll("scroll.lines", { count: int });
    scroll("scroll.pixels", { dx: int, dy: int });
    scroll("scroll.pages", { fraction: number, count: int });
    scroll("scroll.to", { percent: number, axis: { type: "enum", values: ["x", "y"] } });

    core.add_frame_script(scroll_frame_script);
  }

  // Runs in each tab. It scrolls the box DesertFox's own scroll keys would: the focused element's scrolling ancestor, else the page when it scrolls, else the largest scrolling box (the settings pane of about:preferences, the PDF viewer's pages).
  function scroll_frame_script() {
    const MESSAGE = "desertfox-browser-module:scroll";
    // LINE_PIXELS in src/content/scroll_target.ts.
    const LINE_PIXELS = 5;
    // A held key repeats faster than this, so its presses reuse the box the first press found.
    const KEEP_MS = 1000;
    let kept = { axis: "", box: null, at: 0 };

    const can_scroll = (node, axis) => {
      if (!node) return false;
      const room = axis === "y" ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
      if (room <= 1) return false;
      const doc = node.ownerDocument;
      if (node === doc.scrollingElement) return true;
      const overflow = content.getComputedStyle(node)[axis === "y" ? "overflowY" : "overflowX"];
      return overflow === "auto" || overflow === "scroll";
    };

    function deep_active(doc) {
      let active_element = doc.activeElement;
      while (active_element?.shadowRoot?.activeElement) active_element = active_element.shadowRoot.activeElement;
      return active_element;
    }

    function scroll_box(axis) {
      const doc = content.document;
      const now = Date.now();
      const keep = kept.axis === axis && now - kept.at < KEEP_MS && kept.box?.deref();
      kept.at = now;
      if (keep?.isConnected && can_scroll(keep, axis)) return keep;
      for (let node = deep_active(doc); node && node !== doc.body && node !== doc.documentElement; node = node.parentElement ?? node.getRootNode().host ?? null) {
        if (can_scroll(node, axis)) return node;
      }
      const root = doc.scrollingElement;
      if (can_scroll(root, axis)) return root;
      let best = null;
      let best_area = 0;
      for (const node of doc.querySelectorAll("*")) {
        if (!can_scroll(node, axis)) continue;
        const area = node.clientWidth * node.clientHeight;
        if (area > best_area) [best, best_area] = [node, area];
      }
      kept = { axis, box: best ? new WeakRef(best) : null, at: now };
      return best ?? root;
    }

    const percent_offset = (percent, scroll_size, client_size) => (Math.max(0, scroll_size - client_size) * Math.min(100, Math.max(0, percent))) / 100;

    addMessageListener(MESSAGE, ({ data }) => {
      try {
        const { id, args, repeat } = data;
        const behavior = repeat ? "instant" : "smooth";
        if (id === "scroll.lines") scroll_box("y").scrollBy({ top: args.count * LINE_PIXELS, behavior: "instant" });
        else if (id === "scroll.pixels") scroll_box(args.dy !== 0 ? "y" : "x").scrollBy({ left: args.dx, top: args.dy, behavior: "instant" });
        else if (id === "scroll.pages") {
          const box = scroll_box("y");
          box.scrollBy({ top: args.fraction * args.count * box.clientHeight, behavior });
        } else if (id === "scroll.to") {
          const box = scroll_box(args.axis);
          if (args.axis === "x") box.scrollTo({ left: percent_offset(args.percent, box.scrollWidth, box.clientWidth), behavior });
          else box.scrollTo({ top: percent_offset(args.percent, box.scrollHeight, box.clientHeight), behavior });
        }
      } catch (_) {
        // A document going away mid-scroll scrolls nothing.
      }
    });
  }
})(this);
