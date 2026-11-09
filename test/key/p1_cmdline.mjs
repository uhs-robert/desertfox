// Key test cases of the command line piece. The harness calls run_cases with the piece context.
// Each case runs on its own, so a KEY_TEST_ONLY filter can pick any of them.

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export const areas = ["cmdline"];

export async function run_cases({ run_case, setup, expect, send_keys, press_keys, settle_focus, open_page, events, wait_event, wait_cmdline, close_cmdline, poll_until, expect_absent, scroll_report_wait_ms, scroll_of, last_scroll_y, in_background, open_cmdline, type_in_line, run_line, type_in_address_bar }) {
  await setup("open the page the command line cases use", () => open_page("page", "cmd", { new_tab: false }));

  const open_line = async () => {
    await press_keys(":");
    await wait_cmdline((line) => line.ready, "the command line to open");
  };
  const scroll_down_and_wait = async (what) => {
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of("cmd"), what);
  };

  await run_case("colon then a command typed at once, then Enter, runs it with no key lost to the load, and the line is closed after Enter", async () => {
    // Everything arrives within a few milliseconds of the colon, before cmdline.js has loaded.
    const mark = events.length;
    await press_keys(":scroll.pixels --dy=300", "-k", "Return");
    const scrolled = await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scroll.pixels --dy=300", 8000);
    expect(scrolled.y === 300, `scrolled to ${scrolled.y}, expected 300`);
    await wait_cmdline((line) => !line.open, "the line to close after Enter");
    const before = last_scroll_y("cmd");
    await scroll_down_and_wait("j to scroll after the line closed");
    expect(last_scroll_y("cmd") > before, "j did not scroll");
  });

  await run_case("Escape closes the line and returns to normal mode", async () => {
    await open_line();
    const mark = events.length;
    await press_keys("j");
    // The j in the line shows that the line took the key, so the page did not.
    await wait_cmdline((line) => line.value === "j", "j to be typed into the line");
    // The list is open, so the first Escape closes it and the second closes the line.
    await close_cmdline();
    await expect_absent(mark, "cmd", scroll_of("cmd"), "j scrolled the page while the line was open", { report_delay_ms: scroll_report_wait_ms });
    const before = last_scroll_y("cmd");
    await scroll_down_and_wait("j to scroll after Escape");
    expect(last_scroll_y("cmd") > before, "j did not scroll after Escape");
  });

  // Race: the key after Enter reaches the frame while the focus moves back to the page, so the frame hands it back before it goes.
  await run_case("Enter and the next key in one press: the key acts on the page once the line has run", async () => {
    await open_cmdline();
    await type_in_line("scroll.pixels --dy=300");
    const before = last_scroll_y("cmd");
    const mark = events.length;
    await press_keys("-k", "Return", "j");
    // The command and j each scroll, in either order, so only both together pass the line's 300 pixels.
    await wait_event(mark, (event) => scroll_of("cmd")(event) && event.y > before + 300, "j after Enter to scroll past the command's 300 pixels").catch((error) => {
      throw new Error(`${error.message}, last scroll ${last_scroll_y("cmd")} from ${before}`);
    });
    await wait_cmdline((line) => !line.open, "the line to close after Enter");
  });

  // Race: as above, after the Escape the frame takes as its own key.
  await run_case("Escape and the next key in one press: the key acts on the page", async () => {
    await open_cmdline();
    const before = last_scroll_y("cmd");
    const mark = events.length;
    // The list is open on an empty line, so the first Escape closes it and the second closes the line.
    await press_keys("-k", "Escape", "-k", "Escape", "j");
    await wait_event(mark, (event) => scroll_of("cmd")(event) && event.y > before, "j after Escape to scroll");
    await wait_cmdline((line) => !line.open, "the line to close after Escape");
  });

  await run_case("a failed parse keeps the line open, fixing the line runs it, and Up brings back that command", async () => {
    // The corrected command scrolls to the top, so the page must be below it first or no scroll event follows.
    await scroll_down_and_wait("j to scroll away from the top");
    await run_line(":nosuchcommand");
    await wait_cmdline((line) => line.open && line.note !== "", "the parse error under the line");
    // Still open: Ctrl-u clears the line, and the next command still goes to it instead of the page.
    let mark = events.length;
    await press_keys(...CTRL("u"));
    await wait_cmdline((line) => line.open && line.value === "", "Ctrl-u to clear the line");
    await type_in_line("scroll.pixels --dy=-100000");
    await press_keys("-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the corrected command to scroll", 8000);
    expect(last_scroll_y("cmd") === 0, `expected the top, at ${last_scroll_y("cmd")}`);
    await wait_cmdline((line) => !line.open, "the line to close after the corrected command");
    // The page is at the top after the command, so move away first or the recalled command would not scroll.
    await scroll_down_and_wait("j to scroll away from the top again");
    // On a fresh line Up walks the history, though the list is open.
    await open_cmdline();
    await press_keys("-k", "Up");
    await wait_cmdline((line) => line.value === "scroll.pixels --dy=-100000", "Up to bring back the command");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the recalled command to scroll again");
    expect(last_scroll_y("cmd") === 0, "the recalled command was not scroll.pixels --dy=-100000");
  });

  await run_case("the history on disk holds a run command and no failed one", async () => {
    const mark = events.length;
    await run_line(":scroll.pixels --dy=150");
    await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scroll.pixels --dy=150", 8000);
    await wait_cmdline((line) => !line.open, "the line to close after Enter");
    await run_line(":nohistorycommand");
    await wait_cmdline((line) => line.open && line.note !== "", "the parse error under the line");
    await close_cmdline();
    const stored = await in_background(`(async () => (await browser.storage.local.get("desertfox_cmdline_history")).desertfox_cmdline_history ?? [])()`);
    expect(Array.isArray(stored) && stored.includes("scroll.pixels --dy=150"), `history was ${JSON.stringify(stored)}`);
    expect(!stored.includes("nohistorycommand"), "a failed parse was stored");
  });

  // Race: the keys after the first colon of a page wait for cmdline.js, and that wait once dropped every key past the 32nd.
  // Last but one, because it leaves its own tab active.
  await run_case("40 keys typed at once after the first colon of a page all reach the line", async () => {
    await open_page("page", "cmd_first_colon", { new_tab: true });
    const typed = "abcdefghij".repeat(4);
    await press_keys(`:${typed}`);
    await wait_cmdline((line) => line.value === typed, `the line to hold all ${typed.length} keys`, 8000);
    await close_cmdline();
  });

  await run_case("a page with no content script refuses the command line with a notice", async () => {
    // The address bar sends no report when it opens or takes the focus, so these two keep the settle of send_keys.
    await settle_focus();
    await send_keys(...CTRL("t"));
    // Text typed in the same run as Ctrl+L can lose its first character before the address bar has the focus.
    await send_keys(...CTRL("l"));
    await type_in_address_bar("about:support");
    await press_keys("-k", "Return");
    let tab_state;
    await poll_until("about:support to load", async () => (tab_state = await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => ({ url: tab.url, status: tab.status }))`))?.url === "about:support" && tab_state.status === "complete", { timeout_ms: 8000 }).catch((error) => { throw new Error(`${error.message} (tab: ${JSON.stringify(tab_state)})`); });
    await in_background(`(async () => { for (const id of Object.keys(await browser.notifications.getAll())) await browser.notifications.clear(id); })()`);
    try {
      await press_keys(...ALT("."));
      let notices = {};
      await poll_until("the refusal notice", async () => Object.keys((notices = await in_background(`browser.notifications.getAll()`) ?? {})).length > 0, { timeout_ms: 3000 });
      expect(Object.values(notices).some((notice) => /needs a page DesertFox runs on/.test(notice.message)), `notices: ${JSON.stringify(notices)}`);
    } finally {
      // Firefox shows the notice in a window of its own (user.js), which holds the focus until it closes, so a failed case clears it too.
      await in_background(`(async () => { for (const id of Object.keys(await browser.notifications.getAll())) await browser.notifications.clear(id); })()`);
    }
  });
}
