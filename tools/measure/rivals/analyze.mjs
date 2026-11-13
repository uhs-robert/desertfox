import { readFileSync, existsSync, writeFileSync } from "node:fs";
const out_dir = `${process.env.RIVALS_DIR}/out`;
const cfgs = ["none", "desertfox", "vimium", "vimiumc", "tridactyl"];
const pages = ["large", "wiki", "frames", "frames0"];
const data = {};
for (const c of cfgs) for (const pass of (process.env.PASSES ?? "1,2").split(",").map(Number)) { const f = `${out_dir}/${c}.p${pass}.json`; if (!existsSync(f)) continue; const d = JSON.parse(readFileSync(f, "utf8")); if (!data[c]) data[c] = d; else data[c].runs.push(...d.runs.map((r) => ({ ...r, pass }))); }
const med = (a) => { a = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const stat = (a) => { a = a.filter((x) => x != null && Number.isFinite(x)); if (!a.length) return "-"; const s = [...a].sort((x, y) => x - y); const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)); return `${f(med(a))} [${f(s[0])}-${f(s.at(-1))}] n=${a.length}`; };
const MB = 1048576;
const get = (c, p, fn) => (data[c]?.runs ?? []).filter((r) => r.page === p && r.run >= 0 && !r.error).map(fn);
let md = "";
const table = (title, fn, unit) => {
  md += `\n### ${title} (${unit}; median [min-max])\n\n| tool | ${pages.join(" | ")} |\n|---|${pages.map(() => "---").join("|")}|\n`;
  for (const c of cfgs) if (data[c]) md += `| ${c} | ${pages.map((p) => stat(get(c, p, fn))).join(" | ")} |\n`;
};
table("DOMContentLoaded end", (r) => r.dcl, "ms");
table("Load event end", (r) => r.load, "ms");
table("Hint key to first label, first press on the page", (r) => r.press1?.first_ms, "ms");
table("Hint key to first label painted (next rAF), first press", (r) => r.press1?.paint_ms, "ms");
table("Hint key to first label, second press (warm)", (r) => r.press2?.first_ms, "ms");
table("Labels seen in the top document", (r) => r.press1?.count, "count");
table("Page content process RSS after load", (r) => r.mem_load?.content_rss / MB, "MB");
table("Page content process RSS after hints", (r) => r.mem_hints?.content_rss / MB, "MB");
table("Extension process RSS after load", (r) => r.mem_load?.ext_rss / MB, "MB");
table("Extension process RSS after hints", (r) => r.mem_hints?.ext_rss / MB, "MB");
table("Extension heap inside the page content process after load (explicit, moz-extension)", (r) => r.mem_load?.content_ext_heap / MB, "MB");
table("Extension heap inside the page content process after hints", (r) => r.mem_hints?.content_ext_heap / MB, "MB");
table("Extension-process heap attributed to moz-extension after load", (r) => r.mem_load?.ext_proc_heap / MB, "MB");
table("Extension-process heap attributed to moz-extension after hints", (r) => r.mem_hints?.ext_proc_heap / MB, "MB");
// per-frame
md += "\n### Per-frame cost on the 100-iframe page (frames minus frames0, medians)\n\n| tool | load delta ms/frame | content RSS KB/frame | extension heap in content KB/frame | page load vs baseline, frames (ms) |\n|---|---|---|---|---|\n";
const m1 = (c, p, fn) => med(get(c, p, fn));
for (const c of cfgs) if (data[c]) {
  const lo = (m1(c, "frames", (r) => r.load) - m1(c, "frames0", (r) => r.load)) / 100;
  const rss = (m1(c, "frames", (r) => r.mem_load?.content_rss) - m1(c, "frames0", (r) => r.mem_load?.content_rss)) / 1024 / 100;
  const hp = (m1(c, "frames", (r) => r.mem_load?.content_ext_heap) - m1(c, "frames0", (r) => r.mem_load?.content_ext_heap)) / 1024 / 100;
  const vs = m1(c, "frames", (r) => r.load) - (data.none ? m1("none", "frames", (r) => r.load) : 0);
  md += `| ${c} | ${lo.toFixed(2)} | ${rss.toFixed(0)} | ${hp.toFixed(0)} | ${vs.toFixed(0)} |\n`;
}
// delta vs baseline summary
md += "\n### Median delta against the no-extension baseline\n\n| tool | page | dcl ms | load ms | content RSS MB after load |\n|---|---|---|---|---|\n";
for (const c of cfgs.slice(1)) if (data[c]) for (const p of pages) {
  const d = (fn) => m1(c, p, fn) - m1("none", p, fn);
  md += `| ${c} | ${p} | ${d((r) => r.dcl).toFixed(0)} | ${d((r) => r.load).toFixed(0)} | ${(d((r) => r.mem_load?.content_rss) / MB).toFixed(1)} |\n`;
}
md += "\n### Cold first press (warm-up run, run -1, fresh browser)\n\n| tool | " + pages.slice(0, 3).join(" | ") + " |\n|---|---|---|---|\n";
for (const c of cfgs.slice(1)) if (data[c]) md += `| ${c} | ${pages.slice(0, 3).map((p) => { const r = data[c].runs.find((x) => x.page === p && x.run === -1); return r?.press1?.first_ms?.toFixed(0) ?? "-"; }).join(" | ")} |\n`;
md += "\n### Versions\n\n" + cfgs.map((c) => data[c] ? `- ${c}: firefox ${data[c].firefox}, meta ${JSON.stringify(data[c].meta)}` : "").join("\n") + "\n";
writeFileSync(`${out_dir}/tables.md`, md);
console.log(md);
