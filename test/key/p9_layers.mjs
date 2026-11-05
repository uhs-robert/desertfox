// Key test case of the layering: where surfaces overlap, the one with the higher LAYERS number is on top.
// The surfaces are top-layer popovers, where z-index has no effect, so the case hit-tests the page. At each grid point it
// takes the top host, hides it, and sees which host shows through: the one hidden must have the higher layer attribute.
// A key press closes the which-key panel, so the toast comes first and the panel opens over it while the toast shows.
// The re-show order itself is covered by test/content/surface.test.ts.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const hit_test_with_step = (step) => `(() => {
    const layer = (element) => Number(element.getAttribute("data-oasisfox-layer"));
    const own = (element) => element && element.hasAttribute("data-oasisfox-layer");
    const overlaps = [];
    let hosts = 0;
    for (const child of document.documentElement.children) if (own(child)) hosts++;
    for (let x = 0; x < innerWidth; x += ${step}) {
      for (let y = Math.max(innerHeight - 160, 0); y < innerHeight; y += ${step}) {
        const top = document.elementFromPoint(x, y);
        if (!own(top)) continue;
        const display = top.style.display;
        top.style.display = "none";
        const under = document.elementFromPoint(x, y);
        top.style.display = display;
        if (own(under)) overlaps.push([layer(top), layer(under)]);
      }
    }
    return JSON.stringify({ hosts, overlaps });
  })()`;
  const hit_test = hit_test_with_step(8);

  await run_case("where surfaces overlap, the higher layer is on top", async () => {
    await open_page("caret", "p9_layers", { new_tab: true });
    await send_keys("gV");
    await send_keys("3w");
    await send_keys("v");
    await send_keys("e");
    let mark = events.length;
    await send_keys("y");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers", "the copied toast");
    mark = events.length;
    await send_keys(",w");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9_layers" && event.value !== "", "the which-key panel");
    const { hosts, overlaps } = JSON.parse((await in_active_tab(hit_test))[0]);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect(hosts >= 2, `${hosts} surface hosts are shown, need the which-key panel and the toast`);
    expect(overlaps.length > 0, "no two surfaces overlap in the bottom 160px, so the order is not tested");
    const wrong = overlaps.filter(([top, under]) => top < under);
    expect(wrong.length === 0, `a lower layer is on top of a higher one at ${wrong.length} points, first ${JSON.stringify(wrong[0])}`);
  });

  // The line is a top-layer popover shown last. A surface mounted over it shows it again, which drops the frame's focus, and
  // the host gives the focus back. The text cannot be read from outside the iframe, so the case types a command in two parts
  // around the toast and checks that Enter ran it whole. Not yet run: the key-test queue belongs to another session.
  const push_toast = () => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.sendMessage(tab.id, { type: "refusal", refusal: { message: "a toast long enough to cover many grid points" }, kind: "info" }); })()`);
  // Escape closes the line, so a failed case does not leave it open for the next one.
  const close_line = async () => {
    await send_keys("-k", "Escape");
    await sleep(300);
    await send_keys("-k", "Escape");
    await sleep(300);
  };
  const toast_then_finish_typing = async (typed_before, step_keys, typed_after) => {
    try {
      await type_around_toast(typed_before, step_keys, typed_after);
    } finally {
      await close_line();
    }
  };
  const type_around_toast = async (typed_before, step_keys, typed_after) => {
    await send_keys(":");
    await sleep(600);
    await send_keys(typed_before);
    if (step_keys.length > 0) await send_keys(...step_keys);
    let mark = events.length;
    await push_toast();
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers_line", "the pushed toast");
    // A fine grid, since the toast is small next to the line.
    const { hosts, overlaps } = JSON.parse((await in_active_tab(hit_test_with_step(2)))[0]);
    expect(overlaps.length > 0, `the toast and the line share no grid point in the bottom 160px (${hosts} surface hosts shown), so the order is not tested`);
    const wrong = overlaps.filter(([top, under]) => top < under);
    expect(wrong.length === 0, `a lower layer is on top of a higher one at ${wrong.length} points, first ${JSON.stringify(wrong[0])}`);
    await send_keys(typed_after);
    mark = events.length;
    await send_keys("-k", "Return");
    await wait_event(mark, (event) => event.type === "scroll" && event.page_id === "p9_layers_line", "scroll.down run from the typed line");
  };

  await run_case("a toast shown while typing in the command line: typing continues and the line stays on top", async () => {
    await open_page("caret", "p9_layers_line", { new_tab: true });
    await toast_then_finish_typing("scroll.dow", [], "n");
  });

  await run_case("a toast shown with the caret in the middle of the line: typing lands at the caret", async () => {
    // Five Left keys put the caret after "scrol", so the "l" typed after the toast completes "scroll.down".
    await toast_then_finish_typing("scrol.down", ["-k", "Left", "-k", "Left", "-k", "Left", "-k", "Left", "-k", "Left"], "l");
  });
}
