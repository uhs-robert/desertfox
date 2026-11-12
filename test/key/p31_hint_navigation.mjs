// Hint mode and navigation. A navigation that replaces the document ends the mode. A change of the address inside the document (hash, pushState) ends it too, because the view the labels point at may be gone.
// Hint mode shows no badge, so the mode is read from the label host and from whether j scrolls: hint mode takes the letter, normal mode scrolls.

export const areas = ["hints"];

export async function run_cases({ run_case, press_keys, poll_until, open_page, wait_event, events, expect, in_active_tab, hint_label_count, scroll_delta_by_press, settle_focus }) {
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const start_hints = async (page_id) => {
    await open_page("hints", page_id, { new_tab: true });
    await press_keys("f");
    await poll_until("the hint labels after f", async () => (await hint_label_count()) > 0);
  };
  const expect_normal = async (what) => {
    await poll_until(`the hint labels to go after ${what}`, async () => (await hint_label_count()) === 0);
  };
  const expect_keys_work = async (page_id, what) => {
    await settle_focus();
    expect((await scroll_delta_by_press(page_id, ["j"])) > 0, `j did not scroll after ${what}`);
  };

  await run_case("after a reload the page is in normal mode with no labels", async () => {
    await start_hints("hn_reload");
    const mark = events.length;
    await in_active_tab(`setTimeout(() => location.reload(), 0); true`);
    await wait_event(mark, loaded("hn_reload"), "hn_reload to load again");
    await expect_normal("the reload");
    await expect_keys_work("hn_reload", "the reload");
  });

  await run_case("after a navigation to a new page the tab is in normal mode with no labels", async () => {
    await start_hints("hn_new_page");
    const mark = events.length;
    await in_active_tab(`setTimeout(() => location.assign("/page?id=hn_target"), 0); true`);
    await wait_event(mark, loaded("hn_target"), "the new page to load");
    await expect_normal("the navigation");
    await expect_keys_work("hn_target", "the navigation");
  });

  await run_case("after going back in history the page is in normal mode with no labels", async () => {
    await start_hints("hn_back");
    const mark = events.length;
    await in_active_tab(`setTimeout(() => location.assign("/page?id=hn_away"), 0); true`);
    await wait_event(mark, loaded("hn_away"), "the other page to load");
    const back_mark = events.length;
    await in_active_tab(`setTimeout(() => history.back(), 0); true`);
    // Measured here (Firefox 160): the page is reloaded on the way back, not restored from the back-forward cache, so only the reload path is proven. A restore would report the page visible again, a reload reports tree_read. A late hidden report of the old page matches neither.
    await wait_event(back_mark, (event) => event.page_id === "hn_back" && (event.type === "tree_read" || (event.type === "visibility" && event.state === "visible")), "the first page to show again");
    await expect_normal("the way back");
    await expect_keys_work("hn_back", "the way back");
  });

  for (const [page_id, name, change] of [["hn_hash", "a hash change", `location.hash = "#moved"`], ["hn_push", "history.pushState", `history.pushState({}, "", location.pathname + location.search + "&pushed=1")`]]) {
    await run_case(`${name} ends hint mode, as a new document does`, async () => {
      await start_hints(page_id);
      await in_active_tab(`${change}; true`);
      await expect_normal(name);
      await expect_keys_work(page_id, name);
    });
  }
}
