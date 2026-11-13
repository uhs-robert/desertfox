// The pages run.mjs serves. `large` has 20,000 elements (10,000 links and 10,000 divs), the size where hint collection cost shows. `wiki` is a saved long article with many links. `frames` has 100 same-origin iframes of 20 links each, and `frames0` is its top page alone, so (frames minus frames0) / 100 is the cost of one frame.
import { readFileSync } from "node:fs";

const pages_dir = `${process.env.RIVALS_DIR}/pages`;

const links = (count, tag) => Array.from({ length: count }, (_, i) => `<a href="/p?${tag}=${i}">link ${tag} ${i}</a> text <span>x</span>`).join("<br>");

export function page_body(name) {
  if (name === "large") {
    const parts = [];
    for (let i = 0; i < 10000; i++) parts.push(`<a href="/page?id=big_${i}">link ${i}</a><div>plain ${i}</div>`);
    return `<!doctype html><title>large</title><body>${parts.join("")}</body>`;
  }
  if (name === "wiki") return readFileSync(`${pages_dir}/wiki.html`);
  if (name === "frames" || name === "frames0") {
    const frame_count = name === "frames" ? 100 : 0;
    let body = `<!doctype html><title>frames</title><p>top</p>${links(5, "top")}`;
    for (let i = 0; i < frame_count; i++) body += `<iframe src="/frame?i=${i}" width="300" height="80"></iframe>`;
    return body;
  }
  if (name === "frame") return `<!doctype html><title>f</title><body>${links(20, "f")}</body>`;
  return null;
}
