// Key test cases of piece P3 (command line completion). run.mjs calls run_cases with its helpers.
// The line page sits in an iframe at the extension origin, which neither executeScript nor the debugger helper here
// can read. The cases drive it with keys and check what the commands it runs did. The look is checked in screenshots:
// set DESERTFOX_SHOT_DIR to save the list on open, after a fuzzy match (tab.close shows its keys in the last column) and in a narrow window.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export const areas = ["cmdline"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, press_keys, open_page, wait_event, wait_cmdline, close_cmdline, close_tabs_with, poll_until, settle_focus, expect_absent, scroll_report_wait_ms, take_shot, events, expect, sleep, scroll_of, last_scroll_y, scroll_delta_after, became_visible, type_in_line, complete_in_line }) {
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const set_zoom = (factor) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.setZoom(tab.id, ${factor}); })()`);
  const active_url = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].url)()`);
  const tab_urls = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => tab.url))()`);

  // Opens the line on a page that has the keys. The tab before may have been switched or closed by the case before.
  const open_line = async () => {
    await settle_focus();
    await press_keys(":");
    await wait_cmdline((line) => line.ready, "the command line to open");
  };

  await open_page("page", "p9_start", { new_tab: true });
  await open_page("page", "p9_target", { new_tab: true });

  if (shot_dir) {
    await run_case("screenshots of the list on open, after a fuzzy match and in a narrow window", async () => {
      await send_keys(":");
      await sleep(900);
      await take_shot(`${shot_dir}/list-on-open.png`);
      await send_keys("tab.c");
      await sleep(500);
      await take_shot(`${shot_dir}/fuzzy-match.png`);
      await send_keys(...CTRL("u"));
      await sleep(300);
      await set_zoom(3);
      await sleep(900);
      await take_shot(`${shot_dir}/narrow.png`);
      // 3.75 times zoom makes the line 512px wide, 32rem: just above where the widgets hide.
      await set_zoom(3.75);
      await sleep(900);
      await take_shot(`${shot_dir}/narrow-32rem.png`);
      await set_zoom(1);
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
    });
  }

  await run_case("typing tc, Tab and Enter close the tab: the fuzzy match ranks tab.close first and Enter runs the shown line", async () => {
    await open_line();
    const mark = events.length;
    await type_in_line("tc");
    await complete_in_line();
    await press_keys("-k", "Return");
    const shown = await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id !== "p9_target", "another tab after the close");
    expect(shown.page_id === "p9_start", `the visible tab was ${shown.page_id}`);
    expect(!(await tab_urls()).some((url) => url.includes("p9_target")), "p9_target is still open");
  });

  await run_case("tab.close -A then Tab previews its long form, --all-after, and Enter closes the tabs on the right", async () => {
    await open_page("page", "p9_left", { new_tab: true });
    await open_page("page", "p9_right_a", { new_tab: true });
    await open_page("page", "p9_right_b", { new_tab: true });
    // K walks left, so p9_left ends up active with the two new tabs on its right.
    for (const page_id of ["p9_right_a", "p9_left"]) {
      const mark = events.length;
      await press_keys("K");
      await wait_event(mark, became_visible(page_id), `tab ${page_id} after K`);
      await settle_focus();
    }
    await open_line();
    await type_in_line("tab.close -A");
    await complete_in_line();
    await press_keys("-k", "Return");
    await poll_until("the tabs on the right to close", async () => !(await tab_urls()).some((url) => url.includes("p9_right_")));
    const urls = await tab_urls();
    expect(urls.some((url) => url.includes("p9_left")), "the active tab was closed too");
  });

  await run_case("search keyfam. lists the family, Tab previews its engine and Enter runs the search with it", async () => {
    await open_line();
    const mark = events.length;
    await type_in_line("search keyfam.");
    await complete_in_line();
    await type_in_line("hello");
    await press_keys("-k", "Return");
    const result = await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "engine_family", "the family engine page");
    expect(decodeURIComponent(result.search).includes("hello"), `the page opened with ${result.search}`);
    await close_tabs_with("id=engine_family");
  });

  await run_case("Escape hides the list, typing shows it again, and Escape twice more closes the line so the page takes j again", async () => {
    // The tab left active by the case before depends on Firefox, so the page is read from the active tab.
    await settle_focus();
    const page_id = new URL(await active_url()).searchParams.get("id");
    await open_line();
    await press_keys("-k", "Escape");
    await wait_cmdline((line) => line.open && !line.list_open, "Escape to hide the list");
    const mark = events.length;
    // The line is still open, so j types into it and the page does not scroll.
    await press_keys("j");
    await wait_cmdline((line) => line.value === "j" && line.list_open, "j to be typed and to show the list again");
    // The typed j showed the list again, so this Escape only hides it. The next one closes the line.
    await press_keys("-k", "Escape");
    await wait_cmdline((line) => line.open && !line.list_open, "Escape to hide the list again");
    await press_keys("-k", "Escape");
    await wait_cmdline((line) => !line.open, "the second Escape to close the line");
    await expect_absent(mark, page_id, scroll_of(page_id), "j scrolled while the line was open", { report_delay_ms: scroll_report_wait_ms });
    // The line is closed, so j scrolls the page.
    const closed_mark = events.length;
    await press_keys("j");
    await wait_event(closed_mark, scroll_of(page_id), "the page to take j after the line closed");
  });

  await run_case("Ctrl-h on a selected command row opens its help card in a new tab and closes the line", async () => {
    const before = (await tab_urls()).length;
    await open_line();
    await type_in_line("tab.close");
    await complete_in_line();
    await press_keys(...CTRL("h"));
    await poll_until("the help tab at the tab.close card", async () => (await tab_urls()).some((url) => url.includes("home.html#command=tab.close")));
    const urls = await tab_urls();
    expect(urls.length === before + 1, `expected one new tab, got ${urls.length - before}`);
    await close_tabs_with("home.html#command=tab.close");
  });

  await run_case("Ctrl-h with only a typed command word opens that command's help", async () => {
    const before = (await tab_urls()).length;
    await open_line();
    await type_in_line("tab.close --right");
    await press_keys(...CTRL("h"));
    await poll_until("the help tab at the tab.close card", async () => (await tab_urls()).some((url) => url.includes("home.html#command=tab.close")));
    const urls = await tab_urls();
    expect(urls.length === before + 1, "no help tab for the typed word");
    await close_tabs_with("home.html#command=tab.close");
  });

  // The widgets sit in the iframe. The case checks that they leave the line usable and the page where it was, and the shots show the text.
  await run_case("the status widgets on a scrolled page leave the page in place and the line closable", async () => {
    await open_page("aligned", "p9_status", { new_tab: true });
    const mark = events.length;
    await press_keys("G");
    const at_bottom = await wait_event(mark, scroll_of("p9_status"), "scroll to the bottom");
    const open_mark = events.length;
    await open_line();
    if (shot_dir) {
      await sleep(900);
      await take_shot(`${shot_dir}/status-bottom.png`);
    }
    await close_cmdline();
    await expect_absent(open_mark, "p9_status", scroll_of("p9_status"), "the page scrolled while the line was open", { report_delay_ms: scroll_report_wait_ms });
    expect(last_scroll_y("p9_status") === at_bottom.y, "the page scrolled while the line was open");
    expect(await scroll_delta_after("p9_status", ["k"]) < 0, "k did not scroll up after the line closed");
    await open_line();
    if (shot_dir) {
      await sleep(900);
      await take_shot(`${shot_dir}/status-above-bottom.png`);
    }
    await close_cmdline();
  });
}
