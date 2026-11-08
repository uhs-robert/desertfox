// scroll.align (zt, zz, zb) on a field and on a page with nothing focused, and the zoom reset z=.

export const areas = ["scroll"];

export async function run_cases({ run_case, on_teardown, expect, open_page, press_keys, poll_until, events, wait_event, scroll_of, expect_no_scroll, in_background, record }) {
  await run_case("scroll.align puts the field just left at the top, center and bottom", async () => {
    await open_page("aligned", "align", { new_tab: true });
    const field_top_after = async (keys) => {
      const mark = events.length;
      await press_keys(...keys);
      const reported = await wait_event(mark, scroll_of("align"), `scroll after ${keys.join(" ")}`);
      return events.filter(scroll_of("align")).at(-1).field_top ?? reported.field_top;
    };
    await field_top_after(["gi"]);
    await press_keys("-k", "Escape");
    await poll_until("the field to lose the focus", async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.activeElement?.id" }))`))?.[0] !== "field");
    const top = await field_top_after(["zt"]);
    expect(Math.abs(top) <= 2, `zt left the field at ${top}`);
    const center = await field_top_after(["zz"]);
    expect(center > 100, `zz left the field at ${center}`);
    const bottom = await field_top_after(["zb"]);
    expect(bottom > center, `zb left the field at ${bottom}, zz at ${center}`);
    record("align_field_tops", { top, center, bottom });
  });

  await run_case("scroll.align with nothing focused leaves the scroll position alone", async () => {
    await open_page("page", "align_plain", { new_tab: true });
    const mark = events.length;
    // zt has no effect to observe, so the proof that it arrived is the order: the barrier key follows it.
    await press_keys("zt");
    await expect_no_scroll(mark, "align_plain");
  });

  await run_case("z= resets the zoom to 100 percent", async () => {
    const tab_id = await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id)`);
    expect(Number.isInteger(tab_id), `no active tab id: ${tab_id}`);
    // Zoom is kept per site, so a failure after zI must not leave 300 percent for later pieces.
    on_teardown(() => in_background(`browser.tabs.setZoom(${tab_id}, 1)`));
    const active_zoom = `browser.tabs.getZoom(${tab_id})`;
    await press_keys("zI");
    await poll_until("the zoom to reach 300 percent", async () => (await in_background(active_zoom)) === 3).catch(async (error) => { throw new Error(`zI did not zoom to 300 percent (${error.message}, zoom ${await in_background(active_zoom)})`); });
    await press_keys("z=");
    await poll_until("the zoom to return to 100 percent", async () => (await in_background(active_zoom)) === 1).catch(async (error) => { throw new Error(`z= did not reset the zoom (${error.message}, zoom ${await in_background(active_zoom)})`); });
  });
}
