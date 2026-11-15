// Key cases of the Practice page (#/practice in the help document). Each case does one lesson with the keys its steps name, on the extension page, and waits for the check lines the page turns done.
// Set DESERTFOX_SHOT_DIR to also save stills of the first screen of the page and of lessons 3, 7, 10 and 11, in the default theme and in catppuccin.
import { SHIFT_ESCAPE } from "./harness.mjs";
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["help", "hints", "scroll", "whichkey", "find", "caret", "cmdline", "tabs", "config", "ui"];

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
// <A-?> is Alt+Shift+/ on the test layout.
const WHICH_KEY = ["-M", "alt", "-M", "shift", "/", "-m", "shift", "-m", "alt"];
const SHOT_LESSONS = ["headings", "slider", "command-line", "tabs"];

export async function run_cases({ run_case, expect, press_keys, poll_until, wait_view_takes_keys, rdp, extension_id, extension_view, close_tabs_with, on_teardown, take_shot, sleep, wait_cmdline, type_in_line, close_cmdline }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);
  // The tab lesson opens two more help tabs, so the view is the one that shows Practice. While that tab shows the Commands page, it is the only help tab.
  const view = `(browser.extension.getViews({ type: "tab" }).find((each) => each.location.pathname === "/home.html" && each.location.hash.includes("practice")) ?? ${extension_view("home.html")})`;
  const in_page = (code) => evaluate(`(() => { const view = ${view}; ${code} })()`);
  const by_id = (id) => `view.document.getElementById(${JSON.stringify(id)})`;
  const badge = () => in_page(`return view.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null;`);
  const wait_badge = (accepted) => poll_until(`the badge to be ${accepted.join(" or ")}`, async () => accepted.includes(await badge()));
  const mode = () => in_page(`return view.desertfox_host?.get_mode() ?? null;`);
  const wait_mode = (wanted) => poll_until(`${wanted} mode`, async () => (await mode()) === wanted);
  const focused_id = () => in_page(`return view.document.activeElement?.id ?? "";`);
  const wait_focus = (id) => poll_until(`the focus on ${id}`, async () => (await focused_id()) === id);
  const is_done = (slug, name) => in_page(`return ${by_id(`practice-check-${slug}-${name}`)}.getAttribute("data-done") === "true";`);
  const wait_done = (slug, ...names) => Promise.all(names.map((name) => poll_until(`the check "${name}" of lesson ${slug} to turn done`, () => is_done(slug, name))));
  const heading_top = (slug) => in_page(`return Math.round(${by_id(`practice-${slug}`)}.getBoundingClientRect().top);`);
  const scroll_y = () => in_page(`return view.scrollY;`);

  async function leave_to_normal() {
    await in_page(`view.document.activeElement?.blur();`);
    for (let step = 0; step < 3 && (await badge()) !== "NORMAL"; step++) {
      await press_keys("-k", "Escape");
      await sleep(200);
    }
    await wait_badge(["NORMAL"]);
  }
  // Puts a lesson where a heading jump puts it: its heading at the top of the view, so only its own targets are on screen.
  async function to_lesson(slug) {
    await leave_to_normal();
    await in_page(`${by_id(`practice-${slug}`)}.scrollIntoView();`);
    await poll_until(`lesson ${slug} at the top of the view`, async () => Math.abs(await heading_top(slug)) < 4);
    // One watch tick, so a check that needs the lesson on screen first has seen it.
    await sleep(400);
  }
  // The label drawn on a target. The labels sit in a closed shadow root that only privileged code reads, and each is placed at its element.
  const label_at = (selector) => in_page(`
    const target = view.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const labels = [...view.document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => label.style.display !== "none" && label.style.visibility !== "hidden");
    const near = labels.map((label) => { const box = label.getBoundingClientRect(); return { text: label.textContent, far: Math.hypot(box.left - target.left, box.top - target.top) }; }).sort((a, b) => a.far - b.far)[0];
    return near && near.far < 30 ? near.text : null;`);
  // Types the label of a target, as a reader does after a hint key.
  async function pick(selector, { one_letter = false } = {}) {
    let label;
    await poll_until(`a hint label on ${selector}`, async () => (label = await label_at(selector)) !== null);
    if (one_letter) expect(label.length === 1, `the label on ${selector} is "${label}", so the lesson no longer keeps its targets to one letter`);
    await press_keys(label);
  }
  // The first pass of ;gg labels only the draggable cards. Its labels stay up until the second pass replaces them, and one sits near a column corner, so a column pick waits for the labels of every place.
  const wait_target_labels = () => poll_until("the labels of the drop targets", async () => (await in_page(`return [...view.document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => label.style.display !== "none" && label.style.visibility !== "hidden" && label.textContent.length > 1).length;`)) > 0);
  async function hint(keys, selector, options) {
    await press_keys(keys);
    await wait_mode("hint");
    await pick(selector, options);
  }
  async function type_line_and_run(key, text) {
    await press_keys(key);
    await wait_cmdline((line) => line.open && line.focused, "the command line to open");
    await type_in_line(text);
    await press_keys("-k", "Return");
  }
  const practice_tab_active = () => evaluate(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url.includes("practice"))`);

  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  async function shots(theme) {
    if (!shot_dir) return;
    // Each shot starts from the top at rest, so no jump here starts inside a lesson that watches for jumps.
    const to_top = async () => {
      await leave_to_normal();
      await in_page(`view.scrollTo(0, 0);`);
      await sleep(700);
    };
    await to_top();
    await take_shot(`${shot_dir}/practice-${theme}-first-screen.png`);
    for (const slug of SHOT_LESSONS) {
      await to_top();
      await to_lesson(slug);
      await take_shot(`${shot_dir}/practice-${theme}-${slug}.png`);
    }
  }
  // The test Firefox reports light mode. A shot run forces dark, as the maintainer runs it, and puts the pref back.
  if (shot_dir) {
    on_teardown(() => evaluate_in_chrome(rdp, `Services.prefs.clearUserPref("layout.css.prefers-color-scheme.content-override")`));
    await evaluate_in_chrome(rdp, `Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 0)`);
  }

  on_teardown(async () => {
    await close_tabs_with("/home.html");
    const tab_id = await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/practice"), active: true }).then((tab) => tab.id)`);
    await poll_until("the page to load", async () => await in_page(`return !!view && !!${by_id("practice-end")};`).catch(() => false), { timeout_ms: 10000 });
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_setting", name: "theme", action: "reset" });`);
    await evaluate(`browser.tabs.setZoom(${tab_id}, 1).then(() => browser.tabs.remove(${tab_id})).then(() => true)`);
    await close_tabs_with("/home.html");
  });

  await close_tabs_with("/home.html");
  await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/practice"), active: true }).then(() => true)`);
  await poll_until("the Practice page to render and take focus", async () => await in_page(`return !!view && !!${by_id("practice-end")} && view.document.hasFocus();`).catch(() => false), { timeout_ms: 10000 });
  await wait_view_takes_keys("home.html");

  await run_case("the page opens on one welcome line with lesson 1 right below it, fourteen lessons, no jump links and no section list", async () => {
    const shape = await in_page(`
      const doc = view.document;
      const intro = doc.querySelector(".desertfox-practice-intro");
      const page_text = doc.querySelector(".desertfox-help-page").textContent;
      const step_of = (lesson, index) => doc.getElementById(lesson).closest("section").querySelectorAll("ol > li")[index].textContent;
      return {
        lessons: [...doc.querySelectorAll(".desertfox-practice-lesson h2")].map((heading) => heading.id),
        intro: intro.textContent,
        gap: doc.getElementById("practice-scroll").getBoundingClientRect().top - intro.getBoundingClientRect().bottom,
        end: doc.getElementById("practice-end").textContent,
        jump_links: doc.querySelectorAll('[id^="practice-link-"]').length,
        sidebar_sections: doc.querySelectorAll('.desertfox-help-sidebar a[href^="#section=practice"]').length,
        says_click: /click/i.test(page_text),
        names_caret_key: page_text.includes("^"),
        has_temp_flag: / -t | --temp/.test(page_text),
        theme_step: step_of("practice-command-line", 1),
        unsets: /unset/.test(page_text),
        leaving_steps: [step_of("practice-command-line", 3), step_of("practice-tabs", 1), step_of("practice-video", 0)],
        hash: view.location.hash,
      };`);
    expect(shape.lessons.length === 14 && shape.lessons[0] === "practice-scroll" && shape.lessons[13] === "practice-ignore", `the lessons are ${JSON.stringify(shape.lessons)}`);
    expect(shape.intro === "Welcome! These lessons will teach you the basic keys needed for web browsing.", `the welcome line is ${JSON.stringify(shape.intro)}`);
    expect(shape.gap >= 0 && shape.gap < 60, `lesson 1 starts ${shape.gap} px under the welcome line, so a gap sits between them`);
    expect(shape.jump_links === 0 && shape.sidebar_sections === 0, `jump links ${shape.jump_links}, sidebar sections ${shape.sidebar_sections}`);
    expect(!shape.says_click, `the page says "click"`);
    expect(!shape.names_caret_key, "the page names the ^ key");
    expect(!shape.has_temp_flag, "a command example carries the temp flag");
    expect(!shape.unsets, "the page teaches unset, which also drops a theme the visitor chose in Settings");
    expect(shape.theme_step.includes("set theme catppuccin") && shape.theme_step.includes("set theme dracula"), `the theme step is ${JSON.stringify(shape.theme_step)}`);
    // A step that leaves the page names the way back before the key that leaves.
    const ways_back = ["H goes back one page, so it brings you back here.", "dd closes the tab you are on, and that brings you back here.", "H goes back one page, so it brings you back here from the video."];
    shape.leaving_steps.forEach((step, index) => expect(step.startsWith(ways_back[index]), `a step that leaves the page does not start with the way back: ${JSON.stringify(step)}`));
    expect(shape.end.includes("<A-?>") && /:.* opens the command line/.test(shape.end) && shape.end.includes("Tab"), `the end does not name which-key and the command line: ${JSON.stringify(shape.end)}`);
    // A first visit stays at the top, with no lesson in the address.
    await sleep(700);
    expect((await in_page(`return view.location.hash;`)) === "#/practice" && shape.hash === "#/practice", "a first visit put a lesson in the address");
  });

  await shots("oasis-moonlight");

  await run_case("lesson 1: j, k, Ctrl+D, Ctrl+U, G, gg scroll the page and l and h move the wide strip", async () => {
    await in_page(`view.scrollTo(0, 0);`);
    await poll_until("the page to be at the top", async () => (await scroll_y()) === 0);
    await press_keys("j", "j", "j");
    await wait_done("scroll", "down");
    const lowest = await scroll_y();
    await press_keys("k");
    await poll_until("k to scroll up", async () => (await scroll_y()) < lowest);
    const before = await scroll_y();
    await press_keys(...CTRL("d"));
    await poll_until("Ctrl+D to scroll down", async () => (await scroll_y()) > before);
    const lower = await scroll_y();
    await press_keys(...CTRL("u"));
    await poll_until("Ctrl+U to scroll up", async () => (await scroll_y()) < lower);
    await press_keys("G");
    await wait_done("scroll", "end");
    await press_keys("gg");
    await wait_done("scroll", "top");
    await to_lesson("scroll");
    await press_keys("l", "l", "l");
    await wait_done("scroll", "strip");
    const strip_left = () => in_page(`return ${by_id("practice-strip")}.scrollLeft;`);
    const moved_right = await strip_left();
    await press_keys("h");
    await poll_until("h to move the strip back", async () => (await strip_left()) < moved_right);
    expect((await in_page(`return view.scrollX;`)) === 0, "l moved the page sideways, not the strip");
    const at = await scroll_y();
    await press_keys("5", "j");
    await poll_until("5j to scroll", async () => (await scroll_y()) > at);
  });

  await run_case("lesson 2: Alt+? lists the keys, z narrows to zoom, and the listed keys zoom in and reset", async () => {
    await to_lesson("which-key");
    // The panel is a top-layer popover in a host that carries its layer number (LAYERS.which_key in src/shared/layers.ts).
    const panel_open = `return [...view.document.documentElement.children].some((node) => node.getAttribute("data-desertfox-layer") === "2147483646" && node.matches(":popover-open"));`;
    await press_keys(...WHICH_KEY);
    await poll_until("the which-key panel to open", async () => await in_page(panel_open));
    await press_keys("z");
    await sleep(300);
    expect(await in_page(panel_open), "the panel closed on z, so it no longer shows the zoom group at once");
    await press_keys("i");
    await wait_done("which-key", "zoomed");
    await press_keys(...WHICH_KEY);
    await poll_until("the which-key panel to open again", async () => await in_page(panel_open));
    await press_keys("z", "=");
    await wait_done("which-key", "reset");
    await poll_until("the which-key panel to close", async () => !(await in_page(panel_open)));
  });

  await run_case("lesson 3: ]h and [h step by heading and sh picks a heading from the list", async () => {
    await to_lesson("headings");
    // The jump that brought the lesson into view started in another lesson, so it does not count.
    await sleep(700);
    expect(!(await is_done("headings", "heading")), "the heading check turned done before ]h was pressed");
    await press_keys("]", "h");
    await poll_until("]h to put lesson 4 at the top", async () => Math.abs(await heading_top("hints")) < 12);
    await wait_done("headings", "heading");
    await press_keys("[", "h");
    await poll_until("[h to put lesson 3 at the top", async () => Math.abs(await heading_top("headings")) < 12);
    await sleep(700);
    expect(!(await is_done("headings", "listed")), "the list check turned done before sh was pressed");
    await type_line_and_run("sh", "grab");
    await poll_until("sh grab to put lesson 7 at the top", async () => Math.abs(await heading_top("slider")) < 12);
    await wait_done("headings", "listed");
    await type_line_and_run("sh", "jump");
    await poll_until("sh jump to return to lesson 3", async () => Math.abs(await heading_top("headings")) < 12);
  });

  await run_case("lesson 4: f and a label rings the bell, opens the section and turns the lights on", async () => {
    await to_lesson("hints");
    await hint("f", "#practice-bell");
    await wait_done("hints", "bell");
    await hint("f", "#practice-details summary");
    await wait_done("hints", "section");
    await hint("f", "#practice-lights");
    await wait_done("hints", "lights");
  });

  await run_case("lesson 5: gi enters the first box, Tab moves on, and ]i walks the other controls", async () => {
    await to_lesson("form");
    await press_keys("g", "i");
    await wait_focus("practice-name");
    await wait_badge(["INSERT"]);
    await press_keys("ada", "-k", "Tab", "mail", "-k", "Tab", "note");
    await wait_done("form", "typed");
    await press_keys("-k", "Tab");
    await wait_focus("practice-subscribe");
    await wait_badge(["NORMAL"]);
    await press_keys("-k", "space");
    await wait_done("form", "ticked");
    await press_keys("]", "i");
    await wait_focus("practice-topic");
    await press_keys("-k", "Down");
    await wait_done("form", "chosen");
    await press_keys("]", "i");
    await wait_focus("practice-send");
    await press_keys("-k", "Return");
    await wait_done("form", "sent");
    await press_keys("[", "i");
    await wait_focus("practice-topic");
  });

  await run_case("lesson 6: ;i picks a radio and the dropdown by one letter, ;ri ticks three boxes in one go, ;b presses Done", async () => {
    await to_lesson("inputs");
    await hint(";i", "#practice-radio-2", { one_letter: true });
    await wait_done("inputs", "bravo");
    await press_keys("-k", "Down");
    await wait_done("inputs", "charlie");
    await hint(";i", "#practice-select", { one_letter: true });
    await wait_focus("practice-select");
    await press_keys("-k", "Down", "-k", "Down");
    await wait_done("inputs", "oasis");
    await press_keys(";ri");
    await wait_mode("hint");
    for (const box of [1, 2, 3]) {
      await pick(`#practice-box-${box}`, { one_letter: true });
      await poll_until(`box ${box} to be ticked`, async () => await in_page(`return ${by_id(`practice-box-${box}`)}.checked;`));
      expect((await mode()) === "hint", `hint mode ended after box ${box}, so the pick was not rapid`);
    }
    await wait_done("inputs", "rapid");
    await press_keys("-k", "Escape");
    await wait_mode("normal");
    await hint(";b", "#practice-done", { one_letter: true });
    await wait_done("inputs", "done");
  });

  await run_case("lesson 7: ;Gg grabs the slider, l moves it, Enter keeps it, and ;gg drops the card in the Done column", async () => {
    await to_lesson("slider");
    await hint(";Gg", "#practice-range", { one_letter: true });
    await wait_mode("grab");
    await press_keys("l", "l", "l", "l", "l");
    await poll_until("the slider to read 7", async () => (await in_page(`return ${by_id("practice-range")}.value;`)) === "7");
    await press_keys("-k", "Return");
    await wait_done("slider", "seven");
    await wait_mode("normal");
    // A wrong drop first: another card in Done leaves the check unticked.
    await hint(";gg", "#practice-card-fix-the-bug");
    await wait_target_labels();
    await pick("#practice-column-done");
    await poll_until("Fix the bug to land in Done", async () => await in_page(`return ${by_id("practice-card-fix-the-bug")}.parentElement.id === "practice-column-done";`));
    await wait_mode("normal");
    expect(!(await is_done("slider", "moved")), "a wrong card in Done ticked the check");
    expect(!(await in_page(`return !!view.document.querySelector(".desertfox-practice-over");`)), "a drop highlight stayed on a column");
    await hint(";gg", "#practice-card-review-the-pr");
    await wait_target_labels();
    await pick("#practice-column-done");
    await wait_done("slider", "moved");
    expect(!(await in_page(`return !!view.document.querySelector(".desertfox-practice-over");`)), "a drop highlight stayed on a column");
    // A card in Done drags out again, and the tick stays.
    await wait_mode("normal");
    await hint(";gg", "#practice-card-review-the-pr");
    await wait_target_labels();
    await pick("#practice-column-doing");
    await poll_until("Review the PR to leave Done", async () => await in_page(`return ${by_id("practice-card-review-the-pr")}.parentElement.id === "practice-column-doing";`));
    expect(await is_done("slider", "moved"), "the tick went away when the card left Done");
    await leave_to_normal();
  });

  await run_case("lesson 8: / finds a word, n moves to the next match and N to the one before", async () => {
    await to_lesson("find");
    await type_line_and_run("/", "fox");
    await wait_done("find", "found");
    const current_match = () => in_page(`const [range] = view.CSS.highlights.get("oasis-find-current") ?? []; return range ? range.startContainer.parentElement.id + ":" + range.startOffset : null;`);
    const first = await current_match();
    await press_keys("n");
    await wait_done("find", "stepped");
    await poll_until("n to move to the next match", async () => (await current_match()) !== first);
    await press_keys("N");
    await poll_until("N to move back to the first match", async () => (await current_match()) === first);
    await leave_to_normal();
  });

  await run_case("lesson 9: ;yt copies a paragraph, ;V as y copies one sentence, and Escape, gi and Ctrl+V paste it", async () => {
    await to_lesson("copy");
    await hint(";yt", "#practice-copy-2");
    await wait_mode("normal");
    await press_keys("g", "i");
    await wait_focus("practice-paste");
    await press_keys(...CTRL("v"));
    await wait_done("copy", "paragraph");
    await leave_to_normal();
    await in_page(`${by_id("practice-paste")}.value = "";`);
    await hint(";V", "#practice-copy-1");
    await wait_badge(["VISUAL"]);
    await press_keys("a", "s");
    await sleep(300);
    await press_keys("y");
    // The yank leaves caret mode on, where gi is not a key, so the lesson has Escape first.
    await wait_badge(["CARET"]);
    await press_keys("-k", "Escape");
    await wait_badge(["NORMAL"]);
    await press_keys("g", "i");
    await wait_focus("practice-paste");
    await press_keys(...CTRL("v"));
    await wait_done("copy", "sentence");
    const pasted = await in_page(`return ${by_id("practice-paste")}.value;`);
    expect(pasted.trim() === "Rain is rare in the desert.", `the paste box holds ${JSON.stringify(pasted)}`);
    await leave_to_normal();
  });

  await run_case("lesson 10: the command line shows the theme, changes it and sets it back, keeps the page state, and :help commands with H returns to the lesson", async () => {
    await to_lesson("command-line");
    await in_page(`const input = ${by_id("practice-name")}; input.value = "keep me"; input.dataset.kept = "yes"; input.setSelectionRange(2, 6);`);
    // The toast text sits in a closed shadow root. The extension's own world reads it with openOrClosedShadowRoot.
    const shown_theme = () => in_page(`return [...view.document.documentElement.children].map((child) => child.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent.match(/^theme = "(.+)"$/)?.[1]).find(Boolean) ?? null;`);
    const background = () => in_page(`return view.getComputedStyle(view.document.documentElement).getPropertyValue("--desertfox-bg-core");`);
    const first_background = await background();
    await type_line_and_run(":", "set theme");
    let first_theme;
    await poll_until("set theme to show the theme in use", async () => (first_theme = await shown_theme()) !== null);
    expect(first_theme !== "catppuccin", "the test theme is catppuccin already, so the lesson changes nothing");
    await type_line_and_run(":", "set theme catppuccin");
    await wait_done("command-line", "themed");
    const kept = await in_page(`const input = ${by_id("practice-name")}; return { value: input.value, kept: input.dataset.kept, start: input.selectionStart, end: input.selectionEnd };`);
    expect(kept.value === "keep me" && kept.kept === "yes" && kept.start === 2 && kept.end === 6, `the input after the theme change: ${JSON.stringify(kept)}`);
    await shots("catppuccin");
    await to_lesson("command-line");
    await sleep(700);
    expect(!(await is_done("command-line", "restored")), "the theme check turned done before the theme was set back");
    await type_line_and_run(":", `set theme ${first_theme}`);
    await wait_done("command-line", "restored");
    expect((await background()) === first_background, `the page background is ${await background()}, not the ${first_background} it started with`);
    await poll_until("the page to remember the lesson in its address", async () => (await in_page(`return view.location.hash;`)) === "#section=practice/command-line");
    // A move to another help page and back is not the Commands trip.
    await type_line_and_run(":", "help settings");
    await poll_until("the Settings page to show", async () => (await in_page(`return view.location.hash;`)) === "#/settings");
    await wait_view_takes_keys("home.html");
    await press_keys("H");
    await poll_until("H to return from Settings", async () => (await in_page(`return view.location.hash;`)) === "#section=practice/command-line" && Math.abs(await heading_top("command-line")) < 12);
    await sleep(700);
    expect(!(await is_done("command-line", "returned")), "the return check turned done after a trip to Settings");
    // The trip rebuilt the page, and the checks that were done stay done.
    expect((await is_done("command-line", "themed")) && (await is_done("scroll", "down")), "the done checks were lost when the page was built again");
    await wait_view_takes_keys("home.html");
    await type_line_and_run(":", "help commands");
    await poll_until("the Commands page to show", async () => (await in_page(`return view.location.hash;`)) === "#/commands");
    await wait_view_takes_keys("home.html");
    await press_keys("H");
    await poll_until("H to return to the lesson", async () => (await in_page(`return view.location.hash;`)) === "#section=practice/command-line" && Math.abs(await heading_top("command-line")) < 12);
    await wait_done("command-line", "returned");
  });

  await run_case("a reload lands on the lesson in the address and keeps the done checks", async () => {
    await in_page(`view.document.documentElement.dataset.before_reload = "yes"; view.location.reload();`);
    await poll_until("the page to load again", async () => await in_page(`return !!view && view.document.documentElement.dataset.before_reload === undefined && !!${by_id("practice-end")} && view.document.hasFocus();`).catch(() => false), { timeout_ms: 10000 });
    await poll_until("the reload to land on lesson 10", async () => (await in_page(`return view.location.hash;`)) === "#section=practice/command-line" && Math.abs(await heading_top("command-line")) < 12);
    expect((await is_done("command-line", "returned")) && (await is_done("form", "sent")), "the done checks were lost in the reload");
    await wait_view_takes_keys("home.html");
  });

  await run_case("a Settings tab opened from the sidebar in another lesson stays where it opened", async () => {
    const tab_indexes = () => evaluate(`browser.tabs.query({ currentWindow: true }).then((tabs) => ({ settings: tabs.find((tab) => tab.url.endsWith("#/settings"))?.index ?? null, practice: tabs.find((tab) => /home\\.html#.*practice/.test(tab.url)).index }))`);
    await to_lesson("hints");
    await hint("F", '.desertfox-help-sidebar a[href="#/settings"]');
    await poll_until("the Settings tab to open", async () => (await tab_indexes()).settings !== null);
    // Longer than the 1.5 s between two reads of the tab list.
    await sleep(2000);
    const at = await tab_indexes();
    expect(at.settings === at.practice + 1, `the Settings tab is at ${at.settings} and Practice at ${at.practice}, so the tab was moved`);
    // Entering the tab lesson later does not move it either.
    await to_lesson("tabs");
    await sleep(2000);
    const later = await tab_indexes();
    expect(later.settings === later.practice + 1, `the Settings tab moved to ${later.settings} when the tab lesson came into view`);
    await close_tabs_with("#/settings");
    await poll_until("the Settings tab to close", async () => (await tab_indexes()).settings === null);
  });

  await run_case("lesson 11: F opens two tabs in the background, T jumps to one, dd closes it and lands back here, and Alt+X closes the other from the list", async () => {
    const open_pages = () => evaluate(`browser.tabs.query({}).then((tabs) => ["#/settings", "#/commands"].filter((hash) => tabs.some((tab) => tab.url.endsWith(hash))).length)`);
    await to_lesson("tabs");
    await hint("F", "#practice-open-settings");
    await wait_mode("normal");
    await hint("F", "#practice-open-commands");
    await poll_until("both tabs to open", async () => (await open_pages()) === 2);
    expect(await practice_tab_active(), "F moved to the new tab, so it did not open in the background");
    await wait_done("tabs", "opened");
    const list_tabs = async (text, hash) => {
      await press_keys("T");
      await wait_cmdline((line) => line.open && line.focused, "the tab list to open");
      return type_in_line(text, { until: (line) => line.row_texts.some((row) => row.includes(hash)), what: `a row for ${hash}` });
    };
    async function highlight(hash) {
      let line = await wait_cmdline((state) => state.open, "the tab list");
      for (let step = 0; step < 5 && !(line.row_texts[line.selected] ?? "").includes(hash); step++) {
        const before = line.selected;
        await press_keys("-k", "Down");
        line = await wait_cmdline((state) => state.selected !== before, "the Down arrow to move to the next row");
      }
      expect((line.row_texts[line.selected] ?? "").includes(hash), `the Down arrow did not reach the ${hash} row: ${JSON.stringify(line.row_texts)}`);
    }
    await poll_until("the Settings tab to sit just before the Practice tab", async () => await evaluate(`browser.tabs.query({ currentWindow: true }).then((tabs) => tabs.find((tab) => tab.url.endsWith("#/settings")).index === tabs.find((tab) => /home\\.html#.*practice/.test(tab.url)).index - 1)`));
    // Typed text narrows the list loosely, so the Down arrow steps to the wanted row, as the lesson says.
    await list_tabs("settings", "#/settings");
    await highlight("#/settings");
    await press_keys("-k", "Return");
    await poll_until("the Settings tab to be active", async () => await evaluate(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url.endsWith("#/settings"))`));
    // The probe of wait_view_takes_keys goes to the first help view, which is the Practice tab, so the Settings tab gets a pause instead.
    await sleep(500);
    await press_keys("dd");
    await poll_until("dd to close the Settings tab", async () => (await open_pages()) === 1);
    await poll_until("dd to land on the Practice tab", async () => (await practice_tab_active()) && (await in_page(`return view.document.hasFocus();`)));
    await sleep(500);
    await wait_done("tabs", "returned");
    await list_tabs("comm", "#/commands");
    await highlight("#/commands");
    await press_keys(...ALT("x"));
    await poll_until("Alt+X to close the Commands tab", async () => (await open_pages()) === 0);
    await close_cmdline();
    expect(await practice_tab_active(), "closing a tab from the list left the Practice tab");
    await wait_done("tabs", "closed");
  });

  await run_case("lesson 12: f on the video link leaves for the watch page in this tab, and the return turns its check done", async () => {
    await to_lesson("video");
    const link = await in_page(`const link = ${by_id("practice-video-link")}; return { href: link.href, target: link.target };`);
    expect(link.href === "https://www.youtube.com/watch?v=dQw4w9WgXcQ" && link.target === "", `the video link is ${JSON.stringify(link)}`);
    // The test session has no network, so the trip is stood in for: the pick that leaves, held back from navigating, then the show event of the way back.
    await in_page(`${by_id("practice-video-link")}.addEventListener("click", (event) => { event.preventDefault(); view.document.documentElement.dataset.video_picked = "yes"; }, { once: true });`);
    await hint("f", "#practice-video-link");
    await poll_until("f to pick the video link", async () => await in_page(`return view.document.documentElement.dataset.video_picked === "yes";`));
    await in_page(`view.dispatchEvent(new view.PageTransitionEvent("pageshow", { persisted: true }));`);
    await wait_done("video", "returned");
  });

  await run_case("lesson 13: a mark and Ctrl+O both return to the lesson, and scrolling back does not count", async () => {
    await to_lesson("marks");
    await press_keys("G");
    await poll_until("G to leave the lesson", async () => (await heading_top("marks")) < 0);
    await sleep(700);
    for (let step = 0; step < 8 && (await heading_top("marks")) < 0; step++) {
      const before = await scroll_y();
      await press_keys(...CTRL("u"));
      await poll_until("Ctrl+U to scroll up", async () => (await scroll_y()) < before);
      // More than one watch tick, so the page sees each place on the way.
      await sleep(700);
    }
    expect((await heading_top("marks")) >= 0, "Ctrl+U did not scroll back to the lesson");
    expect(!(await is_done("marks", "marked")), "the mark check turned done after scrolling back, with no mark jump");
    await to_lesson("marks");
    await press_keys("m", "a");
    await press_keys("G");
    await poll_until("G to leave the lesson", async () => (await heading_top("marks")) < 0);
    await sleep(700);
    await press_keys("'", "a");
    await poll_until("'a to return to the lesson", async () => Math.abs(await heading_top("marks")) < 12);
    await wait_done("marks", "marked");
    await press_keys("gg");
    await poll_until("gg to reach the start", async () => (await scroll_y()) === 0);
    await sleep(700);
    await press_keys(...CTRL("o"));
    await wait_done("marks", "jumped");
  });

  await run_case("lesson 14: j stays with DesertFox, Ctrl+V passes one, and ignore mode passes them all", async () => {
    await to_lesson("ignore");
    const count = () => in_page(`return ${by_id("practice-j-count")}.textContent;`);
    await press_keys("j");
    await sleep(300);
    expect((await count()) === "The page received j 0 times.", `after a plain j: ${await count()}`);
    await press_keys(...CTRL("v"), "j");
    await wait_done("ignore", "passed");
    await press_keys(...SHIFT_ESCAPE);
    await wait_badge(["IGNORE"]);
    await press_keys("j", "j", "j");
    await wait_done("ignore", "ignored");
    await press_keys(...SHIFT_ESCAPE);
    await wait_badge(["NORMAL"]);
  });
}
