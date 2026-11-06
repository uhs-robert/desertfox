// Key test cases of piece P2 (prompts). run.mjs calls run_cases with its helpers.
// `go = ":open"` in the test keymap carries an explicit prompt, so the router opens the command line with `open ` typed in.
import { evaluate_in_background } from "./rdp.mjs";

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, url_of }) {
  const scrolled = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const history = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.storage.local.get("desertfox_cmdline_history")).desertfox_cmdline_history ?? [])()`);

  await open_page("page", "p2_start", { new_tab: true });

  await run_case("go opens the command line with open typed in, and the key did not run", async () => {
    await send_keys("go");
    await sleep(800);
    const mark = events.length;
    // The line has the keys now, so j types into it instead of scrolling.
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, scrolled("p2_start")), "j scrolled the page while the line was open");
    await send_keys(...CTRL("u"));
    // The cleared line lists every command, so the first Escape closes the list and the second closes the line.
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(400);
  });

  await run_case("Enter on a typed value after go runs once and records the line", async () => {
    await send_keys("go");
    await sleep(800);
    const mark = events.length;
    await send_keys(url_of("page", "p2_target"), "-k", "Return");
    await wait_event(mark, loaded("p2_target"), "the typed address to load");
    await sleep(500);
    expect(events.slice(mark).filter(loaded("p2_target")).length === 1, "the page loaded more than once");
    expect((await history()).some((line) => line.includes("p2_target")), "the line is not in the history");
  });

  await run_case("a typed command that lacks its value shows the error, stays open and then submits once", async () => {
    await open_page("page", "p2_pre", { new_tab: false });
    const before = (await history()).length;
    await send_keys(":open", "-k", "Return");
    await sleep(700);
    expect((await history()).length === before, "the incomplete line was recorded or run");
    const mark = events.length;
    // Still open: the next characters go to the same line and Enter submits it.
    await send_keys(" ", url_of("page", "p2_filled"), "-k", "Return");
    await wait_event(mark, loaded("p2_filled"), "the completed line to run");
    await sleep(500);
    expect(events.slice(mark).filter(loaded("p2_filled")).length === 1, "the completed line ran more than once");
  });

  await run_case("a scheme-less address typed into the command line opens on https, not on the extension", async () => {
    await open_page("page", "p2_bare", { new_tab: false });
    await send_keys(":open www.example.com/desertfox_bare", "-k", "Return");
    const active_url = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].url)()`);
    let url = "";
    for (let attempt = 0; attempt < 30 && !url.includes("desertfox_bare"); attempt++) {
      await sleep(300);
      url = await active_url();
    }
    expect(url.startsWith("https://www.example.com/desertfox_bare"), `the tab is at ${url}`);
    // Leave the pending external load behind before the next cases.
    await open_page("page", "p2_after_bare", { new_tab: false });
  });

  await run_case("sd, a config search key on the selection with no engine named, opens the command line when nothing is selected", async () => {
    await open_page("page", "p2_search", { new_tab: false });
    await send_keys("sd");
    await sleep(800);
    const mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, scrolled("p2_search")), "j scrolled the page while the line was open");
    await send_keys(...CTRL("u"));
    // The cleared line lists every command, so the first Escape closes the list and the second closes the line.
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(400);
  });

  // Close the tab of these cases.
  await send_keys(...CTRL("w"));
  await sleep(700);
  await send_keys(...ALT(","));
  await sleep(500);
}
