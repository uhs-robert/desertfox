// A popup inside a subframe must survive the command line (#634). The line draws in the top frame, which takes the real focus, so the subframe gets blur and focusout.
// The subframe hides them from the page while the line is open. The fixture is /popup_frames (see popup_pages.mjs): a cross-origin frame with three popups that close on an element blur, a document focusout and a window blur.

export const areas = ["cmdline"];

export async function run_cases({ run_case, press_keys, open_page, open_cmdline, type_in_line, run_line, read_cmdline_state, expect, poll_until, wait_event, wait_takes_keys, events, in_active_tab }) {
  const top_id = "p6_popup_frame";
  const frame_id = `${top_id}_cross`;
  const closed_popups = () => events.filter((event) => event.page_id === frame_id && event.type === "popup_closed").map((event) => event.name);
  const expect_no_popup_closed = (when) => expect(closed_popups().length === 0, `${when}: popups closed: ${closed_popups().join(", ")}`);

  await run_case("the frame takes the keys and its three popups are open", async () => {
    await open_page("popup_frames", top_id, { new_tab: true, keys_page_id: frame_id });
    await wait_event(0, (event) => event.page_id === frame_id && event.type === "window_focus", "the popup frame to take the focus");
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
}
