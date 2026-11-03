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
document.addEventListener("selectionchange", () => send("selection", { text: String(getSelection()), scroll_y: scrollY, pane_top: document.getElementById("pane")?.scrollTop ?? null, top: getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect().top : null }));
addEventListener("input", (event) => send("input", { value: event.target.value }));
addEventListener("focus", () => send("window_focus"));
const root = document.documentElement;
// The indicator host is in the page, its text is in a closed shadow root, so the label is an attribute.
let last_indicator = "";
let last_css = "";
// The toast host is the other floating surface: no mode attribute, and its text sits in a closed shadow root.
const toast_host = () => [...root.children].find((child) => child.style.position === "fixed" && !child.hasAttribute("data-oasisfox-mode") && !child.hasAttribute("data-oasisfox-whichkey"));
let last_whichkey = "";
let toast_shown = false;
new MutationObserver(() => {
  const label = root.querySelector("[data-oasisfox-mode]")?.getAttribute("data-oasisfox-mode") ?? "";
  if (label !== last_indicator) send("indicator", { label: (last_indicator = label) });
  const whichkey = root.querySelector("[data-oasisfox-whichkey]")?.getAttribute("data-oasisfox-whichkey") ?? "";
  if (whichkey !== last_whichkey) send("whichkey", { value: (last_whichkey = whichkey) });
  const css = root.querySelector(":scope > style")?.textContent ?? "";
  if (css !== last_css) send("selection_style", { css: (last_css = css) });
  const toast_now = Boolean(toast_host());
  if (toast_now !== toast_shown) send(toast_now ? "toast" : "toast_gone");
  toast_shown = toast_now;
}).observe(root, { childList: true });
const report_tree_read = () => {
  const ms = root.getAttribute("data-oasisfox-tree-read-ms");
  if (ms === null) return false;
  send("tree_read", { ms: Number(ms), search: location.search });
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
    if (url.pathname === "/framed") {
      const frame = '<iframe id="inner" src="/page?id=inner" style="width:300px;height:200px"></iframe>';
      return response.end(page(`framed ${id}`, frame, "<script>addEventListener('load', () => document.getElementById('inner').contentWindow.focus())</script>"));
    }
    if (url.pathname === "/hints") {
      const covered = '<div style="position:relative;width:200px"><a href="/page?id=hint_covered">covered</a><div style="position:absolute;inset:0;background:#fff"></div></div>';
      const links = `<a href="/page?id=hint_hidden" style="display:none">hidden</a>${covered}<p><a href="/page?id=hint_one">one</a></p><p><a href="/page?id=hint_two">two</a></p>`;
      return response.end(page(`hints ${id}`, links + tall_filler));
    }
    if (url.pathname === "/caret" || url.pathname === "/caret_themed") {
      const text = "<p>foo bar.baz</p><p>second line here</p>";
      // caret_themed sets a non-default palette on the page, for the surfaces to inherit.
      const theme = url.pathname === "/caret_themed" ? "<style>:root { --oasisfox-bg: #3b1d4a; --oasisfox-fg: #f4e6ff; --oasisfox-accent: #ff6ec7; --oasisfox-secondary: #9bffb0; }</style>" : "";
      return response.end(page(`caret ${id}`, `${text}<input id="paste_target">`, theme));
    }
    if (url.pathname === "/caret_wrap") {
      // Each word fills a screen line: the column is 6 characters wide and the words are 3.
      return response.end(page(`caret_wrap ${id}`, '<p style="width:6ch;font-family:monospace">abc def ghi jkl</p>'));
    }
    if (url.pathname === "/caret_columns") {
      // The middle line is short: j over it must still come back to the column the caret left.
      return response.end(page(`caret_columns ${id}`, '<p style="font-family:monospace">abcdefghij<br>ab<br>abcdefghij</p>'));
    }
    if (url.pathname === "/caret_long_columns") {
      // Far more lines than the screen holds, a long line then a short one, so j crosses the bottom edge many times.
      return response.end(page(`caret_long_columns ${id}`, `<p style="font-family:monospace">${"abcdefghij<br>ab<br>".repeat(120)}</p>`));
    }
    if (url.pathname === "/caret_nested") {
      const lines = Array.from({ length: 100 }, (_, index) => `<div>line ${index}</div>`).join("");
      return response.end(page(`caret_nested ${id}`, `<div id="pane" style="height:200px;width:300px;overflow:auto;font-family:monospace">${lines}</div>`));
    }
    if (url.pathname === "/caret_scrolled") {
      const words = Array.from({ length: 1500 }, (_, index) => `w${String(index).padStart(4, "0")}`).join(" ");
      return response.end(page(`caret_scrolled ${id}`, `<p style="width:30ch;font-family:monospace">${words}</p><script>addEventListener("load", () => scrollTo(0, 3000))</script>`));
    }
    if (url.pathname === "/caret_bug_lines") {
      const kind = (url.searchParams.get("id") ?? "").replace(/^lines_/, "");
      const bodies = {
        blocks: "<p>one two</p><p>three four</p><p>five six</p><p>seven</p>",
        empty_line: '<p style="font-family:monospace">abc<br><br>def<br><br><br>ghi</p>',
        links: '<p>some <a href="/x">link text</a> more</p><p>next <b>bold</b> line</p><p>last</p>',
        pre: "<pre>abc\n\ndef\n  ghi\n\njkl</pre>",
        lists: "<ul><li>alpha</li><li>beta <em>gamma</em></li><li>delta</li></ul><p>tail</p>",
        wrapped_blocks: '<p style="width:8ch;font-family:monospace">aaa bbb ccc ddd</p><p style="width:8ch;font-family:monospace">eee fff ggg</p>',
      };
      return response.end(page(`caret_bug_lines ${id}`, bodies[kind] ?? ""));
    }
    if (url.pathname === "/caret_bug_find") {
      const filler = Array.from({ length: 60 }, (_, index) => `<p>filler line ${index} with some text</p>`).join("");
      return response.end(page(`caret_bug_find ${id}`, `<p>start of page</p>${filler}<p>the needle sits here</p>${filler}`));
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
