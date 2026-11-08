// Key test cases of piece P2 (prompts). run.mjs calls run_cases with its helpers.
// `go = ":open"` in the test keymap carries an explicit prompt, so the router opens the command line with `open ` typed in.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export const areas = ["cmdline", "keys"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, open_page, wait_event, wait_cmdline, close_cmdline, poll_until, settle_focus, barrier, expect_absent, scroll_report_wait_ms, events, expect, url_of, run_line, type_in_line }) {
  const scrolled = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const history = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.storage.local.get("desertfox_cmdline_history")).desertfox_cmdline_history ?? [])()`);
  const loads_of = (mark, page_id) => events.slice(mark).filter(loaded(page_id)).length;
  // After the command ran, one more key on the new page shows that no second load was on its way.
  const expect_one_load = async (mark, page_id, message) => {
    await settle_focus();
    await barrier(page_id);
    expect(loads_of(mark, page_id) === 1, message);
  };
  // A prompt step types the text of the command into the line, so the text is the proof that the key opened it.
  const type_in_open_line = async (prompt_text) => {
    await wait_cmdline((line) => line.open && line.value === prompt_text, `the line to open with "${prompt_text}"`);
    const mark = events.length;
    await press_keys("j");
    // The j in the line shows that the line took the key, so the page did not.
    await wait_cmdline((line) => line.value === `${prompt_text}j`, "j to be typed into the line");
    await press_keys(...CTRL("u"));
    await wait_cmdline((line) => line.value === "", "Ctrl-u to clear the line");
    return mark;
  };

  await open_page("page", "p2_start", { new_tab: true });

  await run_case("go opens the command line with open typed in, and the key did not run", async () => {
    await press_keys("go");
    const mark = await type_in_open_line("open ");
    // The cleared line lists every command, so the first Escape closes the list and the second closes the line.
    await close_cmdline();
    await expect_absent(mark, "p2_start", scrolled("p2_start"), "j scrolled the page while the line was open", { report_delay_ms: scroll_report_wait_ms });
  });

  await run_case("Enter on a typed value after go runs once and records the line", async () => {
    await press_keys("go");
    await wait_cmdline((line) => line.open && line.value === "open ", "the line to open with open typed in");
    const mark = events.length;
    await type_in_line(url_of("page", "p2_target"));
    await press_keys("-k", "Return");
    await wait_event(mark, loaded("p2_target"), "the typed address to load");
    await poll_until("the line in the history", async () => (await history()).some((line) => line.includes("p2_target")));
    await expect_one_load(mark, "p2_target", "the page loaded more than once");
  });

  await run_case("a typed command that lacks its value shows the error, stays open and then submits once", async () => {
    await open_page("page", "p2_pre", { new_tab: false });
    const before = (await history()).length;
    await run_line(":open");
    await wait_cmdline((line) => line.open && line.note !== "", "the error under the line");
    expect((await history()).length === before, "the incomplete line was recorded or run");
    const mark = events.length;
    // Still open: the next characters go to the same line and Enter submits it.
    await type_in_line(` ${url_of("page", "p2_filled")}`);
    await press_keys("-k", "Return");
    await wait_event(mark, loaded("p2_filled"), "the completed line to run");
    await expect_one_load(mark, "p2_filled", "the completed line ran more than once");
  });

  await run_case("a scheme-less address typed into the command line opens on https, not on the extension", async () => {
    await open_page("page", "p2_bare", { new_tab: false });
    await run_line(":open www.example.com/desertfox_bare");
    const active_url = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].url)()`);
    let url = "";
    await poll_until("the tab to head for desertfox_bare", async () => (url = await active_url()).includes("desertfox_bare"), { timeout_ms: 9000 });
    expect(url.startsWith("https://www.example.com/desertfox_bare"), `the tab is at ${url}`);
    // Leave the pending external load behind before the next cases.
    await open_page("page", "p2_after_bare", { new_tab: false });
  });

  await run_case("sd, a config search key on the selection with no engine named, opens the command line when nothing is selected", async () => {
    await open_page("page", "p2_search", { new_tab: false });
    await press_keys("sd");
    const opened = await wait_cmdline((line) => line.ready, "the line to open");
    const mark = events.length;
    await press_keys("j");
    // The j in the line shows that the line took the key, so the page did not.
    await wait_cmdline((line) => line.value === `${opened.value}j`, "j to be typed into the line");
    await press_keys(...CTRL("u"));
    await wait_cmdline((line) => line.value === "", "Ctrl-u to clear the line");
    // The cleared line lists every command, so the first Escape closes the list and the second closes the line.
    await close_cmdline();
    await expect_absent(mark, "p2_search", scrolled("p2_search"), "j scrolled the page while the line was open", { report_delay_ms: scroll_report_wait_ms });
  });
}
