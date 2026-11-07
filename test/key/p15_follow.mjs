// Key test cases of ]] and [[ (page.follow). run.mjs calls run_cases with its helpers.
export async function run_cases({ run_case, send_keys, open_page, wait_event, events, sleep, became_visible }) {
  const BRACKET_RIGHT_TWICE = ["-k", "bracketright", "-k", "bracketright"];
  const BRACKET_LEFT_TWICE = ["-k", "bracketleft", "-k", "bracketleft"];
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await run_case("]] and [[ follow the rel links of the page, ahead of a link whose text matches", async () => {
    await open_page("follow_rel", "follow_rel", { new_tab: true });
    let mark = events.length;
    await send_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, loaded("follow_rel_next"), "the rel next page after ]]");
    await open_page("follow_rel", "follow_rel", { new_tab: false });
    mark = events.length;
    await send_keys(...BRACKET_LEFT_TWICE);
    await wait_event(mark, loaded("follow_rel_prev"), "the rel prev page after [[");
  });

  await run_case("]] and [[ follow a link by its text when it is off screen", async () => {
    await open_page("follow_text", "follow_text", { new_tab: false });
    let mark = events.length;
    await send_keys(...BRACKET_RIGHT_TWICE);
    await wait_event(mark, loaded("follow_text_next"), "the next page after ]]");
    await open_page("follow_text", "follow_text", { new_tab: false });
    mark = events.length;
    await send_keys(...BRACKET_LEFT_TWICE);
    await wait_event(mark, loaded("follow_text_prev"), "the previous page after [[");
    await sleep(300);
  });
}
