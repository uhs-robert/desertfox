// Key test cases of piece P4 (which-key). run.mjs finds this file by its name and calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, take_shot, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
  const whichkey_events = (mark, page_id) => events.slice(mark).filter((event) => event.type === "whichkey" && event.page_id === page_id);

  await open_page("page", "wk", { new_tab: true });

  await run_case("g then a pause shows the which-key panel with the keys that follow", async () => {
    const mark = events.length;
    await send_keys("g");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && event.value !== "", "the which-key panel");
    expect(/^\d+:\d+$/.test(shown.value) && Number(shown.value.split(":")[1]) >= 5, `panel reported "${shown.value}"`);
  });

  await run_case("the next key closes the panel", async () => {
    const mark = events.length;
    await send_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && event.value === "", "the panel to close");
  });

  await run_case("gg typed at once shows no panel", async () => {
    const mark = events.length;
    await send_keys("gg");
    await sleep(700);
    expect(whichkey_events(mark, "wk").length === 0, "a panel showed for a finished sequence");
  });

  await run_case("g? opens the help page", async () => {
    const help_tab_count = `(async () => (await browser.tabs.query({})).filter((tab) => tab.url.endsWith("/help.html")).length)()`;
    const before = await evaluate_in_background(rdp, extension_id, help_tab_count);
    await send_keys("g?");
    await sleep(1000);
    const after = await evaluate_in_background(rdp, extension_id, help_tab_count);
    expect(after === before + 1, `help tabs went from ${before} to ${after}`);
    await evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/help.html")) await browser.tabs.remove(tab.id); })()`);
    await sleep(500);
  });

  // The page can read the panel host, so the test sees only numbers: how many groups were dropped from the title, and the panel width.
  const shape_after = async (keys) => {
    const mark = events.length;
    await send_keys(...keys);
    const shown = await wait_event(mark, (event) => event.type === "whichkey_shape" && event.width > 0, "the panel shape");
    // Set OASISFOX_SHOT_DIR to also save a screenshot of the panel.
    if (process.env.OASISFOX_SHOT_DIR) { await sleep(300); await take_shot(`${process.env.OASISFOX_SHOT_DIR}/${keys[0]}-title.png`); }
    await send_keys("-k", "Escape");
    return shown;
  };

  await run_case("a long group chain widens the panel to fit the title", async () => {
    const shown = await shape_after(["Qab"]);
    expect(shown.dropped === 0, `${shown.dropped} groups dropped from a chain that fits`);
    expect(shown.width > 400 && shown.width <= shown.viewport - 32, `panel width ${shown.width} of ${shown.viewport}`);
  });

  await run_case("a chain past the panel cap drops groups from the start, keeps the deepest and stays in the cap", async () => {
    const shown = await shape_after(["Zabcd"]);
    // Five groups: at least one dropped, and never the deepest, so at most four.
    expect(shown.dropped >= 1 && shown.dropped <= 4, `${shown.dropped} groups dropped from a chain of 5`);
    expect(shown.width <= shown.viewport - 32, `panel width ${shown.width} past the cap of ${shown.viewport - 32}`);
  });

  const panel_value = (mark, predicate, what) => wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && predicate(event.value), what);
  const is_panel_of = (rows) => (value) => value.endsWith(`:${rows}`);

  async function open_gx_panel() {
    let mark = events.length;
    await send_keys("g");
    await panel_value(mark, (value) => value !== "" && !is_panel_of(2)(value), "the g panel");
    mark = events.length;
    await send_keys("x");
    await panel_value(mark, is_panel_of(2), "the gx panel");
  }

  await run_case("gx then Backspace shows the g panel", async () => {
    await open_gx_panel();
    const mark = events.length;
    await send_keys("-k", "BackSpace");
    await panel_value(mark, (value) => value !== "" && !is_panel_of(2)(value), "the g panel again");
    await send_keys("-k", "Escape");
  });

  await run_case("g then Backspace closes the panel", async () => {
    let mark = events.length;
    await send_keys("g");
    await panel_value(mark, (value) => value !== "", "the g panel");
    mark = events.length;
    await send_keys("-k", "BackSpace");
    await panel_value(mark, (value) => value === "", "the panel to close");
    mark = events.length;
    await sleep(700);
    expect(whichkey_events(mark, "wk").length === 0, "the panel came back after Backspace");
  });

  await run_case("gx then Escape closes the panel", async () => {
    await open_gx_panel();
    const mark = events.length;
    await send_keys("-k", "Escape");
    await panel_value(mark, (value) => value === "", "the panel to close");
    await sleep(700);
    expect(whichkey_events(mark, "wk").every((event) => event.value === ""), "the panel came back after Escape");
  });

  // keymap.d binds ,w to help.whichkey in normal, caret and visual mode. It sits there so the keymap that config.reload writes keeps it. Each mode lists its own keys.
  const rows_after = async (keys, mode) => {
    const mark = events.length;
    await send_keys(...keys);
    const shown = await panel_value(mark, (value) => value !== "", `the manual panel in ${mode} mode`);
    return Number(shown.value.split(":")[1]);
  };

  await run_case("help.whichkey lists the keys of the current mode", async () => {
    await open_page("caret", "wk", { new_tab: true });
    const normal_rows = await rows_after([",w"], "normal");
    await send_keys("-k", "Escape");
    await send_keys("gV");
    const caret_rows = await rows_after([",w"], "caret");
    // Escape closes the panel and also leaves caret mode, so V starts caret mode again before v.
    await send_keys("-k", "Escape");
    await send_keys("gV");
    await send_keys("v");
    const visual_rows = await rows_after([",w"], "visual");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    expect(caret_rows !== normal_rows, `caret mode listed ${caret_rows} rows, the same as normal mode`);
    expect(visual_rows !== normal_rows, `visual mode listed ${visual_rows} rows, the same as normal mode`);
  });

  // Set OASISFOX_SHOT_DIR to also save screenshots of the panel. A raised page zoom shrinks the viewport, which forces the columns.
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  if (shot_dir) {
    const set_zoom = (factor) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); await browser.tabs.setZoom(tab.id, ${factor}); })()`);
    for (const [name, zoom] of [["g", 1], ["g-tall", 2.5]]) {
      await run_case(`screenshot of the panel for g (${name})`, async () => {
        await set_zoom(zoom);
        await sleep(500);
        const mark = events.length;
        await send_keys("-k", "Escape");
        await send_keys("g");
        await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && event.value !== "", "the which-key panel");
        await sleep(300);
        await take_shot(`${shot_dir}/${name}.png`);
        await send_keys("-k", "Escape");
        await set_zoom(1);
      });
    }
    await run_case("screenshots of the panel and the toast under a non-default theme", async () => {
      await open_page("caret_themed", "wk_theme", { new_tab: true });
      await send_keys("g");
      await sleep(900);
      await take_shot(`${shot_dir}/themed-panel.png`);
      await send_keys("-k", "Escape");
      await send_keys("gV");
      await send_keys("v");
      await send_keys("e");
      const mark = events.length;
      await send_keys("y");
      await wait_event(mark, (event) => event.type === "toast" && event.page_id === "wk_theme", "the copied toast");
      await take_shot(`${shot_dir}/themed-toast.png`);
      await send_keys("-k", "Escape");
      await send_keys("-k", "Escape");
    });
  }
}
