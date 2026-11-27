// DesertFox browser module, the DevTools feature: tree keys in docked DevTools and in DevTools windows. See docs/design/browser_module.md.
// The extension pushes the key table (`devtools.keys`), a one-character key and a fixed action per row. Each action becomes an arrow key on the focused DevTools element, so a DevTools tree (the Inspector markup, the Debugger sources, Storage, Network rows) moves, expands and collapses as its own arrows make it.
// No DesertFox page code runs in DevTools: every DevTools document has the system principal, so code there runs as the browser. This file reads no DevTools internals either, only the focused element.
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
    // Empty until the extension pushes a table, so a module with an older extension takes no key in DevTools.
    let actions = new Map();
    // A reloaded or older DesertFox gets a new hello. The table of the one before goes, so only a DesertFox that pushes its own table gets these keys.
    core.on_hello(() => (actions = new Map()));

    // The core checked the rows against the protocol. A push may come twice, and the newest table wins.
    core.register_kind("devtools.keys", ({ keys }) => {
      actions = new Map(keys.filter(({ action }) => Object.hasOwn(ARROWS, action)).map(({ key, action }) => [key, action]));
      return { ok: true };
    });

    const in_editable = (node) =>
      !!node?.localName && (node.isContentEditable || node.localName === "input" || node.localName === "textarea" || node.localName === "select" || !!node.closest?.(".CodeMirror, .cm-editor"));
    // A key in a frame of another process, such as an extension's DevTools panel, targets the frame element, so the field it types into is out of sight.
    const is_frame = (node) => node?.localName === "iframe" || node?.localName === "browser";

    core.claim_devtools_keys(({ event, token }) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      const action = actions.get(token);
      if (!action) return false;
      const target = event.originalTarget ?? event.target;
      if (in_editable(target) || is_frame(target)) return false;
      // An untrusted arrow: no DevTools tree checks `isTrusted`, and the core's own listener skips the event when it bubbles past.
      const { key, keyCode } = ARROWS[action];
      const view = target.ownerDocument.defaultView;
      target.dispatchEvent(new view.KeyboardEvent("keydown", { key, code: key, keyCode, bubbles: true, cancelable: true, composed: true, repeat: event.repeat }));
      return true;
    });
  }
})(this);
