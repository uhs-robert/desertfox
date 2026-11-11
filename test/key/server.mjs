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
addEventListener("keydown", (event) => send("keydown", { key: event.key, code: event.code }));
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

// The page still reports each keydown it cancels, so the key probe of the harness works on it. `send` comes from the reporter, which runs later.
const CANCEL_KEYS_IN_CAPTURE = `<script>
  for (const target of [window, document]) for (const type of ["keydown", "keypress", "keyup"])
    target.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (target === window && type === "keydown" && typeof send === "function") send("keydown", { key: event.key, code: event.code });
    }, true);
</script>`;

const CLIP_WEBM_BASE64 = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAL2EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEzTbuMU6uEHFO7a1OsggLg7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhA3UwAAAAAABZUrmvYrgEAAAAAAABP14EBc8WIHDcjzCbgU4ucgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4UBKgXyAOCQsIEQuoEQmoECVbCEVbmBAVXugQDsAQAAAAAAAAIAABJUw2f6c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2My4xLjEwMnNz1WPAi2PFiBw3I8wm4FOLZ8igRaOHRU5DT0RFUkSHk0xhdmM2My4xLjEwMiBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjMwLjAwMDAwMDAwMAAfQ7Z1QSjngQCjvYEAAIDwAgCdASoQABAAAEcIhYWImYSIAgICdaoD+AP6Ag1NtgD+++j//+mTV7YaD/9Mnf/rzAQu4d/660CjrIETiACxAQABEBAAGAAwP/QMAMIA/vvo///pk1e2Gg//TJ3/68wELuHf+utAo6yBJxAAsQEAARAQABgAMD/0DADCAP776P//6ZNXthoP/0yd/+vMBC7h3/rrQKOsgTqYALEBAAEQEAAYADA/9AwAwgD+++j//+mTV7YaD/9Mnf/rzAQu4d/660CjrIFOIACxAQABEBAAGAAwP/QMAMIA/vvo///pk1e2Gg//TJ3/68wELuHf+utAo6yBYagAsQEAARAQABgAMD/0DADCAP776P//6ZNXthoP/0yd/+vMBC7h3/rrQBxTu2uRu4+zgQC3iveBAfGCAbLwgQM=";

// Reports what the media keys change on one video: play and pause, rate, volume, position and picture-in-picture.
const MEDIA_REPORTER = `<script>
function report_media(video, send) {
  const state = () => ({ rate: video.playbackRate, volume: video.volume, muted: video.muted, time: video.currentTime, paused: video.paused });
  for (const type of ["play", "pause", "ratechange", "volumechange", "seeked", "enterpictureinpicture", "leavepictureinpicture"]) video.addEventListener(type, () => send("media_" + type, state()));
}
</script>`;

// The reports in arrival order, and a wait that wakes on each new report. A waiter checks the reports and starts
// listening in one synchronous step, and a report is pushed only between steps, so no report falls between the two.
export function create_event_log() {
  const events = [];
  const listeners = new Set();
  function push(event) {
    events.push(event);
    for (const listener of [...listeners]) listener();
  }
  // Resolves with the first report from `mark` on that matches, or with undefined after timeout_ms. A predicate that
  // throws rejects. Every end removes the listener and the timer.
  function wait_for(mark, predicate, timeout_ms) {
    return new Promise((resolve_wait, reject_wait) => {
      let timer;
      const finish = (settle, value) => {
        clearTimeout(timer);
        listeners.delete(look_for_match);
        settle(value);
      };
      function look_for_match() {
        let found;
        try {
          found = events.slice(mark).find(predicate);
        } catch (error) {
          finish(reject_wait, error);
          return;
        }
        if (found) finish(resolve_wait, found);
      }
      listeners.add(look_for_match);
      timer = setTimeout(() => finish(resolve_wait, undefined), timeout_ms);
      look_for_match();
    });
  }
  return { events, push, wait_for };
}

