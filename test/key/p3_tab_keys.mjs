// The default t, x and r groups, where plain t, x and r are prefixes only, and Ctrl+A / Ctrl+X on the number in the address.
import { CTRL } from "./harness.mjs";

export const areas = ["tabs", "keys"];

export async function run_cases({ run_case, setup, expect, open_page, press_keys, settle_focus, expect_absent, wait_cmdline, close_cmdline, events, wait_event, scroll_delta_by_press }) {
  const panel_event = (event) => event.type === "whichkey" && event.page_id === "d_reload" && event.value !== "";
  await setup("open page d_reload", () => open_page("page", "d_reload", { new_tab: true }));

  await run_case("rr reloads the page", async () => {
    const mark = events.length;
    await press_keys("rr");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "d_reload", "d_reload to load again after rr");
    await settle_focus();
  });

  await run_case("tt opens the command line for its prompt without opening a tab", async () => {
    const mark = events.length;
    await press_keys("tt");
    await wait_cmdline((line) => line.open, "the command line to open after tt");
    await close_cmdline();
    await expect_absent(mark, "d_reload", (event) => event.type === "visibility" || event.type === "tree_read", "tt switched tabs or loaded a page");
  });

  await run_case("x alone does nothing", async () => {
    const mark = events.length;
    await press_keys("x");
    // x is a prefix, so the which-key panel shows once it arrived.
    await wait_event(mark, panel_event, "the which-key panel for the x prefix");
    await press_keys("-k", "Escape");
    await expect_absent(mark, "d_reload", (event) => event.type === "visibility", "x closed or switched a tab");
    expect(await scroll_delta_by_press("d_reload", ["j"]) > 0, "the page stopped taking keys after x");
  });

  await run_case("xx closes the tab", async () => {
    await open_page("page", "d_close", { new_tab: true });
    const mark = events.length;
    await press_keys("xx");
    const shown = await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id !== "d_close", "another tab after xx");
    expect(shown.page_id !== "d_close", "d_close is still the visible tab");
    await settle_focus();
    expect(await scroll_delta_by_press(shown.page_id, ["j"]) > 0, "the tab left after xx does not take keys");
  });

  await run_case("Ctrl+A adds one to the number in the address, and 3 then Ctrl+X takes three off", async () => {
    await open_page("page", "num_5", { new_tab: true });
    let mark = events.length;
    await press_keys(...CTRL("a"));
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_6", "the page num_6 after Ctrl+A");
    await settle_focus();
    mark = events.length;
    await press_keys("3", ...CTRL("x"));
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_3", "the page num_3 after 3 Ctrl+X");
  });
}
