// scroll.align (zt, zz, zb) on a field, on the heading a jump just reached, and on a page with nothing focused, the zoom reset z=, and the form control keys ]i and [i.

export const areas = ["scroll", "hints"];

export async function run_cases({ run_case, on_teardown, expect, open_page, press_keys, poll_until, events, wait_event, find_event, scroll_of, expect_no_scroll, in_background, record, wait_cmdline, type_in_line, read_cmdline_state }) {
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

  const in_tab = (code) => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))`).then((answer) => answer?.[0]);
  const toast_layer = 2147483647 - 2;
  const toast_text = () => in_tab(`(() => { const host = [...document.documentElement.children].find((child) => child.style.zIndex === "${toast_layer}"); return host?.openOrClosedShadowRoot?.textContent ?? ""; })()`);
  const bottom_of = (id) => in_tab(`Math.round(document.getElementById("${id}").getBoundingClientRect().bottom - innerHeight)`);

  const heading_top_of = (id) => in_tab(`document.getElementById("${id}")?.getBoundingClientRect().top`);

  await run_case("scroll.align puts the heading that ]h jumped to at the bottom, center and top", async () => {
    await open_page("headings", "align_heading", { new_tab: true });
    // The rows in page order are the title, Intro and Below, so a count of 3 lands on Below.
    let mark = events.length;
    await press_keys("3", "]", "h");
    await wait_event(mark, scroll_of("align_heading"), "the scroll of 3]h");
    await poll_until("Below at the top of the view", async () => Math.abs(await heading_top_of("below")) < 4);
    const top_after = async (keys) => {
      mark = events.length;
      await press_keys(...keys);
      await wait_event(mark, scroll_of("align_heading"), `scroll after ${keys.join(" ")}`);
      return heading_top_of("below");
    };
    const bottom = await top_after(["zb"]);
    const center = await top_after(["zz"]);
    const top = await top_after(["zt"]);
    expect(Math.abs(top) <= 2, `zt left the heading at ${top}`);
    expect(center > 100 && center < bottom, `zz left the heading at ${center}, zb at ${bottom}`);
    record("align_heading_tops", { top, center, bottom });
  });

  await run_case("scroll.align takes the newest of the heading jump and a later field focus, and sh fills the heading slot again", async () => {
    await open_page("headings_field", "align_newest", { new_tab: true });
    const scrolled = scroll_of("align_newest");
    let mark = events.length;
    await press_keys("3", "]", "h");
    await wait_event(mark, scrolled, "the scroll of 3]h");
    // The field takes the focus after the jump, so the slot is cleared and zb aligns the field that Escape just left.
    mark = events.length;
    await press_keys("gi");
    await wait_event(mark, scrolled, "the scroll of gi");
    await press_keys("-k", "Escape");
    await poll_until("the field to lose the focus", async () => (await in_tab("document.activeElement?.id")) !== "field");
    mark = events.length;
    await press_keys("zb");
    await wait_event(mark, scrolled, "the scroll after zb on the field");
    await poll_until("the field at the bottom of the view", async () => Math.abs(await bottom_of("field")) <= 2);
    expect(Math.abs(await bottom_of("below")) > 100, "zb aligned the heading and not the newer field");
    // sh runs from the command line, which gives the focus back to the page without a focus change that clears the slot.
    mark = events.length;
    await press_keys("sh");
    await wait_cmdline((line) => line.open && line.focused, "the heading list to open");
    await type_in_line("Below");
    await press_keys("-k", "Return");
    await wait_event(mark, scrolled, "the scroll of the sh pick");
    await poll_until("the command line to close", async () => !(await read_cmdline_state()).open);
    await poll_until("Below at the top of the view", async () => Math.abs(await heading_top_of("below")) < 4);
    mark = events.length;
    await press_keys("zb");
    await wait_event(mark, scrolled, "the scroll after zb on the sh heading");
    await poll_until("Below at the bottom of the view", async () => Math.abs(await bottom_of("below")) <= 2);
  });

  await run_case("scroll.align skips a heading that left the page and refuses when nothing else is left", async () => {
    await open_page("headings", "align_heading_gone", { new_tab: true });
    const mark = events.length;
    await press_keys("3", "]", "h");
    await wait_event(mark, scroll_of("align_heading_gone"), "the scroll of 3]h");
    // A stand-in of the same height keeps the layout, so the removal causes no scroll event of its own.
    await in_tab('const below = document.getElementById("below"); const stand_in = document.createElement("div"); stand_in.style.height = below.offsetHeight + "px"; below.replaceWith(stand_in)');
    const before_align = events.length;
    await press_keys("zb");
    await poll_until("the refusal notice", async () => (await toast_text()).includes("Nothing focused or selected to align"));
    await expect_no_scroll(before_align, "align_heading_gone");
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
