if (!this.__rivals_loaded) { this.__rivals_loaded = 1; (function(){
// Frame script: runs in the content process of the test tab, with Xray access to the page, so it can read closed shadow roots.
// For the timing pages it sends the key and watches for labels in one process, so one clock covers both ends. The live-site check sends its keys from the parent process instead (run.mjs).
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


// The live-site checks (PAGES=sites). run.mjs sends every key of these checks through the parent process, so here a check is a pair: one message reads or arms before the key, one reads after it.
// This script reports facts only. sites.mjs judges them. State between messages lives here: the targets of the last hint check, the scrollable elements of the last baseline and the armed activation.
let last_targets = [];
let scrollables = [];
let armed = null;
const plain_rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
const in_viewport = (rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < content.innerHeight && rect.left < content.innerWidth;
const describe = (el) => (el ? el.localName + (el.id ? "#" + el.id : "") : "none");
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

// The baseline of the scroll check, taken just before the key: the window's offset and each element that can scroll vertically, with the area of it inside the viewport. sites.mjs picks the main scroller from them.
answer("scroll_baseline", async () => {
  const can_scroll = (el) => el.scrollHeight > el.clientHeight + 1 && ["auto", "scroll", "overlay"].includes(content.getComputedStyle(el).overflowY);
  scrollables = [...content.document.querySelectorAll("*")].filter(can_scroll);
  const visible_area = (el) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(rect.right, content.innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, content.innerHeight) - Math.max(rect.top, 0));
  };
  return { window_y: content.scrollY, viewport_area: content.innerWidth * content.innerHeight, candidates: scrollables.map((el, index) => ({ index, name: describe(el), visible_area: visible_area(el), top: el.scrollTop })) };
});
answer("scroll_now", async () => ({ window_y: content.scrollY, tops: scrollables.map((el) => el.scrollTop) }));

answer("hint_targets", async ({ activate_selector }) => {
  last_targets = visible_targets();
  return last_targets.map((el, i) => ({ name: String(i), rect: plain_rect(el.getBoundingClientRect()), chosen: !!activate_selector && el.matches(activate_selector) }));
});
answer("top_labels", async () => visible_labels());

// Arms the activation check before run.mjs types the label: a click or a focus on the page, and a page hide when it navigates. The first event on the labelled target or inside it wins, else the first event is kept, so sites.mjs sees what happened.
// A navigation into another content process takes this script's state with it, so run.mjs keeps the expected address returned here and compares the new address itself.
answer("arm_activation", async ({ target }) => {
  const expected = last_targets[Number(target)] ?? null;
  const record = { event: null, relation: null, tag: null, navigated: false };
  const on_event = (event) => {
    const el = event.target;
    const relation = !expected ? "other" : el === expected ? "self" : expected.contains(el) ? "inside" : "other";
    if (record.event && (record.relation !== "other" || relation === "other")) return;
    Object.assign(record, { event: event.type === "focusin" ? "focus" : "click", relation, tag: describe(el) });
  };
  const on_hide = () => { record.navigated = true; };
  const page = content;
  page.addEventListener("click", on_event, true);
  page.addEventListener("focusin", on_event, true);
  page.addEventListener("pagehide", on_hide, true);
  armed = { record, disarm: () => { for (const [type, listener] of [["click", on_event], ["focusin", on_event], ["pagehide", on_hide]]) page.removeEventListener(type, listener, true); } };
  return { expected_href: expected?.localName === "a" ? expected.href : null, tag: describe(expected) };
});
answer("activation_result", async () => {
  if (!armed) return null;
  armed.disarm();
  const { record } = armed;
  armed = null;
  return record;
});

// DesertFox's mode badge carries the mode label for its key test, in the top document.
answer("desertfox_mode", async () => content.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null);

answer("video_state", async () => { const video = largest_video(); return video ? { paused: video.paused, volume: video.muted ? 0 : video.volume } : null; });

// The Sheets name box shows the selected cell.
answer("name_box", async () => content.document.querySelector("#t-name-box")?.value ?? null);

// What the view of a canvas or grid site shows, as plain facts for judge_movement in sites.mjs. The Maps address and the Excalidraw state save are debounced, so run.mjs waits before the second read.
// Monaco marks the cursor's line number with active-line-number. The Sheets grid offset is the scroll position of its vertical scroll bar element.
answer("move_state", async ({ probe }) => {
  const doc = content.document;
  if (probe === "maps") return { url: String(content.location) };
  if (probe === "excalidraw") return { state: content.localStorage.getItem("excalidraw-state") };
  if (probe === "stackblitz") return { line_numbers: [...doc.querySelectorAll(".monaco-editor .line-numbers")].map((el) => el.textContent), cursor_lines: [...doc.querySelectorAll(".monaco-editor .active-line-number")].map((el) => el.textContent) };
  if (probe === "sheets") return { cell: doc.querySelector("#t-name-box")?.value ?? null, grid_offset: doc.querySelector(".native-scrollbar-y")?.scrollTop ?? null };
  return null;
});

// Puts the focus where a click on the site's work area would, for the control pass: the site's own key reaches the map, the canvas or the editor only from there. Sheets has the focus on its grid already.
const VIEW_SELECTORS = { maps: "[role=application]", excalidraw: ".excalidraw canvas.interactive", stackblitz: ".monaco-editor textarea" };
answer("focus_view", async ({ probe }) => {
  const el = VIEW_SELECTORS[probe] ? content.document.querySelector(VIEW_SELECTORS[probe]) : null;
  el?.focus();
  return { focused: describe(content.document.activeElement) };
});

// X marks the post its j moved to by focusing the article.
answer("post_focus", async () => { const post = content.document.activeElement?.closest?.("article"); return post ? [...content.document.querySelectorAll("article")].indexOf(post) : null; });

// pages.mjs writes the embedded player's state onto the body, because the player frame is in another process.
answer("embed_state", async () => {
  const body = content.document.body;
  const state = body.getAttribute("data-yt-state");
  return state === null ? null : { paused: state !== "1" && state !== "3", volume: Number(body.getAttribute("data-yt-volume")) / 100, state: Number(state) };
});

})(); }
