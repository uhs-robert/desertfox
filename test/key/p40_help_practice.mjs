// Key cases of the Practice page (#/practice in the help document): each area works with real keys on an extension page, including the tab finder and page search.
// Set DESERTFOX_SHOT_DIR to also save stills of the page in the default theme and in catppuccin.
import { SHIFT_ESCAPE } from "./harness.mjs";
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["help"];

export async function run_cases({ run_case, expect, press_keys, poll_until, wait_view_takes_keys, run_line, rdp, extension_id, extension_view, close_tabs_with, on_teardown, take_shot, sleep, wait_cmdline, close_cmdline, in_background }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);
  const view = extension_view("home.html");
  const in_page = (code) => evaluate(`(() => { const view = ${view}; ${code} })()`);
  const by_id = (id) => `view.document.getElementById(${JSON.stringify(id)})`;
  const badge = () => in_page(`return view.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null;`);
  const wait_badge = (accepted) => poll_until(`the badge to be ${accepted.join(" or ")}`, async () => accepted.includes(await badge()));
  const log_text = () => in_page(`return ${by_id("practice-log")}.textContent;`);
  const wait_log = (text) => poll_until(`the log line to read "${text}"`, async () => (await log_text()) === text).catch(async (error) => { throw new Error(`${error.message} (it reads "${await log_text()}")`); });
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const shot = async (name, scroll_to) => {
    if (!shot_dir) return;
    await in_page(`${scroll_to ? `${by_id(scroll_to)}.scrollIntoView({ block: "center" });` : "view.scrollTo(0, 0);"}`);
    await sleep(400);
    await take_shot(`${shot_dir}/${name}.png`);
  };
  async function leave_to_normal() {
    for (let step = 0; step < 3 && (await badge()) !== "NORMAL"; step++) {
      await press_keys("-k", "Escape");
      await sleep(200);
    }
    await wait_badge(["NORMAL"]);
  }
  // Hints name a target by its text, because the labels sit in a closed shadow root the test cannot read.
  // The text is the shortest start that only one target has: the pick runs at the first character that leaves one match, and any key after it would reach the page.
  const mode = () => in_page(`return view.desertfox_host?.get_mode() ?? null;`);
  async function hint_by_text(key, text, target_id) {
    // Hints label only what is on screen.
    await in_page(`${by_id(target_id)}.scrollIntoView({ block: "center" });`);
    await sleep(200);
    await press_keys(key);
    await poll_until("hint mode", async () => (await mode()) === "hint");
    await press_keys("/", text);
  }

  // The test Firefox reports light mode. A shot run forces dark, as the maintainer runs it, and puts the pref back.
  if (shot_dir) {
    on_teardown(() => evaluate_in_chrome(rdp, `Services.prefs.clearUserPref("layout.css.prefers-color-scheme.content-override")`));
    await evaluate_in_chrome(rdp, `Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 0)`);
  }

  on_teardown(async () => {
    await close_tabs_with("/home.html");
    const tab_id = await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/practice"), active: true }).then((tab) => tab.id)`);
    await poll_until("the page to load", async () => await in_page(`return !!view && !!${by_id("practice-log")};`).catch(() => false), { timeout_ms: 10000 });
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_setting", name: "theme", action: "reset" });`);
    await evaluate(`browser.tabs.remove(${tab_id}).then(() => true)`);
    await close_tabs_with("/home.html");
  });

  await close_tabs_with("/home.html");
  await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/practice"), active: true }).then(() => true)`);
  await poll_until("the Practice page to render and take focus", async () => await in_page(`return !!view && !!${by_id("practice-log")} && view.document.hasFocus();`).catch(() => false), { timeout_ms: 10000 });
  await wait_view_takes_keys("home.html");

  await run_case("the page holds every target by its id", async () => {
    const found = await in_page(`return ["practice-link-1", "practice-link-5", "practice-button-1", "practice-button-2", "practice-checkbox", "practice-log", "practice-prose-1", "practice-prose-3", "practice-paste", "practice-input", "practice-textarea", "practice-open-settings", "practice-open-commands", "practice-scroll", "practice-end"].filter((id) => !${"view.document.getElementById(id)"});`);
    expect(found.length === 0, `missing ids: ${found.join(", ")}`);
    const prompts = await in_page(`return [...view.document.querySelectorAll(".desertfox-help-tip")].map((tip) => tip.textContent);`);
    expect(prompts.length === 12 && prompts.every((text) => text.length > 20 && !text.includes("(no key bound)")), `prompts: ${JSON.stringify(prompts)}`);
    await shot("practice-default-top");
    await shot("practice-default-middle", "practice-textarea");
    await shot("practice-default-controls", "practice-radio");
  });

  await run_case("f and the text of a button or checkbox clicks it and the log line says so", async () => {
    await hint_by_text("f", "tw", "practice-button-2");
    await wait_log("Clicked Button two, 1 time.");
    await hint_by_text("f", "tw", "practice-button-2");
    await wait_log("Clicked Button two, 2 times.");
    await hint_by_text("f", "chec", "practice-checkbox");
    await poll_until("the checkbox to turn on", async () => (await log_text()) === "The checkbox is on.");
    await wait_badge(["NORMAL"]);
  });

  await run_case("f and the text of a link follows it to its section and keeps the typed text and the log line", async () => {
    await in_page(`const input = ${by_id("practice-input")}; input.value = "typed text"; input.dataset.kept = "yes";`);
    const log_before = await log_text();
    await hint_by_text("f", "typi", "practice-link-3");
    await poll_until("the page to jump to the typing section", async () => (await in_page(`return view.location.hash;`)) === "#section=practice/type-in-a-box");
    await poll_until("the typing heading to reach the top", async () => await in_page(`return Math.abs(view.document.getElementById("practice-type-in-a-box").getBoundingClientRect().top) < 40;`));
    const kept = await in_page(`const input = ${by_id("practice-input")}; return { value: input.value, kept: input.dataset.kept, log: ${by_id("practice-log")}.textContent };`);
    expect(kept.value === "typed text" && kept.kept === "yes" && kept.log === log_before, `the jump rebuilt the page: ${JSON.stringify(kept)}`);
    await wait_view_takes_keys("home.html");
  });

  await run_case("j, G and gg scroll the tall area", async () => {
    await in_page(`view.scrollTo(0, 0);`);
    await poll_until("the page to be at the top", async () => (await in_page(`return view.scrollY;`)) === 0);
    await press_keys("j", "j", "j");
    await poll_until("the page to scroll after j", async () => (await in_page(`return view.scrollY;`)) > 0);
    await press_keys("G");
    await poll_until("the end line to show after G", async () => await in_page(`const box = ${by_id("practice-end")}.getBoundingClientRect(); return box.bottom <= view.innerHeight + 2 && box.top >= 0;`));
    await press_keys("gg");
    await poll_until("the page to return to the top after gg", async () => (await in_page(`return view.scrollY;`)) === 0);
  });

  await run_case("/ finds a word on the page, n moves to the next match", async () => {
    await press_keys("/", "fox", "-k", "Return");
    const current = () => in_page(`const range = [...(view.CSS.highlights.get("oasis-find-current") ?? [])][0]; return range ? range.startContainer.parentElement.id + ":" + range.startOffset : null;`);
    await poll_until("a current match", async () => (await current()) !== null);
    const first = await current();
    expect(await in_page(`return view.CSS.highlights.get("oasis-find").size;`) >= 3, "fewer than three matches painted for fox");
    await press_keys("n");
    await poll_until("n to move the current match", async () => { const now = await current(); return now !== null && now !== first; });
    await leave_to_normal();
  });

  await run_case("caret and visual mode select a paragraph, y copies it, and Ctrl+V pastes it in the paste box", async () => {
    await hint_by_text(";v", "liste", "practice-prose-2");
    await wait_badge(["CARET"]);
    await press_keys("v");
    await wait_badge(["VISUAL"]);
    await press_keys("e", "e");
    await sleep(300);
    await press_keys("y");
    await leave_to_normal();
    await in_page(`${by_id("practice-paste")}.focus();`);
    await press_keys("-M", "ctrl", "v", "-m", "ctrl");
    await poll_until("the paste box to hold the copied text", async () => (await in_page(`return ${by_id("practice-paste")}.value;`)).length > 0);
    const pasted = await in_page(`return ${by_id("practice-paste")}.value;`);
    const paragraph = await in_page(`return ${by_id("practice-prose-2")}.textContent;`);
    expect(pasted.trim().length >= 3 && paragraph.includes(pasted.trim()), `the paste box holds ${JSON.stringify(pasted)}, which is not part of ${JSON.stringify(paragraph)}`);
    await in_page(`${by_id("practice-paste")}.blur();`);
    await wait_badge(["NORMAL"]);
  });

  await run_case("insert mode types in the text input and the text area", async () => {
    await in_page(`${by_id("practice-input")}.value = ""; ${by_id("practice-input")}.focus();`);
    await press_keys("h", "i");
    await poll_until("the input to hold hi", async () => (await in_page(`return ${by_id("practice-input")}.value;`)) === "hi");
    await leave_to_normal();
    await in_page(`${by_id("practice-textarea")}.focus();`);
    await press_keys("a", "-k", "Return", "b");
    await poll_until("the text area to hold two lines", async () => (await in_page(`return ${by_id("practice-textarea")}.value;`)) === "a\nb");
    await in_page(`view.document.activeElement.blur();`);
    await wait_badge(["NORMAL"]);
  });

  await run_case("hints reach the slider, the dropdown, the radio buttons and the summary, and each echoes in the log line", async () => {
    await in_page(`${by_id("practice-range")}.scrollIntoView({ block: "center" });`);
    await hint_by_text("f", "rang", "practice-range");
    await poll_until("the hint to focus the slider", async () => (await in_page(`return view.document.activeElement.id;`)) === "practice-range");
    await press_keys("-k", "Right");
    await poll_until("the slider to echo", async () => /^The slider is at \d+\.$/.test(await log_text()));
    await hint_by_text("f", "bra", "practice-radio-2");
    await wait_log("Bravo is chosen.");
    expect(await in_page(`return ${by_id("practice-radio-2")}.checked && !${by_id("practice-radio-1")}.checked;`), "the second radio button is not the only one chosen");
    await hint_by_text("f", "rev", "practice-details");
    await wait_log("The section is open.");
    await hint_by_text("f", "rev", "practice-details");
    await wait_log("The section is closed.");
    await hint_by_text("f", "choi", "practice-select");
    await poll_until("the hint to focus the dropdown", async () => (await in_page(`return view.document.activeElement.id;`)) === "practice-select");
    await press_keys("-k", "Down");
    await wait_log("The dropdown shows Dune.");
    await in_page(`view.document.activeElement.blur();`);
    await leave_to_normal();
  });

  await run_case("a prefix key shows the which-key panel on the page", async () => {
    await press_keys("g");
    // The panel is a top-layer popover in a host that carries its layer number (LAYERS.which_key in src/shared/layers.ts).
    const panel_open = `return [...view.document.documentElement.children].some((node) => node.getAttribute("data-desertfox-layer") === "2147483646" && node.matches(":popover-open"));`;
    await poll_until("the which-key panel to open", async () => await in_page(panel_open));
    await press_keys("-k", "Escape");
    await poll_until("the which-key panel to close", async () => !(await in_page(panel_open)));
  });

  await run_case("a theme change keeps typed text, the selection and the node", async () => {
    await in_page(`const input = ${by_id("practice-input")}; input.value = "keep me"; input.dataset.kept = "yes"; input.focus(); input.setSelectionRange(2, 6); input.blur();`);
    await wait_badge(["NORMAL"]);
    const before = await in_page(`return getComputedStyle(view.document.documentElement).getPropertyValue("--desertfox-bg-core");`);
    await run_line(":set -t theme catppuccin");
    await poll_until("the page colors to change", async () => (await in_page(`return getComputedStyle(view.document.documentElement).getPropertyValue("--desertfox-bg-core");`)) !== before);
    const kept = await in_page(`const input = ${by_id("practice-input")}; return { value: input.value, kept: input.dataset.kept, start: input.selectionStart, end: input.selectionEnd };`);
    expect(kept.value === "keep me" && kept.kept === "yes" && kept.start === 2 && kept.end === 6, `the input after the theme change: ${JSON.stringify(kept)}`);
    await shot("practice-catppuccin-top");
    await shot("practice-catppuccin-middle", "practice-textarea");
    await shot("practice-catppuccin-controls", "practice-radio");
  });

  await run_case("the tab finder lists the Settings and Commands tabs opened by the page links and jumps to one", async () => {
    // F opens the pick in a background tab. The sidebar link of the same name ranks first, so Tab moves to the link on the page.
    for (const [id, start] of [["practice-open-settings", "sett"], ["practice-open-commands", "comm"]]) {
      await in_page(`${by_id(id)}.scrollIntoView({ block: "center" });`);
      await sleep(200);
      await press_keys("F");
      await poll_until("hint mode", async () => (await mode()) === "hint");
      await press_keys("/", start, "-k", "Tab", "-k", "Return");
      await poll_until("hint mode to end", async () => (await mode()) === "normal");
    }
    await poll_until("both tabs to open", async () => await evaluate(`browser.tabs.query({}).then((tabs) => ["#/settings", "#/commands"].every((hash) => tabs.some((tab) => tab.url.endsWith(hash))))`));
    await evaluate(`browser.tabs.query({}).then((tabs) => browser.tabs.update(tabs.find((tab) => tab.url.endsWith("#/practice") || tab.url.includes("#section=practice")).id, { active: true })).then(() => true)`);
    await wait_view_takes_keys("home.html");
    await press_keys(",,");
    const line = await wait_cmdline((state) => state.open && state.focused, "the tab finder to open");
    await press_keys("commands");
    const listed = await wait_cmdline((state) => state.value.endsWith("commands") && state.row_texts.some((text) => text.includes("#/commands")), "a row for the Commands tab");
    await press_keys("-k", "Return");
    await poll_until("the Commands tab to be active", async () => await evaluate(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url.endsWith("#/commands"))`));
    expect(line.open && listed.rows >= 1, `the finder rows: ${JSON.stringify(listed.row_texts)}`);
  });
}
