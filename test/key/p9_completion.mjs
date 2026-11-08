// Key test cases of piece P3 (command line completion). run.mjs calls run_cases with its helpers.
// The line page sits in an iframe at the extension origin, which neither executeScript nor the debugger helper here
// can read. The cases drive it with keys and check what the commands it runs did. The look is checked in screenshots:
// set DESERTFOX_SHOT_DIR to save the list on open, after a fuzzy match (tab.close shows its keys in the last column) and in a narrow window.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export const areas = ["cmdline"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, take_shot, events, expect, sleep, scroll_of, last_scroll_y, scroll_delta_after }) {
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const set_zoom = (factor) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.setZoom(tab.id, ${factor}); })()`);
  const tab_urls = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => tab.url))()`);

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
    await send_keys(":");
    await sleep(600);
    const mark = events.length;
    await send_keys("tc", "-k", "Tab", "-k", "Return");
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
      await sleep(600);
      await send_keys("K");
      await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id === page_id, `tab ${page_id} after K`);
    }
    await sleep(500);
    await send_keys(":");
    await sleep(600);
    await send_keys("tab.close -A", "-k", "Tab", "-k", "Return");
    let urls = await tab_urls();
    for (let attempt = 0; attempt < 20 && urls.some((url) => url.includes("p9_right_")); attempt++) {
      await sleep(250);
      urls = await tab_urls();
    }
    expect(!urls.some((url) => url.includes("p9_right_")), "the tabs on the right are still open");
    expect(urls.some((url) => url.includes("p9_left")), "the active tab was closed too");
  });

  await run_case("search keyfam. lists the family, Tab previews its engine and Enter runs the search with it", async () => {
    await send_keys(":");
    await sleep(600);
    const mark = events.length;
    await send_keys("search keyfam.", "-k", "Tab", "hello", "-k", "Return");
    const result = await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "engine_family", "the family engine page");
    expect(decodeURIComponent(result.search).includes("hello"), `the page opened with ${result.search}`);
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  await run_case("Escape hides the list, typing shows it again, and Escape twice more closes the line so the page takes j again", async () => {
    await send_keys(":");
    await sleep(600);
    await send_keys("-k", "Escape");
    await sleep(400);
    const mark = events.length;
    // The line is still open, so j types into it and the page does not scroll.
    await send_keys("j");
    await sleep(500);
    expect(!events.slice(mark).some((event) => event.type === "scroll"), "j scrolled while the line was open");
    // The typed j showed the list again, so this Escape only hides it. The next one closes the line.
    await send_keys("-k", "Escape");
    await sleep(400);
    await send_keys("-k", "Escape");
    await sleep(400);
    const closed_mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(events.slice(closed_mark).some((event) => event.type === "scroll"), "the line is still open: j did not scroll the page");
  });

  await run_case("Ctrl-h on a selected command row opens its help card in a new tab and closes the line", async () => {
    const before = (await tab_urls()).length;
    await send_keys(":");
    await sleep(600);
    await send_keys("tab.close", "-k", "Tab", ...CTRL("h"));
    await sleep(900);
    const urls = await tab_urls();
    expect(urls.length === before + 1, `expected one new tab, got ${urls.length - before}`);
    expect(urls.some((url) => url.includes("home.html#command=tab.close")), "no help tab at the command card");
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  await run_case("Ctrl-h with only a typed command word opens that command's help", async () => {
    const before = (await tab_urls()).length;
    await send_keys(":");
    await sleep(600);
    await send_keys("tab.close --right", ...CTRL("h"));
    await sleep(900);
    const urls = await tab_urls();
    expect(urls.length === before + 1 && urls.some((url) => url.includes("home.html#command=tab.close")), "no help tab for the typed word");
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  // The widgets sit in the iframe, which no helper here can read. The case checks that they leave the line usable and the page where it was, and the shots show the text.
  await run_case("the status widgets on a scrolled page leave the page in place and the line closable", async () => {
    await open_page("aligned", "p9_status", { new_tab: true });
    const mark = events.length;
    await send_keys("G");
    const at_bottom = await wait_event(mark, scroll_of("p9_status"), "scroll to the bottom");
    await sleep(500);
    await send_keys(":");
    await sleep(900);
    if (shot_dir) await take_shot(`${shot_dir}/status-bottom.png`);
    // The first Escape closes the open list, the second the line.
    await send_keys("-k", "Escape");
    await sleep(300);
    await send_keys("-k", "Escape");
    await sleep(400);
    expect(last_scroll_y("p9_status") === at_bottom.y, "the page scrolled while the line was open");
    expect(await scroll_delta_after("p9_status", ["k"]) < 0, "k did not scroll up after the line closed");
    await send_keys(":");
    await sleep(900);
    if (shot_dir) await take_shot(`${shot_dir}/status-above-bottom.png`);
    // The first Escape closes the open list, the second the line.
    await send_keys("-k", "Escape");
    await sleep(300);
    await send_keys("-k", "Escape");
    await sleep(400);
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  await send_keys(...CTRL("w"));
  await sleep(700);
}
