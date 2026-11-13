if (!this.__pb) { this.__pb = 1; (function(){
// Frame script: runs in the content process of the test tab, with Xray access to the page.
const SELS = [".desertfox-hint", ".vimiumHintMarker", ".LH", ".TridactylHint"];
const now = () => content.performance.timeOrigin + content.performance.now();
const reply = (data) => sendAsyncMessage("pb:reply", data);
const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
const send = (key, code, key_code) => { tip.beginInputTransactionForTests(content); const ev = new content.KeyboardEvent("", { key, code, keyCode: key_code }); tip.keydown(ev); tip.keyup(ev); };
const press_char = (c) => send(c, "Key" + c.toUpperCase(), c.toUpperCase().charCodeAt(0));

addMessageListener("pb:state", () => {
  const nav = content.performance.getEntriesByType("navigation")[0];
  reply({ url: String(content.location), ready: content.document.readyState, focus: content.document.hasFocus(),
    dcl: nav ? nav.domContentLoadedEventEnd : null, load: nav ? nav.loadEventEnd : null,
    elements: content.document.querySelectorAll("*").length });
});

addMessageListener("pb:escape", () => { send("Escape", "Escape", 27); reply(1); });

addMessageListener("pb:press", ({ data }) => { try {
  const { char, timeout_ms, settle_ms } = data;
  const seen = new WeakSet();
  const watched = new WeakSet();
  let count = 0, first = null, paint = null, done = false;
  const observers = [];
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (SELS.some((s) => node.matches(s)) && !seen.has(node)) {
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
  const t_sent = now();
  const finish = () => {
    if (done) return; done = true;
    for (const o of observers) o.disconnect();
    reply({ found: first !== null, first_ms: first === null ? null : first - t0, paint_ms: paint === null ? null : paint - t0, send_ms: t_sent - t0, count });
  };
  const started = content.performance.now();
  const tick = () => {
    if (first !== null && content.performance.now() - Math.min(started + (first - t0), content.performance.now()) >= settle_ms) return finish();
    if (content.performance.now() - started > timeout_ms) return finish();
    content.setTimeout(tick, 25);
  };
  content.setTimeout(tick, 25);
  } catch (e) { reply({ error: String(e).slice(0, 300), line: String(e.stack).slice(0, 300) }); }
});

})(); }
