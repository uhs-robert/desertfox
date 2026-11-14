// The README demo: a looping GIF of five scenes and four 1280x800 stills, played with real key presses in the key-test session.
// The scenes of the README demo, played by demo.mjs as a piece of the key-test session. wf-recorder films the nested display.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_chrome } from "./rdp.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = dirname(dirname(key_test_dir));
const page_template = readFileSync(join(key_test_dir, "demo", "docs_page.html"), "utf8");

// The Firefox window is floated to this size and the shots and the film cover exactly this area.
export const WORK_DIR_NAME = ".demo-work";
const SIZE = { width: 1280, height: 800 };
const FRAME_RATE_OF_FILM = 24;

export const output_dir = process.env.DEMO_OUT_DIR ?? join(repo_dir, "docs", "images");
const theme_for_switch = "oasis_rose";

// A name under *.localhost resolves to the loopback, so the address bar reads like a site and not 127.0.0.1.
function start_docs_server() {
  const server = http.createServer((request, response) => {
    const title = new URL(request.url, "http://x").searchParams.get("title") ?? "Get started";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page_template.replace("__TITLE__", title));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const wait_for_exit = (child) => new Promise((resolve) => child.once("exit", resolve));

export async function run_cases({ spawn_client, take_shot, sleep, press_keys, poll_until, in_active_tab, in_background, hint_label_count, close_cmdline, config_copy, load_config_dir, open_page, rdp }) {
  mkdirSync(output_dir, { recursive: true });
  const work_dir = join(output_dir, WORK_DIR_NAME);
  rmSync(work_dir, { recursive: true, force: true });
  mkdirSync(work_dir, { recursive: true });
  const docs_server = await start_docs_server();
  const docs_url = (title) => `http://fennec-docs.localhost:${docs_server.address().port}/?title=${encodeURIComponent(title)}`;
  const run_client = async (argv) => { const child = spawn_client(argv, "demo.log"); await wait_for_exit(child); };

  // The default settings and keys, so the clip shows what a first install shows.
  const demo_config = config_copy();
  for (const name of ["keymap.toml", "keymap.d", "snippets", "search_engines.toml"]) rmSync(join(demo_config, name), { recursive: true, force: true });
  writeFileSync(join(demo_config, "settings.toml"), "");
  await open_page("page", "demo_config", {});
  await load_config_dir(demo_config);

  // Float the window to the shot size. The rest of the output stays the dark backdrop.
  await run_client(["sh", "-c", "hyprctl dispatch 'hl.dsp.window.float({ action = \"enable\" })'; hyprctl dispatch 'hl.dsp.window.resize({ x = " + SIZE.width + ", y = " + SIZE.height + ", exact = true })'; hyprctl dispatch 'hl.dsp.window.center()'"]);
  await sleep(800);
  // Firefox stripes the address bar while a debugger is connected. The attribute is the only cause, so removing it hides the stripes.
  await evaluate_in_chrome(rdp, `(() => { for (const window of Services.wm.getEnumerator("navigator:browser")) window.document.documentElement.removeAttribute("remotecontrol"); })()`);

  const region = await window_region(spawn_client);
  const still = async (name) => {
    await sleep(250);
    await run_client(["grim", "-g", region, join(output_dir, `${name}.png`)]);
  };

  // Typed one key at a time, so a viewer can read the key line of the extension.
  const type_slowly = async (text, gap_ms = 140) => { for (const character of text) { await press_keys(character); await sleep(gap_ms); } };

  // Other tabs for the tab finder, then the docs page in the tab the clip starts on.
  for (const title of ["Plugins", "Changelog", "Configuration"]) {
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(docs_url(title))}, active: false })`);
  }
  await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.update(tab.id, { url: ${JSON.stringify(docs_url("Get started"))} }); })()`);
  await sleep(2500);

  const film_path = join(work_dir, "film.mkv");
  const film_started_ms = Date.now();
  const recorder = spawn_client(["wf-recorder", "-o", "WAYLAND-1", "-g", region, "-r", String(FRAME_RATE_OF_FILM), "-c", "libx264", "-p", "preset=ultrafast", "-p", "crf=14", "-y", "-f", film_path], "wf-recorder.log");
  await sleep(1500);

  // Scene 1: link hints.
  console.log("scene: link hints");
  await sleep(800);
  await press_keys("f");
  await poll_until("hint labels", async () => (await hint_label_count()) > 0);
  await sleep(1600);
  await still("hints");
  await sleep(400);
  await press_keys("d");
  await sleep(1800);

  // Scene 2: which-key.
  console.log("scene: which-key");
  await press_keys("g");
  await sleep(2400);
  await still("which-key");
  await sleep(600);
  await press_keys("-k", "Escape");
  await sleep(900);

  // Scene 3: command line with completion.
  console.log("scene: command line with completion");
  await press_keys(":");
  await sleep(700);
  await type_slowly("tab ch");
  await sleep(1800);
  await still("command-line");
  await sleep(600);
  await close_cmdline();
  await sleep(900);

  // Scene 4: tab finder.
  console.log("scene: tab finder");
  await press_keys(",,");
  await sleep(1200);
  await type_slowly("chang");
  await sleep(1800);
  await close_cmdline();
  await sleep(900);

  // Scene 5: caret mode.
  console.log("scene: caret mode");
  await press_keys("v");
  await sleep(900);
  for (const key of ["j", "w", "w"]) { await press_keys(key); await sleep(500); }
  await press_keys("v");
  await sleep(700);
  for (const key of ["w", "w", "w", "w"]) { await press_keys(key); await sleep(450); }
  await sleep(1600);
  // The first Escape leaves visual mode for caret mode, the second leaves caret mode.
  await press_keys("-k", "Escape");
  await sleep(500);
  await press_keys("-k", "Escape");
  await sleep(1200);

  const film_seconds = (Date.now() - film_started_ms) / 1000;
  writeFileSync(join(work_dir, "film_seconds"), String(film_seconds));
  // wf-recorder closes the file on the next frame, so a page that stops changing holds it open. Scrolling after the cut gives it that frame, and the GIF stops at film_seconds.
  recorder.kill("SIGINT");
  let recorder_stopped = false;
  void wait_for_exit(recorder).then(() => { recorder_stopped = true; });
  while (!recorder_stopped) { await press_keys("j"); await sleep(300); }
  console.log(`film ${film_path} ${statSync(film_path).size} bytes`);

  // The theme switch, after the film so the clip keeps the default theme.
  await press_keys(":");
  await sleep(500);
  await type_slowly(`set theme ${theme_for_switch}`, 60);
  await sleep(500);
  await press_keys("-k", "Return");
  await sleep(1200);
  await press_keys("f");
  await poll_until("hint labels", async () => (await hint_label_count()) > 0);
  await sleep(800);
  await still("theme-switch");
  await press_keys("-k", "Escape");
  await press_keys(":");
  await sleep(300);
  await type_slowly("set theme oasis_moonlight", 30);
  await press_keys("-k", "Return");
  await sleep(500);
  docs_server.close();
  // The harness cleans up through a key probe that only its own pages answer.
  await open_page("page", "demo_done", {});
}

// Where the window sits, as grim and wf-recorder take it: "x,y WxH".
async function window_region(spawn_client) {
  const out_path = join(output_dir, ".demo-work", "clients.json");
  const child = spawn_client(["sh", "-c", `hyprctl clients -j > ${out_path}`], "demo.log");
  await wait_for_exit(child);
  const window = JSON.parse(readFileSync(out_path, "utf8")).find((client) => client.class === "firefox" && client.mapped);
  return `${window.at[0]},${window.at[1]} ${window.size[0]}x${window.size[1]}`;
}
