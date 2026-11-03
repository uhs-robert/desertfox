// Key test cases of piece P4 (which-key). run.mjs calls this with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_whichkey_cases({ rdp, extension_id, take_shot, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
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
  }
}
