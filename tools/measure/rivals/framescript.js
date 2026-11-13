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


// The live-site checks (PAGES=sites). State between messages lives here: the targets of the last hint check, so the activation check knows the element its label sits on.
let last_targets = [];
const sleep = (ms) => new Promise((resolve) => content.setTimeout(resolve, ms));
const plain_rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
const in_viewport = (rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < content.innerHeight && rect.left < content.innerWidth;
const describe = (el) => (el ? el.localName + (el.id ? "#" + el.id : "") : "none");
// Uppercase keys go out with Shift held, as a typed capital would.
const press_keys = async (keys, gap_ms = 80) => {
  for (const c of keys) {
    const upper = c !== c.toLowerCase();
    tip.beginInputTransactionForTests(content);
    const shift = new content.KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
    if (upper) tip.keydown(shift);
    const event = new content.KeyboardEvent("", { key: c, code: "Key" + c.toUpperCase(), keyCode: c.toUpperCase().charCodeAt(0), shiftKey: upper });
    tip.keydown(event);
    tip.keyup(event);
    if (upper) tip.keyup(shift);
    await sleep(gap_ms);
  }
};
const visible_labels = () => {
  const labels = [];
  for (const el of content.document.documentElement.children) walk_hints(el, (label) => {
    const rect = label.getBoundingClientRect();
    if (in_viewport(rect) && label.checkVisibility({ opacityProperty: true, visibilityProperty: true })) labels.push({ text: label.textContent, rect: plain_rect(rect) });
  });
  return labels;
};
const TARGET_SELECTOR = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [onclick], [tabindex]:not([tabindex='-1'])";
const visible_targets = () => [...content.document.querySelectorAll(TARGET_SELECTOR)].filter((el) => {
  const rect = el.getBoundingClientRect();
  if (!in_viewport(rect)) return false;
  const top_element = content.document.elementFromPoint(Math.min(rect.left + rect.width / 2, content.innerWidth - 1), Math.min(rect.top + rect.height / 2, content.innerHeight - 1));
  return !!top_element && (top_element === el || el.contains(top_element));
});
const largest_video = () => [...content.document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
const answer = (name, job) => addMessageListener("rivals:" + name, ({ data }) => { job(data).then(reply, (e) => reply({ error: String(e).slice(0, 300) })); });

answer("page_info", async () => ({ url: String(content.location), title: content.document.title, text: (content.document.body?.innerText ?? "").slice(0, 3000), content_type: content.document.contentType }));

answer("scroll_check", async ({ keys, wait_ms }) => {
  const scrolled = [...content.document.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight).map((el) => [el, el.scrollTop]);
  const window_y = content.scrollY;
  const active = describe(content.document.activeElement);
  await press_keys(keys);
  await sleep(wait_ms);
  let element_dy = 0, element = "none";
  for (const [el, top] of scrolled) if (Math.abs(el.scrollTop - top) > Math.abs(element_dy)) { element_dy = el.scrollTop - top; element = describe(el); }
  return { window_dy: content.scrollY - window_y, element_dy, element, active };
});

answer("hints", async ({ keys, settle_ms }) => {
  const targets = visible_targets();
  last_targets = targets;
  await press_keys(keys);
  await sleep(settle_ms);
  return { labels: visible_labels(), targets: targets.map((el, i) => ({ name: String(i), rect: plain_rect(el.getBoundingClientRect()) })) };
});

answer("label_count", async () => visible_labels().length);

answer("keys", async ({ keys }) => { await press_keys(keys); return 1; });

// Watches what typing the label does: a click or a focus on the page, or a navigation away. A tool can focus or click another element first, so any event on the labelled target counts, and the first event is the fallback.
// The page's timers stop once it unloads, so a navigation answers at once.
// A user's click at the label's spot lands on the element on top there, under the label. The label sits on the tool's own target, which can be an element the rig's target list missed or an overlay over it (YouTube lays one over its buttons). So that element, its inside, and its ancestors short of the body count as the target too.
const has_hint = (el) => { let found = false; walk_hints(el, () => { found = true; }); return found; };
const element_under_label = (at) => (at ? content.document.elementsFromPoint(at.x, at.y).find((el) => !has_hint(el)) ?? null : null);
const is_under_label = (el, under) => !!under && (el === under || under.contains(el) || (el.contains(under) && el !== content.document.body && el !== content.document.documentElement));
answer("activate", ({ keys, target, at, wait_ms }) => new Promise((resolve) => {
  const expected = last_targets[Number(target)];
  const under = element_under_label(at);
  let first = null;
  const finish = (seen) => {
    content.removeEventListener("click", on_event, true);
    content.removeEventListener("focusin", on_event, true);
    content.removeEventListener("pagehide", on_leave, true);
    resolve(seen ?? first ?? { event: null });
  };
  const on_event = (event) => {
    const el = event.target;
    const seen = { event: event.type === "focusin" ? "focus" : "click", tag: describe(el), on_target: !!expected && (el === expected || expected.contains(el) || el.contains(expected)), under_label: is_under_label(el, under) };
    if (seen.on_target || seen.under_label) finish(seen);
    first ??= seen;
  };
  const on_leave = () => finish({ event: "navigated" });
  content.addEventListener("click", on_event, true);
  content.addEventListener("focusin", on_event, true);
  content.addEventListener("pagehide", on_leave, true);
  void press_keys(keys).then(() => content.setTimeout(() => finish(null), wait_ms));
}));

// Follows the focus from the top document into each focused frame of the same origin. A frame of another origin cannot be read from here, so the path stops at it.
const innermost_focus = () => {
  let doc = content.document;
  const path = [];
  for (;;) {
    const active = doc.activeElement;
    path.push(describe(active));
    if (!active || !["iframe", "frame"].includes(active.localName)) return { doc, active, path, cross_origin: false };
    const inner = active.contentDocument;
    if (!inner) return { doc, active, path: [...path, "(frame of another origin)"], cross_origin: true };
    doc = inner;
  }
};
const focus_path = () => {
  const { active, path, cross_origin } = innermost_focus();
  const takes_typing = cross_origin || (!!active && (active.isContentEditable || ["input", "textarea", "select"].includes(active.localName)));
  return { path: path.join(" > "), takes_typing, cross_origin };
};

answer("focus_path", async () => focus_path());

// DesertFox's mode badge carries the mode label for its key test, in the top document.
answer("desertfox_mode", async () => content.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null);

// Infers a tool's mode from what it does with its scroll key. The tools listen in the capture phase on the window and stop a key they take, so a capture listener added after theirs, on the focused document's window, sees the key only if the tool let it through. Capture also runs before the page's own handlers on the field can stop the key.
answer("probe_key", async ({ keys }) => {
  const { doc, cross_origin } = innermost_focus();
  if (cross_origin) return null;
  const seen = { reached: false, prevented: false };
  const on_key = (event) => { seen.reached = true; seen.prevented = event.defaultPrevented; };
  doc.defaultView.addEventListener("keydown", on_key, true);
  await press_keys(keys);
  await sleep(300);
  doc.defaultView.removeEventListener("keydown", on_key, true);
  return seen;
});

// The tool's own leave key, Escape for every tool here, and the focus path before and after it.
answer("leave_key", async () => {
  const before = focus_path();
  send("Escape", "Escape", 27);
  await sleep(600);
  return { before, after: focus_path() };
});

answer("video_state", async () => { const video = largest_video(); return video ? { paused: video.paused, volume: video.muted ? 0 : video.volume } : null; });

// The Sheets name box shows the selected cell.
answer("name_box", async () => content.document.querySelector("#t-name-box")?.value ?? null);

// X marks the post its j moved to by focusing the article.
answer("post_focus", async () => { const post = content.document.activeElement?.closest?.("article"); return post ? [...content.document.querySelectorAll("article")].indexOf(post) : null; });

// pages.mjs writes the embedded player's state onto the body, because the player frame is in another process.
answer("embed_state", async () => {
  const body = content.document.body;
  const state = body.getAttribute("data-yt-state");
  return state === null ? null : { paused: state !== "1" && state !== "3", volume: Number(body.getAttribute("data-yt-volume")) / 100, state: Number(state) };
});

})(); }
