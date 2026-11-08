// Key test cases of the command line piece. The harness calls run_cases with the piece context.
// Each case runs on its own, so a KEY_TEST_ONLY filter can pick any of them.

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export const areas = ["cmdline"];

export async function run_cases({ run_case, setup, expect, send_keys, press_keys, settle_focus, open_page, events, wait_event, wait_cmdline, close_cmdline, poll_until, expect_absent, scroll_report_wait_ms, scroll_of, last_scroll_y, in_background }) {
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

  await run_case("a failed parse keeps the line open, fixing the line runs it, and Up brings back that command", async () => {
    // The corrected command scrolls to the top, so the page must be below it first or no scroll event follows.
    await scroll_down_and_wait("j to scroll away from the top");
    await press_keys(":nosuchcommand", "-k", "Return");
    await wait_cmdline((line) => line.open && line.note !== "", "the parse error under the line");
    // Still open: Ctrl-u clears the line, and the next command still goes to it instead of the page.
    let mark = events.length;
    await press_keys(...CTRL("u"));
    await wait_cmdline((line) => line.open && line.value === "", "Ctrl-u to clear the line");
    await press_keys("scroll.pixels --dy=-100000", "-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the corrected command to scroll", 8000);
    expect(last_scroll_y("cmd") === 0, `expected the top, at ${last_scroll_y("cmd")}`);
    await wait_cmdline((line) => !line.open, "the line to close after the corrected command");
    // The page is at the top after the command, so move away first or the recalled command would not scroll.
    await scroll_down_and_wait("j to scroll away from the top again");
    // On a fresh line Up walks the history, though the list is open.
    await press_keys(":", "-k", "Up");
    await wait_cmdline((line) => line.value === "scroll.pixels --dy=-100000", "Up to bring back the command");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the recalled command to scroll again");
    expect(last_scroll_y("cmd") === 0, "the recalled command was not scroll.pixels --dy=-100000");
  });

  await run_case("the history on disk holds a run command and no failed one", async () => {
    const mark = events.length;
    await press_keys(":scroll.pixels --dy=150", "-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scroll.pixels --dy=150", 8000);
    await wait_cmdline((line) => !line.open, "the line to close after Enter");
    await press_keys(":nohistorycommand", "-k", "Return");
    await wait_cmdline((line) => line.open && line.note !== "", "the parse error under the line");
    await close_cmdline();
    const stored = await in_background(`(async () => (await browser.storage.local.get("desertfox_cmdline_history")).desertfox_cmdline_history ?? [])()`);
    expect(Array.isArray(stored) && stored.includes("scroll.pixels --dy=150"), `history was ${JSON.stringify(stored)}`);
    expect(!stored.includes("nohistorycommand"), "a failed parse was stored");
  });

  await run_case("a page with no content script refuses the command line with a notice", async () => {
    // The address bar has no signal to wait for, so these two keep the settle of send_keys.
    await settle_focus();
    await send_keys(...CTRL("t"));
    // Text typed in the same run as Ctrl+L can lose its first character before the address bar has the focus.
    await send_keys(...CTRL("l"));
    await send_keys("about:support", "-k", "Return");
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
