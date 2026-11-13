// The tools under test, shared by rivals.mjs, run.mjs and analyze.mjs: the pinned store builds and the id of each add-on.
// framescript.js keeps its own list of hint selectors, one per tool, because it runs in the content process and cannot import.

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

// The timing pages, run by default. `coverage` is not timed: it records which visible targets get a label, and runs only when PAGES=coverage.
export const PAGE_NAMES = ["large", "wiki", "frames", "frames0"];

export const xpi_path = (work_dir, tool) => `${work_dir}/xpi/${PINNED_BUILDS[tool].dir}/${PINNED_BUILDS[tool].dir}.xpi`;
