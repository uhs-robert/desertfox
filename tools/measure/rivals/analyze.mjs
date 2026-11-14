// Turns the per-run JSON files in $RIVALS_DIR/out into $RIVALS_DIR/out/tables.md: medians with min and max per tool and page, plus per-frame and against-baseline rows.
// Only the pages that ran appear, and a derived row is left out when a median it needs is missing.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { sites_table } from "./sites.mjs";
import { PAGE_NAMES, TOOL_NAMES } from "./tools.mjs";

const out_dir = `${process.env.RIVALS_DIR}/out`;
const pass_numbers = (process.env.PASSES ?? "1,2").split(",").map(Number);
const MEGABYTE = 1048576;
// A missing sample stays null: dividing null would give a measured zero.
const to_mb = (bytes) => (typeof bytes === "number" ? bytes / MEGABYTE : null);

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
// A run of only the live-site check or only the tab switch has no timing page, and the timing tables would be empty.
const timing_ran = ran_pages.length > 0;
function table(title, pick, unit) {
  markdown += `\n### ${title} (${unit}; median [min-max])\n\n| tool | ${ran_pages.join(" | ")} |\n|---|${ran_pages.map(() => "---").join("|")}|\n`;
  for (const tool of tools) markdown += `| ${tool} | ${ran_pages.map((page) => summary_of(values_of(tool, page, pick))).join(" | ")} |\n`;
}
if (timing_ran) {
  table("DOMContentLoaded end", (run) => run.dcl, "ms");
  table("Load event end", (run) => run.load, "ms");
  table("Hint key to first label, first press on the page", (run) => run.press1?.first_ms, "ms");
  table("Hint key to first label painted (next animation frame), first press", (run) => run.press1?.paint_ms, "ms");
  table("Hint key to first label, second press (warm)", (run) => run.press2?.first_ms, "ms");
  table("Labels seen in the top document", (run) => run.press1?.count, "count");
  table("Page content process RSS after load", (run) => to_mb(run.mem_load?.content_rss), "MB");
  table("Page content process RSS after hints", (run) => to_mb(run.mem_hints?.content_rss), "MB");
  table("Extension process RSS after load", (run) => to_mb(run.mem_load?.ext_rss), "MB");
  table("Extension process RSS after hints", (run) => to_mb(run.mem_hints?.ext_rss), "MB");
  table("Extension heap in the page content process after load (explicit, moz-extension)", (run) => to_mb(run.mem_load?.content_ext_heap), "MB");
  table("Extension heap in the page content process after hints", (run) => to_mb(run.mem_hints?.content_ext_heap), "MB");
  table("Extension-process heap attributed to moz-extension after load", (run) => to_mb(run.mem_load?.ext_proc_heap), "MB");
  table("Extension-process heap attributed to moz-extension after hints", (run) => to_mb(run.mem_hints?.ext_proc_heap), "MB");
}

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

