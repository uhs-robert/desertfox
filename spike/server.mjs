// Spike test pages on 127.0.0.1:47801.
import http from "node:http";
import fs from "node:fs";
const pdf = fs.readFileSync(new URL("./doc.pdf", import.meta.url));
const page = (title, body = "", head = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}</body></html>`;
const para = "The quick brown fox jumps over the lazy dog while the reader view checks whether this page holds enough prose to count as an article worth simplifying for a calm reading session. ";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ms = Number(url.searchParams.get("ms") || 3000);
  const html = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  if (url.pathname === "/slow-head") { await sleep(ms); res.writeHead(200, html); return res.end(page(`slow-head ${ms}`)); }
  if (url.pathname === "/slow-body") {
    res.writeHead(200, html);
    res.write(`<!doctype html><html><head><title>slow-body ${ms}</title></head><body><p>start</p>` + " ".repeat(2048));
    await sleep(ms); return res.end("<p>end</p></body></html>");
  }
  if (url.pathname === "/swallow") {
    res.writeHead(200, html);
    return res.end(page("swallow", "<input id=i>", `<script>
      for (const t of [window, document]) for (const type of ["keydown","keypress","keyup"])
        t.addEventListener(type, e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    </script>`));
  }
  if (url.pathname === "/article") {
    res.writeHead(200, html);
    const ps = Array.from({ length: 40 }, () => `<p>${para.repeat(4)}</p>`).join("");
    return res.end(page("A long article", `<article>${ps}</article>`));
  }
  if (url.pathname === "/doc.pdf") { res.writeHead(200, { "content-type": "application/pdf" }); return res.end(pdf); }
  res.writeHead(200, html); res.end(page(url.pathname.slice(1) || "fast"));
}).listen(47801, "127.0.0.1");
