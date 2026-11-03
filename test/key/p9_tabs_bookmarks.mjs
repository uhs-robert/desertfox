// Key test cases of piece P3 PR E (tab and bookmark completion). run.mjs calls run_cases with its helpers.
// The list sits in the extension-origin iframe, so the cases drive it with keys and check what the commands did.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep, url_of, became_visible }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);

  await open_page("page", "p9e_one", { new_tab: true });
  await open_page("page", "p9e_two", { new_tab: true });
  await open_page("page", "p9e_three", { new_tab: true });

  await run_case("tab, a typed name, Tab and Enter switch to that tab", async () => {
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys("tab p9e_one", "-k", "Tab", "-k", "Return");
    await wait_event(mark, became_visible("p9e_one"), "tab p9e_one after the pick");
  });

  await run_case("a leading number picks the tab at that place of the tab bar", async () => {
    const tabs = await background(`(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => tab.url))()`);
    const place = tabs.findIndex((url) => url.includes("p9e_three")) + 1;
    expect(place > 0, "p9e_three is not in the window");
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys(`tab ${place}`, "-k", "Return");
    await wait_event(mark, became_visible("p9e_three"), `tab p9e_three after "tab ${place}"`);
  });

  await run_case("bookmark -t lists the bookmarks, and a pick opens it in a new tab", async () => {
    await background(`browser.bookmarks.create({ title: "P9e Zeta bookmark", url: ${JSON.stringify(url_of("page", "p9e_mark"))} })`);
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys("bookmark -t zeta", "-k", "Tab", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9e_mark", "the bookmarked page in a new tab");
    await send_keys(...CTRL("w"));
    await sleep(500);
  });

  for (let closed = 0; closed < 3; closed++) {
    await send_keys(...CTRL("w"));
    await sleep(700);
  }
}