if (timing_ran && tools.includes("none")) {
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
if (timing_ran) markdown += `\n### First press after load on each page, from the warm-up run (run -1) in the same browser process; only the first page of a tool is a fresh browser (ms)\n\n| tool | ${hint_pages.join(" | ")} |\n|---|${hint_pages.map(() => "---").join("|")}|\n`;
for (const tool of timing_ran ? tools.filter((name) => name !== "none") : []) {
  const cells = hint_pages.map((page) => (runs_of[tool].find((run) => run.page === page && run.run === -1)?.press1?.first_ms ?? null));
  markdown += `| ${tool} | ${cells.map((value) => show(value, 0)).join(" | ")} |\n`;
}
// Coverage page: per target, in how many timed runs a tool put a label on it. A target counts as visible only if it was visible in every run of every tool.
// An errored coverage run would shrink the n of a cell without notice, so it stops the analysis.
const coverage_runs_of = (tool) => (runs_of[tool] ?? []).filter((run) => run.page === "coverage" && run.run >= 0);
for (const tool of tools) {
  for (const run of coverage_runs_of(tool)) if (run.error || (tool !== "none" && !run.coverage?.targets)) throw new Error(`coverage run ${run.run} of ${tool} has no result: ${run.error ?? "no targets"}`);
}
const coverage_tools = tools.filter((tool) => tool !== "none" && coverage_runs_of(tool).length > 0);
if (coverage_tools.length > 0) {
  const all_runs = coverage_tools.flatMap((tool) => coverage_runs_of(tool));
  const first = all_runs[0].coverage;
  const is_visible = (name) => all_runs.every((run) => run.coverage.targets.find((target) => target.name === name)?.visible);
  const is_labelled = (run, name) => run.coverage.labelled.includes(name);
  markdown += `\n### Coverage: runs in which a target got a hint label (viewport ${first.viewport.join("x")}, scrolled to ${first.scroll_y}; ${all_runs.length} runs over ${coverage_tools.length} tools)\n\n| target | visible | ${coverage_tools.join(" | ")} |\n|---|---|${coverage_tools.map(() => "---").join("|")}|\n`;
  for (const { name } of first.targets) {
    const cells = coverage_tools.map((tool) => {
      const runs = coverage_runs_of(tool);
      return `${runs.filter((run) => is_labelled(run, name)).length}/${runs.length}`;
    });
    markdown += `| ${name} | ${is_visible(name) ? "yes" : "no"} | ${cells.join(" | ")} |\n`;
  }
  const visible_names = first.targets.map((target) => target.name).filter(is_visible);
  const labelled_visible = (tool) => median_of(coverage_runs_of(tool).map((run) => visible_names.filter((name) => is_labelled(run, name)).length));
  markdown += `| visible targets labelled (median) | ${visible_names.length} | ${coverage_tools.map(labelled_visible).join(" | ")} |\n`;
  markdown += `| labels in total (median) | - | ${coverage_tools.map((tool) => median_of(coverage_runs_of(tool).map((run) => run.coverage.labels.length))).join(" | ")} |\n`;
}
// Tab-switch page: hop A is the key in a loaded tab (a control), hop B the key in a tab that was unloaded and is loading.
const tabswitch_runs_of = (tool) => (runs_of[tool] ?? []).filter((run) => run.page === "tabswitch" && run.run >= 0);
const tabswitch_tools = tools.filter((tool) => tabswitch_runs_of(tool).length > 0);
if (tabswitch_tools.length > 0) {
  const meta = info_of[tabswitch_tools[0]].meta.tabswitch;
  markdown += `\n### Tab switch to an unloaded tab (ms; median [min-max]; extensions at default settings; presses asked for every ${meta.retry_ms} ms, measured gap in the last column; cache: ${meta.cache}). Early keys: ${meta.early_keys}\n\n| tool | next-tab key | hop A: key in loaded tab to next tab | hop B: unloaded tab active to next tab active | presses sent before landing | extra hops | measured press gap (ms) |\n|---|---|---|---|---|---|---|\n`;
  for (const tool of tabswitch_tools) {
    const runs = tabswitch_runs_of(tool);
    const pick = (field) => runs.map((run) => run.tabswitch[field]);
    markdown += `| ${tool} | ${info_of[tool].meta.tabswitch.next_key} | ${summary_of(pick("first_hop_ms"))} | ${summary_of(pick("arrive_to_land_ms"))} | ${summary_of(pick("presses_sent"))} | ${pick("extra_hops").reduce((sum, count) => sum + count, 0)} | ${summary_of(pick("press_gap_ms"))} |\n`;
  }
}
// Live-site check: one dated JSON for the whole run, and the table.
const site_runs_of = Object.fromEntries(tools.map((tool) => [tool, runs_of[tool].filter((run) => run.page === "sites")]));
const site_tools = tools.filter((tool) => site_runs_of[tool].length > 0);
if (site_tools.length > 0) {
  const date = info_of[site_tools[0]].date.slice(0, 10);
  const versions = Object.fromEntries(site_tools.map((tool) => [tool, { firefox: info_of[tool].firefox, version: info_of[tool].meta.version, commit: info_of[tool].meta.commit, keys: info_of[tool].meta.sites.keys, started: info_of[tool].date }]));
  writeFileSync(`${out_dir}/sites-${date}.json`, JSON.stringify({ date, versions, runs: site_runs_of }, null, 1));
  markdown += `\n### Live sites, ${date} (Firefox ${info_of[site_tools[0]].firefox}; ${site_tools.map((tool) => `${tool} ${info_of[tool].meta.version ?? "no extension"}`).join(", ")})\n\nSteps per site, on one page load, every key sent through the parent process: \`mode_on_load\` is information (where the focus starts, and the tool's mode, read for DesertFox and inferred for the others). \`leave\` is the tool's Escape out of the field the site focused: pass, fail, or unknown when the focus could not be read. The rows after it are normal-mode actions, pass or blocked, or wrong_target when the hint acted on another element than the labelled one. The DesertFox frame rows read n/a in a pass that never entered frame mode. A site behind a wall shows wall (a consent or bot wall) or login on every row, and error means the rig could not run the check. A cell shows the status most passes got, with a count such as 2/3 when they differ, and split when no status has a majority. A run retried after a timeout stays in the JSON and is not scored. Two rows score movement, both from the keyboard alone, from the page as loaded: \`scroll\` sends the tool's own j, and \`passthrough\` sends the site's ArrowDown with the tool active, so a tool that lets the site's keys through gets credit. Before the key, a tool's leave key goes out only when a typing field has the focus, and a site may add Tab presses to reach its scrolling area, the same for every tool. A click never starts a scored row. On Sheets, Maps, Excalidraw and StackBlitz the canvas or grid draws its own view, so both rows read whether the view or the selection moved (\`unknown\` when the page could not be read). Elsewhere they read the scroll offsets of the window and the main scroller. The \`none\` column is the control for those four sites: no extension, a click into the work area, then the site's own movement input (ArrowDown, or a wheel scroll on Excalidraw). It only proves the probe reads movement. A cell ending (the control did not move: ...) means the site's own input moved nothing, so the result says little about the tool.\n\n${sites_table(site_runs_of, site_tools)}`;
}
markdown += `\n### Versions\n\n${tools.map((tool) => `- ${tool}: firefox ${info_of[tool].firefox}, meta ${JSON.stringify(info_of[tool].meta)}`).join("\n")}\n`;
writeFileSync(`${out_dir}/tables.md`, markdown);
console.log(markdown);
