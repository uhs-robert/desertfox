// scroll.align (zt, zz, zb) on a field and on a page with nothing focused, the zoom reset z=, and the form control keys ]i and [i.

export const areas = ["scroll", "hints"];

export async function run_cases({ run_case, on_teardown, expect, open_page, press_keys, poll_until, events, wait_event, find_event, scroll_of, expect_no_scroll, in_background, record }) {
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
    await poll_until("the field to lose the focus", async () => {
      const answer = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.activeElement?.id" }))`);
      return typeof answer?.[0] === "string" && answer[0] !== "field";
    });
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

  await run_case("]i and [i walk the form controls, skip a disabled fieldset, scroll to the far field and stop with a notice", async () => {
    await open_page("controls", "controls", { new_tab: true });
    const focused = (id) => (event) => event.type === "focused" && event.page_id === "controls" && event.id === id;
    const badge = (label) => (event) => event.type === "indicator" && event.page_id === "controls" && event.label === label;
    const press_and_wait = async (keys, predicate, what) => {
      const mark = events.length;
      await press_keys(...keys);
      await wait_event(mark, predicate, what);
      return mark;
    };
    const leave_field = (what) => press_and_wait(["-k", "Escape"], badge("NORMAL"), what);

    await press_and_wait(["]i"], focused("first"), "]i to focus the first field");
    await wait_event(0, badge("INSERT"), "the INSERT badge for a text field");
    await leave_field("NORMAL after Escape from the first field");

    const mark_box = await press_and_wait(["]i"], focused("box"), "]i to move on from the field Escape left, to the checkbox");
    expect(!find_event(mark_box, badge("INSERT")), "the checkbox switched the mode to insert");

    const mark_last = await press_and_wait(["]i"], focused("last"), "]i to skip the disabled fieldset and focus the far field");
    await wait_event(mark_last, (event) => event.type === "scroll" && event.page_id === "controls" && event.y > 0, "the page to scroll to the far field");
    await wait_event(mark_last, badge("INSERT"), "the INSERT badge for the far field");
    await leave_field("NORMAL after Escape from the far field");

    await press_and_wait(["[i"], focused("box"), "[i to go back to the checkbox, past the disabled fieldset");

    await press_and_wait(["]i"], focused("last"), "]i to the far field again");
    await leave_field("NORMAL after Escape at the last field");
    const mark_end = events.length;
    await press_keys("]i");
    await wait_event(mark_end, (event) => event.type === "toast" && event.page_id === "controls", "the stop notice past the last control");
    expect(!find_event(mark_end, (event) => event.type === "focused" && event.page_id === "controls"), "focus moved past the last control");
  });

  await run_case("focus into and out of a field in a closed shadow root switches between INSERT and NORMAL", async () => {
    const badge = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
    const press_and_wait = async (key, predicate, what) => {
      const mark = events.length;
      await press_keys("-k", key);
      await wait_event(mark, predicate, what);
    };

    await open_page("closed_field", "closed_field", { new_tab: true });
    await press_and_wait("F9", badge("closed_field", "INSERT"), "INSERT after the page focused the field in the closed root");
    await press_and_wait("F2", badge("closed_field", "NORMAL"), "NORMAL after the page focused the plain button outside");

    const mark_load = events.length;
    await open_page("closed_field", "closed_field_autofocus", { new_tab: true });
    await wait_event(mark_load, badge("closed_field_autofocus", "INSERT"), "INSERT for the field in the closed root focused at load");
    await press_and_wait("F2", badge("closed_field_autofocus", "NORMAL"), "NORMAL after focus left the load-focused field");
  });

  for (const root_kind of ["closed", "open"]) {
    await run_case(`focus moving between a field and a button inside one ${root_kind} shadow root follows INSERT and NORMAL`, async () => {
      const badge = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
      const press_and_wait = async (key, predicate, what) => {
        const mark = events.length;
        await press_keys("-k", key);
        await wait_event(mark, predicate, what);
      };
      const page_id = `${root_kind}_root_move`;

      await open_page("closed_field", page_id, { new_tab: true });
      await press_and_wait("F9", badge(page_id, "INSERT"), "INSERT after the page focused the field in the root");
      await press_and_wait("Tab", badge(page_id, "NORMAL"), "NORMAL after Tab moved focus to the button in the same root");
      await press_and_wait("F9", badge(page_id, "INSERT"), "INSERT after the page focused the field in the root again");
    });
  }
}
