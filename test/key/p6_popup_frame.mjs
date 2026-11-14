// A popup inside a subframe must survive the command line (#634). The line draws in the top frame, which takes the real focus, so the subframe gets blur and focusout.
// The subframe hides them from the page while the line is open. The fixture is /popup_frames (see popup_pages.mjs): a cross-origin frame with three popups that close on an element blur, a document focusout and a window blur.

// A popup frame that takes the focus on load with no click is parked, which blurs its window and closes a popup that closes on a window blur. That is the cost of the park: the last case drives it once, and checks that Gecko's hand-back does not loop.

import { click_element } from "./native_click.mjs";

export const areas = ["cmdline", "ui"];

export async function run_cases({ run_case, press_keys, open_page, open_cmdline, type_in_line, run_line, read_cmdline_state, expect, poll_until, wait_event, wait_takes_keys, events, in_active_tab, rdp, sleep }) {
  const top_id = "p6_popup_frame_click";
  const frame_id = `${top_id}_cross`;
  const closed_popups = () => events.filter((event) => event.page_id === frame_id && event.type === "popup_closed").map((event) => event.name);
  const expect_no_popup_closed = (when) => expect(closed_popups().length === 0, `${when}: popups closed: ${closed_popups().join(", ")}`);

  const click_frame = () => click_element(rdp, in_active_tab, "cross", 150, 100);

  await run_case("the frame takes the keys and its three popups are open", async () => {
    await open_page("popup_frames", top_id, { new_tab: true });
    const mark = events.length;
    for (let attempt = 0; attempt < 6 && !events.slice(mark).some((event) => event.page_id === frame_id && event.type === "window_focus"); attempt++) {
      await click_frame();
      await sleep(300);
    }
    await wait_event(mark, (event) => event.page_id === frame_id && event.type === "window_focus", "the popup frame to take the focus from the click");
    await wait_takes_keys(frame_id);
    expect_no_popup_closed("before the line");
  });

  await run_case("opening the line and leaving it with Escape closes no popup", async () => {
    await open_cmdline();
    await type_in_line("scroll 5");
    expect_no_popup_closed("while the line is open");
    await press_keys("-k", "Escape");
    await poll_until("the line to close", async () => !(await read_cmdline_state()).open);
    expect_no_popup_closed("after Escape");
  });

  await run_case("running a command from the line closes no popup", async () => {
    await run_line("scroll 5");
    await poll_until("the line to close", async () => !(await read_cmdline_state()).open);
    expect_no_popup_closed("after Enter");
  });

  await run_case("a blur after the line closed reaches the page again", async () => {
    // The blocking ended with the line, so a real focus loss closes the popups.
    await in_active_tab(`document.getElementById("cross").blur(); 0`);
    await poll_until("the popups to close on a real blur", async () => closed_popups().length === 3);
  });

  await run_case("a popup frame that takes the focus on load is parked once: the popup that closes on a window blur closes and the frame is not handed focus again", async () => {
    const parked_top = "p6_popup_frame_parked";
    const parked_frame = `${parked_top}_cross`;
    const mark = events.length;
    await open_page("popup_frames", parked_top, { new_tab: true });
    await poll_until("the park to close the popup that closes on a window blur", async () => events.slice(mark).some((event) => event.page_id === parked_frame && event.type === "popup_closed" && event.name === "window"));
    // A second hand-back from Gecko would show as another window focus of the frame, and put the keys in it again.
    await sleep(800);
    expect(events.slice(mark).filter((event) => event.page_id === parked_frame && event.type === "window_focus").length === 1, "the frame took the focus more than once");
    await wait_takes_keys(parked_top);
  });
}
