// Turns the per-run JSON files in $RIVALS_DIR/out into $RIVALS_DIR/out/tables.md: medians with min and max per tool and page, plus per-frame and against-baseline rows.
// Only the pages that ran appear, and a derived row is left out when a median it needs is missing.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { PAGE_NAMES, TOOL_NAMES } from "./tools.mjs";

const out_dir = `${process.env.RIVALS_DIR}/out`;
const pass_numbers = (process.env.PASSES ?? "1,2").split(",").map(Number);
const MEGABYTE = 1048576;

const runs_of = {};
const info_of = {};
for (const tool of TOOL_NAMES) {
  for (const pass of pass_numbers) {
    const file = `${out_dir}/${tool}.p${pass}.json`;
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8"));
    info_of[tool] ??= data;
    runs_of[tool] = [...(runs_of[tool] ?? []), ...data.runs];
  }
}
const tools = TOOL_NAMES.filter((tool) => runs_of[tool]);
const ran_pages = PAGE_NAMES.filter((page) => tools.some((tool) => runs_of[tool].some((run) => run.page === page && !run.error)));

const finite_sorted = (values) => values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
function median_of(values) {
  const sorted = finite_sorted(values);
  if (sorted.length === 0) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const format_number = (value) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1));
function summary_of(values) {
  const sorted = finite_sorted(values);
  if (sorted.length === 0) return "-";
  return `${format_number(median_of(sorted))} [${format_number(sorted[0])}-${format_number(sorted.at(-1))}] n=${sorted.length}`;
}

// Timed runs only: run -1 is the warm-up and is read separately.
const values_of = (tool, page, pick) => (runs_of[tool] ?? []).filter((run) => run.page === page && run.run >= 0 && !run.error).map(pick);
const median_for = (tool, page, pick) => median_of(values_of(tool, page, pick));
// A difference is null when either side is missing, so the row is left out instead of showing a zero.
const difference = (a, b) => (a === null || b === null ? null : a - b);
const show = (value, digits) => (value === null ? "-" : value.toFixed(digits));

let markdown = "";
function table(title, pick, unit) {
  markdown += `\n### ${title} (${unit}; median [min-max])\n\n| tool | ${ran_pages.join(" | ")} |\n|---|${ran_pages.map(() => "---").join("|")}|\n`;
  for (const tool of tools) markdown += `| ${tool} | ${ran_pages.map((page) => summary_of(values_of(tool, page, pick))).join(" | ")} |\n`;
}
table("DOMContentLoaded end", (run) => run.dcl, "ms");
table("Load event end", (run) => run.load, "ms");
table("Hint key to first label, first press on the page", (run) => run.press1?.first_ms, "ms");
table("Hint key to first label painted (next animation frame), first press", (run) => run.press1?.paint_ms, "ms");
table("Hint key to first label, second press (warm)", (run) => run.press2?.first_ms, "ms");
table("Labels seen in the top document", (run) => run.press1?.count, "count");
table("Page content process RSS after load", (run) => run.mem_load?.content_rss / MEGABYTE, "MB");
table("Page content process RSS after hints", (run) => run.mem_hints?.content_rss / MEGABYTE, "MB");
table("Extension process RSS after load", (run) => run.mem_load?.ext_rss / MEGABYTE, "MB");
table("Extension process RSS after hints", (run) => run.mem_hints?.ext_rss / MEGABYTE, "MB");
table("Extension heap in the page content process after load (explicit, moz-extension)", (run) => run.mem_load?.content_ext_heap / MEGABYTE, "MB");
table("Extension heap in the page content process after hints", (run) => run.mem_hints?.content_ext_heap / MEGABYTE, "MB");
table("Extension-process heap attributed to moz-extension after load", (run) => run.mem_load?.ext_proc_heap / MEGABYTE, "MB");
table("Extension-process heap attributed to moz-extension after hints", (run) => run.mem_hints?.ext_proc_heap / MEGABYTE, "MB");

if (ran_pages.includes("frames") && ran_pages.includes("frames0")) {
  const frame_count = 100;
  markdown += "\n### Per-frame cost on the 100-iframe page (frames minus frames0, medians)\n\n| tool | load delta ms/frame | content RSS KB/frame | extension heap in content KB/frame | load vs baseline on frames (ms) |\n|---|---|---|---|---|\n";
  const per_frame = (tool, pick, divisor) => {
    const total = difference(median_for(tool, "frames", pick), median_for(tool, "frames0", pick));
    return total === null ? null : total / divisor / frame_count;
  };
  for (const tool of tools) {
    const load_ms = per_frame(tool, (run) => run.load, 1);
    const rss_kb = per_frame(tool, (run) => run.mem_load?.content_rss, 1024);
    const heap_kb = per_frame(tool, (run) => run.mem_load?.content_ext_heap, 1024);
    const load_vs_baseline = tools.includes("none") ? difference(median_for(tool, "frames", (run) => run.load), median_for("none", "frames", (run) => run.load)) : null;
    markdown += `| ${tool} | ${show(load_ms, 2)} | ${show(rss_kb, 0)} | ${show(heap_kb, 0)} | ${show(load_vs_baseline, 0)} |\n`;
  }
}

if (tools.includes("none")) {
  markdown += "\n### Median delta against the no-extension baseline\n\n| tool | page | dcl ms | load ms | content RSS MB after load |\n|---|---|---|---|---|\n";
  for (const tool of tools.filter((name) => name !== "none")) {
    for (const page of ran_pages) {
      const delta = (pick) => difference(median_for(tool, page, pick), median_for("none", page, pick));
      const rss_delta = delta((run) => run.mem_load?.content_rss);
      markdown += `| ${tool} | ${page} | ${show(delta((run) => run.dcl), 0)} | ${show(delta((run) => run.load), 0)} | ${show(rss_delta === null ? null : rss_delta / MEGABYTE, 1)} |\n`;
    }
  }
}

const hint_pages = ran_pages.filter((page) => page !== "frames0");
markdown += `\n### Cold first press (warm-up run, run -1, fresh browser; ms)\n\n| tool | ${hint_pages.join(" | ")} |\n|---|${hint_pages.map(() => "---").join("|")}|\n`;
for (const tool of tools.filter((name) => name !== "none")) {
  const cells = hint_pages.map((page) => (runs_of[tool].find((run) => run.page === page && run.run === -1)?.press1?.first_ms ?? null));
  markdown += `| ${tool} | ${cells.map((value) => show(value, 0)).join(" | ")} |\n`;
}
markdown += `\n### Versions\n\n${tools.map((tool) => `- ${tool}: firefox ${info_of[tool].firefox}, meta ${JSON.stringify(info_of[tool].meta)}`).join("\n")}\n`;
writeFileSync(`${out_dir}/tables.md`, markdown);
console.log(markdown);
