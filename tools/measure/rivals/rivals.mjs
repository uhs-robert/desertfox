// Runs the rival-extension benchmark: DesertFox from dist/ against the three store builds listed in PINNED, and a no-extension baseline.
// Settings by environment: MEASURE_DIR (default /tmp/desertfox-measure), PAGES (default all four), RUNS (timed runs per page and tool, default 8), PASSES (1 or 2, default 2; pass 2 runs the tools in reverse order).
// Everything it downloads or writes goes to $MEASURE_DIR/rivals. Downloaded files are only unzipped by `unzip -p manifest.json` to check the version.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const repo = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const work = `${process.env.MEASURE_DIR ?? "/tmp/desertfox-measure"}/rivals`;
const runs = process.env.RUNS ?? "8";
const passes = Number(process.env.PASSES ?? "2");

// Pinned store builds. A new version needs a new url and sha256, so a run never measures a build nobody checked.
const PINNED = {
  vimium: { dir: "vimium-ff", version: "2.4.2", url: "https://addons.mozilla.org/firefox/downloads/file/4717567/vimium_ff-2.4.2.xpi", sha256: "131e2a67580e7ae9125ab19781159e61409fac47b441fc2782aab76396ead196" },
  vimiumc: { dir: "vimium-c", version: "2.12.3", url: "https://addons.mozilla.org/firefox/downloads/file/4474326/vimium_c-2.12.3.xpi", sha256: "e1a4f8cc13791dfb985c2a78d33df1e8a40f23bd6eca9217165cb748009df540" },
  tridactyl: { dir: "tridactyl", version: "1.25.1", url: "https://addons.mozilla.org/firefox/downloads/file/5014416/tridactyl_vim-1.25.1.xpi", sha256: "722c2c6dfc03d80e48faeb4c3113d330203940483e3fcfc6c1d410e1cc58563e" },
};
const WIKI_URL = "https://en.wikipedia.org/wiki/World_War_II";
const USER_AGENT = "desertfox-measure/1.0 (local benchmark)";

if (!existsSync(`${repo}/dist/content.js`)) throw new Error("dist/ is missing: run `just build` first");
for (const sub of ["xpi", "out", "profiles"]) rmSync(`${work}/${sub}`, { recursive: true, force: true });
for (const sub of ["xpi", "out", "profiles", "pages"]) mkdirSync(`${work}/${sub}`, { recursive: true });

for (const [name, pin] of Object.entries(PINNED)) {
  const dir = `${work}/xpi/${pin.dir}`;
  mkdirSync(dir);
  const bytes = Buffer.from(await (await fetch(pin.url)).arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== pin.sha256) throw new Error(`${name}: sha256 ${sha256} does not match the pin ${pin.sha256}`);
  writeFileSync(`${dir}/${pin.dir}.xpi`, bytes);
  const manifest = JSON.parse(spawnSync("unzip", ["-p", `${dir}/${pin.dir}.xpi`, "manifest.json"], { encoding: "utf8" }).stdout);
  if (manifest.version !== pin.version) throw new Error(`${name}: manifest version ${manifest.version}, pinned ${pin.version}`);
  console.log(`${name} ${pin.version} sha256 ${sha256.slice(0, 12)}`);
}

// A saved article with its style sheets inlined and no scripts or images, so the page loads the same offline on every run.
if (!existsSync(`${work}/pages/wiki.html`)) {
  const get = async (url) => (await fetch(url, { headers: { "user-agent": USER_AGENT } })).text();
  let html = await get(WIKI_URL);
  let css = "";
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="(\/w\/load\.php[^"]+)"/g)) css += `${await get(`https://en.wikipedia.org${href.replaceAll("&amp;", "&")}`)}\n`;
  html = html.replace(/<script.*?<\/script>/gs, "").replace(/<link[^>]*>/g, "").replace(/<img[^>]*>/g, "").replace(/<base[^>]*>/g, "");
  writeFileSync(`${work}/pages/wiki.html`, html.replace("</head>", () => `<style>${css}</style></head>`));
}

const tools = ["desertfox", "vimium", "vimiumc", "tridactyl", "none"];
const env = { ...process.env, RIVALS_DIR: work };
for (let pass = 1; pass <= passes; pass++) {
  for (const tool of pass === 1 ? tools : [...tools].reverse()) {
    console.log(`pass ${pass}: ${tool}`);
    // A busy machine can make the debugger connection time out at startup, so each tool gets one retry.
    const attempt = () => spawnSync("node", [`${here}run.mjs`, tool, runs], { env: { ...env, PASS: String(pass) }, stdio: ["ignore", "inherit", "inherit"] });
    const result = attempt().status === 0 ? { status: 0 } : attempt();
    if (result.status !== 0) throw new Error(`run.mjs ${tool} failed twice (status ${result.status})`);
  }
}
const analyzed = spawnSync("node", [`${here}analyze.mjs`], { env: { ...env, PASSES: Array.from({ length: passes }, (_, i) => i + 1).join(",") }, stdio: ["ignore", "ignore", "inherit"] });
if (analyzed.status !== 0) throw new Error("analyze.mjs failed");
console.log(`tables: ${work}/out/tables.md`);
