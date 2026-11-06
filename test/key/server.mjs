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
// The toast host is found by its layer, because its text sits in a closed shadow root.
// LAYERS.toast in src/shared/layers.ts. The page script cannot import it.
const TOAST_Z_INDEX = "2147483645";
const toast_host = () => [...root.children].find((child) => child.style.zIndex === TOAST_Z_INDEX);
let last_whichkey = "";
let last_whichkey_shape = "";
let toast_shown = false;
new MutationObserver(() => {
  const label = root.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? "";
  if (label !== last_indicator) send("indicator", { label: (last_indicator = label) });
  const whichkey = root.querySelector("[data-desertfox-whichkey]")?.getAttribute("data-desertfox-whichkey") ?? "";
  if (whichkey !== last_whichkey) send("whichkey", { value: (last_whichkey = whichkey) });
  const panel_host = root.querySelector("[data-desertfox-whichkey]");
  const panel_shape = panel_host ? panel_host.getAttribute("data-desertfox-whichkey-dropped") + ":" + panel_host.getAttribute("data-desertfox-whichkey-width") : "";
  if (panel_shape !== last_whichkey_shape) {
    last_whichkey_shape = panel_shape;
    send("whichkey_shape", { dropped: Number(panel_host?.getAttribute("data-desertfox-whichkey-dropped")), width: Number(panel_host?.getAttribute("data-desertfox-whichkey-width") ?? 0), viewport: window.innerWidth });
  }
  const css = root.querySelector(":scope > style")?.textContent ?? "";
  if (css !== last_css) send("selection_style", { css: (last_css = css) });
  const toast_now = Boolean(toast_host());
  if (toast_now !== toast_shown) send(toast_now ? "toast" : "toast_gone");
  toast_shown = toast_now;
}).observe(root, { childList: true });
const report_tree_read = () => {
  const ms = root.getAttribute("data-desertfox-tree-read-ms");
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
        if (process.env.KEY_TEST_LOG_REPORTS) { const { page_id, type } = events.at(-1); console.log(`report ${events.at(-1).at_ms} ${page_id} ${type}`); }
        response.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === "/icon.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8a33d"/><path d="M5 8l2 2 4-4" fill="none" stroke="#fff" stroke-width="2"/></svg>');
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
    if (url.pathname === "/hoverbox") {
      // Plain divs with a mouseenter listener only, no click role and no CSS :hover rule. The page reports each enter and leave.
      const boxes = '<div id="card" style="width:200px;height:60px;background:#eee">card</div><div id="other" style="width:200px;height:60px;background:#ddd">other</div><div id="menu" style="width:200px;height:80px;background:#ccc">menu<div id="item" style="width:100px;height:30px;background:#bbb">item</div></div>';
      const script = `<script>for (const box of document.querySelectorAll("#card, #other, #menu, #item")) {
  box.addEventListener("mouseenter", () => send("hover_in", { box: box.id }));
  box.addEventListener("mouseleave", () => send("hover_out", { box: box.id }));
}</script>`;
      return response.end(page(`hoverbox ${id}`, boxes + script));
    }
    if (url.pathname === "/chosen") {
      // A custom dropdown that opens on mousedown, as Chosen does: mousedown cancels the default and focuses its own search field. Its click handler only cancels the default. The page reports each mouse event it receives.
      const widget = '<div id="c"><a id="single" href="javascript:void(0)" tabindex="-1">Select</a><ul id="drop" style="position:absolute;left:-9000px"><li><input id="search"></li></ul></div>';
      const script = `<script>const c = document.getElementById("c");
for (const name of ["pointerdown", "mousedown", "mouseup", "click"]) c.addEventListener(name, (event) => { if (name === "click") event.preventDefault(); send("chosen_" + name); });
c.addEventListener("mousedown", (event) => { event.preventDefault(); document.getElementById("drop").style.left = "0"; document.getElementById("search").focus(); send("chosen_open"); })</script>`;
      return response.end(page(`chosen ${id}`, widget + tall_filler + script));
    }
    if (url.pathname === "/scrollbox") {
      // A side panel that scrolls, no tabindex, and a tall page. The box reports its own scrollTop.
      const lines = Array.from({ length: 60 }, (_, index) => `<p>line ${index}</p>`).join("");
      const panel = `<div id="panel" style="position:fixed;right:0;top:0;width:200px;height:200px;overflow:auto;background:#eee">${lines}</div>`;
      const report = '<script>document.getElementById("panel").addEventListener("scroll", () => send("panel_scroll", { top: document.getElementById("panel").scrollTop }))</script>';
      return response.end(page(`scrollbox ${id}`, panel + tall_filler + report));
    }
    if (url.pathname === "/shadowbox") {
      // The same side panel, but inside an open shadow root. After a pick the page sees only the host as focused.
      const lines = Array.from({ length: 60 }, (_, index) => `<p>line ${index}</p>`).join("");
      const host = '<div id="host"></div>';
      const build = `<script>const shadow = document.getElementById("host").attachShadow({ mode: "open" });
shadow.innerHTML = '<div id="panel" style="position:fixed;right:0;top:0;width:200px;height:200px;overflow:auto;background:#eee">${lines}</div>';
shadow.getElementById("panel").addEventListener("scroll", () => send("panel_scroll", { top: shadow.getElementById("panel").scrollTop }))</script>`;
      return response.end(page(`shadowbox ${id}`, host + tall_filler + build));
    }
    if (url.pathname === "/caret_editable_shadow") {
      const build = '<div id="host"></div><script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = \'<div id="editable" contenteditable="true">hello world</div>\'</script>';
      return response.end(page(`caret_editable_shadow ${id}`, "<p>foo bar.baz</p>" + build));
    }
    if (url.pathname === "/headings") {
      // In document order the labels are: the title h1 "a", Intro "s", Below "d", Last "f". The three hidden headings get none, so "d" is Below only when they are dropped.
      const dropped = '<h2 style="visibility:hidden">Hidden</h2><details><summary>More</summary><h3>Closed</h3></details><h2 style="position:absolute;width:1px;height:1px;overflow:hidden">Screen reader only</h2>';
      const filler = '<div style="height:3000px;background:linear-gradient(#fff,#ccc)"></div>';
      const body = `<h2 id="intro">Intro</h2>${dropped}${filler}<div id="below" role="heading" aria-level="2">Below the fold</div>${filler}<h3 id="last">Last</h3>${filler}`;
      return response.end(page(`headings ${id}`, body));
    }
    if (url.pathname === "/headings_many") {
      // Sixty headings, more than the panel shows. "Section 59" is the last row, so its label is below the panel's edge.
      const sections = Array.from({ length: 60 }, (_, index) => `<h2 id="section_${index}">Section ${index}</h2><div style="height:200px"></div>`).join("");
      return response.end(page(`headings_many ${id}`, sections));
    }
    if (url.pathname === "/headings_frames") {
      // Rows: the title, Top and "In frame". The heading in the hidden frame gets none. "In frame" sits low inside a frame that is itself below the top view.
      const inner = '<div style="height:900px"></div><h3 id="in_frame">In frame</h3><div style="height:900px"></div>';
      const frames = `<div style="height:2000px"></div><iframe id="shown" style="display:block;width:400px;height:300px" srcdoc='${inner}'></iframe><iframe id="hidden_frame" style="visibility:hidden;width:400px;height:100px" srcdoc="<h3>Hidden frame</h3>"></iframe><div style="height:3000px"></div>`;
      return response.end(page(`headings_frames ${id}`, `<h2>Top</h2>${frames}`));
    }
    if (url.pathname === "/prose") {
      // The heading, two spans in a wrapper div and a paragraph hold text of their own. The wrapper holds only blanks and children, so it gets no label.
      const body = '<div id="card"> <span>alpha text</span> <span>beta text</span> </div><p>gamma <b>bold</b></p>';
      return response.end(page(`prose ${id}`, body + tall_filler));
    }
    if (url.pathname === "/caret") {
      const text = "<p>foo bar.baz</p><p>second line here</p>";
      return response.end(page(`caret ${id}`, `${text}<input id="paste_target">`));
    }
    if (url.pathname === "/caret_editable") {
      return response.end(page(`caret_editable ${id}`, '<p>foo bar.baz</p><div id="editable" contenteditable="true">hello world</div>'));
    }
    if (url.pathname === "/caret_hint") {
      // The hint targets: a paragraph, an image and a field, each followed by text, and an image with no text after it.
      const body = '<p>alpha one</p><p id="pick">beta two</p><img id="pic" alt="" width="20" height="20" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><p>gamma three</p><input id="field"><p>omega four</p><iframe id="frame" srcdoc="<p id=inner>inner text</p>"></iframe><img id="last" alt="" width="20" height="20" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
      return response.end(page(`caret_hint ${id}`, body));
    }
    if (url.pathname === "/caret_shadow") {
      // An open root, a closed root and an open root inside the closed one. With remove_host in the id, the open host leaves the page a second after the caret first enters it.
      const roots = `<script>
        const open_root = document.getElementById("open_host").attachShadow({ mode: "open" });
        open_root.innerHTML = '<p id="open_text">beta two</p>';
        const closed_root = document.getElementById("closed_host").attachShadow({ mode: "closed" });
        closed_root.innerHTML = '<p id="closed_text">gamma three</p><div id="nested_host"></div>';
        closed_root.getElementById("nested_host").attachShadow({ mode: "open" }).innerHTML = '<p id="nested_text">delta four</p>';
        if (location.search.includes("remove_host")) {
          const watch = () => {
            if (getSelection().anchorNode?.getRootNode() !== open_root) return;
            document.removeEventListener("selectionchange", watch);
            setTimeout(() => document.getElementById("open_host").remove(), 1000);
          };
          document.addEventListener("selectionchange", watch);
        }
      </script>`;
      return response.end(page(`caret_shadow ${id}`, `<p id="before">alpha one</p><div id="open_host"></div><div id="closed_host"></div><p>omega five</p>${roots}`));
    }
    if (url.pathname === "/caret_frames") {
      // A same-origin frame holding another, then a frame from another origin: localhost is not 127.0.0.1.
      // With remove_frame in the id, the frame removes itself (see /caret_frame_inner).
      const inner = `/caret_frame_inner?id=${id}_inner`;
      const frames = `<iframe id="frame" src="${inner}" style="width:400px;height:160px"></iframe><p id="tail">top tail</p><iframe id="xframe" src="http://localhost:${request.socket.localPort}/page?id=${id}_cross" style="width:200px;height:60px"></iframe>`;
      return response.end(page(`caret_frames ${id}`, `<p id="head">top head</p>${frames}`));
    }
    if (url.pathname === "/caret_tall_frame") {
      // A tall same-origin frame below a spacer, with the page scrolled so the frame's text sits on screen. In the frame's own coordinates that text is far below the page's viewport edge, so a wrong space shows as a scroll.
      const inner = '<body style=\'margin:0\'><div style=\'height:1200px\'></div><p>target words</p></body>';
      const frame = `<div style="height:600px"></div><iframe id="tall" srcdoc="${inner}" style="width:400px;height:3000px;border:0;display:block"></iframe>`;
      return response.end(page(`caret_tall_frame ${id}`, frame, "<script>addEventListener('load', () => { scrollTo(0, 1500); document.getElementById('tall').contentWindow.focus(); })</script>"));
    }
    if (url.pathname === "/caret_frame_inner") {
      // With remove_frame in the id, the frame takes itself off its parent a second after the caret first lands in it.
      const remove = id.includes("remove_frame")
        ? `<script>const watch = () => { if (!getSelection().anchorNode) return; document.removeEventListener("selectionchange", watch); setTimeout(() => frameElement.remove(), 1000); }; document.addEventListener("selectionchange", watch);</script>`
        : "";
      const deep = `<iframe id="deep" srcdoc="<p id=deep_text>deep words</p>" style="width:300px;height:50px"></iframe>`;
      return response.end(page(`inner ${id}`, `<p id="inner_text">inner words here</p>${deep}${remove}`));
    }
    if (url.pathname === "/caret_wrap") {
      // Each word fills a screen line: the column is 6 characters wide and the words are 3.
      return response.end(page(`caret_wrap ${id}`, '<p style="width:6ch;font-family:monospace">abc def ghi jkl</p>'));
    }
    if (url.pathname === "/caret_inline_host") {
      // An inline host in the middle of a wrapped paragraph: "aaa mid bbb " fills the first screen line and "ccc ddd eee" the second.
      const root = '<script>document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML = "mid";</script>';
      return response.end(page(`caret_inline_host ${id}`, `<p id="first" style="width:12ch;font-family:monospace">aaa <span id="host"></span> bbb ccc ddd eee</p>${root}`));
    }
    if (url.pathname === "/find_page") {
      // Five matches of "needle": on the page, in a same-origin frame, in an open root, in a closed root, and far below the first screen.
      const roots = `<script>
        document.getElementById("open_host").attachShadow({ mode: "open" }).innerHTML = '<p>needle three</p>';
        document.getElementById("closed_host").attachShadow({ mode: "closed" }).innerHTML = '<p>needle four</p>';
      </script>`;
      const body = `<p id="one">needle one</p><iframe id="frame" srcdoc="<p>needle two</p>" style="width:300px;height:60px"></iframe><div id="open_host"></div><div id="closed_host"></div><div style="height:1800px"></div><p id="five">needle five</p>${roots}`;
      return response.end(page(`find_page ${id}`, body));
    }
    if (url.pathname === "/find_scroll") {
      // Four matches of "marker": one at the top, one far below, one inside a box that scrolls sideways, and one at the bottom of a frame that scrolls itself.
      const inner = "<body style='margin:0'><div style='height:1500px'></div><p>marker four</p></body>";
      const body = `<p id="m1">marker one</p><div style="width:4000px;height:30px"><span style="margin-left:3500px">marker five</span></div><div style="height:2500px"></div><p id="m6" style="width:3ch;word-break:break-all;font-family:monospace">marker</p><div style="height:2500px"></div><p id="m2">marker two</p><div style="height:2500px"></div><div id="wide" style="width:300px;overflow-x:scroll;white-space:nowrap;border:1px solid"><span style="display:inline-block;width:2000px"></span>marker three</div><div style="height:2500px"></div><iframe id="frame" srcdoc="${inner}" style="width:400px;height:200px;display:block"></iframe><div style="height:800px"></div>`;
      // With smooth in the id the page asks for animated scrolls, as many sites do.
      const smooth = id.includes("smooth") ? "<style>html, #wide { scroll-behavior: smooth }</style>" : "";
      return response.end(page(`find_scroll ${id}`, body, smooth));
    }
    if (url.pathname === "/find_frame_visible") {
      // A short frame that scrolls, with its one match in the last 56 pixels of the frame: visible, but under where the command line would sit if the frame were the top window.
      const inner = "<body style='margin:0'><div style='height:150px'></div><p style='margin:0'>marker low</p><div style='height:1500px'></div></body>";
      return response.end(page(`find_frame_visible ${id}`, `<iframe id="frame" srcdoc="${inner}" style="width:400px;height:200px;display:block"></iframe>`));
    }
    if (url.pathname === "/find_big") {
      // Three hundred thousand matches of "e" in one text node, and one "ex" at the end: a scan for "e" takes many slices.
      return response.end(page(`find_big ${id}`, `<p id="big" style="word-break:break-all">${"e ".repeat(Number(/_(\d+)$/.exec(id)?.[1] ?? 300000))}ex</p>`));
    }
    if (url.pathname === "/find_words") {
      // The title in the h1 is the first word on the page, and "find_words" is in three more places. "quick" is a word once, then the start of "quickly" and a word again.
      return response.end(page(`find_words ${id}`, '<p>find_words aa</p><p>find_words bb</p><p>find_words cc</p><p>quick fox</p><p>quickly now</p><p>a quick one</p><input id="paste_target">'));
    }
    if (url.pathname === "/find_case") {
      return response.end(page(`find_case ${id}`, "<p>zeta one</p><p>Zeta two</p><p>zeta three</p>"));
    }
    if (url.pathname === "/find_astral") {
      // A word that starts with a letter outside the basic plane: MATHEMATICAL SCRIPT CAPITAL A, two UTF-16 units.
      return response.end(page(`find_astral ${id}`, "<p>x \u{1D49C}bc y</p><p>\u{1D49C}bc again</p><p>bc</p>"));
    }
    if (url.pathname === "/find_huge") {
      // Five million characters in five thousand paragraphs, past the 4 million that a search reads. The only "needle" is in the first paragraph.
      const filler = "lorem ".repeat(166) + "lore";
      const paragraphs = Array.from({ length: 5000 }, (_, index) => `<p>${index === 0 ? "needle " : ""}${filler}</p>`).join("");
      return response.end(page(`find_huge ${id}`, paragraphs));
    }
    if (url.pathname === "/caret_ft") {
      // Forty rows of 100 pixels, each with one "x" and no other: a screen holds a few, and the rest lie below it.
      const rows = Array.from({ length: 40 }, (_, index) => `<p style="margin:0;height:100px">row ${index} x</p>`).join("");
      return response.end(page(`caret_ft ${id}`, rows));
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
    if (url.pathname === "/iconed") return response.end(page(`iconed ${id}`, "", '<link rel="icon" href="/icon.svg">'));
    if (url.pathname === "/swallow") return response.end(page(`swallow ${id}`, tall_filler, CANCEL_KEYS_IN_CAPTURE));
    response.end(page(`page ${id}`, tall_filler));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ events, port: server.address().port, close: () => server.close() });
    });
  });
}
