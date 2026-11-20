// The scenes of the README demo, played by demo.mjs as a piece of the key-test session. wf-recorder films the nested display.
// Seven shots, in the order of the approved storyboard v3, played on the 14-lesson Practice page. The key presses of the film go to key_presses.json, which demo.mjs burns into the GIF as a corner overlay.
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";
import { OUTPUT } from "./session.mjs";

// The Firefox window is floated to this size, and the stills and the film cover exactly this area.
const SIZE = { width: 1280, height: 800 };
const FRAME_RATE_OF_FILM = 24;
// The recorder is asked to stop and then fed frames until it does. A recorder that is not done by then is a failure.
const RECORDER_STOP_LIMIT_MS = 20000;

// Everything the run makes lands here first, so a failed run leaves docs/images as it was. demo.mjs makes the folder, copies the results out and removes it.
export let stage_dir;
export function set_stage_dir(dir) { stage_dir = dir; }

// <A-?> is Alt+Shift+/ on the test layout.
const WHICH_KEY = ["-M", "alt", "-M", "shift", "/", "-m", "shift", "-m", "alt"];
const DARK_MODE_PREF = "layout.css.prefers-color-scheme.content-override";
// A lesson can be taller than the window, so a target outside the view is scrolled in before its hint keys.
const PRACTICE_VIEW = `(browser.extension.getViews({ type: "tab" }).find((each) => each.location.pathname === "/home.html" && each.location.hash.includes("practice")) ?? null)`;

const KEY_NAMES = { Escape: "Esc", Return: "Enter", Tab: "Tab", space: "Space" };
// The overlay text of one wtype-style argument list: "-k Name" is a named key, any other argument is typed text.
function overlay_labels(wtype_args) {
  if (wtype_args.join(" ") === WHICH_KEY.join(" ")) return ["Alt+?"];
  const labels = [];
  for (let index = 0; index < wtype_args.length; index++) {
    if (wtype_args[index] === "-k") labels.push(KEY_NAMES[wtype_args[++index]] ?? wtype_args[index]);
    else labels.push(...wtype_args[index]);
  }
  return labels;
}

