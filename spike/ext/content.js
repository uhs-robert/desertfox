// Spike: report when this script starts, and catch Shift+J/K in the capture phase on window.
const inject_ms = performance.now();
const nav = performance.getEntriesByType("navigation")[0];
browser.runtime.sendMessage({
  kind: "ready", url: location.href, inject_ms,
  response_start_ms: nav ? nav.responseStart : null, ready_state: document.readyState,
});
window.addEventListener("keydown", (event) => {
  if (!event.isTrusted) return;
  if (event.key === "D") { browser.runtime.sendMessage({ kind: "discard_others" }); return; }
  if (event.key !== "J" && event.key !== "K") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  browser.runtime.sendMessage({
    kind: "key", key: event.key, url: location.href, t_ms: performance.now(), ready_state: document.readyState,
  });
}, true);
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.kind !== "bench") return;
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now();
    await browser.runtime.sendMessage({ kind: "ping" });
    samples.push(performance.now() - start);
  }
  browser.runtime.sendMessage({ kind: "bench_result", what: "content_to_background_roundtrip_ms", samples });
});
