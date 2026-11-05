// Key test cases of array bindings (awaitable commands, routing). run.mjs calls run_cases with its helpers.
// The bindings live in config/keymap.toml: ,n = [tab.next, scroll.to 0], ,h = [hint.run background, scroll 300],
// ,f = [find.next, scroll 300], ,o = [cmdline.open, scroll 300].
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, became_visible }) {
  const close_tabs_with = (text) => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const scroll_of = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const last_scroll_y = (page_id) => events.filter(scroll_of(page_id)).at(-1)?.y ?? 0;
  const ENTER = ["-k", "Return"];
  const ESCAPE = ["-k", "Escape"];

  await run_case("[tab.next, scroll.to] scrolls the tab that tab.next showed, and leaves the first tab alone", async () => {
    await open_page("page", "sq_one", { new_tab: true });
    await open_page("page", "sq_two", { new_tab: true });
    let mark = events.length;
    await send_keys("G");
    await wait_event(mark, scroll_of("sq_two"), "sq_two to scroll to the bottom");
    expect(last_scroll_y("sq_two") > 0, "sq_two did not scroll down");
    mark = events.length;
    await send_keys("gT");
    await wait_event(mark, became_visible("sq_one"), "sq_one after gT");
    await sleep(300);
    mark = events.length;
    await send_keys(",n");
    await wait_event(mark, became_visible("sq_two"), "sq_two after ,n");
    await wait_event(mark, (event) => scroll_of("sq_two")(event) && event.y === 0, "sq_two to scroll to the top");
    expect(!find_event(mark, scroll_of("sq_one")), "the first tab scrolled");
    await close_tabs_with("sq_");
    await sleep(300);
  });

  await run_case("[hint.run, scroll]: a pick resumes the sequence, Escape cancels the rest", async () => {
    await open_page("hints", "sq_hints", { new_tab: true });
    let mark = events.length;
    await send_keys(",h");
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_hints")), "the page scrolled while the hint labels were up");
    await send_keys("s");
    await wait_event(mark, scroll_of("sq_hints"), "the scroll after the hint pick");
    await sleep(500);
    await close_tabs_with("hint_two");
    mark = events.length;
    await send_keys(",h");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_hints")), "the page scrolled after Escape left the hints");
    await close_tabs_with("sq_hints");
    await sleep(300);
  });

  await run_case("[find.next, scroll] with no earlier search stops after the failure", async () => {
    await open_page("page", "sq_find", { new_tab: true });
    const mark = events.length;
    await send_keys(",f");
    await sleep(1000);
    expect(!find_event(mark, scroll_of("sq_find")), "the page scrolled after find.next failed");
    await close_tabs_with("sq_find");
    await sleep(300);
  });

  await run_case("[cmdline.open, scroll]: the page does not scroll behind the open line, Enter resumes, Escape cancels", async () => {
    await open_page("page", "sq_line", { new_tab: true });
    let mark = events.length;
    await send_keys(",o");
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_line")), "the page scrolled behind the open command line");
    await send_keys("scroll.pixels --dy=0", ...ENTER);
    await wait_event(mark, scroll_of("sq_line"), "the scroll after Enter");
    mark = events.length;
    await send_keys(",o");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_line")), "the page scrolled after Escape closed the line");
    await close_tabs_with("sq_line");
    await sleep(300);
  });
}
