// Key test cases of ]] and [[ (page.follow). run.mjs calls run_cases with its helpers.
export const areas = ["hints"];

export async function run_cases({ run_case, press_keys, open_page, wait_event, events }) {
  const BRACKET_RIGHT_TWICE = ["-k", "bracketright", "-k", "bracketright"];
  const BRACKET_LEFT_TWICE = ["-k", "bracketleft", "-k", "bracketleft"];
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await run_case("]] and [[ follow the rel links of the page, ahead of a link whose text matches", async () => {
    await open_page("follow_rel", "follow_rel", { new_tab: true });
    let mark = events.length;
    await press_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, loaded("follow_rel_next"), "the rel next page after ]]");
    await open_page("follow_rel", "follow_rel", { new_tab: false });
    mark = events.length;
    await press_keys(...BRACKET_LEFT_TWICE);
    await wait_event(mark, loaded("follow_rel_prev"), "the rel prev page after [[");
  });

  await run_case("]] and [[ follow a link by its text when it is off screen", async () => {
    await open_page("follow_text", "follow_text", { new_tab: false });
    let mark = events.length;
    await press_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, loaded("follow_text_next"), "the next page after ]]");
    await open_page("follow_text", "follow_text", { new_tab: false });
    mark = events.length;
    await press_keys(...BRACKET_LEFT_TWICE);
    await wait_event(mark, loaded("follow_text_prev"), "the previous page after [[");
  });

  await run_case("]] with no next page clicks the load control after the list", async () => {
    await open_page("follow_load", "follow_load", { new_tab: false });
    const mark = events.length;
    await press_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, (event) => event.type === "loaded" && event.page_id === "follow_load", "the items the load control added");
  });

  await run_case("]] with no next page and no load control scrolls an endless list to its end", async () => {
    await open_page("follow_load", "follow_load_scroll", { new_tab: false });
    const mark = events.length;
    await press_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, (event) => event.type === "loaded" && event.page_id === "follow_load_scroll", "the items the page added at its end");
  });

  await run_case("]] says so when the scroll loads nothing", async () => {
    await open_page("follow_load", "follow_load_dead", { new_tab: false });
    const mark = events.length;
    await press_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "follow_load_dead", "the Nothing loaded toast", 10000);
  });
}
