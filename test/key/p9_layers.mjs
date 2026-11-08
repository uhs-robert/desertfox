// Key test case of the layering: where surfaces overlap, the one with the higher LAYERS number is on top.
// The surfaces are top-layer popovers, where z-index has no effect, so the case hit-tests the page. At each grid point it
// reads the stack with elementsFromPoint: the top host must have a higher layer attribute than the next one. It writes no
// style, because hiding the command line host at each point floods the extension process that runs its frame.
// A key press closes the which-key panel, so the toast comes first and the panel opens over it while the toast shows.
// The re-show order itself is covered by test/content/surface.test.ts.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["ui", "whichkey", "cmdline"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, open_page, wait_event, wait_cmdline, close_cmdline, events, expect }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const hit_test_with_step = (step, before = "", right_width = Infinity) => `(() => {
    ${before}
    const layer = (element) => Number(element.getAttribute("data-desertfox-layer"));
    const own = (element) => element && element.hasAttribute("data-desertfox-layer");
    const overlaps = [];
    let hosts = 0;
    for (const child of document.documentElement.children) if (own(child)) hosts++;
    for (let x = Math.max(innerWidth - ${right_width}, 0); x < innerWidth; x += ${step}) {
      for (let y = Math.max(innerHeight - 160, 0); y < innerHeight; y += ${step}) {
        const stack = document.elementsFromPoint(x, y);
        // A closed shadow root retargets its content to the host, so a host can appear more than once.
        const hosts_here = stack.filter(own).filter((element, index, all) => all.indexOf(element) === index);
        if (hosts_here.length >= 2 && hosts_here[0] === stack[0]) overlaps.push([layer(hosts_here[0]), layer(hosts_here[1])]);
      }
    }
    return JSON.stringify({ hosts, overlaps });
  })()`;
  const hit_test = hit_test_with_step(8);

  await run_case("where surfaces overlap, the higher layer is on top", async () => {
    await open_page("caret", "p9_layers", { new_tab: true });
    // Each key waits for its effect: a mode badge or a moved selection.
    const press_and_wait = async (keys, predicate, what) => {
      const mark = events.length;
      await press_keys(keys);
      await wait_event(mark, (event) => event.page_id === "p9_layers" && predicate(event), what);
    };
    const badge_other_than_normal = (event) => event.type === "indicator" && event.label !== "" && event.label !== "NORMAL";
    await press_and_wait("gV", badge_other_than_normal, "the caret badge");
    await press_and_wait("3w", (event) => event.type === "selection", "the caret to move");
    await press_and_wait("v", (event) => event.type === "indicator" && event.label === "VISUAL", "the VISUAL badge");
    await press_and_wait("e", (event) => event.type === "selection" && event.text !== "", "a selected word");
    let mark = events.length;
    await press_keys("y");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers", "the copied toast");
    mark = events.length;
    await press_keys("_w");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9_layers" && event.value !== "", "the which-key panel");
    const { hosts, overlaps } = JSON.parse((await in_active_tab(hit_test))[0]);
    expect(hosts >= 2, `${hosts} surface hosts are shown, need the which-key panel and the toast`);
    expect(overlaps.length > 0, "no two surfaces overlap in the bottom 160px, so the order is not tested");
    const wrong = overlaps.filter(([top, under]) => top < under);
    expect(wrong.length === 0, `a lower layer is on top of a higher one at ${wrong.length} points, first ${JSON.stringify(wrong[0])}`);
  });

  // The line is a top-layer popover shown last. A surface mounted over it shows it again, which drops the frame's focus, and
  // the host gives the focus back. The text cannot be read from outside the iframe, so the case types a command in two parts
  // around the toast and checks that Enter ran it whole.
  // Not awaited: the page listener returns nothing for this message, and the debugger evaluation then never gets an answer.
  const push_toast = () => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); browser.tabs.sendMessage(tab.id, { type: "refusal", refusal: { message: "a toast long enough to cover many grid points" }, kind: "info" }).catch(() => {}); })()`);
  // The toast sits just above the line, so the probe first moves it down over the line in one style write. A translate on
  // the host makes it the containing block of the fixed toast inside, and the 0x0 host at the viewport's bottom right corner
  // keeps the toast where it was, 24px lower. The surface is reused, so a second toast keeps the move. LAYERS.toast, as in server.mjs.
  const move_toast_over_line = `for (const child of document.documentElement.children) if (child.getAttribute("data-desertfox-layer") === "2147483645") child.style.cssText += "left:100vw;top:calc(100vh + 24px);translate:0 0;";`;
  const toast_then_finish_typing = async (typed_before, step_keys, typed_after) => {
    // A tall page, so the command typed in the line has room to scroll. Each case opens it, so each runs alone.
    await open_page("page", "p9_layers_line", { new_tab: true });
    try {
      await type_around_toast(typed_before, step_keys, typed_after);
    } finally {
      await close_cmdline();
    }
  };
  const type_around_toast = async (typed_before, step_keys, typed_after) => {
    await press_keys(":");
    await wait_cmdline((line) => line.ready, "the command line to open");
    await press_keys(typed_before);
    await wait_cmdline((line) => line.value === typed_before, "the typed text in the line");
    if (step_keys.length > 0) {
      await press_keys(...step_keys);
      await wait_cmdline((line) => line.caret === typed_before.indexOf("."), "the caret to move left");
    }
    let mark = events.length;
    await push_toast();
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers_line", "the pushed toast");
    // Only the bottom right corner, where the toast is. A hit test where the toast covers the line's frame is slow in Firefox, and
    // the whole bottom of the page stalls the extension process past the debugger's timeout.
    const { hosts, overlaps } = JSON.parse((await in_active_tab(hit_test_with_step(8, move_toast_over_line, 320)))[0]);
    expect(overlaps.length > 0, `the toast and the line share no grid point in the bottom 160px (${hosts} surface hosts shown), so the order is not tested`);
    const wrong = overlaps.filter(([top, under]) => top < under);
    expect(wrong.length === 0, `a lower layer is on top of a higher one at ${wrong.length} points, first ${JSON.stringify(wrong[0])}`);
    // The toast showed the popover again, which drops the frame's focus until the host gives it back.
    await wait_cmdline((line) => line.open && line.focused, "the line to hold the focus after the toast");
    await press_keys(typed_after);
    await wait_cmdline((line) => line.value === "scroll.lines", "the whole command in the line");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, (event) => event.type === "scroll" && event.page_id === "p9_layers_line", "scroll.lines run from the typed line");
  };

  await run_case("a toast shown while typing in the command line: typing continues and the line stays on top", async () => {
    await toast_then_finish_typing("scroll.line", [], "s");
  });

  await run_case("a toast shown with the caret in the middle of the line: typing lands at the caret", async () => {
    // Six Left keys put the caret after "scrol", so the "l" typed after the toast completes "scroll.lines".
    await toast_then_finish_typing("scrol.lines", ["-k", "Left", "-k", "Left", "-k", "Left", "-k", "Left", "-k", "Left", "-k", "Left"], "l");
  });
}
