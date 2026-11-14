// The tools under test, shared by rivals.mjs, run.mjs and analyze.mjs: the pinned store builds and the id of each add-on.
// framescript.js keeps its own list of hint selectors, one per tool, because it runs in the content process and cannot import.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

export const DESERTFOX_ID = "desertfox@uhs-robert";

// Pinned store builds. A new version needs a new url and sha256, so a run never measures a build nobody checked.
// `gecko_id` is checked against the downloaded manifest, so a pin cannot drift from the id the runner waits for.
export const PINNED_BUILDS = {
  vimium: { dir: "vimium-ff", version: "2.4.2", gecko_id: "{d7742d87-e61d-4b78-b8a1-b469842139fa}", url: "https://addons.mozilla.org/firefox/downloads/file/4717567/vimium_ff-2.4.2.xpi", sha256: "131e2a67580e7ae9125ab19781159e61409fac47b441fc2782aab76396ead196" },
  vimiumc: { dir: "vimium-c", version: "2.12.3", gecko_id: "vimium-c@gdh1995.cn", url: "https://addons.mozilla.org/firefox/downloads/file/4474326/vimium_c-2.12.3.xpi", sha256: "e1a4f8cc13791dfb985c2a78d33df1e8a40f23bd6eca9217165cb748009df540" },
  tridactyl: { dir: "tridactyl", version: "1.25.1", gecko_id: "tridactyl.vim@cmcaine.co.uk", url: "https://addons.mozilla.org/firefox/downloads/file/5014416/tridactyl_vim-1.25.1.xpi", sha256: "722c2c6dfc03d80e48faeb4c3113d330203940483e3fcfc6c1d410e1cc58563e" },
};

// Every tool name in run order. `none` is the baseline with no extension.
export const TOOL_NAMES = ["desertfox", ...Object.keys(PINNED_BUILDS), "none"];

// The timing pages, run by default. `coverage` is not timed: it records which visible targets get a label, and runs only when PAGES=coverage. `sites` (sites.mjs) and `tabswitch` also run only when asked for.
export const PAGE_NAMES = ["large", "wiki", "frames", "frames0"];

export const xpi_path = (work_dir, tool) => `${work_dir}/xpi/${PINNED_BUILDS[tool].dir}/${PINNED_BUILDS[tool].dir}.xpi`;

// Exit status of run.mjs when a coverage result fails its checks. rivals.mjs retries other failures (debugger timeouts) but not this one, so a bad result is never retried into a clean one.
export const CHECK_FAILED_STATUS = 3;

const XPI_FETCH_TIMEOUT_MS = 60000;

function manifest_of(xpi_file) {
  const unzipped = spawnSync("unzip", ["-p", xpi_file, "manifest.json"], { encoding: "utf8" });
  if (unzipped.error || unzipped.status !== 0) throw new Error(`cannot read manifest.json from ${xpi_file} (is unzip installed?): ${unzipped.error ?? unzipped.stderr}`);
  return JSON.parse(unzipped.stdout);
}

// Downloads a pinned build to `xpi_file` (its folder must exist). A build that fails the sha256, version or id check is never left behind for a later run to use. Returns the sha256.
export async function fetch_pinned_xpi(name, xpi_file) {
  const pin = PINNED_BUILDS[name];
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(XPI_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${pin.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== pin.sha256) throw new Error(`${name}: sha256 ${sha256} does not match the pin ${pin.sha256}`);
  writeFileSync(xpi_file, bytes);
  try {
    const manifest = manifest_of(xpi_file);
    const gecko_id = manifest.browser_specific_settings?.gecko?.id ?? manifest.applications?.gecko?.id;
    if (manifest.version !== pin.version) throw new Error(`${name}: manifest version ${manifest.version}, pinned ${pin.version}`);
    if (gecko_id !== pin.gecko_id) throw new Error(`${name}: manifest id ${gecko_id}, pinned ${pin.gecko_id}`);
  } catch (error) {
    rmSync(xpi_file, { force: true });
    throw error;
  }
  return sha256;
}
