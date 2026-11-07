// The default t, x and r groups, where plain t, x and r are prefixes only, and Ctrl+A / Ctrl+X on the number in the address.
import { CTRL } from "./harness.mjs";

export async function run_cases({ run_case, setup, expect, open_page, send_keys, sleep, events, wait_event, find_event, scroll_delta_after, visible_events }) {
  await setup("open page d_reload", () => open_page("page", "d_reload", { new_tab: true }));

  await run_case("rr reloads the page", async () => {
    const mark = events.length;
    await send_keys("rr");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "d_reload", "d_reload to load again after rr");
  });

  await run_case("tt opens the command line for its prompt without opening a tab", async () => {
    const mark = events.length;
    await send_keys("tt");
    await sleep(1000);
    // The first Escape closes the completion list and keeps the line. The second closes the line.
    await send_keys("-k", "Escape");
    await sleep(400);
    await send_keys("-k", "Escape");
    await sleep(400);
    expect(visible_events(mark).length === 0, "tt switched tabs");
    expect(!find_event(mark, (event) => event.type === "tree_read"), "tt loaded a page");
  });

  await run_case("x alone does nothing", async () => {
    const mark = events.length;
    await send_keys("x");
    await sleep(1000);
    expect(visible_events(mark).length === 0, "x closed or switched a tab");
    await send_keys("-k", "Escape");
    expect(await scroll_delta_after("d_reload", ["j"]) > 0, "the page stopped taking keys after x");
  });

  await run_case("xx closes the tab", async () => {
    await open_page("page", "d_close", { new_tab: true });
    const mark = events.length;
    await send_keys("xx");
    const shown = await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id !== "d_close", "another tab after xx");
    expect(shown.page_id !== "d_close", "d_close is still the visible tab");
    expect(await scroll_delta_after(shown.page_id, ["j"]) > 0, "the tab left after xx does not take keys");
  });

  await run_case("Ctrl+A adds one to the number in the address, and 3 then Ctrl+X takes three off", async () => {
    await open_page("page", "num_5", { new_tab: true });
    let mark = events.length;
    await send_keys(...CTRL("a"));
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_6", "the page num_6 after Ctrl+A");
    mark = events.length;
    await send_keys("3", ...CTRL("x"));
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_3", "the page num_3 after 3 Ctrl+X");
  });
}
