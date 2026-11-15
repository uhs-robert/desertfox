// The scenes of the README demo, played by demo.mjs as a piece of the key-test session. wf-recorder films the nested display.
// Seven shots, in the order of the approved storyboard. The key presses of the film go to key_presses.json, which demo.mjs burns into the GIF as a corner overlay.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_chrome } from "./rdp.mjs";
import { OUTPUT } from "./session.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
const page_template = readFileSync(join(key_test_dir, "demo", "docs_page.html"), "utf8");

// The Firefox window is floated to this size, and the stills and the film cover exactly this area.
const SIZE = { width: 1280, height: 800 };
const FRAME_RATE_OF_FILM = 24;
// The recorder is asked to stop and then fed frames until it does. A recorder that is not done by then is a failure.
const RECORDER_STOP_LIMIT_MS = 20000;

// Everything the run makes lands here first, so a failed run leaves docs/images as it was. demo.mjs copies the results out and removes the folder.
export const stage_dir = mkdtempSync(join(tmpdir(), "desertfox-demo-"));

// PLACEHOLDER targets until the help Practice page (#/practice) exists. Shot 2 hints the Help link in place of the Practice link, and shots 3 to 5 run on the fixture page in place of the Practice page. When the Practice page merges, point them at it and set the labels from a still.
const PLACEHOLDER = {
  new_tab_link_label: "H",
  practice_page_url: (docs_url) => docs_url("Get started"),
  practice_hint_label: "d",
  practice_log_text: "",
};

