// Key test cases of the command line piece. run.mjs calls p1_cases with the helpers it already has.

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function p1_cases(t) {
  const { run_case, expect, send_keys, sleep, open_page, events, wait_event, scroll_of, last_scroll_y, find_event, evaluate_in_background, rdp, EXTENSION_ID } = t;

  await open_page("page", "cmd", { new_tab: true });

  await run_case("colon then a command typed at once, then Enter, runs it with no key lost to the load", async () => {
    // Everything arrives within a few milliseconds of the colon, before cmdline.js has loaded.
    const mark = events.length;
    await send_keys(":scrollpx dy=300", "-k", "Return");
    const scrolled = await wait_event(mark, scroll_of("cmd"), "the page to scroll after :scrollpx dy=300", 8000);
    expect(scrolled.y === 300, `scrolled to ${scrolled.y}, expected 300`);
  });

  await run_case("the line is closed after Enter, so j scrolls the page again", async () => {
    await sleep(300);
    const before = last_scroll_y("cmd");
    const mark = events.length;
    await send_keys("j");
    await wait_event(mark, scroll_of("cmd"), "j to scroll after the line closed");
    expect(last_scroll_y("cmd") > before, "j did not scroll");
  });

  await run_case("Escape closes the line and returns to normal mode", async () => {
    await send_keys(":");
    await sleep(600);
    const mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, scroll_of("cmd")), "j scrolled the page while the line was open");
    await send_keys("-k", "Escape");
    await sleep(400);
    const after = events.length;
    const before = last_scroll_y("cmd");
    await send_keys("j");
    await wait_event(after, scroll_of("cmd"), "j to scroll after Escape");
    expect(last_scroll_y("cmd") > before, "j did not scroll after Escape");
  });

  await run_case("a failed parse keeps the line open, and fixing the line runs it", async () => {
    await send_keys(":nosuchcommand", "-k", "Return");
    await sleep(500);
    // Still open: Ctrl-u clears the line, and the next command still goes to it instead of the page.
    const mark = events.length;
    await send_keys(...CTRL("u"));
    await send_keys("scrollpx dy=-100000", "-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the corrected command to scroll", 8000);
    expect(last_scroll_y("cmd") === 0, `expected the top, at ${last_scroll_y("cmd")}`);
  });

  await run_case("Up brings back the last command", async () => {
    // The page is at the top after the last command, so move away first or the recalled command would not scroll.
    await send_keys("j");
    await sleep(400);
    await send_keys(":", "-k", "Up");
    await sleep(300);
    const mark = events.length;
    await send_keys("-k", "Return");
    await wait_event(mark, scroll_of("cmd"), "the recalled command to scroll again");
    expect(last_scroll_y("cmd") === 0, "the recalled command was not scrollpx dy=-100000");
  });

  await run_case("the history on disk holds the run commands and no failed one", async () => {
    const stored = await evaluate_in_background(rdp, EXTENSION_ID, `(async () => (await browser.storage.local.get("oasisfox_cmdline_history")).oasisfox_cmdline_history ?? [])()`);
    expect(Array.isArray(stored) && stored.includes("scrollpx dy=300") && stored.includes("scrollpx dy=-100000"), `history was ${JSON.stringify(stored)}`);
    expect(!stored.includes("nosuchcommand"), "a failed parse was stored");
  });

  await run_case("a page with no content script refuses the command line with a notice", async () => {
    await send_keys(...CTRL("t"));
    await send_keys(...CTRL("l"), "about:support", "-k", "Return");
    await sleep(1500);
    await evaluate_in_background(rdp, EXTENSION_ID, `(async () => { for (const id of Object.keys(await browser.notifications.getAll())) await browser.notifications.clear(id); })()`);
    await send_keys(...ALT("."));
    let notices = {};
    for (let waited = 0; waited < 3000 && Object.keys(notices).length === 0; waited += 250) {
      await sleep(250);
      notices = await evaluate_in_background(rdp, EXTENSION_ID, `browser.notifications.getAll()`);
    }
    expect(Object.values(notices).some((notice) => /needs a page OasisFox runs on/.test(notice.message)), `notices: ${JSON.stringify(notices)}`);
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  // Close the tab of these cases.
  await send_keys(...CTRL("w"));
  await sleep(700);
  // Closing a tab can leave the keyboard focus in the browser chrome.
  await send_keys(...ALT(","));
  await sleep(500);
}
