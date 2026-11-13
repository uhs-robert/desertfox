if (!this.__rivals_loaded) { this.__rivals_loaded = 1; (function(){
// Frame script: runs in the content process of the test tab, with Xray access to the page, so it can read closed shadow roots.
// It sends the key and watches for labels in one process, so one clock covers both ends.
// Hint label classes, one per tool: DesertFox, Vimium, Vimium C (inside a closed shadow root), Tridactyl.
const hint_selectors = [".desertfox-hint", ".vimiumHintMarker", ".LH", ".TridactylHint"];
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
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (hint_selectors.some((selector) => node.matches(selector)) && !seen.has(node)) {
      seen.add(node); count++;
      if (first === null) { first = now(); content.requestAnimationFrame(() => { paint = now(); }); }
    }
    const root = node.openOrClosedShadowRoot;
    if (root) { watch(root); for (const c of root.children) scan(c); }
    for (const c of node.children) scan(c);
  };
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

addMessageListener("rivals:coverage", ({ data }) => { try {
  press_char(data.char);
  content.setTimeout(() => {
    const labels = [];
    const walk = (node) => {
      if (node.nodeType !== 1) return;
      if (hint_selectors.some((selector) => node.matches(selector))) labels.push(node.getBoundingClientRect());
      const root = node.openOrClosedShadowRoot;
      if (root) for (const c of root.children) walk(c);
      for (const c of node.children) walk(c);
    };
    for (const el of content.document.documentElement.children) walk(el);
    const distance = (label, r) => Math.hypot(Math.max(r.left - (label.left + label.width / 2), 0, (label.left + label.width / 2) - r.right), Math.max(r.top - (label.top + label.height / 2), 0, (label.top + label.height / 2) - r.bottom));
    const targets = [...content.document.querySelectorAll("[data-target]")].map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inside = r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < content.innerWidth && cy < content.innerHeight;
      const top = inside ? content.document.elementFromPoint(cx, cy) : null;
      return { name: el.dataset.target, rect: r, visible: !!top && (top === el || el.contains(top)), labels: 0 };
    });
    let unmatched = 0;
    for (const label of labels) {
      let best = null;
      for (const t of targets) if (t.rect.width > 0 && (best === null || distance(label, t.rect) < distance(label, best.rect))) best = t;
      if (best && distance(label, best.rect) <= 40) best.labels++; else unmatched++;
    }
    reply({ label_count: labels.length, unmatched, viewport: [content.innerWidth, content.innerHeight], scroll_y: content.scrollY, targets: targets.map((t) => ({ name: t.name, visible: t.visible, labelled: t.labels > 0 })) });
  }, data.settle_ms);
  } catch (e) { reply({ error: String(e).slice(0, 300) }); }
});

})(); }