export async function run_cases({ on_teardown, spawn_client, take_shot, sleep, press_keys, poll_until, in_background, in_active_tab, wait_cmdline, config_copy, load_config_dir, open_page, wait_view_takes_keys, extension_view, rdp, extension_id, expect }) {
  const wait_for_exit = (child) => new Promise((resolve) => child.once("exit", resolve));
  const run_client = async (argv) => { const child = spawn_client(argv, "demo.log"); await wait_for_exit(child); };

  // The default settings and keys, so the clip shows what a first install shows.
  const demo_config = config_copy();
  for (const name of ["keymap.toml", "keymap.d", "snippets", "search_engines.toml"]) rmSync(join(demo_config, name), { recursive: true, force: true });
  // The new tab defaults of a new user: no top sites and no recently closed tabs. The harness page the config loads from would otherwise show up as a top-site tile.
  writeFileSync(join(demo_config, "settings.toml"), "newtab_top_sites = false\nnewtab_closed_tabs = false\n");
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
  let key_presses = [];
  let film_started_ms;
  const press = async (...wtype_args) => {
    if (film_started_ms !== undefined) for (const label of overlay_labels(wtype_args)) key_presses.push({ at_s: (Date.now() - film_started_ms) / 1000, label });
    await press_keys(...wtype_args);
  };
  // Real typing speed: about 8 keys a second, with a short hold between words.
  const type = async (text, gap_ms = 120) => { for (const character of text) { await press(character); await sleep(gap_ms); } };
  const wait_in_page = (what, read) => poll_until(what, async () => Boolean(await read()));
  const read_mode = () => in_background(`${extension_view("newtab.html")}?.desertfox_host?.get_mode() ?? null`);

  // The helpers of p40_help_practice.mjs, on the Practice view.
  const in_practice = (code) => in_background(`(() => { const view = ${PRACTICE_VIEW}; ${code} })()`);
  const practice_mode = () => in_practice(`return view?.desertfox_host?.get_mode() ?? null;`);
  const wait_practice_mode = (wanted) => poll_until(`${wanted} mode`, async () => (await practice_mode()) === wanted);
  const focused_id = () => in_practice(`return view.document.activeElement?.id ?? "";`);
  const wait_focus = (id) => poll_until(`the focus on ${id}`, async () => (await focused_id()) === id);
  const heading_top = (slug) => in_practice(`return Math.round(view.document.getElementById("practice-${slug}").getBoundingClientRect().top);`);
  // sh puts the lesson heading at the top of the view, and the film waits for it as a reader does.
  const wait_lesson_at_top = (slug) => poll_until(`lesson ${slug} at the top of the view`, async () => Math.abs(await heading_top(slug)) < 12);
  const to_lesson = async (slug, search) => {
    await press("sh");
    await wait_cmdline((line) => line.open && line.focused, "the heading list to open");
    await sleep(250);
    await type(search, 90);
    await sleep(300);
    await press("-k", "Return");
    await wait_lesson_at_top(slug);
    await sleep(400);
  };
  // The label that the hint mode draws on a target, read from the closed shadow root of the labels.
  const label_at = (selector) => in_practice(`
    const target = view.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const labels = [...view.document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => label.style.display !== "none" && label.style.visibility !== "hidden");
    const near = labels.map((label) => { const box = label.getBoundingClientRect(); return { text: label.textContent, far: Math.hypot(box.left - target.left, box.top - target.top) }; }).sort((a, b) => a.far - b.far)[0];
    return near && near.far < 30 ? near.text : null;`);
  const scroll_into_view = (selector) => in_practice(`
    const box = view.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    if (box.top < 0 || box.bottom > view.innerHeight) view.document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" });`);
  async function pick(selector, hold_ms = 0) {
    let label;
    await poll_until(`a hint label on ${selector}`, async () => (label = await label_at(selector)) !== null);
    await sleep(hold_ms);
    await press(label);
  }
  async function hint(keys, selector, hold_ms) {
    await scroll_into_view(selector);
    await sleep(300);
    await press(keys);
    await wait_practice_mode("hint");
    await pick(selector, hold_ms);
  }

  // Dark mode as the maintainer runs it, and the pref goes back when the piece ends.
  on_teardown(() => evaluate_in_chrome(rdp, `Services.prefs.clearUserPref("${DARK_MODE_PREF}")`));
  await evaluate_in_chrome(rdp, `Services.prefs.setIntPref("${DARK_MODE_PREF}", 0)`);

  // The tabs for shot 6, and the first tab, which the film starts on.
  for (const hash of ["settings", "commands"]) await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/${hash}"), active: false })`);
  await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab.html") }); })()`);
  await poll_until("the new tab page to render and take focus", async () => await in_background(`(() => { const view = ${extension_view("newtab.html")}; return !!view?.document.querySelector(".desertfox-newtab") && view.document.hasFocus(); })()`).catch(() => false));
  await wait_view_takes_keys("newtab.html");
  await sleep(1200);

  // Listening from the start, so an exit before the stop is not missed.
  const start_film = (film_path) => {
    const recorder = spawn_client(["wf-recorder", "-o", OUTPUT, "-g", region, "-r", String(FRAME_RATE_OF_FILM), "-c", "libx264", "-p", "preset=ultrafast", "-p", "crf=14", "-y", "-f", film_path], "wf-recorder.log");
    const film = { recorder, exited: false };
    recorder.once("exit", () => { film.exited = true; });
    film_started_ms = Date.now();
    return film;
  };
  // wf-recorder closes the file on the next frame, so a page that stops changing holds it open. Scrolling after the cut gives it that frame, and the GIF stops at the returned length.
  // An exit before this point leaves a partial film that must not be published.
  async function stop_film(film, film_path) {
    const film_seconds = (Date.now() - film_started_ms) / 1000;
    if (film.exited) throw new Error("wf-recorder exited before the film was done");
    film.recorder.kill("SIGINT");
    const stop_deadline_ms = Date.now() + RECORDER_STOP_LIMIT_MS;
    while (!film.exited) {
      if (Date.now() > stop_deadline_ms) throw new Error(`wf-recorder did not stop within ${RECORDER_STOP_LIMIT_MS} ms`);
      await press_keys("j");
      await sleep(300);
    }
    if (statSync(film_path).size < 100000) throw new Error(`the film is only ${statSync(film_path).size} bytes, so the recorder caught no frames`);
    return film_seconds;
  }
  const film_path = join(stage_dir, "film.mkv");
  const main_film = start_film(film_path);
  await sleep(1000);

  console.log("shot 1: new tab page");
  await sleep(1000);

  console.log("shot 2: f, hint labels, open the Practice link");
  const practice_link = '.builtin-links a[href="home.html#/practice"]';
  await press("f");
  await poll_until("the hint mode on the new tab page", async () => (await read_mode()) === "hint");
  await sleep(1400);
  await still("hints");
  let link_label;
  await poll_until("the label on the Practice link", async () => (link_label = await in_background(`(() => { const view = ${extension_view("newtab.html")}; const target = view.document.querySelector(${JSON.stringify(practice_link)}).getBoundingClientRect(); const labels = [...view.document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => label.style.display !== "none"); const near = labels.map((label) => { const box = label.getBoundingClientRect(); return { text: label.textContent, far: Math.hypot(box.left - target.left, box.top - target.top) }; }).sort((a, b) => a.far - b.far)[0]; return near && near.far < 40 ? near.text : null; })()`)) !== null);
  await press(link_label);
  await poll_until("the Practice page", async () => (await in_practice(`return !!view?.document.getElementById("practice-end");`).catch(() => false)));
  // The probe of wait_view_takes_keys answers from the first help view, which is a background tab here, so the Practice view gets a focus wait and a pause.
  await poll_until("the Practice view to take focus", async () => await in_practice(`return view.document.hasFocus();`));
  await sleep(300);
  // dd lands on the tab to the right of the closed one, so Settings sits directly left of Practice.
  await in_background(`(async () => { const tabs = await browser.tabs.query({ currentWindow: true }); const practice = tabs.find((tab) => /home\\.html#.*practice/.test(tab.url)); const settings = tabs.find((tab) => tab.url.endsWith("#/settings")); await browser.tabs.move(settings.id, { index: practice.index > settings.index ? practice.index - 1 : practice.index }); })()`);
  await sleep(900);

  console.log("shot 3: Alt+?, the which-key panel, z narrows it");
  const panel_open = `return [...view.document.documentElement.children].some((node) => node.getAttribute("data-desertfox-layer") === "2147483646" && node.matches(":popover-open"));`;
  await to_lesson("which-key", "see every");
  await press(...WHICH_KEY);
  await poll_until("the which-key panel to open", async () => await in_practice(panel_open));
  await sleep(1500);
  await press("z");
  await sleep(800);
  await press("-k", "Escape");
  await poll_until("the which-key panel to close", async () => !(await in_practice(panel_open)));
  await sleep(300);
  // The still shows the panel of the t prefix, the tab actions with their keys, which opens after the key delay.
  await press("t");
  await poll_until("the t panel to open", async () => await in_practice(panel_open));
  await sleep(1500);
  await still("which-key");
  await press("-k", "Escape");
  await poll_until("the t panel to close", async () => !(await in_practice(panel_open)));
  await sleep(300);

  console.log("shot 4: gi and ]i fill a form, ;i picks a radio, ;Gg grabs a slider, ;gg moves a card across the board");
  await to_lesson("form", "fill in");
  await press("gi");
  await wait_focus("practice-name");
  await sleep(300);
  await type("ada");
  await press("-k", "Escape");
  await sleep(300);
  await press("]i");
  await sleep(800);
  await press("-k", "Escape");
  await to_lesson("inputs", "go straight");
  await hint(";i", "#practice-radio-2", 600);
  await sleep(900);
  await press("]h");
  await wait_lesson_at_top("slider");
  await sleep(300);
  await hint(";Gg", "#practice-range", 600);
  await wait_practice_mode("grab");
  for (let step = 0; step < 5; step++) { await press("l"); await sleep(200); }
  await poll_until("the slider to read 7", async () => (await in_practice(`return view.document.getElementById("practice-range").value;`)) === "7");
  await sleep(500);
  await press("-k", "Return");
  await sleep(900);
  // The board below the slider: ;gg grabs the card, the second pass labels every place it can go.
  // The slider's "Grab dropped" toast must be gone, so the still shows only the board.
  await poll_until("the Grab dropped toast to clear", async () => await in_practice(`return ![...view.document.documentElement.children].some((child) => (child.openOrClosedShadowRoot?.textContent ?? "").includes("Grab dropped"));`), { timeout_ms: 30000 });
  const card_column = (id) => in_practice(`return view.document.getElementById(${JSON.stringify(id)}).parentElement.id;`);
  const target_labels_up = () => in_practice(`return [...view.document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => label.style.display !== "none" && label.style.visibility !== "hidden" && label.textContent.length > 1).length > 0;`);
  // One card moves twice, To do to Doing and then Doing to Done, so the board reads as work in motion.
  const fix_card = "#practice-card-fix-the-bug";
  const board_scene = { start_s: (Date.now() - film_started_ms) / 1000 };
  await hint(";gg", fix_card, 600);
  await wait_in_page("the labels of the drop targets", target_labels_up);
  await still("drag");
  await pick("#practice-column-doing", 900);
  await poll_until("the card to land in Doing", async () => (await card_column("practice-card-fix-the-bug")) === "practice-column-doing");
  await sleep(1000);
  await hint(";gg", fix_card, 400);
  await wait_in_page("the labels of the drop targets", target_labels_up);
  await sleep(500);
  await pick("#practice-column-done", 900);
  await poll_until("the card to land in Done", async () => (await card_column("practice-card-fix-the-bug")) === "practice-column-done");
  await sleep(1200);
  board_scene.end_s = (Date.now() - film_started_ms) / 1000;

  console.log("shot 5: caret mode selects a sentence, y copies");
  await to_lesson("copy", "copy");
  await hint(";V", "#practice-copy-1", 600);
  await sleep(400);
  await press("as");
  await sleep(700);
  await press("y");
  await sleep(1200);
  await press("-k", "Escape");
  await sleep(300);
  await press("-k", "Escape");
  await sleep(600);

  console.log("shot 6: T, the tab finder, Settings, dd");
  const practice_tab_active = () => in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => /home\\.html#.*practice/.test(tab.url))`);
  await press("T");
  await wait_cmdline((line) => line.open, "the tab finder to open");
  await sleep(500);
  await type("sett");
  await sleep(400);
  // The typed text narrows the list loosely, so the Settings row is not always the first.
  let line = await wait_cmdline((state) => state.row_texts.some((row) => row.includes("#/settings")), "a Settings row");
  for (let step = 0; step < 5 && !(line.row_texts[line.selected] ?? "").includes("#/settings"); step++) {
    const before = line.selected;
    await press("-k", "Down");
    line = await wait_cmdline((state) => state.selected !== before, "the Down arrow to move to the next row");
  }
  expect((line.row_texts[line.selected] ?? "").includes("#/settings"), `the tab finder did not reach the Settings row: ${JSON.stringify(line.row_texts)}`);
  await sleep(400);
  await press("-k", "Return");
  await poll_until("the Settings tab to be active", async () => await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url.endsWith("#/settings"))`));
  await sleep(1200);
  await press("dd");
  await poll_until("dd to land on the Practice tab", async () => (await practice_tab_active()) && (await in_practice(`return view.document.hasFocus();`)));
  await sleep(700);

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

  const film_seconds = await stop_film(main_film, film_path);
  const main_presses = key_presses;

  // The item mode films play on live sites, so each has its own recorder. A page that shows a consent wall, a captcha or no tiles fails the piece instead of filming it.
  const item_films = [];
  async function item_scene(name, url, { walk, tiles_up }) {
    console.log(`item scene ${name}: ${url}`);
    await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.update(tab.id, { url: ${JSON.stringify(url)} }); })()`);
    await poll_until(`the key handler on ${name}`, async () => await in_active_tab(`document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`).catch(() => false), { timeout_ms: 45000 });
    try {
      await poll_until(`the results of ${name}`, async () => await in_active_tab(tiles_up).catch(() => false), { timeout_ms: 30000 });
    } catch (error) {
      // The page the recorder met, kept for the maintainer: a wall or a blank page decides the site.
      await run_client(["grim", "-g", region, join(process.env.DEMO_DEBUG_DIR ?? tmpdir(), `demo_${name}_blocked.png`)]);
      throw error;
    }
    await sleep(1500);
    // The shipped rows start item mode by themselves, so the film starts from normal mode and shows I doing it.
    await poll_until("item mode to start by itself", async () => (await item_badge()) === "ITEM");
    await press_keys("-k", "Escape");
    await poll_until("normal mode", async () => (await item_badge()) === "NORMAL");
    await sleep(500);
    key_presses = [];
    const item_path = join(stage_dir, `item_${name}.mkv`);
    const film = start_film(item_path);
    await sleep(1200);
    await walk();
    await sleep(1200);
    const seconds = await stop_film(film, item_path);
    item_films.push({ name, film_seconds: seconds, key_presses });
  }
  const item_badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const wait_item_mode = () => poll_until("item mode", async () => (await item_badge()) === "ITEM");
  const walk_keys = async (keys) => { for (const key of keys) { await press(key); await sleep(650); } };

  // Google Images shows a captcha to the recorder, so the grid is Brave Images, which has its own shipped row (brave_images). The web results film is DuckDuckGo, so the two films show two sites.
  await item_scene("brave_images", "https://search.brave.com/images?q=desertfox&source=web", {
    tiles_up: `document.querySelectorAll("button.image-result").length > 8`,
    walk: async () => {
      await press("I");
      await wait_item_mode();
      await sleep(900);
      await walk_keys("llljjhhkk");
      await press("-k", "Escape");
    },
  });
  await item_scene("ddg", "https://duckduckgo.com/?q=desertfox+firefox&ia=web", {
    tiles_up: `document.querySelectorAll("article").length > 3`,
    walk: async () => {
      await press("I");
      await wait_item_mode();
      await sleep(900);
      await walk_keys("jjjjkk");
      await press("-k", "Escape");
    },
  });
  writeFileSync(join(stage_dir, "film.json"), JSON.stringify({ film_seconds, key_presses: main_presses, board_scene, item_films }));
  // The Commands tab stays open from the start, and the first tab is the one the harness keeps.
  await in_background(`browser.tabs.query({ currentWindow: true }).then((tabs) => browser.tabs.remove(tabs.filter((tab) => tab.url.endsWith("#/commands")).map((tab) => tab.id)))`);
  // The harness cleans up through a key probe that only its own pages answer, and it keeps only the tab the piece started on.
  await in_background(`(async () => { const [first_tab] = await browser.tabs.query({ index: 0, currentWindow: true }); await browser.tabs.update(first_tab.id, { active: true }); })()`);
  await open_page("page", "demo_done", {});
}
