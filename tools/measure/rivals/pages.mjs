import { readFileSync } from "node:fs";
const dir = `${process.env.RIVALS_DIR}/pages`;
const links = (n, tag) => Array.from({ length: n }, (_, i) => `<a href="/p?${tag}=${i}">link ${tag} ${i}</a> text <span>x</span>`).join("<br>");
export function page_body(name, url) {
  if (name === "large") {
    const parts = [];
    for (let i = 0; i < 10000; i++) parts.push(`<a href="/page?id=big_${i}">link ${i}</a><div>plain ${i}</div>`);
    return `<!doctype html><title>large</title><body>${parts.join("")}</body>`;
  }
  if (name === "wiki") return readFileSync(`${dir}/wiki.html`);
  if (name === "frames" || name === "frames0") {
    const n = name === "frames" ? 100 : 0;
    let body = `<!doctype html><title>frames</title><p>top</p>${links(5, "top")}`;
    for (let i = 0; i < n; i++) body += `<iframe src="/frame?i=${i}" width="300" height="80"></iframe>`;
    return body;
  }
  if (name === "frame") return `<!doctype html><title>f</title><body>${links(20, "f")}</body>`;
  return null;
}
