// scroll.align (zt, zz, zb) on a field and on a page with nothing focused, and the zoom reset z=.

export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event, scroll_of, expect_no_scroll, in_background, record }) {
  await run_case("scroll.align puts the field just left at the top, center and bottom", async () => {
    await open_page("aligned", "align", { new_tab: true });
    const field_top_after = async (keys) => {
      const mark = events.length;
      await send_keys(...keys);
      const reported = await wait_event(mark, scroll_of("align"), `scroll after ${keys.join(" ")}`);
      await sleep(300);
      return events.filter(scroll_of("align")).at(-1).field_top ?? reported.field_top;
    };
    await field_top_after(["gi"]);
    await send_keys("-k", "Escape");
    await sleep(300);
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
    await send_keys("zt");
    await expect_no_scroll(mark, "align_plain");
  });

  await run_case("z= resets the zoom to 100 percent", async () => {
    const active_zoom = `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.getZoom(tab.id); })()`;
    await send_keys("zI");
    await sleep(500);
    expect(await in_background(active_zoom) === 3, "zI did not zoom to 300 percent");
    await send_keys("z=");
    await sleep(500);
    expect(await in_background(active_zoom) === 1, "z= did not reset the zoom");
  });
}
