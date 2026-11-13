if (!this.__rivals_loaded) { this.__rivals_loaded = 1; (function(){
// Frame script: runs in the content process of the test tab, with Xray access to the page, so it can read closed shadow roots.
// It sends the key and watches for labels in one process, so one clock covers both ends.
// Hint label classes, one per tool: DesertFox, Vimium, Vimium C (inside a closed shadow root), Tridactyl.
const hint_selectors = [".desertfox-hint", ".vimiumHintMarker", ".LH", ".TridactylHint"];
// Visits every hint label under node, and calls on_root for each shadow root on the way (Xray access reads closed roots too).
const walk_hints = (node, on_label, on_root = () => {}) => {
  if (node.nodeType !== 1) return;
  if (hint_selectors.some((selector) => node.matches(selector))) on_label(node);
  const root = node.openOrClosedShadowRoot;
  if (root) { on_root(root); for (const child of root.children) walk_hints(child, on_label, on_root); }
  for (const child of node.children) walk_hints(child, on_label, on_root);
};
const now = () => content.performance.timeOrigin + content.performance.now();
const reply = (data) => sendAsyncMessage("rivals:reply", data);
const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
const send = (key, code, key_code) => {
  tip.beginInputTransactionForTests(content);
  const event = new content.KeyboardEvent("", { key, code, keyCode: key_code });
  tip.keydown(event);
  tip.keyup(event);
};
const press_char = (c) => send(c, "Key" + c.toUpperCase(), c.toUpperCase().charCodeAt(0));

addMessageListener("rivals:state", () => {
  const nav = content.performance.getEntriesByType("navigation")[0];
  reply({ url: String(content.location), ready: content.document.readyState, dcl: nav ? nav.domContentLoadedEventEnd : null, load: nav ? nav.loadEventEnd : null });
});

addMessageListener("rivals:escape", () => { send("Escape", "Escape", 27); reply(1); });

addMessageListener("rivals:press", ({ data }) => { try {
  const { char, timeout_ms, settle_ms } = data;
  const seen = new WeakSet();
  const watched = new WeakSet();
  let count = 0, first = null, paint = null, done = false;
  const observers = [];
  const scan = (node) => walk_hints(node, (label) => {
    if (seen.has(label)) return;
    seen.add(label); count++;
    if (first === null) { first = now(); content.requestAnimationFrame(() => { paint = now(); }); }
  }, watch);
  const watch = (root) => {
    if (watched.has(root)) return;
    watched.add(root);
    const obs = new content.MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) scan(n); });
    obs.observe(root, { childList: true, subtree: true });
    observers.push(obs);
  };
  watch(content.document);
  for (const el of content.document.documentElement.children) { const r = el.openOrClosedShadowRoot; if (r) watch(r); }
  for (const el of content.document.body ? content.document.body.children : []) { const r = el.openOrClosedShadowRoot; if (r) watch(r); }
  const t0 = now();
  press_char(char);
  const finish = () => {
    if (done) return; done = true;
    for (const o of observers) o.disconnect();
    reply({ found: first !== null, first_ms: first === null ? null : first - t0, paint_ms: paint === null ? null : paint - t0, count });
  };
  const started = content.performance.now();
  const tick = () => {
    // Wait settle_ms after the first label so that the count covers the whole batch.
    const since_first_label = first === null ? 0 : content.performance.now() - (started + (first - t0));
    if (first !== null && since_first_label >= settle_ms) return finish();
    if (content.performance.now() - started > timeout_ms) return finish();
    content.setTimeout(tick, 25);
  };
  content.setTimeout(tick, 25);
  } catch (e) { reply({ error: String(e).slice(0, 300) }); }
});

// Coverage: reads where the targets are and whether they are visible before the key is sent, because a hint overlay can cover a target. After settle_ms it sends the rects of the visible labels. run.mjs does the matching.
addMessageListener("rivals:coverage", ({ data }) => { try {
  const plain_rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const targets = [...content.document.querySelectorAll("[data-target]")].map((el) => {
    const rect = el.getBoundingClientRect();
    const center_x = rect.left + rect.width / 2, center_y = rect.top + rect.height / 2;
    const in_view = rect.width > 0 && rect.height > 0 && center_x >= 0 && center_y >= 0 && center_x < content.innerWidth && center_y < content.innerHeight;
    const top_element = in_view ? content.document.elementFromPoint(center_x, center_y) : null;
    return { name: el.dataset.target, rect: plain_rect(rect), visible: !!top_element && (top_element === el || el.contains(top_element)) };
  });
  press_char(data.char);
  content.setTimeout(() => {
    const labels = [];
    for (const el of content.document.documentElement.children) walk_hints(el, (label) => {
      const rect = label.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && label.checkVisibility({ opacityProperty: true, visibilityProperty: true })) labels.push(plain_rect(rect));
    });
    reply({ labels, viewport: [content.innerWidth, content.innerHeight], scroll_y: content.scrollY, targets });
  }, data.settle_ms);
  } catch (e) { reply({ error: String(e).slice(0, 300) }); }
});

})(); }
