// Key test cases of the command line piece. The harness calls run_cases with the piece context.
// Each case runs on its own, so a KEY_TEST_ONLY filter can pick any of them.

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function run_cases({ run_case, setup, expect, send_keys, sleep, open_page, events, wait_event, scroll_of, last_scroll_y, find_event, in_background }) {
  await setup("open the page the command line cases use", () => open_page("page", "cmd", { new_tab: false }));

  await run_case("colon then a command typed at once, then Enter, runs it with no key lost to the load, and the line is closed after Enter", async () => {
    // Everything arrives within a few milliseconds of the colon, before cmdline.js has loaded.
    const mark = events.length;
    await send_keys(":scroll.pixels --dy=300", "-k", "Return");
    const scrolled = await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scroll.pixels --dy=300", 8000);
    expect(scrolled.y === 300, `scrolled to ${scrolled.y}, expected 300`);
    await sleep(300);
    const before = last_scroll_y("cmd");
    const after_enter = events.length;
    await send_keys("j");
    await wait_event(after_enter, scroll_of("cmd"), "j to scroll after the line closed");
    expect(last_scroll_y("cmd") > before, "j did not scroll");
  });

  await run_case("Escape closes the line and returns to normal mode", async () => {
    await send_keys(":");
    await sleep(600);
    const mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, scroll_of("cmd")), "j scrolled the page while the line was open");
    // The list is open, so the first Escape closes it and the second closes the line.
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(400);
    const after = events.length;
    const before = last_scroll_y("cmd");
    await send_keys("j");
    await wait_event(after, scroll_of("cmd"), "j to scroll after Escape");
    expect(last_scroll_y("cmd") > before, "j did not scroll after Escape");
  });

  await run_case("a failed parse keeps the line open, fixing the line runs it, and Up brings back that command", async () => {
    await send_keys(":nosuchcommand", "-k", "Return");
    await sleep(500);
    // Still open: Ctrl-u clears the line, and the next command still goes to it instead of the page.
    let mark = events.length;
    await send_keys(...CTRL("u"));
    await send_keys("scroll.pixels --dy=-100000", "-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the corrected command to scroll", 8000);
    expect(last_scroll_y("cmd") === 0, `expected the top, at ${last_scroll_y("cmd")}`);
    // The page is at the top after the command, so move away first or the recalled command would not scroll.
    await send_keys("j");
    await sleep(400);
    // On a fresh line Up walks the history, though the list is open.
    await send_keys(":", "-k", "Up");
    await sleep(300);
    mark = events.length;
    await send_keys("-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the recalled command to scroll again");
    expect(last_scroll_y("cmd") === 0, "the recalled command was not scroll.pixels --dy=-100000");
  });

  await run_case("the history on disk holds a run command and no failed one", async () => {
    const mark = events.length;
    await send_keys(":scroll.pixels --dy=150", "-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scroll.pixels --dy=150", 8000);
    await send_keys(":nohistorycommand", "-k", "Return");
    await sleep(500);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(400);
    const stored = await in_background(`(async () => (await browser.storage.local.get("desertfox_cmdline_history")).desertfox_cmdline_history ?? [])()`);
    expect(Array.isArray(stored) && stored.includes("scroll.pixels --dy=150"), `history was ${JSON.stringify(stored)}`);
    expect(!stored.includes("nohistorycommand"), "a failed parse was stored");
  });

  await run_case("a page with no content script refuses the command line with a notice", async () => {
    await send_keys(...CTRL("t"));
    await send_keys(...CTRL("l"), "about:support", "-k", "Return");
    await sleep(1500);
    await in_background(`(async () => { for (const id of Object.keys(await browser.notifications.getAll())) await browser.notifications.clear(id); })()`);
    await send_keys(...ALT("."));
    let notices = {};
    for (let waited = 0; waited < 3000 && Object.keys(notices).length === 0; waited += 250) {
      await sleep(250);
      notices = await in_background(`browser.notifications.getAll()`);
    }
    expect(Object.values(notices).some((notice) => /needs a page DesertFox runs on/.test(notice.message)), `notices: ${JSON.stringify(notices)}`);
  });
}