export function start_server() {
  const event_log = create_event_log();
  const { events } = event_log;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://x");
    if (url.pathname === "/report" && request.method === "POST") {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        event_log.push({ at_ms: Date.now(), ...JSON.parse(text) });
        if (process.env.KEY_TEST_LOG_REPORTS) { const { page_id, type } = events.at(-1); console.log(`report ${events.at(-1).at_ms} ${page_id} ${type}`); }
        response.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === "/icon.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8a33d"/><path d="M5 8l2 2 4-4" fill="none" stroke="#fff" stroke-width="2"/></svg>');
    }
    if (url.pathname === "/tone.wav") {
      // Thirty seconds of silence at 8 kHz, 8 bit mono, so a media element has a source that plays with no network.
      const samples = 8000 * 30;
      const header = Buffer.alloc(44);
      header.write("RIFF", 0); header.writeUInt32LE(36 + samples, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28);
      header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.write("data", 36); header.writeUInt32LE(samples, 40);
      response.writeHead(200, { "content-type": "audio/wav" });
      return response.end(Buffer.concat([header, Buffer.alloc(samples, 0x80)]));
    }
    if (url.pathname === "/clip.webm") {
      // Thirty seconds of a 16 px orange square, one frame per 5 s and no sound: a video track for picture-in-picture, which refuses audio alone. Made with ffmpeg from the lavfi color source.
      response.writeHead(200, { "content-type": "video/webm" });
      return response.end(Buffer.from(CLIP_WEBM_BASE64, "base64"));
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    const id = url.searchParams.get("id") ?? "none";
    if (url.pathname === "/field") {
      return response.end(page(`field ${id}`, '<input id="field" autofocus>', "<script>addEventListener('load', () => document.getElementById('field').focus())</script>"));
    }
    if (url.pathname === "/aligned") {
      return response.end(page(`aligned ${id}`, `${tall_filler}<input id="field">${tall_filler}`));
    }
    if (url.pathname === "/controls") {
      // A text field and a checkbox up top, a control in a disabled fieldset that ]i skips, and a text field far below. The page reports each focus.
      const controls = '<input id="first"><input type="checkbox" id="box"><fieldset disabled><input id="off"></fieldset>' + tall_filler + '<input id="last">';
      return response.end(page(`controls ${id}`, controls, "<script>addEventListener('focusin', (event) => send('focused', { id: event.target.id }))</script>"));
    }
    if (url.pathname === "/closed_field") {
      // A field inside a closed root and a plain button outside. F9 focuses the inner field and F2 the outer one (not F10, whose key-up moves Firefox focus to the menu bar), because the test cannot reach into a closed root. With autofocus in the id, the inner field takes the focus at load. A button sits after the field in the root, so Tab moves focus inside it; "open" in the id makes the root open.
      const build = `<div id="host"></div><button id="outside">outside</button><script>
        const inner = document.getElementById("host").attachShadow({ mode: location.search.includes("open") ? "open" : "closed" });
        inner.innerHTML = '<input id="inner"><button id="inner_button">inner</button>';
        addEventListener("keydown", (event) => {
          if (event.key === "F9") inner.getElementById("inner").focus();
          if (event.key === "F2") document.getElementById("outside").focus();
        });
        if (location.search.includes("autofocus")) addEventListener("load", () => inner.getElementById("inner").focus());
      </script>`;
      return response.end(page(`closed_field ${id}`, build));
    }
    if (url.pathname === "/framed") {
      const frame = '<iframe id="inner" src="/page?id=inner" style="width:300px;height:200px"></iframe>';
      return response.end(page(`framed ${id}`, frame, "<script>addEventListener('load', () => document.getElementById('inner').contentWindow.focus())</script>"));
    }
    if (url.pathname === "/frame_inner") return response.end(page(`frame_inner ${id}`, tall_filler));
    if (url.pathname === "/frames") {
      // A same-origin frame, a frame from another origin (localhost is not 127.0.0.1), and a 10 px tracking frame from another origin too. The top page is tall, so a scroll of it shows where the keys went.
      const port = request.socket.localPort;
      const frames = `<iframe id="same" src="/frame_inner?id=${id}_same" style="display:block;width:300px;height:200px"></iframe><iframe id="cross" src="http://localhost:${port}/frame_inner?id=${id}_cross" style="display:block;width:300px;height:200px"></iframe><iframe id="tiny" src="http://localhost:${port}/frame_inner?id=${id}_tiny" style="display:block;width:10px;height:10px"></iframe>`;
      return response.end(page(`frames ${id}`, frames + tall_filler));
    }
    if (url.pathname === "/hidden_input_frame") {
      // A stand-in for the Google Docs editor: on load the page writes a contenteditable into an offscreen same-origin frame and focuses it.
      // The frame is made the way Docs makes it, with `src="javascript:undefined"`, so its content script starts in the written document.
      // A frame with no src gets its script in the first about:blank document, and `document.open` then removes that script's listeners.
      // The frame's box is the one measured on Docs (625 by 1 at top -10000), and its document is taller than the frame, so a scroll key that lands in the frame shows as a scroll of it.
      // With keyup_refocus in the id, the page focuses the editor again on an Escape keyup in the top document, as Docs does (measured on a real document).
      // With shift_moves_focus in the id, a Shift keydown in the frame moves the focus to the title field, so the keydown and the keyup of one press land in two frames.
      // The top page and the frame report each keyup they get, so a case can tell which half of a press a page saw.
      // With refocus_field in the id, the page puts the focus back in the editor whenever the frame loses it, as an editor that insists on the focus does. With refocus_frame it focuses the frame element, which leaves the frame in normal mode.
      const script = `<script>addEventListener("load", () => {
        const frame = document.createElement("iframe");
        frame.id = "input_frame";
        frame.tabIndex = -1;
        frame.src = "javascript:undefined";
        frame.style.cssText = "position:absolute;top:-10000px;left:0;width:625px;height:1px;border:0;opacity:0";
        document.body.append(frame);
        const inner = frame.contentDocument;
        inner.open();
        inner.write('<!doctype html><body><div id="editor" contenteditable="true"></div><div style="height:400px"></div></body>');
        inner.close();
        const editor = inner.getElementById("editor");
        // The frame reports its keys under its own id, so the key probe can tell that the frame takes them.
        inner.defaultView.addEventListener("keydown", (event) => fetch("/report", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ page_id: page_id + "_frame", type: "keydown", key: event.key, code: event.code }),
        }));
        inner.defaultView.addEventListener("keyup", (event) => fetch("/report", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ page_id: page_id + "_frame", type: "keyup", key: event.key, code: event.code }),
        }));
        addEventListener("keyup", (event) => send("keyup", { key: event.key, code: event.code }));
        // How often the frame's window took the focus, on the body so an extension script can read it. A hand-off loop shows as a count that keeps growing.
        let frame_focuses = 0;
        inner.defaultView.addEventListener("focus", () => (document.body.dataset.frameFocuses = ++frame_focuses));
        // Docs focuses its editor on a mouse press anywhere in the document.
        addEventListener("mousedown", () => editor.focus());
        if (page_id.includes("refocus_field")) inner.defaultView.addEventListener("blur", () => setTimeout(() => editor.focus()));
        if (page_id.includes("refocus_frame")) inner.defaultView.addEventListener("blur", () => setTimeout(() => frame.focus()));
        if (page_id.includes("keyup_refocus")) addEventListener("keyup", (event) => {
          if (event.key === "Escape") { inner.defaultView.focus(); editor.focus(); }
        });
        if (page_id.includes("shift_moves_focus")) inner.defaultView.addEventListener("keydown", (event) => {
          if (event.key === "Shift") document.getElementById("title").focus();
        });
        editor.focus();
      })</script>`;
      // With title_input in the id, the page shows a field of its own above the document, as Docs does with its title.
      const title_input = id.includes("title_input") ? '<input id="title">' : "";
      return response.end(page(`hidden_input_frame ${id}`, title_input + tall_filler, script));
    }
    // A frame whose whole document is the editor, as an iframe rich-text editor makes it: the body is contenteditable, or the document is in designMode. The body takes the focus and cannot be blurred.
    if (url.pathname === "/body_editor_frame" || url.pathname === "/design_mode_frame") {
      const turn_on = url.pathname === "/design_mode_frame" ? 'document.designMode = "on"' : 'document.body.contentEditable = "true"';
      const frame = `<iframe id="inner" src="/body_editor?id=${id}_frame&turn_on=${encodeURIComponent(turn_on)}" style="width:300px;height:200px"></iframe>`;
      const focus_body = "<script>addEventListener('load', () => { const inner = document.getElementById('inner'); inner.contentWindow.focus(); inner.contentDocument.body.focus(); })</script>";
      return response.end(page(`body_editor_frame ${id}`, frame + focus_body));
    }
    if (url.pathname === "/body_editor") return response.end(page(`body_editor ${id}`, `${tall_filler}<script>${url.searchParams.get("turn_on")}</script>`));
    if (url.pathname === "/cell_editor") {
      // A stand-in for the Google Sheets cell editor: one contenteditable that holds the focus from load on. While a cell is only selected it is parked off screen, empty and with no width.
      // Enter starts an edit, which moves the box over a cell and gives it a width, and Enter again ends it. A double-click on the cell starts an edit with no key, and a click on it ends one.
      const editor = '<div id="cell" style="position:fixed;top:100px;left:100px;width:114px;height:20px"></div><div id="box" style="position:absolute;top:-10000px;left:0"><div id="waffle-rich-text-editor" contenteditable="true" style="outline:0"></div></div>';
      const script = `<script>
        const box = document.getElementById("box");
        const editor = document.getElementById("waffle-rich-text-editor");
        let editing = false;
        function start_edit() { editing = true; box.style.cssText = "position:fixed;top:100px;left:100px;min-width:114px;background:#fff"; }
        function end_edit() { editing = false; box.style.cssText = "position:absolute;top:-10000px;left:0"; editor.textContent = ""; }
        addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (editing) end_edit(); else start_edit();
        });
        const cell = document.getElementById("cell");
        cell.addEventListener("dblclick", start_edit);
        cell.addEventListener("click", end_edit);
        editor.focus();
      </script>`;
      return response.end(page(`cell_editor ${id}`, editor + tall_filler + script));
    }
    // Answers after `ms`, so a page that embeds it stays in its load that long.
    if (url.pathname === "/slow_pixel") return void setTimeout(() => response.end(), Number(url.searchParams.get("ms")));
    if (url.pathname === "/replaces_address") {
      // Changes its own address while it still loads, as Google Docs does. Firefox reports that to the extension like the start of a new page.
      const script = `<script>setTimeout(() => history.replaceState(null, "", location.href + "&replaced=1"), 300)</script>`;
      return response.end(page(`replaces_address ${id}`, '<img src="/slow_pixel?ms=2500">' + tall_filler, script));
    }
    if (url.pathname === "/hints") {
      const covered = '<div style="position:relative;width:200px"><a href="/page?id=hint_covered">covered</a><div style="position:absolute;inset:0;background:#fff"></div></div>';
      const links = `<a href="/page?id=hint_hidden" style="display:none">hidden</a>${covered}<p><a href="/page?id=hint_one">one</a></p><p><a href="/page?id=hint_two">two</a></p>`;
      return response.end(page(`hints ${id}`, links + tall_filler));
    }
    if (url.pathname === "/follow_rel") {
      // The head link is the rel match. The visible text link would match a pattern too, so the test shows rel wins.
      const head = '<link rel="next" href="/page?id=follow_rel_next"><link rel="prev" href="/page?id=follow_rel_prev">';
      return response.end(page(`follow_rel ${id}`, '<a href="/page?id=follow_text_decoy">Next</a>' + tall_filler, head));
    }
    if (url.pathname === "/follow_text") {
      // Both links sit below a tall filler, because a next link is usually off-screen.
      const links = '<a href="/page?id=follow_text_prev">Previous</a> <a href="/page?id=follow_text_next">Next</a>';
      return response.end(page(`follow_text ${id}`, tall_filler + links));
    }
    if (url.pathname === "/media") {
      // A video in a player box of its own size, under an overlay that catches the pointer as a site's controls do, and a hidden audio.
      const player = '<div id="player" style="position:relative;width:320px;height:180px;background:#222"><video id="video" src="/tone.wav" loop style="width:320px;height:180px"></video><div style="position:absolute;inset:0"></div></div>';
      const hidden_audio = '<audio id="hidden_audio" src="/tone.wav"></audio>';
      const script = `<script>const video = document.getElementById("video");
video.addEventListener("play", () => send("media_play"));
document.getElementById("hidden_audio").addEventListener("play", () => send("audio_play"));
video.addEventListener("pause", () => send("media_pause"));
video.addEventListener("volumechange", () => send("media_volume", { muted: video.muted }));
document.addEventListener("fullscreenchange", () => send("media_fullscreen", { element: document.fullscreenElement ? document.fullscreenElement.id : "" }));</script>`;
      return response.end(page(`media ${id}`, player + hidden_audio + script));
    }
    if (url.pathname === "/media_frames") {
      // A large paused video on top, and a frame from another origin (localhost is not 127.0.0.1) whose small muted video plays in a closed shadow root. Beside them a sandboxed frame and an about:blank frame, where a script may be refused.
      // "audible" or "clip" in the id leaves out the top video and makes the framed one paused, with sound or with a picture.
      const framed_only = id.includes("audible") || id.includes("clip");
      const top_video = framed_only ? "" : '<video id="video" src="/clip.webm" loop style="display:block;width:320px;height:180px"></video>';
      const frame = `<iframe id="frame" src="http://localhost:${request.socket.localPort}/media_inner?id=${id}_inner" style="display:block;width:220px;height:240px"></iframe>`;
      const refusing = '<iframe sandbox srcdoc="<video src=/tone.wav></video>" style="width:50px;height:30px"></iframe><iframe src="about:blank" style="width:50px;height:30px"></iframe>';
      const watch_top = framed_only ? "" : '<script>addEventListener("DOMContentLoaded", () => report_media(document.getElementById("video"), send));</script>';
      return response.end(page(`media_frames ${id}`, top_video + frame + refusing, MEDIA_REPORTER + watch_top));
    }
    if (url.pathname === "/media_inner") {
      const attributes = id.includes("audible") ? 'src="/tone.wav"' : id.includes("clip") ? 'src="/clip.webm"' : 'src="/tone.wav" muted autoplay';
      // `send` comes from the reporter, which runs after this script, so the call looks it up at each event.
      const build = `<div id="host"></div><script>
        const closed_root = document.getElementById("host").attachShadow({ mode: "closed" });
        closed_root.innerHTML = '<video ${attributes} loop style="width:160px;height:90px"></video>';
        report_media(closed_root.querySelector("video"), (type, data) => send(type, data));
      </script>`;
      return response.end(page(`media_inner ${id}`, build, MEDIA_REPORTER));
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
      // A custom dropdown that opens on mousedown, as Chosen does: mousedown cancels the default and focuses its own search field. Its click handler only cancels the default. The page reports each mouse event it receives and keeps their order in `chosen_order`, because reports sent within a millisecond can reach the server out of order.
      const widget = '<div id="c"><a id="single" href="javascript:void(0)" tabindex="-1">Select</a><ul id="drop" style="position:absolute;left:-9000px"><li><input id="search"></li></ul></div>';
      const script = `<script>const c = document.getElementById("c");
window.chosen_order = [];
for (const name of ["pointerdown", "mousedown", "mouseup", "click"]) c.addEventListener(name, (event) => { if (name === "click") event.preventDefault(); window.chosen_order.push("chosen_" + name); send("chosen_" + name); });
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
    if (url.pathname === "/headings_end") {
      // Headings b, c and d sit in the last 260px, so the page cannot scroll them to the top of the view. In page order: title, a, b, c, d.
      const gap = '<div style="height:60px"></div>';
      return response.end(page(`headings_end ${id}`, `<h2 id="a">A</h2><div style="height:3000px"></div><h2 id="b">B</h2>${gap}<h2 id="c">C</h2>${gap}<h2 id="d">D</h2>${gap}`));
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
      // The frame reports its keydowns only, as ${id}_frame, so the key probe of the harness can see that keys reach it.
      const report_keys = `<script>addEventListener('keydown', (event) => fetch('/report', { method: 'POST', body: JSON.stringify({ page_id: '${id}_frame', type: 'keydown', key: event.key, code: event.code }) }))</script>`;
      const inner = `<body style='margin:0'><div style='height:1200px'></div><p>target words</p>${report_keys}</body>`;
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
    if (url.pathname === "/caret_added") {
      // The text arrives after the caret session has read the page, so it is newer than the session's model.
      const added = `<script>document.addEventListener("selectionchange", () => setTimeout(() => { if (document.getElementById("added")) return; document.body.insertAdjacentHTML("beforeend", "<p id=added>zebra words</p>"); send("text_added"); }, 500), { once: true });</script>`;
      return response.end(page(`caret_added ${id}`, `<p>foo bar</p>${added}`));
    }
    if (url.pathname === "/caret_wrap") {
      // Each word fills a screen line: the column is 6 characters wide and the words are 3.
      return response.end(page(`caret_wrap ${id}`, '<p style="width:6ch;font-family:monospace">abc def ghi jkl</p><input id="paste_target">'));
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
    if (url.pathname === "/find_field") {
      // "needle" in two paragraphs and in an input, a textarea and a contenteditable. Search leaves the three fields out, so only the paragraphs match.
      const body = '<p id="a">needle one</p><input id="f" value="needle in input"><textarea id="t">needle in textarea</textarea><div id="e" contenteditable>needle in editable</div><p id="z">needle two</p>';
      return response.end(page(`find_field ${id}`, body));
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
      resolve({ events, wait_for_event: event_log.wait_for, port: server.address().port, close: () => server.close() });
    });
  });
}