// A name under *.localhost resolves to the loopback, so the address bar reads like a site and not 127.0.0.1.
function start_docs_server() {
  const server = http.createServer((request, response) => {
    const title = new URL(request.url, "http://x").searchParams.get("title") ?? "Get started";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page_template.replace("__TITLE__", title));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const KEY_NAMES = { Escape: "Esc", Return: "Enter", Tab: "Tab", space: "Space" };
// The overlay text of one wtype-style argument list: "-k Name" is a named key, any other argument is typed text.
function overlay_labels(wtype_args) {
  const labels = [];
  for (let index = 0; index < wtype_args.length; index++) {
    if (wtype_args[index] === "-k") labels.push(KEY_NAMES[wtype_args[++index]] ?? wtype_args[index]);
    else labels.push(...wtype_args[index]);
  }
  return labels;
}

export async function run_cases({ spawn_client, take_shot, sleep, press_keys, poll_until, in_background, in_active_tab, hint_label_count, wait_cmdline, close_cmdline, config_copy, load_config_dir, open_page, wait_view_takes_keys, extension_view, rdp, extension_id }) {
  const docs_server = await start_docs_server();
  const docs_url = (title) => `http://fennec-docs.localhost:${docs_server.address().port}/?title=${encodeURIComponent(title)}`;
  const wait_for_exit = (child) => new Promise((resolve) => child.once("exit", resolve));
  const run_client = async (argv) => { const child = spawn_client(argv, "demo.log"); await wait_for_exit(child); };

  // The default settings and keys, so the clip shows what a first install shows.
  const demo_config = config_copy();
  for (const name of ["keymap.toml", "keymap.d", "snippets", "search_engines.toml"]) rmSync(join(demo_config, name), { recursive: true, force: true });
  writeFileSync(join(demo_config, "settings.toml"), "");
  await open_page("page", "demo_config", {});
  await load_config_dir(demo_config);

  // Float the window to the still size. The rest of the output stays the dark backdrop.
  await run_client(["sh", "-c", "hyprctl dispatch 'hl.dsp.window.float({ action = \"enable\" })'; hyprctl dispatch 'hl.dsp.window.resize({ x = " + SIZE.width + ", y = " + SIZE.height + ", exact = true })'; hyprctl dispatch 'hl.dsp.window.center()'"]);
  await sleep(800);
  // Firefox stripes the address bar while a debugger is connected. The attribute is the only cause, so removing it hides the stripes.
  await evaluate_in_chrome(rdp, `(() => { for (const window of Services.wm.getEnumerator("navigator:browser")) window.document.documentElement.removeAttribute("remotecontrol"); Services.prefs.setCharPref("browser.toolbars.bookmarks.visibility", "never"); })()`);

  const clients_path = join(stage_dir, "clients.json");
  await run_client(["sh", "-c", `hyprctl clients -j > ${clients_path}`]);
  const window = JSON.parse(readFileSync(clients_path, "utf8")).find((client) => client.class === "firefox" && client.mapped);
  const region = `${window.at[0]},${window.at[1]} ${window.size[0]}x${window.size[1]}`;
  const still = async (name) => {
    await sleep(250);
    await run_client(["grim", "-g", region, join(stage_dir, `${name}.png`)]);
  };

  // Every press goes through here, so the overlay lists exactly what the film shows.
  const key_presses = [];
  let film_started_ms;
  const press = async (...wtype_args) => {
    if (film_started_ms !== undefined) for (const label of overlay_labels(wtype_args)) key_presses.push({ at_s: (Date.now() - film_started_ms) / 1000, label });
    await press_keys(...wtype_args);
  };
  // Real typing speed: about 8 keys a second, with a short hold between words.
  const type = async (text, gap_ms = 120) => { for (const character of text) { await press(character); await sleep(gap_ms); } };
  const wait_in_page = (what, read) => poll_until(what, async () => Boolean(await read()));
  const read_mode = () => in_background(`${extension_view("newtab.html")}?.desertfox_host?.get_mode() ?? null`);

  // The tabs for shot 6, and the first tab, which the film starts on.
  for (const title of ["Plugins", "Changelog"]) await in_background(`browser.tabs.create({ url: ${JSON.stringify(docs_url(title))}, active: false })`);
  await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab.html") }); })()`);
  await poll_until("the new tab page to render and take focus", async () => await in_background(`(() => { const view = ${extension_view("newtab.html")}; return !!view?.document.querySelector(".desertfox-newtab") && view.document.hasFocus(); })()`).catch(() => false));
  await wait_view_takes_keys("newtab.html");
  await sleep(1500);

  const film_path = join(stage_dir, "film.mkv");
  const recorder = spawn_client(["wf-recorder", "-o", OUTPUT, "-g", region, "-r", String(FRAME_RATE_OF_FILM), "-c", "libx264", "-p", "preset=ultrafast", "-p", "crf=14", "-y", "-f", film_path], "wf-recorder.log");
  // Listening from the start, so an exit before the stop is not missed.
  let recorder_exited = false;
  recorder.once("exit", () => { recorder_exited = true; });
  film_started_ms = Date.now();
  await sleep(1500);

  console.log("shot 1: new tab page");
  await sleep(1500);

  console.log("shot 2: f, hint labels, open the Practice link");
  await press("f");
  await poll_until("the hint mode on the new tab page", async () => (await read_mode()) === "hint");
  await sleep(1400);
  await still("hints");
  await press(PLACEHOLDER.new_tab_link_label);
  await sleep(1500);
  // PLACEHOLDER: the Practice page stands in as the fixture page.
  await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.update(tab.id, { url: ${JSON.stringify(PLACEHOLDER.practice_page_url(docs_url))} }); })()`);
  await sleep(2500);

  console.log("shot 3: Practice page, hint a sandbox link");
  await press("f");
  await poll_until("hint labels", async () => (await hint_label_count()) > 0);
  await sleep(1200);
  await press(PLACEHOLDER.practice_hint_label);
  await sleep(1800);

  console.log("shot 4: g, the which-key Go panel");
  await press("g");
  await sleep(1800);
  await still("which-key");
  await press("-k", "Escape");
  await sleep(800);

  console.log("shot 5: caret mode selects a sentence, y copies");
  await press("v");
  await sleep(700);
  for (const key of ["j", "w", "w"]) { await press(key); await sleep(350); }
  await press("v");
  await sleep(500);
  for (const key of ["w", "w", "w", "w"]) { await press(key); await sleep(300); }
  await wait_in_page("a selection in caret mode", () => in_active_tab(`getSelection().toString() !== ""`));
  await sleep(500);
  await press("y");
  await sleep(1500);
  await press("-k", "Escape");
  await sleep(300);
  await press("-k", "Escape");
  await sleep(600);

  console.log("shot 6: T, the tab finder over the extra tabs");
  await press("T");
  await wait_cmdline((line) => line.open, "the tab finder to open");
  await sleep(800);
  await type("chang");
  await sleep(1000);
  await press("-k", "Return");
  await sleep(1500);

  console.log("shot 7: :set theme, Tab completes, Enter");
  await press(":");
  await wait_cmdline((line) => line.open, "the command line to open");
  await sleep(500);
  await type("set theme cat");
  await sleep(600);
  await press("-k", "Tab");
  await sleep(1000);
  await still("command-line");
  await press("-k", "Return");
  await sleep(2500);
  await still("theme-switch");
  await sleep(500);

  const film_seconds = (Date.now() - film_started_ms) / 1000;
  // wf-recorder closes the file on the next frame, so a page that stops changing holds it open. Scrolling after the cut gives it that frame, and the GIF stops at film_seconds.
  recorder.kill("SIGINT");
  const stop_deadline_ms = Date.now() + RECORDER_STOP_LIMIT_MS;
  while (!recorder_exited) {
    if (Date.now() > stop_deadline_ms) throw new Error(`wf-recorder did not stop within ${RECORDER_STOP_LIMIT_MS} ms`);
    await press_keys("j");
    await sleep(300);
  }
  if (statSync(film_path).size < 100000) throw new Error(`the film is only ${statSync(film_path).size} bytes, so the recorder caught no frames`);
  writeFileSync(join(stage_dir, "film.json"), JSON.stringify({ film_seconds, key_presses }));
  docs_server.close();
  // The harness cleans up through a key probe that only its own pages answer, and it keeps only the tab the piece started on.
  await in_background(`(async () => { const [first_tab] = await browser.tabs.query({ index: 0, currentWindow: true }); await browser.tabs.update(first_tab.id, { active: true }); })()`);
  await open_page("page", "demo_done", {});
}
