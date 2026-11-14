// Runs the rival-extension benchmark: DesertFox from dist/ against the pinned store builds in tools.mjs, and a no-extension baseline.
// Settings by environment: MEASURE_DIR (default /tmp/desertfox-measure), PAGES (default the four timing pages; `coverage` is not timed and runs only when asked for), RUNS (timed runs per page and tool, default 8), PASSES (default 2; each even pass runs the tools in reverse order, so a slow minute on the machine does not land on one tool only).
// PAGES=sites is the live-site check (sites.mjs): it loads public sites over the network and records pass or fail per check. A live page varies from load to load, so run it with PASSES=3 at least: the table scores each cell by the majority of the passes. SITES=youtube,wikipedia limits it to some sites.
// Everything it downloads or writes goes to $MEASURE_DIR/rivals. A downloaded file is touched only by `unzip -p manifest.json`, to check its version and id.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { CHECK_FAILED_STATUS, fetch_pinned_xpi, PINNED_BUILDS, PAGE_NAMES, TOOL_NAMES } from "./tools.mjs";

const here = new URL(".", import.meta.url).pathname;
const repo_dir = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const work_dir = `${process.env.MEASURE_DIR ?? "/tmp/desertfox-measure"}/rivals`;
const timed_runs = process.env.RUNS ?? "8";
const pass_count = Number(process.env.PASSES ?? "2");
const page_names = (process.env.PAGES ?? PAGE_NAMES.join(",")).split(",");
const WIKI_URL = "https://en.wikipedia.org/wiki/World_War_II";
const USER_AGENT = "desertfox-measure/1.0 (local benchmark)";
const FETCH_TIMEOUT_MS = 60000;

if (!Number.isInteger(pass_count) || pass_count < 1) throw new Error("PASSES must be a whole number of 1 or more");
if (!existsSync(`${repo_dir}/dist/content.js`)) throw new Error("dist/ is missing: run `just build` first");
for (const sub of ["xpi", "out", "profiles"]) rmSync(`${work_dir}/${sub}`, { recursive: true, force: true });
for (const sub of ["xpi", "out", "profiles", "pages"]) mkdirSync(`${work_dir}/${sub}`, { recursive: true });

async function fetch_checked(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

for (const [name, pin] of Object.entries(PINNED_BUILDS)) {
  const dir = `${work_dir}/xpi/${pin.dir}`;
  mkdirSync(dir);
  const sha256 = await fetch_pinned_xpi(name, `${dir}/${pin.dir}.xpi`);
  console.log(`${name} ${pin.version} sha256 ${sha256.slice(0, 12)}`);
}

// The article is a snapshot taken on the first run and reused after it, with its style sheets inlined and no scripts or images, so the page loads the same offline every time. Delete $MEASURE_DIR/rivals/pages to take a new one.
const wiki_file = `${work_dir}/pages/wiki.html`;
if (page_names.includes("wiki") && !existsSync(wiki_file)) {
  const get_text = async (url) => (await fetch_checked(url, { "user-agent": USER_AGENT })).text();
  let html = await get_text(WIKI_URL);
  let css = "";
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="(\/w\/load\.php[^"]+)"/g)) css += `${await get_text(`https://en.wikipedia.org${href.replaceAll("&amp;", "&")}`)}\n`;
  html = html.replace(/<script.*?<\/script>/gs, "").replace(/<link[^>]*>/g, "").replace(/<img[^>]*>/g, "").replace(/<base[^>]*>/g, "");
  // Written under another name and renamed, so a failed write never leaves a half page that the next run would reuse.
  writeFileSync(`${wiki_file}.part`, html.replace("</head>", () => `<style>${css}</style></head>`));
  renameSync(`${wiki_file}.part`, wiki_file);
}

const env = { ...process.env, RIVALS_DIR: work_dir };
for (let pass = 1; pass <= pass_count; pass++) {
  for (const tool of pass % 2 === 1 ? TOOL_NAMES : [...TOOL_NAMES].reverse()) {
    console.log(`pass ${pass}: ${tool}`);
    // A busy machine can make the debugger connection time out at startup, so each tool gets one retry.
    const attempt = () => spawnSync("node", [`${here}run.mjs`, tool, timed_runs], { env: { ...env, PASS: String(pass) }, stdio: ["ignore", "inherit", "inherit"] });
    const first = attempt();
    if (first.status === CHECK_FAILED_STATUS) throw new Error(`run.mjs ${tool} failed a result check: not retried`);
    const result = first.status === 0 ? first : attempt();
    if (result.status !== 0) throw new Error(`run.mjs ${tool} failed twice (status ${result.status})`);
  }
}
const analyzed = spawnSync("node", [`${here}analyze.mjs`], { env: { ...env, PASSES: Array.from({ length: pass_count }, (_, index) => index + 1).join(",") }, stdio: ["ignore", "ignore", "inherit"] });
if (analyzed.status !== 0) throw new Error("analyze.mjs failed");
console.log(`tables: ${work_dir}/out/tables.md`);
