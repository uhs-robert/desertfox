// Test pages for the key test. Each page posts what it sees to /report, and the test reads the event list.
import http from "node:http";

const REPORTER = `
const page_id = new URLSearchParams(location.search).get("id") ?? "none";
const send = (type, data = {}) => fetch("/report", {
  method: "POST", keepalive: true, headers: { "content-type": "application/json" },
  body: JSON.stringify({ page_id, type, ...data }),
}).catch(() => {});
send("visibility", { state: document.visibilityState });
document.addEventListener("visibilitychange", () => send("visibility", { state: document.visibilityState }));
let scroll_timer;
addEventListener("scroll", () => {
  clearTimeout(scroll_timer);
  scroll_timer = setTimeout(() => send("scroll", {
    y: scrollY, max_y: document.documentElement.scrollHeight - innerHeight,
    field_top: document.getElementById("field")?.getBoundingClientRect().top,
  }), 150);
});
addEventListener("keydown", (event) => send("keydown", { key: event.key }));
addEventListener("input", (event) => send("input", { value: event.target.value }));
addEventListener("focus", () => send("window_focus"));
const root = document.documentElement;
// The indicator host is in the page, its text is in a closed shadow root, so the label is an attribute.
let last_indicator = "";
new MutationObserver(() => {
  const label = root.querySelector("[data-oasisfox-mode]")?.getAttribute("data-oasisfox-mode") ?? "";
  if (label !== last_indicator) send("indicator", { label: (last_indicator = label) });
}).observe(root, { childList: true });
const report_tree_read = () => {
  const ms = root.getAttribute("data-oasisfox-tree-read-ms");
  if (ms === null) return false;
  send("tree_read", { ms: Number(ms) });
  return true;
};
if (!report_tree_read()) {
  const observer = new MutationObserver(() => { if (report_tree_read()) observer.disconnect(); });
  observer.observe(root, { attributes: true });
}
`;

const page = (title, body = "", head = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body style="margin:0"><h1>${title}</h1>${body}<script>${REPORTER}</script></body></html>`;

const tall_filler = '<div style="height:6000px;background:linear-gradient(#fff,#ccc)"></div>';

const CANCEL_KEYS_IN_CAPTURE = `<script>
  for (const target of [window, document]) for (const type of ["keydown", "keypress", "keyup"])
    target.addEventListener(type, (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
</script>`;

export function start_server() {
  const events = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://x");
    if (url.pathname === "/report" && request.method === "POST") {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        events.push({ at_ms: Date.now(), ...JSON.parse(text) });
        response.writeHead(204).end();
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    const id = url.searchParams.get("id") ?? "none";
    if (url.pathname === "/field") {
      return response.end(page(`field ${id}`, '<input id="field" autofocus>', "<script>addEventListener('load', () => document.getElementById('field').focus())</script>"));
    }
    if (url.pathname === "/aligned") {
      return response.end(page(`aligned ${id}`, `${tall_filler}<input id="field">${tall_filler}`));
    }
    if (url.pathname === "/swallow") return response.end(page(`swallow ${id}`, tall_filler, CANCEL_KEYS_IN_CAPTURE));
    response.end(page(`page ${id}`, tall_filler));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ events, port: server.address().port, close: () => server.close() });
    });
  });
}
